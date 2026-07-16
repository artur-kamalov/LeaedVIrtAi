import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@leadvirt/db";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import type { AiReplyEnqueueRequest, AiReplyJobData } from "@leadvirt/types";
import { Queue } from "bullmq";
import { bullMqConnectionFromRedisUrl } from "./redis.js";

export {
  assertRedisClientReady,
  bullMqConnectionFromRedisUrl,
  RedisReadinessProbe,
  type BullMqRedisConnectionPolicy,
  type RedisReadinessProbeOptions,
} from "./redis.js";

export type RuntimeQueueName = "ai.reply" | "channels.sendMessage" | "knowledge.ingest";

export type KnowledgeSourceJobOperation = "IMPORT" | "SYNC" | "RECONCILE" | "DELETE";

export interface KnowledgeSourceJobData {
  tenantId: string;
  sourceId: string;
  knowledgeJobId: string;
  generation: number;
  operation: KnowledgeSourceJobOperation;
  requestedByUserId: string;
  requestedAt: string;
}

export interface RuntimeQueueEnvelope {
  queueName: RuntimeQueueName;
  jobName: string;
  jobId: string;
  data: Record<string, unknown>;
  attempts: number;
  backoffMs: number;
}

export interface CreateRuntimeQueueEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  generation?: number;
  eventType: string;
  dedupeKey: string;
  envelope: RuntimeQueueEnvelope;
  deadlineAt?: Date | null;
  traceId?: string | null;
  traceParent?: string | null;
}

export interface RuntimeOutboxDispatchResult {
  eventId: string;
  jobId: string;
  status: "published" | "already_published" | "not_available";
}

export type RuntimeQueuePublisher = (envelope: RuntimeQueueEnvelope) => Promise<void>;

type RuntimeOutboxRecord = Prisma.RuntimeOutboxGetPayload<object>;

export const automaticReplyAdmissionReasons = {
  conversationNotFound: "CONVERSATION_NOT_FOUND",
  conversationNotOpen: "CONVERSATION_NOT_OPEN",
  conversationHandoffRequested: "CONVERSATION_HANDOFF_REQUESTED",
  conversationAiDisabled: "CONVERSATION_AI_DISABLED",
  channelNotFound: "CHANNEL_NOT_FOUND",
  channelNotActive: "CHANNEL_NOT_ACTIVE",
  channelAutomationDisabled: "CHANNEL_AUTOMATIC_REPLIES_DISABLED",
  channelBindingIncomplete: "CHANNEL_AUTOMATIC_REPLY_BINDING_INCOMPLETE",
  channelFingerprintMismatch: "CHANNEL_AUTOMATIC_REPLY_FINGERPRINT_MISMATCH",
  corpusNotStructuredV2: "KNOWLEDGE_CORPUS_NOT_STRUCTURED_V2",
  activePublicationMissing: "KNOWLEDGE_ACTIVE_PUBLICATION_MISSING",
  publicationBindingMismatch: "KNOWLEDGE_PUBLICATION_BINDING_MISMATCH",
  capabilityBindingMismatch: "KNOWLEDGE_CAPABILITY_BINDING_MISMATCH",
  operationalBindingMismatch: "KNOWLEDGE_OPERATIONAL_BINDING_MISMATCH",
  activePublicationInvalid: "KNOWLEDGE_ACTIVE_PUBLICATION_INVALID",
} as const;

export type AutomaticReplyAdmissionReason =
  (typeof automaticReplyAdmissionReasons)[keyof typeof automaticReplyAdmissionReasons];

export interface AutomaticReplyChannelFingerprintInput {
  type: string;
  status: string;
  publicKey: string | null;
  externalId: string | null;
  settings: Prisma.JsonValue | null;
  encryptedCredentials: string | null;
}

export interface AutomaticReplyAdmissionBinding {
  admitted: true;
  channelId: string;
  channelGeneration: number;
  publicationId: string;
  publicationEtag: number;
  capabilitySetHash: string;
  operationalBindingHash: string;
  operationalPermissionGeneration: number;
  channelFingerprint: string;
}

export type AutomaticReplyAdmissionResult =
  | AutomaticReplyAdmissionBinding
  | { admitted: false; reason: AutomaticReplyAdmissionReason };

