import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
import {
  Prisma,
  type KnowledgeV2DeletionLedger,
  type KnowledgeV2DocumentRevision,
  type KnowledgeV2SecurityClassification,
  type KnowledgeV2Source,
  type PrismaClient,
} from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  createKnowledgeAcceptanceWebsiteFixture,
  createPinnedHttpsWebsiteSourceConnector,
  decodeKnowledgeObjectEncryptionKey,
  deterministicPointId,
  EncryptedFileKnowledgeObjectStore,
  estimateKnowledgeTokens,
  extractWebsiteContent,
  hashKnowledgeValue,
  KnowledgeV2HybridIndexError,
  KnowledgeV2HybridQdrantClient,
  KnowledgeObjectStoreError,
  knowledgeAcceptanceWebsiteFixtureEnabled,
  scanWebsiteContentSecurity,
  stableKnowledgeValue,
  WebsiteContentExtractionError,
  connectWebsiteSource,
  type AcquiredWebsiteSourceBody,
  type ExtractedWebsiteContent,
  type KnowledgeObjectStore,
  type KnowledgeV2IndexPermissionPartition,
  type WebsiteContentSecurityResult,
} from "@leadvirt/knowledge";
import type { KnowledgeSourceJobData } from "@leadvirt/runtime-queue";

const PIPELINE_VERSION = "knowledge-v2";
const INGESTION_STEPS = 6;
const MAX_CHUNK_CHARACTERS = 900;

export const knowledgeIngestionMessages = Object.freeze({
  KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED: "Knowledge source ingestion is not configured.",
  KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE: "Knowledge artifact storage is unavailable.",
  KNOWLEDGE_DEPENDENCY_VECTOR_CLEANUP_UNAVAILABLE: "Knowledge vector cleanup is unavailable.",
  KNOWLEDGE_DEPENDENCY_INDEXING_UNAVAILABLE: "Knowledge indexing is not configured.",
  KNOWLEDGE_DEPENDENCY_SOURCE_FETCH_FAILED: "The website could not be acquired securely.",
  KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED: "Knowledge ingestion was interrupted.",
  KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_EXPIRED:
    "The knowledge source event expired before processing.",
  KNOWLEDGE_DEPENDENCY_RUNTIME_EVENT_UNDELIVERABLE:
    "The knowledge source event could not be delivered.",
  KNOWLEDGE_SOURCE_RUNTIME_INVALID: "The knowledge source job is invalid.",
  KNOWLEDGE_SOURCE_NOT_AVAILABLE: "The knowledge source is not available.",
  KNOWLEDGE_SOURCE_KIND_UNSUPPORTED: "This source type cannot be ingested by this worker.",
  KNOWLEDGE_SOURCE_GENERATION_STALE: "The knowledge source job was superseded.",
  KNOWLEDGE_PERMISSION_ACTOR_NOT_AUTHORIZED:
    "The requesting user is no longer authorized to manage this source.",
  KNOWLEDGE_SECURITY_CONTENT_QUARANTINED: "The source content requires security review.",
  KNOWLEDGE_SECURITY_LEGAL_HOLD: "Knowledge artifacts on legal hold cannot be deleted.",
  KNOWLEDGE_PARSE_CONTENT_INVALID: "The website content could not be processed safely.",
  KNOWLEDGE_VALIDATION_JOB_INVALID: "The persisted knowledge job does not match its queue event.",
  KNOWLEDGE_VALIDATION_JOB_EXPIRED: "The knowledge source job expired.",
  KNOWLEDGE_VALIDATION_JOB_BUSY: "The knowledge source job is already running.",
  KNOWLEDGE_VALIDATION_ABORTED: "The knowledge source job was cancelled.",
} as const);

export type KnowledgeIngestionErrorCode = keyof typeof knowledgeIngestionMessages;
export type KnowledgeIngestionStage =
  | "ACQUIRING"
  | "SCANNING"
  | "PARSING"
  | "NORMALIZING"
  | "EXTRACTING"
  | "CHUNKING"
  | "INDEXING"
  | "EVALUATING"
  | "RECONCILING"
  | "CLEANING_UP";

export class KnowledgeIngestionError extends Error {
  constructor(
    readonly code: KnowledgeIngestionErrorCode,
    readonly retryable: boolean,
    readonly stage: KnowledgeIngestionStage,
  ) {
    super(knowledgeIngestionMessages[code]);
    this.name = "KnowledgeIngestionError";
  }
}

export class KnowledgeIngestionCrashError extends Error {
  constructor(readonly point: KnowledgeIngestionFailpoint) {
    super("Simulated knowledge ingestion interruption.");
    this.name = "KnowledgeIngestionCrashError";
  }
}

export type KnowledgeIngestionFailpoint = "AFTER_OBJECTS" | "AFTER_DATABASE_COMMIT";

export interface KnowledgeIngestionRuntimeData extends KnowledgeSourceJobData {
  runtimeEventId: string;
  runtimeGeneration: number;
}

export interface KnowledgeIngestionJobInput {
  id: string;
  name: string;
  data: KnowledgeIngestionRuntimeData;
  attemptsMade: number;
  maxAttempts: number;
  signal: AbortSignal;
}

export interface KnowledgeIngestionAcquisition {
  finalUrl: string;
  redirectCount: number;
  body: AcquiredWebsiteSourceBody;
}

export interface KnowledgeIngestionVectorCleaner {
  deletePoints(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    pointIds: string[];
  }): Promise<void>;
}

export interface KnowledgeIngestionDependencies {
  prisma: PrismaClient;
  objectStore: KnowledgeObjectStore | null;
  objectEncryptionKeyRef: string;
  websiteImportEnabled: boolean;
  websiteEgressReady: boolean;
  fileImportEnabled: boolean;
  objectStoreConfigured: boolean;
  pipelineVersion: string;
  maxWebsiteBytes: number;
  maxFileBytes: number;
  staleAttemptMs: number;
  workerId: string;
  acquireWebsite(url: string, signal: AbortSignal): Promise<KnowledgeIngestionAcquisition>;
  extractWebsite(body: AcquiredWebsiteSourceBody): Promise<ExtractedWebsiteContent>;
  scanWebsite(
    content: ExtractedWebsiteContent,
    classification: Extract<KnowledgeV2SecurityClassification, "PUBLIC" | "INTERNAL">,
  ): WebsiteContentSecurityResult;
  vectorCleaner?: KnowledgeIngestionVectorCleaner;
  invalidateCache?(tenantId: string, sourceId: string): Promise<void>;
  now(): Date;
  id(): string;
  failpoint?(point: KnowledgeIngestionFailpoint): void | Promise<void>;
}

export interface KnowledgeIngestionResult {
  status: "succeeded" | "unchanged" | "quarantined" | "cancelled" | "already_succeeded";
  operation: KnowledgeSourceJobData["operation"];
  stage: KnowledgeIngestionStage;
  revisionId?: string;
  documentId?: string;
  reason?: "stale_generation" | "terminal_replay";
}

interface RunningAttempt {
  tenantId: string;
  sourceId: string;
  knowledgeJobId: string;
  generation: number;
  operation: KnowledgeSourceJobData["operation"];
  requestedByUserId: string;
  attempt: number;
  attemptId: string;
  maxAttempts: number;
  deadlineAt: Date | null;
  revisionId: string | null;
  source: KnowledgeV2Source;
  stage: KnowledgeIngestionStage;
}

interface PreparedWebsiteContent {
  acquisition: KnowledgeIngestionAcquisition;
  extracted: ExtractedWebsiteContent;
  security: WebsiteContentSecurityResult;
  contentHash: string;
  locale: string;
  title: string;
  permissionFingerprint: string;
  existingArtifact?: {
    id: string;
    objectStorageKey: string;
    encryptionKeyRef: string;
    originalFilename: string;
    mimeType: string;
  };
}

