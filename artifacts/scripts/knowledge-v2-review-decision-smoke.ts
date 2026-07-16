import { randomBytes, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { createRuntimeQueueEvent } from "@leadvirt/runtime-queue";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeSourceQueueService } from "../../apps/api/src/modules/knowledge/knowledge-source-queue.service.js";
import { strongKnowledgeV2Etag } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "../../apps/api/src/modules/knowledge/knowledge-v2-conflict-candidate-reader.service.js";
import { KnowledgeV2ReviewDecisionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.js";
import { KnowledgeV2ReviewService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review.service.js";
import { KnowledgeV2SourceService } from "../../apps/api/src/modules/knowledge/knowledge-v2-source.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks += 1;
}

function context(tenant: RequestContext["tenant"], user: RequestContext["user"]): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user,
  };
}

function sourceConfig() {
  return {
    env: { APP_ENV: "local" },
    knowledgeWebsiteImportEnabled: true,
    knowledgeWebsiteEgressReady: true,
    knowledgeObjectStorePath: "C:\\leadvirt-review-decision-smoke",
    knowledgeArtifactEncryptionKey: randomBytes(32).toString("base64"),
    knowledgeArtifactEncryptionKeyId: "review-decision-smoke",
    knowledgeAcceptanceWebsiteFixtureEnabled: false,
  } as unknown as AppConfigService;
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : null;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    check(
      errorCode(error) === code,
      `Expected ${code}, received ${errorCode(error) ?? "unknown"}.`,
    );
    return;
  }
  throw new Error(`Expected ${code}.`);
}

async function cleanup(prisma: PrismaService, tenantId: string, userId?: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.knowledgeV2FeedbackEvidence.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2ReviewItemEvidence.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2ConflictCandidateEvidence.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2ReviewItem.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2ConflictCandidate.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Conflict.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Evidence.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Feedback.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2FactVersion.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Fact.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2GuidanceRuleVersion.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2GuidanceRule.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Chunk.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Element.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2DocumentRevision.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Document.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2DeletionLedger.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Source.deleteMany({ where: { tenantId } });
    await tx.knowledgeInbox.deleteMany({ where: { tenantId } });
    await tx.knowledgeOutbox.deleteMany({ where: { tenantId } });
    await tx.runtimeOutbox.deleteMany({ where: { tenantId } });
    await tx.knowledgeJobAttempt.deleteMany({ where: { tenantId } });
    await tx.knowledgeJob.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId } });
    await tx.knowledgeV2Settings.deleteMany({ where: { tenantId } });
    await tx.auditLog.deleteMany({ where: { tenantId } });
    await tx.membership.deleteMany({ where: { tenantId } });
    await tx.tenant.deleteMany({ where: { id: tenantId } });
    if (userId) await tx.user.deleteMany({ where: { id: userId } });
  });
}

