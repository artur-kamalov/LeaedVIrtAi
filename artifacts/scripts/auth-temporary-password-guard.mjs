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

async function apiRequest(path, { method = "GET", cookie, data } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {})
    },
    body: data ? JSON.stringify(data) : undefined
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function cleanupUserWorkspace(prisma, email) {
  const user = await prisma.user.findUnique({
    where: { email },
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
  if (!health?.ok) {
    console.log(`SKIP: LeadVirt API is not running at ${apiOrigin}.`);
    return;
  }

  const prisma = new PrismaClient();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `temporary-password-${runId}@yandex.ru`;
  const initialPassword = `initial-${runId}`;
  const newPassword = `permanent-${runId}`;

  try {
    await cleanupUserWorkspace(prisma, email);

    const signup = await apiRequest("/auth/signup", {
      method: "POST",
      data: {
        email,
        password: initialPassword,
        companyName: `Temporary Password Guard ${runId}`
      }
    });
    assert(signup.response.ok, `Expected signup to succeed, got ${signup.response.status}`);

    const sessionCookie = signup.response.headers.get("set-cookie")?.split(";")[0];
    assert(sessionCookie, "Expected signup to return a session cookie.");

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordChangeRequired: true }
    });

    const blockedDashboard = await apiRequest("/dashboard/summary", { cookie: sessionCookie });
    assert(blockedDashboard.response.status === 403, `Expected dashboard to be blocked, got ${blockedDashboard.response.status}`);

    const authMe = await apiRequest("/auth/me", { cookie: sessionCookie });
    assert(authMe.response.status === 200, `Expected auth/me to stay available, got ${authMe.response.status}`);
    assert(authMe.payload?.data?.passwordChangeRequired === true, "Expected auth/me to return passwordChangeRequired=true.");

    const security = await apiRequest("/settings/security", { cookie: sessionCookie });
    assert(security.response.status === 200, `Expected settings/security to stay available, got ${security.response.status}`);
    assert(security.payload?.data?.passwordChangeRequired === true, "Expected settings/security to return passwordChangeRequired=true.");

    const changed = await apiRequest("/settings/security/password", {
      method: "PATCH",
      cookie: sessionCookie,
      data: {
        currentPassword: initialPassword,
        newPassword
      }
    });
    assert(changed.response.status === 200, `Expected password change to succeed, got ${changed.response.status}`);

    const unblockedDashboard = await apiRequest("/dashboard/summary", { cookie: sessionCookie });
    assert(unblockedDashboard.response.status === 200, `Expected dashboard to unblock after password change, got ${unblockedDashboard.response.status}`);

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordChangeRequired: true }
    });
    assert(updatedUser.passwordChangeRequired === false, "Expected passwordChangeRequired to be cleared.");

    console.log("PASS: temporary-password guard blocks workspace APIs until password change.");
  } finally {
    await cleanupUserWorkspace(prisma, email);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
