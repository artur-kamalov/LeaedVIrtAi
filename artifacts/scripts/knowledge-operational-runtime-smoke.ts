import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@leadvirt/db";
import {
  classifyOperationalQuery,
  createKnowledgeV2QueryHashKeyring,
  hashKnowledgeValue,
  knowledgeLiveToolAuthorizationScopeHash,
  knowledgeLiveToolQueryHash,
  knowledgeLiveToolResultEnvelopeHash,
  knowledgeOperationalRequirementHash,
  KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES,
  KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
  KnowledgeRuntimeRetriever,
  KnowledgeV2Retriever,
  stableKnowledgeValue,
  type KnowledgeEvidenceBundle,
  type KnowledgeOperationalLiveCategory,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeRuntimeCorpus,
  type KnowledgeRuntimeRetrievalResult,
  type KnowledgeV2LiveToolResult,
  type KnowledgeV2LiveToolResultResolver,
  type KnowledgeV2RuntimeUnavailableReason,
  type OperationalQueryCategory,
  type KnowledgeV2QueryHashKeyring,
} from "@leadvirt/knowledge";

const tenantId = "tenant-operational-smoke";
const executionContextId = "turn-operational-smoke";
const customerIdentity = {
  id: "customer-identity-operational-smoke",
  version: 1 as const,
  subjectHash: "d".repeat(64),
  attestationHash: "e".repeat(64),
};
const nowMs = Date.now();
const oldQueryKeyId = "operational-query-key-v1";
const newQueryKeyId = "operational-query-key-v2";
const oldQueryKey = new Uint8Array(32).fill(11);
const newQueryKey = new Uint8Array(32).fill(22);
const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: oldQueryKeyId,
  keys: { [oldQueryKeyId]: oldQueryKey },
});
const rotatedQueryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: newQueryKeyId,
  keys: { [oldQueryKeyId]: oldQueryKey, [newQueryKeyId]: newQueryKey },
});
const removedQueryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: newQueryKeyId,
  keys: { [newQueryKeyId]: newQueryKey },
});
let checks = 0;
let sequence = 0;

function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks += 1;
}

function equal<T>(actual: T, expected: T, message: string) {
  assert.equal(actual, expected, message);
  checks += 1;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown) {
  return hashKnowledgeValue(stableKnowledgeValue(value));
}

function personalAuthorization(
  locale: string,
  intent?: string,
  references: readonly { executionId: string }[] = [],
): KnowledgeRuntimeAuthorizationContext {
  return {
    locale,
    channelType: "WEBSITE",
    audience: "PUBLIC",
    classifications: ["PUBLIC"],
    queryClassification: "CUSTOMER_PERSONAL",
    channelIds: ["channel-operational-smoke"],
    executionContextId,
    customerIdentity,
    ...(intent ? { intent } : {}),
    ...(references.length > 0 ? { liveToolResults: references } : {}),
  };
}

function publicAuthorization(
  locale: string,
  intent?: string,
): KnowledgeRuntimeAuthorizationContext {
  return {
    locale,
    channelType: "WEBSITE",
    audience: "PUBLIC",
    classifications: ["PUBLIC"],
    queryClassification: "PUBLIC",
    channelIds: ["channel-operational-smoke"],
    executionContextId,
    ...(intent ? { intent } : {}),
  };
}

const staticFactValue = "Static content says operational values are available.";
const staticFact = {
  kind: "FACT" as const,
  evidenceKey: `v2:fact:static:${"a".repeat(64)}`,
  factId: "fact-static",
  versionId: "fact-version-static",
  versionHash: "a".repeat(64),
  safeLabel: "static/policy",
  value: staticFactValue,
  valueHash: canonicalHash(staticFactValue),
  riskLevel: "LOW" as const,
  authority: "OWNER_VERIFIED",
  verificationStatus: "VERIFIED",
  score: 1,
};

function publication(corpusKind: KnowledgeRuntimeCorpus, documentBacked = false) {
  const indexSnapshot = documentBacked
    ? {
        id: "snapshot-operational-smoke",
        collectionName: "knowledge-operational-smoke",
        embeddingProvider: "test",
        embeddingModel: "test",
        indexSchema: { dense: {}, sparse: {} },
        indexSchemaHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
      }
    : null;
  return {
    id: `publication-${corpusKind.toLowerCase()}`,
    tenantId,
    targetKey: corpusKind === "STRUCTURED_V2" ? "workspace-v2" : "workspace",
    corpusKind,
    sequence: 1,
    status: "ACTIVE",
    manifestHash: "b".repeat(64),
    indexSnapshotId: indexSnapshot?.id ?? null,
    indexSnapshot,
    pipelineVersion: "operational-smoke-v1",
    retrievalPolicyVersion: "operational-smoke-v1",
    promptPolicyVersion: "operational-smoke-v1",
    items: documentBacked
      ? [
          {
            itemType: "DOCUMENT_REVISION",
            itemId: "revision-operational-smoke",
            itemVersionHash: "e".repeat(64),
            authorizationFingerprint: "f".repeat(64),
            v2DocumentRevisionId: "revision-operational-smoke",
            factVersionId: null,
            guidanceRuleVersionId: null,
            scope: null,
          },
        ]
      : [],
  };
}

interface RuntimeFixture {
  runtime: KnowledgeRuntimeRetriever;
  structured: KnowledgeV2Retriever;
  ledger: Map<string, KnowledgeV2LiveToolResult>;
  executorCalls: string[];
  documentCalls: number;
  embeddingQueries: string[];
  rerankerQueries: string[];
  runtimeCalls: string[];
  restrictedDeletes: string[];
  conflictRows: FixtureConflict[];
}

interface FixtureConflict {
  id: string;
  semanticKey: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_REVIEW" | "RESOLVED";
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
}