interface PersistedWebsiteResult {
  status: "succeeded" | "quarantined" | "unchanged";
  revisionId?: string;
  documentId?: string;
  objectsReferenced: boolean;
  queryable: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value ?? "");
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDateString(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function isKnowledgeIngestionRuntimeData(
  value: Record<string, unknown>,
): value is KnowledgeIngestionRuntimeData & Record<string, unknown> {
  return (
    nonEmptyString(value.tenantId) &&
    nonEmptyString(value.sourceId) &&
    nonEmptyString(value.knowledgeJobId) &&
    nonEmptyString(value.requestedByUserId) &&
    validDateString(value.requestedAt) &&
    nonEmptyString(value.runtimeEventId) &&
    typeof value.generation === "number" &&
    Number.isInteger(value.generation) &&
    value.generation > 0 &&
    typeof value.runtimeGeneration === "number" &&
    Number.isInteger(value.runtimeGeneration) &&
    value.runtimeGeneration === value.generation &&
    ["IMPORT", "SYNC", "RECONCILE", "DELETE"].includes(String(value.operation))
  );
}

function operationStage(operation: KnowledgeSourceJobData["operation"]): KnowledgeIngestionStage {
  if (operation === "RECONCILE") return "RECONCILING";
  if (operation === "DELETE") return "CLEANING_UP";
  return "ACQUIRING";
}

function expectedJobName(operation: KnowledgeSourceJobData["operation"]) {
  return operation.toLowerCase();
}

function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalLocale(value: string | null | undefined, fallback: string) {
  for (const candidate of [value, fallback]) {
    if (!candidate) continue;
    try {
      const locale = Intl.getCanonicalLocales(candidate)[0];
      if (locale) return locale;
    } catch {
      continue;
    }
  }
  return "en";
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function stringArray(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sourceAudiences(source: Pick<KnowledgeV2Source, "defaultScope">) {
  return stringArray(jsonRecord(source.defaultScope).audiences).filter((value) =>
    ["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"].includes(value),
  );
}

function permissionFingerprint(
  source: Pick<
    KnowledgeV2Source,
    | "tenantId"
    | "id"
    | "sourcePermissionVersion"
    | "defaultScope"
    | "defaultClassification"
    | "defaultLocale"
  >,
) {
  return hashKnowledgeValue(
    stableKnowledgeValue({
      tenantId: source.tenantId,
      sourceId: source.id,
      permissionVersion: source.sourcePermissionVersion,
      scope: source.defaultScope,
      classification: source.defaultClassification,
      locale: source.defaultLocale,
    }),
  );
}

function revisionPipelineVersion(pipelineVersion: string, generation: number) {
  return `${pipelineVersion}:source-generation-${generation}`;
}

function compatiblePipelineVersion(actual: string, expected: string) {
  return actual === expected || actual.startsWith(`${expected}:`);
}

function strongestClassification(
  left: KnowledgeV2SecurityClassification,
  right: KnowledgeV2SecurityClassification,
) {
  const rank: Record<KnowledgeV2SecurityClassification, number> = {
    PUBLIC: 0,
    INTERNAL: 1,
    CUSTOMER_PERSONAL: 2,
    SENSITIVE: 3,
    SECRET: 4,
  };
  return rank[left] >= rank[right] ? left : right;
}

function assertNotAborted(signal: AbortSignal, stage: KnowledgeIngestionStage) {
  if (signal.aborted) {
    const timedOut =
      signal.reason instanceof Error && signal.reason.name === "WorkerJobTimeoutError";
    throw new KnowledgeIngestionError(
      timedOut ? "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED" : "KNOWLEDGE_VALIDATION_ABORTED",
      timedOut,
      stage,
    );
  }
}

function normalizedError(error: unknown, stage: KnowledgeIngestionStage) {
  if (error instanceof KnowledgeIngestionError) return error;
  if (error instanceof KnowledgeIngestionCrashError) {
    return new KnowledgeIngestionError("KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED", true, stage);
  }
  if (error instanceof WebsiteContentExtractionError) {
    return new KnowledgeIngestionError(
      "KNOWLEDGE_PARSE_CONTENT_INVALID",
      error.code === "PARSER_TIMEOUT",
      stage,
    );
  }
  if (error instanceof KnowledgeObjectStoreError) {
    return new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      error.code === "STORAGE_FAILED" || error.code === "OBJECT_NOT_FOUND",
      stage,
    );
  }
  if (error instanceof KnowledgeV2HybridIndexError) {
    return new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_VECTOR_CLEANUP_UNAVAILABLE",
      true,
      stage,
    );
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ["P1001", "P1002", "P1008", "P2024", "P2034"].includes(error.code)
  ) {
    return new KnowledgeIngestionError("KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED", true, stage);
  }
  return new KnowledgeIngestionError("KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED", true, stage);
}

function sourceStatusAfterRevision(status: string | null | undefined, queryable = false) {
  return status === "QUARANTINED" || status === "NEEDS_REVIEW"
    ? ("NEEDS_REVIEW" as const)
    : queryable
      ? ("READY" as const)
      : ("SYNCING" as const);
}

function reviewRisk(security: WebsiteContentSecurityResult) {
  if (security.findings.some((finding) => finding.severity === "CRITICAL")) {
    return "CRITICAL" as const;
  }
  if (security.findings.some((finding) => finding.severity === "HIGH")) {
    return "HIGH" as const;
  }
  return "MEDIUM" as const;
}

function reviewReason(security: WebsiteContentSecurityResult) {
  return security.findings.some((finding) =>
    ["SECRET", "SENSITIVE_DATA", "PROMPT_INJECTION"].includes(finding.kind),
  )
    ? ("SENSITIVE_CONTENT" as const)
    : ("LOW_CONFIDENCE_CONTENT" as const);
}

function reconciledReviewSecurity(input: {
  status: "NEEDS_REVIEW" | "QUARANTINED";
  classification: KnowledgeV2SecurityClassification;
  parserQuality: Prisma.JsonValue | null;
}): WebsiteContentSecurityResult {
  const quality = jsonRecord(input.parserQuality);
  const rawFindings = Array.isArray(quality.findings) ? quality.findings : [];
  const findings: WebsiteContentSecurityResult["findings"] = rawFindings.flatMap((value) => {
    const finding = jsonRecord(value);
    const kind = typeof finding.kind === "string" ? finding.kind : "";
    const severity = typeof finding.severity === "string" ? finding.severity : "";
    const location = typeof finding.location === "string" ? finding.location : "";
    if (
      !["SECRET", "SENSITIVE_DATA", "PROMPT_INJECTION", "HIDDEN_CONTENT"].includes(kind) ||
      typeof finding.code !== "string" ||
      !["MEDIUM", "HIGH", "CRITICAL"].includes(severity) ||
      !["VISIBLE", "HIDDEN", "METADATA"].includes(location) ||
      typeof finding.count !== "number" ||
      !Number.isInteger(finding.count) ||
      finding.count < 1
    ) {
      return [];
    }
    return [
      {
        kind: kind as WebsiteContentSecurityResult["findings"][number]["kind"],
        code: finding.code,
        severity: severity as WebsiteContentSecurityResult["findings"][number]["severity"],
        location: location as WebsiteContentSecurityResult["findings"][number]["location"],
        count: finding.count,
      },
    ];
  });
  return {
    decision: input.status,
    classification: input.classification,
    publishable: false,
    findings:
      findings.length > 0
        ? findings
        : [
            {
              kind:
                input.classification === "SECRET" || input.classification === "SENSITIVE"
                  ? "SENSITIVE_DATA"
                  : "HIDDEN_CONTENT",
              code: "PERMISSION_RECONCILIATION_REVIEW_REQUIRED",
              severity: input.status === "QUARANTINED" ? "HIGH" : "MEDIUM",
              location: "METADATA",
              count: 1,
            },
          ],
  };
}

async function createRevisionReview(
  tx: Prisma.TransactionClient,
  dependencies: KnowledgeIngestionDependencies,
  input: {
    attempt: RunningAttempt;
    sourceId: string;
    documentId: string;
    revisionId: string;
    contentHash: string;
    permissionFingerprint: string;
    extractedObjectKey?: string | null;
    locatorHash: string;
    security: WebsiteContentSecurityResult;
    now: Date;
  },
) {
  if (input.security.decision === "READY") return;

  const reason = reviewReason(input.security);
  const riskLevel = reviewRisk(input.security);
  const evidence = await tx.knowledgeV2EvidenceReference.create({
    data: {
      id: dependencies.id(),
      tenantId: input.attempt.tenantId,
      evidenceKey: `document-revision:${input.revisionId}`,
      targetType: "DOCUMENT_REVISION",
      itemVersionHash: input.contentHash,
      v2DocumentRevisionId: input.revisionId,
      safeLabel: "Imported website revision",
      locatorHash: input.locatorHash,
      ...(input.extractedObjectKey ? { restrictedPayloadRef: input.extractedObjectKey } : {}),
      isPublic: false,
      observedAt: input.now,
      permissionFingerprint: input.permissionFingerprint,
    },
  });
  const review = await tx.knowledgeV2ReviewItem.create({
    data: {
      id: dependencies.id(),
      tenantId: input.attempt.tenantId,
      reviewKey: `document-revision:${input.revisionId}:${reason}`,
      reason,
      riskLevel,
      suggestedAction:
        input.security.decision === "QUARANTINED" ? "EXCLUDE_CONTENT" : "REVIEW_VALUE",
      safeTitle:
        input.security.decision === "QUARANTINED"
          ? "Review quarantined source content"
          : "Review imported source content",
      safeSummary: "Automated content checks require review before this revision can be published.",
      ...(input.extractedObjectKey ? { restrictedPayloadRef: input.extractedObjectKey } : {}),
      sourceId: input.sourceId,
      v2DocumentRevisionId: input.revisionId,
      createdByUserId: input.attempt.requestedByUserId,
    },
  });
  await tx.knowledgeV2ReviewItemEvidence.create({
    data: {
      tenantId: input.attempt.tenantId,
      reviewItemId: review.id,
      evidenceReferenceId: evidence.id,
      ordinal: 0,
      relevanceScore: 1,
    },
  });
  await tx.auditLog.create({
    data: {
      tenantId: input.attempt.tenantId,
      actorUserId: input.attempt.requestedByUserId,
      action: "knowledge.v2.review.created_from_ingestion",
      entityType: "KnowledgeV2ReviewItem",
      entityId: review.id,
      payload: {
        sourceId: input.sourceId,
        documentId: input.documentId,
        revisionId: input.revisionId,
        reason,
        riskLevel,
        decision: input.security.decision,
        findingCodes: input.security.findings.map((finding) => finding.code).sort(),
      },
    },
  });
}

async function revisionQueryableInCandidate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  revision: KnowledgeV2DocumentRevision,
) {
  if (revision.status !== "READY" && revision.status !== "PUBLISHED") return false;
  const candidate = await tx.knowledgePublicationItem.findFirst({
    where: {
      tenantId,
      corpusKind: "STRUCTURED_V2",
      v2DocumentRevisionId: revision.id,
      itemVersionHash: revision.contentHash,
      authorizationFingerprint: revision.sourcePermissionFingerprint,
      publication: {
        status: { in: ["READY", "ACTIVE"] },
        indexSnapshot: { is: { status: "READY", corpusKind: "STRUCTURED_V2" } },
      },
    },
    select: { publication: { select: { indexSnapshotId: true } } },
    orderBy: { publication: { sequence: "desc" } },
  });
  const snapshotId = candidate?.publication.indexSnapshotId;
  if (!snapshotId) return false;
  const [chunkCount, indexedChunkCount, snapshotItemCount] = await Promise.all([
    tx.knowledgeV2Chunk.count({
      where: { tenantId, revisionId: revision.id, deletedAt: null },
    }),
    tx.knowledgeV2Chunk.count({
      where: {
        tenantId,
        revisionId: revision.id,
        deletedAt: null,
        indexState: "INDEXED",
        indexedAt: { not: null },
      },
    }),
    tx.knowledgeV2IndexSnapshotItem.count({
      where: {
        tenantId,
        snapshotId,
        chunk: { revisionId: revision.id, deletedAt: null },
      },
    }),
  ]);
  return chunkCount > 0 && indexedChunkCount === chunkCount && snapshotItemCount === chunkCount;
}

function extractedContentBytes(input: PreparedWebsiteContent) {
  return new TextEncoder().encode(
    stableKnowledgeValue({
      schemaVersion: 1,
      title: input.extracted.title,
      locale: input.locale,
      text: input.extracted.text,
      hiddenText: input.extracted.hiddenText,
      elements: input.extracted.elements,
      links: input.extracted.links,
    }),
  );
}

function splitElementText(value: string) {
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  if (!value) return chunks;
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + MAX_CHUNK_CHARACTERS);
    if (end < value.length) {
      const minimumBoundary = offset + Math.floor(MAX_CHUNK_CHARACTERS * 0.6);
      for (const boundary of ["\n\n", "\n", ". ", "; ", " "]) {
        const candidate = value.lastIndexOf(boundary, end);
        if (candidate >= minimumBoundary) {
          end = candidate + boundary.length;
          break;
        }
      }
    }
    const raw = value.slice(offset, end);
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const text = raw.trim();
    offset = Math.max(end, offset + 1);
    if (!text) continue;
    const start = offset - raw.length + leadingWhitespace;
    chunks.push({ text, start, end: start + text.length });
  }
  return chunks;
}

function parserQuality(
  extraction: ExtractedWebsiteContent,
  security: WebsiteContentSecurityResult,
  redirectCount: number,
) {
  return {
    schemaVersion: 1,
    decision: security.decision,
    publishable: security.publishable,
    findings: security.findings.map((finding) => ({
      kind: finding.kind,
      code: finding.code,
      severity: finding.severity,
      location: finding.location,
      count: finding.count,
    })),
    elementCount: extraction.elements.length,
    linkCount: extraction.links.length,
    redirectCount,
  } satisfies Prisma.InputJsonObject;
}

function acquisitionUriHash(url: string) {
  return hash(`knowledge-acquisition-uri-v1\u0000${url}`);
}

function safeAttemptDelay(attempt: number) {
  return Math.min(60_000, 2_000 * 2 ** Math.min(Math.max(0, attempt - 1), 5));
}

async function lockJob(tx: Prisma.TransactionClient, jobId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "KnowledgeJob" WHERE "id" = ${jobId} FOR UPDATE
  `);
  return tx.knowledgeJob.findUnique({ where: { id: jobId } });
}

async function lockSource(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "KnowledgeV2Source"
    WHERE "tenantId" = ${tenantId} AND "id" = ${sourceId}
    FOR UPDATE
  `);
  return tx.knowledgeV2Source.findUnique({
    where: { tenantId_id: { tenantId, id: sourceId } },
  });
}

async function assertActorAuthorized(
  tx: Prisma.TransactionClient,
  attempt: Pick<RunningAttempt, "tenantId" | "requestedByUserId" | "stage">,
) {
  const membership = await tx.membership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: attempt.tenantId,
        userId: attempt.requestedByUserId,
      },
    },
    include: {
      user: { select: { deletedAt: true } },
      tenant: { select: { status: true, deletedAt: true } },
    },
  });
  if (
    !membership ||
    !["OWNER", "ADMIN"].includes(membership.role) ||
    membership.user.deletedAt ||
    membership.tenant.deletedAt ||
    !["ACTIVE", "TRIALING"].includes(membership.tenant.status)
  ) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_PERMISSION_ACTOR_NOT_AUTHORIZED",
      false,
      attempt.stage,
    );
  }
}

