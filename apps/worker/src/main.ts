import { Queue, Worker } from "bullmq";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describeRedisEndpoint, loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { shutdownOpenTelemetry, startOpenTelemetry } from "@leadvirt/observability";
import {
  bullMqConnectionFromRedisUrl,
  RedisReadinessProbe,
  RuntimeOutboxDispatcher,
} from "@leadvirt/runtime-queue";
import { queueNames } from "./queues/queue-names.js";
import type { LeadVirtJobData } from "./processors/processor-registry.js";
import {
  captureDeadLetterJob,
  isFinalAttempt,
  processLeadVirtJobWithReliability,
  workerJobTimeoutMs,
} from "./reliability/worker-reliability.js";
import { startWorkerMetricsServer } from "./observability/metrics-server.js";
import { knowledgeIngestionSafeError } from "./knowledge/knowledge-ingestion-processor.js";

loadEnvFile();
startOpenTelemetry({
  serviceName: "leadvirt-worker",
  environment: process.env.APP_ENV ?? process.env.NODE_ENV,
});

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
const redisEndpoint = describeRedisEndpoint(redisUrl);
const enableProcessors = process.env.WORKER_ENABLE_PROCESSORS === "true";
const deploymentPaused = enableProcessors && process.env.WORKER_DEPLOYMENT_PAUSED === "true";
const activationMarkerPath =
  process.env.WORKER_ACTIVATION_MARKER_PATH ?? "/tmp/leadvirt-worker-activated";
let runtimeOutboxDispatcher: RuntimeOutboxDispatcher | undefined;
let runtimeOutboxTimer: NodeJS.Timeout | undefined;
let redisReadinessProbe: RedisReadinessProbe | undefined;
const queues: Queue[] = [];
const workers: Worker<LeadVirtJobData>[] = [];
const workerRunPromises = new Map<Worker<LeadVirtJobData>, Promise<void>>();
const workerRunFailures = new Map<Worker<LeadVirtJobData>, unknown>();
let metricsServer: ReturnType<typeof startWorkerMetricsServer>;
let shuttingDown = false;
let activationPromise: Promise<void> | undefined;
const health = {
  ready: false,
  active: false,
  processorsEnabled: enableProcessors,
  deploymentPaused,
};

async function activationMarkerExists() {
  try {
    await access(activationMarkerPath);
    return true;
  } catch {
    return false;
  }
}

