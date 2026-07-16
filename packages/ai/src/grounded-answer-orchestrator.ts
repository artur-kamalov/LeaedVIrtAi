import {
  hashGroundedAnswerText,
  validateGroundedAnswer,
  type GroundedAnswerEvidence,
  type GroundedAnswerEvidenceConflict,
  type GroundedAnswerGateIssue,
  type GroundedAnswerRiskLevel,
  type GroundedAnswerValidatedCitation,
} from "./grounded-answer-gate.js";

const MAX_FINAL_TEXT = 100_000;
const MAX_CLAIMS = 1_000;
const MAX_CITATIONS = 10_000;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;

export interface GroundedAnswerProviderIdentity {
  provider: string;
  model: string;
  version: string;
  region: string;
}

export interface GroundedAnswerProviderInput {
  purpose: "GENERATE" | "REPAIR";
  tenantId: string;
  locale: string;
  question: string;
  promptPolicyVersion: string;
  evidence: readonly GroundedAnswerOrchestrationEvidence[];
  requiredEvidenceKind?: GroundedAnswerEvidence["kind"] | null;
  previousOutput?: unknown;
  repairIssues?: readonly string[];
}

export interface GroundedAnswerProvider {
  readonly identity: GroundedAnswerProviderIdentity;
  generate(input: GroundedAnswerProviderInput, signal: AbortSignal): Promise<unknown>;
}

export interface GroundedAnswerProcessorAdmission extends GroundedAnswerProviderIdentity {
  policyVersion: string;
  policyHash: string;
  promptPolicyVersion: string;
}

export interface GroundedAnswerProcessorAuthorizer {
  authorize(input: {
    tenantId: string;
    purpose: "GENERATE" | "REPAIR";
    promptPolicyVersion: string;
    classifications: readonly string[];
  }): Promise<GroundedAnswerProcessorAdmission | null>;
}

export interface GroundedAnswerOutputPolicy {
  validateInput(input: GroundedAnswerOrchestrationInput): Promise<boolean> | boolean;
  validateOutput(input: {
    orchestration: GroundedAnswerOrchestrationInput;
    finalText: string;
    citations: readonly GroundedAnswerValidatedCitation[];
  }): Promise<boolean> | boolean;
}

export interface GroundedAnswerOrchestrationEvidence {
  evidence: GroundedAnswerEvidence;
  riskLevel: GroundedAnswerRiskLevel;
  classification: string;
  safeLabel: string;
}

export interface GroundedAnswerOrchestrationInput {
  tenantId: string;
  locale: string;
  question: string;
  promptPolicyVersion: string;
  queryClassification: string;
  evidenceAllowed: boolean;
  evidence: readonly GroundedAnswerOrchestrationEvidence[];
  conflicts: readonly GroundedAnswerEvidenceConflict[];
  now: string;
  requiredEvidenceKind?: GroundedAnswerEvidence["kind"] | null;
  signal?: AbortSignal;
}

export interface GroundedAnswerOrchestrationResult {
  disposition: "AUTO_SEND" | "HANDOFF";
  finalText: string | null;
  citations: GroundedAnswerValidatedCitation[];
  issues: Array<
    | GroundedAnswerGateIssue
    | {
        code:
          | "OUTPUT_FORMAT_INVALID"
          | "PROCESSOR_DENIED"
          | "PROVIDER_UNAVAILABLE"
          | "INPUT_POLICY_DENIED"
          | "OUTPUT_POLICY_DENIED";
      }
  >;
  provider: string | null;
  model: string | null;
  providerVersion: string | null;
  region: string | null;
  processorPolicyVersion: string | null;
  processorPolicyHash: string | null;
  promptPolicyVersion: string;
  providerOutputHash: string | null;
  gateInputHash: string | null;
  gateResultHash: string;
  providerCallCount: number;
  repairCount: 0 | 1;
}

interface ProviderClaim {
  claimId: string;
  text: string;
  evidenceKeys: string[];
  exactValueText: string | null;
}

