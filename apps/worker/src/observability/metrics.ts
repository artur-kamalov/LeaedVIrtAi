type Labels = Record<string, string | number | boolean | null | undefined>;

interface CounterMetric {
  kind: "counter";
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, { labels: Record<string, string>; value: number }>;
}

interface HistogramMetric {
  kind: "histogram";
  name: string;
  help: string;
  labelNames: string[];
  buckets: number[];
  values: Map<
    string,
    { labels: Record<string, string>; buckets: number[]; sum: number; count: number }
  >;
}

type Metric = CounterMetric | HistogramMetric;

const metrics = new Map<string, Metric>();

const knowledgeMetricLocales = new Set(["en", "fr", "de", "es", "pt", "ru"]);
const knowledgeRetrievalOutcomes = new Set(["grounded", "empty", "degraded", "blocked"]);
const knowledgeAnswerResults = new Set(["passed", "blocked"]);
const knowledgeRiskLevels = new Set(["low", "medium", "high", "critical", "unknown"]);
const knowledgeStableReasons = new Set([
  "evidence_ready",
  "no_match",
  "conflict",
  "stale",
  "unauthorized",
  "hash_mismatch",
  "no_active_publication",
  "publication_invalid",
  "snapshot_not_ready",
  "snapshot_incompatible",
  "draft_snapshot_unavailable",
  "restricted_storage_unavailable",
  "embedding_unavailable",
  "processor_policy_denied",
  "sparse_encoding_unavailable",
  "qdrant_unavailable",
  "reranker_unavailable",
  "permission_partition_unavailable",
  "runtime_not_configured",
  "corpus_mismatch",
  "grounded_answer_passed",
  "structured_handoff",
  "structured_evidence_revoked",
  "structured_model_revoked",
  "output_format_invalid",
  "processor_denied",
  "provider_unavailable",
  "input_policy_denied",
  "output_policy_denied",
  "input_invalid",
  "input_limit_exceeded",
  "claim_id_duplicate",
  "claim_text_hash_mismatch",
  "claim_text_not_in_draft",
  "claim_exact_support_required",
  "claim_evidence_required",
  "unknown_claim_evidence",
  "evidence_key_duplicate",
  "evidence_content_hash_mismatch",
  "evidence_unauthorized",
  "evidence_target_mismatch",
  "evidence_stale",
  "live_evidence_failed",
  "live_evidence_invalid",
  "live_evidence_expired",
  "high_risk_exact_value_required",
  "high_risk_exact_value_hash_mismatch",
  "high_risk_exact_support_required",
  "high_risk_citation_not_exact",
  "active_evidence_conflict",
  "unknown_citation_claim",
  "unknown_citation_evidence",
  "citation_not_declared",
  "citation_claim_hash_mismatch",
  "duplicate_citation",
  "missing_citation",
]);

function boundedMetricValue(value: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
}

function knowledgeLocale(value: string) {
  const base = value.trim().toLowerCase().split(/[-_]/u)[0] ?? "";
  return knowledgeMetricLocales.has(base) ? base : "other";
}

function stableKnowledgeReason(value: string) {
  const normalized = value.trim().toLowerCase();
  return knowledgeStableReasons.has(normalized) ? normalized : "other";
}

function stableKnowledgeLabel(value: string, allowed: Set<string>, fallback: string) {
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function escapeHelp(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function normalizeLabels(labelNames: string[], labels: Labels) {
  const normalized: Record<string, string> = {};
  for (const name of labelNames) {
    const value = labels[name];
    normalized[name] = value === null || value === undefined ? "unknown" : String(value);
  }
  return normalized;
}

function labelKey(labelNames: string[], labels: Record<string, string>) {
  return labelNames.map((name) => `${name}=${labels[name]}`).join("\u0001");
}

function renderLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function incrementCounter(
  name: string,
  help: string,
  labelNames: string[],
  labels: Labels,
  value = 1,
) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = { kind: "counter", name, help, labelNames, values: new Map() };
    metrics.set(name, metric);
  }

  if (metric.kind !== "counter")
    throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);

  const normalized = normalizeLabels(metric.labelNames, labels);
  const key = labelKey(metric.labelNames, normalized);
  const current = metric.values.get(key) ?? { labels: normalized, value: 0 };
  current.value += value;
  metric.values.set(key, current);
}

