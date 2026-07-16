import { randomUUID } from "node:crypto";
import {
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type MembershipRole, type Tenant, type User } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import type { AuthService } from "../../apps/api/src/modules/auth/auth.service.js";
import type { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { SettingsController } from "../../apps/api/src/modules/settings/settings.controller.js";
import { SettingsService } from "../../apps/api/src/modules/settings/settings.service.js";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextFor(
  tenant: Tenant,
  user: User,
  role: MembershipRole,
  claimedRole: MembershipRole = role,
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role: claimedRole,
    authMode: "credentials",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
    },
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      passwordChangeRequired: user.passwordChangeRequired,
    },
  };
}

type ApiKeyControllerMethod = "apiKeys" | "createApiKey" | "revokeApiKey";

function guardContext(methodName: ApiKeyControllerMethod, role: MembershipRole): ExecutionContext {
  const handler = SettingsController.prototype[methodName];
  assert(typeof handler === "function", `SettingsController.${methodName} is missing.`);
  return {
    getHandler: () => handler,
    getClass: () => SettingsController,
    switchToHttp: () => ({ getRequest: () => ({ leadvirtContext: { role } }) }),
  } as unknown as ExecutionContext;
}

async function expectUnavailable(operation: () => unknown | Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof HttpException, "API-key creation did not return an HTTP exception.");
    assert(error.getStatus() === 501, "API-key creation did not return HTTP 501.");
    const response = error.getResponse();
    assert(isRecord(response), "API-key unavailable response was not structured.");
    assert(
      response.code === "API_KEYS_NOT_AVAILABLE",
      "API-key creation returned the wrong stable error code.",
    );
    assert(response.retryable === false, "API-key unavailable response was marked retryable.");
    assert(
      isRecord(response.details) && response.details.capability === "TENANT_API_KEYS",
      "API-key unavailable response omitted capability metadata.",
    );
    const serialized = JSON.stringify(response);
    assert(!serialized.includes("secret"), "API-key unavailable response exposed secret material.");
    return;
  }
  throw new Error("API-key creation unexpectedly succeeded.");
}

