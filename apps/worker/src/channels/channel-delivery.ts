import { createHash } from "node:crypto";
import {
  decryptIntegrationCredentials,
  TelegramAdapter,
  WebhookAdapter,
  WebhookDeliveryError,
  type ChannelAdapter,
  type SendMessageResult,
} from "@leadvirt/integrations";
import { prisma, Prisma, type AiReplyRun } from "@leadvirt/db";
import {
  authorizeKnowledgeCapabilityEffectV1,
  type KnowledgeRuntimeRetriever,
  type KnowledgeV2GroundedAnswerService,
} from "@leadvirt/knowledge";
import type { ChannelSendMessageJobData } from "@leadvirt/types";
import {
  automaticReplyAdmissionState,
  completedAutomaticReplyHandoffAdmissionState,
} from "@leadvirt/runtime-queue";
import { recordSpanError, setSpanOk, SpanKind, startSpan } from "@leadvirt/observability";
import { recordChannelDelivery } from "../observability/metrics.js";
import {
  aiReplyContentHashV1,
  knowledgeHandoffReplyForTemplateV1,
} from "../ai/ai-reply-outcome.js";

const DELIVERY_VERSION = 1;
const DELIVERY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

type DeliveryMessage = Prisma.MessageGetPayload<{
  include: {
    conversation: {
      include: {
        channel: true;
        messages: true;
      };
    };
  };
}>;

type DeliveryOperation = Prisma.ChannelDeliveryOperationGetPayload<object>;

interface DeliveryOperationDescriptor {
  id: string;
  requestHash: string;
  channelKey: string;
  recipientKey: string;
  provider: ChannelSendMessageJobData["source"];
  deliveryVersion: number;
}

export interface ChannelDeliveryResult {
  status: "sent" | "failed" | "already_delivered" | "reconciliation_required" | "skipped";
  messageId: string;
  outboundStatus?: SendMessageResult["status"];
  providerExternalMessageId?: string;
  reason?: string;
  deliveryOperationId?: string;
}

