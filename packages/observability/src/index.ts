import { context, SpanKind, SpanStatusCode, trace, type Attributes, type Span, type SpanOptions as ApiSpanOptions } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION
} from "@opentelemetry/semantic-conventions";

export { SpanKind };
export type { Attributes, Span };

interface StartOpenTelemetryOptions {
  serviceName: string;
  serviceVersion?: string | undefined;
  environment?: string | undefined;
}

interface SpanOptions {
  kind?: SpanKind | undefined;
  attributes?: Attributes | undefined;
}

export type SensitiveDataTag = "email" | "phone" | "secret" | "token";

export interface SensitiveDataRedaction<T> {
  redacted: T;
  tags: SensitiveDataTag[];
  redactedCount: number;
}

let sdk: NodeSDK | null = null;
const secretKeyPattern = /(password|secret|api[_-]?key|authorization|cookie|bearer|access[_-]?token|refresh[_-]?token|tokenhash|webhooksecret)/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const botTokenPattern = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const phoneLikePattern = /(?<![\w@])(?:\+?\d[\d\s().-]{7,}\d)(?![\w@])/g;

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function tracesEndpoint() {
  return process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || "";
}

export function startOpenTelemetry(options: StartOpenTelemetryOptions) {
  if (sdk || !enabled(process.env.OTEL_ENABLED)) return;

  const endpoint = tracesEndpoint();
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_NAMESPACE]: "leadvirt",
    [ATTR_SERVICE_VERSION]: options.serviceVersion ?? "0.1.0",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: options.environment ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "local"
  });

  sdk = new NodeSDK({
    resource,
    ...(endpoint ? { traceExporter: new OTLPTraceExporter({ url: endpoint }) } : {})
  });
  sdk.start();
  console.log(JSON.stringify({ module: "otel", status: "started", service: options.serviceName, endpoint: endpoint || "env/default" }));
}

export async function shutdownOpenTelemetry() {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}

export function startSpan(name: string, options: SpanOptions = {}) {
  return trace.getTracer("leadvirt").startSpan(name, apiSpanOptions(options));
}

export async function withSpan<T>(name: string, options: SpanOptions, run: (span: Span) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    trace.getTracer("leadvirt").startActiveSpan(name, apiSpanOptions(options), (span) => {
      void run(span)
        .then((result) => {
          span.setStatus({ code: SpanStatusCode.OK });
          resolve(result);
        })
        .catch((error: unknown) => {
          recordSpanError(span, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          span.end();
        });
    });
  });
}

function apiSpanOptions(options: SpanOptions): ApiSpanOptions {
  const spanOptions: ApiSpanOptions = {};
  if (options.kind !== undefined) spanOptions.kind = options.kind;
  if (options.attributes !== undefined) spanOptions.attributes = options.attributes;
  return spanOptions;
}

export function runWithSpanContext<T>(span: Span, run: () => T): T {
  return context.with(trace.setSpan(context.active(), span), run);
}

export function recordSpanError(span: Span, error: unknown) {
  if (error instanceof Error) {
    const exception = {
      name: error.name,
      message: redactSensitiveText(error.message),
      ...(error.stack ? { stack: redactSensitiveText(error.stack) } : {})
    };
    span.recordException(exception);
    span.setStatus({ code: SpanStatusCode.ERROR, message: redactSensitiveText(error.message) });
    return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: redactSensitiveText(String(error)) });
}

export function setSpanOk(span: Span) {
  span.setStatus({ code: SpanStatusCode.OK });
}

export function spanIds(span: Span) {
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId
  };
}

function redactPhoneCandidate(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || value.includes(":") || /\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return "[redacted-phone]";
}

function shouldRedactKey(key: string) {
  return secretKeyPattern.test(key);
}

function sortedTags(tags: Set<SensitiveDataTag>) {
  return Array.from(tags).sort();
}

function addTextTags(value: string, tags: Set<SensitiveDataTag>) {
  if (value.match(botTokenPattern)) tags.add("token");
  if (value.match(emailPattern)) tags.add("email");
  const phoneCandidates = value.match(phoneLikePattern) ?? [];
  if (phoneCandidates.some((candidate) => redactPhoneCandidate(candidate) === "[redacted-phone]")) {
    tags.add("phone");
  }
}

function collectSensitiveDataTags(value: unknown, tags: Set<SensitiveDataTag>, depth: number) {
  if (depth > 8) return;
  if (typeof value === "string") {
    addTextTags(value, tags);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveDataTags(item, tags, depth + 1);
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      tags.add("secret");
      continue;
    }
    collectSensitiveDataTags(item, tags, depth + 1);
  }
}

export function detectSensitiveTextTags(value: string): SensitiveDataTag[] {
  const tags = new Set<SensitiveDataTag>();
  addTextTags(value, tags);
  return sortedTags(tags);
}

export function detectSensitiveDataTags(value: unknown): SensitiveDataTag[] {
  const tags = new Set<SensitiveDataTag>();
  collectSensitiveDataTags(value, tags, 0);
  return sortedTags(tags);
}

export function redactSensitiveText(value: string) {
  return value
    .replace(botTokenPattern, "[redacted-token]")
    .replace(emailPattern, "[redacted-email]")
    .replace(phoneLikePattern, redactPhoneCandidate);
}

export function redactSensitiveData<T>(value: T): T {
  return redactSensitiveValue(value, 0) as T;
}

export function redactAndTagSensitiveData<T>(value: T): SensitiveDataRedaction<T> {
  const tags = detectSensitiveDataTags(value);
  return {
    redacted: redactSensitiveData(value),
    tags,
    redactedCount: tags.length
  };
}

function redactSensitiveValue(value: unknown, depth: number): unknown {
  if (depth > 8) return "[redacted-depth]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) ? "[redacted-secret]" : redactSensitiveValue(item, depth + 1);
  }
  return output;
}
