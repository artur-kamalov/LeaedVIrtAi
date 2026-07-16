import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  admitKnowledgeV2ProcessorQuery as admitProcessorQuery,
  createKnowledgeV2QueryHashKeyring,
  createKnowledgeV2QueryHashKeyringFromEnvironment,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  KNOWLEDGE_V2_QUERY_HASH_VERSION,
  KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION,
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS,
  KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_INTENT_CHARACTERS,
  KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_NORMALIZED_CHARACTERS,
  KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_RAW_CHARACTERS,
  KNOWLEDGE_V2_PROCESSOR_QUERY_MODES,
  KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES,
  equalKnowledgeV2ProcessorQueryAdmissionBindings,
  OPERATIONAL_QUERY_CATEGORIES,
  parseKnowledgeV2ProcessorQueryAdmissionBinding,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  revalidateKnowledgeV2ProcessorQueryAdmission,
  type KnowledgeV2ProcessorQueryAdmissionInput,
  type KnowledgeV2ProcessorQueryDenialReason,
  type KnowledgeV2QueryHashKeyring,
} from "../../packages/knowledge/src/index.js";

const tenantId = "tenant-query-hmac-a";
const priorKeyId = "query-hmac-2026-01";
const activeKeyId = "query-hmac-2026-07";
const priorKey = Buffer.alloc(32, 0x11);
const activeKey = Buffer.alloc(32, 0x22);
const priorQueryHashes = createKnowledgeV2QueryHashKeyring({
  activeKeyId: priorKeyId,
  keys: { [priorKeyId]: priorKey },
});
const queryHashes = createKnowledgeV2QueryHashKeyring({
  activeKeyId,
  keys: { [priorKeyId]: priorKey, [activeKeyId]: activeKey },
});
const activeOnlyQueryHashes = createKnowledgeV2QueryHashKeyring({
  activeKeyId,
  keys: { [activeKeyId]: activeKey },
});

type AdmissionInput = Omit<KnowledgeV2ProcessorQueryAdmissionInput, "tenantId"> & {
  tenantId?: string;
};

