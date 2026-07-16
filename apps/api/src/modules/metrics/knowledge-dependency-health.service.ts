import { access, constants, stat } from "node:fs/promises";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { RedisReadinessProbe } from "@leadvirt/runtime-queue";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { incrementCounter, replaceGauge } from "./metrics.registry.js";

const refreshIntervalMs = 30_000;
const staleAfterMs = 90_000;
const probeTimeoutMs = 1_500;
const dependencies = [
  "postgresql",
  "redis",
  "qdrant",
  "object_storage",
  "embedding",
  "reranker",
  "grounded_model",
  "otel_collector",
] as const;

type Dependency = (typeof dependencies)[number];
type FailureReason = "timeout" | "unavailable";

interface DependencyState {
  configured: boolean;
  up: boolean;
  checkedAt: number | null;
  lastSuccessAt: number | null;
  failureReason: FailureReason | null;
}

export interface KnowledgeDependencyProbeOverrides {
  now?: () => number;
  probes?: Partial<Record<Dependency, () => Promise<void>>>;
}

export const KNOWLEDGE_DEPENDENCY_PROBE_OVERRIDES = Symbol("KNOWLEDGE_DEPENDENCY_PROBE_OVERRIDES");

function modelsEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function configuredIdentity(values: Array<string | null | undefined>) {
  return values.every((value) => Boolean(value && value !== "unconfigured"));
}

