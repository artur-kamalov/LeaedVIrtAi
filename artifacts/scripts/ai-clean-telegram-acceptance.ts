import { createHash, createHmac, randomUUID } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";

loadEnvFile();

const apiBaseUrl = (process.env.LEADVIRT_API_BASE ?? process.env.API_BASE_URL ?? "http://localhost:4001/api").replace(/\/$/, "");
const apiOrigin = apiBaseUrl.replace(/\/api$/, "");
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
const workerMetricsUrl = process.env.WORKER_METRICS_URL ?? "http://localhost:4002/metrics";
const telegramBotToken = (process.env.TELEGRAM_LOGIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.LEADVIRT_TELEGRAM_AUTH_TEST_TOKEN || "").trim();

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataCheckString(payload: JsonRecord) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function signedTelegramPayload(id: number) {
  assert(telegramBotToken.length > 0, "TELEGRAM_LOGIN_BOT_TOKEN or TELEGRAM_BOT_TOKEN is required for Telegram acceptance smoke.");
  const payload = {
    id,
    first_name: "Acceptance",
    last_name: "Smoke",
    username: `leadvirt_acceptance_${id}`,
    auth_date: Math.floor(Date.now() / 1000)
  };
  const secret = createHash("sha256").update(telegramBotToken).digest();
  return {
    ...payload,
    hash: createHmac("sha256", secret).update(dataCheckString(payload)).digest("hex")
  };
}

function cookieFromResponse(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const raw = values.join("; ");
  const match = raw.match(/leadvirt_session=([^;]+)/);
  assert(match?.[1], "Auth response did not set leadvirt_session cookie.");
  return `leadvirt_session=${match[1]}`;
}