export type AiReplyQueueEventRejectionReason =
  | AutomaticReplyAdmissionReason
  | "EXISTING_AI_REPLY_RUN_PUBLICATION_MISMATCH"
  | "EXISTING_AI_REPLY_RUN_CAPABILITY_MISMATCH"
  | "EXISTING_AI_REPLY_RUN_OPERATIONAL_BINDING_MISMATCH";

export type CreateAiReplyQueueEventResult =
  | {
      created: true;
      event: Prisma.RuntimeOutboxGetPayload<object>;
      run: Prisma.AiReplyRunGetPayload<object>;
      admission: AutomaticReplyAdmissionBinding;
    }
  | { created: false; reason: AiReplyQueueEventRejectionReason };

interface LockedAutomaticReplyConversation {
  id: string;
  channelId: string | null;
  status: string;
  aiEnabled: boolean;
  handoffRequested: boolean;
}

interface LockedAutomaticReplyChannel extends AutomaticReplyChannelFingerprintInput {
  id: string;
  automaticRepliesEnabled: boolean;
  automaticRepliesGeneration: number;
  automaticRepliesPublicationId: string | null;
  automaticRepliesPublicationEtag: number | null;
  automaticRepliesCapabilitySetHash: string | null;
  automaticRepliesOperationalBindingHash: string | null;
  automaticRepliesOperationalPermissionGeneration: number | null;
  automaticRepliesChannelFingerprint: string | null;
  automaticRepliesActivatedAt: Date | null;
  automaticRepliesActivatedByUserId: string | null;
}

export function automaticReplyChannelFingerprint(channel: AutomaticReplyChannelFingerprintInput) {
  const encryptedCredentialsHash =
    typeof channel.encryptedCredentials === "string"
      ? createHash("sha256").update(channel.encryptedCredentials).digest("hex")
      : null;
  return createHash("sha256")
    .update(
      canonicalJson({
        version: "automatic-reply-channel-fingerprint-v1",
        type: channel.type,
        status: channel.status,
        publicKey: channel.publicKey ?? null,
        externalId: channel.externalId ?? null,
        settings: channel.settings ?? null,
        encryptedCredentialsHash,
      }),
    )
    .digest("hex");
}