function observeHistogram(
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
  labels: Labels,
  value: number,
) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = {
      kind: "histogram",
      name,
      help,
      labelNames,
      buckets: [...buckets].sort((left, right) => left - right),
      values: new Map(),
    };
    metrics.set(name, metric);
  }

  if (metric.kind !== "histogram")
    throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);

  const normalized = normalizeLabels(metric.labelNames, labels);
  const key = labelKey(metric.labelNames, normalized);
  const current = metric.values.get(key) ?? {
    labels: normalized,
    buckets: metric.buckets.map(() => 0),
    sum: 0,
    count: 0,
  };

  current.count += 1;
  current.sum += value;
  metric.buckets.forEach((bucket, index) => {
    if (value <= bucket) current.buckets[index] = (current.buckets[index] ?? 0) + 1;
  });
  metric.values.set(key, current);
}

function renderCounter(metric: CounterMetric) {
  const lines = [
    `# HELP ${metric.name} ${escapeHelp(metric.help)}`,
    `# TYPE ${metric.name} counter`,
  ];
  for (const value of metric.values.values()) {
    lines.push(`${metric.name}${renderLabels(value.labels)} ${value.value}`);
  }
  return lines;
}

function renderHistogram(metric: HistogramMetric) {
  const lines = [
    `# HELP ${metric.name} ${escapeHelp(metric.help)}`,
    `# TYPE ${metric.name} histogram`,
  ];
  for (const value of metric.values.values()) {
    metric.buckets.forEach((bucket, index) => {
      lines.push(
        `${metric.name}_bucket${renderLabels({ ...value.labels, le: String(bucket) })} ${value.buckets[index] ?? 0}`,
      );
    });
    lines.push(
      `${metric.name}_bucket${renderLabels({ ...value.labels, le: "+Inf" })} ${value.count}`,
    );
    lines.push(`${metric.name}_sum${renderLabels(value.labels)} ${value.sum}`);
    lines.push(`${metric.name}_count${renderLabels(value.labels)} ${value.count}`);
  }
  return lines;
}

export function renderPrometheusMetrics() {
  const lines: string[] = [];
  for (const metric of metrics.values()) {
    lines.push(...(metric.kind === "counter" ? renderCounter(metric) : renderHistogram(metric)));
  }
  return `${lines.join("\n")}\n`;
}

export function recordWorkerJob(input: {
  queue: string;
  status: "completed" | "failed" | "timeout";
  durationMs: number;
}) {
  const labels = { queue: input.queue, status: input.status };
  incrementCounter(
    "leadvirt_worker_jobs_total",
    "Total worker jobs processed.",
    ["queue", "status"],
    labels,
  );
  observeHistogram(
    "leadvirt_worker_job_duration_seconds",
    "Worker job duration in seconds.",
    ["queue", "status"],
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    labels,
    input.durationMs / 1000,
  );
}

export function recordDeadLetterJob(queue: string) {
  incrementCounter(
    "leadvirt_worker_dlq_total",
    "Total worker jobs captured in DLQ audit.",
    ["queue"],
    { queue },
  );
}

export function recordKnowledgeIngestion(input: {
  operation: string;
  stage: string;
  result: "succeeded" | "unchanged" | "quarantined" | "cancelled" | "failed";
  errorType: string;
  durationMs: number;
}) {
  const labels = {
    operation: input.operation,
    stage: input.stage,
    result: input.result,
    error_type: input.errorType,
  };
  incrementCounter(
    "leadvirt_knowledge_jobs_total",
    "Total Knowledge v2 ingestion job outcomes.",
    ["operation", "stage", "result", "error_type"],
    labels,
  );
  observeHistogram(
    "leadvirt_knowledge_job_duration_seconds",
    "Knowledge v2 ingestion job duration in seconds.",
    ["operation", "stage", "result", "error_type"],
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    labels,
    input.durationMs / 1000,
  );
}

