import { HttpException } from "@nestjs/common";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { canonicalKnowledgeV2Hash } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const service = new KnowledgeV2IdempotencyService(prisma);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenant = await prisma.tenant.create({
    data: { name: "Knowledge v2 idempotency smoke", slug: `kv2-idem-${stamp}` },
  });

  try {
    let effects = 0;
    const execute = () =>
      service.execute(
        {
          tenantId: tenant.id,
          endpoint: "POST /knowledge/v2/facts",
          key: `fact:${stamp}`,
          request: { factKey: "business/name", value: "LeadVirt" },
        },
        async (tx) => {
          effects += 1;
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id,
              action: "knowledge.v2.idempotency.smoke",
              entityType: "smoke",
              entityId: stamp,
            },
          });
          return { httpStatus: 201, responseBody: { id: `fact-${stamp}` } };
        },
      );

    const [first, replay] = await Promise.all([execute(), execute()]);
    assert(effects === 1, "Concurrent replay executed the mutation more than once.");
    assert(
      [first.idempotencyReplayed, replay.idempotencyReplayed].filter(Boolean).length === 1,
      "Concurrent replay flags are incorrect.",
    );
    assert(first.responseBody.id === replay.responseBody.id, "Replay response changed.");

    let changedRequestRejected = false;
    try {
      await service.execute(
        {
          tenantId: tenant.id,
          endpoint: "POST /knowledge/v2/facts",
          key: `fact:${stamp}`,
          request: { factKey: "business/name", value: "Changed" },
        },
        async () => ({ httpStatus: 201, responseBody: { id: "unexpected" } }),
      );
    } catch (error) {
      const payload = error instanceof HttpException ? error.getResponse() : null;
      changedRequestRejected =
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        typeof payload === "object" &&
        payload !== null &&
        "code" in payload &&
        payload.code === "IDEMPOTENCY_KEY_REUSED";
    }
    assert(changedRequestRejected, "Changed request reused an idempotency key.");

    let terminalEffects = 0;
    const terminalKey = `terminal:${stamp}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await service.execute(
          {
            tenantId: tenant.id,
            endpoint: "PATCH /knowledge/v2/facts/:id",
            key: terminalKey,
            request: { normalizedValue: "stale" },
          },
          async (tx) => {
            terminalEffects += 1;
            await tx.auditLog.create({
              data: { tenantId: tenant.id, action: "knowledge.v2.idempotency.terminal" },
            });
            throw new HttpException(
              {
                code: "REVISION_CONFLICT",
                message: "This resource changed after it was loaded.",
                retryable: false,
              },
              412,
            );
          },
        );
      } catch (error) {
        assert(error instanceof HttpException && error.getStatus() === 412, "Expected 412 replay.");
      }
    }
    assert(terminalEffects === 1, "Deterministic terminal error executed more than once.");
    assert(
      (await prisma.auditLog.count({
        where: { tenantId: tenant.id, action: "knowledge.v2.idempotency.terminal" },
      })) === 0,
      "Terminal mutation side effect was not rolled back.",
    );

    const failingKey = `failure:${stamp}`;
    try {
      await service.execute(
        {
          tenantId: tenant.id,
          endpoint: "PATCH /knowledge/v2/settings",
          key: failingKey,
          request: { defaultLocale: "fr" },
        },
        async (tx) => {
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id,
              action: "knowledge.v2.idempotency.should_rollback",
            },
          });
          throw new Error("expected mutation failure");
        },
      );
    } catch {}
    const [failedRecord, rolledBackAudit] = await Promise.all([
      prisma.knowledgeV2IdempotencyRecord.findUnique({
        where: {
          tenantId_endpoint_key: {
            tenantId: tenant.id,
            endpoint: "PATCH /knowledge/v2/settings",
            key: failingKey,
          },
        },
      }),
      prisma.auditLog.count({
        where: { tenantId: tenant.id, action: "knowledge.v2.idempotency.should_rollback" },
      }),
    ]);
    assert(failedRecord === null, "Failed mutation left a false idempotency claim.");
    assert(rolledBackAudit === 0, "Failed mutation side effect was not rolled back.");

    const leaseEndpoint = "POST /knowledge/v2/publications/validate";
    const leaseKey = `lease:${stamp}`;
    let preparationStarted!: () => void;
    let releasePreparation!: () => void;
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const leasedExecution = service.executePrepared(
      {
        tenantId: tenant.id,
        endpoint: leaseEndpoint,
        key: leaseKey,
        request: { candidate: "draft" },
      },
      async () => {
        preparationStarted();
        await release;
        return { prepared: true };
      },
      async (_tx, prepared) => ({ httpStatus: 200, responseBody: prepared }),
    );
    await started;
    const liveClaim = await prisma.knowledgeV2IdempotencyRecord.findUniqueOrThrow({
      where: {
        tenantId_endpoint_key: {
          tenantId: tenant.id,
          endpoint: leaseEndpoint,
          key: leaseKey,
        },
      },
    });
    const remainingLeaseMs = liveClaim.expiresAt.getTime() - Date.now();
    assert(liveClaim.status === "IN_PROGRESS", "Preparation claim was not live.");
    assert(
      remainingLeaseMs > 30_000 && remainingLeaseMs < 5 * 60_000,
      "Preparation claim used response retention instead of a bounded lease.",
    );
    releasePreparation();
    await leasedExecution;

    const staleEndpoint = "PATCH /knowledge/v2/settings/stale-claim";
    const staleKey = `stale:${stamp}`;
    const staleRequest = { defaultLocale: "en" };
    const staleCreatedAt = new Date(Date.now() - 10 * 60_000);
    const staleRecord = await prisma.knowledgeV2IdempotencyRecord.create({
      data: {
        tenantId: tenant.id,
        endpoint: staleEndpoint,
        key: staleKey,
        requestHash: canonicalKnowledgeV2Hash({
          version: 1,
          endpoint: staleEndpoint,
          request: staleRequest,
        }),
        status: "IN_PROGRESS",
        expiresAt: new Date(Date.now() - 1_000),
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      },
    });
    let takeoverEffects = 0;
    const takeover = await service.execute(
      {
        tenantId: tenant.id,
        endpoint: staleEndpoint,
        key: staleKey,
        request: staleRequest,
      },
      async () => {
        takeoverEffects += 1;
        return { httpStatus: 200, responseBody: { defaultLocale: "en" } };
      },
    );
    const takeoverRecord = await prisma.knowledgeV2IdempotencyRecord.findUniqueOrThrow({
      where: {
        tenantId_endpoint_key: {
          tenantId: tenant.id,
          endpoint: staleEndpoint,
          key: staleKey,
        },
      },
    });
    assert(takeoverEffects === 1, "Stale claim takeover did not execute exactly once.");
    assert(takeoverRecord.id !== staleRecord.id, "Stale claim was not replaced.");
    assert(takeoverRecord.status === "SUCCEEDED", "Stale claim takeover did not complete.");
    assert(!takeover.idempotencyReplayed, "Stale claim takeover was reported as a replay.");

    console.log(
      JSON.stringify({
        ok: true,
        concurrentMutationCount: effects,
        changedRequestRejected,
        terminalErrorReplayed: terminalEffects === 1,
        failedMutationRolledBack: true,
        boundedPreparationLease: true,
        staleClaimTakenOver: true,
      }),
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