function admitKnowledgeV2ProcessorQuery(
  input: AdmissionInput,
  keyring: KnowledgeV2QueryHashKeyring = queryHashes,
) {
  return admitProcessorQuery({ tenantId, ...input }, keyring);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function expectDenied(
  input: AdmissionInput,
  reason: KnowledgeV2ProcessorQueryDenialReason,
) {
  const result = admitKnowledgeV2ProcessorQuery(input);
  assert.equal(result.admitted, false);
  if (result.admitted) throw new Error("Expected processor query admission to be denied.");
  assert.equal(result.status, "DENIED");
  assert.equal(result.reason, reason);
  assert.equal(result.processorQueryHash, null);
  assert.equal("processorQuery" in result, false);
  assert.match(result.originalQueryHash, /^[a-f0-9]{64}$/u);
  assert.match(result.admissionHash, /^[a-f0-9]{64}$/u);
  return result;
}

const safeInput: AdmissionInput = {
  query: "  What\u00a0are your hours? \n",
  classification: "PUBLIC",
};
const safe = admitKnowledgeV2ProcessorQuery(safeInput);
assert.equal(safe.admitted, true);
if (!safe.admitted) throw new Error("Expected safe processor query admission.");
assert.equal(safe.version, KNOWLEDGE_V2_PROCESSOR_QUERY_ADMISSION_VERSION);
assert.equal(safe.status, "ADMITTED");
assert.equal(safe.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH);
assert.equal(safe.processorQuery, "What are your hours?");
assert.equal(safe.queryHashKeyId, activeKeyId);
assert.equal(safe.queryHashVersion, KNOWLEDGE_V2_QUERY_HASH_VERSION);
assert.match(safe.originalQueryHash, /^[a-f0-9]{64}$/u);
assert.match(safe.processorQueryHash, /^[a-f0-9]{64}$/u);
assert.match(safe.admissionHash, /^[a-f0-9]{64}$/u);
assert.notEqual(safe.originalQueryHash, sha256(safeInput.query));
assert.notEqual(safe.processorQueryHash, sha256(safe.processorQuery));
assert.equal(
  queryHashes.verify({
    tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: safeInput.query,
    binding: {
      hash: safe.originalQueryHash,
      keyId: safe.queryHashKeyId,
      version: safe.queryHashVersion,
    },
  }),
  true,
);
assert.equal(
  queryHashes.verify({
    tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.PROCESSOR_QUERY,
    value: safe.processorQuery,
    binding: {
      hash: safe.processorQueryHash,
      keyId: safe.queryHashKeyId,
      version: safe.queryHashVersion,
    },
  }),
  true,
);
assert.deepEqual(admitKnowledgeV2ProcessorQuery(safeInput), safe);

const safeBinding = projectKnowledgeV2ProcessorQueryAdmissionBinding(safe);
const parsedSafeBinding = parseKnowledgeV2ProcessorQueryAdmissionBinding(
  structuredClone(safeBinding),
);
if (!parsedSafeBinding) throw new Error("Expected persisted binding to parse.");
assert.deepEqual(parsedSafeBinding, safeBinding);
assert.notEqual(parsedSafeBinding, safeBinding);
assert.equal(equalKnowledgeV2ProcessorQueryAdmissionBindings(parsedSafeBinding, safeBinding), true);
assert.equal(parseKnowledgeV2ProcessorQueryAdmissionBinding(safe), null);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...safeBinding,
    unexpected: true,
  }),
  null,
);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...safeBinding,
    mode: KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.CANONICAL_OPERATIONAL,
  }),
  null,
);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...safeBinding,
    originalQueryHash: "0".repeat(64),
  }),
  null,
);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...safeBinding,
    admissionHash: safeBinding.admissionHash.toUpperCase(),
  }),
  null,
);
const missingHashBinding = structuredClone(safeBinding) as Record<string, unknown>;
delete missingHashBinding.admissionHash;
assert.equal(parseKnowledgeV2ProcessorQueryAdmissionBinding(missingHashBinding), null);
for (const malformed of [null, [], {}, { status: "ADMITTED" }, { status: "DENIED" }]) {
  assert.equal(parseKnowledgeV2ProcessorQueryAdmissionBinding(malformed), null);
}
const hostileBinding = new Proxy(
  {},
  {
    get() {
      throw new Error("hostile binding");
    },
  },
);
assert.equal(parseKnowledgeV2ProcessorQueryAdmissionBinding(hostileBinding), null);

const originalPurposeHash = queryHashes.hash({
  tenantId,
  purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
  value: safeInput.query,
});
const processorPurposeHash = queryHashes.hash({
  tenantId,
  purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.PROCESSOR_QUERY,
  value: safeInput.query,
});
const testPurposeHash = queryHashes.hash({
  tenantId,
  purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
  value: safeInput.query,
});
assert.equal(new Set([originalPurposeHash.hash, processorPurposeHash.hash, testPurposeHash.hash]).size, 3);
assert.equal(
  queryHashes.verify({
    tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.PROCESSOR_QUERY,
    value: safeInput.query,
    binding: originalPurposeHash,
  }),
  false,
);

const otherTenantHash = queryHashes.hash({
  tenantId: "tenant-query-hmac-b",
  purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
  value: safeInput.query,
});
assert.notEqual(otherTenantHash.hash, originalPurposeHash.hash);
assert.equal(
  queryHashes.verify({
    tenantId: "tenant-query-hmac-b",
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: safeInput.query,
    binding: originalPurposeHash,
  }),
  false,
);

