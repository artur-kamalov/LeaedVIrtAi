import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AiVerbosity = "low" | "medium" | "high";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("local"),
  PORT: z.coerce.number().int().positive().default(4001),
  APP_URL: z.string().url().default("http://localhost:3001"),
  API_URL: z.string().url().default("http://localhost:4001"),
  CORS_ORIGINS: z.string().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  AUTH_MODE: z.enum(["mock", "clerk", "local"]).default("mock"),
  AI_PROVIDER: z.enum(["mock", "openai", "other"]).default("mock"),
  AI_ENABLE_REAL_PROVIDER: booleanEnv.default(false),
  AI_REPLY_MODE: z.enum(["sync", "queue"]).default("sync"),
  AI_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default("gpt-5.5"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).default("low"),
  AI_VERBOSITY: z.enum(["low", "medium", "high"]).default("low"),
  AI_TENANT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
  AI_TENANT_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
  RAG_QDRANT_ENABLED: booleanEnv.default(false),
  RAG_QDRANT_URL: z.string().url().default("http://localhost:6333"),
  RAG_QDRANT_API_KEY: z.string().optional(),
  RAG_QDRANT_COLLECTION: z.string().default("leadvirt_knowledge"),
  STORAGE_PROVIDER: z.enum(["local", "s3", "r2"]).default("local"),
  BILLING_MODE: z.enum(["manual", "stripe", "yookassa"]).default("manual"),
  JWT_SECRET: z.string().default("dev-change-me"),
  ENCRYPTION_KEY: z.string().default("dev-32-byte-key-change-in-production")
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
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === "\"" ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"") : unquoted;
  }

  return trimmed;
}

export function loadEnvFile(options: { path?: string; override?: boolean } = {}): string | null {
  const envPath = options.path ? resolve(options.path) : findEnvFile();
  if (!envPath || !existsSync(envPath)) return null;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
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
