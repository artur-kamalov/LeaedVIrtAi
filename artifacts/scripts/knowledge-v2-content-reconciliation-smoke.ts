import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import {
  KnowledgeV2ContentReconciliationService,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-content-reconciliation.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";

const prisma = new PrismaService();
const eventType = "knowledge.v2.content-reconciliation.requested";

async function cleanup(tenantId: string | null, userId: string | null) {
  if (!tenantId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const tables = [
      "KnowledgeInbox",
      "KnowledgeJobAttempt",
      "KnowledgeOutbox",
      "KnowledgeJob",
      "KnowledgeV2IdempotencyRecord",
      "ActiveKnowledgePublication",
      "KnowledgePublicationItem",
      "KnowledgePublication",
      "KnowledgeV2Evidence",
      "KnowledgeV2GuidanceRuleVersion",
      "KnowledgeV2GuidanceRule",
      "KnowledgeV2FactVersion",
      "KnowledgeV2Fact",
      "KnowledgeV2Settings",
      "AuditLog",
      "Membership",
    ];
    for (const table of tables) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
    }
    await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    if (userId) await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', userId);
  });
}

async function main() {
  let tenantId: string | null = null;
  let userId: string | null = null;
  try {
    await prisma.$connect();
    const stamp = randomUUID();
    const tenant = await prisma.tenant.create({
      data: { name: "Content reconciliation smoke", slug: `content-reconcile-${stamp}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { email: `content-reconcile-${stamp}@example.test`, name: "Content owner" },
    });
    userId = user.id;
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    await prisma.knowledgeV2Settings.create({ data: { tenantId } });
    const activePublication = await prisma.knowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        manifestHash: "a".repeat(64),
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        readyAt: new Date(),
      },
    });
    await prisma.knowledgePublication.update({
      where: { id: activePublication.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    await prisma.activeKnowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        publicationId: activePublication.id,
        sequence: 1,
        updatedByUserId: userId,
      },
    });
    const context: RequestContext = {
      tenantId,
      userId,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const knowledge = new KnowledgeV2Service(prisma, idempotency);
    const dispatcher = new KnowledgeV2ContentReconciliationService(prisma);

    const eventForVersion = async (resourceId: string, versionId: string) => {
      const job = await prisma.knowledgeJob.findFirstOrThrow({
        where: {
          tenantId,
          payloadRef: { endsWith: `:${resourceId}:${versionId}` },
        },
      });
      const event = await prisma.knowledgeOutbox.findFirstOrThrow({
        where: { tenantId, eventType, dedupeKey: job.idempotencyKey },
      });
      return { job, event };
    };
    const dispatchVersion = async (resourceId: string, versionId: string) => {
      const queued = await eventForVersion(resourceId, versionId);
      await dispatcher.dispatch(queued.event.id);
      const job = await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: queued.job.id } });
      assert.equal(job.status, "SUCCEEDED");
      assert.equal(job.progressCompleted, 1);
      return queued;
    };
    const factInput = (key: string, value: string) => ({
      factKey: key,
      entityType: "BUSINESS",
      fieldType: "TEXT",
      normalizedValue: { value },
      displayValue: value,
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL" as const,
      riskLevel: "LOW" as const,
      authority: "MANUAL" as const,
    });
    const guidanceInput = (title: string, instruction: string) => ({
      title,
      type: "PROHIBITION" as const,
      condition: {
        kind: "PREDICATE" as const,
        field: "INTENT" as const,
        operator: "EQUALS" as const,
        value: "pricing",
      },
      instruction,
      priority: 100,
      tieBreakKey: `manual.${randomUUID()}`,
      riskLevel: "LOW" as const,
    });

    const factCreateKey = `fact-create-${stamp}`;
    const fact = await knowledge.createFact(
      context,
      factInput("business/private-value", "PRIVATE_FACT_VALUE"),
      factCreateKey,
    );
    await dispatchVersion(fact.resource.id, fact.resource.versionId);
    const jobCountBeforeReplay = await prisma.knowledgeJob.count({ where: { tenantId } });
    const factReplay = await knowledge.createFact(
      context,
      factInput("business/private-value", "PRIVATE_FACT_VALUE"),
      factCreateKey,
    );
    assert.equal(factReplay.idempotencyReplayed, true);
    assert.equal(await prisma.knowledgeJob.count({ where: { tenantId } }), jobCountBeforeReplay);

    const updatedFact = await knowledge.updateFact(
      context,
      fact.resource.id,
      { displayValue: "PRIVATE_FACT_UPDATED", changeReason: "PRIVATE_CHANGE_REASON" },
      `fact-update-${stamp}`,
      [fact.resource.etag],
    );
    await dispatchVersion(updatedFact.resource.id, updatedFact.resource.versionId);
    const verifiedFact = await knowledge.verifyFact(
      context,
      updatedFact.resource.id,
      { note: "PRIVATE_VERIFY_NOTE" },
      `fact-verify-${stamp}`,
      [updatedFact.resource.etag],
    );
    await dispatchVersion(verifiedFact.resource.id, verifiedFact.resource.versionId);
    const rejectedFact = await knowledge.rejectFact(
      context,
      verifiedFact.resource.id,
      { note: "PRIVATE_REJECT_NOTE" },
      `fact-reject-${stamp}`,
      [verifiedFact.resource.etag],
    );
    await dispatchVersion(rejectedFact.resource.id, rejectedFact.resource.versionId);

    const guidance = await knowledge.createGuidanceRule(
      context,
      guidanceInput("Private guidance", "PRIVATE_GUIDANCE_INSTRUCTION"),
      `guidance-create-${stamp}`,
    );
    await dispatchVersion(guidance.resource.id, guidance.resource.versionId);
    const updatedGuidance = await knowledge.updateGuidanceRule(
      context,
      guidance.resource.id,
      { instruction: "PRIVATE_GUIDANCE_UPDATED", changeReason: "PRIVATE_GUIDANCE_REASON" },
      `guidance-update-${stamp}`,
      [guidance.resource.etag],
    );
    await dispatchVersion(updatedGuidance.resource.id, updatedGuidance.resource.versionId);
    const approvedGuidance = await knowledge.approveGuidanceRule(
      context,
      updatedGuidance.resource.id,
      { note: "PRIVATE_APPROVAL_NOTE" },
      `guidance-approve-${stamp}`,
      [updatedGuidance.resource.etag],
    );
    await dispatchVersion(approvedGuidance.resource.id, approvedGuidance.resource.versionId);
    const rejectedGuidance = await knowledge.rejectGuidanceRule(
      context,
      approvedGuidance.resource.id,
      { note: "PRIVATE_GUIDANCE_REJECT_NOTE" },
      `guidance-reject-${stamp}`,
      [approvedGuidance.resource.etag],
    );
    await dispatchVersion(rejectedGuidance.resource.id, rejectedGuidance.resource.versionId);
    const disabledGuidance = await knowledge.disableGuidanceRule(
      context,
      rejectedGuidance.resource.id,
      { note: "PRIVATE_DISABLE_NOTE" },
      `guidance-disable-${stamp}`,
      [rejectedGuidance.resource.etag],
    );
    await dispatchVersion(disabledGuidance.resource.id, disabledGuidance.resource.versionId);

    const earlierIndependentFact = await knowledge.createFact(
      context,
      factInput("business/independent-earlier", "PRIVATE_INDEPENDENT_EARLIER"),
      `independent-earlier-${stamp}`,
    );
    const laterIndependentFact = await knowledge.createFact(
      context,
      factInput("business/independent-later", "PRIVATE_INDEPENDENT_LATER"),
      `independent-later-${stamp}`,
    );
    await dispatchVersion(
      earlierIndependentFact.resource.id,
      earlierIndependentFact.resource.versionId,
    );
    await dispatchVersion(
      laterIndependentFact.resource.id,
      laterIndependentFact.resource.versionId,
    );

    const staleFact = await knowledge.createFact(
      context,
      factInput("business/stale", "PRIVATE_STALE_VALUE"),
      `stale-create-${stamp}`,
    );
    const staleCreate = await eventForVersion(staleFact.resource.id, staleFact.resource.versionId);
    const staleSuccessor = await knowledge.updateFact(
      context,
      staleFact.resource.id,
      { displayValue: "PRIVATE_STALE_SUCCESSOR" },
      `stale-update-${stamp}`,
      [staleFact.resource.etag],
    );
    await dispatcher.dispatch(staleCreate.event.id);
    const staleJob = await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: staleCreate.job.id } });
    assert.equal(staleJob.status, "DEAD_LETTER");
    assert.equal(staleJob.errorCode, "KNOWLEDGE_CONFLICT_CONTENT_RECONCILIATION_STALE");
    await dispatchVersion(staleSuccessor.resource.id, staleSuccessor.resource.versionId);

    const revokedFact = await knowledge.createFact(
      context,
      factInput("business/revoked", "PRIVATE_REVOKED_VALUE"),
      `revoked-create-${stamp}`,
    );
    const revoked = await eventForVersion(revokedFact.resource.id, revokedFact.resource.versionId);
    await prisma.membership.delete({ where: { tenantId_userId: { tenantId, userId } } });
    await dispatcher.dispatch(revoked.event.id);
    const revokedJob = await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: revoked.job.id } });
    assert.equal(revokedJob.status, "DEAD_LETTER");
    assert.equal(
      revokedJob.errorCode,
      "KNOWLEDGE_PERMISSION_CONTENT_RECONCILIATION_ACTOR_REVOKED",
    );
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });

    const redriveFact = await knowledge.createFact(
      context,
      factInput("business/redrive", "PRIVATE_REDRIVE_VALUE"),
      `redrive-create-${stamp}`,
    );
    const redrive = await eventForVersion(redriveFact.resource.id, redriveFact.resource.versionId);
    const expiredLease = new Date(Date.now() - 10 * 60_000);
    await prisma.$transaction([
      prisma.knowledgeOutbox.update({
        where: { id: redrive.event.id },
        data: { status: "PUBLISHING", attemptCount: 1, lockedAt: expiredLease, lockedBy: "crashed" },
      }),
      prisma.knowledgeJob.update({
        where: { id: redrive.job.id },
        data: { status: "RUNNING", attemptCount: 1, startedAt: expiredLease, heartbeatAt: expiredLease },
      }),
      prisma.knowledgeJobAttempt.create({
        data: {
          tenantId,
          jobId: redrive.job.id,
          attempt: 1,
          status: "RUNNING",
          workerId: "crashed",
          heartbeatAt: expiredLease,
        },
      }),
    ]);
    await dispatcher.dispatch(redrive.event.id);
    const redrivenJob = await prisma.knowledgeJob.findUniqueOrThrow({
      where: { id: redrive.job.id },
      include: { attempts: { orderBy: { attempt: "asc" } } },
    });
    assert.equal(redrivenJob.status, "SUCCEEDED");
    assert.deepEqual(redrivenJob.attempts.map((attempt) => attempt.status), ["TIMED_OUT", "SUCCEEDED"]);

    const cancelledFact = await knowledge.createFact(
      context,
      factInput("business/cancelled", "PRIVATE_CANCELLED_VALUE"),
      `cancelled-create-${stamp}`,
    );
    const cancelled = await eventForVersion(
      cancelledFact.resource.id,
      cancelledFact.resource.versionId,
    );
    await prisma.knowledgeJob.update({
      where: { id: cancelled.job.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await dispatcher.dispatch(cancelled.event.id);
    assert.equal(
      (await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: cancelled.job.id } })).status,
      "CANCELLED",
    );
    assert.equal(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: cancelled.event.id } })).status,
      "DEAD_LETTER",
    );

    const reconciliationEvents = await prisma.knowledgeOutbox.findMany({
      where: { tenantId, eventType },
      select: { payload: true },
    });
    const reconciliationAudits = await prisma.auditLog.findMany({
      where: { tenantId, action: "knowledge.v2.content_reconciliation.completed" },
      select: { payload: true },
    });
    const safeDurableData = JSON.stringify({ reconciliationEvents, reconciliationAudits });
    for (const secret of [
      "PRIVATE_FACT_VALUE",
      "PRIVATE_FACT_UPDATED",
      "PRIVATE_GUIDANCE_INSTRUCTION",
      "PRIVATE_GUIDANCE_UPDATED",
      "PRIVATE_VERIFY_NOTE",
      "PRIVATE_APPROVAL_NOTE",
    ]) assert.equal(safeDurableData.includes(secret), false);

    const publicationService = new KnowledgeV2PublicationService(
      prisma,
      idempotency,
      {} as never,
    );
    const overview = await publicationService.getOverview(context);
    assert.ok(overview.recentJobs.some((job) =>
      job.resources.some((resource) => resource.type === "FACT" || resource.type === "GUIDANCE_RULE")
    ));
    assert.equal(
      (await prisma.activeKnowledgePublication.findUniqueOrThrow({
        where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
      })).publicationId,
      activePublication.id,
    );
    assert.equal(
      await prisma.knowledgePublication.count({ where: { tenantId } }),
      1,
    );
    console.log(JSON.stringify({ checks: 40, passed: 40 }));
  } finally {
    await cleanup(tenantId, userId).catch((error) => console.error("cleanup failed", error));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
