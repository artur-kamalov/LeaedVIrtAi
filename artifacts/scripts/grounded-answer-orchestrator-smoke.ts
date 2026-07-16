import assert from "node:assert/strict";
import {
  GroundedAnswerOrchestrator,
  hashGroundedAnswerText,
  type GroundedAnswerOrchestrationEvidence,
  type GroundedAnswerOrchestrationInput,
  type GroundedAnswerProvider,
} from "@leadvirt/ai";

const identity = {
  provider: "test-provider",
  model: "test-model",
  version: "v1",
  region: "test-region",
};

function documentEvidence(content: string, riskLevel: "LOW" | "HIGH" = "LOW"): GroundedAnswerOrchestrationEvidence {
  return {
    evidence: {
      evidenceKey: "document:1",
      kind: "DOCUMENT",
      content,
      contentHash: hashGroundedAnswerText(content),
      authorized: true,
      inCapturedTarget: true,
      stale: false,
    },
    riskLevel,
    classification: "INTERNAL",
    safeLabel: "Test document",
  };
}

function input(evidence: GroundedAnswerOrchestrationEvidence[], evidenceAllowed = true): GroundedAnswerOrchestrationInput {
  return {
    tenantId: "tenant-1",
    locale: "en",
    question: "How long does shipping take?",
    promptPolicyVersion: "grounded-v1",
    queryClassification: "INTERNAL",
    evidenceAllowed,
    evidence,
    conflicts: [],
    now: "2026-07-13T12:00:00.000Z",
  };
}

function provider(outputs: unknown[]) {
  let calls = 0;
  const value: GroundedAnswerProvider = {
    identity,
    async generate() {
      const output = outputs[calls];
      calls += 1;
      return output;
    },
  };
  return { value, calls: () => calls };
}

const allow = {
  async authorize() {
    return {
      ...identity,
      policyVersion: "model-v1",
      policyHash: "a".repeat(64),
      promptPolicyVersion: "grounded-v1",
    };
  },
};

const outputPolicy = {
  validateInput: () => true,
  validateOutput: () => true,
};

function exactOutput(text: string, duplicateCitation = false) {
  return {
    schemaVersion: 1,
    claims: [{
      claimId: "claim-1",
      text,
      evidenceKeys: ["document:1"],
      exactValueText: null,
    }],
    citations: [
      { claimId: "claim-1", evidenceKey: "document:1" },
      ...(duplicateCitation ? [{ claimId: "claim-1", evidenceKey: "document:1" }] : []),
    ],
  };
}

async function main() {
  const deniedEvidenceProvider = provider([exactOutput("Shipping takes 2 days.")]);
  const deniedEvidence = await new GroundedAnswerOrchestrator(
    deniedEvidenceProvider.value,
    allow,
    outputPolicy,
  ).answer(input([documentEvidence("Shipping takes 2 days.")], false));
  assert.equal(deniedEvidence.disposition, "HANDOFF");
  assert.equal(deniedEvidenceProvider.calls(), 0);

  const deniedPolicyProvider = provider([exactOutput("Shipping takes 2 days.")]);
  const deniedPolicy = await new GroundedAnswerOrchestrator(
    deniedPolicyProvider.value,
    { async authorize() { return null; } },
    outputPolicy,
  ).answer(input([documentEvidence("Shipping takes 2 days.")]));
  assert.equal(deniedPolicy.disposition, "HANDOFF");
  assert.equal(deniedPolicyProvider.calls(), 0);

  const exactProvider = provider([exactOutput("Shipping takes 2 days.")]);
  const exact = await new GroundedAnswerOrchestrator(
    exactProvider.value,
    allow,
    outputPolicy,
  ).answer(input([documentEvidence("Standard delivery: Shipping takes 2 days. Contact support for help.")]));
  assert.equal(exact.disposition, "AUTO_SEND");
  assert.equal(exact.finalText, "Shipping takes 2 days.");
  assert.equal(exact.citations.length, 1);
  assert.equal(exactProvider.calls(), 1);

  const paraphraseProvider = provider([exactOutput("Your order should arrive within two days.")]);
  const paraphrase = await new GroundedAnswerOrchestrator(
    paraphraseProvider.value,
    allow,
    outputPolicy,
  ).answer(input([documentEvidence("Shipping takes 2 days.")]));
  assert.equal(paraphrase.disposition, "HANDOFF");
  assert.equal(paraphraseProvider.calls(), 1);
  assert.ok(paraphrase.issues.some((issue) => issue.code === "CLAIM_EXACT_SUPPORT_REQUIRED"));

  const highRiskProvider = provider([{
    schemaVersion: 1,
    claims: [{
      claimId: "claim-1",
      text: "Refund limit is $5,000.",
      evidenceKeys: ["document:1"],
      exactValueText: "$5,000",
    }],
    citations: [{ claimId: "claim-1", evidenceKey: "document:1" }],
  }]);
  const highRisk = await new GroundedAnswerOrchestrator(
    highRiskProvider.value,
    allow,
    outputPolicy,
  ).answer(input([documentEvidence("Refund limit is $5,000.", "HIGH")]));
  assert.equal(highRisk.disposition, "HANDOFF");
  assert.equal(highRiskProvider.calls(), 1);
  assert.ok(highRisk.issues.some((issue) => issue.code === "HIGH_RISK_EXACT_SUPPORT_REQUIRED"));

  const repairProvider = provider([
    exactOutput("Shipping takes 2 days.", true),
    exactOutput("Shipping takes 2 days.", true),
  ]);
  const repair = await new GroundedAnswerOrchestrator(
    repairProvider.value,
    allow,
    outputPolicy,
  ).answer(input([documentEvidence("Shipping takes 2 days.")]));
  assert.equal(repair.disposition, "HANDOFF");
  assert.equal(repair.finalText, null);
  assert.equal(repairProvider.calls(), 2);
  assert.equal(repair.repairCount, 1);
  assert.equal(repair.citations.length, 0);

  console.log(JSON.stringify({ checks: 6, passed: 6 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
