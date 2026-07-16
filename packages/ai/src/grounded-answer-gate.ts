const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_DRAFT_CHARACTERS = 100_000;
const MAX_CLAIMS = 1_000;
const MAX_EVIDENCE = 10_000;
const MAX_CITATIONS = 10_000;
const MAX_CONFLICTS = 1_000;
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export type GroundedAnswerRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type GroundedAnswerEvidenceKind = "FACT" | "GUIDANCE" | "DOCUMENT" | "LIVE_TOOL";
export type GroundedAnswerGateDecision = "ALLOW" | "REPAIR_ONCE" | "HANDOFF";

export type GroundedAnswerGateIssueCode =
  | "INPUT_INVALID"
  | "INPUT_LIMIT_EXCEEDED"
  | "CLAIM_ID_DUPLICATE"
  | "CLAIM_TEXT_HASH_MISMATCH"
  | "CLAIM_TEXT_NOT_IN_DRAFT"
  | "CLAIM_EXACT_SUPPORT_REQUIRED"
  | "CLAIM_EVIDENCE_REQUIRED"
  | "REQUIRED_EVIDENCE_KIND_MISSING"
  | "UNKNOWN_CLAIM_EVIDENCE"
  | "EVIDENCE_KEY_DUPLICATE"
  | "EVIDENCE_CONTENT_HASH_MISMATCH"
  | "EVIDENCE_UNAUTHORIZED"
  | "EVIDENCE_TARGET_MISMATCH"
  | "EVIDENCE_STALE"
  | "LIVE_EVIDENCE_FAILED"
  | "LIVE_EVIDENCE_INVALID"
  | "LIVE_EVIDENCE_EXPIRED"
  | "HIGH_RISK_EXACT_VALUE_REQUIRED"
  | "HIGH_RISK_EXACT_VALUE_HASH_MISMATCH"
  | "HIGH_RISK_EXACT_SUPPORT_REQUIRED"
  | "HIGH_RISK_CITATION_NOT_EXACT"
  | "ACTIVE_EVIDENCE_CONFLICT"
  | "UNKNOWN_CITATION_CLAIM"
  | "UNKNOWN_CITATION_EVIDENCE"
  | "CITATION_NOT_DECLARED"
  | "CITATION_CLAIM_HASH_MISMATCH"
  | "DUPLICATE_CITATION"
  | "MISSING_CITATION";

export interface GroundedAnswerExactValue {
  text: string;
  textHash: string;
}

export interface GroundedAnswerMaterialClaim {
  claimId: string;
  text: string;
  textHash: string;
  riskLevel: GroundedAnswerRiskLevel;
  evidenceKeys: readonly string[];
  exactValue?: GroundedAnswerExactValue | null;
}

interface GroundedAnswerEvidenceBase {
  evidenceKey: string;
  kind: GroundedAnswerEvidenceKind;
  content: string;
  contentHash: string;
  authorized: boolean;
  inCapturedTarget: boolean;
  stale: boolean;
}

export interface GroundedAnswerFactEvidence extends GroundedAnswerEvidenceBase {
  kind: "FACT";
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  exactValueHash?: string | null;
}

export interface GroundedAnswerDocumentEvidence extends GroundedAnswerEvidenceBase {
  kind: "DOCUMENT";
}

export interface GroundedAnswerGuidanceEvidence extends GroundedAnswerEvidenceBase {
  kind: "GUIDANCE";
}

export interface GroundedAnswerLiveToolEvidence extends GroundedAnswerEvidenceBase {
  kind: "LIVE_TOOL";
  status: "SUCCEEDED" | "FAILED";
  observedAt: string;
  expiresAt: string;
  exactValueHash?: string | null;
}

export type GroundedAnswerEvidence =
  | GroundedAnswerFactEvidence
  | GroundedAnswerGuidanceEvidence
  | GroundedAnswerDocumentEvidence
  | GroundedAnswerLiveToolEvidence;

export interface GroundedAnswerCitationProposal {
  claimId: string;
  claimHash: string;
  evidenceKey: string;
}

export interface GroundedAnswerEvidenceConflict {
  conflictId: string;
  active: boolean;
  evidenceKeys: readonly string[];
}