async function beginAttempt(
  input: KnowledgeIngestionJobInput,
  dependencies: KnowledgeIngestionDependencies,
): Promise<RunningAttempt | KnowledgeIngestionResult> {
  const { data } = input;
  const stage = operationStage(data.operation);
  return dependencies.prisma
    .$transaction(
      async (tx) => {
        const now = dependencies.now();
        const job = await lockJob(tx, data.knowledgeJobId);
        if (!job || job.tenantId !== data.tenantId) {
          throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_INVALID", false, stage);
        }
        if (job.status === "SUCCEEDED") {
          return {
            status: "already_succeeded",
            operation: data.operation,
            stage,
            reason: "terminal_replay",
          } as const;
        }
        if (job.status === "FAILED" || job.status === "CANCELLED" || job.status === "DEAD_LETTER") {
          return {
            status: "cancelled",
            operation: data.operation,
            stage,
            reason: "terminal_replay",
          } as const;
        }

        const source = await lockSource(tx, data.tenantId, data.sourceId);
        const membership = await tx.membership.findUnique({
          where: {
            tenantId_userId: { tenantId: data.tenantId, userId: data.requestedByUserId },
          },
          include: {
            user: { select: { deletedAt: true } },
            tenant: { select: { status: true, deletedAt: true } },
          },
        });
        const expectedPayloadRef = `runtime-outbox:${data.runtimeEventId}`;
        const exactJob =
          job.v2SourceId === data.sourceId &&
          job.generation === data.generation &&
          job.pipelineVersion === dependencies.pipelineVersion &&
          job.idempotencyKey ===
            `knowledge-source:${data.operation.toLowerCase()}:${data.sourceId}:${data.generation}` &&
          job.payloadRef === expectedPayloadRef &&
          input.id === `knowledge-source:${data.knowledgeJobId}` &&
          input.name === expectedJobName(data.operation) &&
          data.runtimeGeneration === data.generation &&
          input.maxAttempts === job.maxAttempts;

        let startupError: KnowledgeIngestionError | null = null;
        if (!exactJob) {
          startupError = new KnowledgeIngestionError(
            "KNOWLEDGE_VALIDATION_JOB_INVALID",
            false,
            stage,
          );
        } else if (!source) {
          startupError = new KnowledgeIngestionError(
            "KNOWLEDGE_SOURCE_NOT_AVAILABLE",
            false,
            stage,
          );
        } else if (
          !membership ||
          !["OWNER", "ADMIN"].includes(membership.role) ||
          membership.user.deletedAt ||
          membership.tenant.deletedAt ||
          !["ACTIVE", "TRIALING"].includes(membership.tenant.status)
        ) {
          startupError = new KnowledgeIngestionError(
            "KNOWLEDGE_PERMISSION_ACTOR_NOT_AUTHORIZED",
            false,
            stage,
          );
        } else if (source.generation !== data.generation) {
          const attempt = job.attemptCount + 1;
          await tx.knowledgeJobAttempt.updateMany({
            where: { tenantId: data.tenantId, jobId: job.id, status: "RUNNING" },
            data: { status: "CANCELLED", completedAt: now, heartbeatAt: now },
          });
          await tx.knowledgeJobAttempt.create({
            data: {
              id: dependencies.id(),
              tenantId: data.tenantId,
              jobId: job.id,
              attempt,
              status: "CANCELLED",
              workerId: dependencies.workerId,
              errorCode: "KNOWLEDGE_SOURCE_GENERATION_STALE",
              errorMessage: knowledgeIngestionMessages.KNOWLEDGE_SOURCE_GENERATION_STALE,
              heartbeatAt: now,
              completedAt: now,
            },
          });
          await tx.knowledgeJob.update({
            where: { id: job.id },
            data: {
              status: "CANCELLED",
              attemptCount: attempt,
              errorCode: "KNOWLEDGE_SOURCE_GENERATION_STALE",
              errorMessage: knowledgeIngestionMessages.KNOWLEDGE_SOURCE_GENERATION_STALE,
              heartbeatAt: now,
              completedAt: now,
            },
          });
          return {
            status: "cancelled",
            operation: data.operation,
            stage,
            reason: "stale_generation",
          } as const;
        } else if (job.deadlineAt && job.deadlineAt <= now) {
          startupError = new KnowledgeIngestionError(
            "KNOWLEDGE_VALIDATION_JOB_EXPIRED",
            false,
            stage,
          );
        } else if (
          job.status === "RUNNING" &&
          job.heartbeatAt &&
          job.heartbeatAt.getTime() > now.getTime() - dependencies.staleAttemptMs
        ) {
          throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_BUSY", true, stage);
        }

        const attempt = job.attemptCount + 1;
        if (attempt > job.maxAttempts) {
          await tx.knowledgeJob.update({
            where: { id: job.id },
            data: {
              status: "DEAD_LETTER",
              errorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
              errorMessage: knowledgeIngestionMessages.KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED,
              heartbeatAt: now,
              completedAt: now,
            },
          });
          if (source && source.generation === data.generation) {
            await tx.knowledgeV2Source.update({
              where: { id: source.id },
              data: {
                ...(data.operation === "DELETE" ? {} : { status: "FAILED" as const }),
                lastErrorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
                lastErrorAt: now,
                etag: { increment: 1 },
              },
            });
          }
          return {
            status: "cancelled",
            operation: data.operation,
            stage,
            reason: "terminal_replay",
          } as const;
        }

        await tx.knowledgeJobAttempt.updateMany({
          where: { tenantId: data.tenantId, jobId: job.id, status: "RUNNING" },
          data: {
            status: "TIMED_OUT",
            errorCode: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
            errorMessage: knowledgeIngestionMessages.KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED,
            heartbeatAt: now,
            completedAt: now,
          },
        });
        const attemptId = dependencies.id();
        await tx.knowledgeJobAttempt.create({
          data: {
            id: attemptId,
            tenantId: data.tenantId,
            jobId: job.id,
            attempt,
            status: "RUNNING",
            workerId: dependencies.workerId,
            heartbeatAt: now,
          },
        });
        await tx.knowledgeJob.update({
          where: { id: job.id },
          data: {
            stage,
            status: "RUNNING",
            attemptCount: attempt,
            progressCompleted: 0,
            progressTotal:
              data.operation === "IMPORT" || data.operation === "SYNC" ? INGESTION_STEPS : 1,
            startedAt: job.startedAt ?? now,
            heartbeatAt: now,
            completedAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        if (source) {
          await tx.knowledgeV2Source.updateMany({
            where: { id: source.id, tenantId: source.tenantId, generation: data.generation },
            data: {
              lastAttemptAt: now,
              ...(data.operation === "IMPORT" || data.operation === "SYNC"
                ? { status: "SYNCING" as const }
                : {}),
              etag: { increment: 1 },
            },
          });
        }

        const running: RunningAttempt = {
          tenantId: data.tenantId,
          sourceId: data.sourceId,
          knowledgeJobId: data.knowledgeJobId,
          generation: data.generation,
          operation: data.operation,
          requestedByUserId: data.requestedByUserId,
          attempt,
          attemptId,
          maxAttempts: job.maxAttempts,
          deadlineAt: job.deadlineAt,
          revisionId: job.v2RevisionId,
          source: source ?? ({ tenantId: data.tenantId, id: data.sourceId } as KnowledgeV2Source),
          stage,
        };
        if (startupError)
          return { ...running, startupError } as RunningAttempt & {
            startupError: KnowledgeIngestionError;
          };
        return running;
      },
      { isolationLevel: "Serializable" },
    )
    .then((result) => {
      if ("startupError" in result) {
        Object.defineProperty(result.startupError, "runningAttempt", { value: result });
        throw result.startupError;
      }
      return result;
    });
}

function runningAttemptFromError(error: unknown): RunningAttempt | null {
  if (
    error instanceof KnowledgeIngestionError &&
    "runningAttempt" in error &&
    typeof error.runningAttempt === "object" &&
    error.runningAttempt !== null
  ) {
    return error.runningAttempt as RunningAttempt;
  }
  return null;
}

async function setStage(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  stage: KnowledgeIngestionStage,
  completed: number,
  total = INGESTION_STEPS,
) {
  attempt.stage = stage;
  const now = dependencies.now();
  const updated = await dependencies.prisma.$transaction(async (tx) => {
    const job = await tx.knowledgeJob.updateMany({
      where: {
        id: attempt.knowledgeJobId,
        tenantId: attempt.tenantId,
        generation: attempt.generation,
        status: "RUNNING",
        attemptCount: attempt.attempt,
      },
      data: {
        stage,
        progressCompleted: completed,
        progressTotal: total,
        heartbeatAt: now,
      },
    });
    const jobAttempt = await tx.knowledgeJobAttempt.updateMany({
      where: {
        id: attempt.attemptId,
        tenantId: attempt.tenantId,
        jobId: attempt.knowledgeJobId,
        attempt: attempt.attempt,
        status: "RUNNING",
      },
      data: { heartbeatAt: now },
    });
    return job.count === 1 && jobAttempt.count === 1;
  });
  if (!updated) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, stage);
  }
}

async function completeAttempt(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  result: KnowledgeIngestionResult,
) {
  const now = dependencies.now();
  const updated = await dependencies.prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    const job = await lockJob(tx, attempt.knowledgeJobId);
    if (
      !source ||
      source.generation !== attempt.generation ||
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt
    ) {
      return false;
    }
    const auditActor = await tx.user.findUnique({
      where: { id: attempt.requestedByUserId },
      select: { id: true },
    });
    const jobUpdate = await tx.knowledgeJob.updateMany({
      where: {
        id: attempt.knowledgeJobId,
        tenantId: attempt.tenantId,
        generation: attempt.generation,
        status: "RUNNING",
        attemptCount: attempt.attempt,
      },
      data: {
        stage: result.stage,
        status: "SUCCEEDED",
        progressCompleted:
          attempt.operation === "IMPORT" || attempt.operation === "SYNC" ? INGESTION_STEPS : 1,
        progressTotal:
          attempt.operation === "IMPORT" || attempt.operation === "SYNC" ? INGESTION_STEPS : 1,
        v2RevisionId: result.revisionId ?? job.v2RevisionId,
        errorCode: null,
        errorMessage: null,
        heartbeatAt: now,
        completedAt: now,
      },
    });
    const attemptUpdate = await tx.knowledgeJobAttempt.updateMany({
      where: {
        id: attempt.attemptId,
        tenantId: attempt.tenantId,
        jobId: attempt.knowledgeJobId,
        attempt: attempt.attempt,
        status: "RUNNING",
      },
      data: { status: "SUCCEEDED", heartbeatAt: now, completedAt: now },
    });
    if (jobUpdate.count !== 1 || attemptUpdate.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        tenantId: attempt.tenantId,
        actorUserId: auditActor?.id ?? null,
        action: `knowledge.v2.source.${attempt.operation.toLowerCase()}_completed`,
        entityType: "KnowledgeV2Source",
        entityId: attempt.sourceId,
        payload: {
          jobId: attempt.knowledgeJobId,
          generation: attempt.generation,
          attempt: attempt.attempt,
          result: result.status,
          revisionId: result.revisionId ?? null,
          documentId: result.documentId ?? null,
        },
      },
    });
    return true;
  });
  if (!updated) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, result.stage);
  }
}

async function failAttempt(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  error: KnowledgeIngestionError,
) {
  const now = dependencies.now();
  const retryable =
    error.retryable &&
    attempt.attempt < attempt.maxAttempts &&
    (!attempt.deadlineAt || attempt.deadlineAt > now);
  const cancelled =
    error.code === "KNOWLEDGE_SOURCE_GENERATION_STALE" ||
    error.code === "KNOWLEDGE_VALIDATION_ABORTED";
  const status = cancelled ? "CANCELLED" : retryable ? "RETRY_SCHEDULED" : "FAILED";
  const attemptStatus = cancelled ? "CANCELLED" : "FAILED";
  const availableAt = new Date(now.getTime() + safeAttemptDelay(attempt.attempt));
  await dependencies.prisma.$transaction(async (tx) => {
    const auditActor = await tx.user.findUnique({
      where: { id: attempt.requestedByUserId },
      select: { id: true },
    });
    const attemptUpdate = await tx.knowledgeJobAttempt.updateMany({
      where: {
        id: attempt.attemptId,
        tenantId: attempt.tenantId,
        jobId: attempt.knowledgeJobId,
        attempt: attempt.attempt,
        status: "RUNNING",
      },
      data: {
        status: attemptStatus,
        errorCode: error.code,
        errorMessage: error.message,
        heartbeatAt: now,
        completedAt: now,
      },
    });
    const jobUpdate = await tx.knowledgeJob.updateMany({
      where: {
        id: attempt.knowledgeJobId,
        tenantId: attempt.tenantId,
        generation: attempt.generation,
        status: "RUNNING",
        attemptCount: attempt.attempt,
      },
      data: {
        status,
        availableAt,
        errorCode: error.code,
        errorMessage: error.message,
        heartbeatAt: now,
        completedAt: retryable ? null : now,
      },
    });
    if (jobUpdate.count === 0 && attemptUpdate.count === 0) return;
    if (jobUpdate.count !== 1 || attemptUpdate.count !== 1) {
      throw new KnowledgeIngestionError(
        "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
        true,
        error.stage,
      );
    }
    if (error.code !== "KNOWLEDGE_SOURCE_GENERATION_STALE") {
      await tx.knowledgeV2Source.updateMany({
        where: {
          id: attempt.sourceId,
          tenantId: attempt.tenantId,
          generation: attempt.generation,
        },
        data: {
          ...(attempt.operation === "DELETE"
            ? {}
            : { status: retryable ? ("SYNCING" as const) : ("FAILED" as const) }),
          lastErrorCode: error.code,
          lastErrorAt: now,
          etag: { increment: 1 },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: attempt.tenantId,
        actorUserId: auditActor?.id ?? null,
        action: `knowledge.v2.source.${attempt.operation.toLowerCase()}_failed`,
        entityType: "KnowledgeV2Source",
        entityId: attempt.sourceId,
        payload: {
          jobId: attempt.knowledgeJobId,
          generation: attempt.generation,
          attempt: attempt.attempt,
          stage: error.stage,
          errorCode: error.code,
          retryable,
        },
      },
    });
  });
}

function assertWebsiteConfiguration(dependencies: KnowledgeIngestionDependencies) {
  if (!dependencies.websiteImportEnabled || !dependencies.websiteEgressReady) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
      false,
      "ACQUIRING",
    );
  }
  if (!dependencies.objectStoreConfigured || !dependencies.objectStore) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      false,
      "ACQUIRING",
    );
  }
}

function validateAcquiredBody(
  body: AcquiredWebsiteSourceBody,
  maximumBytes: number,
  stage: KnowledgeIngestionStage,
) {
  if (
    !(body.bytes instanceof Uint8Array) ||
    body.byteLength !== body.bytes.byteLength ||
    body.byteLength < 1 ||
    body.byteLength > maximumBytes ||
    !["text/html", "text/plain"].includes(body.contentType) ||
    !/^[a-f0-9]{64}$/u.test(body.sha256) ||
    hash(body.bytes) !== body.sha256
  ) {
    throw new KnowledgeIngestionError("KNOWLEDGE_PARSE_CONTENT_INVALID", false, stage);
  }
}

