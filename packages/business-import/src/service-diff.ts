import { createHash } from "node:crypto";
import {
  businessOfferingCandidateKey,
  businessOfferingCanonicalValueHash,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  normalizeBusinessExternalId,
} from "./identity.js";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  BUSINESS_IMPORT_SERVICE_LIMIT,
  canonicalBusinessImportDecimal,
  type BusinessImportDiagnostic,
  type BusinessServiceCsvHeader,
  type ParsedBusinessServiceRow,
} from "./service-csv.js";

export type BusinessImportRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";
export type BusinessImportConfidence = "CONFIRMED_FORMAT" | "HIGH" | "MEDIUM" | "LOW";

export type BusinessServiceDiffAction =
  | "ADD"
  | "UPDATE"
  | "LINK"
  | "UNCHANGED"
  | "CONFLICT"
  | "INVALID"
  | "MISSING"
  | "ARCHIVE";

export const BUSINESS_IMPORT_CATALOG_MUTATION_LIMIT = BUSINESS_IMPORT_SERVICE_LIMIT;

const BUSINESS_IMPORT_CATALOG_MUTATION_ACTIONS = new Set<BusinessServiceDiffAction>([
  "ADD",
  "UPDATE",
  "LINK",
  "ARCHIVE",
]);

export function isBusinessImportCatalogMutationAction(action: string) {
  return BUSINESS_IMPORT_CATALOG_MUTATION_ACTIONS.has(action as BusinessServiceDiffAction);
}

export function countBusinessImportCatalogMutations(candidates: ReadonlyArray<{ action: string }>) {
  return candidates.filter((candidate) => isBusinessImportCatalogMutationAction(candidate.action))
    .length;
}

export function businessImportCandidateRequiresApproval(risk: string, action: string) {
  return risk === "HIGH" && isBusinessImportCatalogMutationAction(action);
}

export interface ExistingBusinessOffering {
  id: string;
  value: ParsedBusinessServiceRow;
  valueHash: string;
}

export interface BusinessOfferingSourceBinding {
  offeringId: string;
  externalKey: string;
  identityKey: string;
  sourceValueHash: string;
}

export interface BusinessImportManualFieldAttribution {
  offeringId: string;
  resourceType: "BUSINESS_IDENTITY" | "OFFERING" | "OFFERING_PRICE" | "OFFERING_DURATION";
  fieldPath: string;
}

const MANUAL_FIELD_HEADERS: Record<
  BusinessImportManualFieldAttribution["resourceType"],
  Record<string, readonly BusinessServiceCsvHeader[]>
> = {
  OFFERING: {
    "/category": ["category"],
    "/name": ["name"],
    "/description": ["description"],
    "/locale": ["language"],
    "/bookingNotes": ["booking_notes"],
    "/active": ["active"],
  },
  OFFERING_PRICE: {
    "/type": ["price_type"],
    "/amount": ["price_amount"],
    "/amountFrom": ["price_from", "price_amount"],
    "/amountTo": ["price_to"],
    "/currency": ["currency"],
    "/unit": ["price_unit"],
    "/taxNote": ["tax_note"],
    "/effectiveFrom": ["valid_from"],
    "/effectiveUntil": ["valid_until"],
  },
  OFFERING_DURATION: {
    "/minimumMinutes": ["duration_minutes"],
    "/maximumMinutes": ["duration_max_minutes"],
  },
  BUSINESS_IDENTITY: {},
};

export function businessImportManualFieldsByOffering(
  attributions: readonly BusinessImportManualFieldAttribution[],
) {
  const result = new Map<string, Set<BusinessServiceCsvHeader>>();
  for (const attribution of attributions) {
    const headers = MANUAL_FIELD_HEADERS[attribution.resourceType][attribution.fieldPath] ?? [];
    if (headers.length === 0) continue;
    const current = result.get(attribution.offeringId) ?? new Set<BusinessServiceCsvHeader>();
    for (const header of headers) current.add(header);
    result.set(attribution.offeringId, current);
  }
  return result;
}

