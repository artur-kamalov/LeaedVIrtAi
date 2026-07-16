import { z } from "zod";
import type { Prisma } from "@leadvirt/db";
import type { AiActionType } from "@leadvirt/ai";
import {
  authorizeKnowledgeCapabilityEffectV1,
  knowledgeCapabilityToolEffectV1,
} from "@leadvirt/knowledge";
import { redactSensitiveText } from "@leadvirt/observability";
import {
  AiReplyFenceError,
  externalOperationIdentity,
  withFencedAiReplyTransaction,
  withSerializableAiToolTransaction,
  type AiReplyAttempt,
} from "./ai-reply-reliability.js";

const leadStatusSchema = z.enum([
  "NEW",
  "IN_PROGRESS",
  "QUALIFIED",
  "BOOKED",
  "ORDERED",
  "SENT_TO_CRM",
  "CLOSED",
  "LOST",
]);
const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

const leadUpdateCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.update"),
  input: z
    .object({
      leadId: z.string().min(1),
      summary: z.string().trim().min(1).max(500).optional(),
      interest: z.string().trim().min(1).max(160).optional(),
    })
    .refine(
      (value) => Boolean(value.summary || value.interest),
      "lead.update requires summary or interest",
    ),
});

const leadNoteCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.note.create"),
  input: z.object({
    leadId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000),
  }),
});

const leadStatusCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.status.change"),
  input: z.object({
    leadId: z.string().min(1),
    status: leadStatusSchema,
    reason: z.string().trim().min(1).max(300),
  }),
});

const bookingProposalCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("booking.proposal.create"),
  input: z.object({
    leadId: z.string().min(1),
    title: z.string().trim().min(1).max(160),
    startsAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "startsAt must be a valid datetime"),
    notes: z.string().trim().max(1000).optional(),
  }),
});

const taskCreateCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task.create"),
  input: z.object({
    leadId: z.string().min(1),
    assignedToUserId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    priority: prioritySchema.default("NORMAL"),
  }),
});

const aiToolCallSchema = z.discriminatedUnion("type", [
  leadUpdateCallSchema,
  leadNoteCallSchema,
  leadStatusCallSchema,
  bookingProposalCallSchema,
  taskCreateCallSchema,
]);

export type AiToolCall = z.infer<typeof aiToolCallSchema>;

export interface AiToolResult {
  callId: string;
  type: AiToolCall["type"];
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  entityType?: string;
  entityId?: string;
  reason?: string;
}

export interface PlanAiToolCallsInput {
  tenantId: string;
  leadId?: string | null;
  currentLeadStatus?: string | null;
  requestedByUserId?: string | null;
  graphRunId: string;
  conversationId: string;
  normalizedText: string;
  extractedFields: Record<string, unknown>;
  recommendationAction: AiActionType | "none";
  recommendationReason: string;
  qualityPassed: boolean;
  handoffRequired: boolean;
  retrievedContext: Array<{ title: string; content: string }>;
  autonomy?: {
    capabilityDecision: AiReplyAttempt["capabilityDecision"];
    allowedAutonomy: AiReplyAttempt["allowedAutonomy"];
    confirmationValid?: boolean;
    autonomousActionApproved?: boolean;
  };
}

export interface ExecuteAiToolCallsInput {
  tenantId: string;
  graphRunId: string;
  conversationId: string;
  calls: AiToolCall[];
  attempt?: AiReplyAttempt;
  signal?: AbortSignal;
}

function textField(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function callId(graphRunId: string, suffix: string) {
  return `${graphRunId}:${suffix}`;
}

function validDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstExactDateTime(text: string) {
  const iso = text.match(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?\b/u,
  )?.[0];
  const isoDate = validDate(iso);
  if (isoDate) return isoDate;

  const local = text.match(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\b/u);
  if (!local) return undefined;
  return validDate(`${local[1]}T${local[2]}:00+03:00`);
}

function bookingCandidate(input: PlanAiToolCallsInput) {
  const haystack = [
    input.normalizedText,
    ...input.retrievedContext.map((item) => `${item.title} ${item.content}`),
  ].join("\n");
  return firstExactDateTime(haystack);
}

function hasExplicitBookingIntent(input: PlanAiToolCallsInput) {
  const haystack = input.normalizedText.toLowerCase();
  return (
    /\b(book|booking|appointment|schedule|slot)\b/u.test(haystack) ||
    /запис|брон|слот|окн[оа]/iu.test(haystack)
  );
}

function statusTimestamp(
  status: z.infer<typeof leadStatusSchema>,
  date: Date,
): Prisma.LeadUpdateInput {
  if (status === "QUALIFIED") return { qualifiedAt: date };
  if (status === "BOOKED") return { bookedAt: date };
  if (status === "SENT_TO_CRM") return { sentToCrmAt: date };
  if (status === "CLOSED" || status === "LOST") return { closedAt: date };
  return {};
}

async function ensureLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string) {
  return tx.lead.findFirst({
    where: {
      id: leadId,
      tenantId,
      deletedAt: null,
    },
    select: { id: true, status: true },
  });
}

