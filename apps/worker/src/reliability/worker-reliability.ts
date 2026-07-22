import { UnrecoverableError, type Job } from "bullmq";
import { prisma, type Prisma } from "@leadvirt/db";
import { parseRuntimeQueueEnvelope, runtimeQueueEnvelopeSignature } from "@leadvirt/runtime-queue";
import { randomUUID } from "node:crypto";
import { SpanKind, withSpan } from "@leadvirt/observability";
import type { LeadVirtQueueName } from "../queues/queue-names.js";
import { recordDeadLetterJob, recordWorkerJob } from "../observability/metrics.js";
import { knowledgeIngestionSafeError } from "../knowledge/knowledge-ingestion-processor.js";
import { processLeadVirtJob, type LeadVirtJobData } from "../processors/processor-registry.js";

export class WorkerJobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Worker job timed out after ${timeoutMs}ms`);
    this.name = "WorkerJobTimeoutError";
  }
}

export function workerJobTimeoutMs(queueName?: LeadVirtQueueName) {
  const value = Number(process.env.WORKER_JOB_TIMEOUT_MS ?? "30000");
  const base = Number.isFinite(value) && value > 0 ? value : 30000;
  if (queueName !== "business.import") return base;
  const parserTimeout = Number(process.env.BUSINESS_IMPORT_PARSER_TIMEOUT_MS ?? "300000");
  const boundedParserTimeout =
    Number.isFinite(parserTimeout) && parserTimeout >= 1_000
      ? Math.min(parserTimeout, 600_000)
      : 300_000;
  return Math.max(base, boundedParserTimeout + 60_000);
}

function stringDataField(data: LeadVirtJobData | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function runtimeEvent(data: LeadVirtJobData | undefined) {
  const eventId = stringDataField(data, "runtimeEventId");
  const generation = data?.runtimeGeneration;
  const tenantId = stringDataField(data, "tenantId");
  if (
    !eventId ||
    !tenantId ||
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 1
  )
    return null;
  return { eventId, generation, tenantId };
}

function persistedJobData(data: LeadVirtJobData) {
  const copy = { ...data };
  delete copy.runtimeEventId;
  delete copy.runtimeGeneration;
  return copy;
}

function jsonResult(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return { value: null };
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function claimRuntimeInbox(queueName: LeadVirtQueueName, job: Job<LeadVirtJobData>) {
  const runtime = runtimeEvent(job.data);
  if (!runtime) return { status: "untracked" as const };
  const consumerName = `worker.${queueName}.${job.name}.v1`;
  const now = new Date();
  const lockId = `${consumerName}:${randomUUID()}`;
  const lockExpiresAt = new Date(now.getTime() + workerJobTimeoutMs(queueName) + 5000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const event = await tx.runtimeOutbox.findFirst({
            where: {
              id: runtime.eventId,
              tenantId: runtime.tenantId,
              generation: runtime.generation,
            },
            select: { id: true, status: true, deadlineAt: true, payload: true },
          });
          if (!event) throw new Error("Runtime outbox event is not valid for this job.");
          const envelope = parseRuntimeQueueEnvelope(event.payload);
          const actualEnvelope = {
            ...envelope,
            queueName: envelope.queueName,
            jobName: job.name,
            jobId: String(job.id ?? ""),
            data: persistedJobData(job.data),
          };
          if (
            queueName !== envelope.queueName ||
            job.name !== envelope.jobName ||
            String(job.id ?? "") !== envelope.jobId ||
            runtimeQueueEnvelopeSignature(actualEnvelope) !==
              runtimeQueueEnvelopeSignature(envelope)
          ) {
            throw new Error("Runtime outbox event does not authorize this queue job.");
          }
          if (!["PUBLISHED", "PUBLISHING", "FAILED"].includes(event.status)) {
            return { status: "outbox_pending" as const, eventStatus: event.status };
          }
          if (event.deadlineAt && event.deadlineAt <= now) {
            if (envelope.queueName === "ai.reply") {
              const inboundMessageId = envelope.data.triggerMessageId;
              if (typeof inboundMessageId === "string") {
                await tx.aiReplyRun.updateMany({
                  where: {
                    tenantId: runtime.tenantId,
                    inboundMessageId,
                    status: {
                      in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"],
                    },
                  },
                  data: {
                    status: "DEAD_LETTER",
                    errorCode: "RUNTIME_EVENT_EXPIRED",
                    errorMessage: "Runtime event expired before worker execution.",
                    completedAt: now,
                  },
                });
              }
            } else if (envelope.queueName === "business.import") {
              const importId = envelope.data.importId;
              const generation = envelope.data.generation;
              if (
                typeof importId === "string" &&
                typeof generation === "number" &&
                Number.isInteger(generation)
              ) {
                if (envelope.jobName === "project") {
                  const applicationId = envelope.data.applicationId;
                  const businessRevisionId = envelope.data.businessRevisionId;
                  const businessRevision = envelope.data.businessRevision;
                  if (
                    typeof applicationId === "string" &&
                    typeof businessRevisionId === "string" &&
                    typeof businessRevision === "number" &&
                    Number.isInteger(businessRevision)
                  ) {
                    const delayed = await tx.businessImportApplication.updateMany({
                      where: {
                        id: applicationId,
                        tenantId: runtime.tenantId,
                        importId,
                        businessRevisionId,
                        resultingInformationRevision: businessRevision,
                        projectionOutboxId: runtime.eventId,
                        projectionOutboxDedupeKey: envelope.jobId,
                        projectionReceiptHash: null,
                        state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
                      },
                      data: { state: "PROJECTION_DELAYED" },
                    });
                    if (delayed.count === 1) {
                      await tx.businessImport.updateMany({
                        where: {
                          id: importId,
                          tenantId: runtime.tenantId,
                          generation,
                          state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
                        },
                        data: {
                          state: "PROJECTION_DELAYED",
                          failureCode: "BUSINESS_INFORMATION_PROJECTION_RUNTIME_EVENT_EXPIRED",
                          failureStage: "PROJECTION",
                          retryable: false,
                          etag: { increment: 1 },
                        },
                      });
                    }
                  }
                } else {
                  await tx.businessImport.updateMany({
                    where: {
                      id: importId,
                      tenantId: runtime.tenantId,
                      generation,
                      state: { in: ["UPLOADED", "SCANNING", "PARSING", "EXTRACTING"] },
                    },
                    data: {
                      state: "FAILED_RETRYABLE",
                      failureCode: "BUSINESS_IMPORT_RUNTIME_EVENT_EXPIRED",
                      failureStage: "QUEUE",
                      retryable: true,
                      etag: { increment: 1 },
                    },
                  });
                }
              }
            } else if (envelope.queueName === "knowledge.ingest") {
              const knowledgeJobId = envelope.data.knowledgeJobId;
              const sourceId = envelope.data.sourceId;
              const operation = envelope.data.operation;
              const sourceGeneration = envelope.data.generation;
              if (typeof knowledgeJobId === "string") {
                await tx.knowledgeJob.updateMany({
                  where: {
                    id: knowledgeJobId,
                    tenantId: runtime.tenantId,
                    status: { notIn: ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"] },
                  },
                  data: {
                    status: "DEAD_LETTER",
                    errorCode: "KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_EXPIRED",
                    errorMessage: "The knowledge source event expired before processing.",
                    completedAt: now,
                  },
                });
              }
              if (
                typeof sourceId === "string" &&
                typeof sourceGeneration === "number" &&
                Number.isInteger(sourceGeneration)
              ) {
                await tx.knowledgeV2Source.updateMany({
                  where: {
                    id: sourceId,
                    tenantId: runtime.tenantId,
                    generation: sourceGeneration,
                    status: { notIn: ["DELETED", "DISCONNECTED"] },
                  },
                  data: {
                    ...(operation === "DELETE" ? {} : { status: "FAILED" as const }),
                    lastErrorCode: "KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_EXPIRED",
                    lastErrorAt: now,
                    etag: { increment: 1 },
                  },
                });
              }
            } else {
              const messageId = envelope.data.messageId;
              if (typeof messageId === "string") {
                await tx.message.updateMany({
                  where: { id: messageId, tenantId: runtime.tenantId, status: "QUEUED" },
                  data: { status: "FAILED" },
                });
              }
            }
            return { status: "expired" as const };
          }

          const existing = await tx.runtimeInbox.findUnique({
            where: { consumerName_eventId: { consumerName, eventId: runtime.eventId } },
          });
          if (existing?.status === "SUCCEEDED") {
            return { status: "replayed" as const, result: existing.result };
          }
          if (
            existing?.status === "PROCESSING" &&
            existing.lockExpiresAt &&
            existing.lockExpiresAt > now
          ) {
            return { status: "busy" as const, lockExpiresAt: existing.lockExpiresAt };
          }
          if (existing) {
            await tx.runtimeInbox.update({
              where: { id: existing.id },
              data: {
                generation: runtime.generation,
                status: "PROCESSING",
                attemptCount: { increment: 1 },
                startedAt: now,
                heartbeatAt: now,
                lockedBy: lockId,
                lockExpiresAt,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
              },
            });
          } else {
            await tx.runtimeInbox.create({
              data: {
                tenantId: runtime.tenantId,
                consumerName,
                eventId: runtime.eventId,
                generation: runtime.generation,
                status: "PROCESSING",
                heartbeatAt: now,
                lockedBy: lockId,
                lockExpiresAt,
              },
            });
          }
          return { status: "claimed" as const, eventId: runtime.eventId, consumerName, lockId };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        attempt < 2 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Runtime inbox claim failed.");
}

async function waitForRuntimeInbox(
  queueName: LeadVirtQueueName,
  consumerName: string,
  eventId: string,
  lockExpiresAt: Date,
) {
  const deadline = Math.min(
    lockExpiresAt.getTime() + 1000,
    Date.now() + workerJobTimeoutMs(queueName) + 10_000,
  );
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const existing = await prisma.runtimeInbox.findUnique({
      where: { consumerName_eventId: { consumerName, eventId } },
    });
    if (existing?.status === "SUCCEEDED")
      return { status: "replayed" as const, result: existing.result };
    if (
      !existing ||
      existing.status !== "PROCESSING" ||
      !existing.lockExpiresAt ||
      existing.lockExpiresAt <= new Date()
    ) {
      return { status: "retry" as const };
    }
  }
  return { status: "busy" as const };
}

async function completeRuntimeInbox(
  claim: { eventId: string; consumerName: string; lockId: string },
  result: unknown,
) {
  const updated = await prisma.runtimeInbox.updateMany({
    where: {
      consumerName: claim.consumerName,
      eventId: claim.eventId,
      status: "PROCESSING",
      lockedBy: claim.lockId,
    },
    data: {
      status: "SUCCEEDED",
      result: jsonResult(result),
      heartbeatAt: new Date(),
      completedAt: new Date(),
      lockedBy: null,
      lockExpiresAt: null,
      errorCode: null,
      errorMessage: null,
    },
  });
  if (updated.count !== 1) throw new Error("Runtime inbox lease was lost before completion.");
}

async function failRuntimeInbox(
  claim: { eventId: string; consumerName: string; lockId: string },
  error: unknown,
) {
  await prisma.runtimeInbox
    .updateMany({
      where: {
        consumerName: claim.consumerName,
        eventId: claim.eventId,
        status: "PROCESSING",
        lockedBy: claim.lockId,
      },
      data: {
        status: "FAILED",
        heartbeatAt: new Date(),
        completedAt: new Date(),
        lockedBy: null,
        lockExpiresAt: null,
        errorCode: error instanceof Error ? error.name : "RUNTIME_CONSUMER_FAILED",
        errorMessage: errorMessage(error).slice(0, 500),
      },
    })
    .catch(() => undefined);
}

function safeKnowledgeId(value: string | undefined, kind: "cuid" | "uuid" | "job") {
  if (!value) return null;
  if (kind === "cuid") return /^c[a-z0-9]{20,30}$/u.test(value) ? value : null;
  if (kind === "uuid")
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
      ? value
      : null;
  return /^knowledge-source:[a-f0-9-]{36}$/iu.test(value) ? value : null;
}

function safeDataSummary(data: LeadVirtJobData | undefined, queueName: LeadVirtQueueName) {
  if (!data) return {};
  if (queueName === "knowledge.ingest") {
    const operation = stringDataField(data, "operation");
    return {
      tenantId: safeKnowledgeId(stringDataField(data, "tenantId"), "cuid"),
      sourceId: safeKnowledgeId(stringDataField(data, "sourceId"), "cuid"),
      knowledgeJobId: safeKnowledgeId(stringDataField(data, "knowledgeJobId"), "uuid"),
      operation: ["IMPORT", "SYNC", "RECONCILE", "DELETE"].includes(operation ?? "")
        ? operation
        : null,
      generation:
        typeof data.generation === "number" &&
        Number.isInteger(data.generation) &&
        data.generation > 0
          ? data.generation
          : null,
    };
  }
  if (queueName === "business.import") {
    return {
      tenantId: stringDataField(data, "tenantId") ?? null,
      sourceId: stringDataField(data, "sourceId") ?? null,
      importId: stringDataField(data, "importId") ?? null,
      applicationId: stringDataField(data, "applicationId") ?? null,
      businessRevisionId: stringDataField(data, "businessRevisionId") ?? null,
      businessRevision:
        typeof data.businessRevision === "number" && Number.isInteger(data.businessRevision)
          ? data.businessRevision
          : null,
      operation: stringDataField(data, "operation") ?? null,
      generation:
        typeof data.generation === "number" && Number.isInteger(data.generation)
          ? data.generation
          : null,
      runtimeEventId: stringDataField(data, "runtimeEventId") ?? null,
    };
  }
  return {
    tenantId: stringDataField(data, "tenantId") ?? null,
    conversationId: stringDataField(data, "conversationId") ?? null,
    messageId: stringDataField(data, "messageId") ?? null,
    leadId: stringDataField(data, "leadId") ?? null,
    triggerMessageId: stringDataField(data, "triggerMessageId") ?? null,
    source: stringDataField(data, "source") ?? null,
    sourceId: stringDataField(data, "sourceId") ?? null,
    knowledgeJobId: stringDataField(data, "knowledgeJobId") ?? null,
    operation: stringDataField(data, "operation") ?? null,
    generation:
      typeof data?.generation === "number" && Number.isInteger(data.generation)
        ? data.generation
        : null,
  };
}

export function withWorkerJobTimeout<T>(
  work: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
  onTimeout?: (error: WorkerJobTimeoutError) => void | Promise<void>,
): Promise<T> {
  const controller = new AbortController();
  const promise = typeof work === "function" ? work(controller.signal) : work;
  let timeout: NodeJS.Timeout | undefined;
  let timeoutError: WorkerJobTimeoutError | undefined;
  let timeoutFence: Promise<void> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new WorkerJobTimeoutError(timeoutMs);
      timeoutError = error;
      controller.abort(error);
      timeoutFence = Promise.resolve(onTimeout?.(error))
        .catch(() => undefined)
        .then(() => reject(error));
    }, timeoutMs);
  });

  const guardedPromise = promise.then(
    async (value) => {
      if (timeoutError) {
        await timeoutFence;
        throw timeoutError;
      }
      return value;
    },
    async (error: unknown) => {
      if (timeoutError) {
        await timeoutFence;
        throw timeoutError;
      }
      throw error;
    },
  );

  return Promise.race([guardedPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function fenceTimedOutKnowledgeJob(job: Job<LeadVirtJobData>) {
  const tenantId = stringDataField(job.data, "tenantId");
  const sourceId = stringDataField(job.data, "sourceId");
  const knowledgeJobId = stringDataField(job.data, "knowledgeJobId");
  const operation = stringDataField(job.data, "operation");
  const generation = job.data.generation;
  if (
    !tenantId ||
    !sourceId ||
    !knowledgeJobId ||
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 1
  ) {
    return;
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeJobAttempt.updateMany({
      where: { tenantId, jobId: knowledgeJobId, status: "RUNNING" },
      data: {
        status: "TIMED_OUT",
        errorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
        errorMessage: "Knowledge ingestion was interrupted.",
        heartbeatAt: now,
        completedAt: now,
      },
    });
    const fenced = await tx.knowledgeJob.updateMany({
      where: {
        id: knowledgeJobId,
        tenantId,
        generation,
        status: "RUNNING",
      },
      data: {
        status: "RETRY_SCHEDULED",
        availableAt: new Date(now.getTime() + 2_000),
        errorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
        errorMessage: "Knowledge ingestion was interrupted.",
        heartbeatAt: now,
        completedAt: null,
      },
    });
    if (fenced.count === 1) {
      await tx.knowledgeV2Source.updateMany({
        where: { id: sourceId, tenantId, generation },
        data: {
          ...(operation === "DELETE" ? {} : { status: "SYNCING" as const }),
          lastErrorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
          lastErrorAt: now,
          etag: { increment: 1 },
        },
      });
    }
  });
}

async function fenceTimedOutBusinessImportJob(job: Job<LeadVirtJobData>) {
  const tenantId = stringDataField(job.data, "tenantId");
  if (job.name === "project-revision") return;
  const importId = stringDataField(job.data, "importId");
  const sourceId = stringDataField(job.data, "sourceId");
  const generation = job.data.generation;
  if (
    !tenantId ||
    !importId ||
    !sourceId ||
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 1
  )
    return;
  if (job.name === "project") {
    const applicationId = stringDataField(job.data, "applicationId");
    const businessRevisionId = stringDataField(job.data, "businessRevisionId");
    const runtimeEventId = stringDataField(job.data, "runtimeEventId");
    const businessRevision = job.data.businessRevision;
    if (
      !applicationId ||
      !businessRevisionId ||
      !runtimeEventId ||
      typeof businessRevision !== "number" ||
      !Number.isInteger(businessRevision) ||
      businessRevision < 1
    )
      return;
    await prisma.$transaction(async (tx) => {
      const delayed = await tx.businessImportApplication.updateMany({
        where: {
          id: applicationId,
          tenantId,
          sourceId,
          importId,
          businessRevisionId,
          resultingInformationRevision: businessRevision,
          projectionOutboxId: runtimeEventId,
          projectionOutboxDedupeKey: `business-import-project:${applicationId}:${businessRevision}`,
          projectionReceiptHash: null,
          state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
        },
        data: { state: "PROJECTION_DELAYED" },
      });
      if (delayed.count !== 1) return;
      await tx.businessImport.updateMany({
        where: {
          id: importId,
          tenantId,
          sourceId,
          generation,
          state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
        },
        data: {
          state: "PROJECTION_DELAYED",
          failureCode: "BUSINESS_INFORMATION_PROJECTION_INTERRUPTED",
          failureStage: "PROJECTION",
          retryable: false,
          etag: { increment: 1 },
        },
      });
    });
    return;
  }
  await prisma.businessImport.updateMany({
    where: {
      id: importId,
      tenantId,
      sourceId,
      generation,
      state: { in: ["SCANNING", "PARSING", "EXTRACTING"] },
    },
    data: {
      state: "FAILED_RETRYABLE",
      failureCode: "BUSINESS_IMPORT_PROCESSING_INTERRUPTED",
      failureStage: "PROCESSING",
      retryable: true,
      etag: { increment: 1 },
    },
  });
}

export function isFinalAttempt(
  job: Pick<Job<LeadVirtJobData>, "attemptsMade" | "opts"> | undefined,
  error?: unknown,
) {
  if (
    error instanceof UnrecoverableError ||
    (error instanceof Error && error.name === "UnrecoverableError")
  ) {
    return true;
  }
  if (!job) return true;
  const attempts =
    typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
  return job.attemptsMade >= attempts;
}

export async function processLeadVirtJobWithReliability(
  queueName: LeadVirtQueueName,
  job: Job<LeadVirtJobData>,
  processor: typeof processLeadVirtJob = processLeadVirtJob,
) {
  const startedAt = Date.now();
  return withSpan(
    `worker.job ${queueName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "bullmq",
        "messaging.destination.name": queueName,
        "messaging.message.id":
          queueName === "knowledge.ingest"
            ? (safeKnowledgeId(typeof job.id === "string" ? job.id : undefined, "job") ?? "invalid")
            : (job.id ?? "unknown"),
        "leadvirt.queue": queueName,
      },
    },
    async (span) => {
      let inbox = await claimRuntimeInbox(queueName, job);
      if (
        (queueName === "ai.reply" || queueName === "channels.sendMessage") &&
        inbox.status === "untracked"
      ) {
        throw new UnrecoverableError(`${queueName} job is not backed by RuntimeOutbox.`);
      }
      for (let attempt = 0; inbox.status === "outbox_pending" && attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        inbox = await claimRuntimeInbox(queueName, job);
      }
      if (inbox.status === "outbox_pending") {
        throw new Error(
          `Runtime outbox event is ${inbox.eventStatus.toLowerCase()}, not published.`,
        );
      }
      if (inbox.status === "expired") {
        const expired = new UnrecoverableError("Runtime event expired before worker execution.");
        if (queueName === "knowledge.ingest") {
          Object.defineProperty(expired, "knowledgeCode", {
            value: "KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_EXPIRED",
          });
          Object.defineProperty(expired, "knowledgeStage", { value: "ACQUIRING" });
        }
        throw expired;
      }
      if (inbox.status === "replayed") return inbox.result;
      if (inbox.status === "busy") {
        const waited = await waitForRuntimeInbox(
          queueName,
          `worker.${queueName}.${job.name}.v1`,
          runtimeEvent(job.data)?.eventId ?? "",
          inbox.lockExpiresAt,
        );
        if (waited.status === "replayed") return waited.result;
        if (waited.status === "retry") inbox = await claimRuntimeInbox(queueName, job);
        if (waited.status === "busy" || inbox.status === "busy") {
          throw new Error("Runtime event is still being processed by an active consumer.");
        }
      }
      try {
        const result = await withWorkerJobTimeout(
          (signal) => Promise.resolve(processor(queueName, job, signal)),
          workerJobTimeoutMs(queueName),
          queueName === "knowledge.ingest"
            ? () => fenceTimedOutKnowledgeJob(job)
            : queueName === "business.import"
              ? () => fenceTimedOutBusinessImportJob(job)
              : undefined,
        );
        recordWorkerJob({
          queue: queueName,
          status: "completed",
          durationMs: Date.now() - startedAt,
        });
        span.setAttribute("leadvirt.worker.status", "completed");
        if (inbox.status === "claimed") await completeRuntimeInbox(inbox, result);
        return result;
      } catch (error) {
        const status = error instanceof WorkerJobTimeoutError ? "timeout" : "failed";
        recordWorkerJob({
          queue: queueName,
          status,
          durationMs: Date.now() - startedAt,
        });
        span.setAttribute("leadvirt.worker.status", status);
        if (inbox.status === "claimed") await failRuntimeInbox(inbox, error);
        throw error;
      }
    },
  );
}

