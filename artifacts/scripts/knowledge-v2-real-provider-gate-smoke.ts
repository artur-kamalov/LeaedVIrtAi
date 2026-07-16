import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateKnowledgeRealProviderGate,
  knowledgeRealProviderApiBase,
  knowledgeRealProviderHash,
  knowledgeRealProviderLocales,
  type KnowledgeRealProviderCaseObservation,
  type KnowledgeRealProviderGatePolicy,
} from "@leadvirt/knowledge";

const policy = JSON.parse(readFileSync(
  new URL("../evals/knowledge-v2-real-provider-gate.json", import.meta.url),
  "utf8",
)) as KnowledgeRealProviderGatePolicy;

function hash(label: string) {
  return knowledgeRealProviderHash({ label });
}

function identity() {
  return {
    environment: "staging-protected",
    provider: "openai-compatible",
    generatorModel: "gpt-real-v1",
    embeddingVersion: "multilingual-embed-v3",
    sparseVersion: "unicode-hash-tf-v1",
    rerankerVersion: "multilingual-reranker-v2",
    retrievalPolicyVersion: "hybrid-rff-v2",
    promptPolicyVersion: "grounded-answer-v2",
    graphVersion: "structured-v2",
    codeCommit: "0123456789abcdef",
    testCaseSetHash: hash("test-set"),
    candidateManifestHash: hash("candidate"),
    indexSnapshotHash: hash("snapshot"),
    indexSchemaHash: hash("schema"),
    retrievalProcessorPolicyHash: hash("retrieval-policy"),
    modelProcessorPolicyHash: hash("model-policy"),
    configHash: hash("config"),
  };
}

function observation(
  locale: string,
  behavior: "ANSWER" | "ABSTAIN" | "HANDOFF",
): KnowledgeRealProviderCaseObservation {
  return {
    caseVersionHash: hash(`${locale}:${behavior}`),
    locale,
    riskLevel: behavior === "ANSWER" ? "LOW" : behavior === "ABSTAIN" ? "MEDIUM" : "CRITICAL",
    critical: true,
    expectedBehavior: behavior,
    observedBehavior: behavior,
    status: "PASSED",
    gateOutcome: behavior === "ANSWER" ? "AUTO_SEND" : "HANDOFF",
    retrievalChecksPassed: behavior === "ANSWER" ? 1 : 0,
    retrievalChecksTotal: behavior === "ANSWER" ? 1 : 0,
    providerOutputHash: behavior === "ANSWER" ? hash(`${locale}:provider`) : null,
    gateResultHash: behavior === "ANSWER" ? hash(`${locale}:gate`) : null,
    evidenceManifestHash: hash(`${locale}:evidence:${behavior}`),
    latencyMs: 25,
    inputTokens: behavior === "ANSWER" ? 120 : 0,
    outputTokens: behavior === "ANSWER" ? 40 : 0,
    costMicros: behavior === "ANSWER" ? "250" : "0",
  };
}

const passing = knowledgeRealProviderLocales.flatMap((locale) => [
  observation(locale, "ANSWER"),
  observation(locale, "ABSTAIN"),
  observation(locale, "HANDOFF"),
]);

let checks = 0;
const pass = evaluateKnowledgeRealProviderGate({ policy, identity: identity(), observations: passing });
assert.equal(pass.ok, true); checks += 1;
assert.equal(pass.localeSlices.length, 6); checks += 1;
assert.ok(pass.localeSlices.every((slice) => slice.passedGate)); checks += 1;
assert.equal(pass.totals.critical, 18); checks += 1;
assert.equal(pass.totals.criticalPassed, 18); checks += 1;
assert.equal(pass.usage.inputTokens, 720); checks += 1;
assert.equal(pass.usage.outputTokens, 240); checks += 1;
assert.equal(pass.usage.costMicros, "1500"); checks += 1;
assert.deepEqual(pass.criticalStatusSlices.map((slice) => slice.sliceKey), [
  "CRITICAL_STATUS:critical",
  "CRITICAL_STATUS:noncritical",
]); checks += 1;
assert.equal(pass.criticalStatusSlices[0]?.passedGate, true); checks += 1;

const reversed = evaluateKnowledgeRealProviderGate({
  policy,
  identity: identity(),
  observations: [...passing].reverse(),
});
assert.equal(reversed.reportHash, pass.reportHash); checks += 1;
assert.deepEqual(reversed.localeSlices, pass.localeSlices); checks += 1;
assert.deepEqual(reversed.riskSlices, pass.riskSlices); checks += 1;
assert.deepEqual(reversed.criticalStatusSlices, pass.criticalStatusSlices); checks += 1;

const masked = passing.map((item) => item.locale === "fr" && item.expectedBehavior === "ANSWER"
  ? { ...item, retrievalChecksPassed: 0, status: "FAILED" as const }
  : item);
const maskedReport = evaluateKnowledgeRealProviderGate({ policy, identity: identity(), observations: masked });
assert.equal(maskedReport.ok, false); checks += 1;
assert.equal(maskedReport.localeSlices.find((slice) => slice.sliceKey === "LOCALE:en")?.passedGate, true); checks += 1;
assert.equal(maskedReport.localeSlices.find((slice) => slice.sliceKey === "LOCALE:fr")?.passedGate, false); checks += 1;
assert.ok(maskedReport.failureCodes.includes("LOCALE:fr:RETRIEVAL_FLOOR_FAILED")); checks += 1;
assert.ok(maskedReport.failureCodes.includes("LOCALE:fr:CRITICAL_CASE_FAILED")); checks += 1;
assert.ok(maskedReport.failureCodes.includes("CRITICAL_STATUS:critical:CRITICAL_CASE_FAILED")); checks += 1;