export function recordStructuredKnowledgeRetrieval(input: {
  backend: string;
  outcome: string;
  reason: string;
  locale: string;
  candidateCount: number;
  selectedCount: number;
  durationMs: number;
}) {
  const labels = {
    corpus: "structured_v2",
    backend: input.backend === "database" || input.backend === "qdrant" ? input.backend : "unknown",
    outcome: stableKnowledgeLabel(input.outcome, knowledgeRetrievalOutcomes, "blocked"),
    reason: stableKnowledgeReason(input.reason),
    locale: knowledgeLocale(input.locale),
  };
  incrementCounter(
    "leadvirt_knowledge_live_retrieval_outcomes_total",
    "Total live Knowledge v2 retrieval outcomes.",
    ["corpus", "backend", "outcome", "reason", "locale"],
    labels,
  );
  observeHistogram(
    "leadvirt_knowledge_live_retrieval_duration_seconds",
    "Live Knowledge v2 retrieval duration in seconds.",
    ["corpus", "backend", "outcome", "locale"],
    [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    labels,
    boundedMetricValue(input.durationMs / 1000, 300),
  );
  observeHistogram(
    "leadvirt_knowledge_live_retrieval_candidate_count",
    "Candidate count observed during live Knowledge v2 retrieval.",
    ["corpus", "backend", "outcome", "locale"],
    [0, 1, 2, 4, 8, 16, 32, 64, 128, 256],
    labels,
    boundedMetricValue(input.candidateCount, 10_000),
  );
  observeHistogram(
    "leadvirt_knowledge_live_retrieval_selected_count",
    "Selected evidence count observed during live Knowledge v2 retrieval.",
    ["corpus", "backend", "outcome", "locale"],
    [0, 1, 2, 4, 8, 16, 32, 64],
    labels,
    boundedMetricValue(input.selectedCount, 10_000),
  );
}

export function recordStructuredKnowledgeAnswerGate(input: {
  result: string;
  reason: string;
  risk: string;
  locale: string;
  citationCount: number;
  availableEvidenceCount: number;
}) {
  const result = stableKnowledgeLabel(input.result, knowledgeAnswerResults, "blocked");
  const labels = {
    corpus: "structured_v2",
    result,
    reason: stableKnowledgeReason(input.reason),
    risk: stableKnowledgeLabel(input.risk, knowledgeRiskLevels, "unknown"),
    locale: knowledgeLocale(input.locale),
  };
  const citationCount = boundedMetricValue(input.citationCount, 10_000);
  const evidenceCount = boundedMetricValue(input.availableEvidenceCount, 10_000);
  const coverage = evidenceCount > 0 ? Math.min(1, citationCount / evidenceCount) : 0;
  incrementCounter(
    "leadvirt_knowledge_live_answer_gate_total",
    "Total live Knowledge v2 grounded-answer gate outcomes.",
    ["corpus", "result", "reason", "risk", "locale"],
    labels,
  );
  observeHistogram(
    "leadvirt_knowledge_live_answer_citation_count",
    "Validated citation count per live Knowledge v2 answer.",
    ["corpus", "result", "risk", "locale"],
    [0, 1, 2, 4, 8, 16, 32, 64],
    labels,
    citationCount,
  );
  observeHistogram(
    "leadvirt_knowledge_live_answer_citation_coverage_ratio",
    "Share of available evidence referenced by validated live-answer citations.",
    ["corpus", "result", "risk", "locale"],
    [0, 0.25, 0.5, 0.75, 1],
    labels,
    coverage,
  );
}

export function recordAiGraphRun(input: {
  source: string;
  status: string;
  handoffRequired: boolean;
  durationMs: number;
  qualityReason?: string | undefined;
  qualityPassed?: boolean | undefined;
}) {
  const labels = {
    source: input.source,
    status: input.status,
    handoff: String(input.handoffRequired),
    quality: input.qualityReason ?? "unknown",
  };
  incrementCounter(
    "leadvirt_ai_graph_runs_total",
    "Total AI reply graph runs.",
    ["source", "status", "handoff", "quality"],
    labels,
  );
  observeHistogram(
    "leadvirt_ai_graph_duration_seconds",
    "AI reply graph duration in seconds.",
    ["source", "status", "handoff", "quality"],
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    labels,
    input.durationMs / 1000,
  );

  if (input.qualityReason) {
    incrementCounter(
      "leadvirt_ai_quality_gate_total",
      "Total AI quality gate outcomes.",
      ["source", "result", "reason"],
      {
        source: input.source,
        result: input.qualityPassed ? "passed" : "blocked",
        reason: input.qualityReason,
      },
    );
  }
}

export function recordAiBudgetBlocked(input: {
  budgetType: string;
  actionType: string;
  provider: string;
  model: string;
  requestedTokens: number;
}) {
  const labels = {
    budget: input.budgetType,
    action: input.actionType,
    provider: input.provider,
    model: input.model,
  };

  incrementCounter(
    "leadvirt_ai_budget_blocks_total",
    "Total AI calls blocked by tenant token budgets.",
    ["budget", "action", "provider", "model"],
    labels,
  );
  incrementCounter(
    "leadvirt_ai_budget_blocked_tokens_total",
    "Total estimated AI tokens blocked by tenant token budgets.",
    ["budget", "action", "provider", "model"],
    labels,
    input.requestedTokens,
  );
}

export function recordChannelDelivery(input: {
  source: string;
  status: string;
  durationMs: number;
}) {
  const labels = { source: input.source, status: input.status };
  incrementCounter(
    "leadvirt_channel_delivery_total",
    "Total outbound channel delivery outcomes.",
    ["source", "status"],
    labels,
  );
  observeHistogram(
    "leadvirt_channel_delivery_duration_seconds",
    "Outbound channel delivery duration in seconds.",
    ["source", "status"],
    [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    labels,
    input.durationMs / 1000,
  );
}
