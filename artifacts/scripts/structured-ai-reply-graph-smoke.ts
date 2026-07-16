import { createHash, randomUUID } from "node:crypto";
import nodeAssert from "node:assert/strict";
import type {
  AiProvider,
  GroundedAnswerProcessorAuthorizer,
  GroundedAnswerProvider,
} from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, Prisma } from "@leadvirt/db";
import {
  admitKnowledgeV2ProcessorQuery,
  authenticatedCustomerChannelBindingHash,
  authenticatedCustomerIdentityAttestationHash,
  authenticatedCustomerSubjectHash,
  classifyOperationalQuery,
  createKnowledgeV2QueryHashKeyring,
  hashKnowledgeValue,
  knowledgeLiveToolAuthorizationScopeHash,
  knowledgeLiveToolQueryHash,
  knowledgeLiveToolResultEnvelopeHash,
  knowledgeOperationalRequirementHash,
  KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
  KnowledgeV2GroundedAnswerService,
  KnowledgeV2GroundedOutputPolicy,
  KnowledgeV2Retriever,
  loadKnowledgeOperationalCapabilityProjectionV1,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  stableKnowledgeValue,
  type KnowledgeEvidenceBundle,
  type KnowledgeV2ProcessorQueryAdmissionBinding,
  type KnowledgeV2LiveToolResult,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeRuntimeRetriever,
  type KnowledgeRuntimeRetrievalResult,
} from "@leadvirt/knowledge";
import type { AiReplyJobData } from "@leadvirt/types";
import { automaticReplyChannelFingerprint } from "@leadvirt/runtime-queue";
import {
  localizedKnowledgeHandoffReply,
  runAiReplyGraph,
} from "../../apps/worker/src/ai/ai-reply-graph.js";
import {
  aiReplyContentHashV1,
  knowledgeHandoffReplyV1,
} from "../../apps/worker/src/ai/ai-reply-outcome.js";
import { renderPrometheusMetrics } from "../../apps/worker/src/observability/metrics.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: "structured-graph-query-key-v1",
  keys: { "structured-graph-query-key-v1": new Uint8Array(32).fill(73) },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown) {
  return hashKnowledgeValue(stableKnowledgeValue(value));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

class CountingAiProvider implements AiProvider {
  calls = 0;
  readonly providerName = "legacy-should-not-run";
  readonly modelName = "legacy-should-not-run";

  private called(): never {
    this.calls += 1;
    throw new Error("Legacy AI provider was called for STRUCTURED_V2.");
  }

  generateReply() {
    return Promise.reject(this.called());
  }

  extractLeadFields() {
    return Promise.reject(this.called());
  }

  summarizeConversation() {
    return Promise.reject(this.called());
  }

  classifyIntent() {
    return Promise.reject(this.called());
  }

  recommendNextAction() {
    return Promise.reject(this.called());
  }
}

class SmokeGroundedProvider implements GroundedAnswerProvider {
  readonly identity = {
    provider: "smoke-grounded",
    model: "grounded-v1",
    version: "2026-07-13",
    region: "eu-west",
  };
  calls = 0;
  readonly questions: string[] = [];

  constructor(
    private readonly answer: string,
    private readonly evidenceKey: string,
    private readonly afterGenerate?: () => void,
    private readonly exactValueText: string | null = null,
  ) {}

  generate(input: Parameters<GroundedAnswerProvider["generate"]>[0]) {
    this.calls += 1;
    this.questions.push(input.question);
    this.afterGenerate?.();
    return Promise.resolve({
      schemaVersion: 1,
      claims: [
        {
          claimId: "claim-1",
          text: this.answer,
          evidenceKeys: [this.evidenceKey],
          exactValueText: this.exactValueText,
        },
      ],
      citations: [{ claimId: "claim-1", evidenceKey: this.evidenceKey }],
    });
  }
}

class SmokeAuthorizer implements GroundedAnswerProcessorAuthorizer {
  calls = 0;
  allowed = false;

  authorize() {
    this.calls += 1;
    return Promise.resolve(
      this.allowed
        ? {
            provider: "smoke-grounded",
            model: "grounded-v1",
            version: "2026-07-13",
            region: "eu-west",
            policyVersion: "model-policy-v1",
            policyHash: "1".repeat(64),
            promptPolicyVersion: "grounded-answer-v1",
          }
        : null,
    );
  }
}

function approvedAuthorizer() {
  const authorizer = new SmokeAuthorizer();
  authorizer.allowed = true;
  return authorizer;
}

function groundedService(provider: SmokeGroundedProvider, authorizer: SmokeAuthorizer) {
  return new KnowledgeV2GroundedAnswerService(
    provider,
    authorizer,
    new KnowledgeV2GroundedOutputPolicy(),
    queryHashKeyring,
  );
}

interface SmokeFact {
  factId: string;
  versionId: string;
  versionHash: string;
  evidenceKey: string;
}

function bundle(tenantId: string, publicationId: string, fact: SmokeFact): KnowledgeEvidenceBundle {
  const query = "What are your support hours?";
  const queryHash = knowledgeLiveToolQueryHash({ tenantId, query, queryHashKeyring });
  const operational = classifyOperationalQuery(query);
  const processorQueryAdmission = admitKnowledgeV2ProcessorQuery(
    { tenantId, query, classification: "PUBLIC" },
    queryHashKeyring,
  );
  assert(processorQueryAdmission.admitted, "Public static smoke query was not admitted.");
  return {
    schemaVersion: 1,
    corpusKind: "STRUCTURED_V2",
    target: {
      corpusKind: "STRUCTURED_V2",
      snapshotKind: "PUBLICATION",
      targetKey: "workspace-v2",
      publicationId,
      publicationSequence: 1,
      publicationManifestHash: "a".repeat(64),
      indexSnapshotId: null,
      retrievalPolicyVersion: "structured-v2-v1",
      promptPolicyVersion: "grounded-answer-v1",
      pipelineVersion: "knowledge-v2",
    },
    outcome: "ANSWERED",
    gateOutcome: "AUTO_SEND",
    gateReasons: ["EVIDENCE_READY"],
    facts: [
      {
        kind: "FACT",
        evidenceKey: fact.evidenceKey,
        factId: fact.factId,
        versionId: fact.versionId,
        versionHash: fact.versionHash,
        safeLabel: "Support availability",
        value: "Support is available on weekdays.",
        valueHash: "c".repeat(64),
        riskLevel: "LOW",
        authority: "OWNER_VERIFIED",
        verificationStatus: "VERIFIED",
        score: 1,
      },
    ],
    guidance: [],
    documents: [],
    conflicts: [],
    missingSupport: [],
    suppressedEvidence: [],
    citations: [],
    liveToolResults: [],
    answerPolicy: {
      requirementHash: knowledgeOperationalRequirementHash({
        queryHash,
        classification: operational,
      }),
      operationalCategory: operational.category,
      queryHash,
      processorQueryAdmission:
        projectKnowledgeV2ProcessorQueryAdmissionBinding(processorQueryAdmission),
      requiresLiveEvidence: false,
      staticEvidenceMayAnswer: true,
      allowAutoSend: true,
    },
  };
}

function runtime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
  observeAuthorization?: (authorization: KnowledgeRuntimeAuthorizationContext) => void,
): KnowledgeRuntimeRetriever {
  const evidence = bundle(tenantId, publicationId, fact);
  const filters = {
    locale: "en",
    channelType: "DEMO",
    audience: "PUBLIC",
    classifications: ["PUBLIC"],
    queryClassification: "CUSTOMER_PERSONAL",
  };
  const retrieval: KnowledgeRuntimeRetrievalResult = {
    status: "grounded",
    bundle: evidence,
    diagnostics: {
      backend: "qdrant",
      corpusKind: "STRUCTURED_V2",
      candidateCount: 1,
      hydratedCount: 1,
      selectedCount: 1,
      durationMs: 1,
      retrievalPolicyVersion: "structured-v2-v1",
      rerankerVersion: "smoke-v1",
    },
    traceDraft: {
      traceKeySeed: randomUUID(),
      queryHash: evidence.answerPolicy.queryHash,
      restrictedQueryRef: "restricted-query-smoke",
      restrictedQueryCreated: false,
      filters,
      filtersHash: sha256(JSON.stringify(filters)),
      permissionFingerprint: "e".repeat(64),
      snapshotKind: "PUBLICATION",
      targetKey: "workspace-v2",
      publicationId,
      candidateId: null,
      candidateVersion: null,
      candidateManifestHash: null,
      retrievalPolicyVersion: "structured-v2-v1",
      retrievalProcessorPolicyHash: "f".repeat(64),
      modelProcessorPolicyHash: null,
      rerankerVersion: "smoke-v1",
      promptPolicyVersion: "grounded-answer-v1",
      graphVersion: "ai-reply-graph-v2",
      provider: "smoke-retrieval",
      generatorModel: null,
      outcome: "ANSWERED",
      gateOutcome: "AUTO_SEND",
      candidates: [],
      citations: [],
      latencyMs: 1,
    },
  };
  return {
    retrieve: (input) => {
      observeAuthorization?.(input.authorization);
      return Promise.resolve(retrieval);
    },
    revalidateEvidence: () =>
      Promise.resolve({
        valid: true,
        reason: "VALID" as const,
        evidenceManifestHash: "9".repeat(64),
      }),
    prepareTrace: persistence.prepareTrace.bind(persistence),
    persistTrace: persistence.persistTrace.bind(persistence),
    cleanupTraceArtifacts: persistence.cleanupTraceArtifacts.bind(persistence),
  } as unknown as KnowledgeRuntimeRetriever;
}

function mixedCorpusRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  const retrieve = retriever.retrieve.bind(retriever);
  retriever.retrieve = async (...args) => {
    const result = await retrieve(...args);
    if (result.status !== "grounded") return result;
    return {
      ...result,
      bundle: {
        ...result.bundle,
        corpusKind: "LEGACY_V1",
        target: {
          ...result.bundle.target,
          corpusKind: "LEGACY_V1",
          targetKey: "default",
        },
      },
    };
  };
  return retriever;
}

function emptyRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  const retrieve = retriever.retrieve.bind(retriever);
  retriever.retrieve = async (...args) => {
    const result = await retrieve(...args);
    if (result.status !== "grounded") return result;
    return {
      ...result,
      status: "insufficient_grounding",
      reason: "NO_MATCH",
      bundle: {
        ...result.bundle,
        outcome: "ABSTAINED",
        gateOutcome: "HANDOFF",
        gateReasons: ["NO_MATCH"],
      },
      diagnostics: {
        ...result.diagnostics,
        candidateCount: 0,
        hydratedCount: 0,
        selectedCount: 0,
      },
    };
  };
  return retriever;
}

function degradedRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  const retrieve = retriever.retrieve.bind(retriever);
  retriever.retrieve = async (...args) => {
    const result = await retrieve(...args);
    if (result.status !== "grounded") return result;
    return {
      status: "unavailable",
      reason: "QDRANT_UNAVAILABLE",
      retryable: true,
      target: result.bundle.target,
      diagnostics: {
        ...result.diagnostics,
        candidateCount: 0,
        hydratedCount: 0,
        selectedCount: 0,
      },
    };
  };
  return retriever;
}

function degradedGroundedRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  const retrieve = retriever.retrieve.bind(retriever);
  retriever.retrieve = async (...args) => {
    const result = await retrieve(...args);
    if (result.status !== "grounded") return result;
    return {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        candidateCount: 0,
        hydratedCount: 0,
        selectedCount: 0,
        degradedReason: "QDRANT_UNAVAILABLE",
      },
    };
  };
  return retriever;
}

function customerPersonalCurrentStateRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
  observeAuthorization: (authorization: KnowledgeRuntimeAuthorizationContext) => void,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  retriever.retrieve = async (input) => {
    observeAuthorization(input.authorization);
    const operational = classifyOperationalQuery(input.query, input.authorization.intent);
    assert(
      operational.requiresLiveEvidence && operational.category === "ORDER_STATE",
      "Authenticated Telegram smoke query was not classified as current order state.",
    );
    const processorQueryAdmission = admitKnowledgeV2ProcessorQuery(
      {
        tenantId: input.tenantId,
        query: input.query,
        classification: input.authorization.queryClassification,
        ...(input.authorization.intent !== undefined ? { intent: input.authorization.intent } : {}),
      },
      queryHashKeyring,
    );
    assert(
      processorQueryAdmission.admitted && processorQueryAdmission.mode === "CANONICAL_OPERATIONAL",
      "Authenticated current-order query was not admitted canonically.",
    );
    const queryHash = knowledgeLiveToolQueryHash({
      tenantId: input.tenantId,
      query: input.query,
      queryHashKeyring,
    });
    const evidence = bundle(input.tenantId, publicationId, fact);
    return {
      status: "insufficient_grounding",
      reason: "LIVE_EVIDENCE_REQUIRED",
      bundle: {
        ...evidence,
        outcome: "HANDED_OFF",
        gateOutcome: "HANDOFF",
        gateReasons: ["LIVE_EVIDENCE_REQUIRED"],
        missingSupport: ["LIVE_EVIDENCE_REQUIRED"],
        liveToolResults: [],
        answerPolicy: {
          requirementHash: knowledgeOperationalRequirementHash({
            queryHash,
            classification: operational,
          }),
          operationalCategory: operational.category,
          queryHash,
          processorQueryAdmission:
            projectKnowledgeV2ProcessorQueryAdmissionBinding(processorQueryAdmission),
          requiresLiveEvidence: true,
          staticEvidenceMayAnswer: false,
          allowAutoSend: false,
        },
      },
      diagnostics: {
        backend: "qdrant",
        corpusKind: "STRUCTURED_V2",
        candidateCount: 0,
        hydratedCount: 0,
        selectedCount: 0,
        durationMs: 1,
        retrievalPolicyVersion: "structured-v2-v1",
        rerankerVersion: "smoke-v1",
      },
    };
  };
  return retriever;
}

