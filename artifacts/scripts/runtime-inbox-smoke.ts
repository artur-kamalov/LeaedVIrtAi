import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  loadKnowledgeOperationalCapabilityProjectionV1,
  stableKnowledgeValue,
} from "@leadvirt/knowledge";
import {
  automaticReplyChannelFingerprint,
  createAiReplyQueueEvent,
  parseRuntimeQueueEnvelope,
} from "@leadvirt/runtime-queue";
import { processLeadVirtJobWithReliability } from "../../apps/worker/src/reliability/worker-reliability.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: "Runtime Inbox Smoke", slug: `runtime-inbox-${suffix}` },
  });
  try {
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Runtime inbox channel",
        publicKey: `runtime-inbox-${suffix}`,
      },
    });
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Runtime inbox authorization generation is missing.",
    );
    const capabilitySetHash = "b".repeat(64);
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash,
        requirementEvaluationSetHash: "c".repeat(64),
        operationalBindingSchemaVersion: operationalProjection.schemaVersion,
        operationalRegistryVersion: operationalProjection.registryVersion,
        operationalRegistryHash: operationalProjection.registryHash,
        operationalDependencySetHash: operationalProjection.dependencySetHash,
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
        pipelineVersion: "runtime-inbox-smoke-v1",
        retrievalPolicyVersion: "runtime-inbox-smoke-v1",
        promptPolicyVersion: "runtime-inbox-smoke-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
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
          migrationId: `runtime-inbox-migration-${suffix}`,
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
        automaticRepliesActivatedByUserId: `runtime-inbox-actor-${suffix}`,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channelId: channel.id, status: "OPEN", aiEnabled: true },
    });
    const inbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: `runtime-inbox-canary:${suffix}`,
        status: "RECEIVED",
      },
    });
    const queued = await prisma.$transaction((tx) =>
      createAiReplyQueueEvent(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        triggerMessageId: inbound.id,
        text: inbound.text ?? "",
        source: "worker-test",
      }),
    );
    if (!queued.created) {
      throw new Error(`AI reply fixture was rejected: ${queued.reason}.`);
    }
    const event = queued.event;
    const envelope = parseRuntimeQueueEnvelope(event.payload);
    assert(!JSON.stringify(envelope).includes(inbound.text ?? ""), "Runtime outbox leaked text.");
    await prisma.runtimeOutbox.update({
      where: { id: event.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const fakeJob = {
      id: envelope.jobId,
      name: envelope.jobName,
      queueName: "ai.reply",
      data: {
        ...envelope.data,
        runtimeEventId: event.id,
        runtimeGeneration: event.generation,
      },
      opts: { attempts: envelope.attempts },
      attemptsMade: 0,
    } as Parameters<typeof processLeadVirtJobWithReliability>[1];

    const first = await processLeadVirtJobWithReliability("ai.reply", fakeJob);
    const second = await processLeadVirtJobWithReliability("ai.reply", fakeJob);
    assert(
      stableKnowledgeValue(first) === stableKnowledgeValue(second),
      "Runtime inbox replay returned a different terminal result.",
    );

    const inbox = await prisma.runtimeInbox.findUniqueOrThrow({
      where: {
        consumerName_eventId: {
          consumerName: "worker.ai.reply.generate-reply.v1",
          eventId: event.id,
        },
      },
    });
    assert(inbox.status === "SUCCEEDED", `Runtime inbox completed as ${inbox.status}.`);
    assert(
      inbox.attemptCount === 1,
      `Duplicate delivery executed ${inbox.attemptCount} consumer attempts.`,
    );
    const replyRun = await prisma.aiReplyRun.findUniqueOrThrow({ where: { id: queued.run.id } });
    assert(replyRun.status === "SUCCEEDED", `AI reply run completed as ${replyRun.status}.`);

    console.log(
      JSON.stringify({
        ok: true,
        eventId: event.id,
        inboxId: inbox.id,
        replyRunId: replyRun.id,
        opaqueJobProcessed: true,
        duplicateSuppressed: true,
        attempts: inbox.attemptCount,
      }),
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
