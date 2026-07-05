import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDbPackage("@prisma/client");

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const apiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const apiOrigin = apiBase.replace(/\/api$/, "");

function normalizeApiBase(value) {
  const trimmed = value.replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

async function apiRequest(path, { method = "GET", cookie, data, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function cleanupUserWorkspace(prisma, email) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      memberships: { select: { tenantId: true } },
    },
  });

  if (!user) return;

  const tenantIds = user.memberships.map((membership) => membership.tenantId);
  if (tenantIds.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({ where: { id: user.id } });
}

async function main() {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
  if (!health?.ok) {
    console.log(`SKIP: LeadVirt API is not running at ${apiOrigin}.`);
    return;
  }

  const prisma = new PrismaClient();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `channel-provisioning-${runId}@mail.ru`;
  const password = `Channel-${runId}!Aa`;

  try {
    await cleanupUserWorkspace(prisma, email);

    const signup = await apiRequest("/auth/signup", {
      method: "POST",
      data: {
        email,
        password,
        companyName: `Channel Provisioning ${runId}`,
      },
    });
    assert(signup.response.ok, `Expected signup to succeed, got ${signup.response.status}`);

    const sessionCookie = signup.response.headers.get("set-cookie")?.split(";")[0];
    assert(sessionCookie, "Expected signup to return a session cookie.");

    const created = await apiRequest("/channels", {
      method: "POST",
      cookie: sessionCookie,
      data: {
        type: "WEBHOOK",
        name: "Master Budet Webhook",
        status: "ACTIVE",
      },
    });
    assert(created.response.status === 201 || created.response.status === 200, `Expected channel create to succeed, got ${created.response.status}`);

    const channel = created.payload?.data;
    assert(channel?.type === "WEBHOOK", "Expected created channel type WEBHOOK.");
    assert(channel?.status === "ACTIVE", "Expected created channel to be active.");
    assert(typeof channel?.publicKey === "string" && channel.publicKey.startsWith("lvwh_"), `Expected generated lvwh_ public key, got ${channel?.publicKey}`);
    assert(!channel.publicKey.includes("demo"), "Expected generated public key to be non-demo.");

    const webhookSettings = asRecord(asRecord(channel.settings).webhook);
    const webhookSecret = typeof webhookSettings.secret === "string" ? webhookSettings.secret : "";
    assert(webhookSecret.length >= 16, "Expected generated webhook secret in channel settings.");

    const integrations = await apiRequest("/integrations", { cookie: sessionCookie });
    assert(integrations.response.ok, `Expected integrations to load, got ${integrations.response.status}`);
    const webhookIntegration = integrations.payload?.data?.find?.((item) => item.provider === "WEBHOOK_API");
    assert(webhookIntegration?.status === "CONNECTED", "Expected companion Webhook/API integration to be connected.");
    assert(webhookIntegration?.inboundEndpoint?.publicKey === channel.publicKey, "Expected companion integration endpoint to use created public key.");

    const intake = await apiRequest(`/public/channels/webhook/${encodeURIComponent(channel.publicKey)}/events`, {
      method: "POST",
      headers: { "x-leadvirt-webhook-secret": webhookSecret },
      data: {
        eventId: `channel-provisioning-${runId}`,
        conversationId: `channel-provisioning-thread-${runId}`,
        source: "Channel provisioning smoke",
        customer: {
          id: `channel-provisioning-customer-${runId}`,
          name: "Channel Provisioning Lead",
          email,
        },
        message: {
          id: `channel-provisioning-message-${runId}`,
          text: "Webhook/API provisioning smoke",
          timestamp: new Date().toISOString(),
        },
      },
    });
    assert(intake.response.ok, `Expected public webhook intake to succeed, got ${intake.response.status}`);
    assert(intake.payload?.data?.conversationId, "Expected public webhook intake to return a conversation id.");
    assert(intake.payload?.data?.leadId, "Expected public webhook intake to return a lead id.");

    console.log(`PASS: Webhook/API channel provisioning created ${channel.publicKey} and accepted public intake.`);
  } finally {
    await cleanupUserWorkspace(prisma, email);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
