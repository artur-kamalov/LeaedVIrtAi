import { HttpException } from "@nestjs/common";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  requireIdempotencyKey,
  strongKnowledgeV2Etag,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { isKnowledgeV2GuidanceCondition } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-validation.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectHttpError(callback: () => unknown, status: number, code: string) {
  try {
    callback();
  } catch (error) {
    assert(error instanceof HttpException, `Expected HttpException for ${code}.`);
    assert(error.getStatus() === status, `Expected status ${status} for ${code}.`);
    const payload = error.getResponse();
    assert(typeof payload === "object" && payload !== null, `Missing payload for ${code}.`);
    assert("code" in payload && payload.code === code, `Expected error code ${code}.`);
    return payload as Record<string, unknown>;
  }
  throw new Error(`Expected ${code} to be thrown.`);
}

const leftHash = canonicalKnowledgeV2Hash({ nested: { b: 2, a: 1 }, list: [3, 4] });
const rightHash = canonicalKnowledgeV2Hash({ list: [3, 4], nested: { a: 1, b: 2 } });
assert(leftHash === rightHash, "Canonical hashing depends on object key order.");

const etag = strongKnowledgeV2Etag("fact", "fact_1", 3);
assert(/^"kv2-[a-f0-9]{64}"$/.test(etag), "Knowledge ETag is not strong and opaque.");
assert(etag !== strongKnowledgeV2Etag("fact", "fact_1", 4), "ETag did not change by version.");

assert(requireIdempotencyKey("request.key-123") === "request.key-123", "Valid key rejected.");
expectHttpError(
  () => requireIdempotencyKey("short"),
  400,
  "KNOWLEDGE_VALIDATION_IDEMPOTENCY_KEY_REQUIRED",
);

assertIfMatch(etag, etag, 3);
const conflict = expectHttpError(
  () => assertIfMatch('"old"', etag, 3, ["normalizedValue"]),
  412,
  "REVISION_CONFLICT",
);
assert(
  typeof conflict.details === "object" && conflict.details !== null,
  "Revision conflict omitted safe details.",
);
expectHttpError(
  () => assertIfMatch(undefined, etag, 3),
  428,
  "KNOWLEDGE_VALIDATION_PRECONDITION_REQUIRED",
);

const cursor = { createdAt: new Date().toISOString(), id: "fact_1" };
assert(
  JSON.stringify(decodeKnowledgeV2Cursor(encodeKnowledgeV2Cursor(cursor))) ===
    JSON.stringify(cursor),
  "Cursor did not round-trip.",
);
expectHttpError(
  () => decodeKnowledgeV2Cursor("not-a-valid-cursor"),
  400,
  "KNOWLEDGE_VALIDATION_CURSOR_INVALID",
);

assert(
  isKnowledgeV2GuidanceCondition({ kind: "ALL", conditions: [] }),
  "Unconditional ALL guidance was rejected.",
);
assert(
  !isKnowledgeV2GuidanceCondition({ kind: "ANY", conditions: [] }),
  "Empty ANY guidance must remain invalid.",
);

console.log(JSON.stringify({ ok: true, etag }));
