import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { LeadVirtJobData } from "../../apps/worker/src/processors/processor-registry.js";
import {
  captureDeadLetterJob,
  isFinalAttempt,
  processLeadVirtJobWithReliability,
  withWorkerJobTimeout,
  WorkerJobTimeoutError
} from "../../apps/worker/src/reliability/worker-reliability.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertTimeout() {
  try {
    await withWorkerJobTimeout(new Promise(() => undefined), 5);
    throw new Error("Expected worker timeout to reject");
  } catch (error) {
    assert(error instanceof WorkerJobTimeoutError, `Expected WorkerJobTimeoutError, got ${error instanceof Error ? error.name : String(error)}`);
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    await assertTimeout();

    const tenant = await prisma.tenant.create({
      data: {
        name: "Worker DLQ Smoke",
        slug: `worker-dlq-smoke-${suffix}`,
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const jobId = `worker-dlq-smoke:${suffix}`;
    const fakeJob = {
      id: jobId,
      name: "generate-reply",
      queueName: "ai.reply",
      data: {
        tenantId: tenant.id,
        conversationId: `missing-conversation-${suffix}`
      },
      opts: { attempts: 1 },
      attemptsMade: 1
    } as Parameters<typeof processLeadVirtJobWithReliability>[1];

    let failure: unknown;
    try {
      await processLeadVirtJobWithReliability("ai.reply", fakeJob);
    } catch (error) {
      failure = error;
    }

    assert(failure instanceof Error, "Expected invalid ai.reply job to fail");
    assert(isFinalAttempt(fakeJob), "Expected fake job to be treated as final attempt");
    await captureDeadLetterJob("ai.reply", fakeJob, failure);

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenant.id,
        action: "worker.job.dlq",
        entityId: jobId
      }
    });
    assert(audit, "DLQ audit log was not created");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        jobId,
        auditLogId: audit.id
      })
    );
  } finally {
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