async function prepareWebsite(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
) {
  assertWebsiteConfiguration(dependencies);
  if (attempt.source.kind !== "WEBSITE" || !attempt.source.canonicalUri) {
    throw new KnowledgeIngestionError(
      attempt.source.kind === "WEBSITE"
        ? "KNOWLEDGE_SOURCE_NOT_AVAILABLE"
        : "KNOWLEDGE_SOURCE_KIND_UNSUPPORTED",
      false,
      "ACQUIRING",
    );
  }
  if (
    attempt.source.defaultClassification !== "PUBLIC" &&
    attempt.source.defaultClassification !== "INTERNAL"
  ) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_RUNTIME_INVALID", false, "ACQUIRING");
  }

  await setStage(attempt, dependencies, "ACQUIRING", 0);
  assertNotAborted(signal, "ACQUIRING");
  let acquisition: KnowledgeIngestionAcquisition;
  try {
    acquisition = await dependencies.acquireWebsite(attempt.source.canonicalUri, signal);
  } catch (error) {
    assertNotAborted(signal, "ACQUIRING");
    throw normalizedError(error, "ACQUIRING");
  }
  assertNotAborted(signal, "ACQUIRING");

  await setStage(attempt, dependencies, "SCANNING", 1);
  validateAcquiredBody(acquisition.body, dependencies.maxWebsiteBytes, "SCANNING");
  assertNotAborted(signal, "SCANNING");

  await setStage(attempt, dependencies, "PARSING", 2);
  const extracted = await dependencies.extractWebsite(acquisition.body);
  assertNotAborted(signal, "PARSING");
  if (!extracted.text.trim() || extracted.elements.length === 0) {
    throw new KnowledgeIngestionError("KNOWLEDGE_PARSE_CONTENT_INVALID", false, "PARSING");
  }

  await setStage(attempt, dependencies, "NORMALIZING", 3);
  const locale = canonicalLocale(extracted.declaredLocale, attempt.source.defaultLocale);
  const title = (extracted.title?.trim() || attempt.source.displayName).slice(0, 500);
  const contentHash = hashKnowledgeValue(
    stableKnowledgeValue({
      schemaVersion: 2,
      title,
      locale,
      text: extracted.text,
      hiddenText: extracted.hiddenText,
      elements: extracted.elements,
      links: extracted.links,
    }),
  );
  const preparedBase = {
    acquisition,
    extracted,
    contentHash,
    locale,
    title,
    permissionFingerprint: permissionFingerprint(attempt.source),
  };

  await setStage(attempt, dependencies, "EXTRACTING", 4);
  const security = dependencies.scanWebsite(extracted, attempt.source.defaultClassification);
  assertNotAborted(signal, "EXTRACTING");
  return { ...preparedBase, security } satisfies PreparedWebsiteContent;
}

async function prepareFile(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
) {
  if (!dependencies.fileImportEnabled || !dependencies.objectStoreConfigured || !dependencies.objectStore) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
      false,
      "ACQUIRING",
    );
  }
  if (attempt.source.kind !== "FILE" || attempt.operation !== "IMPORT") {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_KIND_UNSUPPORTED", false, "ACQUIRING");
  }
  if (
    attempt.source.defaultClassification !== "PUBLIC" &&
    attempt.source.defaultClassification !== "INTERNAL"
  ) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_RUNTIME_INVALID", false, "ACQUIRING");
  }
  await setStage(attempt, dependencies, "ACQUIRING", 0);
  const artifacts = await dependencies.prisma.knowledgeV2Artifact.findMany({
    where: {
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      deletionState: "RETAINED",
      deletedAt: null,
    },
    orderBy: [{ acquiredAt: "desc" }, { id: "desc" }],
    take: 2,
  });
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    !artifact ||
    artifact.malwareStatus !== "CLEAN" ||
    artifact.mimeValidationStatus !== "VALID" ||
    !artifact.originalFilename ||
    !artifact.detectedMimeType ||
    artifact.detectedMimeType !== artifact.declaredMimeType ||
    !["text/plain", "text/csv"].includes(artifact.detectedMimeType) ||
    artifact.byteSize < 1n ||
    artifact.byteSize > BigInt(dependencies.maxFileBytes)
  ) {
    throw new KnowledgeIngestionError("KNOWLEDGE_PARSE_CONTENT_INVALID", false, "ACQUIRING");
  }
  assertNotAborted(signal, "ACQUIRING");
  const bytes = await dependencies.objectStore.get(
    artifact.objectStorageKey,
    artifact.encryptionKeyRef,
  );
  await setStage(attempt, dependencies, "SCANNING", 1);
  if (BigInt(bytes.byteLength) !== artifact.byteSize || hash(bytes) !== artifact.sha256) {
    throw new KnowledgeIngestionError("KNOWLEDGE_PARSE_CONTENT_INVALID", false, "SCANNING");
  }
  const body: AcquiredWebsiteSourceBody = {
    bytes,
    byteLength: bytes.byteLength,
    sha256: artifact.sha256,
    contentType: "text/plain",
    charset: "utf-8",
  };
  validateAcquiredBody(body, dependencies.maxFileBytes, "SCANNING");
  await setStage(attempt, dependencies, "PARSING", 2);
  const extracted = await dependencies.extractWebsite(body);
  if (!extracted.text.trim() || extracted.elements.length === 0) {
    throw new KnowledgeIngestionError("KNOWLEDGE_PARSE_CONTENT_INVALID", false, "PARSING");
  }
  await setStage(attempt, dependencies, "NORMALIZING", 3);
  const locale = canonicalLocale(extracted.declaredLocale, attempt.source.defaultLocale);
  const title = attempt.source.displayName.slice(0, 500);
  const contentHash = hashKnowledgeValue(
    stableKnowledgeValue({
      schemaVersion: 2,
      sourceKind: "FILE",
      title,
      locale,
      text: extracted.text,
      elements: extracted.elements,
    }),
  );
  await setStage(attempt, dependencies, "EXTRACTING", 4);
  const security = dependencies.scanWebsite(extracted, attempt.source.defaultClassification);
  return {
    acquisition: {
      finalUrl: `urn:leadvirt:file:${artifact.id}`,
      redirectCount: 0,
      body,
    },
    extracted,
    security,
    contentHash,
    locale,
    title,
    permissionFingerprint: permissionFingerprint(attempt.source),
    existingArtifact: {
      id: artifact.id,
      objectStorageKey: artifact.objectStorageKey,
      encryptionKeyRef: artifact.encryptionKeyRef,
      originalFilename: artifact.originalFilename,
      mimeType: artifact.detectedMimeType,
    },
  } satisfies PreparedWebsiteContent;
}

async function noChangeWebsite(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
  prepared: PreparedWebsiteContent,
) {
  return dependencies.prisma.$transaction(
    async (tx) => {
      const job = await lockJob(tx, attempt.knowledgeJobId);
      const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
      if (
        !job ||
        job.status !== "RUNNING" ||
        job.attemptCount !== attempt.attempt ||
        !source ||
        source.generation !== attempt.generation
      ) {
        throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "EXTRACTING");
      }
      assertNotAborted(signal, "EXTRACTING");
      await assertActorAuthorized(tx, attempt);
      const document = await tx.knowledgeV2Document.findUnique({
        where: {
          tenantId_sourceId_externalKey: {
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            externalKey: source.externalRootKey ?? `source:${source.id}`,
          },
        },
        include: { currentDraftRevision: true },
      });
      const matching =
        document?.currentDraftRevision?.contentHash === prepared.contentHash &&
        document.currentDraftRevision.sourcePermissionFingerprint ===
          prepared.permissionFingerprint &&
        compatiblePipelineVersion(
          document.currentDraftRevision.pipelineVersion,
          dependencies.pipelineVersion,
        )
          ? document.currentDraftRevision
          : null;
      if (!document || !matching) return null;
      const now = dependencies.now();
      const visibleRevision = document.currentDraftRevision ?? matching;
      const queryable = await revisionQueryableInCandidate(tx, attempt.tenantId, visibleRevision);
      const terminalSuccess =
        queryable || ["NEEDS_REVIEW", "QUARANTINED"].includes(visibleRevision.status);
      await tx.knowledgeV2Source.update({
        where: { id: source.id },
        data: {
          status: sourceStatusAfterRevision(visibleRevision.status, queryable),
          ...(terminalSuccess ? { lastSuccessAt: now } : {}),
          sourceObservedAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
          etag: { increment: 1 },
        },
      });
      return {
        status: "unchanged",
        documentId: document.id,
        ...(document.currentDraftRevisionId ? { revisionId: document.currentDraftRevisionId } : {}),
        objectsReferenced: false,
        queryable,
      } satisfies PersistedWebsiteResult;
    },
    { isolationLevel: "Serializable" },
  );
}

async function putOrVerify(
  store: KnowledgeObjectStore,
  key: string,
  value: Uint8Array,
  encryptionKeyRef: string,
) {
  try {
    const result = await store.put(key, value);
    return { result, created: true };
  } catch (error) {
    if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS") {
      throw error;
    }
    const existing = await store.get(key, encryptionKeyRef);
    if (!Buffer.from(existing).equals(Buffer.from(value))) {
      throw new KnowledgeObjectStoreError("OBJECT_CORRUPT");
    }
    return {
      result: {
        key,
        encryptionKeyRef,
        plaintextBytes: value.byteLength,
        storedBytes: 0,
      },
      created: false,
    };
  }
}

