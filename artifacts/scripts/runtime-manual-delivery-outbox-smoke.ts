import { randomUUID } from "node:crypto";
import { MockAiProvider } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import { ConversationsService } from "../../apps/api/src/modules/conversations/conversations.service.js";
import { RuntimeQueueService } from "../../apps/api/src/modules/ai/runtime-queue.service.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

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
    data: { name: "Manual Delivery Outbox", slug: `manual-delivery-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `manual-delivery-${suffix}@example.com`, name: "Outbox Manager" },
  });
  try {
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Manual Webhook",
        publicKey: `manual-webhook-${suffix}`,
        settings: {
          webhook: { outbound: { targetUrl: "https://example.com/leadvirt-runtime-smoke" } },
        },
      },
    });
    const lead = await prisma.lead.create({
      data: { tenantId: tenant.id, source: "smoke", channelType: "WEBHOOK", status: "IN_PROGRESS" },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: `recipient-${suffix}`,
        status: "OPEN",
      },
    });

    const runtimeQueue = new RuntimeQueueService(
      { redisUrl: "redis://unused:6380" } as AppConfigService,
      prisma as unknown as PrismaService,
    );
    const dispatched: string[] = [];
    runtimeQueue.dispatch = (eventId: string) => {
      dispatched.push(eventId);
    };
    const service = new ConversationsService(
      prisma as unknown as PrismaService,
      new MockAiProvider(),
      runtimeQueue,
    );
    const context: RequestContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };

    await service.sendMessage(context, conversation.id, { text: "A durable manual reply" });
    const message = await prisma.message.findFirstOrThrow({
      where: { tenantId: tenant.id, conversationId: conversation.id, senderType: "USER" },
    });
    const event = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `channels.send-message:${message.id}:v1`,
        },
      },
    });
    const envelope = record(event.payload);
    const data = record(envelope.data);
    const metadata = record(message.metadata);
    assert(message.status === "QUEUED", `Manual message persisted as ${message.status}.`);
    assert(envelope.queueName === "channels.sendMessage", "Manual outbox targets the wrong queue.");
    assert(
      data.messageId === message.id && data.requestedByUserId === user.id,
      "Manual delivery identity was lost.",
    );
    assert(
      metadata.deliveryOutboxId === event.id,
      "Message metadata does not reference its outbox event.",
    );
    assert(
      dispatched.length === 1 && dispatched[0] === event.id,
      "Manual delivery event was not dispatched after commit.",
    );
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, action: "message.sent", entityId: conversation.id },
    });
    assert(
      record(audit?.payload ?? null).deliveryOutboxId === event.id,
      "Manual send audit lost its outbox identity.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        messageId: message.id,
        outboxEventId: event.id,
        stableJobId: envelope.jobId,
        transactionallyPersisted: true,
      }),
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
