import { parseRedisConnectionUrl } from "@leadvirt/config";
import { Queue, type ConnectionOptions } from "bullmq";

export interface BullMqRedisConnectionPolicy {
  connectTimeout?: number;
  enableOfflineQueue?: boolean;
  maxRetriesPerRequest?: number | null;
}

export interface RedisReadinessProbeOptions {
  queueName?: string;
  timeoutMs?: number;
}

export function bullMqConnectionFromRedisUrl(
  redisUrl: string,
  policy: BullMqRedisConnectionPolicy = {},
): ConnectionOptions {
  const parsed = parseRedisConnectionUrl(redisUrl);
  return {
    host: parsed.host,
    port: parsed.port,
    db: parsed.db,
    ...(parsed.username === undefined ? {} : { username: parsed.username }),
    ...(parsed.password === undefined ? {} : { password: parsed.password }),
    ...(parsed.tls ? { tls: {} } : {}),
    ...policy,
  };
}

export async function assertRedisClientReady(
  client: PromiseLike<{ ping(): Promise<string> }> | { ping(): Promise<string> },
  timeoutMs: number,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Redis readiness timeout must be a positive integer.");
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(client).then((value) => value.ping()),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Redis readiness probe timed out.")), timeoutMs);
      }),
    ]);
    if (result !== "PONG") throw new Error("Redis readiness probe returned an invalid response.");
  } finally {
    clearTimeout(timeout);
  }
}

export class RedisReadinessProbe {
  private readonly timeoutMs: number;
  private readonly queueName: string;
  private queue: Queue | undefined;
  private checkPromise: Promise<void> | undefined;

  constructor(
    private readonly redisUrl: string,
    options: RedisReadinessProbeOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 1500;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Redis readiness timeout must be a positive integer.");
    }
    this.queueName = options.queueName ?? "leadvirt-runtime-readiness";
    if (!this.queueName.trim()) throw new Error("Redis readiness queue name is required.");
  }

  check() {
    if (this.checkPromise) return this.checkPromise;
    const promise = this.runCheck().finally(() => {
      if (this.checkPromise === promise) this.checkPromise = undefined;
    });
    this.checkPromise = promise;
    return promise;
  }

  private async runCheck() {
    const queue = this.getQueue();
    await assertRedisClientReady(queue.client, this.timeoutMs);
  }

  async close() {
    const queue = this.queue;
    this.queue = undefined;
    await queue?.close().catch(() => undefined);
  }

  private getQueue() {
    if (this.queue) return this.queue;
    const queue = new Queue(this.queueName, {
      connection: bullMqConnectionFromRedisUrl(this.redisUrl, {
        connectTimeout: this.timeoutMs,
        maxRetriesPerRequest: 1,
      }),
    });
    queue.on("error", () => undefined);
    this.queue = queue;
    return queue;
  }
}
