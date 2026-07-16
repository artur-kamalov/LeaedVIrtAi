import type { KnowledgeV2SecurityClassification } from "@leadvirt/types";
import { hashKnowledgeValue } from "./legacy-hash-embedding.js";
import {
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  KNOWLEDGE_V2_QUERY_HASH_VERSION,
  type KnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "./tenant-query-hash.js";
import {
  classifyOperationalQuery,
  normalizeOperationalQueryText,
  OPERATIONAL_QUERY_CATEGORIES,
  type OperationalQueryCategory,
} from "./operational-query.js";

export const KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION =
  "knowledge-v2-processor-query-admission-v3" as const;
export const KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_RAW_CHARACTERS = 32_000;
export const KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_NORMALIZED_CHARACTERS = 4_096;
export const KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_INTENT_CHARACTERS = 128;

export const KNOWLEDGE_V2_PROCESSOR_QUERY_MODES = {
  PASSTHROUGH: "PASSTHROUGH",
  CANONICAL_OPERATIONAL: "CANONICAL_OPERATIONAL",
  REDACTED_PERSONAL: "REDACTED_PERSONAL",
} as const;

export type KnowledgeV2ProcessorQueryMode =
  (typeof KNOWLEDGE_V2_PROCESSOR_QUERY_MODES)[keyof typeof KNOWLEDGE_V2_PROCESSOR_QUERY_MODES];

export const KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS = {
  EMPTY_QUERY: "EMPTY_QUERY",
  RAW_QUERY_TOO_LARGE: "RAW_QUERY_TOO_LARGE",
  NORMALIZED_QUERY_TOO_LARGE: "NORMALIZED_QUERY_TOO_LARGE",
  INTENT_TOO_LARGE: "INTENT_TOO_LARGE",
  CREDENTIAL_DETECTED: "CREDENTIAL_DETECTED",
  PERSONAL_IDENTIFIER_DETECTED: "PERSONAL_IDENTIFIER_DETECTED",
  DESTRUCTIVE_PERSONAL_REDACTION: "DESTRUCTIVE_PERSONAL_REDACTION",
  CUSTOMER_PERSONAL_NON_OPERATIONAL: "CUSTOMER_PERSONAL_NON_OPERATIONAL",
  CLASSIFICATION_NOT_ADMITTED: "CLASSIFICATION_NOT_ADMITTED",
} as const;

export type KnowledgeV2ProcessorQueryDenialReason =
  (typeof KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS)[keyof typeof KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS];

type OperationalProcessorCategory = Exclude<OperationalQueryCategory, "STATIC_KNOWLEDGE">;

export const KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES = {
  [OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY]: "current availability lookup",
  [OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE]: "current booking status lookup",
  [OPERATIONAL_QUERY_CATEGORIES.INVENTORY]: "current inventory status lookup",
  [OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE]: "current order status lookup",
  [OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE]: "current account status lookup",
} as const satisfies Readonly<Record<OperationalProcessorCategory, string>>;

export interface KnowledgeV2ProcessorQueryAdmissionInput {
  tenantId: string;
  query: string;
  classification: KnowledgeV2SecurityClassification;
  intent?: string | null;
}

interface KnowledgeV2ProcessorQueryAdmissionBase {
  version: typeof KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION;
  classification: KnowledgeV2SecurityClassification;
  originalQueryHash: string;
  processorQueryHash: string | null;
  queryHashKeyId: string;
  queryHashVersion: typeof KNOWLEDGE_V2_QUERY_HASH_VERSION;
  admissionHash: string;
}

export interface KnowledgeV2ProcessorQueryAdmitted extends KnowledgeV2ProcessorQueryAdmissionBase {
  admitted: true;
  status: "ADMITTED";
  mode: KnowledgeV2ProcessorQueryMode;
  processorQuery: string;
  processorQueryHash: string;
  operationalCategory: OperationalQueryCategory;
  requiresLiveEvidence: boolean;
}

export interface KnowledgeV2ProcessorQueryDenied extends KnowledgeV2ProcessorQueryAdmissionBase {
  admitted: false;
  status: "DENIED";
  reason: KnowledgeV2ProcessorQueryDenialReason;
  processorQueryHash: null;
}

export type KnowledgeV2ProcessorQueryAdmission =
  | KnowledgeV2ProcessorQueryAdmitted
  | KnowledgeV2ProcessorQueryDenied;

export type KnowledgeV2ProcessorQueryAdmissionBinding =
  | {
      version: typeof KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION;
      status: "ADMITTED";
      mode: KnowledgeV2ProcessorQueryMode;
      originalQueryHash: string;
      processorQueryHash: string;
      queryHashKeyId: string;
      queryHashVersion: typeof KNOWLEDGE_V2_QUERY_HASH_VERSION;
      admissionHash: string;
    }
  | {
      version: typeof KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION;
      status: "DENIED";
      reason: KnowledgeV2ProcessorQueryDenialReason;
      originalQueryHash: string;
      processorQueryHash: null;
      queryHashKeyId: string;
      queryHashVersion: typeof KNOWLEDGE_V2_QUERY_HASH_VERSION;
      admissionHash: string;
    };

const admittedClassifications = new Set<KnowledgeV2SecurityClassification>([
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
]);
const minimizedClassifications = new Set<KnowledgeV2SecurityClassification>([
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
]);

const credentialPatterns: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/iu,
  /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/iu,
  /\bbearer\s+(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[A-Za-z0-9._~+/-]{20,}={0,2})\b/iu,
  /\b(?:password|passwd|pwd|api[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|webhook[ _-]?secret)\s*[:=]\s*(?:"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|[^\s,;]{4,})/iu,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^@\s/]+@/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
];

const personalIdentifierRules = [
  {
    pattern:
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu,
    placeholder: "[EMAIL]",
  },
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
    placeholder: "[UUID]",
  },
  {
    pattern:
      /\b(?:order|booking|reservation|account|customer|invoice|ticket|case|tracking|shipment|subscription)\s*(?:(?:id|number|no)\s*)?(?:[:#-]\s*)?(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]{3,}\b/giu,
    placeholder: "[REFERENCE]",
  },
  {
    pattern:
      /(?<![\p{Letter}\p{Number}])(?:\+\d[\d .()/-]{6,}\d|\(\d{2,4}\)[\d .-]{5,}\d|\d{3}[-. ]\d{3}[-. ]\d{4})(?![\p{Letter}\p{Number}])/gu,
    placeholder: "[PHONE]",
  },
  {
    pattern: /\b\d{13,19}\b/gu,
    placeholder: "[NUMERIC_ID]",
  },
] as const;

const personalIdentifierPlaceholderPattern = /\[(?:EMAIL|PHONE|UUID|REFERENCE|NUMERIC_ID)\]/gu;
const nonMeaningfulPersonalTokens = new Set([
  "a",
  "an",
  "account",
  "customer",
  "email",
  "for",
  "id",
  "identifier",
  "is",
  "me",
  "my",
  "no",
  "number",
  "of",
  "order",
  "phone",
  "please",
  "reference",
  "the",
  "to",
  "uuid",
]);

function normalizeProcessorQuery(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stableCanonicalValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableCanonicalValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableCanonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalAdmissionHash(value: unknown): string {
  return hashKnowledgeValue(stableCanonicalValue(value));
}

function hasExactKeys(value: Record<PropertyKey, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => actual.includes(key)) &&
    actual.every((key) => typeof key === "string")
  );
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isKnowledgeHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function invalidAdmissionBinding(): null {
  return null;
}

function containsPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function redactPersonalIdentifiers(value: string): { query: string; redacted: boolean } {
  let query = value;
  let redacted = false;
  for (const rule of personalIdentifierRules) {
    const next = query.replace(rule.pattern, rule.placeholder);
    if (next !== query) redacted = true;
    query = next;
  }
  return { query: normalizeProcessorQuery(query), redacted };
}

function hasMeaningfulPersonalText(value: string): boolean {
  const normalized = normalizeOperationalQueryText(
    value.replace(personalIdentifierPlaceholderPattern, " "),
  );
  if (!normalized) return false;
  return normalized
    .split(" ")
    .some((token) => token.length > 1 && !nonMeaningfulPersonalTokens.has(token));
}

function deniedAdmission(
  input: KnowledgeV2ProcessorQueryAdmissionInput,
  originalQuery: KnowledgeV2QueryHashBinding,
  reason: KnowledgeV2ProcessorQueryDenialReason,
): KnowledgeV2ProcessorQueryDenied {
  const binding = {
    version: KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION,
    status: "DENIED" as const,
    reason,
    originalQueryHash: originalQuery.hash,
    processorQueryHash: null,
    queryHashKeyId: originalQuery.keyId,
    queryHashVersion: originalQuery.version,
  };
  return {
    admitted: false,
    classification: input.classification,
    ...binding,
    admissionHash: canonicalAdmissionHash(binding),
  };
}

function admittedAdmission(
  input: KnowledgeV2ProcessorQueryAdmissionInput,
  originalQuery: KnowledgeV2QueryHashBinding,
  queryHashes: KnowledgeV2QueryHashKeyring,
  mode: KnowledgeV2ProcessorQueryMode,
  processorQuery: string,
  operationalCategory: OperationalQueryCategory,
  requiresLiveEvidence: boolean,
): KnowledgeV2ProcessorQueryAdmitted {
  const processorQueryHash = queryHashes.hash({
    tenantId: input.tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.PROCESSOR_QUERY,
    value: processorQuery,
  });
  if (
    processorQueryHash.keyId !== originalQuery.keyId ||
    processorQueryHash.version !== originalQuery.version
  ) {
    throw new Error("Knowledge query HMAC key rotation changed during admission.");
  }
  const binding = {
    version: KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION,
    status: "ADMITTED" as const,
    mode,
    originalQueryHash: originalQuery.hash,
    processorQueryHash: processorQueryHash.hash,
    queryHashKeyId: originalQuery.keyId,
    queryHashVersion: originalQuery.version,
  };
  return {
    admitted: true,
    classification: input.classification,
    ...binding,
    operationalCategory,
    requiresLiveEvidence,
    processorQuery,
    admissionHash: canonicalAdmissionHash(binding),
  };
}

export function admitKnowledgeV2ProcessorQuery(
  input: KnowledgeV2ProcessorQueryAdmissionInput,
  queryHashes: KnowledgeV2QueryHashKeyring,
): KnowledgeV2ProcessorQueryAdmission {
  const originalQueryHash = queryHashes.hash({
    tenantId: input.tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: input.query,
  });
  if (input.query.length > KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_RAW_CHARACTERS) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.RAW_QUERY_TOO_LARGE,
    );
  }

  const normalizedQuery = normalizeProcessorQuery(input.query);
  if (normalizedQuery.length === 0) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.EMPTY_QUERY,
    );
  }
  if (normalizedQuery.length > KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_NORMALIZED_CHARACTERS) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.NORMALIZED_QUERY_TOO_LARGE,
    );
  }

  const normalizedIntent = input.intent ? normalizeProcessorQuery(input.intent) : null;
  if (
    normalizedIntent !== null &&
    normalizedIntent.length > KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_INTENT_CHARACTERS
  ) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.INTENT_TOO_LARGE,
    );
  }

  if (
    containsPattern(normalizedQuery, credentialPatterns) ||
    (normalizedIntent !== null && containsPattern(normalizedIntent, credentialPatterns))
  ) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CREDENTIAL_DETECTED,
    );
  }

  if (!admittedClassifications.has(input.classification)) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CLASSIFICATION_NOT_ADMITTED,
    );
  }

  const operational = classifyOperationalQuery(normalizedQuery, normalizedIntent ?? undefined);
  const personalRedaction = redactPersonalIdentifiers(normalizedQuery);

  if (minimizedClassifications.has(input.classification)) {
    if (
      operational.category !== OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE &&
      operational.requiresLiveEvidence
    ) {
      const processorQuery =
        KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES[operational.category];
      return admittedAdmission(
        input,
        originalQueryHash,
        queryHashes,
        KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.CANONICAL_OPERATIONAL,
        processorQuery,
        operational.category,
        true,
      );
    }
    if (!personalRedaction.redacted) {
      return admittedAdmission(
        input,
        originalQueryHash,
        queryHashes,
        KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH,
        normalizedQuery,
        operational.category,
        operational.requiresLiveEvidence,
      );
    }
    if (personalRedaction.query.length > KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_NORMALIZED_CHARACTERS) {
      return deniedAdmission(
        input,
        originalQueryHash,
        KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.NORMALIZED_QUERY_TOO_LARGE,
      );
    }
    if (!hasMeaningfulPersonalText(personalRedaction.query)) {
      return deniedAdmission(
        input,
        originalQueryHash,
        KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.DESTRUCTIVE_PERSONAL_REDACTION,
      );
    }
    return admittedAdmission(
      input,
      originalQueryHash,
      queryHashes,
      KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.REDACTED_PERSONAL,
      personalRedaction.query,
      operational.category,
      operational.requiresLiveEvidence,
    );
  }

  if (personalRedaction.redacted) {
    return deniedAdmission(
      input,
      originalQueryHash,
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.PERSONAL_IDENTIFIER_DETECTED,
    );
  }

  return admittedAdmission(
    input,
    originalQueryHash,
    queryHashes,
    KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH,
    normalizedQuery,
    operational.category,
    operational.requiresLiveEvidence,
  );
}

