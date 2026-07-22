import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BusinessImportProcessorError,
  businessImportInitialDecision,
  businessImportEvidenceBytes,
  businessImportPdfParserRetryableStatus,
  businessImportRuntimeEnvelopeMatches,
  businessImportSafeError,
  businessImportXlsxSandboxApproved,
  canonicalBusinessImportJson,
  isBusinessImportRuntimeData,
  type BusinessImportRuntimeData,
  validatePdfExtraction,
} from "./business-import-processor.js";

const data = {
  tenantId: `c${"1".repeat(24)}`,
  sourceId: `c${"2".repeat(24)}`,
  importId: "123e4567-e89b-42d3-a456-426614174000",
  generation: 3,
  operation: "PARSE",
  requestedByUserId: `c${"3".repeat(24)}`,
  requestedAt: "2026-07-21T12:00:00.000Z",
  runtimeEventId: `c${"4".repeat(24)}`,
  runtimeGeneration: 3,
} satisfies BusinessImportRuntimeData;

assert.equal(isBusinessImportRuntimeData(data), true);
assert.equal(isBusinessImportRuntimeData({ ...data, rawBytes: "forbidden" }), false);
assert.equal(isBusinessImportRuntimeData({ ...data, runtimeGeneration: 2 }), false);
assert.equal(isBusinessImportRuntimeData({ ...data, requestedAt: "yesterday" }), false);
const jobId = `business-import:${data.importId}:${data.generation}`;
const persistedData = Object.fromEntries(
  Object.entries(data).filter(([key]) => !["runtimeEventId", "runtimeGeneration"].includes(key)),
);
const runtimePayload = {
  queueName: "business.import",
  jobName: "parse",
  jobId,
  data: persistedData,
  attempts: 5,
  backoffMs: 2_000,
};
assert.equal(businessImportRuntimeEnvelopeMatches(runtimePayload, data, jobId), true);
assert.equal(
  businessImportRuntimeEnvelopeMatches(
    { ...runtimePayload, data: { ...persistedData, requestedByUserId: `c${"9".repeat(24)}` } },
    data,
    jobId,
  ),
  false,
);
assert.equal(
  businessImportRuntimeEnvelopeMatches({ ...runtimePayload, attempts: 6 }, data, jobId),
  false,
);
assert.equal(businessImportXlsxSandboxApproved(undefined), false);
assert.equal(businessImportXlsxSandboxApproved("false"), false);
assert.equal(businessImportXlsxSandboxApproved("true"), true);
assert.equal(businessImportInitialDecision("MISSING"), "REJECTED");
assert.equal(businessImportInitialDecision("ADD"), "PENDING");
assert.equal(businessImportPdfParserRetryableStatus(408), true);
assert.equal(businessImportPdfParserRetryableStatus(429), true);
assert.equal(businessImportPdfParserRetryableStatus(503), true);
assert.equal(businessImportPdfParserRetryableStatus(413), false);
assert.equal(businessImportPdfParserRetryableStatus(422), false);

assert.equal(
  canonicalBusinessImportJson({ z: 1, nested: { b: 2, a: 1 }, a: [2, { y: 2, x: 1 }] }),
  '{"a":[2,{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}',
);

const sourceValue = "Exact source: Стрижка, 25 EUR";
const evidence = businessImportEvidenceBytes(sourceValue);
assert.equal(new TextDecoder().decode(evidence.bytes), sourceValue);
assert.equal(evidence.excerptHash, createHash("sha256").update(evidence.bytes).digest("hex"));
assert.equal(evidence.sourceValueHash, evidence.excerptHash);
assert.throws(
  () => businessImportEvidenceBytes("x".repeat(32 * 1024 + 1)),
  (error: unknown) =>
    error instanceof BusinessImportProcessorError &&
    error.code === "BUSINESS_IMPORT_EVIDENCE_VALUE_LIMIT",
);

const artifactHash = "a".repeat(64);
const pdf = validatePdfExtraction(
  {
    data: {
      contractVersion: "leadvirt.pdf-extraction.v1",
      parser: { version: "parser-v1", ocrLanguages: null },
      document: { sha256: artifactHash, pageCount: 1, pdfVersion: "1.7" },
      pages: [
        {
          pageNumber: 1,
          width: 612,
          height: 792,
          source: "NATIVE",
          words: [{ text: "Service", box: [10, 20, 70, 40], confidence: 1 }],
          characterCount: 7,
        },
      ],
      counts: { characters: 7, words: 1, ocrPages: 0, ocrPixels: 0 },
      warnings: [],
    },
  },
  { sha256: artifactHash, version: "parser-v1" },
);
assert.equal(pdf.pages[0]?.words[0]?.text, "Service");
assert.throws(
  () =>
    validatePdfExtraction(
      { data: { ...pdf, document: { ...pdf.document, sha256: "b".repeat(64) } } },
      { sha256: artifactHash, version: "parser-v1" },
    ),
  (error: unknown) =>
    error instanceof BusinessImportProcessorError &&
    error.code === "BUSINESS_IMPORT_PDF_PARSER_CONTRACT_INVALID",
);

const safe = businessImportSafeError(
  new BusinessImportProcessorError("INTERNAL_DETAIL", false, "PERSISTING"),
);
assert.equal(safe.message.includes("INTERNAL_DETAIL"), false);
assert.equal(safe.retryable, false);

console.log("business import worker smoke passed");