export async function captureDeadLetterJob(
  queueName: LeadVirtQueueName,
  job: Job<LeadVirtJobData> | undefined,
  error: unknown,
) {
  const attempts =
    typeof job?.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
  const knowledgeError =
    queueName === "knowledge.ingest" ? knowledgeIngestionSafeError(error) : null;
  const safeKnowledgeJobId =
    queueName === "knowledge.ingest"
      ? safeKnowledgeId(typeof job?.id === "string" ? job.id : undefined, "job")
      : (job?.id ?? null);
  const safeKnowledgeJobName =
    queueName === "knowledge.ingest" &&
    !["import", "sync", "reconcile", "delete"].includes(job?.name ?? "")
      ? "invalid"
      : (job?.name ?? null);
  const payload = {
    queueName,
    jobName: safeKnowledgeJobName,
    jobId: safeKnowledgeJobId,
    attemptsMade: job?.attemptsMade ?? null,
    attempts,
    failedReason: knowledgeError?.message ?? errorMessage(error),
    data: safeDataSummary(job?.data, queueName),
  };

  console.error(JSON.stringify({ status: "dlq", ...payload }));
  recordDeadLetterJob(queueName);

  const tenantId = stringDataField(job?.data, "tenantId");
  if (!tenantId) return;

  if (queueName === "knowledge.ingest") {
    const knowledgeJobId = stringDataField(job?.data, "knowledgeJobId");
    const sourceId = stringDataField(job?.data, "sourceId");
    const operation = stringDataField(job?.data, "operation");
    const generation = job?.data.generation;
    const now = new Date();
    if (knowledgeJobId) {
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeJob.updateMany({
          where: {
            id: knowledgeJobId,
            tenantId,
            status: { notIn: ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"] },
          },
          data: {
            status: "DEAD_LETTER",
            errorCode: knowledgeError?.code ?? "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
            errorMessage: knowledgeError?.message ?? "Knowledge ingestion could not be completed.",
            heartbeatAt: now,
            completedAt: now,
          },
        });
        await tx.knowledgeJobAttempt.updateMany({
          where: { tenantId, jobId: knowledgeJobId, status: "RUNNING" },
          data: {
            status: "FAILED",
            errorCode: knowledgeError?.code ?? "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
            errorMessage: knowledgeError?.message ?? "Knowledge ingestion could not be completed.",
            heartbeatAt: now,
            completedAt: now,
          },
        });
        if (sourceId && typeof generation === "number" && Number.isInteger(generation)) {
          await tx.knowledgeV2Source.updateMany({
            where: {
              id: sourceId,
              tenantId,
              generation,
              status: { notIn: ["DELETED", "DISCONNECTED"] },
            },
            data: {
              ...(operation === "DELETE" ? {} : { status: "FAILED" as const }),
              lastErrorCode: knowledgeError?.code ?? "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
              lastErrorAt: now,
              etag: { increment: 1 },
            },
          });
        }
      });
    }
  }

  if (queueName === "business.import" && job?.name === "project") {
    const importId = stringDataField(job.data, "importId");
    const sourceId = stringDataField(job.data, "sourceId");
    const applicationId = stringDataField(job.data, "applicationId");
    const businessRevisionId = stringDataField(job.data, "businessRevisionId");
    const runtimeEventId = stringDataField(job.data, "runtimeEventId");
    const businessRevision = job.data.businessRevision;
    const generation = job.data.generation;
    if (
      importId &&
      sourceId &&
      applicationId &&
      businessRevisionId &&
      runtimeEventId &&
      typeof businessRevision === "number" &&
      Number.isInteger(businessRevision) &&
      typeof generation === "number" &&
      Number.isInteger(generation)
    ) {
      await prisma.$transaction(async (tx) => {
        const delayed = await tx.businessImportApplication.updateMany({
          where: {
            id: applicationId,
            tenantId,
            sourceId,
            importId,
            businessRevisionId,
            resultingInformationRevision: businessRevision,
            projectionOutboxId: runtimeEventId,
            projectionOutboxDedupeKey: `business-import-project:${applicationId}:${businessRevision}`,
            projectionReceiptHash: null,
            state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
          },
          data: { state: "PROJECTION_DELAYED" },
        });
        if (delayed.count !== 1) return;
        await tx.businessImport.updateMany({
          where: {
            id: importId,
            tenantId,
            sourceId,
            generation,
            state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
          },
          data: {
            state: "PROJECTION_DELAYED",
            failureCode: "BUSINESS_INFORMATION_PROJECTION_DEAD_LETTER",
            failureStage: "PROJECTION",
            retryable: false,
            etag: { increment: 1 },
          },
        });
      });
    }
  }

  if (queueName === "business.import" && job?.name === "project-revision") {
    const businessRevisionId = stringDataField(job.data, "businessRevisionId");
    const runtimeEventId = stringDataField(job.data, "runtimeEventId");
    const businessRevision = job.data.businessRevision;
    if (
      businessRevisionId &&
      runtimeEventId &&
      typeof businessRevision === "number" &&
      Number.isInteger(businessRevision)
    ) {
      const state = await prisma.businessInformationState.findUnique({ where: { tenantId } });
      await prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "business_information.projection_delayed",
          entityType: "BusinessInformationRevision",
          entityId: businessRevisionId,
          payload: {
            businessRevisionId,
            businessRevision,
            runtimeEventId,
            failureCode: "BUSINESS_INFORMATION_PROJECTION_DEAD_LETTER",
            currentRevisionId: state?.currentRevisionId ?? null,
            currentRevision: state?.revision ?? null,
            lastProjectedRevisionId: state?.lastProjectedRevisionId ?? null,
            lastProjectedRevision: state?.lastProjectedRevision ?? null,
            receiptCreated: false,
            publicationChanged: false,
          },
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: "worker.job.dlq",
      entityType: queueName,
      entityId: safeKnowledgeJobId,
      payload,
    },
  });
}
