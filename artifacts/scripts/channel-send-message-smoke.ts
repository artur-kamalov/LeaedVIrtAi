import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { ChannelSendMessageJobData } from "@leadvirt/types";

loadEnvFile();

type ProcessLeadVirtJob = typeof import("../../apps/worker/src/processors/processor-registry.js").processLeadVirtJob;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const { processLeadVirtJob } = (await import("../../apps/worker/src/processors/processor-registry.js")) as {
    processLeadVirtJob: ProcessLeadVirtJob;
  };
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Channel Delivery Smoke",
        slug: `channel-delivery-smoke-${suffix}`,
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Channel Delivery Smoke Webhook",
        externalId: `channel-delivery-${suffix}`,
        publicKey: `lvwh_channel_delivery_${suffix.replace(/-/g, "_")}`
      }
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "Channel Delivery Lead",
        source: "webhook",
        channelType: "WEBHOOK",
        status: "IN_PROGRESS",
        temperature: "WARM"
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: `webhook:${suffix}`,
        status: "OPEN",
        subject: "Channel delivery smoke",
        aiEnabled: true
      }
    });

    const message = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        externalMessageId: `ai-reply:${conversation.id}:trigger-${suffix}`,
        text: "Smoke reply from delivery worker.",
        status: "QUEUED",
        metadata: {
          graphRunId: `langgraph:channel-delivery-${suffix}`,
          outboundStatus: "queued"
        }
      }
    });

    const data: ChannelSendMessageJobData = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      messageId: message.id,
      source: "webhook",
      graphRunId: `langgraph:channel-delivery-${suffix}`,
      triggerMessageId: `trigger-${suffix}`,
      requestedAt: new Date().toISOString()
    };

    const jobId = `channel-send-${message.id}`;
    const result = await processLeadVirtJob("channels.sendMessage", { id: jobId, data } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(result), "Delivery processor did not return an object result");
    assert(result.status === "sent", `Expected sent result, got ${String(result.status)}`);
    assert(typeof result.providerExternalMessageId === "string", "Delivery result has no provider external message id");

    const sentMessage = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    assert(sentMessage.status === "SENT", `Expected message status SENT, got ${sentMessage.status}`);
    assert(hasRecord(sentMessage.metadata), "Sent message metadata is not an object");
    assert(sentMessage.metadata.outboundStatus === "queued", "Adapter outbound status was not stored");
    assert(hasRecord(sentMessage.metadata.delivery), "Delivery metadata was not stored");

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenant.id,
        action: "channel.message.sent",
        entityId: message.id
      }
    });
    assert(audit, "Delivery processor did not create audit log");

    const duplicate = await processLeadVirtJob("channels.sendMessage", { id: jobId, data } as Parameters<typeof processLeadVirtJob>[1]);
    assert(hasRecord(duplicate), "Duplicate delivery did not return an object result");
    assert(duplicate.status === "already_delivered", `Expected already_delivered duplicate result, got ${String(duplicate.status)}`);

    console.log(JSON.stringify({ ok: true, tenantId: tenant.id, conversationId: conversation.id, messageId: message.id }));
  } finally {
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
