import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import { PrismaService } from "../database/prisma.service.js";
import { replaceGauge } from "./metrics.registry.js";

const activeReviewStatuses = ["OPEN", "ASSIGNED", "IN_REVIEW"] as const;
const activeConflictStatuses = ["OPEN", "IN_REVIEW"] as const;
const pendingDeletionStatuses = ["PENDING", "IN_PROGRESS", "FAILED"] as const;
const refreshIntervalMs = 10_000;
const failureBackoffMs = 5_000;

function ageSeconds(value: Date | null, now: number) {
  return value ? Math.max(0, (now - value.getTime()) / 1_000) : null;
}

@Injectable()
export class KnowledgeMetricsSnapshotService {
  private refreshPromise: Promise<void> | null = null;
  private nextRefreshAt = 0;
  private lastSuccessAt: number | null = null;
  private stale = true;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async refresh() {
    const now = Date.now();
    this.updateSnapshotHealth(now);
    if (now < this.nextRefreshAt) return;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshSnapshot().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshSnapshot() {
    try {
      const snapshot = await this.prisma.$transaction(
        (tx) => this.readSnapshot(tx),
        { isolationLevel: "RepeatableRead" },
      );
      this.applySnapshot(snapshot);
      this.lastSuccessAt = Date.now();
      this.nextRefreshAt = this.lastSuccessAt + refreshIntervalMs;
      this.stale = false;
      this.updateSnapshotHealth(this.lastSuccessAt);
    } catch (error) {
      this.stale = true;
      this.nextRefreshAt = Date.now() + failureBackoffMs;
      this.updateSnapshotHealth(Date.now());
      throw error;
    }
  }

  private readSnapshot(tx: Prisma.TransactionClient) {
    return Promise.all([
      tx.knowledgeJob.groupBy({
          by: ["stage", "status"],
          where: { pipelineVersion: { startsWith: "knowledge-v2" } },
          _count: { _all: true },
          _min: { createdAt: true },
        }),
      tx.knowledgeV2Source.groupBy({
          by: ["kind", "status"],
          where: { deletedAt: null },
          _count: { _all: true },
          _min: { lastSuccessAt: true },
        }),
      tx.knowledgeV2Source.groupBy({
          by: ["kind", "status"],
          where: { deletedAt: null, lastSuccessAt: null },
          _count: { _all: true },
        }),
      tx.knowledgeV2Document.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
      tx.knowledgeV2ReviewItem.groupBy({
          by: ["reason", "riskLevel"],
          where: { status: { in: [...activeReviewStatuses] } },
          _count: { _all: true },
        }),
      tx.knowledgeV2Conflict.groupBy({
          by: ["severity", "status"],
          where: { status: { in: [...activeConflictStatuses] } },
          _count: { _all: true },
        }),
      tx.knowledgePublication.groupBy({
          by: ["status"],
          where: { corpusKind: "STRUCTURED_V2" },
          _count: { _all: true },
        }),
      tx.knowledgeV2DeletionLedger.groupBy({
          by: ["subsystem", "status"],
          where: { status: { in: [...pendingDeletionStatuses] } },
          _count: { _all: true },
          _min: { deniedAt: true },
        }),
      tx.knowledgeV2EvaluationResult.groupBy({
          by: ["status", "gateOutcome"],
          _count: { _all: true },
        }),
      tx.knowledgeV2Feedback.groupBy({
          by: ["category", "status"],
          _count: { _all: true },
        }),
    ]);
  }

  private applySnapshot(
    [jobs, sources, neverSucceededSources, documents, reviews, conflicts, publications, deletions, gates, feedback]:
      Awaited<ReturnType<KnowledgeMetricsSnapshotService["readSnapshot"]>>,
  ) {
    const now = Date.now();
    replaceGauge(
      "leadvirt_knowledge_jobs_current",
      "Current durable Knowledge v2 jobs by stage and status.",
      ["stage", "status"],
      jobs.map((row) => ({
        labels: { stage: row.stage, status: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_job_oldest_age_seconds",
      "Age of the oldest durable Knowledge v2 job by stage and status.",
      ["stage", "status"],
      jobs.flatMap((row) => {
        const value = ageSeconds(row._min.createdAt, now);
        return value === null
          ? []
          : [{ labels: { stage: row.stage, status: row.status.toLowerCase() }, value }];
      }),
    );
    replaceGauge(
      "leadvirt_knowledge_sources_current",
      "Current Knowledge v2 sources by bounded kind and status.",
      ["source_kind", "status"],
      sources.map((row) => ({
        labels: { source_kind: row.kind.toLowerCase(), status: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_source_oldest_success_age_seconds",
      "Age of the oldest successful Knowledge v2 source sync.",
      ["source_kind", "status"],
      sources.flatMap((row) => {
        const value = ageSeconds(row._min.lastSuccessAt, now);
        return value === null
          ? []
          : [
              {
                labels: {
                  source_kind: row.kind.toLowerCase(),
                  status: row.status.toLowerCase(),
                },
                value,
              },
            ];
      }),
    );
    replaceGauge(
      "leadvirt_knowledge_sources_never_succeeded",
      "Current Knowledge v2 sources that have never completed a successful sync.",
      ["source_kind", "status"],
      neverSucceededSources.map((row) => ({
        labels: { source_kind: row.kind.toLowerCase(), status: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_documents_current",
      "Current Knowledge v2 documents by state.",
      ["state", "source_kind"],
      documents.map((row) => ({
        labels: { state: row.status.toLowerCase(), source_kind: "all" },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_review_items",
      "Current unresolved Knowledge v2 review items.",
      ["reason", "risk"],
      reviews.map((row) => ({
        labels: { reason: row.reason.toLowerCase(), risk: row.riskLevel.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_conflicts",
      "Current unresolved Knowledge v2 conflicts.",
      ["risk", "state"],
      conflicts.map((row) => ({
        labels: { risk: row.severity.toLowerCase(), state: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_publications_current",
      "Current Knowledge v2 publications by state.",
      ["state"],
      publications.map((row) => ({
        labels: { state: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_deletion_oldest_age_seconds",
      "Age of the oldest incomplete Knowledge v2 deletion ledger entry.",
      ["subsystem", "status"],
      deletions.flatMap((row) => {
        const value = ageSeconds(row._min?.deniedAt ?? null, now);
        return value === null
          ? []
          : [
              {
                labels: { subsystem: row.subsystem, status: row.status.toLowerCase() },
                value,
              },
            ];
      }),
    );
    replaceGauge(
      "leadvirt_knowledge_answer_gate_results",
      "Persisted Knowledge v2 answer-gate results.",
      ["result", "outcome"],
      gates.map((row) => ({
        labels: {
          result: row.status.toLowerCase(),
          outcome: row.gateOutcome?.toLowerCase() ?? "none",
        },
        value: row._count._all,
      })),
    );
    replaceGauge(
      "leadvirt_knowledge_feedback_current",
      "Current persisted Knowledge v2 feedback by category and status.",
      ["category", "status"],
      feedback.map((row) => ({
        labels: { category: row.category.toLowerCase(), status: row.status.toLowerCase() },
        value: row._count._all,
      })),
    );
  }

  private updateSnapshotHealth(now: number) {
    replaceGauge(
      "leadvirt_knowledge_metrics_snapshot_stale",
      "Whether the Knowledge metrics snapshot is stale after a refresh failure.",
      [],
      [{ labels: {}, value: this.stale ? 1 : 0 }],
    );
    replaceGauge(
      "leadvirt_knowledge_metrics_snapshot_last_success_timestamp_seconds",
      "Unix timestamp of the last successful Knowledge metrics snapshot.",
      [],
      this.lastSuccessAt === null
        ? []
        : [{ labels: {}, value: this.lastSuccessAt / 1_000 }],
    );
    replaceGauge(
      "leadvirt_knowledge_metrics_snapshot_age_seconds",
      "Age of the last successful Knowledge metrics snapshot.",
      [],
      this.lastSuccessAt === null
        ? []
        : [{ labels: {}, value: Math.max(0, (now - this.lastSuccessAt) / 1_000) }],
    );
  }
}
