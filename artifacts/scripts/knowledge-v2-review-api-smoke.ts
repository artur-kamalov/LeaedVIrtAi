import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "../../apps/api/src/modules/knowledge/knowledge-v2-conflict-candidate-reader.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import { KnowledgeV2ReviewDecisionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.js";
import { KnowledgeV2ReviewService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review.service.js";

let assertionCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertionCount += 1;
  if (!condition) throw new Error(message);
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

function errorPayload(error: unknown) {
  return error instanceof HttpException ? error.getResponse() : null;
}

async function expectKnowledgeError(action: Promise<unknown>, status: number, code: string) {
  try {
    await action;
  } catch (error) {
    const payload = errorPayload(error);
    assert(
      error instanceof HttpException && error.getStatus() === status,
      `Expected HTTP ${status}.`,
    );
    assert(
      typeof payload === "object" && payload !== null && "code" in payload && payload.code === code,
      `Expected ${code}, received ${JSON.stringify(payload)}.`,
    );
    return;
  }
  throw new Error(`Expected ${status} ${code}.`);
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
    await tx.knowledgeOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Source.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: "Knowledge review smoke",
      slug: `kv2-review-${stamp}`,
      businessType: "services",
      timezone: "Europe/Paris",
    },
  });
  const otherTenant = await prisma.tenant.create({
    data: { name: "Knowledge review isolation", slug: `kv2-review-other-${stamp}` },
  });
  const [ownerUser, managerOneUser, managerTwoUser, agentUser] = await Promise.all([
    prisma.user.create({
      data: { email: `kv2-review-owner-${stamp}@example.test`, name: "Review owner" },
    }),
    prisma.user.create({
      data: { email: `kv2-review-manager-one-${stamp}@example.test`, name: "Manager one" },
    }),
    prisma.user.create({
      data: { email: `kv2-review-manager-two-${stamp}@example.test`, name: "Manager two" },
    }),
    prisma.user.create({
      data: { email: `kv2-review-agent-${stamp}@example.test`, name: "Review agent" },
    }),
  ]);
  await prisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: ownerUser.id, role: "OWNER" },
      { tenantId: otherTenant.id, userId: ownerUser.id, role: "OWNER" },
      { tenantId: tenant.id, userId: managerOneUser.id, role: "MANAGER" },
      { tenantId: tenant.id, userId: managerTwoUser.id, role: "MANAGER" },
      { tenantId: tenant.id, userId: agentUser.id, role: "AGENT" },
    ],
  });

  const owner = context(tenant, ownerUser, "OWNER");
  const otherOwner = context(otherTenant, ownerUser, "OWNER");
  const managerOne = context(tenant, managerOneUser, "MANAGER");
  const managerTwo = context(tenant, managerTwoUser, "MANAGER");
  const agent = context(tenant, agentUser, "AGENT");
  const idempotency = new KnowledgeV2IdempotencyService(prisma);
  const decisionStub = {
    enqueueReviewDecision: async (
      tx: Parameters<KnowledgeV2ReviewDecisionService["enqueueReviewDecision"]>[0],
      review: Parameters<KnowledgeV2ReviewDecisionService["enqueueReviewDecision"]>[1],
    ) =>
      (
        await tx.knowledgeOutbox.create({
          data: {
            tenantId: review.tenantId,
            aggregateType: "KnowledgeV2ReviewItem",
            aggregateId: review.id,
            aggregateVersion: review.generation,
            eventType: "knowledge.v2.review-decision.execute.requested",
            dedupeKey: `review-api-smoke:review:${review.id}:${review.generation}`,
            payload: {},
          },
        })
      ).id,
    enqueueConflictDecision: async (
      tx: Parameters<KnowledgeV2ReviewDecisionService["enqueueConflictDecision"]>[0],
      conflict: Parameters<KnowledgeV2ReviewDecisionService["enqueueConflictDecision"]>[1],
    ) =>
      (
        await tx.knowledgeOutbox.create({
          data: {
            tenantId: conflict.tenantId,
            aggregateType: "KnowledgeV2Conflict",
            aggregateId: conflict.id,
            aggregateVersion: conflict.generation,
            eventType: "knowledge.v2.review-decision.execute.requested",
            dedupeKey: `review-api-smoke:conflict:${conflict.id}:${conflict.generation}`,
            payload: {},
          },
        })
      ).id,
    dispatchSoon: () => undefined,
  } as unknown as KnowledgeV2ReviewDecisionService;
  const candidateReader = new KnowledgeV2ConflictCandidateReaderService(
    prisma,
    {} as AppConfigService,
  );
  const reviews = new KnowledgeV2ReviewService(prisma, idempotency, decisionStub, candidateReader);
  const publications = new KnowledgeV2PublicationService(prisma, idempotency);

  try {
    const source = await prisma.knowledgeV2Source.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        displayName: "Review source",
        externalRootKey: `review:${stamp}`,
        syncMode: "MANUAL",
        status: "READY",
        defaultClassification: "INTERNAL",
        defaultLocale: "en",
        createdByUserId: ownerUser.id,
        updatedByUserId: ownerUser.id,
      },
    });
    const otherSource = await prisma.knowledgeV2Source.create({
      data: {
        tenantId: otherTenant.id,
        kind: "MANUAL",
        displayName: "Other review source",
        externalRootKey: `review-other:${stamp}`,
        syncMode: "MANUAL",
        status: "READY",
        defaultClassification: "INTERNAL",
        defaultLocale: "en",
        createdByUserId: ownerUser.id,
        updatedByUserId: ownerUser.id,
      },
    });
    const privateEvidence = await prisma.knowledgeV2EvidenceReference.create({
      data: {
        tenantId: tenant.id,
        evidenceKey: `private:${stamp}`,
        targetType: "EXTERNAL_REFERENCE",
        externalReferenceHash: `external-${stamp}`,
        safeLabel: "Private contract evidence",
        locatorHash: `locator-${stamp}`,
        restrictedPayloadRef: `vault://review-secret-${stamp}`,
        isPublic: false,
        confidence: 0.9,
      },
    });
    const concurrentReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        reviewKey: `concurrent:${stamp}`,
        reason: "LOW_CONFIDENCE_CONTENT",
        riskLevel: "LOW",
        suggestedAction: "APPROVE",
        safeTitle: "Confirm imported service detail",
        safeSummary: "A reviewer should confirm this low-risk item.",
        restrictedPayloadRef: `vault://review-payload-${stamp}`,
        sourceId: source.id,
        createdByUserId: ownerUser.id,
      },
    });
    await prisma.knowledgeV2ReviewItemEvidence.create({
      data: {
        tenantId: tenant.id,
        reviewItemId: concurrentReview.id,
        evidenceReferenceId: privateEvidence.id,
        ordinal: 0,
        relevanceScore: 0.9,
      },
    });
    const highReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        reviewKey: `high:${stamp}`,
        reason: "SENSITIVE_CONTENT",
        riskLevel: "HIGH",
        suggestedAction: "VERIFY_PERMISSION",
        safeTitle: "Verify sensitive source permission",
        sourceId: source.id,
        createdByUserId: ownerUser.id,
      },
    });
    const assignmentReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        reviewKey: `assignment:${stamp}`,
        reason: "LOW_CONFIDENCE_CONTENT",
        riskLevel: "MEDIUM",
        suggestedAction: "REVIEW_VALUE",
        safeTitle: "Review assignment lifecycle",
        sourceId: source.id,
        createdByUserId: ownerUser.id,
      },
    });
    const conflict = await prisma.knowledgeV2Conflict.create({
      data: {
        tenantId: tenant.id,
        conflictKey: `conflict:${stamp}`,
        conflictType: "FACT_VALUE",
        semanticKey: "services.primary.price",
        scopeHash: `scope-${stamp}`,
        severity: "MEDIUM",
        sourceId: source.id,
        candidateSetHash: `candidate-set-${stamp}`,
      },
    });
    const linkedReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        reviewKey: `linked:${stamp}`,
        reason: "CONFLICTING_VALUES",
        riskLevel: "MEDIUM",
        suggestedAction: "REVIEW_VALUE",
        safeTitle: "Choose the authoritative service price",
        conflictId: conflict.id,
        createdByUserId: ownerUser.id,
      },
    });
    const dismissConflict = await prisma.knowledgeV2Conflict.create({
      data: {
        tenantId: tenant.id,
        conflictKey: `dismiss-conflict:${stamp}`,
        conflictType: "DUPLICATE_IDENTITY",
        semanticKey: "services.duplicate",
        scopeHash: `dismiss-scope-${stamp}`,
        severity: "LOW",
        sourceId: source.id,
        candidateSetHash: `dismiss-candidates-${stamp}`,
      },
    });
    const dismissLinkedReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        reviewKey: `dismiss-linked:${stamp}`,
        reason: "CONFLICTING_VALUES",
        riskLevel: "HIGH",
        suggestedAction: "DISMISS",
        safeTitle: "Review possible duplicate",
        conflictId: dismissConflict.id,
        createdByUserId: ownerUser.id,
      },
    });
    const otherReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: otherTenant.id,
        reviewKey: `other:${stamp}`,
        reason: "LOW_CONFIDENCE_CONTENT",
        riskLevel: "LOW",
        suggestedAction: "REVIEW_VALUE",
        safeTitle: "Other tenant review",
        sourceId: otherSource.id,
        createdByUserId: ownerUser.id,
      },
    });

    const ownerList = await reviews.listReviewItems(owner, { limit: 3 });
    assert(
      ownerList.items.every((item) => item.id !== otherReview.id),
      "Review list crossed tenants.",
    );
    assert(ownerList.pageInfo.hasNextPage, "Review list did not expose cursor pagination.");
    assert(Boolean(ownerList.pageInfo.nextCursor), "Review list omitted its next cursor.");
    const nextPage = await reviews.listReviewItems(owner, {
      limit: 3,
      cursor: ownerList.pageInfo.nextCursor ?? undefined,
    });
    assert(
      nextPage.items.every((item) => !ownerList.items.some((first) => first.id === item.id)),
      "Review cursor repeated a row.",
    );
    const filteredPage = await reviews.listReviewItems(owner, { limit: 1, query: "Review" });
    assert(filteredPage.pageInfo.hasNextPage, "Filtered review list did not expose pagination.");
    const filteredNext = await reviews.listReviewItems(owner, {
      limit: 1,
      query: "Review",
      cursor: filteredPage.pageInfo.nextCursor ?? undefined,
    });
    assert(
      filteredNext.items.length === 1 && filteredNext.items[0]?.id !== filteredPage.items[0]?.id,
      "Search and cursor filters did not compose.",
    );
    await expectKnowledgeError(
      reviews.getReviewItem(owner, otherReview.id),
      404,
      "KNOWLEDGE_CONFLICT_REVIEW_ITEM_NOT_FOUND",
    );
    await expectKnowledgeError(
      reviews.listReviewItems(agent, {}),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );

    const ownerDetail = await reviews.getReviewItem(owner, concurrentReview.id);
    const managerDetail = await reviews.getReviewItem(managerOne, concurrentReview.id);
    assert(
      ownerDetail.evidence?.[0]?.evidence.safeLabel === "Private contract evidence",
      "Owner evidence was unexpectedly redacted.",
    );
    assert(
      managerDetail.evidence?.[0]?.evidence.redacted,
      "Manager non-public evidence was not redacted.",
    );
    assert(
      managerDetail.evidence?.[0]?.evidence.evidenceKey === null,
      "Redacted evidence leaked its key.",
    );
    assert(
      !JSON.stringify(ownerDetail).includes(`vault://review-secret-${stamp}`),
      "Restricted evidence reference leaked.",
    );
    assert(
      !JSON.stringify(ownerDetail).includes(`vault://review-payload-${stamp}`),
      "Restricted review payload leaked.",
    );

    const readiness = await publications.getReadiness(owner);
    assert(
      readiness.draft.blockers.some((gate) => gate.code === "KNOWLEDGE_SECURITY_REVIEW_REQUIRED"),
      "Sensitive review did not block publication readiness.",
    );
    assert(
      readiness.draft.blockers.some(
        (gate) => gate.code === "KNOWLEDGE_PUBLICATION_CONFLICT_UNRESOLVED",
      ),
      "Open conflict did not block publication readiness.",
    );
    assert(
      readiness.draft.warnings.some(
        (gate) => gate.code === "KNOWLEDGE_PUBLICATION_REVIEW_REQUIRED",
      ),
      "Low-risk review did not warn publication readiness.",
    );
    const overview = await publications.getOverview(owner);
    const activeReviewCount = await prisma.knowledgeV2ReviewItem.count({
      where: { tenantId: tenant.id, status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] } },
    });
    assert(
      overview.counts.reviewItems === activeReviewCount,
      "Overview review count is not backed by review rows.",
    );

    await expectKnowledgeError(
      reviews.resolveReviewItem(
        owner,
        highReview.id,
        { action: "ADD_MISSING_ANSWER", rationale: "Wrong action" },
        `high-incompatible-${stamp}`,
        [(await reviews.getReviewItem(owner, highReview.id)).etag],
      ),
      422,
      "KNOWLEDGE_VALIDATION_REVIEW_ACTION_INCOMPATIBLE",
    );

    const initialConcurrent = await reviews.getReviewItem(owner, concurrentReview.id);
    const claimOneKey = `claim-one-${stamp}`;
    const claimTwoKey = `claim-two-${stamp}`;
    const claims = await Promise.allSettled([
      reviews.assignReviewItem(managerOne, concurrentReview.id, {}, claimOneKey, [
        initialConcurrent.etag,
      ]),
      reviews.assignReviewItem(managerTwo, concurrentReview.id, {}, claimTwoKey, [
        initialConcurrent.etag,
      ]),
    ]);
    const successfulClaims = claims.filter(
      (
        claim,
      ): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof reviews.assignReviewItem>>> =>
        claim.status === "fulfilled",
    );
    const failedClaims = claims.filter(
      (claim): claim is PromiseRejectedResult => claim.status === "rejected",
    );
    assert(
      successfulClaims.length === 1 && failedClaims.length === 1,
      "Concurrent claim did not have one winner.",
    );
    assert(
      failedClaims[0]?.reason instanceof HttpException &&
        failedClaims[0].reason.getStatus() === 412,
      "Concurrent loser did not receive a stale ETag response.",
    );
    const winnerId = successfulClaims[0]?.value.resource.assignedTo?.id;
    const winner = winnerId === managerOne.userId ? managerOne : managerTwo;
    const winnerKey = winnerId === managerOne.userId ? claimOneKey : claimTwoKey;
    const replayedClaim = await reviews.assignReviewItem(
      winner,
      concurrentReview.id,
      {},
      winnerKey,
      [initialConcurrent.etag],
    );
    assert(replayedClaim.idempotencyReplayed, "Concurrent winner did not replay idempotently.");
    assert(
      replayedClaim.resource.etag === successfulClaims[0]?.value.resource.etag,
      "Replay response drifted.",
    );
    await expectKnowledgeError(
      reviews.assignReviewItem(
        owner,
        concurrentReview.id,
        { assigneeUserId: managerOne.userId },
        `stale-owner-${stamp}`,
        [initialConcurrent.etag],
      ),
      412,
      "REVISION_CONFLICT",
    );

    const claimedConcurrent = await reviews.getReviewItem(owner, concurrentReview.id);
    const resolvedConcurrent = await reviews.resolveReviewItem(
      winner,
      concurrentReview.id,
      { action: "APPROVE", rationale: "Verified against the public service page." },
      `resolve-concurrent-${stamp}`,
      [claimedConcurrent.etag],
    );
    assert(
      resolvedConcurrent.resource.status === "IN_REVIEW" &&
        resolvedConcurrent.resource.allowedActions.length === 0,
      "Low-risk manager decision was not accepted as pending.",
    );
    assert(
      resolvedConcurrent.resource.generation === 3,
      "Review generation did not advance per mutation.",
    );
    const terminalReplay = await reviews.resolveReviewItem(
      winner,
      concurrentReview.id,
      { action: "APPROVE", rationale: "Verified against the public service page." },
      `resolve-concurrent-${stamp}`,
      [claimedConcurrent.etag],
    );
    assert(terminalReplay.resource.generation === 3, "Pending decision replay changed generation.");
    await expectKnowledgeError(
      reviews.resolveReviewItem(
        winner === managerOne ? managerTwo : managerOne,
        concurrentReview.id,
        { action: "APPROVE", rationale: "Not the original resolver." },
        `resolve-terminal-other-${stamp}`,
        [resolvedConcurrent.resource.etag],
      ),
      409,
      "KNOWLEDGE_CONFLICT_REVIEW_DECISION_PENDING",
    );
    await expectKnowledgeError(
      reviews.dismissReviewItem(
        winner,
        concurrentReview.id,
        { rationale: "Contradictory terminal outcome." },
        `dismiss-terminal-${stamp}`,
        [resolvedConcurrent.resource.etag],
      ),
      409,
      "KNOWLEDGE_CONFLICT_REVIEW_DECISION_PENDING",
    );

    const assignmentOpen = await reviews.getReviewItem(owner, assignmentReview.id);
    const assignmentClaimed = await reviews.assignReviewItem(
      managerOne,
      assignmentReview.id,
      {},
      `assignment-claim-${stamp}`,
      [assignmentOpen.etag],
    );
    const assignmentUnassigned = await reviews.assignReviewItem(
      managerOne,
      assignmentReview.id,
      { assigneeUserId: null },
      `assignment-unassign-${stamp}`,
      [assignmentClaimed.resource.etag],
    );
    assert(
      assignmentUnassigned.resource.status === "OPEN" && !assignmentUnassigned.resource.assignedTo,
      "Current assignee could not unassign the review.",
    );
    const assignmentAssigned = await reviews.assignReviewItem(
      owner,
      assignmentReview.id,
      { assigneeUserId: managerTwo.userId },
      `assignment-owner-${stamp}`,
      [assignmentUnassigned.resource.etag],
    );
    assert(
      assignmentAssigned.resource.assignedTo?.id === managerTwo.userId,
      "Owner assignment failed.",
    );
    const dismissedReview = await reviews.dismissReviewItem(
      managerTwo,
      assignmentReview.id,
      { rationale: "Duplicate review item." },
      `assignment-dismiss-${stamp}`,
      [assignmentAssigned.resource.etag],
    );
    assert(dismissedReview.resource.status === "IN_REVIEW", "Review dismissal was not queued.");

    const highOpen = await reviews.getReviewItem(owner, highReview.id);
    const highClaimed = await reviews.assignReviewItem(
      managerOne,
      highReview.id,
      {},
      `high-claim-${stamp}`,
      [highOpen.etag],
    );
    await expectKnowledgeError(
      reviews.resolveReviewItem(
        managerOne,
        highReview.id,
        { action: "VERIFY_PERMISSION", rationale: "Manager cannot approve high risk." },
        `high-manager-resolve-${stamp}`,
        [highClaimed.resource.etag],
      ),
      403,
      "KNOWLEDGE_PERMISSION_HIGH_RISK_REVIEW_REQUIRED",
    );
    const highResolved = await reviews.resolveReviewItem(
      owner,
      highReview.id,
      { action: "VERIFY_PERMISSION", rationale: "Owner verified source access." },
      `high-owner-resolve-${stamp}`,
      [highClaimed.resource.etag],
    );
    assert(
      highResolved.resource.status === "IN_REVIEW",
      "Owner could not queue the high-risk review decision.",
    );

    await expectKnowledgeError(
      reviews.resolveReviewItem(
        owner,
        linkedReview.id,
        { action: "REVIEW_VALUE", rationale: "Bypass conflict." },
        `linked-bypass-${stamp}`,
        [(await reviews.getReviewItem(owner, linkedReview.id)).etag],
      ),
      409,
      "KNOWLEDGE_CONFLICT_RESOLUTION_REQUIRED",
    );
    const conflictOpen = await reviews.getConflict(owner, conflict.id);
    const conflictClaimed = await reviews.assignConflict(
      managerOne,
      conflict.id,
      {},
      `conflict-claim-${stamp}`,
      [conflictOpen.etag],
    );
    const resolvedConflict = await reviews.resolveConflict(
      managerOne,
      conflict.id,
      { resolution: "MARK_UNANSWERABLE", rationale: "No candidate has enough authority." },
      `conflict-resolve-${stamp}`,
      [conflictClaimed.resource.etag],
    );
    assert(resolvedConflict.resource.status === "IN_REVIEW", "Conflict decision was not queued.");
    const linkedResolved = await reviews.getReviewItem(owner, linkedReview.id);
    assert(
      linkedResolved.status !== "RESOLVED" && linkedResolved.resolutionAction === null,
      "Conflict acceptance prematurely resolved its linked review.",
    );
    const conflictReplay = await reviews.resolveConflict(
      managerOne,
      conflict.id,
      { resolution: "MARK_UNANSWERABLE", rationale: "No candidate has enough authority." },
      `conflict-resolve-${stamp}`,
      [conflictClaimed.resource.etag],
    );
    assert(
      conflictReplay.resource.generation === resolvedConflict.resource.generation,
      "Conflict pending replay changed generation.",
    );

    const dismissConflictOpen = await reviews.getConflict(owner, dismissConflict.id);
    const dismissConflictManagerView = await reviews.getConflict(managerOne, dismissConflict.id);
    assert(
      !dismissConflictManagerView.allowedActions.includes("RESOLVE") &&
        !dismissConflictManagerView.allowedActions.includes("DISMISS"),
      "Manager actions ignored an elevated linked review.",
    );
    const dismissConflictClaimed = await reviews.assignConflict(
      managerOne,
      dismissConflict.id,
      {},
      `dismiss-conflict-claim-${stamp}`,
      [dismissConflictOpen.etag],
    );
    await expectKnowledgeError(
      reviews.dismissConflict(
        managerOne,
        dismissConflict.id,
        { rationale: "Manager cannot close linked high-risk work." },
        `dismiss-conflict-manager-${stamp}`,
        [dismissConflictClaimed.resource.etag],
      ),
      403,
      "KNOWLEDGE_PERMISSION_HIGH_RISK_REVIEW_REQUIRED",
    );
    const dismissedConflictResult = await reviews.dismissConflict(
      owner,
      dismissConflict.id,
      { rationale: "The identities intentionally refer to one service." },
      `conflict-dismiss-${stamp}`,
      [dismissConflictClaimed.resource.etag],
    );
    assert(
      dismissedConflictResult.resource.status === "IN_REVIEW",
      "Conflict dismissal was not queued.",
    );
    const dismissLinked = await reviews.getReviewItem(owner, dismissLinkedReview.id);
    assert(
      dismissLinked.status !== "DISMISSED" && dismissLinked.resolutionAction === null,
      "Conflict dismissal prematurely dismissed its linked review.",
    );

    const publicationCount = await prisma.knowledgePublication.count({
      where: { tenantId: tenant.id },
    });
    assert(publicationCount === 0, "Review decisions directly created a publication.");
    const restrictedResolutionCount = await prisma.knowledgeV2ReviewItem.count({
      where: { tenantId: tenant.id, restrictedResolutionRef: { not: null } },
    });
    assert(restrictedResolutionCount === 0, "Review API stored raw resolution content.");
    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, action: { startsWith: "knowledge.v2." } },
      select: { payload: true },
    });
    assert(auditRows.length >= 10, "Review mutations did not create audit rows.");
    assert(
      !JSON.stringify(auditRows).includes("Verified against the public service page"),
      "Audit payload leaked a raw rationale.",
    );
    assert(
      (await reviews.listReviewItems(otherOwner, {})).items.length === 1,
      "Other tenant changed.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        assertions: assertionCount,
        concurrentClaimWinner: winnerId,
        auditRows: auditRows.length,
        publicationReadinessGates: {
          blockers: readiness.draft.blockers.length,
          warnings: readiness.draft.warnings.length,
        },
      }),
    );
  } finally {
    await cleanup(
      prisma,
      [tenant.id, otherTenant.id],
      [ownerUser.id, managerOneUser.id, managerTwoUser.id, agentUser.id],
    );
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
