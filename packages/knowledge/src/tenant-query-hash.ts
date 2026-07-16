import { createHmac, timingSafeEqual } from "node:crypto";

export const KNOWLEDGE_V2_QUERY_HASH_VERSION = "knowledge-query-hmac-sha256-v1" as const;

export const KNOWLEDGE_V2_QUERY_HASH_PURPOSES = {
  ORIGINAL_QUERY: "ORIGINAL_QUERY",
  PROCESSOR_QUERY: "PROCESSOR_QUERY",
  TEST_QUERY: "TEST_QUERY",
} as const;

export type KnowledgeV2QueryHashPurpose =
  (typeof KNOWLEDGE_V2_QUERY_HASH_PURPOSES)[keyof typeof KNOWLEDGE_V2_QUERY_HASH_PURPOSES];

export interface KnowledgeV2QueryHashBinding {
  hash: string;
  keyId: string;
  version: typeof KNOWLEDGE_V2_QUERY_HASH_VERSION;
}

export interface KnowledgeV2QueryHashInput {
  tenantId: string;
  purpose: KnowledgeV2QueryHashPurpose;
  value: string;
}

export interface KnowledgeV2QueryHashVerificationInput extends KnowledgeV2QueryHashInput {
  binding: KnowledgeV2QueryHashBinding;
}

export interface KnowledgeV2QueryHashKeyCheck {
  readonly keyId: string;
  readonly version: typeof KNOWLEDGE_V2_QUERY_HASH_VERSION;
  readonly keyCheck: string;
}

export interface KnowledgeV2QueryHashKeyring {
  readonly activeKeyId: string;
  readonly verificationKeyIds: readonly string[];
  readonly configuredKeyChecks: readonly KnowledgeV2QueryHashKeyCheck[];
  hash(input: KnowledgeV2QueryHashInput): KnowledgeV2QueryHashBinding;
  verify(input: KnowledgeV2QueryHashVerificationInput): boolean;
}

export interface KnowledgeV2QueryHashKeyringInput {
  activeKeyId: string;
  keys: Readonly<Record<string, string | Uint8Array>>;
}

const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const base64KeyPattern = /^[A-Za-z0-9+/]{43}=$/u;
const localKeyId = "local-query-hmac-v1";
const localKey = "TGVhZFZpcnQgbG9jYWwgcXVlcnkgSE1BQyBrZXkhISE=";
const acceptanceKeyId = "acceptance-query-v1";
const acceptanceKey = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=";
const purposes = new Set<string>(Object.values(KNOWLEDGE_V2_QUERY_HASH_PURPOSES));

function canonical(parts: readonly string[]) {
  return JSON.stringify(parts);
}

function validTenantId(value: string) {
  return value.length > 0 && value.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(value);
}

export function parseKnowledgeV2QueryHashBinding(
  value: unknown,
): KnowledgeV2QueryHashBinding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record = value as Record<PropertyKey, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== 3 ||
    !keys.includes("hash") ||
    !keys.includes("keyId") ||
    !keys.includes("version") ||
    keys.some((key) => typeof key !== "string") ||
    typeof record.hash !== "string" ||
    !digestPattern.test(record.hash) ||
    typeof record.keyId !== "string" ||
    !keyIdPattern.test(record.keyId) ||
    record.version !== KNOWLEDGE_V2_QUERY_HASH_VERSION
  ) {
    return null;
  }
  return {
    hash: record.hash,
    keyId: record.keyId,
    version: record.version,
  };
}

export function equalKnowledgeV2QueryHashBindings(
  left: KnowledgeV2QueryHashBinding,
  right: KnowledgeV2QueryHashBinding,
) {
  return left.hash === right.hash && left.keyId === right.keyId && left.version === right.version;
}

