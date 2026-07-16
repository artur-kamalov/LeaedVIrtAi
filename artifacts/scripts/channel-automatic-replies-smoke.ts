import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import {
  automaticReplyAdmissionReasons,
  automaticReplyChannelFingerprint,
  createAiReplyQueueEvent,
  createRuntimeQueueEvent,
  parseRuntimeQueueEnvelope,
  type CreateAiReplyQueueEventResult,
} from "@leadvirt/runtime-queue";
import type { AiReplyJobData } from "@leadvirt/types";
import { beginAiReplyAttempt } from "../../apps/worker/src/ai/ai-reply-reliability.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertRejected(
  result: CreateAiReplyQueueEventResult,
  reason: Exclude<CreateAiReplyQueueEventResult, { created: true }>["reason"],
) {
  assert(!result.created, `Expected ${reason}, but an AI reply was queued.`);
  assert(result.reason === reason, `Expected ${reason}, received ${result.reason}.`);
}

async function createConversationInbound(input: {
  tenantId: string;
  channelId: string;
  suffix: string;
  label: string;
  aiEnabled?: boolean;
  status?: "OPEN" | "CLOSED";
  handoffRequested?: boolean;
}) {
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      externalConversationId: `${input.label}-${input.suffix}`,
      status: input.status ?? "OPEN",
      ...(input.aiEnabled === undefined ? {} : { aiEnabled: input.aiEnabled }),
      handoffRequested: input.handoffRequested ?? false,
    },
  });
  const inbound = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: `${input.label}:${input.suffix}`,
      status: "RECEIVED",
    },
  });
  return { conversation, inbound };
}

