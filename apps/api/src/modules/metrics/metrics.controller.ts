import { Controller, Get, Header, Inject } from "@nestjs/common";
import { KnowledgeMetricsSnapshotService } from "./knowledge-metrics-snapshot.service.js";
import { KnowledgeDependencyHealthService } from "./knowledge-dependency-health.service.js";
import { incrementCounter, renderPrometheusMetrics } from "./metrics.registry.js";

@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(KnowledgeMetricsSnapshotService)
    private readonly knowledge: KnowledgeMetricsSnapshotService,
    @Inject(KnowledgeDependencyHealthService)
    private readonly dependencies: KnowledgeDependencyHealthService,
  ) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics() {
    void this.dependencies.refresh().catch(() => undefined);
    try {
      await this.knowledge.refresh();
    } catch {
      incrementCounter(
        "leadvirt_knowledge_metrics_snapshot_failures_total",
        "Knowledge metrics snapshot refresh failures.",
        [],
        {},
      );
    }
    return renderPrometheusMetrics();
  }
}
