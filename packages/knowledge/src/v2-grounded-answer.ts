import {
  GroundedAnswerOrchestrator,
  hashGroundedAnswerText,
  type GroundedAnswerOrchestrationInput,
  type GroundedAnswerOrchestrationResult,
  type GroundedAnswerOutputPolicy,
  type GroundedAnswerProcessorAdmission,
  type GroundedAnswerProcessorAuthorizer,
  type GroundedAnswerProvider,
} from "@leadvirt/ai";
import type { Prisma, PrismaClient } from "@leadvirt/db";
import type {
  KnowledgeV2ModelProcessorPolicy,
  KnowledgeV2RiskLevel,
  KnowledgeV2SecurityClassification,
} from "@leadvirt/types";
import { hashKnowledgeValue } from "./legacy-hash-embedding.js";
import { stableKnowledgeValue } from "./publisher.js";
import {
  parseKnowledgeV2ProcessorQueryAdmissionBinding,
  revalidateKnowledgeV2ProcessorQueryAdmission,
} from "./v2-processor-query-admission.js";
import type { KnowledgeEvidenceBundle } from "./v2-retriever.js";
import {
  equalKnowledgeV2QueryHashBindings,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  parseKnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "./tenant-query-hash.js";

const classificationOrder: readonly KnowledgeV2SecurityClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
  "SECRET",
];
const credentialPattern =
  /(?:api[_ -]?key|access[_ -]?token|authorization|password|secret|private[_ -]?key)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/iu;
const escalationPattern =
  /\b(?:handoff|escalat|manager|human review|manual review|refus|must not|do not|never|forbidden|prohibit)\b|(?:передат|менеджер|оператор|нельзя|запрещ)/iu;

export interface KnowledgeV2ModelProcessorIdentity {
  policyVersion: string;
  promptPolicyVersion: string;
  provider: string;
  model: string;
  version: string;
  region: string;
  maxClassification: KnowledgeV2SecurityClassification;
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function normalizedPolicy(value: Prisma.JsonValue | null): KnowledgeV2ModelProcessorPolicy | null {
  const policy = record(value);
  const groundedAnswer = record(policy.groundedAnswer);
  const allowed = groundedAnswer.allowedClassifications;
  if (
    policy.schemaVersion !== 1 ||
    typeof policy.policyVersion !== "string" ||
    !policy.policyVersion ||
    policy.approved !== true ||
    typeof policy.promptPolicyVersion !== "string" ||
    !policy.promptPolicyVersion ||
    typeof groundedAnswer.provider !== "string" ||
    !groundedAnswer.provider ||
    typeof groundedAnswer.model !== "string" ||
    !groundedAnswer.model ||
    typeof groundedAnswer.version !== "string" ||
    !groundedAnswer.version ||
    typeof groundedAnswer.region !== "string" ||
    !groundedAnswer.region ||
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    new Set(allowed).size !== allowed.length ||
    allowed.some(
      (item) =>
        typeof item !== "string" ||
        !classificationOrder.includes(item as KnowledgeV2SecurityClassification),
    )
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    approved: true,
    promptPolicyVersion: policy.promptPolicyVersion,
    groundedAnswer: {
      provider: groundedAnswer.provider,
      model: groundedAnswer.model,
      version: groundedAnswer.version,
      region: groundedAnswer.region,
      allowedClassifications: [...allowed].sort(
        (left, right) =>
          classificationOrder.indexOf(left as KnowledgeV2SecurityClassification) -
          classificationOrder.indexOf(right as KnowledgeV2SecurityClassification),
      ) as KnowledgeV2SecurityClassification[],
    },
  };
}

export class PrismaKnowledgeV2ModelProcessorAuthorizer implements GroundedAnswerProcessorAuthorizer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: KnowledgeV2ModelProcessorIdentity,
  ) {}

  async authorize(input: {
    tenantId: string;
    purpose: "GENERATE" | "REPAIR";
    promptPolicyVersion: string;
    classifications: readonly string[];
  }): Promise<GroundedAnswerProcessorAdmission | null> {
    return this.authorizeWithDatabase(this.prisma, input);
  }

  async authorizeWithDatabase(
    database: PrismaClient | Prisma.TransactionClient,
    input: {
      tenantId: string;
      purpose: "GENERATE" | "REPAIR";
      promptPolicyVersion: string;
      classifications: readonly string[];
    },
  ): Promise<GroundedAnswerProcessorAdmission | null> {
    if (input.promptPolicyVersion !== this.identity.promptPolicyVersion) return null;
    const delegate = database.knowledgeV2Settings as unknown as {
      findUnique(input: {
        where: { tenantId: string };
        select: { modelProcessorPolicy: true };
      }): Promise<{ modelProcessorPolicy: Prisma.JsonValue | null } | null>;
    };
    const settings = await delegate.findUnique({
      where: { tenantId: input.tenantId },
      select: { modelProcessorPolicy: true },
    });
    const policy = normalizedPolicy(settings?.modelProcessorPolicy ?? null);
    const processor = policy?.groundedAnswer;
    const maximum = classificationOrder.indexOf(this.identity.maxClassification);
    const classifications = [...new Set(input.classifications)];
    if (
      !policy ||
      !processor ||
      policy.policyVersion !== this.identity.policyVersion ||
      policy.promptPolicyVersion !== this.identity.promptPolicyVersion ||
      processor.provider !== this.identity.provider ||
      processor.model !== this.identity.model ||
      processor.version !== this.identity.version ||
      processor.region !== this.identity.region ||
      processor.allowedClassifications.some(
        (classification) => classificationOrder.indexOf(classification) > maximum,
      ) ||
      classifications.some(
        (classification) =>
          !classificationOrder.includes(classification as KnowledgeV2SecurityClassification) ||
          classificationOrder.indexOf(classification as KnowledgeV2SecurityClassification) >
            maximum ||
          !processor.allowedClassifications.includes(
            classification as KnowledgeV2SecurityClassification,
          ),
      )
    ) {
      return null;
    }
    return {
      provider: processor.provider,
      model: processor.model,
      version: processor.version,
      region: processor.region,
      policyVersion: policy.policyVersion,
      policyHash: hashKnowledgeValue(stableKnowledgeValue(policy)),
      promptPolicyVersion: policy.promptPolicyVersion,
    };
  }
}