function runtimeFixture(
  corpusKind: KnowledgeRuntimeCorpus,
  options: {
    resolver?: boolean;
    staticEvidence?: boolean;
    executorResult?: KnowledgeV2LiveToolResult;
    documentFailure?: KnowledgeV2RuntimeUnavailableReason;
    documentFailureStage?: "query" | "rerank";
    documentProcessing?: boolean;
    structuredFailure?: Error;
    conflicts?: FixtureConflict[];
    queryHashKeyring?: KnowledgeV2QueryHashKeyring;
  } = {},
): RuntimeFixture {
  const runtimeQueryHashKeyring = options.queryHashKeyring ?? queryHashKeyring;
  const activePublication = publication(
    corpusKind,
    Boolean(options.documentFailure || options.documentProcessing),
  );
  const conflictRows = options.conflicts?.map((conflict) => ({ ...conflict })) ?? [];
  const prisma = {
    knowledgeCorpusSelector: {
      findUnique: async () => ({ corpusKind }),
    },
    activeKnowledgePublication: {
      findUnique: async () => ({ publication: activePublication }),
    },
    knowledgePublication: {
      findFirst: async () => activePublication,
    },
    knowledgeIndexSnapshot: {
      findFirst: async () => ({ id: "snapshot-operational-smoke" }),
    },
    knowledgeV2Conflict: {
      findMany: async (input: { where?: { id?: { in?: string[] } } }) => {
        const ids = input.where?.id?.in;
        return conflictRows.filter(
          (conflict) =>
            (conflict.status === "OPEN" || conflict.status === "IN_REVIEW") &&
            (!ids || ids.includes(conflict.id)),
        );
      },
    },
  } as unknown as PrismaClient;
  const ledger = new Map<string, KnowledgeV2LiveToolResult>();
  const resolver: KnowledgeV2LiveToolResultResolver = {
    async resolve(input) {
      return ledger.get(input.executionId) ?? null;
    },
  };
  const executorCalls: string[] = [];
  const runtimeCalls: string[] = [];
  const restrictedDeletes: string[] = [];
  const embeddingQueries: string[] = [];
  const rerankerQueries: string[] = [];
  let documentCalls = 0;
  const structured = new KnowledgeV2Retriever(
    prisma,
    {
      hybridClient: {} as never,
      denseProvider: { schema: { provider: "test", model: "test" } } as never,
      sparseEncoder: { schema: { provider: "test", model: "test" } } as never,
      reranker: { version: "test" } as never,
      restrictedStore: {
        async put(input) {
          return {
            reference: `memory:${input.identity}`,
            hash: sha256(input.content),
            created: true,
          };
        },
        async delete(reference) {
          restrictedDeletes.push(reference);
        },
      },
      queryHashKeyring: runtimeQueryHashKeyring,
      ...(options.executorResult
        ? {
            liveToolResultExecutor: {
              async execute(input) {
                runtimeCalls.push("live");
                executorCalls.push(input.queryHash.hash);
                ledger.set(options.executorResult!.executionId, options.executorResult!);
                return [{ executionId: options.executorResult!.executionId }];
              },
            },
          }
        : {}),
      ...(options.resolver === false ? {} : { liveToolResultResolver: resolver }),
      now: () => new Date(nowMs),
    },
    {
      candidateLimit: 20,
      documentLimit: 4,
      maximumChunksPerDocument: 2,
      maximumFacts: 10,
      maximumGuidance: 10,
      minimumRerankScore: 0,
      maximumParentCharacters: 4_000,
      retentionMs: 60_000,
      graphVersion: "operational-smoke-v1",
    },
  );
  const internals = structured as unknown as {
    resolveStructured: () => Promise<{ facts: (typeof staticFact)[]; guidance: [] }>;
    conflicts: () => Promise<
      Array<{
        conflictId: string;
        safeLabel: string;
        riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        status: "OPEN" | "IN_REVIEW";
      }>
    >;
    snapshotCompatible: () => boolean;
    permissionPartitions: () => Promise<Array<{ fingerprint: string; version: number }>>;
    queryDocuments: (...args: unknown[]) => Promise<unknown>;
    hydrateAndRerank: (...args: unknown[]) => Promise<unknown>;
  };
  internals.resolveStructured = async () => {
    if (options.structuredFailure) throw options.structuredFailure;
    return {
      facts: options.staticEvidence === false ? [] : [staticFact],
      guidance: [],
    };
  };
  internals.conflicts = async () =>
    conflictRows
      .filter(
        (conflict): conflict is FixtureConflict & { status: "OPEN" | "IN_REVIEW" } =>
          conflict.status === "OPEN" || conflict.status === "IN_REVIEW",
      )
      .map((conflict) => ({
        conflictId: conflict.id,
        safeLabel: conflict.semanticKey,
        riskLevel: conflict.severity,
        status: conflict.status,
      }));
  if (options.documentFailure || options.documentProcessing) {
    internals.snapshotCompatible = () => true;
    internals.permissionPartitions = async () => [{ fingerprint: "f".repeat(64), version: 1 }];
    internals.queryDocuments = async (...args) => {
      documentCalls += 1;
      runtimeCalls.push("documents");
      const processorQuery = args[2];
      if (typeof processorQuery === "string") embeddingQueries.push(processorQuery);
      if (options.documentProcessing) {
        return {
          points: [],
          processorAdmission: {
            policyVersion: "operational-smoke-v1",
            policyHash: "9".repeat(64),
          },
        };
      }
      if (options.documentFailureStage === "rerank") {
        return {
          points: [{ id: "point-operational-smoke", score: 1 }],
          processorAdmission: {
            policyVersion: "operational-smoke-v1",
            policyHash: "9".repeat(64),
          },
        };
      }
      return {
        status: "unavailable" as const,
        reason: options.documentFailure,
        retryable: options.documentFailure !== "PROCESSOR_POLICY_DENIED",
        target: null,
        diagnostics: {
          backend: "qdrant" as const,
          corpusKind: "STRUCTURED_V2" as const,
          candidateCount: 0,
          hydratedCount: 0,
          selectedCount: 0,
          durationMs: 1,
        },
      };
    };
    if (options.documentFailureStage === "rerank") {
      internals.hydrateAndRerank = async () => {
        throw new Error("reranker unavailable");
      };
    } else if (options.documentProcessing) {
      internals.hydrateAndRerank = async (...args) => {
        const processorQuery = args[3];
        if (typeof processorQuery === "string") rerankerQueries.push(processorQuery);
        runtimeCalls.push("rerank");
        return {
          selected: [],
          suppressed: [],
          traceCandidates: [],
          hydratedCount: 0,
          processorAdmission: {
            policyVersion: "operational-smoke-v1",
            policyHash: "9".repeat(64),
          },
        };
      };
    }
  }
  const legacy = {
    async retrieve() {
      return {
        status: "grounded" as const,
        publicationId: activePublication.id,
        indexSnapshotId: "legacy-snapshot",
        evidence: [
          {
            chunkId: "legacy-chunk",
            revisionId: "legacy-revision",
            sourceId: "legacy-source",
            sourceType: "POLICY" as const,
            title: "Static operational page",
            content: staticFactValue,
            contentHash: sha256(staticFactValue),
            sourceVersion: 1,
            chunkIndex: 0,
            tokenEstimate: 8,
            embeddingProvider: "test",
            embeddingModel: "test",
            createdAt: new Date(nowMs).toISOString(),
            score: 1,
          },
        ],
        diagnostics: {
          backend: "database" as const,
          candidateCount: 1,
          hydratedCount: 1,
          durationMs: 1,
        },
      };
    },
  };
  return {
    runtime: new KnowledgeRuntimeRetriever(
      prisma,
      legacy as never,
      structured,
      runtimeQueryHashKeyring,
    ),
    structured,
    ledger,
    executorCalls,
    get documentCalls() {
      return documentCalls;
    },
    embeddingQueries,
    rerankerQueries,
    runtimeCalls,
    restrictedDeletes,
    conflictRows,
  };
}