function approvedCustomerPersonalCurrentStateRuntime(
  tenantId: string,
  publicationId: string,
  fact: SmokeFact,
  persistence: KnowledgeV2Retriever,
  executionId: string,
  answer: string,
  permissionGeneration: number,
  observeAuthorization: (authorization: KnowledgeRuntimeAuthorizationContext) => void,
  observeAdmission: (admission: KnowledgeV2ProcessorQueryAdmissionBinding) => void,
): KnowledgeRuntimeRetriever {
  const retriever = runtime(tenantId, publicationId, fact, persistence);
  const retrieve = retriever.retrieve.bind(retriever);
  retriever.retrieve = async (input) => {
    observeAuthorization(input.authorization);
    const operational = classifyOperationalQuery(input.query, input.authorization.intent);
    const processorQueryAdmission = admitKnowledgeV2ProcessorQuery(
      {
        tenantId: input.tenantId,
        query: input.query,
        classification: input.authorization.queryClassification,
        ...(input.authorization.intent !== undefined ? { intent: input.authorization.intent } : {}),
      },
      queryHashKeyring,
    );
    assert(
      processorQueryAdmission.admitted &&
        processorQueryAdmission.mode === "CANONICAL_OPERATIONAL" &&
        processorQueryAdmission.operationalCategory === "ORDER_STATE",
      "Authenticated current-order query was not admitted for canonical processing.",
    );
    const admissionBinding =
      projectKnowledgeV2ProcessorQueryAdmissionBinding(processorQueryAdmission);
    observeAdmission(admissionBinding);
    const customerIdentity = input.authorization.customerIdentity;
    assert(customerIdentity, "Approved current-order runtime received no customer identity.");
    const queryHash = knowledgeLiveToolQueryHash({
      tenantId: input.tenantId,
      query: input.query,
      queryHashKeyring,
    });
    const now = Date.now();
    const exactValue = "in transit";
    const value = { status: "IN_TRANSIT" };
    const liveToolResult: KnowledgeV2LiveToolResult = {
      executionId,
      toolCallId: `tool-call-${executionId}`,
      toolKey: "orders.current-status",
      toolVersion: "v1",
      safeName: "Current order status",
      sourceSystem: "smoke-order-ledger",
      operationalCategory: operational.category,
      tenantId: input.tenantId,
      executionContextId: input.authorization.executionContextId!,
      queryHash,
      requestHash: canonicalHash({ executionId, queryHash }),
      authorizationScopeHash: knowledgeLiveToolAuthorizationScopeHash({
        tenantId: input.tenantId,
        authorization: input.authorization,
      }),
      authorizationDecisionId: `decision-${executionId}`,
      permissionGeneration,
      connectionId: null,
      connectionPermissionVersion: null,
      customerIdentityId: customerIdentity.id,
      customerIdentityVersion: customerIdentity.version,
      subjectHash: customerIdentity.subjectHash,
      resultType: "order-status",
      value,
      valueHash: canonicalHash(value),
      exactValue,
      exactValueHash: sha256(exactValue),
      content: answer,
      contentHash: sha256(answer),
      observedAt: new Date(now - 30_000).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
      authorizedAt: new Date(now - 60_000).toISOString(),
      authorizationExpiresAt: new Date(now + 180_000).toISOString(),
      toolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
      status: "SUCCEEDED",
    };
    const aiReplyRunId = input.authorization.executionContextId?.replace(/^langgraph:/u, "");
    assert(aiReplyRunId, "Live smoke runtime received no AI reply run identity.");
    const aiReplyRun = await prisma.aiReplyRun.findFirstOrThrow({
      where: { id: aiReplyRunId, tenantId: input.tenantId },
      include: { conversation: { select: { leadId: true } } },
    });
    await prisma.knowledgeV2LiveToolExecution.create({
      data: {
        id: executionId,
        executionKey: canonicalHash({ tenantId: input.tenantId, executionId }),
        tenantId: input.tenantId,
        aiReplyRunId: aiReplyRun.id,
        conversationId: aiReplyRun.conversationId,
        originatingMessageId: aiReplyRun.inboundMessageId,
        leadId: aiReplyRun.conversation.leadId,
        executionContextId: input.authorization.executionContextId!,
        attemptNumber: Math.max(1, aiReplyRun.attemptCount),
        toolCallId: liveToolResult.toolCallId,
        toolKey: liveToolResult.toolKey,
        toolVersion: liveToolResult.toolVersion,
        safeName: liveToolResult.safeName,
        sourceSystem: liveToolResult.sourceSystem,
        operationalCategory: liveToolResult.operationalCategory,
        toolPolicyVersion: liveToolResult.toolPolicyVersion,
        queryHash: liveToolResult.queryHash.hash,
        queryHashKeyId: liveToolResult.queryHash.keyId,
        queryHashVersion: liveToolResult.queryHash.version,
        requestHash: liveToolResult.requestHash,
        authorizationScopeHash: liveToolResult.authorizationScopeHash,
        authorizationDecisionId: liveToolResult.authorizationDecisionId,
        permissionGeneration: liveToolResult.permissionGeneration,
        connectionId: liveToolResult.connectionId,
        connectionPermissionVersion: liveToolResult.connectionPermissionVersion,
        customerIdentityId: liveToolResult.customerIdentityId,
        customerIdentityVersion: liveToolResult.customerIdentityVersion,
        subjectHash: liveToolResult.subjectHash,
        resultType: liveToolResult.resultType,
        valueHash: liveToolResult.valueHash,
        exactValueHash: liveToolResult.exactValueHash,
        contentHash: liveToolResult.contentHash,
        envelopeHash: knowledgeLiveToolResultEnvelopeHash(liveToolResult),
        payloadObjectKey: `smoke:${input.tenantId}:${executionId}`,
        payloadEncryptionKeyRef: "smoke-key",
        payloadHash: sha256(answer),
        payloadBytes: Buffer.byteLength(answer, "utf8"),
        observedAt: new Date(liveToolResult.observedAt),
        expiresAt: new Date(liveToolResult.expiresAt),
        authorizedAt: new Date(liveToolResult.authorizedAt),
        authorizationExpiresAt: new Date(liveToolResult.authorizationExpiresAt),
        retentionExpiresAt: new Date(liveToolResult.authorizationExpiresAt),
      },
    });
    const base = await retrieve(input);
    assert(base.status === "grounded" && base.traceDraft, "Live smoke runtime was not grounded.");
    const requirementHash = knowledgeOperationalRequirementHash({
      queryHash,
      classification: operational,
    });
    const filters = {
      locale: input.authorization.locale,
      channelType: input.authorization.channelType,
      audience: input.authorization.audience,
      classifications: [...input.authorization.classifications].sort(),
      queryClassification: input.authorization.queryClassification,
      brandIds: [...(input.authorization.brandIds ?? [])].sort(),
      locationIds: [...(input.authorization.locationIds ?? [])].sort(),
      channelIds: [
        input.authorization.channelType,
        ...(input.authorization.channelIds ?? []),
      ].sort(),
      assistantIds: [...(input.authorization.assistantIds ?? [])].sort(),
      segmentIds: [...(input.authorization.segmentIds ?? [])].sort(),
      hasIntent: Boolean(input.authorization.intent),
      hasLeadStage: Boolean(input.authorization.leadStage),
      businessHours: input.authorization.businessHours ?? null,
      executionContextId: input.authorization.executionContextId ?? null,
      customerIdentityId: customerIdentity.id,
      customerIdentityVersion: customerIdentity.version,
      customerSubjectHash: customerIdentity.subjectHash,
      customerAttestationHash: customerIdentity.attestationHash,
      operationalCategory: operational.category,
      requiresLiveEvidence: true,
      operationalRequirementHash: requirementHash,
      queryHash,
      processorPolicyVersion: "smoke-retrieval-policy-v1",
      processorPolicyHash: "f".repeat(64),
      processorQueryAdmission: admissionBinding,
      documentRetrievalDegradedReason: null,
    };
    return {
      ...base,
      bundle: {
        ...base.bundle,
        outcome: "ANSWERED",
        gateOutcome: "AUTO_SEND",
        gateReasons: ["EVIDENCE_READY"],
        facts: [],
        guidance: [],
        documents: [],
        conflicts: [],
        missingSupport: [],
        suppressedEvidence: [],
        citations: [],
        liveToolResults: [liveToolResult],
        answerPolicy: {
          requirementHash,
          operationalCategory: operational.category,
          queryHash,
          processorQueryAdmission: admissionBinding,
          requiresLiveEvidence: true,
          staticEvidenceMayAnswer: false,
          allowAutoSend: true,
        },
      },
      diagnostics: {
        ...base.diagnostics,
        candidateCount: 0,
        hydratedCount: 0,
        selectedCount: 0,
      },
      traceDraft: {
        ...base.traceDraft,
        queryHash,
        filters,
        filtersHash: canonicalHash(filters),
        permissionFingerprint: canonicalHash({ filters, partitions: [] }),
      },
    };
  };
  return retriever;
}