export interface GroundedAnswerGateInput {
  finalText: string;
  claims: readonly GroundedAnswerMaterialClaim[];
  evidence: readonly GroundedAnswerEvidence[];
  proposedCitations: readonly GroundedAnswerCitationProposal[];
  conflicts: readonly GroundedAnswerEvidenceConflict[];
  now: string;
  repairAttempt: number;
  requiredEvidenceKind?: GroundedAnswerEvidenceKind | null;
}

export interface GroundedAnswerGateIssue {
  code: GroundedAnswerGateIssueCode;
  repairable: boolean;
  claimId: string | null;
  evidenceKey: string | null;
}

export interface GroundedAnswerValidatedCitation {
  ordinal: number;
  claimId: string;
  claimHash: string;
  evidenceKey: string;
  evidenceKind: GroundedAnswerEvidenceKind;
}

export interface GroundedAnswerGateResult {
  decision: GroundedAnswerGateDecision;
  safeToSend: boolean;
  repairAttemptsRemaining: 0 | 1;
  issues: GroundedAnswerGateIssue[];
  citations: GroundedAnswerValidatedCitation[];
}

interface ParsedInput {
  finalText: string;
  claims: GroundedAnswerMaterialClaim[];
  evidence: GroundedAnswerEvidence[];
  proposedCitations: GroundedAnswerCitationProposal[];
  conflicts: GroundedAnswerEvidenceConflict[];
  nowMs: number;
  repairAttempt: number;
  requiredEvidenceKind: GroundedAnswerEvidenceKind | null;
}