async function retrieve(
  fixture: RuntimeFixture,
  query: string,
  context: KnowledgeRuntimeAuthorizationContext,
) {
  return fixture.runtime.retrieve({
    tenantId,
    query,
    limit: 4,
    locale: context.locale,
    channel: context.channelType,
    graphVersion: "operational-smoke-v1",
    authorization: context,
  });
}

function bundle(result: KnowledgeRuntimeRetrievalResult): KnowledgeEvidenceBundle {
  assert.notEqual(result.status, "unavailable", "runtime unexpectedly became unavailable");
  if (result.status === "unavailable") throw new Error(result.reason);
  return result.bundle;
}

function assertRequirement(
  evidence: KnowledgeEvidenceBundle,
  query: string,
  category: OperationalQueryCategory,
  requiresLiveEvidence: boolean,
) {
  const queryHash = knowledgeLiveToolQueryHash({ tenantId, query, queryHashKeyring });
  assert.deepEqual(
    evidence.answerPolicy.queryHash,
    queryHash,
    "query hash changed across the runtime gate",
  );
  checks += 1;
  equal(
    evidence.answerPolicy.operationalCategory,
    category,
    "runtime operational category differs from the classifier",
  );
  equal(
    evidence.answerPolicy.requirementHash,
    knowledgeOperationalRequirementHash({
      queryHash,
      classification: { category, requiresLiveEvidence },
    }),
    "runtime requirement hash is not reproducible",
  );
}

function assertLiveBlocked(
  result: KnowledgeRuntimeRetrievalResult,
  query: string,
  category: KnowledgeOperationalLiveCategory,
) {
  equal(result.status, "insufficient_grounding", "operational query did not fail closed");
  const evidence = bundle(result);
  equal(evidence.gateOutcome, "HANDOFF", "operational query bypassed handoff");
  check(
    evidence.gateReasons.includes("LIVE_EVIDENCE_REQUIRED"),
    "missing live evidence was not recorded",
  );
  equal(evidence.liveToolResults.length, 0, "invalid live result entered the evidence bundle");
  equal(evidence.answerPolicy.requiresLiveEvidence, true, "live requirement was dropped");
  equal(
    evidence.answerPolicy.staticEvidenceMayAnswer,
    false,
    "static evidence unlocked live state",
  );
  equal(evidence.answerPolicy.allowAutoSend, false, "blocked live query was marked sendable");
  assertRequirement(evidence, query, category, true);
}

function assertLiveAllowed(
  result: KnowledgeRuntimeRetrievalResult,
  query: string,
  category: KnowledgeOperationalLiveCategory,
  executionId: string,
) {
  equal(result.status, "grounded", "valid authoritative live evidence did not ground the query");
  const evidence = bundle(result);
  equal(evidence.gateOutcome, "AUTO_SEND", "valid live evidence did not pass retrieval gate");
  equal(evidence.liveToolResults.length, 1, "valid live result was not selected exactly once");
  equal(
    evidence.liveToolResults[0]?.executionId,
    executionId,
    "selected live result changed identity",
  );
  equal(evidence.answerPolicy.requiresLiveEvidence, true, "live requirement was not preserved");
  equal(evidence.answerPolicy.staticEvidenceMayAnswer, false, "live query allowed static fallback");
  equal(evidence.answerPolicy.allowAutoSend, true, "valid live evidence remained blocked");
  assertRequirement(evidence, query, category, true);
}

function assertStaticAllowed(result: KnowledgeRuntimeRetrievalResult, query: string) {
  equal(result.status, "grounded", "ordinary static question was blocked");
  const evidence = bundle(result);
  equal(evidence.gateOutcome, "AUTO_SEND", "ordinary static question did not pass retrieval");
  equal(
    evidence.answerPolicy.operationalCategory,
    "STATIC_KNOWLEDGE",
    "static query was misclassified",
  );
  equal(
    evidence.answerPolicy.requiresLiveEvidence,
    false,
    "static query incorrectly requires a tool",
  );
  equal(evidence.answerPolicy.staticEvidenceMayAnswer, true, "static evidence was disabled");
  equal(evidence.answerPolicy.allowAutoSend, true, "static answer was not sendable");
  equal(evidence.liveToolResults.length, 0, "static answer consumed an unrelated tool result");
  assertRequirement(evidence, query, "STATIC_KNOWLEDGE", false);
}