async function persistWebsite(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
  prepared: PreparedWebsiteContent,
  rawObjectKey: string,
  extractedObjectKey: string,
  encryptionKeyRef: string,
) {
  return dependencies.prisma.$transaction(
    async (tx) => {
      const job = await lockJob(tx, attempt.knowledgeJobId);
      const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
      if (
        !job ||
        job.status !== "RUNNING" ||
        job.attemptCount !== attempt.attempt ||
        !source ||
        source.generation !== attempt.generation ||
        source.status === "DELETING" ||
        source.status === "DELETED"
      ) {
        throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CHUNKING");
      }
      assertNotAborted(signal, "CHUNKING");
      await assertActorAuthorized(tx, attempt);
      const externalKey = source.externalRootKey ?? `source:${source.id}`;
      let document = await tx.knowledgeV2Document.findUnique({
        where: {
          tenantId_sourceId_externalKey: {
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            externalKey,
          },
        },
        include: { currentDraftRevision: true },
      });
      const duplicate =
        document?.currentDraftRevision?.contentHash === prepared.contentHash &&
        document.currentDraftRevision.sourcePermissionFingerprint ===
          prepared.permissionFingerprint &&
        compatiblePipelineVersion(
          document.currentDraftRevision.pipelineVersion,
          dependencies.pipelineVersion,
        )
          ? document.currentDraftRevision
          : null;
      const now = dependencies.now();
      if (document && duplicate) {
        const queryable = await revisionQueryableInCandidate(tx, attempt.tenantId, duplicate);
        const terminalSuccess =
          queryable || ["NEEDS_REVIEW", "QUARANTINED"].includes(duplicate.status);
        await tx.knowledgeV2Source.update({
          where: { id: source.id },
          data: {
            status: sourceStatusAfterRevision(
              document.currentDraftRevision?.status ?? duplicate.status,
              queryable,
            ),
            ...(terminalSuccess ? { lastSuccessAt: now } : {}),
            sourceObservedAt: now,
            lastErrorCode: null,
            lastErrorAt: null,
            etag: { increment: 1 },
          },
        });
        return {
          status: "unchanged",
          documentId: document.id,
          ...(document.currentDraftRevisionId
            ? { revisionId: document.currentDraftRevisionId }
            : {}),
          objectsReferenced: false,
          queryable,
        } satisfies PersistedWebsiteResult;
      }

      const documentId = document?.id ?? dependencies.id();
      const previousDraftId = document?.currentDraftRevisionId ?? null;
      const previousPublishedId = document?.currentPublishedRevisionId ?? null;
      const revisionId = dependencies.id();
      const artifactId = prepared.existingArtifact?.id ?? dependencies.id();
      const pipelineCollision = document
        ? await tx.knowledgeV2DocumentRevision.findUnique({
            where: {
              documentId_contentHash_pipelineVersion: {
                documentId,
                contentHash: prepared.contentHash,
                pipelineVersion: dependencies.pipelineVersion,
              },
            },
            select: { id: true },
          })
        : null;
      const persistedPipelineVersion = pipelineCollision
        ? revisionPipelineVersion(dependencies.pipelineVersion, attempt.generation)
        : dependencies.pipelineVersion;
      const revisionNumber = document
        ? ((
            await tx.knowledgeV2DocumentRevision.aggregate({
              where: { tenantId: attempt.tenantId, documentId },
              _max: { revisionNumber: true },
            })
          )._max.revisionNumber ?? 0) + 1
        : 1;
      const revisionStatus =
        prepared.security.decision === "QUARANTINED"
          ? ("QUARANTINED" as const)
          : prepared.security.decision === "NEEDS_REVIEW"
            ? ("NEEDS_REVIEW" as const)
            : ("CHUNKING" as const);
      const documentStatus =
        revisionStatus === "CHUNKING" ? ("DISCOVERED" as const) : ("NEEDS_REVIEW" as const);
      const documentTitle =
        revisionStatus === "QUARANTINED" ? source.displayName.slice(0, 500) : prepared.title;
      const scope = source.defaultScope ?? Prisma.DbNull;
      const audiences = sourceAudiences(source);

      if (!prepared.existingArtifact) {
        await tx.knowledgeV2Artifact.create({
          data: {
            id: artifactId,
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            objectStorageKey: rawObjectKey,
            encryptionKeyRef,
            sha256: prepared.acquisition.body.sha256,
            byteSize: BigInt(prepared.acquisition.body.byteLength),
            detectedMimeType: prepared.acquisition.body.contentType,
            declaredMimeType: prepared.acquisition.body.contentType,
            acquisitionUriHash: acquisitionUriHash(prepared.acquisition.finalUrl),
            malwareStatus: "NOT_APPLICABLE",
            mimeValidationStatus: "VALID",
            securityClassification: prepared.security.classification,
            retentionClass: "KNOWLEDGE_SOURCE_STANDARD",
            scannedAt: now,
          },
        });
      } else {
        const existingArtifact = await tx.knowledgeV2Artifact.findFirst({
          where: {
            id: prepared.existingArtifact.id,
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            objectStorageKey: prepared.existingArtifact.objectStorageKey,
            encryptionKeyRef: prepared.existingArtifact.encryptionKeyRef,
            malwareStatus: "CLEAN",
            mimeValidationStatus: "VALID",
            deletionState: "RETAINED",
            deletedAt: null,
          },
        });
        if (!existingArtifact) {
          throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CHUNKING");
        }
        if (existingArtifact.securityClassification !== prepared.security.classification) {
          await tx.knowledgeV2Artifact.update({
            where: { id: existingArtifact.id },
            data: { securityClassification: prepared.security.classification },
          });
        }
      }

      if (!document) {
        document = await tx.knowledgeV2Document.create({
          data: {
            id: documentId,
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            externalKey,
            kind: prepared.existingArtifact ? "FILE" : "WEBSITE_PAGE",
            canonicalUri: prepared.existingArtifact ? null : prepared.acquisition.finalUrl,
            title: documentTitle,
            canonicalLocale: prepared.locale,
            scope,
            audience: audiences.length > 0 ? audiences : Prisma.DbNull,
            classification: prepared.security.classification,
            permissionVersion: source.sourcePermissionVersion,
            status: documentStatus,
            sourceCreatedAt: now,
            sourceUpdatedAt: now,
          },
          include: { currentDraftRevision: true },
        });
      }

      await tx.knowledgeV2DocumentRevision.create({
        data: {
          id: revisionId,
          tenantId: attempt.tenantId,
          sourceId: attempt.sourceId,
          documentId,
          revisionNumber,
          contentHash: prepared.contentHash,
          artifactId,
          extractedContentObjectKey: extractedObjectKey,
          status: revisionStatus,
          parserVersion: prepared.existingArtifact
            ? prepared.existingArtifact.mimeType === "text/csv"
              ? "csv-text-v1"
              : "plain-text-v1"
            : "parse5-8",
          normalizerVersion: prepared.existingArtifact ? "file-normalizer-v1" : "website-normalizer-v1",
          extractorVersion: prepared.existingArtifact ? "file-extractor-v1" : "website-extractor-v1",
          chunkerVersion: "element-window-v1",
          pipelineVersion: persistedPipelineVersion,
          detectedLocale: prepared.locale,
          characterCount: prepared.extracted.characterCount,
          tokenCount: estimateKnowledgeTokens(prepared.extracted.text),
          pageCount: 1,
          tableCount: prepared.extracted.elements.filter(
            (element) => element.kind === "TABLE_ROW_GROUP",
          ).length,
          imageCount: 0,
          extractionCoverage: prepared.extracted.characterCount > 0 ? 1 : 0,
          parserQuality: parserQuality(
            prepared.extracted,
            prepared.security,
            prepared.acquisition.redirectCount,
          ),
          sourcePermissionFingerprint: prepared.permissionFingerprint,
          scopeSnapshot: scope,
          supersedesRevisionId: previousDraftId,
          generation: attempt.generation,
          createdByUserId: attempt.requestedByUserId,
        },
      });

      const quarantined = revisionStatus === "QUARANTINED";
      const elementRows = prepared.extracted.elements.map((element) => ({
        id: dependencies.id(),
        tenantId: attempt.tenantId,
        documentId,
        revisionId,
        kind: element.kind,
        ordinal: element.ordinal,
        headingPath: element.headingPath,
        urlAnchor: element.urlAnchor,
        normalizedText: quarantined ? null : element.text,
        objectStorageKey: quarantined ? extractedObjectKey : null,
        contentHash: hashKnowledgeValue(element.text),
        parserConfidence: element.parserConfidence,
        locale: prepared.locale,
        classification: prepared.security.classification,
        rawText: element.text,
      }));
      await tx.knowledgeV2Element.createMany({
        data: elementRows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          documentId: row.documentId,
          revisionId: row.revisionId,
          kind: row.kind,
          ordinal: row.ordinal,
          headingPath: row.headingPath,
          urlAnchor: row.urlAnchor,
          normalizedText: row.normalizedText,
          objectStorageKey: row.objectStorageKey,
          contentHash: row.contentHash,
          parserConfidence: row.parserConfidence,
          locale: row.locale,
          classification: row.classification,
        })),
      });

      if (!quarantined) {
        let ordinal = 0;
        const chunks = elementRows.flatMap((element) =>
          splitElementText(element.rawText).map((chunk) => {
            const chunkId = dependencies.id();
            return {
              id: chunkId,
              tenantId: attempt.tenantId,
              revisionId,
              documentId,
              ordinal: ordinal++,
              parentElementId: element.id,
              parentSectionId: element.kind === "TITLE" ? element.id : null,
              contentHash: hashKnowledgeValue(chunk.text),
              tokenCount: estimateKnowledgeTokens(chunk.text),
              locale: prepared.locale,
              scope,
              classification: prepared.security.classification,
              permissionVersion: source.sourcePermissionVersion,
              denseSchemaVersion: "knowledge-dense-v1",
              sparseSchemaVersion: "knowledge-sparse-v1",
              pipelineVersion: dependencies.pipelineVersion,
              vectorPointId: deterministicPointId(
                `${attempt.tenantId}:${revisionId}:${chunkId}:knowledge-dense-v1`,
              ),
              indexState: "PENDING" as const,
              provenanceRange: {
                schemaVersion: 1,
                elementId: element.id,
                start: chunk.start,
                end: chunk.end,
              },
            };
          }),
        );
        await tx.knowledgeV2Chunk.createMany({ data: chunks });
      }

      await createRevisionReview(tx, dependencies, {
        attempt,
        sourceId: source.id,
        documentId,
        revisionId,
        contentHash: prepared.contentHash,
        permissionFingerprint: prepared.permissionFingerprint,
        extractedObjectKey,
        locatorHash: prepared.existingArtifact
          ? hash(prepared.existingArtifact.id)
          : acquisitionUriHash(prepared.acquisition.finalUrl),
        security: prepared.security,
        now,
      });

      if (previousDraftId && previousDraftId !== previousPublishedId) {
        await tx.knowledgeV2DocumentRevision.updateMany({
          where: {
            id: previousDraftId,
            tenantId: attempt.tenantId,
            status: { in: ["READY", "NEEDS_REVIEW", "QUARANTINED", "FAILED"] },
          },
          data: { status: "SUPERSEDED" },
        });
        await tx.knowledgeV2Chunk.updateMany({
          where: { tenantId: attempt.tenantId, revisionId: previousDraftId },
          data: { indexState: "DELETED", deletedAt: now },
        });
        await tx.knowledgeV2DeletionLedger.createMany({
          data: ["VECTOR_INDEX", "CACHE"].map((subsystem) => ({
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            sourceGeneration: attempt.generation,
            targetType: "REVISION",
            targetId: previousDraftId,
            subsystem,
            deniedAt: now,
          })),
          skipDuplicates: true,
        });
        await tx.knowledgeV2ReviewItem.updateMany({
          where: {
            tenantId: attempt.tenantId,
            v2DocumentRevisionId: previousDraftId,
            status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
          },
          data: {
            status: "SUPERSEDED",
            assignedToUserId: null,
            assignedAt: null,
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
        });
      }
      await tx.knowledgeV2Document.update({
        where: { id: documentId },
        data: {
          canonicalUri: prepared.existingArtifact ? null : prepared.acquisition.finalUrl,
          title: documentTitle,
          canonicalLocale: prepared.locale,
          scope,
          audience: audiences.length > 0 ? audiences : Prisma.DbNull,
          classification: prepared.security.classification,
          permissionVersion: source.sourcePermissionVersion,
          currentDraftRevisionId: revisionId,
          status: documentStatus,
          sourceUpdatedAt: now,
          tombstonedAt: null,
          deletedAt: null,
        },
      });
      await tx.knowledgeV2Source.update({
        where: { id: source.id },
        data: {
          status: sourceStatusAfterRevision(revisionStatus),
          ...(revisionStatus === "CHUNKING" ? {} : { lastSuccessAt: now }),
          sourceObservedAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
          etag: { increment: 1 },
        },
      });
      await tx.knowledgeV2Settings.upsert({
        where: { tenantId: attempt.tenantId },
        create: { tenantId: attempt.tenantId, draftGeneration: 2 },
        update: { draftGeneration: { increment: 1 } },
      });
      assertNotAborted(signal, "CHUNKING");
      return {
        status: revisionStatus === "QUARANTINED" ? "quarantined" : "succeeded",
        revisionId,
        documentId,
        objectsReferenced: true,
        queryable: false,
      } satisfies PersistedWebsiteResult;
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}

async function ingestWebsite(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
): Promise<KnowledgeIngestionResult> {
  const prepared = await prepareWebsite(attempt, dependencies, signal);
  return ingestPreparedContent(attempt, dependencies, signal, prepared);
}

async function ingestFile(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
): Promise<KnowledgeIngestionResult> {
  const prepared = await prepareFile(attempt, dependencies, signal);
  return ingestPreparedContent(attempt, dependencies, signal, prepared);
}

async function ingestPreparedContent(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
  prepared: PreparedWebsiteContent,
): Promise<KnowledgeIngestionResult> {
  const unchanged = await noChangeWebsite(attempt, dependencies, signal, prepared);
  if (unchanged) {
    await setStage(attempt, dependencies, "CHUNKING", 5);
    await processReconciliationLedgers(attempt, dependencies, signal);
    await setStage(attempt, dependencies, "CHUNKING", INGESTION_STEPS);
    return {
      status: unchanged.status,
      operation: attempt.operation,
      stage: "CHUNKING",
      documentId: unchanged.documentId,
      ...(unchanged.revisionId ? { revisionId: unchanged.revisionId } : {}),
    };
  }

  await setStage(attempt, dependencies, "CHUNKING", 5);
  assertNotAborted(signal, "CHUNKING");
  const store = dependencies.objectStore;
  if (!store) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      false,
      "CHUNKING",
    );
  }
  const identity = `${attempt.knowledgeJobId}:${prepared.acquisition.body.sha256}:${prepared.contentHash}`;
  const rawObjectKey = createDeterministicKnowledgeObjectKey({
    tenantId: attempt.tenantId,
    sourceId: attempt.sourceId,
    purpose: "raw",
    identity,
  });
  const extractedObjectKey = createDeterministicKnowledgeObjectKey({
    tenantId: attempt.tenantId,
    sourceId: attempt.sourceId,
    purpose: "extracted",
    identity,
  });
  let rawWrite: Awaited<ReturnType<typeof putOrVerify>> | undefined;
  let extractedWrite: Awaited<ReturnType<typeof putOrVerify>> | undefined;
  try {
    rawWrite = prepared.existingArtifact
      ? {
          result: {
            key: prepared.existingArtifact.objectStorageKey,
            encryptionKeyRef: prepared.existingArtifact.encryptionKeyRef,
            plaintextBytes: prepared.acquisition.body.byteLength,
            storedBytes: 0,
          },
          created: false,
        }
      : await putOrVerify(
          store,
          rawObjectKey,
          prepared.acquisition.body.bytes,
          dependencies.objectEncryptionKeyRef,
        );
    extractedWrite = await putOrVerify(
      store,
      extractedObjectKey,
      extractedContentBytes(prepared),
      rawWrite.result.encryptionKeyRef,
    );
  } catch (error) {
    if (rawWrite?.created) await store.delete(rawObjectKey).catch(() => undefined);
    if (extractedWrite?.created) await store.delete(extractedObjectKey).catch(() => undefined);
    throw error;
  }
  try {
    assertNotAborted(signal, "CHUNKING");
    await dependencies.failpoint?.("AFTER_OBJECTS");
  } catch (error) {
    if (!(error instanceof KnowledgeIngestionCrashError)) {
      if (rawWrite.created) await store.delete(rawObjectKey).catch(() => undefined);
      if (extractedWrite.created) await store.delete(extractedObjectKey).catch(() => undefined);
    }
    throw error;
  }
  let persisted: PersistedWebsiteResult;
  try {
    persisted = await persistWebsite(
      attempt,
      dependencies,
      signal,
      prepared,
      prepared.existingArtifact?.objectStorageKey ?? rawObjectKey,
      extractedObjectKey,
      rawWrite.result.encryptionKeyRef,
    );
  } catch (error) {
    if (!(error instanceof KnowledgeIngestionCrashError)) {
      if (rawWrite.created) await store.delete(rawObjectKey).catch(() => undefined);
      if (extractedWrite.created) await store.delete(extractedObjectKey).catch(() => undefined);
    }
    throw error;
  }
  if (!persisted.objectsReferenced) {
    if (rawWrite.created) await store.delete(rawObjectKey).catch(() => undefined);
    if (extractedWrite.created) await store.delete(extractedObjectKey).catch(() => undefined);
  }
  await dependencies.failpoint?.("AFTER_DATABASE_COMMIT");
  await processReconciliationLedgers(attempt, dependencies, signal);
  assertNotAborted(signal, "CHUNKING");
  await setStage(attempt, dependencies, "CHUNKING", INGESTION_STEPS);
  return {
    status: persisted.status,
    operation: attempt.operation,
    stage: "CHUNKING",
    ...(persisted.documentId ? { documentId: persisted.documentId } : {}),
    ...(persisted.revisionId ? { revisionId: persisted.revisionId } : {}),
  };
}

