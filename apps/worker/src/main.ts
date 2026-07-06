import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { shutdownOpenTelemetry, startOpenTelemetry } from "@leadvirt/observability";
import { queueNames } from "./queues/queue-names.js";
import type { LeadVirtJobData } from "./processors/processor-registry.js";
import { captureDeadLetterJob, isFinalAttempt, processLeadVirtJobWithReliability, workerJobTimeoutMs } from "./reliability/worker-reliability.js";
import { startWorkerMetricsServer } from "./observability/metrics-server.js";

loadEnvFile();
startOpenTelemetry({
  serviceName: "leadvirt-worker",
  environment: process.env.APP_ENV ?? process.env.NODE_ENV
});

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
const enableProcessors = process.env.WORKER_ENABLE_PROCESSORS === "true";

function createConnectionOptions(): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6380),
    maxRetriesPerRequest: null
  };

  if (parsed.username) {
    connection.username = decodeURIComponent(parsed.username);
  }

  if (parsed.password) {
    connection.password = decodeURIComponent(parsed.password);
  }

  return connection;
}

async function bootstrap() {
  startWorkerMetricsServer();

  console.log(
    JSON.stringify({
      service: "LeadVirt.ai worker",
      status: "starting",
      redisUrl,
      queues: queueNames,
      processorsEnabled: enableProcessors,
      jobTimeoutMs: workerJobTimeoutMs()
    }),
  );

  if (!enableProcessors) {
    console.log(
      "Worker bootstrap complete. Set WORKER_ENABLE_PROCESSORS=true with Redis running to process BullMQ jobs.",
    );
    return;
  }

  const connection = createConnectionOptions();
  const queues = queueNames.map((name) => new Queue(name, { connection }));
  const workers = queueNames.map(
    (name) =>
      new Worker<LeadVirtJobData>(
        name,
        (job) => processLeadVirtJobWithReliability(name, job),
        { connection },
      ),
  );

  for (const queue of queues) {
    await queue.waitUntilReady();
  }

  for (const worker of workers) {
    worker.on("completed", (job) => {
      console.log(JSON.stringify({ queue: job.queueName, jobId: job.id, status: "completed" }));
    });
    worker.on("failed", (job, error) => {
      const queueName = worker.name as (typeof queueNames)[number];
      if (isFinalAttempt(job)) {
        void captureDeadLetterJob(queueName, job, error).catch((captureError) => {
          console.error(
            JSON.stringify({
              queue: job?.queueName ?? queueName,
              jobId: job?.id,
              status: "dlq_capture_failed",
              error: captureError instanceof Error ? captureError.message : String(captureError)
            })
          );
        });
        return;
      }
      console.error(
        JSON.stringify({
          queue: job?.queueName ?? queueName,
          jobId: job?.id,
          status: "failed_retrying",
          attemptsMade: job?.attemptsMade ?? null,
          attempts: job?.opts.attempts ?? 1,
          error: error.message
        })
      );
    });
  }

  console.log("LeadVirt.ai worker processors are running.");
}

process.on("SIGTERM", () => {
  void shutdownOpenTelemetry().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdownOpenTelemetry().finally(() => process.exit(0));
});

void bootstrap();