const priorAdmission = admitKnowledgeV2ProcessorQuery(safeInput, priorQueryHashes);
assert.equal(priorAdmission.admitted, true);
if (!priorAdmission.admitted) throw new Error("Expected prior-key admission.");
const priorBinding = projectKnowledgeV2ProcessorQueryAdmissionBinding(priorAdmission);
assert.equal(priorBinding.queryHashKeyId, priorKeyId);
assert.notEqual(priorBinding.originalQueryHash, safeBinding.originalQueryHash);
const revalidatedPrior = revalidateKnowledgeV2ProcessorQueryAdmission(
  { tenantId, query: safeInput.query, classification: safeInput.classification },
  priorBinding,
  queryHashes,
);
assert.ok(revalidatedPrior);
assert.equal(revalidatedPrior.queryHashKeyId, priorKeyId);
assert.equal(
  revalidateKnowledgeV2ProcessorQueryAdmission(
    { tenantId, query: safeInput.query, classification: safeInput.classification },
    priorBinding,
    activeOnlyQueryHashes,
  ),
  null,
);
assert.equal(
  queryHashes.verify({
    tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: safeInput.query,
    binding: { ...originalPurposeHash, keyId: "unknown-query-hmac-key" },
  }),
  false,
);
assert.equal(
  revalidateKnowledgeV2ProcessorQueryAdmission(
    { tenantId: "tenant-query-hmac-b", query: safeInput.query, classification: "PUBLIC" },
    safeBinding,
    queryHashes,
  ),
  null,
);

assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    version: "knowledge-v2-processor-query-admission-v2",
    status: "ADMITTED",
    mode: "PASSTHROUGH",
    originalQueryHash: sha256(safeInput.query),
    processorQueryHash: sha256("What are your hours?"),
    admissionHash: sha256("legacy-admission"),
  }),
  null,
);
assert.throws(
  () =>
    createKnowledgeV2QueryHashKeyringFromEnvironment({
      NODE_ENV: "production",
      APP_ENV: "production",
    }),
  /both required/u,
);
for (const fixture of [
  {
    id: "local-query-hmac-v1",
    key: "TGVhZFZpcnQgbG9jYWwgcXVlcnkgSE1BQyBrZXkhISE=",
  },
  {
    id: "acceptance-query-v1",
    key: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=",
  },
]) {
  assert.throws(
    () =>
      createKnowledgeV2QueryHashKeyringFromEnvironment({
        NODE_ENV: "production",
        APP_ENV: "production",
        KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID: fixture.id,
        KNOWLEDGE_QUERY_HMAC_KEYS: JSON.stringify({ [fixture.id]: fixture.key }),
      }),
    /forbidden in production/u,
  );
}
assert.throws(
  () =>
    createKnowledgeV2QueryHashKeyring({
      activeKeyId: "invalid-key",
      keys: { "invalid-key": "not-base64" },
    }),
  /canonical 32-byte base64/u,
);

const equivalentSafe = admitKnowledgeV2ProcessorQuery({
  query: "What are your hours?",
  classification: "PUBLIC",
});
assert.equal(equivalentSafe.admitted, true);
if (!equivalentSafe.admitted) throw new Error("Expected equivalent safe query admission.");
assert.equal(equivalentSafe.processorQuery, safe.processorQuery);
assert.equal(equivalentSafe.processorQueryHash, safe.processorQueryHash);
assert.notEqual(equivalentSafe.originalQueryHash, safe.originalQueryHash);
assert.notEqual(equivalentSafe.admissionHash, safe.admissionHash);
assert.equal(
  equalKnowledgeV2ProcessorQueryAdmissionBindings(
    safeBinding,
    projectKnowledgeV2ProcessorQueryAdmissionBinding(equivalentSafe),
  ),
  false,
);

const internal = admitKnowledgeV2ProcessorQuery({
  query: "Summarize the internal returns policy.",
  classification: "INTERNAL",
});
assert.equal(internal.admitted, true);
if (!internal.admitted) throw new Error("Expected internal safe query admission.");
assert.equal(internal.processorQuery, "Summarize the internal returns policy.");

