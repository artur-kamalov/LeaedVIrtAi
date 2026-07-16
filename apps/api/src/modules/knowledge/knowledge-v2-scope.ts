import { HttpStatus } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import { compareKnowledgeCanonicalText, parseKnowledgeV2PersistedScope } from "@leadvirt/knowledge";
import type { KnowledgeV2ScopeInput, KnowledgeV2ScopeView } from "@leadvirt/types";
import { knowledgeV2Error } from "./knowledge-v2-http.js";

function sortedUnique(values: readonly string[] | undefined) {
  return [...new Set(values ?? [])].sort(compareKnowledgeCanonicalText);
}

export function canonicalKnowledgeV2Locale(value: string) {
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (!canonical) throw new Error("missing canonical locale");
    return canonical;
  } catch {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_LOCALE_INVALID",
      "The locale is invalid.",
      { field: "locale" },
    );
  }
}

export function canonicalKnowledgeV2Scope(
  value: KnowledgeV2ScopeInput | null | undefined,
): Prisma.InputJsonObject | null {
  if (value === null || value === undefined) return null;
  return {
    brandIds: sortedUnique(value.brandIds),
    locationIds: sortedUnique(value.locationIds),
    channelTypes: sortedUnique(value.channelTypes),
    assistantIds: sortedUnique(value.assistantIds),
    audiences: sortedUnique(value.audiences),
    segments: sortedUnique(value.segments),
    locales: sortedUnique(value.locales?.map(canonicalKnowledgeV2Locale)),
  };
}

export function knowledgeV2ScopeView(
  value: Prisma.JsonValue | null | undefined,
): KnowledgeV2ScopeView {
  const parsed = parseKnowledgeV2PersistedScope(value);
  if (parsed.state === "INVALID") {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_PERMISSION_SCOPE_INVALID",
      "The stored knowledge scope is invalid.",
    );
  }
  return {
    usesTenantDefault: parsed.state === "TENANT_DEFAULT",
    ...parsed.scope,
  };
}
