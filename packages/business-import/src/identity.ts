import { createHash } from "node:crypto";
import { canonicalBusinessImportDecimal, type ParsedBusinessServiceRow } from "./service-csv.js";

function normalizedText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function normalizeBusinessExternalId(value: string | null | undefined) {
  return normalizedText(value);
}

export function businessOfferingIdentityKey(
  value: Pick<ParsedBusinessServiceRow, "category" | "name" | "locationExternalId" | "language">,
) {
  return [
    normalizedText(value.category),
    normalizedText(value.name),
    normalizedText(value.locationExternalId),
    normalizedText(value.language),
  ].join("\u001f");
}

export function businessOfferingCandidateKey(
  sourceLineageId: string,
  value: Pick<
    ParsedBusinessServiceRow,
    "externalId" | "category" | "name" | "locationExternalId" | "language"
  >,
) {
  const external = normalizeBusinessExternalId(value.externalId);
  const identity = external
    ? `external:${external}`
    : `identity:${businessOfferingIdentityKey(value)}`;
  return createHash("sha256")
    .update(`leadvirt.business-offering.v1\0${sourceLineageId}\0${identity}`)
    .digest("hex");
}

function canonicalOfferingValue(value: ParsedBusinessServiceRow, includeExternalId: boolean) {
  const canonical = {
    active: value.active,
    bookingNotes: value.bookingNotes,
    category: value.category,
    description: value.description,
    duration: value.duration
      ? {
          maximumMinutes: value.duration.maximumMinutes,
          minimumMinutes: value.duration.minimumMinutes,
        }
      : null,
    ...(includeExternalId ? { externalId: value.externalId } : {}),
    language: value.language,
    locationExternalId: value.locationExternalId,
    name: value.name,
    price: value.price
      ? {
          amount: canonicalBusinessImportDecimal(value.price.amount),
          currency: value.price.currency,
          from: canonicalBusinessImportDecimal(value.price.from),
          taxNote: value.price.taxNote,
          to: canonicalBusinessImportDecimal(value.price.to),
          type: value.price.type,
          unit: value.price.unit,
        }
      : null,
    validFrom: value.validFrom,
    validUntil: value.validUntil,
  };
  return canonical;
}

export function businessOfferingValueHash(value: ParsedBusinessServiceRow) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalOfferingValue(value, true)))
    .digest("hex");
}

export function businessOfferingCanonicalValueHash(value: ParsedBusinessServiceRow) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalOfferingValue(value, false)))
    .digest("hex");
}
