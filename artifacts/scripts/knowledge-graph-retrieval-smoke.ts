import { randomUUID } from "node:crypto";
import { MockAiProvider } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  createKnowledgeV2QueryHashKeyring,
  KnowledgeRetriever,
  KnowledgeRuntimeRetriever,
  LegacyKnowledgePublisher,
  type KnowledgeRuntimeConfig,
} from "@leadvirt/knowledge";
import type { AiReplyJobData } from "@leadvirt/types";
import { runAiReplyGraph } from "../../apps/worker/src/ai/ai-reply-graph.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const marker = `sharedretrievalhaircut${suffix.replaceAll("-", "")}`;
  const config: KnowledgeRuntimeConfig = {
    mode: "database",
    qdrantUrl: "http://localhost:6333",
    qdrantCollection: "leadvirt_knowledge",
    qdrantTimeoutMs: 1000,
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace",
  };
  const publisher = new LegacyKnowledgePublisher(prisma, config);
  const retriever = new KnowledgeRetriever(prisma, config);
  const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
    activeKeyId: "knowledge-graph-query-key-v1",
    keys: { "knowledge-graph-query-key-v1": new Uint8Array(32).fill(107) },
  });
  const runtimeRetriever = new KnowledgeRuntimeRetriever(
    prisma,
    retriever,
    undefined,
    queryHashKeyring,
  );
  const provider = new MockAiProvider();
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Knowledge Graph Retrieval Smoke",
        slug: `knowledge-graph-${suffix}`,
        businessType: "salon",
        timezone: "Europe/Paris",
      },
    });
    tenantId = tenant.id;
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        name: "Knowledge Graph Lead",
        source: "worker-smoke",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM",
      },
    });
    await prisma.businessKnowledgeSource.create({
      data: {
        tenantId,
        type: "CATALOG",
        status: "ACTIVE",
        source: "worker-smoke",
        sourceKey: `knowledge-graph:${suffix}`,
        title: "Verified haircut catalog",
        content: `${marker} haircut costs 2500 RUB and takes 60 minutes.`,
      },
    });
    const publication = await publisher.publish({ tenantId, reason: "knowledge_graph_smoke" });

    const groundedConversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        status: "OPEN",
        subject: "Grounded retrieval",
        aiEnabled: true,
      },
    });
    const groundedInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: groundedConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: `What is the ${marker} price?`,
        status: "RECEIVED",
      },
    });
    const groundedData: AiReplyJobData = {
      tenantId,
      conversationId: groundedConversation.id,
      triggerMessageId: groundedInbound.id,
      source: "worker-test",
    };
    const grounded = await runAiReplyGraph({
      data: groundedData,
      jobId: `knowledge-grounded:${groundedInbound.id}`,
      aiProvider: provider,
      knowledgeRetriever: runtimeRetriever,
    });
    assert(
      grounded.status === "processed" && grounded.qualityPassed === true,
      "Grounded graph reply did not pass.",
    );
    const groundedMessage = await prisma.message.findUniqueOrThrow({
      where: { id: grounded.messageId },
    });
    const groundedMetadata = record(groundedMessage.metadata);
    const groundedRetrieval = record(groundedMetadata.knowledgeRetrieval);
    assert(
      groundedRetrieval.status === "grounded",
      "Worker did not use the shared grounded retrieval outcome.",
    );
    assert(
      groundedRetrieval.publicationId === publication.publicationId,
      "Worker captured the wrong publication.",
    );
    const groundedContext = Array.isArray(groundedMetadata.retrievedContext)
      ? groundedMetadata.retrievedContext
      : [];
    assert(groundedContext.length === 1, "Grounded worker context cardinality is wrong.");

    const missingConversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        status: "OPEN",
        subject: "Missing retrieval",
        aiEnabled: true,
      },
    });
    const missingInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: missingConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "What is the price of an unrelated quantum submarine?",
        status: "RECEIVED",
      },
    });
    const missingData: AiReplyJobData = {
      tenantId,
      conversationId: missingConversation.id,
      triggerMessageId: missingInbound.id,
      source: "worker-test",
    };
    const missing = await runAiReplyGraph({
      data: missingData,
      jobId: `knowledge-missing:${missingInbound.id}`,
      aiProvider: provider,
      knowledgeRetriever: runtimeRetriever,
    });
    assert(
      missing.status === "processed",
      "Missing-grounding graph did not produce a safe result.",
    );
    assert(
      missing.qualityPassed === false && missing.qualityReason === "missing_grounding",
      "Missing grounding was not blocked.",
    );
    assert(missing.handoffRequired === true, "Missing grounding did not request handoff.");
    const missingMessage = await prisma.message.findUniqueOrThrow({
      where: { id: missing.messageId },
    });
    const missingMetadata = record(missingMessage.metadata);
    const missingRetrieval = record(missingMetadata.knowledgeRetrieval);
    assert(
      missingRetrieval.status === "insufficient_grounding",
      "Worker hid the insufficient-grounding outcome.",
    );
    const missingContext = Array.isArray(missingMetadata.retrievedContext)
      ? missingMetadata.retrievedContext
      : [];
    assert(missingContext.length === 0, "Worker attached arbitrary context after a no-match.");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId,
        publicationId: publication.publicationId,
        groundedMessageId: grounded.messageId,
        missingMessageId: missing.messageId,
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
      await prisma.activeKnowledgePublication
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await prisma.knowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.knowledgeIndexSnapshot
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
