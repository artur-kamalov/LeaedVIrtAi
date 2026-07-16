import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@leadvirt/db";

export const WEBHOOK_EVENT_LEASE_MS = 5 * 60_000;

export type WebhookEventStage =
  | "intakeCompletedAt"
  | "aiDispatchCompletedAt"
  | "workflowDispatchCompletedAt";

export class WebhookEventClaimLostError extends Error {
  constructor() {
    super("Webhook event processing lease was lost.");
    this.name = "WebhookEventClaimLostError";
  }
}

type WebhookEventStore = Pick<PrismaClient, "webhookEvent">;

function leaseExpiresAt(now: Date) {
  return new Date(now.getTime() + WEBHOOK_EVENT_LEASE_MS);
}

export async function claimWebhookEvent(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    provider: string;
    externalEventId: string;
    payloadHash: string;
    payload: Prisma.InputJsonValue;
    receivedAt: Date;
  },
) {
  const leaseToken = randomUUID();
  const leaseAcquiredAt = new Date(input.receivedAt);
  const nextLeaseExpiresAt = leaseExpiresAt(leaseAcquiredAt);

  return prisma.$transaction(async (tx) => {
    const lockKey = `webhook:${input.provider}:${input.externalEventId}`;
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
    `);
    const existing = await tx.webhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: input.provider,
          externalEventId: input.externalEventId,
        },
      },
    });
    if (existing) {
      if (existing.tenantId !== input.tenantId || existing.payloadHash !== input.payloadHash) {
        throw new ConflictException("Webhook event identity was reused with different input.");
      }
      const leaseExpired =
        existing.status === "RECEIVED" &&
        (!existing.leaseExpiresAt || existing.leaseExpiresAt <= leaseAcquiredAt);
      if (existing.status !== "FAILED" && !leaseExpired) {
        return {
          claimed: false as const,
          resumed: false as const,
          claimToken: null,
          event: existing,
        };
      }
      const event = await tx.webhookEvent.update({
        where: { id: existing.id },
        data: {
          status: "RECEIVED",
          errorMessage: null,
          processedAt: null,
          processingAttempt: { increment: 1 },
          leaseToken,
          leaseAcquiredAt,
          leaseExpiresAt: nextLeaseExpiresAt,
        },
      });
      return { claimed: true as const, resumed: true as const, claimToken: leaseToken, event };
    }

    const event = await tx.webhookEvent.create({
      data: {
        tenantId: input.tenantId,
        provider: input.provider,
        externalEventId: input.externalEventId,
        payloadHash: input.payloadHash,
        payload: input.payload,
        status: "RECEIVED",
        receivedAt: input.receivedAt,
        processingAttempt: 1,
        leaseToken,
        leaseAcquiredAt,
        leaseExpiresAt: nextLeaseExpiresAt,
      },
    });
    return { claimed: true as const, resumed: false as const, claimToken: leaseToken, event };
  });
}

export async function renewWebhookEventClaim(
  prisma: WebhookEventStore,
  input: { eventId: string; claimToken: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const updated = await prisma.webhookEvent.updateMany({
    where: { id: input.eventId, status: "RECEIVED", leaseToken: input.claimToken },
    data: { leaseExpiresAt: leaseExpiresAt(now) },
  });
  if (updated.count !== 1) throw new WebhookEventClaimLostError();
}

export async function completeWebhookEventStage(
  prisma: WebhookEventStore,
  input: {
    eventId: string;
    claimToken: string;
    stage: WebhookEventStage;
    completedAt?: Date;
  },
) {
  const completedAt = input.completedAt ?? new Date();
  const updated = await prisma.webhookEvent.updateMany({
    where: {
      id: input.eventId,
      status: "RECEIVED",
      leaseToken: input.claimToken,
      [input.stage]: null,
    },
    data: {
      [input.stage]: completedAt,
      leaseExpiresAt: leaseExpiresAt(completedAt),
    },
  });
  if (updated.count === 1) return;

  const event = await prisma.webhookEvent.findUnique({
    where: { id: input.eventId },
    select: {
      status: true,
      leaseToken: true,
      intakeCompletedAt: true,
      aiDispatchCompletedAt: true,
      workflowDispatchCompletedAt: true,
    },
  });
  if (
    event?.status !== "RECEIVED" ||
    event.leaseToken !== input.claimToken ||
    event[input.stage] === null
  ) {
    throw new WebhookEventClaimLostError();
  }
  await renewWebhookEventClaim(prisma, {
    eventId: input.eventId,
    claimToken: input.claimToken,
    now: completedAt,
  });
}

export async function completeWebhookEvent(
  prisma: WebhookEventStore,
  input: { eventId: string; claimToken: string; processedAt?: Date },
) {
  const processedAt = input.processedAt ?? new Date();
  const updated = await prisma.webhookEvent.updateMany({
    where: { id: input.eventId, status: "RECEIVED", leaseToken: input.claimToken },
    data: {
      status: "PROCESSED",
      errorMessage: null,
      processedAt,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
    },
  });
  if (updated.count !== 1) throw new WebhookEventClaimLostError();
}

export async function failWebhookEvent(
  prisma: WebhookEventStore,
  input: { eventId: string; claimToken: string; errorMessage: string; processedAt?: Date },
) {
  const updated = await prisma.webhookEvent.updateMany({
    where: { id: input.eventId, status: "RECEIVED", leaseToken: input.claimToken },
    data: {
      status: "FAILED",
      errorMessage: input.errorMessage,
      processedAt: input.processedAt ?? new Date(),
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
    },
  });
  return updated.count === 1;
}
