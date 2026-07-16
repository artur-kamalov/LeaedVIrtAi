import { createHash } from "node:crypto";
import type { Prisma } from "@leadvirt/db";
import type {
  ChannelType,
  KnowledgeV2Audience,
  KnowledgeV2RiskLevel,
  KnowledgeV2SecurityClassification,
} from "@leadvirt/types";
import { stableKnowledgeValue } from "./publisher.js";

const scopeKeys = new Set([
  "brandIds",
  "locationIds",
  "channelTypes",
  "assistantIds",
  "audiences",
  "segments",
  "locales",
]);

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
const channelTypes = new Set<ChannelType>([
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "WEBHOOK",
  "PHONE",
  "DEMO",
]);
const audiences = new Set<KnowledgeV2Audience>(["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"]);
const opaqueId = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export const KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES = 50;
export const KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH = 128;
export const KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH = 64;
export const KNOWLEDGE_V2_SCOPE_WILDCARD = "*";

export function isKnowledgeV2ScopeOpaqueId(value: string) {
  return value.length <= KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH && opaqueId.test(value);
}

export function isKnowledgeV2ScopeSegment(value: string) {
  return (
    value.length <= KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH &&
    value !== KNOWLEDGE_V2_SCOPE_WILDCARD &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

export interface KnowledgeV2PersistedScope {
  brandIds: string[];
  locationIds: string[];
  channelTypes: ChannelType[];
  assistantIds: string[];
  audiences: KnowledgeV2Audience[];
  segments: string[];
  locales: string[];
}

export interface KnowledgeV2TenantDefaultScopePolicy {
  scope: KnowledgeV2PersistedScope;
  generation: number;
  hash: string;
}

export interface KnowledgeV2StructuredScopeBinding {
  scope: KnowledgeV2PersistedScope;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
}

export interface KnowledgeV2StructuredAuthorizationEvidence {
  id: string;
  kind: string;
  label: string;
  locator: string | null;
  isPublic: boolean;
  legacyRevisionId: string | null;
  sourceReference: Prisma.JsonValue | null;
  elementReference: Prisma.JsonValue | null;
  quoteHash: string | null;
  confidence: number | null;
}

const callerAudiences: KnowledgeV2Audience[] = ["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"];

function callerCanRead(caller: KnowledgeV2Audience, required: readonly KnowledgeV2Audience[]) {
  if (required.length === 0 || required.includes("PUBLIC")) return true;
  return required.includes(caller);
}

export function knowledgeV2DocumentPrefilterEnforcesScope(
  scope: KnowledgeV2PersistedScope,
  documentAudiences: readonly KnowledgeV2Audience[],
  documentLocale: string,
) {
  if (
    documentAudiences.length === 0 ||
    callerAudiences.some(
      (caller) =>
        callerCanRead(caller, documentAudiences) && !callerCanRead(caller, scope.audiences),
    )
  ) {
    return false;
  }
  if (scope.locales.length === 0) return true;
  const canonical = locale(documentLocale);
  if (!canonical) return false;
  const base = canonical.split("-")[0] ?? canonical;
  return canonical === base
    ? scope.locales.includes(base)
    : scope.locales.includes(canonical) || scope.locales.includes(base);
}

export type KnowledgeV2PersistedScopeResult =
  | { state: "TENANT_DEFAULT"; scope: KnowledgeV2PersistedScope }
  | { state: "EXPLICIT"; scope: KnowledgeV2PersistedScope }
  | { state: "INVALID" };

export type KnowledgeV2PersistedAudienceResult =
  | { state: "CLASSIFICATION_DEFAULT"; audiences: KnowledgeV2Audience[] }
  | { state: "EXPLICIT"; audiences: KnowledgeV2Audience[] }
  | { state: "INVALID" };

interface StringArrayPolicy<T extends string = string> {
  maximumItems: number;
  maximumLength: number;
  minimumLength?: number;
  normalize?: (value: string) => T | null;
}

function parseStringArray<T extends string = string>(
  value: Prisma.JsonValue | undefined,
  policy: StringArrayPolicy<T>,
): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > policy.maximumItems) return null;
  const normalized: T[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item !== item.trim() ||
      item.length < (policy.minimumLength ?? 1) ||
      item.length > policy.maximumLength
    ) {
      return null;
    }
    const parsed = policy.normalize ? policy.normalize(item) : (item as T);
    if (parsed === null) return null;
    normalized.push(parsed);
  }
  if (new Set(normalized).size !== normalized.length) return null;
  return normalized.sort(compareCanonicalText);
}

