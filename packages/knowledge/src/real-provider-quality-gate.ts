import { createHash } from "node:crypto";
import type {
  KnowledgeV2EvaluationResultStatus,
  KnowledgeV2ExpectedBehavior,
  KnowledgeV2GateOutcome,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import { compareKnowledgeCanonicalText } from "./canonical-order.js";

export const knowledgeRealProviderLocales = ["de", "en", "es", "fr", "pt", "ru"] as const;
export type KnowledgeRealProviderLocale = (typeof knowledgeRealProviderLocales)[number];

export interface KnowledgeRealProviderLocaleFloor {
  minRetrievalRecall: number;
  minGroundingRate: number;
  minSafeBehaviorRate: number;
  minCases: number;
}

export interface KnowledgeRealProviderGatePolicy {
  schemaVersion: 1;
  policyVersion: string;
  criticalPassRate: 1;
  requiredBehaviors: Array<Extract<KnowledgeV2ExpectedBehavior, "ANSWER" | "ABSTAIN" | "HANDOFF">>;
  localeFloors: Record<KnowledgeRealProviderLocale, KnowledgeRealProviderLocaleFloor>;
}

export interface KnowledgeRealProviderCaseObservation {
  caseVersionHash: string;
  locale: string;
  riskLevel: KnowledgeV2RiskLevel;
  critical: boolean;
  expectedBehavior: KnowledgeV2ExpectedBehavior;
  observedBehavior: KnowledgeV2ExpectedBehavior | null;
  status: KnowledgeV2EvaluationResultStatus;
  gateOutcome: KnowledgeV2GateOutcome | null;
  retrievalChecksPassed: number;
  retrievalChecksTotal: number;
  providerOutputHash: string | null;
  gateResultHash: string | null;
  evidenceManifestHash: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: string | null;
}

export interface KnowledgeRealProviderRunIdentity {
  environment: string;
  provider: string;
  generatorModel: string;
  embeddingVersion: string;
  sparseVersion: string;
  rerankerVersion: string;
  retrievalPolicyVersion: string;
  promptPolicyVersion: string;
  graphVersion: string;
  codeCommit: string;
  testCaseSetHash: string;
  candidateManifestHash: string;
  indexSnapshotHash: string;
  indexSchemaHash: string;
  retrievalProcessorPolicyHash: string;
  modelProcessorPolicyHash: string;
  configHash: string;
}

export interface KnowledgeRealProviderGateInput {
  policy: KnowledgeRealProviderGatePolicy;
  identity: KnowledgeRealProviderRunIdentity;
  observations: KnowledgeRealProviderCaseObservation[];
}

interface SliceSummary {
  sliceKey: string;
  total: number;
  passed: number;
  criticalTotal: number;
  criticalPassed: number;
  retrievalRecall: number | null;
  groundingRate: number | null;
  safeBehaviorRate: number | null;
  passedGate: boolean;
  failureCodes: string[];
  sliceHash: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareKnowledgeCanonicalText(left, right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export function knowledgeRealProviderHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function validRate(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isHash(value: string) {
  return /^[a-f0-9]{64}$/u.test(value);
}

function safeIdentifier(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,190}$/u.test(value);
}

function optionalNonnegativeInteger(value: number | null) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

export function knowledgeRealProviderApiBase(
  value: string,
  allowedHosts: readonly string[],
  options: { allowHttp: boolean },
) {
  if (value.length > 2_048 || allowedHosts.length < 1 || allowedHosts.length > 20) {
    throw new Error("Knowledge real-provider API destination is invalid.");
  }
  const normalizedHosts = allowedHosts.map((host) => host.trim().toLowerCase());
  if (
    normalizedHosts.some(
      (host) => !/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[a-f0-9:]+\])$/u.test(host),
    )
  ) {
    throw new Error("Knowledge real-provider API allowlist is invalid.");
  }
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    !normalizedHosts.includes(hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !options.allowHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/+$/u, "").endsWith("/api")
  )
    throw new Error("Knowledge real-provider API destination is invalid or not allowlisted.");
  return url.toString().replace(/\/+$/u, "");
}

