import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type TenantStatus } from "@leadvirt/db";
import { RequestMethod, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/src/app.module.js";
import { HttpExceptionFilter } from "../../apps/api/src/common/filters/http-exception.filter.js";
import { canInactiveTenantAccessRoute } from "../../apps/api/src/modules/auth/workspace-auth.guard.js";
import { hashPassword } from "../../apps/api/src/modules/auth/passwords.js";

loadEnvFile();
process.env.DATABASE_URL =
  process.env.LEADVIRT_QA_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
process.env.REDIS_URL = process.env.LEADVIRT_QA_REDIS_URL ?? "redis://localhost:6380";
process.env.PORT = "4001";

const apiOrigin = "http://localhost:4001";
const apiBase = `${apiOrigin}/api`;
const inactiveCode = "TENANT_INACTIVE";

type JsonRecord = Record<string, unknown>;

interface ApiResult {
  status: number;
  payload: unknown;
  headers: Headers;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown, label: string): JsonRecord {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} is not an object.`,
  );
  return value as JsonRecord;
}

function successData(result: ApiResult) {
  assert(
    result.status >= 200 && result.status < 300,
    `Expected success, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  return asRecord(result.payload, "response payload").data;
}

function responseData(result: ApiResult) {
  return asRecord(successData(result), "response data");
}

function expectInactive(result: ApiResult, status: "SUSPENDED" | "CANCELLED") {
  assert(
    result.status === 403,
    `Expected HTTP 403 for ${status}, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  const error = asRecord(asRecord(result.payload, "error payload").error, "error");
  const details = asRecord(error.details, "error details");
  assert(error.code === inactiveCode, `Expected ${inactiveCode}, received ${String(error.code)}.`);
  assert(error.retryable === false, "Inactive tenant error must not be marked retryable.");
  assert(details.status === status, `Expected current status ${status} in error details.`);
}

async function request(path: string, options: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-leadvirt-qa": "playwright",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { text };
    }
  }
  return { status: response.status, payload, headers: response.headers };
}

async function publicRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, options);
  return { status: response.status, body: await response.text() };
}

async function apiIsRunning() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`${apiOrigin}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // The development API can be between hot-reload generations.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startApiIfNeeded(): Promise<INestApplication | null> {
  if (await apiIsRunning()) return null;

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
      { path: "metrics", method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(4001);
  return app;
}

function assertRoutePolicy() {
  const allowed = [
    ["OPTIONS", "/api/dashboard/summary"],
    ["GET", "/api/auth/me"],
    ["GET", "/api/me"],
    ["GET", "/api/current-tenant?fresh=true"],
    ["POST", "/api/auth/logout"],
    ["PATCH", "/api/settings/preferences/locale"],
    ["GET", "/api/settings/security"],
    ["PATCH", "/api/settings/security/password"],
    ["POST", "/api/settings/security/2fa/setup"],
    ["POST", "/api/settings/security/2fa/enable"],
    ["POST", "/api/settings/security/2fa/disable"],
    ["POST", "/api/settings/security/2fa/recovery-codes"],
    ["DELETE", "/api/settings/security/sessions/session-id"],
    ["POST", "/api/settings/security/sessions/revoke-others"],
    ["GET", "/api/settings/billing"],
    ["GET", "/api/billing/plans/"],
    ["POST", "/api/billing/payment-method/change-request"],
    ["PATCH", "/api/billing/current-subscription"],
  ] as const;
  const denied = [
    ["GET", "/api/tenants"],
    ["GET", "/api/dashboard/summary"],
    ["POST", "/api/channels"],
    ["GET", "/api/settings/account"],
    ["POST", "/api/settings/api-keys"],
    ["POST", "/api/billing/current-subscription/cancel"],
    ["POST", "/api/public/widget/key/messages"],
  ] as const;

  for (const [method, url] of allowed) {
    assert(
      canInactiveTenantAccessRoute({ method, originalUrl: url, url }),
      `${method} ${url} must remain available to inactive tenants.`,
    );
  }
  for (const [method, url] of denied) {
    assert(
      !canInactiveTenantAccessRoute({ method, originalUrl: url, url }),
      `${method} ${url} must be blocked for inactive tenants.`,
    );
  }
}

async function runtimeCounts(tenantId: string) {
  const [webhookEvents, leads, conversations, messages, workflowRuns, runtimeOutbox] =
    await Promise.all([
      prisma.webhookEvent.count({ where: { tenantId } }),
      prisma.lead.count({ where: { tenantId } }),
      prisma.conversation.count({ where: { tenantId } }),
      prisma.message.count({ where: { tenantId } }),
      prisma.workflowRun.count({ where: { tenantId } }),
      prisma.runtimeOutbox.count({ where: { tenantId } }),
    ]);
  return { webhookEvents, leads, conversations, messages, workflowRuns, runtimeOutbox };
}

async function assertInactiveBoundary(input: {
  status: "SUSPENDED" | "CANCELLED";
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  cookie: string;
  keys: { widget: string; telegram: string; webhook: string };
}) {
  await prisma.tenant.update({ where: { id: input.tenantId }, data: { status: input.status } });

  const authMe = await request("/auth/me", { headers: { cookie: input.cookie } });
  const authData = responseData(authMe);
  assert(authData.tenantId === input.tenantId, "auth/me returned a different tenant.");

  const currentTenant = responseData(
    await request("/current-tenant", { headers: { cookie: input.cookie } }),
  );
  assert(currentTenant.status === input.status, "current-tenant did not refresh tenant status.");

  responseData(await request("/settings/security", { headers: { cookie: input.cookie } }));
  responseData(await request("/settings/billing", { headers: { cookie: input.cookie } }));
  const locale = responseData(
    await request("/settings/preferences/locale", {
      method: "PATCH",
      headers: { cookie: input.cookie },
      body: JSON.stringify({ locale: input.status === "SUSPENDED" ? "fr" : "de" }),
    }),
  );
  assert(
    locale.locale === (input.status === "SUSPENDED" ? "fr" : "de"),
    "Locale recovery route failed.",
  );
  successData(await request("/billing/plans", { headers: { cookie: input.cookie } }));
  responseData(
    await request("/billing/payment-method/change-request", {
      method: "POST",
      headers: { cookie: input.cookie },
    }),
  );

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  responseData(login);
  const recoveryCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(recoveryCookie, `Credential login failed for ${input.status}.`);

  expectInactive(await request("/tenants", { headers: { cookie: input.cookie } }), input.status);
  expectInactive(
    await request("/channels", {
      method: "POST",
      headers: { cookie: input.cookie },
      body: "{}",
    }),
    input.status,
  );

  const before = await runtimeCounts(input.tenantId);
  expectInactive(await request(`/public/widget/${input.keys.widget}/config`), input.status);
  expectInactive(
    await request(`/public/widget/${input.keys.widget}/messages`, {
      method: "POST",
      body: JSON.stringify({
        sessionId: `tenant-lifecycle-${input.status.toLowerCase()}`,
        clientMessageId: `widget-${input.status.toLowerCase()}`,
        text: "This message must not enter an inactive workspace.",
      }),
    }),
    input.status,
  );
  expectInactive(
    await request(`/public/channels/telegram/${input.keys.telegram}/webhook`, {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    }),
    input.status,
  );
  expectInactive(
    await request(`/public/channels/webhook/${input.keys.webhook}/events`, {
      method: "POST",
      body: JSON.stringify({ eventId: `event-${input.status.toLowerCase()}` }),
    }),
    input.status,
  );
  const after = await runtimeCounts(input.tenantId);
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    `${input.status} public intake created runtime side effects.`,
  );

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { cookie: recoveryCookie },
  });
  responseData(logout);
  const storedLocale = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { locale: true },
  });
  assert(storedLocale.locale === locale.locale, "Locale preference was not persisted.");
}

