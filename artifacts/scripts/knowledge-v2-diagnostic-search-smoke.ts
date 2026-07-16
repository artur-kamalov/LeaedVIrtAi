import "reflect-metadata";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import type { MembershipRole } from "@leadvirt/db";
import {
  admitKnowledgeV2ProcessorQuery,
  createKnowledgeV2QueryHashKeyring,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  type KnowledgeEvidenceBundle,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeRuntimeRetrievalResult,
  type KnowledgeRuntimeRetrieveInput,
  type KnowledgeV2TraceDraft,
} from "@leadvirt/knowledge";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";

const tenantId = "tenant-diagnostic-search";
const publicationId = "publication-diagnostic-v2";
const query = "What is the private diagnostic price?";
const queryHashes = createKnowledgeV2QueryHashKeyring({
  activeKeyId: "diagnostic-search-query-v1",
  keys: { "diagnostic-search-query-v1": new Uint8Array(32).fill(100) },
});
const processorQueryAdmission = projectKnowledgeV2ProcessorQueryAdmissionBinding(
  admitKnowledgeV2ProcessorQuery({ tenantId, query, classification: "SECRET" }, queryHashes),
);
const queryHashBinding = {
  hash: processorQueryAdmission.originalQueryHash,
  keyId: processorQueryAdmission.queryHashKeyId,
  version: processorQueryAdmission.queryHashVersion,
};

const secrets = {
  publicationManifestHash: "1".repeat(64),
  versionHash: "2".repeat(64),
  valueHash: "3".repeat(64),
  instructionHash: "4".repeat(64),
  revisionHash: "5".repeat(64),
  contentHash: "6".repeat(64),
  permissionFingerprint: "7".repeat(64),
  requirementHash: "8".repeat(64),
  queryHash: queryHashBinding.hash,
  restrictedQueryRef: "restricted://diagnostic-query-secret",
};

const target = {
  corpusKind: "STRUCTURED_V2" as const,
  snapshotKind: "PUBLICATION" as const,
  targetKey: "workspace-v2",
  publicationId,
  publicationSequence: 12,
  publicationManifestHash: secrets.publicationManifestHash,
  indexSnapshotId: "snapshot-diagnostic-v2",
  indexCollectionName: "knowledge_diagnostic_v2",
  indexSchemaHash: "a".repeat(64),
  embeddingProvider: "approved-provider",
  embeddingModel: "approved-model",
  retrievalPolicyVersion: "retrieval-policy-v2",
  promptPolicyVersion: "prompt-policy-v2",
  pipelineVersion: "pipeline-v2",
};

const traceDraft = {
  traceKeySeed: "b".repeat(64),
  queryHash: queryHashBinding,
  restrictedQueryRef: secrets.restrictedQueryRef,
  restrictedQueryCreated: true,
  filters: {},
  filtersHash: "c".repeat(64),
  permissionFingerprint: secrets.permissionFingerprint,
  snapshotKind: "PUBLICATION",
  targetKey: "workspace-v2",
  publicationId,
  retrievalPolicyVersion: "retrieval-policy-v2",
  promptPolicyVersion: "prompt-policy-v2",
  graphVersion: "knowledge-api-diagnostics-v1",
  outcome: "ANSWERED",
  gateOutcome: "AUTO_SEND",
  candidates: [],
  citations: [],
  latencyMs: 2,
} satisfies KnowledgeV2TraceDraft;

