import { createHash } from "node:crypto";
import { prisma, Prisma, type AiReplyRun, type LeadStatus } from "@leadvirt/db";
import { aiReplyRunIdentity, automaticReplyAdmissionState } from "@leadvirt/runtime-queue";
import { classifyKnowledgeCapabilityIntentV1 } from "@leadvirt/knowledge";
import type { AiReplyJobData } from "@leadvirt/types";

const activeRunStatuses = [
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "FAILED",
  "CANCEL_REQUESTED",
] as const;

const terminalWithoutReplyStatuses = new Set([
  "SKIPPED",
  "CANCELLED",
  "TIMED_OUT",
  "SUPERSEDED",
  "DEAD_LETTER",
]);

interface LockedConversation {
  id: string;
  tenantId: string;
  leadId: string | null;
  aiGeneration: number;
  aiReplySequence: number;
  aiReplyFence: number;
}

interface LockedInboundMessage {
  id: string;
  text: string | null;
  createdAt: Date;
}

export interface AiReplyAttempt {
  runId: string;
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  publicationId: string | null;
  capabilitySetHash: string | null;
  operationalBindingHash: string | null;
  operationalPermissionGeneration: number | null;
  capabilityType: AiReplyRun["capabilityType"];
  allowedAutonomy: AiReplyRun["allowedAutonomy"];
  requiredAutonomy: AiReplyRun["requiredAutonomy"];
  capabilityDecision: AiReplyRun["capabilityDecision"];
  idempotencyKey: string;
  inputHash: string;
  inputData: AiReplyJobData;
  generation: number;
  sequence: number;
  attemptCount: number;
  maxAttempts: number;
}

export interface AiReplyRuntimeInput {
  inputText: string;
  receivedAt: Date;
  businessName: string;
  businessType: string | null;
  leadId: string | null;
  leadStatus: LeadStatus | null;
}

export type BeginAiReplyAttemptResult =
  | { disposition: "active"; attempt: AiReplyAttempt; input: AiReplyRuntimeInput }
  | { disposition: "duplicate"; attempt: AiReplyAttempt; messageId: string }
  | { disposition: "superseded"; attempt: AiReplyAttempt; messageId: string };

export class AiReplyFenceError extends Error {
  constructor(
    public readonly code:
      | "AI_REPLY_INPUT_MISMATCH"
      | "AI_REPLY_INBOUND_NOT_FOUND"
      | "AI_REPLY_NEWER_INBOUND"
      | "AI_EXTERNAL_OPERATION_AMBIGUOUS"
      | "AI_REPLY_RUN_CORRUPT"
      | "AI_REPLY_RUN_SUPERSEDED"
      | "AI_REPLY_AUTOMATIC_REPLY_REVOKED"
      | "AI_REPLY_STRUCTURED_TARGET_REVOKED"
      | "AI_REPLY_HANDOFF_TEMPLATE_INVALID",
  ) {
    super(code);
    this.name = "AiReplyFenceError";
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function attemptFromRun(run: AiReplyRun, data: AiReplyJobData): AiReplyAttempt {
  return {
    runId: run.id,
    tenantId: run.tenantId,
    conversationId: run.conversationId,
    inboundMessageId: run.inboundMessageId,
    publicationId: run.publicationId,
    capabilitySetHash: run.capabilitySetHash,
    operationalBindingHash: run.operationalBindingHash,
    operationalPermissionGeneration: run.operationalPermissionGeneration,
    capabilityType: run.capabilityType,
    allowedAutonomy: run.allowedAutonomy,
    requiredAutonomy: run.requiredAutonomy,
    capabilityDecision: run.capabilityDecision,
    idempotencyKey: run.idempotencyKey,
    inputHash: run.inputHash,
    inputData: data,
    generation: run.generation,
    sequence: run.sequence,
    attemptCount: run.attemptCount,
    maxAttempts: run.maxAttempts,
  };
}

async function resolveCapabilityBinding(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    publicationId: string;
    text: string;
    operationalBindingHash: string;
    operationalPermissionGeneration: number;
  },
) {
  const classification = classifyKnowledgeCapabilityIntentV1(input.text);
  if (classification.route === "HUMAN_HANDOFF" || !classification.capabilityType) {
    return {
      capabilityDecision: "HANDOFF" as const,
      capabilityType: null,
      allowedAutonomy: null,
      requiredAutonomy: "ANSWER_ONLY" as const,
    };
  }
  const snapshot = await tx.knowledgePublicationCapability.findFirst({
    where: {
      tenantId: input.tenantId,
      publicationId: input.publicationId,
      capabilityType: classification.capabilityType,
    },
    select: {
      capabilityType: true,
      allowedAutonomy: true,
      operationalBindingHash: true,
      operationalPermissionGeneration: true,
    },
  });
  if (!snapshot) {
    return {
      capabilityDecision: "HANDOFF" as const,
      capabilityType: null,
      allowedAutonomy: null,
      requiredAutonomy: "ANSWER_ONLY" as const,
    };
  }
  if (
    snapshot.operationalBindingHash !== input.operationalBindingHash ||
    snapshot.operationalPermissionGeneration !== input.operationalPermissionGeneration
  ) {
    throw new AiReplyFenceError("AI_REPLY_AUTOMATIC_REPLY_REVOKED");
  }
  return {
    capabilityDecision: "AUTHORIZED" as const,
    capabilityType: snapshot.capabilityType,
    allowedAutonomy: snapshot.allowedAutonomy,
    requiredAutonomy: "ANSWER_ONLY" as const,
  };
}

function capabilityBindingMatches(
  run: AiReplyRun,
  binding: Awaited<ReturnType<typeof resolveCapabilityBinding>>,
) {
  return (
    run.capabilityDecision === binding.capabilityDecision &&
    run.capabilityType === binding.capabilityType &&
    run.allowedAutonomy === binding.allowedAutonomy &&
    run.requiredAutonomy === binding.requiredAutonomy
  );
}

function retryableTransactionError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (retry >= 4 || !retryableTransactionError(error)) throw error;
    }
  }
}

