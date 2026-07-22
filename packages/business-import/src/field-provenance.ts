import type {
  BusinessImportCellEvidence,
  BusinessServiceCsvHeader,
  ParsedBusinessServiceRow,
} from "./service-csv.js";

export const BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS = [
  "/active",
  "/archivedAt",
  "/bookingNotes",
  "/category",
  "/description",
  "/duration/maximumMinutes",
  "/duration/minimumMinutes",
  "/externalId",
  "/kind",
  "/language",
  "/locationExternalId",
  "/name",
  "/price/amount",
  "/price/currency",
  "/price/from",
  "/price/taxNote",
  "/price/to",
  "/price/type",
  "/price/unit",
  "/validFrom",
  "/validUntil",
] as const;

export type BusinessImportFieldProvenancePath =
  (typeof BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS)[number];
export type BusinessImportFieldAuthority = "IMPORTED" | "MANUAL" | "SYSTEM";

export type BusinessImportFieldProvenanceBinding =
  | { authority: "IMPORTED"; evidenceId: string }
  | { authority: "MANUAL" }
  | { authority: "SYSTEM" };

export type BusinessImportFieldProvenance = Record<
  BusinessImportFieldProvenancePath,
  BusinessImportFieldProvenanceBinding
>;

export interface BusinessImportProvenanceOfferingValue {
  externalId?: string | null;
  category?: string | null;
  name: string;
  description?: string | null;
  price?: {
    type: string;
    amount?: string | null;
    from?: string | null;
    to?: string | null;
    currency?: string | null;
    unit?: string | null;
    taxNote?: string | null;
  } | null;
  duration?: {
    minimumMinutes: number;
    maximumMinutes?: number | null;
  } | null;
  locationExternalId?: string | null;
  bookingNotes?: string | null;
  active: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  language?: string | null;
}

function systemProvenance(): BusinessImportFieldProvenance {
  return Object.fromEntries(
    BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [path, { authority: "SYSTEM" }]),
  ) as BusinessImportFieldProvenance;
}

function sourcePresent(evidence: BusinessImportCellEvidence | undefined) {
  return Boolean(evidence?.sourceValue.normalize("NFC").trim());
}

export function createBusinessImportFieldProvenance(
  row: ParsedBusinessServiceRow,
  evidenceIds: Partial<Record<BusinessServiceCsvHeader, string>>,
): BusinessImportFieldProvenance {
  const result = systemProvenance();
  const bind = (
    path: BusinessImportFieldProvenancePath,
    header: BusinessServiceCsvHeader,
    requireSourceValue = false,
  ) => {
    const evidence = row.evidence[header];
    const evidenceId = evidenceIds[header];
    if (!evidence || !evidenceId || (requireSourceValue && !sourcePresent(evidence))) return;
    result[path] = { authority: "IMPORTED", evidenceId };
  };

  bind("/externalId", "external_id");
  bind("/category", "category");
  bind("/name", "name");
  bind("/description", "description");
  bind("/locationExternalId", "location_external_id");
  bind("/bookingNotes", "booking_notes");
  bind("/active", "active", true);
  bind("/validFrom", "valid_from");
  bind("/validUntil", "valid_until");
  if (row.language !== null) bind("/language", "language", true);

  if (row.price) {
    bind("/price/type", "price_type", true);
    if (row.price.type === "FIXED") bind("/price/amount", "price_amount", true);
    if (row.price.type === "FROM") {
      const header = sourcePresent(row.evidence.price_from) ? "price_from" : "price_amount";
      bind("/price/from", header, true);
    }
    if (row.price.type === "RANGE") {
      bind("/price/from", "price_from", true);
      bind("/price/to", "price_to", true);
    }
    if (row.price.currency !== null) bind("/price/currency", "currency", true);
    bind("/price/unit", "price_unit");
    bind("/price/taxNote", "tax_note");
  }

  if (row.duration) {
    bind("/duration/minimumMinutes", "duration_minutes", true);
    bind("/duration/maximumMinutes", "duration_max_minutes");
  }

  return result;
}