interface ClaimState {
  claim: GroundedAnswerMaterialClaim;
  usableEvidenceKeys: Set<string>;
  exactEvidenceKeys: Set<string>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

function hasOnlyKeys(source: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(source).every((key) => allowed.has(key));
}

function riskLevel(value: unknown): value is GroundedAnswerRiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function validKey(value: string) {
  return value.length > 0 && value.length <= 240 && value.trim() === value;
}

function validIsoInstant(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseClaim(value: unknown): GroundedAnswerMaterialClaim | null {
  const source = record(value);
  if (!source) return null;
  const evidenceKeys = stringArray(source.evidenceKeys);
  const exactSource =
    source.exactValue === null || source.exactValue === undefined
      ? null
      : record(source.exactValue);
  if (
    typeof source.claimId !== "string" ||
    !validKey(source.claimId) ||
    typeof source.text !== "string" ||
    !source.text.trim() ||
    source.text.length > 8_000 ||
    typeof source.textHash !== "string" ||
    !SHA256.test(source.textHash) ||
    !riskLevel(source.riskLevel) ||
    !evidenceKeys ||
    evidenceKeys.length > 256 ||
    evidenceKeys.some((key) => !validKey(key)) ||
    (exactSource &&
      (typeof exactSource.text !== "string" ||
        !exactSource.text ||
        exactSource.text.length > 8_000 ||
        typeof exactSource.textHash !== "string" ||
        !SHA256.test(exactSource.textHash)))
  ) {
    return null;
  }
  return {
    claimId: source.claimId,
    text: source.text,
    textHash: source.textHash,
    riskLevel: source.riskLevel,
    evidenceKeys,
    exactValue: exactSource
      ? { text: exactSource.text as string, textHash: exactSource.textHash as string }
      : null,
  };
}

function parseEvidence(value: unknown): GroundedAnswerEvidence | null {
  const source = record(value);
  if (
    !source ||
    typeof source.evidenceKey !== "string" ||
    !validKey(source.evidenceKey) ||
    typeof source.content !== "string" ||
    source.content.length > 100_000 ||
    typeof source.contentHash !== "string" ||
    !SHA256.test(source.contentHash) ||
    typeof source.authorized !== "boolean" ||
    typeof source.inCapturedTarget !== "boolean" ||
    typeof source.stale !== "boolean"
  ) {
    return null;
  }
  const common = {
    evidenceKey: source.evidenceKey,
    content: source.content,
    contentHash: source.contentHash,
    authorized: source.authorized,
    inCapturedTarget: source.inCapturedTarget,
    stale: source.stale,
  };
  if (source.kind === "DOCUMENT" || source.kind === "GUIDANCE") {
    return { ...common, kind: source.kind };
  }
  if (source.kind === "FACT") {
    if (
      (source.verificationStatus !== "VERIFIED" && source.verificationStatus !== "UNVERIFIED") ||
      (source.exactValueHash !== undefined &&
        source.exactValueHash !== null &&
        (typeof source.exactValueHash !== "string" || !SHA256.test(source.exactValueHash)))
    ) {
      return null;
    }
    return {
      ...common,
      kind: "FACT",
      verificationStatus: source.verificationStatus,
      exactValueHash: typeof source.exactValueHash === "string" ? source.exactValueHash : null,
    };
  }
  if (source.kind === "LIVE_TOOL") {
    if (
      (source.status !== "SUCCEEDED" && source.status !== "FAILED") ||
      typeof source.observedAt !== "string" ||
      typeof source.expiresAt !== "string" ||
      (source.exactValueHash !== undefined &&
        source.exactValueHash !== null &&
        (typeof source.exactValueHash !== "string" || !SHA256.test(source.exactValueHash)))
    ) {
      return null;
    }
    return {
      ...common,
      kind: "LIVE_TOOL",
      status: source.status,
      observedAt: source.observedAt,
      expiresAt: source.expiresAt,
      exactValueHash: typeof source.exactValueHash === "string" ? source.exactValueHash : null,
    };
  }
  return null;
}

function parseCitation(value: unknown): GroundedAnswerCitationProposal | null {
  const source = record(value);
  if (
    !source ||
    !hasOnlyKeys(source, ["claimId", "claimHash", "evidenceKey"]) ||
    typeof source.claimId !== "string" ||
    !validKey(source.claimId) ||
    typeof source.claimHash !== "string" ||
    !SHA256.test(source.claimHash) ||
    typeof source.evidenceKey !== "string" ||
    !validKey(source.evidenceKey)
  ) {
    return null;
  }
  return {
    claimId: source.claimId,
    claimHash: source.claimHash,
    evidenceKey: source.evidenceKey,
  };
}

function parseConflict(value: unknown): GroundedAnswerEvidenceConflict | null {
  const source = record(value);
  const evidenceKeys = source ? stringArray(source.evidenceKeys) : null;
  if (
    !source ||
    typeof source.conflictId !== "string" ||
    !validKey(source.conflictId) ||
    typeof source.active !== "boolean" ||
    !evidenceKeys ||
    evidenceKeys.length > MAX_EVIDENCE ||
    evidenceKeys.some((key) => !validKey(key))
  ) {
    return null;
  }
  return { conflictId: source.conflictId, active: source.active, evidenceKeys };
}

function parseInput(value: unknown): ParsedInput | null {
  const source = record(value);
  if (
    !source ||
    typeof source.finalText !== "string" ||
    source.finalText.length > MAX_DRAFT_CHARACTERS ||
    !Array.isArray(source.claims) ||
    !Array.isArray(source.evidence) ||
    !Array.isArray(source.proposedCitations) ||
    !Array.isArray(source.conflicts) ||
    typeof source.now !== "string" ||
    !validIsoInstant(source.now) ||
    typeof source.repairAttempt !== "number" ||
    !Number.isInteger(source.repairAttempt) ||
    source.repairAttempt < 0 ||
    (source.requiredEvidenceKind !== undefined &&
      source.requiredEvidenceKind !== null &&
      source.requiredEvidenceKind !== "FACT" &&
      source.requiredEvidenceKind !== "GUIDANCE" &&
      source.requiredEvidenceKind !== "DOCUMENT" &&
      source.requiredEvidenceKind !== "LIVE_TOOL")
  ) {
    return null;
  }
  if (
    source.claims.length > MAX_CLAIMS ||
    source.evidence.length > MAX_EVIDENCE ||
    source.proposedCitations.length > MAX_CITATIONS ||
    source.conflicts.length > MAX_CONFLICTS
  ) {
    return null;
  }
  const claims = source.claims.map(parseClaim);
  const evidence = source.evidence.map(parseEvidence);
  const proposedCitations = source.proposedCitations.map(parseCitation);
  const conflicts = source.conflicts.map(parseConflict);
  if (
    claims.some((item) => !item) ||
    evidence.some((item) => !item) ||
    proposedCitations.some((item) => !item) ||
    conflicts.some((item) => !item)
  ) {
    return null;
  }
  return {
    finalText: source.finalText,
    claims: claims as GroundedAnswerMaterialClaim[],
    evidence: evidence as GroundedAnswerEvidence[],
    proposedCitations: proposedCitations as GroundedAnswerCitationProposal[],
    conflicts: conflicts as GroundedAnswerEvidenceConflict[],
    nowMs: Date.parse(source.now),
    repairAttempt: source.repairAttempt,
    requiredEvidenceKind:
      source.requiredEvidenceKind === "FACT" ||
      source.requiredEvidenceKind === "GUIDANCE" ||
      source.requiredEvidenceKind === "DOCUMENT" ||
      source.requiredEvidenceKind === "LIVE_TOOL"
        ? source.requiredEvidenceKind
        : null,
  };
}

function rotateRight(value: number, count: number) {
  return (value >>> count) | (value << (32 - count));
}

export function hashGroundedAnswerText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function invalidResult(code: "INPUT_INVALID" | "INPUT_LIMIT_EXCEEDED"): GroundedAnswerGateResult {
  return {
    decision: "HANDOFF",
    safeToSend: false,
    repairAttemptsRemaining: 0,
    issues: [{ code, repairable: false, claimId: null, evidenceKey: null }],
    citations: [],
  };
}

function normalizedExactText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function validateGroundedAnswer(value: unknown): GroundedAnswerGateResult {
  const source = record(value);
  if (
    source &&
    ((Array.isArray(source.claims) && source.claims.length > MAX_CLAIMS) ||
      (Array.isArray(source.evidence) && source.evidence.length > MAX_EVIDENCE) ||
      (Array.isArray(source.proposedCitations) &&
        source.proposedCitations.length > MAX_CITATIONS) ||
      (Array.isArray(source.conflicts) && source.conflicts.length > MAX_CONFLICTS) ||
      (typeof source.finalText === "string" && source.finalText.length > MAX_DRAFT_CHARACTERS))
  ) {
    return invalidResult("INPUT_LIMIT_EXCEEDED");
  }
  const input = parseInput(value);
  if (!input) return invalidResult("INPUT_INVALID");

  const issues: GroundedAnswerGateIssue[] = [];
  const issueKeys = new Set<string>();
  const addIssue = (
    code: GroundedAnswerGateIssueCode,
    repairable: boolean,
    claimId: string | null = null,
    evidenceKey: string | null = null,
  ) => {
    const key = `${code}:${claimId ?? ""}:${evidenceKey ?? ""}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({ code, repairable, claimId, evidenceKey });
  };

  const evidenceByKey = new Map<string, GroundedAnswerEvidence>();
  const duplicateEvidenceKeys = new Set<string>();
  for (const evidence of input.evidence) {
    if (evidenceByKey.has(evidence.evidenceKey)) {
      duplicateEvidenceKeys.add(evidence.evidenceKey);
      addIssue("EVIDENCE_KEY_DUPLICATE", false, null, evidence.evidenceKey);
    } else {
      evidenceByKey.set(evidence.evidenceKey, evidence);
    }
  }

  const claimById = new Map<string, ClaimState>();
  const claimOrder = new Map<string, number>();
  for (const [index, claim] of input.claims.entries()) {
    if (claimById.has(claim.claimId)) {
      addIssue("CLAIM_ID_DUPLICATE", false, claim.claimId);
      continue;
    }
    claimOrder.set(claim.claimId, index);
    const state: ClaimState = {
      claim,
      usableEvidenceKeys: new Set<string>(),
      exactEvidenceKeys: new Set<string>(),
    };
    claimById.set(claim.claimId, state);
    if (hashGroundedAnswerText(claim.text) !== claim.textHash) {
      addIssue("CLAIM_TEXT_HASH_MISMATCH", false, claim.claimId);
    }
    if (!input.finalText.includes(claim.text)) {
      addIssue("CLAIM_TEXT_NOT_IN_DRAFT", false, claim.claimId);
    }
    const keys = [...new Set(claim.evidenceKeys)];
    if (keys.length === 0) addIssue("CLAIM_EVIDENCE_REQUIRED", false, claim.claimId);
    if (
      input.requiredEvidenceKind &&
      !keys.some((key) => evidenceByKey.get(key)?.kind === input.requiredEvidenceKind)
    ) {
      addIssue("REQUIRED_EVIDENCE_KIND_MISSING", false, claim.claimId);
    }
    const highRisk = claim.riskLevel === "HIGH" || claim.riskLevel === "CRITICAL";
    if (highRisk) {
      if (!claim.exactValue) {
        addIssue("HIGH_RISK_EXACT_VALUE_REQUIRED", false, claim.claimId);
      } else if (
        hashGroundedAnswerText(claim.exactValue.text) !== claim.exactValue.textHash ||
        !claim.text.includes(claim.exactValue.text)
      ) {
        addIssue("HIGH_RISK_EXACT_VALUE_HASH_MISMATCH", false, claim.claimId);
      }
    }
    for (const evidenceKey of keys) {
      const evidence = evidenceByKey.get(evidenceKey);
      if (!evidence) {
        addIssue("UNKNOWN_CLAIM_EVIDENCE", false, claim.claimId, evidenceKey);
        continue;
      }
      let usable = !duplicateEvidenceKeys.has(evidenceKey);
      if (hashGroundedAnswerText(evidence.content) !== evidence.contentHash) {
        usable = false;
        addIssue("EVIDENCE_CONTENT_HASH_MISMATCH", false, claim.claimId, evidenceKey);
      }
      if (!evidence.authorized) {
        usable = false;
        addIssue("EVIDENCE_UNAUTHORIZED", false, claim.claimId, evidenceKey);
      }
      if (!evidence.inCapturedTarget) {
        usable = false;
        addIssue("EVIDENCE_TARGET_MISMATCH", false, claim.claimId, evidenceKey);
      }
      if (evidence.stale) {
        usable = false;
        addIssue("EVIDENCE_STALE", false, claim.claimId, evidenceKey);
      }
      let liveFresh = true;
      if (evidence.kind === "LIVE_TOOL") {
        const observedAt = Date.parse(evidence.observedAt);
        const expiresAt = Date.parse(evidence.expiresAt);
        if (evidence.status !== "SUCCEEDED") {
          usable = false;
          liveFresh = false;
          addIssue("LIVE_EVIDENCE_FAILED", false, claim.claimId, evidenceKey);
        } else if (
          !validIsoInstant(evidence.observedAt) ||
          !validIsoInstant(evidence.expiresAt) ||
          observedAt > input.nowMs ||
          expiresAt <= observedAt
        ) {
          usable = false;
          liveFresh = false;
          addIssue("LIVE_EVIDENCE_INVALID", false, claim.claimId, evidenceKey);
        } else if (expiresAt <= input.nowMs) {
          usable = false;
          liveFresh = false;
          addIssue("LIVE_EVIDENCE_EXPIRED", false, claim.claimId, evidenceKey);
        }
      }
      if (usable) state.usableEvidenceKeys.add(evidenceKey);
      const normalizedClaim = normalizedExactText(claim.text);
      const normalizedEvidence = normalizedExactText(evidence.content);
      const extractiveSupport =
        normalizedClaim.length > 0 &&
        (evidence.kind === "DOCUMENT"
          ? normalizedEvidence.includes(normalizedClaim)
          : normalizedEvidence === normalizedClaim);
      if (usable && extractiveSupport && !highRisk) state.exactEvidenceKeys.add(evidenceKey);
      if (
        highRisk &&
        usable &&
        claim.exactValue &&
        evidence.kind !== "DOCUMENT" &&
        evidence.kind !== "GUIDANCE" &&
        evidence.exactValueHash === claim.exactValue.textHash &&
        evidence.content.includes(claim.exactValue.text) &&
        (evidence.kind !== "FACT" || evidence.verificationStatus === "VERIFIED") &&
        (evidence.kind !== "LIVE_TOOL" || liveFresh)
      ) {
        state.exactEvidenceKeys.add(evidenceKey);
      }
    }
    if (state.exactEvidenceKeys.size === 0) {
      addIssue("CLAIM_EXACT_SUPPORT_REQUIRED", false, claim.claimId);
    }
    if (highRisk && state.exactEvidenceKeys.size === 0) {
      addIssue("HIGH_RISK_EXACT_SUPPORT_REQUIRED", false, claim.claimId);
    }
    if (
      input.requiredEvidenceKind &&
      ![...state.exactEvidenceKeys].some(
        (evidenceKey) => evidenceByKey.get(evidenceKey)?.kind === input.requiredEvidenceKind,
      )
    ) {
      addIssue("REQUIRED_EVIDENCE_KIND_MISSING", false, claim.claimId);
    }
  }

  const usedEvidenceKeys = new Set(
    [...claimById.values()].flatMap(({ claim }) => [...claim.evidenceKeys]),
  );
  for (const conflict of input.conflicts) {
    if (!conflict.active) continue;
    for (const evidenceKey of conflict.evidenceKeys) {
      if (usedEvidenceKeys.has(evidenceKey)) {
        for (const claimState of claimById.values()) {
          const { claim } = claimState;
          if (claim.evidenceKeys.includes(evidenceKey)) {
            claimState.usableEvidenceKeys.delete(evidenceKey);
            claimState.exactEvidenceKeys.delete(evidenceKey);
            addIssue("ACTIVE_EVIDENCE_CONFLICT", false, claim.claimId, evidenceKey);
          }
        }
      }
    }
  }

  const validCitations: Array<Omit<GroundedAnswerValidatedCitation, "ordinal">> = [];
  const citationKeys = new Set<string>();
  const claimsWithCitation = new Set<string>();
  const claimsWithRequiredCitation = new Set<string>();
  for (const citation of input.proposedCitations) {
    const claimState = claimById.get(citation.claimId);
    const evidence = evidenceByKey.get(citation.evidenceKey);
    if (!claimState) {
      addIssue("UNKNOWN_CITATION_CLAIM", false, citation.claimId, citation.evidenceKey);
      continue;
    }
    if (!evidence) {
      addIssue("UNKNOWN_CITATION_EVIDENCE", false, citation.claimId, citation.evidenceKey);
      continue;
    }
    if (!claimState.claim.evidenceKeys.includes(citation.evidenceKey)) {
      addIssue("CITATION_NOT_DECLARED", false, citation.claimId, citation.evidenceKey);
      continue;
    }
    if (citation.claimHash !== claimState.claim.textHash) {
      addIssue("CITATION_CLAIM_HASH_MISMATCH", false, citation.claimId, citation.evidenceKey);
      continue;
    }
    if (!claimState.usableEvidenceKeys.has(citation.evidenceKey)) continue;
    if (!claimState.exactEvidenceKeys.has(citation.evidenceKey)) {
      addIssue("HIGH_RISK_CITATION_NOT_EXACT", false, citation.claimId, citation.evidenceKey);
      continue;
    }
    const key = `${citation.claimId}:${citation.evidenceKey}`;
    if (citationKeys.has(key)) {
      addIssue("DUPLICATE_CITATION", true, citation.claimId, citation.evidenceKey);
      continue;
    }
    citationKeys.add(key);
    claimsWithCitation.add(citation.claimId);
    if (evidence.kind === input.requiredEvidenceKind) {
      claimsWithRequiredCitation.add(citation.claimId);
    }
    validCitations.push({
      claimId: citation.claimId,
      claimHash: claimState.claim.textHash,
      evidenceKey: citation.evidenceKey,
      evidenceKind: evidence.kind,
    });
  }
  for (const claimId of claimById.keys()) {
    if (!claimsWithCitation.has(claimId)) addIssue("MISSING_CITATION", true, claimId);
    if (input.requiredEvidenceKind && !claimsWithRequiredCitation.has(claimId)) {
      addIssue("REQUIRED_EVIDENCE_KIND_MISSING", false, claimId);
    }
  }

  validCitations.sort((left, right) => {
    const claimDifference =
      (claimOrder.get(left.claimId) ?? 0) - (claimOrder.get(right.claimId) ?? 0);
    return claimDifference || left.evidenceKey.localeCompare(right.evidenceKey);
  });
  const citations = validCitations.map((citation, ordinal) => ({ ...citation, ordinal }));
  const hasBlockingIssue = issues.some((issue) => !issue.repairable);
  const hasRepairableIssue = issues.some((issue) => issue.repairable);
  const decision: GroundedAnswerGateDecision = hasBlockingIssue
    ? "HANDOFF"
    : hasRepairableIssue && input.repairAttempt === 0
      ? "REPAIR_ONCE"
      : hasRepairableIssue
        ? "HANDOFF"
        : "ALLOW";
  return {
    decision,
    safeToSend: decision === "ALLOW",
    repairAttemptsRemaining: decision === "REPAIR_ONCE" ? 1 : 0,
    issues,
    citations,
  };
}
