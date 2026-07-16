import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@leadvirt/db";
import type { AuthenticatedCustomerIdentityReference, KnowledgeV2JsonValue } from "@leadvirt/types";
import {
  authenticatedCustomerChannelBindingHash,
  authenticatedCustomerIdentityAttestationHash,
  authenticatedCustomerSubjectHash,
  validAuthenticatedCustomerIdentityReference,
} from "./authenticated-customer-identity.js";
import {
  createDeterministicKnowledgeObjectKey,
  KnowledgeObjectStoreError,
  type KnowledgeObjectStore,
} from "./encrypted-file-object-store.js";
import { hashKnowledgeValue } from "./legacy-hash-embedding.js";
import { stableKnowledgeValue } from "./publisher.js";
import {
  equalKnowledgeV2QueryHashBindings,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  parseKnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "./tenant-query-hash.js";
import {
  isKnowledgeV2LiveToolResultValid,
  KNOWLEDGE_LIVE_TOOL_MAX_TTL_MS,
  KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
  knowledgeLiveToolAuthorizationScopeHash,
  knowledgeLiveToolResultEnvelopeHash,
  knowledgeLiveToolSubjectHash,
  type KnowledgeOperationalLiveCategory,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeV2LiveToolResult,
  type KnowledgeV2LiveToolResultExecutor,
  type KnowledgeV2LiveToolResultReference,
  type KnowledgeV2LiveToolResultResolver,
} from "./v2-retriever.js";
import { knowledgeV2LiveToolDefinitionV1 } from "./v2-live-tool-registry.js";

const LIVE_RESULT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const INTERNAL_RESULT_TTL_MS = 30_000;
const MAXIMUM_PAYLOAD_BYTES = 32 * 1024;
const RUN_CONTEXT_PREFIX = "langgraph:";

type DbClient = PrismaClient | Prisma.TransactionClient;

interface RuntimeSubject {
  runId: string;
  attemptNumber: number;
  conversationId: string;
  originatingMessageId: string;
  leadId: string;
  externalConversationId: string | null;
  channelId: string;
  channelType: KnowledgeRuntimeAuthorizationContext["channelType"];
  customerIdentity: AuthenticatedCustomerIdentityReference;
  permissionGeneration: number;
  runDeadlineAt: Date | null;
}

interface RuntimeIdentityChannel {
  id: string;
  tenantId: string;
  type: KnowledgeRuntimeAuthorizationContext["channelType"];
  externalId: string | null;
  publicKey: string | null;
}

interface RuntimeIdentityRecord {
  id: string;
  tenantId: string;
  version: number;
  channelId: string;
  conversationId: string;
  messageId: string;
  webhookEventId: string;
  provider: string;
  authenticationMethod: string;
  subjectSource: string;
  conversationType: string;
  subjectHash: string;
  channelBindingHash: string;
  eventPayloadHash: string;
  attestationHash: string;
  authenticatedAt: Date;
  webhookEvent: {
    id: string;
    tenantId: string | null;
    provider: string;
    externalEventId: string;
    payloadHash: string;
    payload: Prisma.JsonValue;
    status: string;
    errorMessage: string | null;
    receivedAt: Date;
    processedAt: Date | null;
  };
}

interface InternalReadResult {
  toolKey: string;
  toolVersion: string;
  safeName: string;
  resultType: string;
  value: KnowledgeV2JsonValue;
  exactValue: string;
  content: string;
  resourceType: "BOOKING" | "ORDER";
  resourceId: string;
  resourceVersion: Date;
}

export interface KnowledgeV2LiveToolLedgerCommitInput {
  result: KnowledgeV2LiveToolResult;
  query: string;
  executionKey: string;
  aiReplyRunId: string;
  conversationId: string;
  originatingMessageId: string;
  leadId: string | null;
  attemptNumber: number;
  revalidate(transaction: Prisma.TransactionClient): Promise<boolean>;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown) {
  return hashKnowledgeValue(stableKnowledgeValue(value));
}

function sameCustomerIdentity(left: AuthenticatedCustomerIdentityReference, right: unknown) {
  return (
    validAuthenticatedCustomerIdentityReference(right) &&
    left.id === right.id &&
    left.version === right.version &&
    left.subjectHash === right.subjectHash &&
    left.attestationHash === right.attestationHash
  );
}

function telegramPrivateBoundary(payload: unknown) {
  const update = isRecord(payload) ? payload : {};
  const message = isRecord(update.message)
    ? update.message
    : isRecord(update.edited_message)
      ? update.edited_message
      : null;
  if (!message) return null;
  const chat = isRecord(message.chat) ? message.chat : {};
  const sender = isRecord(message.from) ? message.from : {};
  const updateId = positiveSafeInteger(update.update_id);
  const messageId = positiveSafeInteger(message.message_id);
  const chatId = positiveSafeInteger(chat.id);
  const senderId = positiveSafeInteger(sender.id);
  if (
    updateId === null ||
    messageId === null ||
    chat.type !== "private" ||
    sender.is_bot !== false ||
    chatId === null ||
    senderId === null ||
    chatId !== senderId
  ) {
    return null;
  }
  return {
    externalEventId: `telegram:update:${updateId}`,
    externalMessageId: `telegram:${messageId}`,
    externalConversationId: `telegram:${chatId}`,
    externalSubjectId: String(senderId),
  };
}

function positiveSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function revalidatedCustomerIdentity(input: {
  tenantId: string;
  conversationId: string;
  messageId: string;
  externalConversationId: string | null;
  externalMessageId: string | null;
  channel: RuntimeIdentityChannel;
  identity: RuntimeIdentityRecord | null;
}): AuthenticatedCustomerIdentityReference | null {
  const identity = input.identity;
  const event = identity?.webhookEvent;
  const boundary = telegramPrivateBoundary(event?.payload);
  if (
    !identity ||
    !event ||
    !boundary ||
    identity.tenantId !== input.tenantId ||
    identity.version !== 1 ||
    identity.channelId !== input.channel.id ||
    identity.conversationId !== input.conversationId ||
    identity.messageId !== input.messageId ||
    identity.provider !== "TELEGRAM" ||
    identity.authenticationMethod !== "TELEGRAM_WEBHOOK_SECRET" ||
    identity.subjectSource !== "TELEGRAM_MESSAGE_FROM_ID" ||
    identity.conversationType !== "PRIVATE" ||
    input.channel.tenantId !== input.tenantId ||
    input.channel.type !== "TELEGRAM" ||
    event.id !== identity.webhookEventId ||
    event.tenantId !== input.tenantId ||
    event.provider !== `telegram:${input.channel.id}` ||
    event.externalEventId !== boundary.externalEventId ||
    event.payloadHash !== identity.eventPayloadHash ||
    input.externalConversationId !== boundary.externalConversationId ||
    input.externalMessageId !== boundary.externalMessageId ||
    event.status !== "PROCESSED" ||
    event.errorMessage !== null ||
    !event.processedAt ||
    identity.authenticatedAt.getTime() !== event.receivedAt.getTime() ||
    event.processedAt.getTime() < event.receivedAt.getTime()
  ) {
    return null;
  }
  const subjectHash = authenticatedCustomerSubjectHash({
    tenantId: input.tenantId,
    channelId: input.channel.id,
    provider: "TELEGRAM",
    externalSubjectId: boundary.externalSubjectId,
  });
  if (subjectHash !== identity.subjectHash) return null;
  const channelBindingHash = authenticatedCustomerChannelBindingHash({
    tenantId: input.tenantId,
    channelId: input.channel.id,
    channelType: input.channel.type,
    channelExternalId: input.channel.externalId ?? "",
    channelPublicKey: input.channel.publicKey ?? "",
  });
  if (channelBindingHash !== identity.channelBindingHash) return null;
  const attestationHash = authenticatedCustomerIdentityAttestationHash({
    tenantId: input.tenantId,
    version: 1,
    channelId: input.channel.id,
    conversationId: input.conversationId,
    messageId: input.messageId,
    webhookEventId: identity.webhookEventId,
    provider: "TELEGRAM",
    authenticationMethod: "TELEGRAM_WEBHOOK_SECRET",
    subjectSource: "TELEGRAM_MESSAGE_FROM_ID",
    conversationType: "PRIVATE",
    subjectHash: identity.subjectHash,
    channelBindingHash,
    eventPayloadHash: identity.eventPayloadHash,
    authenticatedAt: identity.authenticatedAt,
  });
  if (attestationHash !== identity.attestationHash) return null;
  return {
    id: identity.id,
    version: 1,
    subjectHash: identity.subjectHash,
    attestationHash,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSerializationFailure(error: unknown) {
  return isRecord(error) && error.code === "P2034";
}

function isUniqueConflict(error: unknown) {
  return isRecord(error) && error.code === "P2002";
}

function parseRunId(executionContextId: string) {
  if (!executionContextId.startsWith(RUN_CONTEXT_PREFIX)) return null;
  const runId = executionContextId.slice(RUN_CONTEXT_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/u.test(runId) ? runId : null;
}

function decodedResult(value: Uint8Array): KnowledgeV2LiveToolResult | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(value));
    return isRecord(parsed) ? (parsed as unknown as KnowledgeV2LiveToolResult) : null;
  } catch {
    return null;
  }
}

async function objectBytes(input: {
  store: KnowledgeObjectStore;
  key: string;
  encryptionKeyRef: string;
  expectedBytes: number;
  expectedHash: string;
}) {
  try {
    const bytes = await input.store.get(input.key, input.encryptionKeyRef);
    if (bytes.byteLength !== input.expectedBytes || sha256(bytes) !== input.expectedHash) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

async function putImmutablePayload(input: {
  store: KnowledgeObjectStore;
  encryptionKeyId: string;
  tenantId: string;
  executionId: string;
  envelopeHash: string;
  payload: Uint8Array;
}) {
  const payloadHash = sha256(input.payload);
  const key = createDeterministicKnowledgeObjectKey({
    tenantId: input.tenantId,
    sourceId: "knowledge-v2-live-tool",
    purpose: "raw",
    identity: `${input.encryptionKeyId}:${input.executionId}:${input.envelopeHash}:${payloadHash}`,
  });
  try {
    const written = await input.store.put(key, input.payload);
    return {
      key: written.key,
      encryptionKeyRef: written.encryptionKeyRef,
      payloadHash,
      payloadBytes: input.payload.byteLength,
      created: true,
    };
  } catch (error) {
    if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS") {
      throw error;
    }
    const existing = await objectBytes({
      store: input.store,
      key,
      encryptionKeyRef: input.encryptionKeyId,
      expectedBytes: input.payload.byteLength,
      expectedHash: payloadHash,
    });
    if (!existing) throw new KnowledgeObjectStoreError("OBJECT_CORRUPT");
    return {
      key,
      encryptionKeyRef: input.encryptionKeyId,
      payloadHash,
      payloadBytes: input.payload.byteLength,
      created: false,
    };
  }
}

export class PrismaKnowledgeV2LiveToolResultLedger implements KnowledgeV2LiveToolResultResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: KnowledgeObjectStore,
    private readonly encryptionKeyId: string,
    private readonly queryHashKeyring: KnowledgeV2QueryHashKeyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private rowMatchesReusableResult(
    row: {
      id: string;
      tenantId: string;
      executionKey: string;
      executionContextId: string;
      queryHash: string;
      queryHashKeyId: string | null;
      queryHashVersion: string | null;
      operationalCategory: string;
      authorizationScopeHash: string;
      permissionGeneration: number;
      connectionId: string | null;
      connectionPermissionVersion: number | null;
      customerIdentityId: string | null;
      customerIdentityVersion: number | null;
      subjectHash: string;
      requestHash: string;
      valueHash: string;
      exactValueHash: string;
      contentHash: string;
    },
    input: KnowledgeV2LiveToolLedgerCommitInput,
  ) {
    const result = input.result;
    return (
      row.id === result.executionId &&
      row.tenantId === result.tenantId &&
      row.executionKey === input.executionKey &&
      row.executionContextId === result.executionContextId &&
      row.queryHash === result.queryHash.hash &&
      row.queryHashKeyId === result.queryHash.keyId &&
      row.queryHashVersion === result.queryHash.version &&
      row.operationalCategory === result.operationalCategory &&
      row.authorizationScopeHash === result.authorizationScopeHash &&
      row.permissionGeneration === result.permissionGeneration &&
      row.connectionId === result.connectionId &&
      row.connectionPermissionVersion === result.connectionPermissionVersion &&
      row.customerIdentityId === result.customerIdentityId &&
      row.customerIdentityVersion === result.customerIdentityVersion &&
      row.subjectHash === result.subjectHash &&
      row.requestHash === result.requestHash &&
      row.valueHash === result.valueHash &&
      row.exactValueHash === result.exactValueHash &&
      row.contentHash === result.contentHash
    );
  }

  async commit(
    input: KnowledgeV2LiveToolLedgerCommitInput,
  ): Promise<KnowledgeV2LiveToolResultReference | null> {
    const now = this.now();
    const result = input.result;
    if (
      !isKnowledgeV2LiveToolResultValid({
        result,
        executionId: result.executionId,
        tenantId: result.tenantId,
        executionContextId: result.executionContextId,
        query: input.query,
        queryHashKeyring: this.queryHashKeyring,
        queryHash: result.queryHash,
        operationalCategory: result.operationalCategory,
        authorizationScopeHash: result.authorizationScopeHash,
        now,
      })
    ) {
      return null;
    }
    const envelopeHash = knowledgeLiveToolResultEnvelopeHash(result);
    const payload = new TextEncoder().encode(stableKnowledgeValue(result));
    if (payload.byteLength < 1 || payload.byteLength > MAXIMUM_PAYLOAD_BYTES) return null;
    const payloadState: {
      value: Awaited<ReturnType<typeof putImmutablePayload>> | null;
    } = { value: null };
    const retentionExpiresAt = new Date(
      Math.max(Date.parse(result.expiresAt), now.getTime()) + LIVE_RESULT_RETENTION_MS,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await this.prisma.$transaction(
          async (tx) => {
            if (!(await input.revalidate(tx))) return null;
            const committedPayload = (payloadState.value ??= await putImmutablePayload({
              store: this.store,
              encryptionKeyId: this.encryptionKeyId,
              tenantId: result.tenantId,
              executionId: result.executionId,
              envelopeHash,
              payload,
            }));
            return tx.knowledgeV2LiveToolExecution.create({
              data: {
                id: result.executionId,
                executionKey: input.executionKey,
                tenantId: result.tenantId,
                aiReplyRunId: input.aiReplyRunId,
                conversationId: input.conversationId,
                originatingMessageId: input.originatingMessageId,
                leadId: input.leadId,
                executionContextId: result.executionContextId,
                attemptNumber: input.attemptNumber,
                toolCallId: result.toolCallId,
                toolKey: result.toolKey,
                toolVersion: result.toolVersion,
                safeName: result.safeName,
                sourceSystem: result.sourceSystem,
                operationalCategory: result.operationalCategory,
                toolPolicyVersion: result.toolPolicyVersion,
                queryHash: result.queryHash.hash,
                queryHashKeyId: result.queryHash.keyId,
                queryHashVersion: result.queryHash.version,
                requestHash: result.requestHash,
                authorizationScopeHash: result.authorizationScopeHash,
                authorizationDecisionId: result.authorizationDecisionId,
                permissionGeneration: result.permissionGeneration,
                connectionId: result.connectionId,
                connectionPermissionVersion: result.connectionPermissionVersion,
                customerIdentityId: result.customerIdentityId,
                customerIdentityVersion: result.customerIdentityVersion,
                subjectHash: result.subjectHash,
                resultType: result.resultType,
                valueHash: result.valueHash,
                exactValueHash: result.exactValueHash,
                contentHash: result.contentHash,
                envelopeHash,
                payloadObjectKey: committedPayload.key,
                payloadEncryptionKeyRef: committedPayload.encryptionKeyRef,
                payloadHash: committedPayload.payloadHash,
                payloadBytes: committedPayload.payloadBytes,
                observedAt: new Date(result.observedAt),
                expiresAt: new Date(result.expiresAt),
                authorizedAt: new Date(result.authorizedAt),
                authorizationExpiresAt: new Date(result.authorizationExpiresAt),
                retentionExpiresAt,
              },
              select: { id: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return created ? { executionId: created.id } : null;
      } catch (error) {
        if (isSerializationFailure(error) && attempt < 2) continue;
        if (!isUniqueConflict(error)) throw error;
        const stored = payloadState.value;
        if (!stored) return null;
        const existing = await this.prisma.knowledgeV2LiveToolExecution.findUnique({
          where: { id: result.executionId },
        });
        const resolved =
          existing && this.rowMatchesReusableResult(existing, input)
            ? await this.resolve({
                executionId: result.executionId,
                tenantId: result.tenantId,
                executionContextId: result.executionContextId,
                query: input.query,
                queryHash: result.queryHash,
                operationalCategory: result.operationalCategory,
                authorizationScopeHash: result.authorizationScopeHash,
                now,
              })
            : null;
        if (stored.created && existing?.payloadObjectKey !== stored.key) {
          await this.store.delete(stored.key).catch(() => undefined);
        }
        return resolved ? { executionId: result.executionId } : null;
      }
    }
    return null;
  }

  async resolve(input: {
    executionId: string;
    tenantId: string;
    executionContextId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: KnowledgeOperationalLiveCategory;
    authorizationScopeHash: string;
    now: Date;
    transaction?: Prisma.TransactionClient;
  }) {
    try {
      const database = input.transaction ?? this.prisma;
      const now = this.now();
      const row = await database.knowledgeV2LiveToolExecution.findFirst({
        where: {
          id: input.executionId,
          tenantId: input.tenantId,
          executionContextId: input.executionContextId,
          queryHash: input.queryHash.hash,
          queryHashKeyId: input.queryHash.keyId,
          queryHashVersion: input.queryHash.version,
          operationalCategory: input.operationalCategory,
          authorizationScopeHash: input.authorizationScopeHash,
          expiresAt: { gt: now },
          authorizationExpiresAt: { gt: now },
          retentionExpiresAt: { gt: now },
        },
      });
      if (
        !row?.aiReplyRunId ||
        !row.conversationId ||
        !row.customerIdentityId ||
        row.customerIdentityVersion !== 1
      ) {
        return null;
      }
      const rowQueryHash = parseKnowledgeV2QueryHashBinding({
        hash: row.queryHash,
        keyId: row.queryHashKeyId,
        version: row.queryHashVersion,
      });
      if (
        !rowQueryHash ||
        !equalKnowledgeV2QueryHashBindings(rowQueryHash, input.queryHash) ||
        !this.queryHashKeyring.verify({
          tenantId: input.tenantId,
          purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
          value: input.query.replace(/\s+/gu, " ").trim(),
          binding: rowQueryHash,
        })
      ) {
        return null;
      }
      if (input.transaction) {
        const tx = input.transaction;
        const identityLocks = await tx.$queryRaw<
          Array<{ id: string; webhookEventId: string }>
        >(Prisma.sql`
          SELECT "id", "webhookEventId"
          FROM "AuthenticatedCustomerIdentity"
          WHERE "tenantId" = ${input.tenantId}
            AND "id" = ${row.customerIdentityId}
            AND "version" = ${row.customerIdentityVersion}
          FOR SHARE
        `);
        const lockedIdentity = identityLocks[0];
        if (!lockedIdentity) return null;
        const webhookEventLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "WebhookEvent"
          WHERE "id" = ${lockedIdentity.webhookEventId}
            AND "tenantId" = ${input.tenantId}
          FOR SHARE
        `);
        const conversations = await tx.$queryRaw<
          Array<{ channelId: string | null; leadId: string | null }>
        >(Prisma.sql`
          SELECT "channelId", "leadId"
          FROM "Conversation"
          WHERE "tenantId" = ${input.tenantId}
            AND "id" = ${row.conversationId}
          FOR SHARE
        `);
        const lockedConversation = conversations[0];
        if (
          !lockedConversation?.channelId ||
          !lockedConversation.leadId ||
          lockedConversation.leadId !== row.leadId
        ) {
          return null;
        }
        const runLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "AiReplyRun"
          WHERE "tenantId" = ${input.tenantId}
            AND "id" = ${row.aiReplyRunId}
            AND "conversationId" = ${row.conversationId}
            AND "inboundMessageId" = ${row.originatingMessageId}
          FOR SHARE
        `);
        const leadLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "Lead"
          WHERE "tenantId" = ${input.tenantId}
            AND "id" = ${lockedConversation.leadId}
          FOR SHARE
        `);
        const channelLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "Channel"
          WHERE "tenantId" = ${input.tenantId}
            AND "id" = ${lockedConversation.channelId}
          FOR SHARE
        `);
        const connectionLocks = row.connectionId
          ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id"
              FROM "IntegrationAccount"
              WHERE "tenantId" = ${input.tenantId}
                AND "id" = ${row.connectionId}
              FOR SHARE
            `)
          : [{ id: "internal" }];
        const tenantLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "Tenant"
          WHERE "id" = ${input.tenantId}
          FOR SHARE
        `);
        const authorizationLocks = await tx.$queryRaw<Array<{ tenantId: string }>>(Prisma.sql`
          SELECT "tenantId"
          FROM "TenantOperationalAuthorizationState"
          WHERE "tenantId" = ${input.tenantId}
          FOR SHARE
        `);
        if (
          runLocks.length !== 1 ||
          identityLocks.length !== 1 ||
          webhookEventLocks.length !== 1 ||
          leadLocks.length !== 1 ||
          channelLocks.length !== 1 ||
          connectionLocks.length !== 1 ||
          tenantLocks.length !== 1 ||
          authorizationLocks.length !== 1
        ) {
          return null;
        }
      }
      const [authorizationState, run, connection] = await Promise.all([
        database.tenantOperationalAuthorizationState.findUnique({
          where: { tenantId: input.tenantId },
        }),
        database.aiReplyRun.findFirst({
          where: {
            id: row.aiReplyRunId,
            tenantId: input.tenantId,
            conversationId: row.conversationId,
            inboundMessageId: row.originatingMessageId,
          },
          select: {
            id: true,
            status: true,
            attemptCount: true,
            generation: true,
            sequence: true,
            inboundMessageId: true,
            tenant: { select: { status: true, deletedAt: true } },
            inboundMessage: {
              select: {
                id: true,
                externalMessageId: true,
                authenticatedCustomerIdentity: {
                  select: {
                    id: true,
                    tenantId: true,
                    version: true,
                    channelId: true,
                    conversationId: true,
                    messageId: true,
                    webhookEventId: true,
                    provider: true,
                    authenticationMethod: true,
                    subjectSource: true,
                    conversationType: true,
                    subjectHash: true,
                    channelBindingHash: true,
                    eventPayloadHash: true,
                    attestationHash: true,
                    authenticatedAt: true,
                    webhookEvent: {
                      select: {
                        id: true,
                        tenantId: true,
                        provider: true,
                        externalEventId: true,
                        payloadHash: true,
                        payload: true,
                        status: true,
                        errorMessage: true,
                        receivedAt: true,
                        processedAt: true,
                      },
                    },
                  },
                },
              },
            },
            conversation: {
              select: {
                id: true,
                leadId: true,
                channelId: true,
                status: true,
                externalConversationId: true,
                aiEnabled: true,
                aiGeneration: true,
                aiReplyFence: true,
                handoffRequested: true,
                deletedAt: true,
                channel: {
                  select: {
                    id: true,
                    tenantId: true,
                    type: true,
                    status: true,
                    externalId: true,
                    publicKey: true,
                    deletedAt: true,
                  },
                },
                lead: { select: { id: true, tenantId: true, deletedAt: true } },
              },
            },
          },
        }),
        row.connectionId
          ? database.integrationAccount.findFirst({
              where: {
                id: row.connectionId,
                tenantId: input.tenantId,
                status: "CONNECTED",
                deletedAt: null,
              },
              select: { id: true, permissionVersion: true },
            })
          : Promise.resolve(null),
      ]);
      const conversation = run?.conversation;
      const tenant = run?.tenant;
      const channel = conversation?.channel;
      const lead = conversation?.lead;
      const customerIdentity =
        run && conversation && channel
          ? revalidatedCustomerIdentity({
              tenantId: input.tenantId,
              conversationId: conversation.id,
              messageId: run.inboundMessageId,
              externalConversationId: conversation.externalConversationId,
              externalMessageId: run.inboundMessage.externalMessageId,
              channel,
              identity: run.inboundMessage.authenticatedCustomerIdentity,
            })
          : null;
      if (
        !authorizationState ||
        authorizationState.permissionGeneration !== row.permissionGeneration ||
        !run ||
        !tenant ||
        !["TRIALING", "ACTIVE"].includes(tenant.status) ||
        tenant.deletedAt ||
        (run.status !== "RUNNING" && run.status !== "SUCCEEDED") ||
        run.attemptCount !== row.attemptNumber ||
        run.inboundMessage.id !== run.inboundMessageId ||
        !conversation ||
        conversation.deletedAt ||
        !["OPEN", "WAITING_FOR_CUSTOMER"].includes(conversation.status) ||
        !conversation.aiEnabled ||
        conversation.handoffRequested ||
        !lead ||
        lead.tenantId !== input.tenantId ||
        lead.deletedAt ||
        lead.id !== row.leadId ||
        !channel ||
        channel.tenantId !== input.tenantId ||
        channel.deletedAt ||
        channel.status !== "ACTIVE" ||
        conversation.channelId !== channel.id ||
        conversation.leadId !== row.leadId ||
        conversation.aiGeneration !== run.generation ||
        conversation.aiReplyFence !== run.sequence ||
        !customerIdentity ||
        customerIdentity.id !== row.customerIdentityId ||
        customerIdentity.version !== row.customerIdentityVersion ||
        `${RUN_CONTEXT_PREFIX}${run.id}` !== row.executionContextId ||
        knowledgeLiveToolSubjectHash({
          tenantId: row.tenantId,
          conversationId: conversation.id,
          leadId: row.leadId,
          channelId: conversation.channelId,
          externalConversationId: conversation.externalConversationId,
          customerIdentity,
        }) !== row.subjectHash ||
        (row.connectionId !== null &&
          (!connection || connection.permissionVersion !== row.connectionPermissionVersion)) ||
        (row.connectionId === null && row.connectionPermissionVersion !== null)
      ) {
        return null;
      }
      const bytes = await objectBytes({
        store: this.store,
        key: row.payloadObjectKey,
        encryptionKeyRef: row.payloadEncryptionKeyRef,
        expectedBytes: row.payloadBytes,
        expectedHash: row.payloadHash,
      });
      const result = bytes ? decodedResult(bytes) : null;
      if (
        !result ||
        result.requestHash !== row.requestHash ||
        result.authorizationDecisionId !== row.authorizationDecisionId ||
        result.permissionGeneration !== row.permissionGeneration ||
        result.connectionId !== row.connectionId ||
        result.connectionPermissionVersion !== row.connectionPermissionVersion ||
        result.customerIdentityId !== row.customerIdentityId ||
        result.customerIdentityVersion !== row.customerIdentityVersion ||
        result.subjectHash !== row.subjectHash ||
        result.valueHash !== row.valueHash ||
        result.exactValueHash !== row.exactValueHash ||
        result.contentHash !== row.contentHash ||
        !equalKnowledgeV2QueryHashBindings(result.queryHash, rowQueryHash) ||
        knowledgeLiveToolResultEnvelopeHash(result) !== row.envelopeHash ||
        !isKnowledgeV2LiveToolResultValid({
          result,
          executionId: input.executionId,
          tenantId: input.tenantId,
          executionContextId: input.executionContextId,
          query: input.query,
          queryHashKeyring: this.queryHashKeyring,
          queryHash: input.queryHash,
          operationalCategory: input.operationalCategory,
          authorizationScopeHash: input.authorizationScopeHash,
          now,
        })
      ) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }
}

async function runtimeSubject(
  db: DbClient,
  input: {
    tenantId: string;
    executionContextId: string;
    authorization: KnowledgeRuntimeAuthorizationContext;
  },
): Promise<RuntimeSubject | null> {
  const runId = parseRunId(input.executionContextId);
  if (!runId || input.authorization.audience !== "AUTHENTICATED_CUSTOMER") return null;
  const run = await db.aiReplyRun.findFirst({
    where: { id: runId, tenantId: input.tenantId, status: "RUNNING" },
    select: {
      id: true,
      inboundMessageId: true,
      attemptCount: true,
      generation: true,
      sequence: true,
      deadlineAt: true,
      tenant: { select: { status: true, deletedAt: true } },
      inboundMessage: {
        select: {
          id: true,
          externalMessageId: true,
          authenticatedCustomerIdentity: {
            select: {
              id: true,
              tenantId: true,
              version: true,
              channelId: true,
              conversationId: true,
              messageId: true,
              webhookEventId: true,
              provider: true,
              authenticationMethod: true,
              subjectSource: true,
              conversationType: true,
              subjectHash: true,
              channelBindingHash: true,
              eventPayloadHash: true,
              attestationHash: true,
              authenticatedAt: true,
              webhookEvent: {
                select: {
                  id: true,
                  tenantId: true,
                  provider: true,
                  externalEventId: true,
                  payloadHash: true,
                  payload: true,
                  status: true,
                  errorMessage: true,
                  receivedAt: true,
                  processedAt: true,
                },
              },
            },
          },
        },
      },
      conversation: {
        select: {
          id: true,
          leadId: true,
          status: true,
          externalConversationId: true,
          aiEnabled: true,
          aiGeneration: true,
          aiReplyFence: true,
          handoffRequested: true,
          deletedAt: true,
          channelId: true,
          channel: {
            select: {
              id: true,
              tenantId: true,
              type: true,
              status: true,
              externalId: true,
              publicKey: true,
              deletedAt: true,
            },
          },
          lead: { select: { id: true, tenantId: true, deletedAt: true } },
        },
      },
    },
  });
  const conversation = run?.conversation;
  const tenant = run?.tenant;
  const channel = conversation?.channel;
  const lead = conversation?.lead;
  const customerIdentity =
    run && conversation && channel
      ? revalidatedCustomerIdentity({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          messageId: run.inboundMessageId,
          externalConversationId: conversation.externalConversationId,
          externalMessageId: run.inboundMessage.externalMessageId,
          channel,
          identity: run.inboundMessage.authenticatedCustomerIdentity,
        })
      : null;
  const state = await db.tenantOperationalAuthorizationState.findUnique({
    where: { tenantId: input.tenantId },
  });
  if (
    !run ||
    run.inboundMessage.id !== run.inboundMessageId ||
    !tenant ||
    !["TRIALING", "ACTIVE"].includes(tenant.status) ||
    tenant.deletedAt ||
    !conversation ||
    conversation.deletedAt ||
    !["OPEN", "WAITING_FOR_CUSTOMER"].includes(conversation.status) ||
    !conversation.aiEnabled ||
    conversation.handoffRequested ||
    !lead ||
    lead.tenantId !== input.tenantId ||
    lead.deletedAt ||
    !channel ||
    channel.tenantId !== input.tenantId ||
    channel.deletedAt ||
    channel.status !== "ACTIVE" ||
    conversation.channelId !== channel.id ||
    conversation.aiGeneration !== run.generation ||
    conversation.aiReplyFence !== run.sequence ||
    input.authorization.channelType !== channel.type ||
    !(input.authorization.channelIds ?? []).includes(channel.id) ||
    !customerIdentity ||
    !sameCustomerIdentity(customerIdentity, input.authorization.customerIdentity) ||
    !state
  ) {
    return null;
  }
  return {
    runId: run.id,
    attemptNumber: run.attemptCount,
    conversationId: conversation.id,
    originatingMessageId: run.inboundMessageId,
    leadId: lead.id,
    externalConversationId: conversation.externalConversationId,
    channelId: channel.id,
    channelType: channel.type,
    customerIdentity,
    permissionGeneration: state.permissionGeneration,
    runDeadlineAt: run.deadlineAt,
  };
}

async function internalRead(
  prisma: PrismaClient,
  tenantId: string,
  leadId: string,
  category: KnowledgeOperationalLiveCategory,
): Promise<InternalReadResult | null> {
  const definition = knowledgeV2LiveToolDefinitionV1(category);
  if (!definition) return null;
  if (category === "BOOKING_STATE") {
    const rows = await prisma.booking.findMany({
      where: { tenantId, leadId, deletedAt: null, status: { not: "DRAFT" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true, status: true, updatedAt: true },
    });
    const row = rows.length === 1 ? rows[0] : null;
    if (!row) return null;
    return {
      toolKey: definition.toolKey,
      toolVersion: definition.toolVersion,
      safeName: definition.safeName,
      resultType: definition.resultType,
      value: { status: row.status },
      exactValue: row.status,
      content: `Current booking status: ${row.status}.`,
      resourceType: definition.resourceType,
      resourceId: row.id,
      resourceVersion: row.updatedAt,
    };
  }
  if (category === "ORDER_STATE") {
    const rows = await prisma.order.findMany({
      where: { tenantId, leadId, deletedAt: null, status: { not: "DRAFT" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true, status: true, updatedAt: true },
    });
    const row = rows.length === 1 ? rows[0] : null;
    if (!row) return null;
    return {
      toolKey: definition.toolKey,
      toolVersion: definition.toolVersion,
      safeName: definition.safeName,
      resultType: definition.resultType,
      value: { status: row.status },
      exactValue: row.status,
      content: `Current order status: ${row.status}.`,
      resourceType: definition.resourceType,
      resourceId: row.id,
      resourceVersion: row.updatedAt,
    };
  }
  return null;
}

async function resourceUnchanged(
  tx: Prisma.TransactionClient,
  tenantId: string,
  leadId: string,
  result: InternalReadResult,
) {
  const matches = (row: { id: string; status: string; updatedAt: Date } | undefined) =>
    row?.id === result.resourceId &&
    row.status === result.exactValue &&
    row.updatedAt.getTime() === result.resourceVersion.getTime();
  if (result.resourceType === "BOOKING") {
    const rows = await tx.booking.findMany({
      where: { tenantId, leadId, deletedAt: null, status: { not: "DRAFT" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true, status: true, updatedAt: true },
    });
    return rows.length === 1 && matches(rows[0]);
  }
  const rows = await tx.order.findMany({
    where: { tenantId, leadId, deletedAt: null, status: { not: "DRAFT" } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { id: true, status: true, updatedAt: true },
  });
  return rows.length === 1 && matches(rows[0]);
}

export class PrismaKnowledgeV2ReadToolGateway implements KnowledgeV2LiveToolResultExecutor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: PrismaKnowledgeV2LiveToolResultLedger,
    private readonly queryHashKeyring: KnowledgeV2QueryHashKeyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    tenantId: string;
    executionContextId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: KnowledgeOperationalLiveCategory;
    authorizationScopeHash: string;
    authorization: KnowledgeRuntimeAuthorizationContext;
    now: Date;
    signal?: AbortSignal;
  }) {
    if (input.signal?.aborted) throw input.signal.reason;
    if (
      !this.queryHashKeyring.verify({
        tenantId: input.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
        value: input.query.replace(/\s+/gu, " ").trim(),
        binding: input.queryHash,
      }) ||
      input.authorizationScopeHash !==
        knowledgeLiveToolAuthorizationScopeHash({
          tenantId: input.tenantId,
          authorization: input.authorization,
        }) ||
      input.authorization.executionContextId?.trim() !== input.executionContextId ||
      input.authorization.queryClassification !== "CUSTOMER_PERSONAL" ||
      !input.authorization.classifications.includes("CUSTOMER_PERSONAL")
    ) {
      return [];
    }
    const subject = await runtimeSubject(this.prisma, input);
    if (!subject) return [];
    const read = await internalRead(
      this.prisma,
      input.tenantId,
      subject.leadId,
      input.operationalCategory,
    );
    if (!read) return [];
    if (input.signal?.aborted) throw input.signal.reason;
    const observedAt = this.now();
    const maximumExpiry = observedAt.getTime() + INTERNAL_RESULT_TTL_MS;
    const authorizationExpiry = Math.min(
      observedAt.getTime() + KNOWLEDGE_LIVE_TOOL_MAX_TTL_MS,
      subject.runDeadlineAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    if (authorizationExpiry <= maximumExpiry) return [];
    const subjectHash = knowledgeLiveToolSubjectHash({
      tenantId: input.tenantId,
      conversationId: subject.conversationId,
      leadId: subject.leadId,
      channelId: subject.channelId,
      externalConversationId: subject.externalConversationId,
      customerIdentity: subject.customerIdentity,
    });
    const requestHash = canonicalHash({
      schemaVersion: 2,
      toolKey: read.toolKey,
      toolVersion: read.toolVersion,
      tenantId: input.tenantId,
      executionContextId: input.executionContextId,
      queryHash: input.queryHash,
      operationalCategory: input.operationalCategory,
      authorizationScopeHash: input.authorizationScopeHash,
      subjectHash,
    });
    const executionKey = canonicalHash({
      schemaVersion: 1,
      requestHash,
      runId: subject.runId,
      attemptNumber: subject.attemptNumber,
      permissionGeneration: subject.permissionGeneration,
      resourceType: read.resourceType,
      resourceId: read.resourceId,
      resourceVersion: read.resourceVersion.toISOString(),
      freshnessGeneration: Math.floor(observedAt.getTime() / INTERNAL_RESULT_TTL_MS),
    });
    const executionId = `live:${executionKey}`;
    const authorizationDecisionId = `auth:${canonicalHash({
      executionKey,
      permissionGeneration: subject.permissionGeneration,
      policyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    })}`;
    const exactValueHash = sha256(read.exactValue);
    const contentHash = sha256(read.content);
    const existing = await this.ledger.resolve({
      executionId,
      tenantId: input.tenantId,
      executionContextId: input.executionContextId,
      query: input.query,
      queryHash: input.queryHash,
      operationalCategory: input.operationalCategory,
      authorizationScopeHash: input.authorizationScopeHash,
      now: observedAt,
    });
    if (
      existing?.requestHash === requestHash &&
      existing.valueHash === canonicalHash(read.value) &&
      existing.exactValueHash === exactValueHash &&
      existing.contentHash === contentHash
    ) {
      return [{ executionId }];
    }
    const result: KnowledgeV2LiveToolResult = {
      executionId,
      toolCallId: `${input.executionContextId}:${read.toolKey}`,
      toolKey: read.toolKey,
      toolVersion: read.toolVersion,
      safeName: read.safeName,
      sourceSystem: "leadvirt.postgres",
      operationalCategory: input.operationalCategory,
      tenantId: input.tenantId,
      executionContextId: input.executionContextId,
      queryHash: input.queryHash,
      requestHash,
      authorizationScopeHash: input.authorizationScopeHash,
      authorizationDecisionId,
      permissionGeneration: subject.permissionGeneration,
      connectionId: null,
      connectionPermissionVersion: null,
      customerIdentityId: subject.customerIdentity.id,
      customerIdentityVersion: subject.customerIdentity.version,
      subjectHash,
      resultType: read.resultType,
      value: read.value,
      valueHash: canonicalHash(read.value),
      exactValue: read.exactValue,
      exactValueHash,
      content: read.content,
      contentHash,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(maximumExpiry).toISOString(),
      authorizedAt: observedAt.toISOString(),
      authorizationExpiresAt: new Date(authorizationExpiry).toISOString(),
      toolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
      status: "SUCCEEDED",
    };
    const committed = await this.ledger.commit({
      result,
      query: input.query,
      executionKey,
      aiReplyRunId: subject.runId,
      conversationId: subject.conversationId,
      originatingMessageId: subject.originatingMessageId,
      leadId: subject.leadId,
      attemptNumber: subject.attemptNumber,
      revalidate: async (tx) => {
        const current = await runtimeSubject(tx, input);
        return Boolean(
          current &&
          current.runId === subject.runId &&
          current.attemptNumber === subject.attemptNumber &&
          current.permissionGeneration === subject.permissionGeneration &&
          current.leadId === subject.leadId &&
          sameCustomerIdentity(current.customerIdentity, subject.customerIdentity) &&
          (await resourceUnchanged(tx, input.tenantId, subject.leadId, read)),
        );
      },
    });
    return committed ? [committed] : [];
  }
}

export function createPrismaKnowledgeV2LiveTools(input: {
  prisma: PrismaClient;
  objectStore: KnowledgeObjectStore;
  encryptionKeyId: string;
  queryHashKeyring: KnowledgeV2QueryHashKeyring;
  now?: () => Date;
}) {
  const ledger = new PrismaKnowledgeV2LiveToolResultLedger(
    input.prisma,
    input.objectStore,
    input.encryptionKeyId,
    input.queryHashKeyring,
    input.now,
  );
  return {
    ledger,
    gateway: new PrismaKnowledgeV2ReadToolGateway(
      input.prisma,
      ledger,
      input.queryHashKeyring,
      input.now,
    ),
  };
}