const missingLocale = evaluateKnowledgeRealProviderGate({
  policy,
  identity: identity(),
  observations: passing.filter((item) => item.locale !== "pt"),
});
assert.equal(missingLocale.ok, false); checks += 1;
assert.ok(missingLocale.failureCodes.includes("LOCALE:pt:INSUFFICIENT_CASES")); checks += 1;
assert.ok(missingLocale.failureCodes.includes("LOCALE:pt:MISSING_BEHAVIOR_ANSWER")); checks += 1;
assert.ok(missingLocale.failureCodes.includes("LOCALE:pt:MISSING_BEHAVIOR_ABSTAIN")); checks += 1;
assert.ok(missingLocale.failureCodes.includes("LOCALE:pt:MISSING_BEHAVIOR_HANDOFF")); checks += 1;

const unsafe = passing.map((item) => item.locale === "de" && item.expectedBehavior === "HANDOFF"
  ? { ...item, observedBehavior: "ANSWER" as const, gateOutcome: "AUTO_SEND" as const, status: "FAILED" as const }
  : item);
const unsafeReport = evaluateKnowledgeRealProviderGate({ policy, identity: identity(), observations: unsafe });
assert.equal(unsafeReport.ok, false); checks += 1;
assert.ok(unsafeReport.failureCodes.includes("LOCALE:de:SAFE_BEHAVIOR_FLOOR_FAILED")); checks += 1;
assert.ok(unsafeReport.failureCodes.includes("LOCALE:de:CRITICAL_CASE_FAILED")); checks += 1;

assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy,
  identity: { ...identity(), provider: "acceptance-fixture" },
  observations: passing,
}), /non-real provider identity/u); checks += 1;
assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy,
  identity: { ...identity(), indexSnapshotHash: "missing" },
  observations: passing,
}), /identity hash/u); checks += 1;
assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy,
  identity: { ...identity(), generatorModel: "real\nmodel" },
  observations: passing,
}), /non-real provider identity/u); checks += 1;
assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy,
  identity: { ...identity(), provider: "owner@example.test" },
  observations: passing,
}), /non-real provider identity/u); checks += 1;
assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy,
  identity: { ...identity(), generatorModel: "models/grounded-v2" },
  observations: passing,
}), /non-real provider identity/u); checks += 1;
assert.throws(() => evaluateKnowledgeRealProviderGate({
  policy: { ...policy, requiredBehaviors: ["ANSWER", "ANSWER", "HANDOFF"] },
  identity: identity(),
  observations: passing,
}), /policy is invalid/u); checks += 1;

for (const invalid of [
  { ...passing[0]!, latencyMs: -1 },
  { ...passing[0]!, inputTokens: 1.5 },
  { ...passing[0]!, outputTokens: -1 },
  { ...passing[0]!, costMicros: "-1" },
  { ...passing[0]!, providerOutputHash: "not-a-hash" },
  { ...passing[0]!, gateResultHash: "not-a-hash" },
  { ...passing[0]!, evidenceManifestHash: "not-a-hash" },
  { ...passing[0]!, status: "BOGUS" },
  { ...passing[0]!, expectedBehavior: "BOGUS" },
  { ...passing[0]!, observedBehavior: "BOGUS" },
  { ...passing[0]!, gateOutcome: "BOGUS" },
] as Array<Record<string, unknown>>) {
  assert.throws(() => evaluateKnowledgeRealProviderGate({
    policy,
    identity: identity(),
    observations: [
      invalid as unknown as KnowledgeRealProviderCaseObservation,
      ...passing.slice(1),
    ],
  }), /observation is invalid/u); checks += 1;
}

assert.equal(
  knowledgeRealProviderApiBase("https://quality.staging.leadvirt.test/api", ["quality.staging.leadvirt.test"], { allowHttp: false }),
  "https://quality.staging.leadvirt.test/api",
); checks += 1;
assert.equal(
  knowledgeRealProviderApiBase("http://api:4001/api", ["api"], { allowHttp: true }),
  "http://api:4001/api",
); checks += 1;
assert.throws(() => knowledgeRealProviderApiBase(
  "https://attacker.test/api",
  ["quality.staging.leadvirt.test"],
  { allowHttp: false },
), /not allowlisted/u); checks += 1;
assert.throws(() => knowledgeRealProviderApiBase(
  "http://api:4001/api",
  ["api"],
  { allowHttp: false },
), /not allowlisted/u); checks += 1;
assert.throws(() => knowledgeRealProviderApiBase(
  "https://user:password@quality.staging.leadvirt.test/api",
  ["quality.staging.leadvirt.test"],
  { allowHttp: false },
), /not allowlisted/u); checks += 1;

const serialized = JSON.stringify(pass);
for (const forbidden of [
  "question",
  "finalText",
  "safeExcerpt",
  "sourceUrl",
  "tenantId",
  "apiKey",
  "customer@example.test",
  "private evidence sentence",
]) {
  assert.equal(serialized.includes(forbidden), false, `report leaked ${forbidden}`); checks += 1;
}

console.log(`Knowledge v2 real-provider gate smoke passed (${checks} checks).`);
