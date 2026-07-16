import { Inject, Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { RedisReadinessProbe } from "@leadvirt/runtime-queue";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";

export type RuntimeDependencyState = "up" | "down";

export interface RuntimeReadinessSnapshot {
  ready: boolean;
  status: "ready" | "not_ready";
  dependencies: {
    database: RuntimeDependencyState;
    redis: RuntimeDependencyState;
  };
  timestamp: string;
}

export interface RuntimeReadinessProbeOverrides {
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
}

export const RUNTIME_READINESS_PROBE_OVERRIDES = Symbol("RUNTIME_READINESS_PROBE_OVERRIDES");

@Injectable()
export class RuntimeReadinessService implements OnModuleDestroy {
  private readonly redisProbe: RedisReadinessProbe;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private checkPromise: Promise<RuntimeReadinessSnapshot> | undefined;
  private cached: { value: RuntimeReadinessSnapshot; expiresAt: number } | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) config: AppConfigService,
    @Optional()
    @Inject(RUNTIME_READINESS_PROBE_OVERRIDES)
    private readonly overrides?: RuntimeReadinessProbeOverrides,
  ) {
    this.timeoutMs = overrides?.timeoutMs ?? 1500;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Runtime readiness timeout must be a positive integer.");
    }
    this.now = overrides?.now ?? (() => new Date());
    this.redisProbe = new RedisReadinessProbe(config.redisUrl, {
      queueName: "leadvirt-api-readiness",
      timeoutMs: this.timeoutMs,
    });
  }

  check() {
    const now = this.now().getTime();
    if (this.cached && now < this.cached.expiresAt) return Promise.resolve(this.cached.value);
    if (this.checkPromise) return this.checkPromise;
    const promise = this.runCheck().finally(() => {
      if (this.checkPromise === promise) this.checkPromise = undefined;
    });
    this.checkPromise = promise;
    return promise;
  }

  private async runCheck(): Promise<RuntimeReadinessSnapshot> {
    const [database, redis] = await Promise.all([
      this.checkDependency(this.overrides?.database ?? (() => this.probeDatabase())),
      this.checkDependency(this.overrides?.redis ?? (() => this.redisProbe.check())),
    ]);
    const ready = database === "up" && redis === "up";
    const value: RuntimeReadinessSnapshot = {
      ready,
      status: ready ? "ready" : "not_ready",
      dependencies: { database, redis },
      timestamp: this.now().toISOString(),
    };
    this.cached = { value, expiresAt: this.now().getTime() + 1000 };
    return value;
  }

  async onModuleDestroy() {
    await this.redisProbe.close();
  }

  private async probeDatabase() {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async checkDependency(probe: () => Promise<void>): Promise<RuntimeDependencyState> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(probe),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Runtime dependency readiness probe timed out.")),
            this.timeoutMs,
          );
        }),
      ]);
      return "up";
    } catch {
      return "down";
    } finally {
      clearTimeout(timeout);
    }
  }
}