async function lockConversation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
): Promise<LockedConversation | null> {
  const rows = await tx.$queryRaw<LockedConversation[]>(Prisma.sql`
    SELECT
      "id",
      "tenantId",
      "leadId",
      "aiGeneration",
      "aiReplySequence",
      "aiReplyFence"
    FROM "Conversation"
    WHERE "id" = ${conversationId}
      AND "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockInboundMessage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
  messageId: string,
): Promise<LockedInboundMessage | null> {
  const rows = await tx.$queryRaw<LockedInboundMessage[]>(Prisma.sql`
    SELECT
      "id",
      "text",
      "createdAt"
    FROM "Message"
    WHERE "id" = ${messageId}
      AND "tenantId" = ${tenantId}
      AND "conversationId" = ${conversationId}
      AND "direction" = 'INBOUND'
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function loadRuntimeInput(
  tx: Prisma.TransactionClient,
  conversation: LockedConversation,
  inbound: LockedInboundMessage,
): Promise<AiReplyRuntimeInput> {
  const [tenant, lead] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: conversation.tenantId },
      select: { name: true, businessType: true },
    }),
    conversation.leadId
      ? tx.lead.findFirst({
          where: { id: conversation.leadId, tenantId: conversation.tenantId },
          select: { status: true },
        })
      : null,
  ]);
  return {
    inputText: inbound.text ?? "",
    receivedAt: inbound.createdAt,
    businessName: tenant.name,
    businessType: tenant.businessType,
    leadId: conversation.leadId,
    leadStatus: lead?.status ?? null,
  };
}

