import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, Prisma, type ChannelDeliveryOperation } from "@leadvirt/db";
import { WebhookDeliveryError, type ChannelAdapter } from "@leadvirt/integrations";
import type { ChannelSendMessageJobData } from "@leadvirt/types";
import {
  deliverChannelMessage,
  type ChannelDeliveryKnowledgeDependencies,
} from "../../apps/worker/src/channels/channel-delivery.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let providerCalls = 0;
  const fakeWebhookAdapter: ChannelAdapter = {
    type: "WEBHOOK",
    normalizeInbound: async () => {
      throw new Error("Inbound normalization is not used by this smoke.");
    },
    sendMessage: async (input) => {
      providerCalls += 1;
      const deliveryOperationId = input.metadata?.deliveryOperationId;
      return {
        externalMessageId: `webhook-test:${
          typeof deliveryOperationId === "string" ? deliveryOperationId : providerCalls
        }`,
        status: "queued",
      };
    },
  };
  const deliveryDependencies = {
    knowledgeRetriever: {} as ChannelDeliveryKnowledgeDependencies["knowledgeRetriever"],
    groundedAnswer: {} as ChannelDeliveryKnowledgeDependencies["groundedAnswer"],
    adapterFactory: () => fakeWebhookAdapter,
    maxDeliveryAttempts: 3,
  } satisfies ChannelDeliveryKnowledgeDependencies;
  const processLeadVirtJob = (name: string, job: { id?: string; data: unknown }) => {
    assert(name === "channels.sendMessage", "Unexpected smoke job name.");
    return deliverChannelMessage(
      job.data as ChannelSendMessageJobData,
      job.id,
      undefined,
      deliveryDependencies,
    );
  };
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Channel Delivery Smoke",
        slug: `channel-delivery-smoke-${suffix}`,
        timezone: "Europe/Moscow",
      },
    });
    tenantId = tenant.id;

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Channel Delivery Smoke Webhook",
        externalId: `channel-delivery-${suffix}`,
        publicKey: `lvwh_channel_delivery_${suffix.replace(/-/g, "_")}`,
      },
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "Channel Delivery Lead",
        source: "webhook",
        channelType: "WEBHOOK",
        status: "IN_PROGRESS",
        temperature: "WARM",
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: `webhook:${suffix}`,
        status: "OPEN",
        subject: "Channel delivery smoke",
        aiEnabled: true,
      },
    });

    const message = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        externalMessageId: `ai-reply:${conversation.id}:trigger-${suffix}`,
        text: "Smoke reply from delivery worker.",
        status: "QUEUED",
        metadata: {
          graphRunId: `langgraph:channel-delivery-${suffix}`,
          outboundStatus: "queued",
        },
      },
    });

    const data: ChannelSendMessageJobData = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      messageId: message.id,
      source: "webhook",
      graphRunId: `langgraph:channel-delivery-${suffix}`,
      triggerMessageId: `trigger-${suffix}`,
      requestedAt: new Date().toISOString(),
    };

    const jobId = `channel-send-${message.id}`;
    const result = await processLeadVirtJob("channels.sendMessage", {
      id: jobId,
      data,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(result), "Delivery processor did not return an object result");
    assert(
      result.status === "sent",
      `Expected sent result, got ${String(result.status)} (${String(result.reason)})`,
    );
    assert(
      typeof result.providerExternalMessageId === "string",
      "Delivery result has no provider external message id",
    );
    assert(typeof result.deliveryOperationId === "string", "Delivery result has no operation id");

    const sentMessage = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    assert(
      sentMessage.status === "SENT",
      `Expected message status SENT, got ${sentMessage.status}`,
    );
    assert(hasRecord(sentMessage.metadata), "Sent message metadata is not an object");
    assert(
      sentMessage.metadata.outboundStatus === "queued",
      "Adapter outbound status was not stored",
    );
    assert(hasRecord(sentMessage.metadata.delivery), "Delivery metadata was not stored");

    const operation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: message.id },
    });
    assert(
      operation.status === "SUCCEEDED",
      `Expected delivery operation SUCCEEDED, got ${operation.status}`,
    );
    assert(
      operation.id === result.deliveryOperationId,
      "Delivery result operation id does not match persisted operation",
    );
    assert(
      /^channel_delivery_[a-f0-9]{64}$/.test(operation.id),
      "Delivery operation id is not deterministic SHA-256",
    );
    assert(
      /^sha256:[a-f0-9]{64}$/.test(operation.requestHash),
      "Delivery request hash is not deterministic SHA-256",
    );
    assert(
      operation.attemptCount === 1,
      `Expected one provider attempt, got ${operation.attemptCount}`,
    );

    const auditCount = await prisma.auditLog.count({
      where: {
        tenantId: tenant.id,
        action: "channel.message.sent",
        entityId: message.id,
      },
    });
    assert(auditCount === 1, `Expected one delivery audit, got ${auditCount}`);

    const duplicate = await processLeadVirtJob("channels.sendMessage", {
      id: jobId,
      data,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(duplicate), "Duplicate delivery did not return an object result");
    assert(
      duplicate.status === "already_delivered",
      `Expected already_delivered duplicate result, got ${String(duplicate.status)}`,
    );
    assert(
      duplicate.reason === "delivery_operation_succeeded",
      "Duplicate did not resolve from the SUCCEEDED operation",
    );
    assert(
      duplicate.deliveryOperationId === operation.id,
      "Duplicate result did not retain its delivery operation id",
    );
    const duplicateOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: message.id },
    });
    assert(
      duplicateOperation.id === operation.id,
      "Retry changed the deterministic delivery operation id",
    );
    assert(duplicateOperation.attemptCount === 1, "Retry incremented the provider attempt count");
    assert(providerCalls === 1, "Duplicate delivery invoked the provider twice");
    const duplicateAuditCount = await prisma.auditLog.count({
      where: { tenantId: tenant.id, action: "channel.message.sent", entityId: message.id },
    });
    assert(duplicateAuditCount === 1, "Retry created a duplicate delivery audit");

    const ambiguousMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        externalMessageId: `ai-reply:${conversation.id}:ambiguous-${suffix}`,
        text: "Ambiguous provider delivery.",
        status: "QUEUED",
        metadata: { outboundStatus: "queued" },
      },
    });
    const ambiguousData: ChannelSendMessageJobData = {
      ...data,
      messageId: ambiguousMessage.id,
      triggerMessageId: `ambiguous-${suffix}`,
    };
    const ambiguousJobId = `channel-send-${ambiguousMessage.id}`;
    const initialAmbiguousDelivery = await processLeadVirtJob("channels.sendMessage", {
      id: ambiguousJobId,
      data: ambiguousData,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(
      hasRecord(initialAmbiguousDelivery),
      "Ambiguous setup delivery did not return an object result",
    );
    assert(initialAmbiguousDelivery.status === "sent", "Ambiguous setup delivery was not sent");

    const ambiguousOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: ambiguousMessage.id },
    });
    await prisma.$transaction([
      prisma.auditLog.deleteMany({
        where: {
          tenantId: tenant.id,
          action: "channel.message.sent",
          entityId: ambiguousMessage.id,
        },
      }),
      prisma.message.update({
        where: { id: ambiguousMessage.id },
        data: { status: "QUEUED", metadata: { outboundStatus: "queued" } },
      }),
      prisma.channelDeliveryOperation.update({
        where: { id: ambiguousOperation.id },
        data: {
          status: "STARTED",
          providerMessageId: null,
          result: { status: "provider_outcome_unconfirmed" },
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);

    const startedRetry = await processLeadVirtJob("channels.sendMessage", {
      id: ambiguousJobId,
      data: ambiguousData,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(startedRetry), "STARTED operation retry did not return an object result");
    assert(
      startedRetry.status === "reconciliation_required",
      `Expected reconciliation_required for STARTED operation, got ${String(startedRetry.status)}`,
    );
    const startedAfterRetry = await prisma.channelDeliveryOperation.findUniqueOrThrow({
      where: { id: ambiguousOperation.id },
    });
    assert(startedAfterRetry.status === "STARTED", "Retry changed the ambiguous STARTED operation");
    assert(
      startedAfterRetry.attemptCount === 1,
      "STARTED retry invoked the provider a second time",
    );

    await prisma.channelDeliveryOperation.update({
      where: { id: ambiguousOperation.id },
      data: {
        status: "UNKNOWN",
        result: { status: "unknown" },
        errorCode: "ADAPTER_OUTCOME_UNKNOWN",
        errorMessage: "simulated ambiguous provider timeout",
      },
    });
    const unknownRetry = await processLeadVirtJob("channels.sendMessage", {
      id: ambiguousJobId,
      data: ambiguousData,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(unknownRetry), "UNKNOWN operation retry did not return an object result");
    assert(
      unknownRetry.status === "reconciliation_required",
      `Expected reconciliation_required for UNKNOWN operation, got ${String(unknownRetry.status)}`,
    );

    const unknownOperation = await prisma.channelDeliveryOperation.findUniqueOrThrow({
      where: { id: ambiguousOperation.id },
    });
    assert(
      unknownOperation.status === "UNKNOWN",
      `Expected UNKNOWN operation, got ${unknownOperation.status}`,
    );
    assert(unknownOperation.attemptCount === 1, "UNKNOWN retry invoked the provider a second time");
    const unchangedMessage = await prisma.message.findUniqueOrThrow({
      where: { id: ambiguousMessage.id },
    });
    assert(
      unchangedMessage.status === "QUEUED",
      `Ambiguous delivery changed message to ${unchangedMessage.status}`,
    );
    const ambiguousAuditCount = await prisma.auditLog.count({
      where: { tenantId: tenant.id, action: "channel.message.sent", entityId: ambiguousMessage.id },
    });
    assert(ambiguousAuditCount === 0, "Ambiguous retry created a success audit");

    const [staleInbound, activeInbound] = await Promise.all([
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: "First customer request",
          status: "RECEIVED",
        },
      }),
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: "Newer customer request",
          status: "RECEIVED",
        },
      }),
    ]);
    const [staleReply, activeReply] = await Promise.all([
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "AI",
          text: "Obsolete reply",
          status: "QUEUED",
        },
      }),
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "AI",
          text: "Current reply",
          status: "QUEUED",
        },
      }),
    ]);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiReplySequence: 2, aiReplyFence: 2 },
    });
    const [staleRun] = await prisma.$transaction([
      prisma.aiReplyRun.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          inboundMessageId: staleInbound.id,
          replyMessageId: staleReply.id,
          idempotencyKey: `stale-delivery-${suffix}`,
          inputHash: `sha256:stale-${suffix}`,
          generation: 1,
          sequence: 1,
          status: "SUCCEEDED",
          attemptCount: 1,
          completedAt: new Date(),
        },
      }),
      prisma.aiReplyRun.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          inboundMessageId: activeInbound.id,
          replyMessageId: activeReply.id,
          idempotencyKey: `active-delivery-${suffix}`,
          inputHash: `sha256:active-${suffix}`,
          generation: 1,
          sequence: 2,
          status: "SUCCEEDED",
          attemptCount: 1,
          completedAt: new Date(),
        },
      }),
    ]);
    const staleDelivery = await processLeadVirtJob("channels.sendMessage", {
      id: `channel-send-${staleReply.id}`,
      data: {
        ...data,
        messageId: staleReply.id,
        triggerMessageId: staleInbound.id,
        aiReplyRunId: staleRun.id,
        aiReplyGeneration: staleRun.generation,
        aiReplySequence: staleRun.sequence,
      },
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(
      hasRecord(staleDelivery) && staleDelivery.status === "skipped",
      "Superseded AI reply was delivered.",
    );
    assert(
      staleDelivery.reason === "ai_reply_superseded",
      "Superseded delivery returned the wrong reason.",
    );
    assert(
      (await prisma.channelDeliveryOperation.count({ where: { messageId: staleReply.id } })) === 0,
      "Superseded reply created a provider delivery operation.",
    );

    const raceConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: `webhook:delivery-race:${suffix}`,
        status: "OPEN",
        subject: "Channel delivery fence race",
        aiEnabled: true,
        aiReplySequence: 1,
        aiReplyFence: 1,
      },
    });
    const raceInbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: raceConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Initial request before delivery race",
        status: "RECEIVED",
      },
    });
    const raceReply = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: raceConversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        text: "Reply whose provider call owns the fence lock",
        status: "QUEUED",
      },
    });
    const raceRun = await prisma.aiReplyRun.create({
      data: {
        tenantId: tenant.id,
        conversationId: raceConversation.id,
        inboundMessageId: raceInbound.id,
        replyMessageId: raceReply.id,
        idempotencyKey: `delivery-race-current-${suffix}`,
        inputHash: `sha256:delivery-race-current-${suffix}`,
        generation: 1,
        sequence: 1,
        status: "SUCCEEDED",
        attemptCount: 1,
        completedAt: new Date(),
      },
    });
    const raceData: ChannelSendMessageJobData = {
      ...data,
      conversationId: raceConversation.id,
      messageId: raceReply.id,
      triggerMessageId: raceInbound.id,
      aiReplyRunId: raceRun.id,
      aiReplyGeneration: raceRun.generation,
      aiReplySequence: raceRun.sequence,
    };

    const fenceLocked = deferred<void>();
    const releaseFenceCommit = deferred<void>();
    let fenceTransaction: Promise<void> | null = null;
    try {
      fenceTransaction = prisma.$transaction(async (tx) => {
        await tx.conversation.update({
          where: { id: raceConversation.id },
          data: { aiReplySequence: 2, aiReplyFence: 2 },
        });
        await tx.message.create({
          data: {
            tenantId: tenant.id,
            conversationId: raceConversation.id,
            direction: "INBOUND",
            senderType: "CUSTOMER",
            text: "Concurrent newer request",
            status: "RECEIVED",
          },
        });
        fenceLocked.resolve();
        await releaseFenceCommit.promise;
      });
      await fenceLocked.promise;

      let deliverySettled = false;
      const raceDeliveryPromise = processLeadVirtJob("channels.sendMessage", {
        id: `channel-send-${raceReply.id}`,
        data: raceData,
      } as Parameters<typeof processLeadVirtJob>[1]).finally(() => {
        deliverySettled = true;
      });

      let claimedOperation: ChannelDeliveryOperation | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        claimedOperation = await prisma.channelDeliveryOperation.findFirst({
          where: { messageId: raceReply.id },
        });
        if (claimedOperation?.status === "STARTED") break;
        await delay(50);
      }
      assert(
        claimedOperation?.status === "STARTED",
        "Delivery did not reach the locked final fence check.",
      );
      assert(!deliverySettled, "Delivery completed before the newer fence transaction committed.");

      releaseFenceCommit.resolve();
      await fenceTransaction;
      const blockedRaceDelivery = await raceDeliveryPromise;
      assert(
        hasRecord(blockedRaceDelivery) && blockedRaceDelivery.status === "skipped",
        "Committed newer fence did not stop the racing delivery.",
      );
      assert(
        blockedRaceDelivery.reason === "ai_reply_superseded" ||
          blockedRaceDelivery.reason === "ai_reply_automatic_reply_admission_revoked",
        `Racing stale delivery returned ${String(blockedRaceDelivery.reason)}.`,
      );
      const reconciledRaceOperation = await prisma.channelDeliveryOperation.findUniqueOrThrow({
        where: { id: claimedOperation.id },
      });
      assert(
        reconciledRaceOperation.status === "RECONCILED",
        "Stale claimed operation was not reconciled without provider delivery.",
      );
      assert(
        reconciledRaceOperation.providerMessageId === null,
        "Racing stale delivery recorded a provider message id.",
      );
      assert(
        hasRecord(reconciledRaceOperation.result) &&
          reconciledRaceOperation.result.status === "skipped",
        "Racing stale operation was not reconciled as skipped.",
      );
      assert(
        (await prisma.auditLog.count({
          where: { tenantId: tenant.id, action: "channel.message.sent", entityId: raceReply.id },
        })) === 0,
        "Racing stale delivery created a provider success audit.",
      );
    } finally {
      releaseFenceCommit.resolve();
      await fenceTransaction?.catch(() => undefined);
    }

    const disconnectRaceMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: raceConversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "This message must not cross a committed channel disconnect.",
        status: "QUEUED",
      },
    });
    const disconnectLocked = deferred<void>();
    const releaseDisconnectCommit = deferred<void>();
    const providerCallsBeforeDisconnect = providerCalls;
    let disconnectTransaction: Promise<void> | null = null;
    let disconnectDeliveryPromise: Promise<unknown> | null = null;
    try {
      disconnectTransaction = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "Conversation"
          WHERE "id" = ${raceConversation.id}
            AND "tenantId" = ${tenant.id}
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "Channel"
          WHERE "id" = ${channel.id}
            AND "tenantId" = ${tenant.id}
          FOR UPDATE
        `);
        await tx.channel.update({
          where: { id: channel.id },
          data: { status: "DISABLED" },
        });
        disconnectLocked.resolve();
        await releaseDisconnectCommit.promise;
      });
      await disconnectLocked.promise;

      let disconnectDeliverySettled = false;
      disconnectDeliveryPromise = processLeadVirtJob("channels.sendMessage", {
        id: `channel-send-${disconnectRaceMessage.id}`,
        data: {
          ...data,
          conversationId: raceConversation.id,
          messageId: disconnectRaceMessage.id,
          triggerMessageId: raceInbound.id,
          aiReplyRunId: null,
          aiReplyGeneration: null,
          aiReplySequence: null,
        },
      } as Parameters<typeof processLeadVirtJob>[1]).finally(() => {
        disconnectDeliverySettled = true;
      });

      await delay(200);
      assert(
        !disconnectDeliverySettled,
        "Delivery completed before the channel disconnect committed.",
      );

      releaseDisconnectCommit.resolve();
      await disconnectTransaction;
      const disconnectDelivery = await disconnectDeliveryPromise;
      assert(
        hasRecord(disconnectDelivery) &&
          disconnectDelivery.status === "skipped" &&
          disconnectDelivery.reason === "channel_not_active",
        "Committed channel disconnect did not stop the racing delivery.",
      );
      assert(
        providerCalls === providerCallsBeforeDisconnect,
        "A provider call started after the channel disconnect committed.",
      );
      const disconnectOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
        where: { messageId: disconnectRaceMessage.id },
      });
      const reconciledDisconnectOperation = await prisma.channelDeliveryOperation.findUniqueOrThrow(
        {
          where: { id: disconnectOperation.id },
        },
      );
      assert(
        reconciledDisconnectOperation.status === "RECONCILED" &&
          reconciledDisconnectOperation.providerMessageId === null,
        "Disconnected channel delivery was not reconciled without a provider result.",
      );
    } finally {
      releaseDisconnectCommit.resolve();
      await disconnectTransaction?.catch(() => undefined);
      await disconnectDeliveryPromise?.catch(() => undefined);
      await prisma.channel.update({ where: { id: channel.id }, data: { status: "ACTIVE" } });
    }

    const unconfiguredMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "This reply must not report a synthetic delivery.",
        status: "QUEUED",
      },
    });
    const unconfigured = await deliverChannelMessage(
      {
        ...data,
        messageId: unconfiguredMessage.id,
      },
      `channel-send-${unconfiguredMessage.id}`,
      undefined,
      {
        knowledgeRetriever: deliveryDependencies.knowledgeRetriever,
        groundedAnswer: deliveryDependencies.groundedAnswer,
        maxDeliveryAttempts: 3,
      },
    );
    assert(
      unconfigured.status === "failed" && unconfigured.reason === "webhook_target_missing",
      "An unconfigured webhook did not fail truthfully before network delivery.",
    );
    const unconfiguredOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: unconfiguredMessage.id },
    });
    assert(
      unconfiguredOperation.status === "FAILED" &&
        unconfiguredOperation.errorCode === "WEBHOOK_TARGET_MISSING" &&
        unconfiguredOperation.attemptCount === 1,
      "An unconfigured webhook was retried or persisted with the wrong outcome.",
    );

    let telegramProviderCalls = 0;
    const telegramAdapter: ChannelAdapter = {
      type: "TELEGRAM",
      normalizeInbound: async () => {
        throw new Error("Inbound normalization is not used by this smoke.");
      },
      sendMessage: async () => {
        telegramProviderCalls += 1;
        return { externalMessageId: "telegram:synthetic", status: "queued" };
      },
    };
    const telegramChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Unconfigured Telegram",
        externalId: `telegram-unconfigured-${suffix}`,
        publicKey: `demo-telegram-${suffix}`,
      },
    });
    const telegramConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: telegramChannel.id,
        externalConversationId: `telegram:${suffix}`,
        status: "OPEN",
        subject: "Unconfigured Telegram delivery",
      },
    });
    const telegramMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: telegramConversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "Never synthesize Telegram delivery.",
        status: "QUEUED",
      },
    });
    const telegramData: ChannelSendMessageJobData = {
      tenantId: tenant.id,
      conversationId: telegramConversation.id,
      messageId: telegramMessage.id,
      source: "telegram",
      requestedAt: new Date().toISOString(),
    };
    let missingTelegramError: unknown;
    try {
      await deliverChannelMessage(telegramData, `channel-send-${telegramMessage.id}`, undefined, {
        knowledgeRetriever: deliveryDependencies.knowledgeRetriever,
        groundedAnswer: deliveryDependencies.groundedAnswer,
        adapterFactory: () => telegramAdapter,
      });
    } catch (error) {
      missingTelegramError = error;
    }
    assert(
      missingTelegramError instanceof Error &&
        missingTelegramError.message === "telegram_credentials_missing",
      "Missing Telegram credentials did not fail deterministically.",
    );
    const failedTelegramMessage = await prisma.message.findUniqueOrThrow({
      where: { id: telegramMessage.id },
    });
    assert(
      failedTelegramMessage.status === "FAILED" && telegramProviderCalls === 0,
      "Missing Telegram credentials reached the adapter or reported success.",
    );
    assert(
      (await prisma.channelDeliveryOperation.count({
        where: { messageId: telegramMessage.id },
      })) === 0,
      "Missing Telegram credentials created a provider delivery operation.",
    );

    await prisma.channel.update({
      where: { id: telegramChannel.id },
      data: { encryptedCredentials: "invalid-credential-envelope" },
    });
    const invalidCredentialMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: telegramConversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "Never use invalid Telegram credentials.",
        status: "QUEUED",
      },
    });
    let invalidCredentialError: unknown;
    try {
      await deliverChannelMessage(
        { ...telegramData, messageId: invalidCredentialMessage.id },
        `channel-send-${invalidCredentialMessage.id}`,
        undefined,
        {
          knowledgeRetriever: deliveryDependencies.knowledgeRetriever,
          groundedAnswer: deliveryDependencies.groundedAnswer,
          adapterFactory: () => telegramAdapter,
        },
      );
    } catch (error) {
      invalidCredentialError = error;
    }
    assert(
      invalidCredentialError instanceof Error &&
        invalidCredentialError.message === "channel_credentials_invalid" &&
        telegramProviderCalls === 0,
      "Invalid Telegram credentials reached the adapter or used an unstable failure reason.",
    );
    const failedInvalidCredentialMessage = await prisma.message.findUniqueOrThrow({
      where: { id: invalidCredentialMessage.id },
    });
    assert(
      failedInvalidCredentialMessage.status === "FAILED" &&
        (await prisma.channelDeliveryOperation.count({
          where: { messageId: invalidCredentialMessage.id },
        })) === 0,
      "Invalid Telegram credentials created a provider operation or retained a queued message.",
    );

    const retryMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "Retry a temporary webhook rejection with the same operation.",
        status: "QUEUED",
      },
    });
    let retryProviderCalls = 0;
    const retryingAdapter: ChannelAdapter = {
      type: "WEBHOOK",
      normalizeInbound: fakeWebhookAdapter.normalizeInbound,
      sendMessage: async () => {
        retryProviderCalls += 1;
        throw new WebhookDeliveryError("WEBHOOK_HTTP_RETRYABLE", true, "FAILED", 503);
      },
    };
    const retryData = { ...data, messageId: retryMessage.id };
    let firstRetryError: unknown;
    try {
      await deliverChannelMessage(retryData, `channel-send-${retryMessage.id}`, undefined, {
        knowledgeRetriever: deliveryDependencies.knowledgeRetriever,
        groundedAnswer: deliveryDependencies.groundedAnswer,
        adapterFactory: () => retryingAdapter,
        maxDeliveryAttempts: 2,
      });
    } catch (error) {
      firstRetryError = error;
    }
    assert(
      firstRetryError instanceof WebhookDeliveryError &&
        firstRetryError.code === "WEBHOOK_HTTP_RETRYABLE",
      "A retryable webhook rejection did not ask the queue for another attempt.",
    );
    const releasedRetry = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: retryMessage.id },
    });
    assert(
      releasedRetry.status === "REQUESTED" &&
        releasedRetry.attemptCount === 1 &&
        releasedRetry.errorCode === "WEBHOOK_HTTP_RETRYABLE",
      "The retryable webhook operation was not released deterministically.",
    );
    const exhaustedRetry = await deliverChannelMessage(
      retryData,
      `channel-send-${retryMessage.id}`,
      undefined,
      {
        knowledgeRetriever: deliveryDependencies.knowledgeRetriever,
        groundedAnswer: deliveryDependencies.groundedAnswer,
        adapterFactory: () => retryingAdapter,
        maxDeliveryAttempts: 2,
      },
    );
    assert(
      exhaustedRetry.status === "failed" && exhaustedRetry.reason === "webhook_http_retryable",
      "An exhausted webhook retry did not settle as failed.",
    );
    const exhaustedOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: retryMessage.id },
    });
    assert(
      retryProviderCalls === 2 &&
        exhaustedOperation.status === "FAILED" &&
        exhaustedOperation.attemptCount === 2 &&
        exhaustedOperation.errorMessage === null,
      "The exhausted webhook retry count or safe terminal state is incorrect.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: message.id,
        deliveryOperationId: operation.id,
        ambiguousMessageId: ambiguousMessage.id,
        staleReplyBlocked: true,
        racingStaleReplyBlockedAfterFenceCommit: true,
        racingDeliveryBlockedAfterDisconnectCommit: true,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.channelDeliveryOperation.deleteMany({ where: { tenantId } });
      await prisma.aiReplyRun.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
