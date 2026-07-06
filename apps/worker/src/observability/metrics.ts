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
  values: Map<string, { labels: Record<string, string>; buckets: number[]; sum: number; count: number }>;
}

type Metric = CounterMetric | HistogramMetric;

const metrics = new Map<string, Metric>();

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

function incrementCounter(name: string, help: string, labelNames: string[], labels: Labels, value = 1) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = { kind: "counter", name, help, labelNames, values: new Map() };
    metrics.set(name, metric);
  }

  if (metric.kind !== "counter") throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);

  const normalized = normalizeLabels(metric.labelNames, labels);
  const key = labelKey(metric.labelNames, normalized);
  const current = metric.values.get(key) ?? { labels: normalized, value: 0 };
  current.value += value;
  metric.values.set(key, current);
}

function observeHistogram(name: string, help: string, labelNames: string[], buckets: number[], labels: Labels, value: number) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = { kind: "histogram", name, help, labelNames, buckets: [...buckets].sort((left, right) => left - right), values: new Map() };
    metrics.set(name, metric);
  }

  if (metric.kind !== "histogram") throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);

  const normalized = normalizeLabels(metric.labelNames, labels);
  const key = labelKey(metric.labelNames, normalized);
  const current =
    metric.values.get(key) ??
    {
      labels: normalized,
      buckets: metric.buckets.map(() => 0),
      sum: 0,
      count: 0
    };

  current.count += 1;
  current.sum += value;
  metric.buckets.forEach((bucket, index) => {
    if (value <= bucket) current.buckets[index] = (current.buckets[index] ?? 0) + 1;
  });
  metric.values.set(key, current);
}

function renderCounter(metric: CounterMetric) {
  const lines = [`# HELP ${metric.name} ${escapeHelp(metric.help)}`, `# TYPE ${metric.name} counter`];
  for (const value of metric.values.values()) {
    lines.push(`${metric.name}${renderLabels(value.labels)} ${value.value}`);
  }
  return lines;
}

function renderHistogram(metric: HistogramMetric) {
  const lines = [`# HELP ${metric.name} ${escapeHelp(metric.help)}`, `# TYPE ${metric.name} histogram`];
  for (const value of metric.values.values()) {
    metric.buckets.forEach((bucket, index) => {
      lines.push(`${metric.name}_bucket${renderLabels({ ...value.labels, le: String(bucket) })} ${value.buckets[index] ?? 0}`);
    });
    lines.push(`${metric.name}_bucket${renderLabels({ ...value.labels, le: "+Inf" })} ${value.count}`);
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

export function recordWorkerJob(input: { queue: string; status: "completed" | "failed" | "timeout"; durationMs: number }) {
  const labels = { queue: input.queue, status: input.status };
  incrementCounter("leadvirt_worker_jobs_total", "Total worker jobs processed.", ["queue", "status"], labels);
  observeHistogram(
    "leadvirt_worker_job_duration_seconds",
    "Worker job duration in seconds.",
    ["queue", "status"],
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    labels,
    input.durationMs / 1000
  );
}

export function recordDeadLetterJob(queue: string) {
  incrementCounter("leadvirt_worker_dlq_total", "Total worker jobs captured in DLQ audit.", ["queue"], { queue });
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
    quality: input.qualityReason ?? "unknown"
  };
  incrementCounter("leadvirt_ai_graph_runs_total", "Total AI reply graph runs.", ["source", "status", "handoff", "quality"], labels);
  observeHistogram(
    "leadvirt_ai_graph_duration_seconds",
    "AI reply graph duration in seconds.",
    ["source", "status", "handoff", "quality"],
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    labels,
    input.durationMs / 1000
  );

  if (input.qualityReason) {
    incrementCounter(
      "leadvirt_ai_quality_gate_total",
      "Total AI quality gate outcomes.",
      ["source", "result", "reason"],
      {
        source: input.source,
        result: input.qualityPassed ? "passed" : "blocked",
        reason: input.qualityReason
      }
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
    model: input.model
  };

  incrementCounter("leadvirt_ai_budget_blocks_total", "Total AI calls blocked by tenant token budgets.", ["budget", "action", "provider", "model"], labels);
  incrementCounter(
    "leadvirt_ai_budget_blocked_tokens_total",
    "Total estimated AI tokens blocked by tenant token budgets.",
    ["budget", "action", "provider", "model"],
    labels,
    input.requestedTokens
  );
}

export function recordChannelDelivery(input: { source: string; status: string; durationMs: number }) {
  const labels = { source: input.source, status: input.status };
  incrementCounter("leadvirt_channel_delivery_total", "Total outbound channel delivery outcomes.", ["source", "status"], labels);
  observeHistogram(
    "leadvirt_channel_delivery_duration_seconds",
    "Outbound channel delivery duration in seconds.",
    ["source", "status"],
    [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    labels,
    input.durationMs / 1000
  );
}