const bundle: KnowledgeEvidenceBundle = {
  schemaVersion: 1,
  corpusKind: "STRUCTURED_V2",
  target,
  outcome: "ANSWERED",
  gateOutcome: "AUTO_SEND",
  gateReasons: ["EVIDENCE_READY"],
  facts: [
    {
      kind: "FACT",
      evidenceKey: "v2:fact:diagnostic",
      factId: "fact-diagnostic",
      versionId: "fact-version-diagnostic",
      versionHash: secrets.versionHash,
      safeLabel: "Diagnostic price",
      value: "49 EUR",
      valueHash: secrets.valueHash,
      riskLevel: "LOW",
      authority: "OWNER",
      verificationStatus: "VERIFIED",
      score: 0.99,
    },
  ],
  guidance: [
    {
      kind: "GUIDANCE",
      evidenceKey: "v2:guidance:diagnostic",
      guidanceRuleId: "guidance-diagnostic",
      versionId: "guidance-version-diagnostic",
      versionHash: secrets.versionHash,
      safeLabel: "Diagnostic guidance",
      instruction: "Offer the diagnostic plan.",
      instructionHash: secrets.instructionHash,
      riskLevel: "LOW",
      priority: 10,
      score: 0.95,
    },
  ],
  documents: [
    {
      kind: "DOCUMENT",
      evidenceKey: "v2:document:diagnostic",
      documentId: "document-diagnostic",
      revisionId: "revision-diagnostic",
      revisionHash: secrets.revisionHash,
      chunkId: "chunk-diagnostic",
      sourceId: "source-diagnostic",
      sourceKind: "MANUAL",
      title: "Diagnostic handbook",
      content: "Public diagnostic excerpt.",
      contentHash: secrets.contentHash,
      classification: "PUBLIC",
      locale: "en",
      headingPath: ["Pricing"],
      pageNumber: 2,
      urlAnchor: "#pricing",
      publicUrl: "https://leadvirt.com/diagnostic-handbook",
      permissionFingerprint: secrets.permissionFingerprint,
      permissionVersion: 4,
      fusedRank: 1,
      fusedScore: 0.9,
      rerankRank: 1,
      rerankScore: 0.98,
    },
  ],
  conflicts: [],
  missingSupport: [],
  suppressedEvidence: [],
  citations: [],
  liveToolResults: [],
  answerPolicy: {
    requirementHash: secrets.requirementHash,
    operationalCategory: "STATIC_KNOWLEDGE",
    queryHash: queryHashBinding,
    processorQueryAdmission,
    requiresLiveEvidence: false,
    staticEvidenceMayAnswer: true,
    allowAutoSend: true,
  },
};

const grounded: KnowledgeRuntimeRetrievalResult = {
  status: "grounded",
  bundle,
  traceDraft,
  diagnostics: {
    backend: "qdrant",
    corpusKind: "STRUCTURED_V2",
    candidateCount: 8,
    hydratedCount: 4,
    selectedCount: 3,
    durationMs: 12,
    retrievalPolicyVersion: "retrieval-policy-v2",
    rerankerVersion: "reranker-v2",
  },
};