async function automaticReplyAdmissionStateForConversationMode(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; conversationId: string },
  conversationMode: "OPEN" | "COMPLETED_HANDOFF",
): Promise<AutomaticReplyAdmissionResult> {
  const conversations = await tx.$queryRaw<LockedAutomaticReplyConversation[]>(Prisma.sql`
    SELECT
      "id",
      "channelId",
      "status"::text AS "status",
      "aiEnabled",
      "handoffRequested"
    FROM "Conversation"
    WHERE "id" = ${input.conversationId}
      AND "tenantId" = ${input.tenantId}
      AND "deletedAt" IS NULL
    FOR UPDATE
  `);
  const conversation = conversations[0];
  if (!conversation) {
    return { admitted: false, reason: automaticReplyAdmissionReasons.conversationNotFound };
  }
  if (conversationMode === "COMPLETED_HANDOFF") {
    if (conversation.status !== "WAITING_FOR_HUMAN" || !conversation.handoffRequested) {
      return { admitted: false, reason: automaticReplyAdmissionReasons.conversationNotOpen };
    }
  } else {
    if (conversation.status !== "OPEN") {
      return { admitted: false, reason: automaticReplyAdmissionReasons.conversationNotOpen };
    }
    if (conversation.handoffRequested) {
      return {
        admitted: false,
        reason: automaticReplyAdmissionReasons.conversationHandoffRequested,
      };
    }
  }
  if (!conversation.aiEnabled) {
    return { admitted: false, reason: automaticReplyAdmissionReasons.conversationAiDisabled };
  }
  if (!conversation.channelId) {
    return { admitted: false, reason: automaticReplyAdmissionReasons.channelNotFound };
  }

  const channels = await tx.$queryRaw<LockedAutomaticReplyChannel[]>(Prisma.sql`
    SELECT
      "id",
      "type"::text AS "type",
      "status"::text AS "status",
      "publicKey",
      "externalId",
      "settings",
      "encryptedCredentials",
      "automaticRepliesEnabled",
      "automaticRepliesGeneration",
      "automaticRepliesPublicationId",
      "automaticRepliesPublicationEtag",
      "automaticRepliesCapabilitySetHash",
      "automaticRepliesOperationalBindingHash",
      "automaticRepliesOperationalPermissionGeneration",
      "automaticRepliesChannelFingerprint",
      "automaticRepliesActivatedAt",
      "automaticRepliesActivatedByUserId"
    FROM "Channel"
    WHERE "id" = ${conversation.channelId}
      AND "tenantId" = ${input.tenantId}
      AND "deletedAt" IS NULL
    FOR SHARE
  `);
  const channel = channels[0];
  if (!channel) {
    return { admitted: false, reason: automaticReplyAdmissionReasons.channelNotFound };
  }
  if (channel.status !== "ACTIVE") {
    return { admitted: false, reason: automaticReplyAdmissionReasons.channelNotActive };
  }
  if (!channel.automaticRepliesEnabled) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.channelAutomationDisabled,
    };
  }
  if (
    !Number.isInteger(channel.automaticRepliesGeneration) ||
    channel.automaticRepliesGeneration < 1 ||
    typeof channel.automaticRepliesPublicationId !== "string" ||
    !channel.automaticRepliesPublicationId.trim() ||
    !Number.isInteger(channel.automaticRepliesPublicationEtag) ||
    (channel.automaticRepliesPublicationEtag ?? 0) < 1 ||
    typeof channel.automaticRepliesCapabilitySetHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(channel.automaticRepliesCapabilitySetHash) ||
    typeof channel.automaticRepliesOperationalBindingHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(channel.automaticRepliesOperationalBindingHash) ||
    !Number.isInteger(channel.automaticRepliesOperationalPermissionGeneration) ||
    (channel.automaticRepliesOperationalPermissionGeneration ?? 0) < 1 ||
    typeof channel.automaticRepliesChannelFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(channel.automaticRepliesChannelFingerprint) ||
    !(channel.automaticRepliesActivatedAt instanceof Date) ||
    Number.isNaN(channel.automaticRepliesActivatedAt.getTime()) ||
    typeof channel.automaticRepliesActivatedByUserId !== "string" ||
    !channel.automaticRepliesActivatedByUserId.trim()
  ) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.channelBindingIncomplete,
    };
  }

  const channelFingerprint = automaticReplyChannelFingerprint(channel);
  if (channel.automaticRepliesChannelFingerprint !== channelFingerprint) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.channelFingerprintMismatch,
    };
  }

  const selectors = await tx.$queryRaw<Array<{ corpusKind: string }>>(Prisma.sql`
    SELECT "corpusKind"::text AS "corpusKind"
    FROM "KnowledgeCorpusSelector"
    WHERE "tenantId" = ${input.tenantId}
    FOR SHARE
  `);
  if (selectors[0]?.corpusKind !== "STRUCTURED_V2") {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.corpusNotStructuredV2,
    };
  }

  const pointers = await tx.$queryRaw<Array<{ publicationId: string; etag: number }>>(Prisma.sql`
    SELECT "publicationId", "etag"
    FROM "ActiveKnowledgePublication"
    WHERE "tenantId" = ${input.tenantId}
      AND "targetKey" = 'workspace-v2'
    FOR SHARE
  `);
  const pointer = pointers[0];
  if (!pointer) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.activePublicationMissing,
    };
  }
  if (
    pointer.publicationId !== channel.automaticRepliesPublicationId ||
    pointer.etag !== channel.automaticRepliesPublicationEtag
  ) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.publicationBindingMismatch,
    };
  }

  const publications = await tx.$queryRaw<
    Array<{
      id: string;
      tenantId: string;
      targetKey: string;
      corpusKind: string;
      status: string;
      capabilitySetHash: string | null;
      operationalBindingHash: string | null;
      operationalPermissionGeneration: number | null;
    }>
  >(Prisma.sql`
    SELECT
      "id",
      "tenantId",
      "targetKey",
      "corpusKind"::text AS "corpusKind",
      "status"::text AS "status",
      "capabilitySetHash",
      "operationalBindingHash",
      "operationalPermissionGeneration"
    FROM "KnowledgePublication"
    WHERE "tenantId" = ${input.tenantId}
      AND "id" = ${pointer.publicationId}
    FOR SHARE
  `);
  const publication = publications[0];
  if (
    !publication ||
    publication.tenantId !== input.tenantId ||
    publication.id !== pointer.publicationId ||
    publication.status !== "ACTIVE" ||
    publication.corpusKind !== "STRUCTURED_V2" ||
    publication.targetKey !== "workspace-v2" ||
    typeof publication.capabilitySetHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(publication.capabilitySetHash) ||
    typeof publication.operationalBindingHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(publication.operationalBindingHash) ||
    !Number.isInteger(publication.operationalPermissionGeneration) ||
    (publication.operationalPermissionGeneration ?? 0) < 1
  ) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.activePublicationInvalid,
    };
  }
  if (publication.capabilitySetHash !== channel.automaticRepliesCapabilitySetHash) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.capabilityBindingMismatch,
    };
  }

  const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(tx, {
    tenantId: input.tenantId,
    lock: true,
  });
  if (
    operationalProjection.permissionGeneration === null ||
    operationalProjection.bindingHash !== publication.operationalBindingHash ||
    operationalProjection.permissionGeneration !== publication.operationalPermissionGeneration ||
    publication.operationalBindingHash !== channel.automaticRepliesOperationalBindingHash ||
    publication.operationalPermissionGeneration !==
      channel.automaticRepliesOperationalPermissionGeneration
  ) {
    return {
      admitted: false,
      reason: automaticReplyAdmissionReasons.operationalBindingMismatch,
    };
  }

  return {
    admitted: true,
    channelId: channel.id,
    channelGeneration: channel.automaticRepliesGeneration,
    publicationId: channel.automaticRepliesPublicationId,
    publicationEtag: channel.automaticRepliesPublicationEtag,
    capabilitySetHash: channel.automaticRepliesCapabilitySetHash,
    operationalBindingHash: channel.automaticRepliesOperationalBindingHash,
    operationalPermissionGeneration:
      channel.automaticRepliesOperationalPermissionGeneration,
    channelFingerprint,
  };
}