async function enqueue(input: {
  tenantId: string;
  conversationId: string;
  inboundId: string;
  text: string | null;
}) {
  return prisma.$transaction((tx) =>
    createAiReplyQueueEvent(tx, {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      triggerMessageId: input.inboundId,
      text: input.text ?? "",
      source: "worker-test",
    }),
  );
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: "Automatic Reply Admission", slug: `automatic-reply-${suffix}` },
  });

  try {
    const firstCapabilitySetHash = "c".repeat(64);
    const baseSettings = { deliveryMode: "managed", webhookConfigured: true };
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Automatic reply channel",
        publicKey: `automatic-reply-${suffix}`,
        settings: baseSettings,
      },
    });
    const firstOperationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(
      prisma,
      { tenantId: tenant.id },
    );
    assert(
      firstOperationalProjection.permissionGeneration !== null,
      "Initial operational permission generation is missing.",
    );
    const firstOperationalBinding = {
      operationalBindingSchemaVersion: firstOperationalProjection.schemaVersion,
      operationalRegistryVersion: firstOperationalProjection.registryVersion,
      operationalRegistryHash: firstOperationalProjection.registryHash,
      operationalDependencySetHash: firstOperationalProjection.dependencySetHash,
      operationalBindingHash: firstOperationalProjection.bindingHash,
      operationalPermissionGeneration: firstOperationalProjection.permissionGeneration,
    };
    const firstPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash: firstCapabilitySetHash,
        requirementEvaluationSetHash: "d".repeat(64),
        ...firstOperationalBinding,
        pipelineVersion: "automatic-reply-smoke-v1",
        retrievalPolicyVersion: "automatic-reply-smoke-v1",
        promptPolicyVersion: "automatic-reply-smoke-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: firstPublication.id,
        sequence: firstPublication.sequence,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeCorpusSelector.create({
        data: {
          tenantId: tenant.id,
          corpusKind: "STRUCTURED_V2",
          generation: 2,
          migrationId: `automatic-reply-migration-${suffix}`,
        },
      });
    });

    const defaultDisabled = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "default-disabled",
    });
    const explicitConversationEnable = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "channel-disabled",
      aiEnabled: true,
    });
    const inboundCountBefore = await prisma.message.count({
      where: { tenantId: tenant.id, direction: "INBOUND" },
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: defaultDisabled.conversation.id,
        inboundId: defaultDisabled.inbound.id,
        text: defaultDisabled.inbound.text,
      }),
      automaticReplyAdmissionReasons.conversationAiDisabled,
    );
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: explicitConversationEnable.conversation.id,
        inboundId: explicitConversationEnable.inbound.id,
        text: explicitConversationEnable.inbound.text,
      }),
      automaticReplyAdmissionReasons.channelAutomationDisabled,
    );
    assert(
      (await prisma.message.count({ where: { tenantId: tenant.id, direction: "INBOUND" } })) ===
        inboundCountBefore,
      "Disabled automation removed or duplicated persisted inbound messages.",
    );
    assert(
      (await prisma.aiReplyRun.count({ where: { tenantId: tenant.id } })) === 0 &&
        (await prisma.runtimeOutbox.count({
          where: { tenantId: tenant.id, eventType: "ai.reply.requested" },
        })) === 0,
      "Disabled automation created an AI reply run or outbox event.",
    );

    const channelFingerprint = automaticReplyChannelFingerprint(channel);
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: firstPublication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesChannelFingerprint: channelFingerprint,
        automaticRepliesCapabilitySetHash: firstCapabilitySetHash,
        automaticRepliesOperationalBindingHash: firstOperationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration:
          firstOperationalProjection.permissionGeneration,
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: `actor-${suffix}`,
      },
    });

    const exact = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "exact-binding",
      aiEnabled: true,
    });
    const exactQueued = await enqueue({
      tenantId: tenant.id,
      conversationId: exact.conversation.id,
      inboundId: exact.inbound.id,
      text: exact.inbound.text,
    });
    if (!exactQueued.created) {
      throw new Error(`Exact binding was rejected as ${exactQueued.reason}.`);
    }
    assert(
      exactQueued.run.publicationId === firstPublication.id &&
        exactQueued.admission.publicationEtag === pointer.etag &&
        exactQueued.admission.channelFingerprint === channelFingerprint,
      "Queued run did not capture the exact activation binding.",
    );

    const fingerprintInput = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "fingerprint-change",
      aiEnabled: true,
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: { settings: { ...baseSettings, deliveryMode: "changed-after-activation" } },
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: fingerprintInput.conversation.id,
        inboundId: fingerprintInput.inbound.id,
        text: fingerprintInput.inbound.text,
      }),
      automaticReplyAdmissionReasons.channelFingerprintMismatch,
    );
    await prisma.channel.update({
      where: { id: channel.id },
      data: { settings: baseSettings, automaticRepliesChannelFingerprint: channelFingerprint },
    });

    const etagInput = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "publication-etag-change",
      aiEnabled: true,
    });
    await prisma.activeKnowledgePublication.update({
      where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      data: { etag: { increment: 1 } },
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: etagInput.conversation.id,
        inboundId: etagInput.inbound.id,
        text: etagInput.inbound.text,
      }),
      automaticReplyAdmissionReasons.publicationBindingMismatch,
    );
    const publicationFence = await beginAiReplyAttempt(
      parseRuntimeQueueEnvelope(exactQueued.event.payload).data as unknown as AiReplyJobData,
    );
    assert(
      publicationFence.disposition === "superseded",
      "Publication etag supersession did not fence the queued run.",
    );
    const publicationSupersededRun = await prisma.aiReplyRun.findUniqueOrThrow({
      where: { id: exactQueued.run.id },
    });
    assert(
      publicationSupersededRun.status === "SUPERSEDED" &&
        publicationSupersededRun.errorCode === "AUTOMATIC_REPLY_ADMISSION_REVOKED",
      "Publication supersession did not persist the queued-run revocation.",
    );

    const secondCapabilitySetHash = "e".repeat(64);
    const secondOperationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(
      prisma,
      { tenantId: tenant.id },
    );
    assert(
      secondOperationalProjection.permissionGeneration !== null,
      "Replacement operational permission generation is missing.",
    );
    const secondOperationalBinding = {
      operationalBindingSchemaVersion: secondOperationalProjection.schemaVersion,
      operationalRegistryVersion: secondOperationalProjection.registryVersion,
      operationalRegistryHash: secondOperationalProjection.registryHash,
      operationalDependencySetHash: secondOperationalProjection.dependencySetHash,
      operationalBindingHash: secondOperationalProjection.bindingHash,
      operationalPermissionGeneration: secondOperationalProjection.permissionGeneration,
    };
    const secondPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 2,
        status: "ACTIVE",
        manifestHash: "b".repeat(64),
        capabilitySetHash: secondCapabilitySetHash,
        requirementEvaluationSetHash: "f".repeat(64),
        ...secondOperationalBinding,
        pipelineVersion: "automatic-reply-smoke-v2",
        retrievalPolicyVersion: "automatic-reply-smoke-v2",
        promptPolicyVersion: "automatic-reply-smoke-v2",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const currentPointer = await prisma.activeKnowledgePublication.update({
      where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      data: {
        publicationId: secondPublication.id,
        sequence: secondPublication.sequence,
        etag: { increment: 1 },
      },
    });
    const publicationInput = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "publication-id-change",
      aiEnabled: true,
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: publicationInput.conversation.id,
        inboundId: publicationInput.inbound.id,
        text: publicationInput.inbound.text,
      }),
      automaticReplyAdmissionReasons.publicationBindingMismatch,
    );
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesGeneration: { increment: 1 },
        automaticRepliesPublicationId: secondPublication.id,
        automaticRepliesPublicationEtag: currentPointer.etag,
        automaticRepliesCapabilitySetHash: secondCapabilitySetHash,
        automaticRepliesOperationalBindingHash: secondOperationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration:
          secondOperationalProjection.permissionGeneration,
        automaticRepliesActivatedAt: new Date(),
      },
    });

    const closed = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "closed-conversation",
      aiEnabled: true,
      status: "CLOSED",
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: closed.conversation.id,
        inboundId: closed.inbound.id,
        text: closed.inbound.text,
      }),
      automaticReplyAdmissionReasons.conversationNotOpen,
    );
    const handoff = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "handoff-conversation",
      aiEnabled: true,
      handoffRequested: true,
    });
    assertRejected(
      await enqueue({
        tenantId: tenant.id,
        conversationId: handoff.conversation.id,
        inboundId: handoff.inbound.id,
        text: handoff.inbound.text,
      }),
      automaticReplyAdmissionReasons.conversationHandoffRequested,
    );

    const fenced = await createConversationInbound({
      tenantId: tenant.id,
      channelId: channel.id,
      suffix,
      label: "deactivation-fence",
      aiEnabled: true,
    });
    const fencedQueued = await enqueue({
      tenantId: tenant.id,
      conversationId: fenced.conversation.id,
      inboundId: fenced.inbound.id,
      text: fenced.inbound.text,
    });
    if (!fencedQueued.created) {
      throw new Error(`Fence fixture was rejected as ${fencedQueued.reason}.`);
    }
    const fencedEnvelope = parseRuntimeQueueEnvelope(fencedQueued.event.payload);
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesEnabled: false,
        automaticRepliesGeneration: { increment: 1 },
        automaticRepliesPublicationId: null,
        automaticRepliesPublicationEtag: null,
        automaticRepliesChannelFingerprint: null,
        automaticRepliesCapabilitySetHash: null,
        automaticRepliesOperationalBindingHash: null,
        automaticRepliesOperationalPermissionGeneration: null,
        automaticRepliesActivatedAt: null,
        automaticRepliesActivatedByUserId: null,
      },
    });
    const begun = await beginAiReplyAttempt(fencedEnvelope.data as unknown as AiReplyJobData);
    assert(begun.disposition === "superseded", "Deactivation did not fence the queued run.");
    const superseded = await prisma.aiReplyRun.findUniqueOrThrow({
      where: { id: fencedQueued.run.id },
    });
    assert(
      superseded.status === "SUPERSEDED" &&
        superseded.errorCode === "AUTOMATIC_REPLY_ADMISSION_REVOKED",
      "Fenced run did not persist the automatic-admission revocation.",
    );

    const manual = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: fenced.conversation.id,
          direction: "OUTBOUND",
          senderType: "USER",
          text: "Manual reply remains available",
          status: "QUEUED",
        },
      });
      const event = await createRuntimeQueueEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "message",
        aggregateId: message.id,
        aggregateVersion: 1,
        eventType: "channels.send-message.requested",
        dedupeKey: `channels.send-message:${message.id}:v1`,
        envelope: {
          queueName: "channels.sendMessage",
          jobName: "send-message",
          jobId: `channel-send-${message.id}`,
          data: {
            tenantId: tenant.id,
            conversationId: fenced.conversation.id,
            messageId: message.id,
            source: "webhook",
            requestedByUserId: `manual-actor-${suffix}`,
            requestedAt: new Date().toISOString(),
          },
          attempts: 3,
          backoffMs: 1000,
        },
      });
      return { message, event };
    });
    assert(
      manual.message.senderType === "USER" &&
        manual.event.eventType === "channels.send-message.requested",
      "Manual USER delivery was blocked by automatic-reply deactivation.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        defaultDisabledFailClosed: true,
        inboundPersistencePreserved: true,
        exactActivationBindingQueued: true,
        fingerprintMutationRejected: true,
        publicationMutationRejected: true,
        publicationSupersessionFencedQueuedRun: true,
        conversationStateRejected: true,
        deactivationFencedQueuedRun: true,
        manualUserDeliveryAvailable: true,
      }),
    );
  } finally {
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