function reconcilePipelineVersion(
  revision: KnowledgeV2DocumentRevision,
  permissionVersion: number,
) {
  return `${revision.pipelineVersion}:permission-${permissionVersion}`.slice(0, 190);
}

async function reconcileSource(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
): Promise<KnowledgeIngestionResult> {
  await setStage(attempt, dependencies, "RECONCILING", 0, 1);
  assertNotAborted(signal, "RECONCILING");
  const result = await dependencies.prisma.$transaction(
    async (tx) => {
      const job = await lockJob(tx, attempt.knowledgeJobId);
      const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
      if (
        !job ||
        job.status !== "RUNNING" ||
        job.attemptCount !== attempt.attempt ||
        !source ||
        source.generation !== attempt.generation
      ) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_SOURCE_GENERATION_STALE",
          false,
          "RECONCILING",
        );
      }
      await assertActorAuthorized(tx, attempt);
      const now = dependencies.now();
      if (job.v2RevisionId) {
        const excluded = await tx.knowledgeV2DocumentRevision.findFirst({
          where: {
            id: job.v2RevisionId,
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
          },
        });
        if (!excluded || excluded.status !== "REJECTED") {
          throw new KnowledgeIngestionError(
            "KNOWLEDGE_VALIDATION_JOB_INVALID",
            false,
            "RECONCILING",
          );
        }
        await tx.knowledgeV2Chunk.updateMany({
          where: { tenantId: attempt.tenantId, revisionId: excluded.id },
          data: { indexState: "DELETED", deletedAt: now },
        });
        await tx.knowledgeV2ReviewItem.updateMany({
          where: {
            tenantId: attempt.tenantId,
            v2DocumentRevisionId: excluded.id,
            status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
          },
          data: {
            status: "SUPERSEDED",
            assignedToUserId: null,
            assignedAt: null,
            etag: { increment: 1 },
            generation: { increment: 1 },
          },
        });
        const remainingNeedsReview = await tx.knowledgeV2Document.count({
          where: {
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            status: "NEEDS_REVIEW",
          },
        });
        await tx.knowledgeV2Source.update({
          where: { id: source.id },
          data: {
            status: remainingNeedsReview > 0 ? "NEEDS_REVIEW" : "SYNCING",
            lastErrorCode: null,
            lastErrorAt: null,
            etag: { increment: 1 },
          },
        });
        return {
          revisionId: excluded.id,
          documentId: excluded.documentId,
          pendingIndex: false,
        };
      }

      const fingerprint = permissionFingerprint(source);
      const scope = source.defaultScope ?? Prisma.DbNull;
      const audiences = sourceAudiences(source);
      const documents = await tx.knowledgeV2Document.findMany({
        where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId, deletedAt: null },
        include: {
          currentDraftRevision: {
            include: {
              elements: { orderBy: { ordinal: "asc" } },
              chunks: { orderBy: { ordinal: "asc" } },
            },
          },
        },
        orderBy: { id: "asc" },
      });
      await tx.knowledgeV2Chunk.updateMany({
        where: {
          tenantId: attempt.tenantId,
          document: { sourceId: attempt.sourceId },
          permissionVersion: { not: source.sourcePermissionVersion },
        },
        data: { indexState: "DELETED", deletedAt: now },
      });
      let created = 0;
      let changed = 0;
      let needsReview = false;
      let pendingIndex = false;
      for (const document of documents) {
        const revision = document.currentDraftRevision;
        const classification = strongestClassification(
          document.classification,
          source.defaultClassification,
        );
        const permissionChanged =
          document.permissionVersion !== source.sourcePermissionVersion ||
          document.classification !== classification ||
          stableKnowledgeValue(document.scope) !== stableKnowledgeValue(source.defaultScope) ||
          stableKnowledgeValue(document.audience) !==
            stableKnowledgeValue(audiences.length > 0 ? audiences : null);
        if (permissionChanged) {
          await tx.knowledgeV2Document.update({
            where: { id: document.id },
            data: {
              scope,
              audience: audiences.length > 0 ? audiences : Prisma.DbNull,
              classification,
              permissionVersion: source.sourcePermissionVersion,
              deletionGeneration: { increment: 1 },
            },
          });
          changed += 1;
        }
        if (!revision || revision.sourcePermissionFingerprint === fingerprint) {
          if (revision && ["QUARANTINED", "NEEDS_REVIEW"].includes(revision.status)) {
            needsReview = true;
          }
          if (revision?.status === "CHUNKING") pendingIndex = true;
          continue;
        }
        const revisionId = dependencies.id();
        const revisionNumber =
          ((
            await tx.knowledgeV2DocumentRevision.aggregate({
              where: { tenantId: attempt.tenantId, documentId: document.id },
              _max: { revisionNumber: true },
            })
          )._max.revisionNumber ?? 0) + 1;
        const nextStatus =
          revision.status === "QUARANTINED"
            ? ("QUARANTINED" as const)
            : revision.status === "NEEDS_REVIEW"
              ? ("NEEDS_REVIEW" as const)
              : ("CHUNKING" as const);
        needsReview ||= nextStatus === "QUARANTINED" || nextStatus === "NEEDS_REVIEW";
        await tx.knowledgeV2DocumentRevision.create({
          data: {
            id: revisionId,
            tenantId: attempt.tenantId,
            sourceId: attempt.sourceId,
            documentId: document.id,
            revisionNumber,
            contentHash: revision.contentHash,
            artifactId: revision.artifactId,
            extractedContentObjectKey: revision.extractedContentObjectKey,
            status: nextStatus,
            parserVersion: revision.parserVersion,
            ocrVersion: revision.ocrVersion,
            normalizerVersion: revision.normalizerVersion,
            extractorVersion: revision.extractorVersion,
            chunkerVersion: revision.chunkerVersion,
            embeddingVersion: revision.embeddingVersion,
            sparseIndexVersion: revision.sparseIndexVersion,
            pipelineVersion: reconcilePipelineVersion(revision, source.sourcePermissionVersion),
            detectedLocale: revision.detectedLocale,
            characterCount: revision.characterCount,
            tokenCount: revision.tokenCount,
            pageCount: revision.pageCount,
            tableCount: revision.tableCount,
            imageCount: revision.imageCount,
            extractionCoverage: revision.extractionCoverage,
            parserQuality: revision.parserQuality ?? Prisma.DbNull,
            sourcePermissionFingerprint: fingerprint,
            scopeSnapshot: scope,
            effectiveFrom: revision.effectiveFrom,
            effectiveUntil: revision.effectiveUntil,
            staleAfter: revision.staleAfter,
            supersedesRevisionId: revision.id,
            generation: attempt.generation,
            createdByUserId: attempt.requestedByUserId,
          },
        });
        const elementIds = new Map<string, string>();
        for (const element of revision.elements) elementIds.set(element.id, dependencies.id());
        for (const element of revision.elements) {
          await tx.knowledgeV2Element.create({
            data: {
              id: elementIds.get(element.id)!,
              tenantId: attempt.tenantId,
              documentId: document.id,
              revisionId,
              kind: element.kind,
              ordinal: element.ordinal,
              parentElementId: element.parentElementId
                ? (elementIds.get(element.parentElementId) ?? null)
                : null,
              headingPath: element.headingPath,
              pageNumber: element.pageNumber,
              boundingBox: element.boundingBox ?? Prisma.DbNull,
              urlAnchor: element.urlAnchor,
              sheetName: element.sheetName,
              sheetRange: element.sheetRange,
              normalizedText: element.normalizedText,
              objectStorageKey: element.objectStorageKey,
              contentHash: element.contentHash,
              parserConfidence: element.parserConfidence,
              locale: element.locale,
              classification,
            },
          });
        }
        for (const chunk of revision.chunks) {
          const chunkId = dependencies.id();
          await tx.knowledgeV2Chunk.create({
            data: {
              id: chunkId,
              tenantId: attempt.tenantId,
              revisionId,
              documentId: document.id,
              ordinal: chunk.ordinal,
              parentElementId: chunk.parentElementId
                ? (elementIds.get(chunk.parentElementId) ?? null)
                : null,
              parentSectionId: chunk.parentSectionId
                ? (elementIds.get(chunk.parentSectionId) ?? null)
                : null,
              contentHash: chunk.contentHash,
              tokenCount: chunk.tokenCount,
              locale: chunk.locale,
              scope,
              classification,
              permissionVersion: source.sourcePermissionVersion,
              denseSchemaVersion: chunk.denseSchemaVersion,
              sparseSchemaVersion: chunk.sparseSchemaVersion,
              pipelineVersion: dependencies.pipelineVersion,
              vectorPointId: deterministicPointId(
                `${attempt.tenantId}:${revisionId}:${chunkId}:${chunk.denseSchemaVersion}`,
              ),
              indexState: "PENDING",
              provenanceRange:
                chunk.provenanceRange === null
                  ? { schemaVersion: 1 }
                  : (chunk.provenanceRange as Prisma.InputJsonValue),
            },
          });
        }
        if (nextStatus !== "CHUNKING") {
          await createRevisionReview(tx, dependencies, {
            attempt,
            sourceId: source.id,
            documentId: document.id,
            revisionId,
            contentHash: revision.contentHash,
            permissionFingerprint: fingerprint,
            extractedObjectKey: revision.extractedContentObjectKey,
            locatorHash: hashKnowledgeValue(
              stableKnowledgeValue({ documentId: document.id, revisionId }),
            ),
            security: reconciledReviewSecurity({
              status: nextStatus,
              classification,
              parserQuality: revision.parserQuality,
            }),
            now,
          });
        }
        if (revision.status !== "PUBLISHED") {
          await tx.knowledgeV2DocumentRevision.updateMany({
            where: { id: revision.id, tenantId: attempt.tenantId },
            data: { status: "SUPERSEDED" },
          });
          await tx.knowledgeV2ReviewItem.updateMany({
            where: {
              tenantId: attempt.tenantId,
              v2DocumentRevisionId: revision.id,
              status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
            },
            data: {
              status: "SUPERSEDED",
              assignedToUserId: null,
              assignedAt: null,
              etag: { increment: 1 },
              generation: { increment: 1 },
            },
          });
        }
        await tx.knowledgeV2Document.update({
          where: { id: document.id },
          data: {
            currentDraftRevisionId: revisionId,
            status: nextStatus === "CHUNKING" ? "DISCOVERED" : "NEEDS_REVIEW",
          },
        });
        created += 1;
        pendingIndex ||= nextStatus === "CHUNKING";
      }
      await tx.knowledgeV2Source.update({
        where: { id: source.id },
        data: {
          status: needsReview ? "NEEDS_REVIEW" : "SYNCING",
          lastErrorCode: null,
          lastErrorAt: null,
          etag: { increment: 1 },
        },
      });
      if (created > 0 || changed > 0) {
        await tx.knowledgeV2Settings.upsert({
          where: { tenantId: attempt.tenantId },
          create: { tenantId: attempt.tenantId, draftGeneration: 2 },
          update: { draftGeneration: { increment: 1 } },
        });
      }
      return { revisionId: undefined, documentId: undefined, pendingIndex };
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
  await processReconciliationLedgers(
    attempt,
    dependencies,
    signal,
    attempt.revisionId
      ? { type: "REVISION", id: attempt.revisionId }
      : { type: "SOURCE", id: attempt.sourceId },
  );
  assertNotAborted(signal, "RECONCILING");
  return {
    status: "succeeded",
    operation: attempt.operation,
    stage: "RECONCILING",
    ...(result.revisionId ? { revisionId: result.revisionId } : {}),
    ...(result.documentId ? { documentId: result.documentId } : {}),
  };
}

