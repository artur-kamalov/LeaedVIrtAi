import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDbPackage("@prisma/client");

const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const hadExplicitDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ??= localDatabaseUrl;

const databaseUrl = process.env.DATABASE_URL;
const ownerEmail = normalizeEmail(process.env.LEADVIRT_AUTH_READY_EMAIL ?? "admin@leadvirt.ai");
const appEnv = process.env.APP_ENV ?? "local";
const nodeEnv = process.env.NODE_ENV ?? "development";
const strict =
  isTruthy(process.env.LEADVIRT_AUTH_READY_STRICT) ||
  nodeEnv === "production" ||
  ["staging", "production", "public"].includes(appEnv.toLowerCase());
const apiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const apiOrigin = apiBase.replace(/\/api$/, "");

const checks = [];

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function pass(name, detail = "") {
  checks.push({ level: "PASS", name, detail });
}

function warn(name, detail = "") {
  checks.push({ level: "WARN", name, detail });
}

function fail(name, detail = "") {
  checks.push({ level: "FAIL", name, detail });
}

function requireCheck(condition, name, passDetail, failDetail = passDetail) {
  if (condition) pass(name, passDetail);
  else fail(name, failDetail);
}

function strictCheck(condition, name, passDetail, failDetail = passDetail) {
  if (condition) {
    pass(name, passDetail);
    return;
  }

  if (strict) fail(name, failDetail);
  else warn(name, failDetail);
}

