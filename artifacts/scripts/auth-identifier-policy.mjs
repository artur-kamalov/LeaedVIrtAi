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

async function apiRequest(path, { method = "GET", cookie, data } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "x-leadvirt-qa": "playwright",
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {})
    },
    body: data ? JSON.stringify(data) : undefined
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function cleanupUserWorkspace(prisma, where) {
  const user = await prisma.user.findFirst({
    where,
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
  const runId = `${Date.now()}`;
  const allowedEmail = `ru-policy-${runId}@yandex.ru`;
  const rejectedEmail = `ru-policy-${runId}@gmail.com`;
  const phone = `+7900${runId.slice(-7).padStart(7, "0")}`;
  const password = `Policy-${runId}!Aa`;

  try {
    await cleanupUserWorkspace(prisma, { email: allowedEmail });
    await cleanupUserWorkspace(prisma, { email: rejectedEmail });
    await cleanupUserWorkspace(prisma, { phone });

    const rejected = await apiRequest("/auth/signup", {
      method: "POST",
      data: { email: rejectedEmail, password, companyName: "Rejected Policy Workspace" }
    });
    assert(rejected.response.status === 400, `Expected gmail signup to be rejected, got ${rejected.response.status}`);

    const emailSignup = await apiRequest("/auth/signup", {
      method: "POST",
      data: { email: allowedEmail, password, companyName: "RU Email Policy Workspace" }
    });
    assert(emailSignup.response.ok, `Expected yandex signup to pass, got ${emailSignup.response.status}`);
    assert(emailSignup.payload?.data?.email === allowedEmail, "Expected auth payload to keep the RU email.");

    const phoneSignup = await apiRequest("/auth/signup", {
      method: "POST",
      data: { email: phone, password, companyName: "RU Phone Policy Workspace" }
    });
    assert(phoneSignup.response.ok, `Expected phone signup to pass, got ${phoneSignup.response.status}`);
    assert(phoneSignup.payload?.data?.phone === phone, "Expected auth payload to include the normalized phone.");

    const phoneLogin = await apiRequest("/auth/login", {
      method: "POST",
      data: { email: phone, password }
    });
    assert(phoneLogin.response.ok, `Expected phone login to pass, got ${phoneLogin.response.status}`);
    assert(phoneLogin.payload?.data?.phone === phone, "Expected phone login payload to include the normalized phone.");

    console.log("PASS: RU auth identifier policy accepts RU email/phone and rejects non-RU email.");
  } finally {
    await cleanupUserWorkspace(prisma, { email: allowedEmail });
    await cleanupUserWorkspace(prisma, { email: rejectedEmail });
    await cleanupUserWorkspace(prisma, { phone });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
