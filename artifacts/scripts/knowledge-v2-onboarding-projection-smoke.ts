import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { strongKnowledgeV2Etag } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2MigrationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-migration.service.js";
import { KnowledgeV2OnboardingProjectionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-onboarding-projection.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
    businessType: string | null;
    timezone: string;
  },
  user: {
    id: string;
    email: string;
    phone: string | null;
    name: string | null;
    avatarUrl: string | null;
    passwordChangeRequired: boolean;
  },
  role: RequestContext["role"] = "OWNER",
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "email",
    tenant,
    user,
  };
}

async function createFixture(prisma: PrismaService, userId: string, stamp: string, suffix: string) {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Projection ${suffix}`,
      slug: `projection-${suffix}-${stamp}`,
      settings: { locale: "en" },
    },
  });
  await prisma.membership.create({
    data: { tenantId: tenant.id, userId, role: "OWNER" },
  });
  const availability = `Available now ${suffix} ${stamp}`;
  const servicesCatalog = `Service catalog ${suffix} ${stamp}`;
  const policy = `Confirm every commitment ${suffix} ${stamp}`;
  await prisma.onboardingState.create({
    data: {
      tenantId: tenant.id,
      data: { companyInfo: { availability, servicesCatalog, policies: policy } },
    },
  });
  return { tenant, availability, servicesCatalog, policy };
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [ownerUser, managerUser] = await Promise.all([
      prisma.user.create({
        data: { email: `projection-owner-${stamp}@example.test`, name: "Projection owner" },
      }),
      prisma.user.create({
        data: { email: `projection-manager-${stamp}@example.test`, name: "Projection manager" },
      }),
    ]);
    userIds.push(ownerUser.id, managerUser.id);
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const projection = new KnowledgeV2OnboardingProjectionService();

    const manualFixture = await createFixture(prisma, ownerUser.id, stamp, "manual");
    tenantIds.push(manualFixture.tenant.id);
    await prisma.membership.create({
      data: { tenantId: manualFixture.tenant.id, userId: managerUser.id, role: "MANAGER" },
    });
    const manualContext = context(manualFixture.tenant, ownerUser);
    const managerContext = context(manualFixture.tenant, managerUser, "MANAGER");
    const manualMigration = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      projection,
    );
    await manualMigration.start(manualContext, {}, `manual-start-${stamp}`);

    const manualKnowledge = new KnowledgeV2Service(prisma, idempotency);
    const catalogFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "catalog/summary",
        },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { evidence: true },
        },
      },
    });
    const catalogHead = catalogFact.versions[0]!;
    assert(
      catalogHead.displayValue === manualFixture.servicesCatalog &&
        catalogHead.riskLevel === "HIGH" &&
        (catalogHead.scope as { audiences?: string[] } | null)?.audiences?.includes("PUBLIC") ===
          true &&
        catalogHead.evidence.length === 1 &&
        catalogHead.evidence[0]?.isPublic === true,
      "Free-text onboarding catalog was not projected as HIGH/PUBLIC.",
    );
    let managerVerificationDenied = false;
    try {
      await manualKnowledge.verifyFact(
        managerContext,
        catalogFact.id,
        { note: "Manager must not verify free-text catalog terms." },
        `manager-catalog-verify-${stamp}`,
        [strongKnowledgeV2Etag("fact", catalogFact.id, catalogFact.etag)],
      );
    } catch (error) {
      managerVerificationDenied = error instanceof HttpException && error.getStatus() === 403;
    }
    assert(
      managerVerificationDenied &&
        (await prisma.knowledgeV2FactVersion.count({ where: { factId: catalogFact.id } })) === 1,
      "Manager verified a HIGH-risk free-text onboarding catalog.",
    );
    const initialFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
    });
    const initialRule = await prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
      where: {
        tenantId_ruleKey: {
          tenantId: manualFixture.tenant.id,
          ruleKey: "onboarding/policy",
        },
      },
    });
    await manualKnowledge.updateFact(
      manualContext,
      initialFact.id,
      {
        normalizedValue: manualFixture.availability,
        displayValue: manualFixture.availability,
        scope: { audiences: ["PUBLIC"], locales: ["en"] },
        riskLevel: "LOW",
        changeReason: "Owner controls availability policy.",
      },
      `manual-fact-${stamp}`,
      [strongKnowledgeV2Etag("fact", initialFact.id, initialFact.etag)],
    );
    await manualKnowledge.updateGuidanceRule(
      manualContext,
      initialRule.id,
      {
        instruction: manualFixture.policy,
        condition: {
          kind: "PREDICATE",
          field: "CHANNEL",
          operator: "EQUALS",
          value: "TELEGRAM",
        },
        priority: 900,
        scope: { audiences: ["INTERNAL"], locales: ["en"] },
        riskLevel: "HIGH",
        requiredApproverRole: "OWNER",
        changeReason: "Owner controls response policy.",
      },
      `manual-rule-${stamp}`,
      [strongKnowledgeV2Etag("guidance-rule", initialRule.id, initialRule.etag)],
    );

    const manualEventCount = await prisma.knowledgeOutbox.count({
      where: {
        tenantId: manualFixture.tenant.id,
        eventType: "knowledge.v2.content-reconciliation.requested",
      },
    });
    await manualMigration.start(manualContext, {}, `manual-reconcile-${stamp}`);
    const [protectedFact, protectedRule, factReview, ruleReview, protectedSettings] =
      await Promise.all([
        prisma.knowledgeV2Fact.findUniqueOrThrow({
          where: { id: initialFact.id },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { evidence: true },
            },
          },
        }),
        prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
          where: { id: initialRule.id },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { evidence: true },
            },
          },
        }),
        prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: {
            tenantId_reviewKey: {
              tenantId: manualFixture.tenant.id,
              reviewKey: ["onboarding-projection-v1", "ownership", "FACT", initialFact.id].join(
                ":",
              ),
            },
          },
        }),
        prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: {
            tenantId_reviewKey: {
              tenantId: manualFixture.tenant.id,
              reviewKey: [
                "onboarding-projection-v1",
                "ownership",
                "GUIDANCE_RULE",
                initialRule.id,
              ].join(":"),
            },
          },
        }),
        prisma.knowledgeV2Settings.findUniqueOrThrow({
          where: { tenantId: manualFixture.tenant.id },
        }),
      ]);
    assert(
      protectedFact.latestVersionNumber === 2 &&
        protectedFact.versions[0]?.displayValue === manualFixture.availability &&
        protectedFact.versions[0].riskLevel === "LOW" &&
        protectedFact.versions[0].evidence.some(
          (item) =>
            (item.sourceReference as { origin?: string } | null)?.origin === "knowledge_editor",
        ),
      "Same-text onboarding projection replaced the editor-owned fact policy.",
    );
    assert(
      protectedRule.latestVersionNumber === 2 &&
        protectedRule.versions[0]?.instruction === manualFixture.policy &&
        protectedRule.versions[0].priority === 900 &&
        protectedRule.versions[0].evidence.some(
          (item) =>
            (item.sourceReference as { origin?: string } | null)?.origin === "knowledge_editor",
        ),
      "Same-text onboarding projection replaced the editor-owned guidance policy.",
    );
    assert(
      factReview.status === "OPEN" &&
        ruleReview.status === "OPEN" &&
        factReview.reason === "CONFLICTING_VALUES" &&
        ruleReview.reason === "CONFLICTING_VALUES",
      "Editor-owned material differences did not create ownership review work.",
    );
    assert(
      (await prisma.knowledgeOutbox.count({
        where: {
          tenantId: manualFixture.tenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
      })) === manualEventCount,
      "Ownership reconciliation enqueued onboarding successors.",
    );

    await manualMigration.start(manualContext, {}, `manual-idempotent-${stamp}`);
    const [manualSettingsAfterReplay, manualVersionsAfterReplay] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: manualFixture.tenant.id },
      }),
      Promise.all([
        prisma.knowledgeV2FactVersion.count({ where: { factId: initialFact.id } }),
        prisma.knowledgeV2GuidanceRuleVersion.count({ where: { guidanceRuleId: initialRule.id } }),
      ]),
    ]);
    assert(
      manualSettingsAfterReplay.draftGeneration === protectedSettings.draftGeneration &&
        manualVersionsAfterReplay[0] === 2 &&
        manualVersionsAfterReplay[1] === 2,
      "Identical migration reconciliation duplicated ownership work.",
    );

    const staleFixture = await createFixture(prisma, ownerUser.id, stamp, "stale");
    tenantIds.push(staleFixture.tenant.id);
    const staleContext = context(staleFixture.tenant, ownerUser);
    const staleMigration = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      projection,
    );
    await staleMigration.start(staleContext, {}, `stale-start-${stamp}`);
    const staleFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: staleFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const staleRule = await prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
      where: {
        tenantId_ruleKey: {
          tenantId: staleFixture.tenant.id,
          ruleKey: "onboarding/policy",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const staleFactHead = staleFact.versions[0]!;
    const staleRuleHead = staleRule.versions[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeV2FactVersion.update({
        where: { id: staleFactHead.id },
        data: {
          scope: { audiences: ["PUBLIC"], locales: ["en"] },
          riskLevel: "LOW",
        },
      });
      await tx.knowledgeV2Evidence.updateMany({
        where: { factVersionId: staleFactHead.id },
        data: { isPublic: true },
      });
      await tx.knowledgeV2GuidanceRuleVersion.update({
        where: { id: staleRuleHead.id },
        data: {
          conditionAst: {
            kind: "PREDICATE",
            field: "CHANNEL",
            operator: "EQUALS",
            value: "EMAIL",
          },
          priority: 999,
          scope: { audiences: ["INTERNAL"], locales: ["en"] },
          riskLevel: "HIGH",
          requiredApproverRole: "OWNER",
        },
      });
      await tx.knowledgeV2Evidence.updateMany({
        where: { guidanceRuleVersionId: staleRuleHead.id },
        data: { isPublic: false },
      });
    });

    await staleMigration.start(staleContext, {}, `stale-repair-${stamp}`);
    const [repairedFact, repairedRule, repairedSettings] = await Promise.all([
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: { id: staleFact.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
      }),
      prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
        where: { id: staleRule.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
      }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: staleFixture.tenant.id },
      }),
    ]);
    const repairedFactHead = repairedFact.versions[0]!;
    const repairedRuleHead = repairedRule.versions[0]!;
    assert(
      repairedFact.latestVersionNumber === 2 &&
        repairedFactHead.supersedesVersionId === staleFactHead.id &&
        repairedFactHead.displayValue === staleFixture.availability &&
        repairedFactHead.riskLevel === "HIGH" &&
        (repairedFactHead.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "INTERNAL",
        ) === true &&
        repairedFactHead.evidence.length === 1 &&
        repairedFactHead.evidence[0]?.isPublic === false,
      "Identical-data migration start did not repair stale onboarding fact policy.",
    );
    assert(
      repairedRule.latestVersionNumber === 2 &&
        repairedRuleHead.supersedesVersionId === staleRuleHead.id &&
        repairedRuleHead.instruction === staleFixture.policy &&
        repairedRuleHead.priority === 100 &&
        repairedRuleHead.riskLevel === "MEDIUM" &&
        repairedRuleHead.requiredApproverRole === "ADMIN" &&
        (repairedRuleHead.conditionAst as { kind?: string }).kind === "ALL" &&
        (repairedRuleHead.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "PUBLIC",
        ) === true &&
        repairedRuleHead.evidence.length === 1 &&
        repairedRuleHead.evidence[0]?.isPublic === true,
      "Identical-data migration start did not repair stale onboarding guidance policy.",
    );

    await staleMigration.start(staleContext, {}, `stale-idempotent-${stamp}`);
    const [staleSettingsAfterReplay, repairedFactVersionCount, repairedRuleVersionCount] =
      await Promise.all([
        prisma.knowledgeV2Settings.findUniqueOrThrow({
          where: { tenantId: staleFixture.tenant.id },
        }),
        prisma.knowledgeV2FactVersion.count({ where: { factId: staleFact.id } }),
        prisma.knowledgeV2GuidanceRuleVersion.count({ where: { guidanceRuleId: staleRule.id } }),
      ]);
    assert(
      staleSettingsAfterReplay.draftGeneration === repairedSettings.draftGeneration &&
        repairedFactVersionCount === 2 &&
        repairedRuleVersionCount === 2,
      "Already-current onboarding heads were not idempotent.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        manualOwnershipReviews: 2,
        repairedOnboardingHeads: 2,
        manualDraftGeneration: manualSettingsAfterReplay.draftGeneration,
        repairedDraftGeneration: staleSettingsAfterReplay.draftGeneration,
      }),
    );
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