const credentialQueries = [
  "Use password=correct-horse-battery-staple",
  "Use api\u200b_key=abcdefghijklmnopqrstuvwxyz123456",
  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
  "Bot token 123456789:abcdefghijklmnopqrstuvwxyzABCDE",
  "-----BEGIN PRIVATE KEY-----",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz",
  "AWS key AKIAABCDEFGHIJKLMNOP",
  "GitHub token ghp_abcdefghijklmnopqrstuvwxyz123456",
  "Connect with postgresql://admin:supersecret@db.example.test/leadvirt",
  "OpenAI key sk-proj-abcdefghijklmnopqrstuvwxyz123456",
];
for (const query of credentialQueries) {
  const denied = expectDenied(
    { query, classification: "PUBLIC" },
    KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CREDENTIAL_DETECTED,
  );
  assert.equal(JSON.stringify(denied).includes(query), false);
  assert.notEqual(denied.originalQueryHash, sha256(query));
  assert.equal(
    queryHashes.verify({
      tenantId,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
      value: query,
      binding: {
        hash: denied.originalQueryHash,
        keyId: denied.queryHashKeyId,
        version: denied.queryHashVersion,
      },
    }),
    true,
  );
}
expectDenied(
  {
    query: "Where is my order? api_key=abcdefghijklmnopqrstuvwxyz123456",
    classification: "CUSTOMER_PERSONAL",
  },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CREDENTIAL_DETECTED,
);
expectDenied(
  {
    query: "Review api_key=abcdefghijklmnopqrstuvwxyz123456",
    classification: "SENSITIVE",
  },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CREDENTIAL_DETECTED,
);

const passwordPolicy = admitKnowledgeV2ProcessorQuery({
  query: "How should users choose a secure password?",
  classification: "PUBLIC",
});
assert.equal(passwordPolicy.admitted, true);
assert.equal(
  admitKnowledgeV2ProcessorQuery({
    query: "What is the current order status?",
    classification: "PUBLIC",
  }).admitted,
  true,
);
assert.equal(
  admitKnowledgeV2ProcessorQuery({
    query: "Is there availability on 2026-07-13?",
    classification: "PUBLIC",
  }).admitted,
  true,
);

const operationalCases = [
  {
    query: "Are there appointment slots available today for alex@example.com?",
    identifier: "alex@example.com",
    category: OPERATIONAL_QUERY_CATEGORIES.AVAILABILITY,
  },
  {
    query: "Is booking BK-991188 confirmed for alex@example.com?",
    identifier: "BK-991188",
    category: OPERATIONAL_QUERY_CATEGORIES.BOOKING_STATE,
  },
  {
    query: "Is product X200 in stock for alex@example.com?",
    identifier: "X200",
    category: OPERATIONAL_QUERY_CATEGORIES.INVENTORY,
  },
  {
    query: "Where is order 123456 for alex@example.com?",
    identifier: "123456",
    category: OPERATIONAL_QUERY_CATEGORIES.ORDER_STATE,
  },
  {
    query: "What is my current account balance for alex@example.com?",
    identifier: "alex@example.com",
    category: OPERATIONAL_QUERY_CATEGORIES.ACCOUNT_STATE,
  },
] as const;

for (const testCase of operationalCases) {
  const result = admitKnowledgeV2ProcessorQuery({
    query: testCase.query,
    classification: "CUSTOMER_PERSONAL",
  });
  assert.equal(result.admitted, true, testCase.category);
  if (!result.admitted) throw new Error(`Expected ${testCase.category} admission.`);
  assert.equal(result.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.CANONICAL_OPERATIONAL);
  assert.equal(result.operationalCategory, testCase.category);
  assert.equal(result.requiresLiveEvidence, true);
  assert.equal(
    result.processorQuery,
    KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES[testCase.category],
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(testCase.identifier), false);
  assert.equal(serialized.includes("alex@example.com"), false);

  const binding = projectKnowledgeV2ProcessorQueryAdmissionBinding(result);
  assert.equal(binding.status, "ADMITTED");
  assert.equal(binding.processorQueryHash, result.processorQueryHash);
  assert.equal("processorQuery" in binding, false);
  assert.equal(JSON.stringify(binding).includes(testCase.identifier), false);
}

for (const query of ["shipping", "Tell me about your services."]) {
  const personalStatic = admitKnowledgeV2ProcessorQuery({
    query,
    classification: "CUSTOMER_PERSONAL",
  });
  assert.equal(personalStatic.admitted, true);
  if (!personalStatic.admitted) throw new Error("Expected safe personal static admission.");
  assert.equal(personalStatic.classification, "CUSTOMER_PERSONAL");
  assert.equal(personalStatic.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH);
  assert.equal(personalStatic.processorQuery, query);
  assert.equal(personalStatic.requiresLiveEvidence, false);
}

