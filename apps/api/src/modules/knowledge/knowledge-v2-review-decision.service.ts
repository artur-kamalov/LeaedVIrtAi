import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type {
  KnowledgeV2JsonValue,
  KnowledgeV2ReviewAction,
  KnowledgeV2RiskLevel,
  KnowledgeV2ScopeInput,
  KnowledgeV2UpdateFactRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { canonicalKnowledgeV2Hash, strongKnowledgeV2Etag } from "./knowledge-v2-http.js";
import { KnowledgeSourceQueueService } from "./knowledge-source-queue.service.js";
import { KnowledgeV2SourceService } from "./knowledge-v2-source.service.js";
import { KnowledgeV2Service } from "./knowledge-v2.service.js";
import {
  KnowledgeV2ConflictCandidateReaderService,
  type KnowledgeV2ConflictCandidateHydration,
} from "./knowledge-v2-conflict-candidate-reader.service.js";

const eventType = "knowledge.v2.review-decision.execute.requested";
const consumerName = "api.knowledge-v2-review-decision.v1";
const pipelineVersion = "knowledge-v2-review-decision-v1";
const leaseMs = 60_000;
const maxAttempts = 5;
const sourceActions = [
  "CORRECT_SOURCE",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
] as const;
const reviewDecisionActions = new Set<KnowledgeV2ReviewAction>([
  "REVIEW_VALUE",
  "CORRECT_SOURCE",
  "ADD_MISSING_ANSWER",
  "CHANGE_GUIDANCE",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
  "APPROVE",
  "REJECT",
  "DISMISS",
]);
const conflictDecisionActions = new Set<ConflictResolution>([
  "KEEP_LEFT",
  "KEEP_RIGHT",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
  "DISMISS",
]);

type DecisionKind = "REVIEW" | "CONFLICT";
type ConflictResolution =
  | "KEEP_LEFT"
  | "KEEP_RIGHT"
  | "MARK_UNANSWERABLE"
  | "REQUIRE_HANDOFF"
  | "DISMISS";

interface LinkedReviewPin {
  id: string;
  generation: number;
}

type TargetPin =
  | { kind: "NONE" }
  | {
      kind: "FACT";
      id: string;
      etag: number;
      generation: number;
      latestVersionNumber: number;
      latestVersionId: string;
      latestVersionHash: string;
    }
  | {
      kind: "GUIDANCE";
      id: string;
      etag: number;
      generation: number;
      latestVersionNumber: number;
      latestVersionId: string;
      latestVersionHash: string;
    }
  | {
      kind: "SOURCE";
      id: string;
      etag: number;
      generation: number;
      permissionVersion: number;
      status: string;
    }
  | {
      kind: "REVISION";
      id: string;
      generation: number;
      contentHash: string;
      status: string;
      sourceId: string;
      sourceEtag: number;
      sourceGeneration: number;
      sourcePermissionVersion: number;
      sourceStatus: string;
    }
  | {
      kind: "FACT_CANDIDATE";
      factId: string;
      factEtag: number;
      factGeneration: number;
      factLatestVersionNumber: number;
      factLatestVersionId: string;
      factLatestVersionHash: string;
      candidateId: string;
      conflictId: string;
      candidateOrdinal: number;
      candidateVersionId: string;
      candidateVersionHash: string;
      candidateValueHash: string;
      candidateAuthorizationHash: string;
    };

interface DecisionPayload {
  decisionKind: DecisionKind;
  decisionId: string;
  decisionGeneration: number;
  action: KnowledgeV2ReviewAction | ConflictResolution;
  actorUserId: string;
  riskLevel: KnowledgeV2RiskLevel;
  sensitive: boolean;
  resolutionHash: string;
  semanticKey: string;
  target: TargetPin;
  linkedReviewPins: LinkedReviewPin[];
  jobId: string;
}

export interface TerminalReviewDecision {
  id: string;
  tenantId: string;
  reviewKey: string;
  reason: string;
  riskLevel: KnowledgeV2RiskLevel;
  status: string;
  resolutionAction: KnowledgeV2ReviewAction | null;
  resolutionSummaryHash: string | null;
  resolvedByUserId: string | null;
  generation: number;
  sourceId: string | null;
  v2DocumentRevisionId: string | null;
  factId: string | null;
  guidanceRuleId: string | null;
}

export interface TerminalConflictDecision {
  id: string;
  tenantId: string;
  conflictKey: string;
  semanticKey: string;
  severity: KnowledgeV2RiskLevel;
  status: string;
  resolution: ConflictResolution | null;
  resolutionRationaleHash: string | null;
  resolvedByUserId: string | null;
  generation: number;
  candidateSetHash: string;
}

class ReviewDecisionError extends Error {
  constructor(
    readonly code: string,
    readonly terminal: boolean,
  ) {
    super(code);
    this.name = "ReviewDecisionError";
  }
}

function record(value: Prisma.JsonValue | null | undefined) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function requiredString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 ? value : null;
}

