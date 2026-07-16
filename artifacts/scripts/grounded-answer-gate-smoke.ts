import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  hashGroundedAnswerText,
  validateGroundedAnswer,
  type GroundedAnswerEvidence,
  type GroundedAnswerGateInput,
  type GroundedAnswerMaterialClaim,
} from "@leadvirt/ai";

let checks = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks += 1;
};

const now = "2026-07-12T22:00:00.000Z";

assert.equal(
  hashGroundedAnswerText(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
);
assert.equal(
  hashGroundedAnswerText("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
const unicodeVector = "Проверка 日本語";
assert.equal(
  hashGroundedAnswerText(unicodeVector),
  createHash("sha256").update(unicodeVector, "utf8").digest("hex"),
);
checks += 3;

function documentEvidence(evidenceKey: string, content: string): GroundedAnswerEvidence {
  return {
    evidenceKey,
    kind: "DOCUMENT",
    content,
    contentHash: hashGroundedAnswerText(content),
    authorized: true,
    inCapturedTarget: true,
    stale: false,
  };
}

function factEvidence(
  evidenceKey: string,
  content: string,
  exactValue: string,
): GroundedAnswerEvidence {
  return {
    evidenceKey,
    kind: "FACT",
    content,
    contentHash: hashGroundedAnswerText(content),
    authorized: true,
    inCapturedTarget: true,
    stale: false,
    verificationStatus: "VERIFIED",
    exactValueHash: hashGroundedAnswerText(exactValue),
  };
}

function claim(
  claimId: string,
  text: string,
  evidenceKeys: string[],
  riskLevel: GroundedAnswerMaterialClaim["riskLevel"] = "LOW",
  exactValue?: string,
): GroundedAnswerMaterialClaim {
  return {
    claimId,
    text,
    textHash: hashGroundedAnswerText(text),
    riskLevel,
    evidenceKeys,
    exactValue: exactValue
      ? { text: exactValue, textHash: hashGroundedAnswerText(exactValue) }
      : null,
  };
}

function gateInput(
  finalText: string,
  claims: GroundedAnswerMaterialClaim[],
  evidence: GroundedAnswerEvidence[],
): GroundedAnswerGateInput {
  return {
    finalText,
    claims,
    evidence,
    proposedCitations: claims.map((item) => ({
      claimId: item.claimId,
      claimHash: item.textHash,
      evidenceKey: item.evidenceKeys[0]!,
    })),
    conflicts: [],
    now,
    repairAttempt: 0,
  };
}

const unsupportedText = "The warranty lasts forever.";
const unsupported = validateGroundedAnswer(
  gateInput(unsupportedText, [claim("unsupported", unsupportedText, ["missing-evidence"])], []),
);
check(unsupported.decision === "HANDOFF", "unsupported material claims must hand off");
check(
  unsupported.issues.some((issue) => issue.code === "UNKNOWN_CLAIM_EVIDENCE"),
  "unsupported material claims must identify the missing evidence key",
);
check(
  unsupported.issues.some((issue) => issue.code === "UNKNOWN_CITATION_EVIDENCE"),
  "unknown citation evidence must be rejected independently",
);

const source = documentEvidence("document-pricing", "Published prices may change after review.");
const forgedText = "The published price is fixed.";
const forgedInput = gateInput(
  forgedText,
  [claim("forged", forgedText, [source.evidenceKey])],
  [source],
);
forgedInput.proposedCitations = [
  {
    claimId: "forged",
    claimHash: source.contentHash,
    evidenceKey: source.evidenceKey,
  },
];
const forged = validateGroundedAnswer(forgedInput);
check(forged.decision === "HANDOFF", "preselected or forged citations must hand off");
check(
  forged.issues.some((issue) => issue.code === "CITATION_CLAIM_HASH_MISMATCH"),
  "a citation must bind to the exact output claim hash",
);
check(forged.citations.length === 0, "forged citations must not enter validated output");
const preselected = validateGroundedAnswer({
  ...gateInput(forgedText, [claim("preselected", forgedText, [source.evidenceKey])], [source]),
  proposedCitations: [
    {
      claimId: "preselected",
      claimHash: hashGroundedAnswerText(forgedText),
      evidenceKey: source.evidenceKey,
      selected: true,
    },
  ],
});
check(preselected.decision === "HANDOFF", "model-preselected citations must be rejected");
check(
  preselected.issues.some((issue) => issue.code === "INPUT_INVALID"),
  "citation selection fields must fail strict proposal validation",
);

const exactPrice = "2500 RUB";
const highRiskText = `The appointment price is ${exactPrice}.`;
const wrongPriceEvidence = factEvidence(
  "fact-price",
  "The verified appointment price is 2600 RUB.",
  "2600 RUB",
);
const highRisk = validateGroundedAnswer(
  gateInput(
    highRiskText,
    [claim("high-risk-price", highRiskText, [wrongPriceEvidence.evidenceKey], "HIGH", exactPrice)],
    [wrongPriceEvidence],
  ),
);
check(highRisk.decision === "HANDOFF", "high-risk claims require exact verified support");
check(
  highRisk.issues.some((issue) => issue.code === "HIGH_RISK_EXACT_SUPPORT_REQUIRED"),
  "high-risk exact-value drift must be explicit",
);

const slot = "2026-07-13T10:00:00+02:00";
const liveText = `The available slot is ${slot}.`;
const expiredTool: GroundedAnswerEvidence = {
  evidenceKey: "tool-slot",
  kind: "LIVE_TOOL",
  content: `Available slot: ${slot}`,
  contentHash: hashGroundedAnswerText(`Available slot: ${slot}`),
  authorized: true,
  inCapturedTarget: true,
  stale: false,
  status: "SUCCEEDED",
  observedAt: "2026-07-12T20:00:00.000Z",
  expiresAt: "2026-07-12T21:00:00.000Z",
  exactValueHash: hashGroundedAnswerText(slot),
};
const expired = validateGroundedAnswer(
  gateInput(
    liveText,
    [claim("live-slot", liveText, [expiredTool.evidenceKey], "CRITICAL", slot)],
    [expiredTool],
  ),
);
check(expired.decision === "HANDOFF", "expired live evidence must hand off");
check(
  expired.issues.some((issue) => issue.code === "LIVE_EVIDENCE_EXPIRED"),
  "expired live evidence must be distinguished from invalid evidence",
);
check(expired.citations.length === 0, "expired tools must not produce validated citations");

const orderStatus = "shipped";
const orderText = `Order status: ${orderStatus}.`;
const orderDocument = documentEvidence("document-order-status", orderText);
const orderTool: GroundedAnswerEvidence = {
  evidenceKey: "tool-order-status",
  kind: "LIVE_TOOL",
  content: orderText,
  contentHash: hashGroundedAnswerText(orderText),
  authorized: true,
  inCapturedTarget: true,
  stale: false,
  status: "SUCCEEDED",
  observedAt: "2026-07-12T21:59:00.000Z",
  expiresAt: "2026-07-12T22:04:00.000Z",
  exactValueHash: hashGroundedAnswerText(orderStatus),
};
const operationalClaim = claim(
  "order-status",
  orderText,
  [orderDocument.evidenceKey, orderTool.evidenceKey],
  "HIGH",
  orderStatus,
);
const staticOperationalCitation = gateInput(
  orderText,
  [operationalClaim],
  [orderDocument, orderTool],
);
staticOperationalCitation.requiredEvidenceKind = "LIVE_TOOL";
const staticOperational = validateGroundedAnswer(staticOperationalCitation);
check(
  staticOperational.decision === "HANDOFF",
  "an operational claim cannot cite only static evidence",
);
check(
  staticOperational.issues.some((issue) => issue.code === "REQUIRED_EVIDENCE_KIND_MISSING"),
  "the gate must report missing live operational citation coverage",
);
staticOperationalCitation.proposedCitations = [
  {
    claimId: operationalClaim.claimId,
    claimHash: operationalClaim.textHash,
    evidenceKey: orderTool.evidenceKey,
  },
];
const liveOperational = validateGroundedAnswer(staticOperationalCitation);
check(liveOperational.decision === "ALLOW", "fresh exact live evidence must pass the gate");

const conflictText = "Refund review takes two business days.";
const conflictEvidence = documentEvidence("document-refund", conflictText);
const conflictedInput = gateInput(
  conflictText,
  [claim("refund-window", conflictText, [conflictEvidence.evidenceKey])],
  [conflictEvidence],
);
conflictedInput.conflicts = [
  {
    conflictId: "conflict-refund-window",
    active: true,
    evidenceKeys: [conflictEvidence.evidenceKey],
  },
];
const conflicted = validateGroundedAnswer(conflictedInput);
check(conflicted.decision === "HANDOFF", "active evidence conflicts must hand off");
check(
  conflicted.issues.some((issue) => issue.code === "ACTIVE_EVIDENCE_CONFLICT"),
  "the conflicting evidence key must be reported",
);
check(
  conflicted.citations.length === 0,
  "conflicting evidence must not produce validated citations",
);

const russianText = "Стрижка стоит 2500 RUB.";
const japaneseText = "予約の確認には担当者の承認が必要です。";
const russianEvidence = factEvidence("fact-price-ru", "Цена стрижки: 2500 RUB.", "2500 RUB");
const japaneseEvidence = documentEvidence("document-approval-ja", japaneseText);
const multilingualInput = gateInput(
  `${russianText} ${japaneseText}`,
  [
    claim("price-ru", russianText, [russianEvidence.evidenceKey], "HIGH", "2500 RUB"),
    claim("approval-ja", japaneseText, [japaneseEvidence.evidenceKey]),
  ],
  [japaneseEvidence, russianEvidence],
);
multilingualInput.proposedCitations.reverse();
const multilingual = validateGroundedAnswer(multilingualInput);
check(multilingual.decision === "ALLOW", "valid multilingual claims must pass unchanged");
check(multilingual.safeToSend, "an allowed draft must be explicitly safe to send");
assert.deepEqual(
  multilingual.citations.map((citation) => [
    citation.ordinal,
    citation.claimId,
    citation.evidenceKey,
  ]),
  [
    [0, "price-ru", "fact-price-ru"],
    [1, "approval-ja", "document-approval-ja"],
  ],
);
checks += 1;

const repairText = "Support is available on weekdays.";
const repairEvidence = documentEvidence("document-support", repairText);
const repairInput = gateInput(
  repairText,
  [claim("support-hours", repairText, [repairEvidence.evidenceKey])],
  [repairEvidence],
);
repairInput.proposedCitations = [];
const firstRepair = validateGroundedAnswer(repairInput);
check(firstRepair.decision === "REPAIR_ONCE", "a missing citation may be repaired once");
check(
  firstRepair.repairAttemptsRemaining === 1,
  "the first repair must expose one remaining attempt",
);
const exhausted = validateGroundedAnswer({ ...repairInput, repairAttempt: 1 });
check(exhausted.decision === "HANDOFF", "a second citation repair must hand off");
check(exhausted.repairAttemptsRemaining === 0, "repair exhaustion must be terminal");

console.log(`grounded-answer-gate-smoke: ${checks}/${checks} checks passed`);