export interface ChannelDeliveryKnowledgeDependencies {
  knowledgeRetriever: KnowledgeRuntimeRetriever;
  groundedAnswer: KnowledgeV2GroundedAnswerService;
  adapterFactory?: (input: {
    type: "TELEGRAM" | "WEBHOOK";
    channelId: string;
  }) => ChannelAdapter | null;
  maxDeliveryAttempts?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function telegramBotToken(credentials: unknown) {
  if (!isRecord(credentials)) return null;
  for (const value of [credentials.botToken, credentials.token]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metadataWith(
  message: DeliveryMessage,
  patch: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  const current = isRecord(message.metadata) ? (message.metadata as Prisma.InputJsonObject) : {};
  return {
    ...current,
    ...patch,
  };
}

function triggerRaw(
  message: DeliveryMessage,
  triggerMessageId: string | null | undefined,
): Prisma.InputJsonValue | null {
  const inbound = triggerMessageId
    ? message.conversation.messages.find((candidate) => candidate.id === triggerMessageId)
    : message.conversation.messages[0];
  const metadata = isRecord(inbound?.metadata) ? inbound.metadata : {};
  return isRecord(metadata.raw) || Array.isArray(metadata.raw) ? metadata.raw : null;
}

function adapterFor(
  message: DeliveryMessage,
  dependencies?: ChannelDeliveryKnowledgeDependencies,
): ChannelAdapter | null {
  const type = message.conversation.channel?.type;
  const channelId = message.conversation.channel?.id;
  if ((type === "TELEGRAM" || type === "WEBHOOK") && channelId && dependencies?.adapterFactory) {
    return dependencies.adapterFactory({ type, channelId });
  }
  if (type === "TELEGRAM") return new TelegramAdapter();
  if (type === "WEBHOOK") return new WebhookAdapter();
  return null;
}

function expectedChannelType(source: ChannelSendMessageJobData["source"]) {
  return source === "telegram" ? "TELEGRAM" : "WEBHOOK";
}

function successfulStatus(status: SendMessageResult["status"]) {
  return status === "sent" || status === "queued";
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function operationDescriptor(
  data: ChannelSendMessageJobData,
  message: DeliveryMessage,
  text: string,
): DeliveryOperationDescriptor {
  const channel = message.conversation.channel;
  if (!channel) throw new Error("Channel delivery operation requires a channel.");

  const channelAccountId = channel.externalId ?? channel.id;
  const recipientKey =
    message.conversation.externalConversationId?.trim() || message.conversationId;
  const channelKey = `${channel.type.toLowerCase()}:${channelAccountId}`;
  const requestHash = `sha256:${digest({
    schemaVersion: 1,
    tenantId: data.tenantId,
    conversationId: data.conversationId,
    messageId: data.messageId,
    provider: data.source,
    channelId: channel.id,
    channelAccountId,
    recipientKey,
    text,
    settings: channel.settings ?? null,
    aiReplyRunId: data.aiReplyRunId ?? null,
    aiReplyGeneration: data.aiReplyGeneration ?? null,
    aiReplySequence: data.aiReplySequence ?? null,
  })}`;
  const operationHash = digest({
    tenantId: data.tenantId,
    originatingMessageId: data.messageId,
    actionKind: "channels.sendMessage",
    requestHash,
    aiReplyRunId: data.aiReplyRunId ?? null,
    aiReplyGeneration: data.aiReplyGeneration ?? null,
    aiReplySequence: data.aiReplySequence ?? null,
    confirmationVersion: DELIVERY_VERSION,
  });

  return {
    id: `channel_delivery_${operationHash}`,
    requestHash,
    channelKey,
    recipientKey,
    provider: data.source,
    deliveryVersion: DELIVERY_VERSION,
  };
}

function operationMatches(
  operation: DeliveryOperation,
  descriptor: DeliveryOperationDescriptor,
  message: DeliveryMessage,
) {
  return (
    operation.id === descriptor.id &&
    operation.tenantId === message.tenantId &&
    operation.messageId === message.id &&
    operation.conversationId === message.conversationId &&
    operation.channelId === message.conversation.channel?.id &&
    operation.provider === descriptor.provider &&
    operation.channelKey === descriptor.channelKey &&
    operation.recipientKey === descriptor.recipientKey &&
    operation.deliveryVersion === descriptor.deliveryVersion &&
    operation.requestHash === descriptor.requestHash
  );
}

function assertOperationMatches(
  operation: DeliveryOperation,
  descriptor: DeliveryOperationDescriptor,
  message: DeliveryMessage,
) {
  if (operationMatches(operation, descriptor, message)) return;
  throw new Error(
    `Channel delivery operation conflict for message ${message.id}; refusing to send.`,
  );
}

async function findOperation(descriptor: DeliveryOperationDescriptor, message: DeliveryMessage) {
  return prisma.channelDeliveryOperation.findFirst({
    where: {
      tenantId: message.tenantId,
      messageId: message.id,
      channelKey: descriptor.channelKey,
      recipientKey: descriptor.recipientKey,
      deliveryVersion: descriptor.deliveryVersion,
    },
  });
}

async function findOrCreateRequestedOperation(
  descriptor: DeliveryOperationDescriptor,
  message: DeliveryMessage,
): Promise<DeliveryOperation> {
  const channel = message.conversation.channel;
  if (!channel) throw new Error("Channel delivery operation requires a channel.");
  const existing = await findOperation(descriptor, message);
  if (existing) {
    assertOperationMatches(existing, descriptor, message);
    return existing;
  }

  try {
    return await prisma.channelDeliveryOperation.create({
      data: {
        id: descriptor.id,
        tenantId: message.tenantId,
        messageId: message.id,
        conversationId: message.conversationId,
        channelId: channel.id,
        provider: descriptor.provider,
        channelKey: descriptor.channelKey,
        recipientKey: descriptor.recipientKey,
        deliveryVersion: descriptor.deliveryVersion,
        requestHash: descriptor.requestHash,
        status: "REQUESTED",
        retentionExpiresAt: new Date(Date.now() + DELIVERY_RETENTION_MS),
      },
    });
  } catch (error) {
    const concurrent = await findOperation(descriptor, message);
    if (!concurrent) throw error;
    assertOperationMatches(concurrent, descriptor, message);
    return concurrent;
  }
}

function settledOperationResult(
  operation: DeliveryOperation,
  message: DeliveryMessage,
): ChannelDeliveryResult | null {
  if (operation.status === "REQUESTED") return null;

  if (operation.status === "SUCCEEDED") {
    return {
      status: "already_delivered",
      messageId: message.id,
      ...(operation.providerMessageId
        ? { providerExternalMessageId: operation.providerMessageId }
        : {}),
      reason: "delivery_operation_succeeded",
      deliveryOperationId: operation.id,
    };
  }

  if (operation.status === "STARTED" || operation.status === "UNKNOWN") {
    return {
      status: "reconciliation_required",
      messageId: message.id,
      reason: `delivery_operation_${operation.status.toLowerCase()}`,
      deliveryOperationId: operation.id,
    };
  }

  if (operation.status === "FAILED") {
    return {
      status: "failed",
      messageId: message.id,
      reason: operation.errorCode ?? "delivery_operation_failed",
      deliveryOperationId: operation.id,
    };
  }

  return {
    status:
      message.status === "SENT" || message.status === "DELIVERED" ? "already_delivered" : "skipped",
    messageId: message.id,
    reason: "delivery_operation_reconciled",
    deliveryOperationId: operation.id,
  };
}

async function claimRequestedOperation(
  operation: DeliveryOperation,
  descriptor: DeliveryOperationDescriptor,
  message: DeliveryMessage,
): Promise<{ operation: DeliveryOperation; claimed: boolean }> {
  const claimed = await prisma.channelDeliveryOperation.updateMany({
    where: {
      id: operation.id,
      status: "REQUESTED",
      requestHash: descriptor.requestHash,
    },
    data: {
      status: "STARTED",
      attemptCount: { increment: 1 },
      startedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      nextRetryAt: null,
    },
  });

  const current = await prisma.channelDeliveryOperation.findUnique({ where: { id: operation.id } });
  if (!current)
    throw new Error(`Channel delivery operation ${operation.id} disappeared during claim.`);
  assertOperationMatches(current, descriptor, message);
  return { operation: current, claimed: claimed.count === 1 };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

async function recordUnknownOperation(
  operationId: string,
  code: string,
  error: unknown,
  jobId?: string,
) {
  await prisma.channelDeliveryOperation
    .updateMany({
      where: { id: operationId, status: "STARTED" },
      data: {
        status: "UNKNOWN",
        errorCode: code,
        errorMessage: errorMessage(error),
        result: {
          status: "unknown",
          jobId: jobId ?? null,
          recordedAt: new Date().toISOString(),
        },
      },
    })
    .catch(() => undefined);
}

async function markFailed(
  message: DeliveryMessage,
  reason: string,
  jobId?: string,
): Promise<ChannelDeliveryResult> {
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: "FAILED",
      metadata: metadataWith(message, {
        outboundStatus: "failed",
        deliveryJobId: jobId ?? null,
        delivery: {
          status: "failed",
          reason,
          jobId: jobId ?? null,
          failedAt: new Date().toISOString(),
        },
      }),
    },
  });

  return {
    status: "failed",
    messageId: message.id,
    reason,
  };
}

async function markSkipped(
  message: DeliveryMessage,
  reason: string,
  jobId?: string,
): Promise<ChannelDeliveryResult> {
  await prisma.message.updateMany({
    where: { id: message.id, status: { in: ["QUEUED", "FAILED"] } },
    data: {
      status: "FAILED",
      metadata: metadataWith(message, {
        outboundStatus: "skipped",
        deliveryJobId: jobId ?? null,
        delivery: {
          status: "skipped",
          reason,
          jobId: jobId ?? null,
          skippedAt: new Date().toISOString(),
        },
      }),
    },
  });
  return { status: "skipped", messageId: message.id, reason };
}

async function aiReplyFenceReason(data: ChannelSendMessageJobData, message: DeliveryMessage) {
  if (message.senderType !== "AI") return null;
  const run = await prisma.aiReplyRun.findUnique({
    where: {
      tenantId_replyMessageId: {
        tenantId: message.tenantId,
        replyMessageId: message.id,
      },
    },
  });
  if (!run) {
    return data.aiReplyRunId || data.aiReplyGeneration || data.aiReplySequence
      ? "ai_reply_run_not_found"
      : null;
  }
  if (
    (data.aiReplyRunId && data.aiReplyRunId !== run.id) ||
    (data.aiReplyGeneration !== undefined &&
      data.aiReplyGeneration !== null &&
      data.aiReplyGeneration !== run.generation) ||
    (data.aiReplySequence !== undefined &&
      data.aiReplySequence !== null &&
      data.aiReplySequence !== run.sequence)
  ) {
    return "ai_reply_delivery_identity_mismatch";
  }
  if (run.status !== "SUCCEEDED") return `ai_reply_run_${run.status.toLowerCase()}`;
  const outcomeReason = aiReplyOutcomeFenceReason(run, message);
  if (outcomeReason) return outcomeReason;
  if (
    run.generation !== message.conversation.aiGeneration ||
    run.sequence !== message.conversation.aiReplyFence
  ) {
    return "ai_reply_superseded";
  }
  return capabilityAutonomyFenceReason(prisma, run);
}

function aiReplyOutcomeFenceReason(run: AiReplyRun, message: DeliveryMessage) {
  if (!run.publicationId) return null;
  if (!run.replyDisposition || !run.replyContentHash) {
    return "ai_reply_outcome_binding_missing";
  }
  const text = message.text ?? "";
  if (aiReplyContentHashV1(text) !== run.replyContentHash) {
    return "ai_reply_content_binding_mismatch";
  }
  if (run.replyDisposition === "HANDOFF") {
    if (!run.replyTemplateVersion) return "ai_reply_handoff_template_binding_missing";
    const expected = knowledgeHandoffReplyForTemplateV1(run.replyTemplateVersion);
    if (!expected || text !== expected) return "ai_reply_handoff_template_binding_mismatch";
    return null;
  }
  if (run.replyDisposition === "AUTO_SEND" && run.replyTemplateVersion === null) return null;
  return "ai_reply_outcome_binding_invalid";
}

async function capabilityAutonomyFenceReason(
  db: Prisma.TransactionClient | typeof prisma,
  run: AiReplyRun,
) {
  if (!run.publicationId) return null;
  if (run.capabilityDecision === "HANDOFF") {
    return run.capabilitySetHash &&
      run.operationalBindingHash &&
      run.operationalPermissionGeneration &&
      run.replyDisposition === "HANDOFF" &&
      run.capabilityType === null &&
      run.allowedAutonomy === null &&
      run.requiredAutonomy === "ANSWER_ONLY"
      ? null
      : "ai_reply_handoff_autonomy_binding_invalid";
  }
  if (
    run.capabilityDecision !== "AUTHORIZED" ||
    !run.capabilityType ||
    !run.allowedAutonomy ||
    !run.requiredAutonomy ||
    !run.operationalBindingHash ||
    !run.operationalPermissionGeneration
  ) {
    return "ai_reply_capability_autonomy_binding_missing";
  }
  const snapshot = await db.knowledgePublicationCapability.findFirst({
    where: {
      tenantId: run.tenantId,
      publicationId: run.publicationId,
      capabilityType: run.capabilityType,
      allowedAutonomy: run.allowedAutonomy,
      operationalBindingHash: run.operationalBindingHash,
      operationalPermissionGeneration: run.operationalPermissionGeneration,
    },
    select: { capabilityId: true },
  });
  if (!snapshot) return "ai_reply_capability_autonomy_binding_revoked";
  const decision = authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: run.allowedAutonomy,
    effect: "ANSWER",
  });
  return decision.allowed && decision.requiredAutonomy === run.requiredAutonomy
    ? null
    : "ai_reply_capability_autonomy_denied";
}