function canonicalLocale(value: string): KnowledgeRealProviderLocale | null {
  const locale = value.trim().toLowerCase().split(/[-_]/u)[0] ?? "";
  return knowledgeRealProviderLocales.includes(locale as KnowledgeRealProviderLocale)
    ? (locale as KnowledgeRealProviderLocale)
    : null;
}

function casePassed(observation: KnowledgeRealProviderCaseObservation) {
  if (
    observation.status !== "PASSED" ||
    observation.observedBehavior !== observation.expectedBehavior ||
    !isHash(observation.caseVersionHash) ||
    !isHash(observation.evidenceManifestHash)
  )
    return false;
  if (observation.expectedBehavior !== "ANSWER") return true;
  return (
    observation.gateOutcome === "AUTO_SEND" &&
    observation.retrievalChecksTotal > 0 &&
    Boolean(observation.providerOutputHash && isHash(observation.providerOutputHash)) &&
    Boolean(observation.gateResultHash && isHash(observation.gateResultHash))
  );
}

function summarizeSlice(
  sliceKey: string,
  observations: KnowledgeRealProviderCaseObservation[],
  floor?: KnowledgeRealProviderLocaleFloor,
  requiredBehaviors: KnowledgeRealProviderGatePolicy["requiredBehaviors"] = [],
) {
  const sorted = [...observations].sort((left, right) =>
    compareKnowledgeCanonicalText(left.caseVersionHash, right.caseVersionHash),
  );
  const answers = sorted.filter((item) => item.expectedBehavior === "ANSWER");
  const safeCases = sorted.filter(
    (item) => item.expectedBehavior === "ABSTAIN" || item.expectedBehavior === "HANDOFF",
  );
  const critical = sorted.filter((item) => item.critical);
  const retrievalChecksTotal = answers.reduce((sum, item) => sum + item.retrievalChecksTotal, 0);
  const retrievalChecksPassed = answers.reduce((sum, item) => sum + item.retrievalChecksPassed, 0);
  const retrievalRecall = rate(retrievalChecksPassed, retrievalChecksTotal);
  const groundingRate = rate(answers.filter(casePassed).length, answers.length);
  const safeBehaviorRate = rate(safeCases.filter(casePassed).length, safeCases.length);
  const failureCodes: string[] = [];
  if (critical.some((item) => !casePassed(item))) failureCodes.push("CRITICAL_CASE_FAILED");
  if (floor) {
    if (sorted.length < floor.minCases) failureCodes.push("INSUFFICIENT_CASES");
    for (const behavior of requiredBehaviors) {
      if (!sorted.some((item) => item.expectedBehavior === behavior)) {
        failureCodes.push(`MISSING_BEHAVIOR_${behavior}`);
      }
    }
    if (retrievalRecall === null || retrievalRecall < floor.minRetrievalRecall) {
      failureCodes.push("RETRIEVAL_FLOOR_FAILED");
    }
    if (groundingRate === null || groundingRate < floor.minGroundingRate) {
      failureCodes.push("GROUNDING_FLOOR_FAILED");
    }
    if (safeBehaviorRate === null || safeBehaviorRate < floor.minSafeBehaviorRate) {
      failureCodes.push("SAFE_BEHAVIOR_FLOOR_FAILED");
    }
  }
  const summaryWithoutHash = {
    sliceKey,
    total: sorted.length,
    passed: sorted.filter(casePassed).length,
    criticalTotal: critical.length,
    criticalPassed: critical.filter(casePassed).length,
    retrievalRecall,
    groundingRate,
    safeBehaviorRate,
    passedGate: failureCodes.length === 0,
    failureCodes: [...new Set(failureCodes)].sort(),
  };
  return {
    ...summaryWithoutHash,
    sliceHash: knowledgeRealProviderHash({
      summary: summaryWithoutHash,
      cases: sorted.map((item) => ({
        caseVersionHash: item.caseVersionHash,
        status: item.status,
        expectedBehavior: item.expectedBehavior,
        observedBehavior: item.observedBehavior,
        gateOutcome: item.gateOutcome,
        retrievalChecksPassed: item.retrievalChecksPassed,
        retrievalChecksTotal: item.retrievalChecksTotal,
        evidenceManifestHash: item.evidenceManifestHash,
        providerOutputHash: item.providerOutputHash,
        gateResultHash: item.gateResultHash,
      })),
    }),
  } satisfies SliceSummary;
}

