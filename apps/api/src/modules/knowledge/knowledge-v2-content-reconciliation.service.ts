import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type MembershipRole } from "@leadvirt/db";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { PrismaService } from "../database/prisma.service.js";
import { canonicalKnowledgeV2Hash } from "./knowledge-v2-http.js";

const eventType = "knowledge.v2.content-reconciliation.requested";
const pipelineVersion = "knowledge-v2";
const consumer = "api.knowledge-v2-content-reconciliation.v1";
const leaseMs = 5 * 60_000;
const maximumAttempts = 5;

export type KnowledgeV2ContentResourceType = "FACT" | "GUIDANCE_RULE";
export type KnowledgeV2ContentAction =
  | "CREATE"
  | "UPDATE"
  | "VERIFY"
  | "APPROVE"
  | "REJECT"
  | "DISABLE";

interface ContentEventPayload {
  version: 1;
  jobId: string;
  resourceType: KnowledgeV2ContentResourceType;
  resourceId: string;
  resourceGeneration: number;
  versionId: string;
  versionNumber: number;
  versionHash: string;
  draftGeneration: number;
  action: KnowledgeV2ContentAction;
  actorUserId: string;
  requestedRole: MembershipRole;
  mutationIdempotencyHash: string;
}

class ContentReconciliationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function failure(error: unknown) {
  return error instanceof ContentReconciliationError
    ? error
    : new ContentReconciliationError("KNOWLEDGE_DEPENDENCY_CONTENT_RECONCILIATION_FAILED", true);
}

function parsePayload(value: Prisma.JsonValue): ContentEventPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = value as Record<string, Prisma.JsonValue>;
  if (
    data.version !== 1 ||
    typeof data.jobId !== "string" ||
    (data.resourceType !== "FACT" && data.resourceType !== "GUIDANCE_RULE") ||
    typeof data.resourceId !== "string" ||
    typeof data.resourceGeneration !== "number" ||
    typeof data.versionId !== "string" ||
    typeof data.versionNumber !== "number" ||
    typeof data.versionHash !== "string" ||
    typeof data.draftGeneration !== "number" ||
    typeof data.action !== "string" ||
    !["CREATE", "UPDATE", "VERIFY", "APPROVE", "REJECT", "DISABLE"].includes(data.action) ||
    typeof data.actorUserId !== "string" ||
    typeof data.requestedRole !== "string" ||
    !["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"].includes(data.requestedRole) ||
    typeof data.mutationIdempotencyHash !== "string"
  )
    return null;
  return data as unknown as ContentEventPayload;
}

export async function enqueueKnowledgeV2ContentReconciliation(
  tx: Prisma.TransactionClient,
  input: Omit<ContentEventPayload, "version" | "jobId" | "mutationIdempotencyHash"> & {
    tenantId: string;
    mutationIdempotencyKey: string;
  },
) {
  const jobId = randomUUID();
  const deadlineAt = new Date(Date.now() + 30 * 60_000);
  const mutationIdempotencyHash = canonicalKnowledgeV2Hash(input.mutationIdempotencyKey);
  const idempotencyKey = [
    eventType,
    input.resourceType,
    input.resourceId,
    input.versionId,
    input.action,
  ].join(":");
  const payload: ContentEventPayload = {
    version: 1,
    jobId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceGeneration: input.resourceGeneration,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    versionHash: input.versionHash,
    draftGeneration: input.draftGeneration,
    action: input.action,
    actorUserId: input.actorUserId,
    requestedRole: input.requestedRole,
    mutationIdempotencyHash,
  };
  const job = await tx.knowledgeJob.create({
    data: {
      id: jobId,
      tenantId: input.tenantId,
      idempotencyKey,
      stage: "VALIDATING",
      pipelineVersion,
      generation: input.draftGeneration,
      status: "QUEUED",
      deadlineAt,
      maxAttempts: maximumAttempts,
      progressTotal: 1,
      payloadRef: `content-reconciliation:${input.resourceType}:${input.resourceId}:${input.versionId}`,
    },
  });
  const event = await tx.knowledgeOutbox.create({
    data: {
      tenantId: input.tenantId,
      aggregateType: input.resourceType === "FACT" ? "KnowledgeV2Fact" : "KnowledgeV2GuidanceRule",
      aggregateId: input.resourceId,
      aggregateVersion: input.resourceGeneration,
      eventType,
      schemaVersion: 1,
      dedupeKey: idempotencyKey,
      payload: payload as unknown as Prisma.InputJsonObject,
      deadlineAt,
    },
  });
  return { job, event };
}