function status(result) {
  if (result.ok) return `HTTP ${result.status}`;
  return result.error ? result.error : `HTTP ${result.status}`;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function checkRequiredColumns(prisma, tableName, columns) {
  const missing = [];
  for (const column of columns) {
    if (!(await columnExists(prisma, tableName, column))) {
      missing.push(column);
    }
  }

  requireCheck(
    missing.length === 0,
    `${tableName} auth columns`,
    columns.join(", "),
    missing.length ? `missing: ${missing.join(", ")}` : "missing columns",
  );
}

async function checkDatabaseSchema(prisma) {
  const databaseRows = await prisma.$queryRaw`
    SELECT current_database() AS "database", current_schema() AS "schema"
  `;
  const target = databaseRows[0];
  pass("Database connection", `${target?.database ?? "unknown"}.${target?.schema ?? "unknown"}`);

  const authSessionExists = await tableExists(prisma, "AuthSession");
  requireCheck(authSessionExists, "AuthSession table", "present", "missing; run db:migrate against this database");
  if (authSessionExists) {
    await checkRequiredColumns(prisma, "AuthSession", [
      "userId",
      "tenantId",
      "tokenHash",
      "expiresAt",
      "revokedAt",
      "lastUsedAt",
      "ipAddress",
      "userAgent",
    ]);
  }

  await checkRequiredColumns(prisma, "User", [
    "passwordHash",
    "passwordChangeRequired",
    "twoFactorEnabled",
    "twoFactorSecretEncrypted",
    "twoFactorRecoveryCodes",
    "twoFactorConfirmedAt",
  ]);

  const resetTokenExists = await tableExists(prisma, "AuthPasswordResetToken");
  requireCheck(resetTokenExists, "AuthPasswordResetToken table", "present", "missing; run db:migrate against this database");
  if (resetTokenExists) {
    await checkRequiredColumns(prisma, "AuthPasswordResetToken", [
      "userId",
      "tokenHash",
      "deliveryMode",
      "expiresAt",
      "usedAt",
    ]);
  }
}

async function checkSeedOwner(prisma) {
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordChangeRequired: true,
      twoFactorEnabled: true,
      memberships: {
        select: {
          role: true,
          tenant: {
            select: {
              name: true,
              slug: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  requireCheck(Boolean(owner), "Seed credential user", ownerEmail, `${ownerEmail} not found; run db:seed or create/update release credentials`);
  if (!owner) return;

  requireCheck(Boolean(owner.passwordHash), "Seed user password hash", "present", "missing; user cannot log in with local credentials");
  strictCheck(
    owner.passwordChangeRequired === false || isTruthy(process.env.LEADVIRT_AUTH_READY_ALLOW_TEMP_PASSWORD),
    "Seed user permanent password",
    "passwordChangeRequired=false",
    "passwordChangeRequired=true; set a permanent staging password or LEADVIRT_AUTH_READY_ALLOW_TEMP_PASSWORD=1",
  );

  const activeMemberships = owner.memberships.filter((membership) => !membership.tenant.deletedAt);
  requireCheck(activeMemberships.length > 0, "Seed user tenant membership", `${activeMemberships.length} active membership(s)`, "no active tenant membership");

  const privilegedMembership = activeMemberships.find((membership) => ["OWNER", "ADMIN"].includes(membership.role));
  requireCheck(
    Boolean(privilegedMembership),
    "Seed user workspace role",
    privilegedMembership ? `${privilegedMembership.role} on ${privilegedMembership.tenant.slug}` : "OWNER/ADMIN",
    "no OWNER/ADMIN membership",
  );

  if (owner.twoFactorEnabled) {
    pass("Seed user 2FA state", "enabled");
  } else {
    warn("Seed user 2FA state", "disabled; enable it for shared staging/admin accounts before broad external access");
  }
}

function checkEnvironment() {
  if (hadExplicitDatabaseUrl) {
    pass("DATABASE_URL", "explicitly set");
  } else {
    warn("DATABASE_URL", `not set; using local default ${localDatabaseUrl}`);
  }

  const twoFactorKey = process.env.AUTH_2FA_ENCRYPTION_KEY ?? "";
  strictCheck(
    Boolean(twoFactorKey) && !twoFactorKey.includes("dev-change-me"),
    "AUTH_2FA_ENCRYPTION_KEY",
    "configured",
    "missing or still set to the dev placeholder",
  );

  strictCheck(
    process.env.AUTH_RATE_LIMIT_DISABLED !== "true",
    "AUTH_RATE_LIMIT_DISABLED",
    "not true",
    "true; public auth endpoints are not rate limited",
  );

  const emailProvider = process.env.EMAIL_PROVIDER ?? "mock";
  strictCheck(
    emailProvider !== "mock",
    "EMAIL_PROVIDER",
    emailProvider,
    "mock; password reset URLs may be exposed for local QA behavior",
  );

  strictCheck(
    nodeEnv === "production",
    "NODE_ENV",
    nodeEnv,
    `${nodeEnv}; production cookie/reset behavior is not active`,
  );

  strictCheck(
    Boolean(process.env.APP_URL) && !String(process.env.APP_URL).includes("localhost"),
    "APP_URL",
    process.env.APP_URL ?? "missing",
    "missing or localhost; reset links and public callbacks will not point at staging/public web",
  );
}

async function checkApiBoundary() {
  const health = await fetchJson(`${apiOrigin}/health`);
  if (!health.ok) {
    strictCheck(false, "API health", `${apiOrigin}/health`, `${apiOrigin}/health (${status(health)})`);
    return;
  }

  pass("API health", `${apiOrigin}/health (${status(health)})`);

  const protectedRoutes = ["/auth/me", "/current-tenant", "/dashboard/summary"];
  for (const route of protectedRoutes) {
    const result = await fetchJson(`${apiBase}${route}`);
    requireCheck(
      result.status === 401,
      `No-cookie ${route}`,
      "401",
      `${status(result)}; protected workspace APIs must not fall back to demo data`,
    );
  }
}

async function main() {
  console.log("LeadVirt Auth Staging Readiness");
  console.log(`Mode: ${strict ? "strict" : "local/warn"}`);
  console.log(`APP_ENV: ${appEnv}`);
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log(`API: ${apiBase}`);
  console.log(`Seed user: ${ownerEmail}`);
  console.log("");

  checkEnvironment();

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await checkDatabaseSchema(prisma);
    await checkSeedOwner(prisma);
  } finally {
    await prisma.$disconnect();
  }

  await checkApiBoundary();

  for (const check of checks) {
    console.log(`${check.level} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  const failures = checks.filter((check) => check.level === "FAIL");
  const warnings = checks.filter((check) => check.level === "WARN");
  console.log("");
  if (failures.length) {
    console.log(`Auth readiness failed: ${failures.length} failure(s), ${warnings.length} warning(s).`);
    process.exitCode = 1;
  } else {
    console.log(`Auth readiness passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