async function hasLaterInboundMessage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
  inbound: { id: string; createdAt: Date },
) {
  const later = await tx.message.findFirst({
    where: {
      tenantId,
      conversationId,
      direction: "INBOUND",
      OR: [
        { createdAt: { gt: inbound.createdAt } },
        { createdAt: inbound.createdAt, id: { gt: inbound.id } },
      ],
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return Boolean(later);
}

async function lockReplyRun(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AiReplyRun"
    WHERE "id" = ${runId}
      AND "tenantId" = ${tenantId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

export function externalOperationIdentity(
  attempt: AiReplyAttempt,
  callId: string,
  request: unknown,
) {
  const requestHash = `sha256:${sha256(JSON.stringify(request))}`;
  return {
    id: `aiop_${sha256(JSON.stringify(["ai-internal-operation-v1", attempt.tenantId, attempt.runId, callId]))}`,
    requestHash,
  };
}

export async function beginAiReplyAttempt(
  data: AiReplyJobData,
): Promise<BeginAiReplyAttemptResult> {
  return serializable(async (tx) => {
    const conversation = await lockConversation(tx, data.tenantId, data.conversationId);
    if (!conversation) throw new AiReplyFenceError("AI_REPLY_INBOUND_NOT_FOUND");
    const admission = await automaticReplyAdmissionState(tx, {
      tenantId: data.tenantId,
      conversationId: data.conversationId,
    });

    const inbound = await lockInboundMessage(
      tx,
      data.tenantId,
      data.conversationId,
      data.triggerMessageId,
    );
    if (!inbound) throw new AiReplyFenceError("AI_REPLY_INBOUND_NOT_FOUND");

    const identity = aiReplyRunIdentity(data, inbound, conversation.leadId);
    let existing = await tx.aiReplyRun.findUnique({
      where: {
        tenantId_inboundMessageId: {
          tenantId: data.tenantId,
          inboundMessageId: inbound.id,
        },
      },
    });
    if (
      !admission.admitted ||
      (existing !== null &&
        (existing.publicationId !== admission.publicationId ||
          existing.capabilitySetHash !== admission.capabilitySetHash ||
          existing.operationalBindingHash !== admission.operationalBindingHash ||
          existing.operationalPermissionGeneration !== admission.operationalPermissionGeneration))
    ) {
      if (existing) {
        if (activeRunStatuses.includes(existing.status as (typeof activeRunStatuses)[number])) {
          await tx.aiReplyRun.update({
            where: { id: existing.id },
            data: {
              status: "SUPERSEDED",
              completedAt: new Date(),
              errorCode: "AUTOMATIC_REPLY_ADMISSION_REVOKED",
              errorMessage: null,
            },
          });
        }
        return {
          disposition: "superseded",
          attempt: attemptFromRun(existing, data),
          messageId: inbound.id,
        };
      }
      throw new AiReplyFenceError("AI_REPLY_AUTOMATIC_REPLY_REVOKED");
    }

    const capabilityBinding = await resolveCapabilityBinding(tx, {
      tenantId: data.tenantId,
      publicationId: admission.publicationId,
      text: inbound.text ?? "",
      operationalBindingHash: admission.operationalBindingHash,
      operationalPermissionGeneration: admission.operationalPermissionGeneration,
    });
    if (existing?.capabilityDecision === null) {
      existing = await tx.aiReplyRun.update({
        where: { id: existing.id },
        data: capabilityBinding,
      });
    }
    if (existing && !capabilityBindingMatches(existing, capabilityBinding)) {
      if (activeRunStatuses.includes(existing.status as (typeof activeRunStatuses)[number])) {
        await tx.aiReplyRun.update({
          where: { id: existing.id },
          data: {
            status: "SUPERSEDED",
            completedAt: new Date(),
            errorCode: "CAPABILITY_AUTONOMY_BINDING_REVOKED",
            errorMessage: null,
          },
        });
      }
      return {
        disposition: "superseded",
        attempt: attemptFromRun(existing, data),
        messageId: inbound.id,
      };
    }

    if (existing) {
      if (
        existing.idempotencyKey !== identity.idempotencyKey ||
        existing.inputHash !== identity.inputHash
      ) {
        throw new AiReplyFenceError("AI_REPLY_INPUT_MISMATCH");
      }
      const attempt = attemptFromRun(existing, data);
      if (existing.status === "SUCCEEDED") {
        if (!existing.replyMessageId) throw new AiReplyFenceError("AI_REPLY_RUN_CORRUPT");
        return { disposition: "duplicate", attempt, messageId: existing.replyMessageId };
      }
      const newerInboundExists = await hasLaterInboundMessage(
        tx,
        data.tenantId,
        data.conversationId,
        inbound,
      );
      const cancelRequested =
        existing.status === "CANCEL_REQUESTED" || existing.cancelRequestedAt !== null;
      if (
        terminalWithoutReplyStatuses.has(existing.status) ||
        cancelRequested ||
        newerInboundExists ||
        existing.generation !== conversation.aiGeneration ||
        existing.sequence !== conversation.aiReplyFence ||
        existing.attemptCount >= existing.maxAttempts
      ) {
        if (activeRunStatuses.includes(existing.status as (typeof activeRunStatuses)[number])) {
          const terminalStatus = cancelRequested
            ? "CANCELLED"
            : existing.attemptCount >= existing.maxAttempts
              ? "DEAD_LETTER"
              : "SUPERSEDED";
          const errorCode = cancelRequested
            ? "CANCEL_REQUESTED"
            : newerInboundExists
              ? "SUPERSEDED_BY_NEWER_INPUT"
              : existing.attemptCount >= existing.maxAttempts
                ? "MAX_ATTEMPTS_EXCEEDED"
                : "SUPERSEDED_BY_FENCE";
          await tx.aiReplyRun.update({
            where: { id: existing.id },
            data: {
              status: terminalStatus,
              completedAt: new Date(),
              errorCode,
            },
          });
        }
        return { disposition: "superseded", attempt, messageId: inbound.id };
      }

      const now = new Date();
      const retry = await tx.aiReplyRun.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          attemptCount: { increment: 1 },
          availableAt: now,
          startedAt: existing.startedAt ?? now,
          heartbeatAt: now,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      return {
        disposition: "active",
        attempt: attemptFromRun(retry, data),
        input: await loadRuntimeInput(tx, conversation, inbound),
      };
    }

    if (await hasLaterInboundMessage(tx, data.tenantId, data.conversationId, inbound)) {
      throw new AiReplyFenceError("AI_REPLY_NEWER_INBOUND");
    }

    const now = new Date();
    const sequence = conversation.aiReplySequence + 1;

    await tx.conversation.update({
      where: { id: conversation.id },
      data: { aiReplySequence: sequence, aiReplyFence: sequence },
    });
    await tx.aiReplyRun.updateMany({
      where: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        status: { in: [...activeRunStatuses] },
        OR: [
          { generation: { lt: conversation.aiGeneration } },
          { generation: conversation.aiGeneration, sequence: { lt: sequence } },
        ],
      },
      data: {
        status: "SUPERSEDED",
        completedAt: now,
        errorCode: "SUPERSEDED_BY_NEWER_INPUT",
        errorMessage: null,
      },
    });

    const run = await tx.aiReplyRun.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        inboundMessageId: inbound.id,
        publicationId: admission.publicationId,
        capabilitySetHash: admission.capabilitySetHash,
        operationalBindingHash: admission.operationalBindingHash,
        operationalPermissionGeneration: admission.operationalPermissionGeneration,
        ...capabilityBinding,
        idempotencyKey: identity.idempotencyKey,
        inputHash: identity.inputHash,
        generation: conversation.aiGeneration,
        sequence,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: now,
        heartbeatAt: now,
      },
    });
    return {
      disposition: "active",
      attempt: attemptFromRun(run, data),
      input: await loadRuntimeInput(tx, conversation, inbound),
    };
  });
}

async function assertAttempt(tx: Prisma.TransactionClient, attempt: AiReplyAttempt) {
  const conversation = await lockConversation(tx, attempt.tenantId, attempt.conversationId);
  const admission = conversation
    ? await automaticReplyAdmissionState(tx, {
        tenantId: attempt.tenantId,
        conversationId: attempt.conversationId,
      })
    : null;
  const lockedRun = await lockReplyRun(tx, attempt.tenantId, attempt.runId);
  const run = await tx.aiReplyRun.findUnique({ where: { id: attempt.runId } });
  const inbound = await tx.message.findFirst({
    where: {
      id: attempt.inboundMessageId,
      tenantId: attempt.tenantId,
      conversationId: attempt.conversationId,
      direction: "INBOUND",
    },
    select: { id: true, text: true, createdAt: true },
  });
  const newerInboundExists = inbound
    ? await hasLaterInboundMessage(tx, attempt.tenantId, attempt.conversationId, inbound)
    : false;
  const rederivedInputHash =
    conversation && inbound
      ? aiReplyRunIdentity(attempt.inputData, inbound, conversation.leadId).inputHash
      : null;
  const currentCapabilityBinding =
    admission?.admitted && inbound
      ? await resolveCapabilityBinding(tx, {
          tenantId: attempt.tenantId,
          publicationId: admission.publicationId,
          text: inbound.text ?? "",
          operationalBindingHash: admission.operationalBindingHash,
          operationalPermissionGeneration: admission.operationalPermissionGeneration,
        })
      : null;
  const automaticReplyRevoked =
    admission === null ||
    !admission.admitted ||
    run?.publicationId !== admission.publicationId ||
    run?.capabilitySetHash !== admission.capabilitySetHash ||
    run?.operationalBindingHash !== admission.operationalBindingHash ||
    run?.operationalPermissionGeneration !== admission.operationalPermissionGeneration ||
    currentCapabilityBinding === null ||
    (run !== null && !capabilityBindingMatches(run, currentCapabilityBinding));
  if (
    !conversation ||
    !lockedRun ||
    !run ||
    !inbound ||
    run.tenantId !== attempt.tenantId ||
    run.conversationId !== attempt.conversationId ||
    run.inboundMessageId !== attempt.inboundMessageId ||
    run.inputHash !== attempt.inputHash ||
    rederivedInputHash !== attempt.inputHash ||
    run.status !== "RUNNING" ||
    run.generation !== attempt.generation ||
    run.sequence !== attempt.sequence ||
    run.attemptCount !== attempt.attemptCount ||
    conversation.aiGeneration !== attempt.generation ||
    conversation.aiReplyFence !== attempt.sequence ||
    run.cancelRequestedAt !== null ||
    newerInboundExists ||
    automaticReplyRevoked
  ) {
    throw new AiReplyFenceError(
      newerInboundExists
        ? "AI_REPLY_NEWER_INBOUND"
        : automaticReplyRevoked
          ? "AI_REPLY_AUTOMATIC_REPLY_REVOKED"
          : "AI_REPLY_RUN_SUPERSEDED",
    );
  }
  await tx.aiReplyRun.update({
    where: { id: attempt.runId },
    data: { heartbeatAt: new Date() },
  });
  return run;
}

export async function withFencedAiReplyTransaction<T>(
  attempt: AiReplyAttempt,
  work: (tx: Prisma.TransactionClient, run: AiReplyRun) => Promise<T>,
): Promise<T> {
  try {
    return await serializable(async (tx) => {
      const run = await assertAttempt(tx, attempt);
      return work(tx, run);
    });
  } catch (error) {
    if (
      error instanceof AiReplyFenceError &&
      (error.code === "AI_REPLY_RUN_SUPERSEDED" ||
        error.code === "AI_REPLY_NEWER_INBOUND" ||
        error.code === "AI_REPLY_AUTOMATIC_REPLY_REVOKED")
    ) {
      await prisma.aiReplyRun
        .updateMany({
          where: {
            id: attempt.runId,
            tenantId: attempt.tenantId,
            status: "RUNNING",
            attemptCount: attempt.attemptCount,
            generation: attempt.generation,
            sequence: attempt.sequence,
          },
          data: {
            status: "SUPERSEDED",
            completedAt: new Date(),
            errorCode:
              error.code === "AI_REPLY_NEWER_INBOUND"
                ? "SUPERSEDED_BY_NEWER_INPUT"
                : error.code === "AI_REPLY_AUTOMATIC_REPLY_REVOKED"
                  ? "AUTOMATIC_REPLY_ADMISSION_REVOKED"
                  : "SUPERSEDED_BY_FENCE",
            errorMessage: null,
          },
        })
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function withSerializableAiToolTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return serializable(work);
}

export async function markAiReplyAttemptFailed(
  attempt: AiReplyAttempt,
  errorMessage: string,
  timedOut: boolean,
) {
  const terminal = attempt.attemptCount >= attempt.maxAttempts;
  await prisma.aiReplyRun.updateMany({
    where: {
      id: attempt.runId,
      tenantId: attempt.tenantId,
      status: "RUNNING",
      attemptCount: attempt.attemptCount,
      generation: attempt.generation,
      sequence: attempt.sequence,
    },
    data: {
      status: terminal ? (timedOut ? "TIMED_OUT" : "DEAD_LETTER") : "RETRY_SCHEDULED",
      errorCode: timedOut
        ? "WORKER_TIMEOUT"
        : terminal
          ? "MAX_ATTEMPTS_EXCEEDED"
          : "ATTEMPT_FAILED",
      errorMessage: errorMessage.slice(0, 2_000),
      availableAt: terminal
        ? new Date()
        : new Date(
            Date.now() + Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt.attemptCount - 1)),
          ),
      completedAt: terminal ? new Date() : null,
      heartbeatAt: new Date(),
    },
  });
}
