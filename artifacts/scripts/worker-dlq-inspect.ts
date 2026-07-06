import { Queue, type ConnectionOptions } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { queueNames } from "../../apps/worker/src/queues/queue-names.js";

loadEnvFile();

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
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

async function main() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
  const limit = Math.max(1, Math.min(100, Number(process.env.WORKER_DLQ_INSPECT_LIMIT ?? "20")));
  const connection = connectionFromRedisUrl(redisUrl);
  const queues = queueNames.map((name) => new Queue(name, { connection }));

  try {
    const report = [];
    for (const queue of queues) {
      const failed = await queue.getFailed(0, limit - 1);
      report.push({
        queue: queue.name,
        failedCount: failed.length,
        jobs: failed.map((job) => ({
          id: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade,
          attempts: job.opts.attempts ?? 1,
          failedReason: job.failedReason,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn ?? null
        }))
      });
    }

    console.log(JSON.stringify({ ok: true, queues: report }, null, 2));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
