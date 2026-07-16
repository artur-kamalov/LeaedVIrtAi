import { randomUUID } from "node:crypto";
import { MockAiProvider } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { Prisma, prisma } from "@leadvirt/db";
import type { AiReplyEnqueueRequest } from "@leadvirt/types";
import { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";
import type { AiReplyQueueService } from "../../apps/api/src/modules/ai/ai-reply-queue.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import type { WorkflowsService } from "../../apps/api/src/modules/workflows/workflows.service.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function eventPayload(input: {
  eventId: string;
  messageId: string;
  conversationId: string;
  text: string;
  timestamp: string;
}) {
  return {
    eventId: input.eventId,
    conversationId: input.conversationId,
    message: {
      id: input.messageId,
      text: input.text,
      timestamp: input.timestamp,
    },
    customer: {
      id: `customer-${input.conversationId}`,
      name: "Webhook Reliability Customer",
    },
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const webhookSecret = `reliability-secret-${suffix}`;
  const webhookHeaders = { "x-leadvirt-webhook-secret": webhookSecret };
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Webhook Reliability Smoke", slug: `webhook-reliability-${suffix}` },
    });
    tenantId = tenant.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Webhook Reliability",
        publicKey: `webhook-reliability-${suffix}`,
        settings: { webhook: { secret: webhookSecret } },
      },
    });

    const workflowFailureText = "Retry this exact webhook event";
    const outboxFailureText = "Rollback this failed outbox transaction";
    const rejectionText = "Persist this inbound without an AI dispatch";
    let workflowCalls = 0;
    let workflowFailurePending = true;
    let outboxFailurePending = true;
    let enqueueCalls = 0;
    const persistedTriggerMessageIds: string[] = [];
    const dispatchedEventIds: string[] = [];
    const workflows = {
      runForEvent: async (input: { text?: string | null }) => {
        workflowCalls += 1;
        if (input.text === workflowFailureText && workflowFailurePending) {
          workflowFailurePending = false;
          throw new Error("simulated post-intake workflow failure");
        }
        return [];
      },
    } as unknown as WorkflowsService;
    const queue = {
      enabled: true,
      createEvent: async (tx: Prisma.TransactionClient, data: AiReplyEnqueueRequest) => {
        if (data.text === rejectionText) {
          return { created: false as const, reason: "CONVERSATION_AI_DISABLED" as const };
        }
        const jobId = `ai-reply:${data.conversationId}:${data.triggerMessageId}`;
        const event = await tx.runtimeOutbox.create({
          data: {
            tenantId: data.tenantId,
            aggregateType: "conversation",
            aggregateId: data.triggerMessageId,
            aggregateVersion: 1,
            eventType: "ai.reply.requested",
            dedupeKey: jobId,
            payload: {
              queueName: "ai.reply",
              jobName: "generate-reply",
              jobId,
              data: {
                tenantId: data.tenantId,
                conversationId: data.conversationId,
                triggerMessageId: data.triggerMessageId,
                source: data.source,
              },
              attempts: 3,
              backoffMs: 1000,
            },
          },
        });
        if (data.text === outboxFailureText && outboxFailurePending) {
          outboxFailurePending = false;
          throw new Error("simulated transactional outbox persistence failure");
        }
        persistedTriggerMessageIds.push(data.triggerMessageId);
        return { created: true as const, event, run: {} as never, admission: {} as never };
      },
      dispatchPersisted: (eventId: string) => dispatchedEventIds.push(eventId),
      enqueue: async () => {
        enqueueCalls += 1;
        return { queued: false as const, reason: "CONVERSATION_NOT_OPEN" as const };
      },
    } as unknown as AiReplyQueueService;
    const service = new WebhookService(
      prisma as unknown as PrismaService,
      new MockAiProvider(),
      queue,
      workflows,
    );

    const timestamp = new Date().toISOString();
    const retryEventId = `retry-${suffix}`;
    const retryMessageId = `retry-message-${suffix}`;
    const retryConversationId = `retry-conversation-${suffix}`;
    const retryPayload = eventPayload({
      eventId: retryEventId,
      messageId: retryMessageId,
      conversationId: retryConversationId,
      text: workflowFailureText,
      timestamp,
    });

    let initialFailure: unknown;
    try {
      await service.handleEvent(channel.publicKey!, retryPayload, webhookHeaders);
    } catch (error) {
      initialFailure = error;
    }
    assert(initialFailure instanceof Error, "The first webhook attempt did not fail as arranged.");

    const provider = `webhook:${channel.id}`;
    const externalEventId = `webhook:event:${retryEventId}`;
    const failedEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider, externalEventId } },
    });
    assert(
      failedEvent.status === "FAILED",
      `First attempt ended as ${failedEvent.status}, not FAILED.`,
    );

    const retried = await service.handleEvent(channel.publicKey!, retryPayload, webhookHeaders);
    const processedEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider, externalEventId } },
    });
    assert(!retried.duplicate, "A FAILED webhook event was treated as a completed duplicate.");
    assert(processedEvent.id === failedEvent.id, "Retry created a second webhook event row.");
    assert(
      processedEvent.status === "PROCESSED",
      `Retry ended as ${processedEvent.status}, not PROCESSED.`,
    );
    assert(processedEvent.errorMessage === null, "Retry did not clear the prior webhook error.");
    assert(
      retried.outboundStatus === "queued",
      `Durably accepted retry was reported as ${retried.outboundStatus}.`,
    );
    const retryInbound = await prisma.message.findFirstOrThrow({
      where: { tenantId, externalMessageId: `webhook:${retryMessageId}`, direction: "INBOUND" },
      select: { id: true },
    });
    const retryJobId = `ai-reply:${retried.conversationId}:${retryInbound.id}`;
    const retryOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey: retryJobId } },
    });
    assert(
      persistedTriggerMessageIds.filter((messageId) => messageId === retryInbound.id).length === 1,
      "FAILED event retry persisted more than one AI dispatch.",
    );
    assert(
      dispatchedEventIds.filter((eventId) => eventId === retryOutbox.id).length === 2,
      "FAILED event retry did not reuse the same post-commit dispatch event.",
    );
    assert(enqueueCalls === 0, "Generic webhook called the second-admission enqueue path.");
    assert(
      (await prisma.message.count({
        where: { tenantId, externalMessageId: `webhook:${retryMessageId}`, direction: "INBOUND" },
      })) === 1,
      "FAILED event retry duplicated the inbound message.",
    );

    const outboxCountBeforeFailure = await prisma.runtimeOutbox.count({ where: { tenantId } });
    const outboxFailureEventId = `outbox-failure-${suffix}`;
    const outboxFailureMessageId = `outbox-failure-message-${suffix}`;
    const outboxFailurePayload = eventPayload({
      eventId: outboxFailureEventId,
      messageId: outboxFailureMessageId,
      conversationId: `outbox-failure-conversation-${suffix}`,
      text: outboxFailureText,
      timestamp: new Date(Date.now() + 1).toISOString(),
    });
    let outboxFailure: unknown;
    try {
      await service.handleEvent(channel.publicKey!, outboxFailurePayload, webhookHeaders);
    } catch (error) {
      outboxFailure = error;
    }
    assert(outboxFailure instanceof Error, "Outbox persistence failure did not fail intake.");
    assert(
      (await prisma.message.count({
        where: {
          tenantId,
          externalMessageId: `webhook:${outboxFailureMessageId}`,
          direction: "INBOUND",
        },
      })) === 0,
      "Outbox persistence failure committed the inbound message.",
    );
    assert(
      (await prisma.runtimeOutbox.count({ where: { tenantId } })) === outboxCountBeforeFailure,
      "Outbox persistence failure committed the outbox event.",
    );
    const failedOutboxWebhook = await prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider,
          externalEventId: `webhook:event:${outboxFailureEventId}`,
        },
      },
    });
    assert(
      failedOutboxWebhook.status === "FAILED",
      "Outbox persistence failure did not leave the webhook retryable.",
    );
    const recoveredOutbox = await service.handleEvent(
      channel.publicKey!,
      outboxFailurePayload,
      webhookHeaders,
    );
    assert(
      recoveredOutbox.outboundStatus === "queued" && recoveredOutbox.inboundMessageId !== null,
      "Outbox persistence retry did not durably queue the AI dispatch.",
    );
    assert(
      (await prisma.message.count({
        where: {
          tenantId,
          externalMessageId: `webhook:${outboxFailureMessageId}`,
          direction: "INBOUND",
        },
      })) === 1,
      "Outbox persistence retry did not commit exactly one inbound message.",
    );

    const dispatchCountBeforeRejection = dispatchedEventIds.length;
    const rejected = await service.handleEvent(
      channel.publicKey!,
      eventPayload({
        eventId: `rejected-${suffix}`,
        messageId: `rejected-message-${suffix}`,
        conversationId: `rejected-conversation-${suffix}`,
        text: rejectionText,
        timestamp: new Date(Date.now() + 2).toISOString(),
      }),
      webhookHeaders,
    );
    assert(
      rejected.outboundStatus === "skipped" && rejected.inboundMessageId !== null,
      "Admission rejection did not persist the inbound with a skipped result.",
    );
    assert(
      dispatchedEventIds.length === dispatchCountBeforeRejection,
      "Admission rejection dispatched a nonexistent outbox event.",
    );
    assert(enqueueCalls === 0, "Admission rejection called the second-admission enqueue path.");

    const sharedConversationId = `shared-conversation-${suffix}`;
    const concurrentPayloads = [1, 2].map((number) =>
      eventPayload({
        eventId: `concurrent-event-${number}-${suffix}`,
        messageId: `concurrent-message-${number}-${suffix}`,
        conversationId: sharedConversationId,
        text: `Concurrent webhook message ${number}`,
        timestamp: new Date(Date.now() + number).toISOString(),
      }),
    );
    const concurrentResults = await Promise.all(
      concurrentPayloads.map((payload) =>
        service.handleEvent(channel.publicKey!, payload, webhookHeaders),
      ),
    );
    const externalConversationId = `webhook:${sharedConversationId}`;
    const sharedConversations = await prisma.conversation.findMany({
      where: { tenantId, channelId: channel.id, externalConversationId },
      select: { id: true, leadId: true },
    });
    assert(
      sharedConversations.length === 1,
      `Concurrent first intake created ${sharedConversations.length} conversations.`,
    );
    assert(
      concurrentResults.every((result) => result.conversationId === sharedConversations[0]?.id),
      "Concurrent intake responses did not converge on one conversation.",
    );
    assert(
      concurrentResults.every((result) => result.outboundStatus === "queued"),
      "Concurrent durable dispatch was reported as skipped.",
    );
    assert(
      (await prisma.message.count({
        where: { tenantId, conversationId: sharedConversations[0]!.id, direction: "INBOUND" },
      })) === 2,
      "Concurrent events did not preserve both distinct inbound messages.",
    );
    assert(
      (await prisma.lead.count({
        where: { tenantId, conversations: { some: { id: sharedConversations[0]!.id } } },
      })) === 1,
      "Concurrent first intake created more than one lead for the shared conversation.",
    );

    const inboundCountBeforeConflict = await prisma.message.count({
      where: { tenantId, direction: "INBOUND" },
    });
    const changedPayload = eventPayload({
      eventId: retryEventId,
      messageId: retryMessageId,
      conversationId: retryConversationId,
      text: "Changed payload under the same event identity",
      timestamp,
    });
    let conflictStatus: number | null = null;
    try {
      await service.handleEvent(channel.publicKey!, changedPayload, webhookHeaders);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "getStatus" in error &&
        typeof error.getStatus === "function"
      ) {
        conflictStatus = error.getStatus() as number;
      }
    }
    assert(
      conflictStatus === 409,
      `Changed payload was not rejected with 409; received ${String(conflictStatus)}.`,
    );
    assert(
      (await prisma.message.count({ where: { tenantId, direction: "INBOUND" } })) ===
        inboundCountBeforeConflict,
      "Rejected payload reuse still created an inbound message.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        failedEventRetried: true,
        transactionalOutboxRollback: true,
        singleAdmission: enqueueCalls === 0,
        admissionRejectionSkipped: true,
        webhookEventId: processedEvent.id,
        oneConcurrentConversation: true,
        concurrentConversationId: sharedConversations[0]!.id,
        changedPayloadRejected: true,
        workflowCalls,
      }),
    );
  } finally {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