export function automaticReplyAdmissionState(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; conversationId: string },
) {
  return automaticReplyAdmissionStateForConversationMode(tx, input, "OPEN");
}

export function completedAutomaticReplyHandoffAdmissionState(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; conversationId: string },
) {
  return automaticReplyAdmissionStateForConversationMode(tx, input, "COMPLETED_HANDOFF");
}

export class RuntimeOutboxDeadlineError extends Error {
  constructor(eventId: string) {
    super(`Runtime outbox event ${eventId} expired before dispatch.`);
    this.name = "RuntimeOutboxDeadlineError";
  }
}

export function aiReplyRunIdentity(
  data: AiReplyJobData,
  inbound: { id: string; text: string | null; createdAt: Date },
  leadId: string | null,
) {
  const idempotencyDigest = createHash("sha256")
    .update(
      JSON.stringify(["ai-reply-idempotency-v1", data.tenantId, data.conversationId, inbound.id]),
    )
    .digest("hex");
  const inputDigest = createHash("sha256")
    .update(
      JSON.stringify([
        data.customerIdentity ? "ai-reply-input-v2" : "ai-reply-input-v1",
        data.tenantId,
        data.conversationId,
        inbound.id,
        inbound.text ?? "",
        inbound.createdAt.toISOString(),
        leadId,
        data.source,
        data.requestedByUserId ?? null,
        ...(data.customerIdentity
          ? [
              data.customerIdentity.id,
              data.customerIdentity.version,
              data.customerIdentity.subjectHash,
              data.customerIdentity.attestationHash,
            ]
          : []),
      ]),
    )
    .digest("hex");
  return {
    idempotencyKey: `ai-reply:v1:${idempotencyDigest}`,
    inputHash: `sha256:${inputDigest}`,
  };
}

function validIdentityReference(
  value: unknown,
): value is NonNullable<AiReplyJobData["customerIdentity"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    Object.keys(identity).length === 4 &&
    ["id", "version", "subjectHash", "attestationHash"].every((key) => key in identity) &&
    validDatabaseId(identity.id) &&
    identity.version === 1 &&
    typeof identity.subjectHash === "string" &&
    /^[a-f0-9]{64}$/u.test(identity.subjectHash) &&
    typeof identity.attestationHash === "string" &&
    /^[a-f0-9]{64}$/u.test(identity.attestationHash)
  );
}