function validatePolicy(policy: KnowledgeRealProviderGatePolicy) {
  const exactBehaviors = ["ABSTAIN", "ANSWER", "HANDOFF"];
  const observedBehaviors = [...new Set(policy.requiredBehaviors)].sort();
  if (
    policy.schemaVersion !== 1 ||
    !safeIdentifier(policy.policyVersion) ||
    policy.criticalPassRate !== 1 ||
    policy.requiredBehaviors.length !== 3 ||
    JSON.stringify(observedBehaviors) !== JSON.stringify(exactBehaviors)
  )
    throw new Error("Knowledge real-provider gate policy is invalid.");
  for (const locale of knowledgeRealProviderLocales) {
    const floor = policy.localeFloors[locale];
    if (
      !floor ||
      !validRate(floor.minRetrievalRecall) ||
      !validRate(floor.minGroundingRate) ||
      !validRate(floor.minSafeBehaviorRate) ||
      !Number.isInteger(floor.minCases) ||
      floor.minCases < policy.requiredBehaviors.length
    )
      throw new Error(`Knowledge real-provider gate policy is invalid for ${locale}.`);
  }
}

function validateIdentity(identity: KnowledgeRealProviderRunIdentity) {
  const denied =
    /(?:^|[-_.])(dev|mock|fixture|acceptance|deterministic|local|unconfigured|unknown)(?:$|[-_.])/iu;
  const versionFields = [
    identity.environment,
    identity.provider,
    identity.generatorModel,
    identity.embeddingVersion,
    identity.sparseVersion,
    identity.rerankerVersion,
    identity.retrievalPolicyVersion,
    identity.promptPolicyVersion,
    identity.graphVersion,
    identity.codeCommit,
  ];
  if (versionFields.some((value) => !safeIdentifier(value) || denied.test(value))) {
    throw new Error(
      "Knowledge real-provider identity is missing or uses a non-real provider identity.",
    );
  }
  for (const value of [
    identity.testCaseSetHash,
    identity.candidateManifestHash,
    identity.indexSnapshotHash,
    identity.indexSchemaHash,
    identity.retrievalProcessorPolicyHash,
    identity.modelProcessorPolicyHash,
    identity.configHash,
  ]) {
    if (!isHash(value)) throw new Error("Knowledge real-provider identity hash is invalid.");
  }
}