const personalRedactionCases = [
  {
    query: "Summarize shipping options for alex@example.com.",
    identifier: "alex@example.com",
    processorQuery: "Summarize shipping options for [EMAIL].",
  },
  {
    query: "Explain contact policy for +33 6 12 34 56 78.",
    identifier: "+33 6 12 34 56 78",
    processorQuery: "Explain contact policy for [PHONE].",
  },
  {
    query: "Summarize retention policy for record 550e8400-e29b-41d4-a716-446655440000.",
    identifier: "550e8400-e29b-41d4-a716-446655440000",
    processorQuery: "Summarize retention policy for record [UUID].",
  },
  {
    query: "Explain retention policy for order 123456.",
    identifier: "123456",
    processorQuery: "Explain retention policy for [REFERENCE].",
  },
  {
    query: "Explain privacy policy for account ACCT-998877.",
    identifier: "ACCT-998877",
    processorQuery: "Explain privacy policy for [REFERENCE].",
  },
  {
    query: "Explain retention policy for 1234567890123456.",
    identifier: "1234567890123456",
    processorQuery: "Explain retention policy for [NUMERIC_ID].",
  },
] as const;

for (const testCase of personalRedactionCases) {
  const input = {
    query: testCase.query,
    classification: "CUSTOMER_PERSONAL" as const,
  };
  const result = admitKnowledgeV2ProcessorQuery(input);
  assert.equal(result.admitted, true);
  if (!result.admitted) throw new Error("Expected redacted personal static admission.");
  assert.equal(result.classification, "CUSTOMER_PERSONAL");
  assert.equal(result.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.REDACTED_PERSONAL);
  assert.equal(result.processorQuery, testCase.processorQuery);
  assert.equal(result.requiresLiveEvidence, false);
  assert.equal(result.operationalCategory, OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE);
  assert.deepEqual(admitKnowledgeV2ProcessorQuery(input), result);
  assert.equal(JSON.stringify(result).includes(testCase.identifier), false);
  const binding = projectKnowledgeV2ProcessorQueryAdmissionBinding(result);
  assert.equal(binding.status, "ADMITTED");
  assert.equal("processorQuery" in binding, false);
  assert.equal(JSON.stringify(binding).includes(testCase.identifier), false);
}

const deterministicRedacted = admitKnowledgeV2ProcessorQuery({
  query: personalRedactionCases[0].query,
  classification: "CUSTOMER_PERSONAL",
});
assert.equal(deterministicRedacted.admitted, true);
if (!deterministicRedacted.admitted) throw new Error("Expected deterministic redaction.");
assert.deepEqual(
  deterministicRedacted,
  admitKnowledgeV2ProcessorQuery({
    query: personalRedactionCases[0].query,
    classification: "CUSTOMER_PERSONAL",
  }),
);
assert.notEqual(
  deterministicRedacted.originalQueryHash,
  sha256(personalRedactionCases[0].query),
);
assert.notEqual(
  deterministicRedacted.processorQueryHash,
  sha256(deterministicRedacted.processorQuery),
);

const sensitiveSafe = admitKnowledgeV2ProcessorQuery({
  query: "shipping",
  classification: "SENSITIVE",
});
assert.equal(sensitiveSafe.admitted, true);
if (!sensitiveSafe.admitted) throw new Error("Expected safe sensitive admission.");
assert.equal(sensitiveSafe.classification, "SENSITIVE");
assert.equal(sensitiveSafe.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH);
assert.equal(sensitiveSafe.processorQuery, "shipping");

const sensitiveRedacted = admitKnowledgeV2ProcessorQuery({
  query: "Summarize shipping options for alex@example.com.",
  classification: "SENSITIVE",
});
assert.equal(sensitiveRedacted.admitted, true);
if (!sensitiveRedacted.admitted) throw new Error("Expected minimized sensitive admission.");
assert.equal(sensitiveRedacted.classification, "SENSITIVE");
assert.equal(sensitiveRedacted.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.REDACTED_PERSONAL);
assert.equal(sensitiveRedacted.processorQuery, "Summarize shipping options for [EMAIL].");
assert.equal(JSON.stringify(sensitiveRedacted).includes("alex@example.com"), false);

