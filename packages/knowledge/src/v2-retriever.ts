import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@leadvirt/db";
import type {
  AuthenticatedCustomerIdentityReference,
  ChannelType,
  KnowledgeCorpusKind,
  KnowledgeV2Audience,
  KnowledgeV2GateOutcome,
  KnowledgeV2GuidanceCondition,
  KnowledgeV2JsonValue,
  KnowledgeV2RetrievalOutcome,
  KnowledgeV2RetrievalRejectionReason,
  KnowledgeV2RetrievalProcessorPolicy,
  KnowledgeV2RiskLevel,
  KnowledgeV2SecurityClassification,
} from "@leadvirt/types";
import { validAuthenticatedCustomerIdentityReference } from "./authenticated-customer-identity.js";
import type { KnowledgeRetrieveInput } from "./contracts.js";
import type { KnowledgeRetriever } from "./retriever.js";
import {
  createDeterministicKnowledgeObjectKey,
  KnowledgeObjectStoreError,
  type KnowledgeObjectStore,
} from "./encrypted-file-object-store.js";
import { hashKnowledgeValue } from "./legacy-hash-embedding.js";
import { stableKnowledgeValue } from "./publisher.js";
import {
  equalKnowledgeV2QueryHashBindings,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  parseKnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "./tenant-query-hash.js";
import {
  classifyOperationalQuery,
  OPERATIONAL_QUERY_CATEGORIES,
  type OperationalQueryCategory,
  type OperationalQueryClassification,
} from "./operational-query.js";
import {
  admitKnowledgeV2ProcessorQuery,
  equalKnowledgeV2ProcessorQueryAdmissionBindings,
  parseKnowledgeV2ProcessorQueryAdmissionBinding,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  revalidateKnowledgeV2ProcessorQueryAdmission,
  type KnowledgeV2ProcessorQueryAdmissionBinding,
} from "./v2-processor-query-admission.js";
import {
  KnowledgeV2HybridIndexError,
  type KnowledgeV2DenseEmbeddingProvider,
  type KnowledgeV2HybridQdrantClient,
  type KnowledgeV2HybridQueryPoint,
  type KnowledgeV2SparseEncoder,
  validateKnowledgeV2DenseEmbeddingBatch,
  validateKnowledgeV2SparseEncodingBatch,
} from "./v2-hybrid-qdrant.js";
import { KnowledgeV2EmbeddingProviderError } from "./v2-index-encoding.js";
import {
  isKnowledgeV2ScopeSegment,
  knowledgeV2StructuredAuthorizationFingerprint,
  knowledgeV2DocumentPrefilterEnforcesScope,
  KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
  KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
  parseKnowledgeV2PersistedScope,
  parseKnowledgeV2TenantDefaultScopePolicy,
  resolveKnowledgeV2StructuredScope,
  resolveKnowledgeV2PersistedAudiences,
  type KnowledgeV2StructuredScopeBinding,
  type KnowledgeV2TenantDefaultScopePolicy,
} from "./v2-authorization-policy.js";
import {
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS,
  parseKnowledgeV2SnapshotAuthorizationManifest,
  type KnowledgeV2SnapshotAuthorizationManifest,
} from "./v2-snapshot-authorization-manifest.js";

const structuredTargetKey = "workspace-v2";
const legacyTargetKey = "workspace";
const restrictedReferencePrefix = "lvobj:v1:";
const maximumQueryCharacters = 32_000;
const maximumEvidenceCharacters = 8_000;
const terminalPublicationStatuses = ["ACTIVE", "SUPERSEDED", "ROLLED_BACK"] as const;
const runtimeChannelTypes = new Set<ChannelType>([
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "WEBHOOK",
  "PHONE",
  "DEMO",
]);
const runtimeAudiences = new Set<KnowledgeV2Audience>([
  "PUBLIC",
  "AUTHENTICATED_CUSTOMER",
  "INTERNAL",
]);

export type KnowledgeRuntimeCorpus = Extract<KnowledgeCorpusKind, "LEGACY_V1" | "STRUCTURED_V2">;

export const KNOWLEDGE_LIVE_TOOL_POLICY_VERSION = "knowledge-live-tool-v3";
export const KNOWLEDGE_LIVE_TOOL_MAX_TTL_MS = 5 * 60_000;

export type KnowledgeOperationalLiveCategory = Exclude<
  OperationalQueryCategory,
  "STATIC_KNOWLEDGE"
>;

export type KnowledgeV2RuntimeUnavailableReason =
  | "NO_ACTIVE_PUBLICATION"
  | "PUBLICATION_INVALID"
  | "SNAPSHOT_NOT_READY"
  | "SNAPSHOT_INCOMPATIBLE"
  | "DRAFT_SNAPSHOT_UNAVAILABLE"
  | "RESTRICTED_STORAGE_UNAVAILABLE"
  | "EMBEDDING_UNAVAILABLE"
  | "PROCESSOR_POLICY_DENIED"
  | "SPARSE_ENCODING_UNAVAILABLE"
  | "QDRANT_UNAVAILABLE"
  | "RERANKER_UNAVAILABLE"
  | "PERMISSION_PARTITION_UNAVAILABLE"
  | "RUNTIME_NOT_CONFIGURED";

export type KnowledgeV2RuntimeGateReason =
  | "EVIDENCE_READY"
  | "NO_MATCH"
  | "CONFLICT"
  | "STALE_EVIDENCE"
  | "UNAUTHORIZED_EVIDENCE"
  | "HASH_MISMATCH"
  | "LIVE_EVIDENCE_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";

export interface KnowledgeV2LiveToolResult {
  executionId: string;
  toolCallId: string;
  toolKey: string;
  toolVersion: string;
  safeName: string;
  sourceSystem: string;
  operationalCategory: KnowledgeOperationalLiveCategory;
  tenantId: string;
  executionContextId: string;
  queryHash: KnowledgeV2QueryHashBinding;
  requestHash: string;
  authorizationScopeHash: string;
  authorizationDecisionId: string;
  permissionGeneration: number;
  connectionId: string | null;
  connectionPermissionVersion: number | null;
  customerIdentityId: string;
  customerIdentityVersion: 1;
  subjectHash: string;
  resultType: string;
  value: KnowledgeV2JsonValue;
  valueHash: string;
  exactValue: string;
  exactValueHash: string;
  content: string;
  contentHash: string;
  observedAt: string;
  expiresAt: string;
  authorizedAt: string;
  authorizationExpiresAt: string;
  toolPolicyVersion: string;
  status: "SUCCEEDED";
}

export interface KnowledgeV2LiveToolResultReference {
  executionId: string;
}

export interface KnowledgeRuntimeAuthorizationContext {
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  classifications: readonly KnowledgeV2SecurityClassification[];
  queryClassification: KnowledgeV2SecurityClassification;
  brandIds?: readonly string[];
  locationIds?: readonly string[];
  channelIds?: readonly string[];
  assistantIds?: readonly string[];
  segmentIds?: readonly string[];
  intent?: string | null;
  leadStage?: string | null;
  businessHours?: boolean | null;
  executionContextId?: string | null;
  customerIdentity?: AuthenticatedCustomerIdentityReference | null;
  liveToolResults?: readonly KnowledgeV2LiveToolResultReference[];
}

export interface KnowledgeCapturedPublicationTarget {
  corpusKind: KnowledgeRuntimeCorpus;
  snapshotKind: "PUBLICATION";
  targetKey: string;
  publicationId: string;
  publicationSequence: number;
  publicationManifestHash: string;
  indexSnapshotId: string | null;
  indexCollectionName?: string | null;
  indexSchemaHash?: string | null;
  indexAuthorizationManifestVersion?: number | null;
  indexAuthorizationManifestHash?: string | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  retrievalPolicyVersion: string;
  retrievalProcessorPolicyHash?: string | null;
  promptPolicyVersion: string;
  pipelineVersion: string;
}

export interface KnowledgeCapturedDraftTarget {
  corpusKind: "STRUCTURED_V2";
  snapshotKind: "DRAFT_CANDIDATE";
  targetKey: "workspace-v2";
  candidateId: string;
  candidateVersion: number;
  candidateManifestHash: string;
  validationId: string;
  indexSnapshotId: string | null;
  indexCollectionName?: string | null;
  indexSchemaHash?: string | null;
  indexAuthorizationManifestVersion?: number | null;
  indexAuthorizationManifestHash?: string | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  retrievalPolicyVersion: string;
  retrievalProcessorPolicyHash?: string | null;
  promptPolicyVersion: string;
  pipelineVersion: string;
}

export type KnowledgeCapturedTarget =
  | KnowledgeCapturedPublicationTarget
  | KnowledgeCapturedDraftTarget;

export interface KnowledgeV2DraftManifestItem {
  itemType:
    | "DOCUMENT_REVISION"
    | "FACT_VERSION"
    | "GUIDANCE_RULE_VERSION"
    | "SOURCE_PERMISSION_SNAPSHOT";
  itemId: string;
  itemVersionHash: string;
  documentRevisionId?: string | null;
  factVersionId?: string | null;
  guidanceRuleVersionId?: string | null;
  scope?: Prisma.JsonValue | null;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
  authorizationFingerprint: string;
}

export interface KnowledgeV2DraftTarget {
  corpusKind: "STRUCTURED_V2";
  targetKey: "workspace-v2";
  candidateId: string;
  candidateVersion: number;
  candidateManifestHash: string;
  validationId: string;
  indexSnapshotId: string | null;
  snapshotManifestHash: string;
  retrievalPolicyVersion: string;
  retrievalProcessorPolicyHash?: string | null;
  promptPolicyVersion: string;
  pipelineVersion: string;
  snapshotIdentity: KnowledgeV2SnapshotRuntimeIdentity | null;
  items: readonly KnowledgeV2DraftManifestItem[];
}

export interface KnowledgeV2SnapshotRuntimeIdentity {
  collectionName: string;
  embeddingProvider: string;
  embeddingModel: string;
  indexSchema: Prisma.JsonValue;
  indexSchemaHash: string;
  authorizationManifest: KnowledgeV2SnapshotAuthorizationManifest;
  authorizationManifestVersion: number;
  authorizationManifestHash: string;
}

export interface KnowledgeV2DraftSnapshotResolver {
  resolve(input: {
    tenantId: string;
    validationId: string;
    indexSnapshotId: string | null;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash?: string | null;
  }): Promise<KnowledgeV2DraftTarget | null>;
}

export interface KnowledgeV2ExactFactEvidence {
  kind: "FACT";
  evidenceKey: string;
  factId: string;
  versionId: string;
  versionHash: string;
  safeLabel: string;
  value: string;
  valueHash: string;
  riskLevel: KnowledgeV2RiskLevel;
  authority: string;
  verificationStatus: string;
  observedAt?: string | null;
  expiresAt?: string | null;
  score: number;
}

export interface KnowledgeV2GuidanceEvidence {
  kind: "GUIDANCE";
  evidenceKey: string;
  guidanceRuleId: string;
  versionId: string;
  versionHash: string;
  safeLabel: string;
  instruction: string;
  instructionHash: string;
  riskLevel: KnowledgeV2RiskLevel;
  priority: number;
  score: number;
}

export interface KnowledgeV2DocumentEvidence {
  kind: "DOCUMENT";
  evidenceKey: string;
  documentId: string;
  revisionId: string;
  revisionHash: string;
  chunkId: string;
  sourceId: string;
  sourceKind: string;
  title: string;
  content: string;
  contentHash: string;
  classification: KnowledgeV2SecurityClassification;
  locale: string;
  headingPath: string[];
  pageNumber?: number | null;
  urlAnchor?: string | null;
  publicUrl?: string | null;
  permissionFingerprint: string;
  permissionVersion: number;
  fusedRank: number;
  fusedScore: number;
  rerankRank: number;
  rerankScore: number;
}

export interface KnowledgeLegacyDocumentEvidence {
  kind: "LEGACY_DOCUMENT";
  evidenceKey: string;
  chunkId: string;
  revisionId: string;
  sourceId: string;
  sourceKind: string;
  title: string;
  content: string;
  contentHash: string;
  score: number;
}

export interface KnowledgeV2ConflictEvidence {
  conflictId: string;
  safeLabel: string;
  riskLevel: KnowledgeV2RiskLevel;
  status: "OPEN" | "IN_REVIEW";
}

export interface KnowledgeV2SuppressedEvidence {
  reason: KnowledgeV2RetrievalRejectionReason;
  count: number;
}

export interface KnowledgeV2BundleCitation {
  evidenceKey: string;
  claimHash: string;
  ordinal: number;
  confidence?: number | null;
  support?: "SUPPORTS" | "PARTIAL" | "CONTRADICTS" | "NOT_ASSESSED";
}

export interface KnowledgeEvidenceBundle {
  schemaVersion: 1;
  corpusKind: KnowledgeRuntimeCorpus;
  target: KnowledgeCapturedTarget;
  outcome: KnowledgeV2RetrievalOutcome;
  gateOutcome: KnowledgeV2GateOutcome;
  gateReasons: KnowledgeV2RuntimeGateReason[];
  facts: KnowledgeV2ExactFactEvidence[];
  guidance: KnowledgeV2GuidanceEvidence[];
  documents: Array<KnowledgeV2DocumentEvidence | KnowledgeLegacyDocumentEvidence>;
  conflicts: KnowledgeV2ConflictEvidence[];
  missingSupport: KnowledgeV2RuntimeGateReason[];
  suppressedEvidence: KnowledgeV2SuppressedEvidence[];
  citations: KnowledgeV2BundleCitation[];
  liveToolResults: KnowledgeV2LiveToolResult[];
  answerPolicy: {
    requirementHash: string;
    operationalCategory: OperationalQueryCategory;
    queryHash: KnowledgeV2QueryHashBinding;
    processorQueryAdmission: KnowledgeV2ProcessorQueryAdmissionBinding;
    requiresLiveEvidence: boolean;
    staticEvidenceMayAnswer: boolean;
    allowAutoSend: boolean;
  };
}

export interface KnowledgeV2RuntimeDiagnostics {
  backend: "qdrant" | "database";
  corpusKind: KnowledgeRuntimeCorpus | null;
  candidateCount: number;
  hydratedCount: number;
  selectedCount: number;
  durationMs: number;
  degradedReason?: KnowledgeV2RuntimeUnavailableReason | null;
  retrievalPolicyVersion?: string | null;
  rerankerVersion?: string | null;
}

export interface KnowledgeV2TraceCandidateDraft {
  candidateKey: string;
  evidenceKey: string;
  fusedRank: number;
  fusedScore: number;
  rerankRank?: number | null;
  rerankScore?: number | null;
  selected: boolean;
  rejectionReason?: KnowledgeV2RetrievalRejectionReason | null;
  reference: KnowledgeV2TraceEvidenceReferenceDraft;
}

export interface KnowledgeV2TraceEvidenceReferenceDraft {
  evidenceKey: string;
  targetType: "DOCUMENT_REVISION" | "FACT_VERSION" | "GUIDANCE_RULE_VERSION" | "TOOL_RESULT";
  itemVersionHash: string;
  documentRevisionId?: string | null;
  factVersionId?: string | null;
  guidanceRuleVersionId?: string | null;
  toolResultRef?: string | null;
  safeLabel: string;
  locatorHash?: string | null;
  isPublic: boolean;
  confidence?: number | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  permissionFingerprint?: string | null;
}

export interface KnowledgeV2TraceDraft {
  traceKeySeed: string;
  queryHash: KnowledgeV2QueryHashBinding;
  restrictedQueryRef: string;
  restrictedQueryCreated?: boolean;
  filters: Prisma.InputJsonObject;
  filtersHash: string;
  permissionFingerprint: string;
  snapshotKind: "PUBLICATION" | "DRAFT_CANDIDATE";
  targetKey: string;
  publicationId?: string | null;
  candidateId?: string | null;
  candidateVersion?: number | null;
  candidateManifestHash?: string | null;
  retrievalPolicyVersion: string;
  retrievalProcessorPolicyHash?: string | null;
  modelProcessorPolicyHash?: string | null;
  rerankerVersion?: string | null;
  promptPolicyVersion: string;
  graphVersion: string;
  provider?: string | null;
  generatorModel?: string | null;
  providerOutputHash?: string | null;
  gateInputHash?: string | null;
  gateResultHash?: string | null;
  outcome: KnowledgeV2RetrievalOutcome;
  gateOutcome: KnowledgeV2GateOutcome;
  candidates: KnowledgeV2TraceCandidateDraft[];
  citations: KnowledgeV2BundleCitation[];
  latencyMs: number;
}

export interface KnowledgeRuntimeRetrievalSuccess {
  status: "grounded";
  bundle: KnowledgeEvidenceBundle;
  traceDraft?: KnowledgeV2TraceDraft;
  diagnostics: KnowledgeV2RuntimeDiagnostics;
}

export interface KnowledgeRuntimeRetrievalInsufficient {
  status: "insufficient_grounding";
  reason:
    | "NO_MATCH"
    | "CONFLICT"
    | "STALE"
    | "UNAUTHORIZED"
    | "HASH_MISMATCH"
    | "LIVE_EVIDENCE_REQUIRED";
  bundle: KnowledgeEvidenceBundle;
  traceDraft?: KnowledgeV2TraceDraft;
  diagnostics: KnowledgeV2RuntimeDiagnostics;
}

export interface KnowledgeRuntimeRetrievalUnavailable {
  status: "unavailable";
  reason: KnowledgeV2RuntimeUnavailableReason;
  retryable: boolean;
  target?: KnowledgeCapturedTarget | null;
  traceDraft?: KnowledgeV2TraceDraft;
  diagnostics: KnowledgeV2RuntimeDiagnostics;
}

export type KnowledgeRuntimeRetrievalResult =
  | KnowledgeRuntimeRetrievalSuccess
  | KnowledgeRuntimeRetrievalInsufficient
  | KnowledgeRuntimeRetrievalUnavailable;

export interface KnowledgeV2EvidenceRevalidation {
  valid: boolean;
  reason:
    | "VALID"
    | "TARGET_CHANGED"
    | "MEMBERSHIP_CHANGED"
    | "PERMISSION_CHANGED"
    | "EVIDENCE_CHANGED"
    | "EVIDENCE_EXPIRED"
    | "CONFLICT_DETECTED";
  evidenceManifestHash: string;
}

export interface KnowledgeV2PersistedReplyRevalidation {
  valid: boolean;
  reason:
    | "VALID"
    | "TRACE_MISSING"
    | "TARGET_CHANGED"
    | "PERMISSION_CHANGED"
    | "EVIDENCE_CHANGED"
    | "EVIDENCE_EXPIRED"
    | "CONFLICT_DETECTED";
  evidenceManifestHash: string;
  promptPolicyVersion: string | null;
  classifications: KnowledgeV2SecurityClassification[];
}

export interface KnowledgeRuntimeRetrieveInput extends KnowledgeRetrieveInput {
  authorization: KnowledgeRuntimeAuthorizationContext;
  graphVersion: string;
  signal?: AbortSignal;
}

export interface KnowledgeV2RerankCandidate {
  id: string;
  text: string;
  title: string;
  initialScore: number;
}

export interface KnowledgeV2Reranker {
  readonly version: string;
  rerank(
    input: { query: string; locale: string; candidates: readonly KnowledgeV2RerankCandidate[] },
    signal: AbortSignal,
  ): Promise<readonly { id: string; score: number }[]>;
}

export interface HttpKnowledgeV2RerankerConfig {
  endpoint: string;
  apiKey?: string;
  provider: string;
  model: string;
  version: string;
  region: string;
  timeoutMs: number;
  maximumCandidates?: number;
}

export class KnowledgeV2RerankerError extends Error {
  constructor(readonly retryable: boolean) {
    super("The knowledge reranker is unavailable.");
    this.name = "KnowledgeV2RerankerError";
  }
}

export interface KnowledgeV2RestrictedContentStore {
  put(input: {
    tenantId: string;
    identity: string;
    purpose: "query" | "answer" | "trace";
    content: Uint8Array;
  }): Promise<{ reference: string; hash: string; created?: boolean }>;
  delete(reference: string): Promise<void>;
}

export interface KnowledgeV2ProcessorIdentity {
  queryEmbedding: {
    provider: "openai-compatible";
    deployment: string;
    region: string;
    maxClassification: KnowledgeV2SecurityClassification;
  };
  reranker: {
    provider: string;
    model: string;
    version: string;
    region: string;
    maxClassification: KnowledgeV2SecurityClassification;
  };
  policyVersion: string;
}

export interface KnowledgeV2ProcessorAdmission {
  policyVersion: string;
  policyHash: string;
}

export interface KnowledgeV2ProcessorPolicyResolver {
  authorizeQueryEmbedding(input: {
    tenantId: string;
    retrievalPolicyVersion: string;
    classification: KnowledgeV2SecurityClassification;
  }): Promise<KnowledgeV2ProcessorAdmission | null>;
  authorizeReranker(input: {
    tenantId: string;
    retrievalPolicyVersion: string;
    classifications: readonly KnowledgeV2SecurityClassification[];
  }): Promise<KnowledgeV2ProcessorAdmission | null>;
}

export interface KnowledgeV2RetrieverPolicy {
  candidateLimit: number;
  documentLimit: number;
  maximumChunksPerDocument: number;
  maximumFacts: number;
  maximumGuidance: number;
  minimumRerankScore: number;
  maximumParentCharacters: number;
  retentionMs: number;
  graphVersion: string;
}

export interface KnowledgeV2RetrieverDependencies {
  hybridClient: Pick<
    KnowledgeV2HybridQdrantClient,
    "queryHybrid" | "physicalCollectionName" | "runtimeSchema"
  >;
  denseProvider: KnowledgeV2DenseEmbeddingProvider;
  sparseEncoder: KnowledgeV2SparseEncoder;
  reranker: KnowledgeV2Reranker;
  restrictedStore: KnowledgeV2RestrictedContentStore;
  queryHashKeyring: KnowledgeV2QueryHashKeyring;
  liveToolResultExecutor?: KnowledgeV2LiveToolResultExecutor;
  liveToolResultResolver?: KnowledgeV2LiveToolResultResolver;
  processorPolicy?: KnowledgeV2ProcessorPolicyResolver;
  draftResolver?: KnowledgeV2DraftSnapshotResolver;
  now?: () => Date;
  id?: () => string;
}

export interface KnowledgeV2LiveToolResultResolver {
  resolve(input: {
    executionId: string;
    tenantId: string;
    executionContextId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: KnowledgeOperationalLiveCategory;
    authorizationScopeHash: string;
    now: Date;
    transaction?: Prisma.TransactionClient;
  }): Promise<KnowledgeV2LiveToolResult | null>;
}

export interface KnowledgeV2LiveToolResultExecutor {
  execute(input: {
    tenantId: string;
    executionContextId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: KnowledgeOperationalLiveCategory;
    authorizationScopeHash: string;
    authorization: KnowledgeRuntimeAuthorizationContext;
    now: Date;
    signal?: AbortSignal;
  }): Promise<readonly KnowledgeV2LiveToolResultReference[]>;
}

export interface KnowledgeV2TraceBinding {
  evaluationRunId?: string | null;
  evaluationResultId?: string | null;
  responseMessageId?: string | null;
  distributedTraceId?: string | null;
}

export interface PreparedKnowledgeV2Trace {
  draft: KnowledgeV2TraceDraft;
  answerHash?: string | null;
  restrictedTraceRef?: string | null;
  restrictedTraceCreated?: boolean;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown) {
  return hashKnowledgeValue(stableKnowledgeValue(value));
}

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function sortedUnique<T extends string>(values: readonly T[] | undefined): T[] {
  return [...new Set(values ?? [])].sort(compareCanonicalText);
}

const processorClassifications = new Set<KnowledgeV2SecurityClassification>([
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
  "SECRET",
]);
const processorClassificationOrder: readonly KnowledgeV2SecurityClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
  "SECRET",
];

function processorClassificationAllowed(
  classification: KnowledgeV2SecurityClassification,
  maximum: KnowledgeV2SecurityClassification,
) {
  return (
    processorClassificationOrder.indexOf(classification) <=
    processorClassificationOrder.indexOf(maximum)
  );
}

function runtimeProcessorPolicy(value: Prisma.JsonValue | null) {
  const policy = record(value);
  const queryEmbedding = record(policy.queryEmbedding);
  const reranker = record(policy.reranker);
  const classifications = (input: Prisma.JsonValue | undefined) => {
    if (
      !Array.isArray(input) ||
      input.length === 0 ||
      new Set(input).size !== input.length ||
      input.some(
        (item) =>
          typeof item !== "string" ||
          !processorClassifications.has(item as KnowledgeV2SecurityClassification),
      )
    ) {
      return null;
    }
    return sortedUnique(input as KnowledgeV2SecurityClassification[]);
  };
  const queryClassifications = classifications(queryEmbedding.allowedClassifications);
  const rerankerClassifications = classifications(reranker.allowedClassifications);
  if (
    policy.schemaVersion !== 1 ||
    typeof policy.policyVersion !== "string" ||
    !policy.policyVersion ||
    policy.approved !== true ||
    queryEmbedding.provider !== "openai-compatible" ||
    typeof queryEmbedding.deployment !== "string" ||
    !queryEmbedding.deployment ||
    typeof queryEmbedding.region !== "string" ||
    !queryEmbedding.region ||
    typeof reranker.provider !== "string" ||
    !reranker.provider ||
    typeof reranker.model !== "string" ||
    !reranker.model ||
    typeof reranker.version !== "string" ||
    !reranker.version ||
    typeof reranker.region !== "string" ||
    !reranker.region ||
    !queryClassifications ||
    !rerankerClassifications
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    approved: true,
    queryEmbedding: {
      provider: "openai-compatible",
      deployment: queryEmbedding.deployment,
      region: queryEmbedding.region,
      allowedClassifications: queryClassifications,
    },
    reranker: {
      provider: reranker.provider,
      model: reranker.model,
      version: reranker.version,
      region: reranker.region,
      allowedClassifications: rerankerClassifications,
    },
  } satisfies KnowledgeV2RetrievalProcessorPolicy;
}

