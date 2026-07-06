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

export function incrementCounter(name: string, help: string, labelNames: string[], labels: Labels, value = 1) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = { kind: "counter", name, help, labelNames, values: new Map() };
    metrics.set(name, metric);
  }

  if (metric.kind !== "counter") {
    throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);
  }

  const normalized = normalizeLabels(metric.labelNames, labels);
  const key = labelKey(metric.labelNames, normalized);
  const current = metric.values.get(key) ?? { labels: normalized, value: 0 };
  current.value += value;
  metric.values.set(key, current);
}

export function observeHistogram(name: string, help: string, labelNames: string[], buckets: number[], labels: Labels, value: number) {
  let metric = metrics.get(name);
  if (!metric) {
    metric = { kind: "histogram", name, help, labelNames, buckets: [...buckets].sort((left, right) => left - right), values: new Map() };
    metrics.set(name, metric);
  }

  if (metric.kind !== "histogram") {
    throw new Error(`Metric ${name} is already registered as ${metric.kind}.`);
  }

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

export function recordHttpRequest(input: { method: string; route: string; statusCode: number; durationMs: number }) {
  const labels = {
    method: input.method,
    route: input.route,
    status: String(input.statusCode)
  };

  incrementCounter("leadvirt_http_requests_total", "Total API HTTP requests.", ["method", "route", "status"], labels);
  observeHistogram(
    "leadvirt_http_request_duration_seconds",
    "API HTTP request duration in seconds.",
    ["method", "route", "status"],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    labels,
    input.durationMs / 1000
  );
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
