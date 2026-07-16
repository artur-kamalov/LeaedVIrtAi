import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeSourceQueueService } from "../../apps/api/src/modules/knowledge/knowledge-source-queue.service.js";
import { KnowledgeV2BulkReviewService } from "../../apps/api/src/modules/knowledge/knowledge-v2-bulk-review.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "../../apps/api/src/modules/knowledge/knowledge-v2-conflict-candidate-reader.service.js";
import {
  canonicalKnowledgeV2Hash,
  strongKnowledgeV2Etag,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2ReviewDecisionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.js";
import { KnowledgeV2ReviewService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review.service.js";
import { KnowledgeV2SourceService } from "../../apps/api/src/modules/knowledge/knowledge-v2-source.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks += 1;
}

function context(
  tenant: RequestContext["tenant"],
  user: RequestContext["user"],
  role: RequestContext["role"],
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "credentials",
    tenant,
    user,
  };
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : null;
}

async function expectError(action: Promise<unknown>, status: number, code: string) {
  try {
    await action;
  } catch (error) {
    check(
      error instanceof HttpException && error.getStatus() === status,
      `Expected HTTP ${status}.`,
    );
    check(errorCode(error) === code, `Expected ${code}, received ${String(errorCode(error))}.`);
    return;
  }
  throw new Error(`Expected ${status} ${code}.`);
}

async function expectFailure(action: Promise<unknown>) {
  try {
    await action;
  } catch {
    checks += 1;
    return;
  }
  throw new Error("Expected transaction failure.");
}