export class PrismaKnowledgeV2ProcessorPolicyResolver implements KnowledgeV2ProcessorPolicyResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: KnowledgeV2ProcessorIdentity,
  ) {}

  async authorizeQueryEmbedding(input: {
    tenantId: string;
    retrievalPolicyVersion: string;
    classification: KnowledgeV2SecurityClassification;
  }) {
    const policy = await this.policy(input.tenantId, input.retrievalPolicyVersion);
    if (
      !policy ||
      policy.queryEmbedding.provider !== this.identity.queryEmbedding.provider ||
      policy.queryEmbedding.deployment !== this.identity.queryEmbedding.deployment ||
      policy.queryEmbedding.region !== this.identity.queryEmbedding.region ||
      !policy.queryEmbedding.allowedClassifications.every((classification) =>
        processorClassificationAllowed(
          classification,
          this.identity.queryEmbedding.maxClassification,
        ),
      ) ||
      !processorClassificationAllowed(
        input.classification,
        this.identity.queryEmbedding.maxClassification,
      ) ||
      !policy.queryEmbedding.allowedClassifications.includes(input.classification)
    ) {
      return null;
    }
    return { policyVersion: policy.policyVersion, policyHash: canonicalHash(policy) };
  }

  async authorizeReranker(input: {
    tenantId: string;
    retrievalPolicyVersion: string;
    classifications: readonly KnowledgeV2SecurityClassification[];
  }) {
    const policy = await this.policy(input.tenantId, input.retrievalPolicyVersion);
    const expected = this.identity.reranker;
    if (
      !policy ||
      policy.reranker.provider !== expected.provider ||
      policy.reranker.model !== expected.model ||
      policy.reranker.version !== expected.version ||
      policy.reranker.region !== expected.region ||
      !policy.reranker.allowedClassifications.every((classification) =>
        processorClassificationAllowed(classification, expected.maxClassification),
      ) ||
      sortedUnique(input.classifications).some(
        (classification) =>
          !processorClassificationAllowed(classification, expected.maxClassification) ||
          !policy.reranker.allowedClassifications.includes(classification),
      )
    ) {
      return null;
    }
    return { policyVersion: policy.policyVersion, policyHash: canonicalHash(policy) };
  }

  private async policy(tenantId: string, retrievalPolicyVersion: string) {
    if (!tenantId || !retrievalPolicyVersion || !this.identity.policyVersion) {
      return null;
    }
    const delegate = this.prisma.knowledgeV2Settings as unknown as {
      findUnique(input: {
        where: { tenantId: string };
        select: { retrievalProcessorPolicy: true };
      }): Promise<{ retrievalProcessorPolicy: Prisma.JsonValue | null } | null>;
    };
    const settings = await delegate.findUnique({
      where: { tenantId },
      select: { retrievalProcessorPolicy: true },
    });
    const policy = runtimeProcessorPolicy(settings?.retrievalProcessorPolicy ?? null);
    return policy?.policyVersion === this.identity.policyVersion ? policy : null;
  }
}

function normalizedLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? "en";
  } catch {
    return "en";
  }
}

