import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

function parseEnv(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const separator = value.indexOf("=");
    if (separator <= 0) continue;
    const key = value.slice(0, separator).trim();
    let raw = value.slice(separator + 1).trim();
    if (
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ) {
      raw = raw.slice(1, -1);
    }
    values[key] = raw;
  }
  return values;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validGroundedUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
      url.hostname.toLowerCase(),
    );
    return Boolean(url.hostname) && (url.protocol === "https:" || (url.protocol === "http:" && loopback));
  } catch {
    return false;
  }
}

function validQueryHmacKeyring(activeKeyId, encodedKeys) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(activeKeyId)) return false;
  try {
    const keys = JSON.parse(encodedKeys);
    if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return false;
    const entries = Object.entries(keys);
    const forbiddenIds = new Set(["local-query-hmac-v1", "acceptance-query-v1"]);
    const forbiddenKeys = new Set([
      "TGVhZFZpcnQgbG9jYWwgcXVlcnkgSE1BQyBrZXkhISE=",
      "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=",
    ]);
    return (
      entries.length > 0 &&
      Object.hasOwn(keys, activeKeyId) &&
      !forbiddenIds.has(activeKeyId) &&
      entries.every(
        ([keyId, value]) =>
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(keyId) &&
          !forbiddenIds.has(keyId) &&
          typeof value === "string" &&
          !forbiddenKeys.has(value) &&
          /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
          Buffer.from(value, "base64").byteLength === 32 &&
          Buffer.from(value, "base64").toString("base64") === value,
      )
    );
  } catch {
    return false;
  }
}

const classifications = new Set(["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"]);

const path = process.argv[2] ?? process.env.LEADVIRT_ENV_FILE;
if (!path) {
  console.error("Knowledge v2 readiness failed: env file path is required.");
  process.exit(1);
}

const fileEnv = parseEnv(path);
const env = { ...fileEnv, ...process.env };
if (
  !validQueryHmacKeyring(
    (fileEnv.KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID ?? "").trim(),
    (fileEnv.KNOWLEDGE_QUERY_HMAC_KEYS ?? "").trim(),
  )
) {
  console.error(
    "Knowledge v2 readiness failed: KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID, KNOWLEDGE_QUERY_HMAC_KEYS (active 32-byte base64 keyring)",
  );
  process.exit(1);
}
const knowledgeEnabled =
  enabled(env.KNOWLEDGE_WEBSITE_IMPORT_ENABLED) ||
  enabled(env.KNOWLEDGE_FILE_IMPORT_ENABLED) ||
  enabled(env.RAG_QDRANT_ENABLED) ||
  env.RAG_RETRIEVAL_MODE === "qdrant";

if (!knowledgeEnabled) {
  console.log("Knowledge v2 readiness skipped: website import and Qdrant retrieval are disabled.");
  process.exit(0);
}

