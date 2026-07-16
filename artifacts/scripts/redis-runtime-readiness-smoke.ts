import {
  describeRedisEndpoint,
  parseRedisConnectionUrl,
  parseServerEnv,
} from "@leadvirt/config";
import {
  assertRedisClientReady,
  bullMqConnectionFromRedisUrl,
} from "@leadvirt/runtime-queue";
import type { Response } from "express";
import { HealthController } from "../../apps/api/src/modules/health/health.controller.js";
import { RuntimeReadinessService } from "../../apps/api/src/modules/health/runtime-readiness.service.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { evaluateWorkerReadiness } from "../../apps/worker/src/observability/metrics-server.js";

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

async function rejects(action: () => unknown | Promise<unknown>, message: string) {
  try {
    await action();
  } catch {
    assertions += 1;
    return;
  }
  throw new Error(message);
}

function responseRecorder() {
  let statusCode = 200;
  const headers = new Map<string, string>();
  const response = {
    status(value: number) {
      statusCode = value;
      return response;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
  } as unknown as Response;
  return {
    response,
    statusCode: () => statusCode,
    header: (name: string) => headers.get(name.toLowerCase()),
  };
}

function config(redisUrl: string) {
  return { redisUrl } as AppConfigService;
}

function prisma() {
  return {} as PrismaService;
}

async function main() {
  const plain = parseRedisConnectionUrl("redis://cache.internal");
  assert(plain.port === 6379 && plain.db === 0 && !plain.tls, "redis:// default is invalid.");

  const secure = parseRedisConnectionUrl("rediss://cache.internal");
  assert(secure.port === 6379 && secure.tls, "rediss:// must enable TLS on Redis port 6379.");

  const explicit = parseRedisConnectionUrl("rediss://user:p%40ss@cache.internal:6380/4");
  assert(
    explicit.port === 6380 &&
      explicit.db === 4 &&
      explicit.username === "user" &&
      explicit.password === "p@ss" &&
      explicit.tls,
    "Explicit Redis connection fields were not preserved.",
  );
  assert(
    describeRedisEndpoint("rediss://user:p%40ss@cache.internal:6380/4") ===
      "rediss://cache.internal:6380/4",
    "Redis endpoint description exposed credentials or changed routing.",
  );

  const ipv6 = parseRedisConnectionUrl("redis://[2001:db8::1]:6390/2");
  assert(ipv6.host === "2001:db8::1" && ipv6.port === 6390, "IPv6 Redis host is invalid.");

  const bullMq = bullMqConnectionFromRedisUrl("rediss://user:secret@cache.internal/3", {
    maxRetriesPerRequest: null,
  });
  assert(
    bullMq.port === 6379 &&
      bullMq.db === 3 &&
      bullMq.username === "user" &&
      bullMq.password === "secret" &&
      bullMq.tls !== undefined &&
      bullMq.maxRetriesPerRequest === null,
    "BullMQ Redis adapter changed parsed connection semantics.",
  );

  for (const invalid of [
    "http://cache.internal",
    "redis:///0",
    "redis://cache.internal:0",
    "redis://cache.internal/not-a-db",
    "redis://cache.internal/0?tls=true",
    "redis://cache.internal/0#fragment",
  ]) {
    await rejects(() => parseRedisConnectionUrl(invalid), `Expected Redis URL rejection: ${invalid}`);
  }
  await rejects(
    () =>
      parseServerEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/leadvirt",
        REDIS_URL: "https://cache.internal",
      }),
    "Server environment accepted a non-Redis URL.",
  );

  await assertRedisClientReady({ ping: async () => "PONG" }, 20);
  assertions += 1;
  await rejects(
    () => assertRedisClientReady({ ping: async () => "NOPE" }, 20),
    "Redis readiness accepted a non-PONG response.",
  );
  await rejects(
    () => assertRedisClientReady({ ping: () => new Promise<string>(() => undefined) }, 5),
    "Redis readiness did not time out.",
  );

  const fixedNow = new Date("2026-07-15T12:00:00.000Z");
  let databaseProbes = 0;
  let redisProbes = 0;
  const healthyService = new RuntimeReadinessService(prisma(), config("redis://unused"), {
    database: async () => {
      databaseProbes += 1;
    },
    redis: async () => {
      redisProbes += 1;
    },
    now: () => fixedNow,
    timeoutMs: 20,
  });
  const [healthy] = await Promise.all([healthyService.check(), healthyService.check()]);
  assert(
    healthy.ready &&
      healthy.status === "ready" &&
      healthy.dependencies.database === "up" &&
      healthy.dependencies.redis === "up" &&
      healthy.timestamp === fixedNow.toISOString(),
    "Healthy API dependencies were not ready.",
  );
  assert(databaseProbes === 1 && redisProbes === 1, "Concurrent API readiness was not single-flight.");

  const secret = "never-expose-this-redis-password";
  const degradedService = new RuntimeReadinessService(prisma(), config("redis://unused"), {
    database: async () => undefined,
    redis: async () => {
      throw new Error(secret);
    },
    now: () => fixedNow,
    timeoutMs: 20,
  });
  const degraded = await degradedService.check();
  assert(
    !degraded.ready &&
      degraded.dependencies.database === "up" &&
      degraded.dependencies.redis === "down",
    "Failed Redis dependency did not degrade API readiness.",
  );
  assert(!JSON.stringify(degraded).includes(secret), "API readiness leaked a dependency error.");

  const controller = new HealthController(degradedService);
  const liveResponse = responseRecorder();
  const live = controller.health(liveResponse.response);
  assert(
    live.data.status === "alive" && liveResponse.statusCode() === 200,
    "API liveness became dependency-sensitive.",
  );
  assert(liveResponse.header("cache-control") === "no-store", "API liveness is cacheable.");

  const readyResponse = responseRecorder();
  const ready = await controller.ready(readyResponse.response);
  assert(
    readyResponse.statusCode() === 503 && ready.data.status === "not_ready",
    "API readiness did not return HTTP 503 for a failed dependency.",
  );
  assert(!JSON.stringify(ready).includes(secret), "API readiness controller leaked a secret.");

  const disabledWorker = await evaluateWorkerReadiness({
    ready: true,
    active: false,
    processorsEnabled: false,
    deploymentPaused: false,
  });
  assert(
    disabledWorker.status === "ready" && disabledWorker.dependencies.redis === "not_required",
    "Processor-disabled worker unexpectedly required Redis.",
  );

  const pausedWorker = await evaluateWorkerReadiness(
    { ready: true, active: false, processorsEnabled: true, deploymentPaused: true },
    { database: async () => undefined, redis: async () => undefined },
  );
  assert(
    pausedWorker.status === "ready" &&
      pausedWorker.dependencies.database === "up" &&
      pausedWorker.dependencies.redis === "up",
    "Connected deployment-paused worker was not ready.",
  );

  const failedWorker = await evaluateWorkerReadiness(
    { ready: true, active: true, processorsEnabled: true, deploymentPaused: false },
    {
      database: async () => undefined,
      redis: async () => {
        throw new Error(secret);
      },
    },
  );
  assert(
    failedWorker.status === "not_ready" && failedWorker.dependencies.redis === "down",
    "Worker Redis failure did not degrade readiness.",
  );
  assert(!JSON.stringify(failedWorker).includes(secret), "Worker readiness leaked an error.");

  const failedWorkerDatabase = await evaluateWorkerReadiness(
    { ready: true, active: true, processorsEnabled: true, deploymentPaused: false },
    {
      database: async () => {
        throw new Error(secret);
      },
      redis: async () => undefined,
    },
  );
  assert(
    failedWorkerDatabase.status === "not_ready" &&
      failedWorkerDatabase.dependencies.database === "down" &&
      failedWorkerDatabase.dependencies.redis === "up",
    "Worker database failure did not degrade readiness.",
  );

  await Promise.all([healthyService.onModuleDestroy(), degradedService.onModuleDestroy()]);
  console.log(`Redis runtime readiness smoke passed (${assertions} assertions).`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
