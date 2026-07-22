import { createHash } from "node:crypto";

const EVIDENCE_RECORD_SCHEMA = "leadvirt.business-import-evidence-record.v1";

export interface BusinessImportEvidenceRecordHashInput {
  id: string;
  tenantId: string;
  sourceId: string;
  importId: string;
  candidateId: string;
  candidateVersion: number;
  candidateValueHash: string;
  artifactId: string;
  artifactSha256: string;
  importGeneration: number;
  parsedRevisionId: string;
  parsedManifestHash: string;
  semanticElementId: string | null;
  semanticTableId: string | null;
  locator: unknown;
  sourceValueHash: string;
  excerptHash: string;
  excerptObjectKey: string;
  excerptEncryptionKeyRef: string;
  excerptObjectLedgerId: string;
  excerptObjectKind: string;
  parserVersion: string;
  ocrVersion: string | null;
  extractionContractVersion: string;
}

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence hash input contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalJson(record[key])]),
    );
  }
  throw new TypeError("Evidence hash input contains an unsupported JSON value.");
}

export function businessImportEvidenceRecordHash(
  input: BusinessImportEvidenceRecordHashInput,
): string {
  const record = {
    schema: EVIDENCE_RECORD_SCHEMA,
    id: input.id,
    tenantId: input.tenantId,
    sourceId: input.sourceId,
    importId: input.importId,
    candidateId: input.candidateId,
    candidateVersion: input.candidateVersion,
    candidateValueHash: input.candidateValueHash,
    artifactId: input.artifactId,
    artifactSha256: input.artifactSha256,
    importGeneration: input.importGeneration,
    parsedRevisionId: input.parsedRevisionId,
    parsedManifestHash: input.parsedManifestHash,
    semanticElementId: input.semanticElementId,
    semanticTableId: input.semanticTableId,
    locator: canonicalJson(input.locator),
    sourceValueHash: input.sourceValueHash,
    excerptHash: input.excerptHash,
    excerptObjectKey: input.excerptObjectKey,
    excerptEncryptionKeyRef: input.excerptEncryptionKeyRef,
    excerptObjectLedgerId: input.excerptObjectLedgerId,
    excerptObjectKind: input.excerptObjectKind,
    parserVersion: input.parserVersion,
    ocrVersion: input.ocrVersion,
    extractionContractVersion: input.extractionContractVersion,
  };
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