function validDatabaseId(value: unknown): value is string {
  return typeof value === "string" && /^c[a-z0-9]{24}$/u.test(value);
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function requiredString(value: Prisma.JsonValue | undefined, field: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Runtime outbox payload is missing ${field}.`);
  return value;
}

function positiveInteger(value: Prisma.JsonValue | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

const persistedAiReplyDataKeys = new Set([
  "tenantId",
  "conversationId",
  "triggerMessageId",
  "source",
  "customerIdentity",
  "requestedByUserId",
]);

function assertOpaqueAiReplyEnvelope(envelope: RuntimeQueueEnvelope) {
  const data = envelope.data;
  if (
    envelope.jobName !== "generate-reply" ||
    Object.keys(data).some((key) => !persistedAiReplyDataKeys.has(key)) ||
    !validDatabaseId(data.tenantId) ||
    !validDatabaseId(data.conversationId) ||
    !validDatabaseId(data.triggerMessageId) ||
    !["inbox", "widget", "webhook", "telegram", "worker-test"].includes(String(data.source)) ||
    (data.customerIdentity !== undefined && !validIdentityReference(data.customerIdentity)) ||
    (data.requestedByUserId !== undefined &&
      data.requestedByUserId !== null &&
      !validDatabaseId(data.requestedByUserId)) ||
    envelope.jobId !== `ai-reply:${data.conversationId}:${data.triggerMessageId}`
  ) {
    throw new Error("Runtime ai.reply payload must contain only opaque persisted references.");
  }
}

export function parseRuntimeQueueEnvelope(payload: Prisma.JsonValue | null): RuntimeQueueEnvelope {
  const value = record(payload);
  const queueName = requiredString(value.queueName, "queueName");
  if (
    queueName !== "ai.reply" &&
    queueName !== "channels.sendMessage" &&
    queueName !== "knowledge.ingest"
  ) {
    throw new Error(`Unsupported runtime outbox queue ${queueName}.`);
  }
  const data = record(value.data);
  const envelope: RuntimeQueueEnvelope = {
    queueName,
    jobName: requiredString(value.jobName, "jobName"),
    jobId: requiredString(value.jobId, "jobId"),
    data,
    attempts: positiveInteger(value.attempts, 3),
    backoffMs: positiveInteger(value.backoffMs, 1000),
  };
  if (envelope.queueName === "ai.reply") assertOpaqueAiReplyEnvelope(envelope);
  return envelope;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function runtimeQueueEnvelopeSignature(envelope: RuntimeQueueEnvelope) {
  return createHash("sha256").update(canonicalJson(envelope)).digest("hex");
}

function errorDetails(error: unknown) {
  return {
    code: error instanceof Error ? error.name : "RUNTIME_OUTBOX_PUBLISH_FAILED",
    message:
      error instanceof Error ? error.message.slice(0, 500) : "Runtime outbox publish failed.",
  };
}

export async function createRuntimeQueueEvent(
  tx: Prisma.TransactionClient,
  input: CreateRuntimeQueueEventInput,
) {
  if (input.envelope.queueName === "ai.reply") {
    assertOpaqueAiReplyEnvelope(input.envelope);
    if (
      input.eventType !== "ai.reply.requested" ||
      input.envelope.data.tenantId !== input.tenantId ||
      input.aggregateId !== input.envelope.data.triggerMessageId ||
      input.dedupeKey !== input.envelope.jobId
    ) {
      throw new Error("Runtime ai.reply event metadata does not match its opaque references.");
    }
  }
  const payload = input.envelope as unknown as Prisma.InputJsonObject;
  const event = await tx.runtimeOutbox.upsert({
    where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } },
    update: {},
    create: {
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      generation: input.generation ?? 1,
      eventType: input.eventType,
      schemaVersion: 1,
      dedupeKey: input.dedupeKey,
      payload,
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.traceParent ? { traceParent: input.traceParent } : {}),
    },
  });
  const matches =
    event.tenantId === input.tenantId &&
    event.aggregateType === input.aggregateType &&
    event.aggregateId === input.aggregateId &&
    event.aggregateVersion === input.aggregateVersion &&
    event.generation === (input.generation ?? 1) &&
    event.eventType === input.eventType &&
    event.schemaVersion === 1 &&
    canonicalJson(event.payload) === canonicalJson(payload);
  if (!matches) {
    throw new Error(
      `Runtime outbox dedupe key ${input.dedupeKey} was reused with different input.`,
    );
  }
  return event;
}

export async function createAiReplyQueueEvent(
  tx: Prisma.TransactionClient,
  request: AiReplyEnqueueRequest,
): Promise<CreateAiReplyQueueEventResult> {
  const admission = await automaticReplyAdmissionState(tx, request);
  if (
    !admission.admitted &&
    admission.reason === automaticReplyAdmissionReasons.conversationNotFound
  ) {
    throw new Error("AI reply outbox conversation was not found.");
  }
  const lockedInbound = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Message"
    WHERE "id" = ${request.triggerMessageId}
      AND "tenantId" = ${request.tenantId}
      AND "conversationId" = ${request.conversationId}
      AND "direction" = 'INBOUND'::"MessageDirection"
    FOR UPDATE
  `);
  if (lockedInbound.length !== 1) {
    throw new Error("AI reply outbox requires the persisted inbound message.");
  }
  const inbound = await tx.message.findFirst({
    where: {
      id: request.triggerMessageId,
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      direction: "INBOUND",
    },
    select: {
      id: true,
      text: true,
      createdAt: true,
      authenticatedCustomerIdentity: {
        select: { id: true, version: true, subjectHash: true, attestationHash: true },
      },
    },
  });
  if (!inbound || (inbound.text ?? "") !== request.text) {
    throw new Error("AI reply outbox requires the persisted inbound message.");
  }
  const persistedIdentity = inbound.authenticatedCustomerIdentity;
  const customerIdentity = persistedIdentity
    ? {
        id: persistedIdentity.id,
        version: persistedIdentity.version,
        subjectHash: persistedIdentity.subjectHash,
        attestationHash: persistedIdentity.attestationHash,
      }
    : undefined;
  if (customerIdentity && !validIdentityReference(customerIdentity)) {
    throw new Error("AI reply outbox customer identity is invalid.");
  }
  if (!admission.admitted) return { created: false, reason: admission.reason };
  const conversation = await tx.conversation.findFirst({
    where: { id: request.conversationId, tenantId: request.tenantId, deletedAt: null },
    select: { id: true, leadId: true, aiGeneration: true },
  });
  if (!conversation) throw new Error("AI reply outbox conversation was not found.");

  const data: AiReplyJobData = {
    tenantId: request.tenantId,
    conversationId: request.conversationId,
    triggerMessageId: request.triggerMessageId,
    source: request.source,
    ...(customerIdentity ? { customerIdentity } : {}),
    ...(request.requestedByUserId !== undefined
      ? { requestedByUserId: request.requestedByUserId }
      : {}),
  };
  const identity = aiReplyRunIdentity(data, inbound, conversation.leadId);
  let run = await tx.aiReplyRun.findUnique({
    where: { tenantId_inboundMessageId: { tenantId: data.tenantId, inboundMessageId: inbound.id } },
  });
  if (run) {
    if (run.idempotencyKey !== identity.idempotencyKey || run.inputHash !== identity.inputHash) {
      throw new Error("AI reply idempotency key was reused with different input.");
    }
    if (run.publicationId !== admission.publicationId) {
      return { created: false, reason: "EXISTING_AI_REPLY_RUN_PUBLICATION_MISMATCH" };
    }
    if (run.capabilitySetHash !== admission.capabilitySetHash) {
      return { created: false, reason: "EXISTING_AI_REPLY_RUN_CAPABILITY_MISMATCH" };
    }
    if (
      run.operationalBindingHash !== admission.operationalBindingHash ||
      run.operationalPermissionGeneration !== admission.operationalPermissionGeneration
    ) {
      return { created: false, reason: "EXISTING_AI_REPLY_RUN_OPERATIONAL_BINDING_MISMATCH" };
    }
  } else {
    const allocated = await tx.conversation.update({
      where: { id: conversation.id },
      data: { aiReplySequence: { increment: 1 } },
      select: { aiGeneration: true, aiReplySequence: true },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { aiReplyFence: allocated.aiReplySequence },
    });
    await tx.aiReplyRun.updateMany({
      where: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"] },
        OR: [
          { generation: { lt: allocated.aiGeneration } },
          { generation: allocated.aiGeneration, sequence: { lt: allocated.aiReplySequence } },
        ],
      },
      data: {
        status: "SUPERSEDED",
        completedAt: new Date(),
        errorCode: "SUPERSEDED_BY_NEWER_INPUT",
        errorMessage: null,
      },
    });
    run = await tx.aiReplyRun.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        inboundMessageId: inbound.id,
        publicationId: admission.publicationId,
        capabilitySetHash: admission.capabilitySetHash,
        operationalBindingHash: admission.operationalBindingHash,
        operationalPermissionGeneration: admission.operationalPermissionGeneration,
        idempotencyKey: identity.idempotencyKey,
        inputHash: identity.inputHash,
        generation: allocated.aiGeneration,
        sequence: allocated.aiReplySequence,
        status: "QUEUED",
        attemptCount: 0,
      },
    });
  }

  const jobId = `ai-reply:${data.conversationId}:${data.triggerMessageId}`;
  const event = await createRuntimeQueueEvent(tx, {
    tenantId: data.tenantId,
    aggregateType: "conversation",
    aggregateId: data.triggerMessageId,
    aggregateVersion: run.sequence,
    generation: run.generation,
    eventType: "ai.reply.requested",
    dedupeKey: jobId,
    deadlineAt: new Date(Date.now() + 5 * 60_000),
    envelope: {
      queueName: "ai.reply",
      jobName: "generate-reply",
      jobId,
      data: data as unknown as Record<string, unknown>,
      attempts: run.maxAttempts,
      backoffMs: 1000,
    },
  });
  return { created: true, event, run, admission };
}