function context(role: MembershipRole, locale = "en"): RequestContext {
  return {
    tenantId,
    userId: `user-${role.toLowerCase()}`,
    role,
    authMode: "credentials",
    tenant: {
      id: tenantId,
      name: "Diagnostic Search",
      slug: "diagnostic-search",
      status: "ACTIVE",
      businessType: null,
      timezone: "UTC",
    },
    user: {
      id: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@leadvirt.com`,
      phone: null,
      name: role,
      avatarUrl: null,
      passwordChangeRequired: false,
      locale,
    },
  };
}

interface RuntimeHarness {
  retrieveInputs: KnowledgeRuntimeRetrieveInput[];
  revalidationAuthorizations: KnowledgeRuntimeAuthorizationContext[];
  cleanedDrafts: KnowledgeV2TraceDraft[];
  retrieve(input: KnowledgeRuntimeRetrieveInput): Promise<KnowledgeRuntimeRetrievalResult>;
  revalidateEvidence(input: {
    authorization: KnowledgeRuntimeAuthorizationContext;
  }): Promise<{ valid: boolean; reason: string; evidenceManifestHash: string }>;
  cleanupTraceArtifacts(input: { draft: KnowledgeV2TraceDraft }): Promise<void>;
}

function createRuntime(
  result: KnowledgeRuntimeRetrievalResult,
  revalidation = { valid: true, reason: "VALID", evidenceManifestHash: "d".repeat(64) },
): RuntimeHarness {
  return {
    retrieveInputs: [],
    revalidationAuthorizations: [],
    cleanedDrafts: [],
    async retrieve(input) {
      this.retrieveInputs.push(input);
      return result;
    },
    async revalidateEvidence(input) {
      this.revalidationAuthorizations.push(input.authorization);
      return revalidation;
    },
    async cleanupTraceArtifacts(input) {
      this.cleanedDrafts.push(input.draft);
    },
  };
}

function activePublication() {
  return {
    tenantId,
    targetKey: "workspace-v2",
    publicationId,
    sequence: 12,
    publication: {
      id: publicationId,
      tenantId,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      status: "ACTIVE",
      sequence: 12,
      manifestHash: secrets.publicationManifestHash,
      indexSnapshotId: "snapshot-diagnostic-v2",
      retrievalPolicyVersion: "retrieval-policy-v2",
      promptPolicyVersion: "prompt-policy-v2",
      pipelineVersion: "pipeline-v2",
      indexSnapshot: {
        id: "snapshot-diagnostic-v2",
        status: "READY",
      },
    },
  };
}

function createService(
  runtime: RuntimeHarness,
  active: ReturnType<typeof activePublication> | null,
) {
  const pointerQueries: unknown[] = [];
  const prisma = {
    activeKnowledgePublication: {
      async findUnique(input: unknown) {
        pointerQueries.push(input);
        return active;
      },
      async findFirst(input: unknown) {
        pointerQueries.push(input);
        return active;
      },
    },
    auditLog: {
      create: async () => ({ id: "audit-diagnostic-search" }),
    },
  };
  const service = new KnowledgeService(
    prisma as never,
    {} as never,
    runtime as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, pointerQueries };
}

function errorPayload(error: unknown) {
  assert.ok(error instanceof HttpException, "Expected a public HttpException.");
  const response = error.getResponse();
  return {
    status: error.getStatus(),
    body: typeof response === "string" ? { message: response } : response,
  };
}

async function expectHttp(action: Promise<unknown>, expectedStatus: number, expectedCode: string) {
  try {
    await action;
  } catch (error) {
    const payload = errorPayload(error);
    assert.equal(payload.status, expectedStatus);
    assert.equal((payload.body as { code?: unknown }).code, expectedCode);
    const serialized = JSON.stringify(payload.body);
    assert.ok(!serialized.includes(query), "A public error exposed the raw query.");
    for (const secret of Object.values(secrets)) {
      assert.ok(!serialized.includes(secret), "A public error exposed restricted diagnostics.");
    }
    return payload.body;
  }
  assert.fail(`Expected HTTP ${expectedStatus}.`);
}

function allKeys(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, nested] of Object.entries(value)) {
    output.push(key);
    allKeys(nested, output);
  }
  return output;
}

function assertSafeProjection(result: unknown) {
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("Diagnostic price"), "Safe fact labels were omitted.");
  assert.ok(serialized.includes("49 EUR"), "Safe fact values were omitted.");
  assert.ok(
    serialized.includes("Public diagnostic excerpt."),
    "Safe document excerpts were omitted.",
  );
  assert.ok(!serialized.includes(query), "The raw diagnostic query was exposed.");
  for (const secret of Object.values(secrets)) {
    assert.ok(!serialized.includes(secret), "Restricted runtime metadata was exposed.");
  }
  const forbiddenKeys = allKeys(result).filter((key) =>
    /(hash|fingerprint|restricted|traceDraft|rawQuery)/iu.test(key),
  );
  assert.deepEqual(forbiddenKeys, [], `Unsafe response keys: ${forbiddenKeys.join(", ")}`);
}

function assertExactCapture(runtime: RuntimeHarness) {
  assert.equal(runtime.retrieveInputs.length, 1);
  const input = runtime.retrieveInputs[0]!;
  assert.equal(input.tenantId, tenantId);
  assert.equal(input.publicationId, publicationId);
  assert.equal(input.query, query);
  assert.equal(input.graphVersion, "knowledge-api-diagnostics-v1");
  assert.equal(input.authorization.channelType, "DEMO");
  assert.equal(input.authorization.executionContextId, undefined);
  assert.equal(input.authorization.liveToolResults, undefined);
}

async function testRoleAuthorization() {
  for (const role of ["OWNER", "ADMIN", "MANAGER", "AGENT"] as const) {
    const runtime = createRuntime(grounded);
    const { service, pointerQueries } = createService(runtime, activePublication());
    const result = await service.search(context(role), query, 5);

    assertExactCapture(runtime);
    assert.equal(pointerQueries.length, 1);
    assert.ok(JSON.stringify(pointerQueries[0]).includes("workspace-v2"));
    assert.deepEqual(runtime.revalidationAuthorizations, [
      runtime.retrieveInputs[0]!.authorization,
    ]);
    assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);

    if (role === "OWNER" || role === "ADMIN") {
      assert.equal(runtime.retrieveInputs[0]!.authorization.audience, "INTERNAL");
      assert.deepEqual(runtime.retrieveInputs[0]!.authorization.classifications, [
        "PUBLIC",
        "INTERNAL",
        "SENSITIVE",
      ]);
      assert.equal(runtime.retrieveInputs[0]!.authorization.queryClassification, "SECRET");
    } else {
      assert.equal(runtime.retrieveInputs[0]!.authorization.audience, "PUBLIC");
      assert.deepEqual(runtime.retrieveInputs[0]!.authorization.classifications, ["PUBLIC"]);
      assert.equal(runtime.retrieveInputs[0]!.authorization.queryClassification, "SECRET");
    }
    assertSafeProjection(result);
  }
}

async function testNoActiveV2() {
  const runtime = createRuntime(grounded);
  const { service } = createService(runtime, null);
  await expectHttp(
    service.search(context("OWNER"), query, 5),
    503,
    "KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_UNAVAILABLE",
  );
  assert.equal(runtime.retrieveInputs.length, 0, "Runtime ran without a captured v2 publication.");
  assert.equal(runtime.cleanedDrafts.length, 0);
}

async function testUnavailableCleanup() {
  const unavailable: KnowledgeRuntimeRetrievalResult = {
    status: "unavailable",
    reason: "QDRANT_UNAVAILABLE",
    retryable: true,
    target,
    traceDraft,
    diagnostics: {
      backend: "qdrant",
      corpusKind: "STRUCTURED_V2",
      candidateCount: 0,
      hydratedCount: 0,
      selectedCount: 0,
      durationMs: 8,
      degradedReason: "QDRANT_UNAVAILABLE",
    },
  };
  const runtime = createRuntime(unavailable);
  const { service } = createService(runtime, activePublication());
  await expectHttp(
    service.search(context("OWNER"), query, 5),
    503,
    "KNOWLEDGE_DEPENDENCY_RETRIEVAL_UNAVAILABLE",
  );
  assertExactCapture(runtime);
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
  assert.equal(runtime.revalidationAuthorizations.length, 0);
}

async function testGroundedDegradedFact() {
  const degraded: KnowledgeRuntimeRetrievalResult = {
    ...grounded,
    bundle: { ...bundle, documents: [] },
    diagnostics: {
      ...grounded.diagnostics,
      selectedCount: 0,
      degradedReason: "QDRANT_UNAVAILABLE",
    },
  };
  const runtime = createRuntime(degraded);
  const { service } = createService(runtime, activePublication());
  const result = await service.search(context("OWNER"), query, 5);
  assert.equal(result.status, "grounded");
  assert.equal(result.facts.length, 1);
  assert.equal(result.documents.length, 0);
  assert.equal(result.diagnostics.degradedReason, "QDRANT_UNAVAILABLE");
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
}

async function testInsufficientCleanup() {
  const insufficientBundle: KnowledgeEvidenceBundle = {
    ...bundle,
    outcome: "ABSTAINED",
    gateOutcome: "HANDOFF",
    gateReasons: ["NO_MATCH"],
    facts: [],
    guidance: [],
    documents: [],
    missingSupport: ["NO_MATCH"],
  };
  const insufficient: KnowledgeRuntimeRetrievalResult = {
    status: "insufficient_grounding",
    reason: "NO_MATCH",
    bundle: insufficientBundle,
    traceDraft,
    diagnostics: {
      backend: "qdrant",
      corpusKind: "STRUCTURED_V2",
      candidateCount: 0,
      hydratedCount: 0,
      selectedCount: 0,
      durationMs: 4,
    },
  };
  const runtime = createRuntime(insufficient);
  const { service } = createService(runtime, activePublication());
  const result = await service.search(context("AGENT"), query, 5);
  assert.equal(result.status, "insufficient_grounding");
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
  assert.equal(runtime.revalidationAuthorizations.length, 1);
}

async function testStableConflictDiagnostic() {
  const conflictResult: KnowledgeRuntimeRetrievalResult = {
    status: "insufficient_grounding",
    reason: "CONFLICT",
    bundle: {
      ...bundle,
      outcome: "HANDED_OFF",
      gateOutcome: "HANDOFF",
      gateReasons: ["CONFLICT"],
      facts: [],
      guidance: [],
      documents: [],
      conflicts: [
        {
          conflictId: "conflict-diagnostic",
          safeLabel: "pricing/current",
          riskLevel: "HIGH",
          status: "OPEN",
        },
      ],
      missingSupport: ["CONFLICT"],
    },
    traceDraft,
    diagnostics: {
      backend: "qdrant",
      corpusKind: "STRUCTURED_V2",
      candidateCount: 1,
      hydratedCount: 1,
      selectedCount: 0,
      durationMs: 4,
    },
  };
  const runtime = createRuntime(conflictResult);
  const { service } = createService(runtime, activePublication());
  const result = await service.search(context("OWNER"), query, 5);
  assert.equal(result.status, "insufficient_grounding");
  assert.equal(result.reason, "CONFLICT");
  assert.equal(result.conflicts[0]?.conflictId, "conflict-diagnostic");
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
}

async function testMismatchedTarget() {
  const mismatched: KnowledgeRuntimeRetrievalResult = {
    ...grounded,
    bundle: {
      ...bundle,
      target: {
        ...target,
        publicationId: "publication-from-another-capture",
      },
    },
  };
  const runtime = createRuntime(mismatched);
  const { service } = createService(runtime, activePublication());
  await expectHttp(
    service.search(context("OWNER"), query, 5),
    409,
    "KNOWLEDGE_CONFLICT_DIAGNOSTIC_TARGET_CHANGED",
  );
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
  assert.equal(runtime.revalidationAuthorizations.length, 0);
}

async function testDatabaseBackendRejected() {
  const databaseResult: KnowledgeRuntimeRetrievalResult = {
    ...grounded,
    diagnostics: {
      ...grounded.diagnostics,
      backend: "database",
    },
  };
  const runtime = createRuntime(databaseResult);
  const { service } = createService(runtime, activePublication());
  await expectHttp(
    service.search(context("OWNER"), query, 5),
    409,
    "KNOWLEDGE_CONFLICT_DIAGNOSTIC_TARGET_CHANGED",
  );
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
  assert.equal(runtime.revalidationAuthorizations.length, 0);
}

async function testInvalidRevalidation() {
  const runtime = createRuntime(grounded, {
    valid: false,
    reason: "EVIDENCE_CHANGED",
    evidenceManifestHash: "e".repeat(64),
  });
  const { service } = createService(runtime, activePublication());
  await expectHttp(
    service.search(context("ADMIN"), query, 5),
    409,
    "KNOWLEDGE_CONFLICT_DIAGNOSTIC_EVIDENCE_CHANGED",
  );
  assert.equal(runtime.revalidationAuthorizations.length, 1);
  assert.deepEqual(runtime.cleanedDrafts, [traceDraft]);
}

async function testViewerDenied() {
  const runtime = createRuntime(grounded);
  const { service, pointerQueries } = createService(runtime, activePublication());
  await expectHttp(
    service.search(context("VIEWER"), query, 5),
    403,
    "KNOWLEDGE_PERMISSION_DIAGNOSTIC_DENIED",
  );
  assert.equal(pointerQueries.length, 0);
  assert.equal(runtime.retrieveInputs.length, 0);
}

async function main() {
  await testRoleAuthorization();
  await testNoActiveV2();
  await testUnavailableCleanup();
  await testGroundedDegradedFact();
  await testInsufficientCleanup();
  await testStableConflictDiagnostic();
  await testMismatchedTarget();
  await testDatabaseBackendRejected();
  await testInvalidRevalidation();
  await testViewerDenied();
  console.log("Knowledge v2 diagnostic search smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