export function evaluateKnowledgeRealProviderGate(input: KnowledgeRealProviderGateInput) {
  validatePolicy(input.policy);
  validateIdentity(input.identity);
  const riskLevels: KnowledgeV2RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const statuses: KnowledgeV2EvaluationResultStatus[] = [
    "PASSED",
    "WARNING",
    "FAILED",
    "ERROR",
    "SKIPPED",
  ];
  const behaviors: KnowledgeV2ExpectedBehavior[] = [
    "ANSWER",
    "ABSTAIN",
    "HANDOFF",
    "REFUSE",
    "TOOL_CALL",
    "HOLD_FOR_APPROVAL",
  ];
  const gateOutcomes: KnowledgeV2GateOutcome[] = [
    "AUTO_SEND",
    "HOLD_FOR_APPROVAL",
    "HANDOFF",
    "BLOCKED",
  ];
  const normalized = input.observations
    .map((observation) => {
      const locale = canonicalLocale(observation.locale);
      if (!locale)
        throw new Error("Knowledge real-provider observation has an unsupported locale.");
      if (
        !riskLevels.includes(observation.riskLevel) ||
        !statuses.includes(observation.status) ||
        !behaviors.includes(observation.expectedBehavior) ||
        (observation.observedBehavior !== null &&
          !behaviors.includes(observation.observedBehavior)) ||
        (observation.gateOutcome !== null && !gateOutcomes.includes(observation.gateOutcome)) ||
        !isHash(observation.caseVersionHash) ||
        !isHash(observation.evidenceManifestHash) ||
        (observation.providerOutputHash !== null && !isHash(observation.providerOutputHash)) ||
        (observation.gateResultHash !== null && !isHash(observation.gateResultHash)) ||
        !Number.isInteger(observation.retrievalChecksPassed) ||
        !Number.isInteger(observation.retrievalChecksTotal) ||
        observation.retrievalChecksPassed < 0 ||
        observation.retrievalChecksPassed > observation.retrievalChecksTotal ||
        !optionalNonnegativeInteger(observation.latencyMs) ||
        !optionalNonnegativeInteger(observation.inputTokens) ||
        !optionalNonnegativeInteger(observation.outputTokens) ||
        (observation.costMicros !== null &&
          !/^(?:0|[1-9][0-9]{0,30})$/u.test(observation.costMicros))
      )
        throw new Error("Knowledge real-provider observation is invalid.");
      return { ...observation, locale };
    })
    .sort((left, right) =>
      compareKnowledgeCanonicalText(left.caseVersionHash, right.caseVersionHash),
    );
  const duplicate = normalized.find(
    (item, index) => index > 0 && item.caseVersionHash === normalized[index - 1]?.caseVersionHash,
  );
  if (duplicate)
    throw new Error("Knowledge real-provider observations contain duplicate case versions.");

  const localeSlices = knowledgeRealProviderLocales.map((locale) =>
    summarizeSlice(
      `LOCALE:${locale}`,
      normalized.filter((item) => item.locale === locale),
      input.policy.localeFloors[locale],
      input.policy.requiredBehaviors,
    ),
  );
  const riskOrder: KnowledgeV2RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const riskSlices = riskOrder.map((risk) =>
    summarizeSlice(
      `RISK_LEVEL:${risk}`,
      normalized.filter((item) => item.riskLevel === risk),
    ),
  );
  const criticalStatusSlices = [
    summarizeSlice(
      "CRITICAL_STATUS:critical",
      normalized.filter((item) => item.critical),
    ),
    summarizeSlice(
      "CRITICAL_STATUS:noncritical",
      normalized.filter((item) => !item.critical),
    ),
  ];
  const usage = normalized.reduce(
    (summary, item) => ({
      inputTokens: summary.inputTokens + (item.inputTokens ?? 0),
      outputTokens: summary.outputTokens + (item.outputTokens ?? 0),
      costMicros: (BigInt(summary.costMicros) + BigInt(item.costMicros ?? "0")).toString(),
      latencyMs: summary.latencyMs + (item.latencyMs ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, costMicros: "0", latencyMs: 0 },
  );
  const critical = normalized.filter((item) => item.critical);
  const failureCodes = [
    ...localeSlices.flatMap((slice) =>
      slice.failureCodes.map((code) => `${slice.sliceKey}:${code}`),
    ),
    ...criticalStatusSlices.flatMap((slice) =>
      slice.failureCodes.map((code) => `${slice.sliceKey}:${code}`),
    ),
    ...(critical.length === 0 ? ["NO_CRITICAL_CASES"] : []),
  ].sort();
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    policyVersion: input.policy.policyVersion,
    ok: failureCodes.length === 0,
    identity: input.identity,
    totals: {
      cases: normalized.length,
      passed: normalized.filter(casePassed).length,
      critical: critical.length,
      criticalPassed: critical.filter(casePassed).length,
    },
    usage,
    localeSlices,
    riskSlices,
    criticalStatusSlices,
    cases: normalized.map((item) => ({
      caseVersionHash: item.caseVersionHash,
      locale: item.locale,
      riskLevel: item.riskLevel,
      critical: item.critical,
      expectedBehavior: item.expectedBehavior,
      observedBehavior: item.observedBehavior,
      status: item.status,
      gateOutcome: item.gateOutcome,
      retrievalChecksPassed: item.retrievalChecksPassed,
      retrievalChecksTotal: item.retrievalChecksTotal,
      providerOutputHash: item.providerOutputHash,
      gateResultHash: item.gateResultHash,
      evidenceManifestHash: item.evidenceManifestHash,
      latencyMs: item.latencyMs,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      costMicros: item.costMicros,
    })),
    failureCodes,
  };
  return {
    ...reportWithoutHash,
    reportHash: knowledgeRealProviderHash(reportWithoutHash),
  };
}