interface ProviderOutput {
  schemaVersion: 1;
  claims: ProviderClaim[];
  citations: Array<{ claimId: string; evidenceKey: string }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(source: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed);
  return Object.keys(source).every((key) => keys.has(key));
}

function parseProviderOutput(value: unknown): ProviderOutput | null {
  const source = record(value);
  if (
    !source ||
    !onlyKeys(source, ["schemaVersion", "claims", "citations"]) ||
    source.schemaVersion !== 1 ||
    !Array.isArray(source.claims) ||
    source.claims.length === 0 ||
    source.claims.length > MAX_CLAIMS ||
    !Array.isArray(source.citations) ||
    source.citations.length > MAX_CITATIONS
  ) {
    return null;
  }
  const claims: ProviderClaim[] = [];
  for (const value of source.claims) {
    const claim = record(value);
    if (
      !claim ||
      !onlyKeys(claim, ["claimId", "text", "evidenceKeys", "exactValueText"]) ||
      typeof claim.claimId !== "string" ||
      !SAFE_KEY.test(claim.claimId) ||
      typeof claim.text !== "string" ||
      !claim.text.trim() ||
      claim.text.length > 8_000 ||
      !Array.isArray(claim.evidenceKeys) ||
      claim.evidenceKeys.length === 0 ||
      claim.evidenceKeys.length > 256 ||
      claim.evidenceKeys.some((key) => typeof key !== "string" || !SAFE_KEY.test(key)) ||
      (claim.exactValueText !== null &&
        (typeof claim.exactValueText !== "string" ||
          !claim.exactValueText ||
          claim.exactValueText.length > 8_000))
    ) {
      return null;
    }
    claims.push({
      claimId: claim.claimId,
      text: claim.text,
      evidenceKeys: Array.from(claim.evidenceKeys, (key: unknown) =>
        typeof key === "string" ? key : "",
      ),
      exactValueText: typeof claim.exactValueText === "string" ? claim.exactValueText : null,
    });
  }
  const citations: Array<{ claimId: string; evidenceKey: string }> = [];
  for (const value of source.citations) {
    const citation = record(value);
    if (
      !citation ||
      !onlyKeys(citation, ["claimId", "evidenceKey"]) ||
      typeof citation.claimId !== "string" ||
      !SAFE_KEY.test(citation.claimId) ||
      typeof citation.evidenceKey !== "string" ||
      !SAFE_KEY.test(citation.evidenceKey)
    ) {
      return null;
    }
    citations.push({ claimId: citation.claimId, evidenceKey: citation.evidenceKey });
  }
  return { schemaVersion: 1, claims, citations };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(source[key])}`)
    .join(",")}}`;
}

function hashValue(value: unknown) {
  return hashGroundedAnswerText(stable(value));
}

function highestRisk(values: readonly GroundedAnswerRiskLevel[]): GroundedAnswerRiskLevel {
  const order: readonly GroundedAnswerRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return values.reduce(
    (highest, value) => (order.indexOf(value) > order.indexOf(highest) ? value : highest),
    "LOW" as GroundedAnswerRiskLevel,
  );
}

function sameIdentity(
  admission: GroundedAnswerProcessorAdmission,
  identity: GroundedAnswerProviderIdentity,
) {
  return (
    admission.provider === identity.provider &&
    admission.model === identity.model &&
    admission.version === identity.version &&
    admission.region === identity.region
  );
}

function handoff(
  promptPolicyVersion: string,
  issues: GroundedAnswerOrchestrationResult["issues"],
  metadata: Partial<GroundedAnswerOrchestrationResult> = {},
): GroundedAnswerOrchestrationResult {
  const base = {
    disposition: "HANDOFF" as const,
    finalText: null,
    citations: [],
    issues,
    provider: null,
    model: null,
    providerVersion: null,
    region: null,
    processorPolicyVersion: null,
    processorPolicyHash: null,
    promptPolicyVersion,
    providerOutputHash: null,
    gateInputHash: null,
    providerCallCount: 0,
    repairCount: 0 as const,
  };
  return {
    ...base,
    ...metadata,
    gateResultHash: metadata.gateResultHash ?? hashValue({ disposition: "HANDOFF", issues }),
  };
}

