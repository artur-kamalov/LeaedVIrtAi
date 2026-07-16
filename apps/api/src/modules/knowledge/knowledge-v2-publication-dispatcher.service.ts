import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2PublicationService } from "./knowledge-v2-publication.service.js";
import {
  recordKnowledgeV2PublicationFailure,
  recordKnowledgeV2PublicationSuccess,
} from "./knowledge-v2-publication-metrics.js";

const eventType = "knowledge.v2.publication.activate.requested";
const consumerName = "api.knowledge-v2-publication.v1";
const leaseMs = 60_000;
const maxAttempts = 5;

type ActivationOperation = "PUBLISH" | "ROLLBACK";

interface ActivationPayload {
  publicationId: string;
  actorUserId: string | null;
  operation: ActivationOperation;
  jobId: string;
}

function parsePayload(value: Prisma.JsonValue): ActivationPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  if (
    typeof record.publicationId !== "string" ||
    typeof record.jobId !== "string" ||
    (record.actorUserId !== null && typeof record.actorUserId !== "string") ||
    (record.operation !== "PUBLISH" && record.operation !== "ROLLBACK")
  ) {
    return null;
  }
  return {
    publicationId: record.publicationId,
    jobId: record.jobId,
    actorUserId: record.actorUserId,
    operation: record.operation,
  };
}

function matchesEnvelope(
  event: {
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    eventType: string;
    schemaVersion: number;
    dedupeKey: string;
  },
  payload: ActivationPayload,
) {
  return (
    event.aggregateType === "KnowledgePublication" &&
    event.aggregateId === payload.publicationId &&
    event.aggregateVersion > 0 &&
    event.eventType === eventType &&
    event.schemaVersion === 1 &&
    event.dedupeKey === `${eventType}:${payload.publicationId}`
  );
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "getResponse" in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (typeof response === "object" && response !== null && "code" in response) {
      const code = response.code;
      if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)) return code;
    }
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `PRISMA_${error.code}`;
  return "KNOWLEDGE_PUBLICATION_ACTIVATION_FAILED";
}

function terminalError(code: string) {
  return (
    code.includes("BASE_CHANGED") ||
    code.includes("NOT_FOUND") ||
    code.includes("VALIDATION") ||
    code.includes("CRITICAL_EVALUATION") ||
    code.includes("PERMISSION") ||
    code.includes("STALE")
  );
}