@Injectable()
export class KnowledgeDependencyHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly states = new Map<Dependency, DependencyState>();
  private refreshPromise: Promise<void> | null = null;
  private nextRefreshAt = 0;
  private readonly now: () => number;
  private readonly redisProbe: RedisReadinessProbe;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Optional()
    @Inject(KNOWLEDGE_DEPENDENCY_PROBE_OVERRIDES)
    private readonly overrides?: KnowledgeDependencyProbeOverrides,
  ) {
    this.now = overrides?.now ?? Date.now;
    this.redisProbe = new RedisReadinessProbe(config.redisUrl, {
      queueName: "leadvirt-knowledge-dependency-health",
      timeoutMs: probeTimeoutMs,
    });
    for (const dependency of dependencies) {
      this.states.set(dependency, {
        configured: false,
        up: false,
        checkedAt: null,
        lastSuccessAt: null,
        failureReason: null,
      });
    }
  }

  onModuleInit() {
    void this.refresh().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.redisProbe.close();
  }

  refresh(force = false) {
    const now = this.now();
    this.publish(now);
    if (this.refreshPromise) return this.refreshPromise;
    if (!force && now < this.nextRefreshAt) return Promise.resolve();
    this.refreshPromise = this.runRefresh(now).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async runRefresh(startedAt: number) {
    const definitions = this.probeDefinitions();
    await Promise.all(
      dependencies.map(async (dependency) => {
        const definition = definitions[dependency];
        const state = this.states.get(dependency)!;
        state.configured = definition.configured;
        state.checkedAt = startedAt;
        state.failureReason = null;
        if (!definition.configured) {
          state.up = false;
          return;
        }
        try {
          await this.withTimeout(
            this.overrides?.probes?.[dependency] ?? definition.probe,
            probeTimeoutMs,
          );
          state.up = true;
          state.lastSuccessAt = this.now();
        } catch (error) {
          state.up = false;
          state.failureReason =
            error instanceof DOMException && error.name === "TimeoutError"
              ? "timeout"
              : "unavailable";
          incrementCounter(
            "leadvirt_knowledge_dependency_probe_failures_total",
            "Knowledge dependency probe failures.",
            ["dependency", "reason"],
            { dependency, reason: state.failureReason },
          );
        }
      }),
    );
    this.nextRefreshAt = this.now() + refreshIntervalMs;
    this.publish(this.now());
  }

  private probeDefinitions(): Record<
    Dependency,
    { configured: boolean; probe: () => Promise<void> }
  > {
    const embeddingConfigured = Boolean(
      this.config.knowledgeEmbeddingProviderApproved &&
      this.config.aiApiKey &&
      configuredIdentity([
        this.config.knowledgeV2EmbeddingDeployment,
        this.config.knowledgeV2EmbeddingRegion,
      ]),
    );
    const rerankerConfigured = Boolean(
      this.config.knowledgeV2RerankerApproved &&
      this.config.knowledgeV2RerankerEndpoint &&
      configuredIdentity([
        this.config.knowledgeV2RerankerProvider,
        this.config.knowledgeV2RerankerModel,
        this.config.knowledgeV2RerankerVersion,
        this.config.knowledgeV2RerankerRegion,
      ]),
    );
    const groundedConfigured = Boolean(
      this.config.knowledgeV2GroundedAnswerApproved &&
      this.config.knowledgeV2GroundedAnswerBaseUrl &&
      this.config.knowledgeV2GroundedAnswerApiKey &&
      configuredIdentity([
        this.config.knowledgeV2GroundedAnswerProvider,
        this.config.knowledgeV2GroundedAnswerModel,
        this.config.knowledgeV2GroundedAnswerVersion,
        this.config.knowledgeV2GroundedAnswerRegion,
      ]),
    );
    return {
      postgresql: { configured: true, probe: () => this.probePostgresql() },
      redis: { configured: Boolean(this.config.redisUrl), probe: () => this.probeRedis() },
      qdrant: {
        configured: this.config.ragQdrantEnabled && this.config.ragRetrievalMode === "qdrant",
        probe: () =>
          this.probeHttp(`${this.config.ragQdrantUrl.replace(/\/+$/u, "")}/readyz`, {
            ...(this.config.ragQdrantApiKey ? { "api-key": this.config.ragQdrantApiKey } : {}),
          }),
      },
      object_storage: {
        configured: Boolean(this.config.knowledgeObjectStorePath),
        probe: () => this.probeObjectStore(),
      },
      embedding: {
        configured: embeddingConfigured,
        probe: () =>
          this.probeHttp(modelsEndpoint(this.config.aiBaseUrl), {
            authorization: `Bearer ${this.config.aiApiKey ?? ""}`,
          }),
      },
      reranker: {
        configured: rerankerConfigured,
        probe: () =>
          this.probeHttp(
            this.config.knowledgeV2RerankerEndpoint ?? "http://127.0.0.1",
            {
              ...(this.config.knowledgeV2RerankerApiKey
                ? { authorization: `Bearer ${this.config.knowledgeV2RerankerApiKey}` }
                : {}),
            },
            "HEAD",
            true,
          ),
      },
      grounded_model: {
        configured: groundedConfigured,
        probe: () =>
          this.probeHttp(
            modelsEndpoint(this.config.knowledgeV2GroundedAnswerBaseUrl ?? "http://127.0.0.1"),
            {
              authorization: `Bearer ${this.config.knowledgeV2GroundedAnswerApiKey ?? ""}`,
            },
          ),
      },
      otel_collector: {
        configured: this.config.otelEnabled && Boolean(this.config.otelCollectorHealthUrl),
        probe: () => this.probeHttp(this.config.otelCollectorHealthUrl ?? "http://127.0.0.1", {}),
      },
    };
  }

  private async probePostgresql() {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async probeRedis() {
    await this.redisProbe.check();
  }

  private async probeObjectStore() {
    const path = this.config.knowledgeObjectStorePath;
    if (!path) throw new Error("Object storage is not configured.");
    await access(path, constants.R_OK);
    const value = await stat(path);
    if (!value.isDirectory()) throw new Error("Object storage path is unavailable.");
  }

  private async probeHttp(
    url: string,
    headers: Record<string, string>,
    method: "GET" | "HEAD" = "GET",
    allowMethodNotAllowed = false,
  ) {
    const response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && !(allowMethodNotAllowed && response.status === 405)) {
      throw new Error("HTTP dependency unavailable.");
    }
  }

  private withTimeout(probe: () => Promise<void>, timeoutMs: number) {
    let timeout: NodeJS.Timeout | undefined;
    return Promise.race([
      probe(),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () => reject(new DOMException("Dependency probe timed out.", "TimeoutError")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]).finally(() => clearTimeout(timeout));
  }

  private publish(now: number) {
    const samples = dependencies.map((dependency) => {
      const state = this.states.get(dependency)!;
      const stale =
        state.configured &&
        (state.lastSuccessAt === null || now - state.lastSuccessAt > staleAfterMs);
      return { dependency, state, stale };
    });
    replaceGauge(
      "leadvirt_knowledge_dependency_configured",
      "Whether a Knowledge dependency is configured.",
      ["dependency"],
      samples.map(({ dependency, state }) => ({
        labels: { dependency },
        value: state.configured ? 1 : 0,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_dependency_up",
      "Whether the last bounded Knowledge dependency probe succeeded.",
      ["dependency"],
      samples.map(({ dependency, state }) => ({
        labels: { dependency },
        value: state.up ? 1 : 0,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_dependency_probe_stale",
      "Whether a configured Knowledge dependency lacks a fresh successful probe.",
      ["dependency"],
      samples.map(({ dependency, stale }) => ({
        labels: { dependency },
        value: stale ? 1 : 0,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_dependency_probe_age_seconds",
      "Age of the last successful Knowledge dependency probe.",
      ["dependency"],
      samples.map(({ dependency, state }) => ({
        labels: { dependency },
        value: state.lastSuccessAt === null ? 0 : Math.max(0, (now - state.lastSuccessAt) / 1_000),
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_dependency_last_success_timestamp_seconds",
      "Unix timestamp of the last successful Knowledge dependency probe.",
      ["dependency"],
      samples.map(({ dependency, state }) => ({
        labels: { dependency },
        value: state.lastSuccessAt === null ? 0 : state.lastSuccessAt / 1_000,
      })),
    );
  }
}