async function main() {
  const prisma = new PrismaService();
  let tenantId = "";
  let userId: string | undefined;
  await prisma.$connect();
  try {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: "Review decision smoke", slug: `review-decision-${stamp}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { email: `review-decision-${stamp}@example.test`, name: "Decision owner" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId, userId: user.id, role: "OWNER" },
    });
    await prisma.knowledgeV2Settings.create({ data: { tenantId } });
    const owner = context(tenant, user);
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const knowledge = new KnowledgeV2Service(prisma, idempotency);
    const config = sourceConfig();
    const candidateReader = new KnowledgeV2ConflictCandidateReaderService(prisma, config);
    const fakeSourceQueue = {
      createEvent: (
        tx: Parameters<typeof createRuntimeQueueEvent>[0],
        data: {
          tenantId: string;
          sourceId: string;
          knowledgeJobId: string;
          generation: number;
          operation: "IMPORT" | "SYNC" | "RECONCILE" | "DELETE";
          requestedByUserId: string;
          requestedAt: string;
        },
      ) => {
        const event = `knowledge.source.${data.operation.toLowerCase()}.requested`;
        return createRuntimeQueueEvent(tx, {
          tenantId: data.tenantId,
          aggregateType: "knowledge-source",
          aggregateId: data.sourceId,
          aggregateVersion: data.generation,
          generation: data.generation,
          eventType: event,
          dedupeKey: `${event}:${data.sourceId}:${data.generation}`,
          deadlineAt: new Date(Date.now() + 30 * 60_000),
          envelope: {
            queueName: "knowledge.ingest",
            jobName: data.operation.toLowerCase(),
            jobId: `knowledge-source:${data.knowledgeJobId}`,
            data: data as unknown as Record<string, unknown>,
            attempts: 5,
            backoffMs: 2_000,
          },
        });
      },
      dispatch: () => undefined,
    } as unknown as KnowledgeSourceQueueService;
    const sourceService = new KnowledgeV2SourceService(
      prisma,
      idempotency,
      fakeSourceQueue,
      config,
    );
    const decisions = new KnowledgeV2ReviewDecisionService(
      prisma,
      knowledge,
      sourceService,
      fakeSourceQueue,
      candidateReader,
    );
    decisions.dispatchSoon = () => undefined;
    const reviews = new KnowledgeV2ReviewService(prisma, idempotency, decisions, candidateReader);
    const publications = new KnowledgeV2PublicationService(prisma, idempotency, {} as never);

    let sequence = 0;
    const seedFact = async (value: string, versionCount = 1) => {
      sequence += 1;
      const fact = await prisma.knowledgeV2Fact.create({
        data: {
          tenantId,
          factKey: `decision.fact.${sequence}`,
          entityType: "business",
          fieldType: "text",
          latestVersionNumber: versionCount,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });
      const versions = [];
      for (let index = 1; index <= versionCount; index += 1) {
        versions.push(
          await prisma.knowledgeV2FactVersion.create({
            data: {
              tenantId,
              factId: fact.id,
              versionNumber: index,
              normalizedValue: { value: `${value}-${index}` },
              displayValue: `${value}-${index}`,
              locale: "en",
              localeBehavior: "LANGUAGE_NEUTRAL",
              riskLevel: "LOW",
              authority: "MANUAL",
              lifecycleStatus: "DRAFT",
              verificationStatus: "UNVERIFIED",
              immutableHash: `fact-${sequence}-version-${index}-${stamp}`,
              supersedesVersionId: index > 1 ? versions[index - 2]!.id : null,
              createdByUserId: user.id,
            },
          }),
        );
      }
      return { fact, versions };
    };

    const seedGuidance = async (label: string) => {
      sequence += 1;
      const rule = await prisma.knowledgeV2GuidanceRule.create({
        data: {
          tenantId,
          ruleKey: `decision.guidance.${sequence}`,
          title: label,
          ruleType: "RESPONSE",
          latestVersionNumber: 1,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });
      const version = await prisma.knowledgeV2GuidanceRuleVersion.create({
        data: {
          tenantId,
          guidanceRuleId: rule.id,
          versionNumber: 1,
          title: label,
          ruleType: "RESPONSE",
          conditionAst: { kind: "ALL", conditions: [] },
          instruction: `Instruction for ${label}.`,
          priority: 0,
          tieBreakKey: `decision:${sequence}`,
          riskLevel: "LOW",
          reviewStatus: "PENDING_REVIEW",
          immutableHash: `guidance-${sequence}-${stamp}`,
          createdByUserId: user.id,
        },
      });
      return { rule, version };
    };

    const seedSource = async (label: string, withRevision = false) => {
      sequence += 1;
      const source = await prisma.knowledgeV2Source.create({
        data: {
          tenantId,
          kind: "WEBSITE",
          displayName: label,
          externalRootKey: `decision-source-${sequence}-${stamp}`,
          canonicalUri: "https://example.com/",
          status: "READY",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });
      if (!withRevision) return { source, revision: null };
      const document = await prisma.knowledgeV2Document.create({
        data: {
          tenantId,
          sourceId: source.id,
          externalKey: `decision-document-${sequence}`,
          kind: "policy",
          title: label,
          classification: "PUBLIC",
          status: "ACTIVE",
        },
      });
      const revision = await prisma.knowledgeV2DocumentRevision.create({
        data: {
          tenantId,
          sourceId: source.id,
          documentId: document.id,
          revisionNumber: 1,
          contentHash: `source-revision-${sequence}-${stamp}`,
          status: "READY",
          pipelineVersion: "knowledge-v2",
          sourcePermissionFingerprint: `permission-${sequence}`,
          createdByUserId: user.id,
        },
      });
      return { source, revision };
    };

    const seedReview = async (input: {
      reason:
        | "MISSING_REQUIRED_INFORMATION"
        | "INFERRED_HIGH_RISK"
        | "LOW_CONFIDENCE_CONTENT"
        | "SENSITIVE_CONTENT"
        | "STALE_SOURCE"
        | "FAILING_TEST";
      suggestedAction:
        | "APPROVE"
        | "REJECT"
        | "ADD_MISSING_ANSWER"
        | "MARK_UNANSWERABLE"
        | "REQUIRE_HANDOFF"
        | "CORRECT_SOURCE"
        | "EXCLUDE_CONTENT"
        | "RETRY_SOURCE"
        | "VERIFY_PERMISSION";
      factId?: string;
      guidanceRuleId?: string;
      sourceId?: string;
      revisionId?: string;
      conflictId?: string;
    }) => {
      sequence += 1;
      return prisma.knowledgeV2ReviewItem.create({
        data: {
          tenantId,
          reviewKey: `decision-review-${sequence}-${stamp}`,
          reason: input.reason,
          riskLevel: "LOW",
          suggestedAction: input.suggestedAction,
          safeTitle: `Decision review ${sequence}`,
          factId: input.factId ?? null,
          guidanceRuleId: input.guidanceRuleId ?? null,
          sourceId: input.sourceId ?? null,
          v2DocumentRevisionId: input.revisionId ?? null,
          conflictId: input.conflictId ?? null,
          createdByUserId: user.id,
        },
      });
    };

    const decisionEvent = (decisionId: string) =>
      prisma.knowledgeOutbox.findFirstOrThrow({
        where: {
          tenantId,
          aggregateId: decisionId,
          eventType: "knowledge.v2.review-decision.execute.requested",
        },
      });

    const resolve = async (
      review: Awaited<ReturnType<typeof seedReview>>,
      action: Parameters<KnowledgeV2ReviewService["resolveReviewItem"]>[2]["action"],
    ) => {
      const result = await reviews.resolveReviewItem(
        owner,
        review.id,
        { action, rationale: `Resolve ${action}.` },
        `resolve-${review.id}`,
        [strongKnowledgeV2Etag("review-item", review.id, review.etag)],
      );
      const event = await decisionEvent(review.id);
      check(
        result.resource.status === "IN_REVIEW" && event.status === "PENDING",
        `${action} records a pending decision and durable outbox atomically`,
      );
      return event;
    };

    const approveFact = await seedFact("approve");
    const approveReview = await seedReview({
      reason: "INFERRED_HIGH_RISK",
      suggestedAction: "APPROVE",
      factId: approveFact.fact.id,
    });
    const approveEvent = await resolve(approveReview, "APPROVE");
    await decisions.dispatch(approveEvent.id);
    check(
      (
        await prisma.knowledgeV2FactVersion.findFirstOrThrow({
          where: { tenantId, factId: approveFact.fact.id },
          orderBy: { versionNumber: "desc" },
        })
      ).verificationStatus === "VERIFIED" &&
        (
          await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
            where: { id: approveReview.id },
          })
        ).status === "RESOLVED",
      "APPROVE creates a verified fact successor before settling the review",
    );
    await decisions.dispatch(approveEvent.id);
    check(
      (await prisma.knowledgeV2FactVersion.count({
        where: { tenantId, factId: approveFact.fact.id },
      })) === 2,
      "duplicate fact decision delivery is idempotent",
    );
    await prisma.knowledgeOutbox.update({
      where: { id: approveEvent.id },
      data: { status: "FAILED", publishedAt: null, availableAt: new Date() },
    });
    await decisions.dispatch(approveEvent.id);
    check(
      (await prisma.knowledgeV2FactVersion.count({
        where: { tenantId, factId: approveFact.fact.id },
      })) === 2,
      "redrive reconciles a committed successor without duplicating it",
    );

    const rejectFact = await seedFact("reject");
    const rejectReview = await seedReview({
      reason: "INFERRED_HIGH_RISK",
      suggestedAction: "REJECT",
      factId: rejectFact.fact.id,
    });
    await decisions.dispatch((await resolve(rejectReview, "REJECT")).id);
    check(
      (
        await prisma.knowledgeV2FactVersion.findFirstOrThrow({
          where: { tenantId, factId: rejectFact.fact.id },
          orderBy: { versionNumber: "desc" },
        })
      ).verificationStatus === "REJECTED",
      "REJECT creates a rejected fact successor",
    );

    for (const action of ["APPROVE", "REJECT"] as const) {
      const guidance = await seedGuidance(`Guidance ${action}`);
      const review = await seedReview({
        reason: "FAILING_TEST",
        suggestedAction: action,
        guidanceRuleId: guidance.rule.id,
      });
      await decisions.dispatch((await resolve(review, action)).id);
      const latest = await prisma.knowledgeV2GuidanceRuleVersion.findFirstOrThrow({
        where: { tenantId, guidanceRuleId: guidance.rule.id },
        orderBy: { versionNumber: "desc" },
      });
      check(
        latest.reviewStatus === (action === "APPROVE" ? "APPROVED" : "REJECTED"),
        `${action} creates the matching guidance successor`,
      );
    }

    for (const action of ["MARK_UNANSWERABLE", "REQUIRE_HANDOFF"] as const) {
      const fact = await seedFact(action.toLowerCase());
      const review = await seedReview({
        reason: "MISSING_REQUIRED_INFORMATION",
        suggestedAction: action,
        factId: fact.fact.id,
      });
      const before = await prisma.knowledgeV2GuidanceRule.count({ where: { tenantId } });
      await decisions.dispatch((await resolve(review, action)).id);
      const policy = await prisma.knowledgeV2GuidanceRuleVersion.findFirstOrThrow({
        where: {
          tenantId,
          guidanceRule: { createdAt: { gte: review.createdAt } },
          ruleType: action === "REQUIRE_HANDOFF" ? "ESCALATION" : "PROHIBITION",
        },
        orderBy: { createdAt: "desc" },
      });
      check(
        (await prisma.knowledgeV2GuidanceRule.count({ where: { tenantId } })) === before + 1 &&
          policy.reviewStatus === "DRAFT",
        `${action} creates a narrowly scoped draft policy without publishing`,
      );
    }

    const dismissFact = await seedFact("dismiss");
    const dismissReview = await seedReview({
      reason: "LOW_CONFIDENCE_CONTENT",
      suggestedAction: "APPROVE",
      factId: dismissFact.fact.id,
    });
    const dismissed = await reviews.dismissReviewItem(
      owner,
      dismissReview.id,
      { rationale: "Dismiss this review." },
      `dismiss-${dismissReview.id}`,
      [strongKnowledgeV2Etag("review-item", dismissReview.id, dismissReview.etag)],
    );
    const dismissEvent = await decisionEvent(dismissReview.id);
    await decisions.dispatch(dismissEvent.id);
    check(
      dismissed.resource.status === "IN_REVIEW" &&
        (await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: { id: dismissReview.id },
        })).status === "DISMISSED" &&
        (await prisma.knowledgeV2FactVersion.count({
          where: { tenantId, factId: dismissFact.fact.id },
        })) === 1,
      "DISMISS executes as an audited no-change outcome",
    );

    const sourceCases = [
      { action: "CORRECT_SOURCE" as const, reason: "STALE_SOURCE" as const },
      { action: "RETRY_SOURCE" as const, reason: "STALE_SOURCE" as const },
      { action: "VERIFY_PERMISSION" as const, reason: "SENSITIVE_CONTENT" as const },
    ];
    for (const item of sourceCases) {
      const seeded = await seedSource(item.action, false);
      const review = await seedReview({
        reason: item.reason,
        suggestedAction: item.action,
        sourceId: seeded.source.id,
      });
      await decisions.dispatch((await resolve(review, item.action)).id);
      const updated = await prisma.knowledgeV2Source.findUniqueOrThrow({
        where: { id: seeded.source.id },
      });
      check(
        updated.status === "SYNCING" && updated.generation === seeded.source.generation + 1,
        `${item.action} creates a fenced source follow-up`,
      );
    }

    const sourceExclusion = await seedSource("exclude-source", false);
    const sourceExcludeReview = await seedReview({
      reason: "LOW_CONFIDENCE_CONTENT",
      suggestedAction: "EXCLUDE_CONTENT",
      sourceId: sourceExclusion.source.id,
    });
    await decisions.dispatch((await resolve(sourceExcludeReview, "EXCLUDE_CONTENT")).id);
    check(
      (
        await prisma.knowledgeV2Source.findUniqueOrThrow({
          where: { id: sourceExclusion.source.id },
        })
      ).status === "DELETING",
      "EXCLUDE_CONTENT tombstones a pinned source and queues deletion",
    );

    const exclusion = await seedSource("EXCLUDE_CONTENT", true);
    const excludeReview = await seedReview({
      reason: "LOW_CONFIDENCE_CONTENT",
      suggestedAction: "EXCLUDE_CONTENT",
      sourceId: exclusion.source.id,
      revisionId: exclusion.revision!.id,
    });
    await decisions.dispatch((await resolve(excludeReview, "EXCLUDE_CONTENT")).id);
    check(
      (
        await prisma.knowledgeV2DocumentRevision.findUniqueOrThrow({
          where: { id: exclusion.revision!.id },
        })
      ).status === "REJECTED",
      "EXCLUDE_CONTENT rejects the pinned revision and queues reconciliation",
    );

    for (const resolution of ["KEEP_LEFT", "KEEP_RIGHT"] as const) {
      const seeded = await seedFact(`conflict-${resolution}`, 2);
      const conflict = await prisma.knowledgeV2Conflict.create({
        data: {
          tenantId,
          conflictKey: `decision-conflict-${resolution}-${stamp}`,
          conflictType: "FACT_VALUE",
          semanticKey: `decision.semantic.${resolution.toLowerCase()}`,
          scopeHash: `scope-${resolution}-${stamp}`,
          severity: "LOW",
          factId: seeded.fact.id,
          candidateSetHash: `candidate-set-${resolution}-${stamp}`,
        },
      });
      for (const [ordinal, version] of seeded.versions.entries()) {
        await prisma.knowledgeV2ConflictCandidate.create({
          data: {
            tenantId,
            conflictId: conflict.id,
            candidateKey: `candidate-${ordinal}`,
            ordinal,
            candidateType: "FACT_VERSION",
            itemVersionHash: version.immutableHash,
            factVersionId: version.id,
            candidateValueHash: `candidate-value-${ordinal}-${stamp}`,
          },
        });
      }
      const linkedReview =
        resolution === "KEEP_LEFT"
          ? await seedReview({
              reason: "CONFLICTING_VALUES",
              suggestedAction: "APPROVE",
              conflictId: conflict.id,
            })
          : null;
      const resolved = await reviews.resolveConflict(
        owner,
        conflict.id,
        { resolution, rationale: `Choose ${resolution}.` },
        `resolve-${conflict.id}`,
        [strongKnowledgeV2Etag("conflict", conflict.id, conflict.etag)],
      );
      const event = await decisionEvent(conflict.id);
      const pendingReadiness = await publications.getReadiness(owner);
      check(
        resolved.resource.status === "IN_REVIEW" &&
          resolved.resource.resolution === null &&
          pendingReadiness.draft.blockers.some(
            (blocker) =>
              blocker.code === "KNOWLEDGE_PUBLICATION_CONFLICT_UNRESOLVED" &&
              blocker.resource?.id === conflict.id,
          ) &&
          (!linkedReview ||
            (
              await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
                where: { id: linkedReview.id },
              })
            ).status !== "RESOLVED"),
        `${resolution} keeps conflict publication gates active while its successor is pending`,
      );
      await decisions.dispatch(event.id);
      const latest = await prisma.knowledgeV2FactVersion.findFirstOrThrow({
        where: { tenantId, factId: seeded.fact.id },
        orderBy: { versionNumber: "desc" },
      });
      const selected = resolution === "KEEP_LEFT" ? seeded.versions[0]! : seeded.versions[1]!;
      const settledConflict = await prisma.knowledgeV2Conflict.findUniqueOrThrow({
        where: { id: conflict.id },
      });
      const settledReadiness = await publications.getReadiness(owner);
      check(
        settledConflict.status === "RESOLVED" &&
          settledConflict.resolution === resolution &&
          latest.versionNumber === 3 &&
          latest.displayValue === selected.displayValue &&
          !settledReadiness.draft.blockers.some(
            (blocker) => blocker.resource?.id === conflict.id,
          ) &&
          (!linkedReview ||
            (
              await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
                where: { id: linkedReview.id },
              })
            ).status === "RESOLVED"),
        `${resolution} creates one successor before atomically settling conflict gates`,
      );
    }

    const unsupportedConflict = await prisma.knowledgeV2Conflict.create({
      data: {
        tenantId,
        conflictKey: `decision-conflict-unsupported-${stamp}`,
        conflictType: "SCOPE_OVERLAP",
        semanticKey: "decision.semantic.unsupported",
        scopeHash: `scope-unsupported-${stamp}`,
        severity: "LOW",
        candidateSetHash: `candidate-set-unsupported-${stamp}`,
      },
    });
    const unsupportedEventCount = await prisma.knowledgeOutbox.count({ where: { tenantId } });
    for (const resolution of ["MERGE", "SPLIT_SCOPE"] as const) {
      await expectCode(
        reviews.resolveConflict(
          owner,
          unsupportedConflict.id,
          { resolution: resolution as never, rationale: "Unsupported decision." },
          `unsupported-${resolution}-${unsupportedConflict.id}`,
          [strongKnowledgeV2Etag("conflict", unsupportedConflict.id, unsupportedConflict.etag)],
        ),
        "KNOWLEDGE_VALIDATION_CONFLICT_RESOLUTION_UNSUPPORTED",
      );
    }
    check(
      (await prisma.knowledgeOutbox.count({ where: { tenantId } })) === unsupportedEventCount &&
        (
          await prisma.knowledgeV2Conflict.findUniqueOrThrow({
            where: { id: unsupportedConflict.id },
          })
        ).status === "OPEN",
      "Unsupported conflict decisions are rejected before durable acceptance",
    );

    const failedConflictFact = await seedFact("failed-conflict", 2);
    const failedConflict = await prisma.knowledgeV2Conflict.create({
      data: {
        tenantId,
        conflictKey: `decision-conflict-failed-${stamp}`,
        conflictType: "FACT_VALUE",
        semanticKey: "decision.semantic.failed",
        scopeHash: `scope-failed-${stamp}`,
        severity: "LOW",
        factId: failedConflictFact.fact.id,
        candidateSetHash: `candidate-set-failed-${stamp}`,
      },
    });
    for (const [ordinal, version] of failedConflictFact.versions.entries()) {
      await prisma.knowledgeV2ConflictCandidate.create({
        data: {
          tenantId,
          conflictId: failedConflict.id,
          candidateKey: `failed-candidate-${ordinal}`,
          ordinal,
          candidateType: "FACT_VERSION",
          itemVersionHash: version.immutableHash,
          factVersionId: version.id,
          candidateValueHash: `failed-candidate-value-${ordinal}-${stamp}`,
        },
      });
    }
    await reviews.resolveConflict(
      owner,
      failedConflict.id,
      { resolution: "KEEP_LEFT", rationale: "Exercise a stale target." },
      `resolve-failed-${failedConflict.id}`,
      [strongKnowledgeV2Etag("conflict", failedConflict.id, failedConflict.etag)],
    );
    const failedConflictEvent = await decisionEvent(failedConflict.id);
    await prisma.knowledgeV2Fact.update({
      where: { id: failedConflictFact.fact.id },
      data: { etag: { increment: 1 }, generation: { increment: 1 } },
    });
    await decisions.dispatch(failedConflictEvent.id);
    const failedReadiness = await publications.getReadiness(owner);
    check(
      (
        await prisma.knowledgeV2Conflict.findUniqueOrThrow({
          where: { id: failedConflict.id },
        })
      ).status === "IN_REVIEW" &&
        (
          await prisma.knowledgeOutbox.findUniqueOrThrow({
            where: { id: failedConflictEvent.id },
          })
        ).lastErrorCode === "KNOWLEDGE_CONFLICT_REVIEW_DECISION_STALE" &&
        failedReadiness.draft.blockers.some(
          (blocker) =>
            blocker.code === "KNOWLEDGE_PUBLICATION_CONFLICT_UNRESOLVED" &&
            blocker.resource?.id === failedConflict.id,
        ),
      "A failed conflict effect remains pending and blocks publication",
    );

    const unavailableFact = await seedFact("unavailable");
    const unavailableReview = await seedReview({
      reason: "MISSING_REQUIRED_INFORMATION",
      suggestedAction: "ADD_MISSING_ANSWER",
      factId: unavailableFact.fact.id,
    });
    const unavailableEvent = await resolve(unavailableReview, "ADD_MISSING_ANSWER");
    await decisions.dispatch(unavailableEvent.id);
    check(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: unavailableEvent.id } }))
        .lastErrorCode === "KNOWLEDGE_CONFLICT_REVIEW_DECISION_VALUE_UNAVAILABLE",
      "missing restricted values fail terminally without being hydrated",
    );

    const staleFact = await seedFact("stale");
    const staleReview = await seedReview({
      reason: "INFERRED_HIGH_RISK",
      suggestedAction: "APPROVE",
      factId: staleFact.fact.id,
    });
    const staleEvent = await resolve(staleReview, "APPROVE");
    await prisma.knowledgeV2Fact.update({
      where: { id: staleFact.fact.id },
      data: { etag: { increment: 1 }, generation: { increment: 1 } },
    });
    await decisions.dispatch(staleEvent.id);
    check(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: staleEvent.id } }))
        .lastErrorCode === "KNOWLEDGE_CONFLICT_REVIEW_DECISION_STALE" &&
        (
          await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
            where: { id: staleReview.id },
          })
        ).status === "IN_REVIEW",
      "a stale target version is fenced while its review remains pending",
    );

    const revokedFact = await seedFact("revoked");
    const revokedReview = await seedReview({
      reason: "MISSING_REQUIRED_INFORMATION",
      suggestedAction: "REQUIRE_HANDOFF",
      factId: revokedFact.fact.id,
    });
    const revokedEvent = await resolve(revokedReview, "REQUIRE_HANDOFF");
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      data: { role: "VIEWER" },
    });
    await decisions.dispatch(revokedEvent.id);
    check(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: revokedEvent.id } }))
        .lastErrorCode === "KNOWLEDGE_PERMISSION_REVIEW_DECISION_ACTOR_INVALID",
      "a revoked actor cannot execute a late decision",
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      data: { role: "OWNER" },
    });

    check(
      (await prisma.knowledgePublication.count({ where: { tenantId } })) === 0,
      "review decision outcomes never create a publication",
    );
    const persisted = JSON.stringify({
      jobs: await prisma.knowledgeJob.findMany({ where: { tenantId } }),
      events: await prisma.knowledgeOutbox.findMany({ where: { tenantId } }),
      inbox: await prisma.knowledgeInbox.findMany({ where: { tenantId } }),
      audits: await prisma.auditLog.findMany({ where: { tenantId } }),
    });
    check(!persisted.includes("normalizedValue"), "decision envelopes never copy fact values");
    check(
      !persisted.includes("restrictedValueRef"),
      "decision envelopes never copy restricted references",
    );
  } finally {
    if (tenantId) await cleanup(prisma, tenantId, userId).catch(() => undefined);
    await prisma.$disconnect();
  }
  console.log(`Knowledge v2 review decision smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(errorCode(error) ?? error);
  process.exitCode = 1;
});