@Injectable()
export class KnowledgeV2PublicationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2PublicationService)
    private readonly publications: KnowledgeV2PublicationService,
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

  async dispatch(id: string) {
    const current = await this.prisma.knowledgeOutbox.findUnique({ where: { id } });
    if (!current || current.eventType !== eventType) return null;
    if (current.status === "PUBLISHED") return this.replayedResult(id);

    const payload = parsePayload(current.payload);
    if (!payload) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_PUBLICATION_EVENT_INVALID",
      );
      return null;
    }
    if (!matchesEnvelope(current, payload)) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_PUBLICATION_ENVELOPE_INVALID",
      );
      return null;
    }

    const envelopeJob = await this.prisma.knowledgeJob.findFirst({
      where: {
        id: payload.jobId,
        tenantId: current.tenantId,
        publicationId: payload.publicationId,
      },
    });
    if (
      !envelopeJob ||
      envelopeJob.idempotencyKey !== current.dedupeKey ||
      envelopeJob.generation !== current.aggregateVersion ||
      envelopeJob.payloadRef !== `knowledge-outbox:${current.id}`
    ) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_PUBLICATION_JOB_MISMATCH",
      );
      return null;
    }

    const reconciled = await this.reconcileCommittedActivation(current, payload);
    if (reconciled) return reconciled;

    const evaluationState = await this.publications.activationEvaluationState({
      tenantId: current.tenantId,
      publicationId: payload.publicationId,
    });
    if (evaluationState === "PENDING") {
      await this.deferForEvaluation(current.id, current.tenantId, payload);
      return null;
    }
    if (evaluationState === "FAILED") {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED",
        payload,
      );
      return null;
    }

    const now = new Date();
    if (
      current.status === "DEAD_LETTER" ||
      current.attemptCount >= maxAttempts ||
      Boolean(current.deadlineAt && current.deadlineAt <= now)
    ) {
      await this.failWithoutClaim(
        current.id,
        current.tenantId,
        "KNOWLEDGE_PUBLICATION_OUTBOX_EXHAUSTED",
        payload,
      );
      return null;
    }

    const lockId = `${consumerName}:${randomUUID()}`;
    const claim = await this.prisma.knowledgeOutbox.updateMany({
      where: {
        id,
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
    if (claim.count !== 1) return this.replayedResult(id);

    const event = await this.prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id } });
    const linkedJob = await this.prisma.knowledgeJob.findFirst({
      where: {
        id: payload.jobId,
        tenantId: event.tenantId,
        publicationId: payload.publicationId,
      },
    });
    if (
      !linkedJob ||
      linkedJob.idempotencyKey !== event.dedupeKey ||
      linkedJob.generation !== event.aggregateVersion ||
      linkedJob.payloadRef !== `knowledge-outbox:${event.id}`
    ) {
      await this.completeFailure(
        event.id,
        event.tenantId,
        lockId,
        payload,
        event.attemptCount,
        "KNOWLEDGE_PUBLICATION_JOB_MISMATCH",
        true,
      );
      return null;
    }
    const updatedJob = await this.prisma.knowledgeJob.updateMany({
      where: {
        id: payload.jobId,
        tenantId: event.tenantId,
        publicationId: payload.publicationId,
        status: { in: ["QUEUED", "RETRY_SCHEDULED", "RUNNING"] },
      },
      data: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        heartbeatAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    if (updatedJob.count !== 1) {
      await this.completeFailure(
        event.id,
        event.tenantId,
        lockId,
        payload,
        event.attemptCount,
        "KNOWLEDGE_PUBLICATION_JOB_MISMATCH",
        true,
      );
      return null;
    }
    const job = await this.prisma.knowledgeJob.findFirstOrThrow({
      where: {
        id: payload.jobId,
        tenantId: event.tenantId,
        publicationId: payload.publicationId,
      },
    });
    await this.prisma.knowledgeJobAttempt.create({
      data: {
        tenantId: event.tenantId,
        jobId: job.id,
        attempt: job.attemptCount,
        status: "RUNNING",
        workerId: consumerName,
      },
    });
    await this.prisma.knowledgeInbox.upsert({
      where: { consumer_eventId: { consumer: consumerName, eventId: event.id } },
      update: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        completedAt: null,
        errorCode: null,
      },
      create: {
        tenantId: event.tenantId,
        consumer: consumerName,
        eventId: event.id,
        status: "PROCESSING",
      },
    });

    let renewal = Promise.resolve();
    let leaseLost = false;
    const renewalTimer = setInterval(
      () => {
        renewal = renewal
          .then(async () => {
            const renewed = await this.prisma.knowledgeOutbox.updateMany({
              where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
              data: { lockedAt: new Date() },
            });
            if (renewed.count !== 1) leaseLost = true;
            await this.prisma.knowledgeJob.updateMany({
              where: {
                id: job.id,
                tenantId: event.tenantId,
                publicationId: payload.publicationId,
                status: "RUNNING",
              },
              data: { heartbeatAt: new Date() },
            });
          })
          .catch(() => {
            leaseLost = true;
          });
      },
      Math.floor(leaseMs / 3),
    );
    renewalTimer.unref();

    try {
      const result = await this.publications.activatePublication({
        tenantId: event.tenantId,
        publicationId: payload.publicationId,
        actorUserId: payload.actorUserId,
        operation: payload.operation,
      });
      clearInterval(renewalTimer);
      await renewal;
      if (leaseLost) throw new Error("Knowledge v2 outbox lease was lost.");
      const resultJson = result as unknown as Prisma.InputJsonObject;
      await this.prisma.$transaction(async (tx) => {
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
        if (completed.count !== 1) throw new Error("Knowledge v2 outbox lease was lost.");
        await tx.knowledgeInbox.update({
          where: { consumer_eventId: { consumer: consumerName, eventId: event.id } },
          data: { status: "SUCCEEDED", result: resultJson, completedAt: new Date() },
        });
        await tx.knowledgeJob.updateMany({
          where: {
            id: job.id,
            tenantId: event.tenantId,
            publicationId: payload.publicationId,
          },
          data: {
            status: "SUCCEEDED",
            completedAt: new Date(),
            heartbeatAt: new Date(),
            progressCompleted: result.itemCount,
            progressTotal: result.itemCount,
          },
        });
        await tx.knowledgeJobAttempt.update({
          where: { jobId_attempt: { jobId: job.id, attempt: job.attemptCount } },
          data: { status: "SUCCEEDED", completedAt: new Date() },
        });
      });
      await recordKnowledgeV2PublicationSuccess(this.prisma, {
        tenantId: event.tenantId,
        publicationId: payload.publicationId,
        operation: payload.operation,
      }).catch(() => undefined);
      return result;
    } catch (error) {
      clearInterval(renewalTimer);
      await renewal;
      if (leaseLost) throw error;
      const activeCheck = await this.prisma.activeKnowledgePublication
        .findUnique({
          where: { tenantId_targetKey: { tenantId: event.tenantId, targetKey: "workspace-v2" } },
          select: { publicationId: true },
        })
        .then((active) => ({
          checked: true as const,
          publicationId: active?.publicationId ?? null,
        }))
        .catch(() => ({ checked: false as const, publicationId: null }));
      if (!activeCheck.checked || activeCheck.publicationId === payload.publicationId) throw error;
      const code = errorCode(error);
      await this.completeFailure(
        event.id,
        event.tenantId,
        lockId,
        payload,
        job.attemptCount,
        code,
        terminalError(code),
      );
      throw error;
    }
  }

  private async replayedResult(eventId: string) {
    const inbox = await this.prisma.knowledgeInbox.findUnique({
      where: { consumer_eventId: { consumer: consumerName, eventId } },
    });
    return inbox?.status === "SUCCEEDED" ? inbox.result : null;
  }

  private async reconcileCommittedActivation(
    event: {
      id: string;
      tenantId: string;
      aggregateVersion: number;
      eventType: string;
    },
    payload: ActivationPayload,
  ) {
    const publication = await this.prisma.knowledgePublication.findFirst({
      where: {
        id: payload.publicationId,
        tenantId: event.tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: event.aggregateVersion,
        activatedAt: { not: null },
        status: { in: ["ACTIVE", "SUPERSEDED", "ROLLED_BACK"] },
      },
      select: { id: true, sequence: true, _count: { select: { items: true } } },
    });
    if (!publication) return null;
    const result = {
      publicationId: publication.id,
      sequence: publication.sequence,
      itemCount: publication._count.items,
    };
    const resultJson = result as Prisma.InputJsonObject;
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, tenantId: event.tenantId, eventType: event.eventType },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      await tx.knowledgeInbox.upsert({
        where: { consumer_eventId: { consumer: consumerName, eventId: event.id } },
        update: {
          status: "SUCCEEDED",
          result: resultJson,
          completedAt: new Date(),
          errorCode: null,
        },
        create: {
          tenantId: event.tenantId,
          consumer: consumerName,
          eventId: event.id,
          status: "SUCCEEDED",
          result: resultJson,
          completedAt: new Date(),
        },
      });
      await tx.knowledgeJob.updateMany({
        where: {
          id: payload.jobId,
          tenantId: event.tenantId,
          publicationId: payload.publicationId,
        },
        data: {
          status: "SUCCEEDED",
          progressCompleted: result.itemCount,
          progressTotal: result.itemCount,
          heartbeatAt: new Date(),
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      await tx.knowledgeJobAttempt.updateMany({
        where: { tenantId: event.tenantId, jobId: payload.jobId, status: "RUNNING" },
        data: { status: "SUCCEEDED", completedAt: new Date(), errorCode: null },
      });
    });
    return result;
  }

  private async failWithoutClaim(
    id: string,
    tenantId: string,
    code: string,
    payload?: ActivationPayload,
  ) {
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const failed = await tx.knowledgeOutbox.updateMany({
        where: { id, eventType, status: { notIn: ["PUBLISHED", "DEAD_LETTER"] } },
        data: {
          status: "DEAD_LETTER",
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: code,
        },
      });
      if (failed.count !== 1) return false;
      if (payload) {
        await tx.knowledgeJob.updateMany({
          where: {
            id: payload.jobId,
            tenantId,
            publicationId: payload.publicationId,
          },
          data: { status: "DEAD_LETTER", errorCode: code, completedAt: new Date() },
        });
        await tx.knowledgePublication.updateMany({
          where: {
            id: payload.publicationId,
            tenantId,
            status: { in: ["READY", "PUBLISHING"] },
          },
          data: { status: "FAILED", failureCode: code, failedAt: new Date() },
        });
      }
      return true;
    });
    if (transitioned) {
      await recordKnowledgeV2PublicationFailure(this.prisma, {
        tenantId,
        publicationId: payload?.publicationId ?? null,
        operation: payload?.operation ?? "UNKNOWN",
        code,
      }).catch(() => undefined);
    }
  }

  private async completeFailure(
    eventId: string,
    tenantId: string,
    lockId: string,
    payload: ActivationPayload,
    attempt: number,
    code: string,
    forceTerminal: boolean,
  ) {
    const terminal = forceTerminal || attempt >= maxAttempts;
    const availableAt = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)));
    const transitionedTerminal = await this.prisma.$transaction(async (tx) => {
      const failed = await tx.knowledgeOutbox.updateMany({
        where: { id: eventId, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          availableAt,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: code,
        },
      });
      if (failed.count !== 1) return false;
      await tx.knowledgeInbox.updateMany({
        where: { consumer: consumerName, eventId },
        data: { status: "FAILED", errorCode: code, completedAt: new Date() },
      });
      await tx.knowledgeJob.updateMany({
        where: { id: payload.jobId, tenantId, publicationId: payload.publicationId },
        data: {
          status: terminal ? "DEAD_LETTER" : "RETRY_SCHEDULED",
          availableAt,
          errorCode: code,
          errorMessage: "Knowledge publication activation failed.",
          heartbeatAt: new Date(),
          ...(terminal ? { completedAt: new Date() } : {}),
        },
      });
      await tx.knowledgeJobAttempt.updateMany({
        where: { jobId: payload.jobId, attempt },
        data: {
          status: "FAILED",
          errorCode: code,
          errorMessage: "Knowledge publication activation failed.",
          completedAt: new Date(),
        },
      });
      if (terminal) {
        await tx.knowledgePublication.updateMany({
          where: {
            id: payload.publicationId,
            tenantId,
            status: { in: ["READY", "PUBLISHING"] },
          },
          data: { status: "FAILED", failureCode: code, failedAt: new Date() },
        });
      }
      return terminal;
    });
    if (transitionedTerminal) {
      await recordKnowledgeV2PublicationFailure(this.prisma, {
        tenantId,
        publicationId: payload.publicationId,
        operation: payload.operation,
        code,
      }).catch(() => undefined);
    }
  }

  private async deferForEvaluation(eventId: string, tenantId: string, payload: ActivationPayload) {
    const availableAt = new Date(Date.now() + 5_000);
    await this.prisma.$transaction(async (tx) => {
      const deferred = await tx.knowledgeOutbox.updateMany({
        where: { id: eventId, tenantId, status: { in: ["PENDING", "FAILED"] } },
        data: {
          availableAt,
          lastErrorCode: "KNOWLEDGE_PUBLICATION_EVALUATION_PENDING",
        },
      });
      if (deferred.count !== 1) return;
      await tx.knowledgeJob.updateMany({
        where: {
          id: payload.jobId,
          tenantId,
          publicationId: payload.publicationId,
          status: { in: ["QUEUED", "RETRY_SCHEDULED"] },
        },
        data: {
          availableAt,
          errorCode: "KNOWLEDGE_PUBLICATION_EVALUATION_PENDING",
          errorMessage: null,
        },
      });
    });
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
