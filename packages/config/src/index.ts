import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { parseRedisConnectionUrl } from "./redis.js";

export {
  describeRedisEndpoint,
  parseRedisConnectionUrl,
  type RedisConnectionConfiguration,
} from "./redis.js";

export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AiVerbosity = "low" | "medium" | "high";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const optionalUrlEnv = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z.string().url().optional(),
);

const redisUrlEnv = z.string().min(1).superRefine((value, context) => {
  try {
    parseRedisConnectionUrl(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Redis URL is invalid.",
    });
  }
});

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("local"),
  API_DEPLOYMENT_PREFLIGHT: booleanEnv.default(false),
  PORT: z.coerce.number().int().positive().default(4001),
  APP_URL: z.string().url().default("http://localhost:3001"),
  API_URL: z.string().url().default("http://localhost:4001"),
  CORS_ORIGINS: z.string().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: redisUrlEnv.default("redis://localhost:6380"),
  AUTH_MODE: z.enum(["mock", "clerk", "local"]).default("mock"),
  AI_PROVIDER: z.enum(["mock", "openai", "other"]).default("mock"),
  AI_ENABLE_REAL_PROVIDER: booleanEnv.default(false),
  AI_REPLY_MODE: z.literal("queue").default("queue"),
  AI_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default("gpt-5.5"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).default("low"),
  AI_VERBOSITY: z.enum(["low", "medium", "high"]).default("low"),
  AI_TENANT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
  AI_TENANT_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
  RAG_RETRIEVAL_MODE: z.enum(["database", "qdrant"]).optional(),
  RAG_QDRANT_ENABLED: booleanEnv.default(false),
  RAG_QDRANT_URL: z.string().url().default("http://localhost:6333"),
  RAG_QDRANT_API_KEY: z.string().optional(),
  RAG_QDRANT_COLLECTION: z.string().default("leadvirt_knowledge"),
  RAG_QDRANT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  RAG_MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.05),
  RAG_CANDIDATE_LIMIT: z.coerce.number().int().min(1).max(200).default(50),
  KNOWLEDGE_V2_EMBEDDING_MODEL: z.string().min(1).max(200).default("text-embedding-3-small"),
  KNOWLEDGE_V2_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(65_536).default(1536),
  KNOWLEDGE_V2_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(256).default(64),
  KNOWLEDGE_V2_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT: z.string().min(1).max(200).default("unconfigured"),
  KNOWLEDGE_V2_EMBEDDING_REGION: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION: z
    .string()
    .min(1)
    .max(100)
    .default("external-embedding-v1"),
  KNOWLEDGE_V2_EXTERNAL_EMBEDDING_MAX_CLASSIFICATION: z
    .enum(["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"])
    .default("INTERNAL"),
  KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION: z
    .string()
    .min(1)
    .max(100)
    .default("external-retrieval-v1"),
  KNOWLEDGE_V2_QUERY_EMBEDDING_MAX_CLASSIFICATION: z
    .enum(["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"])
    .default("INTERNAL"),
  KNOWLEDGE_V2_RERANKER_MAX_CLASSIFICATION: z
    .enum(["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"])
    .default("INTERNAL"),
  KNOWLEDGE_V2_SPARSE_MAX_NON_ZERO: z.coerce.number().int().min(1).max(65_536).default(2048),
  KNOWLEDGE_V2_EMBEDDING_CACHE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  KNOWLEDGE_V2_RERANKER_APPROVED: booleanEnv.default(false),
  KNOWLEDGE_V2_RERANKER_ENDPOINT: optionalUrlEnv,
  KNOWLEDGE_V2_RERANKER_API_KEY: z.string().optional(),
  KNOWLEDGE_V2_RERANKER_PROVIDER: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_RERANKER_MODEL: z.string().min(1).max(200).default("unconfigured"),
  KNOWLEDGE_V2_RERANKER_VERSION: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_RERANKER_REGION: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_RERANKER_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5000),
  KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED: booleanEnv.default(false),
  KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL: optionalUrlEnv,
  KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY: z.string().optional(),
  KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL: z.string().min(1).max(200).default("unconfigured"),
  KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_GROUNDED_ANSWER_REGION: z.string().min(1).max(100).default("unconfigured"),
  KNOWLEDGE_V2_MODEL_PROCESSOR_POLICY_VERSION: z
    .string()
    .min(1)
    .max(100)
    .default("external-model-v1"),
  KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION: z
    .string()
    .min(1)
    .max(100)
    .default("grounded-answer-v1"),
  KNOWLEDGE_V2_MODEL_PROCESSOR_MAX_CLASSIFICATION: z
    .enum(["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"])
    .default("INTERNAL"),
  KNOWLEDGE_V2_GROUNDED_ANSWER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(20_000),
  KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED: booleanEnv.default(false),
  KNOWLEDGE_WEBSITE_IMPORT_ENABLED: booleanEnv.default(false),
  KNOWLEDGE_WEBSITE_EGRESS_READY: booleanEnv.default(false),
  KNOWLEDGE_OBJECT_STORE_PATH: z.string().min(1).optional(),
  KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY: z.string().min(1).optional(),
  KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
    .default("knowledge-artifact-v1"),
  KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
      .optional(),
  ),
  KNOWLEDGE_QUERY_HMAC_KEYS: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().min(1).optional(),
  ),
  KNOWLEDGE_MAX_WEBSITE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(16 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  KNOWLEDGE_WEBSITE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_ENABLED: booleanEnv.default(false),
  KNOWLEDGE_FILE_IMPORT_ENABLED: booleanEnv.default(false),
  KNOWLEDGE_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  KNOWLEDGE_FILE_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  KNOWLEDGE_FILE_UPLOAD_STREAM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(30_000),
  KNOWLEDGE_FILE_SCANNER_APPROVED: booleanEnv.default(false),
  KNOWLEDGE_FILE_SCANNER_HOST: z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)
    .optional(),
  KNOWLEDGE_FILE_SCANNER_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  KNOWLEDGE_FILE_SCANNER_VERSION: z.string().min(1).max(100).default("clamav"),
  KNOWLEDGE_FILE_SCANNER_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  BUSINESS_IMPORT_ENABLED: booleanEnv.default(false),
  BUSINESS_IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  BUSINESS_IMPORT_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  BUSINESS_IMPORT_MAX_PENDING_PER_TENANT: z.coerce.number().int().min(1).max(20).default(5),
  BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED: booleanEnv.default(false),
  BUSINESS_IMPORT_PARSER_APPROVED: booleanEnv.default(false),
  BUSINESS_IMPORT_PARSER_URL: optionalUrlEnv,
  BUSINESS_IMPORT_PARSER_VERSION: z.string().min(1).max(100).default("unconfigured"),
  BUSINESS_IMPORT_PARSER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(10 * 60_000)
    .default(5 * 60_000),
  OTEL_ENABLED: booleanEnv.default(false),
  OTEL_COLLECTOR_HEALTH_URL: optionalUrlEnv,
  STORAGE_PROVIDER: z.enum(["local", "s3", "r2"]).default("local"),
  BILLING_MODE: z.enum(["manual", "stripe", "yookassa"]).default("manual"),
  JWT_SECRET: z.string().default("dev-change-me"),
  ENCRYPTION_KEY: z.string().default("dev-32-byte-key-change-in-production"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(env);
}

function findEnvFile(startDir = process.cwd()): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === '"'
      ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"')
      : unquoted;
  }

  return trimmed;
}

export function loadEnvFile(options: { path?: string; override?: boolean } = {}): string | null {
  const envPath = options.path ? resolve(options.path) : findEnvFile();
  if (!envPath || !existsSync(envPath)) return null;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    const value = parseEnvValue(withoutExport.slice(separator + 1));
    if (!key || (!options.override && process.env[key] !== undefined)) continue;
    process.env[key] = value;
  }

  return envPath;
}

export function getCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
