import type { Job } from "bullmq";
import { prisma } from "@leadvirt/db";
import { SpanKind, withSpan } from "@leadvirt/observability";
import type { LeadVirtQueueName } from "../queues/queue-names.js";
import { recordDeadLetterJob, recordWorkerJob } from "../observability/metrics.js";
import { processLeadVirtJob, type LeadVirtJobData } from "../processors/processor-registry.js";

export class WorkerJobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Worker job timed out after ${timeoutMs}ms`);
    this.name = "WorkerJobTimeoutError";
  }
}

export function workerJobTimeoutMs() {
  const value = Number(process.env.WORKER_JOB_TIMEOUT_MS ?? "30000");
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function stringDataField(data: LeadVirtJobData | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeDataSummary(data: LeadVirtJobData | undefined) {
  if (!data) return {};
  return {
    tenantId: stringDataField(data, "tenantId") ?? null,
    conversationId: stringDataField(data, "conversationId") ?? null,
    messageId: stringDataField(data, "messageId") ?? null,
    leadId: stringDataField(data, "leadId") ?? null,
    triggerMessageId: stringDataField(data, "triggerMessageId") ?? null,
    source: stringDataField(data, "source") ?? null
  };
}

export function withWorkerJobTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new WorkerJobTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function isFinalAttempt(job: Pick<Job<LeadVirtJobData>, "attemptsMade" | "opts"> | undefined) {
  if (!job) return true;
  const attempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
  return job.attemptsMade >= attempts;
}

export async function processLeadVirtJobWithReliability(queueName: LeadVirtQueueName, job: Job<LeadVirtJobData>) {
  const startedAt = Date.now();
  return withSpan(`worker.job ${queueName}`, {
    kind: SpanKind.CONSUMER,
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination.name": queueName,
      "messaging.message.id": job.id ?? "unknown",
      "leadvirt.queue": queueName
    }
  }, async (span) => {
    try {
      const result = await withWorkerJobTimeout(Promise.resolve(processLeadVirtJob(queueName, job)), workerJobTimeoutMs());
      recordWorkerJob({ queue: queueName, status: "completed", durationMs: Date.now() - startedAt });
      span.setAttribute("leadvirt.worker.status", "completed");
      return result;
    } catch (error) {
      const status = error instanceof WorkerJobTimeoutError ? "timeout" : "failed";
      recordWorkerJob({
        queue: queueName,
        status,
        durationMs: Date.now() - startedAt
      });
      span.setAttribute("leadvirt.worker.status", status);
      throw error;
    }
  });
}

export async function captureDeadLetterJob(queueName: LeadVirtQueueName, job: Job<LeadVirtJobData> | undefined, error: unknown) {
  const attempts = typeof job?.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
  const payload = {
    queueName,
    jobName: job?.name ?? null,
    jobId: job?.id ?? null,
    attemptsMade: job?.attemptsMade ?? null,
    attempts,
    failedReason: errorMessage(error),
    data: safeDataSummary(job?.data)
  };

  console.error(JSON.stringify({ status: "dlq", ...payload }));
  recordDeadLetterJob(queueName);

  const tenantId = stringDataField(job?.data, "tenantId");
  if (!tenantId) return;

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: "worker.job.dlq",
      entityType: queueName,
      entityId: job?.id ?? null,
      payload
    }
  });
}
