import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDbPackage("@prisma/client");

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const apiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const apiOrigin = apiBase.replace(/\/api$/, "");
const botToken = process.env.LEADVIRT_TELEGRAM_AUTH_TEST_TOKEN ?? "123456:leadvirt-test-token";

function normalizeApiBase(value) {
  const trimmed = value.replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function dataCheckString(payload) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function signedPayload(id) {
  const payload = {
    id,
    first_name: "Telegram",
    last_name: "Smoke",
    username: `leadvirt_smoke_${id}`,
    auth_date: Math.floor(Date.now() / 1000)
  };
  const secret = createHash("sha256").update(botToken).digest();
  return {
    ...payload,
    hash: createHmac("sha256", secret).update(dataCheckString(payload)).digest("hex")
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function apiRequest(path, { method = "GET", data } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-leadvirt-qa": "playwright"
    },
    body: data ? JSON.stringify(data) : undefined
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function cleanup(prisma, telegramId) {
  const user = await prisma.user.findUnique({
    where: { externalAuthId: `telegram:${telegramId}` },
    select: {
      id: true,
      memberships: { select: { tenantId: true } }
    }
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
  const telegramId = Number(`${Date.now()}`.slice(-9));

  try {
    await cleanup(prisma, telegramId);

    const invalid = await apiRequest("/auth/telegram", {
      method: "POST",
      data: { ...signedPayload(telegramId), hash: "00" }
    });
    assert(invalid.response.status === 401, `Expected invalid Telegram hash to return 401, got ${invalid.response.status}. Is API running with LEADVIRT_TELEGRAM_AUTH_TEST_TOKEN?`);

    const created = await apiRequest("/auth/telegram", {
      method: "POST",
      data: signedPayload(telegramId)
    });
    assert(created.response.ok, `Expected Telegram auth to pass, got ${created.response.status}: ${JSON.stringify(created.payload)}`);
    assert(created.payload?.data?.isNewUser === true, "Expected first Telegram auth to create a user.");
    assert(created.payload?.data?.authMode === "telegram", "Expected first Telegram auth to return authMode=telegram.");

    const login = await apiRequest("/auth/telegram", {
      method: "POST",
      data: signedPayload(telegramId)
    });
    assert(login.response.ok, `Expected Telegram login to pass, got ${login.response.status}: ${JSON.stringify(login.payload)}`);
    assert(login.payload?.data?.isNewUser === false, "Expected second Telegram auth to reuse the user.");
    assert(login.payload?.data?.authMode === "telegram", "Expected second Telegram auth to return authMode=telegram.");

    console.log("PASS: Telegram auth verifies signatures, creates first workspace, and logs in existing users.");
  } finally {
    await cleanup(prisma, telegramId);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