async function ensureConversation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
) {
  return tx.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId,
      deletedAt: null,
    },
    select: { id: true, leadId: true },
  });
}

async function userBelongsToTenant(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const membership = await tx.membership.findFirst({
    where: {
      tenantId,
      userId,
      user: { deletedAt: null },
    },
    select: { id: true },
  });
  return Boolean(membership);
}

export function planAiToolCalls(input: PlanAiToolCallsInput): AiToolCall[] {
  if (!input.leadId) return [];

  const calls: AiToolCall[] = [];
  const summary = textField(input.extractedFields, "summary");
  const interest = textField(input.extractedFields, "interest");

  if (summary || interest) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "lead-update"),
        type: "lead.update",
        input: {
          leadId: input.leadId,
          ...(summary ? { summary } : {}),
          ...(interest ? { interest } : {}),
        },
      }),
    );
  }

  calls.push(
    aiToolCallSchema.parse({
      id: callId(input.graphRunId, "lead-note"),
      type: "lead.note.create",
      input: {
        leadId: input.leadId,
        title: "AI processing note",
        message: input.qualityPassed
          ? `Recommendation: ${input.recommendationAction}. ${input.recommendationReason}`
          : `Quality gate blocked an automatic action. ${input.recommendationReason}`,
      },
    }),
  );

  if (input.currentLeadStatus === "NEW") {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "status-in-progress"),
        type: "lead.status.change",
        input: {
          leadId: input.leadId,
          status: "IN_PROGRESS",
          reason: "AI started processing the lead",
        },
      }),
    );
  }

  const startsAt =
    input.qualityPassed &&
    (input.recommendationAction === "create_booking_draft" || hasExplicitBookingIntent(input))
      ? bookingCandidate(input)
      : undefined;
  if (startsAt) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "booking-proposal"),
        type: "booking.proposal.create",
        input: {
          leadId: input.leadId,
          title: interest ? `Booking proposal: ${interest}` : "Booking proposal",
          startsAt: startsAt.toISOString(),
          notes: `Created by AI graph ${input.graphRunId}. Manager must confirm before final booking.`,
        },
      }),
    );
  }

  if (
    input.handoffRequired ||
    (input.qualityPassed && input.recommendationAction === "request_human_handoff")
  ) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "handoff-task"),
        type: "task.create",
        input: {
          leadId: input.leadId,
          ...(input.requestedByUserId ? { assignedToUserId: input.requestedByUserId } : {}),
          title: "Review AI handoff",
          description: input.recommendationReason,
          priority: "HIGH",
        },
      }),
    );
  }

  if (!input.autonomy) return calls;
  if (input.autonomy.capabilityDecision !== "AUTHORIZED") return [];
  const autonomy = input.autonomy;
  return calls.filter((call) =>
    authorizeKnowledgeCapabilityEffectV1({
      allowedAutonomy: autonomy.allowedAutonomy,
      effect: knowledgeCapabilityToolEffectV1(call.type),
      ...(autonomy.confirmationValid === undefined
        ? {}
        : { confirmationValid: autonomy.confirmationValid }),
      ...(autonomy.autonomousActionApproved === undefined
        ? {}
        : { autonomousActionApproved: autonomy.autonomousActionApproved }),
    }).allowed,
  );
}

function operationResult(call: AiToolCall, entityType: string, entityId: string): AiToolResult {
  return {
    callId: call.id,
    type: call.type,
    status: "SUCCESS",
    entityType,
    entityId,
  };
}

function storedOperationResult(
  call: AiToolCall,
  operation: { externalReference: string | null; result: Prisma.JsonValue | null },
) {
  if (
    !operation.externalReference ||
    typeof operation.result !== "object" ||
    operation.result === null ||
    Array.isArray(operation.result)
  ) {
    return null;
  }
  const entityType = operation.result.entityType;
  if (typeof entityType !== "string") return null;
  return operationResult(call, entityType, operation.externalReference);
}