async function apiJson(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-leadvirt-qa": "playwright",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

function getData(payload: unknown) {
  assert(isRecord(payload), "API response is not an object.");
  assert(payload.data !== undefined, "API response has no data field.");
  return payload.data;
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

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

async function cleanupTelegramUser(telegramId: number) {
  const user = await prisma.user.findUnique({
    where: { externalAuthId: `telegram:${telegramId}` },
    select: { id: true, memberships: { select: { tenantId: true } } }
  });
  if (!user) return;
  const tenantIds = user.memberships.map((membership) => membership.tenantId);
  if (tenantIds.length > 0) {
    await prisma.webhookEvent.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => undefined);
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => undefined);
}

function metadataRecord(value: unknown) {
  assert(isRecord(value), "AI message metadata is not an object.");
  return value;
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function includesPrice(value: string) {
  return /2\s?500|2500/.test(value);
}

async function main() {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
  assert(health?.ok, `LeadVirt API is not running at ${apiOrigin}.`);

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const telegramId = Number(`${Date.now()}`.slice(-9));
  const publicKey = `lvwh_accept_${suffix.replace(/-/g, "_")}`;
  const webhookSecret = `accept-secret-${suffix}`;
  const aiQueue = new Queue("ai.reply", { connection: connectionFromRedisUrl(redisUrl) });
  const deliveryQueue = new Queue("channels.sendMessage", { connection: connectionFromRedisUrl(redisUrl) });
  let tenantId: string | null = null;
  let userId: string | null = null;
  let aiJobId: string | null = null;
  let deliveryJobId: string | null = null;

  try {
    await cleanupTelegramUser(telegramId);

    const login = await apiJson("/auth/telegram", {
      method: "POST",
      body: JSON.stringify(signedTelegramPayload(telegramId))
    });
    const cookie = cookieFromResponse(login.response);
    const loginData = getData(login.payload);
    assert(isRecord(loginData), "Telegram login data is not an object.");
    assert(loginData.isNewUser === true, "Expected Telegram auth to create a clean user.");
    assert(loginData.authMode === "telegram", "Expected Telegram authMode.");

    const me = getData((await apiJson("/auth/me", { headers: { cookie } })).payload);
    assert(isRecord(me), "Auth me response is not an object.");
    assert(typeof me.tenantId === "string", "Auth me response has no tenant id.");
    assert(typeof me.id === "string", "Auth me response has no user id.");
    tenantId = me.tenantId;
    userId = me.id;

    await apiJson("/onboarding/state", {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({
        currentStep: "launch",
        data: {
          businessType: "beauty_salon",
          scenario: "booking",
          companyInfo: {
            name: "Acceptance Smoke Studio",
            description: "Beauty studio that answers pricing questions and books haircut appointments.",
            servicesCatalog: "Haircut price is 2500 RUB and takes 60 minutes. Hair coloring starts from 6000 RUB.",
            availability: "Available booking slot: 2026-07-07T14:00:00.000Z.",
            workingHours: "Monday-Friday 10:00-19:00.",
            address: "Moscow, Tverskaya street, 1.",
            faq: "A haircut costs 2500 RUB. Confirm booking only for available windows.",
            escalationRules: "Escalate refund requests and medical questions to a human manager."
          }
        }
      })
    });

    const reindex = getData((await apiJson("/knowledge/sources/reindex", { method: "POST", headers: { cookie } })).payload);
    assert(isRecord(reindex), "Knowledge reindex response is not an object.");
    assert(Number(reindex.sources) >= 1, "Onboarding did not create knowledge sources.");
    assert(Number(reindex.chunks) >= 1, "Knowledge reindex did not create chunks.");

    const search = getData((await apiJson("/knowledge/sources/search?q=haircut%202500%20available%2014%3A00", { headers: { cookie } })).payload);
    assert(Array.isArray(search) && search.length > 0, "Knowledge search did not return onboarding context.");

    const channel = getData(
      (
        await apiJson("/channels", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            type: "WEBHOOK",
            name: "Acceptance Webhook/API",
            publicKey,
            settings: {
              webhook: {
                publicKey,
                secret: webhookSecret,
                autoReply: true,
                acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"]
              }
            }
          })
        })
      ).payload
    );
    assert(isRecord(channel) && channel.publicKey === publicKey, "Webhook/API channel was not created.");

    const eventId = `ai-acceptance-${suffix}`;
    const inboundText = "I want to book a haircut for 2026-07-07T14:00:00.000Z. How much does it cost?";
    const intake = getData(
      (
        await apiJson(`/public/channels/webhook/${encodeURIComponent(publicKey)}/events`, {
          method: "POST",
          headers: { "x-leadvirt-webhook-secret": webhookSecret },
          body: JSON.stringify({
            eventId,
            source: "ai-clean-telegram-acceptance",
            conversationId: `conversation-${suffix}`,
            customer: {
              id: `customer-${suffix}`,
              name: "Acceptance Client",
              phone: "+79990000001",
              email: `acceptance.${suffix}@example.com`
            },
            message: {
              id: `message-${suffix}`,
              text: inboundText,
              timestamp: new Date().toISOString()
            }
          })
        })
      ).payload
    );
    assert(isRecord(intake), "Webhook intake data is not an object.");
    assert(intake.ok === true, "Webhook intake was not accepted.");
    assert(intake.outboundStatus === "queued", `Expected queued AI reply, got ${String(intake.outboundStatus)}.`);
    assert(typeof intake.conversationId === "string", "Webhook intake has no conversation id.");
    assert(typeof intake.inboundMessageId === "string", "Webhook intake has no inbound message id.");
    assert(typeof intake.leadId === "string", "Webhook intake has no lead id.");

    const conversationId = intake.conversationId;
    const leadId = intake.leadId;
    aiJobId = `ai-reply:${conversationId}:${intake.inboundMessageId}`;

    const aiMessage = await waitFor("AI reply delivery", async () => {
      assert(tenantId, "Tenant id was not resolved.");
      const message = await prisma.message.findFirst({
        where: { tenantId, conversationId, senderType: "AI" },
        orderBy: { createdAt: "desc" }
      });
      if (!message) return null;
      if (message.status === "FAILED") throw new Error(`AI message delivery failed: ${JSON.stringify(message.metadata)}`);
      return message.status === "SENT" ? message : null;
    });

    assert(aiMessage.text && includesPrice(aiMessage.text), `AI reply did not include grounded price: ${aiMessage.text ?? ""}`);
    assert(aiMessage.text.includes("14:00") || aiMessage.text.includes("2026-07-07"), `AI reply did not include available slot: ${aiMessage.text}`);

    const metadata = metadataRecord(aiMessage.metadata);
    assert(typeof metadata.graphRunId === "string", "AI metadata has no graphRunId.");
    assert(isRecord(metadata.quality), "AI metadata has no quality payload.");
    assert(metadata.quality.passed === true, "AI quality gate did not pass.");
    const retrievedRefs = arrayOfRecords(metadata.retrievedContext);
    assert(retrievedRefs.length > 0, "AI reply has no retrieved RAG refs.");
    const chunkIds = retrievedRefs.map((item) => item.chunkId).filter((id): id is string => typeof id === "string");
    const chunks = await prisma.businessKnowledgeChunk.findMany({
      where: { tenantId: tenantId!, id: { in: chunkIds } },
      select: { content: true }
    });
    const contextText = chunks.map((chunk) => chunk.content).join("\n");
    assert(contextText.includes("2500 RUB"), "Retrieved context did not include catalog price.");
    assert(contextText.includes("2026-07-07T14:00:00.000Z"), "Retrieved context did not include available slot.");
    const toolTypes = arrayOfRecords(metadata.toolResults).map((item) => item.type).filter((type): type is string => typeof type === "string");
    assert(toolTypes.includes("lead.note.create"), "AI tools did not create lead note.");
    assert(toolTypes.includes("lead.status.change"), "AI tools did not update lead status.");
    assert(toolTypes.includes("booking.proposal.create"), "AI tools did not create booking draft.");
    assert(typeof metadata.deliveryJobId === "string", "AI metadata has no delivery job id.");
    deliveryJobId = metadata.deliveryJobId;

    const usage = await prisma.aiUsageLog.findFirst({
      where: { tenantId: tenantId!, conversationId, actionType: "langgraph_queued_reply" },
      orderBy: { createdAt: "desc" }
    });
    assert(usage, "AI usage log was not stored.");
    assert(usage.inputTokens > 0 && usage.outputTokens > 0, "AI usage log has no token usage.");
    assert(usage.estimatedCost !== null, "AI usage log has no estimated cost.");

    const booking = await prisma.booking.findFirst({ where: { tenantId: tenantId!, leadId, status: "DRAFT" } });
    assert(booking, "AI did not create booking draft.");

    const inbox = (await apiJson("/inbox/conversations", { headers: { cookie } })).payload;
    assert(JSON.stringify(inbox).includes(conversationId), "Inbox does not include the acceptance conversation.");
    const conversation = getData((await apiJson(`/conversations/${conversationId}`, { headers: { cookie } })).payload);
    assert(JSON.stringify(conversation).includes(aiMessage.id), "Conversation detail does not include AI reply.");
    assert(JSON.stringify(conversation).includes("langgraph_ai_reply_generated"), "Conversation activity timeline does not include AI event.");
    const lead = getData((await apiJson(`/leads/${leadId}`, { headers: { cookie } })).payload);
    assert(JSON.stringify(lead).includes(leadId), "Lead detail does not include acceptance lead.");
    const dashboard = getData((await apiJson("/dashboard/summary", { headers: { cookie } })).payload);
    assert(JSON.stringify(dashboard).includes(leadId), "Dashboard summary does not include acceptance lead.");
    assert(!JSON.stringify(dashboard).includes("Анна Соколова"), "Dashboard leaked demo lead data.");

    const audit = getData((await apiJson("/ai-audit?limit=30", { headers: { cookie } })).payload);
    assert(JSON.stringify(audit).includes(String(metadata.graphRunId)), "AI audit does not include graph run.");
    assert(JSON.stringify(audit).includes("langgraph_queued_reply"), "AI audit does not include usage log event.");

    const completedAiJob = await aiQueue.getJob(aiJobId);
    const completedDeliveryJob = await deliveryQueue.getJob(deliveryJobId);
    assert(!completedAiJob || (await completedAiJob.getState()) === "completed", "AI reply job did not complete.");
    assert(!completedDeliveryJob || (await completedDeliveryJob.getState()) === "completed", "Channel delivery job did not complete.");

    const metrics = await fetch(workerMetricsUrl, { signal: AbortSignal.timeout(3_000) });
    assert(metrics.ok, `Worker metrics endpoint is not available at ${workerMetricsUrl}.`);
    const metricsText = await metrics.text();
    assert(metricsText.includes("leadvirt_ai_graph_runs_total"), "Worker metrics do not include AI graph run counter.");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId,
        userId,
        channelId: channel.id,
        conversationId,
        leadId,
        aiMessageId: aiMessage.id,
        aiJobId,
        deliveryJobId,
        graphRunId: metadata.graphRunId
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
    await cleanupTelegramUser(telegramId).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
