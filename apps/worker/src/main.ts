import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { queueNames } from "./queues/queue-names.js";
import { processLeadVirtJob, type LeadVirtJobData } from "./processors/processor-registry.js";

loadEnvFile();

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
  console.log(
    JSON.stringify({
      service: "LeadVirt.ai worker",
      status: "starting",
      redisUrl,
      queues: queueNames,
      processorsEnabled: enableProcessors
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
        (job) => processLeadVirtJob(name, job),
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
      console.error(JSON.stringify({ queue: job?.queueName, jobId: job?.id, status: "failed", error: error.message }));
    });
  }

  console.log("LeadVirt.ai worker processors are running.");
}

void bootstrap();