async function executeToolCall(
  tx: Prisma.TransactionClient,
  input: ExecuteAiToolCallsInput,
  call: AiToolCall,
  ensureActive: () => void,
): Promise<AiToolResult> {
  ensureActive();
  if (input.attempt?.publicationId) {
    const autonomyDecision = authorizeKnowledgeCapabilityEffectV1({
      allowedAutonomy:
        input.attempt.capabilityDecision === "AUTHORIZED"
          ? input.attempt.allowedAutonomy
          : null,
      effect: knowledgeCapabilityToolEffectV1(call.type),
      confirmationValid: false,
      autonomousActionApproved: false,
    });
    if (input.attempt.capabilityDecision !== "AUTHORIZED" || !autonomyDecision.allowed) {
      return {
        callId: call.id,
        type: call.type,
        status: "SKIPPED",
        reason: `autonomy_${autonomyDecision.reason.toLowerCase()}`,
      };
    }
  }
  const conversation = await ensureConversation(tx, input.tenantId, input.conversationId);
  if (!conversation) {
    return {
      callId: call.id,
      type: call.type,
      status: "SKIPPED",
      reason: "conversation_not_found",
    };
  }
  const lead = await ensureLead(tx, input.tenantId, call.input.leadId);
  if (!lead) {
    return { callId: call.id, type: call.type, status: "SKIPPED", reason: "lead_not_found" };
  }
  if (conversation.leadId && conversation.leadId !== call.input.leadId) {
    return {
      callId: call.id,
      type: call.type,
      status: "SKIPPED",
      reason: "lead_not_in_conversation",
    };
  }
  if (
    call.type === "task.create" &&
    call.input.assignedToUserId &&
    !(await userBelongsToTenant(tx, input.tenantId, call.input.assignedToUserId))
  ) {
    return {
      callId: call.id,
      type: call.type,
      status: "SKIPPED",
      reason: "assigned_user_not_in_tenant",
    };
  }

  const request = { type: call.type, input: call.input };
  const operationAttempt: AiReplyAttempt = input.attempt ?? {
    runId: input.graphRunId,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    inboundMessageId: "direct",
    publicationId: null,
    capabilitySetHash: null,
    operationalBindingHash: null,
    operationalPermissionGeneration: null,
    capabilityType: null,
    allowedAutonomy: null,
    requiredAutonomy: null,
    capabilityDecision: null,
    idempotencyKey: input.graphRunId,
    inputHash: input.graphRunId,
    inputData: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      triggerMessageId: "direct",
      source: "worker-test",
    },
    generation: 1,
    sequence: 1,
    attemptCount: 1,
    maxAttempts: 1,
  };
  const identity = externalOperationIdentity(operationAttempt, call.id, request);
  const existing = await tx.externalOperation.findUnique({ where: { id: identity.id } });
  if (existing) {
    if (existing.tenantId !== input.tenantId || existing.requestHash !== identity.requestHash) {
      throw new AiReplyFenceError("AI_REPLY_INPUT_MISMATCH");
    }
    if (existing.status === "SUCCEEDED") {
      const result = storedOperationResult(call, existing);
      if (!result) throw new AiReplyFenceError("AI_REPLY_RUN_CORRUPT");
      return result;
    }
    if (existing.status === "RECONCILED") {
      const result = storedOperationResult(call, existing);
      if (result) return result;
      throw new AiReplyFenceError("AI_EXTERNAL_OPERATION_AMBIGUOUS");
    }
    if (existing.status === "STARTED" || existing.status === "UNKNOWN") {
      throw new AiReplyFenceError("AI_EXTERNAL_OPERATION_AMBIGUOUS");
    }
  }

  const now = new Date();
  if (existing) {
    await tx.externalOperation.update({
      where: { id: identity.id },
      data: {
        status: "STARTED",
        attemptCount: { increment: 1 },
        startedAt: now,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  } else {
    await tx.externalOperation.create({
      data: {
        id: identity.id,
        tenantId: input.tenantId,
        aiReplyRunId: input.attempt?.runId ?? null,
        conversationId: input.conversationId,
        originatingMessageId: input.attempt?.inboundMessageId ?? null,
        operationKind: call.type,
        requestHash: identity.requestHash,
        status: "STARTED",
        attemptCount: 1,
        startedAt: now,
        retentionExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
      },
    });
  }

  let result: AiToolResult;
  if (call.type === "lead.update") {
    const updated = await tx.lead.update({
      where: { id: call.input.leadId },
      data: {
        ...(call.input.summary ? { summary: call.input.summary } : {}),
        ...(call.input.interest ? { interest: call.input.interest } : {}),
        updatedAt: now,
      },
      select: { id: true },
    });
    result = operationResult(call, "lead", updated.id);
  } else if (call.type === "lead.note.create") {
    const event = await tx.leadEvent.create({
      data: {
        tenantId: input.tenantId,
        leadId: call.input.leadId,
        type: "ai_tool_note",
        title: call.input.title,
        message: call.input.message,
        metadata: {
          graphRunId: input.graphRunId,
          conversationId: input.conversationId,
          toolCallId: call.id,
          externalOperationId: identity.id,
        },
      },
    });
    result = operationResult(call, "lead_event", event.id);
  } else if (call.type === "lead.status.change") {
    const updated = await tx.lead.update({
      where: { id: call.input.leadId },
      data: {
        status: call.input.status,
        ...statusTimestamp(call.input.status, now),
        updatedAt: now,
      },
      select: { id: true },
    });
    await tx.leadEvent.create({
      data: {
        tenantId: input.tenantId,
        leadId: call.input.leadId,
        type: "ai_tool_status_changed",
        title: "AI changed lead status",
        message: call.input.reason,
        metadata: {
          graphRunId: input.graphRunId,
          conversationId: input.conversationId,
          toolCallId: call.id,
          externalOperationId: identity.id,
          status: call.input.status,
        },
      },
    });
    result = operationResult(call, "lead", updated.id);
  } else if (call.type === "booking.proposal.create") {
    const startsAt = new Date(call.input.startsAt);
    const booking = await tx.booking.create({
      data: {
        tenantId: input.tenantId,
        leadId: call.input.leadId,
        title: call.input.title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        status: "DRAFT",
        notes: call.input.notes ?? null,
        metadata: {
          graphRunId: input.graphRunId,
          conversationId: input.conversationId,
          toolCallId: call.id,
          externalOperationId: identity.id,
          requiresManagerConfirmation: true,
        },
      },
    });
    await tx.leadEvent.create({
      data: {
        tenantId: input.tenantId,
        leadId: call.input.leadId,
        type: "ai_tool_booking_proposed",
        title: "AI created booking proposal",
        message: `${call.input.title} at ${startsAt.toISOString()}`,
        metadata: {
          graphRunId: input.graphRunId,
          conversationId: input.conversationId,
          toolCallId: call.id,
          externalOperationId: identity.id,
          bookingId: booking.id,
        },
      },
    });
    result = operationResult(call, "booking", booking.id);
  } else {
    const task = await tx.task.create({
      data: {
        tenantId: input.tenantId,
        leadId: call.input.leadId,
        assignedToUserId: call.input.assignedToUserId ?? null,
        title: call.input.title,
        description: call.input.description ?? null,
        priority: call.input.priority,
        metadata: {
          graphRunId: input.graphRunId,
          conversationId: input.conversationId,
          toolCallId: call.id,
          externalOperationId: identity.id,
        },
      },
    });
    result = operationResult(call, "task", task.id);
  }

  ensureActive();
  await tx.externalOperation.update({
    where: { id: identity.id },
    data: {
      status: "SUCCEEDED",
      externalReference: result.entityId ?? null,
      result: { entityType: result.entityType ?? "unknown" },
      completedAt: new Date(),
    },
  });
  ensureActive();
  return result;
}

export async function executeAiToolCalls(input: ExecuteAiToolCallsInput): Promise<AiToolResult[]> {
  const ensureActive = () => {
    if (!input.signal?.aborted) return;
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new Error("AI tool execution was cancelled.");
  };
  ensureActive();
  const results: AiToolResult[] = [];

  for (const rawCall of input.calls) {
    ensureActive();
    const parsed = aiToolCallSchema.safeParse(rawCall);
    if (!parsed.success) {
      results.push({
        callId: rawCall.id,
        type: rawCall.type,
        status: "FAILED",
        reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }

    const call = parsed.data;
    try {
      const work = (tx: Prisma.TransactionClient) => executeToolCall(tx, input, call, ensureActive);
      const result = input.attempt
        ? await withFencedAiReplyTransaction(input.attempt, work)
        : await withSerializableAiToolTransaction(work);
      results.push(result);
    } catch (error) {
      if (error instanceof AiReplyFenceError) throw error;
      if (input.attempt) throw error;
      results.push({
        callId: call.id,
        type: call.type,
        status: "FAILED",
        reason:
          error instanceof Error ? redactSensitiveText(error.message) : "tool_execution_failed",
      });
    }
  }

  return results;
}