export interface KnowledgeV2OutputInspector {
  validateInput?(input: GroundedAnswerOrchestrationInput): Promise<boolean> | boolean;
  validateOutput?(value: string): Promise<boolean> | boolean;
}

export class KnowledgeV2GroundedOutputPolicy implements GroundedAnswerOutputPolicy {
  constructor(private readonly inspector: KnowledgeV2OutputInspector = {}) {}

  async validateInput(input: GroundedAnswerOrchestrationInput) {
    if (
      credentialPattern.test(input.question) ||
      input.evidence.some((item) => credentialPattern.test(item.evidence.content))
    ) {
      return false;
    }
    return this.inspector.validateInput ? this.inspector.validateInput(input) : true;
  }

  async validateOutput(input: { finalText: string }) {
    if (credentialPattern.test(input.finalText)) return false;
    return this.inspector.validateOutput ? this.inspector.validateOutput(input.finalText) : true;
  }
}

function riskClassification(riskLevel: KnowledgeV2RiskLevel) {
  return riskLevel === "HIGH" || riskLevel === "CRITICAL" ? "SENSITIVE" : "INTERNAL";
}

export function knowledgeV2GroundedAnswerInput(input: {
  tenantId: string;
  locale: string;
  question: string;
  queryClassification: KnowledgeV2SecurityClassification;
  promptPolicyVersion: string;
  bundle: KnowledgeEvidenceBundle;
  now: string;
  queryHashKeyring: KnowledgeV2QueryHashKeyring;
  signal?: AbortSignal;
}): GroundedAnswerOrchestrationInput {
  const question = input.question.replace(/\s+/gu, " ").trim();
  const persistedProcessorQueryAdmission = parseKnowledgeV2ProcessorQueryAdmissionBinding(
    input.bundle.answerPolicy.processorQueryAdmission,
  );
  const processorQueryAdmission = revalidateKnowledgeV2ProcessorQueryAdmission(
    {
      tenantId: input.tenantId,
      query: question,
      classification: input.queryClassification,
    },
    persistedProcessorQueryAdmission,
    input.queryHashKeyring,
  );
  const queryHash = parseKnowledgeV2QueryHashBinding(input.bundle.answerPolicy.queryHash);
  const processorQueryHash = processorQueryAdmission
    ? parseKnowledgeV2QueryHashBinding({
        hash: processorQueryAdmission.originalQueryHash,
        keyId: processorQueryAdmission.queryHashKeyId,
        version: processorQueryAdmission.queryHashVersion,
      })
    : null;
  const processorQueryAdmissionMatches = Boolean(
    queryHash &&
    input.queryHashKeyring.verify({
      tenantId: input.tenantId,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
      value: question,
      binding: queryHash,
    }) &&
    processorQueryAdmission?.admitted &&
    processorQueryHash &&
    equalKnowledgeV2QueryHashBindings(processorQueryHash, queryHash) &&
    processorQueryAdmission.operationalCategory === input.bundle.answerPolicy.operationalCategory &&
    processorQueryAdmission.requiresLiveEvidence === input.bundle.answerPolicy.requiresLiveEvidence,
  );
  const guidanceForcesHandoff = input.bundle.guidance.some(
    (item) =>
      item.riskLevel === "HIGH" ||
      item.riskLevel === "CRITICAL" ||
      escalationPattern.test(item.instruction),
  );
  const evidence = [
    ...input.bundle.facts.map((item) => ({
      evidence: {
        evidenceKey: item.evidenceKey,
        kind: "FACT" as const,
        content: item.value,
        contentHash: hashGroundedAnswerText(item.value),
        authorized: true,
        inCapturedTarget: true,
        stale: false,
        verificationStatus:
          item.verificationStatus === "VERIFIED" ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
        exactValueHash: hashGroundedAnswerText(item.value),
      },
      riskLevel: item.riskLevel,
      classification: riskClassification(item.riskLevel),
      safeLabel: item.safeLabel,
    })),
    ...input.bundle.guidance.map((item) => ({
      evidence: {
        evidenceKey: item.evidenceKey,
        kind: "GUIDANCE" as const,
        content: item.instruction,
        contentHash: hashGroundedAnswerText(item.instruction),
        authorized: true,
        inCapturedTarget: true,
        stale: false,
      },
      riskLevel: item.riskLevel,
      classification: riskClassification(item.riskLevel),
      safeLabel: item.safeLabel,
    })),
    ...input.bundle.documents.map((item) => ({
      evidence: {
        evidenceKey: item.evidenceKey,
        kind: "DOCUMENT" as const,
        content: item.content,
        contentHash: hashGroundedAnswerText(item.content),
        authorized: true,
        inCapturedTarget: true,
        stale: false,
      },
      riskLevel: "LOW" as const,
      classification: item.kind === "DOCUMENT" ? item.classification : "INTERNAL",
      safeLabel: item.title,
    })),
    ...input.bundle.liveToolResults.map((item) => ({
      evidence: {
        evidenceKey: `v2:tool:${item.executionId}:${item.contentHash}`,
        kind: "LIVE_TOOL" as const,
        content: item.content,
        contentHash: hashGroundedAnswerText(item.content),
        authorized: true,
        inCapturedTarget: true,
        stale: false,
        status: item.status,
        observedAt: item.observedAt,
        expiresAt: item.expiresAt,
        exactValueHash: item.exactValueHash,
      },
      riskLevel: "HIGH" as const,
      classification: "CUSTOMER_PERSONAL",
      safeLabel: item.safeName,
    })),
  ];
  return {
    tenantId: input.tenantId,
    locale: input.locale,
    question:
      processorQueryAdmissionMatches && processorQueryAdmission?.admitted
        ? processorQueryAdmission.processorQuery
        : "",
    promptPolicyVersion: input.promptPolicyVersion,
    queryClassification: input.queryClassification,
    evidenceAllowed:
      input.bundle.corpusKind === "STRUCTURED_V2" &&
      input.bundle.gateOutcome === "AUTO_SEND" &&
      input.bundle.answerPolicy.allowAutoSend &&
      processorQueryAdmissionMatches &&
      !guidanceForcesHandoff,
    evidence,
    conflicts: input.bundle.conflicts.map((item) => ({
      conflictId: item.conflictId,
      active: item.status === "OPEN" || item.status === "IN_REVIEW",
      evidenceKeys: [],
    })),
    now: input.now,
    requiredEvidenceKind: input.bundle.answerPolicy.requiresLiveEvidence ? "LIVE_TOOL" : null,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export class KnowledgeV2GroundedAnswerService {
  private readonly orchestrator: GroundedAnswerOrchestrator;

  constructor(
    private readonly provider: GroundedAnswerProvider,
    private readonly authorizer: GroundedAnswerProcessorAuthorizer,
    outputPolicy: GroundedAnswerOutputPolicy,
    private readonly queryHashKeyring: KnowledgeV2QueryHashKeyring,
  ) {
    this.orchestrator = new GroundedAnswerOrchestrator(provider, authorizer, outputPolicy);
  }

  answer(
    input: Omit<Parameters<typeof knowledgeV2GroundedAnswerInput>[0], "queryHashKeyring">,
  ): Promise<GroundedAnswerOrchestrationResult> {
    return this.orchestrator.answer(
      knowledgeV2GroundedAnswerInput({ ...input, queryHashKeyring: this.queryHashKeyring }),
    );
  }

  async revalidateProcessor(
    input: Omit<Parameters<typeof knowledgeV2GroundedAnswerInput>[0], "queryHashKeyring">,
    expected: GroundedAnswerOrchestrationResult,
    transaction?: Prisma.TransactionClient,
  ) {
    if (expected.disposition !== "AUTO_SEND") return true;
    const orchestration = knowledgeV2GroundedAnswerInput({
      ...input,
      queryHashKeyring: this.queryHashKeyring,
    });
    if (!orchestration.evidenceAllowed) return false;
    const classifications = [
      ...new Set([
        orchestration.queryClassification,
        ...orchestration.evidence.map((item) => item.classification),
      ]),
    ].sort();
    return this.revalidateProcessorAdmission(
      {
        tenantId: orchestration.tenantId,
        promptPolicyVersion: orchestration.promptPolicyVersion,
        classifications,
      },
      expected,
      transaction,
    );
  }

  async revalidateProcessorAdmission(
    input: {
      tenantId: string;
      promptPolicyVersion: string;
      classifications: readonly string[];
    },
    expected: Pick<
      GroundedAnswerOrchestrationResult,
      | "disposition"
      | "provider"
      | "model"
      | "providerVersion"
      | "region"
      | "processorPolicyVersion"
      | "processorPolicyHash"
      | "promptPolicyVersion"
    >,
    transaction?: Prisma.TransactionClient,
  ) {
    if (expected.disposition !== "AUTO_SEND") return true;
    const request = {
      tenantId: input.tenantId,
      purpose: "GENERATE" as const,
      promptPolicyVersion: input.promptPolicyVersion,
      classifications: [...new Set(input.classifications)].sort(),
    };
    const admission =
      transaction && this.authorizer instanceof PrismaKnowledgeV2ModelProcessorAuthorizer
        ? await this.authorizer.authorizeWithDatabase(transaction, request)
        : await this.authorizer.authorize(request);
    return Boolean(
      admission &&
      admission.provider === this.provider.identity.provider &&
      admission.provider === expected.provider &&
      admission.model === this.provider.identity.model &&
      admission.model === expected.model &&
      admission.version === this.provider.identity.version &&
      admission.version === expected.providerVersion &&
      admission.region === this.provider.identity.region &&
      admission.region === expected.region &&
      admission.policyVersion === expected.processorPolicyVersion &&
      admission.policyHash === expected.processorPolicyHash &&
      admission.promptPolicyVersion === expected.promptPolicyVersion,
    );
  }
}
