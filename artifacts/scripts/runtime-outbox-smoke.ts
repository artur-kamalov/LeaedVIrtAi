import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import {
  automaticReplyChannelFingerprint,
  createAiReplyQueueEvent,
  createRuntimeQueueEvent,
  parseRuntimeQueueEnvelope,
  RuntimeOutboxDispatcher,
  type RuntimeQueueEnvelope,
} from "@leadvirt/runtime-queue";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejected(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: "Runtime Outbox Smoke", slug: `runtime-outbox-${suffix}` },
  });
  const published: RuntimeQueueEnvelope[] = [];
  let failNext = true;
  const dispatcher = new RuntimeOutboxDispatcher(
    prisma,
    "redis://unused:6380",
    "runtime-outbox-smoke",
    1000,
    async (envelope) => {
      if (failNext) {
        failNext = false;
        throw new Error("simulated queue outage");
      }
      published.push(envelope);
    },
  );

  try {
    const event = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "conversation",
        aggregateId: `message-${suffix}`,
        aggregateVersion: 1,
        eventType: "ai.reply.requested",
        dedupeKey: `ai-reply:${suffix}`,
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "generate-reply",
          jobId: `ai-reply:${suffix}`,
          data: { tenantId: tenant.id, conversationId: `conversation-${suffix}` },
          attempts: 3,
          backoffMs: 1000,
        },
      }),
    );

    await dispatcher.dispatch(event.id).catch(() => undefined);
    const failed = await prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: event.id } });
    assert(
      failed.status === "FAILED",
      `Expected FAILED after queue outage, received ${failed.status}.`,
    );
    assert(failed.attemptCount === 1, "Failed publish did not increment attempt count.");

    await prisma.runtimeOutbox.update({
      where: { id: event.id },
      data: { availableAt: new Date() },
    });
    const retried = await dispatcher.dispatch(event.id);
    assert(retried.status === "published", `Expected published retry, received ${retried.status}.`);
    assert(
      published.length === 1,
      `Expected one successful queue publish, received ${published.length}.`,
    );
    assert(published[0]?.jobId === `ai-reply:${suffix}`, "Retry changed the stable BullMQ job id.");

    const duplicate = await dispatcher.dispatch(event.id);
    assert(
      duplicate.status === "already_published",
      `Expected already_published, received ${duplicate.status}.`,
    );
    assert(published.length === 1, "Published outbox event was sent twice.");

    const staleEvent = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "message",
        aggregateId: `outbound-${suffix}`,
        aggregateVersion: 1,
        eventType: "channels.send-message.requested",
        dedupeKey: `channel-send-${suffix}`,
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "send-message",
          jobId: `channel-send-${suffix}`,
          data: { tenantId: tenant.id, messageId: `outbound-${suffix}` },
          attempts: 3,
          backoffMs: 1000,
        },
      }),
    );
    await prisma.runtimeOutbox.update({
      where: { id: staleEvent.id },
      data: {
        status: "PUBLISHING",
        lockedBy: "crashed-worker",
        lockedAt: new Date(Date.now() - 60_000),
        lockExpiresAt: new Date(Date.now() - 30_000),
      },
    });
    const drained = await dispatcher.drain();
    assert(drained >= 1, "Stale publishing lease was not drained.");
    const recovered = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: staleEvent.id },
    });
    assert(recovered.status === "PUBLISHED", `Stale lease recovered as ${recovered.status}.`);
    assert(
      published.some((item) => item.jobId === `channel-send-${suffix}`),
      "Recovered event was not published.",
    );

    const mismatchEvent = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "conversation",
        aggregateId: `dedupe-${suffix}`,
        aggregateVersion: 1,
        eventType: "ai.reply.requested",
        dedupeKey: `dedupe-mismatch-${suffix}`,
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "generate-reply",
          jobId: `dedupe-mismatch-${suffix}`,
          data: { tenantId: tenant.id, conversationId: `original-${suffix}` },
          attempts: 3,
          backoffMs: 1000,
        },
      }),
    );
    const mismatchError = await rejected(
      prisma.$transaction((tx) =>
        createRuntimeQueueEvent(tx, {
          tenantId: tenant.id,
          aggregateType: "conversation",
          aggregateId: `dedupe-${suffix}`,
          aggregateVersion: 1,
          eventType: "ai.reply.requested",
          dedupeKey: `dedupe-mismatch-${suffix}`,
          envelope: {
            queueName: "channels.sendMessage",
            jobName: "generate-reply",
            jobId: `dedupe-mismatch-${suffix}`,
            data: { tenantId: tenant.id, conversationId: `changed-${suffix}` },
            attempts: 3,
            backoffMs: 1000,
          },
        }),
      ),
    );
    assert(mismatchError instanceof Error, "Dedupe-key reuse with a changed payload was accepted.");
    assert(
      mismatchError.message.includes("reused with different input"),
      "Dedupe mismatch returned an unrelated error.",
    );
    const unchangedMismatchEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: mismatchEvent.id },
    });
    const unchangedMismatchPayload = unchangedMismatchEvent.payload as Record<string, unknown>;
    const unchangedMismatchData = unchangedMismatchPayload.data as Record<string, unknown>;
    assert(
      unchangedMismatchData.conversationId === `original-${suffix}`,
      "Dedupe mismatch replaced the original payload.",
    );
    await prisma.runtimeOutbox.delete({ where: { id: mismatchEvent.id } });

    const malformedEvent = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "runtime-test",
        aggregateId: `malformed-${suffix}`,
        aggregateVersion: 1,
        eventType: "runtime.malformed",
        dedupeKey: `runtime-malformed-${suffix}`,
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "malformed",
          jobId: `runtime-malformed-${suffix}`,
          data: { tenantId: tenant.id },
          attempts: 1,
          backoffMs: 1000,
        },
      }),
    );
    await prisma.runtimeOutbox.update({
      where: { id: malformedEvent.id },
      data: {
        maxAttempts: 1,
        payload: {
          queueName: "unsupported.queue",
          jobName: "malformed",
          jobId: `runtime-malformed-${suffix}`,
          data: { tenantId: tenant.id },
          attempts: 1,
          backoffMs: 1000,
        },
      },
    });
    const malformedPublishCount = published.length;
    const malformedError = await rejected(dispatcher.dispatch(malformedEvent.id));
    assert(malformedError instanceof Error, "Malformed outbox payload did not reject dispatch.");
    const malformedTerminal = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: malformedEvent.id },
    });
    assert(
      malformedTerminal.status === "DEAD_LETTER",
      `Malformed event ended as ${malformedTerminal.status}.`,
    );
    assert(
      malformedTerminal.attemptCount === malformedTerminal.maxAttempts,
      "Malformed event ignored maxAttempts.",
    );
    assert(published.length === malformedPublishCount, "Malformed event reached the publisher.");

    const expiredEvent = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "runtime-test",
        aggregateId: `expired-${suffix}`,
        aggregateVersion: 1,
        eventType: "runtime.expired",
        dedupeKey: `runtime-expired-${suffix}`,
        deadlineAt: new Date(Date.now() - 1000),
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "expired",
          jobId: `runtime-expired-${suffix}`,
          data: { tenantId: tenant.id },
          attempts: 3,
          backoffMs: 1000,
        },
      }),
    );
    const expiredPublishCount = published.length;
    const expiredError = await rejected(dispatcher.dispatch(expiredEvent.id));
    assert(expiredError instanceof Error, "Expired outbox event did not reject dispatch.");
    const expiredTerminal = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: expiredEvent.id },
    });
    assert(
      expiredTerminal.status === "DEAD_LETTER",
      `Expired event ended as ${expiredTerminal.status}.`,
    );
    assert(
      expiredTerminal.lastErrorCode === "RuntimeOutboxDeadlineError",
      "Expired event lost its deadline error code.",
    );
    assert(published.length === expiredPublishCount, "Expired event reached the publisher.");

    const centralOpacityError = await rejected(
      prisma.$transaction((tx) =>
        createRuntimeQueueEvent(tx, {
          tenantId: tenant.id,
          aggregateType: "conversation",
          aggregateId: `central-trigger-${suffix}`,
          aggregateVersion: 1,
          eventType: "ai.reply.requested",
          dedupeKey: `ai-reply:central-conversation-${suffix}:central-trigger-${suffix}`,
          envelope: {
            queueName: "ai.reply",
            jobName: "generate-reply",
            jobId: `ai-reply:central-conversation-${suffix}:central-trigger-${suffix}`,
            data: {
              tenantId: tenant.id,
              conversationId: `central-conversation-${suffix}`,
              triggerMessageId: `central-trigger-${suffix}`,
              source: "worker-test",
              prompt: `central-opacity-canary:${suffix}`,
            },
            attempts: 3,
            backoffMs: 1000,
          },
        }),
      ),
    );
    assert(
      centralOpacityError instanceof Error &&
        centralOpacityError.message.includes("opaque persisted references"),
      "Generic runtime outbox accepted content-bearing ai.reply data.",
    );

    const opaqueChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Opaque queue channel",
        externalId: `opaque-bot-${suffix}`,
        publicKey: `opaque-queue-${suffix}`,
      },
    });
    const capabilitySetHash = "6".repeat(64);
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Runtime outbox fixture has no operational permission generation.",
    );
    const structuredPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash,
        operationalBindingSchemaVersion: operationalProjection.schemaVersion,
        operationalRegistryVersion: operationalProjection.registryVersion,
        operationalRegistryHash: operationalProjection.registryHash,
        operationalDependencySetHash: operationalProjection.dependencySetHash,
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
        pipelineVersion: "runtime-outbox-smoke-v1",
        retrievalPolicyVersion: "runtime-outbox-smoke-v1",
        promptPolicyVersion: "runtime-outbox-smoke-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const structuredPointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: structuredPublication.id,
        sequence: structuredPublication.sequence,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeCorpusSelector.create({
        data: {
          tenantId: tenant.id,
          corpusKind: "STRUCTURED_V2",
          generation: 2,
          migrationId: `runtime-outbox-migration-${suffix}`,
        },
      });
    });

    const rawCanary = `raw-ai-queue-canary:${suffix}:${randomUUID()}`;
    await prisma.channel.update({
      where: { id: opaqueChannel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: structuredPublication.id,
        automaticRepliesPublicationEtag: structuredPointer.etag,
        automaticRepliesCapabilitySetHash: capabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(opaqueChannel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: `runtime-outbox-actor-${suffix}`,
      },
    });
    const opaqueConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channelId: opaqueChannel.id,
        externalConversationId: `telegram:${suffix}`,
        status: "OPEN",
        aiEnabled: true,
      },
    });
    const opaqueInbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: opaqueConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: rawCanary,
        status: "RECEIVED",
      },
    });
    const identityEvent = await prisma.webhookEvent.create({
      data: {
        tenantId: tenant.id,
        provider: `telegram:${opaqueChannel.id}`,
        externalEventId: `opaque-event:${suffix}`,
        payloadHash: "4".repeat(64),
        payload: { kind: "opaque-queue-proof" },
      },
    });
    const persistedIdentity = await prisma.authenticatedCustomerIdentity.create({
      data: {
        tenantId: tenant.id,
        channelId: opaqueChannel.id,
        conversationId: opaqueConversation.id,
        messageId: opaqueInbound.id,
        webhookEventId: identityEvent.id,
        provider: "TELEGRAM",
        authenticationMethod: "TELEGRAM_WEBHOOK_SECRET",
        subjectSource: "TELEGRAM_MESSAGE_FROM_ID",
        conversationType: "PRIVATE",
        subjectHash: "2".repeat(64),
        channelBindingHash: "3".repeat(64),
        eventPayloadHash: "4".repeat(64),
        attestationHash: "5".repeat(64),
        authenticatedAt: identityEvent.receivedAt,
      },
    });
    const mismatchedText = await rejected(
      prisma.$transaction((tx) =>
        createAiReplyQueueEvent(tx, {
          tenantId: tenant.id,
          conversationId: opaqueConversation.id,
          triggerMessageId: opaqueInbound.id,
          text: `${rawCanary}:changed`,
          source: "telegram",
        }),
      ),
    );
    assert(
      mismatchedText instanceof Error &&
        mismatchedText.message.includes("persisted inbound message"),
      "AI reply enqueue accepted text that differed from the persisted inbound row.",
    );

    const opaqueQueued = await prisma.$transaction((tx) =>
      createAiReplyQueueEvent(tx, {
        tenantId: tenant.id,
        conversationId: opaqueConversation.id,
        triggerMessageId: opaqueInbound.id,
        text: rawCanary,
        source: "telegram",
      }),
    );
    assert(
      opaqueQueued.created,
      `Opaque AI queue fixture did not satisfy automatic admission: ${opaqueQueued.reason}.`,
    );
    const storedEnvelope = parseRuntimeQueueEnvelope(opaqueQueued.event.payload);
    const expectedIdentity = {
      id: persistedIdentity.id,
      version: 1,
      subjectHash: persistedIdentity.subjectHash,
      attestationHash: persistedIdentity.attestationHash,
    };
    assert(
      !JSON.stringify(opaqueQueued.event.payload).includes(rawCanary),
      "Runtime outbox payload retained raw inbound text.",
    );
    assert(
      !JSON.stringify(storedEnvelope).includes(rawCanary),
      "Runtime queue envelope retained raw inbound text.",
    );
    assert(
      storedEnvelope.data.tenantId === tenant.id &&
        storedEnvelope.data.conversationId === opaqueConversation.id &&
        storedEnvelope.data.triggerMessageId === opaqueInbound.id &&
        storedEnvelope.data.source === "telegram",
      "Opaque AI queue envelope lost its exact aggregate identifiers.",
    );
    assert(
      JSON.stringify(storedEnvelope.data.customerIdentity) === JSON.stringify(expectedIdentity),
      "Opaque AI queue envelope lost its DB-derived customer identity.",
    );
    assert(
      !("text" in storedEnvelope.data) &&
        !("businessName" in storedEnvelope.data) &&
        !("receivedAt" in storedEnvelope.data),
      "Opaque AI queue envelope retained producer content or rehydratable metadata.",
    );

    const opaquePublishIndex = published.length;
    await dispatcher.dispatch(opaqueQueued.event.id);
    const publishedOpaque = published[opaquePublishIndex];
    assert(publishedOpaque, "Opaque AI reply event was not published.");
    assert(
      !JSON.stringify(publishedOpaque.data).includes(rawCanary),
      "Published BullMQ job data retained raw inbound text.",
    );
    assert(
      publishedOpaque.data.tenantId === tenant.id &&
        publishedOpaque.data.conversationId === opaqueConversation.id &&
        publishedOpaque.data.triggerMessageId === opaqueInbound.id &&
        JSON.stringify(publishedOpaque.data.customerIdentity) === JSON.stringify(expectedIdentity),
      "Published BullMQ job data lost its exact IDs or DB-derived identity.",
    );

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channelId: opaqueChannel.id,
        status: "OPEN",
        subject: "Terminal AI outbox",
        aiEnabled: true,
      },
    });
    const opaqueInboundSentinel = `opaque-runtime-outbox-${suffix}`;
    const inbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: opaqueInboundSentinel,
        status: "RECEIVED",
      },
    });
    const queuedAiReply = await prisma.$transaction((tx) =>
      createAiReplyQueueEvent(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        triggerMessageId: inbound.id,
        text: opaqueInboundSentinel,
        source: "webhook",
      }),
    );
    assert(
      queuedAiReply.created,
      `Terminal AI queue fixture did not satisfy automatic admission: ${queuedAiReply.reason}.`,
    );
    const queuedPayload = queuedAiReply.event.payload as {
      data?: Record<string, unknown>;
    };
    assert(
      queuedPayload.data !== undefined &&
        !Object.prototype.hasOwnProperty.call(queuedPayload.data, "text"),
      "AI reply RuntimeOutbox payload retained a text property.",
    );
    assert(
      !JSON.stringify(queuedAiReply.event.payload).includes(opaqueInboundSentinel),
      "AI reply RuntimeOutbox payload retained the inbound text.",
    );
    assert(
      queuedAiReply.run.publicationId === structuredPublication.id,
      "Structured AI reply run did not capture the active workspace-v2 publication.",
    );
    await prisma.runtimeOutbox.update({
      where: { id: queuedAiReply.event.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    const terminalAiPublishCount = published.length;
    const terminalAiError = await rejected(dispatcher.dispatch(queuedAiReply.event.id));
    assert(terminalAiError instanceof Error, "Expired AI reply event did not reject dispatch.");
    const terminalAiEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: queuedAiReply.event.id },
    });
    const terminalAiRun = await prisma.aiReplyRun.findUniqueOrThrow({
      where: { id: queuedAiReply.run.id },
    });
    assert(
      terminalAiEvent.status === "DEAD_LETTER",
      `Terminal AI event ended as ${terminalAiEvent.status}.`,
    );
    assert(
      terminalAiRun.status === "DEAD_LETTER",
      `Terminal AI run ended as ${terminalAiRun.status}.`,
    );
    assert(
      terminalAiRun.errorCode === "RuntimeOutboxDeadlineError",
      "Terminal AI run lost the outbox error code.",
    );
    assert(published.length === terminalAiPublishCount, "Terminal AI event reached the publisher.");

    console.log(
      JSON.stringify({
        ok: true,
        eventId: event.id,
        attempts: failed.attemptCount + 1,
        stableJobId: retried.jobId,
        staleLeaseRecovered: true,
        dedupeMismatchRejected: true,
        malformedDeadLettered: true,
        expiredDeadLettered: true,
        centralAiReplyOpacityEnforced: true,
        rawAiQueueTextRejected: true,
        opaqueAiQueuePayload: true,
        dbDerivedCustomerIdentity: true,
        aiReplyDeadLetterPropagated: true,
        structuredPublicationCaptured: true,
      }),
    );
  } finally {
    await dispatcher.close();
    await prisma.runtimeInbox.deleteMany({ where: { tenantId: tenant.id } }).catch(() => undefined);
    await prisma.runtimeOutbox
      .deleteMany({ where: { tenantId: tenant.id } })
      .catch(() => undefined);
    await prisma.aiReplyRun.deleteMany({ where: { tenantId: tenant.id } }).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