@Injectable()
export class KnowledgeV2ContentReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.drain().catch(() => undefined), 5_000);
    this.timer.unref();
    void this.drain().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(eventId: string) {
    const lockId = `${consumer}:${randomUUID()}`;
    const claimed = await this.prisma.knowledgeOutbox.updateMany({
      where: {
        id: eventId,
        eventType,
        attemptCount: { lt: maximumAttempts },
        deadlineAt: { gt: new Date() },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - leaseMs) } },
          { status: "PUBLISHING", lockedAt: null },
        ],
      },
      data: {
        status: "PUBLISHING",
        attemptCount: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: lockId,
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return;
    const event = await this.prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: eventId } });
    const payload = parsePayload(event.payload);
    if (
      !payload ||
      event.dedupeKey !==
        [
          eventType,
          payload.resourceType,
          payload.resourceId,
          payload.versionId,
          payload.action,
        ].join(":")
    ) {
      await this.fail(
        event,
        lockId,
        payload?.jobId ?? "",
        new ContentReconciliationError(
          "KNOWLEDGE_VALIDATION_CONTENT_RECONCILIATION_EVENT_INVALID",
          false,
        ),
      );
      return;
    }
    try {
      await this.execute(event, payload, lockId);
    } catch (error) {
      await this.fail(event, lockId, payload.jobId, error);
    }
  }

  private async execute(
    event: { id: string; tenantId: string; attemptCount: number },
    payload: ContentEventPayload,
    lockId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.knowledgeJob.findFirst({
        where: {
          id: payload.jobId,
          tenantId: event.tenantId,
          idempotencyKey: [
            eventType,
            payload.resourceType,
            payload.resourceId,
            payload.versionId,
            payload.action,
          ].join(":"),
          generation: payload.draftGeneration,
          payloadRef: `content-reconciliation:${payload.resourceType}:${payload.resourceId}:${payload.versionId}`,
        },
      });
      if (!job)
        throw new ContentReconciliationError(
          "KNOWLEDGE_VALIDATION_CONTENT_RECONCILIATION_JOB_INVALID",
          false,
        );
      if (job.status === "CANCELLED")
        throw new ContentReconciliationError(
          "KNOWLEDGE_CONFLICT_CONTENT_RECONCILIATION_CANCELLED",
          false,
        );
      const claimedJob = await tx.knowledgeJob.updateMany({
        where: {
          id: job.id,
          tenantId: event.tenantId,
          status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED"] },
          deadlineAt: { gt: new Date() },
        },
        data: {
          status: "RUNNING",
          attemptCount: { increment: 1 },
          startedAt: job.startedAt ?? new Date(),
          heartbeatAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claimedJob.count !== 1)
        throw new ContentReconciliationError(
          "KNOWLEDGE_CONFLICT_CONTENT_RECONCILIATION_CLAIM_INVALID",
          false,
        );
      const attempt = job.attemptCount + 1;
      await tx.knowledgeJobAttempt.updateMany({
        where: { jobId: job.id, status: "RUNNING" },
        data: {
          status: "TIMED_OUT",
          errorCode: "KNOWLEDGE_DEPENDENCY_CONTENT_RECONCILIATION_LEASE_EXPIRED",
          errorMessage: null,
          heartbeatAt: new Date(),
          completedAt: new Date(),
        },
      });
      await tx.knowledgeJobAttempt.create({
        data: {
          tenantId: event.tenantId,
          jobId: job.id,
          attempt,
          status: "RUNNING",
          workerId: lockId,
          heartbeatAt: new Date(),
        },
      });
      await tx.knowledgeInbox.upsert({
        where: { consumer_eventId: { consumer, eventId: event.id } },
        update: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          startedAt: new Date(),
          completedAt: null,
          errorCode: null,
        },
        create: { tenantId: event.tenantId, consumer, eventId: event.id, status: "PROCESSING" },
      });
    });

    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: {
          tenantId: event.tenantId,
          userId: payload.actorUserId,
          role: payload.requestedRole,
          user: { deletedAt: null },
          tenant: { deletedAt: null },
        },
        select: { role: true },
      });
      if (!membership || !this.roleAllows(payload, membership.role)) {
        throw new ContentReconciliationError(
          "KNOWLEDGE_PERMISSION_CONTENT_RECONCILIATION_ACTOR_REVOKED",
          false,
        );
      }
      const settings = await tx.knowledgeV2Settings.findUnique({
        where: { tenantId: event.tenantId },
        select: { draftGeneration: true },
      });
      if (!settings || settings.draftGeneration < payload.draftGeneration) throw this.stale();
      if (!(await this.versionIsCurrent(tx, event.tenantId, payload))) throw this.stale();
      const fenced = await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      if (fenced.count !== 1)
        throw new ContentReconciliationError(
          "KNOWLEDGE_CONFLICT_CONTENT_RECONCILIATION_CLAIM_INVALID",
          false,
        );
      const job = await tx.knowledgeJob.findUniqueOrThrow({ where: { id: payload.jobId } });
      await tx.knowledgeJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          progressCompleted: 1,
          progressTotal: 1,
          heartbeatAt: new Date(),
          completedAt: new Date(),
        },
      });
      await tx.knowledgeJobAttempt.update({
        where: { jobId_attempt: { jobId: job.id, attempt: job.attemptCount } },
        data: { status: "SUCCEEDED", heartbeatAt: new Date(), completedAt: new Date() },
      });
      await tx.knowledgeInbox.update({
        where: { consumer_eventId: { consumer, eventId: event.id } },
        data: {
          status: "SUCCEEDED",
          result: {
            resourceType: payload.resourceType,
            resourceId: payload.resourceId,
            versionId: payload.versionId,
            versionHash: payload.versionHash,
            draftGeneration: payload.draftGeneration,
          },
          completedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: event.tenantId,
          actorUserId: payload.actorUserId,
          action: "knowledge.v2.content_reconciliation.completed",
          entityType: "knowledge_v2",
          entityId: payload.resourceId,
          payload: {
            resourceType: payload.resourceType,
            action: payload.action,
            versionId: payload.versionId,
            versionHash: payload.versionHash,
            resourceGeneration: payload.resourceGeneration,
            draftGeneration: payload.draftGeneration,
            mutationIdempotencyHash: payload.mutationIdempotencyHash,
          },
        },
      });
    });
  }

  private async versionIsCurrent(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payload: ContentEventPayload,
  ) {
    if (payload.resourceType === "FACT") {
      const fact = await tx.knowledgeV2Fact.findFirst({
        where: {
          id: payload.resourceId,
          tenantId,
          deletedAt: null,
          generation: payload.resourceGeneration,
          latestVersionNumber: payload.versionNumber,
          versions: { some: { id: payload.versionId, immutableHash: payload.versionHash } },
        },
        select: {
          versions: {
            where: { id: payload.versionId },
            select: { riskLevel: true, verificationStatus: true },
          },
        },
      });
      const version = fact?.versions[0];
      if (!version) return false;
      if (payload.action === "VERIFY") return version.verificationStatus === "VERIFIED";
      if (payload.action === "REJECT") return version.verificationStatus === "REJECTED";
      return version.verificationStatus === "UNVERIFIED";
    }
    const guidance = await tx.knowledgeV2GuidanceRule.findFirst({
      where: {
        id: payload.resourceId,
        tenantId,
        deletedAt: null,
        generation: payload.resourceGeneration,
        latestVersionNumber: payload.versionNumber,
        versions: { some: { id: payload.versionId, immutableHash: payload.versionHash } },
      },
      select: {
        versions: {
          where: { id: payload.versionId },
          select: { reviewStatus: true },
        },
      },
    });
    const version = guidance?.versions[0];
    if (!version) return false;
    if (payload.action === "APPROVE") return version.reviewStatus === "APPROVED";
    if (payload.action === "REJECT") return version.reviewStatus === "REJECTED";
    if (payload.action === "DISABLE") return version.reviewStatus === "DISABLED";
    return version.reviewStatus === "DRAFT";
  }

  private roleAllows(payload: ContentEventPayload, role: MembershipRole) {
    if (!(["OWNER", "ADMIN", "MANAGER"] as MembershipRole[]).includes(role)) return false;
    if (payload.action === "VERIFY" || payload.action === "APPROVE") {
      return role === "OWNER" || role === "ADMIN" || payload.requestedRole === "MANAGER";
    }
    return true;
  }

  private stale() {
    return new ContentReconciliationError("KNOWLEDGE_CONFLICT_CONTENT_RECONCILIATION_STALE", false);
  }

  private async fail(
    event: { id: string; tenantId: string; attemptCount: number },
    lockId: string,
    jobId: string,
    error: unknown,
  ) {
    const failed = failure(error);
    const terminal = !failed.retryable || event.attemptCount >= maximumAttempts;
    const availableAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** event.attemptCount));
    await this.prisma.$transaction(async (tx) => {
      const fenced = await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: failed.code,
        },
      });
      if (fenced.count !== 1) return;
      if (jobId) {
        const job = await tx.knowledgeJob.findUnique({ where: { id: jobId } });
        if (job) {
          await tx.knowledgeJob.update({
            where: { id: job.id },
            data: {
              status: failed.code.includes("CANCELLED")
                ? "CANCELLED"
                : terminal
                  ? "DEAD_LETTER"
                  : "RETRY_SCHEDULED",
              availableAt,
              errorCode: failed.code,
              errorMessage: null,
              heartbeatAt: new Date(),
              ...(terminal ? { completedAt: new Date() } : {}),
            },
          });
          await tx.knowledgeJobAttempt.updateMany({
            where: { jobId: job.id, status: "RUNNING" },
            data: {
              status: failed.code.includes("CANCELLED") ? "CANCELLED" : "FAILED",
              errorCode: failed.code,
              errorMessage: null,
              heartbeatAt: new Date(),
              completedAt: new Date(),
            },
          });
        }
      }
      await tx.knowledgeInbox.upsert({
        where: { consumer_eventId: { consumer, eventId: event.id } },
        update: { status: "FAILED", errorCode: failed.code, completedAt: new Date() },
        create: {
          tenantId: event.tenantId,
          consumer,
          eventId: event.id,
          status: "FAILED",
          errorCode: failed.code,
          completedAt: new Date(),
        },
      });
    });
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const expired = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType,
          deadlineAt: { lte: new Date() },
          status: { in: ["PENDING", "FAILED", "PUBLISHING"] },
        },
        select: { id: true, tenantId: true, payload: true },
        take: 25,
      });
      for (const event of expired) {
        const payload = parsePayload(event.payload);
        await this.prisma.$transaction(async (tx) => {
          const fenced = await tx.knowledgeOutbox.updateMany({
            where: {
              id: event.id,
              eventType,
              deadlineAt: { lte: new Date() },
              status: { in: ["PENDING", "FAILED", "PUBLISHING"] },
            },
            data: {
              status: "DEAD_LETTER",
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: "KNOWLEDGE_DEPENDENCY_CONTENT_RECONCILIATION_DEADLINE_EXPIRED",
            },
          });
          if (fenced.count !== 1 || !payload) return;
          await tx.knowledgeJob.updateMany({
            where: { id: payload.jobId, tenantId: event.tenantId },
            data: {
              status: "DEAD_LETTER",
              errorCode: "KNOWLEDGE_DEPENDENCY_CONTENT_RECONCILIATION_DEADLINE_EXPIRED",
              errorMessage: null,
              completedAt: new Date(),
            },
          });
          await tx.knowledgeJobAttempt.updateMany({
            where: { jobId: payload.jobId, status: "RUNNING" },
            data: {
              status: "TIMED_OUT",
              errorCode: "KNOWLEDGE_DEPENDENCY_CONTENT_RECONCILIATION_DEADLINE_EXPIRED",
              completedAt: new Date(),
            },
          });
        });
      }
      const events = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType,
          availableAt: { lte: new Date() },
          deadlineAt: { gt: new Date() },
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - leaseMs) } },
            { status: "PUBLISHING", lockedAt: null },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { id: "asc" }],
        take: 10,
      });
      for (const event of events) await this.dispatch(event.id);
    } finally {
      this.draining = false;
    }
  }
}