async function main() {
  assertRoutePolicy();
  const ownedApp = await startApiIfNeeded();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `tenant-lifecycle-${suffix}@yandex.ru`;
  const password = `Tenant-lifecycle-${suffix}!`;
  let tenantId: string | null = null;
  let userId: string | null = null;

  try {
    const health = await publicRequest("/health");
    assert(health.status === 200, `Health check failed with ${health.status}.`);
    const metrics = await publicRequest("/metrics");
    assert(metrics.status === 200, `Metrics check failed with ${metrics.status}.`);

    const tenant = await prisma.tenant.create({
      data: {
        name: "Tenant Lifecycle Smoke",
        slug: `tenant-lifecycle-${suffix}`,
        status: "TRIALING",
      },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: {
        email,
        name: "Tenant Lifecycle Owner",
        passwordHash: hashPassword(password),
      },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });

    const keys = {
      widget: `lifecycle-widget-${suffix}`,
      telegram: `lifecycle-telegram-${suffix}`,
      webhook: `lifecycle-webhook-${suffix}`,
    };
    await prisma.channel.createMany({
      data: [
        {
          tenantId: tenant.id,
          type: "WEBSITE",
          status: "ACTIVE",
          name: "Lifecycle Website",
          publicKey: keys.widget,
          settings: { widget: { title: "Lifecycle Widget" } },
        },
        {
          tenantId: tenant.id,
          type: "TELEGRAM",
          status: "ACTIVE",
          name: "Lifecycle Telegram",
          publicKey: keys.telegram,
          settings: { telegram: { webhookSecret: "lifecycle-telegram-secret" } },
        },
        {
          tenantId: tenant.id,
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "Lifecycle Webhook",
          publicKey: keys.webhook,
          settings: { webhook: { secret: "lifecycle-webhook-secret" } },
        },
      ],
    });

    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    responseData(login);
    const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
    assert(sessionCookie, "Initial credential login did not return a session cookie.");

    successData(await request("/tenants", { headers: { cookie: sessionCookie } }));
    responseData(await request(`/public/widget/${keys.widget}/config`));
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });
    successData(await request("/tenants", { headers: { cookie: sessionCookie } }));
    responseData(await request(`/public/widget/${keys.widget}/config`));

    for (const status of ["SUSPENDED", "CANCELLED"] satisfies TenantStatus[]) {
      assert(status === "SUSPENDED" || status === "CANCELLED", "Unexpected inactive status.");
      await assertInactiveBoundary({
        status,
        tenantId: tenant.id,
        userId: user.id,
        email,
        password,
        cookie: sessionCookie,
        keys,
      });
    }

    const finalHealth = await publicRequest("/health");
    const finalMetrics = await publicRequest("/metrics");
    assert(finalHealth.status === 200, "Tenant state affected health liveness.");
    assert(finalMetrics.status === 200, "Tenant state affected metrics availability.");

    console.log(
      JSON.stringify({
        ok: true,
        activeStatuses: ["TRIALING", "ACTIVE"],
        inactiveStatuses: ["SUSPENDED", "CANCELLED"],
        errorCode: inactiveCode,
        recoveryRoutes: ["identity", "security", "sessions", "locale", "billing"],
        publicIngress: ["WEBSITE", "TELEGRAM", "WEBHOOK"],
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await ownedApp?.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