export class GroundedAnswerOrchestrator {
  constructor(
    private readonly provider: GroundedAnswerProvider,
    private readonly authorizer: GroundedAnswerProcessorAuthorizer,
    private readonly outputPolicy: GroundedAnswerOutputPolicy,
  ) {}

  async answer(
    input: GroundedAnswerOrchestrationInput,
  ): Promise<GroundedAnswerOrchestrationResult> {
    if (
      !input.evidenceAllowed ||
      input.evidence.length === 0 ||
      input.conflicts.some((item) => item.active)
    ) {
      return handoff(input.promptPolicyVersion, []);
    }
    if (!(await this.outputPolicy.validateInput(input))) {
      return handoff(input.promptPolicyVersion, [{ code: "INPUT_POLICY_DENIED" }]);
    }
    const classifications = [
      ...new Set([input.queryClassification, ...input.evidence.map((item) => item.classification)]),
    ].sort();
    let calls = 0;
    let repairCount: 0 | 1 = 0;
    let previousOutput: unknown;
    let repairIssues: string[] | undefined;
    for (const purpose of ["GENERATE", "REPAIR"] as const) {
      if (purpose === "REPAIR" && repairCount === 0) break;
      const admission = await this.authorizer.authorize({
        tenantId: input.tenantId,
        purpose,
        promptPolicyVersion: input.promptPolicyVersion,
        classifications,
      });
      if (!admission || !sameIdentity(admission, this.provider.identity)) {
        return handoff(input.promptPolicyVersion, [{ code: "PROCESSOR_DENIED" }], {
          providerCallCount: calls,
          repairCount,
        });
      }
      let raw: unknown;
      try {
        calls += 1;
        raw = await this.provider.generate(
          {
            purpose,
            tenantId: input.tenantId,
            locale: input.locale,
            question: input.question,
            promptPolicyVersion: input.promptPolicyVersion,
            evidence: input.evidence,
            requiredEvidenceKind: input.requiredEvidenceKind ?? null,
            ...(purpose === "REPAIR"
              ? {
                  previousOutput,
                  ...(repairIssues ? { repairIssues } : {}),
                }
              : {}),
          },
          input.signal ?? new AbortController().signal,
        );
      } catch {
        return handoff(input.promptPolicyVersion, [{ code: "PROVIDER_UNAVAILABLE" }], {
          provider: admission.provider,
          model: admission.model,
          providerVersion: admission.version,
          region: admission.region,
          processorPolicyVersion: admission.policyVersion,
          processorPolicyHash: admission.policyHash,
          providerCallCount: calls,
          repairCount,
        });
      }
      const output = parseProviderOutput(raw);
      if (!output) {
        if (purpose === "GENERATE") {
          previousOutput = raw;
          repairIssues = ["OUTPUT_FORMAT_INVALID"];
          repairCount = 1;
          continue;
        }
        return handoff(input.promptPolicyVersion, [{ code: "OUTPUT_FORMAT_INVALID" }], {
          provider: admission.provider,
          model: admission.model,
          providerVersion: admission.version,
          region: admission.region,
          processorPolicyVersion: admission.policyVersion,
          processorPolicyHash: admission.policyHash,
          providerCallCount: calls,
          repairCount,
        });
      }
      const evidenceByKey = new Map(
        input.evidence.map((item) => [item.evidence.evidenceKey, item]),
      );
      const claims = output.claims.map((claim) => {
        const riskLevel = highestRisk(
          claim.evidenceKeys
            .flatMap((key) => {
              const evidence = evidenceByKey.get(key);
              return evidence ? [evidence.riskLevel] : [];
            })
            .concat(input.requiredEvidenceKind === "LIVE_TOOL" ? ["HIGH"] : []),
        );
        return {
          claimId: claim.claimId,
          text: claim.text,
          textHash: hashGroundedAnswerText(claim.text),
          riskLevel,
          evidenceKeys: claim.evidenceKeys,
          exactValue: claim.exactValueText
            ? { text: claim.exactValueText, textHash: hashGroundedAnswerText(claim.exactValueText) }
            : null,
        };
      });
      const claimHash = new Map(claims.map((claim) => [claim.claimId, claim.textHash]));
      const finalText = claims.map((claim) => claim.text.trim()).join("\n\n");
      if (!finalText || finalText.length > MAX_FINAL_TEXT) {
        if (purpose === "GENERATE") {
          previousOutput = output;
          repairIssues = ["OUTPUT_FORMAT_INVALID"];
          repairCount = 1;
          continue;
        }
        return handoff(input.promptPolicyVersion, [{ code: "OUTPUT_FORMAT_INVALID" }], {
          provider: admission.provider,
          model: admission.model,
          providerVersion: admission.version,
          region: admission.region,
          processorPolicyVersion: admission.policyVersion,
          processorPolicyHash: admission.policyHash,
          providerOutputHash: hashValue(output),
          providerCallCount: calls,
          repairCount,
        });
      }
      const gateInput = {
        finalText,
        claims,
        evidence: input.evidence.map((item) => item.evidence),
        proposedCitations: output.citations.map((citation) => ({
          ...citation,
          claimHash: claimHash.get(citation.claimId) ?? "0".repeat(64),
        })),
        conflicts: input.conflicts,
        now: input.now,
        repairAttempt: purpose === "REPAIR" ? 1 : 0,
        requiredEvidenceKind: input.requiredEvidenceKind ?? null,
      };
      const gate = validateGroundedAnswer(gateInput);
      const metadata = {
        provider: admission.provider,
        model: admission.model,
        providerVersion: admission.version,
        region: admission.region,
        processorPolicyVersion: admission.policyVersion,
        processorPolicyHash: admission.policyHash,
        providerOutputHash: hashValue(output),
        gateInputHash: hashValue(gateInput),
        gateResultHash: hashValue(gate),
        providerCallCount: calls,
        repairCount,
      };
      if (gate.safeToSend) {
        if (
          !(await this.outputPolicy.validateOutput({
            orchestration: input,
            finalText,
            citations: gate.citations,
          }))
        ) {
          return handoff(input.promptPolicyVersion, [{ code: "OUTPUT_POLICY_DENIED" }], metadata);
        }
        return {
          disposition: "AUTO_SEND",
          finalText,
          citations: gate.citations,
          issues: gate.issues,
          promptPolicyVersion: input.promptPolicyVersion,
          ...metadata,
        };
      }
      if (gate.decision === "REPAIR_ONCE" && purpose === "GENERATE") {
        previousOutput = output;
        repairIssues = gate.issues.map((issue) => issue.code);
        repairCount = 1;
        continue;
      }
      return handoff(input.promptPolicyVersion, gate.issues, metadata);
    }
    return handoff(input.promptPolicyVersion, [{ code: "OUTPUT_FORMAT_INVALID" }], {
      providerCallCount: calls,
      repairCount,
    });
  }
}

export const groundedAnswerProviderOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "claims", "citations"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    claims: {
      type: "array",
      minItems: 1,
      maxItems: MAX_CLAIMS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimId", "text", "evidenceKeys", "exactValueText"],
        properties: {
          claimId: { type: "string" },
          text: { type: "string" },
          evidenceKeys: { type: "array", minItems: 1, maxItems: 256, items: { type: "string" } },
          exactValueText: { type: ["string", "null"] },
        },
      },
    },
    citations: {
      type: "array",
      maxItems: MAX_CITATIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimId", "evidenceKey"],
        properties: {
          claimId: { type: "string" },
          evidenceKey: { type: "string" },
        },
      },
    },
  },
} as const;