export interface BusinessServiceDiffCandidate {
  candidateKey: string;
  action: BusinessServiceDiffAction;
  riskLevel: BusinessImportRiskLevel;
  confidence: BusinessImportConfidence;
  proposed: ParsedBusinessServiceRow | null;
  current: ExistingBusinessOffering | null;
  targetOfferingId: string | null;
  sourceExternalKey: string | null;
  identityKey: string;
  proposedValueHash: string | null;
  diagnostics: BusinessImportDiagnostic[];
}

export function applyBusinessServiceCatalogMode(
  candidates: BusinessServiceDiffCandidate[],
  mode: "ADD" | "REPLACE",
): BusinessServiceDiffCandidate[] {
  if (mode === "ADD") return candidates;
  return candidates.map((candidate) =>
    candidate.action === "MISSING"
      ? {
          ...candidate,
          action: "ARCHIVE",
          diagnostics: [
            {
              severity: "WARNING",
              code: "BUSINESS_IMPORT_ARCHIVE_MISSING_SERVICE",
              message:
                "This service is absent from the replacement file and will be removed from this catalog.",
            },
          ],
        }
      : candidate,
  );
}

function risk(value: ParsedBusinessServiceRow): BusinessImportRiskLevel {
  if (value.price) return "HIGH";
  if (value.duration || value.bookingNotes) return "MEDIUM";
  return "LOW";
}

function conflictDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_POSSIBLE_DUPLICATE",
    message: "This row has no stable external ID and may duplicate an existing service.",
    row,
  };
}

function ambiguousBindingDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_AMBIGUOUS_SOURCE_BINDING",
    message: "This row matches more than one source binding and requires manual resolution.",
    row,
  };
}

function ambiguousIdentityDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_AMBIGUOUS_CANONICAL_IDENTITY",
    message: "This row matches more than one existing service and requires manual resolution.",
    row,
  };
}

function addBinding(
  index: Map<string, BusinessOfferingSourceBinding[]>,
  key: string,
  binding: BusinessOfferingSourceBinding,
) {
  if (!key) return;
  index.set(key, [...(index.get(key) ?? []), binding]);
}

function uniqueOfferingBindings(bindings: BusinessOfferingSourceBinding[]) {
  const byOffering = new Map<string, BusinessOfferingSourceBinding>();
  for (const binding of [...bindings].sort((left, right) => {
    const offering = left.offeringId.localeCompare(right.offeringId);
    return offering || left.externalKey.localeCompare(right.externalKey);
  })) {
    if (!byOffering.has(binding.offeringId)) byOffering.set(binding.offeringId, binding);
  }
  return [...byOffering.values()];
}

function replacementOmissionCandidateKey(sourceLineageId: string, offeringId: string) {
  return createHash("sha256")
    .update(`leadvirt.business-offering-removal.v1\0${sourceLineageId}\0${offeringId}`)
    .digest("hex");
}

function csvFieldValue(row: ParsedBusinessServiceRow, field: BusinessServiceCsvHeader) {
  switch (field) {
    case "external_id":
      return normalizeBusinessExternalId(row.externalId);
    case "category":
      return row.category;
    case "name":
      return row.name;
    case "description":
      return row.description;
    case "price_type":
      return row.price?.type ?? null;
    case "price_amount":
      return canonicalBusinessImportDecimal(row.price?.amount ?? null);
    case "price_from":
      return canonicalBusinessImportDecimal(row.price?.from ?? null);
    case "price_to":
      return canonicalBusinessImportDecimal(row.price?.to ?? null);
    case "currency":
      return row.price?.currency ?? null;
    case "price_unit":
      return row.price?.unit ?? null;
    case "tax_note":
      return row.price?.taxNote ?? null;
    case "duration_minutes":
      return row.duration?.minimumMinutes ?? null;
    case "duration_max_minutes":
      return row.duration?.maximumMinutes ?? null;
    case "location_external_id":
      return row.locationExternalId;
    case "booking_notes":
      return row.bookingNotes;
    case "active":
      return row.active;
    case "valid_from":
      return row.validFrom;
    case "valid_until":
      return row.validUntil;
    case "language":
      return row.language;
  }
}