async function main() {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Structured graph smoke",
        slug: `structured-graph-${stamp}`,
        settings: { defaultLocale: "en-US" },
      },
    });
    tenantId = tenant.id;
    const automaticReplyChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Structured graph automatic replies",
        publicKey: `structured-graph-${stamp}`,
        settings: { deliveryMode: "managed", fixture: "structured-graph" },
      },
    });
    const telegramChannels = await Promise.all(
      [1, 2].map((ordinal) =>
        prisma.channel.create({
          data: {
            tenantId: tenant.id,
            type: "TELEGRAM",
            status: "ACTIVE",
            name: `Authenticated Telegram smoke ${ordinal}`,
            externalId: String(770_000_000 + ordinal),
            publicKey: `telegram-smoke-${stamp}-${ordinal}`,
          },
        }),
      ),
    );
    const entity = await prisma.knowledgeV2Entity.create({
      data: {
        tenantId: tenant.id,
        entityType: "BUSINESS",
        entityKey: "business/default",
      },
    });
    const fact = await prisma.knowledgeV2Fact.create({
      data: {
        tenantId: tenant.id,
        entityId: entity.id,
        entityType: "BUSINESS",
        factKey: "support/availability",
        fieldType: "TEXT",
        latestVersionNumber: 1,
      },
    });
    const factScope = { audiences: ["PUBLIC"] };
    const factValue = { value: "Support is available on weekdays." };
    const factVersion = await prisma.knowledgeV2FactVersion.create({
      data: {
        tenantId: tenant.id,
        factId: fact.id,
        versionNumber: 1,
        normalizedValue: factValue,
        displayValue: factValue.value,
        scope: factScope,
        riskLevel: "LOW",
        authority: "MANUAL",
        lifecycleStatus: "DRAFT",
        verificationStatus: "VERIFIED",
        immutableHash: sha256(JSON.stringify(factValue)),
        verifiedAt: new Date(),
      },
    });
    const authorizationFingerprint = hashKnowledgeValue(
      stableKnowledgeValue({
        version: 1,
        corpusKind: "STRUCTURED_V2",
        itemType: "FACT_VERSION",
        scope: factScope,
        riskLevel: "LOW",
        authority: { authority: "MANUAL", verifiedByUserId: null },
        evidence: [],
      }),
    );
    const smokeFact: SmokeFact = {
      factId: fact.id,
      versionId: factVersion.id,
      versionHash: factVersion.immutableHash,
      evidenceKey: `v2:fact:${factVersion.id}:${factVersion.immutableHash}`,
    };
    const capabilitySetHash = "c".repeat(64);
    const requirementEvaluationSetHash = "d".repeat(64);
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Structured graph authorization generation is missing.",
    );
    const operationalBinding = {
      operationalBindingSchemaVersion: operationalProjection.schemaVersion,
      operationalRegistryVersion: operationalProjection.registryVersion,
      operationalRegistryHash: operationalProjection.registryHash,
      operationalDependencySetHash: operationalProjection.dependencySetHash,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
    };
    const generalFaqCapability = await prisma.knowledgeV2Capability.create({
      data: {
        tenantId: tenant.id,
        capabilityType: "GENERAL_FAQ",
        enabled: true,
        allowedAutonomy: "COLLECT_INFORMATION",
        templateKey: "structured-graph-general-faq-v1",
      },
    });
    const orderSupportCapability = await prisma.knowledgeV2Capability.create({
      data: {
        tenantId: tenant.id,
        capabilityType: "ORDER_ACCOUNT_SUPPORT",
        enabled: true,
        templateKey: "structured-graph-order-support-v1",
      },
    });
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        manifestHash: "a".repeat(64),
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "structured-v2-v1",
        promptPolicyVersion: "grounded-answer-v1",
        readyAt: new Date(),
      },
    });
    const validation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        candidateId: "workspace-v2",
        candidateVersion: 1,
        candidateManifestHash: publication.manifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        validationPolicyVersion: "structured-graph-smoke-v1",
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: generalFaqCapability.id,
        capabilityType: generalFaqCapability.capabilityType,
        allowedAutonomy: generalFaqCapability.allowedAutonomy,
        capabilityEtag: generalFaqCapability.etag,
        capabilitySnapshotHash: "e".repeat(64),
        requirementEvaluationSetHash: "f".repeat(64),
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: orderSupportCapability.id,
        capabilityType: orderSupportCapability.capabilityType,
        allowedAutonomy: orderSupportCapability.allowedAutonomy,
        capabilityEtag: orderSupportCapability.etag,
        capabilitySnapshotHash: "1".repeat(64),
        requirementEvaluationSetHash: "2".repeat(64),
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    await prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "FACT_VERSION",
        itemId: factVersion.id,
        itemVersionHash: factVersion.immutableHash,
        factVersionId: factVersion.id,
        scope: factScope,
        authorizationFingerprint,
      },
    });
    await prisma.knowledgePublication.update({
      where: { id: publication.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: publication.id,
        sequence: 1,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.$executeRaw`
        INSERT INTO "KnowledgeCorpusSelector"
          ("tenantId", "corpusKind", "generation", "migrationId", "selectedAt", "createdAt", "updatedAt")
        VALUES
          (${tenant.id}, 'STRUCTURED_V2', 2, ${`migration-${stamp}`}, NOW(), NOW(), NOW())
      `;
    });
    await prisma.channel.update({
      where: { id: automaticReplyChannel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesPublicationId: publication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesCapabilitySetHash: capabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(automaticReplyChannel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: `structured-graph-${stamp}`,
      },
    });
    const restrictedContent = new Map<string, Uint8Array>();
    const persistence = new KnowledgeV2Retriever(
      prisma,
      {
        hybridClient: {} as never,
        denseProvider: { schema: { provider: "smoke", model: "smoke" } } as never,
        sparseEncoder: { schema: { provider: "smoke", model: "smoke" } } as never,
        reranker: { version: "smoke" } as never,
        restrictedStore: {
          put: (input: { identity: string; content: Uint8Array }) => {
            const reference = `memory:${input.identity}`;
            const created = !restrictedContent.has(reference);
            restrictedContent.set(reference, input.content);
            return Promise.resolve({
              reference,
              hash: sha256(Buffer.from(input.content).toString("utf8")),
              created,
            });
          },
          delete: (reference: string) => {
            restrictedContent.delete(reference);
            return Promise.resolve();
          },
        },
        queryHashKeyring,
      },
      {
        candidateLimit: 20,
        documentLimit: 4,
        maximumChunksPerDocument: 2,
        maximumFacts: 12,
        maximumGuidance: 12,
        minimumRerankScore: 0,
        maximumParentCharacters: 4_000,
        retentionMs: 60_000,
        graphVersion: "ai-reply-graph-v2",
      },
    );

    const runScenario = async (
      name: string,
      provider: SmokeGroundedProvider,
      authorizer: SmokeAuthorizer,
      retriever: KnowledgeRuntimeRetriever = runtime(
        tenant.id,
        publication.id,
        smokeFact,
        persistence,
      ),
      inputText = "What are your support hours?",
    ) => {
      const lead = await prisma.lead.create({
        data: {
          tenantId: tenant.id,
          name,
          source: "smoke",
          channelType: "WEBSITE",
          status: "NEW",
        },
      });
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          leadId: lead.id,
          channelId: automaticReplyChannel.id,
          status: "OPEN",
          aiEnabled: true,
        },
      });
      const inbound = await prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: inputText,
          status: "RECEIVED",
        },
      });
      const data: AiReplyJobData = {
        tenantId: tenant.id,
        conversationId: conversation.id,
        triggerMessageId: inbound.id,
        source: "worker-test",
      };
      const legacy = new CountingAiProvider();
      const result = await runAiReplyGraph({
        data,
        aiProvider: legacy,
        knowledgeRetriever: retriever,
        groundedAnswer: groundedService(provider, authorizer),
      });
      const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
      return { result, message, legacy, lead };
    };

    const runAuthenticatedTelegramScenario = async (input: {
      name: string;
      ordinal: number;
      text: string;
      answer: string;
      evidenceKey: string;
      exactValueText?: string | null;
      authorizer: SmokeAuthorizer;
      retriever: (
        observeAuthorization: (authorization: KnowledgeRuntimeAuthorizationContext) => void,
      ) => KnowledgeRuntimeRetriever;
    }) => {
      const telegramSubjectId = String(420_000_000 + input.ordinal);
      const channel = telegramChannels[input.ordinal - 1];
      assert(channel, `Missing Telegram channel fixture ${input.ordinal}.`);
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          automaticRepliesEnabled: true,
          automaticRepliesPublicationId: publication.id,
          automaticRepliesPublicationEtag: pointer.etag,
          automaticRepliesCapabilitySetHash: capabilitySetHash,
          automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
          automaticRepliesOperationalPermissionGeneration:
            operationalProjection.permissionGeneration,
          automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(channel),
          automaticRepliesActivatedAt: new Date(),
          automaticRepliesActivatedByUserId: `structured-graph-${stamp}`,
        },
      });
      const lead = await prisma.lead.create({
        data: {
          tenantId: tenant.id,
          name: "Authenticated Telegram customer",
          source: "telegram",
          channelType: "TELEGRAM",
          status: "NEW",
        },
      });
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          leadId: lead.id,
          channelId: channel.id,
          externalConversationId: `telegram:${telegramSubjectId}`,
          status: "OPEN",
          aiEnabled: true,
        },
      });
      const authenticatedAt = new Date();
      const payload = {
        update_id: 9_100_000 + input.ordinal,
        message: {
          message_id: 7_100_000 + input.ordinal,
          from: { id: Number(telegramSubjectId), is_bot: false, first_name: "Customer" },
          chat: { id: Number(telegramSubjectId), type: "private", first_name: "Customer" },
          date: Math.floor(authenticatedAt.getTime() / 1_000),
          text: input.text,
        },
      };
      const eventPayloadHash = sha256(JSON.stringify(payload));
      const webhookEvent = await prisma.webhookEvent.create({
        data: {
          tenantId: tenant.id,
          provider: `telegram:${channel.id}`,
          externalEventId: `telegram:update:${payload.update_id}`,
          payloadHash: eventPayloadHash,
          payload,
          status: "PROCESSED",
          receivedAt: authenticatedAt,
          processedAt: authenticatedAt,
        },
      });
      const inbound = await prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          externalMessageId: `telegram:${payload.message.message_id}`,
          text: payload.message.text,
          status: "RECEIVED",
          createdAt: authenticatedAt,
          updatedAt: authenticatedAt,
        },
      });
      const subjectHash = authenticatedCustomerSubjectHash({
        tenantId: tenant.id,
        channelId: channel.id,
        provider: "TELEGRAM",
        externalSubjectId: telegramSubjectId,
      });
      const channelBindingHash = authenticatedCustomerChannelBindingHash({
        tenantId: tenant.id,
        channelId: channel.id,
        channelType: channel.type,
        channelExternalId: channel.externalId!,
        channelPublicKey: channel.publicKey!,
      });
      const identityFields = {
        tenantId: tenant.id,
        version: 1 as const,
        channelId: channel.id,
        conversationId: conversation.id,
        messageId: inbound.id,
        webhookEventId: webhookEvent.id,
        provider: "TELEGRAM" as const,
        authenticationMethod: "TELEGRAM_WEBHOOK_SECRET" as const,
        subjectSource: "TELEGRAM_MESSAGE_FROM_ID" as const,
        conversationType: "PRIVATE" as const,
        subjectHash,
        channelBindingHash,
        eventPayloadHash,
        authenticatedAt,
      };
      const identity = await prisma.authenticatedCustomerIdentity.create({
        data: {
          ...identityFields,
          attestationHash: authenticatedCustomerIdentityAttestationHash(identityFields),
        },
      });
      const customerIdentity = {
        id: identity.id,
        version: 1 as const,
        subjectHash: identity.subjectHash,
        attestationHash: identity.attestationHash,
      };
      const data: AiReplyJobData = {
        tenantId: tenant.id,
        conversationId: conversation.id,
        triggerMessageId: inbound.id,
        source: "telegram",
        customerIdentity,
      };
      const authorizations: KnowledgeRuntimeAuthorizationContext[] = [];
      const groundedProvider = new SmokeGroundedProvider(
        input.answer,
        input.evidenceKey,
        undefined,
        input.exactValueText ?? null,
      );
      const legacy = new CountingAiProvider();
      const result = await runAiReplyGraph({
        data,
        aiProvider: legacy,
        knowledgeRetriever: input.retriever((authorization) => authorizations.push(authorization)),
        groundedAnswer: groundedService(groundedProvider, input.authorizer),
      });
      const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
      const persistedIdentity = await prisma.authenticatedCustomerIdentity.findUniqueOrThrow({
        where: { tenantId_messageId: { tenantId: tenant.id, messageId: inbound.id } },
      });
      return {
        result,
        message,
        groundedProvider,
        legacy,
        authorizer: input.authorizer,
        authorizations,
        customerIdentity,
        persistedIdentity,
      };
    };

    const exactProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const publicAuthorizations: KnowledgeRuntimeAuthorizationContext[] = [];
    const exact = await runScenario(
      "exact",
      exactProvider,
      approvedAuthorizer(),
      runtime(tenant.id, publication.id, smokeFact, persistence, (authorization) =>
        publicAuthorizations.push(authorization),
      ),
    );
    assert(
      exact.result.qualityPassed,
      `Exact grounded answer did not pass: ${exact.result.qualityReason ?? "unknown"}; provider calls ${exactProvider.calls}; questions ${JSON.stringify(exactProvider.questions)}.`,
    );
    assert(exact.message.text === "Support is available on weekdays.", "Exact answer changed.");
    nodeAssert.deepEqual(
      exactProvider.questions,
      ["What are your support hours?"],
      "Public grounded provider query changed.",
    );
    assert(
      publicAuthorizations.length === 1 &&
        publicAuthorizations[0]?.audience === "PUBLIC" &&
        publicAuthorizations[0]?.queryClassification === "PUBLIC" &&
        JSON.stringify(publicAuthorizations[0]?.classifications) === JSON.stringify(["PUBLIC"]) &&
        publicAuthorizations[0]?.customerIdentity === undefined,
      "Unauthenticated worker runtime did not preserve public-only authorization.",
    );
    assert(exactProvider.calls === 1 && exact.legacy.calls === 0, "Wrong provider path executed.");
    nodeAssert.deepEqual(
      exact.result.toolResults?.map((result) => ({ type: result.type, status: result.status })),
      [{ type: "lead.note.create", status: "SUCCESS" }],
      "Structured reply did not apply its persisted COLLECT_INFORMATION autonomy.",
    );
    const exactLead = await prisma.lead.findUniqueOrThrow({ where: { id: exact.lead.id } });
    assert(
      exactLead.status === "NEW",
      "Structured reply committed a lead status change without confirmation proof.",
    );
    const exactMetadata = record(exact.message.metadata);
    const exactGroundedAudit = record(exactMetadata.groundedAnswer);
    const exactTrace = await prisma.knowledgeV2RetrievalTrace.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        responseMessageId: exact.message.id,
        publicationId: publication.id,
      },
      include: {
        citations: {
          include: { evidenceReference: true },
          orderBy: { ordinal: "asc" },
        },
      },
    });
    const exactRun = await prisma.aiReplyRun.findFirstOrThrow({
      where: { tenantId: tenant.id, replyMessageId: exact.message.id },
    });
    const exactPublicationItem = await prisma.knowledgePublicationItem.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        publicationId: publication.id,
        factVersionId: factVersion.id,
      },
    });
    assert(exactMetadata.retrievalTraceId === exactTrace.id, "Message trace identity changed.");
    assert(
      exactTrace.distributedTraceId === exact.result.graphRunId,
      "Distributed graph/trace identity changed.",
    );
    assert(
      exactTrace.publicationId === publication.id && exactTrace.targetKey === "workspace-v2",
      "Trace was not pinned to the structured publication.",
    );
    assert(
      exactRun.publicationId === publication.id &&
        exactRun.replyDisposition === "AUTO_SEND" &&
        exactRun.replyContentHash === aiReplyContentHashV1(exact.message.text ?? "") &&
        exactRun.replyTemplateVersion === null &&
        exactPublicationItem.itemVersionHash === smokeFact.versionHash,
      "Reply run and cited evidence were not bound to the publication snapshot.",
    );
    assert(
      exactTrace.outcome === "ANSWERED" && exactTrace.gateOutcome === "AUTO_SEND",
      "Persisted structured gate outcome changed.",
    );
    assert(
      exactTrace.provider === exactProvider.identity.provider &&
        exactTrace.generatorModel === exactProvider.identity.model &&
        exactTrace.promptPolicyVersion === "grounded-answer-v1" &&
        exactTrace.modelProcessorPolicyHash === "1".repeat(64),
      "Persisted provider/model/prompt/policy identity changed.",
    );
    for (const hash of [
      exactTrace.providerOutputHash,
      exactTrace.gateInputHash,
      exactTrace.gateResultHash,
      exactTrace.answerHash,
      exactTrace.citationManifestHash,
    ]) {
      assert(typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash), "Trace hash is invalid.");
    }
    assert(
      exactTrace.answerHash === sha256(exact.message.text ?? "") &&
        typeof exactTrace.restrictedTraceRef === "string" &&
        restrictedContent.has(exactTrace.restrictedTraceRef),
      "Persisted answer artifact identity changed.",
    );
    assert(exactTrace.citations.length === 1, "Validated citation was not persisted exactly once.");
    const exactCitation = exactTrace.citations[0]!;
    assert(
      exactCitation.support === "SUPPORTS" &&
        exactCitation.ordinal === 0 &&
        exactCitation.claimHash === sha256(exact.message.text ?? "") &&
        exactCitation.evidenceReference.evidenceKey === smokeFact.evidenceKey &&
        exactCitation.evidenceReference.factVersionId === smokeFact.versionId &&
        exactCitation.evidenceReference.itemVersionHash === smokeFact.versionHash,
      "Persisted citation did not bind the published fact version.",
    );
    assert(
      exactGroundedAudit.provider === exactTrace.provider &&
        exactGroundedAudit.model === exactTrace.generatorModel &&
        exactGroundedAudit.promptPolicyVersion === exactTrace.promptPolicyVersion &&
        exactGroundedAudit.processorPolicyHash === exactTrace.modelProcessorPolicyHash &&
        exactGroundedAudit.providerOutputHash === exactTrace.providerOutputHash &&
        exactGroundedAudit.gateInputHash === exactTrace.gateInputHash &&
        exactGroundedAudit.gateResultHash === exactTrace.gateResultHash,
      "Message audit hashes diverged from the retrieval trace.",
    );
    const exactAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        action: "ai.langgraph_reply.processed",
        entityId: exact.result.conversationId,
      },
      orderBy: { createdAt: "desc" },
    });
    const exactAuditPayload = record(exactAudit.payload);
    const exactAuditGrounded = record(exactAuditPayload.groundedAnswer);
    assert(
      exactAuditPayload.messageId === exact.message.id &&
        exactAuditPayload.graphRunId === exact.result.graphRunId &&
        exactAuditPayload.retrievalTraceId === exactTrace.id &&
        exactAuditGrounded.gateResultHash === exactTrace.gateResultHash &&
        exactAuditGrounded.evidenceManifestHash === exactGroundedAudit.evidenceManifestHash,
      "Live AuditLog did not preserve the grounded trace identity.",
    );

    const explicitHandoffProvider = new SmokeGroundedProvider(
      "This answer must not be generated.",
      smokeFact.evidenceKey,
    );
    const explicitHandoffAuthorizer = approvedAuthorizer();
    const explicitHandoff = await runScenario(
      "explicit handoff",
      explicitHandoffProvider,
      explicitHandoffAuthorizer,
      runtime(tenant.id, publication.id, smokeFact, persistence),
      "I want to talk to a human",
    );
    const explicitHandoffRun = await prisma.aiReplyRun.findFirstOrThrow({
      where: { tenantId: tenant.id, replyMessageId: explicitHandoff.message.id },
    });
    const explicitHandoffConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: explicitHandoff.result.conversationId },
    });
    const explicitHandoffMetadata = record(explicitHandoff.message.metadata);
    const explicitHandoffTemplate = knowledgeHandoffReplyV1("en-US");
    assert(
      !explicitHandoff.result.qualityPassed &&
        explicitHandoff.result.handoffRequired &&
        explicitHandoff.message.text === localizedKnowledgeHandoffReply("en-US") &&
        explicitHandoffRun.capabilityDecision === "HANDOFF" &&
        explicitHandoffRun.capabilityType === null &&
        explicitHandoffRun.allowedAutonomy === null &&
        explicitHandoffRun.requiredAutonomy === "ANSWER_ONLY" &&
        explicitHandoffRun.replyDisposition === "HANDOFF" &&
        explicitHandoffRun.replyContentHash ===
          aiReplyContentHashV1(explicitHandoff.message.text ?? "") &&
        explicitHandoffRun.replyTemplateVersion === explicitHandoffTemplate.templateVersion &&
        explicitHandoffRun.publicationId === publication.id &&
        explicitHandoffRun.capabilitySetHash === capabilitySetHash &&
        explicitHandoffRun.operationalBindingHash === operationalProjection.bindingHash &&
        explicitHandoffRun.operationalPermissionGeneration ===
          operationalProjection.permissionGeneration,
      "Explicit HANDOFF did not persist the exact publication and operational run binding.",
    );
    assert(
      explicitHandoffProvider.calls === 0 &&
        explicitHandoffAuthorizer.calls === 0 &&
        explicitHandoff.legacy.calls === 0 &&
        explicitHandoffMetadata.groundedAnswer === null &&
        explicitHandoffConversation.status === "WAITING_FOR_HUMAN" &&
        explicitHandoffConversation.handoffRequested,
      "Explicit HANDOFF generated grounded content or did not preserve its terminal state.",
    );

    const deniedProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const deniedAuthorizer = new SmokeAuthorizer();
    const denied = await runScenario("denied", deniedProvider, deniedAuthorizer);
    assert(
      !denied.result.qualityPassed && denied.result.handoffRequired,
      "Denied policy did not hand off.",
    );
    assert(
      deniedProvider.calls === 0 && denied.legacy.calls === 0,
      "Policy denial called a provider.",
    );

    const revokedAuthorizer = approvedAuthorizer();
    const revokedProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
      () => {
        revokedAuthorizer.allowed = false;
      },
    );
    const revoked = await runScenario("revoked", revokedProvider, revokedAuthorizer);
    assert(
      !revoked.result.qualityPassed && revoked.result.handoffRequired,
      "Revocation did not hand off.",
    );
    assert(
      revokedProvider.calls === 1 && revoked.legacy.calls === 0,
      "Revocation call counts changed.",
    );

    const unsupportedProvider = new SmokeGroundedProvider(
      "Support is available every day.",
      smokeFact.evidenceKey,
    );
    const unsupported = await runScenario("unsupported", unsupportedProvider, approvedAuthorizer());
    assert(
      !unsupported.result.qualityPassed && unsupported.result.handoffRequired,
      "Unsupported paraphrased claim did not hand off.",
    );
    assert(unsupportedProvider.calls === 1, "Unsupported claim used an unexpected provider count.");
    assert(unsupported.legacy.calls === 0, "Structured failure mixed in the legacy provider.");

    const mixedProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const mixed = await runScenario(
      "mixed-corpus",
      mixedProvider,
      new SmokeAuthorizer(),
      mixedCorpusRuntime(tenant.id, publication.id, smokeFact, persistence),
    );
    assert(
      !mixed.result.qualityPassed && mixed.result.handoffRequired,
      "Mixed corpus did not hand off.",
    );
    assert(
      mixedProvider.calls === 0 && mixed.legacy.calls === 0,
      "Mixed corpus called a provider.",
    );

    const emptyProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const empty = await runScenario(
      "empty",
      emptyProvider,
      new SmokeAuthorizer(),
      emptyRuntime(tenant.id, publication.id, smokeFact, persistence),
    );
    assert(
      !empty.result.qualityPassed && empty.result.handoffRequired,
      "Empty retrieval did not hand off.",
    );
    assert(
      emptyProvider.calls === 0 && empty.legacy.calls === 0,
      "Empty retrieval called a provider.",
    );

    const degradedProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const degraded = await runScenario(
      "degraded",
      degradedProvider,
      new SmokeAuthorizer(),
      degradedRuntime(tenant.id, publication.id, smokeFact, persistence),
    );
    assert(
      !degraded.result.qualityPassed && degraded.result.handoffRequired,
      "Degraded retrieval did not hand off.",
    );
    assert(
      degradedProvider.calls === 0 && degraded.legacy.calls === 0,
      "Degraded retrieval called a provider.",
    );

    const degradedGroundedProvider = new SmokeGroundedProvider(
      "Support is available on weekdays.",
      smokeFact.evidenceKey,
    );
    const degradedGrounded = await runScenario(
      "degraded-grounded",
      degradedGroundedProvider,
      approvedAuthorizer(),
      degradedGroundedRuntime(tenant.id, publication.id, smokeFact, persistence),
    );
    assert(
      degradedGrounded.result.qualityPassed && !degradedGrounded.result.handoffRequired,
      "Authoritative evidence was blocked by a document-only outage.",
    );
    assert(
      degradedGroundedProvider.calls === 1 && degradedGrounded.legacy.calls === 0,
      "Degraded authoritative evidence used the wrong provider path.",
    );

    const authenticatedTelegram = await runAuthenticatedTelegramScenario({
      name: "Authenticated Telegram without live evidence",
      ordinal: 1,
      text: "What is the status of my order?",
      answer: "Your order is currently in transit.",
      evidenceKey: smokeFact.evidenceKey,
      authorizer: new SmokeAuthorizer(),
      retriever: (observeAuthorization) =>
        customerPersonalCurrentStateRuntime(
          tenant.id,
          publication.id,
          smokeFact,
          persistence,
          observeAuthorization,
        ),
    });
    assert(
      authenticatedTelegram.persistedIdentity.id === authenticatedTelegram.customerIdentity.id &&
        authenticatedTelegram.persistedIdentity.version ===
          authenticatedTelegram.customerIdentity.version &&
        authenticatedTelegram.persistedIdentity.subjectHash ===
          authenticatedTelegram.customerIdentity.subjectHash &&
        authenticatedTelegram.persistedIdentity.attestationHash ===
          authenticatedTelegram.customerIdentity.attestationHash,
      "Queued Telegram customer identity did not match the persisted attestation.",
    );
    assert(
      authenticatedTelegram.authorizations.length === 1 &&
        authenticatedTelegram.authorizations[0]?.audience === "AUTHENTICATED_CUSTOMER" &&
        JSON.stringify(authenticatedTelegram.authorizations[0]?.classifications) ===
          JSON.stringify(["PUBLIC", "CUSTOMER_PERSONAL"]),
      "A valid Telegram customer identity did not reach authenticated knowledge runtime.",
    );
    nodeAssert.deepEqual(
      authenticatedTelegram.authorizations[0]?.customerIdentity,
      authenticatedTelegram.customerIdentity,
      "Authenticated knowledge runtime did not receive the exact queued identity reference.",
    );
    assert(
      !authenticatedTelegram.result.qualityPassed &&
        authenticatedTelegram.result.handoffRequired &&
        authenticatedTelegram.result.toolResults?.length === 0 &&
        authenticatedTelegram.groundedProvider.calls === 0 &&
        authenticatedTelegram.authorizer.calls === 0 &&
        authenticatedTelegram.legacy.calls === 0,
      "Customer-personal current-state retrieval did not hand off without a live-tool answer.",
    );
    assert(
      authenticatedTelegram.message.text === localizedKnowledgeHandoffReply("en-US"),
      "Authenticated Telegram handoff exposed a customer-personal answer.",
    );

    const authenticatedLiveAnswer = "Your order is currently in transit.";
    const authenticatedLiveExecutionId = `order-live-${stamp}`;
    const authenticatedLiveEvidenceKey = `v2:tool:${authenticatedLiveExecutionId}:${sha256(authenticatedLiveAnswer)}`;
    const authenticatedLiveAdmissions: KnowledgeV2ProcessorQueryAdmissionBinding[] = [];
    const authenticatedLive = await runAuthenticatedTelegramScenario({
      name: "Authenticated Telegram with admitted live evidence",
      ordinal: 2,
      text: "What is the status of my order?",
      answer: authenticatedLiveAnswer,
      evidenceKey: authenticatedLiveEvidenceKey,
      exactValueText: "in transit",
      authorizer: approvedAuthorizer(),
      retriever: (observeAuthorization) =>
        approvedCustomerPersonalCurrentStateRuntime(
          tenant.id,
          publication.id,
          smokeFact,
          persistence,
          authenticatedLiveExecutionId,
          authenticatedLiveAnswer,
          operationalProjection.permissionGeneration,
          observeAuthorization,
          (admission) => authenticatedLiveAdmissions.push(admission),
        ),
    });
    assert(
      authenticatedLive.result.qualityPassed &&
        !authenticatedLive.result.handoffRequired &&
        authenticatedLive.result.toolResults?.length === 0 &&
        authenticatedLive.groundedProvider.calls === 1 &&
        authenticatedLive.authorizer.calls === 3 &&
        authenticatedLive.legacy.calls === 0,
      `Approved authenticated live evidence did not auto-send: ${authenticatedLive.result.qualityReason ?? "unknown"}; provider calls ${authenticatedLive.groundedProvider.calls}; authorizer calls ${authenticatedLive.authorizer.calls}; questions ${JSON.stringify(authenticatedLive.groundedProvider.questions)}.`,
    );
    assert(
      authenticatedLive.message.text === authenticatedLiveAnswer,
      "Approved authenticated live answer changed.",
    );
    nodeAssert.deepEqual(
      authenticatedLive.groundedProvider.questions,
      ["current order status lookup"],
      "Grounded provider received the raw customer-personal query.",
    );
    assert(
      authenticatedLive.authorizations.length === 1 &&
        authenticatedLive.authorizations[0]?.audience === "AUTHENTICATED_CUSTOMER" &&
        authenticatedLive.authorizations[0]?.queryClassification === "CUSTOMER_PERSONAL" &&
        JSON.stringify(authenticatedLive.authorizations[0]?.classifications) ===
          JSON.stringify(["PUBLIC", "CUSTOMER_PERSONAL"]),
      "Approved live runtime did not retain authenticated authorization.",
    );
    nodeAssert.deepEqual(
      authenticatedLive.authorizations[0]?.customerIdentity,
      authenticatedLive.customerIdentity,
      "Approved live runtime received a different customer identity.",
    );
    assert(
      authenticatedLiveAdmissions.length === 1 &&
        authenticatedLiveAdmissions[0]?.status === "ADMITTED" &&
        authenticatedLiveAdmissions[0].mode === "CANONICAL_OPERATIONAL",
      "Approved live runtime did not bind canonical processor-query admission.",
    );
    const authenticatedLiveTrace = await prisma.knowledgeV2RetrievalTrace.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        responseMessageId: authenticatedLive.message.id,
        publicationId: publication.id,
      },
    });
    nodeAssert.deepEqual(
      record(authenticatedLiveTrace.filters).processorQueryAdmission,
      authenticatedLiveAdmissions[0],
      "Persisted live trace changed processor-query admission binding.",
    );

    const renderedMetrics = renderPrometheusMetrics();
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_outcomes_total\{corpus="structured_v2",backend="qdrant",outcome="grounded",reason="evidence_ready",locale="en"\} 5/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_outcomes_total\{corpus="structured_v2",backend="qdrant",outcome="empty",reason="no_match",locale="en"\} 1/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_outcomes_total\{corpus="structured_v2",backend="qdrant",outcome="degraded",reason="qdrant_unavailable",locale="en"\} 2/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_outcomes_total\{corpus="structured_v2",backend="qdrant",outcome="blocked",reason="corpus_mismatch",locale="en"\} 1/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_duration_seconds_count\{corpus="structured_v2",backend="qdrant",outcome="grounded",locale="en"\} 5/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_candidate_count_count\{corpus="structured_v2",backend="qdrant",outcome="grounded",locale="en"\} 5/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_retrieval_selected_count_count\{corpus="structured_v2",backend="qdrant",outcome="grounded",locale="en"\} 5/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_answer_gate_total\{corpus="structured_v2",result="passed",reason="grounded_answer_passed",risk="low",locale="en"\} 2/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_answer_gate_total\{corpus="structured_v2",result="blocked",reason="processor_denied",risk="low",locale="en"\} 1/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_answer_gate_total\{corpus="structured_v2",result="passed",reason="grounded_answer_passed",risk="high",locale="en"\} 1/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_answer_citation_count_sum\{corpus="structured_v2",result="passed",risk="low",locale="en"\} 2/u,
    );
    nodeAssert.match(
      renderedMetrics,
      /leadvirt_knowledge_live_answer_citation_coverage_ratio_sum\{corpus="structured_v2",result="passed",risk="low",locale="en"\} 2/u,
    );
    for (const forbidden of [
      tenant.id,
      exact.result.conversationId,
      smokeFact.evidenceKey,
      "When is support available?",
      "Support is available on weekdays.",
      "en-US",
      exactProvider.identity.provider,
      exactProvider.identity.model,
    ]) {
      assert(!renderedMetrics.includes(forbidden), "Live Knowledge metrics exposed unsafe data.");
    }

    const bookings = await prisma.booking.count({ where: { tenantId: tenant.id } });
    assert(bookings === 0, "Structured graph created a state-changing booking.");
    console.log(
      JSON.stringify({
        ok: true,
        exactCalls: exactProvider.calls,
        deniedCalls: deniedProvider.calls,
        revokedCalls: revokedProvider.calls,
        unsupportedCalls: unsupportedProvider.calls,
        legacyCalls:
          exact.legacy.calls +
          denied.legacy.calls +
          revoked.legacy.calls +
          unsupported.legacy.calls +
          mixed.legacy.calls +
          empty.legacy.calls +
          degraded.legacy.calls +
          degradedGrounded.legacy.calls,
        mixedCorpusCalls: mixedProvider.calls,
        emptyCalls: emptyProvider.calls,
        degradedCalls: degradedProvider.calls,
        degradedGroundedCalls: degradedGroundedProvider.calls,
        authenticatedTelegramAudience: authenticatedTelegram.authorizations[0]?.audience,
        authenticatedTelegramHandoff: authenticatedTelegram.result.handoffRequired,
        authenticatedLiveAutoSend: authenticatedLive.result.qualityPassed,
        authenticatedLiveProviderQuery: authenticatedLive.groundedProvider.questions[0],
        exactTraceId: exactTrace.id,
        exactGateOutcome: exactTrace.gateOutcome,
        exactCitationCount: exactTrace.citations.length,
        metricsChecks: 13,
        bookings,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.authenticatedCustomerIdentity.deleteMany({ where: { tenantId } });
        await tx.webhookEvent.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { id: tenantId } });
      });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
