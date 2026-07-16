import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import type { AiReplyEnqueueRequest } from "@leadvirt/types";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  completeWebhookEventStage,
  WEBHOOK_EVENT_LEASE_MS,
  WebhookEventClaimLostError,
} from "../../apps/api/src/common/webhook-event-claim.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AiReplyQueueService } from "../../apps/api/src/modules/ai/ai-reply-queue.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import { WorkflowsService } from "../../apps/api/src/modules/workflows/workflows.service.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const webhookSecret = `telegram-replay-${suffix}`;
  const botId = String(700_000_000 + (Date.now() % 100_000_000));
  let tenantId: string | null = null;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: { email: `telegram-replay-${suffix}@example.test`, name: "Replay Fence Owner" },
    });
    userId = user.id;
    const tenant = await prisma.tenant.create({
      data: { name: "Telegram Replay Fence", slug: `telegram-replay-${suffix}` },
    });
    tenantId = tenant.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const context: RequestContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };
    const workflows = new WorkflowsService(prisma as unknown as PrismaService);
    const workflow = await workflows.create(context, {
      name: "Telegram replay handoff",
      status: "ACTIVE",
      steps: [
        { type: "TRIGGER", name: "Inbound", config: { enabled: true } },
        { type: "HANDOFF", name: "Owner handoff", config: { enabled: true } },
        { type: "END", name: "End", config: { enabled: true } },
      ],
    });
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Replay fence bot",
        externalId: botId,
        publicKey: `telegram-replay-${suffix}`,
        settings: { telegram: { webhookSecret } },
      },
    });

    let aiDispatches = 0;
    let redundantAiEnqueues = 0;
    const queue = {
      enabled: true,
      createEvent: async (_tx: Prisma.TransactionClient, _request: AiReplyEnqueueRequest) => {
        aiDispatches += 1;
        return { created: true, event: { id: `ai-intake-${suffix}` } };
      },
      enqueue: async (request: AiReplyEnqueueRequest) => {
        redundantAiEnqueues += 1;
        return {
          queued: true,
          jobId: `ai-reply:${request.conversationId}:${request.triggerMessageId}`,
        };
      },
    } as unknown as AiReplyQueueService;
    let workflowCalls = 0;
    const crashAfterCommittedWorkflow = {
      runForEvent: async (input: Parameters<WorkflowsService["runForEvent"]>[0]) => {
        workflowCalls += 1;
        const result = await workflows.runForEvent(input);
        if (workflowCalls === 1) throw new Error("arranged crash after committed workflow");
        return result;
      },
    } as WorkflowsService;
    const telegram = new TelegramService(
      prisma as unknown as PrismaService,
      queue,
      crashAfterCommittedWorkflow,
    );
    const updateId = Math.floor(Date.now() / 10);
    const messageTimestamp = Math.floor(Date.now() / 1000);
    const payload = {
      update_id: updateId,
      message: {
        message_id: 41,
        date: messageTimestamp,
        from: { id: 812345678, is_bot: false, first_name: "Replay" },
        chat: { id: 812345678, type: "private", first_name: "Replay" },
        text: "Please connect me to the owner",
      },
    };
    const headers = { "x-telegram-bot-api-secret-token": webhookSecret };

    let arrangedFailure: unknown;
    try {
      await telegram.handleWebhook(channel.publicKey!, payload, headers, "TELEGRAM_WEBHOOK");
    } catch (error) {
      arrangedFailure = error;
    }
    assert(
      arrangedFailure instanceof Error && arrangedFailure.message.includes("arranged crash"),
      "Telegram processing did not fail after the committed workflow as arranged.",
    );
    const provider = `telegram:${channel.id}`;
    const externalEventId = `telegram:bot:${botId}:update:${updateId}`;
    const failedEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider, externalEventId } },
    });
    assert(
      failedEvent.status === "FAILED" &&
        failedEvent.intakeCompletedAt !== null &&
        failedEvent.aiDispatchCompletedAt !== null &&
        failedEvent.workflowDispatchCompletedAt === null,
      "The failed Telegram event did not preserve its completed stage checkpoints.",
    );
    assert(
      aiDispatches === 1 && redundantAiEnqueues === 0,
      "Initial durable AI dispatch was not singular.",
    );

    const resumed = await telegram.handleWebhook(
      channel.publicKey!,
      payload,
      headers,
      "TELEGRAM_WEBHOOK",
    );
    const processedEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: failedEvent.id },
    });
    assert(!resumed.duplicate, "The failed Telegram event was not resumed.");
    assert(
      processedEvent.status === "PROCESSED" &&
        processedEvent.processingAttempt === failedEvent.processingAttempt + 1 &&
        processedEvent.receivedAt.getTime() === failedEvent.receivedAt.getTime() &&
        processedEvent.workflowDispatchCompletedAt !== null &&
        processedEvent.leaseToken === null &&
        processedEvent.leaseAcquiredAt === null &&
        processedEvent.leaseExpiresAt === null,
      "The resumed Telegram event did not finish under a distinct released lease.",
    );
    assert(
      aiDispatches === 1 && redundantAiEnqueues === 0,
      "Telegram resumption replayed an already completed AI stage.",
    );
    assert(workflowCalls === 2, "The retry did not reconcile the workflow stage.");
    assert(
      (await prisma.workflowRun.count({
        where: { tenantId: tenant.id, workflowId: workflow.id },
      })) === 1,
      "Telegram resumption created a second workflow run.",
    );
    assert(
      (await prisma.auditLog.count({
        where: {
          tenantId: tenant.id,
          action: "workflow.runtime_completed",
          entityId: workflow.id,
        },
      })) === 1,
      "Telegram resumption duplicated the workflow completion audit.",
    );
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resumed.conversationId },
      select: { leadId: true, status: true, handoffRequested: true },
    });
    assert(
      conversation.status === "WAITING_FOR_HUMAN" && conversation.handoffRequested,
      "The committed workflow effect was not retained.",
    );
    assert(
      (await prisma.leadEvent.count({
        where: {
          tenantId: tenant.id,
          leadId: conversation.leadId!,
          type: "workflow_run_completed",
        },
      })) === 1,
      "Telegram resumption duplicated the workflow lead event.",
    );
    const usage = await prisma.usageCounter.findFirstOrThrow({
      where: { tenantId: tenant.id },
      select: { workflowRuns: true },
    });
    assert(usage.workflowRuns === 1, "Telegram resumption billed the workflow twice.");

    const duplicate = await telegram.handleWebhook(
      channel.publicKey!,
      payload,
      headers,
      "TELEGRAM_WEBHOOK",
    );
    assert(duplicate.duplicate, "A processed Telegram replay was not acknowledged as duplicate.");
    assert(
      aiDispatches === 1 && redundantAiEnqueues === 0 && workflowCalls === 2,
      "A processed Telegram duplicate executed a side effect.",
    );

    const raceProvider = `telegram-race:${channel.id}`;
    const raceEventId = `race:${suffix}`;
    const racePayload = { update_id: updateId + 1 } satisfies Prisma.InputJsonObject;
    const firstReceiptAt = new Date();
    const claims = await Promise.all(
      [0, 1].map(() =>
        claimWebhookEvent(prisma, {
          tenantId: tenant.id,
          provider: raceProvider,
          externalEventId: raceEventId,
          payloadHash: `race-hash-${suffix}`,
          payload: racePayload,
          receivedAt: firstReceiptAt,
        }),
      ),
    );
    const firstClaim = claims.find((claim) => claim.claimed);
    assert(
      claims.filter((claim) => claim.claimed).length === 1 && firstClaim?.claimed,
      "Concurrent webhook claimants did not converge on one lease owner.",
    );
    assert(
      claims.filter((claim) => !claim.claimed).length === 1,
      "The active webhook lease was stolen before expiry.",
    );
    const resumedAt = new Date(firstReceiptAt.getTime() + WEBHOOK_EVENT_LEASE_MS + 1);
    const expiredClaim = await claimWebhookEvent(prisma, {
      tenantId: tenant.id,
      provider: raceProvider,
      externalEventId: raceEventId,
      payloadHash: `race-hash-${suffix}`,
      payload: racePayload,
      receivedAt: resumedAt,
    });
    assert(
      expiredClaim.claimed && expiredClaim.resumed,
      "An expired webhook lease was not resumed.",
    );
    assert(
      expiredClaim.event.receivedAt.getTime() === firstReceiptAt.getTime() &&
        expiredClaim.event.leaseAcquiredAt?.getTime() === resumedAt.getTime() &&
        expiredClaim.event.processingAttempt === 2 &&
        expiredClaim.claimToken !== firstClaim.claimToken,
      "Webhook resumption reused receipt time or the prior processing lease.",
    );
    let staleOwnerRejected = false;
    try {
      await completeWebhookEventStage(prisma, {
        eventId: expiredClaim.event.id,
        claimToken: firstClaim.claimToken,
        stage: "intakeCompletedAt",
      });
    } catch (error) {
      staleOwnerRejected = error instanceof WebhookEventClaimLostError;
    }
    assert(staleOwnerRejected, "The expired webhook lease owner could still commit a stage.");
    for (const stage of [
      "intakeCompletedAt",
      "aiDispatchCompletedAt",
      "workflowDispatchCompletedAt",
    ] as const) {
      await completeWebhookEventStage(prisma, {
        eventId: expiredClaim.event.id,
        claimToken: expiredClaim.claimToken,
        stage,
      });
    }
    await completeWebhookEvent(prisma, {
      eventId: expiredClaim.event.id,
      claimToken: expiredClaim.claimToken,
    });

    console.log(
      JSON.stringify({
        ok: true,
        failedStageResumed: true,
        aiDispatches,
        workflowRuns: 1,
        workflowCalls,
        concurrentClaimOwnerCount: 1,
        expiredOwnerFenced: true,
        immutableReceiptTime: true,
      }),
    );
  } finally {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