function incompleteReplacementDiagnostic(
  row: ParsedBusinessServiceRow,
  current?: ParsedBusinessServiceRow,
  manuallyOwnedFields: ReadonlySet<BusinessServiceCsvHeader> = new Set(),
) {
  const preservedFields = new Set(manuallyOwnedFields);
  const priceFields = new Set<BusinessServiceCsvHeader>([
    "price_type",
    "price_amount",
    "price_from",
    "price_to",
    "currency",
    "price_unit",
    "tax_note",
    "valid_from",
    "valid_until",
  ]);
  const durationFields = new Set<BusinessServiceCsvHeader>([
    "duration_minutes",
    "duration_max_minutes",
  ]);
  if (
    ![...priceFields].some((field) => field in row.evidence) &&
    [...priceFields].some((field) => manuallyOwnedFields.has(field))
  ) {
    for (const field of priceFields) preservedFields.add(field);
  }
  if (
    ![...durationFields].some((field) => field in row.evidence) &&
    [...durationFields].some((field) => manuallyOwnedFields.has(field))
  ) {
    for (const field of durationFields) preservedFields.add(field);
  }
  const missing = BUSINESS_SERVICES_CSV_HEADERS.filter(
    (field) =>
      !(field in row.evidence) &&
      !preservedFields.has(field) &&
      (!current || csvFieldValue(row, field) !== csvFieldValue(current, field)),
  );
  if (missing.length === 0) return null;
  return {
    severity: "ERROR" as const,
    code: "BUSINESS_IMPORT_PARTIAL_UPDATE_UNSUPPORTED",
    message: `Updating an existing service requires the complete template. Missing columns: ${missing.join(", ")}.`,
    row: row.sourceRow,
  } satisfies BusinessImportDiagnostic;
}

