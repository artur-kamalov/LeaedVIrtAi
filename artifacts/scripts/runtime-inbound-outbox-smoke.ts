import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import { automaticReplyChannelFingerprint } from "@leadvirt/runtime-queue";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: "Inbound Outbox Smoke",
      slug: `inbound-outbox-${suffix}`,
      businessType: "services",
    },
  });
  try {
    const publicKey = `widget-outbox-${suffix}`;
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBSITE",
        status: "ACTIVE",
        name: "Outbox Widget",
        publicKey,
        settings: { widget: { businessName: "Outbox Studio" } },
      },
    });
    const capabilitySetHash = "7".repeat(64);
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Inbound outbox fixture has no operational permission generation.",
    );
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "8".repeat(64),
        capabilitySetHash,
        operationalBindingSchemaVersion: operationalProjection.schemaVersion,
        operationalRegistryVersion: operationalProjection.registryVersion,
        operationalRegistryHash: operationalProjection.registryHash,
        operationalDependencySetHash: operationalProjection.dependencySetHash,
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
        pipelineVersion: "runtime-inbound-outbox-smoke-v1",
        retrievalPolicyVersion: "runtime-inbound-outbox-smoke-v1",
        promptPolicyVersion: "runtime-inbound-outbox-smoke-v1",
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
          migrationId: `runtime-inbound-outbox-${suffix}`,
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
        automaticRepliesActivatedByUserId: `runtime-inbound-outbox-${suffix}`,
      },
    });

    const startedAt = Date.now();
    const response = await fetch(`${apiBase}/public/widget/${publicKey}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: `session-${suffix}`,
        clientMessageId: `message-${suffix}`,
        text: "I need an appointment tomorrow",
        customer: { name: "Outbox Customer" },
      }),
    });
    const elapsedMs = Date.now() - startedAt;
    const body = (await response.json()) as {
      data?: {
        conversationId?: string;
        ai?: { replied?: boolean; intent?: string };
        messages?: Array<{ id: string; senderType: string }>;
      };
    };
    assert(response.ok, `Widget request failed with ${response.status}: ${JSON.stringify(body)}`);
    assert(elapsedMs < 3000, `Durable queue request waited ${elapsedMs}ms for unavailable Redis.`);
    assert(
      body.data?.ai?.replied === false && body.data.ai.intent === "queued",
      "Widget fell back to synchronous AI.",
    );
    const conversationId = body.data?.conversationId;
    assert(conversationId, "Widget response did not include the conversation.");
    const inbound = body.data.messages?.find((message) => message.senderType === "CUSTOMER");
    assert(inbound?.id, "Widget response did not include the inbound message.");

    const event = await prisma.runtimeOutbox.findUnique({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `ai-reply:${conversationId}:${inbound.id}`,
        },
      },
    });
    assert(event, "Inbound message committed without its AI reply outbox event.");
    const payload = record(event.payload);
    assert(payload.queueName === "ai.reply", "Inbound outbox event targets the wrong queue.");
    const data = record(payload.data);
    assert(
      data.triggerMessageId === inbound.id && data.source === "widget",
      "Inbound outbox payload lost its message identity.",
    );
    const run = await prisma.aiReplyRun.findUnique({
      where: { tenantId_inboundMessageId: { tenantId: tenant.id, inboundMessageId: inbound.id } },
    });
    assert(
      run?.status === "QUEUED" && run.attemptCount === 0,
      "Inbound transaction did not create a queued AI reply run.",
    );
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    assert(
      conversation.aiReplyFence === run.sequence && conversation.aiReplySequence === run.sequence,
      "Inbound transaction did not atomically allocate the conversation reply fence.",
    );

    const secondResponse = await fetch(`${apiBase}/public/widget/${publicKey}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: `session-${suffix}`,
        clientMessageId: `message-2-${suffix}`,
        text: "Actually, I need the afternoon",
        customer: { name: "Outbox Customer" },
      }),
    });
    const secondBody = (await secondResponse.json()) as typeof body;
    assert(
      secondResponse.ok && secondBody.data?.ai?.intent === "queued",
      "Second inbound message was not queued.",
    );
    const secondInbound = secondBody.data.messages?.find(
      (message) => message.senderType === "CUSTOMER" && message.id !== inbound.id,
    );
    assert(secondInbound?.id, "Second inbound message was not returned.");
    const [supersededFirst, secondRun, orderedConversation] = await Promise.all([
      prisma.aiReplyRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.aiReplyRun.findUniqueOrThrow({
        where: {
          tenantId_inboundMessageId: { tenantId: tenant.id, inboundMessageId: secondInbound.id },
        },
      }),
      prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
    ]);
    assert(
      supersededFirst.status === "SUPERSEDED",
      "A newer inbound message did not supersede the older queued run.",
    );
    assert(
      secondRun.sequence === run.sequence + 1,
      "Conversation reply sequence did not advance exactly once.",
    );
    assert(
      orderedConversation.aiReplyFence === secondRun.sequence,
      "The newest inbound message does not own the reply fence.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        elapsedMs,
        inboundMessageId: inbound.id,
        outboxEventId: event.id,
        outboxStatus: event.status,
        aiReplySequence: run.sequence,
        newestAiReplySequence: secondRun.sequence,
        olderRunSuperseded: true,
        synchronousFallback: false,
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
