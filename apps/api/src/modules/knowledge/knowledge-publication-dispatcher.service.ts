import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import {
  LegacyKnowledgeCorpusInactiveError,
  LegacyKnowledgePublisher,
  hashKnowledgeValue,
  legacyKnowledgeCorpusInactiveCode,
  legacyPipelineVersion,
} from "@leadvirt/knowledge";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { PrismaService } from "../database/prisma.service.js";
import { LEGACY_KNOWLEDGE_PUBLISHER } from "./knowledge.tokens.js";

const consumerName = "api.legacy-knowledge-publisher.v1";
const legacyEventType = "knowledge.publication.requested";
const outboxLeaseMs = 60_000;
const outboxMaxAttempts = 5;
const outboxExhaustedCode = "KNOWLEDGE_OUTBOX_EXHAUSTED";

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function text(value: Prisma.JsonValue | undefined, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

@Injectable()
export class KnowledgePublicationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LEGACY_KNOWLEDGE_PUBLISHER) private readonly publisher: LegacyKnowledgePublisher,
  ) {}

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.drainPending().catch(() => undefined), 5000);
    this.timer.unref();
    void this.drainPending().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async createEvent(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId?: string | null;
      reason: string;
      stateParts: Array<string | number>;
    },
  ) {
    const stateToken = hashKnowledgeValue(
      [input.tenantId, input.reason, ...input.stateParts.map(String)].join(":"),
    );
    return tx.knowledgeOutbox.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId: input.tenantId,
          dedupeKey: `knowledge.publish:${stateToken}`,
        },
      },
      update: {},
      create: {
        tenantId: input.tenantId,
        aggregateType: "tenant_knowledge",
        aggregateId: stateToken,
        aggregateVersion: 1,
        eventType: "knowledge.publication.requested",
        schemaVersion: 1,
        dedupeKey: `knowledge.publish:${stateToken}`,
        payload: {
          tenantId: input.tenantId,
          targetKey: "workspace",
          actorUserId: input.actorUserId ?? null,
          reason: input.reason,
        },
      },
    });
  }

  async dispatch(eventId: string) {
    const current = await this.prisma.knowledgeOutbox.findUnique({ where: { id: eventId } });
    if (!current) throw new Error(`Knowledge outbox event ${eventId} was not found.`);
    if (current.eventType !== legacyEventType) return null;
    if (
      current.status === "DEAD_LETTER" &&
      current.lastErrorCode === legacyKnowledgeCorpusInactiveCode
    ) {
      throw new LegacyKnowledgeCorpusInactiveError();
    }
    const now = new Date();
    if (
      current.status !== "PUBLISHED" &&
      current.status !== "DEAD_LETTER" &&
      (current.attemptCount >= outboxMaxAttempts ||
        (current.deadlineAt && current.deadlineAt <= now))
    ) {
      const terminalized = await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.knowledgeOutbox.updateMany({
          where: {
            id: eventId,
            eventType: legacyEventType,
            AND: [
              {
                OR: [
                  { status: { in: ["PENDING", "FAILED"] } },
                  {
                    status: "PUBLISHING",
                    lockedAt: { lte: new Date(now.getTime() - outboxLeaseMs) },
                  },
                  { status: "PUBLISHING", lockedAt: null },
                ],
              },
              {
                OR: [{ attemptCount: { gte: outboxMaxAttempts } }, { deadlineAt: { lte: now } }],
              },
            ],
          },
          data: {
            status: "DEAD_LETTER",
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: outboxExhaustedCode,
          },
        });
        if (transitioned.count !== 1) return false;

        const completedAt = new Date();
        await tx.knowledgeInbox.updateMany({
          where: { consumer: consumerName, eventId, status: "PROCESSING" },
          data: {
            status: "FAILED",
            completedAt,
            errorCode: outboxExhaustedCode,
          },
        });
        await tx.knowledgeJobAttempt.updateMany({
          where: {
            tenantId: current.tenantId,
            status: "RUNNING",
            job: { idempotencyKey: `outbox:${eventId}` },
          },
          data: {
            status: "FAILED",
            completedAt,
            errorCode: outboxExhaustedCode,
          },
        });
        await tx.knowledgeJob.updateMany({
          where: {
            tenantId: current.tenantId,
            idempotencyKey: `outbox:${eventId}`,
            status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED"] },
          },
          data: {
            status: "DEAD_LETTER",
            completedAt,
            errorCode: outboxExhaustedCode,
          },
        });
        return true;
      });
      if (terminalized) {
        throw new Error(`Knowledge outbox event ${eventId} exhausted its retry budget.`);
      }
    }

    const lockId = `${consumerName}:${randomUUID()}`;
    const claimed = await this.prisma.knowledgeOutbox.updateMany({
      where: {
        id: eventId,
        eventType: legacyEventType,
        availableAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PUBLISHING", lockedAt: { lte: new Date(now.getTime() - outboxLeaseMs) } },
          { status: "PUBLISHING", lockedAt: null },
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
    if (claimed.count === 0) {
      const existing = await this.prisma.knowledgeOutbox.findUnique({ where: { id: eventId } });
      if (existing?.status === "PUBLISHED") {
        const inbox = await this.prisma.knowledgeInbox.findUnique({
          where: { consumer_eventId: { consumer: consumerName, eventId } },
        });
        return inbox?.result ?? null;
      }
      if (
        existing?.status === "DEAD_LETTER" &&
        existing.lastErrorCode === legacyKnowledgeCorpusInactiveCode
      ) {
        throw new LegacyKnowledgeCorpusInactiveError();
      }
      return null;
    }

    const event = await this.prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: eventId } });
    const payload = record(event.payload);
    const job = await this.prisma.knowledgeJob.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: event.tenantId,
          idempotencyKey: `outbox:${event.id}`,
        },
      },
      update: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        heartbeatAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
      create: {
        tenantId: event.tenantId,
        idempotencyKey: `outbox:${event.id}`,
        stage: "publish_legacy_snapshot",
        pipelineVersion: legacyPipelineVersion,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: new Date(),
        heartbeatAt: new Date(),
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
      where: { consumer_eventId: { consumer: consumerName, eventId } },
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
        eventId,
        status: "PROCESSING",
      },
    });

    let renewalTimer: NodeJS.Timeout | undefined;
    let renewal = Promise.resolve();
    let leaseLost = false;
    try {
      const renewLease = async () => {
        const renewed = await this.prisma.knowledgeOutbox.updateMany({
          where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
          data: { lockedAt: new Date() },
        });
        if (renewed.count !== 1) leaseLost = true;
        await this.prisma.knowledgeJob.updateMany({
          where: { id: job.id, status: "RUNNING" },
          data: { heartbeatAt: new Date() },
        });
      };
      renewalTimer = setInterval(
        () => {
          renewal = renewal.then(renewLease).catch(() => {
            leaseLost = true;
          });
        },
        Math.floor(outboxLeaseMs / 3),
      );
      renewalTimer.unref();
      const result = await this.publisher.publish({
        tenantId: event.tenantId,
        targetKey: text(payload.targetKey, "workspace"),
        actorUserId: typeof payload.actorUserId === "string" ? payload.actorUserId : null,
        reason: text(payload.reason, "knowledge_outbox"),
      });
      if (renewalTimer) clearInterval(renewalTimer);
      await renewal;
      if (leaseLost) throw new Error("Knowledge outbox lease was lost during publication.");
      const resultJson = result as unknown as Prisma.InputJsonObject;
      await this.prisma.$transaction(async (tx) => {
        const published = await tx.knowledgeOutbox.updateMany({
          where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: null,
          },
        });
        if (published.count !== 1)
          throw new Error("Knowledge outbox lease was lost after publication.");
        await tx.knowledgeInbox.update({
          where: { consumer_eventId: { consumer: consumerName, eventId } },
          data: {
            status: "SUCCEEDED",
            result: resultJson,
            completedAt: new Date(),
            errorCode: null,
          },
        });
        await tx.knowledgeJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            completedAt: new Date(),
            heartbeatAt: new Date(),
            publicationId: result.publicationId,
            indexSnapshotId: result.indexSnapshotId,
            progressCompleted: result.chunkCount,
            progressTotal: result.chunkCount,
          },
        });
        await tx.knowledgeJobAttempt.update({
          where: { jobId_attempt: { jobId: job.id, attempt: job.attemptCount } },
          data: { status: "SUCCEEDED", completedAt: new Date() },
        });
      });
      return result;
    } catch (error) {
      if (renewalTimer) clearInterval(renewalTimer);
      await renewal;
      const corpusInactive = error instanceof LegacyKnowledgeCorpusInactiveError;
      const errorCode = corpusInactive
        ? error.code
        : error instanceof Error
          ? error.name
          : "KNOWLEDGE_PUBLICATION_FAILED";
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "Knowledge publication failed.";
      const availableAt = new Date(
        Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(event.attemptCount, 6)),
      );
      const terminal =
        corpusInactive ||
        event.attemptCount >= outboxMaxAttempts ||
        Boolean(event.deadlineAt && event.deadlineAt <= new Date());
      await this.prisma
        .$transaction(async (tx) => {
          const failed = await tx.knowledgeOutbox.updateMany({
            where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
            data: {
              status: terminal ? "DEAD_LETTER" : "FAILED",
              availableAt,
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: errorCode,
            },
          });
          if (failed.count !== 1) return;
          await tx.knowledgeInbox.update({
            where: { consumer_eventId: { consumer: consumerName, eventId } },
            data: { status: "FAILED", errorCode, completedAt: new Date() },
          });
          await tx.knowledgeJob.update({
            where: { id: job.id },
            data: {
              status: corpusInactive
                ? "CANCELLED"
                : terminal || job.attemptCount >= job.maxAttempts
                  ? "DEAD_LETTER"
                  : "RETRY_SCHEDULED",
              availableAt,
              errorCode,
              errorMessage: message,
              heartbeatAt: new Date(),
              ...(terminal || job.attemptCount >= job.maxAttempts
                ? { completedAt: new Date() }
                : {}),
            },
          });
          await tx.knowledgeJobAttempt.update({
            where: { jobId_attempt: { jobId: job.id, attempt: job.attemptCount } },
            data: {
              status: corpusInactive ? "CANCELLED" : "FAILED",
              errorCode,
              errorMessage: message,
              completedAt: new Date(),
            },
          });
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async drainPending() {
    if (this.draining) return;
    this.draining = true;
    try {
      const events = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType: legacyEventType,
          availableAt: { lte: new Date() },
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - outboxLeaseMs) } },
            { status: "PUBLISHING", lockedAt: null },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const event of events) {
        await this.dispatch(event.id).catch(() => undefined);
      }
    } finally {
      this.draining = false;
    }
  }
}