export function diffBusinessServiceRows(input: {
  sourceLineageId: string;
  rows: ParsedBusinessServiceRow[];
  existing: ExistingBusinessOffering[];
  sourceBindings: BusinessOfferingSourceBinding[];
  replacementScopeBindings?: BusinessOfferingSourceBinding[];
  manualFieldsByOfferingId?: ReadonlyMap<string, ReadonlySet<BusinessServiceCsvHeader>>;
}): BusinessServiceDiffCandidate[] {
  const existingById = new Map(input.existing.map((item) => [item.id, item]));
  const existingByIdentity = new Map<string, ExistingBusinessOffering[]>();
  for (const item of input.existing) {
    const key = businessOfferingIdentityKey(item.value);
    existingByIdentity.set(key, [...(existingByIdentity.get(key) ?? []), item]);
  }
  const bindingsByExternal = new Map<string, BusinessOfferingSourceBinding[]>();
  const bindingsByIdentity = new Map<string, BusinessOfferingSourceBinding[]>();
  for (const binding of input.sourceBindings) {
    addBinding(bindingsByExternal, normalizeBusinessExternalId(binding.externalKey), binding);
    addBinding(bindingsByIdentity, binding.identityKey, binding);
  }
  const replacementBindingsByExternal = new Map<string, BusinessOfferingSourceBinding[]>();
  const replacementBindingsByIdentity = new Map<string, BusinessOfferingSourceBinding[]>();
  for (const binding of input.replacementScopeBindings ?? []) {
    addBinding(
      replacementBindingsByExternal,
      normalizeBusinessExternalId(binding.externalKey),
      binding,
    );
    addBinding(replacementBindingsByIdentity, binding.identityKey, binding);
  }
  const replacementOfferingIds = new Set(
    (input.replacementScopeBindings ?? []).map((binding) => binding.offeringId),
  );
  const matchedOfferingIds = new Set<string>();
  const candidates = input.rows.map((row): BusinessServiceDiffCandidate => {
    const identityKey = businessOfferingIdentityKey(row);
    const proposedValueHash = businessOfferingValueHash(row);
    const candidateKey = businessOfferingCandidateKey(input.sourceLineageId, row);
    if (!row.valid) {
      return {
        candidateKey,
        action: "INVALID",
        riskLevel: risk(row),
        confidence: "CONFIRMED_FORMAT",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: row.diagnostics,
      };
    }
    const externalKey = normalizeBusinessExternalId(row.externalId);
    const sourceMatchingBindings = externalKey
      ? (bindingsByExternal.get(externalKey) ?? [])
      : (bindingsByIdentity.get(identityKey) ?? []);
    const replacementBindingsWithMatchingKey =
      input.replacementScopeBindings && sourceMatchingBindings.length === 0
        ? externalKey
          ? (replacementBindingsByExternal.get(externalKey) ?? [])
          : (replacementBindingsByIdentity.get(identityKey) ?? [])
        : [];
    const replacementMatchingBindings = externalKey
      ? replacementBindingsWithMatchingKey.filter((replacementBinding) => {
          const replacementOffering = existingById.get(replacementBinding.offeringId);
          return (
            replacementOffering !== undefined &&
            businessOfferingIdentityKey(replacementOffering.value) === identityKey
          );
        })
      : replacementBindingsWithMatchingKey;
    const matchedFromReplacementScope =
      sourceMatchingBindings.length === 0 && replacementMatchingBindings.length > 0;
    const matchingBindings = matchedFromReplacementScope
      ? uniqueOfferingBindings(replacementMatchingBindings)
      : sourceMatchingBindings;
    if (matchingBindings.length > 1 && !matchedFromReplacementScope) {
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, ambiguousBindingDiagnostic(row.sourceRow)],
      };
    }
    const binding = matchingBindings[0];
    const bound = binding ? existingById.get(binding.offeringId) : undefined;
    if (bound) {
      matchedOfferingIds.add(bound.id);
      const changed = matchedFromReplacementScope
        ? businessOfferingCanonicalValueHash(bound.value) !==
          businessOfferingCanonicalValueHash(row)
        : bound.valueHash !== proposedValueHash;
      const incomplete = changed
        ? incompleteReplacementDiagnostic(
            row,
            matchedFromReplacementScope ? bound.value : undefined,
            input.manualFieldsByOfferingId?.get(bound.id),
          )
        : null;
      return {
        candidateKey,
        action: incomplete
          ? "INVALID"
          : changed
            ? "UPDATE"
            : matchedFromReplacementScope
              ? "LINK"
              : "UNCHANGED",
        riskLevel: risk(row),
        confidence: "CONFIRMED_FORMAT",
        proposed: row,
        current: bound,
        targetOfferingId: bound.id,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
      };
    }
    const exact = existingByIdentity.get(identityKey) ?? [];
    if (exact.length > 1) {
      const deterministicReplacement = input.replacementScopeBindings
        ? exact
            .filter((offering) => replacementOfferingIds.has(offering.id))
            .sort((left, right) => left.id.localeCompare(right.id))[0]
        : undefined;
      if (deterministicReplacement) {
        matchedOfferingIds.add(deterministicReplacement.id);
        const changed =
          businessOfferingCanonicalValueHash(deterministicReplacement.value) !==
          businessOfferingCanonicalValueHash(row);
        const incomplete = changed
          ? incompleteReplacementDiagnostic(
              row,
              deterministicReplacement.value,
              input.manualFieldsByOfferingId?.get(deterministicReplacement.id),
            )
          : null;
        return {
          candidateKey,
          action: incomplete ? "INVALID" : changed ? "UPDATE" : "LINK",
          riskLevel: risk(row),
          confidence: "HIGH",
          proposed: row,
          current: deterministicReplacement,
          targetOfferingId: deterministicReplacement.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
        };
      }
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, ambiguousIdentityDiagnostic(row.sourceRow)],
      };
    }
    if (exact.length === 1) {
      const exactOffering = exact[0]!;
      const exactSourceBindings = input.sourceBindings.filter(
        (item) => item.offeringId === exactOffering.id,
      );
      if (
        externalKey &&
        matchingBindings.length === 0 &&
        exactSourceBindings.length === 1 &&
        exactSourceBindings[0]?.identityKey === identityKey &&
        !matchedOfferingIds.has(exactOffering.id)
      ) {
        matchedOfferingIds.add(exactOffering.id);
        const changed = exactOffering.valueHash !== proposedValueHash;
        const incomplete = changed
          ? incompleteReplacementDiagnostic(
              row,
              exactOffering.value,
              input.manualFieldsByOfferingId?.get(exactOffering.id),
            )
          : null;
        return {
          candidateKey,
          action: incomplete ? "INVALID" : changed ? "UPDATE" : "UNCHANGED",
          riskLevel: risk(row),
          confidence: "HIGH",
          proposed: row,
          current: exactOffering,
          targetOfferingId: exactOffering.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
        };
      }
      if (
        !input.sourceBindings.some((item) => item.offeringId === exactOffering.id) &&
        businessOfferingCanonicalValueHash(exactOffering.value) ===
          businessOfferingCanonicalValueHash(row)
      ) {
        matchedOfferingIds.add(exactOffering.id);
        return {
          candidateKey,
          action: "LINK",
          riskLevel: risk(row),
          confidence: "HIGH",
          proposed: row,
          current: exactOffering,
          targetOfferingId: exactOffering.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: row.diagnostics,
        };
      }
      if (
        input.replacementScopeBindings &&
        replacementOfferingIds.has(exactOffering.id) &&
        !input.sourceBindings.some((item) => item.offeringId === exactOffering.id)
      ) {
        matchedOfferingIds.add(exactOffering.id);
        const incomplete = incompleteReplacementDiagnostic(
          row,
          exactOffering.value,
          input.manualFieldsByOfferingId?.get(exactOffering.id),
        );
        return {
          candidateKey,
          action: incomplete ? "INVALID" : "UPDATE",
          riskLevel: risk(row),
          confidence: "HIGH",
          proposed: row,
          current: exactOffering,
          targetOfferingId: exactOffering.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
        };
      }
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "MEDIUM",
        proposed: row,
        current: exact[0] ?? null,
        targetOfferingId: exact[0]?.id ?? null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, conflictDiagnostic(row.sourceRow)],
      };
    }
    const sourceAlreadyHasRows = input.sourceBindings.length > 0;
    if (!externalKey && sourceAlreadyHasRows) {
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: null,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, conflictDiagnostic(row.sourceRow)],
      };
    }
    return {
      candidateKey,
      action: "ADD",
      riskLevel: risk(row),
      confidence: "CONFIRMED_FORMAT",
      proposed: row,
      current: null,
      targetOfferingId: null,
      sourceExternalKey: row.externalId,
      identityKey,
      proposedValueHash,
      diagnostics: row.diagnostics,
    };
  });
  const missingOfferingIds = new Set<string>();
  for (const binding of [...(input.replacementScopeBindings ?? input.sourceBindings)].sort(
    (left, right) => {
      const offering = left.offeringId.localeCompare(right.offeringId);
      return offering || left.externalKey.localeCompare(right.externalKey);
    },
  )) {
    if (missingOfferingIds.has(binding.offeringId)) continue;
    missingOfferingIds.add(binding.offeringId);
    if (matchedOfferingIds.has(binding.offeringId)) continue;
    const existing = existingById.get(binding.offeringId);
    if (!existing) continue;
    candidates.push({
      candidateKey: input.replacementScopeBindings
        ? replacementOmissionCandidateKey(input.sourceLineageId, existing.id)
        : businessOfferingCandidateKey(input.sourceLineageId, existing.value),
      action: "MISSING",
      riskLevel: "HIGH",
      confidence: "CONFIRMED_FORMAT",
      proposed: null,
      current: existing,
      targetOfferingId: existing.id,
      sourceExternalKey: binding.externalKey || null,
      identityKey: binding.identityKey,
      proposedValueHash: null,
      diagnostics: [
        {
          severity: "WARNING",
          code: "BUSINESS_IMPORT_MISSING_FROM_REVISION",
          message: "This existing service is absent from the new file and will remain unchanged.",
        },
      ],
    });
  }
  return candidates;
}
