import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Tenant, type User } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AuthService } from "../../apps/api/src/modules/auth/auth.service.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { SettingsService } from "../../apps/api/src/modules/settings/settings.service.js";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function contextFor(tenant: Tenant, user: User): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role: "OWNER",
    authMode: "credentials",
    tenant: {
      id: tenant.id,
      name: "Stale request name",
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const businessProfile = new BusinessProfileService(
    prisma as unknown as PrismaService,
    {
      syncOnboardingSourcesInTransaction: async () => ({
        eventId: null,
        reconciliationEventIds: [],
      }),
      dispatchOnboardingSync: async () => undefined,
    } as never,
    new KnowledgeV2IdempotencyService(prisma as unknown as PrismaService),
  );
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    {} as AuthService,
    businessProfile,
  );
  let tenantId: string | null = null;
  let userId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Current database name",
        slug: `settings-profile-${suffix}`,
        settings: {
          unrelated: { retained: true },
          profile: {
            logoDataUrl: "data:image/png;base64,QQ==",
            description: "Original description",
            phone: "+33123456789",
            website: "https://old.example.test",
            retainedProfileField: "keep",
          },
          notifications: { new_lead: false },
        },
      },
    });
    const user = await prisma.user.create({
      data: { email: `settings-profile-${suffix}@example.test`, name: "Settings Owner" },
    });
    tenantId = tenant.id;
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const context = contextFor(tenant, user);

    const initial = await service.account(context);
    assert(
      initial.tenant.name === "Current database name",
      "Account returned stale request context.",
    );
    assert(
      initial.description === "Original description",
      "Account omitted the stored description.",
    );
    assert(initial.phone === "+33123456789", "Account omitted the stored phone.");
    assert(initial.website === "https://old.example.test", "Account omitted the stored website.");

    const settingsBackfill = await service.updateAccount(
      context,
      {
        businessName: initial.businessName,
        description: initial.description,
      },
      initial.businessProfileEtag,
    );
    const stateAfterSettingsBackfill = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    const settingsBackfillCompany = record(record(stateAfterSettingsBackfill.data).companyInfo);
    assert(
      settingsBackfill.businessProfileVersion === 1 &&
        stateAfterSettingsBackfill.businessProfileVersion === 1,
      "A fallback-only Settings save incremented the profile version.",
    );
    assert(
      settingsBackfillCompany.name === initial.businessName &&
        settingsBackfillCompany.description === initial.description,
      "A fallback-only Settings no-op did not materialize the canonical profile.",
    );
    assert(
      !Object.prototype.hasOwnProperty.call(settingsBackfillCompany, "weeklySchedule"),
      "An unrelated Settings save invented an explicit weekly schedule.",
    );

    await prisma.onboardingState.delete({ where: { tenantId: tenant.id } });
    const directBackfill = await businessProfile.patch(
      context,
      { profile: { name: initial.businessName } },
      `settings-profile-direct-backfill-${suffix}`,
      initial.businessProfileEtag,
    );
    const stateAfterDirectBackfill = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    assert(
      directBackfill.version === 1 && stateAfterDirectBackfill.businessProfileVersion === 1,
      "A fallback-only direct save incremented the profile version.",
    );
    assert(
      record(record(stateAfterDirectBackfill.data).companyInfo).name === initial.businessName,
      "A fallback-only direct no-op did not materialize the canonical profile.",
    );

    const updated = await service.updateAccount(
      context,
      {
        businessName: "Updated database name",
        description: "  Updated private profile text  ",
        phone: "  +33987654321  ",
      },
      directBackfill.etag,
    );
    assert(updated.businessName === "Updated database name", "Business name was not persisted.");
    assert(
      updated.description === "Updated private profile text",
      "Description was not normalized.",
    );
    assert(updated.phone === "+33987654321", "Phone was not normalized.");
    assert(updated.website === "https://old.example.test", "Partial update erased website.");
    assert(updated.logoDataUrl === "data:image/png;base64,QQ==", "Partial update erased logo.");

    await Promise.all([
      service.updateAccount(context, { website: "https://current.example.test/profile" }),
      service.updateNotifications(context, { daily: true }),
    ]);
    const afterConcurrent = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { settings: true },
    });
    const settings = record(afterConcurrent.settings);
    const profile = record(settings.profile);
    const notifications = record(settings.notifications);
    assert(
      profile.website === "https://current.example.test/profile",
      "Concurrent save lost website.",
    );
    assert(notifications.daily === true, "Concurrent save lost notification settings.");
    assert(
      record(settings.unrelated).retained === true,
      "Concurrent save erased unrelated settings.",
    );
    assert(
      profile.retainedProfileField === "keep",
      "Profile update erased an unknown profile field.",
    );

    const cleared = await service.updateAccount(
      context,
      {
        description: null,
        phone: null,
        website: null,
      },
      updated.businessProfileEtag,
    );
    assert(cleared.description === null, "Description could not be cleared.");
    assert(cleared.phone === null, "Phone could not be cleared.");
    assert(cleared.website === null, "Website could not be cleared.");
    assert(cleared.logoDataUrl === "data:image/png;base64,QQ==", "Clear operation erased logo.");

    const auditLogs = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, action: "settings.account_updated" },
      select: { payload: true },
    });
    const auditJson = JSON.stringify(auditLogs);
    for (const privateValue of [
      "Updated private profile text",
      "+33987654321",
      "https://current.example.test/profile",
      "data:image/png;base64,QQ==",
    ]) {
      assert(
        !auditJson.includes(privateValue),
        `Audit payload leaked profile value: ${privateValue}`,
      );
    }
    assert(
      auditJson.includes("profileFields"),
      "Audit payload omitted changed profile field names.",
    );

    console.log(`Settings account profile smoke: ${checks}/${checks} checks passed`);
  } finally {
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
