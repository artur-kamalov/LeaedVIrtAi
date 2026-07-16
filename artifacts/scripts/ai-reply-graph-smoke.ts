import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import { automaticReplyChannelFingerprint, createAiReplyQueueEvent } from "@leadvirt/runtime-queue";
import type { AiReplyJobData } from "@leadvirt/types";

loadEnvFile();
process.env.AI_PROVIDER = "mock";
process.env.AI_ENABLE_REAL_PROVIDER = "false";
process.env.RAG_RETRIEVAL_MODE = "database";

type ProcessLeadVirtJob =
  typeof import("../../apps/worker/src/processors/processor-registry.js").processLeadVirtJob;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const { processLeadVirtJob } =
    (await import("../../apps/worker/src/processors/processor-registry.js")) as {
      processLeadVirtJob: ProcessLeadVirtJob;
    };
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "AI Graph Smoke",
        slug: `ai-graph-smoke-${suffix}`,
        businessType: "salon",
        timezone: "Europe/Moscow",
      },
    });
    tenantId = tenant.id;

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "AI Graph Smoke Webhook",
        externalId: `ai-graph-smoke-${suffix}`,
        publicKey: `lvwh_ai_graph_smoke_${suffix.replace(/-/g, "_")}`,
      },
    });

    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "AI graph authorization generation is missing.",
    );
    const capabilitySetHash = "b".repeat(64);
    const requirementEvaluationSetHash = "c".repeat(64);
    const operationalBinding = {
      operationalBindingSchemaVersion: operationalProjection.schemaVersion,
      operationalRegistryVersion: operationalProjection.registryVersion,
      operationalRegistryHash: operationalProjection.registryHash,
      operationalDependencySetHash: operationalProjection.dependencySetHash,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
    };
    const capability = await prisma.knowledgeV2Capability.create({
      data: {
        tenantId: tenant.id,
        capabilityType: "GENERAL_FAQ",
        enabled: true,
        allowedAutonomy: "PROPOSE_ACTION",
        templateKey: "ai-reply-graph-general-faq-v1",
      },
    });
    const bookingCapability = await prisma.knowledgeV2Capability.create({
      data: {
        tenantId: tenant.id,
        capabilityType: "APPOINTMENT_BOOKING",
        enabled: true,
        allowedAutonomy: "PROPOSE_ACTION",
        templateKey: "ai-reply-graph-appointment-booking-v1",
      },
    });
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        pipelineVersion: "ai-reply-graph-smoke-v2",
        retrievalPolicyVersion: "ai-reply-graph-smoke-v2",
        promptPolicyVersion: "ai-reply-graph-smoke-v2",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const validation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        candidateId: "workspace-v2",
        candidateVersion: 1,
        candidateManifestHash: publication.manifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        validationPolicyVersion: "ai-reply-graph-smoke-v2",
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: capability.id,
        capabilityType: capability.capabilityType,
        allowedAutonomy: capability.allowedAutonomy,
        capabilityEtag: capability.etag,
        capabilitySnapshotHash: "d".repeat(64),
        requirementEvaluationSetHash: "e".repeat(64),
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: bookingCapability.id,
        capabilityType: bookingCapability.capabilityType,
        allowedAutonomy: bookingCapability.allowedAutonomy,
        capabilityEtag: bookingCapability.etag,
        capabilitySnapshotHash: "f".repeat(64),
        requirementEvaluationSetHash: "9".repeat(64),
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: publication.id,
        sequence: publication.sequence,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeCorpusSelector.create({
        data: {
          tenantId: tenant.id,
          corpusKind: "STRUCTURED_V2",
          generation: 2,
          migrationId: `ai-reply-graph-migration-${suffix}`,
        },
      });
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: publication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesCapabilitySetHash: capabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(channel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: `ai-graph-actor-${suffix}`,
      },
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "AI Graph Smoke Lead",
        source: "worker-smoke",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM",
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "AI graph smoke",
        aiEnabled: true,
      },
    });

    const inboundText =
      "I want to book a haircut for 2026-07-07T14:00:00.000Z. How much does it cost?";
    const inbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: `inbound-ai-graph-smoke-${suffix}`,
        text: inboundText,
        status: "RECEIVED",
      },
    });

    const request = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      triggerMessageId: inbound.id,
      text: inbound.text ?? "",
      source: "worker-test",
    } as const;

    const jobId = `ai-reply:${conversation.id}:${inbound.id}`;
    const queued = await prisma.$transaction((tx) => createAiReplyQueueEvent(tx, request));
    assert(queued.created, "AI graph fixture did not satisfy automatic reply admission.");
    assert(hasRecord(queued.event.payload), "AI graph outbox payload is not an envelope.");
    assert(hasRecord(queued.event.payload.data), "AI graph outbox envelope has no job data.");
    const data = queued.event.payload.data as unknown as AiReplyJobData;
    const trackedData = {
      ...data,
      runtimeEventId: queued.event.id,
      runtimeGeneration: queued.event.generation,
    };
    const result = await processLeadVirtJob("ai.reply", {
      id: jobId,
      data: trackedData,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(result), "AI graph did not return an object result");
    assert(
      result.status === "processed",
      `Expected processed result, got ${String(result.status)}`,
    );
    assert(typeof result.messageId === "string", "AI graph result has no message id");
    assert(typeof result.graphRunId === "string", "AI graph result has no graph run id");
    assert(Array.isArray(result.toolResults), "AI graph result has no tool results");
    assert(
      result.handoffRequired === true && result.qualityPassed === false,
      "Operational query without a configured structured runtime did not fail closed.",
    );
    assert(result.toolResults.length === 0, "Blocked operational query executed AI tools.");

    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    assert(message.senderType === "AI", "Created message is not an AI message");
    assert(
      message.status === "SENT",
      `Expected worker-test AI message status SENT, got ${message.status}`,
    );
    assert(hasRecord(message.metadata), "AI message metadata is not an object");
    assert(
      message.metadata.graphRunId === result.graphRunId,
      "AI message graphRunId metadata mismatch",
    );
    assert(
      message.metadata.outboundStatus === "sent",
      "AI message outboundStatus metadata mismatch",
    );
    assert(
      Array.isArray(message.metadata.retrievedContext),
      "AI message has no retrievedContext metadata",
    );
    const knowledgeRetrievalReason = hasRecord(message.metadata.knowledgeRetrieval)
      ? message.metadata.knowledgeRetrieval.reason
      : undefined;
    assert(
      message.metadata.retrievedContext.length === 0 &&
        knowledgeRetrievalReason === "RUNTIME_NOT_CONFIGURED",
      `Unavailable structured runtime did not persist the fail-closed reason (got ${String(knowledgeRetrievalReason)}).`,
    );
    assert(Array.isArray(message.metadata.toolResults), "AI message has no toolResults metadata");

    const usage = await prisma.aiUsageLog.findFirst({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        actionType: "langgraph_queued_reply",
      },
    });
    assert(usage, "AI graph did not create usage log");

    const booking = await prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: lead.id,
      },
    });
    assert(!booking, "Blocked operational query created a booking proposal.");

    const note = await prisma.leadEvent.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "ai_tool_note",
      },
    });
    assert(!note, "Blocked operational query created a tool note.");

    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert(
      updatedLead.status === "NEW",
      `Blocked operational query changed lead status to ${updatedLead.status}.`,
    );

    const duplicate = await processLeadVirtJob("ai.reply", {
      id: jobId,
      data: trackedData,
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(duplicate), "AI graph duplicate did not return an object result");
    assert(
      duplicate.status === "duplicate",
      `Expected duplicate result, got ${String(duplicate.status)}`,
    );

    const publicLead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "AI Graph Public Source Lead",
        source: "webhook",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM",
      },
    });
    const publicConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: publicLead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "AI graph public source smoke",
        aiEnabled: true,
      },
    });
    const publicInbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: publicConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: `inbound-ai-public-source-${suffix}`,
        text: "Need the haircut price",
        status: "RECEIVED",
      },
    });
    const publicRequest = {
      tenantId: tenant.id,
      conversationId: publicConversation.id,
      triggerMessageId: publicInbound.id,
      text: publicInbound.text ?? "",
      source: "webhook",
    } as const;
    const publicJobId = `ai-reply:${publicConversation.id}:${publicInbound.id}`;
    const publicQueued = await prisma.$transaction((tx) =>
      createAiReplyQueueEvent(tx, publicRequest),
    );
    assert(
      publicQueued.created,
      "AI graph public fixture did not satisfy automatic reply admission.",
    );
    assert(
      hasRecord(publicQueued.event.payload),
      "AI graph public outbox payload is not an envelope.",
    );
    assert(
      hasRecord(publicQueued.event.payload.data),
      "AI graph public outbox envelope has no job data.",
    );
    const publicData = publicQueued.event.payload.data as unknown as AiReplyJobData;
    const publicResult = await processLeadVirtJob("ai.reply", {
      id: publicJobId,
      data: {
        ...publicData,
        runtimeEventId: publicQueued.event.id,
        runtimeGeneration: publicQueued.event.generation,
      },
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(publicResult), "AI graph public source did not return an object result");
    assert(
      publicResult.status === "processed",
      `Expected public source processed result, got ${String(publicResult.status)}`,
    );
    assert(
      typeof publicResult.messageId === "string",
      "AI graph public source result has no message id",
    );
    const publicMessage = await prisma.message.findUniqueOrThrow({
      where: { id: publicResult.messageId },
    });
    assert(
      publicMessage.status === "QUEUED",
      `Expected public source AI message status QUEUED, got ${publicMessage.status}`,
    );
    assert(hasRecord(publicMessage.metadata), "Public source AI message metadata is not an object");
    assert(
      publicMessage.metadata.outboundStatus === "queued",
      "Public source outboundStatus metadata mismatch",
    );
    assert(
      typeof publicMessage.metadata.deliveryJobId === "string",
      "Public source deliveryJobId metadata missing",
    );
    assert(
      typeof publicMessage.metadata.deliveryOutboxId === "string",
      "Public source deliveryOutboxId metadata missing",
    );
    const deliveryEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: publicMessage.metadata.deliveryOutboxId },
    });
    assert(hasRecord(deliveryEvent.payload), "Delivery outbox payload is not an envelope");
    assert(
      deliveryEvent.payload.queueName === "channels.sendMessage",
      "Delivery outbox targets the wrong queue",
    );
    assert(hasRecord(deliveryEvent.payload.data), "Delivery outbox has no job data");
    assert(
      deliveryEvent.payload.data.messageId === publicMessage.id,
      "Delivery outbox lost the reply message id",
    );
    assert(
      typeof deliveryEvent.payload.data.aiReplySequence === "number",
      "Delivery outbox has no reply sequence fence",
    );

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: result.messageId,
        graphRunId: result.graphRunId,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.externalOperation.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.runtimeInbox.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.runtimeOutbox.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.channelDeliveryOperation
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await prisma.aiReplyRun.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
