import { randomUUID } from "node:crypto";
import { MockAiProvider } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  KnowledgeRetriever,
  loadKnowledgeOperationalCapabilityProjectionV1,
  type KnowledgeRuntimeConfig,
} from "@leadvirt/knowledge";
import { automaticReplyChannelFingerprint, createAiReplyQueueEvent } from "@leadvirt/runtime-queue";
import type { AiReplyEnqueueRequest, AiReplyJobData } from "@leadvirt/types";
import {
  AiReplyFenceError,
  beginAiReplyAttempt,
  markAiReplyAttemptFailed,
  withFencedAiReplyTransaction,
} from "../../apps/worker/src/ai/ai-reply-reliability.js";
import { runAiReplyGraph } from "../../apps/worker/src/ai/ai-reply-graph.js";
import { executeAiToolCalls, type AiToolCall } from "../../apps/worker/src/ai/ai-tools.js";
import { processLeadVirtJob } from "../../apps/worker/src/processors/processor-registry.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function opaqueAiReplyData(payload: unknown): AiReplyJobData {
  assert(isRecord(payload) && isRecord(payload.data), "AI reply outbox envelope has no job data.");
  const data = payload.data;
  assert(!("text" in data), "AI reply outbox persisted plaintext message text.");
  assert(typeof data.tenantId === "string", "Opaque AI reply job has no tenant id.");
  assert(typeof data.conversationId === "string", "Opaque AI reply job has no conversation id.");
  assert(typeof data.triggerMessageId === "string", "Opaque AI reply job has no trigger id.");
  assert(typeof data.source === "string", "Opaque AI reply job has no source.");
  return data as unknown as AiReplyJobData;
}