const runtimeAuthorizationId = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,${KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH - 1}}$`,
  "u",
);

function runtimeAuthorizationSegment(value: string) {
  return value.length > 0 && value === value.trim() && isKnowledgeV2ScopeSegment(value);
}

function safeAuthorizationValues(
  values: readonly string[] | undefined,
  validate: (value: string) => boolean = (value) => runtimeAuthorizationId.test(value),
) {
  return sortedUnique(values).filter(validate).slice(0, KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES);
}

function persistedAuthorizationValues(
  value: Prisma.JsonValue | undefined,
  validate: (value: string) => boolean = (item) => runtimeAuthorizationId.test(item),
) {
  if (
    !Array.isArray(value) ||
    value.length > KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES ||
    value.some((item) => typeof item !== "string" || !validate(item))
  ) {
    return null;
  }
  const parsed = value as string[];
  return new Set(parsed).size === parsed.length ? [...parsed].sort() : null;
}

function safeRuntimeAuthorizationFilters(
  context: KnowledgeRuntimeAuthorizationContext,
): Prisma.InputJsonObject {
  const executionContextId = context.executionContextId?.trim() ?? "";
  const customerIdentity = validAuthenticatedCustomerIdentityReference(context.customerIdentity)
    ? context.customerIdentity
    : null;
  return {
    locale: normalizedLocale(context.locale),
    channelType: context.channelType,
    audience: context.audience,
    classifications: sortedUnique(context.classifications),
    queryClassification: context.queryClassification,
    brandIds: safeAuthorizationValues(context.brandIds),
    locationIds: safeAuthorizationValues(context.locationIds),
    channelIds: safeAuthorizationValues([context.channelType, ...(context.channelIds ?? [])]),
    assistantIds: safeAuthorizationValues(context.assistantIds),
    segmentIds: safeAuthorizationValues(context.segmentIds, runtimeAuthorizationSegment),
    hasIntent: Boolean(context.intent),
    hasLeadStage: Boolean(context.leadStage),
    businessHours: context.businessHours ?? null,
    executionContextId: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(executionContextId)
      ? executionContextId
      : null,
    customerIdentityId: customerIdentity?.id ?? null,
    customerIdentityVersion: customerIdentity?.version ?? null,
    customerSubjectHash: customerIdentity?.subjectHash ?? null,
    customerAttestationHash: customerIdentity?.attestationHash ?? null,
  };
}

export function parseKnowledgeV2PersistedAuthorizationFilters(input: {
  filters: Prisma.JsonValue;
  executionContextId: string;
  queryHash: KnowledgeV2QueryHashBinding;
}): {
  authorization: KnowledgeRuntimeAuthorizationContext;
  operationalCategory: OperationalQueryCategory;
  processorQueryAdmission: KnowledgeV2ProcessorQueryAdmissionBinding;
  retrievalProcessorPolicyVersion: string | null;
  retrievalProcessorPolicyHash: string | null;
  requiresLiveEvidence: boolean;
} | null {
  const filters = record(input.filters);
  const classifications = persistedAuthorizationValues(filters.classifications);
  const brandIds = persistedAuthorizationValues(filters.brandIds);
  const locationIds = persistedAuthorizationValues(filters.locationIds);
  const channelIds = persistedAuthorizationValues(filters.channelIds);
  const assistantIds = persistedAuthorizationValues(filters.assistantIds);
  const segmentIds = persistedAuthorizationValues(filters.segmentIds, runtimeAuthorizationSegment);
  const hasCustomerIdentity = [
    filters.customerIdentityId,
    filters.customerIdentityVersion,
    filters.customerSubjectHash,
    filters.customerAttestationHash,
  ].some((value) => value !== null && value !== undefined);
  const customerIdentity = hasCustomerIdentity
    ? {
        id: filters.customerIdentityId,
        version: filters.customerIdentityVersion,
        subjectHash: filters.customerSubjectHash,
        attestationHash: filters.customerAttestationHash,
      }
    : null;
  const operationalCategory =
    typeof filters.operationalCategory === "string" &&
    Object.values(OPERATIONAL_QUERY_CATEGORIES).includes(
      filters.operationalCategory as OperationalQueryCategory,
    )
      ? (filters.operationalCategory as OperationalQueryCategory)
      : null;
  const processorQueryAdmission = parseKnowledgeV2ProcessorQueryAdmissionBinding(
    filters.processorQueryAdmission,
  );
  const queryHash = parseKnowledgeV2QueryHashBinding(filters.queryHash);
  const processorQueryHash = processorQueryAdmission
    ? parseKnowledgeV2QueryHashBinding({
        hash: processorQueryAdmission.originalQueryHash,
        keyId: processorQueryAdmission.queryHashKeyId,
        version: processorQueryAdmission.queryHashVersion,
      })
    : null;
  const retrievalProcessorPolicyVersion =
    typeof filters.processorPolicyVersion === "string" && filters.processorPolicyVersion.length > 0
      ? filters.processorPolicyVersion
      : null;
  const retrievalProcessorPolicyHash =
    typeof filters.processorPolicyHash === "string" &&
    /^[a-f0-9]{64}$/u.test(filters.processorPolicyHash)
      ? filters.processorPolicyHash
      : null;
  if (
    typeof filters.locale !== "string" ||
    normalizedLocale(filters.locale) !== filters.locale ||
    typeof filters.channelType !== "string" ||
    !runtimeChannelTypes.has(filters.channelType as ChannelType) ||
    typeof filters.audience !== "string" ||
    !runtimeAudiences.has(filters.audience as KnowledgeV2Audience) ||
    typeof filters.queryClassification !== "string" ||
    !["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"].includes(
      filters.queryClassification,
    ) ||
    filters.executionContextId !== input.executionContextId ||
    !operationalCategory ||
    !queryHash ||
    !equalKnowledgeV2QueryHashBindings(queryHash, input.queryHash) ||
    !processorQueryAdmission ||
    processorQueryAdmission.status !== "ADMITTED" ||
    !processorQueryHash ||
    !equalKnowledgeV2QueryHashBindings(processorQueryHash, input.queryHash) ||
    (filters.processorPolicyVersion === null) !== (filters.processorPolicyHash === null) ||
    (filters.processorPolicyVersion !== null &&
      (!retrievalProcessorPolicyVersion || !retrievalProcessorPolicyHash)) ||
    typeof filters.requiresLiveEvidence !== "boolean" ||
    typeof filters.operationalRequirementHash !== "string" ||
    filters.operationalRequirementHash !==
      knowledgeOperationalRequirementHash({
        queryHash: input.queryHash,
        classification: {
          category: operationalCategory,
          requiresLiveEvidence: filters.requiresLiveEvidence,
        },
      }) ||
    !classifications ||
    classifications.length === 0 ||
    classifications.some(
      (value) =>
        !["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"].includes(value),
    ) ||
    !brandIds ||
    !locationIds ||
    !channelIds ||
    !channelIds.includes(filters.channelType) ||
    !assistantIds ||
    !segmentIds ||
    typeof filters.hasIntent !== "boolean" ||
    typeof filters.hasLeadStage !== "boolean" ||
    (filters.businessHours !== null && typeof filters.businessHours !== "boolean") ||
    (customerIdentity !== null && !validAuthenticatedCustomerIdentityReference(customerIdentity))
  ) {
    return null;
  }
  return {
    authorization: {
      locale: filters.locale,
      channelType: filters.channelType as ChannelType,
      audience: filters.audience as KnowledgeV2Audience,
      classifications: classifications as KnowledgeV2SecurityClassification[],
      queryClassification: filters.queryClassification as KnowledgeV2SecurityClassification,
      brandIds,
      locationIds,
      channelIds,
      assistantIds,
      segmentIds,
      intent: filters.hasIntent ? "present" : null,
      leadStage: filters.hasLeadStage ? "present" : null,
      businessHours: filters.businessHours,
      executionContextId: input.executionContextId,
      ...(customerIdentity ? { customerIdentity } : {}),
    },
    operationalCategory,
    processorQueryAdmission,
    retrievalProcessorPolicyVersion,
    retrievalProcessorPolicyHash,
    requiresLiveEvidence: filters.requiresLiveEvidence,
  };
}

export function knowledgeLiveToolQueryHash(input: {
  tenantId: string;
  query: string;
  queryHashKeyring: KnowledgeV2QueryHashKeyring;
}) {
  return input.queryHashKeyring.hash({
    tenantId: input.tenantId,
    purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
    value: input.query.replace(/\s+/gu, " ").trim(),
  });
}

export function knowledgeOperationalRequirementHash(input: {
  queryHash: KnowledgeV2QueryHashBinding;
  classification: Pick<OperationalQueryClassification, "category" | "requiresLiveEvidence">;
}) {
  return canonicalHash({
    schemaVersion: 1,
    queryHash: input.queryHash,
    operationalCategory: input.classification.category,
    requiresLiveEvidence: input.classification.requiresLiveEvidence,
    staticPolicyAllowed: !input.classification.requiresLiveEvidence,
  });
}

export function knowledgeLiveToolAuthorizationScopeHash(input: {
  tenantId: string;
  authorization: KnowledgeRuntimeAuthorizationContext;
}) {
  return canonicalHash({
    schemaVersion: 1,
    policyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    tenantId: input.tenantId,
    authorization: safeRuntimeAuthorizationFilters(input.authorization),
  });
}

export function knowledgeLiveToolSubjectHash(input: {
  tenantId: string;
  conversationId: string;
  leadId: string | null;
  channelId: string | null;
  externalConversationId: string | null;
  customerIdentity: AuthenticatedCustomerIdentityReference;
}) {
  return canonicalHash({
    schemaVersion: 2,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    leadId: input.leadId,
    channelId: input.channelId,
    externalConversationId: input.externalConversationId,
    customerIdentity: input.customerIdentity,
  });
}

export function knowledgeLiveToolResultEnvelopeHash(result: KnowledgeV2LiveToolResult) {
  return canonicalHash({
    schemaVersion: 3,
    executionId: result.executionId,
    toolCallId: result.toolCallId,
    toolKey: result.toolKey,
    toolVersion: result.toolVersion,
    safeName: result.safeName,
    sourceSystem: result.sourceSystem,
    operationalCategory: result.operationalCategory,
    tenantId: result.tenantId,
    executionContextId: result.executionContextId,
    queryHash: result.queryHash,
    requestHash: result.requestHash,
    authorizationScopeHash: result.authorizationScopeHash,
    authorizationDecisionId: result.authorizationDecisionId,
    permissionGeneration: result.permissionGeneration,
    connectionId: result.connectionId,
    connectionPermissionVersion: result.connectionPermissionVersion,
    customerIdentityId: result.customerIdentityId,
    customerIdentityVersion: result.customerIdentityVersion,
    subjectHash: result.subjectHash,
    resultType: result.resultType,
    value: result.value,
    valueHash: result.valueHash,
    exactValue: result.exactValue,
    exactValueHash: result.exactValueHash,
    content: result.content,
    contentHash: result.contentHash,
    status: result.status,
    observedAt: result.observedAt,
    expiresAt: result.expiresAt,
    authorizedAt: result.authorizedAt,
    authorizationExpiresAt: result.authorizationExpiresAt,
    toolPolicyVersion: result.toolPolicyVersion,
  });
}

export function isKnowledgeV2LiveToolResultValid(input: {
  result: KnowledgeV2LiveToolResult;
  query: string;
  queryHashKeyring: KnowledgeV2QueryHashKeyring;
  executionId: string;
  tenantId: string;
  executionContextId: string;
  queryHash: KnowledgeV2QueryHashBinding;
  operationalCategory: KnowledgeOperationalLiveCategory;
  authorizationScopeHash: string;
  now: Date;
}) {
  const { result } = input;
  const authorizedAt = Date.parse(result.authorizedAt);
  const authorizationExpiresAt = Date.parse(result.authorizationExpiresAt);
  const observedAt = Date.parse(result.observedAt);
  const expiresAt = Date.parse(result.expiresAt);
  const now = input.now.getTime();
  const resultQueryHash = parseKnowledgeV2QueryHashBinding(result.queryHash);
  const expectedQueryHash = parseKnowledgeV2QueryHashBinding(input.queryHash);
  const boundedIdentifier = (value: unknown, maximum = 200): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
  const hash = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  return (
    result.status === "SUCCEEDED" &&
    result.toolPolicyVersion === KNOWLEDGE_LIVE_TOOL_POLICY_VERSION &&
    result.executionId === input.executionId &&
    result.tenantId === input.tenantId &&
    result.executionContextId === input.executionContextId &&
    resultQueryHash !== null &&
    expectedQueryHash !== null &&
    equalKnowledgeV2QueryHashBindings(resultQueryHash, expectedQueryHash) &&
    input.queryHashKeyring.verify({
      tenantId: input.tenantId,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
      value: input.query.replace(/\s+/gu, " ").trim(),
      binding: resultQueryHash,
    }) &&
    result.operationalCategory === input.operationalCategory &&
    result.authorizationScopeHash === input.authorizationScopeHash &&
    boundedIdentifier(result.executionId, 150) &&
    boundedIdentifier(result.toolCallId) &&
    boundedIdentifier(result.toolKey) &&
    boundedIdentifier(result.toolVersion) &&
    boundedIdentifier(result.sourceSystem) &&
    boundedIdentifier(result.authorizationDecisionId) &&
    boundedIdentifier(result.resultType) &&
    typeof result.safeName === "string" &&
    result.safeName.trim().length > 0 &&
    result.safeName.length <= 500 &&
    (result.connectionId === null || boundedIdentifier(result.connectionId)) &&
    Number.isInteger(result.permissionGeneration) &&
    result.permissionGeneration > 0 &&
    ((result.connectionId === null && result.connectionPermissionVersion === null) ||
      (result.connectionId !== null &&
        Number.isInteger(result.connectionPermissionVersion) &&
        (result.connectionPermissionVersion ?? 0) > 0)) &&
    boundedIdentifier(result.customerIdentityId) &&
    result.customerIdentityVersion === 1 &&
    hash(result.requestHash) &&
    hash(result.authorizationScopeHash) &&
    hash(result.subjectHash) &&
    hash(result.valueHash) &&
    hash(result.exactValueHash) &&
    hash(result.contentHash) &&
    result.valueHash === canonicalHash(result.value) &&
    typeof result.exactValue === "string" &&
    result.exactValue.length > 0 &&
    result.exactValue.length <= 2_000 &&
    result.exactValueHash === sha256(result.exactValue) &&
    typeof result.content === "string" &&
    result.content.length > 0 &&
    result.content.length <= maximumEvidenceCharacters &&
    result.contentHash === sha256(result.content) &&
    result.content.includes(result.exactValue) &&
    Number.isFinite(authorizedAt) &&
    Number.isFinite(authorizationExpiresAt) &&
    Number.isFinite(observedAt) &&
    Number.isFinite(expiresAt) &&
    authorizedAt <= observedAt &&
    observedAt <= now &&
    expiresAt > now &&
    authorizationExpiresAt > now &&
    expiresAt > observedAt &&
    authorizationExpiresAt >= expiresAt &&
    authorizationExpiresAt > authorizedAt &&
    expiresAt - observedAt <= KNOWLEDGE_LIVE_TOOL_MAX_TTL_MS &&
    authorizationExpiresAt - authorizedAt <= KNOWLEDGE_LIVE_TOOL_MAX_TTL_MS
  );
}

function localeVariants(value: string) {
  const locale = normalizedLocale(value);
  const base = locale.split("-")[0] ?? locale;
  return sortedUnique([locale, base]);
}

function queryTerms(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("und")
      .match(/[\p{L}\p{N}][\p{L}\p{N}._:/+-]*/gu) ?? [],
  );
}

function lexicalScore(query: Set<string>, values: readonly string[]) {
  if (query.size === 0) return 0;
  const candidate = queryTerms(values.join(" "));
  let matches = 0;
  for (const term of query) if (candidate.has(term)) matches += 1;
  return matches / Math.sqrt(query.size * Math.max(1, candidate.size));
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function effective(from: Date | null, until: Date | null, now: Date) {
  return (!from || from <= now) && (!until || until > now);
}

function safePublicUrl(value: string | null, classification: KnowledgeV2SecurityClassification) {
  if (!value || classification !== "PUBLIC") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search) {
      return null;
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function boundedText(value: string, maximum: number) {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function scopeAllowed(
  binding: KnowledgeV2StructuredScopeBinding | null,
  context: KnowledgeRuntimeAuthorizationContext,
) {
  if (!binding) return false;
  const scope = binding.scope;
  const intersects = (required: string[], available: readonly string[] | undefined) =>
    required.length === 0 ||
    (available !== undefined && required.some((item) => available.includes(item)));
  const audiences = scope.audiences;
  const locales = scope.locales;
  return (
    (audiences.length === 0 ||
      audiences.some((audience) => retrievalAudiences(context.audience).includes(audience))) &&
    (locales.length === 0 ||
      locales.some((item) => localeVariants(context.locale).includes(item))) &&
    intersects(scope.brandIds, context.brandIds) &&
    intersects(scope.locationIds, context.locationIds) &&
    intersects(scope.channelTypes, [context.channelType]) &&
    intersects(scope.assistantIds, context.assistantIds) &&
    intersects(scope.segments, context.segmentIds)
  );
}

function documentScopeAllowed(
  scopeValue: Prisma.JsonValue | null | undefined,
  context: KnowledgeRuntimeAuthorizationContext,
) {
  const parsed = parseKnowledgeV2PersistedScope(scopeValue);
  if (parsed.state === "INVALID") return false;
  return scopeAllowed(
    {
      scope: parsed.scope,
      usesTenantDefaultScope: false,
      tenantDefaultScopeGeneration: null,
      tenantDefaultScopeHash: null,
    },
    context,
  );
}

function samePersistedScope(
  left: Prisma.JsonValue | null | undefined,
  right: Prisma.JsonValue | null | undefined,
) {
  return (
    parseKnowledgeV2PersistedScope(left).state !== "INVALID" &&
    parseKnowledgeV2PersistedScope(right).state !== "INVALID" &&
    stableKnowledgeValue(left ?? null) === stableKnowledgeValue(right ?? null)
  );
}

function sameStructuredScopeBinding(
  left: KnowledgeV2StructuredScopeBinding | null,
  right: KnowledgeV2StructuredScopeBinding | null,
) {
  return Boolean(left && right && canonicalHash(left) === canonicalHash(right));
}

interface KnowledgeV2PinnedScopeItem {
  itemType: string;
  scope: Prisma.JsonValue | null;
  usesTenantDefaultScope?: boolean;
  tenantDefaultScopeGeneration?: number | null;
  tenantDefaultScopeHash?: string | null;
}

function manifestItemScopeBinding(
  item: KnowledgeV2PinnedScopeItem,
  policy: KnowledgeV2TenantDefaultScopePolicy | null,
): KnowledgeV2StructuredScopeBinding | null {
  const effective = resolveKnowledgeV2StructuredScope(item.scope, null);
  if (!effective) return null;
  const usesTenantDefaultScope = item.usesTenantDefaultScope ?? false;
  const tenantDefaultScopeGeneration = item.tenantDefaultScopeGeneration ?? null;
  const tenantDefaultScopeHash = item.tenantDefaultScopeHash ?? null;
  if (!usesTenantDefaultScope) {
    return tenantDefaultScopeGeneration === null && tenantDefaultScopeHash === null
      ? effective
      : null;
  }
  if (
    !policy ||
    tenantDefaultScopeGeneration !== policy.generation ||
    tenantDefaultScopeHash !== policy.hash ||
    stableKnowledgeValue(effective.scope) !== stableKnowledgeValue(policy.scope)
  ) {
    return null;
  }
  return {
    scope: policy.scope,
    usesTenantDefaultScope: true,
    tenantDefaultScopeGeneration: policy.generation,
    tenantDefaultScopeHash: policy.hash,
  };
}

async function currentTargetScopePolicy(
  database: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  items: readonly KnowledgeV2PinnedScopeItem[],
): Promise<
  | { valid: true; policy: KnowledgeV2TenantDefaultScopePolicy | null }
  | { valid: false; policy: null }
> {
  let policy: KnowledgeV2TenantDefaultScopePolicy | null = null;
  const structuredItems = items.filter(
    (item) => item.itemType === "FACT_VERSION" || item.itemType === "GUIDANCE_RULE_VERSION",
  );
  if (structuredItems.some((item) => item.usesTenantDefaultScope === true)) {
    const settings = await database.knowledgeV2Settings.findUnique({
      where: { tenantId },
      select: {
        defaultScope: true,
        defaultScopeGeneration: true,
        defaultScopeHash: true,
      },
    });
    if (!settings) return { valid: false, policy: null };
    policy = parseKnowledgeV2TenantDefaultScopePolicy({
      scope: settings.defaultScope,
      generation: settings.defaultScopeGeneration,
      hash: settings.defaultScopeHash,
    });
    if (!policy) return { valid: false, policy: null };
  }
  const nonStructuredPinsValid = items
    .filter((item) => item.itemType !== "FACT_VERSION" && item.itemType !== "GUIDANCE_RULE_VERSION")
    .every(
      (item) =>
        item.usesTenantDefaultScope !== true &&
        (item.tenantDefaultScopeGeneration ?? null) === null &&
        (item.tenantDefaultScopeHash ?? null) === null,
    );
  return nonStructuredPinsValid &&
    structuredItems.every((item) => manifestItemScopeBinding(item, policy))
    ? { valid: true, policy }
    : { valid: false, policy: null };
}

function structuredItemVersionBinding(
  item: KnowledgeV2PinnedScopeItem,
  rawScope: Prisma.JsonValue | null | undefined,
  policy: KnowledgeV2TenantDefaultScopePolicy | null,
) {
  const itemBinding = manifestItemScopeBinding(item, policy);
  const versionBinding = resolveKnowledgeV2StructuredScope(rawScope, policy);
  return sameStructuredScopeBinding(itemBinding, versionBinding) ? versionBinding : null;
}

function comparableValues(value: Prisma.JsonValue | undefined): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function guidanceContextValue(
  field: string,
  context: KnowledgeRuntimeAuthorizationContext,
): unknown {
  if (field === "CHANNEL") return context.channelType;
  if (field === "LOCALE") return normalizedLocale(context.locale);
  if (field === "LOCATION") return context.locationIds ?? [];
  if (field === "CUSTOMER_AUTHORIZATION") {
    return context.audience === "AUTHENTICATED_CUSTOMER";
  }
  if (field === "INTENT") return context.intent ?? undefined;
  if (field === "BUSINESS_HOURS") return context.businessHours ?? undefined;
  if (field === "LEAD_STAGE") return context.leadStage ?? undefined;
  return undefined;
}

function predicateMatches(
  actual: unknown,
  operator: string,
  expected: Prisma.JsonValue | undefined,
) {
  if (operator === "EXISTS") return actual !== undefined && actual !== null;
  if (actual === undefined || actual === null) return false;
  const actualValues = Array.isArray(actual) ? actual : [actual];
  const expectedValues = comparableValues(expected);
  const equal = (left: unknown, right: unknown) =>
    stableKnowledgeValue(left) === stableKnowledgeValue(right);
  if (operator === "EQUALS") return expectedValues.length === 1 && equal(actual, expectedValues[0]);
  if (operator === "NOT_EQUALS")
    return expectedValues.length === 1 && !equal(actual, expectedValues[0]);
  if (operator === "IN")
    return actualValues.some((item) => expectedValues.some((value) => equal(item, value)));
  if (operator === "NOT_IN")
    return actualValues.every((item) => expectedValues.every((value) => !equal(item, value)));
  if (operator === "CONTAINS") {
    return actualValues.some((item) =>
      expectedValues.some((value) =>
        typeof item === "string" && typeof value === "string"
          ? item.toLocaleLowerCase("und").includes(value.toLocaleLowerCase("und"))
          : equal(item, value),
      ),
    );
  }
  if (operator === "GREATER_THAN" || operator === "LESS_THAN") {
    const expectedNumber = expectedValues[0];
    return (
      typeof actual === "number" &&
      typeof expectedNumber === "number" &&
      (operator === "GREATER_THAN" ? actual > expectedNumber : actual < expectedNumber)
    );
  }
  return false;
}

function guidanceMatches(
  condition: KnowledgeV2GuidanceCondition,
  context: KnowledgeRuntimeAuthorizationContext,
  depth = 0,
): boolean {
  if (depth > 12) return false;
  if (condition.kind === "ALL") {
    return (
      condition.conditions.length <= 32 &&
      condition.conditions.every((item) => guidanceMatches(item, context, depth + 1))
    );
  }
  if (condition.kind === "ANY") {
    return (
      condition.conditions.length <= 32 &&
      condition.conditions.some((item) => guidanceMatches(item, context, depth + 1))
    );
  }
  if (condition.kind === "NOT") return !guidanceMatches(condition.condition, context, depth + 1);
  return predicateMatches(
    guidanceContextValue(condition.field, context),
    condition.operator,
    condition.value,
  );
}

function retrievalAudiences(audience: KnowledgeV2Audience): KnowledgeV2Audience[] {
  if (audience === "INTERNAL") return ["PUBLIC", "INTERNAL"];
  if (audience === "AUTHENTICATED_CUSTOMER") return ["PUBLIC", "AUTHENTICATED_CUSTOMER"];
  return ["PUBLIC"];
}

function payloadString(payload: Readonly<Record<string, unknown>>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function payloadNumber(payload: Readonly<Record<string, unknown>>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function payloadStrings(payload: Readonly<Record<string, unknown>>, key: string) {
  const value = payload[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function encodeRestrictedReference(input: { key: string; encryptionKeyRef: string }) {
  return `${restrictedReferencePrefix}${Buffer.from(
    JSON.stringify({ version: 1, key: input.key, encryptionKeyRef: input.encryptionKeyRef }),
    "utf8",
  ).toString("base64url")}`;
}

function restrictedObjectKey(reference: string) {
  if (!reference.startsWith(restrictedReferencePrefix)) {
    throw new KnowledgeObjectStoreError("KEY_INVALID");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(reference.slice(restrictedReferencePrefix.length), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (parsed.version !== 1 || typeof parsed.key !== "string" || !parsed.key) {
      throw new Error("invalid reference");
    }
    return parsed.key;
  } catch {
    throw new KnowledgeObjectStoreError("KEY_INVALID");
  }
}

export class EncryptedKnowledgeV2RestrictedContentStore implements KnowledgeV2RestrictedContentStore {
  constructor(
    private readonly store: KnowledgeObjectStore,
    private readonly encryptionKeyId: string,
  ) {}

  async put(input: {
    tenantId: string;
    identity: string;
    purpose: "query" | "answer" | "trace";
    content: Uint8Array;
  }) {
    const hash = sha256(input.content);
    const key = createDeterministicKnowledgeObjectKey({
      tenantId: input.tenantId,
      sourceId: `knowledge-v2-${input.purpose}`,
      purpose: "raw",
      identity: `${this.encryptionKeyId}:${input.identity}:${hash}`,
    });
    try {
      const written = await this.store.put(key, input.content);
      return { hash, reference: encodeRestrictedReference(written), created: true };
    } catch (error) {
      if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS") {
        throw error;
      }
      const existing = await this.store.get(key, this.encryptionKeyId);
      const expected = Buffer.from(hash, "hex");
      const actual = Buffer.from(sha256(existing), "hex");
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new KnowledgeObjectStoreError("OBJECT_CORRUPT");
      }
      return {
        hash,
        reference: encodeRestrictedReference({ key, encryptionKeyRef: this.encryptionKeyId }),
        created: false,
      };
    }
  }

  delete(reference: string) {
    return this.store.delete(restrictedObjectKey(reference));
  }
}

export class DeterministicKnowledgeV2Reranker implements KnowledgeV2Reranker {
  readonly version = "lexical-rrf-v1";

  rerank(
    input: { query: string; locale: string; candidates: readonly KnowledgeV2RerankCandidate[] },
    signal: AbortSignal,
  ) {
    if (signal.aborted) throw signal.reason;
    const terms = queryTerms(input.query);
    return Promise.resolve(
      input.candidates
        .map((candidate) => ({
          id: candidate.id,
          score:
            0.65 * candidate.initialScore +
            0.35 * lexicalScore(terms, [candidate.title, candidate.text]),
        }))
        .sort((left, right) => right.score - left.score || compareCanonicalText(left.id, right.id)),
    );
  }
}

export class HttpKnowledgeV2Reranker implements KnowledgeV2Reranker {
  readonly version: string;
  private readonly endpoint: string;
  private readonly maximumCandidates: number;

  constructor(
    private readonly config: HttpKnowledgeV2RerankerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new KnowledgeV2RerankerError(false);
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      !endpoint.hostname ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !config.provider.trim() ||
      !config.model.trim() ||
      !config.version.trim() ||
      !config.region.trim() ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 100 ||
      config.timeoutMs > 120_000
    ) {
      throw new KnowledgeV2RerankerError(false);
    }
    this.maximumCandidates = config.maximumCandidates ?? 200;
    if (
      !Number.isInteger(this.maximumCandidates) ||
      this.maximumCandidates < 1 ||
      this.maximumCandidates > 200
    ) {
      throw new KnowledgeV2RerankerError(false);
    }
    this.endpoint = endpoint.toString();
    this.version = `${config.provider}:${config.model}:${config.version}:${config.region}`;
  }

  async rerank(
    input: { query: string; locale: string; candidates: readonly KnowledgeV2RerankCandidate[] },
    signal: AbortSignal,
  ) {
    if (
      !input.query.trim() ||
      input.candidates.length === 0 ||
      input.candidates.length > this.maximumCandidates
    ) {
      throw new KnowledgeV2RerankerError(false);
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          version: this.config.version,
          region: this.config.region,
          query: input.query,
          locale: input.locale,
          candidates: input.candidates,
        }),
      });
      if (!response.ok) {
        throw new KnowledgeV2RerankerError(
          [408, 425, 429, 500, 502, 503, 504].includes(response.status),
        );
      }
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new KnowledgeV2RerankerError(false);
      const body = JSON.parse(text) as { results?: unknown };
      if (!Array.isArray(body.results)) throw new KnowledgeV2RerankerError(false);
      return body.results.map((value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new KnowledgeV2RerankerError(false);
        }
        const result = value as Record<string, unknown>;
        if (
          typeof result.id !== "string" ||
          typeof result.score !== "number" ||
          !Number.isFinite(result.score)
        ) {
          throw new KnowledgeV2RerankerError(false);
        }
        return { id: result.id, score: result.score };
      });
    } catch (error) {
      if (error instanceof KnowledgeV2RerankerError) throw error;
      throw new KnowledgeV2RerankerError(!signal.aborted);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
}

const publicationInclude = {
  indexSnapshot: true,
  items: {
    include: {
      factVersion: {
        include: {
          fact: true,
          evidence: { orderBy: { id: "asc" as const }, take: 100 },
        },
      },
      guidanceRuleVersion: {
        include: {
          guidanceRule: true,
          evidence: { orderBy: { id: "asc" as const }, take: 100 },
        },
      },
      v2DocumentRevision: {
        include: { document: { include: { source: true } } },
      },
    },
    orderBy: [{ itemType: "asc" as const }, { itemId: "asc" as const }],
  },
} satisfies Prisma.KnowledgePublicationInclude;

const snapshotChunkInclude = {
  chunk: {
    include: {
      document: { include: { source: true } },
      revision: true,
      parentElement: true,
      parentSection: true,
    },
  },
} satisfies Prisma.KnowledgeV2IndexSnapshotItemInclude;

type PublicationRecord = Prisma.KnowledgePublicationGetPayload<{
  include: typeof publicationInclude;
}>;
type SnapshotChunkRecord = Prisma.KnowledgeV2IndexSnapshotItemGetPayload<{
  include: typeof snapshotChunkInclude;
}>;

interface InternalManifestItem {
  itemType: KnowledgeV2DraftManifestItem["itemType"];
  itemId: string;
  itemVersionHash: string;
  documentRevisionId: string | null;
  factVersionId: string | null;
  guidanceRuleVersionId: string | null;
  scope: Prisma.JsonValue | null;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
  authorizationFingerprint: string;
}

interface ResolvedStructuredTarget {
  tenantId: string;
  captured: KnowledgeCapturedPublicationTarget | KnowledgeCapturedDraftTarget;
  snapshotManifestHash: string;
  snapshotIdentity: KnowledgeV2SnapshotRuntimeIdentity | null;
  items: InternalManifestItem[];
  tenantDefaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null;
  publication?: PublicationRecord;
}

interface PermissionPartition {
  fingerprint: string;
  version: number;
}

interface ProvisionalDocumentCandidate {
  point: KnowledgeV2HybridQueryPoint;
  snapshotItem: SnapshotChunkRecord;
  evidence: Omit<KnowledgeV2DocumentEvidence, "rerankRank" | "rerankScore">;
}

function parsedGuidanceCondition(
  value: Prisma.JsonValue,
  depth = 0,
): KnowledgeV2GuidanceCondition | null {
  if (depth > 12 || typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, Prisma.JsonValue>;
  if (source.kind === "ALL" || source.kind === "ANY") {
    if (!Array.isArray(source.conditions) || source.conditions.length > 32) return null;
    const conditions = source.conditions.map((item) => parsedGuidanceCondition(item, depth + 1));
    if (conditions.some((item) => item === null)) return null;
    return {
      kind: source.kind,
      conditions: conditions as KnowledgeV2GuidanceCondition[],
    };
  }
  if (source.kind === "NOT") {
    const condition = parsedGuidanceCondition(source.condition ?? null, depth + 1);
    return condition ? { kind: "NOT", condition } : null;
  }
  const fields = [
    "INTENT",
    "CHANNEL",
    "LOCALE",
    "LOCATION",
    "BUSINESS_HOURS",
    "CUSTOMER_AUTHORIZATION",
    "LEAD_STAGE",
    "TOOL_RESULT",
  ] as const;
  const operators = [
    "EQUALS",
    "NOT_EQUALS",
    "IN",
    "NOT_IN",
    "CONTAINS",
    "EXISTS",
    "GREATER_THAN",
    "LESS_THAN",
  ] as const;
  if (
    source.kind !== "PREDICATE" ||
    typeof source.field !== "string" ||
    !fields.includes(source.field as (typeof fields)[number]) ||
    typeof source.operator !== "string" ||
    !operators.includes(source.operator as (typeof operators)[number])
  ) {
    return null;
  }
  return {
    kind: "PREDICATE",
    field: source.field as (typeof fields)[number],
    operator: source.operator as (typeof operators)[number],
    ...(source.value !== undefined ? { value: source.value as KnowledgeV2JsonValue } : {}),
  };
}

function validatedPolicy(input: KnowledgeV2RetrieverPolicy): KnowledgeV2RetrieverPolicy {
  const integers = [
    input.candidateLimit,
    input.documentLimit,
    input.maximumChunksPerDocument,
    input.maximumFacts,
    input.maximumGuidance,
    input.maximumParentCharacters,
    input.retentionMs,
  ];
  if (
    integers.some((value) => !Number.isInteger(value) || value <= 0) ||
    input.candidateLimit > 200 ||
    input.documentLimit > input.candidateLimit ||
    input.maximumChunksPerDocument > 8 ||
    input.maximumFacts > 100 ||
    input.maximumGuidance > 100 ||
    input.maximumParentCharacters > maximumEvidenceCharacters ||
    input.retentionMs < 60_000 ||
    input.retentionMs > 365 * 24 * 60 * 60_000 ||
    !Number.isFinite(input.minimumRerankScore) ||
    input.minimumRerankScore < -1 ||
    input.minimumRerankScore > 1 ||
    !input.graphVersion.trim()
  ) {
    throw new Error("Knowledge v2 retrieval policy is invalid.");
  }
  return Object.freeze({ ...input });
}

function sourcePermissionFingerprint(source: {
  tenantId: string;
  id: string;
  sourcePermissionVersion: number;
  defaultScope: Prisma.JsonValue | null;
  defaultClassification: string;
  defaultLocale: string;
}) {
  return canonicalHash({
    tenantId: source.tenantId,
    sourceId: source.id,
    permissionVersion: source.sourcePermissionVersion,
    scope: source.defaultScope,
    classification: source.defaultClassification,
    locale: source.defaultLocale,
  });
}

function structuredAuthorizationFingerprintMatches(
  expected: string | null | undefined,
  input: Parameters<typeof knowledgeV2StructuredAuthorizationFingerprint>[0] & {
    rawScope: Prisma.JsonValue | null;
  },
) {
  if (!expected) return false;
  if (expected === knowledgeV2StructuredAuthorizationFingerprint(input)) return true;
  if (input.binding.usesTenantDefaultScope) return false;
  return (
    expected ===
    canonicalHash({
      version: 1,
      corpusKind: "STRUCTURED_V2",
      itemType: input.itemType,
      scope: input.rawScope,
      riskLevel: input.riskLevel,
      authority: input.authority,
      evidence: input.evidence
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          locator: item.locator,
          isPublic: item.isPublic,
          legacyRevisionId: item.legacyRevisionId,
          sourceReference: item.sourceReference,
          elementReference: item.elementReference,
          quoteHash: item.quoteHash,
          confidence: item.confidence,
        }))
        .sort((left, right) => compareCanonicalText(left.id, right.id)),
    })
  );
}

function resolvedAudiences(
  value: Prisma.JsonValue | null,
  classification: KnowledgeV2SecurityClassification,
): KnowledgeV2Audience[] {
  const resolved = resolveKnowledgeV2PersistedAudiences(value, classification);
  return resolved.state === "INVALID" ? [] : resolved.audiences;
}

function boundedParentText(parent: string | null | undefined, chunk: string, maximum: number) {
  if (!parent || parent.length <= chunk.length || !parent.includes(chunk)) return chunk;
  if (parent.length <= maximum) return parent;
  const index = parent.indexOf(chunk);
  const start = Math.max(0, Math.min(index, index - Math.floor((maximum - chunk.length) / 2)));
  const adjustedStart = Math.min(start, Math.max(0, parent.length - maximum));
  return parent.slice(adjustedStart, adjustedStart + maximum);
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, value));
}

class KnowledgeV2RuntimeDependencyError extends Error {
  constructor(
    readonly reason: KnowledgeV2RuntimeUnavailableReason,
    readonly retryable: boolean,
  ) {
    super(reason);
    this.name = "KnowledgeV2RuntimeDependencyError";
  }
}

function unavailableDiagnostics(
  startedAt: number,
  corpusKind: KnowledgeRuntimeCorpus | null,
  policy?: KnowledgeV2RetrieverPolicy,
  rerankerVersion?: string,
): KnowledgeV2RuntimeDiagnostics {
  return {
    backend: "qdrant",
    corpusKind,
    candidateCount: 0,
    hydratedCount: 0,
    selectedCount: 0,
    durationMs: Date.now() - startedAt,
    retrievalPolicyVersion: policy ? "structured-v2" : null,
    rerankerVersion: rerankerVersion ?? null,
  };
}

export class KnowledgeV2Retriever {
  private readonly policy: KnowledgeV2RetrieverPolicy;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: KnowledgeV2RetrieverDependencies,
    policy: KnowledgeV2RetrieverPolicy,
  ) {
    this.policy = validatedPolicy(policy);
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
  }

  async retrievePublication(input: {
    tenantId: string;
    publicationId: string;
    query: string;
    authorization: KnowledgeRuntimeAuthorizationContext;
    graphVersion: string;
    signal?: AbortSignal;
  }): Promise<KnowledgeRuntimeRetrievalResult> {
    const startedAt = Date.now();
    const publication = await this.prisma.knowledgePublication.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.publicationId,
        targetKey: structuredTargetKey,
        corpusKind: "STRUCTURED_V2",
        status: { in: [...terminalPublicationStatuses] },
      },
      include: publicationInclude,
    });
    if (!publication) {
      return this.unavailable("PUBLICATION_INVALID", false, startedAt, null);
    }
    const publishedItems = this.publicationItems(publication);
    const hasDocuments = publishedItems.some((item) => item.itemType === "DOCUMENT_REVISION");
    if (hasDocuments && (!publication.indexSnapshotId || !publication.indexSnapshot)) {
      return this.unavailable("PUBLICATION_INVALID", false, startedAt, null);
    }
    const target: ResolvedStructuredTarget = {
      tenantId: input.tenantId,
      captured: {
        corpusKind: "STRUCTURED_V2",
        snapshotKind: "PUBLICATION",
        targetKey: publication.targetKey,
        publicationId: publication.id,
        publicationSequence: publication.sequence,
        publicationManifestHash: publication.manifestHash,
        indexSnapshotId: publication.indexSnapshotId,
        indexCollectionName: publication.indexSnapshot?.collectionName ?? null,
        indexSchemaHash: publication.indexSnapshot?.indexSchemaHash ?? null,
        indexAuthorizationManifestVersion:
          publication.indexSnapshot?.authorizationManifestVersion ?? null,
        indexAuthorizationManifestHash:
          publication.indexSnapshot?.authorizationManifestHash ?? null,
        embeddingProvider: publication.indexSnapshot?.embeddingProvider ?? null,
        embeddingModel: publication.indexSnapshot?.embeddingModel ?? null,
        retrievalPolicyVersion: publication.retrievalPolicyVersion,
        promptPolicyVersion: publication.promptPolicyVersion,
        pipelineVersion: publication.pipelineVersion,
      },
      snapshotManifestHash: publication.indexSnapshot?.manifestHash ?? "structured-no-documents",
      snapshotIdentity: this.snapshotIdentity(publication.indexSnapshot),
      items: publishedItems,
      tenantDefaultScopePolicy: null,
      publication,
    };
    return this.retrieveResolved(target, input, startedAt);
  }

  async retrieveDraft(input: {
    tenantId: string;
    validationId: string;
    indexSnapshotId: string | null;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash?: string | null;
    query: string;
    authorization: KnowledgeRuntimeAuthorizationContext;
    graphVersion: string;
    signal?: AbortSignal;
  }): Promise<KnowledgeRuntimeRetrievalResult> {
    const startedAt = Date.now();
    const resolved = await this.dependencies.draftResolver?.resolve({
      tenantId: input.tenantId,
      validationId: input.validationId,
      indexSnapshotId: input.indexSnapshotId,
      candidateId: input.candidateId,
      candidateVersion: input.candidateVersion,
      ...(input.candidateManifestHash !== undefined
        ? { candidateManifestHash: input.candidateManifestHash }
        : {}),
    });
    if (!resolved) {
      return this.unavailable("DRAFT_SNAPSHOT_UNAVAILABLE", false, startedAt, null);
    }
    if (
      resolved.candidateId !== input.candidateId ||
      resolved.validationId !== input.validationId ||
      resolved.indexSnapshotId !== input.indexSnapshotId ||
      resolved.candidateVersion !== input.candidateVersion ||
      (input.candidateManifestHash &&
        resolved.candidateManifestHash !== input.candidateManifestHash)
    ) {
      return this.unavailable("DRAFT_SNAPSHOT_UNAVAILABLE", false, startedAt, null);
    }
    const hasDocuments = resolved.items.some(
      (item) => item.itemType === "DOCUMENT_REVISION" && item.documentRevisionId,
    );
    if (hasDocuments) {
      if (!resolved.indexSnapshotId) {
        return this.unavailable("DRAFT_SNAPSHOT_UNAVAILABLE", false, startedAt, null);
      }
      const snapshot = await this.prisma.knowledgeIndexSnapshot.findFirst({
        where: {
          tenantId: input.tenantId,
          id: resolved.indexSnapshotId,
          corpusKind: "STRUCTURED_V2",
          status: "READY",
          manifestHash: resolved.snapshotManifestHash,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!snapshot) {
        return this.unavailable("DRAFT_SNAPSHOT_UNAVAILABLE", false, startedAt, null);
      }
    } else if (resolved.indexSnapshotId !== null) {
      return this.unavailable("DRAFT_SNAPSHOT_UNAVAILABLE", false, startedAt, null);
    }
    return this.retrieveResolved(
      {
        tenantId: input.tenantId,
        captured: {
          corpusKind: "STRUCTURED_V2",
          snapshotKind: "DRAFT_CANDIDATE",
          targetKey: structuredTargetKey,
          candidateId: resolved.candidateId,
          candidateVersion: resolved.candidateVersion,
          candidateManifestHash: resolved.candidateManifestHash,
          validationId: resolved.validationId,
          indexSnapshotId: resolved.indexSnapshotId,
          indexCollectionName: resolved.snapshotIdentity?.collectionName ?? null,
          indexSchemaHash: resolved.snapshotIdentity?.indexSchemaHash ?? null,
          indexAuthorizationManifestVersion:
            resolved.snapshotIdentity?.authorizationManifestVersion ?? null,
          indexAuthorizationManifestHash:
            resolved.snapshotIdentity?.authorizationManifestHash ?? null,
          embeddingProvider: resolved.snapshotIdentity?.embeddingProvider ?? null,
          embeddingModel: resolved.snapshotIdentity?.embeddingModel ?? null,
          retrievalPolicyVersion: resolved.retrievalPolicyVersion,
          promptPolicyVersion: resolved.promptPolicyVersion,
          pipelineVersion: resolved.pipelineVersion,
        },
        snapshotManifestHash: resolved.snapshotManifestHash,
        snapshotIdentity: resolved.snapshotIdentity,
        items: resolved.items.map((item) => ({
          itemType: item.itemType,
          itemId: item.itemId,
          itemVersionHash: item.itemVersionHash,
          documentRevisionId: item.documentRevisionId ?? null,
          factVersionId: item.factVersionId ?? null,
          guidanceRuleVersionId: item.guidanceRuleVersionId ?? null,
          scope: item.scope ?? null,
          usesTenantDefaultScope: item.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: item.tenantDefaultScopeHash,
          authorizationFingerprint: item.authorizationFingerprint,
        })),
        tenantDefaultScopePolicy: null,
      },
      input,
      startedAt,
    );
  }

  async revalidateEvidence(input: {
    tenantId: string;
    query: string;
    bundle: KnowledgeEvidenceBundle;
    authorization: KnowledgeRuntimeAuthorizationContext;
    transaction?: Prisma.TransactionClient;
  }): Promise<KnowledgeV2EvidenceRevalidation> {
    const manifestHash = canonicalHash({
      target: input.bundle.target,
      facts: input.bundle.facts.map((item) => [item.evidenceKey, item.versionHash, item.valueHash]),
      guidance: input.bundle.guidance.map((item) => [
        item.evidenceKey,
        item.versionHash,
        item.instructionHash,
      ]),
      documents: input.bundle.documents.map((item) => [
        item.evidenceKey,
        item.revisionId,
        item.contentHash,
      ]),
      conflicts: input.bundle.conflicts.map((item) => [
        item.conflictId,
        item.safeLabel,
        item.riskLevel,
        item.status,
      ]),
      liveToolResults: input.bundle.liveToolResults.map((item) => [
        item.executionId,
        knowledgeLiveToolResultEnvelopeHash(item),
      ]),
      answerPolicy: input.bundle.answerPolicy,
    });
    const result = (
      reason: KnowledgeV2EvidenceRevalidation["reason"],
    ): KnowledgeV2EvidenceRevalidation => ({
      valid: reason === "VALID",
      reason,
      evidenceManifestHash: manifestHash,
    });
    if (input.bundle.corpusKind !== "STRUCTURED_V2") return result("TARGET_CHANGED");
    const processorQueryAdmission = parseKnowledgeV2ProcessorQueryAdmissionBinding(
      input.bundle.answerPolicy.processorQueryAdmission,
    );
    const queryHash = parseKnowledgeV2QueryHashBinding(input.bundle.answerPolicy.queryHash);
    const currentProcessorQueryAdmission = revalidateKnowledgeV2ProcessorQueryAdmission(
      {
        tenantId: input.tenantId,
        query: input.query.replace(/\s+/gu, " ").trim(),
        classification: input.authorization.queryClassification,
        ...(input.authorization.intent !== undefined ? { intent: input.authorization.intent } : {}),
      },
      processorQueryAdmission,
      this.dependencies.queryHashKeyring,
    );
    const processorQueryHash = currentProcessorQueryAdmission
      ? parseKnowledgeV2QueryHashBinding({
          hash: currentProcessorQueryAdmission.originalQueryHash,
          keyId: currentProcessorQueryAdmission.queryHashKeyId,
          version: currentProcessorQueryAdmission.queryHashVersion,
        })
      : null;
    if (
      !queryHash ||
      !this.dependencies.queryHashKeyring.verify({
        tenantId: input.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
        value: input.query.replace(/\s+/gu, " ").trim(),
        binding: queryHash,
      }) ||
      !currentProcessorQueryAdmission?.admitted ||
      currentProcessorQueryAdmission.operationalCategory !==
        input.bundle.answerPolicy.operationalCategory ||
      currentProcessorQueryAdmission.requiresLiveEvidence !==
        input.bundle.answerPolicy.requiresLiveEvidence ||
      !processorQueryHash ||
      !equalKnowledgeV2QueryHashBindings(processorQueryHash, queryHash) ||
      input.bundle.answerPolicy.requirementHash !==
        knowledgeOperationalRequirementHash({
          queryHash: input.bundle.answerPolicy.queryHash,
          classification: {
            category: input.bundle.answerPolicy.operationalCategory,
            requiresLiveEvidence: input.bundle.answerPolicy.requiresLiveEvidence,
          },
        })
    ) {
      return result("EVIDENCE_CHANGED");
    }
    const database = input.transaction ?? this.prisma;
    const captured = input.bundle.target;
    let target: ResolvedStructuredTarget | null = null;
    if (captured.snapshotKind === "PUBLICATION" && captured.corpusKind === "STRUCTURED_V2") {
      const publication = await database.knowledgePublication.findFirst({
        where: {
          tenantId: input.tenantId,
          id: captured.publicationId,
          targetKey: structuredTargetKey,
          corpusKind: "STRUCTURED_V2",
          status: { in: [...terminalPublicationStatuses] },
        },
        include: publicationInclude,
      });
      if (!publication) return result("TARGET_CHANGED");
      const current = {
        corpusKind: "STRUCTURED_V2" as const,
        snapshotKind: "PUBLICATION" as const,
        targetKey: publication.targetKey,
        publicationId: publication.id,
        publicationSequence: publication.sequence,
        publicationManifestHash: publication.manifestHash,
        indexSnapshotId: publication.indexSnapshotId,
        indexCollectionName: publication.indexSnapshot?.collectionName ?? null,
        indexSchemaHash: publication.indexSnapshot?.indexSchemaHash ?? null,
        indexAuthorizationManifestVersion:
          publication.indexSnapshot?.authorizationManifestVersion ?? null,
        indexAuthorizationManifestHash:
          publication.indexSnapshot?.authorizationManifestHash ?? null,
        embeddingProvider: publication.indexSnapshot?.embeddingProvider ?? null,
        embeddingModel: publication.indexSnapshot?.embeddingModel ?? null,
        retrievalPolicyVersion: publication.retrievalPolicyVersion,
        promptPolicyVersion: publication.promptPolicyVersion,
        pipelineVersion: publication.pipelineVersion,
      };
      const expected = {
        corpusKind: captured.corpusKind,
        snapshotKind: captured.snapshotKind,
        targetKey: captured.targetKey,
        publicationId: captured.publicationId,
        publicationSequence: captured.publicationSequence,
        publicationManifestHash: captured.publicationManifestHash,
        indexSnapshotId: captured.indexSnapshotId,
        indexCollectionName: captured.indexCollectionName ?? null,
        indexSchemaHash: captured.indexSchemaHash ?? null,
        indexAuthorizationManifestVersion: captured.indexAuthorizationManifestVersion ?? null,
        indexAuthorizationManifestHash: captured.indexAuthorizationManifestHash ?? null,
        embeddingProvider: captured.embeddingProvider ?? null,
        embeddingModel: captured.embeddingModel ?? null,
        retrievalPolicyVersion: captured.retrievalPolicyVersion,
        promptPolicyVersion: captured.promptPolicyVersion,
        pipelineVersion: captured.pipelineVersion,
      };
      if (canonicalHash(current) !== canonicalHash(expected)) return result("TARGET_CHANGED");
      target = {
        tenantId: input.tenantId,
        captured,
        snapshotManifestHash: publication.indexSnapshot?.manifestHash ?? "structured-no-documents",
        snapshotIdentity: this.snapshotIdentity(publication.indexSnapshot),
        items: this.publicationItems(publication),
        tenantDefaultScopePolicy: null,
        publication,
      };
    } else if (captured.snapshotKind === "DRAFT_CANDIDATE") {
      const resolved = await new PrismaKnowledgeV2DraftSnapshotResolver(
        database as unknown as PrismaClient,
        this.now,
      ).resolve({
        tenantId: input.tenantId,
        validationId: captured.validationId,
        indexSnapshotId: captured.indexSnapshotId,
        candidateId: captured.candidateId,
        candidateVersion: captured.candidateVersion,
        candidateManifestHash: captured.candidateManifestHash,
      });
      if (!resolved) return result("TARGET_CHANGED");
      const current = {
        corpusKind: resolved.corpusKind,
        snapshotKind: "DRAFT_CANDIDATE" as const,
        targetKey: resolved.targetKey,
        candidateId: resolved.candidateId,
        candidateVersion: resolved.candidateVersion,
        candidateManifestHash: resolved.candidateManifestHash,
        validationId: resolved.validationId,
        indexSnapshotId: resolved.indexSnapshotId,
        indexCollectionName: resolved.snapshotIdentity?.collectionName ?? null,
        indexSchemaHash: resolved.snapshotIdentity?.indexSchemaHash ?? null,
        indexAuthorizationManifestVersion:
          resolved.snapshotIdentity?.authorizationManifestVersion ?? null,
        indexAuthorizationManifestHash:
          resolved.snapshotIdentity?.authorizationManifestHash ?? null,
        embeddingProvider: resolved.snapshotIdentity?.embeddingProvider ?? null,
        embeddingModel: resolved.snapshotIdentity?.embeddingModel ?? null,
        retrievalPolicyVersion: resolved.retrievalPolicyVersion,
        promptPolicyVersion: resolved.promptPolicyVersion,
        pipelineVersion: resolved.pipelineVersion,
      };
      const expected = {
        corpusKind: captured.corpusKind,
        snapshotKind: captured.snapshotKind,
        targetKey: captured.targetKey,
        candidateId: captured.candidateId,
        candidateVersion: captured.candidateVersion,
        candidateManifestHash: captured.candidateManifestHash,
        validationId: captured.validationId,
        indexSnapshotId: captured.indexSnapshotId,
        indexCollectionName: captured.indexCollectionName ?? null,
        indexSchemaHash: captured.indexSchemaHash ?? null,
        indexAuthorizationManifestVersion: captured.indexAuthorizationManifestVersion ?? null,
        indexAuthorizationManifestHash: captured.indexAuthorizationManifestHash ?? null,
        embeddingProvider: captured.embeddingProvider ?? null,
        embeddingModel: captured.embeddingModel ?? null,
        retrievalPolicyVersion: captured.retrievalPolicyVersion,
        promptPolicyVersion: captured.promptPolicyVersion,
        pipelineVersion: captured.pipelineVersion,
      };
      if (canonicalHash(current) !== canonicalHash(expected)) return result("TARGET_CHANGED");
      target = {
        tenantId: input.tenantId,
        captured,
        snapshotManifestHash: resolved.snapshotManifestHash,
        snapshotIdentity: resolved.snapshotIdentity,
        items: resolved.items.map((item) => ({
          itemType: item.itemType,
          itemId: item.itemId,
          itemVersionHash: item.itemVersionHash,
          documentRevisionId: item.documentRevisionId ?? null,
          factVersionId: item.factVersionId ?? null,
          guidanceRuleVersionId: item.guidanceRuleVersionId ?? null,
          scope: item.scope ?? null,
          usesTenantDefaultScope: item.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: item.tenantDefaultScopeHash,
          authorizationFingerprint: item.authorizationFingerprint,
        })),
        tenantDefaultScopePolicy: null,
      };
    }
    if (!target) return result("TARGET_CHANGED");
    const targetScopePolicy = await currentTargetScopePolicy(
      database,
      input.tenantId,
      target.items,
    );
    if (!targetScopePolicy.valid) return result("PERMISSION_CHANGED");
    target.tenantDefaultScopePolicy = targetScopePolicy.policy;

    const now = this.now();
    const factRows =
      input.bundle.facts.length === 0
        ? []
        : await database.knowledgeV2FactVersion.findMany({
            where: {
              tenantId: input.tenantId,
              id: { in: input.bundle.facts.map((item) => item.versionId) },
            },
            include: { fact: true, evidence: { orderBy: { id: "asc" }, take: 100 } },
          });
    const factById = new Map(factRows.map((row) => [row.id, row]));
    for (const evidence of input.bundle.facts) {
      const version = factById.get(evidence.versionId);
      const item = target.items.find(
        (candidate) =>
          candidate.itemType === "FACT_VERSION" && candidate.factVersionId === evidence.versionId,
      );
      const binding =
        version && item
          ? structuredItemVersionBinding(item, version.scope, target.tenantDefaultScopePolicy)
          : null;
      if (
        !version ||
        !item ||
        item.itemVersionHash !== evidence.versionHash ||
        version.immutableHash !== evidence.versionHash
      ) {
        return result("MEMBERSHIP_CHANGED");
      }
      if (
        version.fact.deletedAt ||
        version.lifecycleStatus === "ARCHIVED" ||
        version.verificationStatus !== "VERIFIED" ||
        !effective(version.effectiveFrom, version.effectiveUntil, now)
      )
        return result("EVIDENCE_CHANGED");
      if (
        !binding ||
        !scopeAllowed(binding, input.authorization) ||
        !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
          itemType: "FACT_VERSION",
          binding,
          rawScope: version.scope,
          riskLevel: version.riskLevel,
          authority: { authority: version.authority, verifiedByUserId: version.verifiedByUserId },
          evidence: version.evidence,
        })
      )
        return result("PERMISSION_CHANGED");
      const value = version.displayValue?.trim() || stableKnowledgeValue(version.normalizedValue);
      if (
        evidence.evidenceKey !== `v2:fact:${version.id}:${version.immutableHash}` ||
        evidence.factId !== version.factId ||
        evidence.value !== value ||
        evidence.valueHash !== canonicalHash(version.normalizedValue) ||
        evidence.riskLevel !== version.riskLevel
      )
        return result("EVIDENCE_CHANGED");
    }

    const guidanceRows =
      input.bundle.guidance.length === 0
        ? []
        : await database.knowledgeV2GuidanceRuleVersion.findMany({
            where: {
              tenantId: input.tenantId,
              id: { in: input.bundle.guidance.map((item) => item.versionId) },
            },
            include: { guidanceRule: true, evidence: { orderBy: { id: "asc" }, take: 100 } },
          });
    const guidanceById = new Map(guidanceRows.map((row) => [row.id, row]));
    for (const evidence of input.bundle.guidance) {
      const version = guidanceById.get(evidence.versionId);
      const item = target.items.find(
        (candidate) =>
          candidate.itemType === "GUIDANCE_RULE_VERSION" &&
          candidate.guidanceRuleVersionId === evidence.versionId,
      );
      const binding =
        version && item
          ? structuredItemVersionBinding(item, version.scope, target.tenantDefaultScopePolicy)
          : null;
      if (
        !version ||
        !item ||
        item.itemVersionHash !== evidence.versionHash ||
        version.immutableHash !== evidence.versionHash
      ) {
        return result("MEMBERSHIP_CHANGED");
      }
      const condition = parsedGuidanceCondition(version.conditionAst);
      if (
        version.guidanceRule.deletedAt ||
        version.reviewStatus !== "APPROVED" ||
        !effective(version.effectiveFrom, version.effectiveUntil, now) ||
        !condition ||
        !guidanceMatches(condition, input.authorization)
      )
        return result("EVIDENCE_CHANGED");
      if (
        !binding ||
        !scopeAllowed(binding, input.authorization) ||
        !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
          itemType: "GUIDANCE_RULE_VERSION",
          binding,
          rawScope: version.scope,
          riskLevel: version.riskLevel,
          authority: {
            requiredApproverRole: version.requiredApproverRole,
            approvedByUserId: version.approvedByUserId,
          },
          evidence: version.evidence,
        })
      )
        return result("PERMISSION_CHANGED");
      if (
        evidence.evidenceKey !== `v2:guidance:${version.id}:${version.immutableHash}` ||
        evidence.guidanceRuleId !== version.guidanceRuleId ||
        evidence.instruction !== version.instruction ||
        evidence.instructionHash !== sha256(version.instruction) ||
        evidence.riskLevel !== version.riskLevel
      )
        return result("EVIDENCE_CHANGED");
    }

    if (input.bundle.documents.some((item) => item.kind !== "DOCUMENT"))
      return result("TARGET_CHANGED");
    const documents = input.bundle.documents as KnowledgeV2DocumentEvidence[];
    const rows =
      documents.length === 0
        ? []
        : await database.knowledgeV2IndexSnapshotItem.findMany({
            where: {
              tenantId: input.tenantId,
              snapshotId: target.captured.indexSnapshotId ?? "__missing__",
              chunkId: { in: documents.map((item) => item.chunkId) },
            },
            include: snapshotChunkInclude,
          });
    if (rows.length !== documents.length) return result("MEMBERSHIP_CHANGED");
    const rowByChunk = new Map(rows.map((row) => [row.chunkId, row]));
    const sourceIds = sortedUnique(rows.map((row) => row.chunk.document.sourceId));
    const targetIds = sortedUnique(
      rows.flatMap((row) => [
        row.chunk.document.sourceId,
        row.chunk.documentId,
        row.chunk.revisionId,
        row.chunk.id,
      ]),
    );
    const deletionRows =
      sourceIds.length === 0
        ? []
        : await database.knowledgeV2DeletionLedger.findMany({
            where: {
              tenantId: input.tenantId,
              sourceId: { in: sourceIds },
              targetId: { in: targetIds },
              status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] },
            },
            select: { targetId: true },
          });
    const deleted = new Set(deletionRows.map((row) => row.targetId));
    for (const evidence of documents) {
      const snapshotItem = rowByChunk.get(evidence.chunkId);
      if (!snapshotItem) return result("MEMBERSHIP_CHANGED");
      const chunk = snapshotItem.chunk;
      const revision = chunk.revision;
      const document = chunk.document;
      const source = document.source;
      const item = target.items.find(
        (candidate) =>
          candidate.itemType === "DOCUMENT_REVISION" &&
          candidate.documentRevisionId === revision.id,
      );
      if (
        !item ||
        snapshotItem.snapshotId !== target.captured.indexSnapshotId ||
        snapshotItem.contentHash !== chunk.contentHash ||
        item.itemVersionHash !== revision.contentHash ||
        !/^[a-f0-9]{64}$/u.test(snapshotItem.pointFingerprint)
      )
        return result("MEMBERSHIP_CHANGED");
      if (
        chunk.indexState !== "INDEXED" ||
        chunk.deletedAt ||
        revision.deletedAt ||
        document.deletedAt ||
        document.tombstonedAt ||
        source.deletedAt ||
        source.tombstonedAt ||
        deleted.has(source.id) ||
        deleted.has(document.id) ||
        deleted.has(revision.id) ||
        deleted.has(chunk.id) ||
        !["READY", "PUBLISHED", "SUPERSEDED"].includes(revision.status) ||
        !effective(revision.effectiveFrom, revision.effectiveUntil, now) ||
        (revision.staleAfter !== null && revision.staleAfter <= now)
      )
        return result("EVIDENCE_CHANGED");
      const fingerprint = sourcePermissionFingerprint(source);
      const audiences = resolvedAudiences(document.audience, document.classification);
      const effectiveScope = parseKnowledgeV2PersistedScope(
        revision.scopeSnapshot ?? document.scope,
      );
      if (
        source.kind === "LEGACY_ONBOARDING" ||
        item.authorizationFingerprint !== fingerprint ||
        revision.sourcePermissionFingerprint !== fingerprint ||
        document.permissionVersion !== source.sourcePermissionVersion ||
        chunk.permissionVersion !== document.permissionVersion ||
        evidence.permissionFingerprint !== fingerprint ||
        evidence.permissionVersion !== chunk.permissionVersion ||
        !input.authorization.classifications.includes(chunk.classification) ||
        !audiences.some((audience) =>
          retrievalAudiences(input.authorization.audience).includes(audience),
        ) ||
        !localeVariants(input.authorization.locale).includes(chunk.locale) ||
        effectiveScope.state === "INVALID" ||
        !knowledgeV2DocumentPrefilterEnforcesScope(effectiveScope.scope, audiences, chunk.locale) ||
        !samePersistedScope(chunk.scope, revision.scopeSnapshot ?? document.scope) ||
        !samePersistedScope(item.scope, revision.scopeSnapshot ?? document.scope) ||
        !documentScopeAllowed(source.defaultScope, input.authorization) ||
        !documentScopeAllowed(document.scope, input.authorization) ||
        !documentScopeAllowed(revision.scopeSnapshot, input.authorization) ||
        !documentScopeAllowed(chunk.scope, input.authorization) ||
        !documentScopeAllowed(item.scope, input.authorization)
      )
        return result("PERMISSION_CHANGED");
      const parentText = chunk.parentElement?.normalizedText;
      const range = record(chunk.provenanceRange);
      const start = range.start;
      const end = range.end;
      if (
        typeof parentText !== "string" ||
        typeof start !== "number" ||
        !Number.isInteger(start) ||
        typeof end !== "number" ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end > parentText.length
      )
        return result("EVIDENCE_CHANGED");
      const exactContent = parentText.slice(start, end);
      const expanded = boundedText(
        boundedParentText(
          chunk.parentSection?.normalizedText ?? parentText,
          exactContent,
          this.policy.maximumParentCharacters,
        ),
        this.policy.maximumParentCharacters,
      );
      if (
        !exactContent.trim() ||
        hashKnowledgeValue(exactContent) !== chunk.contentHash ||
        evidence.evidenceKey !== `v2:document:${revision.id}:${chunk.id}:${chunk.contentHash}` ||
        evidence.documentId !== document.id ||
        evidence.revisionId !== revision.id ||
        evidence.revisionHash !== revision.contentHash ||
        evidence.sourceId !== source.id ||
        evidence.contentHash !== chunk.contentHash ||
        evidence.content !== expanded ||
        evidence.classification !== chunk.classification ||
        evidence.locale !== chunk.locale
      )
        return result("EVIDENCE_CHANGED");
    }

    if (input.bundle.answerPolicy.requiresLiveEvidence) {
      const expiresAt = input.bundle.liveToolResults.map((item) => Date.parse(item.expiresAt));
      if (expiresAt.some((value) => !Number.isFinite(value) || value <= now.getTime())) {
        return result("EVIDENCE_EXPIRED");
      }
      const verified = await this.resolveLiveToolResults({
        tenantId: input.tenantId,
        query: input.query,
        queryHash: input.bundle.answerPolicy.queryHash,
        operationalCategory: input.bundle.answerPolicy.operationalCategory,
        ...(input.transaction ? { transaction: input.transaction } : {}),
        authorization: {
          ...input.authorization,
          liveToolResults: input.bundle.liveToolResults.map((item) => ({
            executionId: item.executionId,
          })),
        },
      });
      const verifiedById = new Map(verified.map((item) => [item.executionId, item]));
      if (
        verifiedById.size !== input.bundle.liveToolResults.length ||
        input.bundle.liveToolResults.some((item) => {
          const current = verifiedById.get(item.executionId);
          return (
            !current ||
            knowledgeLiveToolResultEnvelopeHash(current) !==
              knowledgeLiveToolResultEnvelopeHash(item)
          );
        })
      ) {
        return result("PERMISSION_CHANGED");
      }
    } else if (input.bundle.liveToolResults.length > 0) {
      return result("EVIDENCE_CHANGED");
    }

    const conflictIds = sortedUnique(input.bundle.conflicts.map((item) => item.conflictId));
    if (conflictIds.length !== input.bundle.conflicts.length || conflictIds.length > 100) {
      return result("EVIDENCE_CHANGED");
    }
    if (conflictIds.length > 0) {
      const rows = await database.knowledgeV2Conflict.findMany({
        where: {
          id: { in: conflictIds },
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2",
          status: { in: ["OPEN", "IN_REVIEW"] },
        },
        select: {
          id: true,
          semanticKey: true,
          severity: true,
          status: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      });
      const current = rows
        .filter((row) => effective(row.effectiveFrom, row.effectiveUntil, now))
        .map((row) => ({
          conflictId: row.id,
          safeLabel: row.semanticKey,
          riskLevel: row.severity,
          status: row.status,
        }))
        .sort((left, right) => compareCanonicalText(left.conflictId, right.conflictId));
      const expected = [...input.bundle.conflicts].sort((left, right) =>
        compareCanonicalText(left.conflictId, right.conflictId),
      );
      if (canonicalHash(current) !== canonicalHash(expected)) {
        return result("EVIDENCE_CHANGED");
      }
    }

    const factIds = sortedUnique(input.bundle.facts.map((item) => item.factId));
    const guidanceIds = sortedUnique(input.bundle.guidance.map((item) => item.guidanceRuleId));
    const revisionIds = sortedUnique(documents.map((item) => item.revisionId));
    const conflictTargets: Prisma.KnowledgeV2ConflictWhereInput[] = [];
    if (factIds.length > 0) conflictTargets.push({ factId: { in: factIds } });
    if (guidanceIds.length > 0) conflictTargets.push({ guidanceRuleId: { in: guidanceIds } });
    if (revisionIds.length > 0)
      conflictTargets.push({ candidates: { some: { v2DocumentRevisionId: { in: revisionIds } } } });
    if (conflictTargets.length > 0) {
      const conflicts = await database.knowledgeV2Conflict.findMany({
        where: {
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2",
          status: { in: ["OPEN", "IN_REVIEW"] },
          OR: conflictTargets,
        },
        select: { effectiveFrom: true, effectiveUntil: true },
        take: 1,
      });
      if (
        conflicts.some((conflict) =>
          effective(conflict.effectiveFrom, conflict.effectiveUntil, now),
        )
      ) {
        return result("CONFLICT_DETECTED");
      }
    }
    return result("VALID");
  }

  async revalidateRetrievalProcessorAdmission(input: {
    tenantId: string;
    retrievalPolicyVersion: string;
    queryClassification: KnowledgeV2SecurityClassification;
    rerankerClassifications?: readonly KnowledgeV2SecurityClassification[];
    expectedPolicyVersion: string;
    expectedPolicyHash: string;
  }) {
    const queryAdmission = await this.dependencies.processorPolicy?.authorizeQueryEmbedding({
      tenantId: input.tenantId,
      retrievalPolicyVersion: input.retrievalPolicyVersion,
      classification: input.queryClassification,
    });
    if (
      !queryAdmission ||
      queryAdmission.policyVersion !== input.expectedPolicyVersion ||
      queryAdmission.policyHash !== input.expectedPolicyHash
    ) {
      return false;
    }
    if (!input.rerankerClassifications) return true;
    const rerankerAdmission = await this.dependencies.processorPolicy?.authorizeReranker({
      tenantId: input.tenantId,
      retrievalPolicyVersion: input.retrievalPolicyVersion,
      classifications: sortedUnique(input.rerankerClassifications),
    });
    return Boolean(
      rerankerAdmission &&
      rerankerAdmission.policyVersion === input.expectedPolicyVersion &&
      rerankerAdmission.policyHash === input.expectedPolicyHash,
    );
  }

  async revalidatePersistedLiveToolResult(input: {
    tenantId: string;
    executionId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: OperationalQueryCategory;
    authorization: KnowledgeRuntimeAuthorizationContext;
    envelopeHash: string;
    authorizationScopeHash: string;
    observedAt: Date | null;
    expiresAt: Date | null;
    transaction?: Prisma.TransactionClient;
  }) {
    if (
      input.operationalCategory === OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE ||
      !input.observedAt ||
      !input.expiresAt
    ) {
      return null;
    }
    const resolved = await this.resolveLiveToolResults({
      tenantId: input.tenantId,
      query: input.query,
      queryHash: input.queryHash,
      operationalCategory: input.operationalCategory,
      ...(input.transaction ? { transaction: input.transaction } : {}),
      authorization: {
        ...input.authorization,
        liveToolResults: [{ executionId: input.executionId }],
      },
    });
    const result = resolved[0];
    return result &&
      result.executionId === input.executionId &&
      result.authorizationScopeHash === input.authorizationScopeHash &&
      result.observedAt === input.observedAt.toISOString() &&
      result.expiresAt === input.expiresAt.toISOString() &&
      knowledgeLiveToolResultEnvelopeHash(result) === input.envelopeHash
      ? result
      : null;
  }

  private publicationItems(publication: PublicationRecord): InternalManifestItem[] {
    return publication.items.flatMap((item) => {
      if (
        ![
          "DOCUMENT_REVISION",
          "FACT_VERSION",
          "GUIDANCE_RULE_VERSION",
          "SOURCE_PERMISSION_SNAPSHOT",
        ].includes(item.itemType) ||
        !item.itemVersionHash ||
        !item.authorizationFingerprint
      ) {
        return [];
      }
      return [
        {
          itemType: item.itemType as InternalManifestItem["itemType"],
          itemId: item.itemId,
          itemVersionHash: item.itemVersionHash,
          documentRevisionId: item.v2DocumentRevisionId,
          factVersionId: item.factVersionId,
          guidanceRuleVersionId: item.guidanceRuleVersionId,
          scope: item.scope,
          usesTenantDefaultScope: item.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: item.tenantDefaultScopeHash,
          authorizationFingerprint: item.authorizationFingerprint,
        },
      ];
    });
  }

  private snapshotIdentity(
    snapshot: {
      id: string;
      tenantId: string;
      manifestHash: string;
      collectionName: string;
      embeddingProvider: string;
      embeddingModel: string;
      indexSchema: Prisma.JsonValue | null;
      indexSchemaHash: string | null;
      authorizationManifest: Prisma.JsonValue | null;
      authorizationManifestVersion: number | null;
      authorizationManifestHash: string | null;
      expectedPointCount: number;
      observedPointCount: number | null;
    } | null,
  ): KnowledgeV2SnapshotRuntimeIdentity | null {
    const authorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot?.authorizationManifest,
      snapshot?.authorizationManifestHash,
    );
    if (
      !snapshot?.indexSchema ||
      !snapshot.indexSchemaHash ||
      snapshot.authorizationManifestVersion !== 1 ||
      !snapshot.authorizationManifestHash ||
      !authorizationManifest ||
      authorizationManifest.tenantId !== snapshot.tenantId ||
      authorizationManifest.snapshotId !== snapshot.id ||
      authorizationManifest.snapshotManifestHash !== snapshot.manifestHash ||
      authorizationManifest.indexSchemaHash !== snapshot.indexSchemaHash ||
      authorizationManifest.expectedPointCount !== snapshot.expectedPointCount ||
      snapshot.expectedPointCount !== snapshot.observedPointCount
    ) {
      return null;
    }
    return {
      collectionName: snapshot.collectionName,
      embeddingProvider: snapshot.embeddingProvider,
      embeddingModel: snapshot.embeddingModel,
      indexSchema: snapshot.indexSchema,
      indexSchemaHash: snapshot.indexSchemaHash,
      authorizationManifest,
      authorizationManifestVersion: snapshot.authorizationManifestVersion,
      authorizationManifestHash: snapshot.authorizationManifestHash,
    };
  }

  private async retrieveResolved(
    target: ResolvedStructuredTarget,
    input: {
      tenantId: string;
      query: string;
      authorization: KnowledgeRuntimeAuthorizationContext;
      graphVersion: string;
      signal?: AbortSignal;
    },
    startedAt: number,
  ): Promise<KnowledgeRuntimeRetrievalResult> {
    const query = input.query.replace(/\s+/gu, " ").trim();
    if (!query || query.length > maximumQueryCharacters) {
      return this.unavailable("PUBLICATION_INVALID", false, startedAt, target.captured);
    }
    const targetScopePolicy = await currentTargetScopePolicy(
      this.prisma,
      input.tenantId,
      target.items,
    );
    if (!targetScopePolicy.valid) {
      return this.unavailable("PUBLICATION_INVALID", false, startedAt, target.captured);
    }
    target.tenantDefaultScopePolicy = targetScopePolicy.policy;
    const documentItems = target.items.filter(
      (item) => item.itemType === "DOCUMENT_REVISION" && item.documentRevisionId,
    );
    if (documentItems.length === 0 && !this.snapshotCompatible(target, false)) {
      return this.unavailable("SNAPSHOT_INCOMPATIBLE", false, startedAt, target.captured);
    }
    const queryHash = knowledgeLiveToolQueryHash({
      tenantId: input.tenantId,
      query,
      queryHashKeyring: this.dependencies.queryHashKeyring,
    });
    const operational = classifyOperationalQuery(query, input.authorization.intent ?? undefined);
    const processorQueryAdmission = admitKnowledgeV2ProcessorQuery(
      {
        tenantId: input.tenantId,
        query,
        classification: input.authorization.queryClassification,
        ...(input.authorization.intent !== undefined ? { intent: input.authorization.intent } : {}),
      },
      this.dependencies.queryHashKeyring,
    );
    const processorQueryAdmissionBinding =
      projectKnowledgeV2ProcessorQueryAdmissionBinding(processorQueryAdmission);
    const requirementHash = knowledgeOperationalRequirementHash({
      queryHash,
      classification: operational,
    });
    let queryReference: { reference: string; hash: string; created?: boolean };
    try {
      queryReference = await this.dependencies.restrictedStore.put({
        tenantId: input.tenantId,
        identity: canonicalHash({
          target: target.captured,
          queryHash,
          authorization: this.safeFilters(input.authorization),
        }),
        purpose: "query",
        content: new TextEncoder().encode(query),
      });
    } catch {
      return this.unavailable("RESTRICTED_STORAGE_UNAVAILABLE", true, startedAt, target.captured);
    }
    let queryArtifactTransferred = false;
    const transferQueryArtifact = <T extends KnowledgeRuntimeRetrievalResult>(result: T): T => {
      queryArtifactTransferred = Boolean(result.traceDraft);
      return result;
    };
    try {
      if (
        !processorQueryAdmission.admitted ||
        processorQueryAdmission.operationalCategory !== operational.category ||
        processorQueryAdmission.requiresLiveEvidence !== operational.requiresLiveEvidence
      ) {
        const denied = this.unavailable(
          "PROCESSOR_POLICY_DENIED",
          false,
          startedAt,
          target.captured,
        );
        return transferQueryArtifact({
          ...denied,
          traceDraft: this.traceDraft({
            target,
            queryReference,
            queryHash,
            authorization: input.authorization,
            graphVersion: input.graphVersion,
            permissionPartitions: [],
            outcome: "FAILED",
            gateOutcome: "HANDOFF",
            candidates: [],
            citations: [],
            processorAdmission: null,
            processorQueryAdmission: processorQueryAdmissionBinding,
            operational,
            requirementHash,
            degradedReason: "PROCESSOR_POLICY_DENIED",
            startedAt,
          }),
        });
      }
      const structured = await this.resolveStructured(target, input.authorization, query);
      const requiresLiveEvidence = operational.requiresLiveEvidence;
      const liveToolResults = requiresLiveEvidence
        ? await this.resolveLiveToolResults({
            tenantId: input.tenantId,
            query,
            queryHash,
            operationalCategory: operational.category,
            authorization: input.authorization,
            ...(input.signal ? { signal: input.signal } : {}),
          })
        : [];
      const missingLiveEvidence = requiresLiveEvidence && liveToolResults.length === 0;
      const localEvidenceCount =
        structured.facts.length + structured.guidance.length + liveToolResults.length;
      let points: KnowledgeV2HybridQueryPoint[] = [];
      let qdrantFailure: KnowledgeRuntimeRetrievalUnavailable | null = null;
      let permissionPartitions: PermissionPartition[] = [];
      let processorAdmission: KnowledgeV2ProcessorAdmission | null = null;
      if (documentItems.length > 0 && !missingLiveEvidence) {
        if (!this.snapshotCompatible(target, true)) {
          qdrantFailure = this.unavailable(
            "SNAPSHOT_INCOMPATIBLE",
            false,
            startedAt,
            target.captured,
          );
        } else if (!target.captured.indexSnapshotId) {
          qdrantFailure = this.unavailable("SNAPSHOT_NOT_READY", false, startedAt, target.captured);
        } else {
          const snapshot = await this.prisma.knowledgeIndexSnapshot.findFirst({
            where: {
              tenantId: input.tenantId,
              id: target.captured.indexSnapshotId,
              corpusKind: "STRUCTURED_V2",
              status: "READY",
              manifestHash: target.snapshotManifestHash,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!snapshot) {
            qdrantFailure = this.unavailable(
              "SNAPSHOT_NOT_READY",
              true,
              startedAt,
              target.captured,
            );
          }
        }
        if (!qdrantFailure) {
          permissionPartitions = await this.permissionPartitions(
            input.tenantId,
            target,
            documentItems,
          );
        }
        if (!qdrantFailure && permissionPartitions.length === 0) {
          qdrantFailure = this.unavailable(
            "PERMISSION_PARTITION_UNAVAILABLE",
            false,
            startedAt,
            target.captured,
          );
        } else if (!qdrantFailure) {
          const queryResult = await this.queryDocuments(
            target,
            input.authorization,
            processorQueryAdmission.processorQuery,
            permissionPartitions,
            input.signal,
            startedAt,
          );
          if ("status" in queryResult) qdrantFailure = queryResult;
          else {
            points = queryResult.points;
            processorAdmission = queryResult.processorAdmission;
          }
        }
      }
      if (qdrantFailure && localEvidenceCount === 0) {
        return transferQueryArtifact({
          ...qdrantFailure,
          traceDraft: this.traceDraft({
            target,
            queryReference,
            queryHash,
            authorization: input.authorization,
            graphVersion: input.graphVersion,
            permissionPartitions,
            outcome: "FAILED",
            gateOutcome: "HANDOFF",
            candidates: [],
            citations: [],
            processorAdmission,
            processorQueryAdmission: processorQueryAdmissionBinding,
            operational,
            requirementHash,
            degradedReason: qdrantFailure.reason,
            startedAt,
          }),
        });
      }
      let documentRetrievalDegradedReason = qdrantFailure?.reason ?? null;
      let documents: Awaited<ReturnType<KnowledgeV2Retriever["hydrateAndRerank"]>> = {
        selected: [],
        suppressed: [],
        traceCandidates: [],
        hydratedCount: 0,
        processorAdmission,
      };
      if (!qdrantFailure) {
        try {
          documents = await this.hydrateAndRerank(
            input.tenantId,
            target,
            input.authorization,
            processorQueryAdmission.processorQuery,
            points,
            processorAdmission,
            input.signal,
          );
        } catch (error) {
          const dependency =
            error instanceof KnowledgeV2RuntimeDependencyError
              ? error
              : new KnowledgeV2RuntimeDependencyError("RERANKER_UNAVAILABLE", true);
          if (localEvidenceCount === 0) {
            return transferQueryArtifact(
              this.unavailable(dependency.reason, dependency.retryable, startedAt, target.captured),
            );
          }
          documentRetrievalDegradedReason = dependency.reason;
          documents = {
            selected: [],
            suppressed: points.map(() => ({ reason: "NOT_SELECTED" as const })),
            traceCandidates: [],
            hydratedCount: 0,
            processorAdmission,
          };
        }
      }
      const conflicts = await this.conflicts(
        input.tenantId,
        query,
        structured.facts,
        structured.guidance,
        documents.selected,
      );
      const hasConflict = conflicts.length > 0;
      const availableEvidence =
        structured.facts.length +
        structured.guidance.length +
        documents.selected.length +
        liveToolResults.length;
      const gateReasons: KnowledgeV2RuntimeGateReason[] = hasConflict
        ? ["CONFLICT"]
        : missingLiveEvidence
          ? ["LIVE_EVIDENCE_REQUIRED"]
          : availableEvidence > 0
            ? ["EVIDENCE_READY"]
            : documents.suppressed.some((item) => item.reason === "PERMISSION_DENIED")
              ? ["UNAUTHORIZED_EVIDENCE"]
              : documents.suppressed.some((item) => item.reason === "STALE")
                ? ["STALE_EVIDENCE"]
                : documents.suppressed.some((item) => item.reason === "DELETED")
                  ? ["HASH_MISMATCH"]
                  : ["NO_MATCH"];
      const outcome: KnowledgeV2RetrievalOutcome =
        hasConflict || missingLiveEvidence
          ? "HANDED_OFF"
          : availableEvidence > 0
            ? "ANSWERED"
            : "ABSTAINED";
      const gateOutcome: KnowledgeV2GateOutcome =
        hasConflict || missingLiveEvidence || availableEvidence === 0 ? "HANDOFF" : "AUTO_SEND";
      const citations: KnowledgeV2BundleCitation[] = [];
      const bundle: KnowledgeEvidenceBundle = {
        schemaVersion: 1,
        corpusKind: "STRUCTURED_V2",
        target: target.captured,
        outcome,
        gateOutcome,
        gateReasons,
        facts: hasConflict ? [] : structured.facts,
        guidance: hasConflict ? [] : structured.guidance,
        documents: hasConflict ? [] : documents.selected,
        conflicts,
        missingSupport: gateOutcome === "AUTO_SEND" ? [] : gateReasons,
        suppressedEvidence: this.suppressedSummary(
          hasConflict
            ? [
                ...documents.suppressed,
                ...documents.selected.map(() => ({ reason: "CONFLICTED" as const })),
              ]
            : documents.suppressed,
        ),
        citations,
        liveToolResults,
        answerPolicy: {
          requirementHash,
          operationalCategory: operational.category,
          queryHash,
          processorQueryAdmission: processorQueryAdmissionBinding,
          requiresLiveEvidence,
          staticEvidenceMayAnswer: !requiresLiveEvidence,
          allowAutoSend: gateOutcome === "AUTO_SEND" && processorQueryAdmission.admitted,
        },
      };
      const diagnostics: KnowledgeV2RuntimeDiagnostics = {
        backend: "qdrant",
        corpusKind: "STRUCTURED_V2",
        candidateCount: points.length,
        hydratedCount: documents.hydratedCount,
        selectedCount: hasConflict ? 0 : documents.selected.length,
        durationMs: Date.now() - startedAt,
        degradedReason: documentRetrievalDegradedReason,
        retrievalPolicyVersion: target.captured.retrievalPolicyVersion,
        rerankerVersion: this.dependencies.reranker.version,
      };
      const traceDraft = this.traceDraft({
        target,
        queryReference,
        queryHash,
        authorization: input.authorization,
        graphVersion: input.graphVersion,
        permissionPartitions,
        outcome,
        gateOutcome,
        candidates: documents.traceCandidates.map((candidate) =>
          hasConflict && candidate.selected
            ? { ...candidate, selected: false, rejectionReason: "CONFLICTED" }
            : candidate,
        ),
        citations,
        processorAdmission: documents.processorAdmission ?? processorAdmission,
        processorQueryAdmission: processorQueryAdmissionBinding,
        operational,
        requirementHash,
        degradedReason: documentRetrievalDegradedReason,
        startedAt,
      });
      if (gateOutcome === "AUTO_SEND") {
        return transferQueryArtifact({ status: "grounded", bundle, traceDraft, diagnostics });
      }
      return transferQueryArtifact({
        status: "insufficient_grounding",
        reason: hasConflict
          ? "CONFLICT"
          : missingLiveEvidence
            ? "LIVE_EVIDENCE_REQUIRED"
            : gateReasons.includes("UNAUTHORIZED_EVIDENCE")
              ? "UNAUTHORIZED"
              : gateReasons.includes("STALE_EVIDENCE")
                ? "STALE"
                : gateReasons.includes("HASH_MISMATCH")
                  ? "HASH_MISMATCH"
                  : "NO_MATCH",
        bundle,
        traceDraft,
        diagnostics,
      });
    } finally {
      if (!queryArtifactTransferred && queryReference.created) {
        await this.dependencies.restrictedStore
          .delete(queryReference.reference)
          .catch(() => undefined);
      }
    }
  }

  private safeFilters(context: KnowledgeRuntimeAuthorizationContext): Prisma.InputJsonObject {
    return safeRuntimeAuthorizationFilters(context);
  }

  private snapshotCompatible(target: ResolvedStructuredTarget, hasDocuments: boolean) {
    if (!hasDocuments) {
      return target.captured.indexSnapshotId === null && target.snapshotIdentity === null;
    }
    const identity = target.snapshotIdentity;
    if (!target.captured.indexSnapshotId || !identity) return false;
    if (canonicalHash(identity.indexSchema) !== identity.indexSchemaHash) return false;
    const schema = record(identity.indexSchema);
    const dense = record(schema.dense);
    const sparse = record(schema.sparse);
    return (
      identity.collectionName === this.dependencies.hybridClient.physicalCollectionName &&
      target.captured.indexCollectionName === identity.collectionName &&
      target.captured.indexSchemaHash === identity.indexSchemaHash &&
      target.captured.indexAuthorizationManifestVersion === identity.authorizationManifestVersion &&
      target.captured.indexAuthorizationManifestHash === identity.authorizationManifestHash &&
      target.captured.embeddingProvider === identity.embeddingProvider &&
      target.captured.embeddingModel === identity.embeddingModel &&
      identity.embeddingProvider === this.dependencies.denseProvider.schema.provider &&
      identity.embeddingModel === this.dependencies.denseProvider.schema.model &&
      canonicalHash(dense) === canonicalHash(this.dependencies.hybridClient.runtimeSchema.dense) &&
      canonicalHash(sparse) ===
        canonicalHash(this.dependencies.hybridClient.runtimeSchema.sparse) &&
      canonicalHash(dense) === canonicalHash(this.dependencies.denseProvider.schema) &&
      canonicalHash(sparse) === canonicalHash(this.dependencies.sparseEncoder.schema)
    );
  }

  private async resolveStructured(
    target: ResolvedStructuredTarget,
    authorization: KnowledgeRuntimeAuthorizationContext,
    query: string,
  ) {
    const now = this.now();
    const factItems = target.items.filter(
      (item) => item.itemType === "FACT_VERSION" && item.factVersionId,
    );
    const guidanceItems = target.items.filter(
      (item) => item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersionId,
    );
    const publicationFacts = target.publication?.items.flatMap((item) =>
      item.factVersion ? [item.factVersion] : [],
    );
    const publicationGuidance = target.publication?.items.flatMap((item) =>
      item.guidanceRuleVersion ? [item.guidanceRuleVersion] : [],
    );
    const [facts, guidance] = await Promise.all([
      publicationFacts ??
        this.prisma.knowledgeV2FactVersion.findMany({
          where: {
            tenantId: target.tenantId,
            id: {
              in: factItems.flatMap((item) => (item.factVersionId ? [item.factVersionId] : [])),
            },
          },
          include: {
            fact: true,
            evidence: { orderBy: { id: "asc" }, take: 100 },
          },
        }),
      publicationGuidance ??
        this.prisma.knowledgeV2GuidanceRuleVersion.findMany({
          where: {
            tenantId: target.tenantId,
            id: {
              in: guidanceItems.flatMap((item) =>
                item.guidanceRuleVersionId ? [item.guidanceRuleVersionId] : [],
              ),
            },
          },
          include: {
            guidanceRule: true,
            evidence: { orderBy: { id: "asc" }, take: 100 },
          },
        }),
    ]);
    const factItemByVersion = new Map(
      factItems.flatMap((item) =>
        item.factVersionId ? [[item.factVersionId, item] as const] : [],
      ),
    );
    const guidanceItemByVersion = new Map(
      guidanceItems.flatMap((item) =>
        item.guidanceRuleVersionId ? [[item.guidanceRuleVersionId, item] as const] : [],
      ),
    );
    const terms = queryTerms(query);
    const selectedFacts = facts
      .flatMap((version): KnowledgeV2ExactFactEvidence[] => {
        const item = factItemByVersion.get(version.id);
        const binding = item
          ? structuredItemVersionBinding(item, version.scope, target.tenantDefaultScopePolicy)
          : null;
        if (
          !item ||
          item.itemVersionHash !== version.immutableHash ||
          version.fact.deletedAt ||
          version.lifecycleStatus === "ARCHIVED" ||
          version.verificationStatus !== "VERIFIED" ||
          !effective(version.effectiveFrom, version.effectiveUntil, now) ||
          !binding ||
          !scopeAllowed(binding, authorization) ||
          !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
            itemType: "FACT_VERSION",
            binding,
            rawScope: version.scope,
            riskLevel: version.riskLevel,
            authority: {
              authority: version.authority,
              verifiedByUserId: version.verifiedByUserId,
            },
            evidence: version.evidence,
          })
        ) {
          return [];
        }
        const value = version.displayValue?.trim() || stableKnowledgeValue(version.normalizedValue);
        const score = lexicalScore(terms, [version.fact.factKey, version.fact.entityType, value]);
        if (score <= 0) return [];
        return [
          {
            kind: "FACT",
            evidenceKey: `v2:fact:${version.id}:${version.immutableHash}`,
            factId: version.factId,
            versionId: version.id,
            versionHash: version.immutableHash,
            safeLabel: version.fact.factKey,
            value,
            valueHash: canonicalHash(version.normalizedValue),
            riskLevel: version.riskLevel,
            authority: version.authority,
            verificationStatus: version.verificationStatus,
            observedAt: dateValue(version.verifiedAt ?? version.createdAt),
            expiresAt: dateValue(version.effectiveUntil),
            score,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.score - left.score || compareCanonicalText(left.evidenceKey, right.evidenceKey),
      )
      .slice(0, this.policy.maximumFacts);
    const selectedGuidance = guidance
      .flatMap((version): KnowledgeV2GuidanceEvidence[] => {
        const item = guidanceItemByVersion.get(version.id);
        const condition = parsedGuidanceCondition(version.conditionAst);
        const binding = item
          ? structuredItemVersionBinding(item, version.scope, target.tenantDefaultScopePolicy)
          : null;
        if (
          !item ||
          item.itemVersionHash !== version.immutableHash ||
          version.guidanceRule.deletedAt ||
          version.reviewStatus !== "APPROVED" ||
          !effective(version.effectiveFrom, version.effectiveUntil, now) ||
          !binding ||
          !scopeAllowed(binding, authorization) ||
          !condition ||
          !guidanceMatches(condition, authorization) ||
          !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
            itemType: "GUIDANCE_RULE_VERSION",
            binding,
            rawScope: version.scope,
            riskLevel: version.riskLevel,
            authority: {
              requiredApproverRole: version.requiredApproverRole,
              approvedByUserId: version.approvedByUserId,
            },
            evidence: version.evidence,
          })
        ) {
          return [];
        }
        const lexical = lexicalScore(terms, [
          version.guidanceRule.ruleKey,
          version.title,
          version.instruction,
        ]);
        const score = Math.max(
          0,
          Math.min(1, lexical * 0.8 + Math.max(0, version.priority) / 10_000),
        );
        return [
          {
            kind: "GUIDANCE",
            evidenceKey: `v2:guidance:${version.id}:${version.immutableHash}`,
            guidanceRuleId: version.guidanceRuleId,
            versionId: version.id,
            versionHash: version.immutableHash,
            safeLabel: version.title,
            instruction: version.instruction,
            instructionHash: sha256(version.instruction),
            riskLevel: version.riskLevel,
            priority: version.priority,
            score,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          right.score - left.score ||
          compareCanonicalText(left.evidenceKey, right.evidenceKey),
      )
      .slice(0, this.policy.maximumGuidance);
    return { facts: selectedFacts, guidance: selectedGuidance };
  }

  private async permissionPartitions(
    tenantId: string,
    target: ResolvedStructuredTarget,
    documentItems: InternalManifestItem[],
  ): Promise<PermissionPartition[]> {
    const snapshotId = target.captured.indexSnapshotId;
    const identity = target.snapshotIdentity;
    if (!snapshotId || !identity) return [];
    const manifest = identity.authorizationManifest;
    if (
      manifest.tenantId !== tenantId ||
      manifest.snapshotId !== snapshotId ||
      manifest.snapshotManifestHash !== target.snapshotManifestHash ||
      manifest.indexSchemaHash !== identity.indexSchemaHash ||
      manifest.partitions.length === 0 ||
      manifest.partitions.length > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS
    ) {
      return [];
    }

    const itemByRevision = new Map<string, InternalManifestItem>();
    for (const item of documentItems) {
      if (
        !item.documentRevisionId ||
        itemByRevision.has(item.documentRevisionId) ||
        !/^[a-f0-9]{64}$/u.test(item.authorizationFingerprint)
      ) {
        return [];
      }
      itemByRevision.set(item.documentRevisionId, item);
    }
    if (
      itemByRevision.size !== manifest.revisionIds.length ||
      manifest.revisionIds.some((revisionId) => !itemByRevision.has(revisionId))
    ) {
      return [];
    }

    const sourceIds = new Set<string>();
    const partitionByRevision = new Map<string, (typeof manifest.partitions)[number]>();
    for (const partition of manifest.partitions) {
      if (sourceIds.has(partition.sourceId)) return [];
      sourceIds.add(partition.sourceId);
      for (const revisionId of partition.revisionIds) {
        if (partitionByRevision.has(revisionId)) return [];
        partitionByRevision.set(revisionId, partition);
      }
    }
    if (
      partitionByRevision.size !== itemByRevision.size ||
      [...itemByRevision].some(
        ([revisionId, item]) =>
          partitionByRevision.get(revisionId)?.authorizationFingerprint !==
          item.authorizationFingerprint,
      )
    ) {
      return [];
    }

    const sources = await this.prisma.knowledgeV2Source.findMany({
      where: { tenantId, id: { in: [...sourceIds] } },
      select: {
        id: true,
        tenantId: true,
        sourcePermissionVersion: true,
        defaultScope: true,
        defaultClassification: true,
        defaultLocale: true,
        generation: true,
        deletedAt: true,
        tombstonedAt: true,
      },
    });
    if (sources.length !== sourceIds.size) return [];
    const partitionBySource = new Map(
      manifest.partitions.map((partition) => [partition.sourceId, partition]),
    );
    for (const source of sources) {
      const partition = partitionBySource.get(source.id);
      if (
        !partition ||
        source.deletedAt ||
        source.tombstonedAt ||
        source.generation < partition.sourceGeneration ||
        source.sourcePermissionVersion !== partition.permissionVersion ||
        sourcePermissionFingerprint(source) !== partition.authorizationFingerprint
      ) {
        return [];
      }
    }

    return manifest.partitions
      .map((partition) => ({
        fingerprint: partition.authorizationFingerprint,
        version: partition.permissionVersion,
      }))
      .sort(
        (left, right) =>
          compareCanonicalText(left.fingerprint, right.fingerprint) || left.version - right.version,
      );
  }

  private async queryDocuments(
    target: ResolvedStructuredTarget,
    authorization: KnowledgeRuntimeAuthorizationContext,
    query: string,
    permissions: PermissionPartition[],
    signal: AbortSignal | undefined,
    startedAt: number,
  ): Promise<
    | { points: KnowledgeV2HybridQueryPoint[]; processorAdmission: KnowledgeV2ProcessorAdmission }
    | KnowledgeRuntimeRetrievalUnavailable
  > {
    const snapshotId = target.captured.indexSnapshotId;
    if (!snapshotId) {
      return this.unavailable("SNAPSHOT_NOT_READY", false, startedAt, target.captured);
    }
    const controller = signal ? null : new AbortController();
    const activeSignal = signal ?? controller!.signal;
    const request = [
      { id: "runtime-query", text: query, locale: normalizedLocale(authorization.locale) },
    ];
    const processorAdmission = await this.dependencies.processorPolicy?.authorizeQueryEmbedding({
      tenantId: target.tenantId,
      retrievalPolicyVersion: target.captured.retrievalPolicyVersion,
      classification: authorization.queryClassification,
    });
    if (!processorAdmission) {
      return this.unavailable("PROCESSOR_POLICY_DENIED", false, startedAt, target.captured);
    }
    let dense: readonly { id: string; vector: readonly number[] }[];
    try {
      dense = await this.dependencies.denseProvider.embedBatch(request, activeSignal);
      validateKnowledgeV2DenseEmbeddingBatch(
        this.dependencies.denseProvider.schema,
        ["runtime-query"],
        dense,
      );
    } catch (error) {
      const retryable = error instanceof KnowledgeV2EmbeddingProviderError ? error.retryable : true;
      return this.unavailable("EMBEDDING_UNAVAILABLE", retryable, startedAt, target.captured);
    }
    let sparse: Awaited<ReturnType<KnowledgeV2SparseEncoder["encodeBatch"]>>;
    try {
      sparse = await this.dependencies.sparseEncoder.encodeBatch(request, activeSignal);
      validateKnowledgeV2SparseEncodingBatch(
        this.dependencies.sparseEncoder.schema,
        ["runtime-query"],
        sparse,
      );
    } catch {
      return this.unavailable("SPARSE_ENCODING_UNAVAILABLE", true, startedAt, target.captured);
    }
    const classifications = sortedUnique(authorization.classifications);
    if (classifications.length === 0) return { points: [], processorAdmission };
    const byPoint = new Map<string, KnowledgeV2HybridQueryPoint>();
    try {
      for (let offset = 0; offset < permissions.length; offset += 64) {
        const batch = permissions.slice(offset, offset + 64);
        const points = await this.dependencies.hybridClient.queryHybrid({
          workspaceId: target.tenantId,
          indexSnapshotId: snapshotId,
          permissions: batch,
          audiences: retrievalAudiences(authorization.audience),
          classifications,
          locales: localeVariants(authorization.locale),
          locationIds: safeAuthorizationValues(authorization.locationIds),
          brandIds: safeAuthorizationValues(authorization.brandIds),
          channelIds: safeAuthorizationValues([
            authorization.channelType,
            ...(authorization.channelIds ?? []),
          ]),
          assistantIds: safeAuthorizationValues(authorization.assistantIds),
          segmentIds: safeAuthorizationValues(
            authorization.segmentIds,
            runtimeAuthorizationSegment,
          ),
          denseVector: dense[0]!.vector,
          sparseVector: sparse[0]!.vector,
          candidateLimit: this.policy.candidateLimit,
          limit: this.policy.candidateLimit,
          ...(signal ? { signal } : {}),
        });
        for (const point of points) {
          const current = byPoint.get(point.id);
          if (!current || point.score > current.score) byPoint.set(point.id, point);
        }
      }
    } catch (error) {
      const retryable = error instanceof KnowledgeV2HybridIndexError ? error.retryable : true;
      return this.unavailable("QDRANT_UNAVAILABLE", retryable, startedAt, target.captured);
    }
    return {
      points: [...byPoint.values()]
        .sort((left, right) => right.score - left.score || compareCanonicalText(left.id, right.id))
        .slice(0, this.policy.candidateLimit),
      processorAdmission,
    };
  }

  private async hydrateAndRerank(
    tenantId: string,
    target: ResolvedStructuredTarget,
    authorization: KnowledgeRuntimeAuthorizationContext,
    query: string,
    points: KnowledgeV2HybridQueryPoint[],
    queryAdmission: KnowledgeV2ProcessorAdmission | null,
    signal?: AbortSignal,
  ) {
    if (points.length === 0) {
      return {
        selected: [] as KnowledgeV2DocumentEvidence[],
        suppressed: [] as Array<{ reason: KnowledgeV2RetrievalRejectionReason }>,
        traceCandidates: [] as KnowledgeV2TraceCandidateDraft[],
        hydratedCount: 0,
        processorAdmission: queryAdmission,
      };
    }
    const snapshotId = target.captured.indexSnapshotId;
    if (!snapshotId || !queryAdmission) {
      throw new KnowledgeV2RuntimeDependencyError("PROCESSOR_POLICY_DENIED", false);
    }
    const rows = await this.loadSnapshotRows(tenantId, snapshotId, points);
    const deletedTargets = await this.deletionTargets(tenantId, rows);
    const rowByPoint = new Map(rows.map((row) => [row.vectorPointId, row]));
    const provisional: ProvisionalDocumentCandidate[] = [];
    const suppressed: Array<{ reason: KnowledgeV2RetrievalRejectionReason }> = [];
    for (const [index, point] of points.entries()) {
      const row = rowByPoint.get(point.id);
      if (!row) {
        suppressed.push({ reason: "DELETED" });
        continue;
      }
      const hydrated = this.hydratePoint(
        target,
        authorization,
        point,
        row,
        index + 1,
        deletedTargets,
      );
      if ("reason" in hydrated) suppressed.push({ reason: hydrated.reason });
      else provisional.push(hydrated);
    }
    const deduplicated: ProvisionalDocumentCandidate[] = [];
    const duplicateKeys = new Set<string>();
    for (const candidate of provisional) {
      const key = `${candidate.evidence.documentId}:${candidate.evidence.contentHash}`;
      if (duplicateKeys.has(key)) {
        suppressed.push({ reason: "DUPLICATE" });
        continue;
      }
      duplicateKeys.add(key);
      deduplicated.push(candidate);
    }
    if (deduplicated.length === 0) {
      return {
        selected: [] as KnowledgeV2DocumentEvidence[],
        suppressed,
        traceCandidates: [] as KnowledgeV2TraceCandidateDraft[],
        hydratedCount: provisional.length,
        processorAdmission: queryAdmission,
      };
    }
    const controller = signal ? null : new AbortController();
    const activeSignal = signal ?? controller!.signal;
    const rerankerAdmission = await this.dependencies.processorPolicy?.authorizeReranker({
      tenantId,
      retrievalPolicyVersion: target.captured.retrievalPolicyVersion,
      classifications: sortedUnique([
        authorization.queryClassification,
        ...deduplicated.map((candidate) => candidate.evidence.classification),
      ]),
    });
    if (
      !rerankerAdmission ||
      rerankerAdmission.policyVersion !== queryAdmission.policyVersion ||
      rerankerAdmission.policyHash !== queryAdmission.policyHash
    ) {
      throw new KnowledgeV2RuntimeDependencyError("PROCESSOR_POLICY_DENIED", false);
    }
    let reranked: readonly { id: string; score: number }[];
    try {
      reranked = await this.dependencies.reranker.rerank(
        {
          query,
          locale: normalizedLocale(authorization.locale),
          candidates: deduplicated.map((candidate) => ({
            id: candidate.point.id,
            title: candidate.evidence.title,
            text: candidate.evidence.content,
            initialScore: candidate.point.score,
          })),
        },
        activeSignal,
      );
    } catch {
      throw new KnowledgeV2RuntimeDependencyError("RERANKER_UNAVAILABLE", true);
    }
    const requestedIds = new Set(deduplicated.map((candidate) => candidate.point.id));
    if (
      reranked.length !== requestedIds.size ||
      new Set(reranked.map((item) => item.id)).size !== reranked.length ||
      reranked.some(
        (item) =>
          !requestedIds.has(item.id) ||
          !Number.isFinite(item.score) ||
          Math.abs(item.score) > 1_000,
      )
    ) {
      throw new KnowledgeV2RuntimeDependencyError("RERANKER_UNAVAILABLE", false);
    }
    const provisionalById = new Map(
      deduplicated.map((candidate) => [candidate.point.id, candidate]),
    );
    const acceptedIds: string[] = [];
    const documentCounts = new Map<string, number>();
    const acceptedDocuments = new Set<string>();
    for (const item of reranked) {
      const candidate = provisionalById.get(item.id)!;
      if (item.score < this.policy.minimumRerankScore) continue;
      const documentId = candidate.evidence.documentId;
      const currentCount = documentCounts.get(documentId) ?? 0;
      if (
        currentCount >= this.policy.maximumChunksPerDocument ||
        (!acceptedDocuments.has(documentId) && acceptedDocuments.size >= this.policy.documentLimit)
      ) {
        continue;
      }
      acceptedDocuments.add(documentId);
      documentCounts.set(documentId, currentCount + 1);
      acceptedIds.push(item.id);
    }
    const finalPoints = acceptedIds.map((id) => provisionalById.get(id)!.point);
    const finalRows = await this.loadSnapshotRows(tenantId, snapshotId, finalPoints);
    const finalDeletedTargets = await this.deletionTargets(tenantId, finalRows);
    const finalRowByPoint = new Map(finalRows.map((row) => [row.vectorPointId, row]));
    const scoreById = new Map(
      reranked.map((item, index) => [item.id, { score: item.score, rank: index + 1 }]),
    );
    const finalById = new Map<string, KnowledgeV2DocumentEvidence>();
    for (const id of acceptedIds) {
      const candidate = provisionalById.get(id)!;
      const row = finalRowByPoint.get(id);
      if (!row) {
        suppressed.push({ reason: "DELETED" });
        continue;
      }
      const final = this.hydratePoint(
        target,
        authorization,
        candidate.point,
        row,
        candidate.evidence.fusedRank,
        finalDeletedTargets,
      );
      if ("reason" in final) {
        suppressed.push({ reason: final.reason });
        continue;
      }
      const rank = scoreById.get(id)!;
      finalById.set(id, {
        ...final.evidence,
        rerankRank: rank.rank,
        rerankScore: rank.score,
      });
    }
    const selected = acceptedIds.flatMap((id) => {
      const evidence = finalById.get(id);
      return evidence ? [evidence] : [];
    });
    const acceptedSet = new Set(selected.map((item) => item.evidenceKey));
    const traceCandidates = deduplicated.map((candidate): KnowledgeV2TraceCandidateDraft => {
      const rerank = scoreById.get(candidate.point.id)!;
      const selectedCandidate = acceptedSet.has(candidate.evidence.evidenceKey);
      const rejectionReason: KnowledgeV2RetrievalRejectionReason | null = selectedCandidate
        ? null
        : rerank.score < this.policy.minimumRerankScore
          ? "BELOW_THRESHOLD"
          : acceptedIds.includes(candidate.point.id)
            ? "DELETED"
            : "RERANKED_OUT";
      if (rejectionReason) suppressed.push({ reason: rejectionReason });
      return {
        candidateKey: candidate.point.id,
        evidenceKey: candidate.evidence.evidenceKey,
        fusedRank: candidate.evidence.fusedRank,
        fusedScore: candidate.evidence.fusedScore,
        rerankRank: rerank.rank,
        rerankScore: rerank.score,
        selected: selectedCandidate,
        rejectionReason,
        reference: this.documentReference(candidate.evidence),
      };
    });
    return {
      selected,
      suppressed,
      traceCandidates,
      hydratedCount: provisional.length,
      processorAdmission: rerankerAdmission,
    };
  }

  private loadSnapshotRows(
    tenantId: string,
    snapshotId: string,
    points: readonly KnowledgeV2HybridQueryPoint[],
  ) {
    if (points.length === 0) return Promise.resolve([] as SnapshotChunkRecord[]);
    return this.prisma.knowledgeV2IndexSnapshotItem.findMany({
      where: {
        tenantId,
        snapshotId,
        vectorPointId: { in: points.map((point) => point.id) },
      },
      include: snapshotChunkInclude,
    });
  }

  private async deletionTargets(tenantId: string, rows: readonly SnapshotChunkRecord[]) {
    const sourceIds = sortedUnique(rows.map((row) => row.chunk.document.sourceId));
    const targetIds = sortedUnique(
      rows.flatMap((row) => [
        row.chunk.document.sourceId,
        row.chunk.documentId,
        row.chunk.revisionId,
        row.chunk.id,
      ]),
    );
    if (sourceIds.length === 0) return new Set<string>();
    const ledger = await this.prisma.knowledgeV2DeletionLedger.findMany({
      where: {
        tenantId,
        sourceId: { in: sourceIds },
        targetId: { in: targetIds },
        status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] },
      },
      select: { targetId: true },
    });
    return new Set(ledger.map((entry) => entry.targetId));
  }

  private hydratePoint(
    target: ResolvedStructuredTarget,
    authorization: KnowledgeRuntimeAuthorizationContext,
    point: KnowledgeV2HybridQueryPoint,
    snapshotItem: SnapshotChunkRecord,
    fusedRank: number,
    deletedTargets: ReadonlySet<string>,
  ): ProvisionalDocumentCandidate | { reason: KnowledgeV2RetrievalRejectionReason } {
    const now = this.now();
    const chunk = snapshotItem.chunk;
    const revision = chunk.revision;
    const document = chunk.document;
    const source = document.source;
    if (source.kind === "LEGACY_ONBOARDING") {
      return { reason: "PERMISSION_DENIED" };
    }
    const manifest = target.items.find(
      (item) => item.itemType === "DOCUMENT_REVISION" && item.documentRevisionId === revision.id,
    );
    if (
      !manifest ||
      snapshotItem.tenantId !== target.tenantId ||
      snapshotItem.snapshotId !== target.captured.indexSnapshotId ||
      snapshotItem.vectorPointId !== point.id ||
      snapshotItem.contentHash !== chunk.contentHash ||
      manifest.itemVersionHash !== revision.contentHash ||
      payloadString(point.payload, "document_id") !== document.id ||
      payloadString(point.payload, "revision_id") !== revision.id ||
      payloadString(point.payload, "chunk_id") !== chunk.id ||
      payloadString(point.payload, "content_hash") !== chunk.contentHash ||
      payloadString(point.payload, "point_fingerprint") !== snapshotItem.pointFingerprint ||
      !/^[a-f0-9]{64}$/u.test(snapshotItem.pointFingerprint) ||
      payloadString(point.payload, "locale") !== chunk.locale ||
      payloadString(point.payload, "classification") !== chunk.classification ||
      payloadString(point.payload, "dense_schema") !== chunk.denseSchemaVersion ||
      payloadString(point.payload, "sparse_schema") !== chunk.sparseSchemaVersion ||
      chunk.indexState !== "INDEXED" ||
      chunk.deletedAt ||
      revision.deletedAt ||
      document.deletedAt ||
      document.tombstonedAt ||
      source.deletedAt ||
      source.tombstonedAt ||
      deletedTargets.has(source.id) ||
      deletedTargets.has(document.id) ||
      deletedTargets.has(revision.id) ||
      deletedTargets.has(chunk.id)
    ) {
      return { reason: "DELETED" };
    }
    if (!["READY", "PUBLISHED", "SUPERSEDED"].includes(revision.status)) {
      return { reason: "DELETED" };
    }
    if (
      !effective(revision.effectiveFrom, revision.effectiveUntil, now) ||
      (revision.staleAfter !== null && revision.staleAfter <= now)
    ) {
      return { reason: "STALE" };
    }
    const fingerprint = sourcePermissionFingerprint(source);
    const audiences = resolvedAudiences(document.audience, document.classification);
    const effectiveScope = parseKnowledgeV2PersistedScope(revision.scopeSnapshot ?? document.scope);
    const permissionAllowed =
      manifest.authorizationFingerprint === fingerprint &&
      revision.sourcePermissionFingerprint === fingerprint &&
      document.permissionVersion === source.sourcePermissionVersion &&
      chunk.permissionVersion === document.permissionVersion &&
      payloadString(point.payload, "permission_fingerprint") === fingerprint &&
      payloadNumber(point.payload, "permission_version") === chunk.permissionVersion &&
      authorization.classifications.includes(chunk.classification) &&
      audiences.some((audience) => retrievalAudiences(authorization.audience).includes(audience)) &&
      localeVariants(authorization.locale).includes(chunk.locale) &&
      effectiveScope.state !== "INVALID" &&
      knowledgeV2DocumentPrefilterEnforcesScope(effectiveScope.scope, audiences, chunk.locale) &&
      samePersistedScope(chunk.scope, revision.scopeSnapshot ?? document.scope) &&
      samePersistedScope(manifest.scope, revision.scopeSnapshot ?? document.scope) &&
      documentScopeAllowed(source.defaultScope, authorization) &&
      documentScopeAllowed(document.scope, authorization) &&
      documentScopeAllowed(revision.scopeSnapshot, authorization) &&
      documentScopeAllowed(chunk.scope, authorization) &&
      documentScopeAllowed(manifest.scope, authorization);
    if (!permissionAllowed) return { reason: "PERMISSION_DENIED" };
    const payloadAudience = payloadStrings(point.payload, "audience");
    if (
      payloadAudience.length === 0 ||
      payloadAudience.some((audience) => !audiences.includes(audience as KnowledgeV2Audience))
    ) {
      return { reason: "PERMISSION_DENIED" };
    }
    const parentText = chunk.parentElement?.normalizedText;
    const range = record(chunk.provenanceRange);
    const start = range.start;
    const end = range.end;
    if (
      typeof parentText !== "string" ||
      typeof start !== "number" ||
      !Number.isInteger(start) ||
      typeof end !== "number" ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > parentText.length
    ) {
      return { reason: "DELETED" };
    }
    const exactContent = parentText.slice(start, end);
    if (!exactContent.trim() || hashKnowledgeValue(exactContent) !== chunk.contentHash) {
      return { reason: "DELETED" };
    }
    const expanded = boundedParentText(
      chunk.parentSection?.normalizedText ?? parentText,
      exactContent,
      this.policy.maximumParentCharacters,
    );
    const anchor = chunk.parentElement ?? chunk.parentSection;
    const evidence: Omit<KnowledgeV2DocumentEvidence, "rerankRank" | "rerankScore"> = {
      kind: "DOCUMENT",
      evidenceKey: `v2:document:${revision.id}:${chunk.id}:${chunk.contentHash}`,
      documentId: document.id,
      revisionId: revision.id,
      revisionHash: revision.contentHash,
      chunkId: chunk.id,
      sourceId: source.id,
      sourceKind: source.kind,
      title: document.title,
      content: boundedText(expanded, this.policy.maximumParentCharacters),
      contentHash: chunk.contentHash,
      classification: chunk.classification,
      locale: chunk.locale,
      headingPath: anchor?.headingPath ?? [],
      pageNumber: anchor?.pageNumber ?? null,
      urlAnchor: anchor?.urlAnchor ?? null,
      publicUrl: safePublicUrl(document.canonicalUri, chunk.classification),
      permissionFingerprint: fingerprint,
      permissionVersion: chunk.permissionVersion,
      fusedRank,
      fusedScore: point.score,
    };
    return { point, snapshotItem, evidence };
  }

  private documentReference(
    evidence:
      | Omit<KnowledgeV2DocumentEvidence, "rerankRank" | "rerankScore">
      | KnowledgeV2DocumentEvidence,
  ): KnowledgeV2TraceEvidenceReferenceDraft {
    return {
      evidenceKey: evidence.evidenceKey,
      targetType: "DOCUMENT_REVISION",
      itemVersionHash: evidence.revisionHash,
      documentRevisionId: evidence.revisionId,
      safeLabel: evidence.title,
      locatorHash: canonicalHash({
        chunkId: evidence.chunkId,
        headingPath: evidence.headingPath,
        pageNumber: evidence.pageNumber,
        urlAnchor: evidence.urlAnchor,
      }),
      isPublic: evidence.classification === "PUBLIC",
      confidence: clampConfidence(
        "rerankScore" in evidence ? evidence.rerankScore : evidence.fusedScore,
      ),
      permissionFingerprint: evidence.permissionFingerprint,
    };
  }

  private async conflicts(
    tenantId: string,
    query: string,
    facts: readonly KnowledgeV2ExactFactEvidence[],
    guidance: readonly KnowledgeV2GuidanceEvidence[],
    documents: readonly KnowledgeV2DocumentEvidence[],
  ): Promise<KnowledgeV2ConflictEvidence[]> {
    const factIds = sortedUnique(facts.map((item) => item.factId));
    const guidanceIds = sortedUnique(guidance.map((item) => item.guidanceRuleId));
    const revisionIds = sortedUnique(documents.map((item) => item.revisionId));
    const candidates: Prisma.KnowledgeV2ConflictWhereInput[] = [];
    if (factIds.length > 0) candidates.push({ factId: { in: factIds } });
    if (guidanceIds.length > 0) candidates.push({ guidanceRuleId: { in: guidanceIds } });
    if (revisionIds.length > 0) {
      candidates.push({ candidates: { some: { v2DocumentRevisionId: { in: revisionIds } } } });
    }
    if (candidates.length === 0) return [];
    const rows = await this.prisma.knowledgeV2Conflict.findMany({
      where: {
        tenantId,
        corpusKind: "STRUCTURED_V2",
        status: { in: ["OPEN", "IN_REVIEW"] },
        OR: candidates,
      },
      orderBy: [{ severity: "desc" }, { detectedAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    const now = this.now();
    const terms = queryTerms(query);
    return rows
      .filter((row) => effective(row.effectiveFrom, row.effectiveUntil, now))
      .filter(
        (row) =>
          lexicalScore(terms, [row.semanticKey]) > 0 || Boolean(row.factId || row.guidanceRuleId),
      )
      .map((row) => ({
        conflictId: row.id,
        safeLabel: row.semanticKey,
        riskLevel: row.severity,
        status: row.status as "OPEN" | "IN_REVIEW",
      }));
  }

  private citations(
    facts: readonly KnowledgeV2ExactFactEvidence[],
    guidance: readonly KnowledgeV2GuidanceEvidence[],
    documents: readonly KnowledgeV2DocumentEvidence[],
  ): KnowledgeV2BundleCitation[] {
    const evidence = [
      ...facts.map((item) => ({
        key: item.evidenceKey,
        hash: item.valueHash,
        confidence: item.score,
      })),
      ...guidance.map((item) => ({
        key: item.evidenceKey,
        hash: item.instructionHash,
        confidence: item.score,
      })),
      ...documents.map((item) => ({
        key: item.evidenceKey,
        hash: item.contentHash,
        confidence: item.rerankScore,
      })),
    ];
    return evidence.map((item, ordinal) => ({
      evidenceKey: item.key,
      claimHash: canonicalHash({ evidenceKey: item.key, evidenceHash: item.hash }),
      ordinal,
      confidence: clampConfidence(item.confidence),
    }));
  }

  private suppressedSummary(
    values: readonly { reason: KnowledgeV2RetrievalRejectionReason }[],
  ): KnowledgeV2SuppressedEvidence[] {
    const counts = new Map<KnowledgeV2RetrievalRejectionReason, number>();
    for (const value of values) counts.set(value.reason, (counts.get(value.reason) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([left], [right]) => compareCanonicalText(left, right))
      .map(([reason, count]) => ({ reason, count }));
  }

  private traceDraft(input: {
    target: ResolvedStructuredTarget;
    queryReference: { reference: string; hash: string; created?: boolean };
    queryHash: KnowledgeV2QueryHashBinding;
    authorization: KnowledgeRuntimeAuthorizationContext;
    graphVersion: string;
    permissionPartitions: readonly PermissionPartition[];
    outcome: KnowledgeV2RetrievalOutcome;
    gateOutcome: KnowledgeV2GateOutcome;
    candidates: KnowledgeV2TraceCandidateDraft[];
    citations: KnowledgeV2BundleCitation[];
    processorAdmission: KnowledgeV2ProcessorAdmission | null;
    processorQueryAdmission: KnowledgeV2ProcessorQueryAdmissionBinding;
    operational: OperationalQueryClassification;
    requirementHash: string;
    degradedReason?: KnowledgeV2RuntimeUnavailableReason | null;
    startedAt: number;
  }): KnowledgeV2TraceDraft {
    const filters: Prisma.InputJsonObject = {
      ...this.safeFilters(input.authorization),
      queryHash: { ...input.queryHash },
      operationalCategory: input.operational.category,
      requiresLiveEvidence: input.operational.requiresLiveEvidence,
      operationalRequirementHash: input.requirementHash,
      processorPolicyVersion: input.processorAdmission?.policyVersion ?? null,
      processorPolicyHash: input.processorAdmission?.policyHash ?? null,
      processorQueryAdmission: { ...input.processorQueryAdmission },
      documentRetrievalDegradedReason: input.degradedReason ?? null,
    };
    const permissionFingerprint = canonicalHash({
      filters,
      partitions: input.permissionPartitions,
    });
    const captured = input.target.captured;
    return {
      traceKeySeed: canonicalHash({
        target: captured,
        queryHash: input.queryHash,
        filtersHash: canonicalHash(filters),
        graphVersion: input.graphVersion,
      }),
      queryHash: input.queryHash,
      restrictedQueryRef: input.queryReference.reference,
      restrictedQueryCreated: input.queryReference.created ?? false,
      filters,
      filtersHash: canonicalHash(filters),
      permissionFingerprint,
      snapshotKind: captured.snapshotKind,
      targetKey: captured.targetKey,
      publicationId: captured.snapshotKind === "PUBLICATION" ? captured.publicationId : null,
      candidateId: captured.snapshotKind === "DRAFT_CANDIDATE" ? captured.candidateId : null,
      candidateVersion:
        captured.snapshotKind === "DRAFT_CANDIDATE" ? captured.candidateVersion : null,
      candidateManifestHash:
        captured.snapshotKind === "DRAFT_CANDIDATE" ? captured.candidateManifestHash : null,
      retrievalPolicyVersion: captured.retrievalPolicyVersion,
      retrievalProcessorPolicyHash: input.processorAdmission?.policyHash ?? null,
      rerankerVersion: this.dependencies.reranker.version,
      promptPolicyVersion: captured.promptPolicyVersion,
      graphVersion: input.graphVersion,
      provider: this.dependencies.denseProvider.schema.provider,
      generatorModel: null,
      outcome: input.outcome,
      gateOutcome: input.gateOutcome,
      candidates: input.candidates,
      citations: input.citations,
      latencyMs: Math.max(0, Date.now() - input.startedAt),
    };
  }

  async prepareTrace(input: {
    tenantId: string;
    draft: KnowledgeV2TraceDraft;
    finalAnswer?: string | null;
  }): Promise<PreparedKnowledgeV2Trace> {
    if (!input.finalAnswer) return { draft: input.draft };
    const bytes = new TextEncoder().encode(input.finalAnswer);
    try {
      const stored = await this.dependencies.restrictedStore.put({
        tenantId: input.tenantId,
        identity: `${input.draft.traceKeySeed}:${sha256(bytes)}`,
        purpose: "answer",
        content: bytes,
      });
      return {
        draft: input.draft,
        answerHash: stored.hash,
        restrictedTraceRef: stored.reference,
        restrictedTraceCreated: stored.created ?? false,
      };
    } catch {
      throw new KnowledgeV2RuntimeDependencyError("RESTRICTED_STORAGE_UNAVAILABLE", true);
    }
  }

  async cleanupTraceArtifacts(input: {
    draft: KnowledgeV2TraceDraft;
    prepared?: PreparedKnowledgeV2Trace | null;
  }) {
    const references = [
      ...(input.draft.restrictedQueryCreated ? [input.draft.restrictedQueryRef] : []),
      ...(input.prepared?.restrictedTraceCreated && input.prepared.restrictedTraceRef
        ? [input.prepared.restrictedTraceRef]
        : []),
    ];
    await Promise.all(
      references.map((reference) =>
        this.dependencies.restrictedStore.delete(reference).catch(() => undefined),
      ),
    );
  }

  async persistTrace(input: {
    tenantId: string;
    prepared: PreparedKnowledgeV2Trace;
    bundle: KnowledgeEvidenceBundle;
    binding: KnowledgeV2TraceBinding;
    transaction?: Prisma.TransactionClient;
  }) {
    const { draft } = input.prepared;
    if (
      (!input.binding.responseMessageId && !input.binding.evaluationRunId) ||
      (input.binding.evaluationResultId && !input.binding.evaluationRunId)
    ) {
      throw new Error("A retrieval trace requires an exact runtime or evaluation binding.");
    }
    const references = this.traceReferences(input.bundle, draft.candidates);
    const traceKey = canonicalHash({ seed: draft.traceKeySeed, binding: input.binding });
    const persist = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.knowledgeV2RetrievalTrace.findUnique({
        where: { tenantId_traceKey: { tenantId: input.tenantId, traceKey } },
        select: { id: true },
      });
      if (existing) return existing;
      await tx.knowledgeV2EvidenceReference.createMany({
        data: references.map((reference) => ({
          id: this.id(),
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2" as const,
          evidenceKey: reference.evidenceKey,
          targetType: reference.targetType,
          itemVersionHash:
            reference.targetType === "TOOL_RESULT" ? null : reference.itemVersionHash,
          v2DocumentRevisionId: reference.documentRevisionId ?? null,
          factVersionId: reference.factVersionId ?? null,
          guidanceRuleVersionId: reference.guidanceRuleVersionId ?? null,
          toolResultRef: reference.toolResultRef ?? null,
          safeLabel: boundedText(reference.safeLabel, 500),
          locatorHash: reference.locatorHash ?? null,
          isPublic: reference.isPublic,
          confidence: reference.confidence ?? null,
          observedAt: reference.observedAt ? new Date(reference.observedAt) : null,
          expiresAt: reference.expiresAt ? new Date(reference.expiresAt) : null,
          permissionFingerprint: reference.permissionFingerprint ?? null,
        })),
        skipDuplicates: true,
      });
      const persistedReferences = await tx.knowledgeV2EvidenceReference.findMany({
        where: {
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2",
          evidenceKey: { in: references.map((reference) => reference.evidenceKey) },
        },
        select: {
          id: true,
          evidenceKey: true,
          targetType: true,
          itemVersionHash: true,
          v2DocumentRevisionId: true,
          factVersionId: true,
          guidanceRuleVersionId: true,
          toolResultRef: true,
          safeLabel: true,
          locatorHash: true,
          isPublic: true,
          confidence: true,
          observedAt: true,
          expiresAt: true,
          permissionFingerprint: true,
        },
      });
      const referenceByKey = new Map(
        persistedReferences.map((reference) => [reference.evidenceKey, reference.id]),
      );
      if (referenceByKey.size !== references.length) {
        throw new Error("Retrieval evidence references could not be persisted.");
      }
      for (const reference of references) {
        const persisted = persistedReferences.find(
          (candidate) => candidate.evidenceKey === reference.evidenceKey,
        );
        if (
          !persisted ||
          persisted.targetType !== reference.targetType ||
          persisted.itemVersionHash !==
            (reference.targetType === "TOOL_RESULT" ? null : reference.itemVersionHash) ||
          persisted.v2DocumentRevisionId !== (reference.documentRevisionId ?? null) ||
          persisted.factVersionId !== (reference.factVersionId ?? null) ||
          persisted.guidanceRuleVersionId !== (reference.guidanceRuleVersionId ?? null) ||
          persisted.toolResultRef !== (reference.toolResultRef ?? null) ||
          persisted.safeLabel !== boundedText(reference.safeLabel, 500) ||
          persisted.locatorHash !== (reference.locatorHash ?? null) ||
          persisted.isPublic !== reference.isPublic ||
          persisted.observedAt?.toISOString() !== (reference.observedAt ?? undefined) ||
          persisted.expiresAt?.toISOString() !== (reference.expiresAt ?? undefined) ||
          persisted.permissionFingerprint !== (reference.permissionFingerprint ?? null)
        ) {
          throw new Error("Retrieval evidence reference identity changed.");
        }
      }
      const candidateManifestHash = canonicalHash(
        draft.candidates.map((candidate) => ({
          candidateKey: candidate.candidateKey,
          evidenceKey: candidate.evidenceKey,
          fusedRank: candidate.fusedRank,
          fusedScore: candidate.fusedScore,
          rerankRank: candidate.rerankRank ?? null,
          rerankScore: candidate.rerankScore ?? null,
          selected: candidate.selected,
          rejectionReason: candidate.rejectionReason ?? null,
        })),
      );
      const citationManifestHash = canonicalHash(draft.citations);
      const trace = await tx.knowledgeV2RetrievalTrace.create({
        data: {
          id: this.id(),
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2",
          traceKey,
          distributedTraceId: input.binding.distributedTraceId ?? null,
          snapshotKind: draft.snapshotKind,
          targetKey: draft.targetKey,
          publicationId: draft.publicationId ?? null,
          candidateId: draft.candidateId ?? null,
          candidateVersion: draft.candidateVersion ?? null,
          candidateManifestHash: draft.candidateManifestHash ?? null,
          evaluationRunId: input.binding.evaluationRunId ?? null,
          evaluationResultId: input.binding.evaluationResultId ?? null,
          responseMessageId: input.binding.responseMessageId ?? null,
          queryHash: draft.queryHash.hash,
          queryHashKeyId: draft.queryHash.keyId,
          queryHashVersion: draft.queryHash.version,
          restrictedQueryRef: draft.restrictedQueryRef,
          filters: draft.filters,
          filtersHash: draft.filtersHash,
          permissionFingerprint: draft.permissionFingerprint,
          candidateCount: draft.candidates.length,
          selectedCount: draft.candidates.filter((candidate) => candidate.selected).length,
          retrievalPolicyVersion: draft.retrievalPolicyVersion,
          retrievalProcessorPolicyHash: draft.retrievalProcessorPolicyHash ?? null,
          modelProcessorPolicyHash: draft.modelProcessorPolicyHash ?? null,
          rerankerVersion: draft.rerankerVersion ?? null,
          promptPolicyVersion: draft.promptPolicyVersion,
          graphVersion: draft.graphVersion,
          provider: draft.provider ?? null,
          generatorModel: draft.generatorModel ?? null,
          providerOutputHash: draft.providerOutputHash ?? null,
          gateInputHash: draft.gateInputHash ?? null,
          gateResultHash: draft.gateResultHash ?? null,
          outcome: draft.outcome,
          gateOutcome: draft.gateOutcome,
          answerHash: input.prepared.answerHash ?? null,
          restrictedTraceRef: input.prepared.restrictedTraceRef ?? null,
          retrievalCandidateManifestHash: candidateManifestHash,
          citationManifestHash,
          latencyMs: draft.latencyMs,
          retentionClass: "runtime-v1",
          retentionExpiresAt: new Date(this.now().getTime() + this.policy.retentionMs),
        },
      });
      if (draft.candidates.length > 0) {
        await tx.knowledgeV2RetrievalCandidate.createMany({
          data: draft.candidates.map((candidate) => ({
            id: this.id(),
            tenantId: input.tenantId,
            corpusKind: "STRUCTURED_V2" as const,
            retrievalTraceId: trace.id,
            candidateKey: candidate.candidateKey,
            evidenceReferenceId: referenceByKey.get(candidate.evidenceKey)!,
            fusedRank: candidate.fusedRank,
            fusedScore: candidate.fusedScore,
            rerankRank: candidate.rerankRank ?? null,
            rerankScore: candidate.rerankScore ?? null,
            selected: candidate.selected,
            rejectionReason: candidate.selected
              ? null
              : (candidate.rejectionReason ?? "NOT_SELECTED"),
          })),
        });
      }
      if (draft.citations.length > 0) {
        await tx.knowledgeV2Citation.createMany({
          data: draft.citations.map((citation) => ({
            id: this.id(),
            tenantId: input.tenantId,
            corpusKind: "STRUCTURED_V2" as const,
            citationKey: canonicalHash({ traceKey, ordinal: citation.ordinal }),
            retrievalTraceId: trace.id,
            evidenceReferenceId: referenceByKey.get(citation.evidenceKey)!,
            ordinal: citation.ordinal,
            claimHash: citation.claimHash,
            support: citation.support ?? "NOT_ASSESSED",
            confidence: citation.confidence ?? null,
          })),
        });
      }
      return { id: trace.id };
    };
    return input.transaction
      ? persist(input.transaction)
      : this.prisma.$transaction(persist, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
  }

  private traceReferences(
    bundle: KnowledgeEvidenceBundle,
    candidates: readonly KnowledgeV2TraceCandidateDraft[],
  ) {
    const byKey = new Map<string, KnowledgeV2TraceEvidenceReferenceDraft>();
    for (const candidate of candidates)
      byKey.set(candidate.reference.evidenceKey, candidate.reference);
    for (const fact of bundle.facts) {
      byKey.set(fact.evidenceKey, {
        evidenceKey: fact.evidenceKey,
        targetType: "FACT_VERSION",
        itemVersionHash: fact.versionHash,
        factVersionId: fact.versionId,
        safeLabel: fact.safeLabel,
        isPublic: false,
        confidence: clampConfidence(fact.score),
        observedAt: fact.observedAt ?? null,
        expiresAt: fact.expiresAt ?? null,
      });
    }
    for (const rule of bundle.guidance) {
      byKey.set(rule.evidenceKey, {
        evidenceKey: rule.evidenceKey,
        targetType: "GUIDANCE_RULE_VERSION",
        itemVersionHash: rule.versionHash,
        guidanceRuleVersionId: rule.versionId,
        safeLabel: rule.safeLabel,
        isPublic: false,
        confidence: clampConfidence(rule.score),
      });
    }
    for (const document of bundle.documents) {
      if (document.kind === "DOCUMENT") {
        byKey.set(document.evidenceKey, this.documentReference(document));
      }
    }
    for (const tool of bundle.liveToolResults) {
      const evidenceKey = `v2:tool:${tool.executionId}:${tool.contentHash}`;
      byKey.set(evidenceKey, {
        evidenceKey,
        targetType: "TOOL_RESULT",
        itemVersionHash: tool.contentHash,
        toolResultRef: tool.executionId,
        safeLabel: tool.safeName,
        locatorHash: knowledgeLiveToolResultEnvelopeHash(tool),
        isPublic: false,
        observedAt: tool.observedAt,
        expiresAt: tool.expiresAt,
        permissionFingerprint: tool.authorizationScopeHash,
      });
    }
    return [...byKey.values()].sort((left, right) =>
      compareCanonicalText(left.evidenceKey, right.evidenceKey),
    );
  }

  private async resolveLiveToolResults(input: {
    tenantId: string;
    query: string;
    queryHash: KnowledgeV2QueryHashBinding;
    operationalCategory: OperationalQueryCategory;
    authorization: KnowledgeRuntimeAuthorizationContext;
    signal?: AbortSignal;
    transaction?: Prisma.TransactionClient;
  }) {
    const resolver = this.dependencies.liveToolResultResolver;
    const executor = this.dependencies.liveToolResultExecutor;
    const executionContextId = input.authorization.executionContextId?.trim() ?? "";
    if (
      !resolver ||
      !executionContextId ||
      input.operationalCategory === OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE
    ) {
      return [];
    }
    const operationalCategory = input.operationalCategory;
    const authorizationScopeHash = knowledgeLiveToolAuthorizationScopeHash({
      tenantId: input.tenantId,
      authorization: input.authorization,
    });
    let executedReferences: readonly KnowledgeV2LiveToolResultReference[] = [];
    if (executor) {
      try {
        executedReferences = await executor.execute({
          tenantId: input.tenantId,
          executionContextId,
          query: input.query,
          queryHash: input.queryHash,
          operationalCategory,
          authorizationScopeHash,
          authorization: input.authorization,
          now: this.now(),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch {
        executedReferences = [];
      }
    }
    const references = [
      ...new Set(
        [...(input.authorization.liveToolResults ?? []), ...executedReferences]
          .map((item) => item.executionId.trim())
          .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/u.test(value)),
      ),
    ].slice(0, 8);
    const now = this.now();
    const resolved = await Promise.all(
      references.map(async (executionId) => {
        try {
          const result = await resolver.resolve({
            executionId,
            tenantId: input.tenantId,
            executionContextId,
            query: input.query,
            queryHash: input.queryHash,
            operationalCategory,
            authorizationScopeHash,
            now,
            ...(input.transaction ? { transaction: input.transaction } : {}),
          });
          return { executionId, result };
        } catch {
          return { executionId, result: null };
        }
      }),
    );
    return resolved.flatMap(({ executionId, result }) =>
      result &&
      isKnowledgeV2LiveToolResultValid({
        result,
        query: input.query,
        queryHashKeyring: this.dependencies.queryHashKeyring,
        executionId,
        tenantId: input.tenantId,
        executionContextId,
        queryHash: input.queryHash,
        operationalCategory,
        authorizationScopeHash,
        now,
      })
        ? [result]
        : [],
    );
  }

  private unavailable(
    reason: KnowledgeV2RuntimeUnavailableReason,
    retryable: boolean,
    startedAt: number,
    target: KnowledgeCapturedTarget | null,
  ): KnowledgeRuntimeRetrievalUnavailable {
    return {
      status: "unavailable",
      reason,
      retryable,
      target,
      diagnostics: unavailableDiagnostics(
        startedAt,
        target?.corpusKind ?? null,
        this.policy,
        this.dependencies.reranker.version,
      ),
    };
  }
}

export class PrismaKnowledgeV2DraftSnapshotResolver implements KnowledgeV2DraftSnapshotResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(input: {
    tenantId: string;
    validationId: string;
    indexSnapshotId: string | null;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash?: string | null;
  }): Promise<KnowledgeV2DraftTarget | null> {
    if (!input.candidateManifestHash) return null;
    const validation = await this.prisma.knowledgeV2PublicationValidation.findFirst({
      where: {
        id: input.validationId,
        tenantId: input.tenantId,
        corpusKind: "STRUCTURED_V2",
        targetKey: structuredTargetKey,
        candidateId: input.candidateId,
        candidateVersion: input.candidateVersion,
        candidateManifestHash: input.candidateManifestHash,
        status: "PASSED",
        validUntil: { gt: this.now() },
      },
      include: {
        indexSnapshot: true,
      },
      orderBy: [{ evaluatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (!validation) return null;
    if (validation.indexSnapshotId !== input.indexSnapshotId) return null;
    const items = this.parseItems(validation.candidateItems);
    if (!items || this.manifestHash(items) !== validation.candidateManifestHash) return null;
    const documentRevisionIds = new Set(
      items.flatMap((item) =>
        item.itemType === "DOCUMENT_REVISION" && item.documentRevisionId
          ? [item.documentRevisionId]
          : [],
      ),
    );
    const snapshot = validation.indexSnapshot;
    if (documentRevisionIds.size === 0) {
      if (snapshot) return null;
      return {
        corpusKind: "STRUCTURED_V2",
        targetKey: structuredTargetKey,
        candidateId: validation.candidateId,
        candidateVersion: validation.candidateVersion,
        candidateManifestHash: validation.candidateManifestHash,
        validationId: validation.id,
        indexSnapshotId: null,
        snapshotManifestHash: "structured-no-documents",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        pipelineVersion: "knowledge-v2",
        snapshotIdentity: null,
        items,
      };
    }
    const authorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot?.authorizationManifest,
      snapshot?.authorizationManifestHash,
    );
    if (
      !snapshot ||
      snapshot.corpusKind !== "STRUCTURED_V2" ||
      snapshot.status !== "READY" ||
      snapshot.deletedAt ||
      !snapshot.verifiedAt ||
      snapshot.authorizationManifestVersion !== 1 ||
      !authorizationManifest ||
      authorizationManifest.tenantId !== input.tenantId ||
      authorizationManifest.snapshotId !== snapshot.id ||
      authorizationManifest.snapshotManifestHash !== snapshot.manifestHash ||
      authorizationManifest.indexSchemaHash !== snapshot.indexSchemaHash ||
      authorizationManifest.expectedPointCount !== snapshot.expectedPointCount ||
      snapshot.expectedPointCount !== snapshot.observedPointCount ||
      snapshot.expectedPointCount <= 0
    ) {
      return null;
    }
    if (
      authorizationManifest.revisionIds.length !== documentRevisionIds.size ||
      authorizationManifest.revisionIds.some((revisionId) => !documentRevisionIds.has(revisionId))
    ) {
      return null;
    }
    return {
      corpusKind: "STRUCTURED_V2",
      targetKey: structuredTargetKey,
      candidateId: validation.candidateId,
      candidateVersion: validation.candidateVersion,
      candidateManifestHash: validation.candidateManifestHash,
      validationId: validation.id,
      indexSnapshotId: snapshot.id,
      snapshotManifestHash: snapshot.manifestHash,
      retrievalPolicyVersion: "knowledge-v2",
      promptPolicyVersion: "knowledge-v2",
      pipelineVersion: snapshot.pipelineVersion,
      snapshotIdentity:
        snapshot.indexSchema && snapshot.indexSchemaHash && snapshot.authorizationManifestHash
          ? {
              collectionName: snapshot.collectionName,
              embeddingProvider: snapshot.embeddingProvider,
              embeddingModel: snapshot.embeddingModel,
              indexSchema: snapshot.indexSchema,
              indexSchemaHash: snapshot.indexSchemaHash,
              authorizationManifest,
              authorizationManifestVersion: 1,
              authorizationManifestHash: snapshot.authorizationManifestHash,
            }
          : null,
      items,
    };
  }

  private parseItems(value: Prisma.JsonValue): KnowledgeV2DraftManifestItem[] | null {
    if (!Array.isArray(value) || value.length > 100_000) return null;
    const parsed: KnowledgeV2DraftManifestItem[] = [];
    for (const raw of value) {
      const item = record(raw);
      if (
        typeof item.itemType !== "string" ||
        ![
          "DOCUMENT_REVISION",
          "FACT_VERSION",
          "GUIDANCE_RULE_VERSION",
          "SOURCE_PERMISSION_SNAPSHOT",
        ].includes(item.itemType) ||
        typeof item.itemId !== "string" ||
        typeof item.itemVersionHash !== "string" ||
        typeof item.authorizationFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(item.authorizationFingerprint)
      ) {
        return null;
      }
      const itemType = item.itemType as KnowledgeV2DraftManifestItem["itemType"];
      const isStructuredScopeItem =
        itemType === "FACT_VERSION" || itemType === "GUIDANCE_RULE_VERSION";
      const persistedScope = parseKnowledgeV2PersistedScope(item.scope ?? null);
      const structuredScope = isStructuredScopeItem
        ? resolveKnowledgeV2StructuredScope(item.scope ?? null, null)
        : null;
      const usesTenantDefaultScope = item.usesTenantDefaultScope ?? false;
      const tenantDefaultScopeGeneration = item.tenantDefaultScopeGeneration ?? null;
      const tenantDefaultScopeHash = item.tenantDefaultScopeHash ?? null;
      if (
        persistedScope.state === "INVALID" ||
        (isStructuredScopeItem && !structuredScope) ||
        typeof usesTenantDefaultScope !== "boolean" ||
        (!isStructuredScopeItem && usesTenantDefaultScope) ||
        (usesTenantDefaultScope
          ? !Number.isInteger(tenantDefaultScopeGeneration) ||
            (tenantDefaultScopeGeneration as number) <= 0 ||
            typeof tenantDefaultScopeHash !== "string" ||
            !/^[a-f0-9]{64}$/u.test(tenantDefaultScopeHash)
          : tenantDefaultScopeGeneration !== null || tenantDefaultScopeHash !== null)
      ) {
        return null;
      }
      parsed.push({
        itemType,
        itemId: item.itemId,
        itemVersionHash: item.itemVersionHash,
        documentRevisionId: itemType === "DOCUMENT_REVISION" ? item.itemId : null,
        factVersionId: itemType === "FACT_VERSION" ? item.itemId : null,
        guidanceRuleVersionId: itemType === "GUIDANCE_RULE_VERSION" ? item.itemId : null,
        scope: item.scope ?? null,
        usesTenantDefaultScope,
        tenantDefaultScopeGeneration: usesTenantDefaultScope
          ? (tenantDefaultScopeGeneration as number)
          : null,
        tenantDefaultScopeHash: usesTenantDefaultScope ? (tenantDefaultScopeHash as string) : null,
        authorizationFingerprint: item.authorizationFingerprint,
      });
    }
    return parsed.sort((left, right) =>
      compareCanonicalText(`${left.itemType}:${left.itemId}`, `${right.itemType}:${right.itemId}`),
    );
  }

  private manifestHash(items: readonly KnowledgeV2DraftManifestItem[]) {
    return canonicalHash(
      items.map((item) => ({
        itemType: item.itemType,
        itemId: item.itemId,
        itemVersionHash: item.itemVersionHash,
        scope: item.scope ?? null,
        ...(item.usesTenantDefaultScope
          ? {
              usesTenantDefaultScope: true,
              tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
              tenantDefaultScopeHash: item.tenantDefaultScopeHash,
            }
          : {}),
        authorizationFingerprint: item.authorizationFingerprint,
      })),
    );
  }
}

export class KnowledgeRuntimeRetriever {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly legacy: KnowledgeRetriever,
    private readonly structured: KnowledgeV2Retriever | undefined,
    private readonly queryHashKeyring: KnowledgeV2QueryHashKeyring,
  ) {}

  async retrieve(input: KnowledgeRuntimeRetrieveInput): Promise<KnowledgeRuntimeRetrievalResult> {
    const startedAt = Date.now();
    if (input.publicationId) {
      const publication = await this.prisma.knowledgePublication.findFirst({
        where: {
          tenantId: input.tenantId,
          id: input.publicationId,
          status: { in: [...terminalPublicationStatuses] },
        },
        include: { indexSnapshot: true },
      });
      if (!publication) return this.noPublication(startedAt);
      return this.retrieveCaptured(input, publication, startedAt);
    }
    const selector = await this.prisma.knowledgeCorpusSelector.findUnique({
      where: { tenantId: input.tenantId },
      select: { corpusKind: true },
    });
    const corpusKind = selector?.corpusKind ?? "LEGACY_V1";
    const targetKey = corpusKind === "STRUCTURED_V2" ? structuredTargetKey : legacyTargetKey;
    const pointer = await this.prisma.activeKnowledgePublication.findUnique({
      where: {
        tenantId_targetKey: { tenantId: input.tenantId, targetKey },
      },
      include: { publication: { include: { indexSnapshot: true } } },
    });
    if (!pointer || pointer.publication.corpusKind !== corpusKind) {
      return this.noPublication(startedAt, corpusKind);
    }
    return this.retrieveCaptured(input, pointer.publication, startedAt);
  }

  async retrieveDraft(input: Parameters<KnowledgeV2Retriever["retrieveDraft"]>[0]) {
    if (!this.structured) {
      return {
        status: "unavailable" as const,
        reason: "RUNTIME_NOT_CONFIGURED" as const,
        retryable: false,
        diagnostics: unavailableDiagnostics(Date.now(), "STRUCTURED_V2"),
      };
    }
    return this.structured.retrieveDraft(input);
  }

  async revalidatePersistedReply(input: {
    tenantId: string;
    retrievalTraceId: string;
    responseMessageId: string;
    publicationId: string;
    query: string;
    executionContextId: string;
    transaction?: Prisma.TransactionClient;
  }): Promise<KnowledgeV2PersistedReplyRevalidation> {
    const database = input.transaction ?? this.prisma;
    const invalid = (
      reason: KnowledgeV2PersistedReplyRevalidation["reason"],
      manifest: unknown = { reason },
    ): KnowledgeV2PersistedReplyRevalidation => ({
      valid: false,
      reason,
      evidenceManifestHash: canonicalHash(manifest),
      promptPolicyVersion: null,
      classifications: [],
    });
    const [trace, selector] = await Promise.all([
      database.knowledgeV2RetrievalTrace.findFirst({
        where: {
          id: input.retrievalTraceId,
          tenantId: input.tenantId,
          responseMessageId: input.responseMessageId,
          publicationId: input.publicationId,
          corpusKind: "STRUCTURED_V2",
        },
        include: {
          responseMessage: { select: { text: true } },
          publication: { include: { items: true, indexSnapshot: true } },
          citations: {
            include: { evidenceReference: true },
            orderBy: { ordinal: "asc" },
          },
        },
      }),
      database.knowledgeCorpusSelector.findUnique({
        where: { tenantId: input.tenantId },
        select: { corpusKind: true },
      }),
    ]);
    if (!trace) return invalid("TRACE_MISSING");
    const answer = trace.responseMessage?.text ?? "";
    const queryHash = parseKnowledgeV2QueryHashBinding({
      hash: trace.queryHash,
      keyId: trace.queryHashKeyId,
      version: trace.queryHashVersion,
    });
    if (
      trace.id !== input.retrievalTraceId ||
      trace.responseMessageId !== input.responseMessageId ||
      trace.publicationId !== input.publicationId ||
      selector?.corpusKind !== "STRUCTURED_V2" ||
      !trace.publication ||
      trace.publication.targetKey !== structuredTargetKey ||
      !terminalPublicationStatuses.includes(
        trace.publication.status as (typeof terminalPublicationStatuses)[number],
      ) ||
      trace.snapshotKind !== "PUBLICATION" ||
      trace.distributedTraceId !== input.executionContextId ||
      trace.retentionExpiresAt <= new Date() ||
      trace.gateOutcome !== "AUTO_SEND" ||
      trace.outcome !== "ANSWERED" ||
      !answer ||
      trace.answerHash !== sha256(answer) ||
      !trace.restrictedTraceRef ||
      !trace.provider ||
      !trace.generatorModel ||
      !trace.modelProcessorPolicyHash ||
      !trace.providerOutputHash ||
      !trace.gateInputHash ||
      !trace.gateResultHash ||
      ![
        trace.modelProcessorPolicyHash,
        trace.providerOutputHash,
        trace.gateInputHash,
        trace.gateResultHash,
      ].every((value) => /^[a-f0-9]{64}$/u.test(value)) ||
      canonicalHash(trace.filters) !== trace.filtersHash ||
      !queryHash ||
      !this.queryHashKeyring.verify({
        tenantId: input.tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.ORIGINAL_QUERY,
        value: input.query.replace(/\s+/gu, " ").trim(),
        binding: queryHash,
      }) ||
      trace.citations.length === 0
    ) {
      return invalid("TARGET_CHANGED", { traceId: trace.id });
    }
    const persistedAuthorization = parseKnowledgeV2PersistedAuthorizationFilters({
      filters: trace.filters,
      executionContextId: input.executionContextId,
      queryHash,
    });
    if (!persistedAuthorization) {
      return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    }
    const {
      authorization,
      operationalCategory,
      processorQueryAdmission,
      retrievalProcessorPolicyVersion,
      retrievalProcessorPolicyHash,
      requiresLiveEvidence,
    } = persistedAuthorization;
    const currentProcessorQueryAdmission = revalidateKnowledgeV2ProcessorQueryAdmission(
      {
        tenantId: input.tenantId,
        query: input.query.replace(/\s+/gu, " ").trim(),
        classification: authorization.queryClassification,
        ...(authorization.intent !== undefined ? { intent: authorization.intent } : {}),
      },
      processorQueryAdmission,
      this.queryHashKeyring,
    );
    if (
      !currentProcessorQueryAdmission?.admitted ||
      currentProcessorQueryAdmission.operationalCategory !== operationalCategory ||
      currentProcessorQueryAdmission.requiresLiveEvidence !== requiresLiveEvidence ||
      !equalKnowledgeV2ProcessorQueryAdmissionBindings(
        projectKnowledgeV2ProcessorQueryAdmissionBinding(currentProcessorQueryAdmission),
        processorQueryAdmission,
      )
    ) {
      return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    }
    if (trace.retrievalProcessorPolicyHash !== retrievalProcessorPolicyHash) {
      return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    }
    const targetScopePolicy = await currentTargetScopePolicy(
      database,
      input.tenantId,
      trace.publication.items,
    );
    if (!targetScopePolicy.valid) {
      return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    }
    const itemByVersion = new Map(
      trace.publication.items.flatMap((item) =>
        item.itemVersionHash
          ? [[`${item.itemType}:${item.itemId}:${item.itemVersionHash}`, item] as const]
          : [],
      ),
    );
    const evidenceClassifications = new Set<KnowledgeV2SecurityClassification>([
      authorization.queryClassification,
    ]);
    const conflictTargets: Prisma.KnowledgeV2ConflictWhereInput[] = [];
    const evidenceManifest: unknown[] = [];
    let verifiedLiveEvidenceCount = 0;
    for (const citation of trace.citations) {
      const reference = citation.evidenceReference;
      if (
        citation.support !== "SUPPORTS" ||
        !/^[a-f0-9]{64}$/u.test(citation.claimHash) ||
        reference.tenantId !== input.tenantId
      ) {
        return invalid("EVIDENCE_CHANGED", { traceId: trace.id });
      }
      if (reference.targetType === "FACT_VERSION" && reference.factVersionId) {
        const version = await database.knowledgeV2FactVersion.findFirst({
          where: { id: reference.factVersionId, tenantId: input.tenantId },
          include: { fact: true, evidence: { orderBy: { id: "asc" }, take: 100 } },
        });
        const item = version
          ? itemByVersion.get(`FACT_VERSION:${version.id}:${version.immutableHash}`)
          : null;
        const binding =
          version && item
            ? structuredItemVersionBinding(item, version.scope, targetScopePolicy.policy)
            : null;
        if (
          !version ||
          !item ||
          reference.itemVersionHash !== version.immutableHash ||
          reference.evidenceKey !== `v2:fact:${version.id}:${version.immutableHash}` ||
          version.fact.deletedAt ||
          version.lifecycleStatus === "ARCHIVED" ||
          version.verificationStatus !== "VERIFIED" ||
          !effective(version.effectiveFrom, version.effectiveUntil, new Date()) ||
          !binding ||
          !scopeAllowed(binding, authorization) ||
          !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
            itemType: "FACT_VERSION",
            binding,
            rawScope: version.scope,
            riskLevel: version.riskLevel,
            authority: {
              authority: version.authority,
              verifiedByUserId: version.verifiedByUserId,
            },
            evidence: version.evidence,
          })
        ) {
          return invalid("EVIDENCE_CHANGED", { evidenceKey: reference.evidenceKey });
        }
        evidenceClassifications.add(
          ["HIGH", "CRITICAL"].includes(version.riskLevel) ? "SENSITIVE" : "INTERNAL",
        );
        conflictTargets.push({ factId: version.factId });
      } else if (
        reference.targetType === "GUIDANCE_RULE_VERSION" &&
        reference.guidanceRuleVersionId
      ) {
        const version = await database.knowledgeV2GuidanceRuleVersion.findFirst({
          where: { id: reference.guidanceRuleVersionId, tenantId: input.tenantId },
          include: {
            guidanceRule: true,
            evidence: { orderBy: { id: "asc" }, take: 100 },
          },
        });
        const item = version
          ? itemByVersion.get(`GUIDANCE_RULE_VERSION:${version.id}:${version.immutableHash}`)
          : null;
        const binding =
          version && item
            ? structuredItemVersionBinding(item, version.scope, targetScopePolicy.policy)
            : null;
        if (
          !version ||
          !item ||
          reference.itemVersionHash !== version.immutableHash ||
          reference.evidenceKey !== `v2:guidance:${version.id}:${version.immutableHash}` ||
          version.guidanceRule.deletedAt ||
          version.reviewStatus !== "APPROVED" ||
          !effective(version.effectiveFrom, version.effectiveUntil, new Date()) ||
          !binding ||
          !scopeAllowed(binding, authorization) ||
          !structuredAuthorizationFingerprintMatches(item.authorizationFingerprint, {
            itemType: "GUIDANCE_RULE_VERSION",
            binding,
            rawScope: version.scope,
            riskLevel: version.riskLevel,
            authority: {
              requiredApproverRole: version.requiredApproverRole,
              approvedByUserId: version.approvedByUserId,
            },
            evidence: version.evidence,
          })
        ) {
          return invalid("EVIDENCE_CHANGED", { evidenceKey: reference.evidenceKey });
        }
        evidenceClassifications.add(
          ["HIGH", "CRITICAL"].includes(version.riskLevel) ? "SENSITIVE" : "INTERNAL",
        );
        conflictTargets.push({ guidanceRuleId: version.guidanceRuleId });
      } else if (reference.targetType === "DOCUMENT_REVISION" && reference.v2DocumentRevisionId) {
        const match = /^v2:document:([^:]+):([^:]+):([a-f0-9]{64})$/u.exec(reference.evidenceKey);
        if (!match || match[1] !== reference.v2DocumentRevisionId) {
          return invalid("EVIDENCE_CHANGED", { evidenceKey: reference.evidenceKey });
        }
        const chunkId = match[2]!;
        const contentHash = match[3]!;
        const snapshotItem = await database.knowledgeV2IndexSnapshotItem.findFirst({
          where: {
            tenantId: input.tenantId,
            snapshotId: trace.publication.indexSnapshotId ?? "__missing__",
            chunkId,
            contentHash,
          },
          include: snapshotChunkInclude,
        });
        const revision = snapshotItem?.chunk.revision;
        const document = snapshotItem?.chunk.document;
        const source = document?.source;
        const item = revision
          ? itemByVersion.get(`DOCUMENT_REVISION:${revision.id}:${revision.contentHash}`)
          : null;
        const fingerprint = source ? sourcePermissionFingerprint(source) : null;
        const audiences = document
          ? resolvedAudiences(document.audience, document.classification)
          : [];
        const effectiveScope =
          revision && document
            ? parseKnowledgeV2PersistedScope(revision.scopeSnapshot ?? document.scope)
            : null;
        const deleted =
          snapshotItem && revision && document && source
            ? await database.knowledgeV2DeletionLedger.findFirst({
                where: {
                  tenantId: input.tenantId,
                  sourceId: source.id,
                  targetId: { in: [source.id, document.id, revision.id, snapshotItem.chunk.id] },
                  status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] },
                },
                select: { id: true },
              })
            : null;
        if (
          !snapshotItem ||
          !revision ||
          !document ||
          !source ||
          source.kind === "LEGACY_ONBOARDING" ||
          !item ||
          reference.itemVersionHash !== revision.contentHash ||
          reference.permissionFingerprint !== fingerprint ||
          item.authorizationFingerprint !== fingerprint ||
          revision.sourcePermissionFingerprint !== fingerprint ||
          snapshotItem.chunk.indexState !== "INDEXED" ||
          snapshotItem.chunk.deletedAt ||
          revision.deletedAt ||
          document.deletedAt ||
          document.tombstonedAt ||
          source.deletedAt ||
          source.tombstonedAt ||
          deleted ||
          document.status !== "ACTIVE" ||
          !["READY", "PUBLISHED", "SUPERSEDED"].includes(revision.status) ||
          !effective(revision.effectiveFrom, revision.effectiveUntil, new Date()) ||
          (revision.staleAfter !== null && revision.staleAfter <= new Date()) ||
          snapshotItem.contentHash !== snapshotItem.chunk.contentHash ||
          !/^[a-f0-9]{64}$/u.test(snapshotItem.pointFingerprint) ||
          !authorization.classifications.includes(snapshotItem.chunk.classification) ||
          !audiences.some((audience) =>
            retrievalAudiences(authorization.audience).includes(audience),
          ) ||
          !localeVariants(authorization.locale).includes(snapshotItem.chunk.locale) ||
          !effectiveScope ||
          effectiveScope.state === "INVALID" ||
          !knowledgeV2DocumentPrefilterEnforcesScope(
            effectiveScope.scope,
            audiences,
            snapshotItem.chunk.locale,
          ) ||
          !samePersistedScope(snapshotItem.chunk.scope, revision.scopeSnapshot ?? document.scope) ||
          !samePersistedScope(item.scope, revision.scopeSnapshot ?? document.scope) ||
          !documentScopeAllowed(source.defaultScope, authorization) ||
          !documentScopeAllowed(snapshotItem.chunk.scope, authorization) ||
          !documentScopeAllowed(document.scope, authorization) ||
          !documentScopeAllowed(revision.scopeSnapshot, authorization) ||
          !documentScopeAllowed(item.scope, authorization) ||
          document.permissionVersion !== source.sourcePermissionVersion ||
          snapshotItem.chunk.permissionVersion !== document.permissionVersion
        ) {
          return invalid("PERMISSION_CHANGED", { evidenceKey: reference.evidenceKey });
        }
        evidenceClassifications.add(snapshotItem.chunk.classification);
        conflictTargets.push({
          candidates: { some: { v2DocumentRevisionId: revision.id } },
        });
      } else if (reference.targetType === "TOOL_RESULT") {
        const expiresAt = reference.expiresAt?.getTime() ?? 0;
        const match = /^v2:tool:(.+):([a-f0-9]{64})$/u.exec(reference.evidenceKey);
        const executionId = match?.[1] ?? "";
        const hash = match?.[2] ?? "";
        if (
          !match ||
          !reference.toolResultRef ||
          reference.toolResultRef !== executionId ||
          !reference.locatorHash ||
          !reference.permissionFingerprint ||
          !reference.observedAt ||
          expiresAt <= Date.now() ||
          operationalCategory === OPERATIONAL_QUERY_CATEGORIES.STATIC_KNOWLEDGE ||
          !this.structured
        ) {
          return invalid("EVIDENCE_EXPIRED", { evidenceKey: reference.evidenceKey });
        }
        const verified = await this.structured.revalidatePersistedLiveToolResult({
          tenantId: input.tenantId,
          executionId,
          query: input.query,
          queryHash,
          operationalCategory,
          authorization,
          envelopeHash: reference.locatorHash,
          authorizationScopeHash: reference.permissionFingerprint,
          observedAt: reference.observedAt,
          expiresAt: reference.expiresAt,
          ...(input.transaction ? { transaction: input.transaction } : {}),
        });
        if (!verified || verified.contentHash !== hash) {
          return invalid("PERMISSION_CHANGED", { evidenceKey: reference.evidenceKey });
        }
        verifiedLiveEvidenceCount += 1;
        evidenceClassifications.add("CUSTOMER_PERSONAL");
      } else {
        return invalid("EVIDENCE_CHANGED", { evidenceKey: reference.evidenceKey });
      }
      evidenceManifest.push({
        evidenceKey: reference.evidenceKey,
        itemVersionHash: reference.itemVersionHash,
        permissionFingerprint: reference.permissionFingerprint,
        claimHash: citation.claimHash,
        ordinal: citation.ordinal,
      });
    }
    if (requiresLiveEvidence && verifiedLiveEvidenceCount === 0) {
      return invalid("EVIDENCE_CHANGED", { traceId: trace.id });
    }
    const hasDocumentEvidence = trace.citations.some(
      (citation) => citation.evidenceReference.targetType === "DOCUMENT_REVISION",
    );
    if (retrievalProcessorPolicyVersion && retrievalProcessorPolicyHash && this.structured) {
      const processorValid = await this.structured.revalidateRetrievalProcessorAdmission({
        tenantId: input.tenantId,
        retrievalPolicyVersion: trace.retrievalPolicyVersion,
        queryClassification: authorization.queryClassification,
        ...(hasDocumentEvidence ? { rerankerClassifications: [...evidenceClassifications] } : {}),
        expectedPolicyVersion: retrievalProcessorPolicyVersion,
        expectedPolicyHash: retrievalProcessorPolicyHash,
      });
      if (!processorValid) return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    } else if (hasDocumentEvidence || retrievalProcessorPolicyHash) {
      return invalid("PERMISSION_CHANGED", { traceId: trace.id });
    }
    if (conflictTargets.length > 0) {
      const conflict = await database.knowledgeV2Conflict.findFirst({
        where: {
          tenantId: input.tenantId,
          corpusKind: "STRUCTURED_V2",
          status: { in: ["OPEN", "IN_REVIEW"] },
          OR: conflictTargets,
        },
        select: { id: true },
      });
      if (conflict) return invalid("CONFLICT_DETECTED", { conflictId: conflict.id });
    }
    const citationManifestHash = canonicalHash(
      trace.citations.map((citation) => ({
        evidenceKey: citation.evidenceReference.evidenceKey,
        claimHash: citation.claimHash,
        ordinal: citation.ordinal,
        confidence: citation.confidence,
        support: citation.support,
      })),
    );
    if (citationManifestHash !== trace.citationManifestHash) {
      return invalid("EVIDENCE_CHANGED", { traceId: trace.id });
    }
    return {
      valid: true,
      reason: "VALID",
      evidenceManifestHash: canonicalHash({
        publicationId: trace.publicationId,
        answerHash: trace.answerHash,
        evidence: evidenceManifest,
      }),
      promptPolicyVersion: trace.promptPolicyVersion,
      classifications: [...evidenceClassifications].sort(),
    };
  }

  prepareTrace(input: Parameters<KnowledgeV2Retriever["prepareTrace"]>[0]) {
    if (!this.structured) {
      throw new KnowledgeV2RuntimeDependencyError("RUNTIME_NOT_CONFIGURED", false);
    }
    return this.structured.prepareTrace(input);
  }

  cleanupTraceArtifacts(input: Parameters<KnowledgeV2Retriever["cleanupTraceArtifacts"]>[0]) {
    if (!this.structured) return Promise.resolve();
    return this.structured.cleanupTraceArtifacts(input);
  }

  revalidateEvidence(input: Parameters<KnowledgeV2Retriever["revalidateEvidence"]>[0]) {
    if (!this.structured) {
      return Promise.resolve({
        valid: false,
        reason: "TARGET_CHANGED" as const,
        evidenceManifestHash: canonicalHash({ unavailable: true }),
      });
    }
    return this.structured.revalidateEvidence(input);
  }

  persistTrace(input: Parameters<KnowledgeV2Retriever["persistTrace"]>[0]) {
    if (!this.structured) {
      throw new KnowledgeV2RuntimeDependencyError("RUNTIME_NOT_CONFIGURED", false);
    }
    return this.structured.persistTrace(input);
  }

  private async retrieveCaptured(
    input: KnowledgeRuntimeRetrieveInput,
    publication: Prisma.KnowledgePublicationGetPayload<{ include: { indexSnapshot: true } }>,
    startedAt: number,
  ): Promise<KnowledgeRuntimeRetrievalResult> {
    if (
      publication.targetKey === structuredTargetKey &&
      publication.corpusKind === "STRUCTURED_V2"
    ) {
      if (!this.structured) {
        return {
          status: "unavailable",
          reason: "RUNTIME_NOT_CONFIGURED",
          retryable: false,
          target: this.capturedPublication(publication),
          diagnostics: unavailableDiagnostics(startedAt, "STRUCTURED_V2"),
        };
      }
      return this.structured.retrievePublication({
        tenantId: input.tenantId,
        publicationId: publication.id,
        query: input.query,
        authorization: input.authorization,
        graphVersion: input.graphVersion,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    }
    if (publication.targetKey !== legacyTargetKey || publication.corpusKind !== "LEGACY_V1") {
      return {
        status: "unavailable",
        reason: "PUBLICATION_INVALID",
        retryable: false,
        diagnostics: unavailableDiagnostics(startedAt, null),
      };
    }
    const target = this.capturedPublication(publication);
    const result = await this.legacy.retrieve({
      tenantId: input.tenantId,
      query: input.query,
      limit: input.limit,
      targetKey: publication.targetKey,
      publicationId: publication.id,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
    });
    const diagnostics: KnowledgeV2RuntimeDiagnostics = {
      backend: result.diagnostics.backend,
      corpusKind: "LEGACY_V1",
      candidateCount: result.diagnostics.candidateCount,
      hydratedCount: result.diagnostics.hydratedCount,
      selectedCount: result.status === "grounded" ? result.evidence.length : 0,
      durationMs: result.diagnostics.durationMs,
      retrievalPolicyVersion: publication.retrievalPolicyVersion,
      rerankerVersion: null,
    };
    if (result.status === "unavailable") {
      return {
        status: "unavailable",
        reason:
          result.reason === "no_active_publication"
            ? "NO_ACTIVE_PUBLICATION"
            : result.reason === "snapshot_not_ready"
              ? "SNAPSHOT_NOT_READY"
              : "QDRANT_UNAVAILABLE",
        retryable: result.retryable,
        target,
        diagnostics,
      };
    }
    const documents: KnowledgeLegacyDocumentEvidence[] =
      result.status === "grounded"
        ? result.evidence.map((item) => ({
            kind: "LEGACY_DOCUMENT",
            evidenceKey: `legacy:document:${item.revisionId}:${item.chunkId}:${item.contentHash}`,
            chunkId: item.chunkId,
            revisionId: item.revisionId,
            sourceId: item.sourceId,
            sourceKind: item.sourceType,
            title: item.title,
            content: item.content,
            contentHash: item.contentHash,
            score: item.score,
          }))
        : [];
    const citations = documents.map((item, ordinal) => ({
      evidenceKey: item.evidenceKey,
      claimHash: canonicalHash({ evidenceKey: item.evidenceKey, contentHash: item.contentHash }),
      ordinal,
      confidence: clampConfidence(item.score),
    }));
    const operational = classifyOperationalQuery(
      input.query,
      input.authorization.intent ?? undefined,
    );
    const requiresLiveEvidence = operational.requiresLiveEvidence;
    const canAnswer = documents.length > 0 && !requiresLiveEvidence;
    const queryHash = knowledgeLiveToolQueryHash({
      tenantId: input.tenantId,
      query: input.query,
      queryHashKeyring: this.queryHashKeyring,
    });
    const processorQueryAdmission = projectKnowledgeV2ProcessorQueryAdmissionBinding(
      admitKnowledgeV2ProcessorQuery(
        {
          tenantId: input.tenantId,
          query: input.query.replace(/\s+/gu, " ").trim(),
          classification: input.authorization.queryClassification,
          ...(input.authorization.intent !== undefined
            ? { intent: input.authorization.intent }
            : {}),
        },
        this.queryHashKeyring,
      ),
    );
    const bundle: KnowledgeEvidenceBundle = {
      schemaVersion: 1,
      corpusKind: "LEGACY_V1",
      target,
      outcome: canAnswer ? "ANSWERED" : requiresLiveEvidence ? "HANDED_OFF" : "ABSTAINED",
      gateOutcome: canAnswer ? "AUTO_SEND" : "HANDOFF",
      gateReasons: canAnswer
        ? ["EVIDENCE_READY"]
        : requiresLiveEvidence
          ? ["LIVE_EVIDENCE_REQUIRED"]
          : ["NO_MATCH"],
      facts: [],
      guidance: [],
      documents,
      conflicts: [],
      missingSupport: canAnswer
        ? []
        : requiresLiveEvidence
          ? ["LIVE_EVIDENCE_REQUIRED"]
          : ["NO_MATCH"],
      suppressedEvidence: [],
      citations: canAnswer ? citations : [],
      liveToolResults: [],
      answerPolicy: {
        requirementHash: knowledgeOperationalRequirementHash({
          queryHash,
          classification: operational,
        }),
        operationalCategory: operational.category,
        queryHash,
        processorQueryAdmission,
        requiresLiveEvidence,
        staticEvidenceMayAnswer: !requiresLiveEvidence,
        allowAutoSend: canAnswer,
      },
    };
    return canAnswer
      ? { status: "grounded", bundle, diagnostics }
      : {
          status: "insufficient_grounding",
          reason: requiresLiveEvidence ? "LIVE_EVIDENCE_REQUIRED" : "NO_MATCH",
          bundle,
          diagnostics,
        };
  }

  private capturedPublication(
    publication: Prisma.KnowledgePublicationGetPayload<{ include: { indexSnapshot: true } }>,
  ): KnowledgeCapturedPublicationTarget {
    return {
      corpusKind: publication.corpusKind,
      snapshotKind: "PUBLICATION",
      targetKey: publication.targetKey,
      publicationId: publication.id,
      publicationSequence: publication.sequence,
      publicationManifestHash: publication.manifestHash,
      indexSnapshotId: publication.indexSnapshotId,
      indexCollectionName: publication.indexSnapshot?.collectionName ?? null,
      indexSchemaHash: publication.indexSnapshot?.indexSchemaHash ?? null,
      indexAuthorizationManifestVersion:
        publication.indexSnapshot?.authorizationManifestVersion ?? null,
      indexAuthorizationManifestHash: publication.indexSnapshot?.authorizationManifestHash ?? null,
      embeddingProvider: publication.indexSnapshot?.embeddingProvider ?? null,
      embeddingModel: publication.indexSnapshot?.embeddingModel ?? null,
      retrievalPolicyVersion: publication.retrievalPolicyVersion,
      promptPolicyVersion: publication.promptPolicyVersion,
      pipelineVersion: publication.pipelineVersion,
    };
  }

  private noPublication(
    startedAt: number,
    corpusKind: KnowledgeRuntimeCorpus | null = null,
  ): KnowledgeRuntimeRetrievalUnavailable {
    return {
      status: "unavailable",
      reason: "NO_ACTIVE_PUBLICATION",
      retryable: false,
      diagnostics: unavailableDiagnostics(startedAt, corpusKind),
    };
  }
}