function assertProcessorAdmissionDenied(
  result: KnowledgeRuntimeRetrievalResult,
  fixture: RuntimeFixture,
  forbiddenValues: readonly string[],
  expectedAdmissionStatus: "ADMITTED" | "DENIED" = "DENIED",
) {
  equal(result.status, "unavailable", "denied processor query did not fail closed");
  if (result.status !== "unavailable") throw new Error("Expected processor denial.");
  equal(result.reason, "PROCESSOR_POLICY_DENIED", "processor denial returned the wrong reason");
  equal(fixture.executorCalls.length, 0, "denied query invoked the live-tool executor");
  equal(fixture.embeddingQueries.length, 0, "denied query reached the embedding boundary");
  equal(fixture.rerankerQueries.length, 0, "denied query reached the reranker boundary");
  equal(fixture.documentCalls, 0, "denied query entered document retrieval");
  equal(fixture.runtimeCalls.length, 0, "denied query invoked an external runtime stage");
  const traceDraft = result.traceDraft;
  assert.ok(traceDraft, "processor denial did not retain an auditable trace draft");
  const admission = (traceDraft.filters as Record<string, unknown>).processorQueryAdmission;
  check(
    typeof admission === "object" &&
      admission !== null &&
      (admission as { status?: unknown }).status === expectedAdmissionStatus &&
      !("processorQuery" in admission),
    "processor denial persisted content or lost its binding",
  );
  const serialized = JSON.stringify(result);
  for (const forbiddenValue of forbiddenValues) {
    equal(serialized.includes(forbiddenValue), false, "processor denial leaked raw query content");
  }
}

function preparedLiveResult(input: {
  locale: string;
  query: string;
  category: KnowledgeOperationalLiveCategory;
  intent?: string;
}) {
  sequence += 1;
  const executionId = `execution-${sequence}`;
  const context = personalAuthorization(input.locale, input.intent);
  const value = { available: true, category: input.category };
  const exactValue = `result-${sequence}`;
  const content = `Authoritative ${input.category} result: ${exactValue}`;
  const result: KnowledgeV2LiveToolResult = {
    executionId,
    toolCallId: `tool-call-${sequence}`,
    toolKey: "operational.lookup",
    toolVersion: "v1",
    safeName: "Operational lookup",
    sourceSystem: "test-ledger",
    operationalCategory: input.category,
    tenantId,
    executionContextId,
    queryHash: knowledgeLiveToolQueryHash({
      tenantId,
      query: input.query,
      queryHashKeyring,
    }),
    requestHash: canonicalHash({ executionId, query: input.query, category: input.category }),
    authorizationScopeHash: knowledgeLiveToolAuthorizationScopeHash({
      tenantId,
      authorization: context,
    }),
    authorizationDecisionId: `decision-${sequence}`,
    permissionGeneration: 1,
    connectionId: null,
    connectionPermissionVersion: null,
    customerIdentityId: customerIdentity.id,
    customerIdentityVersion: customerIdentity.version,
    subjectHash: canonicalHash({ tenantId, category: input.category }),
    resultType: "operational-result",
    value,
    valueHash: canonicalHash(value),
    exactValue,
    exactValueHash: sha256(exactValue),
    content,
    contentHash: sha256(content),
    observedAt: new Date(nowMs - 30_000).toISOString(),
    expiresAt: new Date(nowMs + 120_000).toISOString(),
    authorizedAt: new Date(nowMs - 60_000).toISOString(),
    authorizationExpiresAt: new Date(nowMs + 180_000).toISOString(),
    toolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    status: "SUCCEEDED",
  };
  return {
    context: {
      ...context,
      liveToolResults: [{ executionId }],
    } satisfies KnowledgeRuntimeAuthorizationContext,
    result,
  };
}

const multilingualCases: ReadonlyArray<{
  locale: string;
  query: string;
  category: KnowledgeOperationalLiveCategory;
}> = [
  {
    locale: "en",
    query: "Do you have any appointments available today?",
    category: "AVAILABILITY",
  },
  {
    locale: "ru",
    query:
      "\u041c\u043e\u044f \u0437\u0430\u043f\u0438\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430?",
    category: "BOOKING_STATE",
  },
  {
    locale: "es",
    query: "\u00bfCu\u00e1ntas unidades quedan en inventario?",
    category: "INVENTORY",
  },
  {
    locale: "fr",
    query: "Quel est le statut de ma commande ?",
    category: "ORDER_STATE",
  },
  {
    locale: "de",
    query: "Wie hoch ist mein aktuelles Kontoguthaben?",
    category: "ACCOUNT_STATE",
  },
  {
    locale: "pt",
    query: "H\u00e1 hor\u00e1rios dispon\u00edveis hoje?",
    category: "AVAILABILITY",
  },
];

const staticCases = [
  ["en", "What are your business hours?"],
  [
    "ru",
    "\u041a\u0430\u043a\u0438\u0435 \u0443 \u0432\u0430\u0441 \u0447\u0430\u0441\u044b \u0440\u0430\u0431\u043e\u0442\u044b?",
  ],
  ["es", "\u00bfC\u00f3mo funciona la reserva?"],
  ["fr", "Quels services proposez-vous ?"],
  ["de", "Welche Richtlinien gelten f\u00fcr Stornierungen?"],
  ["pt", "Quanto custa?"],
] as const;

const intentCases: ReadonlyArray<[string, KnowledgeOperationalLiveCategory]> = [
  ["booking", "BOOKING_STATE"],
  ["availability", "AVAILABILITY"],
  ["booking_availability", "AVAILABILITY"],
  ["inventory", "INVENTORY"],
  ["inventory_status", "INVENTORY"],
  ["stock_status", "INVENTORY"],
  ["account_status", "ACCOUNT_STATE"],
  ["balance", "ACCOUNT_STATE"],
  ["order_status", "ORDER_STATE"],
  ["shipment_status", "ORDER_STATE"],
];