const knowledgeConfig: KnowledgeRuntimeConfig = {
  mode: "database",
  qdrantUrl: "http://localhost:6333",
  qdrantCollection: "leadvirt_knowledge",
  qdrantTimeoutMs: 1_000,
  minScore: 0.05,
  candidateLimit: 20,
  targetKey: "workspace",
};

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "AI Reliability Smoke",
        slug: `ai-reliability-${suffix}`,
        businessType: "services",
      },
    });
    tenantId = tenant.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "AI reliability channel",
        publicKey: `ai-reliability-${suffix}`,
      },
    });
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "AI reliability authorization generation is missing.",
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
        tenantId,
        capabilityType: "GENERAL_FAQ",
        enabled: true,
        allowedAutonomy: "PROPOSE_ACTION",
        templateKey: "ai-reply-reliability-general-faq-v1",
      },
    });
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        pipelineVersion: "ai-reply-reliability-smoke-v1",
        retrievalPolicyVersion: "ai-reply-reliability-smoke-v1",
        promptPolicyVersion: "ai-reply-reliability-smoke-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const validation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId,
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
        validationPolicyVersion: "ai-reply-reliability-smoke-v1",
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId,
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
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        publicationId: publication.id,
        sequence: publication.sequence,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeCorpusSelector.create({
        data: {
          tenantId,
          corpusKind: "STRUCTURED_V2",
          generation: 2,
          migrationId: `ai-reply-reliability-migration-${suffix}`,
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
        automaticRepliesActivatedByUserId: `ai-reliability-actor-${suffix}`,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        name: "Reliability Lead",
        source: "worker-smoke",
        channelType: "WEBSITE",
        status: "NEW",
        temperature: "WARM",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "Reliability fencing",
        aiEnabled: true,
      },
    });
    const firstInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Hello, I need help choosing a service.",
        status: "RECEIVED",
      },
    });
    const firstRequest: AiReplyEnqueueRequest = {
      tenantId,
      conversationId: conversation.id,
      triggerMessageId: firstInbound.id,
      text: firstInbound.text ?? "",
      source: "webhook",
    };
    const retriever = new KnowledgeRetriever(prisma, knowledgeConfig);
    const provider = new MockAiProvider();
    const queued = await prisma.$transaction((tx) => createAiReplyQueueEvent(tx, firstRequest));
    assert(queued.created, "Initial AI reply fixture did not satisfy automatic admission.");
    const firstData = opaqueAiReplyData(queued.event.payload);
    assert(
      !JSON.stringify(queued.event.payload).includes(firstRequest.text),
      "AI reply outbox envelope contains the inbound plaintext.",
    );
    const trackedFirstData = {
      ...firstData,
      runtimeEventId: queued.event.id,
      runtimeGeneration: queued.event.generation,
    };
    const [runCountBeforePlaintextJob, usageCountBeforePlaintextJob] = await Promise.all([
      prisma.aiReplyRun.count({ where: { tenantId } }),
      prisma.aiUsageLog.count({ where: { tenantId } }),
    ]);
    const forbiddenJobs = [
      { label: "untracked job", data: firstData },
      { label: "legacy text", data: { ...trackedFirstData, text: firstRequest.text } },
      { label: "alternate prompt", data: { ...trackedFirstData, prompt: firstRequest.text } },
      {
        label: "identity attachment",
        data: {
          ...trackedFirstData,
          customerIdentity: {
            id: "identity-proof",
            version: 1,
            subjectHash: "0".repeat(64),
            attestationHash: "1".repeat(64),
            messageText: firstRequest.text,
          },
        },
      },
    ];
    for (const forbidden of forbiddenJobs) {
      let rejected = false;
      try {
        processLeadVirtJob("ai.reply", {
          id: `forbidden-${forbidden.label.replace(/\s+/g, "-")}-${suffix}`,
          data: forbidden.data,
        } as never);
      } catch (error) {
        rejected = error instanceof Error && error.message === "Invalid ai.reply job data.";
      }
      assert(rejected, `Worker accepted forbidden ${forbidden.label} AI reply job data.`);
    }
    const [runCountAfterPlaintextJob, usageCountAfterPlaintextJob] = await Promise.all([
      prisma.aiReplyRun.count({ where: { tenantId } }),
      prisma.aiUsageLog.count({ where: { tenantId } }),
    ]);
    assert(
      runCountAfterPlaintextJob === runCountBeforePlaintextJob &&
        usageCountAfterPlaintextJob === usageCountBeforePlaintextJob,
      "Rejected content-bearing job entered graph or provider processing.",
    );
    const mismatchedConversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "Mismatched trigger guard",
        aiEnabled: true,
      },
    });
    let mismatchedTriggerRejected = false;
    try {
      await beginAiReplyAttempt({
        ...firstData,
        conversationId: mismatchedConversation.id,
      });
    } catch (error) {
      mismatchedTriggerRejected =
        error instanceof AiReplyFenceError && error.code === "AI_REPLY_INBOUND_NOT_FOUND";
    }
    assert(
      mismatchedTriggerRejected,
      "Worker accepted a trigger message from a different conversation.",
    );
    const mutableConversation = await prisma.conversation.create({
      data: {
        tenantId,
        channelId: channel.id,
        status: "OPEN",
        subject: "Mutable trigger guard",
        aiEnabled: true,
      },
    });
    const mutableInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: mutableConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Original immutable input",
        status: "RECEIVED",
      },
    });
    const mutableQueued = await prisma.$transaction((tx) =>
      createAiReplyQueueEvent(tx, {
        tenantId,
        conversationId: mutableConversation.id,
        triggerMessageId: mutableInbound.id,
        text: mutableInbound.text ?? "",
        source: "worker-test",
      }),
    );
    assert(mutableQueued.created, "Mutable trigger fixture did not satisfy automatic admission.");
    const mutableAttempt = await beginAiReplyAttempt(
      opaqueAiReplyData(mutableQueued.event.payload),
    );
    assert(mutableAttempt.disposition === "active", "Mutable trigger run was not active.");
    await prisma.message.update({
      where: { id: mutableInbound.id },
      data: { text: "Changed after hydration" },
    });
    let mutableTriggerRejected = false;
    try {
      await withFencedAiReplyTransaction(mutableAttempt.attempt, async () => undefined);
    } catch (error) {
      mutableTriggerRejected =
        error instanceof AiReplyFenceError && error.code === "AI_REPLY_RUN_SUPERSEDED";
    }
    assert(mutableTriggerRejected, "Commit fence accepted changed inbound text.");

    const staleConversation = await prisma.conversation.create({
      data: {
        tenantId,
        channelId: channel.id,
        status: "OPEN",
        subject: "Stale trigger guard",
        aiEnabled: true,
      },
    });
    const staleInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: staleConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Older input",
        status: "RECEIVED",
      },
    });
    await prisma.message.create({
      data: {
        tenantId,
        conversationId: staleConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Newer input",
        status: "RECEIVED",
        createdAt: new Date(staleInbound.createdAt.getTime() + 1),
      },
    });
    let staleTriggerRejected = false;
    try {
      await beginAiReplyAttempt({
        tenantId,
        conversationId: staleConversation.id,
        triggerMessageId: staleInbound.id,
        source: "worker-test",
      });
    } catch (error) {
      staleTriggerRejected =
        error instanceof AiReplyFenceError && error.code === "AI_REPLY_NEWER_INBOUND";
    }
    assert(staleTriggerRejected, "Run recovery accepted an inbound superseded by a newer message.");

    const first = await runAiReplyGraph({
      data: firstData,
      jobId: `first-job-${suffix}`,
      aiProvider: provider,
      knowledgeRetriever: retriever,
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "OPEN", handoffRequested: false },
    });
    const duplicate = await runAiReplyGraph({
      data: firstData,
      jobId: `different-retry-job-${suffix}`,
      aiProvider: provider,
      knowledgeRetriever: retriever,
    });
    assert(first.status === "processed", "Initial reply was not committed.");
    assert(
      first.graphRunId === `langgraph:${queued.run.id}`,
      "Worker did not claim the preallocated QUEUED run.",
    );
    assert(
      duplicate.status === "duplicate" && duplicate.messageId === first.messageId,
      "Duplicate input created another reply.",
    );
    assert(
      (await prisma.message.count({
        where: { tenantId, conversationId: conversation.id, direction: "OUTBOUND" },
      })) === 1,
      "Duplicate retry created more than one outbound message.",
    );
    assert(
      (await prisma.leadEvent.count({
        where: { tenantId, leadId: lead.id, type: "ai_tool_note" },
      })) === 0,
      "Knowledge-unavailable handoff executed an AI tool side effect.",
    );
    assert(
      first.handoffRequired === true && first.qualityPassed === false,
      "Knowledge-unavailable reply did not fail closed to handoff.",
    );
    const deliveryOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: { tenantId, dedupeKey: `channels.send-message:${first.messageId}:v1` },
      },
    });
    const deliveryEnvelope = deliveryOutbox.payload as Record<string, unknown>;
    assert(
      deliveryOutbox.eventType === "channels.send-message.requested",
      "Final commit omitted the delivery outbox event.",
    );
    assert(
      deliveryEnvelope.queueName === "channels.sendMessage",
      "Delivery outbox payload is not a runtime queue envelope.",
    );
    assert(
      deliveryEnvelope.jobId === `channel-send-${first.messageId}`,
      "Delivery outbox job identity is not deterministic.",
    );

    const retryInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "This message will be retried.",
        status: "RECEIVED",
      },
    });
    const retryData: AiReplyJobData = {
      ...firstData,
      triggerMessageId: retryInbound.id,
    };
    const initialRetryAttempt = await beginAiReplyAttempt(retryData);
    assert(initialRetryAttempt.disposition === "active", "Retry test run was not allocated.");
    assert(
      initialRetryAttempt.input.inputText === retryInbound.text &&
        initialRetryAttempt.input.businessName === tenant.name &&
        initialRetryAttempt.input.businessType === tenant.businessType &&
        initialRetryAttempt.input.leadId === lead.id &&
        initialRetryAttempt.input.leadStatus === lead.status &&
        initialRetryAttempt.input.receivedAt.getTime() === retryInbound.createdAt.getTime(),
      "Worker did not hydrate the active input from the locked database snapshot.",
    );
    await markAiReplyAttemptFailed(initialRetryAttempt.attempt, "simulated retry", false);
    const retried = await beginAiReplyAttempt(retryData);
    assert(
      retried.disposition === "active" && retried.attempt.attemptCount === 2,
      "Retry did not advance attemptCount.",
    );

    const graphRunId = `langgraph:${retried.attempt.runId}`;
    const noteCall: AiToolCall = {
      id: `${graphRunId}:retry-note`,
      type: "lead.note.create",
      input: {
        leadId: lead.id,
        title: "Idempotent retry note",
        message: "This side effect must exist once.",
      },
    };
    const taskCall: AiToolCall = {
      id: `${graphRunId}:retry-task`,
      type: "task.create",
      input: { leadId: lead.id, title: "Idempotent retry task", priority: "HIGH" },
    };
    const bookingCall: AiToolCall = {
      id: `${graphRunId}:retry-booking`,
      type: "booking.proposal.create",
      input: {
        leadId: lead.id,
        title: "Idempotent retry booking",
        startsAt: "2026-08-01T10:00:00.000Z",
      },
    };
    const statusCall: AiToolCall = {
      id: `${graphRunId}:retry-status`,
      type: "lead.status.change",
      input: { leadId: lead.id, status: "QUALIFIED", reason: "Idempotent retry status" },
    };
    const executeInput = {
      tenantId,
      graphRunId,
      conversationId: conversation.id,
      calls: [noteCall, taskCall, bookingCall, statusCall],
      attempt: retried.attempt,
    };
    await executeAiToolCalls(executeInput);
    await executeAiToolCalls(executeInput);
    assert(
      (await prisma.leadEvent.count({
        where: { tenantId, leadId: lead.id, title: "Idempotent retry note" },
      })) === 1,
      "The deterministic external-operation ledger allowed a duplicate note.",
    );
    assert(
      (await prisma.task.count({
        where: { tenantId, leadId: lead.id, title: "Idempotent retry task" },
      })) === 0,
      "Autonomy policy allowed an unconfirmed task commit.",
    );
    assert(
      (await prisma.booking.count({
        where: { tenantId, leadId: lead.id, title: "Idempotent retry booking" },
      })) === 1,
      "The deterministic external-operation ledger allowed a duplicate booking.",
    );
    assert(
      (await prisma.leadEvent.count({
        where: {
          tenantId,
          leadId: lead.id,
          type: "ai_tool_status_changed",
          message: "Idempotent retry status",
        },
      })) === 0,
      "Autonomy policy allowed an unconfirmed status commit.",
    );
    assert(
      (await prisma.externalOperation.count({
        where: { tenantId, aiReplyRunId: retried.attempt.runId },
      })) === 2,
      "The retry produced an unexpected number of operation ledger rows.",
    );
    const ambiguousOperation = await prisma.externalOperation.findFirstOrThrow({
      where: {
        tenantId,
        aiReplyRunId: retried.attempt.runId,
        operationKind: "booking.proposal.create",
      },
    });
    await prisma.externalOperation.update({
      where: { id: ambiguousOperation.id },
      data: { status: "UNKNOWN", completedAt: null },
    });
    let ambiguousBlocked = false;
    try {
      await executeAiToolCalls({ ...executeInput, calls: [bookingCall] });
    } catch (error) {
      ambiguousBlocked =
        error instanceof AiReplyFenceError && error.code === "AI_EXTERNAL_OPERATION_AMBIGUOUS";
    }
    assert(ambiguousBlocked, "An ambiguous operation was executed again without reconciliation.");
    assert(
      (await prisma.booking.count({
        where: { tenantId, leadId: lead.id, title: "Idempotent retry booking" },
      })) === 1,
      "An ambiguous retry duplicated its booking proposal.",
    );

    const newerInbound = await prisma.message.create({
      data: {
        id: `${retryInbound.id}z`,
        tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "This newer message owns the reply fence.",
        status: "RECEIVED",
        createdAt: retryInbound.createdAt,
      },
    });
    const staleTask: AiToolCall = {
      id: `${graphRunId}:stale-task`,
      type: "task.create",
      input: { leadId: lead.id, title: "Stale task must not exist", priority: "HIGH" },
    };
    const staleReplyExternalId = `stale-reply-${suffix}`;
    let finalFenced = false;
    try {
      await withFencedAiReplyTransaction(retried.attempt, (tx) =>
        tx.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            direction: "OUTBOUND",
            senderType: "AI",
            externalMessageId: staleReplyExternalId,
            text: "Stale reply must not exist.",
            status: "SENT",
          },
        }),
      );
    } catch (error) {
      finalFenced = error instanceof AiReplyFenceError && error.code === "AI_REPLY_NEWER_INBOUND";
    }
    assert(
      finalFenced,
      "A persisted but unallocated newer inbound did not reject the older final commit.",
    );
    assert(
      (await prisma.message.count({
        where: { tenantId, externalMessageId: staleReplyExternalId },
      })) === 0,
      "A stale final reply escaped its fenced transaction.",
    );
    let fenced = false;
    try {
      await executeAiToolCalls({ ...executeInput, calls: [staleTask] });
    } catch (error) {
      fenced =
        error instanceof AiReplyFenceError &&
        (error.code === "AI_REPLY_RUN_SUPERSEDED" || error.code === "AI_REPLY_NEWER_INBOUND");
    }
    assert(fenced, "The superseded run was still allowed to enter a tool transaction.");
    assert(
      (await prisma.task.count({
        where: { tenantId, leadId: lead.id, title: "Stale task must not exist" },
      })) === 0,
      "A superseded run committed a task side effect.",
    );
    const staleRun = await prisma.aiReplyRun.findUniqueOrThrow({
      where: { id: retried.attempt.runId },
    });
    assert(
      staleRun.status === "SUPERSEDED",
      "The later-inbound defense did not mark the older run SUPERSEDED.",
    );

    const newer = await beginAiReplyAttempt({
      ...retryData,
      triggerMessageId: newerInbound.id,
    });
    assert(newer.disposition === "active", "Newer run was not allocated.");
    const fencedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    assert(
      fencedConversation.aiReplyFence === newer.attempt.sequence,
      "The newest sequence does not own the conversation fence.",
    );

    const retryGuardConversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "Retry ordering guard",
        aiEnabled: true,
      },
    });
    const orderingTime = new Date();
    const orderingInbound = await prisma.message.create({
      data: {
        id: `ordering-old-${suffix}`,
        tenantId,
        conversationId: retryGuardConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Older retry input.",
        status: "RECEIVED",
        createdAt: orderingTime,
      },
    });
    const orderingData: AiReplyJobData = {
      ...firstData,
      conversationId: retryGuardConversation.id,
      triggerMessageId: orderingInbound.id,
    };
    const orderingAttempt = await beginAiReplyAttempt(orderingData);
    assert(orderingAttempt.disposition === "active", "Ordering retry run was not allocated.");
    await markAiReplyAttemptFailed(orderingAttempt.attempt, "simulated retry", false);
    await prisma.message.create({
      data: {
        id: `${orderingInbound.id}z`,
        tenantId,
        conversationId: retryGuardConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Newer unallocated input.",
        status: "RECEIVED",
        createdAt: orderingTime,
      },
    });
    const rejectedRetry = await beginAiReplyAttempt(orderingData);
    assert(
      rejectedRetry.disposition === "superseded",
      "Retry begin ignored a later persisted inbound message.",
    );
    const rejectedRetryRun = await prisma.aiReplyRun.findUniqueOrThrow({
      where: { id: orderingAttempt.attempt.runId },
    });
    assert(
      rejectedRetryRun.attemptCount === 1,
      "Rejected stale retry incorrectly consumed another attempt.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        tenantId,
        replyRunId: initialRetryAttempt.attempt.runId,
        retryAttemptCount: retried.attempt.attemptCount,
        supersededSequence: retried.attempt.sequence,
        activeSequence: newer.attempt.sequence,
        untrackedJobsRejected: true,
        changedTriggerTextRejected: true,
        staleRunRecoveryRejected: true,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.externalOperation.deleteMany({ where: { tenantId } });
      await prisma.runtimeOutbox.deleteMany({ where: { tenantId } });
      await prisma.aiReplyRun.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
