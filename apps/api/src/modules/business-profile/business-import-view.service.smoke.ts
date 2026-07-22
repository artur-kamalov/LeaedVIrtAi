import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { businessImportEvidenceRecordHash } from "@leadvirt/business-import";
import { KnowledgeObjectStoreError } from "@leadvirt/knowledge";
import { BusinessImportViewService } from "./business-import-view.service.js";

type EvidenceResult =
  | { availability: "AVAILABLE"; sourceValue: string }
  | { availability: "EXPIRED" | "UNAVAILABLE" | "CORRUPT"; sourceValue: null };

const values = new Map<string, Uint8Array>();
const runtime = {
  runtime: () => ({
    store: {
      get: (key: string) => {
        if (key === "store-corrupt") {
          return Promise.reject(new KnowledgeObjectStoreError("OBJECT_CORRUPT"));
        }
        const value = values.get(key);
        return value ? Promise.resolve(value) : Promise.reject(new Error("missing"));
      },
    },
  }),
};
const service = new BusinessImportViewService({} as never, runtime as never);
const read = (item: unknown) =>
  (service as unknown as { evidenceValue(value: unknown): Promise<EvidenceResult> }).evidenceValue(
    item,
  );
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const future = new Date("2100-01-01T00:00:00.000Z");

function evidence(
  key: string,
  excerptHash: string,
  deletionState = "RETAINED",
  retainUntil: Date | null = future,
) {
  const record = {
    id: `evidence-${key}`,
    tenantId: "tenant",
    sourceId: "source",
    importId: "import",
    candidateId: "candidate",
    candidateVersion: 1,
    candidateValueHash: "a".repeat(64),
    artifactId: "artifact",
    artifactSha256: "b".repeat(64),
    importGeneration: 1,
    parsedRevisionId: "parsed",
    parsedManifestHash: "c".repeat(64),
    semanticElementId: null,
    semanticTableId: null,
    locator: { row: 1 },
    sourceValueHash: excerptHash,
    excerptHash,
    excerptObjectKey: key,
    excerptEncryptionKeyRef: "test-key",
    excerptObjectLedgerId: "ledger",
    excerptObjectKind: "EVIDENCE_EXCERPT",
    parserVersion: "parser-v1",
    ocrVersion: null,
    extractionContractVersion: "contract-v1",
  };
  return {
    ...record,
    evidenceRecordHash: businessImportEvidenceRecordHash(record),
    excerptObjectLedger: { deletionState, retainUntil },
  };
}

const blank = new Uint8Array();
values.set("blank", blank);
assert.deepEqual(await read(evidence("blank", hash(blank))), {
  availability: "AVAILABLE",
  sourceValue: "",
});

assert.deepEqual(
  await read(evidence("expired", hash(blank), "RETAINED", new Date("2000-01-01T00:00:00.000Z"))),
  { availability: "EXPIRED", sourceValue: null },
);
assert.deepEqual(await read(evidence("removed", hash(blank), "TOMBSTONED")), {
  availability: "UNAVAILABLE",
  sourceValue: null,
});
assert.deepEqual(await read(evidence("missing", hash(blank))), {
  availability: "UNAVAILABLE",
  sourceValue: null,
});
assert.deepEqual(await read(evidence("store-corrupt", hash(blank))), {
  availability: "CORRUPT",
  sourceValue: null,
});
assert.deepEqual(
  await read({ ...evidence("invalid-record", hash(blank)), evidenceRecordHash: "0".repeat(64) }),
  { availability: "CORRUPT", sourceValue: null },
);

const changed = new TextEncoder().encode("changed");
values.set("hash-invalid", changed);
assert.deepEqual(await read(evidence("hash-invalid", hash(new TextEncoder().encode("original")))), {
  availability: "CORRUPT",
  sourceValue: null,
});

const invalidUtf8 = Uint8Array.from([0xc3, 0x28]);
values.set("invalid-utf8", invalidUtf8);
assert.deepEqual(await read(evidence("invalid-utf8", hash(invalidUtf8))), {
  availability: "CORRUPT",
  sourceValue: null,
});

process.stdout.write("business import evidence view smoke passed\n");