export class RuntimeOutboxDispatcher {
  private readonly queues = new Map<RuntimeQueueName, Queue<Record<string, unknown>>>();
  private draining = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisUrl: string,
    private readonly consumerName: string,
    private readonly leaseMs = 30_000,
    private readonly publisher?: RuntimeQueuePublisher,
  ) {}

  async dispatch(eventId: string): Promise<RuntimeOutboxDispatchResult> {
    const now = new Date();
    const lockId = `${this.consumerName}:${randomUUID()}`;
    const claimed = await this.prisma.runtimeOutbox.updateMany({
      where: {
        id: eventId,
        availableAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PUBLISHING", lockExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: "PUBLISHING",
        attemptCount: { increment: 1 },
        lockedAt: now,
        lockExpiresAt: new Date(now.getTime() + this.leaseMs),
        lockedBy: lockId,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    if (claimed.count === 0) {
      const existing = await this.prisma.runtimeOutbox.findUnique({ where: { id: eventId } });
      if (!existing) throw new Error(`Runtime outbox event ${eventId} was not found.`);
      const envelope = parseRuntimeQueueEnvelope(existing.payload);
      return {
        eventId,
        jobId: envelope.jobId,
        status: existing.status === "PUBLISHED" ? "already_published" : "not_available",
      };
    }

    const event = await this.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: eventId } });
    let envelope: RuntimeQueueEnvelope | undefined;
    let renewalTimer: NodeJS.Timeout | undefined;
    let renewal = Promise.resolve();
    let leaseLost = false;
    try {
      if (event.deadlineAt && event.deadlineAt <= new Date()) {
        throw new RuntimeOutboxDeadlineError(event.id);
      }
      envelope = parseRuntimeQueueEnvelope(event.payload);
      const dispatchEnvelope: RuntimeQueueEnvelope = {
        ...envelope,
        data: {
          ...envelope.data,
          runtimeEventId: event.id,
          runtimeGeneration: event.generation,
        },
      };
      const renewLease = async () => {
        const renewed = await this.prisma.runtimeOutbox.updateMany({
          where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
          data: {
            lockedAt: new Date(),
            lockExpiresAt: new Date(Date.now() + this.leaseMs),
          },
        });
        if (renewed.count !== 1) leaseLost = true;
      };
      renewalTimer = setInterval(
        () => {
          renewal = renewal.then(renewLease).catch(() => {
            leaseLost = true;
          });
        },
        Math.max(1000, Math.floor(this.leaseMs / 3)),
      );
      renewalTimer.unref();
      if (this.publisher) {
        await this.publisher(dispatchEnvelope);
      } else {
        const queue = this.queue(dispatchEnvelope.queueName);
        await queue.add(dispatchEnvelope.jobName, dispatchEnvelope.data, {
          jobId: dispatchEnvelope.jobId,
          attempts: dispatchEnvelope.attempts,
          backoff: { type: "exponential", delay: dispatchEnvelope.backoffMs },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        });
      }
      if (renewalTimer) clearInterval(renewalTimer);
      await renewal;
      if (leaseLost) throw new Error("Runtime outbox lease was lost during queue publish.");
      const published = await this.prisma.runtimeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockExpiresAt: null,
          lockedBy: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (published.count === 0)
        throw new Error("Runtime outbox lease was lost after queue publish.");
      return { eventId: event.id, jobId: envelope.jobId, status: "published" };
    } catch (error) {
      if (renewalTimer) clearInterval(renewalTimer);
      await renewal;
      const details = errorDetails(error);
      const terminal =
        error instanceof RuntimeOutboxDeadlineError ||
        event.attemptCount >= event.maxAttempts ||
        (event.deadlineAt ? event.deadlineAt <= new Date() : false);
      const delayMs = Math.min(60_000, 1000 * 2 ** Math.min(event.attemptCount, 6));
      await this.failClaimedEvent(event, lockId, details, terminal, delayMs).catch(() => undefined);
      throw error;
    }
  }

  async drain(limit = 25) {
    if (this.draining) return 0;
    this.draining = true;
    try {
      const now = new Date();
      const events = await this.prisma.runtimeOutbox.findMany({
        where: {
          availableAt: { lte: now },
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PUBLISHING", lockExpiresAt: { lte: now } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      for (const event of events) await this.dispatch(event.id).catch(() => undefined);
      return events.length;
    } finally {
      this.draining = false;
    }
  }

  async close() {
    await Promise.all(
      Array.from(this.queues.values(), (queue) => queue.close().catch(() => undefined)),
    );
    this.queues.clear();
  }

  private queue(name: RuntimeQueueName) {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<Record<string, unknown>>(name, {
        connection: bullMqConnectionFromRedisUrl(this.redisUrl, {
          connectTimeout: 1000,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        }),
      });
      queue.on("error", () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  private async failClaimedEvent(
    event: RuntimeOutboxRecord,
    lockId: string,
    details: { code: string; message: string },
    terminal: boolean,
    delayMs: number,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.runtimeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          availableAt: new Date(Date.now() + delayMs),
          lockedAt: null,
          lockExpiresAt: null,
          lockedBy: null,
          lastErrorCode: details.code,
          lastErrorMessage: details.message,
        },
      });
      if (updated.count !== 1 || !terminal) return;

      const payload = record(event.payload);
      const data = record(payload.data);
      if (event.eventType === "ai.reply.requested") {
        const inboundMessageId = data.triggerMessageId;
        if (typeof inboundMessageId === "string") {
          await tx.aiReplyRun.updateMany({
            where: {
              tenantId: event.tenantId,
              inboundMessageId,
              status: {
                in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"],
              },
            },
            data: {
              status: "DEAD_LETTER",
              errorCode: details.code,
              errorMessage: details.message,
              completedAt: new Date(),
            },
          });
        }
      } else if (event.eventType.startsWith("knowledge.source.")) {
        const knowledgeJobId = data.knowledgeJobId;
        const sourceId = data.sourceId;
        const operation = data.operation;
        const generation = data.generation;
        if (typeof knowledgeJobId === "string") {
          await tx.knowledgeJob.updateMany({
            where: {
              id: knowledgeJobId,
              tenantId: event.tenantId,
              status: { notIn: ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"] },
            },
            data: {
              status: "DEAD_LETTER",
              errorCode: "KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_UNDELIVERABLE",
              errorMessage: "The knowledge source event could not be delivered.",
              completedAt: new Date(),
            },
          });
        }
        if (
          typeof sourceId === "string" &&
          typeof generation === "number" &&
          Number.isInteger(generation)
        ) {
          await tx.knowledgeV2Source.updateMany({
            where: {
              id: sourceId,
              tenantId: event.tenantId,
              generation,
              status: { notIn: ["DELETED", "DISCONNECTED"] },
            },
            data: {
              ...(operation === "DELETE" ? {} : { status: "FAILED" as const }),
              lastErrorCode: "KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_UNDELIVERABLE",
              lastErrorAt: new Date(),
            },
          });
        }
      } else if (event.eventType === "channels.send-message.requested") {
        const messageId = data.messageId;
        if (typeof messageId === "string") {
          await tx.message.updateMany({
            where: { id: messageId, tenantId: event.tenantId, status: "QUEUED" },
            data: { status: "FAILED" },
          });
        }
      }
    });
  }
}
