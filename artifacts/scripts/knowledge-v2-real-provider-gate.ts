import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { PrismaClient } from "@leadvirt/db";
import {
  evaluateKnowledgeRealProviderGate,
  knowledgeRealProviderApiBase,
  knowledgeRealProviderHash,
  type KnowledgeRealProviderGatePolicy,
} from "@leadvirt/knowledge";
import type {
  ApiEnvelope,
  KnowledgeV2AcceptedMutation,
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2MutationResult,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
  KnowledgeV2SourceView,
} from "@leadvirt/types";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function required(name: string) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for the protected Knowledge real-provider gate.`);
  return value;
}

function requiredHash(name: string) {
  const value = required(name);
  assert(/^[a-f0-9]{64}$/u.test(value), `${name} must be an exact SHA-256 hash.`);
  return value;
}

function safeApiBase() {
  const allowedHosts = required("KNOWLEDGE_REAL_PROVIDER_API_HOST_ALLOWLIST")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return knowledgeRealProviderApiBase(
    required("KNOWLEDGE_REAL_PROVIDER_API_BASE"),
    allowedHosts,
    { allowHttp: enabled(process.env.KNOWLEDGE_REAL_PROVIDER_API_ALLOW_HTTP) },
  );
}

function providerPreflight() {
  assert(enabled(process.env.KNOWLEDGE_REAL_PROVIDER_GATE_ENABLED), "KNOWLEDGE_REAL_PROVIDER_GATE_ENABLED=true is required.");
  assert(["staging", "production"].includes(process.env.APP_ENV ?? ""), "APP_ENV must be staging or production.");
  assert(enabled(process.env.RAG_QDRANT_ENABLED), "RAG_QDRANT_ENABLED=true is required.");
  assert((process.env.RAG_RETRIEVAL_MODE ?? "qdrant") === "qdrant", "RAG_RETRIEVAL_MODE=qdrant is required.");
  assert(enabled(process.env.KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED), "KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED=true is required.");
  assert(enabled(process.env.KNOWLEDGE_V2_RERANKER_APPROVED), "KNOWLEDGE_V2_RERANKER_APPROVED=true is required.");
  assert(enabled(process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED), "KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED=true is required.");
  for (const name of [
    "DATABASE_URL",
    "AI_API_KEY",
    "AI_BASE_URL",
    "KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT",
    "KNOWLEDGE_V2_EMBEDDING_REGION",
    "KNOWLEDGE_V2_RERANKER_ENDPOINT",
    "KNOWLEDGE_V2_RERANKER_PROVIDER",
    "KNOWLEDGE_V2_RERANKER_MODEL",
    "KNOWLEDGE_V2_RERANKER_VERSION",
    "KNOWLEDGE_V2_RERANKER_REGION",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_REGION",
    "KNOWLEDGE_OBJECT_STORE_PATH",
    "KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY",
  ]) required(name);
  assert(enabled(process.env.KNOWLEDGE_WEBSITE_IMPORT_ENABLED), "KNOWLEDGE_WEBSITE_IMPORT_ENABLED=true is required.");
  assert(enabled(process.env.KNOWLEDGE_WEBSITE_EGRESS_READY), "KNOWLEDGE_WEBSITE_EGRESS_READY=true is required.");
  const forbiddenIdentity = /(?:mock|fixture|acceptance|deterministic|unconfigured)/iu;
  for (const name of [
    "KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT",
    "KNOWLEDGE_V2_RERANKER_PROVIDER",
    "KNOWLEDGE_V2_RERANKER_MODEL",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER",
    "KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL",
  ]) {
    assert(!forbiddenIdentity.test(required(name)), `${name} does not identify a real provider.`);
  }
}

class ApiClient {
  private cookie = "";

  constructor(
    private readonly baseUrl: string,
    private readonly requestTimeoutMs: number,
  ) {}

  async login(email: string, password: string) {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    this.cookie = setCookie.split(";", 1)[0] ?? "";
    assert(response.ok && this.cookie, "Protected Knowledge gate login failed.");
  }

  async request<T>(path: string, init: RequestInit = {}, expectedStatuses: number[] = [200]) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        cookie: this.cookie,
        ...init.headers,
      },
    });
    const raw = await response.text();
    assert(expectedStatuses.includes(response.status), `Knowledge gate API ${path} failed with HTTP ${response.status}.`);
    const payload = JSON.parse(raw) as ApiEnvelope<T>;
    return { data: payload.data, etag: response.headers.get("etag") };
  }
}

async function waitForJob(api: ApiClient, jobId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await api.request<{ status: string; error?: { code?: string } | null }>(
      `/knowledge/v2/jobs/${encodeURIComponent(jobId)}`,
    );
    if (data.status === "SUCCEEDED") return;
    assert(!["FAILED", "DEAD_LETTER", "CANCELLED"].includes(data.status), `Knowledge job failed: ${data.error?.code ?? data.status}.`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error("Knowledge job timed out.");
}

async function waitForEvaluation(api: ApiClient, runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await api.request<KnowledgeV2BatchEvaluationRunView>(
      `/knowledge/v2/evaluation-runs/${encodeURIComponent(runId)}`,
    );
    if (data.status === "SUCCEEDED") return data;
    assert(!["FAILED", "CANCELLED"].includes(data.status), `Knowledge evaluation failed: ${data.error?.code ?? data.status}.`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, data.pollAfterMs ?? 1_000));
  }
  throw new Error("Knowledge evaluation timed out.");
}

function reportPath() {
  return resolve(process.env.KNOWLEDGE_REAL_PROVIDER_REPORT_PATH?.trim() || "artifacts/reports/knowledge-v2-real-provider-gate.json");
}

function writeReport(report: unknown) {
  const path = reportPath();
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  providerPreflight();
  const requestTimeoutMs = Number(process.env.KNOWLEDGE_REAL_PROVIDER_API_REQUEST_TIMEOUT_MS ?? 30_000);
  assert(Number.isInteger(requestTimeoutMs) && requestTimeoutMs >= 1_000 && requestTimeoutMs <= 120_000, "KNOWLEDGE_REAL_PROVIDER_API_REQUEST_TIMEOUT_MS is invalid.");
  const api = new ApiClient(safeApiBase(), requestTimeoutMs);
  await api.login(required("KNOWLEDGE_REAL_PROVIDER_EMAIL"), required("KNOWLEDGE_REAL_PROVIDER_PASSWORD"));
  const expectedTestCaseSetHash = requiredHash("KNOWLEDGE_REAL_PROVIDER_EXPECTED_TEST_SET_HASH");
  const sourceIds = [...new Set(required("KNOWLEDGE_REAL_PROVIDER_SOURCE_IDS").split(",").map((value) => value.trim()).filter(Boolean))];
  assert(sourceIds.length > 0 && sourceIds.length <= 30, "KNOWLEDGE_REAL_PROVIDER_SOURCE_IDS must contain 1-30 source IDs.");
  assert(sourceIds.every((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id)), "Knowledge real-provider source ID is invalid.");
  const timeoutMs = Number(process.env.KNOWLEDGE_REAL_PROVIDER_TIMEOUT_MS ?? 900_000);
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 60_000 && timeoutMs <= 3_600_000, "KNOWLEDGE_REAL_PROVIDER_TIMEOUT_MS is invalid.");
  const policyPath = resolve(process.env.KNOWLEDGE_REAL_PROVIDER_POLICY_PATH?.trim() || "artifacts/evals/knowledge-v2-real-provider-gate.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8")) as KnowledgeRealProviderGatePolicy;
  const { data: actor } = await api.request<{ id: string; tenantId: string; role: string }>("/auth/me");
  assert(actor.role === "OWNER" || actor.role === "ADMIN", "Protected Knowledge gate requires OWNER or ADMIN.");
  const startedAt = new Date();

  for (const sourceId of sourceIds) {
    const source = await api.request<KnowledgeV2SourceView>(`/knowledge/v2/sources/${encodeURIComponent(sourceId)}`);
    assert(source.etag, "Knowledge source ETag is missing.");
    assert(source.data.kind === "WEBSITE", "Protected Knowledge real-provider sync currently accepts WEBSITE sources only.");
    const synced = await api.request<KnowledgeV2AcceptedMutation>(
      `/knowledge/v2/sources/${encodeURIComponent(sourceId)}/sync`,
      {
        method: "POST",
        headers: {
          "idempotency-key": `real-provider-sync:${sourceId}:${randomUUID()}`,
          "if-match": source.etag,
        },
        body: JSON.stringify({ reason: "Protected multilingual real-provider release gate." }),
      },
      [202],
    );
    await waitForJob(api, synced.data.jobId, timeoutMs);
  }

  const { data: readiness } = await api.request<KnowledgeV2ReadinessView>("/knowledge/v2/readiness");
  assert(readiness.draft.candidateId && readiness.draft.candidateVersion && readiness.draft.candidateManifestHash, "Knowledge draft candidate is not ready after source sync.");
  assert(readiness.draft.evaluationTestCaseSetHash === expectedTestCaseSetHash, "Knowledge test-case set hash drifted from the protected release pin.");
  const validated = await api.request<KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>>(
    "/knowledge/v2/publications/validate",
    {
      method: "POST",
      headers: { "idempotency-key": `real-provider-validate:${randomUUID()}` },
      body: JSON.stringify({
        targetKey: readiness.targetKey,
        candidateId: readiness.draft.candidateId,
        candidateVersion: readiness.draft.candidateVersion,
      }),
    },
    [201],
  );
  assert(["PASSED", "PASSED_WITH_WARNINGS"].includes(validated.data.resource.status), "Knowledge draft validation did not pass.");
  const validation = validated.data.resource;
  const queued = await api.request<KnowledgeV2MutationResult<KnowledgeV2BatchEvaluationRunView>>(
    "/knowledge/v2/evaluation-runs",
    {
      method: "POST",
      headers: { "idempotency-key": `real-provider-evaluation:${randomUUID()}` },
      body: JSON.stringify({
        target: "DRAFT",
        runKind: "PUBLICATION",
        candidateId: validation.candidateId,
        candidateVersion: validation.candidateVersion,
        candidateManifestHash: validation.candidateManifestHash,
      }),
    },
    [202],
  );
  const completed = await waitForEvaluation(api, queued.data.resource.id, timeoutMs);
  assert(completed.testCaseSetHash === expectedTestCaseSetHash, "Completed evaluation test-case set hash does not match the release pin.");

  const prisma = new PrismaClient({ datasources: { db: { url: required("DATABASE_URL") } } });
  try {
    const persistedRun = await prisma.knowledgeV2EvaluationRun.findFirstOrThrow({
      where: { id: completed.id, tenantId: actor.tenantId, corpusKind: "STRUCTURED_V2" },
      include: {
        results: {
          include: {
            metrics: true,
            testCaseVersion: { include: { testCase: { select: { critical: true } } } },
            retrievalTraces: { include: { candidates: true } },
          },
        },
      },
    });
    const persistedValidation = await prisma.knowledgeV2PublicationValidation.findFirstOrThrow({
      where: {
        tenantId: actor.tenantId,
        candidateId: validation.candidateId,
        candidateVersion: validation.candidateVersion,
        candidateManifestHash: validation.candidateManifestHash,
      },
      include: { indexSnapshot: { include: { v2Items: { select: { chunkId: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    const snapshot = persistedValidation.indexSnapshot;
    assert(snapshot && snapshot.corpusKind === "STRUCTURED_V2" && snapshot.status === "READY", "Evaluation did not use a READY structured-v2 index snapshot.");
    assert(snapshot.expectedPointCount > 0 && snapshot.expectedPointCount === snapshot.observedPointCount, "Qdrant snapshot point reconciliation failed.");
    assert(snapshot.v2Items.length === snapshot.expectedPointCount, "Qdrant snapshot membership is incomplete.");
    assert(snapshot.indexSchemaHash && /^[a-f0-9]{64}$/u.test(snapshot.indexSchemaHash), "Qdrant index schema hash is missing.");
    assert(persistedRun.results.length > 0, "Protected evaluation produced no results.");
    for (const result of persistedRun.results) {
      assert(result.testCaseVersion && result.expectedBehavior && result.observedBehavior, "Protected evaluation result is missing its pinned case behavior.");
      assert(result.retrievalTraces.length === 1, "Protected evaluation result must have exactly one persisted retrieval trace.");
      const trace = result.retrievalTraces[0]!;
      assert(trace.retrievalPolicyVersion === persistedRun.retrievalPolicyVersion, "Retrieval trace policy does not match the run pin.");
      if (result.expectedBehavior === "ANSWER") {
        assert(result.provider && result.generatorModel && result.modelProcessorPolicyHash, "ANSWER result is missing real provider identity.");
        assert(trace.candidates.some((candidate) => candidate.denseRank !== null), "ANSWER case has no dense retrieval candidate.");
        assert(trace.candidates.some((candidate) => candidate.sparseRank !== null), "ANSWER case has no sparse retrieval candidate.");
        assert(trace.rerankerVersion && !/unconfigured|fixture|mock/iu.test(trace.rerankerVersion), "ANSWER case did not use the real reranker.");
      }
    }

    const identity = {
      environment: persistedRun.environment,
      provider: persistedRun.provider ?? "",
      generatorModel: persistedRun.generatorModel ?? "",
      embeddingVersion: persistedRun.embeddingVersion ?? "",
      sparseVersion: persistedRun.sparseVersion ?? "",
      rerankerVersion: persistedRun.rerankerVersion ?? "",
      retrievalPolicyVersion: persistedRun.retrievalPolicyVersion,
      promptPolicyVersion: persistedRun.promptPolicyVersion,
      graphVersion: persistedRun.graphVersion,
      codeCommit: persistedRun.codeCommit,
      testCaseSetHash: persistedRun.testCaseSetHash,
      candidateManifestHash: persistedRun.candidateManifestHash ?? "",
      indexSnapshotHash: knowledgeRealProviderHash({
        manifestHash: snapshot.manifestHash,
        collectionName: snapshot.collectionName,
        embeddingProvider: snapshot.embeddingProvider,
        embeddingModel: snapshot.embeddingModel,
        pipelineVersion: snapshot.pipelineVersion,
        expectedPointCount: snapshot.expectedPointCount,
        observedPointCount: snapshot.observedPointCount,
      }),
      indexSchemaHash: snapshot.indexSchemaHash,
      retrievalProcessorPolicyHash: persistedRun.retrievalProcessorPolicyHash ?? "",
      modelProcessorPolicyHash: persistedRun.modelProcessorPolicyHash ?? "",
      configHash: persistedRun.configHash,
    };
    const observations = persistedRun.results.map((result) => {
      const version = result.testCaseVersion!;
      const retrievalMetrics = result.metrics.filter((metric) => metric.category === "RETRIEVAL");
      const trace = result.retrievalTraces[0]!;
      return {
        caseVersionHash: version.immutableHash,
        locale: version.locale,
        riskLevel: version.riskLevel,
        critical: version.testCase.critical,
        expectedBehavior: result.expectedBehavior!,
        observedBehavior: result.observedBehavior,
        status: result.status,
        gateOutcome: result.gateOutcome,
        retrievalChecksPassed: retrievalMetrics.filter((metric) => metric.status === "PASSED").length,
        retrievalChecksTotal: retrievalMetrics.length,
        providerOutputHash: result.providerOutputHash,
        gateResultHash: result.gateResultHash,
        evidenceManifestHash: result.evidenceManifestHash,
        latencyMs: trace.latencyMs ?? result.latencyMs,
        inputTokens: trace.inputTokens ?? result.inputTokens,
        outputTokens: trace.outputTokens ?? result.outputTokens,
        costMicros: (trace.costMicros ?? result.costMicros)?.toString() ?? null,
      };
    });
    const gate = evaluateKnowledgeRealProviderGate({ policy, identity, observations });
    const report = {
      ...gate,
      executedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      tenantHash: knowledgeRealProviderHash(actor.tenantId),
      sourceSetHash: knowledgeRealProviderHash([...sourceIds].sort()),
      evaluationRunHash: knowledgeRealProviderHash(completed.id),
      validationHash: knowledgeRealProviderHash(validation.id),
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    assert(gate.ok, `Knowledge real-provider multilingual gate failed: ${gate.failureCodes.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