async function cleanup(prisma: PrismaService, tenantIds: string[], userIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.knowledgeV2ReviewItemEvidence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2ConflictCandidateEvidence.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await tx.knowledgeV2ReviewItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2ConflictCandidate.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Conflict.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2FactVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Fact.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2GuidanceRuleVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2GuidanceRule.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2DeletionLedger.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Source.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeInbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.runtimeOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeJobAttempt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function main() {
  const prisma = new PrismaService();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  await prisma.$connect();
  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Bulk review smoke", slug: `bulk-review-${stamp}` },
    });
    const otherTenant = await prisma.tenant.create({
      data: { name: "Bulk review other", slug: `bulk-review-other-${stamp}` },
    });
    tenantIds.push(tenant.id, otherTenant.id);
    const [ownerUser, managerUser, otherOwnerUser] = await Promise.all([
      prisma.user.create({ data: { email: `bulk-owner-${stamp}@example.test`, name: "Owner" } }),
      prisma.user.create({
        data: { email: `bulk-manager-${stamp}@example.test`, name: "Manager" },
      }),
      prisma.user.create({ data: { email: `bulk-other-${stamp}@example.test`, name: "Other" } }),
    ]);
    userIds.push(ownerUser.id, managerUser.id, otherOwnerUser.id);
    await prisma.membership.createMany({
      data: [
        { tenantId: tenant.id, userId: ownerUser.id, role: "OWNER" },
        { tenantId: tenant.id, userId: managerUser.id, role: "MANAGER" },
        { tenantId: otherTenant.id, userId: otherOwnerUser.id, role: "OWNER" },
      ],
    });
    const owner = context(tenant, ownerUser, "OWNER");
    const manager = context(tenant, managerUser, "MANAGER");
    const otherOwner = context(otherTenant, otherOwnerUser, "OWNER");
    const jwtSecret = `bulk-review-secret-${randomBytes(16).toString("hex")}`;
    const config = {
      env: { JWT_SECRET: jwtSecret },
    } as AppConfigService;
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const reader = new KnowledgeV2ConflictCandidateReaderService(prisma, config);
    const decisions = new KnowledgeV2ReviewDecisionService(
      prisma,
      new KnowledgeV2Service(prisma, idempotency),
      {} as KnowledgeV2SourceService,
      {} as KnowledgeSourceQueueService,
      reader,
    );
    decisions.dispatchSoon = () => undefined;
    const reviews = new KnowledgeV2ReviewService(prisma, idempotency, decisions, reader);
    const bulk = new KnowledgeV2BulkReviewService(prisma, idempotency, decisions, config);

    let sequence = 0;
    const seedSource = async (label: string) => {
      sequence += 1;
      return prisma.knowledgeV2Source.create({
        data: {
          tenantId: tenant.id,
          kind: "MANUAL",
          displayName: label,
          externalRootKey: `bulk-source-${sequence}-${stamp}`,
          status: "READY",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
          createdByUserId: ownerUser.id,
          updatedByUserId: ownerUser.id,
        },
      });
    };
    const primarySource = await seedSource("Primary source");
    const otherSource = await seedSource("Other source");

    const seedReview = async (input: {
      label: string;
      sourceId?: string;
      fieldType?: string;
      riskLevel?: "LOW" | "MEDIUM";
      reason?: "LOW_CONFIDENCE_CONTENT" | "INFERRED_HIGH_RISK";
      suggestedAction?: "APPROVE" | "REJECT";
      conflictId?: string;
      restrictedPayloadRef?: string;
    }) => {
      sequence += 1;
      const fact = await prisma.knowledgeV2Fact.create({
        data: {
          tenantId: tenant.id,
          factKey: `bulk.fact.${sequence}.${stamp}`,
          entityType: "business",
          fieldType: input.fieldType ?? "text",
          latestVersionNumber: 1,
          createdByUserId: ownerUser.id,
          updatedByUserId: ownerUser.id,
        },
      });
      await prisma.knowledgeV2FactVersion.create({
        data: {
          tenantId: tenant.id,
          factId: fact.id,
          versionNumber: 1,
          normalizedValue: input.label,
          displayValue: input.label,
          immutableHash: `bulk-fact-${sequence}-${stamp}`,
          createdByUserId: ownerUser.id,
        },
      });
      const review = await prisma.knowledgeV2ReviewItem.create({
        data: {
          tenantId: tenant.id,
          reviewKey: `bulk-review:${sequence}:${stamp}`,
          reason: input.reason ?? "LOW_CONFIDENCE_CONTENT",
          riskLevel: input.riskLevel ?? "LOW",
          suggestedAction: input.suggestedAction ?? "APPROVE",
          safeTitle: input.label,
          sourceId: input.sourceId ?? primarySource.id,
          factId: fact.id,
          conflictId: input.conflictId,
          restrictedPayloadRef: input.restrictedPayloadRef,
          createdByUserId: ownerUser.id,
        },
      });
      return { fact, review };
    };

    const one = await seedReview({ label: "Eligible one" });
    const two = await seedReview({ label: "Eligible two" });
    await expectError(
      bulk.preview(manager, { itemIds: [one.review.id, two.review.id], action: "APPROVE" }),
      403,
      "KNOWLEDGE_PERMISSION_BULK_REVIEW_DENIED",
    );
    const isolated = await bulk.preview(otherOwner, {
      itemIds: [one.review.id],
      action: "APPROVE",
    });
    check(
      !isolated.eligible && isolated.items[0]?.reasons.includes("NOT_FOUND"),
      "Cross-tenant item was disclosed by preview.",
    );
    const eligible = await bulk.preview(owner, {
      itemIds: [two.review.id, one.review.id],
      action: "APPROVE",
    });
    check(
      eligible.eligible && Boolean(eligible.previewHash) && Boolean(eligible.expiresAt),
      "Eligible preview did not produce a signed expiry.",
    );
    check(
      eligible.items.length === 2 && eligible.items.every((item) => item.etag && item.generation),
      "Preview omitted exact item ETags or generations.",
    );
    const eligibleItems = eligible.items.map((item) => ({ id: item.id, etag: item.etag! }));
    const tamperedHash = `${eligible.previewHash!.slice(0, -1)}${eligible.previewHash!.endsWith("0") ? "1" : "0"}`;
    await expectError(
      bulk.execute(
        owner,
        {
          action: "APPROVE",
          items: eligibleItems,
          previewHash: tamperedHash,
          previewExpiresAt: eligible.expiresAt!,
        },
        `tampered-preview-${stamp}`,
      ),
      412,
      "REVISION_CONFLICT",
    );
    const undomainedHash = createHmac("sha256", jwtSecret)
      .update(
        canonicalKnowledgeV2Hash({
          version: 1,
          tenantId: tenant.id,
          actorUserId: ownerUser.id,
          action: "APPROVE",
          sourceId: eligible.sourceId,
          reason: eligible.reason,
          targetSchemaHash: eligible.targetSchemaHash,
          expiresAt: eligible.expiresAt,
          items: eligible.items.map((item) => ({
            id: item.id,
            etag: item.etag,
            generation: item.generation,
          })),
        }),
        "utf8",
      )
      .digest("hex");
    await expectError(
      bulk.execute(
        owner,
        {
          action: "APPROVE",
          items: eligibleItems,
          previewHash: undomainedHash,
          previewExpiresAt: eligible.expiresAt!,
        },
        `cross-purpose-preview-${stamp}`,
      ),
      412,
      "REVISION_CONFLICT",
    );

    const mixedSource = await seedReview({ label: "Mixed source", sourceId: otherSource.id });
    const sourcePreview = await bulk.preview(owner, {
      itemIds: [one.review.id, mixedSource.review.id],
      action: "APPROVE",
    });
    check(
      !sourcePreview.eligible &&
        sourcePreview.items.some((item) => item.reasons.includes("SOURCE_MISMATCH")),
      "Mixed sources were accepted.",
    );
    const mixedSchema = await seedReview({ label: "Mixed schema", fieldType: "number" });
    const schemaPreview = await bulk.preview(owner, {
      itemIds: [one.review.id, mixedSchema.review.id],
      action: "APPROVE",
    });
    check(
      !schemaPreview.eligible &&
        schemaPreview.items.some((item) => item.reasons.includes("TARGET_SCHEMA_MISMATCH")),
      "Mixed schemas were accepted.",
    );
    const mixedRisk = await seedReview({ label: "Mixed risk", riskLevel: "MEDIUM" });
    const riskPreview = await bulk.preview(owner, {
      itemIds: [one.review.id, mixedRisk.review.id],
      action: "APPROVE",
    });
    check(
      !riskPreview.eligible &&
        riskPreview.items.some((item) => item.reasons.includes("RISK_NOT_LOW")),
      "Mixed risk was accepted.",
    );
    const mixedReason = await seedReview({ label: "Mixed reason", reason: "INFERRED_HIGH_RISK" });
    const reasonPreview = await bulk.preview(owner, {
      itemIds: [one.review.id, mixedReason.review.id],
      action: "APPROVE",
    });
    check(
      !reasonPreview.eligible &&
        reasonPreview.items.some((item) => item.reasons.includes("REASON_MISMATCH")),
      "Mixed reasons were accepted.",
    );
    const mismatch = await seedReview({ label: "Action mismatch", suggestedAction: "REJECT" });
    check(
      !(await bulk.preview(owner, { itemIds: [mismatch.review.id], action: "APPROVE" })).eligible,
      "Suggested-action mismatch was accepted.",
    );

    const conflict = await prisma.knowledgeV2Conflict.create({
      data: {
        tenantId: tenant.id,
        conflictKey: `bulk-conflict-${stamp}`,
        conflictType: "FACT_VALUE",
        semanticKey: "bulk.conflict",
        scopeHash: `bulk-scope-${stamp}`,
        severity: "LOW",
        sourceId: primarySource.id,
        candidateSetHash: `bulk-candidates-${stamp}`,
      },
    });
    const linked = await seedReview({ label: "Conflict linked", conflictId: conflict.id });
    const linkedPreview = await bulk.preview(owner, {
      itemIds: [linked.review.id],
      action: "APPROVE",
    });
    check(
      !linkedPreview.eligible && linkedPreview.items[0]?.reasons.includes("CONFLICT_LINKED"),
      "Conflict-linked review was accepted.",
    );
    const restricted = await seedReview({
      label: "Restricted review",
      restrictedPayloadRef: `lvobj:v1:${stamp}`,
    });
    const restrictedPreview = await bulk.preview(owner, {
      itemIds: [restricted.review.id],
      action: "APPROVE",
    });
    check(
      !restrictedPreview.eligible &&
        restrictedPreview.items[0]?.reasons.includes("RESTRICTED_CONTENT"),
      "Restricted review was accepted.",
    );
    await expectError(
      bulk.preview(owner, {
        itemIds: Array.from({ length: 51 }, (_, index) => `item-${index}`),
        action: "APPROVE",
      }),
      400,
      "KNOWLEDGE_VALIDATION_BULK_REVIEW_ITEMS_INVALID",
    );

    const staleOne = await seedReview({ label: "Stale one" });
    const staleTwo = await seedReview({ label: "Stale two" });
    const stalePreview = await bulk.preview(owner, {
      itemIds: [staleOne.review.id, staleTwo.review.id],
      action: "APPROVE",
    });
    await prisma.knowledgeV2ReviewItem.update({
      where: { id: staleTwo.review.id },
      data: { etag: { increment: 1 }, generation: { increment: 1 } },
    });
    await expectError(
      bulk.execute(
        owner,
        {
          action: "APPROVE",
          items: stalePreview.items.map((item) => ({ id: item.id, etag: item.etag! })),
          previewHash: stalePreview.previewHash!,
          previewExpiresAt: stalePreview.expiresAt!,
        },
        `stale-${stamp}`,
      ),
      412,
      "REVISION_CONFLICT",
    );
    check(
      (await prisma.knowledgeV2ReviewItem.count({
        where: { id: { in: [staleOne.review.id, staleTwo.review.id] }, status: "RESOLVED" },
      })) === 0,
      "Stale execution partially resolved the batch.",
    );

    const claimOne = await seedReview({ label: "Claim one" });
    const claimTwo = await seedReview({ label: "Claim two" });
    const claimPreview = await bulk.preview(owner, {
      itemIds: [claimOne.review.id, claimTwo.review.id],
      action: "APPROVE",
    });
    await reviews.assignReviewItem(owner, claimTwo.review.id, {}, `claim-${stamp}`, [
      strongKnowledgeV2Etag("review-item", claimTwo.review.id, claimTwo.review.etag),
    ]);
    await expectError(
      bulk.execute(
        owner,
        {
          action: "APPROVE",
          items: claimPreview.items.map((item) => ({ id: item.id, etag: item.etag! })),
          previewHash: claimPreview.previewHash!,
          previewExpiresAt: claimPreview.expiresAt!,
        },
        `claim-race-${stamp}`,
      ),
      412,
      "REVISION_CONFLICT",
    );
    check(
      (await prisma.knowledgeV2ReviewItem.count({
        where: { id: { in: [claimOne.review.id, claimTwo.review.id] }, status: "RESOLVED" },
      })) === 0,
      "Concurrent claim caused partial resolution.",
    );

    const revokedOne = await seedReview({ label: "Revoked one" });
    const revokedTwo = await seedReview({ label: "Revoked two" });
    const revokedPreview = await bulk.preview(owner, {
      itemIds: [revokedOne.review.id, revokedTwo.review.id],
      action: "APPROVE",
    });
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: ownerUser.id } },
      data: { role: "MANAGER" },
    });
    await expectError(
      bulk.execute(
        owner,
        {
          action: "APPROVE",
          items: revokedPreview.items.map((item) => ({ id: item.id, etag: item.etag! })),
          previewHash: revokedPreview.previewHash!,
          previewExpiresAt: revokedPreview.expiresAt!,
        },
        `revoked-${stamp}`,
      ),
      403,
      "KNOWLEDGE_PERMISSION_BULK_REVIEW_DENIED",
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: ownerUser.id } },
      data: { role: "OWNER" },
    });

    const rollbackOne = await seedReview({ label: "Rollback one" });
    const rollbackTwo = await seedReview({ label: "Rollback two" });
    const rollbackPreview = await bulk.preview(owner, {
      itemIds: [rollbackOne.review.id, rollbackTwo.review.id],
      action: "APPROVE",
    });
    let enqueueCount = 0;
    const failingDecisions = {
      enqueueReviewDecision: async (
        ...args: Parameters<typeof decisions.enqueueReviewDecision>
      ) => {
        enqueueCount += 1;
        if (enqueueCount === 2) throw new Error("forced second enqueue failure");
        return decisions.enqueueReviewDecision(...args);
      },
      dispatchSoon: () => undefined,
    } as unknown as KnowledgeV2ReviewDecisionService;
    const failingBulk = new KnowledgeV2BulkReviewService(
      prisma,
      idempotency,
      failingDecisions,
      config,
    );
    const rollbackJobCount = await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } });
    await expectFailure(
      failingBulk.execute(
        owner,
        {
          action: "APPROVE",
          items: rollbackPreview.items.map((item) => ({ id: item.id, etag: item.etag! })),
          previewHash: rollbackPreview.previewHash!,
          previewExpiresAt: rollbackPreview.expiresAt!,
        },
        `forced-rollback-${stamp}`,
      ),
    );
    check(
      (await prisma.knowledgeV2ReviewItem.count({
        where: { id: { in: [rollbackOne.review.id, rollbackTwo.review.id] }, status: "RESOLVED" },
      })) === 0 &&
        (await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } })) === rollbackJobCount,
      "Second enqueue failure did not roll back all batch state.",
    );

    const successOne = await seedReview({ label: "Secret success one" });
    const successTwo = await seedReview({ label: "Secret success two" });
    const successPreview = await bulk.preview(owner, {
      itemIds: [successOne.review.id, successTwo.review.id],
      action: "APPROVE",
    });
    const successInput = {
      action: "APPROVE" as const,
      items: successPreview.items.map((item) => ({ id: item.id, etag: item.etag! })),
      previewHash: successPreview.previewHash!,
      previewExpiresAt: successPreview.expiresAt!,
      rationale: `private rationale ${stamp}`,
    };
    const success = await bulk.execute(owner, successInput, `success-${stamp}`);
    check(
      !success.idempotencyReplayed && success.resource.items.length === 2,
      "Bulk success receipt was invalid.",
    );
    check(
      (await prisma.knowledgeV2ReviewItem.count({
        where: { id: { in: [successOne.review.id, successTwo.review.id] }, status: "IN_REVIEW" },
      })) === 2,
      "Bulk acceptance did not keep every item pending.",
    );
    const events = await prisma.knowledgeOutbox.findMany({
      where: {
        tenantId: tenant.id,
        aggregateId: { in: [successOne.review.id, successTwo.review.id] },
      },
      orderBy: { aggregateId: "asc" },
    });
    check(events.length === 2, "Bulk success did not enqueue one fenced event per item.");
    const beforeReplay = {
      jobs: await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } }),
      outbox: await prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    };
    const replay = await bulk.execute(owner, successInput, `success-${stamp}`);
    check(replay.idempotencyReplayed, "Bulk replay was not identified.");
    check(
      (await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } })) === beforeReplay.jobs &&
        (await prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } })) ===
          beforeReplay.outbox &&
        (await prisma.auditLog.count({ where: { tenantId: tenant.id } })) === beforeReplay.audits,
      "Bulk replay duplicated follow-up work.",
    );
    for (const event of events) {
      await decisions.dispatch(event.id);
      await decisions.dispatch(event.id);
    }
    check(
      (await prisma.knowledgeV2FactVersion.count({
        where: { tenantId: tenant.id, factId: { in: [successOne.fact.id, successTwo.fact.id] } },
      })) === 4 &&
        (await prisma.knowledgeV2ReviewItem.count({
          where: {
            id: { in: [successOne.review.id, successTwo.review.id] },
            status: "RESOLVED",
          },
        })) === 2,
      "Decision settlement failed or replay duplicated immutable successors.",
    );
    const durable = JSON.stringify({
      jobs: await prisma.knowledgeJob.findMany({ where: { tenantId: tenant.id } }),
      outbox: await prisma.knowledgeOutbox.findMany({ where: { tenantId: tenant.id } }),
      inbox: await prisma.knowledgeInbox.findMany({ where: { tenantId: tenant.id } }),
      audits: await prisma.auditLog.findMany({ where: { tenantId: tenant.id } }),
    });
    check(
      !durable.includes(`private rationale ${stamp}`),
      "Rationale plaintext leaked into durable work.",
    );
    check(!durable.includes("Secret success one"), "Fact plaintext leaked into bulk operations.");
  } finally {
    await cleanup(prisma, tenantIds, userIds).catch(() => undefined);
    await prisma.$disconnect();
  }
  console.log(`Knowledge v2 bulk review smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(errorCode(error) ?? error);
  process.exitCode = 1;
});
