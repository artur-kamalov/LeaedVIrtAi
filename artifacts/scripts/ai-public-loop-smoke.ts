import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";

loadEnvFile();

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:4001/api").replace(/\/$/, "");
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashSecret(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

function connectionFromRedisUrl(value: string): ConnectionOptions {
  const parsed = new URL(value);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6380),
    maxRetriesPerRequest: null
  };

  if (parsed.username) connection.username = decodeURIComponent(parsed.username);
  if (parsed.password) connection.password = decodeURIComponent(parsed.password);
  return connection;
}

async function apiJson(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed ${response.status}: ${text}`);
  }

  return payload;
}

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

function getData(payload: unknown) {
  assert(isRecord(payload), "API response is not an object");
  const data = payload.data;
  assert(data !== undefined, "API response has no data field");
  return data;
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const sessionToken = `lv-smoke-${randomBytes(32).toString("hex")}`;
  const publicKey = `lvwh_ai_loop_${suffix.replace(/-/g, "_")}`;
  const webhookSecret = `secret-${randomBytes(12).toString("hex")}`;
  const cookie = `leadvirt_session=${encodeURIComponent(sessionToken)}`;
  const aiQueue = new Queue("ai.reply", { connection: connectionFromRedisUrl(redisUrl) });
  const deliveryQueue = new Queue("channels.sendMessage", { connection: connectionFromRedisUrl(redisUrl) });
  let tenantId: string | null = null;
  let userId: string | null = null;
  let aiJobId: string | null = null;
  let deliveryJobId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "AI Loop Smoke Studio",
        slug: `ai-loop-smoke-${suffix}`,
        businessType: "beauty_salon",
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: `ai.loop.${suffix}@yandex.ru`,
        name: "AI Loop Smoke Owner"
      }
    });
    userId = user.id;

    await prisma.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER"
      }
    });

    await prisma.authSession.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash: hashSecret(sessionToken),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        ipAddress: "127.0.0.1",
        userAgent: "leadvirt-ai-public-loop-smoke"
      }
    });

    await prisma.onboardingState.create({
      data: {
        tenantId: tenant.id,
        currentStep: "business",
        completedSteps: []
      }
    });

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "AI Loop Webhook",
        externalId: `ai-loop-webhook-${suffix}`,
        publicKey,
        settings: {
          webhook: {
            publicKey,
            secret: webhookSecret,
            acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"]
          }
        }
      }
    });

    await apiJson("/onboarding/state", {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({
        currentStep: "launch",
        data: {
          businessType: "beauty_salon",
          scenario: "booking",
          companyInfo: {
            name: "AI Loop Smoke Studio",
            description: "Beauty studio that answers pricing questions and books haircut appointments.",
            servicesCatalog: "Haircut - 2500 RUB, 60 minutes. Hair coloring - from 6000 RUB, 120 minutes.",
            availability: "Available booking slot: 2026-07-07T14:00:00.000Z.",
            workingHours: "Monday-Friday 10:00-19:00.",
            address: "Moscow, Tverskaya street, 1.",
            faq: "A haircut costs 2500 RUB. Confirm booking only for available windows.",
            escalationRules: "Escalate refund requests and medical questions to a human manager."
          }
        }
      })
    });

    const reindex = getData(await apiJson("/knowledge/sources/reindex", { method: "POST", headers: { cookie } }));
    assert(isRecord(reindex), "Knowledge reindex response is not an object");
    assert(Number(reindex.sources) >= 1, "Onboarding did not create knowledge sources");
    assert(Number(reindex.chunks) >= 1, "Knowledge reindex did not create chunks");

    const search = getData(await apiJson("/knowledge/sources/search?q=haircut%202500%20available%2014%3A00", { headers: { cookie } }));
    assert(Array.isArray(search), "Knowledge search response is not an array");
    assert(search.length > 0, "Knowledge search did not return onboarding context");

    const eventId = `ai-public-loop-${suffix}`;
    const inboundText = "I want to book a haircut for 2026-07-07T14:00:00.000Z. How much does it cost?";
    const webhookData = getData(
      await apiJson(`/public/channels/webhook/${encodeURIComponent(publicKey)}/events`, {
        method: "POST",
        headers: { "x-leadvirt-webhook-secret": webhookSecret },
        body: JSON.stringify({
          eventId,
          source: "ai-public-loop-smoke",
          conversationId: `conversation-${suffix}`,
          customer: {
            id: `customer-${suffix}`,
            name: "Clean Smoke Client",
            phone: "+79990000001",
            email: `client.${suffix}@example.com`
          },
          message: {
            id: `message-${suffix}`,
            text: inboundText,
            timestamp: new Date().toISOString()
          }
        })
      })
    );
    assert(isRecord(webhookData), "Webhook response data is not an object");

    assert(webhookData.ok === true, "Webhook response is not ok");
    assert(webhookData.duplicate === false, "Webhook event was unexpectedly treated as duplicate");
    assert(typeof webhookData.conversationId === "string", "Webhook response has no conversation id");
    assert(typeof webhookData.inboundMessageId === "string", "Webhook response has no inbound message id");
    assert(webhookData.outboundStatus === "queued", `Expected queued webhook reply, got ${String(webhookData.outboundStatus)}`);

    const conversationId = webhookData.conversationId;
    const inboundMessageId = webhookData.inboundMessageId;
    aiJobId = `ai-reply:${conversationId}:${inboundMessageId}`;

    const aiMessage = await waitFor("AI public reply delivery", async () => {
      const message = await prisma.message.findFirst({
        where: {
          tenantId: tenant.id,
          conversationId,
          senderType: "AI"
        },
        orderBy: { createdAt: "desc" }
      });
      if (!message) return null;
      if (message.status === "FAILED") {
        throw new Error(`AI message delivery failed: ${JSON.stringify(message.metadata)}`);
      }
      return message.status === "SENT" ? message : null;
    });

    assert(isRecord(aiMessage.metadata), "AI public reply metadata is not an object");
    assert(Array.isArray(aiMessage.metadata.retrievedContext), "AI public reply has no retrieved RAG context");
    assert(aiMessage.metadata.retrievedContext.length > 0, "AI public reply retrieved no RAG context");
    assert(typeof aiMessage.metadata.deliveryJobId === "string", "AI public reply has no delivery job id");
    deliveryJobId = aiMessage.metadata.deliveryJobId;

    const booking = await prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: typeof webhookData.leadId === "string" ? webhookData.leadId : undefined
      }
    });
    assert(booking, "AI public loop did not create booking draft");
    assert(booking.status === "DRAFT", `Expected booking draft, got ${booking.status}`);

    const inbox = await apiJson("/inbox/conversations", { headers: { cookie } });
    assert(isRecord(inbox), "Inbox response is not an object");
    assert(JSON.stringify(inbox).includes(conversationId), "Inbox does not include public loop conversation");

    const detail = getData(await apiJson(`/conversations/${conversationId}`, { headers: { cookie } }));
    assert(JSON.stringify(detail).includes(aiMessage.id), "Conversation detail does not include AI reply");

    const dashboard = getData(await apiJson("/dashboard/summary", { headers: { cookie } }));
    assert(isRecord(dashboard), "Dashboard summary response is not an object");
    assert(JSON.stringify(dashboard).includes(String(webhookData.leadId)), "Dashboard summary does not include public loop lead");

    const completedAiJob = await aiQueue.getJob(aiJobId);
    const completedDeliveryJob = await deliveryQueue.getJob(deliveryJobId);
    assert(!completedAiJob || (await completedAiJob.getState()) === "completed", "AI reply job did not complete");
    assert(!completedDeliveryJob || (await completedDeliveryJob.getState()) === "completed", "Channel delivery job did not complete");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        userId: user.id,
        channelId: channel.id,
        conversationId,
        leadId: webhookData.leadId,
        aiMessageId: aiMessage.id,
        aiJobId,
        deliveryJobId
      })
    );
  } finally {
    for (const [queue, jobId] of [
      [aiQueue, aiJobId],
      [deliveryQueue, deliveryJobId]
    ] as const) {
      if (!jobId) continue;
      const job = await queue.getJob(jobId).catch(() => null);
      await job?.remove().catch(() => undefined);
    }
    await aiQueue.close().catch(() => undefined);
    await deliveryQueue.close().catch(() => undefined);
    if (tenantId) {
      await prisma.webhookEvent.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