const missing = [];
if (!enabled(env.KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED)) {
  missing.push("KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED=true");
}
if (!enabled(env.RAG_QDRANT_ENABLED)) missing.push("RAG_QDRANT_ENABLED=true");
if (env.RAG_RETRIEVAL_MODE !== "qdrant") missing.push("RAG_RETRIEVAL_MODE=qdrant");
if (!validUrl(env.RAG_QDRANT_URL ?? "")) missing.push("RAG_QDRANT_URL");
if (!(env.AI_API_KEY ?? "").trim()) missing.push("AI_API_KEY");
if (!(env.KNOWLEDGE_V2_EMBEDDING_MODEL ?? "").trim()) {
  missing.push("KNOWLEDGE_V2_EMBEDDING_MODEL");
}
if (["", "unconfigured"].includes((env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT ?? "").trim())) {
  missing.push("KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT");
}
if (["", "unconfigured"].includes((env.KNOWLEDGE_V2_EMBEDDING_REGION ?? "").trim())) {
  missing.push("KNOWLEDGE_V2_EMBEDDING_REGION");
}
if (!(env.KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION ?? "").trim()) {
  missing.push("KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION");
}
if (!(env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ?? "").trim()) {
  missing.push("KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION");
}
for (const name of [
  "KNOWLEDGE_V2_EXTERNAL_EMBEDDING_MAX_CLASSIFICATION",
  "KNOWLEDGE_V2_QUERY_EMBEDDING_MAX_CLASSIFICATION",
  "KNOWLEDGE_V2_RERANKER_MAX_CLASSIFICATION",
]) {
  if (!classifications.has((env[name] ?? "").trim())) missing.push(name);
}
if (!enabled(env.KNOWLEDGE_V2_RERANKER_APPROVED)) {
  missing.push("KNOWLEDGE_V2_RERANKER_APPROVED=true");
}
if (!validUrl(env.KNOWLEDGE_V2_RERANKER_ENDPOINT ?? "")) {
  missing.push("KNOWLEDGE_V2_RERANKER_ENDPOINT");
}
for (const name of [
  "KNOWLEDGE_V2_RERANKER_PROVIDER",
  "KNOWLEDGE_V2_RERANKER_MODEL",
  "KNOWLEDGE_V2_RERANKER_VERSION",
  "KNOWLEDGE_V2_RERANKER_REGION",
]) {
  if (["", "unconfigured"].includes((env[name] ?? "").trim())) missing.push(name);
}
const dimensions = Number(env.KNOWLEDGE_V2_EMBEDDING_DIMENSIONS);
if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 65_536) {
  missing.push("KNOWLEDGE_V2_EMBEDDING_DIMENSIONS");
}
if (!isAbsolute((env.KNOWLEDGE_OBJECT_STORE_PATH ?? "").trim())) {
  missing.push("KNOWLEDGE_OBJECT_STORE_PATH (absolute)");
}
if (!/^[A-Za-z0-9+/]{43}=$/u.test((env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY ?? "").trim())) {
  missing.push("KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY (32-byte base64)");
}
if (!(env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID ?? "").trim()) {
  missing.push("KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID");
}
if (enabled(env.KNOWLEDGE_FILE_IMPORT_ENABLED)) {
  if (!enabled(env.KNOWLEDGE_FILE_SCANNER_APPROVED)) {
    missing.push("KNOWLEDGE_FILE_SCANNER_APPROVED=true");
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u.test(
    (env.KNOWLEDGE_FILE_SCANNER_HOST ?? "").trim(),
  )) {
    missing.push("KNOWLEDGE_FILE_SCANNER_HOST");
  }
  const scannerPort = Number(env.KNOWLEDGE_FILE_SCANNER_PORT);
  if (!Number.isInteger(scannerPort) || scannerPort < 1 || scannerPort > 65_535) {
    missing.push("KNOWLEDGE_FILE_SCANNER_PORT");
  }
  if (!(env.KNOWLEDGE_FILE_SCANNER_VERSION ?? "").trim()) {
    missing.push("KNOWLEDGE_FILE_SCANNER_VERSION");
  }
  const maxFileBytes = Number(env.KNOWLEDGE_MAX_FILE_BYTES);
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 10 * 1024 * 1024) {
    missing.push("KNOWLEDGE_MAX_FILE_BYTES");
  }
  const uploadStreamTimeout = Number(env.KNOWLEDGE_FILE_UPLOAD_STREAM_TIMEOUT_MS);
  if (!Number.isInteger(uploadStreamTimeout) || uploadStreamTimeout < 1000 || uploadStreamTimeout > 120_000) {
    missing.push("KNOWLEDGE_FILE_UPLOAD_STREAM_TIMEOUT_MS");
  }
}
if (enabled(env.KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED)) {
  if (!validGroundedUrl(env.KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL ?? "")) {
    missing.push("KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL (HTTPS)");
  }
  if (!(env.KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY ?? "").trim()) {
    missing.push("KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY");
  }
  for (const name of [
    "KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_REGION",
    "KNOWLEDGE_V2_MODEL_PROCESSOR_POLICY_VERSION",
    "KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION",
  ]) {
    if (["", "unconfigured"].includes((env[name] ?? "").trim())) missing.push(name);
  }
  if (!classifications.has((env.KNOWLEDGE_V2_MODEL_PROCESSOR_MAX_CLASSIFICATION ?? "").trim())) {
    missing.push("KNOWLEDGE_V2_MODEL_PROCESSOR_MAX_CLASSIFICATION");
  }
  const timeout = Number(env.KNOWLEDGE_V2_GROUNDED_ANSWER_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120_000) {
    missing.push("KNOWLEDGE_V2_GROUNDED_ANSWER_TIMEOUT_MS (100..120000)");
  }
}

if (missing.length > 0) {
  console.error(`Knowledge v2 readiness failed: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Knowledge v2 staging readiness passed.");
