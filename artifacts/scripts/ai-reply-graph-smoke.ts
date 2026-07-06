import { randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { AiReplyJobData, ChannelSendMessageJobData } from "@leadvirt/types";

loadEnvFile();
process.env.AI_PROVIDER = "mock";
process.env.AI_ENABLE_REAL_PROVIDER = "false";

type ProcessLeadVirtJob = typeof import("../../apps/worker/src/processors/processor-registry.js").processLeadVirtJob;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6380),
    maxRetriesPerRequest: null
  };

  if (parsed.username) connection.username = decodeURIComponent(parsed.username);
  if (parsed.password) connection.password = decodeURIComponent(parsed.password);
  return connection;
}

async function main() {
  const { processLeadVirtJob } = (await import("../../apps/worker/src/processors/processor-registry.js")) as {
    processLeadVirtJob: ProcessLeadVirtJob;
  };
  const channelSendQueue = new Queue<ChannelSendMessageJobData>("channels.sendMessage", {
    connection: connectionFromRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6380")
  });
  await channelSendQueue.pause();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  const deliveryJobIds: string[] = [];

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "AI Graph Smoke",
        slug: `ai-graph-smoke-${suffix}`,
        businessType: "salon",
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "AI Graph Smoke Webhook",
        externalId: `ai-graph-smoke-${suffix}`,
        publicKey: `lvwh_ai_graph_smoke_${suffix.replace(/-/g, "_")}`
      }
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "AI Graph Smoke Lead",
        source: "worker-smoke",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM"
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "AI graph smoke",
        aiEnabled: true
      }
    });

    const inboundText = "I want to book a haircut for 2026-07-07T14:00:00.000Z. How much does it cost?";
    const inbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: `inbound-ai-graph-smoke-${suffix}`,
        text: inboundText,
        status: "RECEIVED"
      }
    });

    const source = await prisma.businessKnowledgeSource.create({
      data: {
        tenantId: tenant.id,
        type: "CATALOG",
        status: "ACTIVE",
        source: "smoke",
        sourceKey: `ai-graph-smoke:${suffix}:catalog`,
        title: "Catalog and available booking slots",
        content: "Haircut price is 2500 RUB. Available booking slot: 2026-07-07T14:00:00.000Z.",
        structuredData: {
          services: ["Haircut"],
          availability: ["2026-07-07T14:00:00.000Z"]
        }
      }
    });

    await prisma.businessKnowledgeChunk.create({
      data: {
        tenantId: tenant.id,
        sourceId: source.id,
        sourceVersion: source.version,
        chunkIndex: 0,
        content: source.content,
        contentHash: `ai-graph-smoke-${suffix}`,
        tokenEstimate: 14,
        embeddedAt: new Date(),
        indexedAt: new Date()
      }
    });

    const data: AiReplyJobData = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      triggerMessageId: inbound.id,
      text: inboundText,
      businessName: tenant.name,
      ...(tenant.businessType ? { businessType: tenant.businessType } : {}),
      leadId: lead.id,
      leadStatus: lead.status,
      source: "worker-test",
      receivedAt: inbound.createdAt.toISOString()
    };

    const jobId = `ai-reply:${conversation.id}:${inbound.id}`;
    const result = await processLeadVirtJob("ai.reply", { id: jobId, data } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(result), "AI graph did not return an object result");
    assert(result.status === "processed", `Expected processed result, got ${String(result.status)}`);
    assert(typeof result.messageId === "string", "AI graph result has no message id");
    assert(typeof result.graphRunId === "string", "AI graph result has no graph run id");
    assert(Array.isArray(result.toolResults), "AI graph result has no tool results");

    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    assert(message.senderType === "AI", "Created message is not an AI message");
    assert(message.status === "SENT", `Expected worker-test AI message status SENT, got ${message.status}`);
    assert(hasRecord(message.metadata), "AI message metadata is not an object");
    assert(message.metadata.graphRunId === result.graphRunId, "AI message graphRunId metadata mismatch");
    assert(message.metadata.outboundStatus === "sent", "AI message outboundStatus metadata mismatch");
    assert(Array.isArray(message.metadata.retrievedContext), "AI message has no retrievedContext metadata");
    assert(message.metadata.retrievedContext.length > 0, "AI graph did not attach retrieved context");
    assert(Array.isArray(message.metadata.toolResults), "AI message has no toolResults metadata");

    const usage = await prisma.aiUsageLog.findFirst({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        actionType: "langgraph_queued_reply"
      }
    });
    assert(usage, "AI graph did not create usage log");

    const booking = await prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: lead.id
      }
    });
    assert(booking, `AI graph did not create a booking proposal: ${JSON.stringify(result.toolResults)}`);
    assert(booking.status === "DRAFT", "AI graph booking proposal is not a draft");

    const note = await prisma.leadEvent.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "ai_tool_note"
      }
    });
    assert(note, "AI graph did not create a tool note");

    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert(updatedLead.status === "BOOKED", `Expected lead status BOOKED, got ${updatedLead.status}`);

    const duplicate = await processLeadVirtJob("ai.reply", { id: jobId, data } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(duplicate), "AI graph duplicate did not return an object result");
    assert(duplicate.status === "duplicate", `Expected duplicate result, got ${String(duplicate.status)}`);

    const publicLead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "AI Graph Public Source Lead",
        source: "webhook",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM"
      }
    });
    const publicConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: publicLead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: "AI graph public source smoke",
        aiEnabled: true
      }
    });
    const publicInbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: publicConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: `inbound-ai-public-source-${suffix}`,
        text: "Need the haircut price",
        status: "RECEIVED"
      }
    });
    const publicData: AiReplyJobData = {
      tenantId: tenant.id,
      conversationId: publicConversation.id,
      triggerMessageId: publicInbound.id,
      text: publicInbound.text ?? "",
      businessName: tenant.name,
      ...(tenant.businessType ? { businessType: tenant.businessType } : {}),
      leadId: publicLead.id,
      leadStatus: publicLead.status,
      source: "webhook",
      receivedAt: publicInbound.createdAt.toISOString()
    };
    const publicJobId = `ai-reply:${publicConversation.id}:${publicInbound.id}`;
    const publicResult = await processLeadVirtJob("ai.reply", { id: publicJobId, data: publicData } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(publicResult), "AI graph public source did not return an object result");
    assert(publicResult.status === "processed", `Expected public source processed result, got ${String(publicResult.status)}`);
    assert(typeof publicResult.messageId === "string", "AI graph public source result has no message id");
    const publicMessage = await prisma.message.findUniqueOrThrow({ where: { id: publicResult.messageId } });
    assert(publicMessage.status === "QUEUED", `Expected public source AI message status QUEUED, got ${publicMessage.status}`);
    assert(hasRecord(publicMessage.metadata), "Public source AI message metadata is not an object");
    assert(publicMessage.metadata.outboundStatus === "queued", "Public source outboundStatus metadata mismatch");
    assert(typeof publicMessage.metadata.deliveryJobId === "string", "Public source deliveryJobId metadata missing");
    deliveryJobIds.push(publicMessage.metadata.deliveryJobId);

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: result.messageId,
        graphRunId: result.graphRunId
      })
    );
  } finally {
    for (const deliveryJobId of deliveryJobIds) {
      const job = await channelSendQueue.getJob(deliveryJobId);
      await job?.remove().catch(() => undefined);
    }
    await channelSendQueue.resume().catch(() => undefined);
    await channelSendQueue.close().catch(() => undefined);
    if (tenantId) {
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
