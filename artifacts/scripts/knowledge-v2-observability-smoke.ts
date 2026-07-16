import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import {
  KNOWLEDGE_DEPENDENCY_PROBE_OVERRIDES,
  KnowledgeDependencyHealthService,
} from "../../apps/api/src/modules/metrics/knowledge-dependency-health.service.js";
import { MetricsController } from "../../apps/api/src/modules/metrics/metrics.controller.js";
import { KnowledgeMetricsSnapshotService } from "../../apps/api/src/modules/metrics/knowledge-metrics-snapshot.service.js";
import { renderPrometheusMetrics } from "../../apps/api/src/modules/metrics/metrics.registry.js";

const tenantMarker = "tenant-secret-identifier";
const contentMarker = "customer message text";
let jobStatus = "QUEUED";
let transactionCalls = 0;

const prisma = {
  knowledgeJob: {
    groupBy: async () => [
      {
        stage: "EVALUATING",
        status: jobStatus,
        _count: { _all: 2 },
        _min: { createdAt: new Date(Date.now() - 5_000) },
      },
    ],
  },
  knowledgeV2Source: {
    groupBy: async (input: { where?: { lastSuccessAt?: null } }) =>
      input.where?.lastSuccessAt === null
        ? [{ kind: "WEBSITE", status: "CONNECTING", _count: { _all: 1 } }]
        : [
            {
              kind: "WEBSITE",
              status: "READY",
              _count: { _all: 1 },
              _min: { lastSuccessAt: new Date(Date.now() - 10_000) },
            },
          ],
  },
  knowledgeV2Document: {
    groupBy: async () => [{ status: "READY", _count: { _all: 3 } }],
  },
  knowledgeV2ReviewItem: {
    groupBy: async () => [{ reason: "FAILING_TEST", riskLevel: "HIGH", _count: { _all: 1 } }],
  },
  knowledgeV2Conflict: {
    groupBy: async () => [{ severity: "CRITICAL", status: "OPEN", _count: { _all: 1 } }],
  },
  knowledgePublication: {
    groupBy: async () => [{ status: "ACTIVE", _count: { _all: 1 } }],
  },
  knowledgeV2DeletionLedger: {
    groupBy: async () => [
      {
        subsystem: "qdrant",
        status: "PENDING",
        _count: { _all: 1 },
        _min: { deniedAt: new Date(Date.now() - 20_000) },
      },
    ],
  },
  knowledgeV2EvaluationResult: {
    groupBy: async () => [{ status: "PASSED", gateOutcome: "ANSWERED", _count: { _all: 4 } }],
  },
  knowledgeV2Feedback: {
    groupBy: async () => [{ category: "INCORRECT_ANSWER", status: "OPEN", _count: { _all: 1 } }],
  },
};

Object.assign(prisma, {
  $transaction: async (callback: (tx: typeof prisma) => Promise<unknown>) => {
    transactionCalls += 1;
    return callback(prisma);
  },
});