function positiveInteger(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseTarget(value: Prisma.JsonValue | undefined): TargetPin | null {
  const target = record(value);
  if (!target) return null;
  const kind = requiredString(target.kind);
  if (kind === "NONE") return { kind };
  if (kind === "FACT" || kind === "GUIDANCE") {
    const id = requiredString(target.id);
    const etag = positiveInteger(target.etag);
    const generation = positiveInteger(target.generation);
    const latestVersionNumber = positiveInteger(target.latestVersionNumber);
    const latestVersionId = requiredString(target.latestVersionId);
    const latestVersionHash = requiredString(target.latestVersionHash);
    if (
      !id ||
      !etag ||
      !generation ||
      !latestVersionNumber ||
      !latestVersionId ||
      !latestVersionHash
    ) {
      return null;
    }
    return { kind, id, etag, generation, latestVersionNumber, latestVersionId, latestVersionHash };
  }
  if (kind === "SOURCE") {
    const id = requiredString(target.id);
    const etag = positiveInteger(target.etag);
    const generation = positiveInteger(target.generation);
    const permissionVersion = positiveInteger(target.permissionVersion);
    const status = requiredString(target.status);
    if (!id || !etag || !generation || !permissionVersion || !status) return null;
    return { kind, id, etag, generation, permissionVersion, status };
  }
  if (kind === "REVISION") {
    const id = requiredString(target.id);
    const generation = positiveInteger(target.generation);
    const contentHash = requiredString(target.contentHash);
    const status = requiredString(target.status);
    const sourceId = requiredString(target.sourceId);
    const sourceEtag = positiveInteger(target.sourceEtag);
    const sourceGeneration = positiveInteger(target.sourceGeneration);
    const sourcePermissionVersion = positiveInteger(target.sourcePermissionVersion);
    const sourceStatus = requiredString(target.sourceStatus);
    if (
      !id ||
      !generation ||
      !contentHash ||
      !status ||
      !sourceId ||
      !sourceEtag ||
      !sourceGeneration ||
      !sourcePermissionVersion ||
      !sourceStatus
    ) {
      return null;
    }
    return {
      kind,
      id,
      generation,
      contentHash,
      status,
      sourceId,
      sourceEtag,
      sourceGeneration,
      sourcePermissionVersion,
      sourceStatus,
    };
  }
  if (kind !== "FACT_CANDIDATE") return null;
  const factId = requiredString(target.factId);
  const factEtag = positiveInteger(target.factEtag);
  const factGeneration = positiveInteger(target.factGeneration);
  const factLatestVersionNumber = positiveInteger(target.factLatestVersionNumber);
  const factLatestVersionId = requiredString(target.factLatestVersionId);
  const factLatestVersionHash = requiredString(target.factLatestVersionHash);
  const candidateId = requiredString(target.candidateId);
  const conflictId = requiredString(target.conflictId);
  const candidateOrdinal =
    typeof target.candidateOrdinal === "number" &&
    Number.isInteger(target.candidateOrdinal) &&
    target.candidateOrdinal >= 0
      ? target.candidateOrdinal
      : null;
  const candidateVersionId = requiredString(target.candidateVersionId);
  const candidateVersionHash = requiredString(target.candidateVersionHash);
  const candidateValueHash = requiredString(target.candidateValueHash);
  const candidateAuthorizationHash = requiredString(target.candidateAuthorizationHash);
  if (
    !factId ||
    !factEtag ||
    !factGeneration ||
    !factLatestVersionNumber ||
    !factLatestVersionId ||
    !factLatestVersionHash ||
    !candidateId ||
    !conflictId ||
    candidateOrdinal === null ||
    !candidateVersionId ||
    !candidateVersionHash ||
    !candidateValueHash ||
    !candidateAuthorizationHash
  ) {
    return null;
  }
  return {
    kind,
    factId,
    factEtag,
    factGeneration,
    factLatestVersionNumber,
    factLatestVersionId,
    factLatestVersionHash,
    candidateId,
    conflictId,
    candidateOrdinal,
    candidateVersionId,
    candidateVersionHash,
    candidateValueHash,
    candidateAuthorizationHash,
  };
}

function parsePayload(value: Prisma.JsonValue): DecisionPayload | null {
  const payload = record(value);
  if (!payload) return null;
  const decisionKind = payload.decisionKind;
  const decisionId = requiredString(payload.decisionId);
  const decisionGeneration = positiveInteger(payload.decisionGeneration);
  const action = requiredString(payload.action);
  const actorUserId = requiredString(payload.actorUserId);
  const riskLevel = payload.riskLevel;
  const resolutionHash = requiredString(payload.resolutionHash);
  const semanticKey = requiredString(payload.semanticKey);
  const target = parseTarget(payload.target);
  const linkedReviewPins = Array.isArray(payload.linkedReviewPins)
    ? payload.linkedReviewPins.flatMap((value): LinkedReviewPin[] => {
        const pin = record(value);
        const id = requiredString(pin?.id);
        const generation = positiveInteger(pin?.generation);
        return id && generation ? [{ id, generation }] : [];
      })
    : null;
  const jobId = requiredString(payload.jobId);
  if (
    (decisionKind !== "REVIEW" && decisionKind !== "CONFLICT") ||
    !decisionId ||
    !decisionGeneration ||
    !action ||
    !actorUserId ||
    typeof riskLevel !== "string" ||
    !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel) ||
    typeof payload.sensitive !== "boolean" ||
    !resolutionHash ||
    !semanticKey ||
    !target ||
    !linkedReviewPins ||
    linkedReviewPins.length !== (payload.linkedReviewPins as Prisma.JsonArray).length ||
    new Set(linkedReviewPins.map((pin) => pin.id)).size !== linkedReviewPins.length ||
    (decisionKind === "REVIEW" && linkedReviewPins.length !== 0) ||
    !jobId
  ) {
    return null;
  }
  if (
    (decisionKind === "REVIEW" && !reviewDecisionActions.has(action as KnowledgeV2ReviewAction)) ||
    (decisionKind === "CONFLICT" && !conflictDecisionActions.has(action as ConflictResolution))
  ) {
    return null;
  }
  return {
    decisionKind,
    decisionId,
    decisionGeneration,
    action: action as DecisionPayload["action"],
    actorUserId,
    riskLevel: riskLevel as KnowledgeV2RiskLevel,
    sensitive: payload.sensitive,
    resolutionHash,
    semanticKey,
    target,
    linkedReviewPins,
    jobId,
  };
}

function errorInfo(error: unknown) {
  if (error instanceof ReviewDecisionError) return error;
  if (typeof error === "object" && error !== null && "getResponse" in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    const body = record(response as Prisma.JsonValue);
    const code = requiredString(body?.code);
    const retryable = body?.retryable === true;
    if (code) return new ReviewDecisionError(code, !retryable);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return new ReviewDecisionError(`PRISMA_${error.code}`, false);
  }
  return new ReviewDecisionError("KNOWLEDGE_DEPENDENCY_REVIEW_DECISION_FAILED", false);
}

function nullableDate(value: Date | null) {
  return value?.toISOString() ?? null;
}