async function lockedAiReplyFenceReason(
  tx: Prisma.TransactionClient,
  data: ChannelSendMessageJobData,
  message: DeliveryMessage,
) {
  if (message.senderType !== "AI") return null;
  const lockedRuns = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AiReplyRun"
    WHERE "tenantId" = ${message.tenantId}
      AND "conversationId" = ${message.conversationId}
      AND "replyMessageId" = ${message.id}
    FOR SHARE
  `);
  const lockedRunId = lockedRuns[0]?.id;
  const [conversation, run] = await Promise.all([
    tx.conversation.findUnique({
      where: { id: message.conversationId },
      select: { tenantId: true, aiGeneration: true, aiReplyFence: true, deletedAt: true },
    }),
    lockedRunId ? tx.aiReplyRun.findUnique({ where: { id: lockedRunId } }) : null,
  ]);
  if (!conversation || conversation.tenantId !== message.tenantId || conversation.deletedAt) {
    return "ai_reply_conversation_not_found";
  }
  if (!run) {
    return "ai_reply_run_not_found";
  }
  if (
    (data.aiReplyRunId && data.aiReplyRunId !== run.id) ||
    (data.aiReplyGeneration !== undefined &&
      data.aiReplyGeneration !== null &&
      data.aiReplyGeneration !== run.generation) ||
    (data.aiReplySequence !== undefined &&
      data.aiReplySequence !== null &&
      data.aiReplySequence !== run.sequence)
  ) {
    return "ai_reply_delivery_identity_mismatch";
  }
  if (run.status !== "SUCCEEDED") return `ai_reply_run_${run.status.toLowerCase()}`;
  const outcomeReason = aiReplyOutcomeFenceReason(run, message);
  if (outcomeReason) return outcomeReason;
  const admission = await (
    run.replyDisposition === "HANDOFF"
      ? completedAutomaticReplyHandoffAdmissionState
      : automaticReplyAdmissionState
  )(tx, {
    tenantId: message.tenantId,
    conversationId: message.conversationId,
  });
  if (!admission.admitted) return "ai_reply_automatic_reply_admission_revoked";
  if (run.publicationId !== admission.publicationId) {
    return "ai_reply_automatic_reply_publication_revoked";
  }
  if (run.capabilitySetHash !== admission.capabilitySetHash) {
    return "ai_reply_automatic_reply_capability_revoked";
  }
  if (
    run.operationalBindingHash !== admission.operationalBindingHash ||
    run.operationalPermissionGeneration !== admission.operationalPermissionGeneration
  ) {
    return "ai_reply_automatic_reply_operational_binding_revoked";
  }
  const autonomyReason = await capabilityAutonomyFenceReason(tx, run);
  if (autonomyReason) return autonomyReason;
  if (run.generation !== conversation.aiGeneration || run.sequence !== conversation.aiReplyFence) {
    return "ai_reply_superseded";
  }
  return null;
}

async function structuredReplyFenceReason(
  data: ChannelSendMessageJobData,
  message: DeliveryMessage,
  dependencies: ChannelDeliveryKnowledgeDependencies | undefined,
  transaction?: Prisma.TransactionClient,
) {
  if (message.senderType !== "AI") return null;
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const grounded = isRecord(metadata.groundedAnswer) ? metadata.groundedAnswer : null;
  const retrievalTraceId = stringValue(metadata, "retrievalTraceId");
  const runBinding = await (transaction ?? prisma).aiReplyRun.findFirst({
    where: { tenantId: data.tenantId, replyMessageId: message.id },
    select: {
      id: true,
      conversationId: true,
      inboundMessageId: true,
      replyMessageId: true,
      publicationId: true,
      generation: true,
      sequence: true,
      status: true,
      capabilityDecision: true,
      replyDisposition: true,
      replyContentHash: true,
      replyTemplateVersion: true,
      publication: { select: { corpusKind: true, targetKey: true } },
    },
  });
  if (
    runBinding?.publication?.corpusKind !== "STRUCTURED_V2" ||
    runBinding.publication.targetKey !== "workspace-v2"
  ) {
    return null;
  }
  if (
    !data.aiReplyRunId ||
    data.aiReplyGeneration === undefined ||
    data.aiReplyGeneration === null ||
    data.aiReplySequence === undefined ||
    data.aiReplySequence === null
  ) {
    return "structured_delivery_run_identity_missing";
  }
  if (
    runBinding.id !== data.aiReplyRunId ||
    runBinding.generation !== data.aiReplyGeneration ||
    runBinding.sequence !== data.aiReplySequence
  ) {
    return "structured_delivery_run_identity_mismatch";
  }
  const publicationId = runBinding.publicationId;
  if (!data.triggerMessageId) return "structured_delivery_trigger_missing";
  if (
    runBinding.status !== "SUCCEEDED" ||
    runBinding.conversationId !== data.conversationId ||
    runBinding.conversationId !== message.conversationId ||
    runBinding.replyMessageId !== message.id ||
    runBinding.inboundMessageId !== data.triggerMessageId
  ) {
    return "structured_delivery_trigger_mismatch";
  }
  if (runBinding.replyDisposition === "HANDOFF") return null;
  if (runBinding.replyDisposition !== "AUTO_SEND") {
    return "structured_delivery_reply_disposition_missing";
  }
  if (runBinding.capabilityDecision !== "AUTHORIZED") {
    return "structured_delivery_capability_decision_invalid";
  }
  if (!grounded) {
    return "structured_delivery_grounded_audit_missing";
  }
  if (grounded.disposition !== "AUTO_SEND") return "structured_delivery_disposition_invalid";
  if (!dependencies) return "structured_delivery_revalidator_unavailable";
  if (!retrievalTraceId || !publicationId) return "structured_delivery_trace_missing";
  const triggerMessage = await (transaction ?? prisma).message.findFirst({
    where: {
      id: data.triggerMessageId,
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
    },
    select: { id: true, text: true },
  });
  if (!triggerMessage || triggerMessage.id !== runBinding.inboundMessageId) {
    return "structured_delivery_trigger_mismatch";
  }
  const revalidated = await dependencies.knowledgeRetriever.revalidatePersistedReply({
    tenantId: data.tenantId,
    retrievalTraceId,
    responseMessageId: message.id,
    publicationId,
    query: triggerMessage.text ?? "",
    executionContextId: data.graphRunId ?? "",
    ...(transaction ? { transaction } : {}),
  });
  if (!revalidated.valid) {
    return `structured_delivery_${revalidated.reason.toLowerCase()}`;
  }
  const trace = await (transaction ?? prisma).knowledgeV2RetrievalTrace.findFirst({
    where: {
      id: retrievalTraceId,
      tenantId: data.tenantId,
      responseMessageId: message.id,
      publicationId,
    },
    select: {
      provider: true,
      generatorModel: true,
      modelProcessorPolicyHash: true,
      promptPolicyVersion: true,
      providerOutputHash: true,
      gateInputHash: true,
      gateResultHash: true,
      citations: {
        select: { evidenceReference: { select: { targetType: true } } },
      },
    },
  });
  const expected = {
    disposition: "AUTO_SEND" as const,
    provider: stringValue(grounded, "provider"),
    model: stringValue(grounded, "model"),
    providerVersion: stringValue(grounded, "providerVersion"),
    region: stringValue(grounded, "region"),
    processorPolicyVersion: stringValue(grounded, "processorPolicyVersion"),
    processorPolicyHash: stringValue(grounded, "processorPolicyHash"),
    promptPolicyVersion: stringValue(grounded, "promptPolicyVersion") ?? "",
  };
  if (
    !trace ||
    !expected.provider ||
    !expected.model ||
    !expected.providerVersion ||
    !expected.region ||
    !expected.processorPolicyVersion ||
    !expected.processorPolicyHash ||
    !expected.promptPolicyVersion ||
    trace.provider !== expected.provider ||
    trace.generatorModel !== expected.model ||
    trace.modelProcessorPolicyHash !== expected.processorPolicyHash ||
    trace.promptPolicyVersion !== expected.promptPolicyVersion ||
    trace.providerOutputHash !== stringValue(grounded, "providerOutputHash") ||
    trace.gateInputHash !== stringValue(grounded, "gateInputHash") ||
    trace.gateResultHash !== stringValue(grounded, "gateResultHash") ||
    (grounded.requiresLiveEvidence === true &&
      !trace.citations.some((citation) => citation.evidenceReference.targetType === "TOOL_RESULT"))
  ) {
    return "structured_delivery_audit_identity_changed";
  }
  const processor = await dependencies.groundedAnswer.revalidateProcessorAdmission(
    {
      tenantId: data.tenantId,
      promptPolicyVersion: revalidated.promptPolicyVersion ?? "",
      classifications: revalidated.classifications,
    },
    expected,
    transaction,
  );
  return processor ? null : "structured_delivery_model_policy_revoked";
}

async function reconcileSkippedOperation(
  operation: DeliveryOperation,
  message: DeliveryMessage,
  reason: string,
  jobId?: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.message.updateMany({
      where: { id: message.id, tenantId: message.tenantId, status: { in: ["QUEUED", "FAILED"] } },
      data: {
        status: "FAILED",
        metadata: metadataWith(message, {
          outboundStatus: "skipped",
          deliveryJobId: jobId ?? null,
          delivery: {
            status: "skipped",
            reason,
            deliveryOperationId: operation.id,
            jobId: jobId ?? null,
            skippedAt: new Date().toISOString(),
          },
        }),
      },
    });
    const reconciled = await tx.channelDeliveryOperation.updateMany({
      where: { id: operation.id, status: "STARTED" },
      data: {
        status: "RECONCILED",
        result: { status: "skipped", reason, jobId: jobId ?? null },
        errorCode: reason,
        completedAt: new Date(),
        reconciledAt: new Date(),
      },
    });
    if (reconciled.count !== 1)
      throw new Error(`Channel delivery operation ${operation.id} lost its claim.`);
  });
}

async function releaseUnstartedOperation(operationId: string, error: unknown) {
  await prisma.channelDeliveryOperation.updateMany({
    where: { id: operationId, status: "STARTED" },
    data: {
      status: "REQUESTED",
      errorCode: "DELIVERY_NOT_STARTED",
      errorMessage: errorMessage(error),
      startedAt: null,
      nextRetryAt: new Date(),
    },
  });
}

async function releaseRetryableWebhookOperation(operationId: string, error: WebhookDeliveryError) {
  const released = await prisma.channelDeliveryOperation.updateMany({
    where: { id: operationId, status: "STARTED" },
    data: {
      status: "REQUESTED",
      errorCode: error.code,
      errorMessage: null,
      result: {
        status: "retry_scheduled",
        code: error.code,
        providerOutcome: error.outcome,
        httpStatus: error.statusCode ?? null,
      },
      startedAt: null,
      nextRetryAt: new Date(Date.now() + 1_000),
    },
  });
  if (released.count !== 1) {
    throw new Error(`Channel delivery operation ${operationId} lost its retry claim.`);
  }
}

async function commitWebhookDeliveryFailure(
  operation: DeliveryOperation,
  message: DeliveryMessage,
  error: WebhookDeliveryError,
  jobId?: string,
): Promise<ChannelDeliveryResult> {
  const reason = error.code.toLowerCase();
  await prisma.$transaction(async (tx) => {
    const updatedMessage = await tx.message.updateMany({
      where: {
        id: message.id,
        tenantId: message.tenantId,
        conversationId: message.conversationId,
        status: { in: ["QUEUED", "FAILED"] },
      },
      data: {
        status: "FAILED",
        metadata: metadataWith(message, {
          outboundStatus: "failed",
          deliveryJobId: jobId ?? null,
          delivery: {
            status: "failed",
            reason,
            deliveryOperationId: operation.id,
            jobId: jobId ?? null,
            failedAt: new Date().toISOString(),
          },
        }),
      },
    });
    if (updatedMessage.count !== 1) {
      throw new Error(`Message ${message.id} changed during channel delivery.`);
    }

    const updatedOperation = await tx.channelDeliveryOperation.updateMany({
      where: { id: operation.id, status: "STARTED" },
      data: {
        status: "FAILED",
        result: {
          status: "failed",
          code: error.code,
          providerOutcome: error.outcome,
          retryable: error.retryable,
          httpStatus: error.statusCode ?? null,
          jobId: jobId ?? null,
        },
        errorCode: error.code,
        errorMessage: null,
        completedAt: new Date(),
        nextRetryAt: null,
      },
    });
    if (updatedOperation.count !== 1) {
      throw new Error(`Channel delivery operation ${operation.id} lost its claim.`);
    }
  });
  return {
    status: "failed",
    messageId: message.id,
    reason,
    deliveryOperationId: operation.id,
  };
}

async function commitAdapterFailure(
  operation: DeliveryOperation,
  message: DeliveryMessage,
  outbound: SendMessageResult,
  jobId?: string,
) {
  const reason = `adapter_status_${outbound.status}`;
  await prisma.$transaction(async (tx) => {
    const updatedMessage = await tx.message.updateMany({
      where: {
        id: message.id,
        tenantId: message.tenantId,
        conversationId: message.conversationId,
        status: { in: ["QUEUED", "FAILED"] },
      },
      data: {
        status: "FAILED",
        metadata: metadataWith(message, {
          outboundStatus: "failed",
          deliveryJobId: jobId ?? null,
          delivery: {
            status: "failed",
            reason,
            deliveryOperationId: operation.id,
            jobId: jobId ?? null,
            failedAt: new Date().toISOString(),
          },
        }),
      },
    });
    if (updatedMessage.count !== 1)
      throw new Error(`Message ${message.id} changed during channel delivery.`);

    const updatedOperation = await tx.channelDeliveryOperation.updateMany({
      where: { id: operation.id, status: "STARTED" },
      data: {
        status: "FAILED",
        providerMessageId: outbound.externalMessageId,
        result: {
          status: "failed",
          adapterStatus: outbound.status,
          providerExternalMessageId: outbound.externalMessageId,
          jobId: jobId ?? null,
        },
        errorCode: reason,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    if (updatedOperation.count !== 1)
      throw new Error(`Channel delivery operation ${operation.id} lost its claim.`);
  });
}

async function commitSuccessfulDelivery(
  data: ChannelSendMessageJobData,
  operation: DeliveryOperation,
  descriptor: DeliveryOperationDescriptor,
  message: DeliveryMessage,
  outbound: SendMessageResult,
  jobId?: string,
) {
  const channel = message.conversation.channel;
  if (!channel) throw new Error("Channel disappeared during delivery commit.");
  const sentAt = new Date();

  await prisma.$transaction(async (tx) => {
    const updatedMessage = await tx.message.updateMany({
      where: {
        id: message.id,
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        status: { in: ["QUEUED", "FAILED"] },
      },
      data: {
        status: "SENT",
        metadata: metadataWith(message, {
          outboundStatus: outbound.status,
          deliveryJobId: jobId ?? null,
          delivery: {
            status: "sent",
            adapterStatus: outbound.status,
            providerExternalMessageId: outbound.externalMessageId,
            deliveryOperationId: operation.id,
            requestHash: descriptor.requestHash,
            aiReplyRunId: data.aiReplyRunId ?? null,
            aiReplyGeneration: data.aiReplyGeneration ?? null,
            aiReplySequence: data.aiReplySequence ?? null,
            jobId: jobId ?? null,
            sentAt: sentAt.toISOString(),
          },
        }),
      },
    });
    if (updatedMessage.count !== 1)
      throw new Error(`Message ${message.id} changed during channel delivery.`);

    await tx.auditLog.create({
      data: {
        tenantId: data.tenantId,
        action: "channel.message.sent",
        entityType: "message",
        entityId: message.id,
        payload: {
          source: data.source,
          conversationId: data.conversationId,
          channelId: channel.id,
          channelType: channel.type,
          adapterStatus: outbound.status,
          providerExternalMessageId: outbound.externalMessageId,
          deliveryOperationId: operation.id,
          requestHash: descriptor.requestHash,
          deliveryVersion: descriptor.deliveryVersion,
          aiReplyRunId: data.aiReplyRunId ?? null,
          aiReplyGeneration: data.aiReplyGeneration ?? null,
          aiReplySequence: data.aiReplySequence ?? null,
          graphRunId: data.graphRunId ?? null,
          triggerMessageId: data.triggerMessageId ?? null,
          jobId: jobId ?? null,
        },
      },
    });

    const updatedOperation = await tx.channelDeliveryOperation.updateMany({
      where: {
        id: operation.id,
        status: "STARTED",
        requestHash: descriptor.requestHash,
      },
      data: {
        status: "SUCCEEDED",
        providerMessageId: outbound.externalMessageId,
        result: {
          status: "sent",
          adapterStatus: outbound.status,
          providerExternalMessageId: outbound.externalMessageId,
          messageId: message.id,
          aiReplyRunId: data.aiReplyRunId ?? null,
          aiReplyGeneration: data.aiReplyGeneration ?? null,
          aiReplySequence: data.aiReplySequence ?? null,
          jobId: jobId ?? null,
        },
        errorCode: null,
        errorMessage: null,
        completedAt: sentAt,
      },
    });
    if (updatedOperation.count !== 1)
      throw new Error(`Channel delivery operation ${operation.id} lost its claim.`);
  });
}

export async function deliverChannelMessage(
  data: ChannelSendMessageJobData,
  jobId?: string,
  signal?: AbortSignal,
  knowledgeDependencies?: ChannelDeliveryKnowledgeDependencies,
): Promise<ChannelDeliveryResult> {
  const ensureActive = () => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Channel delivery was cancelled.");
  };
  ensureActive();
  const startedAt = Date.now();
  let deliveryStatus = "failed";
  const span = startSpan("channel.delivery", {
    kind: SpanKind.PRODUCER,
    attributes: {
      "leadvirt.tenant_id": data.tenantId,
      "leadvirt.conversation_id": data.conversationId,
      "leadvirt.message_id": data.messageId,
      "leadvirt.source": data.source,
      "messaging.system": data.source,
    },
  });

  try {
    const message = await prisma.message.findFirst({
      where: {
        id: data.messageId,
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        direction: "OUTBOUND",
        senderType: { in: ["AI", "USER"] },
      },
      include: {
        conversation: {
          include: {
            channel: true,
            messages: data.triggerMessageId
              ? {
                  where: {
                    id: data.triggerMessageId,
                    direction: "INBOUND",
                    senderType: "CUSTOMER",
                  },
                  take: 1,
                }
              : {
                  where: { direction: "INBOUND" },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
          },
        },
      },
    });
    ensureActive();

    if (!message) throw new Error(`Message ${data.messageId} was not found for channel delivery.`);

    const existingOperation = await prisma.channelDeliveryOperation.findFirst({
      where: {
        tenantId: data.tenantId,
        messageId: message.id,
        conversationId: data.conversationId,
        deliveryVersion: DELIVERY_VERSION,
      },
      orderBy: { createdAt: "desc" },
    });
    ensureActive();
    if (existingOperation) {
      const existingResult = settledOperationResult(existingOperation, message);
      if (existingResult) {
        deliveryStatus = existingResult.status;
        return existingResult;
      }
    }

    if (message.status === "SENT" || message.status === "DELIVERED") {
      deliveryStatus = "already_delivered";
      return {
        status: "already_delivered",
        messageId: message.id,
        reason: message.status,
      };
    }

    if (message.status !== "QUEUED" && message.status !== "FAILED") {
      deliveryStatus = "skipped";
      return {
        status: "skipped",
        messageId: message.id,
        reason: `message_status_${message.status.toLowerCase()}`,
      };
    }

    const replyFenceReason = await aiReplyFenceReason(data, message);
    if (replyFenceReason) {
      const result = await markSkipped(message, replyFenceReason, jobId);
      deliveryStatus = result.status;
      return result;
    }
    const structuredFenceReason = await structuredReplyFenceReason(
      data,
      message,
      knowledgeDependencies,
    );
    if (structuredFenceReason) {
      const result = await markSkipped(message, structuredFenceReason, jobId);
      deliveryStatus = result.status;
      return result;
    }

    const channel = message.conversation.channel;
    if (!channel || channel.deletedAt || channel.status !== "ACTIVE") {
      const result = await markFailed(message, "channel_not_active", jobId);
      throw new Error(result.reason ?? "channel_not_active");
    }

    if (channel.type !== expectedChannelType(data.source)) {
      const result = await markFailed(
        message,
        `channel_type_${channel.type.toLowerCase()}_does_not_match_${data.source}`,
        jobId,
      );
      throw new Error(result.reason ?? "channel_type_mismatch");
    }

    const adapter = adapterFor(message, knowledgeDependencies);
    if (!adapter) {
      const result = await markFailed(message, "unsupported_channel_adapter", jobId);
      throw new Error(result.reason ?? "unsupported_channel_adapter");
    }

    const text = message.text?.trim();
    if (!text) {
      const result = await markFailed(message, "message_text_empty", jobId);
      throw new Error(result.reason ?? "message_text_empty");
    }

    let credentials: Record<string, unknown> | undefined;
    if (channel.encryptedCredentials) {
      try {
        credentials = decryptIntegrationCredentials(channel.encryptedCredentials);
      } catch {
        const result = await markFailed(message, "channel_credentials_invalid", jobId);
        throw new Error(result.reason ?? "channel_credentials_invalid");
      }
    }
    if (channel.type === "TELEGRAM" && !telegramBotToken(credentials)) {
      const result = await markFailed(message, "telegram_credentials_missing", jobId);
      throw new Error(result.reason ?? "telegram_credentials_missing");
    }
    const descriptor = operationDescriptor(data, message, text);
    ensureActive();

    const requestedOperation = await findOrCreateRequestedOperation(descriptor, message);
    const settledBeforeClaim = settledOperationResult(requestedOperation, message);
    if (settledBeforeClaim) {
      deliveryStatus = settledBeforeClaim.status;
      return settledBeforeClaim;
    }

    ensureActive();
    const claim = await claimRequestedOperation(requestedOperation, descriptor, message);
    if (!claim.claimed) {
      const settledAfterClaim = settledOperationResult(claim.operation, message);
      if (!settledAfterClaim)
        throw new Error(`Channel delivery operation ${claim.operation.id} could not be claimed.`);
      deliveryStatus = settledAfterClaim.status;
      return settledAfterClaim;
    }

    let outbound: SendMessageResult;
    let providerStarted = false;
    try {
      const authorizedSend = await prisma.$transaction(
        async (tx) => {
          const lockedConversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "Conversation"
            WHERE "id" = ${message.conversationId}
              AND "tenantId" = ${message.tenantId}
              AND "deletedAt" IS NULL
            FOR UPDATE
          `);
          if (lockedConversations.length !== 1) {
            return { fenceReason: "channel_conversation_not_found", outbound: null };
          }
          const currentConversation = await tx.conversation.findFirst({
            where: {
              id: message.conversationId,
              tenantId: message.tenantId,
              deletedAt: null,
            },
            select: { channelId: true, externalConversationId: true },
          });
          if (
            !currentConversation ||
            currentConversation.channelId !== channel.id ||
            currentConversation.externalConversationId !==
              message.conversation.externalConversationId
          ) {
            return { fenceReason: "channel_routing_changed", outbound: null };
          }
          const lockedChannels = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "Channel"
            WHERE "id" = ${channel.id}
              AND "tenantId" = ${message.tenantId}
              AND "deletedAt" IS NULL
            FOR SHARE
          `);
          if (lockedChannels.length !== 1) {
            return { fenceReason: "channel_not_active", outbound: null };
          }
          const currentChannel = await tx.channel.findFirst({
            where: { id: channel.id, tenantId: message.tenantId, deletedAt: null },
          });
          if (!currentChannel || currentChannel.status !== "ACTIVE") {
            return { fenceReason: "channel_not_active", outbound: null };
          }
          if (currentChannel.type !== expectedChannelType(data.source)) {
            return { fenceReason: "channel_type_changed", outbound: null };
          }
          if (
            currentChannel.externalId !== channel.externalId ||
            currentChannel.encryptedCredentials !== channel.encryptedCredentials ||
            digest(currentChannel.settings ?? null) !== digest(channel.settings ?? null)
          ) {
            return { fenceReason: "channel_configuration_changed", outbound: null };
          }
          let currentCredentials: Record<string, unknown> | undefined;
          if (currentChannel.encryptedCredentials) {
            try {
              currentCredentials = decryptIntegrationCredentials(
                currentChannel.encryptedCredentials,
              );
            } catch {
              return { fenceReason: "channel_credentials_invalid", outbound: null };
            }
          }
          if (currentChannel.type === "TELEGRAM" && !telegramBotToken(currentCredentials)) {
            return { fenceReason: "telegram_credentials_missing", outbound: null };
          }
          const replyFenceReason = await lockedAiReplyFenceReason(tx, data, message);
          if (replyFenceReason) return { fenceReason: replyFenceReason, outbound: null };
          const structuredFenceReason = await structuredReplyFenceReason(
            data,
            message,
            knowledgeDependencies,
            tx,
          );
          if (structuredFenceReason) {
            return { fenceReason: structuredFenceReason, outbound: null };
          }
          const currentAdapter = adapterFor(message, knowledgeDependencies);
          if (!currentAdapter) {
            return { fenceReason: "unsupported_channel_adapter", outbound: null };
          }
          ensureActive();
          providerStarted = true;
          const result = await currentAdapter.sendMessage({
            tenantId: data.tenantId,
            channelAccountId: currentChannel.externalId ?? currentChannel.id,
            conversationId: message.conversationId,
            externalConversationId: descriptor.recipientKey,
            text,
            ...(signal ? { signal } : {}),
            settings: currentChannel.settings,
            ...(currentCredentials ? { credentials: currentCredentials } : {}),
            metadata: {
              messageId: message.id,
              graphRunId: data.graphRunId ?? null,
              triggerMessageId: data.triggerMessageId ?? null,
              raw: triggerRaw(message, data.triggerMessageId),
              deliveryJobId: jobId ?? null,
              deliveryOperationId: claim.operation.id,
              deliveryRequestHash: descriptor.requestHash,
              deliveryVersion: descriptor.deliveryVersion,
              aiReplyRunId: data.aiReplyRunId ?? null,
              aiReplyGeneration: data.aiReplyGeneration ?? null,
              aiReplySequence: data.aiReplySequence ?? null,
            },
          });
          ensureActive();
          return { fenceReason: null, outbound: result };
        },
        { timeout: 25_000 },
      );
      if (authorizedSend.fenceReason) {
        await reconcileSkippedOperation(
          claim.operation,
          message,
          authorizedSend.fenceReason,
          jobId,
        );
        deliveryStatus = "skipped";
        return {
          status: "skipped",
          messageId: message.id,
          reason: authorizedSend.fenceReason,
          deliveryOperationId: claim.operation.id,
        };
      }
      if (!authorizedSend.outbound) throw new Error("Authorized channel delivery has no result.");
      outbound = authorizedSend.outbound;
    } catch (error) {
      if (providerStarted && error instanceof WebhookDeliveryError) {
        if (error.outcome === "UNKNOWN") {
          deliveryStatus = "unknown";
          await recordUnknownOperation(claim.operation.id, error.code, error, jobId);
          throw error;
        }
        const maxAttempts =
          typeof knowledgeDependencies?.maxDeliveryAttempts === "number" &&
          Number.isInteger(knowledgeDependencies.maxDeliveryAttempts) &&
          knowledgeDependencies.maxDeliveryAttempts > 0
            ? knowledgeDependencies.maxDeliveryAttempts
            : 3;
        if (error.retryable && claim.operation.attemptCount < maxAttempts) {
          await releaseRetryableWebhookOperation(claim.operation.id, error);
          throw error;
        }
        const result = await commitWebhookDeliveryFailure(claim.operation, message, error, jobId);
        deliveryStatus = result.status;
        return result;
      }
      if (providerStarted) {
        deliveryStatus = "unknown";
        await recordUnknownOperation(claim.operation.id, "ADAPTER_OUTCOME_UNKNOWN", error, jobId);
      } else {
        await releaseUnstartedOperation(claim.operation.id, error);
      }
      throw error;
    }

    if (!successfulStatus(outbound.status)) {
      try {
        await commitAdapterFailure(claim.operation, message, outbound, jobId);
      } catch (error) {
        await recordUnknownOperation(
          claim.operation.id,
          "DELIVERY_FAILURE_COMMIT_UNKNOWN",
          error,
          jobId,
        );
        throw error;
      }
      throw new Error(`adapter_status_${outbound.status}`);
    }

    try {
      await commitSuccessfulDelivery(data, claim.operation, descriptor, message, outbound, jobId);
    } catch (error) {
      deliveryStatus = "unknown";
      await recordUnknownOperation(
        claim.operation.id,
        "DELIVERY_SUCCESS_COMMIT_UNKNOWN",
        error,
        jobId,
      );
      throw error;
    }

    deliveryStatus = "sent";
    return {
      status: "sent",
      messageId: message.id,
      outboundStatus: outbound.status,
      providerExternalMessageId: outbound.externalMessageId,
      deliveryOperationId: claim.operation.id,
    };
  } catch (error) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.setAttribute("leadvirt.delivery_status", deliveryStatus);
    if (deliveryStatus !== "failed" && deliveryStatus !== "unknown") setSpanOk(span);
    span.end();
    recordChannelDelivery({
      source: data.source,
      status: deliveryStatus,
      durationMs: Date.now() - startedAt,
    });
  }
}