async function claimDeletionLedger(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  ledgerId: string,
) {
  const now = dependencies.now();
  const claimed = await dependencies.prisma.knowledgeV2DeletionLedger.updateMany({
    where: {
      id: ledgerId,
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      sourceGeneration: attempt.generation,
      status: { in: ["PENDING", "FAILED", "IN_PROGRESS"] },
      OR: [{ notBefore: null }, { notBefore: { lte: now } }],
    },
    data: {
      status: "IN_PROGRESS",
      startedAt: now,
      attemptCount: { increment: 1 },
      lastErrorCode: null,
    },
  });
  return claimed.count === 1 ? now : null;
}

async function completeDeletionLedger(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  ledgerId: string,
  claimStartedAt: Date,
) {
  const completed = await dependencies.prisma.knowledgeV2DeletionLedger.updateMany({
    where: {
      id: ledgerId,
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      sourceGeneration: attempt.generation,
      status: "IN_PROGRESS",
      startedAt: claimStartedAt,
    },
    data: {
      status: "COMPLETED",
      completedAt: dependencies.now(),
      lastErrorCode: null,
    },
  });
  if (completed.count !== 1) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, attempt.stage);
  }
}

async function failDeletionLedger(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  ledgerId: string,
  claimStartedAt: Date,
  error: KnowledgeIngestionError,
) {
  await dependencies.prisma.knowledgeV2DeletionLedger.updateMany({
    where: {
      id: ledgerId,
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      sourceGeneration: attempt.generation,
      status: "IN_PROGRESS",
      startedAt: claimStartedAt,
    },
    data: { status: "FAILED", lastErrorCode: error.code },
  });
}

async function assertAttemptFence(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
) {
  await dependencies.prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, attempt.knowledgeJobId);
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    if (
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt ||
      job.generation !== attempt.generation ||
      !source ||
      source.generation !== attempt.generation ||
      source.status === "DELETING" ||
      source.status === "DELETED"
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, attempt.stage);
    }
    await assertActorAuthorized(tx, attempt);
  });
}

async function assertDeletionFence(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
) {
  await dependencies.prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, attempt.knowledgeJobId);
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    if (
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt ||
      job.generation !== attempt.generation ||
      !source ||
      source.generation !== attempt.generation ||
      source.status !== "DELETING"
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CLEANING_UP");
    }
    await assertActorAuthorized(tx, attempt);
  });
}

async function acknowledgedVectorPointIds(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  ledger: Pick<KnowledgeV2DeletionLedger, "targetType" | "targetId">,
) {
  if (ledger.targetType !== "SOURCE" && ledger.targetType !== "REVISION") {
    throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_INVALID", false, attempt.stage);
  }
  const items = await dependencies.prisma.knowledgeV2IndexSnapshotItem.findMany({
    where: {
      tenantId: attempt.tenantId,
      chunk: {
        indexState: "DELETED",
        indexedAt: { not: null },
        ...(ledger.targetType === "SOURCE"
          ? { document: { sourceId: attempt.sourceId } }
          : { revisionId: ledger.targetId, revision: { sourceId: attempt.sourceId } }),
      },
    },
    select: {
      snapshotId: true,
      vectorPointId: true,
      chunk: {
        select: {
          permissionVersion: true,
          revision: { select: { sourcePermissionFingerprint: true } },
        },
      },
    },
  });
  return vectorPointPartitions(attempt.tenantId, items);
}

function vectorPointPartitions(
  tenantId: string,
  items: ReadonlyArray<{
    snapshotId: string;
    vectorPointId: string;
    chunk: {
      permissionVersion: number;
      revision: { sourcePermissionFingerprint: string };
    };
  }>,
) {
  const groups = new Map<
    string,
    { scope: KnowledgeV2IndexPermissionPartition; pointIds: Set<string> }
  >();
  for (const item of items) {
    const scope: KnowledgeV2IndexPermissionPartition = {
      workspaceId: tenantId,
      indexSnapshotId: item.snapshotId,
      permissionFingerprint: item.chunk.revision.sourcePermissionFingerprint,
      permissionVersion: item.chunk.permissionVersion,
    };
    const key = `${scope.indexSnapshotId}:${scope.permissionFingerprint}:${scope.permissionVersion}`;
    const group = groups.get(key) ?? { scope, pointIds: new Set<string>() };
    group.pointIds.add(item.vectorPointId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    scope: group.scope,
    pointIds: [...group.pointIds],
  }));
}

async function processReconciliationLedgers(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
  requiredTarget?: { type: "SOURCE" | "REVISION"; id: string },
) {
  const ledgers = await dependencies.prisma.knowledgeV2DeletionLedger.findMany({
    where: {
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      sourceGeneration: attempt.generation,
      subsystem: { in: ["VECTOR_INDEX", "CACHE"] },
      targetType: { in: ["SOURCE", "REVISION"] },
    },
    orderBy: [{ targetType: "asc" }, { targetId: "asc" }, { subsystem: "asc" }],
  });
  const groups = new Map<string, KnowledgeV2DeletionLedger[]>();
  for (const ledger of ledgers) {
    const key = `${ledger.targetType}:${ledger.targetId}`;
    const group = groups.get(key) ?? [];
    group.push(ledger);
    groups.set(key, group);
  }
  if (requiredTarget && !groups.has(`${requiredTarget.type}:${requiredTarget.id}`)) {
    throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_INVALID", false, "RECONCILING");
  }
  for (const group of groups.values()) {
    if (
      group.length !== 2 ||
      !group.some((ledger) => ledger.subsystem === "VECTOR_INDEX") ||
      !group.some((ledger) => ledger.subsystem === "CACHE")
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_INVALID", false, attempt.stage);
    }
    for (const ledger of group) {
      if (ledger.status === "COMPLETED") continue;
      assertNotAborted(signal, attempt.stage);
      await assertAttemptFence(attempt, dependencies);
      const claimStartedAt = await claimDeletionLedger(attempt, dependencies, ledger.id);
      if (!claimStartedAt) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
          true,
          attempt.stage,
        );
      }
      try {
        if (ledger.subsystem === "VECTOR_INDEX") {
          const partitions = await acknowledgedVectorPointIds(attempt, dependencies, ledger);
          if (partitions.length > 0 && !dependencies.vectorCleaner) {
            throw new KnowledgeIngestionError(
              "KNOWLEDGE_DEPENDENCY_VECTOR_CLEANUP_UNAVAILABLE",
              true,
              attempt.stage,
            );
          }
          for (const partition of partitions) {
            for (let offset = 0; offset < partition.pointIds.length; offset += 256) {
              assertNotAborted(signal, attempt.stage);
              await dependencies.vectorCleaner?.deletePoints({
                scope: partition.scope,
                pointIds: partition.pointIds.slice(offset, offset + 256),
              });
            }
          }
        } else {
          await dependencies.invalidateCache?.(attempt.tenantId, attempt.sourceId);
        }
        await assertAttemptFence(attempt, dependencies);
        await completeDeletionLedger(attempt, dependencies, ledger.id, claimStartedAt);
      } catch (error) {
        const normalized = normalizedError(error, attempt.stage);
        await failDeletionLedger(attempt, dependencies, ledger.id, claimStartedAt, normalized);
        throw normalized;
      }
    }
  }
}

async function deletePostgresContent(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
) {
  const now = dependencies.now();
  await dependencies.prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, attempt.knowledgeJobId);
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    if (
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt ||
      !source ||
      source.generation !== attempt.generation ||
      source.status !== "DELETING"
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CLEANING_UP");
    }
    assertNotAborted(signal, "CLEANING_UP");
    await assertActorAuthorized(tx, attempt);
    await tx.knowledgeV2Element.updateMany({
      where: { tenantId: attempt.tenantId, revision: { sourceId: attempt.sourceId } },
      data: { normalizedText: null, objectStorageKey: null },
    });
    await tx.knowledgeV2Chunk.updateMany({
      where: { tenantId: attempt.tenantId, document: { sourceId: attempt.sourceId } },
      data: { indexState: "DELETED", deletedAt: now },
    });
    await tx.knowledgeV2ReviewItem.updateMany({
      where: {
        tenantId: attempt.tenantId,
        sourceId: attempt.sourceId,
        status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
      },
      data: {
        status: "SUPERSEDED",
        assignedToUserId: null,
        assignedAt: null,
        restrictedPayloadRef: null,
        etag: { increment: 1 },
        generation: { increment: 1 },
      },
    });
    await tx.knowledgeV2DocumentRevision.updateMany({
      where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId },
      data: { status: "DELETED", deletedAt: now },
    });
    await tx.knowledgeV2Document.updateMany({
      where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId },
      data: { status: "DELETED", deletedAt: now, tombstonedAt: now, sourceDeletedAt: now },
    });
  });
}

async function deleteStoredObjects(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
) {
  if (!dependencies.objectStoreConfigured || !dependencies.objectStore) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      true,
      "CLEANING_UP",
    );
  }
  const artifacts = await dependencies.prisma.knowledgeV2Artifact.findMany({
    where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId },
    include: { revisions: { select: { extractedContentObjectKey: true } } },
  });
  if (artifacts.some((artifact) => artifact.legalHold)) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SECURITY_LEGAL_HOLD", false, "CLEANING_UP");
  }
  const keys = new Set(
    artifacts.flatMap((artifact) => [
      artifact.objectStorageKey,
      ...artifact.revisions.flatMap((revision) =>
        revision.extractedContentObjectKey ? [revision.extractedContentObjectKey] : [],
      ),
    ]),
  );
  for (const key of keys) {
    assertNotAborted(signal, "CLEANING_UP");
    await dependencies.objectStore.delete(key);
  }
  const now = dependencies.now();
  await dependencies.prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, attempt.knowledgeJobId);
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    if (
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt ||
      !source ||
      source.generation !== attempt.generation ||
      source.status !== "DELETING"
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CLEANING_UP");
    }
    assertNotAborted(signal, "CLEANING_UP");
    await assertActorAuthorized(tx, attempt);
    await tx.knowledgeV2Artifact.updateMany({
      where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId },
      data: { deletionState: "DELETED", deletedAt: now },
    });
    await tx.knowledgeV2DocumentRevision.updateMany({
      where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId },
      data: { extractedContentObjectKey: null },
    });
  });
}

async function deleteVectors(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
) {
  const items = await dependencies.prisma.knowledgeV2IndexSnapshotItem.findMany({
    where: {
      tenantId: attempt.tenantId,
      chunk: {
        document: { sourceId: attempt.sourceId },
        indexedAt: { not: null },
      },
    },
    select: {
      snapshotId: true,
      vectorPointId: true,
      chunk: {
        select: {
          permissionVersion: true,
          revision: { select: { sourcePermissionFingerprint: true } },
        },
      },
    },
  });
  const partitions = vectorPointPartitions(attempt.tenantId, items);
  if (partitions.length === 0) return;
  if (!dependencies.vectorCleaner) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_VECTOR_CLEANUP_UNAVAILABLE",
      true,
      "CLEANING_UP",
    );
  }
  for (const partition of partitions) {
    for (let offset = 0; offset < partition.pointIds.length; offset += 256) {
      assertNotAborted(signal, "CLEANING_UP");
      await dependencies.vectorCleaner.deletePoints({
        scope: partition.scope,
        pointIds: partition.pointIds.slice(offset, offset + 256),
      });
    }
  }
}

async function deleteEmbeddingCacheForSource(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
) {
  const contentRows = await dependencies.prisma.knowledgeV2Chunk.findMany({
    where: { tenantId: attempt.tenantId, document: { sourceId: attempt.sourceId } },
    select: { contentHash: true },
    distinct: ["contentHash"],
  });
  if (contentRows.length === 0) return;
  if (!dependencies.objectStore) {
    throw new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      true,
      "CLEANING_UP",
    );
  }
  for (const { contentHash } of contentRows) {
    const retainedReferences = await dependencies.prisma.knowledgeV2Chunk.count({
      where: {
        tenantId: attempt.tenantId,
        contentHash,
        deletedAt: null,
        document: { sourceId: { not: attempt.sourceId } },
      },
    });
    if (retainedReferences > 0) continue;
    const cacheRows = await dependencies.prisma.knowledgeV2EmbeddingCache.findMany({
      where: { tenantId: attempt.tenantId, contentHash, deletedAt: null },
      select: { id: true, objectStorageKey: true },
    });
    for (const row of cacheRows) {
      await dependencies.objectStore.delete(row.objectStorageKey).catch((error: unknown) => {
        if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_NOT_FOUND") {
          throw error;
        }
      });
      await dependencies.prisma.knowledgeV2EmbeddingCache.updateMany({
        where: { id: row.id, tenantId: attempt.tenantId, deletedAt: null },
        data: { deletedAt: dependencies.now() },
      });
    }
  }
}