function provenanceValue(value: BusinessImportProvenanceOfferingValue, path: string): unknown {
  switch (path) {
    case "/kind":
      return "SERVICE";
    case "/archivedAt":
      return null;
    case "/externalId":
      return value.externalId ?? null;
    case "/category":
      return value.category ?? null;
    case "/name":
      return value.name;
    case "/description":
      return value.description ?? null;
    case "/price/type":
      return value.price?.type ?? null;
    case "/price/amount":
      return value.price?.amount ?? null;
    case "/price/from":
      return value.price?.from ?? null;
    case "/price/to":
      return value.price?.to ?? null;
    case "/price/currency":
      return value.price?.currency ?? null;
    case "/price/unit":
      return value.price?.unit ?? null;
    case "/price/taxNote":
      return value.price?.taxNote ?? null;
    case "/duration/minimumMinutes":
      return value.duration?.minimumMinutes ?? null;
    case "/duration/maximumMinutes":
      return value.duration?.maximumMinutes ?? null;
    case "/locationExternalId":
      return value.locationExternalId ?? null;
    case "/bookingNotes":
      return value.bookingNotes ?? null;
    case "/active":
      return value.active;
    case "/validFrom":
      return value.validFrom ?? null;
    case "/validUntil":
      return value.validUntil ?? null;
    case "/language":
      return value.language ?? null;
    default:
      throw new Error(`Unknown business import provenance path: ${path}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBusinessImportFieldProvenance(
  input: unknown,
): BusinessImportFieldProvenance {
  if (!isRecord(input)) throw new Error("Business import field provenance must be an object.");
  const keys = Object.keys(input).sort();
  if (
    keys.length !== BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.length ||
    keys.some((key, index) => key !== BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS[index])
  ) {
    throw new Error("Business import field provenance paths are incomplete or unsupported.");
  }
  const output = {} as BusinessImportFieldProvenance;
  for (const path of BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS) {
    const entry = input[path];
    if (!isRecord(entry) || typeof entry.authority !== "string") {
      throw new Error(`Business import field provenance is invalid at ${path}.`);
    }
    const entryKeys = Object.keys(entry).sort();
    if (entry.authority === "IMPORTED") {
      if (
        entryKeys.join(",") !== "authority,evidenceId" ||
        typeof entry.evidenceId !== "string" ||
        !entry.evidenceId
      ) {
        throw new Error(`Imported field provenance requires exact evidence at ${path}.`);
      }
      output[path] = { authority: "IMPORTED", evidenceId: entry.evidenceId };
    } else if (
      (entry.authority === "MANUAL" || entry.authority === "SYSTEM") &&
      entryKeys.join(",") === "authority"
    ) {
      output[path] = { authority: entry.authority };
    } else {
      throw new Error(`Business import field provenance authority is invalid at ${path}.`);
    }
  }
  return output;
}

export function reviseBusinessImportFieldProvenance(
  previousValue: BusinessImportProvenanceOfferingValue,
  nextValue: BusinessImportProvenanceOfferingValue,
  previousInput: unknown,
  evidenceIdRemap: ReadonlyMap<string, string>,
): BusinessImportFieldProvenance {
  const previous = parseBusinessImportFieldProvenance(previousInput);
  const result = {} as BusinessImportFieldProvenance;
  for (const path of BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS) {
    if (!Object.is(provenanceValue(previousValue, path), provenanceValue(nextValue, path))) {
      result[path] = { authority: "MANUAL" };
      continue;
    }
    const binding = previous[path];
    if (binding.authority !== "IMPORTED") {
      result[path] = binding;
      continue;
    }
    const evidenceId = evidenceIdRemap.get(binding.evidenceId);
    if (!evidenceId) {
      throw new Error(`Imported field evidence was not cloned for ${path}.`);
    }
    result[path] = { authority: "IMPORTED", evidenceId };
  }
  return result;
}

export function remapBusinessImportFieldProvenance(
  previousInput: unknown,
  evidenceIdRemap: ReadonlyMap<string, string>,
): BusinessImportFieldProvenance {
  const previous = parseBusinessImportFieldProvenance(previousInput);
  const result = {} as BusinessImportFieldProvenance;
  for (const path of BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS) {
    const binding = previous[path];
    if (binding.authority !== "IMPORTED") {
      result[path] = binding;
      continue;
    }
    const evidenceId = evidenceIdRemap.get(binding.evidenceId);
    if (!evidenceId) {
      throw new Error(`Imported field evidence was not cloned for ${path}.`);
    }
    result[path] = { authority: "IMPORTED", evidenceId };
  }
  return result;
}

export function sortedBusinessImportFieldProvenance(input: unknown) {
  const provenance = parseBusinessImportFieldProvenance(input);
  return BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => ({
    path,
    ...provenance[path],
  }));
}

export function businessImportCanonicalProvenancePath(
  resourceType: "OFFERING" | "OFFERING_PRICE" | "OFFERING_DURATION",
  fieldPath: string,
  action: string,
): BusinessImportFieldProvenancePath {
  if (resourceType === "OFFERING") {
    if (action === "ARCHIVE" && (fieldPath === "/active" || fieldPath === "/archivedAt")) {
      return "/archivedAt";
    }
    const offeringPaths: Record<string, BusinessImportFieldProvenancePath> = {
      "/kind": "/kind",
      "/category": "/category",
      "/name": "/name",
      "/description": "/description",
      "/locale": "/language",
      "/bookingNotes": "/bookingNotes",
      "/active": "/active",
      "/archivedAt": "/archivedAt",
    };
    const path = offeringPaths[fieldPath];
    if (path) return path;
  }
  if (resourceType === "OFFERING_PRICE") {
    const pricePaths: Record<string, BusinessImportFieldProvenancePath> = {
      "/type": "/price/type",
      "/amount": "/price/amount",
      "/amountFrom": "/price/from",
      "/amountTo": "/price/to",
      "/currency": "/price/currency",
      "/unit": "/price/unit",
      "/taxNote": "/price/taxNote",
      "/effectiveFrom": "/validFrom",
      "/effectiveUntil": "/validUntil",
    };
    const path = pricePaths[fieldPath];
    if (path) return path;
  }
  if (resourceType === "OFFERING_DURATION") {
    if (fieldPath === "/minimumMinutes") return "/duration/minimumMinutes";
    if (fieldPath === "/maximumMinutes") return "/duration/maximumMinutes";
  }
  throw new Error(`Canonical business field has no provenance binding: ${resourceType}${fieldPath}`);
}