async function main() {
  const structured = runtimeFixture("STRUCTURED_V2");
  const legacy = runtimeFixture("LEGACY_V1");

  for (const testCase of multilingualCases) {
    const classification = classifyOperationalQuery(testCase.query);
    equal(classification.category, testCase.category, `${testCase.locale} category mismatch`);
    equal(
      classification.requiresLiveEvidence,
      true,
      `${testCase.locale} did not require live evidence`,
    );

    assertLiveBlocked(
      await retrieve(structured, testCase.query, personalAuthorization(testCase.locale)),
      testCase.query,
      testCase.category,
    );
    assertLiveBlocked(
      await retrieve(legacy, testCase.query, personalAuthorization(testCase.locale)),
      testCase.query,
      testCase.category,
    );

    const prepared = preparedLiveResult(testCase);
    structured.ledger.set(prepared.result.executionId, prepared.result);
    assertLiveAllowed(
      await retrieve(structured, testCase.query, prepared.context),
      testCase.query,
      testCase.category,
      prepared.result.executionId,
    );
  }

  for (const [locale, query] of staticCases) {
    assertStaticAllowed(await retrieve(structured, query, publicAuthorization(locale)), query);
    assertStaticAllowed(await retrieve(legacy, query, publicAuthorization(locale)), query);
  }

  for (const [intent, category] of intentCases) {
    const query = "Tell me more.";
    const classification = classifyOperationalQuery(query, intent);
    equal(classification.category, category, `${intent} alias category mismatch`);
    equal(classification.requiresLiveEvidence, true, `${intent} alias did not fail closed`);
    assertLiveBlocked(
      await retrieve(structured, query, personalAuthorization("en", intent)),
      query,
      category,
    );
    assertLiveBlocked(
      await retrieve(legacy, query, personalAuthorization("en", intent)),
      query,
      category,
    );
  }

  const mutationQuery = multilingualCases[0]!;
  const mutations: ReadonlyArray<
    [string, (result: KnowledgeV2LiveToolResult) => KnowledgeV2LiveToolResult]
  > = [
    ["tenant", (result) => ({ ...result, tenantId: "tenant-other" })],
    [
      "query",
      (result) => ({
        ...result,
        queryHash: { ...result.queryHash, hash: "0".repeat(64) },
      }),
    ],
    ["category", (result) => ({ ...result, operationalCategory: "INVENTORY" })],
    ["scope", (result) => ({ ...result, authorizationScopeHash: "0".repeat(64) })],
    ["customer identity", (result) => ({ ...result, customerIdentityId: "" })],
    ["legacy policy", (result) => ({ ...result, toolPolicyVersion: "knowledge-live-tool-v1" })],
    ["content", (result) => ({ ...result, contentHash: "0".repeat(64) })],
    ["value", (result) => ({ ...result, valueHash: "0".repeat(64) })],
    ["expiry", (result) => ({ ...result, expiresAt: new Date(nowMs - 1).toISOString() })],
  ];
  for (const [label, mutate] of mutations) {
    const fixture = runtimeFixture("STRUCTURED_V2");
    const prepared = preparedLiveResult(mutationQuery);
    fixture.ledger.set(prepared.result.executionId, mutate(prepared.result));
    assertLiveBlocked(
      await retrieve(fixture, mutationQuery.query, prepared.context),
      mutationQuery.query,
      mutationQuery.category,
    );
    check(label.length > 0, "mutation label is missing");
  }

  const noResolver = runtimeFixture("STRUCTURED_V2", { resolver: false });
  const unresolved = preparedLiveResult(mutationQuery);
  noResolver.ledger.set(unresolved.result.executionId, unresolved.result);
  assertLiveBlocked(
    await retrieve(noResolver, mutationQuery.query, unresolved.context),
    mutationQuery.query,
    mutationQuery.category,
  );

  const executed = preparedLiveResult(mutationQuery);
  const executorFixture = runtimeFixture("STRUCTURED_V2", {
    executorResult: executed.result,
  });
  const executorContext = {
    ...executed.context,
    liveToolResults: [],
  } satisfies KnowledgeRuntimeAuthorizationContext;
  assertStaticAllowed(
    await retrieve(executorFixture, staticCases[0][1], publicAuthorization("en")),
    staticCases[0][1],
  );
  equal(executorFixture.executorCalls.length, 0, "static retrieval invoked the live-tool executor");
  assertLiveAllowed(
    await retrieve(executorFixture, mutationQuery.query, executorContext),
    mutationQuery.query,
    mutationQuery.category,
    executed.result.executionId,
  );
  equal(
    executorFixture.executorCalls.length,
    1,
    "operational retrieval did not invoke the live-tool executor exactly once",
  );
  equal(
    executorFixture.executorCalls[0],
    executed.result.queryHash.hash,
    "executor received a different canonical query hash",
  );

  const credentialQuery = "Where is my current order? api_key=abcdefghijklmnopqrstuvwxyz123456";
  const credentialPrepared = preparedLiveResult({
    locale: "en",
    query: credentialQuery,
    category: "ORDER_STATE",
  });
  const credentialDenied = runtimeFixture("STRUCTURED_V2", {
    staticEvidence: false,
    executorResult: credentialPrepared.result,
    documentProcessing: true,
  });
  assertProcessorAdmissionDenied(
    await retrieve(credentialDenied, credentialQuery, {
      ...credentialPrepared.context,
      liveToolResults: [],
    }),
    credentialDenied,
    ["abcdefghijklmnopqrstuvwxyz123456"],
  );

  const personalQuery = "Where is order 123456 for alex@example.com?";
  const publicPersonalPrepared = preparedLiveResult({
    locale: "en",
    query: personalQuery,
    category: "ORDER_STATE",
  });
  const publicPersonalDenied = runtimeFixture("STRUCTURED_V2", {
    staticEvidence: false,
    executorResult: publicPersonalPrepared.result,
    documentProcessing: true,
  });
  assertProcessorAdmissionDenied(
    await retrieve(publicPersonalDenied, personalQuery, publicAuthorization("en")),
    publicPersonalDenied,
    ["123456", "alex@example.com"],
  );

  const admittedPersonalPrepared = preparedLiveResult({
    locale: "en",
    query: personalQuery,
    category: "ORDER_STATE",
  });
  const admittedPersonal = runtimeFixture("STRUCTURED_V2", {
    staticEvidence: false,
    executorResult: admittedPersonalPrepared.result,
    documentProcessing: true,
  });
  const admittedPersonalResult = await retrieve(admittedPersonal, personalQuery, {
    ...admittedPersonalPrepared.context,
    liveToolResults: [],
  });
  assertLiveAllowed(
    admittedPersonalResult,
    personalQuery,
    "ORDER_STATE",
    admittedPersonalPrepared.result.executionId,
  );
  const canonicalOrderQuery = KNOWLEDGE_V2_PROCESSOR_QUERY_OPERATIONAL_TEMPLATES.ORDER_STATE;
  assert.deepEqual(admittedPersonal.embeddingQueries, [canonicalOrderQuery]);
  assert.deepEqual(admittedPersonal.rerankerQueries, [canonicalOrderQuery]);
  checks += 2;
  equal(
    admittedPersonal.runtimeCalls.join(","),
    "live,documents,rerank",
    "admitted personal query skipped or reordered processor stages",
  );
  const admittedPersonalBundle = bundle(admittedPersonalResult);
  equal(
    admittedPersonalBundle.answerPolicy.processorQueryAdmission.status,
    "ADMITTED",
    "admitted personal query lost its persisted admission binding",
  );
  if (admittedPersonalBundle.answerPolicy.processorQueryAdmission.status === "ADMITTED") {
    equal(
      admittedPersonalBundle.answerPolicy.processorQueryAdmission.mode,
      "CANONICAL_OPERATIONAL",
      "personal operational query was not canonicalized",
    );
  }
  const admittedSerialized = JSON.stringify(admittedPersonalResult);
  equal(admittedSerialized.includes("123456"), false, "admitted result leaked an order identifier");
  equal(
    admittedSerialized.includes("alex@example.com"),
    false,
    "admitted result leaked a customer email",
  );

  const dependencyFailures: ReadonlyArray<
    [KnowledgeV2RuntimeUnavailableReason, "query" | "rerank"]
  > = [
    ["EMBEDDING_UNAVAILABLE", "query"],
    ["SPARSE_ENCODING_UNAVAILABLE", "query"],
    ["QDRANT_UNAVAILABLE", "query"],
    ["PROCESSOR_POLICY_DENIED", "query"],
    ["RERANKER_UNAVAILABLE", "rerank"],
  ];
  for (const [reason, stage] of dependencyFailures) {
    const prepared = preparedLiveResult(mutationQuery);
    const fixture = runtimeFixture("STRUCTURED_V2", {
      staticEvidence: false,
      executorResult: prepared.result,
      documentFailure: reason,
      documentFailureStage: stage,
    });
    const context = {
      ...prepared.context,
      liveToolResults: [],
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const result = await retrieve(fixture, mutationQuery.query, context);
    assertLiveAllowed(
      result,
      mutationQuery.query,
      mutationQuery.category,
      prepared.result.executionId,
    );
    equal(result.diagnostics.degradedReason, reason, `${reason} was not reported as degraded`);
    equal(bundle(result).documents.length, 0, `${reason} leaked document evidence`);
    equal(fixture.executorCalls.length, 1, `${reason} re-executed or skipped the live tool`);
    equal(fixture.documentCalls, 1, `${reason} did not exercise document retrieval`);
    equal(
      fixture.runtimeCalls.join(","),
      "live,documents",
      `${reason} queried documents before the live tool`,
    );
  }

  const degradedStatic = runtimeFixture("STRUCTURED_V2", {
    documentFailure: "QDRANT_UNAVAILABLE",
  });
  const degradedStaticResult = await retrieve(
    degradedStatic,
    staticCases[0][1],
    publicAuthorization("en"),
  );
  assertStaticAllowed(degradedStaticResult, staticCases[0][1]);
  equal(
    degradedStaticResult.diagnostics.degradedReason,
    "QDRANT_UNAVAILABLE",
    "exact structured evidence did not retain Qdrant degradation",
  );
  equal(degradedStatic.executorCalls.length, 0, "static degradation invoked a live tool");
  equal(degradedStatic.documentCalls, 1, "static degradation skipped the document attempt");

  const missingLiveWithDocuments = runtimeFixture("STRUCTURED_V2", {
    documentFailure: "QDRANT_UNAVAILABLE",
  });
  const missingLivePrepared = preparedLiveResult(mutationQuery);
  assertLiveBlocked(
    await retrieve(missingLiveWithDocuments, mutationQuery.query, missingLivePrepared.context),
    mutationQuery.query,
    mutationQuery.category,
  );
  equal(
    missingLiveWithDocuments.documentCalls,
    0,
    "missing mandatory live evidence disclosed the query to document processors",
  );

  const documentOnlyOutage = runtimeFixture("STRUCTURED_V2", {
    staticEvidence: false,
    documentFailure: "QDRANT_UNAVAILABLE",
  });
  const documentOnlyResult = await retrieve(
    documentOnlyOutage,
    staticCases[0][1],
    publicAuthorization("en"),
  );
  equal(documentOnlyResult.status, "unavailable", "document-only outage did not fail closed");
  if (documentOnlyResult.status === "unavailable") {
    equal(
      documentOnlyResult.reason,
      "QDRANT_UNAVAILABLE",
      "document-only outage returned the wrong dependency reason",
    );
  }
  equal(documentOnlyOutage.documentCalls, 1, "document-only outage bypassed its dependency");

  const documentOnlyRerankerFailure = runtimeFixture("STRUCTURED_V2", {
    staticEvidence: false,
    documentFailure: "RERANKER_UNAVAILABLE",
    documentFailureStage: "rerank",
  });
  const documentOnlyRerankerResult = await retrieve(
    documentOnlyRerankerFailure,
    staticCases[0][1],
    publicAuthorization("en"),
  );
  equal(
    documentOnlyRerankerResult.status,
    "unavailable",
    "document-only reranker failure did not fail closed",
  );
  if (documentOnlyRerankerResult.status === "unavailable") {
    equal(
      documentOnlyRerankerResult.reason,
      "RERANKER_UNAVAILABLE",
      "document-only reranker failure returned the wrong dependency reason",
    );
    equal(
      documentOnlyRerankerResult.traceDraft,
      undefined,
      "document-only reranker failure transferred an unusable trace",
    );
  }
  equal(
    documentOnlyRerankerFailure.restrictedDeletes.length,
    1,
    "document-only reranker failure leaked its restricted query artifact",
  );
  check(
    documentOnlyRerankerFailure.restrictedDeletes[0]?.startsWith("memory:") === true,
    "document-only reranker failure deleted the wrong restricted artifact",
  );

  const postStorageException = runtimeFixture("STRUCTURED_V2", {
    structuredFailure: new Error("post-storage fixture failure"),
  });
  await assert.rejects(
    retrieve(postStorageException, staticCases[0][1], publicAuthorization("en")),
    /post-storage fixture failure/u,
  );
  checks += 1;
  equal(
    postStorageException.restrictedDeletes.length,
    1,
    "post-storage exception leaked its restricted query artifact",
  );

  const conflictOnly = runtimeFixture("STRUCTURED_V2", {
    conflicts: [
      {
        id: "conflict-operational-smoke",
        semanticKey: "static/policy",
        severity: "HIGH",
        status: "OPEN",
        effectiveFrom: null,
        effectiveUntil: null,
      },
    ],
  });
  const conflictOnlyResult = await retrieve(
    conflictOnly,
    staticCases[0][1],
    publicAuthorization("en"),
  );
  equal(
    conflictOnlyResult.status,
    "insufficient_grounding",
    "conflict-only retrieval did not hand off",
  );
  const conflictOnlyBundle = bundle(conflictOnlyResult);
  equal(conflictOnlyBundle.facts.length, 0, "conflict-only bundle retained disputed facts");
  equal(conflictOnlyBundle.conflicts.length, 1, "conflict-only bundle lost its conflict");
  const unchangedConflict = await conflictOnly.structured.revalidateEvidence({
    tenantId,
    query: staticCases[0][1],
    bundle: conflictOnlyBundle,
    authorization: publicAuthorization("en"),
  });
  check(unchangedConflict.valid, "unchanged conflict-only bundle failed revalidation");
  conflictOnly.conflictRows[0]!.semanticKey = "static/policy-changed";
  const changedConflict = await conflictOnly.structured.revalidateEvidence({
    tenantId,
    query: staticCases[0][1],
    bundle: conflictOnlyBundle,
    authorization: publicAuthorization("en"),
  });
  equal(
    changedConflict.reason,
    "EVIDENCE_CHANGED",
    "changed conflict-only bundle passed revalidation",
  );
  conflictOnly.conflictRows[0]!.semanticKey = "static/policy";
  conflictOnly.conflictRows[0]!.status = "RESOLVED";
  const resolvedConflict = await conflictOnly.structured.revalidateEvidence({
    tenantId,
    query: staticCases[0][1],
    bundle: conflictOnlyBundle,
    authorization: publicAuthorization("en"),
  });
  equal(
    resolvedConflict.reason,
    "EVIDENCE_CHANGED",
    "resolved conflict-only bundle passed revalidation",
  );

  const liveOnly = runtimeFixture("STRUCTURED_V2", { staticEvidence: false });
  const liveOnlyPrepared = preparedLiveResult(mutationQuery);
  liveOnly.ledger.set(liveOnlyPrepared.result.executionId, liveOnlyPrepared.result);
  const liveOnlyResult = await retrieve(liveOnly, mutationQuery.query, liveOnlyPrepared.context);
  assertLiveAllowed(
    liveOnlyResult,
    mutationQuery.query,
    mutationQuery.category,
    liveOnlyPrepared.result.executionId,
  );
  equal(bundle(liveOnlyResult).facts.length, 0, "live-only fixture unexpectedly used static facts");
  const liveOnlyBundle = bundle(liveOnlyResult);
  const validRevalidation = await liveOnly.structured.revalidateEvidence({
    tenantId,
    query: mutationQuery.query,
    bundle: liveOnlyBundle,
    authorization: liveOnlyPrepared.context,
  });
  check(validRevalidation.valid, "authoritative live evidence failed precommit revalidation");
  const mutatedBundle = {
    ...liveOnlyBundle,
    liveToolResults: liveOnlyBundle.liveToolResults.map((result) => ({
      ...result,
      content: `${result.content} mutated`,
    })),
  };
  const mutatedRevalidation = await liveOnly.structured.revalidateEvidence({
    tenantId,
    query: mutationQuery.query,
    bundle: mutatedBundle,
    authorization: liveOnlyPrepared.context,
  });
  check(!mutatedRevalidation.valid, "mutated live evidence passed precommit revalidation");
  const traceDraft = liveOnlyResult.traceDraft;
  assert.ok(traceDraft, "live retrieval did not create a trace draft");
  const answer = liveOnlyPrepared.result.content;
  const claimHash = sha256(answer);
  const evidenceKey = `v2:tool:${liveOnlyPrepared.result.executionId}:${liveOnlyPrepared.result.contentHash}`;
  const persistedReference = {
    tenantId,
    targetType: "TOOL_RESULT",
    evidenceKey,
    itemVersionHash: null,
    toolResultRef: liveOnlyPrepared.result.executionId,
    locatorHash: knowledgeLiveToolResultEnvelopeHash(liveOnlyPrepared.result),
    permissionFingerprint: liveOnlyPrepared.result.authorizationScopeHash,
    observedAt: new Date(liveOnlyPrepared.result.observedAt),
    expiresAt: new Date(liveOnlyPrepared.result.expiresAt),
  };
  const persistedCitation = {
    support: "SUPPORTS",
    claimHash,
    ordinal: 0,
    confidence: null,
    evidenceReference: persistedReference,
  };
  const persistedTrace = {
    id: "trace-operational-smoke",
    tenantId,
    corpusKind: "STRUCTURED_V2",
    distributedTraceId: executionContextId,
    publicationId: publication("STRUCTURED_V2").id,
    responseMessageId: "message-operational-smoke",
    snapshotKind: "PUBLICATION",
    gateOutcome: "AUTO_SEND",
    outcome: "ANSWERED",
    answerHash: sha256(answer),
    restrictedTraceRef: "memory:answer",
    provider: "fixture",
    generatorModel: "fixture",
    modelProcessorPolicyHash: "1".repeat(64),
    retrievalProcessorPolicyHash: null,
    providerOutputHash: "2".repeat(64),
    gateInputHash: "3".repeat(64),
    gateResultHash: "4".repeat(64),
    queryHash: traceDraft.queryHash.hash,
    queryHashKeyId: traceDraft.queryHash.keyId,
    queryHashVersion: traceDraft.queryHash.version,
    filters: traceDraft.filters,
    filtersHash: traceDraft.filtersHash,
    retentionExpiresAt: new Date(nowMs + 60_000),
    responseMessage: { text: answer },
    publication: { ...publication("STRUCTURED_V2"), items: [] },
    citations: [persistedCitation],
    citationManifestHash: canonicalHash([
      {
        evidenceKey,
        claimHash,
        ordinal: 0,
        confidence: null,
        support: "SUPPORTS",
      },
    ]),
    promptPolicyVersion: "operational-smoke-v1",
  };
  let currentPersistedTrace = persistedTrace;
  const persistedRuntime = new KnowledgeRuntimeRetriever(
    {
      knowledgeV2RetrievalTrace: { findFirst: async () => currentPersistedTrace },
      knowledgeCorpusSelector: { findUnique: async () => ({ corpusKind: "STRUCTURED_V2" }) },
      knowledgeV2Conflict: { findFirst: async () => null },
    } as unknown as PrismaClient,
    {} as never,
    liveOnly.structured,
    rotatedQueryHashKeyring,
  );
  const persistedInput = {
    tenantId,
    retrievalTraceId: persistedTrace.id,
    responseMessageId: "message-operational-smoke",
    publicationId: persistedTrace.publicationId,
    query: mutationQuery.query,
    executionContextId,
  };
  const persistedValid = await persistedRuntime.revalidatePersistedReply(persistedInput);
  check(
    persistedValid.valid,
    `fresh persisted live evidence failed delivery revalidation: ${persistedValid.reason}`,
  );
  const removedKeyRuntime = new KnowledgeRuntimeRetriever(
    {
      knowledgeV2RetrievalTrace: { findFirst: async () => persistedTrace },
      knowledgeCorpusSelector: { findUnique: async () => ({ corpusKind: "STRUCTURED_V2" }) },
      knowledgeV2Conflict: { findFirst: async () => null },
    } as unknown as PrismaClient,
    {} as never,
    liveOnly.structured,
    removedQueryHashKeyring,
  );
  const removedKeyRevalidation = await removedKeyRuntime.revalidatePersistedReply(persistedInput);
  equal(
    removedKeyRevalidation.reason,
    "TARGET_CHANGED",
    "persisted reply accepted a removed query HMAC key",
  );
  currentPersistedTrace = { ...persistedTrace, queryHashKeyId: null };
  const missingMetadataRevalidation =
    await persistedRuntime.revalidatePersistedReply(persistedInput);
  equal(
    missingMetadataRevalidation.reason,
    "TARGET_CHANGED",
    "persisted reply accepted missing query HMAC metadata",
  );
  currentPersistedTrace = persistedTrace;
  const persistedFilterRecord = persistedTrace.filters as Record<string, unknown>;
  const persistedAdmission = persistedFilterRecord.processorQueryAdmission as Record<
    string,
    unknown
  >;
  const malformedAdmissionFilters = {
    ...persistedFilterRecord,
    processorQueryAdmission: { ...persistedAdmission, unexpected: true },
  };
  currentPersistedTrace = {
    ...persistedTrace,
    filters: malformedAdmissionFilters,
    filtersHash: canonicalHash(malformedAdmissionFilters),
  };
  const malformedAdmissionRevalidation =
    await persistedRuntime.revalidatePersistedReply(persistedInput);
  equal(
    malformedAdmissionRevalidation.reason,
    "PERMISSION_CHANGED",
    "persisted reply accepted an admission binding with extra fields",
  );
  const tamperedAdmissionFilters = {
    ...persistedFilterRecord,
    processorQueryAdmission: {
      ...persistedAdmission,
      processorQueryHash: "0".repeat(64),
    },
  };
  currentPersistedTrace = {
    ...persistedTrace,
    filters: tamperedAdmissionFilters,
    filtersHash: canonicalHash(tamperedAdmissionFilters),
  };
  const tamperedAdmissionRevalidation =
    await persistedRuntime.revalidatePersistedReply(persistedInput);
  equal(
    tamperedAdmissionRevalidation.reason,
    "PERMISSION_CHANGED",
    "persisted reply accepted a tampered admission binding",
  );
  currentPersistedTrace = persistedTrace;
  const wrongTrace = await persistedRuntime.revalidatePersistedReply({
    ...persistedInput,
    retrievalTraceId: "trace-other",
  });
  check(!wrongTrace.valid, "a different retrieval trace passed delivery revalidation");
  liveOnly.ledger.set(liveOnlyPrepared.result.executionId, {
    ...liveOnlyPrepared.result,
    expiresAt: new Date(nowMs - 1).toISOString(),
  });
  const expiredRevalidation = await liveOnly.structured.revalidateEvidence({
    tenantId,
    query: mutationQuery.query,
    bundle: liveOnlyBundle,
    authorization: liveOnlyPrepared.context,
  });
  check(!expiredRevalidation.valid, "expired ledger evidence passed precommit revalidation");
  const persistedExpired = await persistedRuntime.revalidatePersistedReply(persistedInput);
  check(!persistedExpired.valid, "expired ledger evidence passed delivery revalidation");

  const legacyPrepared = preparedLiveResult(mutationQuery);
  legacy.ledger.set(legacyPrepared.result.executionId, legacyPrepared.result);
  assertLiveBlocked(
    await retrieve(legacy, mutationQuery.query, legacyPrepared.context),
    mutationQuery.query,
    mutationQuery.category,
  );

  console.log(`Knowledge operational runtime smoke passed (${checks} checks).`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