export function projectKnowledgeV2ProcessorQueryAdmissionBinding(
  admission: KnowledgeV2ProcessorQueryAdmission,
): KnowledgeV2ProcessorQueryAdmissionBinding {
  if (admission.admitted) {
    return {
      version: admission.version,
      status: admission.status,
      mode: admission.mode,
      originalQueryHash: admission.originalQueryHash,
      processorQueryHash: admission.processorQueryHash,
      queryHashKeyId: admission.queryHashKeyId,
      queryHashVersion: admission.queryHashVersion,
      admissionHash: admission.admissionHash,
    };
  }
  return {
    version: admission.version,
    status: admission.status,
    reason: admission.reason,
    originalQueryHash: admission.originalQueryHash,
    processorQueryHash: null,
    queryHashKeyId: admission.queryHashKeyId,
    queryHashVersion: admission.queryHashVersion,
    admissionHash: admission.admissionHash,
  };
}

function parseKnowledgeV2ProcessorQueryAdmissionBindingValue(
  value: unknown,
): KnowledgeV2ProcessorQueryAdmissionBinding | null {
  if (!isPlainRecord(value)) return invalidAdmissionBinding();

  if (value.status === "ADMITTED") {
    const expectedKeys = [
      "version",
      "status",
      "mode",
      "originalQueryHash",
      "processorQueryHash",
      "queryHashKeyId",
      "queryHashVersion",
      "admissionHash",
    ] as const;
    if (
      !hasExactKeys(value, expectedKeys) ||
      value.version !== KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION ||
      !Object.values(KNOWLEDGE_V2_PROCESSOR_QUERY_MODES).includes(
        value.mode as KnowledgeV2ProcessorQueryMode,
      ) ||
      !isKnowledgeHash(value.originalQueryHash) ||
      !isKnowledgeHash(value.processorQueryHash) ||
      typeof value.queryHashKeyId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.queryHashKeyId) ||
      value.queryHashVersion !== KNOWLEDGE_V2_QUERY_HASH_VERSION ||
      !isKnowledgeHash(value.admissionHash)
    ) {
      return invalidAdmissionBinding();
    }
    const binding = {
      version: value.version,
      status: "ADMITTED" as const,
      mode: value.mode as KnowledgeV2ProcessorQueryMode,
      originalQueryHash: value.originalQueryHash,
      processorQueryHash: value.processorQueryHash,
      queryHashKeyId: value.queryHashKeyId,
      queryHashVersion: value.queryHashVersion,
    };
    if (canonicalAdmissionHash(binding) !== value.admissionHash) {
      return invalidAdmissionBinding();
    }
    return { ...binding, admissionHash: value.admissionHash };
  }

  if (value.status === "DENIED") {
    const expectedKeys = [
      "version",
      "status",
      "reason",
      "originalQueryHash",
      "processorQueryHash",
      "queryHashKeyId",
      "queryHashVersion",
      "admissionHash",
    ] as const;
    if (
      !hasExactKeys(value, expectedKeys) ||
      value.version !== KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION ||
      !Object.values(KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS).includes(
        value.reason as KnowledgeV2ProcessorQueryDenialReason,
      ) ||
      !isKnowledgeHash(value.originalQueryHash) ||
      value.processorQueryHash !== null ||
      typeof value.queryHashKeyId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.queryHashKeyId) ||
      value.queryHashVersion !== KNOWLEDGE_V2_QUERY_HASH_VERSION ||
      !isKnowledgeHash(value.admissionHash)
    ) {
      return invalidAdmissionBinding();
    }
    const binding = {
      version: value.version,
      status: "DENIED" as const,
      reason: value.reason as KnowledgeV2ProcessorQueryDenialReason,
      originalQueryHash: value.originalQueryHash,
      processorQueryHash: null,
      queryHashKeyId: value.queryHashKeyId,
      queryHashVersion: value.queryHashVersion,
    };
    if (canonicalAdmissionHash(binding) !== value.admissionHash) {
      return invalidAdmissionBinding();
    }
    return { ...binding, admissionHash: value.admissionHash };
  }

  return invalidAdmissionBinding();
}