function decodeKey(value: string | Uint8Array) {
  if (typeof value !== "string") {
    if (value.byteLength !== 32) throw new Error("Knowledge query HMAC keys must be 32 bytes.");
    return Buffer.from(value);
  }
  if (!base64KeyPattern.test(value)) {
    throw new Error("Knowledge query HMAC keys must be canonical 32-byte base64 values.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    throw new Error("Knowledge query HMAC keys must be canonical 32-byte base64 values.");
  }
  return decoded;
}

function assertHashInput(input: KnowledgeV2QueryHashInput) {
  if (!validTenantId(input.tenantId))
    throw new Error("A valid tenant ID is required to hash a query.");
  if (!purposes.has(input.purpose)) throw new Error("A valid query hash purpose is required.");
  if (typeof input.value !== "string") throw new Error("A string query value is required.");
}

function hashWithKey(input: KnowledgeV2QueryHashInput, keyId: string, key: Uint8Array) {
  const tenantKey = createHmac("sha256", key)
    .update(
      canonical([
        "leadvirt.knowledge-query.tenant-key.v1",
        KNOWLEDGE_V2_QUERY_HASH_VERSION,
        keyId,
        input.tenantId,
      ]),
      "utf8",
    )
    .digest();
  return createHmac("sha256", tenantKey)
    .update(
      canonical([
        "leadvirt.knowledge-query.digest.v1",
        KNOWLEDGE_V2_QUERY_HASH_VERSION,
        input.purpose,
        input.value,
      ]),
      "utf8",
    )
    .digest("hex");
}

function keyCheckWithKey(keyId: string, key: Uint8Array) {
  return createHmac("sha256", key)
    .update(
      canonical(["leadvirt.knowledge-query.key-check.v1", KNOWLEDGE_V2_QUERY_HASH_VERSION, keyId]),
      "utf8",
    )
    .digest("hex");
}

export function createKnowledgeV2QueryHashKeyring(
  input: KnowledgeV2QueryHashKeyringInput,
): KnowledgeV2QueryHashKeyring {
  if (!keyIdPattern.test(input.activeKeyId)) {
    throw new Error("A valid active knowledge query HMAC key ID is required.");
  }
  const entries = Object.entries(input.keys);
  if (entries.length === 0) throw new Error("At least one knowledge query HMAC key is required.");
  const keys = new Map<string, Buffer>();
  for (const [keyId, value] of entries) {
    if (!keyIdPattern.test(keyId)) throw new Error("A knowledge query HMAC key ID is invalid.");
    keys.set(keyId, decodeKey(value));
  }
  if (!keys.has(input.activeKeyId)) {
    throw new Error("The active knowledge query HMAC key is not present in the keyring.");
  }
  const configuredKeyChecks = Object.freeze(
    [...keys.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyId, key]) =>
        Object.freeze({
          keyId,
          version: KNOWLEDGE_V2_QUERY_HASH_VERSION,
          keyCheck: keyCheckWithKey(keyId, key),
        }),
      ),
  );

  return Object.freeze({
    activeKeyId: input.activeKeyId,
    verificationKeyIds: Object.freeze(configuredKeyChecks.map(({ keyId }) => keyId)),
    configuredKeyChecks,
    hash(hashInput: KnowledgeV2QueryHashInput): KnowledgeV2QueryHashBinding {
      assertHashInput(hashInput);
      const key = keys.get(input.activeKeyId);
      if (!key) throw new Error("The active knowledge query HMAC key is unavailable.");
      return {
        hash: hashWithKey(hashInput, input.activeKeyId, key),
        keyId: input.activeKeyId,
        version: KNOWLEDGE_V2_QUERY_HASH_VERSION,
      };
    },
    verify(verification: KnowledgeV2QueryHashVerificationInput) {
      try {
        assertHashInput(verification);
        const binding = verification.binding;
        if (
          binding.version !== KNOWLEDGE_V2_QUERY_HASH_VERSION ||
          !keyIdPattern.test(binding.keyId) ||
          !digestPattern.test(binding.hash)
        ) {
          return false;
        }
        const key = keys.get(binding.keyId);
        if (!key) return false;
        const expected = Buffer.from(hashWithKey(verification, binding.keyId, key), "hex");
        const actual = Buffer.from(binding.hash, "hex");
        return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
      } catch {
        return false;
      }
    },
  });
}

function parsedEnvironmentKeys(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("KNOWLEDGE_QUERY_HMAC_KEYS must be a JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("KNOWLEDGE_QUERY_HMAC_KEYS must be a JSON object.");
  }
  const prototype: unknown = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("KNOWLEDGE_QUERY_HMAC_KEYS must be a plain JSON object.");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, key]) => typeof key !== "string")) {
    throw new Error("KNOWLEDGE_QUERY_HMAC_KEYS values must be base64 strings.");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function localFallbackAllowed(env: Readonly<Record<string, string | undefined>>) {
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") return false;
  const appEnv = (env.APP_ENV ?? "local").trim().toLowerCase();
  return ["", "local", "development", "test", "acceptance"].includes(appEnv);
}

export function createKnowledgeV2QueryHashKeyringFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KnowledgeV2QueryHashKeyring {
  const activeKeyId = env.KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID?.trim() ?? "";
  const encodedKeys = env.KNOWLEDGE_QUERY_HMAC_KEYS?.trim() ?? "";
  if (!activeKeyId && !encodedKeys && localFallbackAllowed(env)) {
    return createKnowledgeV2QueryHashKeyring({
      activeKeyId: localKeyId,
      keys: { [localKeyId]: localKey },
    });
  }
  if (!activeKeyId || !encodedKeys) {
    throw new Error(
      "KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID and KNOWLEDGE_QUERY_HMAC_KEYS are both required.",
    );
  }
  const keys = parsedEnvironmentKeys(encodedKeys);
  if (
    !localFallbackAllowed(env) &&
    (activeKeyId === localKeyId ||
      activeKeyId === acceptanceKeyId ||
      Object.entries(keys).some(
        ([keyId, value]) =>
          keyId === localKeyId ||
          keyId === acceptanceKeyId ||
          value === localKey ||
          value === acceptanceKey,
      ))
  ) {
    throw new Error("Development and acceptance query HMAC keys are forbidden in production.");
  }
  return createKnowledgeV2QueryHashKeyring({
    activeKeyId,
    keys,
  });
}