function enumValue<T extends string>(allowed: ReadonlySet<T>) {
  return (value: string): T | null => (allowed.has(value as T) ? (value as T) : null);
}

function locale(value: string) {
  if (value.length < 2 || value.includes("_")) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

function id(value: string) {
  return isKnowledgeV2ScopeOpaqueId(value) ? value : null;
}

function emptyScope(): KnowledgeV2PersistedScope {
  return {
    brandIds: [],
    locationIds: [],
    channelTypes: [],
    assistantIds: [],
    audiences: [],
    segments: [],
    locales: [],
  };
}

export function parseKnowledgeV2PersistedScope(
  value: Prisma.JsonValue | null | undefined,
): KnowledgeV2PersistedScopeResult {
  if (value === null || value === undefined) {
    return { state: "TENANT_DEFAULT", scope: emptyScope() };
  }
  if (typeof value !== "object" || Array.isArray(value)) return { state: "INVALID" };
  if (Object.keys(value).some((key) => !scopeKeys.has(key))) return { state: "INVALID" };

  const brandIds = parseStringArray(value.brandIds, {
    maximumItems: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
    maximumLength: KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
    normalize: id,
  });
  const locationIds = parseStringArray(value.locationIds, {
    maximumItems: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
    maximumLength: KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
    normalize: id,
  });
  const parsedChannelTypes = parseStringArray(value.channelTypes, {
    maximumItems: channelTypes.size,
    maximumLength: 16,
    normalize: enumValue(channelTypes),
  });
  const assistantIds = parseStringArray(value.assistantIds, {
    maximumItems: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
    maximumLength: KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
    normalize: id,
  });
  const parsedAudiences = parseStringArray(value.audiences, {
    maximumItems: audiences.size,
    maximumLength: 32,
    normalize: enumValue(audiences),
  });
  const segments = parseStringArray(value.segments, {
    maximumItems: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
    maximumLength: KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH,
    normalize: (value) => (isKnowledgeV2ScopeSegment(value) ? value : null),
  });
  const locales = parseStringArray(value.locales, {
    maximumItems: 20,
    maximumLength: 35,
    minimumLength: 2,
    normalize: locale,
  });
  if (
    !brandIds ||
    !locationIds ||
    !parsedChannelTypes ||
    !assistantIds ||
    !parsedAudiences ||
    !segments ||
    !locales
  ) {
    return { state: "INVALID" };
  }
  return {
    state: "EXPLICIT",
    scope: {
      brandIds,
      locationIds,
      channelTypes: parsedChannelTypes,
      assistantIds,
      audiences: parsedAudiences,
      segments,
      locales,
    },
  };
}

export function knowledgeV2TenantDefaultScopeHash(scope: KnowledgeV2PersistedScope) {
  return createHash("sha256")
    .update(
      stableKnowledgeValue({
        version: 1,
        policy: "knowledge-v2-tenant-default-scope",
        scope,
      }),
    )
    .digest("hex");
}

export function parseKnowledgeV2TenantDefaultScopePolicy(input: {
  scope: Prisma.JsonValue | null | undefined;
  generation: number | null | undefined;
  hash: string | null | undefined;
}): KnowledgeV2TenantDefaultScopePolicy | null {
  const parsed = parseKnowledgeV2PersistedScope(input.scope);
  if (
    parsed.state !== "EXPLICIT" ||
    parsed.scope.audiences.length === 0 ||
    !Number.isSafeInteger(input.generation) ||
    (input.generation ?? 0) <= 0 ||
    typeof input.hash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.hash) ||
    stableKnowledgeValue(input.scope) !== stableKnowledgeValue(parsed.scope) ||
    input.hash !== knowledgeV2TenantDefaultScopeHash(parsed.scope)
  ) {
    return null;
  }
  return {
    scope: parsed.scope,
    generation: input.generation!,
    hash: input.hash,
  };
}