@Injectable()
export class KnowledgeV2ReviewDecisionService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2Service) private readonly knowledge: KnowledgeV2Service,
    @Inject(KnowledgeV2SourceService) private readonly sources: KnowledgeV2SourceService,
    @Inject(KnowledgeSourceQueueService) private readonly sourceQueue: KnowledgeSourceQueueService,
    @Inject(KnowledgeV2ConflictCandidateReaderService)
    private readonly candidateReader: KnowledgeV2ConflictCandidateReaderService,
  ) {}

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.drain().catch(() => undefined), 5_000);
    this.timer.unref();
    void this.drain().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueueReviewDecision(tx: Prisma.TransactionClient, review: TerminalReviewDecision) {
    if (!review.resolutionAction || !review.resolutionSummaryHash || !review.resolvedByUserId) {
      throw new ReviewDecisionError("KNOWLEDGE_VALIDATION_REVIEW_DECISION_INVALID", true);
    }
    const target = await this.pinReviewTarget(tx, review);
    return this.enqueue(tx, review.tenantId, {
      decisionKind: "REVIEW",
      decisionId: review.id,
      decisionGeneration: review.generation,
      action: review.resolutionAction,
      actorUserId: review.resolvedByUserId,
      riskLevel: review.riskLevel,
      sensitive: review.reason === "SENSITIVE_CONTENT",
      resolutionHash: review.resolutionSummaryHash,
      semanticKey: review.reviewKey,
      target,
      linkedReviewPins: [],
    });
  }

  async enqueueConflictDecision(tx: Prisma.TransactionClient, conflict: TerminalConflictDecision) {
    if (!conflict.resolution || !conflict.resolutionRationaleHash || !conflict.resolvedByUserId) {
      throw new ReviewDecisionError("KNOWLEDGE_VALIDATION_REVIEW_DECISION_INVALID", true);
    }
    const target = await this.pinConflictTarget(tx, conflict);
    const linkedReviewPins = await tx.knowledgeV2ReviewItem.findMany({
      where: {
        tenantId: conflict.tenantId,
        conflictId: conflict.id,
        status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
      },
      select: { id: true, generation: true },
      orderBy: { id: "asc" },
    });
    return this.enqueue(tx, conflict.tenantId, {
      decisionKind: "CONFLICT",
      decisionId: conflict.id,
      decisionGeneration: conflict.generation,
      action: conflict.resolution,
      actorUserId: conflict.resolvedByUserId,
      riskLevel: conflict.severity,
      sensitive: false,
      resolutionHash: conflict.resolutionRationaleHash,
      semanticKey: conflict.semanticKey,
      target,
      linkedReviewPins,
    });
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: Omit<DecisionPayload, "jobId">,
  ) {
    const job = await tx.knowledgeJob.create({
      data: {
        id: randomUUID(),
        tenantId,
        idempotencyKey: `review-decision:${input.decisionKind.toLowerCase()}:${input.decisionId}:${input.decisionGeneration}`,
        stage: "EXECUTING_REVIEW_DECISION",
        pipelineVersion,
        generation: input.decisionGeneration,
        status: "QUEUED",
        deadlineAt: new Date(Date.now() + 30 * 60_000),
        maxAttempts,
        ...(input.target.kind === "SOURCE"
          ? { v2SourceId: input.target.id }
          : input.target.kind === "REVISION"
            ? { v2SourceId: input.target.sourceId, v2RevisionId: input.target.id }
            : {}),
      },
    });
    const payload: DecisionPayload = { ...input, jobId: job.id };
    const aggregateType =
      input.decisionKind === "REVIEW" ? "KnowledgeV2ReviewItem" : "KnowledgeV2Conflict";
    const event = await tx.knowledgeOutbox.create({
      data: {
        tenantId,
        aggregateType,
        aggregateId: input.decisionId,
        aggregateVersion: input.decisionGeneration,
        eventType,
        schemaVersion: 1,
        dedupeKey: `${eventType}:${input.decisionKind.toLowerCase()}:${input.decisionId}:${input.decisionGeneration}`,
        payload: payload as unknown as Prisma.InputJsonObject,
        deadlineAt: job.deadlineAt,
      },
    });
    await tx.knowledgeJob.update({
      where: { id: job.id },
      data: { payloadRef: `knowledge-outbox:${event.id}` },
    });
    return event.id;
  }

  dispatchSoon(eventId: string | null, replayed: boolean) {
    if (eventId && !replayed) void this.dispatch(eventId).catch(() => undefined);
  }

  async dispatch(eventId: string) {
    const current = await this.prisma.knowledgeOutbox.findUnique({ where: { id: eventId } });
    if (!current || current.eventType !== eventType) return null;
    if (current.status === "PUBLISHED") return this.replayedResult(eventId);
    const payload = parsePayload(current.payload);
    if (!payload || !this.matchesEnvelope(current, payload)) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_VALIDATION_REVIEW_DECISION_ENVELOPE_INVALID",
      );
      return null;
    }
    const job = await this.matchingJob(current, payload);
    if (!job) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_CONFLICT_REVIEW_DECISION_JOB_MISMATCH",
        payload,
      );
      return null;
    }
    const downstream = await this.reconcileDownstream(payload, current.id);
    if (downstream)
      return this.completeReconciled(current.id, current.tenantId, payload, downstream);
    const now = new Date();
    const hasActiveLease =
      current.status === "PUBLISHING" &&
      Boolean(current.lockedAt && current.lockedAt > new Date(now.getTime() - leaseMs));
    if (hasActiveLease) return this.replayedResult(eventId);
    if (current.status === "DEAD_LETTER") return null;
    if (
      current.attemptCount >= maxAttempts ||
      Boolean(current.deadlineAt && current.deadlineAt <= now)
    ) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_CONFLICT_REVIEW_DECISION_EXHAUSTED",
        payload,
      );
      return null;
    }
    const lockId = `${consumerName}:${randomUUID()}`;
    const claim = await this.prisma.knowledgeOutbox.updateMany({
      where: {
        id: eventId,
        eventType,
        availableAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PUBLISHING", lockedAt: null },
          { status: "PUBLISHING", lockedAt: { lte: new Date(now.getTime() - leaseMs) } },
        ],
      },
      data: {
        status: "PUBLISHING",
        attemptCount: { increment: 1 },
        lockedAt: now,
        lockedBy: lockId,
        lastErrorCode: null,
      },
    });
    if (claim.count !== 1) return this.replayedResult(eventId);
    const claimed = await this.prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: eventId } });
    const runningJob = await this.prisma.knowledgeJob.updateMany({
      where: {
        id: payload.jobId,
        tenantId: claimed.tenantId,
        generation: payload.decisionGeneration,
        status: { in: ["QUEUED", "RETRY_SCHEDULED", "RUNNING"] },
      },
      data: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        startedAt: now,
        heartbeatAt: now,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (runningJob.count !== 1) {
      await this.completeFailure(
        claimed,
        lockId,
        payload,
        "KNOWLEDGE_CONFLICT_REVIEW_DECISION_JOB_MISMATCH",
        true,
      );
      return null;
    }
    const activeJob = await this.prisma.knowledgeJob.findUniqueOrThrow({
      where: { id: payload.jobId },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeJobAttempt.create({
        data: {
          tenantId: claimed.tenantId,
          jobId: activeJob.id,
          attempt: activeJob.attemptCount,
          status: "RUNNING",
          workerId: consumerName,
        },
      });
      await tx.knowledgeInbox.upsert({
        where: { consumer_eventId: { consumer: consumerName, eventId: claimed.id } },
        update: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          startedAt: now,
          completedAt: null,
          errorCode: null,
        },
        create: {
          tenantId: claimed.tenantId,
          consumer: consumerName,
          eventId: claimed.id,
          status: "PROCESSING",
        },
      });
    });
    try {
      const actor = await this.currentActor(claimed.tenantId, payload);
      await this.assertDecisionFence(payload, claimed.tenantId);
      const candidateHydration = await this.assertTargetFence(payload.target, actor);
      const outcome = await this.executeOutcome(actor, payload, claimed.id, candidateHydration);
      await this.completeSuccess(claimed, lockId, payload, activeJob.attemptCount, outcome);
      return outcome;
    } catch (error) {
      const info = errorInfo(error);
      await this.completeFailure(claimed, lockId, payload, info.code, info.terminal);
      return null;
    }
  }

  private matchesEnvelope(
    event: Prisma.KnowledgeOutboxGetPayload<object>,
    payload: DecisionPayload,
  ) {
    return (
      event.aggregateType ===
        (payload.decisionKind === "REVIEW" ? "KnowledgeV2ReviewItem" : "KnowledgeV2Conflict") &&
      event.aggregateId === payload.decisionId &&
      event.aggregateVersion === payload.decisionGeneration &&
      event.eventType === eventType &&
      event.schemaVersion === 1 &&
      event.dedupeKey ===
        `${eventType}:${payload.decisionKind.toLowerCase()}:${payload.decisionId}:${payload.decisionGeneration}`
    );
  }

  private matchingJob(event: Prisma.KnowledgeOutboxGetPayload<object>, payload: DecisionPayload) {
    return this.prisma.knowledgeJob.findFirst({
      where: {
        id: payload.jobId,
        tenantId: event.tenantId,
        idempotencyKey: `review-decision:${payload.decisionKind.toLowerCase()}:${payload.decisionId}:${payload.decisionGeneration}`,
        stage: "EXECUTING_REVIEW_DECISION",
        pipelineVersion,
        generation: payload.decisionGeneration,
        payloadRef: `knowledge-outbox:${event.id}`,
      },
    });
  }

  private async currentActor(tenantId: string, payload: DecisionPayload): Promise<RequestContext> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        userId: payload.actorUserId,
        role: { in: ["OWNER", "ADMIN", "MANAGER"] },
        user: { deletedAt: null },
        tenant: { deletedAt: null, status: { in: ["TRIALING", "ACTIVE"] } },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            avatarUrl: true,
            passwordChangeRequired: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            businessType: true,
            timezone: true,
          },
        },
      },
    });
    if (!membership) {
      throw new ReviewDecisionError("KNOWLEDGE_PERMISSION_REVIEW_DECISION_ACTOR_INVALID", true);
    }
    const elevated =
      payload.riskLevel === "HIGH" || payload.riskLevel === "CRITICAL" || payload.sensitive;
    const requiresAdministrator =
      elevated || sourceActions.includes(payload.action as (typeof sourceActions)[number]);
    if (requiresAdministrator && membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ReviewDecisionError("KNOWLEDGE_PERMISSION_REVIEW_DECISION_ACTOR_INVALID", true);
    }
    return {
      tenantId,
      userId: membership.user.id,
      role: membership.role,
      authMode: "credentials",
      tenant: membership.tenant,
      user: membership.user,
    };
  }

  private async assertDecisionFence(payload: DecisionPayload, tenantId: string) {
    if (payload.decisionKind === "REVIEW") {
      const review = await this.prisma.knowledgeV2ReviewItem.findFirst({
        where: {
          id: payload.decisionId,
          tenantId,
          generation: payload.decisionGeneration,
          status: "IN_REVIEW",
          resolutionAction: null,
          resolutionSummaryHash: null,
          resolvedByUserId: null,
          resolvedAt: null,
        },
        select: { id: true },
      });
      if (!review) this.stale();
      return;
    }
    const conflict = await this.prisma.knowledgeV2Conflict.findFirst({
      where: {
        id: payload.decisionId,
        tenantId,
        generation: payload.decisionGeneration,
        status: "IN_REVIEW",
        resolution: null,
        resolutionRationaleHash: null,
        resolvedByUserId: null,
        resolvedAt: null,
      },
      select: { id: true },
    });
    if (!conflict) this.stale();
  }

  private async assertTargetFence(target: TargetPin, context: RequestContext) {
    const tenantId = context.tenantId;
    if (target.kind === "NONE") return;
    if (target.kind === "FACT" || target.kind === "GUIDANCE") {
      const row =
        target.kind === "FACT"
          ? await this.prisma.knowledgeV2Fact.findFirst({
              where: {
                id: target.id,
                tenantId,
                etag: target.etag,
                generation: target.generation,
                latestVersionNumber: target.latestVersionNumber,
                deletedAt: null,
                versions: {
                  some: {
                    id: target.latestVersionId,
                    versionNumber: target.latestVersionNumber,
                    immutableHash: target.latestVersionHash,
                  },
                },
              },
              select: { id: true },
            })
          : await this.prisma.knowledgeV2GuidanceRule.findFirst({
              where: {
                id: target.id,
                tenantId,
                etag: target.etag,
                generation: target.generation,
                latestVersionNumber: target.latestVersionNumber,
                deletedAt: null,
                versions: {
                  some: {
                    id: target.latestVersionId,
                    versionNumber: target.latestVersionNumber,
                    immutableHash: target.latestVersionHash,
                  },
                },
              },
              select: { id: true },
            });
      if (!row) this.stale();
      return;
    }
    if (target.kind === "SOURCE") {
      const source = await this.prisma.knowledgeV2Source.findFirst({
        where: {
          id: target.id,
          tenantId,
          etag: target.etag,
          generation: target.generation,
          sourcePermissionVersion: target.permissionVersion,
          status: target.status as Prisma.EnumKnowledgeV2SourceStatusFilter,
        },
        select: { id: true },
      });
      if (!source) this.stale();
      return;
    }
    if (target.kind === "REVISION") {
      const [revision, source] = await Promise.all([
        this.prisma.knowledgeV2DocumentRevision.findFirst({
          where: {
            id: target.id,
            tenantId,
            sourceId: target.sourceId,
            generation: target.generation,
            contentHash: target.contentHash,
            status: target.status as Prisma.EnumKnowledgeV2RevisionStatusFilter,
          },
          select: { id: true },
        }),
        this.prisma.knowledgeV2Source.findFirst({
          where: {
            id: target.sourceId,
            tenantId,
            etag: target.sourceEtag,
            generation: target.sourceGeneration,
            sourcePermissionVersion: target.sourcePermissionVersion,
            status: target.sourceStatus as Prisma.EnumKnowledgeV2SourceStatusFilter,
          },
          select: { id: true },
        }),
      ]);
      if (!revision || !source) this.stale();
      return;
    }
    const candidate = await this.prisma.knowledgeV2ConflictCandidate.findFirst({
      where: {
        id: target.candidateId,
        tenantId,
        conflictId: target.conflictId,
        ordinal: target.candidateOrdinal,
        factVersionId: target.candidateVersionId,
        itemVersionHash: target.candidateVersionHash,
        candidateValueHash: target.candidateValueHash,
        factVersion: { factId: target.factId },
      },
      select: { id: true },
    });
    const fact = await this.prisma.knowledgeV2Fact.findFirst({
      where: {
        id: target.factId,
        tenantId,
        etag: target.factEtag,
        generation: target.factGeneration,
        latestVersionNumber: target.factLatestVersionNumber,
        deletedAt: null,
        versions: {
          some: {
            id: target.factLatestVersionId,
            immutableHash: target.factLatestVersionHash,
            versionNumber: target.factLatestVersionNumber,
          },
        },
      },
      select: { id: true },
    });
    if (!candidate || !fact) this.stale();
    return this.candidateReader.requireHydration(this.prisma, {
      tenantId,
      userId: context.userId,
      conflictId: target.conflictId,
      candidateId: target.candidateId,
      expectedAuthorizationHash: target.candidateAuthorizationHash,
      allowTerminalConflict: true,
    });
  }

  private async executeOutcome(
    context: RequestContext,
    payload: DecisionPayload,
    eventId: string,
    candidateHydration?: KnowledgeV2ConflictCandidateHydration,
  ) {
    if (payload.action === "DISMISS")
      return { outcome: "NO_CHANGE", decisionId: payload.decisionId };
    if (payload.action === "MARK_UNANSWERABLE" || payload.action === "REQUIRE_HANDOFF") {
      const handoff = payload.action === "REQUIRE_HANDOFF";
      const result = await this.knowledge.createGuidanceRule(
        context,
        {
          title: handoff ? "Reviewed handoff policy" : "Reviewed unanswerable policy",
          type: handoff ? "ESCALATION" : "PROHIBITION",
          condition: {
            kind: "PREDICATE",
            field: "INTENT",
            operator: "EQUALS",
            value: payload.semanticKey,
          },
          instruction: handoff
            ? "Require a human handoff for this reviewed knowledge case."
            : "Do not answer this reviewed knowledge case without new verified support.",
          priority: 100,
          tieBreakKey: `review:${canonicalKnowledgeV2Hash({ decision: payload.decisionId, generation: payload.decisionGeneration }).slice(0, 32)}`,
          scope: null,
          riskLevel: payload.riskLevel,
          requiredApproverRole:
            payload.riskLevel === "HIGH" || payload.riskLevel === "CRITICAL" ? "OWNER" : null,
        },
        this.outcomeKey(eventId),
      );
      return { outcome: "GUIDANCE_POLICY_CREATED", guidanceRuleId: result.resource.id };
    }
    if (
      payload.target.kind === "FACT" &&
      (payload.action === "APPROVE" || payload.action === "REJECT")
    ) {
      const etag = strongKnowledgeV2Etag("fact", payload.target.id, payload.target.etag);
      const result =
        payload.action === "APPROVE"
          ? await this.knowledge.verifyFact(
              context,
              payload.target.id,
              {},
              this.outcomeKey(eventId),
              [etag],
            )
          : await this.knowledge.rejectFact(
              context,
              payload.target.id,
              {},
              this.outcomeKey(eventId),
              [etag],
            );
      return { outcome: "FACT_SUCCESSOR_CREATED", factId: result.resource.id };
    }
    if (
      payload.target.kind === "GUIDANCE" &&
      (payload.action === "APPROVE" || payload.action === "REJECT")
    ) {
      const etag = strongKnowledgeV2Etag("guidance-rule", payload.target.id, payload.target.etag);
      const result =
        payload.action === "APPROVE"
          ? await this.knowledge.approveGuidanceRule(
              context,
              payload.target.id,
              {},
              this.outcomeKey(eventId),
              [etag],
            )
          : await this.knowledge.rejectGuidanceRule(
              context,
              payload.target.id,
              {},
              this.outcomeKey(eventId),
              [etag],
            );
      return { outcome: "GUIDANCE_SUCCESSOR_CREATED", guidanceRuleId: result.resource.id };
    }
    if (
      payload.target.kind === "FACT_CANDIDATE" &&
      (payload.action === "KEEP_LEFT" || payload.action === "KEEP_RIGHT")
    ) {
      const candidate = await this.prisma.knowledgeV2FactVersion.findFirst({
        where: {
          id: payload.target.candidateVersionId,
          tenantId: context.tenantId,
          factId: payload.target.factId,
          immutableHash: payload.target.candidateVersionHash,
        },
        select: {
          normalizedValue: true,
          displayValue: true,
          unit: true,
          currency: true,
          timeZone: true,
          locale: true,
          localeBehavior: true,
          scope: true,
          effectiveFrom: true,
          effectiveUntil: true,
          riskLevel: true,
        },
      });
      if (!candidate) this.stale();
      const input: KnowledgeV2UpdateFactRequest = {
        normalizedValue: candidateHydration?.restricted
          ? candidateHydration.value
          : (candidate.normalizedValue as KnowledgeV2JsonValue),
        displayValue: candidateHydration?.restricted
          ? candidateHydration.value
          : candidate.displayValue,
        unit: candidate.unit,
        currency: candidate.currency,
        timeZone: candidate.timeZone,
        locale: candidate.locale,
        localeBehavior: candidate.localeBehavior,
        scope: candidate.scope as KnowledgeV2ScopeInput | null,
        effectiveFrom: nullableDate(candidate.effectiveFrom),
        effectiveUntil: nullableDate(candidate.effectiveUntil),
        riskLevel: candidate.riskLevel,
        changeReason: "Applied reviewed conflict candidate.",
      };
      const result = await this.knowledge.updateFact(
        context,
        payload.target.factId,
        input,
        this.outcomeKey(eventId),
        [strongKnowledgeV2Etag("fact", payload.target.factId, payload.target.factEtag)],
      );
      return { outcome: "FACT_SUCCESSOR_CREATED", factId: result.resource.id };
    }
    if (sourceActions.includes(payload.action as (typeof sourceActions)[number])) {
      return this.executeSourceOutcome(context, payload, eventId);
    }
    if (["ADD_MISSING_ANSWER", "CHANGE_GUIDANCE", "REVIEW_VALUE"].includes(payload.action)) {
      throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_VALUE_UNAVAILABLE", true);
    }
    throw new ReviewDecisionError("KNOWLEDGE_VALIDATION_REVIEW_DECISION_ACTION_UNSUPPORTED", true);
  }

  private async executeSourceOutcome(
    context: RequestContext,
    payload: DecisionPayload,
    eventId: string,
  ) {
    const target = payload.target;
    if (target.kind !== "SOURCE" && target.kind !== "REVISION") {
      throw new ReviewDecisionError("KNOWLEDGE_VALIDATION_REVIEW_DECISION_TARGET_INVALID", true);
    }
    const sourceId = target.kind === "SOURCE" ? target.id : target.sourceId;
    const sourceEtag = target.kind === "SOURCE" ? target.etag : target.sourceEtag;
    const key = this.outcomeKey(eventId);
    if (payload.action === "EXCLUDE_CONTENT") {
      if (target.kind === "REVISION") {
        const result = await this.sources.excludeRevision(
          context,
          target.id,
          { reason: "Excluded by reviewed decision." },
          key,
          [
            strongKnowledgeV2Etag(
              "revision",
              target.id,
              `${target.generation}:${target.status}:${target.contentHash}`,
            ),
          ],
        );
        return { outcome: "REVISION_EXCLUSION_QUEUED", sourceJobId: result.jobId };
      }
      const result = await this.sources.deleteSource(
        context,
        sourceId,
        { reason: "Excluded by reviewed decision." },
        key,
        [strongKnowledgeV2Etag("source", sourceId, sourceEtag)],
      );
      return { outcome: "SOURCE_EXCLUSION_QUEUED", sourceJobId: result.jobId };
    }
    if (payload.action === "VERIFY_PERMISSION") {
      return this.queuePermissionReconciliation(context, target, eventId);
    }
    const result = await this.sources.syncSource(
      context,
      sourceId,
      { reason: "Requested by reviewed decision." },
      key,
      [strongKnowledgeV2Etag("source", sourceId, sourceEtag)],
    );
    return { outcome: "SOURCE_SYNC_QUEUED", sourceJobId: result.jobId };
  }

  private async queuePermissionReconciliation(
    context: RequestContext,
    target: Extract<TargetPin, { kind: "SOURCE" | "REVISION" }>,
    eventId: string,
  ) {
    const sourceId = target.kind === "SOURCE" ? target.id : target.sourceId;
    const operationKey = `${this.outcomeKey(eventId)}:permission-reconcile`;
    const existing = await this.prisma.knowledgeJob.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId: context.tenantId, idempotencyKey: operationKey },
      },
    });
    if (existing)
      return { outcome: "SOURCE_PERMISSION_RECONCILIATION_QUEUED", sourceJobId: existing.id };
    let runtimeEventId: string | null = null;
    const job = await this.prisma.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "KnowledgeV2Source"
        WHERE "tenantId" = ${context.tenantId} AND "id" = ${sourceId}
        FOR UPDATE
      `);
      if (locks.length !== 1) this.stale();
      const expected =
        target.kind === "SOURCE"
          ? {
              etag: target.etag,
              generation: target.generation,
              permission: target.permissionVersion,
            }
          : {
              etag: target.sourceEtag,
              generation: target.sourceGeneration,
              permission: target.sourcePermissionVersion,
            };
      const source = await tx.knowledgeV2Source.findFirst({
        where: {
          id: sourceId,
          tenantId: context.tenantId,
          etag: expected.etag,
          generation: expected.generation,
          sourcePermissionVersion: expected.permission,
          status: { notIn: ["DELETING", "DELETED"] },
        },
      });
      if (!source) this.stale();
      const now = new Date();
      const updated = await tx.knowledgeV2Source.update({
        where: { id: source.id },
        data: {
          generation: { increment: 1 },
          sourcePermissionVersion: { increment: 1 },
          etag: { increment: 1 },
          status: "SYNCING",
          lastErrorCode: null,
          lastErrorAt: null,
          updatedByUserId: context.userId,
        },
      });
      await Promise.all([
        tx.knowledgeV2Document.updateMany({
          where: { tenantId: context.tenantId, sourceId, deletedAt: null },
          data: { deletionGeneration: { increment: 1 } },
        }),
        tx.knowledgeV2Chunk.updateMany({
          where: {
            tenantId: context.tenantId,
            document: { sourceId },
            OR: [{ indexState: { not: "DELETED" } }, { deletedAt: null }],
          },
          data: { indexState: "DELETED", deletedAt: now },
        }),
      ]);
      await tx.knowledgeV2DeletionLedger.createMany({
        data: ["VECTOR_INDEX", "CACHE"].map((subsystem) => ({
          tenantId: context.tenantId,
          sourceId,
          sourceGeneration: updated.generation,
          targetType: "SOURCE",
          targetId: sourceId,
          subsystem,
          status: "PENDING" as const,
          deniedAt: now,
        })),
      });
      const sourceJob = await tx.knowledgeJob.create({
        data: {
          tenantId: context.tenantId,
          idempotencyKey: operationKey,
          stage: "RECONCILING",
          pipelineVersion: "knowledge-v2",
          generation: updated.generation,
          status: "QUEUED",
          deadlineAt: new Date(now.getTime() + 30 * 60_000),
          maxAttempts: 5,
          v2SourceId: sourceId,
        },
      });
      const runtimeEvent = await this.sourceQueue.createEvent(tx, {
        tenantId: context.tenantId,
        sourceId,
        knowledgeJobId: sourceJob.id,
        generation: updated.generation,
        operation: "RECONCILE",
        requestedByUserId: context.userId,
        requestedAt: now.toISOString(),
      });
      runtimeEventId = runtimeEvent.id;
      const settings = await tx.knowledgeV2Settings.updateMany({
        where: { tenantId: context.tenantId },
        data: { draftGeneration: { increment: 1 } },
      });
      if (settings.count !== 1) {
        throw new ReviewDecisionError(
          "KNOWLEDGE_DEPENDENCY_REVIEW_DECISION_SETTINGS_UNAVAILABLE",
          false,
        );
      }
      await Promise.all([
        tx.knowledgeJob.update({
          where: { id: sourceJob.id },
          data: { payloadRef: `runtime-outbox:${runtimeEvent.id}` },
        }),
        tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "knowledge.v2.review.permission_reconciliation_queued",
            entityType: "knowledge_v2_source",
            entityId: sourceId,
            payload: {
              decisionEventId: eventId,
              sourceGeneration: updated.generation,
              permissionVersion: updated.sourcePermissionVersion,
              jobId: sourceJob.id,
            },
          },
        }),
      ]);
      return sourceJob;
    });
    if (runtimeEventId) this.sourceQueue.dispatch(runtimeEventId);
    return { outcome: "SOURCE_PERMISSION_RECONCILIATION_QUEUED", sourceJobId: job.id };
  }

  private async reconcileDownstream(payload: DecisionPayload, eventId: string) {
    const identity = this.downstreamIdentity(payload, eventId);
    if (identity) {
      const record = await this.prisma.knowledgeV2IdempotencyRecord.findUnique({
        where: {
          tenantId_endpoint_key: {
            tenantId: await this.eventTenant(eventId),
            endpoint: identity.endpoint,
            key: identity.key,
          },
        },
      });
      if (record?.status === "SUCCEEDED") {
        return { outcome: "RECONCILED", responseRef: record.responseRef ?? null };
      }
    }
    if (payload.action === "VERIFY_PERMISSION") {
      const job = await this.prisma.knowledgeJob.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: await this.eventTenant(eventId),
            idempotencyKey: `${this.outcomeKey(eventId)}:permission-reconcile`,
          },
        },
      });
      if (job) return { outcome: "SOURCE_PERMISSION_RECONCILIATION_QUEUED", sourceJobId: job.id };
    }
    return null;
  }

  private downstreamIdentity(payload: DecisionPayload, eventId: string) {
    const key = this.outcomeKey(eventId);
    if (payload.action === "MARK_UNANSWERABLE" || payload.action === "REQUIRE_HANDOFF") {
      return { endpoint: "POST:/knowledge/v2/guidance", key };
    }
    if (payload.target.kind === "FACT") {
      if (payload.action === "APPROVE")
        return { endpoint: `POST:/knowledge/v2/facts/${payload.target.id}/verify`, key };
      if (payload.action === "REJECT")
        return { endpoint: `POST:/knowledge/v2/facts/${payload.target.id}/reject`, key };
    }
    if (payload.target.kind === "GUIDANCE") {
      if (payload.action === "APPROVE")
        return { endpoint: `POST:/knowledge/v2/guidance/${payload.target.id}/approve`, key };
      if (payload.action === "REJECT")
        return { endpoint: `POST:/knowledge/v2/guidance/${payload.target.id}/reject`, key };
    }
    if (payload.target.kind === "FACT_CANDIDATE") {
      return { endpoint: `PATCH:/knowledge/v2/facts/${payload.target.factId}`, key };
    }
    if (payload.target.kind === "REVISION" && payload.action === "EXCLUDE_CONTENT") {
      return { endpoint: "POST:/knowledge/v2/revisions/:revisionId/exclude", key };
    }
    if (payload.target.kind === "SOURCE") {
      if (payload.action === "EXCLUDE_CONTENT")
        return { endpoint: "DELETE:/knowledge/v2/sources/:sourceId", key };
      if (payload.action === "CORRECT_SOURCE" || payload.action === "RETRY_SOURCE") {
        return { endpoint: "POST:/knowledge/v2/sources/:sourceId/sync", key };
      }
    }
    if (
      payload.target.kind === "REVISION" &&
      (payload.action === "CORRECT_SOURCE" || payload.action === "RETRY_SOURCE")
    ) {
      return { endpoint: "POST:/knowledge/v2/sources/:sourceId/sync", key };
    }
    return null;
  }

  private async eventTenant(eventId: string) {
    const event = await this.prisma.knowledgeOutbox.findUnique({
      where: { id: eventId },
      select: { tenantId: true },
    });
    if (!event) throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_STALE", true);
    return event.tenantId;
  }

  private outcomeKey(eventId: string) {
    return `review-outcome:${eventId}`;
  }

  private linkedReviewAction(
    resolution: ConflictResolution,
    suggestedAction: KnowledgeV2ReviewAction,
  ): KnowledgeV2ReviewAction {
    if (resolution === "DISMISS") return "DISMISS";
    if (resolution === "MARK_UNANSWERABLE") return "MARK_UNANSWERABLE";
    if (resolution === "REQUIRE_HANDOFF") return "REQUIRE_HANDOFF";
    return suggestedAction === "DISMISS" ? "REVIEW_VALUE" : suggestedAction;
  }

  private async settleDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payload: DecisionPayload,
    outcome: Record<string, unknown>,
  ) {
    const now = new Date();
    if (payload.decisionKind === "REVIEW") {
      const locks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "KnowledgeV2ReviewItem"
        WHERE "tenantId" = ${tenantId} AND "id" = ${payload.decisionId}
        FOR UPDATE
      `);
      if (locks.length !== 1) this.stale();
      const review = await tx.knowledgeV2ReviewItem.findUnique({
        where: { tenantId_id: { tenantId, id: payload.decisionId } },
        select: {
          status: true,
          generation: true,
          resolutionAction: true,
          resolutionSummaryHash: true,
          resolvedByUserId: true,
          resolvedAt: true,
        },
      });
      if (!review) this.stale();
      const action = payload.action as KnowledgeV2ReviewAction;
      const status = action === "DISMISS" ? "DISMISSED" : "RESOLVED";
      if (
        review.generation === payload.decisionGeneration &&
        review.status === status &&
        review.resolutionAction === action &&
        review.resolutionSummaryHash === payload.resolutionHash &&
        review.resolvedByUserId === payload.actorUserId &&
        review.resolvedAt
      ) {
        return false;
      }
      if (
        review.generation !== payload.decisionGeneration ||
        review.status !== "IN_REVIEW" ||
        review.resolutionAction !== null ||
        review.resolutionSummaryHash !== null ||
        review.resolvedByUserId !== null ||
        review.resolvedAt !== null
      ) {
        this.stale();
      }
      await tx.knowledgeV2ReviewItem.update({
        where: { tenantId_id: { tenantId, id: payload.decisionId } },
        data: {
          status,
          resolutionAction: action,
          resolutionSummaryHash: payload.resolutionHash,
          restrictedResolutionRef: null,
          resolvedByUserId: payload.actorUserId,
          resolvedAt: now,
          etag: { increment: 1 },
        },
      });
      return true;
    }

    const locks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2Conflict"
      WHERE "tenantId" = ${tenantId} AND "id" = ${payload.decisionId}
      FOR UPDATE
    `);
    if (locks.length !== 1) this.stale();
    const conflict = await tx.knowledgeV2Conflict.findUnique({
      where: { tenantId_id: { tenantId, id: payload.decisionId } },
      select: {
        status: true,
        generation: true,
        resolution: true,
        resolutionRationaleHash: true,
        resolvedByUserId: true,
        resolvedAt: true,
      },
    });
    if (!conflict) this.stale();
    const resolution = payload.action as ConflictResolution;
    const status = resolution === "DISMISS" ? "DISMISSED" : "RESOLVED";
    if (
      conflict.generation === payload.decisionGeneration &&
      conflict.status === status &&
      conflict.resolution === resolution &&
      conflict.resolutionRationaleHash === payload.resolutionHash &&
      conflict.resolvedByUserId === payload.actorUserId &&
      conflict.resolvedAt
    ) {
      return false;
    }
    if (
      conflict.generation !== payload.decisionGeneration ||
      conflict.status !== "IN_REVIEW" ||
      conflict.resolution !== null ||
      conflict.resolutionRationaleHash !== null ||
      conflict.resolvedByUserId !== null ||
      conflict.resolvedAt !== null
    ) {
      this.stale();
    }

    const linkedLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2ReviewItem"
      WHERE "tenantId" = ${tenantId}
        AND "conflictId" = ${payload.decisionId}
        AND "status" IN ('OPEN', 'ASSIGNED', 'IN_REVIEW')
      ORDER BY "id" ASC
      FOR UPDATE
    `);
    const linkedReviews = await tx.knowledgeV2ReviewItem.findMany({
      where: { tenantId, id: { in: linkedLocks.map((row) => row.id) } },
      select: { id: true, generation: true, status: true, suggestedAction: true },
      orderBy: { id: "asc" },
    });
    if (
      linkedReviews.length !== payload.linkedReviewPins.length ||
      linkedReviews.some((review, index) => {
        const pin = payload.linkedReviewPins[index];
        return !pin || review.id !== pin.id || review.generation !== pin.generation;
      })
    ) {
      this.stale();
    }

    await tx.knowledgeV2Conflict.update({
      where: { tenantId_id: { tenantId, id: payload.decisionId } },
      data: {
        status,
        resolution,
        resolutionRationaleHash: payload.resolutionHash,
        restrictedResolutionRef: null,
        resolvedByUserId: payload.actorUserId,
        resolvedAt: now,
        etag: { increment: 1 },
      },
    });
    for (const review of linkedReviews) {
      const action = this.linkedReviewAction(resolution, review.suggestedAction);
      const reviewStatus = resolution === "DISMISS" ? "DISMISSED" : "RESOLVED";
      const updated = await tx.knowledgeV2ReviewItem.update({
        where: { tenantId_id: { tenantId, id: review.id } },
        data: {
          status: reviewStatus,
          resolutionAction: action,
          resolutionSummaryHash: payload.resolutionHash,
          restrictedResolutionRef: null,
          resolvedByUserId: payload.actorUserId,
          resolvedAt: now,
          etag: { increment: 1 },
          generation: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: payload.actorUserId,
          action: "knowledge.v2.review.resolved_from_conflict",
          entityType: "knowledge_v2_review_item",
          entityId: review.id,
          payload: {
            conflictId: payload.decisionId,
            previousStatus: review.status,
            status: reviewStatus,
            action,
            resolution,
            generation: updated.generation,
            outcome,
          } as Prisma.InputJsonObject,
        },
      });
    }
    return true;
  }

  private async completeSuccess(
    event: Prisma.KnowledgeOutboxGetPayload<object>,
    lockId: string,
    payload: DecisionPayload,
    attempt: number,
    outcome: Record<string, unknown>,
  ) {
    const result = outcome as Prisma.InputJsonObject;
    await this.prisma.$transaction(async (tx) => {
      const settled = await this.settleDecision(tx, event.tenantId, payload, outcome);
      const completed = await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      if (completed.count !== 1)
        throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_LEASE_LOST", false);
      await Promise.all([
        tx.knowledgeInbox.update({
          where: { consumer_eventId: { consumer: consumerName, eventId: event.id } },
          data: { status: "SUCCEEDED", result, completedAt: new Date(), errorCode: null },
        }),
        tx.knowledgeJob.update({
          where: { id: payload.jobId },
          data: {
            status: "SUCCEEDED",
            progressCompleted: 1,
            progressTotal: 1,
            heartbeatAt: new Date(),
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        }),
        tx.knowledgeJobAttempt.update({
          where: { jobId_attempt: { jobId: payload.jobId, attempt } },
          data: { status: "SUCCEEDED", completedAt: new Date(), errorCode: null },
        }),
        tx.auditLog.create({
          data: {
            tenantId: event.tenantId,
            actorUserId: payload.actorUserId,
            action: "knowledge.v2.review_decision.executed",
            entityType:
              payload.decisionKind === "REVIEW"
                ? "knowledge_v2_review_item"
                : "knowledge_v2_conflict",
            entityId: payload.decisionId,
            payload: {
              action: payload.action,
              generation: payload.decisionGeneration,
              outcome,
              settled,
            } as Prisma.InputJsonObject,
          },
        }),
      ]);
    });
  }

  private async completeReconciled(
    eventId: string,
    tenantId: string,
    payload: DecisionPayload,
    outcome: Record<string, unknown>,
  ) {
    const result = outcome as Prisma.InputJsonObject;
    await this.prisma.$transaction(async (tx) => {
      const settled = await this.settleDecision(tx, tenantId, payload, outcome);
      const completed = await tx.knowledgeOutbox.updateMany({
        where: { id: eventId, tenantId, eventType, status: { not: "PUBLISHED" } },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      if (completed.count !== 1) {
        throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_LEASE_LOST", false);
      }
      await tx.knowledgeInbox.upsert({
        where: { consumer_eventId: { consumer: consumerName, eventId } },
        update: { status: "SUCCEEDED", result, completedAt: new Date(), errorCode: null },
        create: {
          tenantId,
          consumer: consumerName,
          eventId,
          status: "SUCCEEDED",
          result,
          completedAt: new Date(),
        },
      });
      await tx.knowledgeJob.updateMany({
        where: { id: payload.jobId, tenantId },
        data: {
          status: "SUCCEEDED",
          progressCompleted: 1,
          progressTotal: 1,
          heartbeatAt: new Date(),
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      await tx.knowledgeJobAttempt.updateMany({
        where: { tenantId, jobId: payload.jobId, status: "RUNNING" },
        data: { status: "SUCCEEDED", completedAt: new Date(), errorCode: null },
      });
      if (settled) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: payload.actorUserId,
            action: "knowledge.v2.review_decision.executed",
            entityType:
              payload.decisionKind === "REVIEW"
                ? "knowledge_v2_review_item"
                : "knowledge_v2_conflict",
            entityId: payload.decisionId,
            payload: {
              action: payload.action,
              generation: payload.decisionGeneration,
              outcome,
              reconciled: true,
            } as Prisma.InputJsonObject,
          },
        });
      }
    });
    return outcome;
  }

  private async completeFailure(
    event: Prisma.KnowledgeOutboxGetPayload<object>,
    lockId: string,
    payload: DecisionPayload,
    code: string,
    forceTerminal: boolean,
  ) {
    const terminal = forceTerminal || event.attemptCount >= maxAttempts;
    const availableAt = new Date(
      Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(event.attemptCount, 6)),
    );
    await this.prisma.$transaction(async (tx) => {
      const failed = await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: code,
        },
      });
      if (failed.count !== 1) return;
      await Promise.all([
        tx.knowledgeInbox.updateMany({
          where: { consumer: consumerName, eventId: event.id },
          data: { status: "FAILED", errorCode: code, completedAt: new Date() },
        }),
        tx.knowledgeJob.updateMany({
          where: { id: payload.jobId, tenantId: event.tenantId },
          data: {
            status: terminal ? "DEAD_LETTER" : "RETRY_SCHEDULED",
            availableAt,
            errorCode: code,
            errorMessage: "Knowledge review decision execution failed.",
            heartbeatAt: new Date(),
            ...(terminal ? { completedAt: new Date() } : {}),
          },
        }),
        tx.knowledgeJobAttempt.updateMany({
          where: { jobId: payload.jobId, attempt: event.attemptCount },
          data: {
            status: "FAILED",
            errorCode: code,
            errorMessage: "Knowledge review decision execution failed.",
            completedAt: new Date(),
          },
        }),
      ]);
    });
  }

  private async failWithoutClaim(
    id: string,
    tenantId: string,
    code: string,
    payload?: DecisionPayload,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeOutbox.updateMany({
        where: { id, tenantId, eventType, status: { not: "PUBLISHED" } },
        data: { status: "DEAD_LETTER", lockedAt: null, lockedBy: null, lastErrorCode: code },
      });
      if (payload) {
        await tx.knowledgeJob.updateMany({
          where: { id: payload.jobId, tenantId },
          data: { status: "DEAD_LETTER", errorCode: code, completedAt: new Date() },
        });
      }
    });
  }

  private replayedResult(eventId: string) {
    return this.prisma.knowledgeInbox
      .findUnique({ where: { consumer_eventId: { consumer: consumerName, eventId } } })
      .then((inbox) => (inbox?.status === "SUCCEEDED" ? inbox.result : null));
  }

  private async pinReviewTarget(
    tx: Prisma.TransactionClient,
    review: TerminalReviewDecision,
  ): Promise<TargetPin> {
    const action = review.resolutionAction;
    if (action && sourceActions.includes(action as (typeof sourceActions)[number])) {
      if (review.v2DocumentRevisionId)
        return this.pinRevision(tx, review.tenantId, review.v2DocumentRevisionId, review.sourceId);
      if (review.sourceId) return this.pinSource(tx, review.tenantId, review.sourceId);
      return { kind: "NONE" };
    }
    if (review.factId) return this.pinFact(tx, review.tenantId, review.factId);
    if (review.guidanceRuleId) return this.pinGuidance(tx, review.tenantId, review.guidanceRuleId);
    if (review.v2DocumentRevisionId)
      return this.pinRevision(tx, review.tenantId, review.v2DocumentRevisionId, review.sourceId);
    if (review.sourceId) return this.pinSource(tx, review.tenantId, review.sourceId);
    return { kind: "NONE" };
  }

  private async pinConflictTarget(
    tx: Prisma.TransactionClient,
    conflict: TerminalConflictDecision,
  ): Promise<TargetPin> {
    if (conflict.resolution !== "KEEP_LEFT" && conflict.resolution !== "KEEP_RIGHT")
      return { kind: "NONE" };
    const ordinal = conflict.resolution === "KEEP_LEFT" ? 0 : 1;
    const candidate = await tx.knowledgeV2ConflictCandidate.findFirst({
      where: { tenantId: conflict.tenantId, conflictId: conflict.id, ordinal },
      select: {
        id: true,
        ordinal: true,
        itemVersionHash: true,
        candidateValueHash: true,
        factVersion: {
          select: { id: true, factId: true },
        },
      },
    });
    if (!candidate?.factVersion) {
      throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_VALUE_UNAVAILABLE", true);
    }
    const hydration = await this.candidateReader.requireHydration(tx, {
      tenantId: conflict.tenantId,
      userId: conflict.resolvedByUserId!,
      conflictId: conflict.id,
      candidateId: candidate.id,
      allowTerminalConflict: true,
    });
    const fact = await this.factRecord(tx, conflict.tenantId, candidate.factVersion.factId);
    return {
      kind: "FACT_CANDIDATE",
      factId: fact.id,
      factEtag: fact.etag,
      factGeneration: fact.generation,
      factLatestVersionNumber: fact.latestVersionNumber,
      factLatestVersionId: fact.versions[0]!.id,
      factLatestVersionHash: fact.versions[0]!.immutableHash,
      candidateId: candidate.id,
      conflictId: conflict.id,
      candidateOrdinal: candidate.ordinal,
      candidateVersionId: candidate.factVersion.id,
      candidateVersionHash: candidate.itemVersionHash,
      candidateValueHash: candidate.candidateValueHash,
      candidateAuthorizationHash: hydration.authorizationHash,
    };
  }

  private async pinFact(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<TargetPin> {
    const fact = await this.factRecord(tx, tenantId, id);
    return {
      kind: "FACT",
      id: fact.id,
      etag: fact.etag,
      generation: fact.generation,
      latestVersionNumber: fact.latestVersionNumber,
      latestVersionId: fact.versions[0]!.id,
      latestVersionHash: fact.versions[0]!.immutableHash,
    };
  }

  private async factRecord(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const fact = await tx.knowledgeV2Fact.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!fact?.versions[0] || fact.versions[0].versionNumber !== fact.latestVersionNumber)
      this.stale();
    return fact;
  }

  private async pinGuidance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<TargetPin> {
    const guidance = await tx.knowledgeV2GuidanceRule.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (
      !guidance?.versions[0] ||
      guidance.versions[0].versionNumber !== guidance.latestVersionNumber
    )
      this.stale();
    return {
      kind: "GUIDANCE",
      id: guidance.id,
      etag: guidance.etag,
      generation: guidance.generation,
      latestVersionNumber: guidance.latestVersionNumber,
      latestVersionId: guidance.versions[0].id,
      latestVersionHash: guidance.versions[0].immutableHash,
    };
  }

  private async pinSource(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<TargetPin> {
    const source = await tx.knowledgeV2Source.findFirst({ where: { id, tenantId } });
    if (!source) this.stale();
    return {
      kind: "SOURCE",
      id: source.id,
      etag: source.etag,
      generation: source.generation,
      permissionVersion: source.sourcePermissionVersion,
      status: source.status,
    };
  }

  private async pinRevision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedSourceId: string | null,
  ): Promise<TargetPin> {
    const revision = await tx.knowledgeV2DocumentRevision.findFirst({
      where: { id, tenantId },
    });
    if (!revision || (expectedSourceId && expectedSourceId !== revision.sourceId)) this.stale();
    const source = await tx.knowledgeV2Source.findFirst({
      where: { id: revision.sourceId, tenantId },
    });
    if (!source) this.stale();
    return {
      kind: "REVISION",
      id: revision.id,
      generation: revision.generation,
      contentHash: revision.contentHash,
      status: revision.status,
      sourceId: source.id,
      sourceEtag: source.etag,
      sourceGeneration: source.generation,
      sourcePermissionVersion: source.sourcePermissionVersion,
      sourceStatus: source.status,
    };
  }

  private stale(): never {
    throw new ReviewDecisionError("KNOWLEDGE_CONFLICT_REVIEW_DECISION_STALE", true);
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const events = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType,
          availableAt: { lte: new Date() },
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PUBLISHING", lockedAt: null },
            { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - leaseMs) } },
          ],
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
        take: 10,
      });
      for (const event of events) await this.dispatch(event.id).catch(() => undefined);
    } finally {
      this.draining = false;
    }
  }
}