async function writeActivationMarker() {
  await mkdir(dirname(activationMarkerPath), { recursive: true });
  const temporaryPath = `${activationMarkerPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, "active\n", { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, activationMarkerPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function startRuntimeOutbox() {
  if (runtimeOutboxDispatcher) return;
  const dispatcher = new RuntimeOutboxDispatcher(prisma, redisUrl, "worker.runtime-outbox.v1");
  try {
    await dispatcher.drain();
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
  runtimeOutboxDispatcher = dispatcher;
  runtimeOutboxTimer = setInterval(() => {
    void runtimeOutboxDispatcher?.drain().catch((error) => {
      console.error(
        JSON.stringify({
          status: "runtime_outbox_drain_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, 5000);
  runtimeOutboxTimer.unref();
}

function activateProcessors(persistMarker: boolean) {
  if (health.active) return Promise.resolve();
  if (activationPromise) return activationPromise;
  activationPromise = (async () => {
    if (persistMarker && deploymentPaused) await writeActivationMarker();
    await startRuntimeOutbox();
    for (const worker of workers) {
      const runPromise = worker.run();
      workerRunPromises.set(worker, runPromise);
      void runPromise.catch((error) => {
        workerRunFailures.set(worker, error);
        health.active = false;
        console.error(
          JSON.stringify({
            queue: worker.name,
            status: "worker_run_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        void shutdown(1);
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const failedWorker = workers.find((worker) => workerRunFailures.has(worker));
    if (failedWorker) {
      throw new Error(`BullMQ worker ${failedWorker.name} rejected during activation.`);
    }
    const inactiveWorker = workers.find((worker) => !worker.isRunning());
    if (inactiveWorker) {
      throw new Error(`BullMQ worker ${inactiveWorker.name} did not enter its run loop.`);
    }
    health.active = true;
    console.log("LeadVirt.ai worker processors are running.");
  })().catch((error) => {
    activationPromise = undefined;
    throw error;
  });
  return activationPromise;
}

async function bootstrap() {
  redisReadinessProbe = enableProcessors
    ? new RedisReadinessProbe(redisUrl, {
        queueName: "leadvirt-worker-readiness",
        timeoutMs: 1500,
      })
    : undefined;
  const workerRedisReadiness = redisReadinessProbe;
  metricsServer = startWorkerMetricsServer(
    () => ({ ...health }),
    enableProcessors
      ? {
          database: async () => {
            await prisma.$queryRaw`SELECT 1`;
          },
          ...(workerRedisReadiness ? { redis: () => workerRedisReadiness.check() } : {}),
        }
      : {},
  );

  console.log(
    JSON.stringify({
      service: "LeadVirt.ai worker",
      status: "starting",
      redisUrl: redisEndpoint,
      queues: queueNames,
      processorsEnabled: enableProcessors,
      deploymentPaused,
      jobTimeoutMs: workerJobTimeoutMs(),
    }),
  );

  if (!enableProcessors) {
    health.ready = true;
    console.log(
      "Worker bootstrap complete. Set WORKER_ENABLE_PROCESSORS=true with Redis running to process BullMQ jobs.",
    );
    return;
  }

  const connection = bullMqConnectionFromRedisUrl(redisUrl, { maxRetriesPerRequest: null });
  queues.push(...queueNames.map((name) => new Queue(name, { connection })));
  workers.push(
    ...queueNames.map(
      (name) =>
        new Worker<LeadVirtJobData>(name, (job) => processLeadVirtJobWithReliability(name, job), {
          connection,
          autorun: false,
        }),
    ),
  );

  for (const queue of queues) {
    await queue.waitUntilReady();
  }

  for (const worker of workers) {
    await worker.waitUntilReady();
  }

  for (const worker of workers) {
    worker.on("completed", (job) => {
      console.log(JSON.stringify({ queue: job.queueName, jobId: job.id, status: "completed" }));
    });
    worker.on("failed", (job, error) => {
      const queueName = worker.name as (typeof queueNames)[number];
      if (isFinalAttempt(job, error)) {
        void captureDeadLetterJob(queueName, job, error).catch((captureError) => {
          console.error(
            JSON.stringify({
              queue: job?.queueName ?? queueName,
              jobId:
                queueName === "knowledge.ingest" &&
                !/^knowledge-source:[a-f0-9-]{36}$/iu.test(String(job?.id ?? ""))
                  ? null
                  : job?.id,
              status: "dlq_capture_failed",
              error:
                queueName === "knowledge.ingest"
                  ? "Knowledge DLQ capture failed."
                  : captureError instanceof Error
                    ? captureError.message
                    : String(captureError),
            }),
          );
        });
        return;
      }
      console.error(
        JSON.stringify({
          queue: job?.queueName ?? queueName,
          jobId:
            queueName === "knowledge.ingest" &&
            !/^knowledge-source:[a-f0-9-]{36}$/iu.test(String(job?.id ?? ""))
              ? null
              : job?.id,
          status: "failed_retrying",
          attemptsMade: job?.attemptsMade ?? null,
          attempts: job?.opts.attempts ?? 1,
          error:
            queueName === "knowledge.ingest"
              ? knowledgeIngestionSafeError(error).message
              : error.message,
        }),
      );
    });
  }

  health.ready = true;
  if (deploymentPaused && !(await activationMarkerExists())) {
    console.log("LeadVirt.ai worker is ready and paused for deployment activation.");
    return;
  }
  await activateProcessors(false);
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (runtimeOutboxTimer) clearInterval(runtimeOutboxTimer);
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(queues.map((queue) => queue.close()));
  await runtimeOutboxDispatcher?.close();
  await redisReadinessProbe?.close();
  if (metricsServer) {
    await new Promise<void>((resolve, reject) => {
      metricsServer?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await prisma.$disconnect();
  await shutdownOpenTelemetry();
  health.ready = false;
  health.active = false;
  process.exitCode = exitCode;
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("SIGUSR2", () => {
  if (!deploymentPaused || !health.ready) return;
  void activateProcessors(true).catch((error) => {
    console.error(error);
    void shutdown(1);
  });
});

void bootstrap().catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