export function parseKnowledgeV2ProcessorQueryAdmissionBinding(
  value: unknown,
): KnowledgeV2ProcessorQueryAdmissionBinding | null {
  try {
    return parseKnowledgeV2ProcessorQueryAdmissionBindingValue(value);
  } catch {
    return null;
  }
}

export function revalidateKnowledgeV2ProcessorQueryAdmission(
  input: KnowledgeV2ProcessorQueryAdmissionInput,
  value: unknown,
  queryHashes: KnowledgeV2QueryHashKeyring,
): KnowledgeV2ProcessorQueryAdmission | null {
  const binding = parseKnowledgeV2ProcessorQueryAdmissionBinding(value);
  if (
    !binding ||
    !queryHashes.verify({
      tenantId: input.tenantId,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
      value: input.query,
      binding: {
        hash: binding.originalQueryHash,
        keyId: binding.queryHashKeyId,
        version: binding.queryHashVersion,
      },
    })
  ) {
    return null;
  }

  const current = admitKnowledgeV2ProcessorQuery(input, queryHashes);
  if (current.status !== binding.status) return null;
  if (binding.status === "DENIED") {
    if (current.status !== "DENIED" || current.reason !== binding.reason) return null;
    return {
      ...current,
      originalQueryHash: binding.originalQueryHash,
      processorQueryHash: null,
      queryHashKeyId: binding.queryHashKeyId,
      queryHashVersion: binding.queryHashVersion,
      admissionHash: binding.admissionHash,
    };
  }
  if (
    current.status !== "ADMITTED" ||
    current.mode !== binding.mode ||
    !queryHashes.verify({
      tenantId: input.tenantId,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.PROCESSOR_QUERY,
      value: current.processorQuery,
      binding: {
        hash: binding.processorQueryHash,
        keyId: binding.queryHashKeyId,
        version: binding.queryHashVersion,
      },
    })
  ) {
    return null;
  }
  return {
    ...current,
    originalQueryHash: binding.originalQueryHash,
    processorQueryHash: binding.processorQueryHash,
    queryHashKeyId: binding.queryHashKeyId,
    queryHashVersion: binding.queryHashVersion,
    admissionHash: binding.admissionHash,
  };
}

export function equalKnowledgeV2ProcessorQueryAdmissionBindings(
  left: KnowledgeV2ProcessorQueryAdmissionBinding,
  right: KnowledgeV2ProcessorQueryAdmissionBinding,
): boolean {
  if (
    left.version !== right.version ||
    left.status !== right.status ||
    left.originalQueryHash !== right.originalQueryHash ||
    left.processorQueryHash !== right.processorQueryHash ||
    left.queryHashKeyId !== right.queryHashKeyId ||
    left.queryHashVersion !== right.queryHashVersion ||
    left.admissionHash !== right.admissionHash
  ) {
    return false;
  }
  if (left.status === "ADMITTED" && right.status === "ADMITTED") {
    return left.mode === right.mode;
  }
  if (left.status === "DENIED" && right.status === "DENIED") {
    return left.reason === right.reason;
  }
  return false;
}

export const knowledgeV2ProcessorQueryAdmissionBindingsEqual =
  equalKnowledgeV2ProcessorQueryAdmissionBindings;