const sensitiveOperational = admitKnowledgeV2ProcessorQuery({
  query: "Where is order 123456 for alex@example.com?",
  classification: "SENSITIVE",
});
assert.equal(sensitiveOperational.admitted, true);
if (!sensitiveOperational.admitted) throw new Error("Expected sensitive operational admission.");
assert.equal(sensitiveOperational.mode, KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.CANONICAL_OPERATIONAL);
assert.equal(
  sensitiveOperational.processorQuery,
  KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES.ORDER_STATE,
);
assert.equal(JSON.stringify(sensitiveOperational).includes("alex@example.com"), false);

for (const query of [
  "alex@example.com",
  "My email is alex@example.com",
  "+33 6 12 34 56 78",
  "UUID 550e8400-e29b-41d4-a716-446655440000",
  "1234567890123456",
]) {
  expectDenied(
    { query, classification: "CUSTOMER_PERSONAL" },
    KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.DESTRUCTIVE_PERSONAL_REDACTION,
  );
}

const destructiveRedaction = expectDenied(
  { query: "alex@example.com", classification: "CUSTOMER_PERSONAL" },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.DESTRUCTIVE_PERSONAL_REDACTION,
);
expectDenied(
  { query: "alex@example.com", classification: "SENSITIVE" },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.DESTRUCTIVE_PERSONAL_REDACTION,
);
const deniedBinding = projectKnowledgeV2ProcessorQueryAdmissionBinding(destructiveRedaction);
assert.equal(deniedBinding.status, "DENIED");
assert.equal("processorQuery" in deniedBinding, false);
assert.equal(JSON.stringify(deniedBinding).includes("alex@example.com"), false);
assert.deepEqual(parseKnowledgeV2ProcessorQueryAdmissionBinding(deniedBinding), deniedBinding);
assert.equal(equalKnowledgeV2ProcessorQueryAdmissionBindings(safeBinding, deniedBinding), false);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...deniedBinding,
    reason: KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CREDENTIAL_DETECTED,
  }),
  null,
);
assert.equal(
  parseKnowledgeV2ProcessorQueryAdmissionBinding({
    ...deniedBinding,
    mode: KNOWLEDGE_V2_PROCESSOR_QUERY_MODES.PASSTHROUGH,
  }),
  null,
);

for (const classification of ["PUBLIC", "INTERNAL"] as const) {
  for (const testCase of personalRedactionCases) {
    expectDenied(
      { query: testCase.query, classification },
      KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.PERSONAL_IDENTIFIER_DETECTED,
    );
  }
}
const secretQuery = "Summarize this record.";
const deniedSecret = expectDenied(
  { query: secretQuery, classification: "SECRET" },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.CLASSIFICATION_NOT_ADMITTED,
);
assert.notEqual(deniedSecret.originalQueryHash, sha256(secretQuery));
assert.equal(
  queryHashes.verify({
    tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: secretQuery,
    binding: {
      hash: deniedSecret.originalQueryHash,
      keyId: deniedSecret.queryHashKeyId,
      version: deniedSecret.queryHashVersion,
    },
  }),
  true,
);
expectDenied(
  { query: " \n\t ", classification: "PUBLIC" },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.EMPTY_QUERY,
);
expectDenied(
  {
    query: "a".repeat(KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_RAW_CHARACTERS + 1),
    classification: "PUBLIC",
  },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.RAW_QUERY_TOO_LARGE,
);
expectDenied(
  {
    query: "a".repeat(KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_NORMALIZED_CHARACTERS + 1),
    classification: "PUBLIC",
  },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.NORMALIZED_QUERY_TOO_LARGE,
);
expectDenied(
  {
    query: "What are your hours?",
    intent: "a".repeat(KNOWLEDGE_V2_PROCESSOR_QUERY_MAX_INTENT_CHARACTERS + 1),
    classification: "PUBLIC",
  },
  KNOWLEDGE_V2_PROCESSOR_QUERY_DENIAL_REASONS.INTENT_TOO_LARGE,
);

console.log("Knowledge v2 processor query admission smoke passed.");
