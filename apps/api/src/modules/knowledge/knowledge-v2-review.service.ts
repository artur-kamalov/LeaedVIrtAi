import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type {
  KnowledgeV2AssignReviewRequest,
  KnowledgeV2ConflictListQuery,
  KnowledgeV2ConflictMutationResult,
  KnowledgeV2ConflictPage,
  KnowledgeV2ConflictResolution,
  KnowledgeV2ConflictView,
  KnowledgeV2DismissReviewRequest,
  KnowledgeV2EvidenceReferenceView,
  KnowledgeV2JsonValue,
  KnowledgeV2ResolveConflictRequest,
  KnowledgeV2ResolveReviewItemRequest,
  KnowledgeV2ReviewAction,
  KnowledgeV2ReviewItemListQuery,
  KnowledgeV2ReviewItemMutationResult,
  KnowledgeV2ReviewItemPage,
  KnowledgeV2ReviewItemView,
  KnowledgeV2ReviewReason,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import { KnowledgeV2ReviewDecisionService } from "./knowledge-v2-review-decision.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "./knowledge-v2-conflict-candidate-reader.service.js";

const terminalReviewStatuses = ["RESOLVED", "DISMISSED", "SUPERSEDED"] as const;
const terminalConflictStatuses = ["RESOLVED", "DISMISSED", "SUPERSEDED"] as const;
const elevatedRiskLevels = ["HIGH", "CRITICAL"] as const;
const reviewerRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
const maximumReviewEvidence = 50;
const maximumConflictCandidates = 20;
const maximumCandidateEvidence = 10;
export const knowledgeV2ReviewResolutionActions = {
  MISSING_REQUIRED_INFORMATION: [
    "ADD_MISSING_ANSWER",
    "MARK_UNANSWERABLE",
    "REQUIRE_HANDOFF",
    "APPROVE",
    "REJECT",
  ],
  CONFLICTING_VALUES: ["REVIEW_VALUE", "MARK_UNANSWERABLE", "REQUIRE_HANDOFF", "APPROVE", "REJECT"],
  INFERRED_HIGH_RISK: ["REVIEW_VALUE", "MARK_UNANSWERABLE", "REQUIRE_HANDOFF", "APPROVE", "REJECT"],
  LOW_CONFIDENCE_CONTENT: [
    "REVIEW_VALUE",
    "CORRECT_SOURCE",
    "EXCLUDE_CONTENT",
    "APPROVE",
    "REJECT",
  ],
  SENSITIVE_CONTENT: ["REVIEW_VALUE", "EXCLUDE_CONTENT", "VERIFY_PERMISSION", "APPROVE", "REJECT"],
  STALE_SOURCE: ["CORRECT_SOURCE", "EXCLUDE_CONTENT", "RETRY_SOURCE", "APPROVE", "REJECT"],
  INACCESSIBLE_SOURCE: [
    "CORRECT_SOURCE",
    "EXCLUDE_CONTENT",
    "RETRY_SOURCE",
    "MARK_UNANSWERABLE",
    "REQUIRE_HANDOFF",
    "REJECT",
  ],
  FAILING_TEST: [
    "REVIEW_VALUE",
    "CORRECT_SOURCE",
    "ADD_MISSING_ANSWER",
    "CHANGE_GUIDANCE",
    "MARK_UNANSWERABLE",
    "REQUIRE_HANDOFF",
    "APPROVE",
    "REJECT",
  ],
} as const satisfies Record<KnowledgeV2ReviewReason, readonly KnowledgeV2ReviewAction[]>;

const actorInclude = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.MembershipInclude;

const evidenceReferenceInclude = {
  documentRevision: {
    select: {
      document: {
        select: {
          classification: true,
          status: true,
          tombstonedAt: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.KnowledgeV2EvidenceReferenceInclude;

const evidenceLinkInclude = {
  evidenceReference: { include: evidenceReferenceInclude },
} satisfies Prisma.KnowledgeV2ReviewItemEvidenceInclude;

const candidateEvidenceLinkInclude = {
  evidenceReference: { include: evidenceReferenceInclude },
} satisfies Prisma.KnowledgeV2ConflictCandidateEvidenceInclude;

const reviewInclude = {
  createdBy: { include: actorInclude },
  assignee: { include: actorInclude },
  resolvedBy: { include: actorInclude },
  evidenceLinks: {
    include: evidenceLinkInclude,
    orderBy: [{ ordinal: "asc" as const }, { evidenceReferenceId: "asc" as const }],
    take: maximumReviewEvidence + 1,
  },
  _count: { select: { evidenceLinks: true } },
} satisfies Prisma.KnowledgeV2ReviewItemInclude;

const conflictInclude = {
  assignee: { include: actorInclude },
  resolvedBy: { include: actorInclude },
  candidates: {
    include: {
      factVersion: { select: { displayValue: true } },
      evidenceLinks: {
        include: candidateEvidenceLinkInclude,
        orderBy: [{ ordinal: "asc" as const }, { evidenceReferenceId: "asc" as const }],
        take: maximumCandidateEvidence + 1,
      },
      _count: { select: { evidenceLinks: true } },
    },
    orderBy: [{ ordinal: "asc" as const }, { id: "asc" as const }],
    take: maximumConflictCandidates + 1,
  },
  reviewItems: {
    where: {
      status: { in: ["OPEN" as const, "ASSIGNED" as const, "IN_REVIEW" as const] },
      OR: [
        { riskLevel: { in: ["HIGH" as const, "CRITICAL" as const] } },
        { reason: "SENSITIVE_CONTENT" as const },
      ],
    },
    select: { id: true },
    take: 1,
  },
  _count: { select: { candidates: true } },
} satisfies Prisma.KnowledgeV2ConflictInclude;

type ReviewRecord = Prisma.KnowledgeV2ReviewItemGetPayload<{ include: typeof reviewInclude }>;
type ConflictRecord = Prisma.KnowledgeV2ConflictGetPayload<{ include: typeof conflictInclude }>;
type ReviewEvidenceLink = ReviewRecord["evidenceLinks"][number];
type ConflictEvidenceLink = ConflictRecord["candidates"][number]["evidenceLinks"][number];
type EvidenceRecord = ReviewEvidenceLink["evidenceReference"];

function dateValue(value: Date | null) {
  return value?.toISOString() ?? null;
}

function reviewEtag(review: Pick<ReviewRecord, "id" | "etag">) {
  return strongKnowledgeV2Etag("review-item", review.id, review.etag);
}

function conflictEtag(conflict: Pick<ConflictRecord, "id" | "etag">) {
  return strongKnowledgeV2Etag("conflict", conflict.id, conflict.etag);
}

function jsonValue(value: Prisma.JsonValue | null): KnowledgeV2JsonValue | null {
  return value as KnowledgeV2JsonValue | null;
}

function isElevatedRisk(value: KnowledgeV2RiskLevel) {
  return elevatedRiskLevels.includes(value as (typeof elevatedRiskLevels)[number]);
}

function isTerminalReview(status: ReviewRecord["status"]) {
  return terminalReviewStatuses.includes(status as (typeof terminalReviewStatuses)[number]);
}

function isTerminalConflict(status: ConflictRecord["status"]) {
  return terminalConflictStatuses.includes(status as (typeof terminalConflictStatuses)[number]);
}

function actorView(member: { user: { id: string; name: string | null } } | null) {
  if (!member) return null;
  return {
    id: member.user.id,
    displayName: member.user.name?.trim() || "Workspace member",
  };
}

function rationaleHash(value: string | null | undefined) {
  const normalized = value?.trim();
  return canonicalKnowledgeV2Hash({ version: 1, rationale: normalized || null });
}

@Injectable()
export class KnowledgeV2ReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeV2ReviewDecisionService)
    private readonly decisions: KnowledgeV2ReviewDecisionService,
    @Inject(KnowledgeV2ConflictCandidateReaderService)
    private readonly candidateReader: KnowledgeV2ConflictCandidateReaderService,
  ) {}

  async listReviewItems(
    context: RequestContext,
    query: KnowledgeV2ReviewItemListQuery,
  ): Promise<KnowledgeV2ReviewItemPage> {
    this.assertReviewer(context);
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2ReviewItemWhereInput[] = [];
    if (query.query?.trim()) {
      filters.push({
        OR: [
          { reviewKey: { contains: query.query.trim(), mode: "insensitive" } },
          { safeTitle: { contains: query.query.trim(), mode: "insensitive" } },
          { safeSummary: { contains: query.query.trim(), mode: "insensitive" } },
        ],
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2ReviewItem.findMany({
      where: {
        tenantId: context.tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
        ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
        ...(query.assignedToUserId
          ? {
              assignedToUserId:
                query.assignedToUserId === "me" ? context.userId : query.assignedToUserId,
            }
          : {}),
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(query.conflictId ? { conflictId: query.conflictId } : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      include: reviewInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.reviewView(context, row)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getReviewItem(context: RequestContext, reviewItemId: string) {
    this.assertReviewer(context);
    const review = await this.prisma.knowledgeV2ReviewItem.findFirst({
      where: { tenantId: context.tenantId, id: reviewItemId },
      include: reviewInclude,
    });
    if (!review) this.reviewNotFound();
    return this.reviewView(context, review);
  }

  async assignReviewItem(
    context: RequestContext,
    reviewItemId: string,
    input: KnowledgeV2AssignReviewRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ReviewItemMutationResult> {
    this.assertReviewer(context);
    const targetUserId = input.assigneeUserId === undefined ? context.userId : input.assigneeUserId;
    const result = await this.idempotency.execute<KnowledgeV2ReviewItemView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/review-items/:reviewItemId/assign",
        key: idempotencyKey,
        request: { actorUserId: context.userId, reviewItemId, targetUserId, ifMatch },
      },
      async (tx) => {
        const current = await this.lockReview(tx, context.tenantId, reviewItemId);
        assertIfMatch(ifMatch, reviewEtag(current), current.etag, [
          "status",
          "assignedToUserId",
          "generation",
        ]);
        await this.assertNoPendingDecision(
          tx,
          context.tenantId,
          "KnowledgeV2ReviewItem",
          current.id,
          current.generation,
        );
        this.assertReviewAssignable(current);
        await this.assertAssignmentAllowed(tx, context, current.assignedToUserId, targetUserId);
        if (current.assignedToUserId === targetUserId) {
          const unchanged = await this.reviewRecord(tx, context.tenantId, reviewItemId);
          return { httpStatus: HttpStatus.OK, responseBody: this.reviewView(context, unchanged) };
        }
        const updated = await tx.knowledgeV2ReviewItem.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: reviewItemId } },
          data: {
            assignedToUserId: targetUserId,
            assignedAt: targetUserId ? new Date() : null,
            status: targetUserId ? "ASSIGNED" : "OPEN",
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
          include: reviewInclude,
        });
        await this.audit(
          tx,
          context,
          "knowledge.v2.review.assignment_changed",
          "knowledge_v2_review_item",
          reviewItemId,
          {
            previousAssigneeUserId: current.assignedToUserId,
            assignedToUserId: targetUserId,
            previousStatus: current.status,
            status: updated.status,
            generation: updated.generation,
          },
        );
        return { httpStatus: HttpStatus.OK, responseBody: this.reviewView(context, updated) };
      },
    );
    return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  async resolveReviewItem(
    context: RequestContext,
    reviewItemId: string,
    input: KnowledgeV2ResolveReviewItemRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ReviewItemMutationResult> {
    return this.finishReviewItem(
      context,
      reviewItemId,
      "RESOLVED",
      input.action,
      input.rationale,
      idempotencyKey,
      ifMatch,
    );
  }

  async dismissReviewItem(
    context: RequestContext,
    reviewItemId: string,
    input: KnowledgeV2DismissReviewRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ReviewItemMutationResult> {
    this.assertDismissRationale(input.rationale);
    return this.finishReviewItem(
      context,
      reviewItemId,
      "DISMISSED",
      "DISMISS",
      input.rationale,
      idempotencyKey,
      ifMatch,
    );
  }

  async listConflicts(
    context: RequestContext,
    query: KnowledgeV2ConflictListQuery,
  ): Promise<KnowledgeV2ConflictPage> {
    this.assertReviewer(context);
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2ConflictWhereInput[] = [];
    if (query.query?.trim()) {
      filters.push({
        OR: [
          { conflictKey: { contains: query.query.trim(), mode: "insensitive" } },
          { semanticKey: { contains: query.query.trim(), mode: "insensitive" } },
        ],
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2Conflict.findMany({
      where: {
        tenantId: context.tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.conflictType ? { conflictType: query.conflictType } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.assignedToUserId
          ? {
              assignedToUserId:
                query.assignedToUserId === "me" ? context.userId : query.assignedToUserId,
            }
          : {}),
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      include: conflictInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.conflictView(context, row)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getConflict(context: RequestContext, conflictId: string) {
    this.assertReviewer(context);
    const conflict = await this.prisma.knowledgeV2Conflict.findFirst({
      where: { tenantId: context.tenantId, id: conflictId },
      include: conflictInclude,
    });
    if (!conflict) this.conflictNotFound();
    const hydratedValues = new Map<string, string>();
    await Promise.all(
      conflict.candidates.map(async (candidate) => {
        if (!candidate.restrictedValueRef) return;
        const hydration = await this.candidateReader.hydrateForDetail(
          context,
          conflict.id,
          candidate.id,
        );
        if (hydration) hydratedValues.set(candidate.id, hydration.value);
      }),
    );
    return this.conflictView(context, conflict, hydratedValues);
  }

  async assignConflict(
    context: RequestContext,
    conflictId: string,
    input: KnowledgeV2AssignReviewRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ConflictMutationResult> {
    this.assertReviewer(context);
    const targetUserId = input.assigneeUserId === undefined ? context.userId : input.assigneeUserId;
    const result = await this.idempotency.execute<KnowledgeV2ConflictView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/conflicts/:conflictId/assign",
        key: idempotencyKey,
        request: { actorUserId: context.userId, conflictId, targetUserId, ifMatch },
      },
      async (tx) => {
        const current = await this.lockConflict(tx, context.tenantId, conflictId);
        assertIfMatch(ifMatch, conflictEtag(current), current.etag, [
          "status",
          "assignedToUserId",
          "generation",
        ]);
        await this.assertNoPendingDecision(
          tx,
          context.tenantId,
          "KnowledgeV2Conflict",
          current.id,
          current.generation,
        );
        this.assertConflictAssignable(current);
        await this.assertAssignmentAllowed(tx, context, current.assignedToUserId, targetUserId);
        if (current.assignedToUserId === targetUserId) {
          const unchanged = await this.conflictRecord(tx, context.tenantId, conflictId);
          return { httpStatus: HttpStatus.OK, responseBody: this.conflictView(context, unchanged) };
        }
        const updated = await tx.knowledgeV2Conflict.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: conflictId } },
          data: {
            assignedToUserId: targetUserId,
            assignedAt: targetUserId ? new Date() : null,
            status: targetUserId ? "IN_REVIEW" : "OPEN",
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
          include: conflictInclude,
        });
        await this.audit(
          tx,
          context,
          "knowledge.v2.conflict.assignment_changed",
          "knowledge_v2_conflict",
          conflictId,
          {
            previousAssigneeUserId: current.assignedToUserId,
            assignedToUserId: targetUserId,
            previousStatus: current.status,
            status: updated.status,
            generation: updated.generation,
          },
        );
        return { httpStatus: HttpStatus.OK, responseBody: this.conflictView(context, updated) };
      },
    );
    return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  async resolveConflict(
    context: RequestContext,
    conflictId: string,
    input: KnowledgeV2ResolveConflictRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ConflictMutationResult> {
    return this.finishConflict(
      context,
      conflictId,
      "RESOLVED",
      input.resolution,
      input.rationale,
      idempotencyKey,
      ifMatch,
    );
  }

  async dismissConflict(
    context: RequestContext,
    conflictId: string,
    input: KnowledgeV2DismissReviewRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ConflictMutationResult> {
    this.assertDismissRationale(input.rationale);
    return this.finishConflict(
      context,
      conflictId,
      "DISMISSED",
      "DISMISS",
      input.rationale,
      idempotencyKey,
      ifMatch,
    );
  }

  private async finishReviewItem(
    context: RequestContext,
    reviewItemId: string,
    targetStatus: "RESOLVED" | "DISMISSED",
    action: KnowledgeV2ReviewAction,
    rationale: string | null | undefined,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ReviewItemMutationResult> {
    this.assertReviewer(context);
    const summaryHash = rationaleHash(rationale);
    let decisionEventId: string | null = null;
    const result = await this.idempotency.execute<KnowledgeV2ReviewItemView>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/knowledge/v2/review-items/:reviewItemId/${targetStatus.toLowerCase()}`,
        key: idempotencyKey,
        request: {
          actorUserId: context.userId,
          reviewItemId,
          targetStatus,
          action,
          summaryHash,
          ifMatch,
        },
      },
      async (tx) => {
        const current = await this.lockReview(tx, context.tenantId, reviewItemId);
        assertIfMatch(ifMatch, reviewEtag(current), current.etag, [
          "status",
          "resolutionAction",
          "assignedToUserId",
          "generation",
        ]);
        this.assertReviewRiskPermission(context, current.riskLevel, current.reason);
        if (isTerminalReview(current.status)) {
          if (current.status === targetStatus && current.resolutionAction === action) {
            this.assertTerminalReplayAllowed(context, current.resolvedByUserId);
            const unchanged = await this.reviewRecord(tx, context.tenantId, reviewItemId);
            return { httpStatus: HttpStatus.OK, responseBody: this.reviewView(context, unchanged) };
          }
          this.terminalConflict("review item");
        }
        await this.assertNoPendingDecision(
          tx,
          context.tenantId,
          "KnowledgeV2ReviewItem",
          current.id,
          current.generation,
        );
        this.assertManagerAssignment(context, current.assignedToUserId);
        this.assertDecisionActorPermission(context, action);
        await this.assertReviewResolutionAllowed(tx, current, action);
        const updated = await tx.knowledgeV2ReviewItem.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: reviewItemId } },
          data: {
            status: "IN_REVIEW",
            resolutionAction: null,
            resolutionSummaryHash: null,
            restrictedResolutionRef: null,
            resolvedByUserId: null,
            resolvedAt: null,
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
          include: reviewInclude,
        });
        await this.audit(
          tx,
          context,
          "knowledge.v2.review.decision_requested",
          "knowledge_v2_review_item",
          reviewItemId,
          {
            previousStatus: current.status,
            status: "IN_REVIEW",
            targetStatus,
            action,
            rationaleHash: summaryHash,
            riskLevel: current.riskLevel,
            generation: updated.generation,
          },
        );
        decisionEventId = await this.decisions.enqueueReviewDecision(tx, {
          ...updated,
          status: targetStatus,
          resolutionAction: action,
          resolutionSummaryHash: summaryHash,
          resolvedByUserId: context.userId,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.reviewView(context, updated, true),
        };
      },
    );
    this.decisions.dispatchSoon(decisionEventId, result.idempotencyReplayed);
    return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private async finishConflict(
    context: RequestContext,
    conflictId: string,
    targetStatus: "RESOLVED" | "DISMISSED",
    resolution: KnowledgeV2ConflictResolution,
    rationale: string | null | undefined,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2ConflictMutationResult> {
    this.assertReviewer(context);
    const resolutionHash = rationaleHash(rationale);
    let decisionEventId: string | null = null;
    const result = await this.idempotency.execute<KnowledgeV2ConflictView>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/knowledge/v2/conflicts/:conflictId/${targetStatus.toLowerCase()}`,
        key: idempotencyKey,
        request: {
          actorUserId: context.userId,
          conflictId,
          targetStatus,
          resolution,
          resolutionHash,
          ifMatch,
        },
      },
      async (tx) => {
        const current = await this.lockConflict(tx, context.tenantId, conflictId);
        assertIfMatch(ifMatch, conflictEtag(current), current.etag, [
          "status",
          "resolution",
          "assignedToUserId",
          "generation",
        ]);
        this.assertRiskPermission(context, current.severity);
        if (isTerminalConflict(current.status)) {
          if (current.status === targetStatus && current.resolution === resolution) {
            this.assertTerminalReplayAllowed(context, current.resolvedByUserId);
            const unchanged = await this.conflictRecord(tx, context.tenantId, conflictId);
            return {
              httpStatus: HttpStatus.OK,
              responseBody: this.conflictView(context, unchanged),
            };
          }
          this.terminalConflict("conflict");
        }
        await this.assertNoPendingDecision(
          tx,
          context.tenantId,
          "KnowledgeV2Conflict",
          current.id,
          current.generation,
        );
        this.assertManagerAssignment(context, current.assignedToUserId);
        await this.assertConflictResolutionShape(tx, context, conflictId, resolution);
        const linkedReviewLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeV2ReviewItem"
          WHERE "tenantId" = ${context.tenantId}
            AND "conflictId" = ${conflictId}
            AND "status" IN ('OPEN', 'ASSIGNED', 'IN_REVIEW')
          ORDER BY "id" ASC
          FOR UPDATE
        `);
        const linkedReviews = await tx.knowledgeV2ReviewItem.findMany({
          where: {
            tenantId: context.tenantId,
            id: { in: linkedReviewLocks.map((row) => row.id) },
          },
          orderBy: { id: "asc" },
          select: {
            id: true,
            status: true,
            suggestedAction: true,
            riskLevel: true,
            reason: true,
            generation: true,
          },
        });
        this.assertLinkedReviewPermission(context, linkedReviews);
        const updated = await tx.knowledgeV2Conflict.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: conflictId } },
          data: {
            status: "IN_REVIEW",
            resolution: null,
            resolutionRationaleHash: null,
            restrictedResolutionRef: null,
            resolvedByUserId: null,
            resolvedAt: null,
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
          include: conflictInclude,
        });
        await this.audit(
          tx,
          context,
          "knowledge.v2.conflict.decision_requested",
          "knowledge_v2_conflict",
          conflictId,
          {
            previousStatus: current.status,
            status: "IN_REVIEW",
            targetStatus,
            resolution,
            rationaleHash: resolutionHash,
            severity: current.severity,
            linkedReviewCount: linkedReviews.length,
            generation: updated.generation,
          },
        );
        decisionEventId = await this.decisions.enqueueConflictDecision(tx, {
          ...updated,
          status: targetStatus,
          resolution: resolution as Exclude<KnowledgeV2ConflictResolution, "MERGE" | "SPLIT_SCOPE">,
          resolutionRationaleHash: resolutionHash,
          resolvedByUserId: context.userId,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.conflictView(context, updated, undefined, true),
        };
      },
    );
    this.decisions.dispatchSoon(decisionEventId, result.idempotencyReplayed);
    return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private reviewView(
    context: RequestContext,
    review: ReviewRecord,
    decisionPending = false,
  ): KnowledgeV2ReviewItemView {
    return {
      id: review.id,
      corpusKind: "STRUCTURED_V2",
      reviewKey: review.reviewKey,
      reason: review.reason,
      riskLevel: review.riskLevel,
      status: review.status,
      suggestedAction: review.suggestedAction,
      safeTitle: review.safeTitle,
      safeSummary: review.safeSummary,
      hasRestrictedPayload: Boolean(review.restrictedPayloadRef),
      sourceId: review.sourceId,
      documentRevisionId: review.v2DocumentRevisionId,
      factId: review.factId,
      guidanceRuleId: review.guidanceRuleId,
      conflictId: review.conflictId,
      evaluationResultId: review.evaluationResultId,
      feedbackId: review.feedbackId,
      publicationId: review.publicationId,
      createdBy: actorView(review.createdBy),
      assignedTo: actorView(review.assignee),
      assignedAt: dateValue(review.assignedAt),
      dueAt: dateValue(review.dueAt),
      freshnessDueAt: dateValue(review.freshnessDueAt),
      resolutionAction: review.resolutionAction,
      resolutionSummaryHash: review.resolutionSummaryHash,
      hasRestrictedResolution: Boolean(review.restrictedResolutionRef),
      resolvedBy: actorView(review.resolvedBy),
      resolvedAt: dateValue(review.resolvedAt),
      evidenceCount: review._count.evidenceLinks,
      evidenceTruncated: review._count.evidenceLinks > maximumReviewEvidence,
      evidence: review.evidenceLinks
        .slice(0, maximumReviewEvidence)
        .map((link) => this.evidenceLinkView(context, review.riskLevel, link)),
      etag: reviewEtag(review),
      generation: review.generation,
      allowedActions: decisionPending ? [] : this.reviewAllowedActions(context, review),
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  private conflictView(
    context: RequestContext,
    conflict: ConflictRecord,
    hydratedValues?: ReadonlyMap<string, string>,
    decisionPending = false,
  ): KnowledgeV2ConflictView {
    const redactCandidates = context.role === "MANAGER" && isElevatedRisk(conflict.severity);
    return {
      id: conflict.id,
      corpusKind: "STRUCTURED_V2",
      conflictKey: conflict.conflictKey,
      conflictType: conflict.conflictType,
      semanticKey: conflict.semanticKey,
      scope: jsonValue(conflict.scope),
      scopeHash: conflict.scopeHash,
      effectiveFrom: dateValue(conflict.effectiveFrom),
      effectiveUntil: dateValue(conflict.effectiveUntil),
      severity: conflict.severity,
      status: conflict.status,
      sourceId: conflict.sourceId,
      factId: conflict.factId,
      guidanceRuleId: conflict.guidanceRuleId,
      publicationId: conflict.publicationId,
      candidateSetHash: conflict.candidateSetHash,
      candidateCount: conflict._count.candidates,
      candidatesTruncated: conflict._count.candidates > maximumConflictCandidates,
      candidates: conflict.candidates.slice(0, maximumConflictCandidates).map((candidate) => ({
        id: candidate.id,
        candidateKey: redactCandidates ? null : candidate.candidateKey,
        ordinal: candidate.ordinal,
        candidateType: candidate.candidateType,
        itemVersionHash: redactCandidates ? null : candidate.itemVersionHash,
        documentRevisionId: redactCandidates ? null : candidate.v2DocumentRevisionId,
        factVersionId: redactCandidates ? null : candidate.factVersionId,
        guidanceRuleVersionId: redactCandidates ? null : candidate.guidanceRuleVersionId,
        candidateValueHash: redactCandidates ? null : candidate.candidateValueHash,
        safeValue: redactCandidates
          ? null
          : candidate.restrictedValueRef
            ? (hydratedValues?.get(candidate.id) ?? null)
            : (candidate.factVersion?.displayValue ?? null),
        authorityFingerprint: redactCandidates ? null : candidate.authorityFingerprint,
        extractionMethod: redactCandidates ? null : candidate.extractionMethod,
        confidence: redactCandidates ? null : candidate.confidence,
        scope: redactCandidates ? null : jsonValue(candidate.scope),
        effectiveFrom: redactCandidates ? null : dateValue(candidate.effectiveFrom),
        effectiveUntil: redactCandidates ? null : dateValue(candidate.effectiveUntil),
        hasRestrictedValue: Boolean(candidate.restrictedValueRef),
        redacted: redactCandidates,
        evidenceCount: candidate._count.evidenceLinks,
        evidenceTruncated: candidate._count.evidenceLinks > maximumCandidateEvidence,
        evidence: candidate.evidenceLinks
          .slice(0, maximumCandidateEvidence)
          .map((link) => this.evidenceLinkView(context, conflict.severity, link)),
        createdAt: candidate.createdAt.toISOString(),
      })),
      assignedTo: actorView(conflict.assignee),
      assignedAt: dateValue(conflict.assignedAt),
      dueAt: dateValue(conflict.dueAt),
      resolution: conflict.resolution,
      resolutionRationaleHash: conflict.resolutionRationaleHash,
      hasRestrictedResolution: Boolean(conflict.restrictedResolutionRef),
      resolvedBy: actorView(conflict.resolvedBy),
      resolvedAt: dateValue(conflict.resolvedAt),
      etag: conflictEtag(conflict),
      generation: conflict.generation,
      allowedActions: decisionPending ? [] : this.conflictAllowedActions(context, conflict),
      detectedAt: conflict.detectedAt.toISOString(),
      createdAt: conflict.createdAt.toISOString(),
      updatedAt: conflict.updatedAt.toISOString(),
    };
  }

  private evidenceLinkView(
    context: RequestContext,
    riskLevel: KnowledgeV2RiskLevel,
    link: ReviewEvidenceLink | ConflictEvidenceLink,
  ) {
    return {
      evidence: this.evidenceView(context, riskLevel, link.evidenceReference),
      ordinal: link.ordinal,
      relevanceScore: link.relevanceScore,
    };
  }

  private evidenceView(
    context: RequestContext,
    riskLevel: KnowledgeV2RiskLevel,
    evidence: EvidenceRecord,
  ): KnowledgeV2EvidenceReferenceView {
    const canRead = this.canReadEvidence(context, riskLevel, evidence);
    if (!canRead) {
      return {
        id: evidence.id,
        corpusKind: "STRUCTURED_V2",
        evidenceKey: null,
        targetType: evidence.targetType,
        itemVersionHash: null,
        documentRevisionId: null,
        factVersionId: null,
        guidanceRuleVersionId: null,
        messageId: null,
        externalReferenceHash: null,
        safeLabel: "Restricted evidence",
        locatorHash: null,
        isPublic: false,
        confidence: null,
        observedAt: null,
        expiresAt: null,
        permissionFingerprint: null,
        hasRestrictedPayload: Boolean(evidence.restrictedPayloadRef),
        redacted: true,
        createdAt: evidence.createdAt.toISOString(),
      };
    }
    return {
      id: evidence.id,
      corpusKind: "STRUCTURED_V2",
      evidenceKey: evidence.evidenceKey,
      targetType: evidence.targetType,
      itemVersionHash: evidence.itemVersionHash,
      documentRevisionId: evidence.v2DocumentRevisionId,
      factVersionId: evidence.factVersionId,
      guidanceRuleVersionId: evidence.guidanceRuleVersionId,
      messageId: evidence.messageId,
      externalReferenceHash: evidence.externalReferenceHash,
      safeLabel: evidence.safeLabel,
      locatorHash: evidence.locatorHash,
      isPublic: evidence.isPublic,
      confidence: evidence.confidence,
      observedAt: dateValue(evidence.observedAt),
      expiresAt: dateValue(evidence.expiresAt),
      permissionFingerprint:
        context.role === "OWNER" || context.role === "ADMIN"
          ? evidence.permissionFingerprint
          : null,
      hasRestrictedPayload: Boolean(evidence.restrictedPayloadRef),
      redacted: false,
      createdAt: evidence.createdAt.toISOString(),
    };
  }

  private canReadEvidence(
    context: RequestContext,
    riskLevel: KnowledgeV2RiskLevel,
    evidence: EvidenceRecord,
  ) {
    if (context.role === "OWNER" || context.role === "ADMIN") return true;
    if (context.role !== "MANAGER" || isElevatedRisk(riskLevel)) return false;
    if (evidence.isPublic) return true;
    const document = evidence.documentRevision?.document;
    if (document) {
      return (
        (document.classification === "PUBLIC" || document.classification === "INTERNAL") &&
        document.status !== "TOMBSTONED" &&
        document.status !== "DELETED" &&
        !document.tombstonedAt &&
        !document.deletedAt
      );
    }
    return Boolean(evidence.factVersionId || evidence.guidanceRuleVersionId);
  }

  private reviewAllowedActions(context: RequestContext, review: ReviewRecord) {
    if (isTerminalReview(review.status)) return [];
    const actions: KnowledgeV2ReviewItemView["allowedActions"] = [];
    const administrator = context.role === "OWNER" || context.role === "ADMIN";
    if (!review.assignedToUserId) actions.push("CLAIM");
    if (administrator) actions.push("ASSIGN");
    if (review.assignedToUserId && (administrator || review.assignedToUserId === context.userId)) {
      actions.push("UNASSIGN");
    }
    if (
      administrator ||
      (!isElevatedRisk(review.riskLevel) && review.assignedToUserId === context.userId)
    ) {
      actions.push("RESOLVE", "DISMISS");
    }
    return actions;
  }

  private conflictAllowedActions(context: RequestContext, conflict: ConflictRecord) {
    if (isTerminalConflict(conflict.status)) return [];
    const actions: KnowledgeV2ConflictView["allowedActions"] = [];
    const administrator = context.role === "OWNER" || context.role === "ADMIN";
    if (!conflict.assignedToUserId) actions.push("CLAIM");
    if (administrator) actions.push("ASSIGN");
    if (
      conflict.assignedToUserId &&
      (administrator || conflict.assignedToUserId === context.userId)
    ) {
      actions.push("UNASSIGN");
    }
    if (
      administrator ||
      (!isElevatedRisk(conflict.severity) &&
        conflict.reviewItems.length === 0 &&
        conflict.assignedToUserId === context.userId)
    ) {
      actions.push("RESOLVE", "DISMISS");
    }
    return actions;
  }

  private async lockReview(tx: Prisma.TransactionClient, tenantId: string, reviewItemId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2ReviewItem"
      WHERE "tenantId" = ${tenantId} AND "id" = ${reviewItemId}
      FOR UPDATE
    `);
    if (rows.length !== 1) this.reviewNotFound();
    return this.reviewRecord(tx, tenantId, reviewItemId);
  }

  private async lockConflict(tx: Prisma.TransactionClient, tenantId: string, conflictId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2Conflict"
      WHERE "tenantId" = ${tenantId} AND "id" = ${conflictId}
      FOR UPDATE
    `);
    if (rows.length !== 1) this.conflictNotFound();
    return this.conflictRecord(tx, tenantId, conflictId);
  }

  private async reviewRecord(tx: Prisma.TransactionClient, tenantId: string, reviewItemId: string) {
    const review = await tx.knowledgeV2ReviewItem.findUnique({
      where: { tenantId_id: { tenantId, id: reviewItemId } },
      include: reviewInclude,
    });
    if (!review) this.reviewNotFound();
    return review;
  }

  private async conflictRecord(tx: Prisma.TransactionClient, tenantId: string, conflictId: string) {
    const conflict = await tx.knowledgeV2Conflict.findUnique({
      where: { tenantId_id: { tenantId, id: conflictId } },
      include: conflictInclude,
    });
    if (!conflict) this.conflictNotFound();
    return conflict;
  }

  private async assertAssignmentAllowed(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    currentAssigneeUserId: string | null,
    targetUserId: string | null,
  ) {
    const administrator = context.role === "OWNER" || context.role === "ADMIN";
    if (!administrator) {
      if (targetUserId !== null && targetUserId !== context.userId) this.actionDenied();
      if (
        targetUserId === null &&
        currentAssigneeUserId !== null &&
        currentAssigneeUserId !== context.userId
      ) {
        this.actionDenied();
      }
      if (
        targetUserId === context.userId &&
        currentAssigneeUserId !== null &&
        currentAssigneeUserId !== context.userId
      ) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_REVIEW_ALREADY_ASSIGNED",
          "This item is already assigned to another reviewer.",
        );
      }
    }
    if (!targetUserId) return;
    const membership = await tx.membership.findFirst({
      where: {
        tenantId: context.tenantId,
        userId: targetUserId,
        role: { in: [...reviewerRoles] },
        user: { deletedAt: null },
        tenant: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!membership) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_ASSIGNEE_INVALID",
        "Choose an active workspace reviewer.",
        { field: "assigneeUserId" },
      );
    }
  }

  private assertRiskPermission(context: RequestContext, riskLevel: KnowledgeV2RiskLevel) {
    if (context.role === "OWNER" || context.role === "ADMIN" || !isElevatedRisk(riskLevel)) {
      return;
    }
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_HIGH_RISK_REVIEW_REQUIRED",
      "An owner or administrator must process high-risk knowledge.",
    );
  }

  private assertReviewRiskPermission(
    context: RequestContext,
    riskLevel: KnowledgeV2RiskLevel,
    reason: KnowledgeV2ReviewReason,
  ) {
    this.assertRiskPermission(context, riskLevel);
    if (reason === "SENSITIVE_CONTENT" && context.role !== "OWNER" && context.role !== "ADMIN") {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_HIGH_RISK_REVIEW_REQUIRED",
        "An owner or administrator must process sensitive knowledge.",
      );
    }
  }

  private assertLinkedReviewPermission(
    context: RequestContext,
    reviews: ReadonlyArray<{
      riskLevel: KnowledgeV2RiskLevel;
      reason: KnowledgeV2ReviewReason;
    }>,
  ) {
    if (context.role === "OWNER" || context.role === "ADMIN") return;
    if (
      reviews.some(
        (review) => isElevatedRisk(review.riskLevel) || review.reason === "SENSITIVE_CONTENT",
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_HIGH_RISK_REVIEW_REQUIRED",
        "An owner or administrator must process linked high-risk knowledge.",
      );
    }
  }

  private assertManagerAssignment(context: RequestContext, assignedToUserId: string | null) {
    if (context.role === "OWNER" || context.role === "ADMIN") return;
    if (assignedToUserId !== context.userId) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ASSIGNMENT_REQUIRED",
        "Claim this item before processing it.",
      );
    }
  }

  private assertDecisionActorPermission(context: RequestContext, action: KnowledgeV2ReviewAction) {
    if (
      ["CORRECT_SOURCE", "EXCLUDE_CONTENT", "RETRY_SOURCE", "VERIFY_PERMISSION"].includes(action) &&
      context.role !== "OWNER" &&
      context.role !== "ADMIN"
    ) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_REVIEW_DECISION_ACTOR_INVALID",
        "An owner or administrator must approve source-changing decisions.",
      );
    }
  }

  private assertTerminalReplayAllowed(context: RequestContext, resolvedByUserId: string | null) {
    if (
      context.role === "OWNER" ||
      context.role === "ADMIN" ||
      resolvedByUserId === context.userId
    ) {
      return;
    }
    this.actionDenied();
  }

  private async assertReviewResolutionAllowed(
    tx: Prisma.TransactionClient,
    review: ReviewRecord,
    action: KnowledgeV2ReviewAction,
  ) {
    if (review.conflictId) {
      const conflict = await tx.knowledgeV2Conflict.findUnique({
        where: { tenantId_id: { tenantId: review.tenantId, id: review.conflictId } },
        select: { status: true },
      });
      if (conflict && (conflict.status === "OPEN" || conflict.status === "IN_REVIEW")) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_RESOLUTION_REQUIRED",
          "Resolve the linked conflict instead of closing this review item directly.",
        );
      }
    }
    if (action === "DISMISS") return;
    const allowed = knowledgeV2ReviewResolutionActions[
      review.reason
    ] as readonly KnowledgeV2ReviewAction[];
    if (!allowed.includes(action)) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_REVIEW_ACTION_INCOMPATIBLE",
        "Choose a resolution that matches this review reason.",
        { field: "action" },
      );
    }
    if (
      ["CORRECT_SOURCE", "EXCLUDE_CONTENT", "RETRY_SOURCE", "VERIFY_PERMISSION"].includes(action) &&
      !review.sourceId &&
      !review.v2DocumentRevisionId
    ) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_REVIEW_TARGET_INCOMPATIBLE",
        "This resolution requires a linked source or document revision.",
        { field: "action" },
      );
    }
  }

  private async assertConflictResolutionShape(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    conflictId: string,
    resolution: KnowledgeV2ConflictResolution,
  ) {
    if (resolution === "MERGE" || resolution === "SPLIT_SCOPE") {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_CONFLICT_RESOLUTION_UNSUPPORTED",
        "Choose one supported conflict outcome.",
        { field: "resolution" },
      );
    }
    if (resolution !== "KEEP_LEFT" && resolution !== "KEEP_RIGHT") return;
    const candidates = await tx.knowledgeV2ConflictCandidate.findMany({
      where: { tenantId: context.tenantId, conflictId },
      select: {
        id: true,
        candidateType: true,
      },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      take: maximumConflictCandidates + 1,
    });
    if (candidates.length < 2) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_CONFLICT_CANDIDATES_REQUIRED",
        "This resolution requires at least two conflict candidates.",
        { field: "resolution" },
      );
    }
    if (
      candidates.length !== 2 ||
      candidates.some((candidate) => candidate.candidateType !== "FACT_VERSION")
    ) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_CONFLICT_VALUE_HYDRATION_REQUIRED",
        "Exactly two fact candidates are required for this resolution.",
        { field: "resolution" },
      );
    }
    await Promise.all(
      candidates.map((candidate) =>
        this.candidateReader.requireHydration(tx, {
          tenantId: context.tenantId,
          userId: context.userId,
          conflictId,
          candidateId: candidate.id,
        }),
      ),
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    entityType: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        payload,
      },
    });
  }

  private assertReviewer(context: RequestContext) {
    if (!reviewerRoles.includes(context.role as (typeof reviewerRoles)[number])) {
      this.actionDenied();
    }
  }

  private assertReviewAssignable(review: ReviewRecord) {
    if (isTerminalReview(review.status)) this.terminalConflict("review item");
  }

  private assertConflictAssignable(conflict: ConflictRecord) {
    if (isTerminalConflict(conflict.status)) this.terminalConflict("conflict");
  }

  private async assertNoPendingDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    aggregateType: "KnowledgeV2ReviewItem" | "KnowledgeV2Conflict",
    aggregateId: string,
    aggregateVersion: number,
  ) {
    const pending = await tx.knowledgeOutbox.findFirst({
      where: {
        tenantId,
        aggregateType,
        aggregateId,
        aggregateVersion,
        eventType: "knowledge.v2.review-decision.execute.requested",
      },
      select: { id: true },
    });
    if (pending) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_REVIEW_DECISION_PENDING",
        "This decision is still being applied.",
      );
    }
  }

  private assertDismissRationale(value: string) {
    if (value.trim().length < 3) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_RATIONALE_REQUIRED",
        "Provide a short dismissal rationale.",
        { field: "rationale" },
      );
    }
  }

  private actionDenied(): never {
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
      "This workspace role cannot process knowledge reviews.",
    );
  }

  private terminalConflict(resource: string): never {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_CONFLICT_REVIEW_TERMINAL",
      `This ${resource} already has a terminal outcome.`,
    );
  }

  private reviewNotFound(): never {
    throw knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_REVIEW_ITEM_NOT_FOUND",
      "Review item not found.",
    );
  }

  private conflictNotFound(): never {
    throw knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_ITEM_NOT_FOUND",
      "Conflict not found.",
    );
  }
}
