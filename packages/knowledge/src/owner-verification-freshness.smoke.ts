import assert from "node:assert/strict";
import {
  KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_MS,
  knowledgeOwnerVerificationEffectiveUntil,
} from "./owner-verification-freshness.js";

const verifiedAt = new Date("2026-07-24T10:00:00.000Z");
const policyExpiry = new Date(
  verifiedAt.getTime() + KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_MS,
);

assert.deepEqual(
  knowledgeOwnerVerificationEffectiveUntil({ verifiedAt, effectiveUntil: null }),
  policyExpiry,
);
assert.deepEqual(
  knowledgeOwnerVerificationEffectiveUntil({
    verifiedAt,
    effectiveUntil: new Date("2026-07-23T10:00:00.000Z"),
  }),
  policyExpiry,
);
assert.deepEqual(
  knowledgeOwnerVerificationEffectiveUntil({
    verifiedAt,
    effectiveUntil: new Date("2026-08-01T00:00:00.000Z"),
  }),
  new Date("2026-08-01T00:00:00.000Z"),
);
assert.deepEqual(
  knowledgeOwnerVerificationEffectiveUntil({
    verifiedAt,
    effectiveUntil: new Date("2027-01-01T00:00:00.000Z"),
  }),
  policyExpiry,
);

console.log("knowledge owner verification freshness smoke passed");