async function main() {
  const controllerDependencies = Reflect.getMetadata("self:paramtypes", MetricsController) as
    | Array<{ index: number; param: unknown }>
    | undefined;
  const serviceDependencies = Reflect.getMetadata(
    "self:paramtypes",
    KnowledgeMetricsSnapshotService,
  ) as Array<{ index: number; param: unknown }> | undefined;
  const dependencyServiceDependencies = Reflect.getMetadata(
    "self:paramtypes",
    KnowledgeDependencyHealthService,
  ) as Array<{ index: number; param: unknown }> | undefined;
  assert.equal(
    controllerDependencies?.find((dependency) => dependency.index === 0)?.param,
    KnowledgeMetricsSnapshotService,
  );
  assert.equal(
    serviceDependencies?.find((dependency) => dependency.index === 0)?.param,
    PrismaService,
  );
  assert.equal(
    controllerDependencies?.find((dependency) => dependency.index === 1)?.param,
    KnowledgeDependencyHealthService,
  );
  assert.equal(
    dependencyServiceDependencies?.find((dependency) => dependency.index === 0)?.param,
    PrismaService,
  );
  assert.equal(
    dependencyServiceDependencies?.find((dependency) => dependency.index === 1)?.param,
    AppConfigService,
  );
  assert.equal(
    dependencyServiceDependencies?.find((dependency) => dependency.index === 2)?.param,
    KNOWLEDGE_DEPENDENCY_PROBE_OVERRIDES,
  );

  let dependencyNow = 1_000_000;
  const dependencyFailures = new Set<string>();
  const dependencyCalls = new Map<string, number>();
  const dependencyNames = [
    "postgresql",
    "redis",
    "qdrant",
    "object_storage",
    "embedding",
    "reranker",
    "grounded_model",
    "otel_collector",
  ] as const;
  const dependencyProbes = Object.fromEntries(
    dependencyNames.map((dependency) => [
      dependency,
      async () => {
        dependencyCalls.set(dependency, (dependencyCalls.get(dependency) ?? 0) + 1);
        if (dependencyFailures.has(dependency)) {
          throw new Error(`${contentMarker}:${tenantMarker}`);
        }
      },
    ]),
  );
  const dependencyHealth = new KnowledgeDependencyHealthService(
    {} as never,
    {
      redisUrl: "redis://private-host:6380",
      ragQdrantEnabled: true,
      ragRetrievalMode: "qdrant",
      ragQdrantUrl: "http://private-qdrant:6333",
      ragQdrantApiKey: "private-qdrant-key",
      knowledgeObjectStorePath: "C:/private/object-store",
      knowledgeEmbeddingProviderApproved: true,
      aiApiKey: "private-embedding-key",
      aiBaseUrl: "https://private-embedding.example/v1",
      knowledgeV2EmbeddingDeployment: "private-deployment",
      knowledgeV2EmbeddingRegion: "private-region",
      knowledgeV2RerankerApproved: true,
      knowledgeV2RerankerEndpoint: "https://private-reranker.example/rerank",
      knowledgeV2RerankerApiKey: "private-reranker-key",
      knowledgeV2RerankerProvider: "private-provider",
      knowledgeV2RerankerModel: "private-model",
      knowledgeV2RerankerVersion: "private-version",
      knowledgeV2RerankerRegion: "private-region",
      knowledgeV2GroundedAnswerApproved: true,
      knowledgeV2GroundedAnswerBaseUrl: "https://private-grounded.example/v1",
      knowledgeV2GroundedAnswerApiKey: "private-grounded-key",
      knowledgeV2GroundedAnswerProvider: "private-provider",
      knowledgeV2GroundedAnswerModel: "private-model",
      knowledgeV2GroundedAnswerVersion: "private-version",
      knowledgeV2GroundedAnswerRegion: "private-region",
      otelEnabled: true,
      otelCollectorHealthUrl: "http://private-collector:13133",
    } as never,
    {
      now: () => dependencyNow,
      probes: dependencyProbes,
    },
  );
  await Promise.all([
    dependencyHealth.refresh(true),
    dependencyHealth.refresh(true),
    dependencyHealth.refresh(true),
  ]);
  assert.deepEqual(
    dependencyNames.map((dependency) => dependencyCalls.get(dependency)),
    dependencyNames.map(() => 1),
  );
  let dependencyMetrics = renderPrometheusMetrics();
  assert.match(dependencyMetrics, /leadvirt_knowledge_dependency_up\{dependency="qdrant"\} 1/u);
  assert.match(
    dependencyMetrics,
    /leadvirt_knowledge_dependency_configured\{dependency="grounded_model"\} 1/u,
  );

  dependencyFailures.add("qdrant");
  dependencyFailures.add("object_storage");
  dependencyFailures.add("otel_collector");
  dependencyNow += 31_000;
  await dependencyHealth.refresh(true);
  dependencyNow += 91_000;
  await dependencyHealth.refresh(true);
  dependencyMetrics = renderPrometheusMetrics();
  assert.match(dependencyMetrics, /leadvirt_knowledge_dependency_up\{dependency="qdrant"\} 0/u);
  assert.match(
    dependencyMetrics,
    /leadvirt_knowledge_dependency_probe_stale\{dependency="object_storage"\} 1/u,
  );
  assert.match(
    dependencyMetrics,
    /leadvirt_knowledge_dependency_probe_failures_total\{dependency="otel_collector",reason="unavailable"\} 2/u,
  );
  assert.doesNotMatch(
    dependencyMetrics,
    /tenant-secret-identifier|customer message text|private-host|private-qdrant|private-provider|private-model|private-region/u,
  );

  dependencyFailures.clear();
  dependencyNow += 31_000;
  await dependencyHealth.refresh(true);
  dependencyMetrics = renderPrometheusMetrics();
  assert.match(dependencyMetrics, /leadvirt_knowledge_dependency_up\{dependency="qdrant"\} 1/u);
  assert.match(
    dependencyMetrics,
    /leadvirt_knowledge_dependency_probe_stale\{dependency="object_storage"\} 0/u,
  );
  const snapshot = new KnowledgeMetricsSnapshotService(prisma as never);
  await Promise.all([snapshot.refresh(), snapshot.refresh(), snapshot.refresh()]);
  assert.equal(transactionCalls, 1);
  let rendered = renderPrometheusMetrics();

  assert.match(
    rendered,
    /leadvirt_knowledge_jobs_current\{stage="EVALUATING",status="queued"\} 2/u,
  );
  assert.match(rendered, /leadvirt_knowledge_review_items\{reason="failing_test",risk="high"\} 1/u);
  assert.match(rendered, /leadvirt_knowledge_conflicts\{risk="critical",state="open"\} 1/u);
  assert.match(rendered, /leadvirt_knowledge_publications_current\{state="active"\} 1/u);
  assert.match(
    rendered,
    /leadvirt_knowledge_answer_gate_results\{result="passed",outcome="answered"\} 4/u,
  );
  assert.match(
    rendered,
    /leadvirt_knowledge_sources_never_succeeded\{source_kind="website",status="connecting"\} 1/u,
  );
  assert.match(rendered, /leadvirt_knowledge_metrics_snapshot_stale 0/u);
  assert.match(rendered, /leadvirt_knowledge_metrics_snapshot_last_success_timestamp_seconds /u);
  assert.doesNotMatch(rendered, new RegExp(`${tenantMarker}|${contentMarker}`, "u"));

  jobStatus = "FAILED";
  const replacementSnapshot = new KnowledgeMetricsSnapshotService(prisma as never);
  await replacementSnapshot.refresh();
  rendered = renderPrometheusMetrics();
  assert.doesNotMatch(rendered, /status="queued"/u);
  assert.match(
    rendered,
    /leadvirt_knowledge_jobs_current\{stage="EVALUATING",status="failed"\} 2/u,
  );

  const failedSnapshot = new KnowledgeMetricsSnapshotService({
    $transaction: async () => {
      throw new Error(contentMarker);
    },
  } as never);
  const controller = new MetricsController(failedSnapshot, {
    refresh: () => Promise.resolve(),
  } as never);
  const degraded = await controller.metrics();
  assert.match(degraded, /leadvirt_knowledge_metrics_snapshot_failures_total 1/u);
  assert.match(degraded, /leadvirt_knowledge_metrics_snapshot_stale 1/u);
  assert.doesNotMatch(degraded, new RegExp(contentMarker, "u"));

  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../deploy/observability/grafana/dashboards/leadvirt-knowledge-health.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    uid?: string;
    panels?: Array<{ id?: number; targets?: Array<{ expr?: string }> }>;
  };
  assert.equal(dashboard.uid, "leadvirt-knowledge-health");
  assert.equal(dashboard.panels?.length, 24);
  assert.equal(new Set(dashboard.panels?.map((panel) => panel.id)).size, 24);
  const dashboardExpressions =
    dashboard.panels?.flatMap((panel) => panel.targets?.map((target) => target.expr ?? "") ?? []) ??
    [];
  const liveExpressions = dashboardExpressions.join("\n");
  assert.match(liveExpressions, /leadvirt_knowledge_live_retrieval_duration_seconds_bucket/u);
  assert.match(liveExpressions, /leadvirt_knowledge_live_retrieval_candidate_count_sum/u);
  assert.match(liveExpressions, /leadvirt_knowledge_live_retrieval_selected_count_sum/u);
  assert.match(liveExpressions, /leadvirt_knowledge_live_retrieval_outcomes_total/u);
  assert.match(liveExpressions, /leadvirt_knowledge_live_answer_gate_total/u);
  assert.match(liveExpressions, /leadvirt_knowledge_live_answer_citation_coverage_ratio_sum/u);
  assert.match(liveExpressions, /leadvirt_knowledge_time_to_queryable_seconds_bucket/u);
  assert.match(liveExpressions, /leadvirt_knowledge_publication_outcomes_total/u);
  assert.match(liveExpressions, /leadvirt_knowledge_publication_duration_seconds_bucket/u);
  assert.match(liveExpressions, /leadvirt_knowledge_dependency_up/u);
  assert.match(liveExpressions, /leadvirt_knowledge_dependency_probe_stale/u);
  assert.match(liveExpressions, /otelcol_exporter_send_failed_spans_total/u);
  assert.match(liveExpressions, /otelcol_exporter_enqueue_failed_spans_total/u);

  const stagingPrometheus = readFileSync(
    new URL("../../deploy/observability/prometheus.staging.yml", import.meta.url),
    "utf8",
  );
  const localPrometheus = readFileSync(
    new URL("../../deploy/observability/prometheus.local.yml", import.meta.url),
    "utf8",
  );
  const collectorConfig = readFileSync(
    new URL("../../deploy/observability/otel-collector.yml", import.meta.url),
    "utf8",
  );
  const alertConfig = readFileSync(
    new URL("../../deploy/observability/knowledge-alerts.yml", import.meta.url),
    "utf8",
  );
  const stagingCompose = readFileSync(
    new URL("../../deploy/docker-compose.staging.yml", import.meta.url),
    "utf8",
  );
  assert.match(stagingPrometheus, /otel-collector:8888/u);
  assert.match(stagingPrometheus, /knowledge-alerts\.yml/u);
  assert.match(localPrometheus, /host\.docker\.internal:8888/u);
  assert.match(collectorConfig, /endpoint: 0\.0\.0\.0:13133/u);
  assert.match(collectorConfig, /queue_size: 2048/u);
  assert.match(collectorConfig, /endpoint: http:\/\/tempo:4318/u);
  assert.match(alertConfig, /LeadVirtKnowledgeDependencyUnavailable/u);
  assert.match(alertConfig, /LeadVirtKnowledgeDependencyProbeStale/u);
  assert.match(alertConfig, /LeadVirtOpenTelemetryExporterFailure/u);
  assert.match(stagingCompose, /opentelemetry-collector-contrib:0\.156\.0/u);
  assert.match(stagingCompose, /127\.0\.0\.1:13133:13133/u);
  assert.doesNotMatch(
    `${collectorConfig}\n${alertConfig}\n${stagingPrometheus}`,
    new RegExp(`${tenantMarker}|${contentMarker}`, "u"),
  );

  console.log(JSON.stringify({ ok: true, checks: 62 }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
