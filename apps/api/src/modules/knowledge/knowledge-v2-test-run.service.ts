import { createHash, randomUUID } from "node:crypto";
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, type KnowledgeV2EvaluationRun, type MembershipRole } from "@leadvirt/db";
import type { GroundedAnswerOrchestrationResult } from "@leadvirt/ai";
import {
  compareKnowledgeCanonicalText,
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  equalKnowledgeV2QueryHashBindings,
  parseKnowledgeV2QueryHashBinding,
  type KnowledgeEvidenceBundle,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeRuntimeRetriever,
  type KnowledgeV2GroundedAnswerService,
  type KnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2ActorView,
  KnowledgeV2BatchEvaluationRunKind,
  KnowledgeV2BatchEvaluationRunPage,
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2CreateEvaluationRunRequest,
  KnowledgeV2CreateTestRunRequest,
  KnowledgeV2ErrorCode,
  KnowledgeV2EvaluationAggregateView,
  KnowledgeV2EvaluationResultStatus,
  KnowledgeV2EvaluationRunListQuery,
  KnowledgeV2EvaluationRunMutationResult,
  KnowledgeV2ExpectedBehavior,
  KnowledgeV2FactAuthority,
  KnowledgeV2RiskLevel,
  KnowledgeV2SecurityClassification,
  KnowledgeV2TestGateReason,
  KnowledgeV2TestMissingSupport,
  KnowledgeV2TestRunContextView,
  KnowledgeV2TestRunMutationResult,
  KnowledgeV2TestRunResultView,
  KnowledgeV2TestRunView,
  KnowledgeV2TestSuppressionReason,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  knowledgeV2Error,
  requireIdempotencyKey,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import {
  canonicalKnowledgeV2Locale,
  canonicalKnowledgeV2Scope,
  knowledgeV2ScopeView,
} from "./knowledge-v2-scope.js";
import { KnowledgeV2TestService } from "./knowledge-v2-test.service.js";
import {
  KNOWLEDGE_V2_GROUNDED_ANSWER,
  KNOWLEDGE_V2_QUERY_HASH_KEYRING,
  KNOWLEDGE_V2_RUNTIME_RETRIEVER,
} from "./knowledge.tokens.js";

const eventType = "knowledge.v2.test-run.execute.requested";
const consumer = "api.knowledge-v2-test-run.v1";
const leaseMs = 5 * 60_000;
const maximumAttempts = 5;
const restrictedReferencePrefix = "lvobj:v1:";

type TestRunFailureCode =
  | "TEST_RUN_CLAIM_INVALID"
  | "TEST_RUN_JOB_CLAIM_INVALID"
  | "TEST_RUN_REQUESTER_REVOKED"
  | "TEST_RUN_PERMISSION_DENIED"
  | "TEST_RUN_QUERY_HASH_MISMATCH"
  | "TEST_RUN_CONFIG_HASH_MISMATCH"
  | "TEST_RUN_RESULT_HASH_MISMATCH"
  | "TEST_RUN_RESTRICTED_STORAGE_UNAVAILABLE"
  | "TEST_RUN_TARGET_REVOKED"
  | "TEST_RUN_RETRIEVAL_UNAVAILABLE"
  | "TEST_RUN_TRACE_UNAVAILABLE"
  | "TEST_CASE_VERSION_REVOKED"
  | "TEST_RUN_DEADLINE_EXPIRED"
  | "TEST_RUN_DEPENDENCY_FAILED";

class TestRunExecutionError extends Error {
  constructor(
    readonly code: TestRunFailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "TestRunExecutionError";
  }
}

function testRunFailure(error: unknown) {
  return error instanceof TestRunExecutionError
    ? error
    : new TestRunExecutionError("TEST_RUN_DEPENDENCY_FAILED", true);
}

interface StoredRunConfig {
  version: 3;
  target: "ACTIVE" | "DRAFT";
  testCaseId: string | null;
  testCaseVersionId: string | null;
  testCaseVersionHash: string | null;
  queryHash: string | null;
  queryHashKeyId: string | null;
  queryHashVersion: string | null;
  validationId: string | null;
  indexSnapshotId: string | null;
  queryClassification: KnowledgeV2SecurityClassification;
  requestedRole: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";
  testCaseRiskLevel: KnowledgeV2RiskLevel | null;
  testCaseCritical?: boolean;
  targetMetadata: {
    publicationManifestHash: string | null;
    embeddingProvider: string | null;
    embeddingVersion: string | null;
    sparseVersion: string | null;
    rerankerVersion: string | null;
    indexSchemaHash: string | null;
    processorPolicyHash: string | null;
  };
  context: KnowledgeV2TestRunContextView;
}

interface StoredBatchCaseConfig {
  testCaseId: string;
  testCaseVersionId: string;
  testCaseVersionHash: string;
  queryHash: string;
  queryHashKeyId: string;
  queryHashVersion: string;
  datasetVersion: string;
  queryClassification: KnowledgeV2SecurityClassification;
  testCaseRiskLevel: KnowledgeV2RiskLevel;
  critical: boolean;
  context: KnowledgeV2TestRunContextView;
}

interface StoredBatchRunConfig {
  version: 4;
  mode: "BATCH";
  target: "ACTIVE" | "DRAFT";
  validationId: string | null;
  indexSnapshotId: string | null;
  requestedRole: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";
  targetMetadata: StoredRunConfig["targetMetadata"];
  testCases: StoredBatchCaseConfig[];
}

type StoredEvaluationConfig = StoredRunConfig | StoredBatchRunConfig;

interface StoredRunOutput {
  version: 1;
  context: KnowledgeV2TestRunContextView;
  result: KnowledgeV2TestRunResultView;
}

const evaluationTestCaseInclude = {
  expectations: { orderBy: { ordinal: "asc" as const } },
  testCase: { select: { critical: true, status: true, currentVersionId: true } },
} satisfies Prisma.KnowledgeV2TestCaseVersionInclude;

const batchEvaluationRunInclude = {
  requestedBy: { include: { user: true } },
  results: {
    include: {
      metrics: { orderBy: [{ metricKey: "asc" as const }, { id: "asc" as const }] },
      testCaseVersion: { select: { locale: true, riskLevel: true } },
    },
    orderBy: [{ testCaseVersionId: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.KnowledgeV2EvaluationRunInclude;

type EvaluationTestCaseVersion = Prisma.KnowledgeV2TestCaseVersionGetPayload<{
  include: typeof evaluationTestCaseInclude;
}>;

type BatchEvaluationRunRecord = Prisma.KnowledgeV2EvaluationRunGetPayload<{
  include: typeof batchEvaluationRunInclude;
}>;

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export interface KnowledgeV2EvaluationAggregateInput {
  testCaseSetHash: string;
  results: readonly {
    testCaseVersionId: string;
    status: KnowledgeV2EvaluationResultStatus;
    metricManifestHash: string;
    locale: string;
    riskLevel: KnowledgeV2RiskLevel;
    critical: boolean;
  }[];
}

export function knowledgeV2EvaluationAggregate(
  input: KnowledgeV2EvaluationAggregateInput,
): KnowledgeV2EvaluationAggregateView {
  const normalized = input.results
    .map((result) => ({
      ...result,
      locale: canonicalKnowledgeV2Locale(result.locale),
    }))
    .sort(
      (left, right) =>
        compareKnowledgeCanonicalText(left.testCaseVersionId, right.testCaseVersionId) ||
        compareKnowledgeCanonicalText(left.status, right.status) ||
        compareKnowledgeCanonicalText(left.metricManifestHash, right.metricManifestHash),
    );
  const counts = (results: typeof normalized) => {
    const total = results.length;
    const passed = results.filter((item) => item.status === "PASSED").length;
    const critical = results.filter((item) => item.critical);
    return {
      total,
      passed,
      warning: results.filter((item) => item.status === "WARNING").length,
      failed: results.filter((item) => item.status === "FAILED").length,
      error: results.filter((item) => item.status === "ERROR").length,
      skipped: results.filter((item) => item.status === "SKIPPED").length,
      criticalTotal: critical.length,
      criticalPassed: critical.filter((item) => item.status === "PASSED").length,
      passRate: total > 0 ? passed / total : null,
    };
  };
  const groups = new Map<
    string,
    {
      dimension: "LOCALE" | "RISK_LEVEL" | "CRITICAL_STATUS";
      value: string;
      results: typeof normalized;
    }
  >();
  const add = (
    dimension: "LOCALE" | "RISK_LEVEL" | "CRITICAL_STATUS",
    value: string,
    result: (typeof normalized)[number],
  ) => {
    const sliceKey = `${dimension}:${value}`;
    const current = groups.get(sliceKey);
    if (current) current.results.push(result);
    else groups.set(sliceKey, { dimension, value, results: [result] });
  };
  for (const result of normalized) {
    add("LOCALE", result.locale, result);
    add("RISK_LEVEL", result.riskLevel, result);
    add("CRITICAL_STATUS", result.critical ? "CRITICAL" : "NON_CRITICAL", result);
  }
  const slices = [...groups.entries()]
    .sort(([left], [right]) => compareKnowledgeCanonicalText(left, right))
    .map(([sliceKey, group]) => {
      const aggregateCounts = counts(group.results);
      return {
        sliceKey,
        dimension: group.dimension,
        value: group.value,
        ...aggregateCounts,
        aggregateHash: canonicalKnowledgeV2Hash({
          sliceKey,
          results: group.results,
          counts: aggregateCounts,
        }),
      };
    });
  const aggregateCounts = counts(normalized);
  const sliceManifestHash = canonicalKnowledgeV2Hash(
    slices.map((slice) => ({ sliceKey: slice.sliceKey, aggregateHash: slice.aggregateHash })),
  );
  return {
    ...aggregateCounts,
    slices,
    sliceManifestHash,
    aggregateHash: canonicalKnowledgeV2Hash({
      testCaseSetHash: input.testCaseSetHash,
      results: normalized,
      counts: aggregateCounts,
      sliceManifestHash,
    }),
  };
}

function encodeReference(value: { key: string; encryptionKeyRef: string }) {
  return `${restrictedReferencePrefix}${Buffer.from(JSON.stringify({ version: 1, ...value }), "utf8").toString("base64url")}`;
}

function decodeReference(value: string) {
  try {
    if (!value.startsWith(restrictedReferencePrefix)) throw new Error("invalid reference");
    const parsed = JSON.parse(
      Buffer.from(value.slice(restrictedReferencePrefix.length), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      typeof parsed.key !== "string" ||
      !parsed.key ||
      typeof parsed.encryptionKeyRef !== "string" ||
      !parsed.encryptionKeyRef
    ) {
      throw new Error("invalid reference");
    }
    return { key: parsed.key, encryptionKeyRef: parsed.encryptionKeyRef };
  } catch {
    throw knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
      "Restricted test-run storage is unavailable.",
      { retryable: true },
    );
  }
}

function observedResultBehavior(result: KnowledgeV2TestRunResultView): KnowledgeV2ExpectedBehavior {
  if (result.disposition === "HOLD_FOR_APPROVAL") return "HOLD_FOR_APPROVAL";
  if (result.disposition === "BLOCKED") return "REFUSE";
  if (result.outcome === "ABSTAINED") return "ABSTAIN";
  if (result.disposition === "HANDOFF") return "HANDOFF";
  return result.outcome === "ANSWERED" ? "ANSWER" : "ABSTAIN";
}

function gateReason(value: string): KnowledgeV2TestGateReason {
  if (value === "EVIDENCE_READY") return "SUFFICIENT_SUPPORT";
  if (value === "CONFLICT") return "CONFLICT";
  if (value === "STALE_EVIDENCE") return "STALE_INFORMATION";
  if (value === "UNAUTHORIZED_EVIDENCE") return "SENSITIVE_CONTENT";
  if (value === "LIVE_EVIDENCE_REQUIRED") return "TOOL_FAILURE";
  if (value === "NO_MATCH") return "MISSING_SUPPORT";
  return "UNKNOWN";
}

function missingSupport(value: string): KnowledgeV2TestMissingSupport {
  if (value === "LIVE_EVIDENCE_REQUIRED") return "FRESH_TOOL_RESULT";
  if (value === "UNAUTHORIZED_EVIDENCE") return "PERMISSION";
  if (value === "NO_MATCH") return "REQUIRED_EVIDENCE";
  return "UNKNOWN";
}

function suppressionReason(value: string): KnowledgeV2TestSuppressionReason {
  if (value === "PERMISSION_DENIED") return "PERMISSION";
  if (value === "STALE" || value === "DELETED") return "STALE";
  if (value === "CONFLICTED") return "CONFLICT";
  if (value === "BELOW_THRESHOLD") return "LOW_CONFIDENCE";
  if (value === "DUPLICATE") return "DUPLICATE";
  return "POLICY";
}

function manifestHasDocuments(value: Prisma.JsonValue) {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        (item as Record<string, Prisma.JsonValue>).itemType === "DOCUMENT_REVISION",
    )
  );
}

export function knowledgeV2ForbiddenClaimPasses(input: {
  expectedValueHash: string | null;
  semanticKey: string | null;
  validatedClaims: readonly { claimId: string; claimHash: string }[];
}) {
  if (input.expectedValueHash) {
    return !input.validatedClaims.some((claim) => claim.claimHash === input.expectedValueHash);
  }
  if (input.semanticKey) {
    return !input.validatedClaims.some((claim) => claim.claimId === input.semanticKey);
  }
  return false;
}

export function knowledgeV2TestRunResultFromBundle(
  bundle: KnowledgeEvidenceBundle,
  grounded?: GroundedAnswerOrchestrationResult,
): KnowledgeV2TestRunResultView {
  const answered = grounded?.disposition === "AUTO_SEND" && Boolean(grounded.finalText);
  const evidenceOnly = bundle.gateOutcome === "AUTO_SEND" && !answered;
  return {
    outcome: answered ? "ANSWERED" : evidenceOnly ? "HANDED_OFF" : bundle.outcome,
    disposition: answered ? "AUTO_SEND" : evidenceOnly ? "HANDOFF" : bundle.gateOutcome,
    finalText: answered ? grounded.finalText : null,
    finalTextRedacted: false,
    gateReasons: evidenceOnly
      ? [...bundle.gateReasons.map(gateReason), "POLICY_REQUIRES_HANDOFF"]
      : bundle.gateReasons.map(gateReason),
    facts: bundle.facts.map((item) => ({
      factId: item.factId,
      safeLabel: item.safeLabel,
      safeValue: item.value,
      redacted: false,
      verificationStatus: "VERIFIED",
      authority: item.authority as KnowledgeV2FactAuthority,
      observedAt: item.observedAt ?? null,
      expiresAt: item.expiresAt ?? null,
    })),
    guidance: bundle.guidance.map((item) => ({
      guidanceRuleId: item.guidanceRuleId,
      safeLabel: item.safeLabel,
      safeSummary: item.instruction,
      redacted: false,
      riskLevel: item.riskLevel,
    })),
    documents: bundle.documents.map((item) => ({
      evidenceReferenceId: item.evidenceKey,
      safeLabel: item.title,
      safeExcerpt: item.content,
      isPublic: item.kind === "DOCUMENT" ? item.classification === "PUBLIC" : true,
      redacted: false,
      confidence: item.kind === "DOCUMENT" ? item.rerankScore : item.score,
      anchor:
        item.kind === "DOCUMENT"
          ? {
              pageNumber: item.pageNumber ?? null,
              headingPath: item.headingPath,
              urlAnchor: item.urlAnchor ?? null,
              publicUrl: item.publicUrl ?? null,
            }
          : { headingPath: [] },
    })),
    toolCalls: bundle.liveToolResults.map((item) => ({
      toolCallId: item.toolCallId,
      safeName: item.safeName,
      safeSummary: item.content,
      status: "SUCCEEDED",
      redacted: false,
      calledAt: item.observedAt,
      observedAt: item.observedAt,
      expiresAt: item.expiresAt,
    })),
    conflicts: bundle.conflicts.map((item) => ({
      conflictId: item.conflictId,
      safeLabel: item.safeLabel,
      riskLevel: item.riskLevel,
      status: item.status,
      redacted: false,
    })),
    missingSupport: bundle.missingSupport.map(missingSupport),
    suppressedEvidence: bundle.suppressedEvidence.map((item) => ({
      reason: suppressionReason(item.reason),
      count: item.count,
    })),
    latencyMs: null,
  };
}

function redactResult(result: KnowledgeV2TestRunResultView, privileged: boolean) {
  if (privileged) return result;
  return {
    ...result,
    finalText: null,
    finalTextRedacted: Boolean(result.finalText),
    facts: result.facts.map((item) => {
      const redacted = { ...item };
      delete redacted.safeValue;
      return { ...redacted, redacted: true };
    }),
    guidance: result.guidance.map((item) => {
      const redacted = { ...item };
      delete redacted.safeSummary;
      return { ...redacted, redacted: true };
    }),
    documents: result.documents.map((item) =>
      item.isPublic ? item : { ...item, safeExcerpt: null, redacted: true },
    ),
    toolCalls: result.toolCalls.map((item) => {
      const redacted = { ...item };
      delete redacted.safeSummary;
      return { ...redacted, redacted: true };
    }),
    conflicts: result.conflicts.map((item) => ({ ...item, redacted: true })),
  } satisfies KnowledgeV2TestRunResultView;
}

function publicRunError(errorCode: string | null | undefined): {
  code: KnowledgeV2ErrorCode;
  message: string;
  retryable: boolean;
} {
  if (errorCode === "TEST_RUN_DEADLINE_EXPIRED") {
    return {
      code: "KNOWLEDGE_DEPENDENCY_TEST_RUN_TIMEOUT",
      message: "The knowledge test run timed out.",
      retryable: true,
    };
  }
  if (errorCode === "TEST_RUN_REQUESTER_REVOKED") {
    return {
      code: "KNOWLEDGE_PERMISSION_TEST_RUN_REQUESTER_REVOKED",
      message: "The requester no longer has access to this test run.",
      retryable: false,
    };
  }
  if (errorCode === "TEST_RUN_TARGET_REVOKED") {
    return {
      code: "KNOWLEDGE_CONFLICT_DRAFT_SNAPSHOT_UNAVAILABLE",
      message: "The exact validated draft snapshot is unavailable.",
      retryable: false,
    };
  }
  return {
    code: "KNOWLEDGE_DEPENDENCY_TEST_RUN_FAILED",
    message: "The knowledge test run failed.",
    retryable: false,
  };
}

@Injectable()
export class KnowledgeV2TestRunService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeV2TestService) private readonly tests: KnowledgeV2TestService,
    @Inject(KNOWLEDGE_V2_RUNTIME_RETRIEVER) private readonly runtime: KnowledgeRuntimeRetriever,
    @Inject(KNOWLEDGE_V2_GROUNDED_ANSWER)
    private readonly grounded: KnowledgeV2GroundedAnswerService,
    @Inject(KNOWLEDGE_V2_QUERY_HASH_KEYRING)
    private readonly queryHashes: KnowledgeV2QueryHashKeyring,
  ) {}

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.drain().catch(() => undefined), 5_000);
    this.timer.unref();
    void this.drain().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async createRun(
    context: RequestContext,
    input: KnowledgeV2CreateTestRunRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2TestRunMutationResult> {
    this.assertReader(context);
    this.assertCreateInput(context, input);
    const key = requireIdempotencyKey(idempotencyKey);
    const outcome = await this.idempotency.execute<KnowledgeV2TestRunView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/test-runs",
        key,
        request: this.idempotencyRequest(context.tenantId, input),
      },
      async (tx) => {
        const prepared = await this.prepareInput(tx, context, input);
        const target = await this.captureTarget(tx, context.tenantId, input);
        const config: StoredRunConfig = {
          ...prepared.config,
          validationId: target.validationId,
          indexSnapshotId: target.indexSnapshotId,
          targetMetadata: target.metadata,
        };
        const runId = randomUUID();
        const createdReferences: string[] = [];
        try {
          let queryRef = prepared.queryRef;
          if (!queryRef) {
            const storedQuestion = await this.storeRestricted(
              context.tenantId,
              `${key}:question`,
              input.question!,
            );
            queryRef = storedQuestion.reference;
            if (storedQuestion.created) createdReferences.push(storedQuestion.reference);
          }
          const storedConfig = await this.storeRestricted(
            context.tenantId,
            `${key}:config`,
            JSON.stringify(config),
          );
          const configRef = storedConfig.reference;
          if (storedConfig.created) createdReferences.push(storedConfig.reference);
          const runKey = canonicalKnowledgeV2Hash({ tenantId: context.tenantId, runId });
          const configHash = canonicalKnowledgeV2Hash(config);
          const deadlineAt = new Date(Date.now() + 30 * 60_000);
          const run = await tx.knowledgeV2EvaluationRun.create({
            data: {
              id: runId,
              tenantId: context.tenantId,
              corpusKind: "STRUCTURED_V2",
              runKey,
              runKind: "PLAYGROUND",
              status: "QUEUED",
              snapshotKind: target.snapshotKind,
              targetKey: "workspace-v2",
              publicationId: target.publicationId,
              candidateId: target.candidateId,
              candidateVersion: target.candidateVersion,
              candidateManifestHash: target.candidateManifestHash,
              datasetVersion: prepared.datasetVersion,
              testCaseSetHash: prepared.testCaseVersionHash ?? canonicalKnowledgeV2Hash([]),
              configHash,
              restrictedConfigRef: configRef,
              queryHash: prepared.queryHash,
              queryHashKeyId: prepared.queryHashKeyId,
              queryHashVersion: prepared.queryHashVersion,
              restrictedInputRef: queryRef,
              embeddingVersion: target.metadata.embeddingVersion,
              sparseVersion: target.metadata.sparseVersion,
              rerankerVersion: target.metadata.rerankerVersion,
              retrievalPolicyVersion: target.retrievalPolicyVersion,
              retrievalProcessorPolicyHash: target.metadata.processorPolicyHash,
              promptPolicyVersion: this.config.knowledgeV2GroundedPromptPolicyVersion,
              graphVersion: "knowledge-v2-test-v1",
              provider: this.config.knowledgeV2GroundedAnswerProvider,
              generatorModel: this.config.knowledgeV2GroundedAnswerModel,
              codeCommit: process.env.GIT_COMMIT_SHA ?? "local",
              environment: process.env.APP_ENV ?? "local",
              requestedByUserId: context.userId,
            },
          });
          const job = await tx.knowledgeJob.create({
            data: {
              tenantId: context.tenantId,
              idempotencyKey: `${eventType}:${run.id}`,
              stage: "EVALUATING",
              pipelineVersion: "knowledge-v2-test-v1",
              status: "QUEUED",
              deadlineAt,
              maxAttempts: maximumAttempts,
              payloadRef: `evaluation-run:${run.id}`,
            },
          });
          const event = await tx.knowledgeOutbox.create({
            data: {
              tenantId: context.tenantId,
              aggregateType: "KnowledgeV2EvaluationRun",
              aggregateId: run.id,
              aggregateVersion: 1,
              eventType,
              schemaVersion: 1,
              dedupeKey: `${eventType}:${run.id}`,
              payload: { runId: run.id, jobId: job.id },
              deadlineAt,
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.test_run.queued",
              entityType: "knowledge_v2",
              entityId: run.id,
              payload: {
                runId: run.id,
                queryHash: prepared.queryHash,
                queryHashKeyId: prepared.queryHashKeyId,
                queryHashVersion: prepared.queryHashVersion,
                snapshotKind: target.snapshotKind,
                publicationId: target.publicationId,
                candidateId: target.candidateId,
                candidateVersion: target.candidateVersion,
                outboxEventId: event.id,
              },
            },
          });
          return {
            httpStatus: HttpStatus.ACCEPTED,
            responseBody: this.runView(context, run, config, null, null, job),
          };
        } catch (error) {
          await Promise.all(
            createdReferences.map((reference) =>
              this.deleteRestricted(reference).catch(() => undefined),
            ),
          );
          throw error;
        }
      },
    );
    void this.drain().catch(() => undefined);
    return {
      resource: outcome.responseBody,
      idempotencyReplayed: outcome.idempotencyReplayed,
    };
  }

  async createEvaluationRun(
    context: RequestContext,
    input: KnowledgeV2CreateEvaluationRunRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2EvaluationRunMutationResult> {
    this.assertEvaluationWriter(context);
    const key = requireIdempotencyKey(idempotencyKey);
    const outcome = await this.idempotency.execute<KnowledgeV2BatchEvaluationRunView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/evaluation-runs",
        key,
        request: input,
        transactionTimeoutMs: 30_000,
      },
      async (tx) => {
        const target = await this.captureTarget(tx, context.tenantId, input);
        const cases = await tx.knowledgeV2TestCase.findMany({
          where: {
            tenantId: context.tenantId,
            corpusKind: "STRUCTURED_V2",
            status: "ACTIVE",
            currentVersionId: { not: null },
          },
          include: { currentVersion: true },
          orderBy: [{ caseKey: "asc" }, { id: "asc" }],
          take: 501,
        });
        if (cases.length > 500 || cases.some((item) => !item.currentVersion)) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_EVALUATION_CASE_SET_INVALID",
            "The current active evaluation case set is unavailable.",
          );
        }
        const testCases: StoredBatchCaseConfig[] = await Promise.all(
          cases.map(async (item) => {
            const version = item.currentVersion!;
            const runtimeInput = await this.tests.getTestCaseRuntimeInput(
              context.tenantId,
              item.id,
              version.id,
            );
            const queryBinding = runtimeInput.queryHashBinding;
            const contextView: KnowledgeV2TestRunContextView = {
              locale: canonicalKnowledgeV2Locale(version.locale),
              channelType: version.channelType,
              audience: version.audience,
              scope: knowledgeV2ScopeView(version.scope),
            };
            return {
              testCaseId: item.id,
              testCaseVersionId: version.id,
              testCaseVersionHash: version.immutableHash,
              queryHash: queryBinding.hash,
              queryHashKeyId: queryBinding.keyId,
              queryHashVersion: queryBinding.version,
              datasetVersion: version.datasetVersion,
              queryClassification: this.queryClassification(
                context.role,
                contextView,
                version.riskLevel,
              ),
              testCaseRiskLevel: version.riskLevel,
              critical: item.critical,
              context: contextView,
            };
          }),
        );
        const config: StoredBatchRunConfig = {
          version: 4,
          mode: "BATCH",
          target: input.target,
          validationId: target.validationId,
          indexSnapshotId: target.indexSnapshotId,
          requestedRole: context.role,
          targetMetadata: target.metadata,
          testCases,
        };
        const runId = randomUUID();
        const stored = await this.storeRestricted(
          context.tenantId,
          `${key}:evaluation-config`,
          JSON.stringify(config),
        );
        try {
          const testCaseSetHash = this.batchCaseSetHash(testCases);
          const run = await tx.knowledgeV2EvaluationRun.create({
            data: {
              id: runId,
              tenantId: context.tenantId,
              corpusKind: "STRUCTURED_V2",
              runKey: canonicalKnowledgeV2Hash({ tenantId: context.tenantId, runId }),
              runKind: input.runKind ?? "MANUAL",
              status: "QUEUED",
              snapshotKind: target.snapshotKind,
              targetKey: "workspace-v2",
              publicationId: target.publicationId,
              candidateId: target.candidateId,
              candidateVersion: target.candidateVersion,
              candidateManifestHash: target.candidateManifestHash,
              datasetVersion: canonicalKnowledgeV2Hash(
                testCases.map((item) => item.datasetVersion),
              ),
              testCaseSetHash,
              configHash: canonicalKnowledgeV2Hash(config),
              restrictedConfigRef: stored.reference,
              embeddingVersion: target.metadata.embeddingVersion,
              sparseVersion: target.metadata.sparseVersion,
              rerankerVersion: target.metadata.rerankerVersion,
              retrievalPolicyVersion: target.retrievalPolicyVersion,
              retrievalProcessorPolicyHash: target.metadata.processorPolicyHash,
              promptPolicyVersion: this.config.knowledgeV2GroundedPromptPolicyVersion,
              graphVersion: "knowledge-v2-test-v1",
              provider: this.config.knowledgeV2GroundedAnswerProvider,
              generatorModel: this.config.knowledgeV2GroundedAnswerModel,
              codeCommit: process.env.GIT_COMMIT_SHA ?? "local",
              environment: process.env.APP_ENV ?? "local",
              requestedByUserId: context.userId,
            },
          });
          const deadlineAt = new Date(Date.now() + 30 * 60_000);
          const job = await tx.knowledgeJob.create({
            data: {
              tenantId: context.tenantId,
              idempotencyKey: `${eventType}:${run.id}`,
              stage: "EVALUATING",
              pipelineVersion: "knowledge-v2-test-v1",
              status: "QUEUED",
              deadlineAt,
              maxAttempts: maximumAttempts,
              progressTotal: testCases.length,
              payloadRef: `evaluation-run:${run.id}`,
            },
          });
          await tx.knowledgeOutbox.create({
            data: {
              tenantId: context.tenantId,
              aggregateType: "KnowledgeV2EvaluationRun",
              aggregateId: run.id,
              aggregateVersion: 1,
              eventType,
              schemaVersion: 2,
              dedupeKey: `${eventType}:${run.id}`,
              payload: { runId: run.id, jobId: job.id },
              deadlineAt,
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.evaluation_run.queued",
              entityType: "knowledge_v2",
              entityId: run.id,
              payload: {
                runKind: run.runKind,
                snapshotKind: run.snapshotKind,
                testCaseSetHash,
                testCaseCount: testCases.length,
                queryHashKeyId: run.queryHashKeyId,
                queryHashVersion: run.queryHashVersion,
              },
            },
          });
          const record = await tx.knowledgeV2EvaluationRun.findUniqueOrThrow({
            where: { id: run.id },
            include: batchEvaluationRunInclude,
          });
          return {
            httpStatus: HttpStatus.ACCEPTED,
            responseBody: this.batchRunView(record, job),
          };
        } catch (error) {
          if (stored.created) await this.deleteRestricted(stored.reference).catch(() => undefined);
          throw error;
        }
      },
    );
    void this.drain().catch(() => undefined);
    return {
      resource: outcome.responseBody,
      idempotencyReplayed: outcome.idempotencyReplayed,
    };
  }

  async listEvaluationRuns(
    context: RequestContext,
    query: KnowledgeV2EvaluationRunListQuery,
  ): Promise<KnowledgeV2BatchEvaluationRunPage> {
    this.assertReader(context);
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2EvaluationRunWhereInput[] = [];
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.runKind) filters.push({ runKind: query.runKind });
    if (query.target) {
      filters.push({ snapshotKind: query.target === "ACTIVE" ? "PUBLICATION" : "DRAFT_CANDIDATE" });
    }
    const rows = await this.prisma.knowledgeV2EvaluationRun.findMany({
      where: {
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        runKind: { in: ["MANUAL", "PUBLICATION"] },
        ...(filters.length ? { AND: filters } : {}),
      },
      include: batchEvaluationRunInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const jobs = await this.jobsForRuns(
      context.tenantId,
      page.map((item) => item.id),
    );
    const nextCursor =
      rows.length > limit && page.length
        ? encodeKnowledgeV2Cursor({
            createdAt: page[page.length - 1]!.createdAt.toISOString(),
            id: page[page.length - 1]!.id,
          })
        : null;
    return {
      items: page.map((item) => this.batchRunView(item, jobs.get(item.id) ?? null)),
      pageInfo: {
        limit,
        nextCursor,
        hasNextPage: nextCursor !== null,
      },
    };
  }

  async getEvaluationRun(context: RequestContext, runId: string) {
    this.assertReader(context);
    const run = await this.prisma.knowledgeV2EvaluationRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        runKind: { in: ["MANUAL", "PUBLICATION"] },
      },
      include: batchEvaluationRunInclude,
    });
    if (!run) throw this.notFound();
    const jobs = await this.jobsForRuns(context.tenantId, [run.id]);
    return this.batchRunView(run, jobs.get(run.id) ?? null);
  }

  async cancelEvaluationRun(
    context: RequestContext,
    runId: string,
    idempotencyKey: string,
  ): Promise<KnowledgeV2EvaluationRunMutationResult> {
    this.assertEvaluationWriter(context);
    const outcome = await this.idempotency.execute<KnowledgeV2BatchEvaluationRunView>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/knowledge/v2/evaluation-runs/${runId}/cancel`,
        key: requireIdempotencyKey(idempotencyKey),
        request: { runId },
      },
      async (tx) => {
        const run = await tx.knowledgeV2EvaluationRun.findFirst({
          where: {
            id: runId,
            tenantId: context.tenantId,
            runKind: { in: ["MANUAL", "PUBLICATION"] },
          },
        });
        if (!run) throw this.notFound();
        if (run.status === "QUEUED" || run.status === "RUNNING") {
          const now = new Date();
          await tx.knowledgeV2EvaluationRun.update({
            where: { id: run.id },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          const jobs = await tx.knowledgeJob.findMany({
            where: { tenantId: context.tenantId, payloadRef: `evaluation-run:${run.id}` },
            select: { id: true },
          });
          await tx.knowledgeJob.updateMany({
            where: {
              id: { in: jobs.map((item) => item.id) },
              status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED"] },
            },
            data: { status: "CANCELLED", completedAt: now, errorCode: "TEST_RUN_CANCELLED" },
          });
          await tx.knowledgeJobAttempt.updateMany({
            where: { jobId: { in: jobs.map((item) => item.id) }, status: "RUNNING" },
            data: { status: "CANCELLED", completedAt: now, errorCode: "TEST_RUN_CANCELLED" },
          });
          await tx.knowledgeOutbox.updateMany({
            where: {
              tenantId: context.tenantId,
              aggregateId: run.id,
              eventType,
              status: { in: ["PENDING", "FAILED", "PUBLISHING"] },
            },
            data: {
              status: "DEAD_LETTER",
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: "TEST_RUN_CANCELLED",
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.evaluation_run.cancelled",
              entityType: "knowledge_v2",
              entityId: run.id,
              payload: { runId: run.id },
            },
          });
        }
        const record = await tx.knowledgeV2EvaluationRun.findUniqueOrThrow({
          where: { id: run.id },
          include: batchEvaluationRunInclude,
        });
        const job = await tx.knowledgeJob.findFirst({
          where: { tenantId: context.tenantId, payloadRef: `evaluation-run:${run.id}` },
          orderBy: { createdAt: "desc" },
        });
        return { httpStatus: HttpStatus.OK, responseBody: this.batchRunView(record, job) };
      },
    );
    return { resource: outcome.responseBody, idempotencyReplayed: outcome.idempotencyReplayed };
  }

  async getRun(context: RequestContext, runId: string) {
    this.assertReader(context);
    const run = await this.prisma.knowledgeV2EvaluationRun.findFirst({
      where: { id: runId, tenantId: context.tenantId, runKind: "PLAYGROUND" },
      include: {
        results: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!run) throw this.notFound();
    const job = await this.prisma.knowledgeJob.findFirst({
      where: { tenantId: context.tenantId, payloadRef: `evaluation-run:${run.id}` },
      orderBy: { createdAt: "desc" },
    });
    const config = await this.readJson<StoredRunConfig>(
      run.restrictedConfigRef,
      run.configHash,
      "TEST_RUN_CONFIG_HASH_MISMATCH",
    );
    if (config.version !== 3) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
        "The test query integrity binding is unavailable.",
      );
    }
    await this.assertRunQueryMetadata(run, config);
    if (
      context.role === "MANAGER" &&
      !this.runtimeAccessAllowed(context.role, run.snapshotKind, config)
    ) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_TEST_RUN_SCOPE_DENIED",
        "Managers can read active public knowledge test runs only.",
      );
    }
    const resultRecord = run.results[0] ?? null;
    const output = resultRecord?.restrictedResultRef
      ? await this.readJsonSha256<StoredRunOutput>(
          resultRecord.restrictedResultRef,
          resultRecord.restrictedResultHash,
          "TEST_RUN_RESULT_HASH_MISMATCH",
        )
      : null;
    const trace = resultRecord
      ? await this.prisma.knowledgeV2RetrievalTrace.findFirst({
          where: {
            tenantId: context.tenantId,
            evaluationRunId: run.id,
            evaluationResultId: resultRecord.id,
          },
          select: { id: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : null;
    const traceId = trace?.id ?? null;
    const result = output?.result
      ? redactResult(
          { ...output.result, retrievalTraceId: traceId },
          context.role === "OWNER" || context.role === "ADMIN",
        )
      : null;
    return this.runView(context, run, config, result, traceId, job);
  }

  private async prepareInput(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    input: KnowledgeV2CreateTestRunRequest,
  ) {
    let queryHashBinding: KnowledgeV2QueryHashBinding;
    let queryRef: string | null = null;
    let testCaseId: string | null = null;
    let testCaseVersionId: string | null = null;
    let testCaseVersionHash: string | null = null;
    let testCaseRiskLevel: KnowledgeV2RiskLevel | null = null;
    let testCaseCritical = false;
    let datasetVersion = "playground-v1";
    let contextView: KnowledgeV2TestRunContextView;
    if (input.testCaseId) {
      const testCase = await tx.knowledgeV2TestCase.findFirst({
        where: {
          id: input.testCaseId,
          tenantId: context.tenantId,
          corpusKind: "STRUCTURED_V2",
          status: "ACTIVE",
        },
        include: { currentVersion: true },
      });
      if (!testCase?.currentVersion) throw this.notFound();
      queryHashBinding = (
        await this.tests.getTestCaseRuntimeInput(
          context.tenantId,
          testCase.id,
          testCase.currentVersion.id,
        )
      ).queryHashBinding;
      queryRef = testCase.currentVersion.restrictedInputRef;
      testCaseId = testCase.id;
      testCaseVersionId = testCase.currentVersion.id;
      testCaseVersionHash = testCase.currentVersion.immutableHash;
      testCaseRiskLevel = testCase.currentVersion.riskLevel;
      testCaseCritical = testCase.critical;
      datasetVersion = testCase.currentVersion.datasetVersion;
      contextView = {
        locale: canonicalKnowledgeV2Locale(testCase.currentVersion.locale),
        channelType: testCase.currentVersion.channelType,
        audience: testCase.currentVersion.audience,
        scope: knowledgeV2ScopeView(testCase.currentVersion.scope),
      };
      this.assertRuntimeAccess(context.role, input.target, contextView, testCaseRiskLevel);
    } else {
      queryHashBinding = this.queryHashes.hash({
        tenantId: context.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
        value: input.question!,
      });
      const scope = canonicalKnowledgeV2Scope(input.scope);
      contextView = {
        locale: canonicalKnowledgeV2Locale(input.locale),
        channelType: input.channelType,
        audience: input.audience,
        scope: knowledgeV2ScopeView(scope as unknown as Prisma.JsonValue),
      };
      this.assertRuntimeAccess(context.role, input.target, contextView, null);
    }
    const queryClassification = this.queryClassification(
      context.role,
      contextView,
      testCaseRiskLevel,
    );
    const config: StoredRunConfig = {
      version: 3,
      target: input.target,
      testCaseId,
      testCaseVersionId,
      testCaseVersionHash,
      queryHash: queryHashBinding.hash,
      queryHashKeyId: queryHashBinding.keyId,
      queryHashVersion: queryHashBinding.version,
      validationId: null,
      indexSnapshotId: null,
      queryClassification,
      requestedRole: context.role,
      testCaseRiskLevel,
      testCaseCritical,
      targetMetadata: {
        publicationManifestHash: null,
        embeddingProvider: null,
        embeddingVersion: null,
        sparseVersion: null,
        rerankerVersion: null,
        indexSchemaHash: null,
        processorPolicyHash: null,
      },
      context: contextView,
    };
    return {
      queryHash: queryHashBinding.hash,
      queryHashKeyId: queryHashBinding.keyId,
      queryHashVersion: queryHashBinding.version,
      queryRef,
      testCaseId,
      testCaseVersionId,
      testCaseVersionHash,
      datasetVersion,
      context: contextView,
      config,
    };
  }

  private async captureTarget(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: {
      target: "ACTIVE" | "DRAFT";
      candidateId?: string | null;
      candidateVersion?: number | null;
      candidateManifestHash?: string | null;
    },
  ) {
    if (input.target === "ACTIVE") {
      const active = await tx.activeKnowledgePublication.findUnique({
        where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
        include: {
          publication: {
            include: {
              indexSnapshot: { include: { v2Items: true } },
              items: { select: { itemType: true } },
            },
          },
        },
      });
      const publication = active?.publication;
      const hasDocuments =
        publication?.items.some((item) => item.itemType === "DOCUMENT_REVISION") ?? false;
      if (
        !publication ||
        publication.corpusKind !== "STRUCTURED_V2" ||
        publication.status !== "ACTIVE" ||
        (hasDocuments &&
          (!publication.indexSnapshot ||
            publication.indexSnapshot.status !== "READY" ||
            publication.indexSnapshot.deletedAt !== null ||
            publication.indexSnapshot.expectedPointCount !==
              publication.indexSnapshot.observedPointCount ||
            publication.indexSnapshot.expectedPointCount !==
              publication.indexSnapshot.v2Items.length))
      ) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_UNAVAILABLE",
          "The active structured knowledge publication is unavailable.",
          { retryable: true },
        );
      }
      const metadata = await this.targetMetadata(
        tx,
        tenantId,
        hasDocuments ? publication.indexSnapshot : null,
      );
      return {
        snapshotKind: "PUBLICATION" as const,
        publicationId: publication.id,
        candidateId: null,
        candidateVersion: null,
        candidateManifestHash: null,
        validationId: null,
        indexSnapshotId: publication.indexSnapshotId,
        metadata: { ...metadata, publicationManifestHash: publication.manifestHash },
        retrievalPolicyVersion: publication.retrievalPolicyVersion,
        promptPolicyVersion: publication.promptPolicyVersion,
      };
    }
    const candidateId = input.candidateId;
    const candidateVersion = input.candidateVersion;
    const candidateManifestHash = input.candidateManifestHash;
    if (!candidateId || !candidateVersion || !candidateManifestHash) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_ERROR",
        "The exact draft candidate identity is required.",
      );
    }
    const validation = await tx.knowledgeV2PublicationValidation.findFirst({
      where: {
        tenantId,
        candidateId,
        candidateVersion,
        candidateManifestHash,
        corpusKind: "STRUCTURED_V2",
        targetKey: "workspace-v2",
        status: "PASSED",
        validUntil: { gt: new Date() },
      },
      include: { indexSnapshot: { include: { v2Items: true } } },
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
    });
    const hasDocuments = validation ? manifestHasDocuments(validation.candidateItems) : false;
    if (
      !validation ||
      (hasDocuments &&
        (!validation.indexSnapshot ||
          validation.indexSnapshot.status !== "READY" ||
          validation.indexSnapshot.deletedAt !== null ||
          validation.indexSnapshot.expectedPointCount !==
            validation.indexSnapshot.observedPointCount ||
          validation.indexSnapshot.expectedPointCount !==
            validation.indexSnapshot.v2Items.length)) ||
      (!hasDocuments && validation.indexSnapshot)
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_DRAFT_SNAPSHOT_UNAVAILABLE",
        "The exact validated draft snapshot is unavailable.",
      );
    }
    const metadata = await this.targetMetadata(
      tx,
      tenantId,
      hasDocuments ? validation.indexSnapshot : null,
    );
    return {
      snapshotKind: "DRAFT_CANDIDATE" as const,
      publicationId: null,
      candidateId: validation.candidateId,
      candidateVersion: validation.candidateVersion,
      candidateManifestHash: validation.candidateManifestHash,
      validationId: validation.id,
      indexSnapshotId: validation.indexSnapshotId,
      metadata: { ...metadata, publicationManifestHash: null },
      retrievalPolicyVersion: "knowledge-v2",
      promptPolicyVersion: "knowledge-v2",
    };
  }

  private async targetMetadata(
    tx: Prisma.TransactionClient,
    tenantId: string,
    snapshot: {
      embeddingProvider: string;
      embeddingModel: string;
      indexSchema: Prisma.JsonValue | null;
      indexSchemaHash: string | null;
    } | null,
  ) {
    if (!snapshot) {
      return {
        publicationManifestHash: null,
        embeddingProvider: null,
        embeddingVersion: null,
        sparseVersion: null,
        rerankerVersion: null,
        indexSchemaHash: null,
        processorPolicyHash: null,
      };
    }
    const settings = await tx.knowledgeV2Settings.findUnique({
      where: { tenantId },
      select: { retrievalProcessorPolicy: true },
    });
    const schema = this.jsonRecord(snapshot.indexSchema);
    const dense = this.jsonRecord(schema.dense);
    const sparse = this.jsonRecord(schema.sparse);
    const denseSchema = typeof dense.schemaVersion === "string" ? dense.schemaVersion : null;
    const sparseSchema = typeof sparse.schemaVersion === "string" ? sparse.schemaVersion : null;
    const sparseProvider = typeof sparse.provider === "string" ? sparse.provider : null;
    const sparseModel = typeof sparse.model === "string" ? sparse.model : null;
    return {
      publicationManifestHash: null,
      embeddingProvider: snapshot.embeddingProvider,
      embeddingVersion: [snapshot.embeddingProvider, snapshot.embeddingModel, denseSchema]
        .filter((value): value is string => Boolean(value))
        .join(":"),
      sparseVersion:
        sparseProvider && sparseModel && sparseSchema
          ? `${sparseProvider}:${sparseModel}:${sparseSchema}`
          : null,
      rerankerVersion: [
        this.config.knowledgeV2RerankerProvider,
        this.config.knowledgeV2RerankerModel,
        this.config.knowledgeV2RerankerVersion,
        this.config.knowledgeV2RerankerRegion,
      ].join(":"),
      indexSchemaHash: snapshot.indexSchemaHash,
      processorPolicyHash: settings?.retrievalProcessorPolicy
        ? canonicalKnowledgeV2Hash(settings.retrievalProcessorPolicy)
        : null,
    };
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const expired = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType,
          deadlineAt: { lte: new Date() },
          status: { in: ["PENDING", "FAILED", "PUBLISHING"] },
        },
        select: { id: true, tenantId: true, aggregateId: true, payload: true },
        take: 25,
      });
      for (const event of expired) await this.expireEvent(event);
      const events = await this.prisma.knowledgeOutbox.findMany({
        where: {
          eventType,
          availableAt: { lte: new Date() },
          deadlineAt: { gt: new Date() },
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - leaseMs) } },
            { status: "PUBLISHING", lockedAt: null },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { id: "asc" }],
        take: 10,
      });
      for (const event of events) await this.executeEvent(event.id);
    } finally {
      this.draining = false;
    }
  }

  private async executeEvent(eventId: string) {
    const lockId = `${consumer}:${randomUUID()}`;
    const claimed = await this.prisma.knowledgeOutbox.updateMany({
      where: {
        id: eventId,
        eventType,
        attemptCount: { lt: maximumAttempts },
        deadlineAt: { gt: new Date() },
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PUBLISHING", lockedAt: { lte: new Date(Date.now() - leaseMs) } },
          { status: "PUBLISHING", lockedAt: null },
        ],
      },
      data: {
        status: "PUBLISHING",
        attemptCount: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: lockId,
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return;
    const event = await this.prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: eventId } });
    const payload = event.payload as Record<string, Prisma.JsonValue>;
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.knowledgeV2EvaluationRun.updateMany({
          where: {
            id: runId,
            tenantId: event.tenantId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: { status: "RUNNING", startedAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new TestRunExecutionError("TEST_RUN_CLAIM_INVALID", false);
        }
        const updatedJob = await tx.knowledgeJob.updateMany({
          where: {
            id: jobId,
            tenantId: event.tenantId,
            status: { in: ["QUEUED", "RETRY_SCHEDULED", "RUNNING"] },
            deadlineAt: { gt: new Date() },
          },
          data: {
            status: "RUNNING",
            attemptCount: { increment: 1 },
            startedAt: new Date(),
            heartbeatAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
        if (updatedJob.count !== 1) {
          throw new TestRunExecutionError("TEST_RUN_JOB_CLAIM_INVALID", false);
        }
        const job = await tx.knowledgeJob.findFirstOrThrow({
          where: { id: jobId, tenantId: event.tenantId },
          select: { attemptCount: true },
        });
        await tx.knowledgeJobAttempt.create({
          data: {
            tenantId: event.tenantId,
            jobId,
            attempt: job.attemptCount,
            status: "RUNNING",
            workerId: lockId,
            heartbeatAt: new Date(),
          },
        });
        return tx.knowledgeV2EvaluationRun.findFirstOrThrow({
          where: { id: runId, tenantId: event.tenantId },
        });
      });
      const storedConfig = await this.readJson<StoredEvaluationConfig>(
        run.restrictedConfigRef,
        run.configHash,
        "TEST_RUN_CONFIG_HASH_MISMATCH",
      );
      await this.executeEvaluationCases({ event, jobId, lockId, run, config: storedConfig });
      return;
    } catch (error) {
      await this.failEvent(event, lockId, runId, jobId, error);
    }
  }

  private async executeEvaluationCases(input: {
    event: { id: string; tenantId: string; attemptCount: number };
    jobId: string;
    lockId: string;
    run: KnowledgeV2EvaluationRun;
    config: StoredEvaluationConfig;
  }) {
    const { event, jobId, lockId, run } = input;
    const membership = await this.currentMembership(run.tenantId, run.requestedByUserId);
    if (!membership || membership.role !== input.config.requestedRole) {
      throw new TestRunExecutionError("TEST_RUN_REQUESTER_REVOKED", false);
    }
    const storedVersion = (input.config as { version?: unknown }).version;
    if (storedVersion !== 3 && storedVersion !== 4) {
      throw new TestRunExecutionError("TEST_RUN_CONFIG_HASH_MISMATCH", false);
    }
    if (
      (input.config.version === 3 && !this.runQueryMetadataMatches(run, input.config)) ||
      (input.config.version === 4 &&
        (run.queryHash !== null || run.queryHashKeyId !== null || run.queryHashVersion !== null))
    ) {
      throw new TestRunExecutionError("TEST_RUN_QUERY_HASH_MISMATCH", false);
    }
    let batchConfig: StoredBatchRunConfig | null;
    let configs: StoredRunConfig[];
    if (input.config.version === 4) {
      const currentBatch = input.config;
      batchConfig = currentBatch;
      configs = currentBatch.testCases.map(
        (item): StoredRunConfig => ({
          version: 3,
          target: currentBatch.target,
          testCaseId: item.testCaseId,
          testCaseVersionId: item.testCaseVersionId,
          testCaseVersionHash: item.testCaseVersionHash,
          queryHash: item.queryHash,
          queryHashKeyId: item.queryHashKeyId,
          queryHashVersion: item.queryHashVersion,
          validationId: currentBatch.validationId,
          indexSnapshotId: currentBatch.indexSnapshotId,
          queryClassification: item.queryClassification,
          requestedRole: currentBatch.requestedRole,
          testCaseRiskLevel: item.testCaseRiskLevel,
          testCaseCritical: item.critical,
          targetMetadata: currentBatch.targetMetadata,
          context: item.context,
        }),
      );
    } else {
      batchConfig = null;
      configs = [input.config];
    }
    if (batchConfig) {
      await this.assertCurrentBatchCases(run.tenantId, run.testCaseSetHash, batchConfig.testCases);
    }
    for (const config of configs) {
      if (!this.runtimeAccessAllowed(membership.role, run.snapshotKind, config)) {
        throw new TestRunExecutionError("TEST_RUN_PERMISSION_DENIED", false);
      }
      await this.executeEvaluationCase({
        event,
        jobId,
        lockId,
        run,
        config,
        membershipRole: membership.role,
      });
      await this.heartbeatLease(event, jobId, lockId);
    }
    if (batchConfig) {
      await this.assertCurrentBatchCases(run.tenantId, run.testCaseSetHash, batchConfig.testCases);
    }
    const targetConfig = configs[0] ?? this.emptyBatchTargetConfig(batchConfig!);
    await this.prisma.$transaction(async (tx) => {
      const currentMembership = await tx.membership.findFirst({
        where: {
          tenantId: run.tenantId,
          userId: run.requestedByUserId ?? "__revoked__",
          role: membership.role,
          user: { deletedAt: null },
          tenant: { deletedAt: null },
        },
        select: { role: true },
      });
      if (!currentMembership) throw new TestRunExecutionError("TEST_RUN_REQUESTER_REVOKED", false);
      if (!batchConfig && targetConfig.testCaseVersionId) {
        const currentCase = await tx.knowledgeV2TestCase.findFirst({
          where: {
            tenantId: run.tenantId,
            id: targetConfig.testCaseId ?? "__missing__",
            status: "ACTIVE",
            currentVersionId: targetConfig.testCaseVersionId,
            currentVersion: { immutableHash: targetConfig.testCaseVersionHash ?? "__missing__" },
          },
          select: { id: true },
        });
        if (!currentCase) throw new TestRunExecutionError("TEST_CASE_VERSION_REVOKED", false);
      }
      await this.assertExactTarget(tx, run, targetConfig);
      if (batchConfig) {
        await this.assertCurrentBatchCases(
          run.tenantId,
          run.testCaseSetHash,
          batchConfig.testCases,
          tx,
        );
      }
      const results = await tx.knowledgeV2EvaluationResult.findMany({
        where: { tenantId: run.tenantId, evaluationRunId: run.id },
        select: {
          status: true,
          provider: true,
          generatorModel: true,
          modelProcessorPolicyHash: true,
          testCaseVersionId: true,
          metricManifestHash: true,
          providerOutputHash: true,
          gateInputHash: true,
          gateResultHash: true,
        },
        orderBy: [{ testCaseVersionId: "asc" }, { id: "asc" }],
      });
      if (results.length !== configs.length) {
        throw new TestRunExecutionError("TEST_RUN_DEPENDENCY_FAILED", true);
      }
      const completedRun = await tx.knowledgeV2EvaluationRun.updateMany({
        where: { id: run.id, tenantId: run.tenantId, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          provider: results.find((item) => item.provider)?.provider ?? run.provider,
          generatorModel:
            results.find((item) => item.generatorModel)?.generatorModel ?? run.generatorModel,
          modelProcessorPolicyHash:
            results.find((item) => item.modelProcessorPolicyHash)?.modelProcessorPolicyHash ?? null,
          completedAt: new Date(),
        },
      });
      const completedJob = await tx.knowledgeJob.updateMany({
        where: { id: jobId, tenantId: run.tenantId, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          progressCompleted: configs.length,
          progressTotal: configs.length,
          completedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      const completedAttempt = await tx.knowledgeJobAttempt.updateMany({
        where: { jobId, status: "RUNNING", workerId: lockId },
        data: { status: "SUCCEEDED", completedAt: new Date() },
      });
      const completedEvent = await tx.knowledgeOutbox.updateMany({
        where: { id: event.id, status: "PUBLISHING", lockedBy: lockId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (
        completedRun.count !== 1 ||
        completedJob.count !== 1 ||
        completedAttempt.count !== 1 ||
        completedEvent.count !== 1
      ) {
        throw new TestRunExecutionError("TEST_RUN_CLAIM_INVALID", false);
      }
      const aggregate = {
        total: results.length,
        passed: results.filter((item) => item.status === "PASSED").length,
        failed: results.filter((item) => item.status === "FAILED").length,
        warning: results.filter((item) => item.status === "WARNING").length,
        error: results.filter((item) => item.status === "ERROR").length,
        skipped: results.filter((item) => item.status === "SKIPPED").length,
      };
      await tx.auditLog.create({
        data: {
          tenantId: run.tenantId,
          actorUserId: run.requestedByUserId,
          action:
            run.runKind === "PLAYGROUND"
              ? "knowledge.v2.test_run.completed"
              : "knowledge.v2.evaluation_run.completed",
          entityType: "knowledge_v2",
          entityId: run.id,
          payload: {
            runId: run.id,
            testCaseSetHash: run.testCaseSetHash,
            queryHashKeyId: run.queryHashKeyId,
            queryHashVersion: run.queryHashVersion,
            ...(run.runKind === "PLAYGROUND"
              ? {
                  providerOutputHash: results[0]?.providerOutputHash ?? null,
                  gateInputHash: results[0]?.gateInputHash ?? null,
                  gateResultHash: results[0]?.gateResultHash ?? null,
                }
              : {}),
            aggregate,
            aggregateHash: canonicalKnowledgeV2Hash({
              testCaseSetHash: run.testCaseSetHash,
              results: results.map((item) => ({
                testCaseVersionId: item.testCaseVersionId,
                status: item.status,
                metricManifestHash: item.metricManifestHash,
              })),
            }),
          },
        },
      });
    });
  }

  private async assertCurrentBatchCases(
    tenantId: string,
    expectedHash: string,
    captured: readonly StoredBatchCaseConfig[],
    transaction?: Prisma.TransactionClient,
  ) {
    const database = transaction ?? this.prisma;
    const rows = await database.knowledgeV2TestCase.findMany({
      where: {
        tenantId,
        corpusKind: "STRUCTURED_V2",
        status: "ACTIVE",
        currentVersionId: { not: null },
      },
      include: { currentVersion: true },
      orderBy: [{ caseKey: "asc" }, { id: "asc" }],
      take: 501,
    });
    const current = rows.flatMap((item) =>
      item.currentVersion
        ? [
            {
              testCaseId: item.id,
              testCaseVersionId: item.currentVersion.id,
              immutableHash: item.currentVersion.immutableHash,
              queryHash: item.currentVersion.queryHash,
              queryHashKeyId: item.currentVersion.queryHashKeyId,
              queryHashVersion: item.currentVersion.queryHashVersion,
            },
          ]
        : [],
    );
    const capturedSet = captured.map((item) => ({
      testCaseId: item.testCaseId,
      testCaseVersionId: item.testCaseVersionId,
      immutableHash: item.testCaseVersionHash,
      queryHash: item.queryHash,
      queryHashKeyId: item.queryHashKeyId,
      queryHashVersion: item.queryHashVersion,
    }));
    if (
      rows.length > 500 ||
      current.length !== rows.length ||
      canonicalKnowledgeV2Hash(current) !== expectedHash ||
      canonicalKnowledgeV2Hash(capturedSet) !== expectedHash
    ) {
      throw new TestRunExecutionError("TEST_CASE_VERSION_REVOKED", false);
    }
  }

  private emptyBatchTargetConfig(config: StoredBatchRunConfig): StoredRunConfig {
    return {
      version: 3,
      target: config.target,
      testCaseId: null,
      testCaseVersionId: null,
      testCaseVersionHash: null,
      queryHash: null,
      queryHashKeyId: null,
      queryHashVersion: null,
      validationId: config.validationId,
      indexSnapshotId: config.indexSnapshotId,
      queryClassification: "PUBLIC",
      requestedRole: config.requestedRole,
      testCaseRiskLevel: null,
      testCaseCritical: false,
      targetMetadata: config.targetMetadata,
      context: {
        locale: "en",
        channelType: "WEBSITE",
        audience: "PUBLIC",
        scope: {
          usesTenantDefault: true,
          brandIds: [],
          locationIds: [],
          channelTypes: [],
          assistantIds: [],
          audiences: [],
          segments: [],
          locales: [],
        },
      },
    };
  }

  private async executeEvaluationCase(input: {
    event: { id: string; tenantId: string; attemptCount: number };
    jobId: string;
    lockId: string;
    run: KnowledgeV2EvaluationRun;
    config: StoredRunConfig;
    membershipRole: MembershipRole;
  }) {
    const { event, jobId, lockId, run, config, membershipRole } = input;
    const resultKey = canonicalKnowledgeV2Hash({
      runId: run.id,
      testCaseVersionId: config.testCaseVersionId,
      repeatIndex: 0,
    });
    const existing = await this.prisma.knowledgeV2EvaluationResult.findUnique({
      where: { tenantId_resultKey: { tenantId: run.tenantId, resultKey } },
      select: {
        status: true,
        provider: true,
        generatorModel: true,
        modelProcessorPolicyHash: true,
      },
    });
    if (existing) return existing;
    const expected = config.testCaseVersionId
      ? await this.prisma.knowledgeV2TestCaseVersion.findFirst({
          where: {
            id: config.testCaseVersionId,
            tenantId: run.tenantId,
            testCaseId: config.testCaseId ?? "__missing__",
            corpusKind: "STRUCTURED_V2",
          },
          include: evaluationTestCaseInclude,
        })
      : null;
    if (config.testCaseVersionId && !expected) {
      throw new TestRunExecutionError("TEST_CASE_VERSION_REVOKED", false);
    }
    if (
      expected &&
      (expected.immutableHash !== config.testCaseVersionHash ||
        expected.testCase.status !== "ACTIVE" ||
        expected.testCase.currentVersionId !== expected.id ||
        !this.savedCaseMatchesConfig(expected, config))
    ) {
      throw new TestRunExecutionError("TEST_CASE_VERSION_REVOKED", false);
    }
    await this.assertExactTarget(this.prisma, run, config);
    await this.heartbeatLease(event, jobId, lockId);
    const runtimeInput = expected
      ? await this.tests.getTestCaseRuntimeInput(run.tenantId, expected.testCaseId, expected.id)
      : null;
    const queryBinding = runtimeInput?.queryHashBinding ?? this.storedTestQueryBinding(run);
    const question = runtimeInput
      ? runtimeInput.question
      : await this.readText(run.restrictedInputRef!);
    const configBinding =
      config.queryHash === null
        ? null
        : parseKnowledgeV2QueryHashBinding({
            hash: config.queryHash,
            keyId: config.queryHashKeyId,
            version: config.queryHashVersion,
          });
    if (
      !queryBinding ||
      !configBinding ||
      !equalKnowledgeV2QueryHashBindings(queryBinding, configBinding) ||
      (runtimeInput === null &&
        !this.queryHashes.verify({
          tenantId: run.tenantId,
          purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
          value: question,
          binding: queryBinding,
        }))
    ) {
      throw new TestRunExecutionError("TEST_RUN_QUERY_HASH_MISMATCH", false);
    }
    const authorization = this.authorization(
      config.context,
      membershipRole,
      config.queryClassification,
    );
    const retrieval =
      run.snapshotKind === "PUBLICATION"
        ? await this.runtime.retrieve({
            tenantId: run.tenantId,
            publicationId: run.publicationId!,
            query: question,
            limit: 4,
            graphVersion: run.graphVersion,
            authorization,
          })
        : await this.runtime.retrieveDraft({
            tenantId: run.tenantId,
            validationId: config.validationId!,
            indexSnapshotId: config.indexSnapshotId,
            candidateId: run.candidateId!,
            candidateVersion: run.candidateVersion!,
            candidateManifestHash: run.candidateManifestHash,
            query: question,
            authorization,
            graphVersion: run.graphVersion,
          });
    if (retrieval.status === "unavailable") {
      if (retrieval.traceDraft) {
        await this.runtime.cleanupTraceArtifacts({ draft: retrieval.traceDraft });
      }
      throw new TestRunExecutionError("TEST_RUN_RETRIEVAL_UNAVAILABLE", retrieval.retryable);
    }
    if (!retrieval.traceDraft) {
      throw new TestRunExecutionError("TEST_RUN_TRACE_UNAVAILABLE", true);
    }
    if (
      !this.queryHashes.verify({
        tenantId: run.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
        value: question,
        binding: retrieval.traceDraft.queryHash,
      })
    ) {
      await this.runtime.cleanupTraceArtifacts({ draft: retrieval.traceDraft });
      throw new TestRunExecutionError("TEST_RUN_QUERY_HASH_MISMATCH", false);
    }
    const groundedAnswer = await this.grounded.answer({
      tenantId: run.tenantId,
      locale: config.context.locale,
      question,
      queryClassification: config.queryClassification,
      promptPolicyVersion: run.promptPolicyVersion,
      bundle: retrieval.bundle,
      now: new Date().toISOString(),
    });
    const citations =
      groundedAnswer.disposition === "AUTO_SEND"
        ? groundedAnswer.citations.map((citation) => ({
            evidenceKey: citation.evidenceKey,
            claimHash: citation.claimHash,
            ordinal: citation.ordinal,
            confidence: null,
            support: "SUPPORTS" as const,
          }))
        : [];
    const bundle: KnowledgeEvidenceBundle = {
      ...retrieval.bundle,
      outcome:
        groundedAnswer.disposition === "AUTO_SEND"
          ? "ANSWERED"
          : retrieval.bundle.outcome === "ABSTAINED"
            ? "ABSTAINED"
            : "HANDED_OFF",
      gateOutcome: groundedAnswer.disposition === "AUTO_SEND" ? "AUTO_SEND" : "HANDOFF",
      citations,
    };
    const traceDraft = {
      ...retrieval.traceDraft,
      promptPolicyVersion: groundedAnswer.promptPolicyVersion,
      provider: groundedAnswer.provider,
      generatorModel: groundedAnswer.model,
      modelProcessorPolicyHash: groundedAnswer.processorPolicyHash,
      providerOutputHash: groundedAnswer.providerOutputHash,
      gateInputHash: groundedAnswer.gateInputHash,
      gateResultHash: groundedAnswer.gateResultHash,
      outcome: bundle.outcome,
      gateOutcome: bundle.gateOutcome,
      citations,
    };
    const rawResult = knowledgeV2TestRunResultFromBundle(bundle, groundedAnswer);
    rawResult.latencyMs = retrieval.diagnostics.durationMs;
    const storedOutput: StoredRunOutput = {
      version: 1,
      context: config.context,
      result: rawResult,
    };
    let preparedTrace: Awaited<ReturnType<KnowledgeRuntimeRetriever["prepareTrace"]>> | null = null;
    let storedResult: { reference: string; hash: string; created: boolean } | null = null;
    try {
      const liveMembership = await this.currentMembership(run.tenantId, run.requestedByUserId);
      if (
        !liveMembership ||
        liveMembership.role !== membershipRole ||
        !this.runtimeAccessAllowed(liveMembership.role, run.snapshotKind, config)
      ) {
        throw new TestRunExecutionError("TEST_RUN_REQUESTER_REVOKED", false);
      }
      await this.assertExactTarget(this.prisma, run, config);
      const precommit = await this.runtime.revalidateEvidence({
        tenantId: run.tenantId,
        query: question,
        bundle,
        authorization,
      });
      if (!precommit.valid) throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
      if (
        !(await this.grounded.revalidateProcessor(
          {
            tenantId: run.tenantId,
            locale: config.context.locale,
            question,
            queryClassification: config.queryClassification,
            promptPolicyVersion: run.promptPolicyVersion,
            bundle,
            now: new Date().toISOString(),
          },
          groundedAnswer,
        ))
      ) {
        throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
      }
      await this.heartbeatLease(event, jobId, lockId);
      const serialized = JSON.stringify(storedOutput);
      const stored = await this.storeRestricted(
        run.tenantId,
        `${run.id}:${config.testCaseVersionId ?? "adhoc"}:result`,
        serialized,
      );
      const currentStoredResult = { ...stored, hash: sha256(serialized) };
      storedResult = currentStoredResult;
      const currentPreparedTrace = await this.runtime.prepareTrace({
        tenantId: run.tenantId,
        draft: traceDraft,
        finalAnswer: groundedAnswer.finalText,
      });
      preparedTrace = currentPreparedTrace;
      const answerHash = groundedAnswer.finalText ? sha256(groundedAnswer.finalText) : null;
      if ((currentPreparedTrace.answerHash ?? null) !== answerHash) {
        throw new TestRunExecutionError("TEST_RUN_RESULT_HASH_MISMATCH", false);
      }
      const expectationChecks = expected
        ? await this.evaluateExpectations(run.tenantId, bundle, expected, [
            ...new Map(
              groundedAnswer.citations.map((citation) => [
                citation.claimId,
                { claimId: citation.claimId, claimHash: citation.claimHash },
              ]),
            ).values(),
          ])
        : [];
      const observed = observedResultBehavior(rawResult);
      const status =
        (!expected || expected.expectedBehavior === observed) &&
        expectationChecks.every((check) => check.passed)
          ? ("PASSED" as const)
          : ("FAILED" as const);
      const evidenceKeys = this.evidenceManifest(bundle);
      const persisted = await this.prisma.$transaction(async (tx) => {
        const fencedEvent = await tx.knowledgeOutbox.updateMany({
          where: {
            id: event.id,
            status: "PUBLISHING",
            lockedBy: lockId,
            deadlineAt: { gt: new Date() },
          },
          data: { lockedAt: new Date() },
        });
        const fencedRun = await tx.knowledgeV2EvaluationRun.updateMany({
          where: { id: run.id, tenantId: run.tenantId, status: "RUNNING" },
          data: { status: "RUNNING" },
        });
        if (fencedEvent.count !== 1 || fencedRun.count !== 1) {
          throw new TestRunExecutionError("TEST_RUN_CLAIM_INVALID", false);
        }
        const currentMembership = await tx.membership.findFirst({
          where: {
            tenantId: run.tenantId,
            userId: run.requestedByUserId ?? "__revoked__",
            role: membershipRole,
            user: { deletedAt: null },
            tenant: { deletedAt: null },
          },
          select: { role: true },
        });
        if (
          !currentMembership ||
          !this.runtimeAccessAllowed(currentMembership.role, run.snapshotKind, config)
        ) {
          throw new TestRunExecutionError("TEST_RUN_REQUESTER_REVOKED", false);
        }
        if (expected) {
          const currentCase = await tx.knowledgeV2TestCase.findFirst({
            where: {
              tenantId: run.tenantId,
              id: expected.testCaseId,
              status: "ACTIVE",
              currentVersionId: expected.id,
            },
            select: { id: true },
          });
          if (!currentCase) throw new TestRunExecutionError("TEST_CASE_VERSION_REVOKED", false);
        }
        await this.assertExactTarget(tx, run, config);
        const finalRevalidation = await this.runtime.revalidateEvidence({
          tenantId: run.tenantId,
          query: question,
          bundle,
          authorization,
          transaction: tx,
        });
        if (
          !finalRevalidation.valid ||
          finalRevalidation.evidenceManifestHash !== precommit.evidenceManifestHash
        ) {
          throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
        }
        if (
          !(await this.grounded.revalidateProcessor(
            {
              tenantId: run.tenantId,
              locale: config.context.locale,
              question,
              queryClassification: config.queryClassification,
              promptPolicyVersion: run.promptPolicyVersion,
              bundle,
              now: new Date().toISOString(),
            },
            groundedAnswer,
            tx,
          ))
        ) {
          throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
        }
        const result = await tx.knowledgeV2EvaluationResult.create({
          data: {
            id: randomUUID(),
            tenantId: run.tenantId,
            corpusKind: "STRUCTURED_V2",
            resultKey,
            evaluationRunId: run.id,
            testCaseVersionId: config.testCaseVersionId,
            repeatIndex: 0,
            status,
            expectedBehavior: expected?.expectedBehavior ?? null,
            observedBehavior: observed,
            gateOutcome: bundle.gateOutcome,
            provider: groundedAnswer.provider,
            generatorModel: groundedAnswer.model,
            promptPolicyVersion: groundedAnswer.promptPolicyVersion,
            modelProcessorPolicyHash: groundedAnswer.processorPolicyHash,
            providerOutputHash: groundedAnswer.providerOutputHash,
            gateInputHash: groundedAnswer.gateInputHash,
            gateResultHash: groundedAnswer.gateResultHash,
            responseHash: currentPreparedTrace.answerHash ?? null,
            restrictedResultRef: currentStoredResult.reference,
            restrictedResultHash: currentStoredResult.hash,
            safeSummaryHash: canonicalKnowledgeV2Hash({
              outcome: bundle.outcome,
              gateOutcome: bundle.gateOutcome,
              providerOutputHash: groundedAnswer.providerOutputHash,
              gateResultHash: groundedAnswer.gateResultHash,
            }),
            metricManifestHash: canonicalKnowledgeV2Hash({
              expectationChecks,
              testCaseCritical: config.testCaseCritical ?? false,
              processorPolicyHash: groundedAnswer.processorPolicyHash,
              promptPolicyVersion: groundedAnswer.promptPolicyVersion,
              gateResultHash: groundedAnswer.gateResultHash,
            }),
            evidenceManifestHash: finalRevalidation.evidenceManifestHash,
            latencyMs: retrieval.diagnostics.durationMs,
          },
        });
        const trace = await this.runtime.persistTrace({
          tenantId: run.tenantId,
          prepared: currentPreparedTrace,
          bundle,
          binding: {
            evaluationRunId: run.id,
            evaluationResultId: result.id,
            distributedTraceId: `knowledge-test:${run.id}:${config.testCaseVersionId ?? "adhoc"}`,
          },
          transaction: tx,
        });
        const metricRows: Prisma.KnowledgeV2EvaluationMetricCreateManyInput[] =
          expectationChecks.map((check) => ({
            id: randomUUID(),
            tenantId: run.tenantId,
            corpusKind: "STRUCTURED_V2",
            evaluationResultId: result.id,
            metricKey: `expectation:${check.ordinal}`,
            category: check.category,
            value: check.passed ? 1 : 0,
            threshold: 1,
            comparator: "GREATER_THAN_OR_EQUAL",
            status: check.passed ? "PASSED" : "FAILED",
            sampleCount: 1,
          }));
        if (run.runKind !== "PLAYGROUND") {
          metricRows.push({
            id: randomUUID(),
            tenantId: run.tenantId,
            corpusKind: "STRUCTURED_V2",
            evaluationResultId: result.id,
            metricKey: "system:critical",
            category: "SYSTEM",
            value: config.testCaseCritical ? 1 : 0,
            threshold: 1,
            comparator: "EQUAL",
            status: "PASSED",
            sampleCount: 1,
          });
        }
        if (metricRows.length) {
          await tx.knowledgeV2EvaluationMetric.createMany({
            data: metricRows,
          });
        }
        const refs = await tx.knowledgeV2EvidenceReference.findMany({
          where: { tenantId: run.tenantId, evidenceKey: { in: evidenceKeys } },
          select: { id: true, evidenceKey: true },
        });
        const referenceByKey = new Map(refs.map((item) => [item.evidenceKey, item.id]));
        if (referenceByKey.size !== evidenceKeys.length) {
          throw new TestRunExecutionError("TEST_RUN_DEPENDENCY_FAILED", true);
        }
        if (evidenceKeys.length) {
          await tx.knowledgeV2EvaluationResultEvidence.createMany({
            data: evidenceKeys.map((evidenceKey, ordinal) => ({
              tenantId: run.tenantId,
              corpusKind: "STRUCTURED_V2" as const,
              evaluationResultId: result.id,
              evidenceReferenceId: referenceByKey.get(evidenceKey)!,
              ordinal,
            })),
          });
        }
        await tx.knowledgeJob.updateMany({
          where: { id: jobId, tenantId: run.tenantId, status: "RUNNING" },
          data: { progressCompleted: { increment: 1 }, heartbeatAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            tenantId: run.tenantId,
            actorUserId: run.requestedByUserId,
            action: "knowledge.v2.evaluation_case.completed",
            entityType: "knowledge_v2",
            entityId: run.id,
            payload: {
              resultId: result.id,
              testCaseVersionId: config.testCaseVersionId,
              status,
              retrievalTraceId: trace.id,
              gateResultHash: groundedAnswer.gateResultHash,
            },
          },
        });
        return {
          status,
          provider: groundedAnswer.provider,
          generatorModel: groundedAnswer.model,
          modelProcessorPolicyHash: groundedAnswer.processorPolicyHash,
        };
      });
      return persisted;
    } catch (error) {
      await this.runtime.cleanupTraceArtifacts({ draft: traceDraft, prepared: preparedTrace });
      if (storedResult?.created) {
        await this.deleteRestricted(storedResult.reference).catch(() => undefined);
      }
      throw error;
    }
  }

  private async failEvent(
    event: { id: string; tenantId: string; attemptCount: number },
    lockId: string,
    runId: string,
    jobId: string,
    error: unknown,
  ) {
    const failure = testRunFailure(error);
    const code = failure.code;
    const terminal = event.attemptCount >= maximumAttempts || !failure.retryable;
    await this.prisma.$transaction(async (tx) => {
      const fenced = await tx.knowledgeOutbox.updateMany({
        where: {
          id: event.id,
          tenantId: event.tenantId,
          status: "PUBLISHING",
          lockedBy: lockId,
          attemptCount: event.attemptCount,
        },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED",
          availableAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** event.attemptCount)),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: code,
        },
      });
      if (fenced.count !== 1) return;
      const job = await tx.knowledgeJob.updateMany({
        where: {
          id: jobId,
          tenantId: event.tenantId,
          status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED"] },
          attemptCount: { in: [event.attemptCount, Math.max(0, event.attemptCount - 1)] },
        },
        data: {
          status: terminal ? "DEAD_LETTER" : "RETRY_SCHEDULED",
          errorCode: code,
          errorMessage: null,
          availableAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** event.attemptCount)),
          ...(terminal ? { completedAt: new Date() } : {}),
        },
      });
      const attempt = await tx.knowledgeJobAttempt.updateMany({
        where: {
          jobId,
          attempt: event.attemptCount,
          status: "RUNNING",
          workerId: lockId,
        },
        data: {
          status: "FAILED",
          errorCode: code,
          completedAt: new Date(),
        },
      });
      if (job.count !== 1 || attempt.count > 1) {
        throw new TestRunExecutionError("TEST_RUN_JOB_CLAIM_INVALID", false);
      }
      if (terminal) {
        await tx.knowledgeV2EvaluationRun.updateMany({
          where: {
            id: runId,
            tenantId: event.tenantId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: { status: "FAILED", completedAt: new Date() },
        });
      }
    });
  }

  private async expireEvent(event: {
    id: string;
    tenantId: string;
    aggregateId: string;
    payload: Prisma.JsonValue;
  }) {
    const payload = event.payload as Record<string, Prisma.JsonValue>;
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.knowledgeOutbox.updateMany({
        where: {
          id: event.id,
          eventType,
          deadlineAt: { lte: new Date() },
          status: { in: ["PENDING", "FAILED", "PUBLISHING"] },
        },
        data: {
          status: "DEAD_LETTER",
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: "TEST_RUN_DEADLINE_EXPIRED",
        },
      });
      if (expired.count !== 1) return;
      const now = new Date();
      await tx.knowledgeV2EvaluationRun.updateMany({
        where: {
          id: event.aggregateId,
          tenantId: event.tenantId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "FAILED", startedAt: now, completedAt: now },
      });
      await tx.knowledgeJob.updateMany({
        where: { id: jobId, tenantId: event.tenantId },
        data: {
          status: "DEAD_LETTER",
          errorCode: "TEST_RUN_DEADLINE_EXPIRED",
          completedAt: now,
        },
      });
      await tx.knowledgeJobAttempt.updateMany({
        where: { jobId, status: "RUNNING" },
        data: {
          status: "TIMED_OUT",
          errorCode: "TEST_RUN_DEADLINE_EXPIRED",
          completedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: event.tenantId,
          action: "knowledge.v2.test_run.timed_out",
          entityType: "knowledge_v2",
          entityId: event.aggregateId,
          payload: {
            runId: event.aggregateId,
            errorCode: "TEST_RUN_DEADLINE_EXPIRED",
          },
        },
      });
    });
  }

  private async evaluateExpectations(
    tenantId: string,
    bundle: KnowledgeEvidenceBundle,
    version: EvaluationTestCaseVersion,
    validatedClaims: readonly { claimId: string; claimHash: string }[],
  ) {
    const evidenceIds = version.expectations.flatMap((item) =>
      item.evidenceReferenceId ? [item.evidenceReferenceId] : [],
    );
    const references =
      evidenceIds.length > 0
        ? await this.prisma.knowledgeV2EvidenceReference.findMany({
            where: { tenantId, id: { in: evidenceIds }, corpusKind: "STRUCTURED_V2" },
          })
        : [];
    const referenceById = new Map(references.map((item) => [item.id, item]));
    const toolKeys = new Set(
      bundle.liveToolResults.flatMap((item) => [item.toolCallId, item.safeName]),
    );
    const referenceMatches = (id: string | null) => {
      const reference = id ? referenceById.get(id) : null;
      if (!reference) return false;
      if (reference.targetType === "FACT_VERSION") {
        return bundle.facts.some(
          (item) =>
            item.versionId === reference.factVersionId &&
            item.versionHash === reference.itemVersionHash,
        );
      }
      if (reference.targetType === "GUIDANCE_RULE_VERSION") {
        return bundle.guidance.some(
          (item) =>
            item.versionId === reference.guidanceRuleVersionId &&
            item.versionHash === reference.itemVersionHash,
        );
      }
      if (reference.targetType === "DOCUMENT_REVISION") {
        return bundle.documents.some(
          (item) =>
            item.kind === "DOCUMENT" &&
            item.revisionId === reference.v2DocumentRevisionId &&
            item.revisionHash === reference.itemVersionHash,
        );
      }
      return false;
    };
    return version.expectations.map((expectation) => {
      const matchingFacts = bundle.facts.filter(
        (item) => !expectation.factId || item.factId === expectation.factId,
      );
      const matchingGuidance = bundle.guidance.filter(
        (item) => !expectation.guidanceRuleId || item.guidanceRuleId === expectation.guidanceRuleId,
      );
      const expectedValueMatches = expectation.expectedValueHash
        ? [
            ...matchingFacts.map((item) => item.value),
            ...matchingGuidance.map((item) => item.instruction),
          ].some((value) => sha256(value) === expectation.expectedValueHash)
        : true;
      let passed = false;
      if (expectation.kind === "REQUIRED_FACT") {
        passed = matchingFacts.length > 0 && expectedValueMatches;
      } else if (expectation.kind === "FORBIDDEN_FACT") {
        passed = matchingFacts.length === 0;
      } else if (expectation.kind === "REQUIRED_GUIDANCE") {
        passed = matchingGuidance.length > 0 && expectedValueMatches;
      } else if (expectation.kind === "FORBIDDEN_GUIDANCE") {
        passed = matchingGuidance.length === 0;
      } else if (expectation.kind === "REQUIRED_EVIDENCE") {
        passed = referenceMatches(expectation.evidenceReferenceId);
      } else if (expectation.kind === "FORBIDDEN_CLAIM") {
        passed = knowledgeV2ForbiddenClaimPasses({
          expectedValueHash: expectation.expectedValueHash,
          semanticKey: expectation.semanticKey,
          validatedClaims,
        });
      } else if (expectation.kind === "REQUIRED_TOOL") {
        passed = Boolean(expectation.semanticKey && toolKeys.has(expectation.semanticKey));
      } else if (expectation.kind === "FORBIDDEN_TOOL") {
        passed = !expectation.semanticKey || !toolKeys.has(expectation.semanticKey);
      }
      return {
        ordinal: expectation.ordinal,
        kind: expectation.kind,
        passed,
        critical: version.testCase.critical,
        category: expectation.kind.includes("TOOL")
          ? ("POLICY_TOOLS" as const)
          : expectation.kind === "FORBIDDEN_CLAIM"
            ? ("SECURITY" as const)
            : ("RETRIEVAL" as const),
      };
    });
  }

  private idempotencyRequest(tenantId: string, input: KnowledgeV2CreateTestRunRequest) {
    const scope = canonicalKnowledgeV2Scope(input.scope);
    const questionBinding = input.question
      ? this.queryHashes.hash({
          tenantId,
          purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
          value: input.question,
        })
      : null;
    return {
      target: input.target,
      testCaseId: input.testCaseId ?? null,
      questionHash: questionBinding?.hash ?? null,
      questionHashKeyId: questionBinding?.keyId ?? null,
      questionHashVersion: questionBinding?.version ?? null,
      locale: canonicalKnowledgeV2Locale(input.locale),
      channelType: input.channelType,
      audience: input.audience,
      scope: knowledgeV2ScopeView(scope as unknown as Prisma.JsonValue),
      candidateId: input.target === "DRAFT" ? input.candidateId : null,
      candidateVersion: input.target === "DRAFT" ? input.candidateVersion : null,
      candidateManifestHash: input.target === "DRAFT" ? input.candidateManifestHash : null,
    };
  }

  private runtimeAccessAllowed(
    role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER",
    target: "PUBLICATION" | "DRAFT_CANDIDATE" | "ACTIVE" | "DRAFT",
    config: Pick<StoredRunConfig, "context" | "testCaseRiskLevel">,
  ) {
    if (role === "OWNER" || role === "ADMIN") return true;
    return (
      role === "MANAGER" &&
      (target === "PUBLICATION" || target === "ACTIVE") &&
      config.context.audience === "PUBLIC" &&
      config.testCaseRiskLevel !== "HIGH" &&
      config.testCaseRiskLevel !== "CRITICAL"
    );
  }

  private assertRuntimeAccess(
    role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER",
    target: "ACTIVE" | "DRAFT",
    context: KnowledgeV2TestRunContextView,
    testCaseRiskLevel: KnowledgeV2RiskLevel | null,
  ) {
    if (this.runtimeAccessAllowed(role, target, { context, testCaseRiskLevel })) return;
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_TEST_RUN_SCOPE_DENIED",
      "This role cannot run the requested knowledge test.",
    );
  }

  private queryClassification(
    role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER",
    context: KnowledgeV2TestRunContextView,
    riskLevel: KnowledgeV2RiskLevel | null,
  ): KnowledgeV2SecurityClassification {
    if (riskLevel === null) return "CUSTOMER_PERSONAL";
    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") return "SENSITIVE";
    if (context.audience === "AUTHENTICATED_CUSTOMER") return "CUSTOMER_PERSONAL";
    if (context.audience === "INTERNAL" || role === "OWNER" || role === "ADMIN") {
      return "INTERNAL";
    }
    return "PUBLIC";
  }

  private storedTestQueryBinding(value: {
    queryHash: string | null;
    queryHashKeyId: string | null;
    queryHashVersion: string | null;
  }) {
    if (!value.queryHash) return null;
    return parseKnowledgeV2QueryHashBinding({
      hash: value.queryHash,
      keyId: value.queryHashKeyId,
      version: value.queryHashVersion,
    });
  }

  private runQueryMetadataMatches(
    run: Pick<KnowledgeV2EvaluationRun, "queryHash" | "queryHashKeyId" | "queryHashVersion">,
    config: Pick<StoredRunConfig, "queryHash" | "queryHashKeyId" | "queryHashVersion">,
  ) {
    const runBinding = this.storedTestQueryBinding(run);
    const configBinding =
      config.queryHash === null
        ? null
        : parseKnowledgeV2QueryHashBinding({
            hash: config.queryHash,
            keyId: config.queryHashKeyId,
            version: config.queryHashVersion,
          });
    return Boolean(
      runBinding && configBinding && equalKnowledgeV2QueryHashBindings(runBinding, configBinding),
    );
  }

  private async assertRunQueryMetadata(
    run: Pick<
      KnowledgeV2EvaluationRun,
      "tenantId" | "queryHash" | "queryHashKeyId" | "queryHashVersion" | "restrictedInputRef"
    >,
    config: Pick<StoredRunConfig, "queryHash" | "queryHashKeyId" | "queryHashVersion">,
  ) {
    const binding = this.storedTestQueryBinding(run);
    if (!this.runQueryMetadataMatches(run, config) || !binding || !run.restrictedInputRef) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
        "The test query integrity binding is unavailable.",
      );
    }
    let question: string;
    try {
      question = await this.readText(run.restrictedInputRef);
    } catch {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
        "The test query integrity binding is unavailable.",
      );
    }
    if (
      !this.queryHashes.verify({
        tenantId: run.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
        value: question,
        binding,
      })
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
        "The test query integrity binding is unavailable.",
      );
    }
  }

  private savedCaseMatchesConfig(version: EvaluationTestCaseVersion, config: StoredRunConfig) {
    const authoritativeContext: KnowledgeV2TestRunContextView = {
      locale: canonicalKnowledgeV2Locale(version.locale),
      channelType: version.channelType,
      audience: version.audience,
      scope: knowledgeV2ScopeView(version.scope),
    };
    const versionQueryBinding = this.storedTestQueryBinding(version);
    const configQueryBinding =
      config.queryHash === null
        ? null
        : parseKnowledgeV2QueryHashBinding({
            hash: config.queryHash,
            keyId: config.queryHashKeyId,
            version: config.queryHashVersion,
          });
    return (
      Boolean(
        versionQueryBinding &&
        configQueryBinding &&
        equalKnowledgeV2QueryHashBindings(versionQueryBinding, configQueryBinding),
      ) &&
      canonicalKnowledgeV2Hash(authoritativeContext) === canonicalKnowledgeV2Hash(config.context) &&
      version.riskLevel === config.testCaseRiskLevel &&
      this.queryClassification(config.requestedRole, authoritativeContext, version.riskLevel) ===
        config.queryClassification
    );
  }

  private evidenceManifest(bundle: KnowledgeEvidenceBundle) {
    return [
      ...new Set([
        ...bundle.facts.map((item) => item.evidenceKey),
        ...bundle.guidance.map((item) => item.evidenceKey),
        ...bundle.documents.map((item) => item.evidenceKey),
        ...bundle.liveToolResults.map((item) => `v2:tool:${item.toolCallId}:${item.contentHash}`),
      ]),
    ].sort(compareKnowledgeCanonicalText);
  }

  private jsonRecord(value: Prisma.JsonValue | null | undefined) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private authorization(
    context: KnowledgeV2TestRunContextView,
    role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER",
    queryClassification: KnowledgeV2SecurityClassification,
  ): KnowledgeRuntimeAuthorizationContext {
    const classifications: KnowledgeRuntimeAuthorizationContext["classifications"] =
      context.audience === "PUBLIC"
        ? ["PUBLIC"]
        : context.audience === "AUTHENTICATED_CUSTOMER" && (role === "OWNER" || role === "ADMIN")
          ? ["PUBLIC", "CUSTOMER_PERSONAL"]
          : role === "OWNER" || role === "ADMIN"
            ? ["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE"]
            : ["PUBLIC"];
    return {
      locale: context.locale,
      channelType: context.channelType,
      audience: context.audience,
      classifications,
      queryClassification,
      brandIds: context.scope.brandIds,
      locationIds: context.scope.locationIds,
      channelIds: context.scope.channelTypes,
      assistantIds: context.scope.assistantIds,
      segmentIds: context.scope.segments,
    };
  }

  private currentMembership(tenantId: string, userId: string | null) {
    if (!userId) return Promise.resolve(null);
    return this.prisma.membership.findFirst({
      where: {
        tenantId,
        userId,
        user: { deletedAt: null },
        tenant: { deletedAt: null },
      },
      select: { role: true },
    });
  }

  private async heartbeatLease(
    event: { id: string; tenantId: string; attemptCount: number },
    jobId: string,
    lockId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const heartbeat = new Date();
      const liveEvent = await tx.knowledgeOutbox.updateMany({
        where: {
          id: event.id,
          tenantId: event.tenantId,
          status: "PUBLISHING",
          lockedBy: lockId,
          attemptCount: event.attemptCount,
          deadlineAt: { gt: heartbeat },
        },
        data: { lockedAt: heartbeat },
      });
      if (liveEvent.count !== 1) {
        throw new TestRunExecutionError("TEST_RUN_DEADLINE_EXPIRED", false);
      }
      const liveJob = await tx.knowledgeJob.updateMany({
        where: {
          id: jobId,
          tenantId: event.tenantId,
          status: "RUNNING",
          attemptCount: event.attemptCount,
          deadlineAt: { gt: heartbeat },
        },
        data: { heartbeatAt: heartbeat },
      });
      const liveAttempt = await tx.knowledgeJobAttempt.updateMany({
        where: {
          jobId,
          attempt: event.attemptCount,
          status: "RUNNING",
          workerId: lockId,
        },
        data: { heartbeatAt: heartbeat },
      });
      if (liveJob.count !== 1 || liveAttempt.count !== 1) {
        throw new TestRunExecutionError("TEST_RUN_JOB_CLAIM_INVALID", false);
      }
    });
  }

  private async assertExactTarget(
    tx: Prisma.TransactionClient,
    run: {
      tenantId: string;
      snapshotKind: "PUBLICATION" | "DRAFT_CANDIDATE";
      publicationId: string | null;
      candidateId: string | null;
      candidateVersion: number | null;
      candidateManifestHash: string | null;
    },
    config: StoredRunConfig,
  ) {
    if (run.snapshotKind === "PUBLICATION") {
      const publication = await tx.knowledgePublication.findFirst({
        where: {
          id: run.publicationId ?? "__missing__",
          tenantId: run.tenantId,
          targetKey: "workspace-v2",
          corpusKind: "STRUCTURED_V2",
          status: { in: ["ACTIVE", "SUPERSEDED", "ROLLED_BACK"] },
          manifestHash: config.targetMetadata.publicationManifestHash ?? "__missing__",
          indexSnapshotId: config.indexSnapshotId,
        },
        include: {
          items: { select: { itemType: true } },
          indexSnapshot: { include: { v2Items: true } },
        },
      });
      const hasDocuments =
        publication?.items.some((item) => item.itemType === "DOCUMENT_REVISION") ?? false;
      if (
        !publication ||
        (hasDocuments &&
          (!publication.indexSnapshot ||
            publication.indexSnapshot.status !== "READY" ||
            publication.indexSnapshot.deletedAt !== null ||
            publication.indexSnapshot.expectedPointCount !==
              publication.indexSnapshot.observedPointCount ||
            publication.indexSnapshot.expectedPointCount !==
              publication.indexSnapshot.v2Items.length)) ||
        (!hasDocuments && publication.indexSnapshot)
      ) {
        throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
      }
      const metadata = await this.targetMetadata(
        tx,
        run.tenantId,
        hasDocuments ? publication.indexSnapshot : null,
      );
      if (
        canonicalKnowledgeV2Hash({
          ...metadata,
          publicationManifestHash: publication.manifestHash,
        }) !== canonicalKnowledgeV2Hash(config.targetMetadata)
      ) {
        throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
      }
      return;
    }
    if (!config.validationId) {
      throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
    }
    const validation = await tx.knowledgeV2PublicationValidation.findFirst({
      where: {
        id: config.validationId,
        tenantId: run.tenantId,
        corpusKind: "STRUCTURED_V2",
        targetKey: "workspace-v2",
        candidateId: run.candidateId ?? "__missing__",
        candidateVersion: run.candidateVersion ?? -1,
        candidateManifestHash: run.candidateManifestHash ?? "__missing__",
        indexSnapshotId: config.indexSnapshotId,
        status: "PASSED",
        validUntil: { gt: new Date() },
      },
      include: { indexSnapshot: { include: { v2Items: true } } },
    });
    const hasDocuments = validation ? manifestHasDocuments(validation.candidateItems) : false;
    if (
      !validation ||
      (hasDocuments &&
        (!validation.indexSnapshot ||
          validation.indexSnapshot.status !== "READY" ||
          validation.indexSnapshot.deletedAt !== null ||
          validation.indexSnapshot.expectedPointCount !==
            validation.indexSnapshot.observedPointCount ||
          validation.indexSnapshot.expectedPointCount !==
            validation.indexSnapshot.v2Items.length)) ||
      (!hasDocuments && validation.indexSnapshot)
    ) {
      throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
    }
    const metadata = await this.targetMetadata(
      tx,
      run.tenantId,
      hasDocuments ? validation.indexSnapshot : null,
    );
    if (canonicalKnowledgeV2Hash(metadata) !== canonicalKnowledgeV2Hash(config.targetMetadata)) {
      throw new TestRunExecutionError("TEST_RUN_TARGET_REVOKED", false);
    }
  }

  private runView(
    context: RequestContext,
    run: {
      id: string;
      status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
      snapshotKind: "PUBLICATION" | "DRAFT_CANDIDATE";
      targetKey: string;
      publicationId: string | null;
      candidateId: string | null;
      candidateVersion: number | null;
      candidateManifestHash: string | null;
      requestedByUserId: string | null;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      updatedAt: Date;
    },
    config: StoredRunConfig,
    result: KnowledgeV2TestRunResultView | null,
    traceId: string | null,
    job: { status: string; errorCode: string | null } | null,
  ): KnowledgeV2TestRunView {
    const status = run.status;
    const progress =
      status === "QUEUED"
        ? { stage: "QUEUED" as const, percent: 0 }
        : status === "RUNNING"
          ? { stage: "CHECKING_KNOWLEDGE" as const, percent: 50 }
          : { stage: "COMPLETE" as const, percent: 100 };
    const actor: KnowledgeV2ActorView | null = run.requestedByUserId
      ? {
          id: run.requestedByUserId,
          displayName:
            run.requestedByUserId === context.userId
              ? context.user.name?.trim() || "Workspace member"
              : "Workspace member",
        }
      : null;
    return {
      id: run.id,
      status,
      target: run.snapshotKind === "PUBLICATION" ? "ACTIVE" : "DRAFT",
      testCaseId: config.testCaseId,
      hasRestrictedQuestion: true,
      context: config.context,
      targetKey: run.targetKey,
      publicationId: run.publicationId,
      candidateId: run.candidateId,
      candidateVersion: run.candidateVersion,
      candidateManifestHash: run.candidateManifestHash,
      progress,
      result: result ? { ...result, retrievalTraceId: traceId } : null,
      error: status === "FAILED" ? publicRunError(job?.errorCode) : null,
      requestedBy: actor,
      etag: strongKnowledgeV2Etag("test-run", run.id, run.updatedAt.toISOString()),
      pollAfterMs: status === "QUEUED" || status === "RUNNING" ? 1_000 : null,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private batchRunView(
    run: BatchEvaluationRunRecord,
    job: { status: string; errorCode: string | null } | null,
  ): KnowledgeV2BatchEvaluationRunView {
    if (run.runKind !== "MANUAL" && run.runKind !== "PUBLICATION") {
      throw new TestRunExecutionError("TEST_RUN_CONFIG_HASH_MISMATCH", false);
    }
    const runKind: KnowledgeV2BatchEvaluationRunKind = run.runKind;
    const aggregate = knowledgeV2EvaluationAggregate({
      testCaseSetHash: run.testCaseSetHash,
      results: run.results.map((result) => ({
        testCaseVersionId: result.testCaseVersionId!,
        status: result.status,
        metricManifestHash: result.metricManifestHash,
        locale: result.testCaseVersion?.locale ?? "und",
        riskLevel: result.testCaseVersion?.riskLevel ?? "LOW",
        critical: result.metrics.some(
          (metric) => metric.metricKey === "system:critical" && metric.value === 1,
        ),
      })),
    });
    return {
      id: run.id,
      corpusKind: "STRUCTURED_V2",
      runKey: run.runKey,
      runKind,
      status: run.status,
      snapshotKind: run.snapshotKind,
      target: run.snapshotKind === "PUBLICATION" ? "ACTIVE" : "DRAFT",
      targetKey: run.targetKey,
      publicationId: run.publicationId,
      candidateId: run.candidateId,
      candidateVersion: run.candidateVersion,
      candidateManifestHash: run.candidateManifestHash,
      datasetVersion: run.datasetVersion,
      testCaseSetHash: run.testCaseSetHash,
      configHash: run.configHash,
      hasRestrictedConfig: Boolean(run.restrictedConfigRef),
      versions: {
        parser: run.parserVersion,
        normalizer: run.normalizerVersion,
        chunker: run.chunkerVersion,
        embedding: run.embeddingVersion,
        sparse: run.sparseVersion,
        reranker: run.rerankerVersion,
        retrievalPolicy: run.retrievalPolicyVersion,
        promptPolicy: run.promptPolicyVersion,
        graph: run.graphVersion,
        generatorModel: run.generatorModel,
        judgeModel: run.judgeModel,
        judgePrompt: run.judgePromptVersion,
        codeCommit: run.codeCommit,
      },
      provider: run.provider,
      modelProcessorPolicyHash: run.modelProcessorPolicyHash,
      environment: run.environment,
      requestedBy: run.requestedBy
        ? {
            id: run.requestedBy.userId,
            displayName: run.requestedBy.user.name?.trim() || "Workspace member",
          }
        : null,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      cancelledAt: run.cancelledAt?.toISOString() ?? null,
      results: run.results.map((result) => ({
        id: result.id,
        resultKey: result.resultKey,
        evaluationRunId: result.evaluationRunId,
        testCaseVersionId: result.testCaseVersionId!,
        repeatIndex: result.repeatIndex,
        status: result.status,
        expectedBehavior: result.expectedBehavior!,
        observedBehavior: result.observedBehavior,
        gateOutcome: result.gateOutcome,
        provider: result.provider,
        generatorModel: result.generatorModel,
        promptPolicyVersion: result.promptPolicyVersion,
        modelProcessorPolicyHash: result.modelProcessorPolicyHash,
        providerOutputHash: result.providerOutputHash,
        gateInputHash: result.gateInputHash,
        gateResultHash: result.gateResultHash,
        responseHash: result.responseHash,
        restrictedResultHash: result.restrictedResultHash,
        safeSummaryHash: result.safeSummaryHash,
        metricManifestHash: result.metricManifestHash,
        evidenceManifestHash: result.evidenceManifestHash,
        errorCode: result.errorCode,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicros: result.costMicros?.toString() ?? null,
        hasRestrictedResult: Boolean(result.restrictedResultRef),
        metrics: result.metrics.map((metric) => ({
          id: metric.id,
          metricKey: metric.metricKey,
          category: metric.category,
          value: metric.value,
          numerator: metric.numerator,
          denominator: metric.denominator,
          unit: metric.unit,
          threshold: metric.threshold,
          comparator: metric.comparator,
          status: metric.status,
          sliceKey: metric.sliceKey,
          sampleCount: metric.sampleCount,
          confidenceLower: metric.confidenceLower,
          confidenceUpper: metric.confidenceUpper,
          createdAt: metric.createdAt.toISOString(),
        })),
        evidence: [],
        createdAt: result.createdAt.toISOString(),
      })),
      aggregate,
      etag: strongKnowledgeV2Etag("evaluation-run", run.id, run.updatedAt.toISOString()),
      pollAfterMs: run.status === "QUEUED" || run.status === "RUNNING" ? 1_000 : null,
      error: run.status === "FAILED" ? publicRunError(job?.errorCode) : null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private batchCaseSetHash(cases: readonly StoredBatchCaseConfig[]) {
    return canonicalKnowledgeV2Hash(
      cases.map((item) => ({
        testCaseId: item.testCaseId,
        testCaseVersionId: item.testCaseVersionId,
        immutableHash: item.testCaseVersionHash,
        queryHash: item.queryHash,
        queryHashKeyId: item.queryHashKeyId,
        queryHashVersion: item.queryHashVersion,
      })),
    );
  }

  private async jobsForRuns(tenantId: string, runIds: readonly string[]) {
    if (runIds.length === 0) return new Map<string, { status: string; errorCode: string | null }>();
    const jobs = await this.prisma.knowledgeJob.findMany({
      where: {
        tenantId,
        payloadRef: { in: runIds.map((id) => `evaluation-run:${id}`) },
      },
      select: { payloadRef: true, status: true, errorCode: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const byRun = new Map<string, { status: string; errorCode: string | null }>();
    for (const job of jobs) {
      const id = job.payloadRef?.startsWith("evaluation-run:")
        ? job.payloadRef.slice("evaluation-run:".length)
        : null;
      if (id && !byRun.has(id)) byRun.set(id, job);
    }
    return byRun;
  }

  private assertEvaluationWriter(context: RequestContext) {
    if (context.role === "OWNER" || context.role === "ADMIN") return;
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_EVALUATION_WRITE_DENIED",
      "Only owners and administrators can manage evaluation runs.",
    );
  }

  private async storeRestricted(tenantId: string, identity: string, value: string) {
    const bytes = new TextEncoder().encode(value);
    const { store, keyId } = this.restrictedStore();
    const key = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: "knowledge-v2-test-run",
      purpose: "raw",
      identity: `${keyId}:${identity}:${sha256(bytes)}`,
    });
    try {
      const stored = await store.put(key, bytes);
      return { reference: encodeReference(stored), created: true };
    } catch {
      try {
        const existing = await store.get(key, keyId);
        if (sha256(existing) !== sha256(bytes)) throw new Error("content conflict");
        return {
          reference: encodeReference({ key, encryptionKeyRef: keyId }),
          created: false,
        };
      } catch {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
          "Restricted test-run storage is unavailable.",
          { retryable: true },
        );
      }
    }
  }

  private async readText(
    reference: string,
    expectedHash?: string | null,
    mismatchCode: TestRunFailureCode = "TEST_RUN_QUERY_HASH_MISMATCH",
  ) {
    const decoded = decodeReference(reference);
    let text: string;
    try {
      const { store } = this.restrictedStore();
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await store.get(decoded.key, decoded.encryptionKeyRef),
      );
    } catch {
      throw new TestRunExecutionError("TEST_RUN_RESTRICTED_STORAGE_UNAVAILABLE", true);
    }
    if (expectedHash && sha256(text) !== expectedHash) {
      throw new TestRunExecutionError(mismatchCode, false);
    }
    return text;
  }

  private async readJson<T>(
    reference: string | null,
    expectedCanonicalHash?: string | null,
    mismatchCode: TestRunFailureCode = "TEST_RUN_CONFIG_HASH_MISMATCH",
  ) {
    if (!reference) {
      throw new TestRunExecutionError("TEST_RUN_RESTRICTED_STORAGE_UNAVAILABLE", true);
    }
    let parsed: T;
    try {
      parsed = JSON.parse(await this.readText(reference)) as T;
    } catch (error) {
      if (error instanceof TestRunExecutionError) throw error;
      throw new TestRunExecutionError("TEST_RUN_RESTRICTED_STORAGE_UNAVAILABLE", true);
    }
    if (expectedCanonicalHash && canonicalKnowledgeV2Hash(parsed) !== expectedCanonicalHash) {
      throw new TestRunExecutionError(mismatchCode, false);
    }
    return parsed;
  }

  private async readJsonSha256<T>(
    reference: string,
    expectedHash: string | null,
    mismatchCode: TestRunFailureCode,
  ) {
    if (!expectedHash) throw new TestRunExecutionError(mismatchCode, false);
    const text = await this.readText(reference, expectedHash, mismatchCode);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TestRunExecutionError(mismatchCode, false);
    }
  }

  private async deleteRestricted(reference: string) {
    const decoded = decodeReference(reference);
    const { store } = this.restrictedStore();
    await store.delete(decoded.key);
  }

  private restrictedStore() {
    if (
      !this.config.knowledgeObjectStorePath ||
      !this.config.knowledgeArtifactEncryptionKey ||
      !this.config.knowledgeArtifactEncryptionKeyId
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
        "Restricted test-run storage is unavailable.",
      );
    }
    return {
      keyId: this.config.knowledgeArtifactEncryptionKeyId,
      store: new EncryptedFileKnowledgeObjectStore({
        rootPath: this.config.knowledgeObjectStorePath,
        activeKey: {
          id: this.config.knowledgeArtifactEncryptionKeyId,
          key: decodeKnowledgeObjectEncryptionKey(this.config.knowledgeArtifactEncryptionKey),
        },
        maxPlaintextBytes: 256 * 1024,
      }),
    };
  }

  private assertCreateInput(context: RequestContext, input: KnowledgeV2CreateTestRunRequest) {
    if (Boolean(input.question) === Boolean(input.testCaseId)) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_RUN_INPUT_INVALID",
        "Provide exactly one question or test case.",
      );
    }
    if (
      input.target === "DRAFT" &&
      (!input.candidateId || !input.candidateVersion || !input.candidateManifestHash)
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_RUN_TARGET_INVALID",
        "An exact validated draft target is required.",
      );
    }
    if (
      context.role === "MANAGER" &&
      (input.target !== "ACTIVE" || (!input.testCaseId && input.audience !== "PUBLIC"))
    ) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_TEST_RUN_SCOPE_DENIED",
        "Managers can run active public knowledge tests only.",
      );
    }
  }

  private assertReader(context: RequestContext) {
    if (!new Set(["OWNER", "ADMIN", "MANAGER"]).has(context.role)) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ACTION_DENIED",
        "This role cannot run knowledge tests.",
      );
    }
  }

  private notFound() {
    return knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
      "The knowledge test run was not found.",
    );
  }
}