export function resolveKnowledgeV2StructuredScope(
  rawScope: Prisma.JsonValue | null | undefined,
  policy: KnowledgeV2TenantDefaultScopePolicy | null,
): KnowledgeV2StructuredScopeBinding | null {
  const parsed = parseKnowledgeV2PersistedScope(rawScope);
  if (parsed.state === "INVALID") return null;
  if (parsed.state === "TENANT_DEFAULT") {
    if (!policy) return null;
    return {
      scope: policy.scope,
      usesTenantDefaultScope: true,
      tenantDefaultScopeGeneration: policy.generation,
      tenantDefaultScopeHash: policy.hash,
    };
  }
  if (parsed.scope.audiences.length === 0) return null;
  return {
    scope: parsed.scope,
    usesTenantDefaultScope: false,
    tenantDefaultScopeGeneration: null,
    tenantDefaultScopeHash: null,
  };
}

export function knowledgeV2StructuredAuthorizationFingerprint(input: {
  itemType: "FACT_VERSION" | "GUIDANCE_RULE_VERSION";
  binding: KnowledgeV2StructuredScopeBinding;
  riskLevel: KnowledgeV2RiskLevel;
  authority: Record<string, unknown>;
  evidence: readonly KnowledgeV2StructuredAuthorizationEvidence[];
}) {
  const evidence = input.evidence
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      locator: item.locator,
      isPublic: item.isPublic,
      legacyRevisionId: item.legacyRevisionId,
      sourceReference: item.sourceReference,
      elementReference: item.elementReference,
      quoteHash: item.quoteHash,
      confidence: item.confidence,
    }))
    .sort((left, right) => compareCanonicalText(left.id, right.id));
  const value = input.binding.usesTenantDefaultScope
    ? {
        version: 2,
        policy: "knowledge-v2-structured-authorization",
        corpusKind: "STRUCTURED_V2",
        itemType: input.itemType,
        scope: input.binding.scope,
        usesTenantDefaultScope: true,
        tenantDefaultScopeGeneration: input.binding.tenantDefaultScopeGeneration,
        tenantDefaultScopeHash: input.binding.tenantDefaultScopeHash,
        riskLevel: input.riskLevel,
        authority: input.authority,
        evidence,
      }
    : {
        version: 1,
        corpusKind: "STRUCTURED_V2",
        itemType: input.itemType,
        scope: input.binding.scope,
        riskLevel: input.riskLevel,
        authority: input.authority,
        evidence,
      };
  return createHash("sha256").update(stableKnowledgeValue(value)).digest("hex");
}

export function resolveKnowledgeV2PersistedAudiences(
  value: Prisma.JsonValue | null | undefined,
  classification: KnowledgeV2SecurityClassification,
): KnowledgeV2PersistedAudienceResult {
  if (value === null || value === undefined) {
    return {
      state: "CLASSIFICATION_DEFAULT",
      audiences: classification === "PUBLIC" ? ["PUBLIC"] : ["INTERNAL"],
    };
  }
  const parsed = parseStringArray(value, {
    maximumItems: audiences.size,
    maximumLength: 32,
    normalize: enumValue(audiences),
  });
  if (!parsed || parsed.length === 0) return { state: "INVALID" };
  return { state: "EXPLICIT", audiences: parsed };
}