async function expectException<T extends Error>(
  operation: () => unknown | Promise<unknown>,
  expected: abstract new (...args: never[]) => T,
  message: string,
) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof expected, message);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  const databaseAccesses: string[] = [];
  const unavailablePrisma = new Proxy(
    {},
    {
      get(_target, property) {
        databaseAccesses.push(String(property));
        throw new Error(`Unavailable API-key creation touched persistence: ${String(property)}`);
      },
    },
  ) as PrismaService;
  const failClosedService = new SettingsService(
    unavailablePrisma,
    {} as AuthService,
    {} as BusinessProfileService,
  );
  const failClosedController = new SettingsController(failClosedService, {} as AuthService);

  await expectUnavailable(() => failClosedService.createApiKey());
  await expectUnavailable(() => failClosedController.createApiKey());
  assert(databaseAccesses.length === 0, "Unavailable API-key creation accessed the database.");

  const rolesGuard = new RolesGuard(new Reflector());
  for (const methodName of ["apiKeys", "createApiKey", "revokeApiKey"] as const) {
    for (const deniedRole of ["MANAGER", "AGENT", "VIEWER"] as const) {
      await expectException(
        () => rolesGuard.canActivate(guardContext(methodName, deniedRole)),
        ForbiddenException,
        `${deniedRole} reached SettingsController.${methodName}.`,
      );
    }
    assert(
      rolesGuard.canActivate(guardContext(methodName, "OWNER")),
      `OWNER cannot reach SettingsController.${methodName}.`,
    );
    assert(
      rolesGuard.canActivate(guardContext(methodName, "ADMIN")),
      `ADMIN cannot reach SettingsController.${methodName}.`,
    );
  }

  const service = new SettingsService(
    prisma as unknown as PrismaService,
    {} as AuthService,
    {} as BusinessProfileService,
  );
  const controller = new SettingsController(service, {} as AuthService);

  try {
    const tenant = await prisma.tenant.create({
      data: { name: "API Key Cleanup", slug: `api-key-cleanup-${suffix}` },
    });
    const otherTenant = await prisma.tenant.create({
      data: { name: "Other API Key Cleanup", slug: `other-api-key-cleanup-${suffix}` },
    });
    tenantIds.push(tenant.id, otherTenant.id);

    const [owner, admin, viewer, otherOwner] = await Promise.all([
      prisma.user.create({ data: { email: `api-key-owner-${suffix}@example.test` } }),
      prisma.user.create({ data: { email: `api-key-admin-${suffix}@example.test` } }),
      prisma.user.create({ data: { email: `api-key-viewer-${suffix}@example.test` } }),
      prisma.user.create({ data: { email: `api-key-other-owner-${suffix}@example.test` } }),
    ]);
    userIds.push(owner.id, admin.id, viewer.id, otherOwner.id);

    await prisma.$transaction([
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: owner.id, role: "OWNER" },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: admin.id, role: "ADMIN" },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: viewer.id, role: "VIEWER" },
      }),
      prisma.membership.create({
        data: { tenantId: otherTenant.id, userId: otherOwner.id, role: "OWNER" },
      }),
    ]);

    const [legacyAdminCleanup, legacyOwnerCleanup, alreadyRevoked, otherTenantKey] =
      await prisma.$transaction([
        prisma.apiKey.create({
          data: {
            tenantId: tenant.id,
            name: "Legacy admin cleanup",
            keyPrefix: `lv_a_${suffix.slice(-8)}`,
            keyHash: "sha256:legacy-private-material-admin",
            scopes: ["workspace:*"],
          },
        }),
        prisma.apiKey.create({
          data: {
            tenantId: tenant.id,
            name: "Legacy owner cleanup",
            keyPrefix: `lv_o_${suffix.slice(-8)}`,
            keyHash: "sha256:legacy-private-material-owner",
            scopes: ["settings:write"],
          },
        }),
        prisma.apiKey.create({
          data: {
            tenantId: tenant.id,
            name: "Already revoked",
            keyPrefix: `lv_r_${suffix.slice(-8)}`,
            keyHash: "sha256:legacy-private-material-revoked",
            revokedAt: new Date(),
          },
        }),
        prisma.apiKey.create({
          data: {
            tenantId: otherTenant.id,
            name: "Other tenant legacy key",
            keyPrefix: `lv_x_${suffix.slice(-8)}`,
            keyHash: "sha256:legacy-private-material-other",
            scopes: ["tenant:other"],
          },
        }),
      ]);

    const ownerContext = contextFor(tenant, owner, "OWNER");
    const adminContext = contextFor(tenant, admin, "ADMIN");
    const forgedViewerContext = contextFor(tenant, viewer, "VIEWER", "OWNER");

    const keyCountBeforeCreate = await prisma.apiKey.count({ where: { tenantId: tenant.id } });
    const createAuditCountBefore = await prisma.auditLog.count({
      where: { tenantId: tenant.id, action: "settings.api_key_created" },
    });
    await expectUnavailable(() => controller.createApiKey());
    assert(
      (await prisma.apiKey.count({ where: { tenantId: tenant.id } })) === keyCountBeforeCreate,
      "Rejected API-key creation wrote a key row.",
    );
    assert(
      (await prisma.auditLog.count({
        where: { tenantId: tenant.id, action: "settings.api_key_created" },
      })) === createAuditCountBefore,
      "Rejected API-key creation wrote an audit row.",
    );

    const billing = service.billing();
    assert(billing.apiKeys.length === 0, "Billing exposed dormant API-key rows.");

    const listed = await controller.apiKeys(ownerContext);
    assert(listed.data.length === 2, "Owner cleanup list returned the wrong active-row count.");
    assert(
      listed.data.every((key) => key.status === "INERT" && key.cleanupOnly),
      "Cleanup list represented a dormant key as operational.",
    );
    assert(
      !listed.data.some((key) => key.id === alreadyRevoked.id || key.id === otherTenantKey.id),
      "Cleanup list exposed revoked or cross-tenant rows.",
    );
    const listJson = JSON.stringify(listed);
    for (const forbidden of [
      "legacy-private-material",
      "workspace:*",
      "settings:write",
      "keyHash",
      "scopes",
      "secret",
    ]) {
      assert(!listJson.includes(forbidden), `Cleanup list exposed ${forbidden}.`);
    }

    await expectException(
      () => service.revokeApiKey(forgedViewerContext, legacyAdminCleanup.id),
      ForbiddenException,
      "A VIEWER revoked a legacy key with a forged OWNER context.",
    );
    assert(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: legacyAdminCleanup.id } }))
        .revokedAt === null,
      "Rejected VIEWER cleanup changed the legacy row.",
    );

    await expectException(
      () => service.revokeApiKey(ownerContext, otherTenantKey.id),
      NotFoundException,
      "An OWNER revoked another tenant's legacy key.",
    );
    assert(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: otherTenantKey.id } })).revokedAt ===
        null,
      "Cross-tenant cleanup changed the target row.",
    );

    const adminResult = await controller.revokeApiKey(adminContext, legacyAdminCleanup.id);
    const ownerResult = await controller.revokeApiKey(ownerContext, legacyOwnerCleanup.id);
    assert(adminResult.data.revoked && ownerResult.data.revoked, "Legacy cleanup did not succeed.");
    assert(
      (await prisma.apiKey.count({
        where: {
          id: { in: [legacyAdminCleanup.id, legacyOwnerCleanup.id] },
          revokedAt: { not: null },
        },
      })) === 2,
      "Legacy cleanup did not retain both rows as revoked history.",
    );
    assert(
      (await controller.apiKeys(ownerContext)).data.length === 0,
      "Revoked legacy rows remained in the cleanup list.",
    );

    const cleanupAudits = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, action: "settings.api_key_revoked" },
      select: { actorUserId: true, entityId: true, payload: true },
    });
    assert(cleanupAudits.length === 2, "Legacy cleanup wrote an incorrect audit count.");
    assert(
      cleanupAudits.every(
        (entry) =>
          (entry.actorUserId === owner.id || entry.actorUserId === admin.id) &&
          (entry.entityId === legacyAdminCleanup.id || entry.entityId === legacyOwnerCleanup.id),
      ),
      "Legacy cleanup audit attribution is invalid.",
    );
    const auditJson = JSON.stringify(cleanupAudits);
    for (const forbidden of [
      "legacy-private-material",
      "workspace:*",
      "settings:write",
      "keyHash",
      "scopes",
      "secret",
    ]) {
      assert(!auditJson.includes(forbidden), `Cleanup audit exposed ${forbidden}.`);
    }
    assert(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: otherTenantKey.id } })).revokedAt ===
        null,
      "Other tenant's legacy key changed during cleanup.",
    );

    console.log(`Settings API-key truthful-state smoke: ${checks}/${checks} checks passed`);
  } finally {
    if (tenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
