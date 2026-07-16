import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejected(work: () => Promise<unknown>, code: string) {
  try {
    await work();
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: "Runtime Relationship Smoke", slug: `runtime-relationship-${suffix}` },
  });
  try {
    const [channelA, channelB] = await Promise.all([
      prisma.channel.create({
        data: {
          tenantId: tenant.id,
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "Channel A",
          publicKey: `a-${suffix}`,
        },
      }),
      prisma.channel.create({
        data: {
          tenantId: tenant.id,
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "Channel B",
          publicKey: `b-${suffix}`,
        },
      }),
    ]);
    const [conversationA, conversationB] = await Promise.all([
      prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          channelId: channelA.id,
          externalConversationId: `a-${suffix}`,
        },
      }),
      prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          channelId: channelB.id,
          externalConversationId: `b-${suffix}`,
        },
      }),
    ]);
    const [messageA, messageB] = await Promise.all([
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversationA.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: "A",
        },
      }),
      prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversationB.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: "B",
        },
      }),
    ]);

    const mismatchedRunRejected = await rejected(
      () =>
        prisma.aiReplyRun.create({
          data: {
            tenantId: tenant.id,
            conversationId: conversationA.id,
            inboundMessageId: messageB.id,
            idempotencyKey: `mismatch-${suffix}`,
            inputHash: `sha256:${suffix}`,
            generation: 1,
            sequence: 1,
          },
        }),
      "P2003",
    );
    const outboundA = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversationA.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "Reply",
        status: "QUEUED",
      },
    });
    const mismatchedMessageRejected = await rejected(
      () =>
        prisma.channelDeliveryOperation.create({
          data: {
            id: `delivery-message-${suffix}`,
            tenantId: tenant.id,
            messageId: outboundA.id,
            conversationId: conversationB.id,
            channelId: channelB.id,
            provider: "webhook",
            channelKey: `webhook:${channelB.id}`,
            recipientKey: conversationB.id,
            requestHash: `sha256:${suffix}:message`,
            retentionExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      "P2003",
    );
    const mismatchedChannelRejected = await rejected(
      () =>
        prisma.channelDeliveryOperation.create({
          data: {
            id: `delivery-channel-${suffix}`,
            tenantId: tenant.id,
            messageId: outboundA.id,
            conversationId: conversationA.id,
            channelId: channelB.id,
            provider: "webhook",
            channelKey: `webhook:${channelB.id}`,
            recipientKey: conversationA.id,
            requestHash: `sha256:${suffix}:channel`,
            retentionExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      "P2003",
    );
    const duplicateConversationRejected = await rejected(
      () =>
        prisma.conversation.create({
          data: {
            tenantId: tenant.id,
            channelId: channelA.id,
            externalConversationId: `a-${suffix}`,
          },
        }),
      "P2002",
    );

    assert(
      mismatchedRunRejected,
      "AI reply run accepted an inbound message from another conversation.",
    );
    assert(mismatchedMessageRejected, "Delivery accepted a message from another conversation.");
    assert(
      mismatchedChannelRejected,
      "Delivery accepted a channel different from its conversation.",
    );
    assert(
      duplicateConversationRejected,
      "Duplicate active external conversation identity was accepted.",
    );
    console.log(
      JSON.stringify({
        ok: true,
        mismatchedRunRejected,
        mismatchedMessageRejected,
        mismatchedChannelRejected,
        duplicateConversationRejected,
      }),
    );
  } finally {
    await prisma.channelDeliveryOperation.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.aiReplyRun.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