async function deleteSource(
  attempt: RunningAttempt,
  dependencies: KnowledgeIngestionDependencies,
  signal: AbortSignal,
): Promise<KnowledgeIngestionResult> {
  await setStage(attempt, dependencies, "CLEANING_UP", 0, 1);
  assertNotAborted(signal, "CLEANING_UP");
  await assertDeletionFence(attempt, dependencies);
  const heldArtifacts = await dependencies.prisma.knowledgeV2Artifact.count({
    where: { tenantId: attempt.tenantId, sourceId: attempt.sourceId, legalHold: true },
  });
  if (heldArtifacts > 0) {
    throw new KnowledgeIngestionError("KNOWLEDGE_SECURITY_LEGAL_HOLD", false, "CLEANING_UP");
  }
  const ledgers = await dependencies.prisma.knowledgeV2DeletionLedger.findMany({
    where: {
      tenantId: attempt.tenantId,
      sourceId: attempt.sourceId,
      sourceGeneration: attempt.generation,
    },
    orderBy: { subsystem: "asc" },
  });
  const expected = new Set(["POSTGRES_CONTENT", "OBJECT_STORAGE", "VECTOR_INDEX", "CACHE"]);
  if (
    ledgers.length !== expected.size ||
    ledgers.some((ledger) => !expected.has(ledger.subsystem))
  ) {
    throw new KnowledgeIngestionError("KNOWLEDGE_VALIDATION_JOB_INVALID", false, "CLEANING_UP");
  }
  for (const ledger of ledgers) {
    if (ledger.status === "COMPLETED") continue;
    assertNotAborted(signal, "CLEANING_UP");
    await assertDeletionFence(attempt, dependencies);
    const claimStartedAt = await claimDeletionLedger(attempt, dependencies, ledger.id);
    if (!claimStartedAt) {
      throw new KnowledgeIngestionError(
        "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
        true,
        "CLEANING_UP",
      );
    }
    try {
      if (ledger.subsystem === "POSTGRES_CONTENT") {
        await deletePostgresContent(attempt, dependencies, signal);
      } else if (ledger.subsystem === "OBJECT_STORAGE") {
        await deleteStoredObjects(attempt, dependencies, signal);
      } else if (ledger.subsystem === "VECTOR_INDEX") {
        await deleteVectors(attempt, dependencies, signal);
      } else {
        await deleteEmbeddingCacheForSource(attempt, dependencies);
        await dependencies.invalidateCache?.(attempt.tenantId, attempt.sourceId);
      }
      await assertDeletionFence(attempt, dependencies);
      await completeDeletionLedger(attempt, dependencies, ledger.id, claimStartedAt);
    } catch (error) {
      const normalized = normalizedError(error, "CLEANING_UP");
      await failDeletionLedger(attempt, dependencies, ledger.id, claimStartedAt, normalized);
      throw normalized;
    }
  }
  assertNotAborted(signal, "CLEANING_UP");
  await dependencies.prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, attempt.knowledgeJobId);
    const source = await lockSource(tx, attempt.tenantId, attempt.sourceId);
    const incomplete = await tx.knowledgeV2DeletionLedger.count({
      where: {
        tenantId: attempt.tenantId,
        sourceId: attempt.sourceId,
        sourceGeneration: attempt.generation,
        status: { not: "COMPLETED" },
      },
    });
    if (
      !job ||
      job.status !== "RUNNING" ||
      job.attemptCount !== attempt.attempt ||
      !source ||
      source.generation !== attempt.generation ||
      source.status !== "DELETING" ||
      incomplete !== 0
    ) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_GENERATION_STALE", false, "CLEANING_UP");
    }
    const now = dependencies.now();
    await tx.knowledgeV2Source.update({
      where: { id: source.id },
      data: {
        status: "DELETED",
        deletedAt: now,
        lastErrorCode: null,
        lastErrorAt: null,
        etag: { increment: 1 },
      },
    });
  });
  return { status: "succeeded", operation: attempt.operation, stage: "CLEANING_UP" };
}

export async function processKnowledgeIngestionJob(
  input: KnowledgeIngestionJobInput,
  dependencies: KnowledgeIngestionDependencies,
): Promise<KnowledgeIngestionResult> {
  let attempt: RunningAttempt | null = null;
  try {
    if (!isKnowledgeIngestionRuntimeData(input.data as unknown as Record<string, unknown>)) {
      throw new KnowledgeIngestionError("KNOWLEDGE_SOURCE_RUNTIME_INVALID", false, "ACQUIRING");
    }
    assertNotAborted(input.signal, operationStage(input.data.operation));
    const started = await beginAttempt(input, dependencies);
    if ("status" in started) return started;
    attempt = started;
    assertNotAborted(input.signal, attempt.stage);
    const result =
      attempt.operation === "IMPORT" || attempt.operation === "SYNC"
        ? attempt.source.kind === "FILE"
          ? await ingestFile(attempt, dependencies, input.signal)
          : await ingestWebsite(attempt, dependencies, input.signal)
        : attempt.operation === "RECONCILE"
          ? await reconcileSource(attempt, dependencies, input.signal)
          : await deleteSource(attempt, dependencies, input.signal);
    await completeAttempt(attempt, dependencies, result);
    return result;
  } catch (error) {
    attempt ??= runningAttemptFromError(error);
    const normalized = normalizedError(
      error,
      attempt?.stage ?? operationStage(input.data.operation),
    );
    if (attempt) await failAttempt(attempt, dependencies, normalized);
    throw normalized;
  }
}

function environmentKeyId() {
  return process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID?.trim() || "knowledge-artifact-v1";
}

function environmentObjectStore() {
  const rootPath = process.env.KNOWLEDGE_OBJECT_STORE_PATH?.trim() ?? "";
  const encodedKey = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY?.trim() ?? "";
  const keyId = environmentKeyId();
  if (!rootPath || !isAbsolute(rootPath) || !encodedKey) return null;
  try {
    return new EncryptedFileKnowledgeObjectStore({
      rootPath,
      activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(encodedKey) },
      maxPlaintextBytes: Math.min(
        64 * 1024 * 1024,
        Math.max(
          positiveInteger(
            process.env.KNOWLEDGE_MAX_WEBSITE_BYTES,
            2 * 1024 * 1024,
            16 * 1024 * 1024,
          ) * 3 + 64 * 1024,
          positiveInteger(
            process.env.KNOWLEDGE_MAX_FILE_BYTES,
            10 * 1024 * 1024,
            10 * 1024 * 1024,
          ),
        ),
      ),
    });
  } catch {
    return null;
  }
}

export function createKnowledgeIngestionDependencies(
  prisma: PrismaClient,
  overrides: Partial<KnowledgeIngestionDependencies> = {},
): KnowledgeIngestionDependencies {
  const maxWebsiteBytes = positiveInteger(
    process.env.KNOWLEDGE_MAX_WEBSITE_BYTES,
    2 * 1024 * 1024,
    16 * 1024 * 1024,
  );
  const maxFileBytes = positiveInteger(
    process.env.KNOWLEDGE_MAX_FILE_BYTES,
    10 * 1024 * 1024,
    10 * 1024 * 1024,
  );
  const fetchTimeoutMs = positiveInteger(
    process.env.KNOWLEDGE_WEBSITE_FETCH_TIMEOUT_MS,
    10_000,
    60_000,
  );
  const acceptanceFixture = knowledgeAcceptanceWebsiteFixtureEnabled(process.env)
    ? createKnowledgeAcceptanceWebsiteFixture()
    : null;
  const connector = createPinnedHttpsWebsiteSourceConnector({
    timeoutMs: fetchTimeoutMs,
    maxBodyBytes: maxWebsiteBytes,
    ...(acceptanceFixture ? { transport: acceptanceFixture.transport } : {}),
  });
  const objectStore =
    overrides.objectStore === undefined ? environmentObjectStore() : overrides.objectStore;
  const qdrantEnabled =
    process.env.RAG_RETRIEVAL_MODE === "qdrant" || enabled(process.env.RAG_QDRANT_ENABLED);
  const qdrant = qdrantEnabled
    ? new KnowledgeV2HybridQdrantClient({
        qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
        ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
        collectionPrefix: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
        dense: {
          vectorName: "dense",
          schemaVersion: "knowledge-dense-v1",
          provider: "openai-compatible",
          model: process.env.KNOWLEDGE_V2_EMBEDDING_MODEL ?? "text-embedding-3-small",
          dimensions: positiveInteger(process.env.KNOWLEDGE_V2_EMBEDDING_DIMENSIONS, 1536, 65_536),
          distance: "Cosine",
        },
        sparse: {
          vectorName: "sparse",
          schemaVersion: "knowledge-sparse-v1",
          provider: "leadvirt",
          model: "unicode-hash-tf-v1",
          maxNonZeroValues: positiveInteger(
            process.env.KNOWLEDGE_V2_SPARSE_MAX_NON_ZERO,
            2048,
            65_536,
          ),
        },
        requestTimeoutMs: positiveInteger(process.env.RAG_QDRANT_TIMEOUT_MS, 3_000, 60_000),
        maxAttempts: 3,
        retryBaseDelayMs: 250,
        maxBatchSize: 256,
        maxReconcilePoints: 100_000,
      })
    : null;
  const defaults: KnowledgeIngestionDependencies = {
    prisma,
    objectStore,
    objectEncryptionKeyRef: environmentKeyId(),
    websiteImportEnabled: enabled(process.env.KNOWLEDGE_WEBSITE_IMPORT_ENABLED),
    websiteEgressReady: enabled(process.env.KNOWLEDGE_WEBSITE_EGRESS_READY),
    fileImportEnabled: enabled(process.env.KNOWLEDGE_FILE_IMPORT_ENABLED),
    objectStoreConfigured: objectStore !== null,
    pipelineVersion: PIPELINE_VERSION,
    maxWebsiteBytes,
    maxFileBytes,
    staleAttemptMs: positiveInteger(process.env.WORKER_JOB_TIMEOUT_MS, 30_000, 10 * 60_000) + 5_000,
    workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
    async acquireWebsite(url, signal) {
      const connected = await connectWebsiteSource(url, {
        connector,
        connectionTimeoutMs: fetchTimeoutMs,
        ...(acceptanceFixture ? { resolver: acceptanceFixture.resolver } : {}),
        signal,
      });
      if (!connected.ok || !connected.value.response.body) {
        throw new KnowledgeIngestionError(
          "KNOWLEDGE_DEPENDENCY_SOURCE_FETCH_FAILED",
          connected.ok
            ? false
            : connected.reason.code === "DNS_LOOKUP_FAILED" ||
                connected.reason.code === "CONNECTION_FAILED",
          "ACQUIRING",
        );
      }
      return {
        finalUrl: connected.value.finalUrl,
        redirectCount: connected.value.redirects.length,
        body: connected.value.response.body,
      };
    },
    extractWebsite: (body) => extractWebsiteContent(body),
    scanWebsite: scanWebsiteContentSecurity,
    ...(qdrant
      ? {
          vectorCleaner: {
            deletePoints: (input) => qdrant.deletePointIds(input).then(() => undefined),
          },
        }
      : {}),
    now: () => new Date(),
    id: randomUUID,
  };
  return { ...defaults, ...overrides };
}

export function knowledgeIngestionErrorType(error: unknown) {
  const code =
    error instanceof KnowledgeIngestionError
      ? error.code
      : typeof error === "object" && error !== null && "knowledgeCode" in error
        ? String(error.knowledgeCode)
        : "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED";
  if (code.includes("PERMISSION")) return "permission";
  if (code.includes("SECURITY")) return "security";
  if (code.includes("PARSE")) return "parse";
  if (code.includes("SOURCE_GENERATION")) return "stale";
  if (code.includes("VALIDATION")) return "validation";
  if (code.includes("DEPENDENCY")) return "dependency";
  return "source";
}

export function knowledgeIngestionSafeError(error: unknown) {
  if (error instanceof KnowledgeIngestionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      stage: error.stage,
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "knowledgeCode" in error &&
    typeof error.knowledgeCode === "string" &&
    error.knowledgeCode in knowledgeIngestionMessages
  ) {
    const code = error.knowledgeCode as KnowledgeIngestionErrorCode;
    const stage =
      "knowledgeStage" in error &&
      typeof error.knowledgeStage === "string" &&
      [
        "ACQUIRING",
        "SCANNING",
        "PARSING",
        "NORMALIZING",
        "EXTRACTING",
        "CHUNKING",
        "INDEXING",
        "EVALUATING",
        "RECONCILING",
        "CLEANING_UP",
      ].includes(error.knowledgeStage)
        ? (error.knowledgeStage as KnowledgeIngestionStage)
        : "ACQUIRING";
    return {
      code,
      message: knowledgeIngestionMessages[code],
      retryable: false,
      stage,
    };
  }
  return {
    code: "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED" as const,
    message: knowledgeIngestionMessages.KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED,
    retryable: true,
    stage: "ACQUIRING" as KnowledgeIngestionStage,
  };
}
