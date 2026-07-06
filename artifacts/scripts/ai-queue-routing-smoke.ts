import { Queue, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import type { AiReplyJobData } from "@leadvirt/types";

loadEnvFile();

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6380";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const redisUrl = process.env.REDIS_URL;

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") {
    throw new Error(message);
  }
  return value;
}

function connectionFromRedisUrl(value: string): ConnectionOptions {
  const parsed = new URL(value);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    maxRetriesPerRequest: null
  };

  if (parsed.username) connection.username = decodeURIComponent(parsed.username);
  if (parsed.password) connection.password = decodeURIComponent(parsed.password);
  return connection;
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  const json = (await response.json()) as { data?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }
  return requireValue(json.data, `${path} response has no data`);
}

async function waitForJob(queue: Queue<AiReplyJobData>, jobId: string, source: AiReplyJobData["source"]) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await queue.getJob(jobId);
    if (job) {
      if (job.data.source !== source) {
        throw new Error(`Expected ${jobId} source ${source}, got ${job.data.source}`);
      }
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Queued ai.reply job was not found: ${jobId}`);
}

async function main() {
  const { prisma } = await import("@leadvirt/db");
  const queue = new Queue<AiReplyJobData>("ai.reply", { connection: connectionFromRedisUrl(requireValue(redisUrl, "REDIS_URL is required")) });
  await queue.pause();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: "AI Queue Routing Smoke",
      slug: `ai-queue-routing-${suffix}`,
      status: "TRIALING",
      businessType: "qa",
      timezone: "Europe/Moscow",
      settings: {}
    }
  });

  const publicKeys = {
    widget: `qa-widget-${suffix}`,
    webhook: `qa-webhook-${suffix}`,
    telegram: `qa-telegram-${suffix}`
  };
  const createdJobIds: string[] = [];

  try {
    await prisma.channel.createMany({
      data: [
        {
          tenantId: tenant.id,
          type: "WEBSITE",
          status: "ACTIVE",
          name: "QA Website Widget",
          publicKey: publicKeys.widget,
          settings: { widget: { businessName: "QA Studio" } }
        },
        {
          tenantId: tenant.id,
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "QA Webhook",
          publicKey: publicKeys.webhook,
          settings: { webhook: { secret: "queue-secret" } }
        },
        {
          tenantId: tenant.id,
          type: "TELEGRAM",
          status: "ACTIVE",
          name: "QA Telegram",
          externalId: "qa-telegram-account",
          publicKey: publicKeys.telegram,
          settings: { telegram: { webhookSecret: "queue-secret" } }
        }
      ]
    });

    const widgetResponse = (await postJson(`/public/widget/${publicKeys.widget}/messages`, {
      sessionId: `session-${suffix}`,
      clientMessageId: `widget-message-${suffix}`,
      text: "Need a booking slot tomorrow",
      customer: { name: "Queue Customer", email: "queue@example.com" }
    })) as {
      conversationId: string;
      ai: { replied: boolean; intent: string };
      messages: Array<{ id: string; senderType: string }>;
    };
    const widgetTriggerMessageId = requireValue(
      widgetResponse.messages.find((message) => message.senderType === "CUSTOMER")?.id,
      "Widget inbound message id was not returned"
    );
    if (widgetResponse.ai.replied || widgetResponse.ai.intent !== "queued") {
      throw new Error(`Widget did not return queued AI state: ${JSON.stringify(widgetResponse.ai)}`);
    }
    const widgetJobId = `ai-reply:${widgetResponse.conversationId}:${widgetTriggerMessageId}`;
    createdJobIds.push(widgetJobId);
    await waitForJob(queue, widgetJobId, "widget");

    const webhookEventId = `webhook-event-${suffix}`;
    const webhookResponse = (await postJson(
      `/public/channels/webhook/${publicKeys.webhook}/events`,
      {
        eventId: webhookEventId,
        conversationId: `webhook-conversation-${suffix}`,
        customer: { id: `webhook-customer-${suffix}`, name: "Webhook Customer" },
        message: { id: `webhook-message-${suffix}`, text: "Need a quote from webhook", timestamp: new Date().toISOString() }
      },
      { "x-leadvirt-webhook-secret": "queue-secret" }
    )) as { conversationId: string; inboundMessageId: string | null; aiMessageId: string | null; outboundStatus: string; reply: string | null };
    if (webhookResponse.outboundStatus !== "queued" || webhookResponse.reply !== null || webhookResponse.aiMessageId !== null) {
      throw new Error(`Webhook did not return queued result: ${JSON.stringify(webhookResponse)}`);
    }
    const webhookJobId = `ai-reply:${webhookResponse.conversationId}:${requireValue(webhookResponse.inboundMessageId, "Webhook inbound id missing")}`;
    createdJobIds.push(webhookJobId);
    await waitForJob(queue, webhookJobId, "webhook");

    const telegramUpdateId = Math.floor(Date.now() / 1000);
    const telegramResponse = (await postJson(
      `/public/channels/telegram/${publicKeys.telegram}/webhook`,
      {
        update_id: telegramUpdateId,
        message: {
          message_id: telegramUpdateId + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramUpdateId + 2 },
          from: { id: telegramUpdateId + 3, first_name: "Telegram", last_name: "Customer" },
          text: "Need Telegram booking"
        }
      },
      { "x-telegram-bot-api-secret-token": "queue-secret" }
    )) as { conversationId: string; inboundMessageId: string | null; aiMessageId: string | null; outboundStatus: string; reply: string | null };
    if (telegramResponse.outboundStatus !== "queued" || telegramResponse.reply !== null || telegramResponse.aiMessageId !== null) {
      throw new Error(`Telegram did not return queued result: ${JSON.stringify(telegramResponse)}`);
    }
    const telegramJobId = `ai-reply:${telegramResponse.conversationId}:${requireValue(telegramResponse.inboundMessageId, "Telegram inbound id missing")}`;
    createdJobIds.push(telegramJobId);
    await waitForJob(queue, telegramJobId, "telegram");

    console.log(JSON.stringify({ ok: true, queuedJobs: createdJobIds }, null, 2));
  } finally {
    for (const jobId of createdJobIds) {
      const job = await queue.getJob(jobId);
      await job?.remove().catch(() => undefined);
    }
    await queue.resume().catch(() => undefined);
    await prisma.webhookEvent.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    await queue.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
