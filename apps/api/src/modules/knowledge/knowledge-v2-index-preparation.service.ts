import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  DeterministicMultilingualKnowledgeV2SparseEncoder,
  createDeterministicKnowledgeObjectKey,
  buildKnowledgeV2SnapshotAuthorizationManifest,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  hashKnowledgeValue,
  KnowledgeV2EmbeddingProviderError,
  KnowledgeV2HybridIndexError,
  KnowledgeV2HybridQdrantClient,
  KnowledgeObjectStoreError,
  knowledgeV2DocumentPrefilterEnforcesScope,
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS,
  OpenAICompatibleKnowledgeV2EmbeddingProvider,
  parseKnowledgeV2PersistedScope,
  parseKnowledgeV2SnapshotAuthorizationManifest,
  resolveKnowledgeV2PersistedAudiences,
  stableKnowledgeValue,
  validateKnowledgeV2DenseEmbeddingBatch,
  validateKnowledgeV2HybridPointMetadata,
  validateKnowledgeV2SparseEncodingBatch,
  type KnowledgeV2DenseEmbeddingProvider,
  type KnowledgeV2HybridPointInput,
  type KnowledgeV2HybridReconcileResult,
  type KnowledgeV2IndexPermissionPartition,
  type KnowledgeV2PreparedHybridPoint,
  type KnowledgeV2SnapshotAuthorizationManifest,
  type KnowledgeV2SnapshotAuthorizationPoint,
  type KnowledgeV2SparseEncoder,
  type KnowledgeObjectStore,
  type KnowledgeV2SparseVector,
} from "@leadvirt/knowledge";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { canonicalKnowledgeV2Hash, knowledgeV2Error } from "./knowledge-v2-http.js";

const corpusKind = "STRUCTURED_V2";
const targetKey = "workspace-v2";
const indexPipelineVersion = "knowledge-v2-hybrid-v1";
const denseSchemaVersion = "knowledge-dense-v1";
const sparseSchemaVersion = "knowledge-sparse-v1";
const maximumReconcilePoints = 100_000;
const stalePreparationMs = 15 * 60 * 1000;

export const KNOWLEDGE_V2_INDEX_PREPARATION_DEPENDENCIES = Symbol.for(
  "leadvirt.knowledge-v2-index-preparation-dependencies",
);

export interface KnowledgeV2IndexClient {
  readonly physicalCollectionName: string;
  ensurePhysicalCollection(signal?: AbortSignal): Promise<unknown>;
  preparePoint(
    scope: KnowledgeV2IndexPermissionPartition,
    point: KnowledgeV2HybridPointInput,
  ): KnowledgeV2PreparedHybridPoint;
  upsertSnapshotPoints(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    points: readonly KnowledgeV2HybridPointInput[];
    signal?: AbortSignal;
  }): Promise<unknown>;
  countPermissionPartition(
    scope: KnowledgeV2IndexPermissionPartition,
    signal?: AbortSignal,
  ): Promise<number>;
  reconcilePermissionPartition(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    expected: readonly KnowledgeV2PreparedHybridPoint[];
    deleteUnexpected?: boolean;
    signal?: AbortSignal;
  }): Promise<KnowledgeV2HybridReconcileResult>;
  deleteSnapshotPartition(input: {
    workspaceId: string;
    indexSnapshotId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface KnowledgeV2IndexPreparationDependencies {
  denseProvider?: KnowledgeV2DenseEmbeddingProvider;
  sparseEncoder?: KnowledgeV2SparseEncoder;
  client?: KnowledgeV2IndexClient;
  cacheStore?: KnowledgeObjectStore;
  id?: () => string;
  now?: () => Date;
}

export interface KnowledgeV2PreparedSnapshotResult {
  snapshotId: string | null;
  expectedPointCount: number;
  observedPointCount: number;
  reused: boolean;
}

export interface KnowledgeV2IndexCandidateItem {
  itemType: string;
  itemId: string;
  itemVersionHash: string;
  authorizationFingerprint: string;
  scope: Prisma.JsonValue | null;
}

interface RestrictedRuntime {
  denseProvider: KnowledgeV2DenseEmbeddingProvider;
  sparseEncoder: KnowledgeV2SparseEncoder;
  client: KnowledgeV2IndexClient;
  cacheStore: KnowledgeObjectStore;
  deploymentFingerprint: string;
  providerRegion: string;
  providerPolicyHash: string;
}

interface CachedEncoding {
  denseVector: readonly number[];
  sparseVector: KnowledgeV2SparseVector;
}

interface AttemptCacheEntry {
  id: string;
  contentHash: string;
  objectStorageKey: string;
  created: boolean;
}

interface ChunkInput {
  id: string;
  text: string;
  locale: string;
  sourceId: string;
  sourceGeneration: number;
  permissionFingerprint: string;
  permissionVersion: number;
  point: Omit<KnowledgeV2HybridPointInput, "denseVector" | "sparseVector">;
}

interface PreparedPointInput {
  chunk: ChunkInput;
  point: KnowledgeV2HybridPointInput;
  scope: KnowledgeV2IndexPermissionPartition;
  prepared: KnowledgeV2PreparedHybridPoint;
}

interface SnapshotMembershipItem {
  chunkId: string;
  contentHash: string;
  vectorPointId: string;
  pointFingerprint: string;
}

interface SnapshotAuthorizationRecord {
  id: string;
  tenantId: string;
  manifestHash: string;
  indexSchemaHash: string | null;
  expectedPointCount: number;
  authorizationManifest: Prisma.JsonValue | null;
  authorizationManifestHash: string | null;
  authorizationManifestVersion: number | null;
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function strings(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeHash(value: string | null | undefined) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotMembershipHash(values: ReadonlyArray<SnapshotMembershipItem>) {
  return canonicalKnowledgeV2Hash(
    values
      .map((value) => ({
        chunkId: value.chunkId,
        contentHash: value.contentHash,
        vectorPointId: value.vectorPointId,
        pointFingerprint: value.pointFingerprint,
      }))
      .sort((left, right) => compareCanonicalText(left.chunkId, right.chunkId)),
  );
}

function dependencyCode(error: unknown) {
  if (error instanceof KnowledgeV2EmbeddingProviderError) return `EMBEDDING_${error.code}`;
  if (error instanceof KnowledgeV2HybridIndexError) return `QDRANT_${error.code}`;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `PRISMA_${error.code}`;
  return "INDEX_PREPARATION_FAILED";
}

function repairableReadySnapshotFailure(error: unknown) {
  if (error instanceof KnowledgeV2HybridIndexError) return true;
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "code" in response &&
    response.code === "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED"
  );
}

function encodingKey(contentHash: string, locale: string) {
  return `${contentHash}:${locale}`;
}

function cacheSchemaFingerprint(runtime: RestrictedRuntime, locale: string) {
  return canonicalKnowledgeV2Hash({
    version: 1,
    deploymentFingerprint: runtime.deploymentFingerprint,
    dense: runtime.denseProvider.schema,
    sparse: runtime.sparseEncoder.schema,
    providerPolicyHash: runtime.providerPolicyHash,
    locale,
  });
}

@Injectable()
export class KnowledgeV2IndexPreparationService {
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Optional()
    @Inject(KNOWLEDGE_V2_INDEX_PREPARATION_DEPENDENCIES)
    private readonly dependencies: KnowledgeV2IndexPreparationDependencies = {},
  ) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async preparePublication(input: {
    tenantId: string;
    publicationId: string;
    signal?: AbortSignal;
  }): Promise<KnowledgeV2PreparedSnapshotResult> {
    const publication = await this.loadPublication(input.tenantId, input.publicationId);
    const publicationMetadata = record(publication.qualitySummary);
    const items = publication.items.map((item) => ({
      itemType: item.itemType,
      itemId: item.itemId,
      itemVersionHash: item.itemVersionHash ?? "",
      authorizationFingerprint: item.authorizationFingerprint ?? "",
      scope: item.scope,
    }));
    return this.prepareManifest({
      tenantId: input.tenantId,
      items,
      requiredSnapshotId: publication.indexSnapshotId,
      publicationId: publication.id,
      allowHistoricalRevisions: publicationMetadata.operation === "ROLLBACK",
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async prepareCandidate(input: {
    tenantId: string;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash: string;
    items: readonly KnowledgeV2IndexCandidateItem[];
    signal?: AbortSignal;
  }): Promise<KnowledgeV2PreparedSnapshotResult> {
    if (
      !input.candidateId.trim() ||
      input.candidateVersion <= 0 ||
      !safeHash(input.candidateManifestHash)
    ) {
      throw this.manifestConflict();
    }
    return this.prepareManifest({
      tenantId: input.tenantId,
      items: input.items,
      requiredSnapshotId: null,
      publicationId: null,
      allowHistoricalRevisions: false,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  private async prepareManifest(input: {
    tenantId: string;
    items: readonly KnowledgeV2IndexCandidateItem[];
    requiredSnapshotId: string | null;
    publicationId: string | null;
    allowHistoricalRevisions: boolean;
    signal?: AbortSignal;
  }): Promise<KnowledgeV2PreparedSnapshotResult> {
    let snapshotId: string | null = null;
    let runtime: RestrictedRuntime | null = null;
    let preparingAttempt = false;
    const attemptCacheEntries: AttemptCacheEntry[] = [];
    try {
      const documentItems = input.items.filter(
        (item): item is KnowledgeV2IndexCandidateItem & { itemType: "DOCUMENT_REVISION" } =>
          item.itemType === "DOCUMENT_REVISION",
      );
      if (documentItems.length === 0) {
        if (input.requiredSnapshotId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_INDEX_SNAPSHOT_UNEXPECTED",
            "A publication without documents cannot reference an index snapshot.",
          );
        }
        return { snapshotId: null, expectedPointCount: 0, observedPointCount: 0, reused: false };
      }
      runtime = this.runtime();
      const chunks = await this.chunkInputs(
        input.tenantId,
        documentItems,
        runtime,
        input.allowHistoricalRevisions,
      );
      if (
        new Set(chunks.map((chunk) => `${chunk.permissionFingerprint}:${chunk.permissionVersion}`))
          .size > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS
      ) {
        throw this.manifestConflict();
      }
      runtime.providerPolicyHash = await this.assertProviderAdmission(
        input.tenantId,
        chunks,
        runtime,
      );
      const indexSchema: Prisma.InputJsonObject = {
        schemaVersion: 1,
        dense: { ...runtime.denseProvider.schema },
        sparse: { ...runtime.sparseEncoder.schema },
        embeddingDeploymentFingerprint: runtime.deploymentFingerprint,
        embeddingRegion: runtime.providerRegion,
        embeddingProviderPolicyHash: runtime.providerPolicyHash,
        locales: [...new Set(chunks.map((chunk) => chunk.locale))].sort(),
        pipelineVersion: indexPipelineVersion,
      };
      const indexSchemaHash = canonicalKnowledgeV2Hash(indexSchema);
      const documentManifestHash = canonicalKnowledgeV2Hash({
        version: 1,
        corpusKind,
        documents: documentItems
          .map((item) => ({
            revisionId: item.itemId,
            contentHash: item.itemVersionHash,
            authorizationFingerprint: item.authorizationFingerprint,
            scope: item.scope,
          }))
          .sort((left, right) => compareCanonicalText(left.revisionId, right.revisionId)),
        indexSchemaHash,
      });
      let resolved = await this.resolveSnapshot({
        tenantId: input.tenantId,
        publicationSnapshotId: input.requiredSnapshotId,
        manifestHash: documentManifestHash,
        collectionName: runtime.client.physicalCollectionName,
        embeddingProvider: runtime.denseProvider.schema.provider,
        embeddingModel: runtime.denseProvider.schema.model,
        indexSchema,
        indexSchemaHash,
      });
      snapshotId = resolved.id;
      preparingAttempt = resolved.status === "PREPARING";
      if (
        !resolved.indexSchema ||
        canonicalKnowledgeV2Hash(resolved.indexSchema) !== indexSchemaHash
      ) {
        throw this.manifestConflict();
      }
      await this.assertPreparationFence({
        tenantId: input.tenantId,
        snapshotId: resolved.id,
        preparationStartedAt:
          resolved.status === "PREPARING" ? resolved.preparationStartedAt : null,
        chunks,
        allowHistoricalRevisions: input.allowHistoricalRevisions,
      });
      await runtime.client.ensurePhysicalCollection(input.signal);
      if (resolved.redriven && !resolved.preservedMembership) {
        await runtime.client.deleteSnapshotPartition({
          workspaceId: input.tenantId,
          indexSnapshotId: resolved.id,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      }
      if (resolved.status === "READY") {
        try {
          const ready = await this.verifyReadySnapshot({
            tenantId: input.tenantId,
            snapshot: resolved,
            chunks,
            client: runtime.client,
            publicationId: input.publicationId,
            allowHistoricalRevisions: input.allowHistoricalRevisions,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          return { ...ready, reused: true };
        } catch (error) {
          if (!repairableReadySnapshotFailure(error)) throw error;
          resolved = await this.claimReadySnapshotRepair({
            tenantId: input.tenantId,
            snapshotId: resolved.id,
            chunks,
          });
          preparingAttempt = true;
        }
      }
      const prepared = await this.preparePoints(
        input.tenantId,
        resolved.id,
        chunks,
        runtime,
        resolved.preparationStartedAt,
        input.allowHistoricalRevisions,
        attemptCacheEntries,
        input.signal,
      );
      const preparedMembership = prepared.map((item) => ({
        chunkId: item.chunk.id,
        contentHash: item.chunk.point.contentHash,
        vectorPointId: item.prepared.id,
        pointFingerprint: item.prepared.pointFingerprint,
      }));
      const authorization =
        resolved.authorizationManifest || resolved.authorizationManifestHash
          ? this.reconcileStoredAuthorizationManifest(resolved, chunks, preparedMembership)
          : buildKnowledgeV2SnapshotAuthorizationManifest({
              tenantId: input.tenantId,
              snapshotId: resolved.id,
              snapshotManifestHash: documentManifestHash,
              indexSchemaHash,
              points: prepared.map((item) => this.authorizationPoint(item)),
            });
      if (resolved.preservedMembership) {
        await this.assertPreparedMembership(input.tenantId, resolved.id, prepared);
        await this.assertPreparationFence({
          tenantId: input.tenantId,
          snapshotId: resolved.id,
          preparationStartedAt: resolved.preparationStartedAt,
          chunks,
          allowHistoricalRevisions: input.allowHistoricalRevisions,
        });
        await runtime.client.deleteSnapshotPartition({
          workspaceId: input.tenantId,
          indexSnapshotId: resolved.id,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      }
      const observedPointCount = await this.upsertAndReconcile(
        runtime.client,
        prepared,
        async () => {
          await this.assertPreparationFence({
            tenantId: input.tenantId,
            snapshotId: resolved.id,
            preparationStartedAt: resolved.preparationStartedAt,
            chunks,
            allowHistoricalRevisions: input.allowHistoricalRevisions,
          });
          await this.assertProviderFence(input.tenantId, chunks, runtime!);
        },
        input.signal,
      );
      if (observedPointCount !== prepared.length) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_INDEX_POINT_COUNT_MISMATCH",
          "The prepared knowledge index did not reconcile.",
          { retryable: true },
        );
      }
      await this.commitReadySnapshot({
        tenantId: input.tenantId,
        snapshotId: resolved.id,
        expected: preparedMembership,
        observedPointCount,
        publicationId: input.publicationId,
        acceptedSources: this.acceptedSources(chunks),
        authorizationManifest: authorization.manifest,
        authorizationManifestHash: authorization.hash,
        chunks,
        preparationStartedAt: resolved.preparationStartedAt,
        allowHistoricalRevisions: input.allowHistoricalRevisions,
      });
      return {
        snapshotId: resolved.id,
        expectedPointCount: prepared.length,
        observedPointCount,
        reused: resolved.reused,
      };
    } catch (error) {
      let compensationFailed = false;
      if (snapshotId && runtime && preparingAttempt) {
        await runtime.client
          .deleteSnapshotPartition({
            workspaceId: input.tenantId,
            indexSnapshotId: snapshotId,
            ...(input.signal ? { signal: input.signal } : {}),
          })
          .catch(() => {
            compensationFailed = true;
          });
      }
      if (runtime) {
        await this.cleanupAttemptCacheEntries(
          input.tenantId,
          attemptCacheEntries,
          runtime.cacheStore,
        ).catch(() => undefined);
      }
      if (snapshotId) {
        await this.prisma.knowledgeIndexSnapshot
          .updateMany({
            where: { id: snapshotId, status: "PREPARING" },
            data: {
              errorCode:
                `${compensationFailed ? "COMPENSATION_PENDING_" : ""}${dependencyCode(error)}`.slice(
                  0,
                  190,
                ),
            },
          })
          .catch(() => undefined);
      }
      if (error instanceof HttpException) throw error;
      const code = dependencyCode(error);
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_UNAVAILABLE",
        "The knowledge index could not be prepared.",
        { retryable: true, details: { dependencyCode: code } },
      );
    }
  }

  private runtime(): RestrictedRuntime {
    if (
      !this.config.knowledgeEmbeddingProviderApproved ||
      !this.config.ragQdrantEnabled ||
      this.config.ragRetrievalMode !== "qdrant" ||
      !this.config.aiApiKey ||
      !this.config.knowledgeObjectStorePath ||
      !this.config.knowledgeArtifactEncryptionKey ||
      this.config.knowledgeV2EmbeddingDeployment === "unconfigured" ||
      this.config.knowledgeV2EmbeddingRegion === "unconfigured"
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_EMBEDDING_PROVIDER_NOT_APPROVED",
        "Knowledge indexing is not configured for an approved provider.",
        { retryable: true },
      );
    }
    const denseProvider =
      this.dependencies.denseProvider ??
      new OpenAICompatibleKnowledgeV2EmbeddingProvider({
        baseUrl: this.config.aiBaseUrl,
        apiKey: this.config.aiApiKey,
        model: this.config.knowledgeV2EmbeddingModel,
        dimensions: this.config.knowledgeV2EmbeddingDimensions,
        requestTimeoutMs: this.config.knowledgeV2EmbeddingTimeoutMs,
        maxBatchSize: this.config.knowledgeV2EmbeddingBatchSize,
        schemaVersion: denseSchemaVersion,
      });
    const sparseEncoder =
      this.dependencies.sparseEncoder ??
      new DeterministicMultilingualKnowledgeV2SparseEncoder({
        maxNonZeroValues: this.config.knowledgeV2SparseMaxNonZero,
        schemaVersion: sparseSchemaVersion,
      });
    const client =
      this.dependencies.client ??
      new KnowledgeV2HybridQdrantClient({
        qdrantUrl: this.config.ragQdrantUrl,
        ...(this.config.ragQdrantApiKey ? { qdrantApiKey: this.config.ragQdrantApiKey } : {}),
        collectionPrefix: this.config.ragQdrantCollection,
        dense: denseProvider.schema,
        sparse: sparseEncoder.schema,
        requestTimeoutMs: this.config.ragQdrantTimeoutMs,
        maxAttempts: 3,
        retryBaseDelayMs: 250,
        maxBatchSize: Math.min(this.config.knowledgeV2EmbeddingBatchSize, 256),
        maxReconcilePoints: maximumReconcilePoints,
      });
    const providerUrl = new URL(this.config.aiBaseUrl);
    const providerRegion = this.config.knowledgeV2EmbeddingRegion;
    const deploymentFingerprint = canonicalKnowledgeV2Hash({
      version: 1,
      origin: providerUrl.origin.toLowerCase(),
      path: providerUrl.pathname.replace(/\/+$/u, "") || "/",
      deployment: this.config.knowledgeV2EmbeddingDeployment,
      region: providerRegion,
      dense: denseProvider.schema,
      sparse: sparseEncoder.schema,
    });
    const cacheStore =
      this.dependencies.cacheStore ??
      new EncryptedFileKnowledgeObjectStore({
        rootPath: this.config.knowledgeObjectStorePath,
        activeKey: {
          id: this.config.knowledgeArtifactEncryptionKeyId,
          key: decodeKnowledgeObjectEncryptionKey(this.config.knowledgeArtifactEncryptionKey),
        },
        maxPlaintextBytes: 4 * 1024 * 1024,
      });
    return {
      denseProvider,
      sparseEncoder,
      client,
      cacheStore,
      deploymentFingerprint,
      providerRegion,
      providerPolicyHash: "",
    };
  }

  private async assertProviderAdmission(
    tenantId: string,
    chunks: readonly ChunkInput[],
    runtime: RestrictedRuntime,
  ) {
    const settings = await this.prisma.knowledgeV2Settings.findUnique({
      where: { tenantId },
      select: { embeddingRegion: true, embeddingProviderPolicy: true },
    });
    const policy = record(settings?.embeddingProviderPolicy);
    const allowed = strings(policy.allowedClassifications);
    const classifications = [
      "PUBLIC",
      "INTERNAL",
      "CUSTOMER_PERSONAL",
      "SENSITIVE",
      "SECRET",
    ] as const;
    const ceiling = classifications.indexOf(
      this.config.knowledgeV2ExternalEmbeddingMaxClassification,
    );
    const valid =
      policy.schemaVersion === 1 &&
      policy.approved === true &&
      policy.provider === runtime.denseProvider.schema.provider &&
      policy.policyVersion === this.config.knowledgeV2EmbeddingPolicyVersion &&
      policy.deployment === this.config.knowledgeV2EmbeddingDeployment &&
      policy.region === runtime.providerRegion &&
      (!settings?.embeddingRegion || settings.embeddingRegion === runtime.providerRegion) &&
      allowed.length > 0 &&
      new Set(allowed).size === allowed.length &&
      allowed.every((value) => {
        const rank = classifications.indexOf(value as (typeof classifications)[number]);
        return rank >= 0 && rank <= ceiling;
      }) &&
      chunks.every((chunk) => allowed.includes(chunk.point.classification));
    if (!valid) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_SECURITY_EMBEDDING_POLICY_DENIED",
        "The tenant embedding provider policy does not allow this content.",
      );
    }
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      policyVersion: policy.policyVersion,
      approved: true,
      provider: policy.provider,
      deployment: policy.deployment,
      region: policy.region,
      allowedClassifications: [...allowed].sort(),
    });
  }

  private async assertProviderFence(
    tenantId: string,
    chunks: readonly ChunkInput[],
    runtime: RestrictedRuntime,
  ) {
    const currentPolicyHash = await this.assertProviderAdmission(tenantId, chunks, runtime);
    if (currentPolicyHash !== runtime.providerPolicyHash) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_SECURITY_EMBEDDING_POLICY_DENIED",
        "The tenant embedding provider policy changed during index preparation.",
      );
    }
  }

  private async loadPublication(tenantId: string, publicationId: string) {
    const publication = await this.prisma.knowledgePublication.findFirst({
      where: { id: publicationId, tenantId, targetKey, corpusKind },
      include: {
        items: {
          orderBy: [{ itemType: "asc" }, { itemId: "asc" }],
        },
      },
    });
    if (!publication) {
      throw knowledgeV2Error(
        HttpStatus.NOT_FOUND,
        "KNOWLEDGE_PUBLICATION_NOT_FOUND",
        "The knowledge publication was not found.",
      );
    }
    if (!["VALIDATING", "READY", "PUBLISHING", "ACTIVE"].includes(publication.status)) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_STATE_INVALID",
        "The publication cannot prepare an index from its current state.",
      );
    }
    return publication;
  }

  private async chunkInputs(
    tenantId: string,
    items: readonly (KnowledgeV2IndexCandidateItem & { itemType: "DOCUMENT_REVISION" })[],
    runtime: RestrictedRuntime,
    allowHistoricalRevisions: boolean,
  ) {
    if (
      new Set(items.map((item) => item.itemId)).size !== items.length ||
      items.some(
        (item) =>
          !item.itemId.trim() ||
          !safeHash(item.itemVersionHash) ||
          !safeHash(item.authorizationFingerprint),
      )
    ) {
      throw this.manifestConflict();
    }
    const revisions = await this.prisma.knowledgeV2DocumentRevision.findMany({
      where: { tenantId, id: { in: items.map((item) => item.itemId) } },
      include: {
        document: { include: { source: true } },
        chunks: {
          where: { deletedAt: null },
          include: { parentElement: true },
          orderBy: { ordinal: "asc" },
        },
      },
      orderBy: { id: "asc" },
    });
    if (revisions.length !== items.length) throw this.manifestConflict();
    const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
    const chunks: ChunkInput[] = [];
    for (const item of items) {
      const revision = revisionsById.get(item.itemId);
      if (!revision || item.itemVersionHash !== revision.contentHash) {
        throw this.manifestConflict();
      }
      const document = revision.document;
      const source = document.source;
      const evaluatedAt = this.now();
      const effectiveScope = parseKnowledgeV2PersistedScope(
        revision.scopeSnapshot ?? document.scope,
      );
      const audiencePolicy = resolveKnowledgeV2PersistedAudiences(
        document.audience,
        document.classification,
      );
      const invalidScope = [
        item.scope,
        source.defaultScope,
        document.scope,
        revision.scopeSnapshot,
        ...revision.chunks.map((chunk) => chunk.scope),
      ].some((scope) => parseKnowledgeV2PersistedScope(scope).state === "INVALID");
      const fingerprint = hashKnowledgeValue(
        stableKnowledgeValue({
          tenantId: source.tenantId,
          sourceId: source.id,
          permissionVersion: source.sourcePermissionVersion,
          scope: source.defaultScope,
          classification: source.defaultClassification,
          locale: source.defaultLocale,
        }),
      );
      if (
        item.authorizationFingerprint !== fingerprint ||
        revision.sourcePermissionFingerprint !== fingerprint ||
        stableKnowledgeValue(item.scope) !==
          stableKnowledgeValue(revision.scopeSnapshot ?? document.scope) ||
        effectiveScope.state === "INVALID" ||
        audiencePolicy.state === "INVALID" ||
        invalidScope ||
        document.permissionVersion !== source.sourcePermissionVersion ||
        revision.deletedAt ||
        (revision.effectiveFrom && revision.effectiveFrom > evaluatedAt) ||
        (revision.effectiveUntil && revision.effectiveUntil <= evaluatedAt) ||
        (revision.staleAfter && revision.staleAfter <= evaluatedAt) ||
        (!["CHUNKING", "READY", "PUBLISHED"].includes(revision.status) &&
          !(allowHistoricalRevisions && revision.status === "SUPERSEDED")) ||
        document.deletedAt ||
        document.tombstonedAt ||
        source.deletedAt ||
        source.tombstonedAt ||
        (!["SYNCING", "READY", "PAUSED"].includes(source.status) &&
          !(allowHistoricalRevisions && source.status === "NEEDS_REVIEW") &&
          !(
            source.status === "FAILED" &&
            source.lastErrorCode === "KNOWLEDGE_DEPENDENCY_INDEXING_UNAVAILABLE"
          )) ||
        revision.chunks.length === 0
      ) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH",
          "The document permission snapshot changed before indexing.",
        );
      }
      const scope = effectiveScope.scope;
      const audiences = audiencePolicy.audiences;
      for (const chunk of revision.chunks) {
        if (
          stableKnowledgeValue(chunk.scope) !==
            stableKnowledgeValue(revision.scopeSnapshot ?? document.scope) ||
          !knowledgeV2DocumentPrefilterEnforcesScope(scope, audiences, chunk.locale) ||
          chunk.permissionVersion !== document.permissionVersion ||
          chunk.denseSchemaVersion !== runtime.denseProvider.schema.schemaVersion ||
          chunk.sparseSchemaVersion !== runtime.sparseEncoder.schema.schemaVersion ||
          !safeHash(chunk.contentHash)
        ) {
          throw this.manifestConflict();
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
          throw this.manifestConflict();
        }
        const text = parentText.slice(start, end);
        if (!text.trim() || hashKnowledgeValue(text) !== chunk.contentHash) {
          throw this.manifestConflict();
        }
        const point: ChunkInput["point"] = {
          documentId: document.id,
          revisionId: revision.id,
          chunkId: chunk.id,
          locale: chunk.locale,
          audiences,
          classification: chunk.classification,
          locationIds: scope.locationIds,
          brandIds: scope.brandIds,
          segmentIds: scope.segments,
          channelIds: scope.channelTypes,
          assistantIds: scope.assistantIds,
          sourceKind: source.kind,
          documentKind: document.kind,
          contentHash: chunk.contentHash,
          pipelineVersion: indexPipelineVersion,
        };
        validateKnowledgeV2HybridPointMetadata(point);
        chunks.push({
          id: chunk.id,
          text,
          locale: chunk.locale,
          sourceId: source.id,
          sourceGeneration: source.generation,
          permissionFingerprint: fingerprint,
          permissionVersion: chunk.permissionVersion,
          point,
        });
      }
    }
    if (new Set(chunks.map((chunk) => chunk.id)).size !== chunks.length) {
      throw this.manifestConflict();
    }
    return chunks;
  }

  private async assertPreparationFence(input: {
    tenantId: string;
    snapshotId: string;
    preparationStartedAt: Date | null;
    chunks: ChunkInput[];
    allowHistoricalRevisions: boolean;
    transaction?: Prisma.TransactionClient;
  }) {
    const database = input.transaction ?? this.prisma;
    if (input.preparationStartedAt) {
      const snapshot = await database.knowledgeIndexSnapshot.findFirst({
        where: {
          id: input.snapshotId,
          tenantId: input.tenantId,
          corpusKind,
          status: "PREPARING",
          preparationStartedAt: input.preparationStartedAt,
        },
        select: { id: true },
      });
      if (!snapshot) throw this.manifestConflict();
    }
    const sourceExpectations = new Map(
      input.chunks.map((chunk) => [
        chunk.sourceId,
        {
          generation: chunk.sourceGeneration,
          fingerprint: chunk.permissionFingerprint,
        },
      ]),
    );
    const [sources, revisions, chunks] = await Promise.all([
      database.knowledgeV2Source.findMany({
        where: { tenantId: input.tenantId, id: { in: [...sourceExpectations.keys()] } },
      }),
      database.knowledgeV2DocumentRevision.findMany({
        where: {
          tenantId: input.tenantId,
          id: { in: [...new Set(input.chunks.map((chunk) => chunk.point.revisionId))] },
        },
        include: { document: true },
      }),
      database.knowledgeV2Chunk.findMany({
        where: { tenantId: input.tenantId, id: { in: input.chunks.map((chunk) => chunk.id) } },
        select: {
          id: true,
          revisionId: true,
          contentHash: true,
          permissionVersion: true,
          deletedAt: true,
        },
      }),
    ]);
    if (
      sources.length !== sourceExpectations.size ||
      revisions.length !== new Set(input.chunks.map((chunk) => chunk.point.revisionId)).size ||
      chunks.length !== input.chunks.length
    ) {
      throw this.manifestConflict();
    }
    for (const source of sources) {
      const expected = sourceExpectations.get(source.id);
      const allowedStatus =
        ["SYNCING", "READY", "PAUSED"].includes(source.status) ||
        (input.allowHistoricalRevisions && source.status === "NEEDS_REVIEW") ||
        (source.status === "FAILED" &&
          source.lastErrorCode === "KNOWLEDGE_DEPENDENCY_INDEXING_UNAVAILABLE");
      if (
        !expected ||
        source.generation !== expected.generation ||
        source.deletedAt ||
        source.tombstonedAt ||
        !allowedStatus ||
        hashKnowledgeValue(
          stableKnowledgeValue({
            tenantId: source.tenantId,
            sourceId: source.id,
            permissionVersion: source.sourcePermissionVersion,
            scope: source.defaultScope,
            classification: source.defaultClassification,
            locale: source.defaultLocale,
          }),
        ) !== expected.fingerprint
      ) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH",
          "The document permission snapshot changed before indexing.",
        );
      }
    }
    const now = this.now();
    for (const revision of revisions) {
      const allowedStatus =
        ["CHUNKING", "READY", "PUBLISHED"].includes(revision.status) ||
        (input.allowHistoricalRevisions && revision.status === "SUPERSEDED");
      if (
        revision.deletedAt ||
        !allowedStatus ||
        (!input.allowHistoricalRevisions &&
          revision.document.currentDraftRevisionId !== revision.id) ||
        revision.document.deletedAt ||
        revision.document.tombstonedAt ||
        (revision.effectiveFrom && revision.effectiveFrom > now) ||
        (revision.effectiveUntil && revision.effectiveUntil <= now) ||
        (revision.staleAfter && revision.staleAfter <= now)
      ) {
        throw this.manifestConflict();
      }
    }
    const expectedChunks = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
    for (const chunk of chunks) {
      const expected = expectedChunks.get(chunk.id);
      if (
        !expected ||
        chunk.deletedAt ||
        chunk.revisionId !== expected.point.revisionId ||
        chunk.contentHash !== expected.point.contentHash ||
        chunk.permissionVersion !== expected.permissionVersion
      ) {
        throw this.manifestConflict();
      }
    }
  }

  private authorizationPoint(item: PreparedPointInput): KnowledgeV2SnapshotAuthorizationPoint {
    return {
      sourceId: item.chunk.sourceId,
      sourceGeneration: item.chunk.sourceGeneration,
      authorizationFingerprint: item.chunk.permissionFingerprint,
      permissionVersion: item.chunk.permissionVersion,
      chunkId: item.chunk.id,
      documentId: item.chunk.point.documentId,
      revisionId: item.chunk.point.revisionId,
      contentHash: item.chunk.point.contentHash,
      vectorPointId: item.prepared.id,
      pointFingerprint: item.prepared.pointFingerprint,
    };
  }

  private reconcileStoredAuthorizationManifest(
    snapshot: SnapshotAuthorizationRecord,
    chunks: readonly ChunkInput[],
    membership: readonly SnapshotMembershipItem[],
  ) {
    if (
      snapshot.authorizationManifestVersion !==
        KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION ||
      !snapshot.authorizationManifest ||
      !snapshot.authorizationManifestHash ||
      !snapshot.indexSchemaHash
    ) {
      throw this.manifestConflict();
    }
    const stored = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot.authorizationManifest,
      snapshot.authorizationManifestHash,
    );
    if (!stored) throw this.manifestConflict();
    const partitionsBySource = new Map(
      stored.partitions.map((partition) => [partition.sourceId, partition]),
    );
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const points: KnowledgeV2SnapshotAuthorizationPoint[] = [];
    for (const item of membership) {
      const chunk = chunksById.get(item.chunkId);
      const partition = chunk ? partitionsBySource.get(chunk.sourceId) : null;
      if (
        !chunk ||
        !partition ||
        chunk.sourceGeneration < partition.sourceGeneration ||
        chunk.permissionFingerprint !== partition.authorizationFingerprint ||
        chunk.permissionVersion !== partition.permissionVersion
      ) {
        throw this.manifestConflict();
      }
      points.push({
        sourceId: chunk.sourceId,
        sourceGeneration: partition.sourceGeneration,
        authorizationFingerprint: chunk.permissionFingerprint,
        permissionVersion: chunk.permissionVersion,
        chunkId: chunk.id,
        documentId: chunk.point.documentId,
        revisionId: chunk.point.revisionId,
        contentHash: item.contentHash,
        vectorPointId: item.vectorPointId,
        pointFingerprint: item.pointFingerprint,
      });
    }
    const expected = buildKnowledgeV2SnapshotAuthorizationManifest({
      tenantId: snapshot.tenantId,
      snapshotId: snapshot.id,
      snapshotManifestHash: snapshot.manifestHash,
      indexSchemaHash: snapshot.indexSchemaHash,
      points,
    });
    if (
      snapshot.expectedPointCount !== membership.length ||
      expected.hash !== snapshot.authorizationManifestHash ||
      stableKnowledgeValue(expected.manifest) !== stableKnowledgeValue(stored)
    ) {
      throw this.manifestConflict();
    }
    return expected;
  }

  private async lockPreparationFence(
    tx: Prisma.TransactionClient,
    tenantId: string,
    chunks: readonly ChunkInput[],
  ) {
    const sourceIds = [...new Set(chunks.map((chunk) => chunk.sourceId))].sort();
    const documentIds = [...new Set(chunks.map((chunk) => chunk.point.documentId))].sort();
    const revisionIds = [...new Set(chunks.map((chunk) => chunk.point.revisionId))].sort();
    const chunkIds = [...new Set(chunks.map((chunk) => chunk.id))].sort();
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "KnowledgeV2Source"
      WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(sourceIds)})
      ORDER BY "id" FOR SHARE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "KnowledgeV2Document"
      WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(documentIds)})
      ORDER BY "id" FOR SHARE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "KnowledgeV2DocumentRevision"
      WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(revisionIds)})
      ORDER BY "id" FOR SHARE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "KnowledgeV2Chunk"
      WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(chunkIds)})
      ORDER BY "id" FOR SHARE
    `);
  }

  private async resolveSnapshot(input: {
    tenantId: string;
    publicationSnapshotId: string | null;
    manifestHash: string;
    collectionName: string;
    embeddingProvider: string;
    embeddingModel: string;
    indexSchema: Prisma.InputJsonValue;
    indexSchemaHash: string;
  }) {
    const startedAt = this.now();
    const where = {
      tenantId: input.tenantId,
      corpusKind: "STRUCTURED_V2" as const,
      manifestHash: input.manifestHash,
      collectionName: input.collectionName,
      embeddingProvider: input.embeddingProvider,
      embeddingModel: input.embeddingModel,
      indexSchemaHash: input.indexSchemaHash,
      pipelineVersion: indexPipelineVersion,
      authorizationManifestVersion: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
    };
    let snapshot = input.publicationSnapshotId
      ? await this.prisma.knowledgeIndexSnapshot.findFirst({
          where: { id: input.publicationSnapshotId, ...where },
        })
      : await this.prisma.knowledgeIndexSnapshot.findFirst({ where });
    if (!snapshot && input.publicationSnapshotId) throw this.manifestConflict();
    let created = false;
    if (!snapshot) {
      try {
        snapshot = await this.prisma.knowledgeIndexSnapshot.create({
          data: {
            id: this.id(),
            ...where,
            indexSchema: input.indexSchema,
            status: "PREPARING",
            preparationStartedAt: startedAt,
          },
        });
        created = true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        snapshot = await this.prisma.knowledgeIndexSnapshot.findFirst({ where });
      }
    }
    if (!snapshot || ["DELETING", "DELETED"].includes(snapshot.status)) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_INDEX_SNAPSHOT_UNAVAILABLE",
        "The exact index snapshot is unavailable.",
      );
    }
    if (snapshot.status === "READY") {
      return { ...snapshot, reused: true, redriven: false, preservedMembership: true };
    }
    let redriven = false;
    let preservedMembership = false;
    if (!created) {
      const staleBefore = new Date(startedAt.getTime() - stalePreparationMs);
      const mayRedrive =
        snapshot.status === "ABANDONED" ||
        (snapshot.status === "PREPARING" &&
          (Boolean(snapshot.errorCode) ||
            !snapshot.preparationStartedAt ||
            snapshot.preparationStartedAt <= staleBefore));
      if (!mayRedrive) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_IN_PROGRESS",
          "The exact knowledge index snapshot is still being prepared.",
          { retryable: true },
        );
      }
      const redrive = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeIndexSnapshot"
          WHERE "tenantId" = ${input.tenantId} AND "id" = ${snapshot!.id}
          FOR UPDATE
        `);
        const current = await tx.knowledgeIndexSnapshot.findFirst({
          where: { id: snapshot!.id, tenantId: input.tenantId, corpusKind },
        });
        if (!current || ["DELETING", "DELETED", "READY"].includes(current.status)) {
          if (current?.status === "READY") {
            return { snapshot: current, preservedMembership: true };
          }
          throw this.manifestConflict();
        }
        const currentMayRedrive =
          current.status === "ABANDONED" ||
          (current.status === "PREPARING" &&
            (Boolean(current.errorCode) ||
              !current.preparationStartedAt ||
              current.preparationStartedAt <= staleBefore));
        if (!currentMayRedrive) {
          throw knowledgeV2Error(
            HttpStatus.SERVICE_UNAVAILABLE,
            "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_IN_PROGRESS",
            "The exact knowledge index snapshot is still being prepared.",
            { retryable: true },
          );
        }
        await tx.knowledgeIndexSnapshot.update({
          where: { id: current.id },
          data: {
            status: "ABANDONED",
            errorCode: current.errorCode ?? "STALE_PREPARATION",
          },
        });
        const storedMembership = await tx.knowledgeV2IndexSnapshotItem.count({
          where: { tenantId: input.tenantId, snapshotId: current.id },
        });
        const updated = await tx.knowledgeIndexSnapshot.update({
          where: { id: current.id },
          data: {
            status: "PREPARING",
            preparationStartedAt: startedAt,
            expectedPointCount: 0,
            observedPointCount: null,
            verifiedAt: null,
            errorCode: null,
            deleteAfter: null,
            deletedAt: null,
          },
        });
        return { snapshot: updated, preservedMembership: storedMembership > 0 };
      });
      snapshot = redrive.snapshot;
      redriven = snapshot.status !== "READY";
      preservedMembership = redrive.preservedMembership;
    }
    return { ...snapshot, reused: !created, redriven, preservedMembership };
  }

  private async claimReadySnapshotRepair(input: {
    tenantId: string;
    snapshotId: string;
    chunks: readonly ChunkInput[];
  }) {
    const startedAt = this.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "KnowledgeIndexSnapshot"
        WHERE "tenantId" = ${input.tenantId} AND "id" = ${input.snapshotId}
        FOR UPDATE
      `);
      const snapshot = await tx.knowledgeIndexSnapshot.findFirst({
        where: { id: input.snapshotId, tenantId: input.tenantId, corpusKind },
        include: {
          v2Items: {
            select: {
              chunkId: true,
              contentHash: true,
              vectorPointId: true,
              pointFingerprint: true,
            },
            orderBy: { chunkId: "asc" },
          },
        },
      });
      const chunksById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
      if (
        !snapshot ||
        snapshot.status !== "READY" ||
        snapshot.expectedPointCount !== input.chunks.length ||
        snapshot.observedPointCount !== input.chunks.length ||
        snapshot.v2Items.length !== input.chunks.length ||
        snapshot.v2Items.some((item) => {
          const chunk = chunksById.get(item.chunkId);
          return (
            !chunk ||
            item.contentHash !== chunk.point.contentHash ||
            !safeHash(item.pointFingerprint) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
              item.vectorPointId,
            )
          );
        })
      ) {
        throw this.manifestConflict();
      }
      this.reconcileStoredAuthorizationManifest(snapshot, input.chunks, snapshot.v2Items);
      const updated = await tx.knowledgeIndexSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: "PREPARING",
          preparationStartedAt: startedAt,
          verifiedAt: null,
          errorCode: null,
        },
      });
      return {
        ...updated,
        reused: true,
        redriven: true,
        preservedMembership: true,
      };
    });
  }

  private async assertPreparedMembership(
    tenantId: string,
    snapshotId: string,
    prepared: readonly PreparedPointInput[],
  ) {
    const stored = await this.prisma.knowledgeV2IndexSnapshotItem.findMany({
      where: { tenantId, snapshotId, corpusKind },
      select: {
        chunkId: true,
        contentHash: true,
        vectorPointId: true,
        pointFingerprint: true,
      },
      orderBy: { chunkId: "asc" },
    });
    const expected = prepared.map((item) => ({
      chunkId: item.chunk.id,
      contentHash: item.chunk.point.contentHash,
      vectorPointId: item.prepared.id,
      pointFingerprint: item.prepared.pointFingerprint,
    }));
    if (
      stored.length !== expected.length ||
      snapshotMembershipHash(stored) !== snapshotMembershipHash(expected)
    ) {
      throw this.manifestConflict();
    }
  }

  private async preparePoints(
    tenantId: string,
    snapshotId: string,
    chunks: ChunkInput[],
    runtime: RestrictedRuntime,
    preparationStartedAt: Date | null,
    allowHistoricalRevisions: boolean,
    attemptCacheEntries: AttemptCacheEntry[],
    signal?: AbortSignal,
  ) {
    if (chunks.length === 0 || chunks.length > maximumReconcilePoints) {
      throw this.manifestConflict();
    }
    const encodings = await this.resolveEncodings(
      tenantId,
      snapshotId,
      preparationStartedAt,
      chunks,
      runtime,
      allowHistoricalRevisions,
      attemptCacheEntries,
      signal,
    );
    const prepared: PreparedPointInput[] = [];
    for (const chunk of chunks) {
      const encoding = encodings.get(encodingKey(chunk.point.contentHash, chunk.locale));
      if (!encoding) throw this.manifestConflict();
      const scope: KnowledgeV2IndexPermissionPartition = {
        workspaceId: tenantId,
        indexSnapshotId: snapshotId,
        permissionFingerprint: chunk.permissionFingerprint,
        permissionVersion: chunk.permissionVersion,
      };
      const point: KnowledgeV2HybridPointInput = {
        ...chunk.point,
        denseVector: encoding.denseVector,
        sparseVector: encoding.sparseVector,
      };
      prepared.push({
        chunk,
        point,
        scope,
        prepared: runtime.client.preparePoint(scope, point),
      });
    }
    return prepared;
  }

  private async resolveEncodings(
    tenantId: string,
    snapshotId: string,
    preparationStartedAt: Date | null,
    chunks: ChunkInput[],
    runtime: RestrictedRuntime,
    allowHistoricalRevisions: boolean,
    attemptCacheEntries: AttemptCacheEntry[],
    signal?: AbortSignal,
  ) {
    await this.purgeExpiredEmbeddingCache(tenantId, runtime);
    const uniqueChunks = new Map<string, ChunkInput>();
    for (const chunk of chunks) {
      const key = encodingKey(chunk.point.contentHash, chunk.locale);
      const existing = uniqueChunks.get(key);
      if (existing && existing.text !== chunk.text) throw this.manifestConflict();
      uniqueChunks.set(key, chunk);
    }
    const expectedRows = new Map(
      [...uniqueChunks].map(([key, chunk]) => [
        `${chunk.point.contentHash}:${cacheSchemaFingerprint(runtime, chunk.locale)}`,
        key,
      ]),
    );
    const now = this.now();
    const cachedRows = await this.prisma.knowledgeV2EmbeddingCache.findMany({
      where: {
        tenantId,
        contentHash: {
          in: [...new Set([...uniqueChunks.values()].map((chunk) => chunk.point.contentHash))],
        },
        deletedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { contentHash: "asc" },
    });
    const resolved = new Map<string, CachedEncoding>();
    for (const row of cachedRows) {
      const key = expectedRows.get(`${row.contentHash}:${row.schemaFingerprint}`);
      if (!key) continue;
      const encoding = await this.readCachedEncoding(row, runtime, row.schemaFingerprint);
      if (!encoding) {
        await this.deleteCachedEncoding(row.id, row.objectStorageKey, runtime.cacheStore);
        continue;
      }
      resolved.set(key, encoding);
      await this.prisma.knowledgeV2EmbeddingCache.updateMany({
        where: { id: row.id, tenantId, deletedAt: null },
        data: { lastUsedAt: now },
      });
    }
    const missing = [...uniqueChunks.values()].filter(
      (chunk) => !resolved.has(encodingKey(chunk.point.contentHash, chunk.locale)),
    );
    const providerSignal = signal ?? new AbortController().signal;
    const batchSize = Math.min(this.config.knowledgeV2EmbeddingBatchSize, 256);
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      await this.assertPreparationFence({
        tenantId,
        snapshotId,
        preparationStartedAt,
        chunks: batch,
        allowHistoricalRevisions,
      });
      await this.assertProviderFence(tenantId, batch, runtime);
      const providerInput = batch.map((chunk) => ({
        id: hashKnowledgeValue(
          stableKnowledgeValue({ contentHash: chunk.point.contentHash, locale: chunk.locale }),
        ),
        text: chunk.text,
        locale: chunk.locale,
      }));
      const [dense, sparse] = await Promise.all([
        runtime.denseProvider.embedBatch(providerInput, providerSignal),
        runtime.sparseEncoder.encodeBatch(providerInput, providerSignal),
      ]);
      validateKnowledgeV2DenseEmbeddingBatch(
        runtime.denseProvider.schema,
        providerInput.map((item) => item.id),
        dense,
      );
      validateKnowledgeV2SparseEncodingBatch(
        runtime.sparseEncoder.schema,
        providerInput.map((item) => item.id),
        sparse,
      );
      const denseById = new Map(dense.map((item) => [item.id, item.vector]));
      const sparseById = new Map(sparse.map((item) => [item.id, item.vector]));
      for (const chunk of batch) {
        const contentHash = chunk.point.contentHash;
        const providerId = hashKnowledgeValue(
          stableKnowledgeValue({ contentHash, locale: chunk.locale }),
        );
        const denseVector = denseById.get(providerId);
        const sparseVector = sparseById.get(providerId);
        if (!denseVector || !sparseVector) throw this.manifestConflict();
        const encoding = { denseVector, sparseVector } satisfies CachedEncoding;
        const schemaFingerprint = cacheSchemaFingerprint(runtime, chunk.locale);
        await this.assertPreparationFence({
          tenantId,
          snapshotId,
          preparationStartedAt,
          chunks: [chunk],
          allowHistoricalRevisions,
        });
        await this.assertProviderFence(tenantId, [chunk], runtime);
        const cached = await this.writeCachedEncoding(
          tenantId,
          contentHash,
          schemaFingerprint,
          encoding,
          runtime,
          now,
        );
        attemptCacheEntries.push(cached.entry);
        resolved.set(encodingKey(contentHash, chunk.locale), cached.encoding);
      }
    }
    return resolved;
  }

  private async readCachedEncoding(
    row: {
      objectStorageKey: string;
      encryptionKeyRef: string;
      payloadHash: string;
      denseDimensions: number;
      denseProvider: string;
      denseModel: string;
      denseSchemaVersion: string;
      sparseProvider: string;
      sparseModel: string;
      sparseSchemaVersion: string;
      providerRegion: string;
      contentHash: string;
      schemaFingerprint: string;
    },
    runtime: RestrictedRuntime,
    expectedSchemaFingerprint: string,
  ): Promise<CachedEncoding | null> {
    if (
      row.schemaFingerprint !== expectedSchemaFingerprint ||
      row.denseDimensions !== runtime.denseProvider.schema.dimensions ||
      row.denseProvider !== runtime.denseProvider.schema.provider ||
      row.denseModel !== runtime.denseProvider.schema.model ||
      row.denseSchemaVersion !== runtime.denseProvider.schema.schemaVersion ||
      row.sparseProvider !== runtime.sparseEncoder.schema.provider ||
      row.sparseModel !== runtime.sparseEncoder.schema.model ||
      row.sparseSchemaVersion !== runtime.sparseEncoder.schema.schemaVersion ||
      row.providerRegion !== runtime.providerRegion
    ) {
      return null;
    }
    try {
      const bytes = await runtime.cacheStore.get(row.objectStorageKey, row.encryptionKeyRef);
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
        denseVector?: unknown;
        sparseVector?: { indices?: unknown; values?: unknown };
      };
      if (canonicalKnowledgeV2Hash(parsed) !== row.payloadHash) return null;
      const encoding: CachedEncoding = {
        denseVector: Array.isArray(parsed.denseVector) ? (parsed.denseVector as number[]) : [],
        sparseVector: {
          indices: Array.isArray(parsed.sparseVector?.indices)
            ? (parsed.sparseVector.indices as number[])
            : [],
          values: Array.isArray(parsed.sparseVector?.values)
            ? (parsed.sparseVector.values as number[])
            : [],
        },
      };
      validateKnowledgeV2DenseEmbeddingBatch(
        runtime.denseProvider.schema,
        [row.contentHash],
        [{ id: row.contentHash, vector: encoding.denseVector }],
      );
      validateKnowledgeV2SparseEncodingBatch(
        runtime.sparseEncoder.schema,
        [row.contentHash],
        [{ id: row.contentHash, vector: encoding.sparseVector }],
      );
      return encoding;
    } catch {
      return null;
    }
  }

  private async writeCachedEncoding(
    tenantId: string,
    contentHash: string,
    schemaFingerprint: string,
    encoding: CachedEncoding,
    runtime: RestrictedRuntime,
    now: Date,
  ) {
    const uniqueWhere = {
      tenantId_contentHash_schemaFingerprint: {
        tenantId,
        contentHash,
        schemaFingerprint,
      },
    } as const;
    let existing = await this.prisma.knowledgeV2EmbeddingCache.findUnique({
      where: uniqueWhere,
    });
    if (existing && existing.deletedAt === null && existing.expiresAt > now) {
      const canonical = await this.readCachedEncoding(existing, runtime, schemaFingerprint);
      if (canonical) {
        return {
          entry: {
            id: existing.id,
            contentHash,
            objectStorageKey: existing.objectStorageKey,
            created: false,
          },
          encoding: canonical,
        };
      }
      await this.deleteCachedEncoding(
        existing.id,
        existing.objectStorageKey,
        runtime.cacheStore,
        existing.updatedAt,
      );
      existing = await this.prisma.knowledgeV2EmbeddingCache.findUnique({
        where: uniqueWhere,
      });
    }
    if (existing && existing.deletedAt === null) {
      await this.deleteCachedEncoding(
        existing.id,
        existing.objectStorageKey,
        runtime.cacheStore,
        existing.updatedAt,
      );
      existing = await this.prisma.knowledgeV2EmbeddingCache.findUnique({
        where: uniqueWhere,
      });
    }
    const payload = {
      denseVector: [...encoding.denseVector],
      sparseVector: {
        indices: [...encoding.sparseVector.indices],
        values: [...encoding.sparseVector.values],
      },
    };
    const payloadHash = canonicalKnowledgeV2Hash(payload);
    const objectStorageKey = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: "embedding-cache",
      purpose: "embedding",
      identity: `${contentHash}:${schemaFingerprint}:${payloadHash}`,
    });
    const bytes = Buffer.from(JSON.stringify(payload), "utf8");
    let objectCreated = false;
    try {
      await runtime.cacheStore.put(objectStorageKey, bytes);
      objectCreated = true;
    } catch (error) {
      if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS") {
        throw error;
      }
      const existing = await runtime.cacheStore.get(
        objectStorageKey,
        this.config.knowledgeArtifactEncryptionKeyId,
      );
      if (
        canonicalKnowledgeV2Hash(JSON.parse(Buffer.from(existing).toString("utf8"))) !== payloadHash
      ) {
        throw error;
      }
    }
    const expiresAt = new Date(
      now.getTime() + this.config.knowledgeV2EmbeddingCacheTtlDays * 24 * 60 * 60 * 1000,
    );
    const values = {
      objectStorageKey,
      encryptionKeyRef: this.config.knowledgeArtifactEncryptionKeyId,
      payloadHash,
      denseDimensions: runtime.denseProvider.schema.dimensions,
      denseProvider: runtime.denseProvider.schema.provider,
      denseModel: runtime.denseProvider.schema.model,
      denseSchemaVersion: runtime.denseProvider.schema.schemaVersion,
      sparseProvider: runtime.sparseEncoder.schema.provider,
      sparseModel: runtime.sparseEncoder.schema.model,
      sparseSchemaVersion: runtime.sparseEncoder.schema.schemaVersion,
      providerRegion: runtime.providerRegion,
      expiresAt,
      lastUsedAt: now,
      deletedAt: null,
    };
    let cachedId: string | null = null;
    try {
      if (existing?.deletedAt) {
        const revived = await this.prisma.knowledgeV2EmbeddingCache.updateMany({
          where: {
            id: existing.id,
            tenantId,
            updatedAt: existing.updatedAt,
            deletedAt: existing.deletedAt,
          },
          data: values,
        });
        if (revived.count === 1) cachedId = existing.id;
      } else if (!existing) {
        const id = this.id();
        const created = await this.prisma.knowledgeV2EmbeddingCache.create({
          data: {
            id,
            tenantId,
            contentHash,
            schemaFingerprint,
            ...values,
            createdAt: now,
            updatedAt: now,
          },
        });
        cachedId = created.id;
      }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        if (objectCreated) {
          await this.deleteUnclaimedCacheObject(objectStorageKey, runtime.cacheStore);
        }
        throw error;
      }
    }
    if (cachedId) {
      return {
        entry: { id: cachedId, contentHash, objectStorageKey, created: true },
        encoding,
      };
    }
    const winner = await this.prisma.knowledgeV2EmbeddingCache.findUnique({
      where: uniqueWhere,
    });
    const canonical =
      winner && winner.deletedAt === null && winner.expiresAt > now
        ? await this.readCachedEncoding(winner, runtime, schemaFingerprint)
        : null;
    if (!winner || !canonical) {
      if (objectCreated) {
        await this.deleteUnclaimedCacheObject(objectStorageKey, runtime.cacheStore);
      }
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_EMBEDDING_CACHE_CONFLICT",
        "The embedding cache could not be published safely.",
        { retryable: true },
      );
    }
    if (objectCreated && winner.objectStorageKey !== objectStorageKey) {
      await this.deleteUnclaimedCacheObject(objectStorageKey, runtime.cacheStore);
    }
    return {
      entry: {
        id: winner.id,
        contentHash,
        objectStorageKey: winner.objectStorageKey,
        created: false,
      },
      encoding: canonical,
    };
  }

  private async purgeExpiredEmbeddingCache(tenantId: string, runtime: RestrictedRuntime) {
    const expired = await this.prisma.knowledgeV2EmbeddingCache.findMany({
      where: { tenantId, deletedAt: null, expiresAt: { lte: this.now() } },
      select: { id: true, objectStorageKey: true, updatedAt: true },
      orderBy: { expiresAt: "asc" },
      take: 32,
    });
    for (const row of expired) {
      await this.deleteCachedEncoding(
        row.id,
        row.objectStorageKey,
        runtime.cacheStore,
        row.updatedAt,
      );
    }
  }

  private async deleteUnclaimedCacheObject(key: string, store: KnowledgeObjectStore) {
    await store.delete(key).catch((error: unknown) => {
      if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_NOT_FOUND") {
        throw error;
      }
    });
  }

  private async deleteCachedEncoding(
    id: string,
    objectStorageKey: string,
    store: KnowledgeObjectStore,
    expectedUpdatedAt?: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "KnowledgeV2EmbeddingCache"
        WHERE "id" = ${id}
        FOR UPDATE
      `);
      const row = await tx.knowledgeV2EmbeddingCache.findFirst({
        where: {
          id,
          objectStorageKey,
          deletedAt: null,
          ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
        },
        select: { id: true },
      });
      if (!row) return false;
      await store.delete(objectStorageKey).catch((error: unknown) => {
        if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_NOT_FOUND") {
          throw error;
        }
      });
      await tx.knowledgeV2EmbeddingCache.update({
        where: { id },
        data: { deletedAt: this.now() },
      });
      return true;
    });
  }

  private async cleanupAttemptCacheEntries(
    tenantId: string,
    entries: readonly AttemptCacheEntry[],
    store: KnowledgeObjectStore,
  ) {
    const unique = new Map(
      entries.filter((entry) => entry.created).map((entry) => [entry.id, entry]),
    );
    for (const entry of unique.values()) {
      const referenced = await this.prisma.knowledgeV2Chunk.count({
        where: { tenantId, contentHash: entry.contentHash, deletedAt: null },
      });
      if (referenced === 0) {
        await this.deleteCachedEncoding(entry.id, entry.objectStorageKey, store);
      }
    }
  }

  private async upsertAndReconcile(
    client: KnowledgeV2IndexClient,
    input: PreparedPointInput[],
    fence: () => Promise<void>,
    signal?: AbortSignal,
  ) {
    const partitions = new Map<string, PreparedPointInput[]>();
    for (const item of input) {
      const key = `${item.scope.permissionFingerprint}:${item.scope.permissionVersion}`;
      const values = partitions.get(key) ?? [];
      values.push(item);
      partitions.set(key, values);
    }
    let observed = 0;
    for (const values of partitions.values()) {
      const scope = values[0]!.scope;
      await fence();
      await client.upsertSnapshotPoints({
        scope,
        points: values.map((value) => value.point),
        ...(signal ? { signal } : {}),
      });
      await fence();
      const expected = values.map((value) => value.prepared);
      const reconciliation = await client.reconcilePermissionPartition({
        scope,
        expected,
        deleteUnexpected: true,
        ...(signal ? { signal } : {}),
      });
      const count = await client.countPermissionPartition(scope, signal);
      if (
        !reconciliation.consistent ||
        reconciliation.expectedCount !== expected.length ||
        reconciliation.observedCount !== expected.length ||
        count !== expected.length
      ) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
          "The prepared knowledge index did not reconcile.",
          { retryable: true },
        );
      }
      observed += count;
    }
    return observed;
  }

  private async verifyReadySnapshot(input: {
    tenantId: string;
    snapshot: {
      id: string;
      tenantId: string;
      status: string;
      manifestHash: string;
      indexSchemaHash: string | null;
      expectedPointCount: number;
      observedPointCount: number | null;
      authorizationManifest: Prisma.JsonValue | null;
      authorizationManifestHash: string | null;
      authorizationManifestVersion: number | null;
    };
    chunks: ChunkInput[];
    client: KnowledgeV2IndexClient;
    publicationId: string | null;
    allowHistoricalRevisions: boolean;
    signal?: AbortSignal;
  }) {
    const stored = await this.prisma.knowledgeV2IndexSnapshotItem.findMany({
      where: { tenantId: input.tenantId, snapshotId: input.snapshot.id, corpusKind },
      select: {
        chunkId: true,
        contentHash: true,
        vectorPointId: true,
        pointFingerprint: true,
      },
      orderBy: { chunkId: "asc" },
    });
    const chunksById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
    if (
      input.snapshot.status !== "READY" ||
      stored.length !== input.chunks.length ||
      input.snapshot.expectedPointCount !== stored.length ||
      input.snapshot.observedPointCount !== stored.length ||
      stored.some((item) => {
        const chunk = chunksById.get(item.chunkId);
        return (
          !chunk ||
          item.contentHash !== chunk.point.contentHash ||
          !safeHash(item.pointFingerprint) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
            item.vectorPointId,
          )
        );
      })
    ) {
      throw this.manifestConflict();
    }
    const authorization = this.reconcileStoredAuthorizationManifest(
      input.snapshot,
      input.chunks,
      stored,
    );
    const partitions = new Map<
      string,
      { scope: KnowledgeV2IndexPermissionPartition; expected: KnowledgeV2PreparedHybridPoint[] }
    >();
    for (const item of stored) {
      const chunk = chunksById.get(item.chunkId)!;
      const scope: KnowledgeV2IndexPermissionPartition = {
        workspaceId: input.tenantId,
        indexSnapshotId: input.snapshot.id,
        permissionFingerprint: chunk.permissionFingerprint,
        permissionVersion: chunk.permissionVersion,
      };
      const key = `${scope.permissionFingerprint}:${scope.permissionVersion}`;
      const partition = partitions.get(key) ?? { scope, expected: [] };
      partition.expected.push({
        id: item.vectorPointId,
        pointFingerprint: item.pointFingerprint,
      });
      partitions.set(key, partition);
    }
    let observedPointCount = 0;
    for (const partition of partitions.values()) {
      const reconciliation = await input.client.reconcilePermissionPartition({
        scope: partition.scope,
        expected: partition.expected,
        deleteUnexpected: true,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const count = await input.client.countPermissionPartition(partition.scope, input.signal);
      if (
        !reconciliation.consistent ||
        reconciliation.expectedCount !== partition.expected.length ||
        reconciliation.observedCount !== partition.expected.length ||
        count !== partition.expected.length
      ) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
          "The prepared knowledge index did not reconcile.",
          { retryable: true },
        );
      }
      observedPointCount += count;
    }
    await this.commitReadySnapshot({
      tenantId: input.tenantId,
      snapshotId: input.snapshot.id,
      expected: stored,
      observedPointCount,
      publicationId: input.publicationId,
      acceptedSources: this.acceptedSources(input.chunks),
      authorizationManifest: authorization.manifest,
      authorizationManifestHash: authorization.hash,
      chunks: input.chunks,
      preparationStartedAt: null,
      allowHistoricalRevisions: input.allowHistoricalRevisions,
    });
    return {
      snapshotId: input.snapshot.id,
      expectedPointCount: stored.length,
      observedPointCount,
    };
  }

  private async commitReadySnapshot(input: {
    tenantId: string;
    publicationId: string | null;
    snapshotId: string;
    expected: SnapshotMembershipItem[];
    observedPointCount: number;
    acceptedSources: Array<{ sourceId: string; generation: number }>;
    authorizationManifest: KnowledgeV2SnapshotAuthorizationManifest;
    authorizationManifestHash: string;
    chunks: ChunkInput[];
    preparationStartedAt: Date | null;
    allowHistoricalRevisions: boolean;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "KnowledgeIndexSnapshot"
        WHERE "tenantId" = ${input.tenantId} AND "id" = ${input.snapshotId}
        FOR UPDATE
      `);
      await this.lockPreparationFence(tx, input.tenantId, input.chunks);
      await this.assertPreparationFence({
        tenantId: input.tenantId,
        snapshotId: input.snapshotId,
        preparationStartedAt: input.preparationStartedAt,
        chunks: input.chunks,
        allowHistoricalRevisions: input.allowHistoricalRevisions,
        transaction: tx,
      });
      const snapshot = await tx.knowledgeIndexSnapshot.findFirst({
        where: { id: input.snapshotId, tenantId: input.tenantId, corpusKind },
        include: { v2Items: { orderBy: { chunkId: "asc" } } },
      });
      if (!snapshot || ["DELETING", "DELETED", "ABANDONED"].includes(snapshot.status)) {
        throw this.manifestConflict();
      }
      const canonicalAuthorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
        input.authorizationManifest,
        input.authorizationManifestHash,
      );
      if (
        !canonicalAuthorizationManifest ||
        canonicalAuthorizationManifest.tenantId !== input.tenantId ||
        canonicalAuthorizationManifest.snapshotId !== snapshot.id ||
        canonicalAuthorizationManifest.snapshotManifestHash !== snapshot.manifestHash ||
        canonicalAuthorizationManifest.indexSchemaHash !== snapshot.indexSchemaHash ||
        canonicalAuthorizationManifest.expectedPointCount !== input.expected.length
      ) {
        throw this.manifestConflict();
      }
      if (
        snapshot.authorizationManifestVersion !==
        KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION
      ) {
        throw this.manifestConflict();
      }
      const hasStoredAuthorizationManifest =
        snapshot.authorizationManifest !== null || snapshot.authorizationManifestHash !== null;
      if (hasStoredAuthorizationManifest) {
        const storedAuthorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
          snapshot.authorizationManifest,
          snapshot.authorizationManifestHash,
        );
        if (
          !storedAuthorizationManifest ||
          snapshot.authorizationManifestHash !== input.authorizationManifestHash ||
          stableKnowledgeValue(storedAuthorizationManifest) !==
            stableKnowledgeValue(canonicalAuthorizationManifest)
        ) {
          throw this.manifestConflict();
        }
      } else if (snapshot.status === "READY") {
        throw this.manifestConflict();
      }
      if (snapshot.v2Items.length === 0 && input.expected.length > 0) {
        await tx.knowledgeV2IndexSnapshotItem.createMany({
          data: input.expected.map((item) => ({
            tenantId: input.tenantId,
            snapshotId: snapshot.id,
            corpusKind,
            ...item,
          })),
          skipDuplicates: true,
        });
      }
      const stored = await tx.knowledgeV2IndexSnapshotItem.findMany({
        where: { tenantId: input.tenantId, snapshotId: snapshot.id },
        select: {
          chunkId: true,
          contentHash: true,
          vectorPointId: true,
          pointFingerprint: true,
        },
        orderBy: { chunkId: "asc" },
      });
      if (
        stored.length !== input.expected.length ||
        snapshotMembershipHash(stored) !== snapshotMembershipHash(input.expected) ||
        input.observedPointCount !== input.expected.length
      ) {
        throw this.manifestConflict();
      }
      const chunksById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
      let rebuiltAuthorization: ReturnType<
        typeof buildKnowledgeV2SnapshotAuthorizationManifest
      > | null = null;
      try {
        rebuiltAuthorization = buildKnowledgeV2SnapshotAuthorizationManifest({
          tenantId: input.tenantId,
          snapshotId: snapshot.id,
          snapshotManifestHash: snapshot.manifestHash,
          indexSchemaHash: snapshot.indexSchemaHash ?? "",
          points: stored.map((item) => {
            const chunk = chunksById.get(item.chunkId);
            if (!chunk) throw this.manifestConflict();
            return {
              sourceId: chunk.sourceId,
              sourceGeneration: chunk.sourceGeneration,
              authorizationFingerprint: chunk.permissionFingerprint,
              permissionVersion: chunk.permissionVersion,
              chunkId: item.chunkId,
              documentId: chunk.point.documentId,
              revisionId: chunk.point.revisionId,
              contentHash: item.contentHash,
              vectorPointId: item.vectorPointId,
              pointFingerprint: item.pointFingerprint,
            };
          }),
        });
      } catch {
        throw this.manifestConflict();
      }
      if (
        rebuiltAuthorization.hash !== input.authorizationManifestHash ||
        stableKnowledgeValue(rebuiltAuthorization.manifest) !==
          stableKnowledgeValue(canonicalAuthorizationManifest)
      ) {
        throw this.manifestConflict();
      }
      const verifiedAt = this.now();
      await tx.knowledgeIndexSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: "READY",
          expectedPointCount: input.expected.length,
          observedPointCount: input.observedPointCount,
          verifiedAt,
          preparationStartedAt: null,
          errorCode: null,
          authorizationManifestVersion: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
          authorizationManifest: canonicalAuthorizationManifest as unknown as Prisma.InputJsonValue,
          authorizationManifestHash: input.authorizationManifestHash,
        },
      });
      if (!input.publicationId) {
        await this.finalizeCandidateSnapshot(
          tx,
          input.tenantId,
          input.expected,
          input.acceptedSources,
          verifiedAt,
        );
      }
      if (input.publicationId) {
        const prepared = await tx.knowledgePublication.updateMany({
          where: {
            id: input.publicationId,
            tenantId: input.tenantId,
            corpusKind,
            status: "VALIDATING",
            indexSnapshotId: null,
          },
          data: {
            status: "READY",
            readyAt: verifiedAt,
            indexSnapshotId: snapshot.id,
          },
        });
        const attached =
          prepared.count === 1
            ? prepared
            : await tx.knowledgePublication.updateMany({
                where: {
                  id: input.publicationId,
                  tenantId: input.tenantId,
                  corpusKind,
                  status: { in: ["READY", "PUBLISHING", "ACTIVE"] },
                  OR: [{ indexSnapshotId: null }, { indexSnapshotId: snapshot.id }],
                },
                data: { indexSnapshotId: snapshot.id },
              });
        if (attached.count !== 1) throw this.manifestConflict();
        const validationAttached = await tx.knowledgeV2PublicationValidation.updateMany({
          where: {
            tenantId: input.tenantId,
            publicationId: input.publicationId,
            corpusKind,
            status: "PASSED",
            OR: [{ indexSnapshotId: null }, { indexSnapshotId: snapshot.id }],
          },
          data: { indexSnapshotId: snapshot.id },
        });
        if (validationAttached.count !== 1) throw this.manifestConflict();
      }
    });
  }

  private async finalizeCandidateSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    expected: SnapshotMembershipItem[],
    acceptedSources: Array<{ sourceId: string; generation: number }>,
    indexedAt: Date,
  ) {
    const expectedByChunk = new Map(expected.map((item) => [item.chunkId, item]));
    const chunks = await tx.knowledgeV2Chunk.findMany({
      where: { tenantId, id: { in: [...expectedByChunk.keys()] }, deletedAt: null },
      select: {
        id: true,
        contentHash: true,
        revisionId: true,
        revision: {
          select: {
            id: true,
            sourceId: true,
            documentId: true,
            status: true,
            contentHash: true,
            sourcePermissionFingerprint: true,
            deletedAt: true,
            document: {
              select: {
                currentDraftRevisionId: true,
                permissionVersion: true,
                deletedAt: true,
                tombstonedAt: true,
              },
            },
          },
        },
      },
    });
    if (
      chunks.length !== expected.length ||
      chunks.some((chunk) => chunk.contentHash !== expectedByChunk.get(chunk.id)?.contentHash)
    ) {
      throw this.manifestConflict();
    }
    const revisions = new Map(chunks.map((chunk) => [chunk.revision.id, chunk.revision]));
    const sourceIds = new Set<string>();
    const acceptedSourceGenerations = new Map(
      acceptedSources.map((source) => [source.sourceId, source.generation]),
    );
    for (const revision of revisions.values()) {
      if (
        revision.deletedAt ||
        revision.document.deletedAt ||
        revision.document.tombstonedAt ||
        revision.document.currentDraftRevisionId !== revision.id ||
        !["CHUNKING", "READY", "PUBLISHED"].includes(revision.status)
      ) {
        throw this.manifestConflict();
      }
      if (revision.status === "CHUNKING") {
        const updated = await tx.knowledgeV2DocumentRevision.updateMany({
          where: {
            id: revision.id,
            tenantId,
            status: "CHUNKING",
            contentHash: revision.contentHash,
            sourcePermissionFingerprint: revision.sourcePermissionFingerprint,
          },
          data: { status: "READY" },
        });
        if (updated.count !== 1) throw this.manifestConflict();
      }
      const documentUpdated = await tx.knowledgeV2Document.updateMany({
        where: {
          id: revision.documentId,
          tenantId,
          currentDraftRevisionId: revision.id,
          permissionVersion: revision.document.permissionVersion,
          status: { in: ["DISCOVERED", "ACTIVE"] },
          deletedAt: null,
          tombstonedAt: null,
        },
        data: { status: "ACTIVE" },
      });
      if (documentUpdated.count !== 1) throw this.manifestConflict();
      sourceIds.add(revision.sourceId);
    }
    const chunksUpdated = await tx.knowledgeV2Chunk.updateMany({
      where: {
        tenantId,
        id: { in: chunks.map((chunk) => chunk.id) },
        deletedAt: null,
      },
      data: { indexState: "INDEXED", indexedAt },
    });
    if (chunksUpdated.count !== chunks.length) throw this.manifestConflict();
    for (const sourceId of sourceIds) {
      const source = await tx.knowledgeV2Source.findFirst({
        where: { id: sourceId, tenantId, deletedAt: null, tombstonedAt: null },
        select: { status: true, generation: true, lastErrorCode: true },
      });
      if (
        !source ||
        source.generation !== acceptedSourceGenerations.get(sourceId) ||
        (!["SYNCING", "READY", "PAUSED"].includes(source.status) &&
          !(
            source.status === "FAILED" &&
            source.lastErrorCode === "KNOWLEDGE_DEPENDENCY_INDEXING_UNAVAILABLE"
          ))
      ) {
        throw this.manifestConflict();
      }
      await tx.knowledgeV2Source.update({
        where: { id: sourceId },
        data: {
          status: source.status === "PAUSED" ? "PAUSED" : "READY",
          lastSuccessAt: indexedAt,
          lastErrorCode: null,
          lastErrorAt: null,
          etag: { increment: 1 },
        },
      });
    }
  }

  private acceptedSources(chunks: ChunkInput[]) {
    const values = new Map<string, number>();
    for (const chunk of chunks) {
      const existing = values.get(chunk.sourceId);
      if (existing !== undefined && existing !== chunk.sourceGeneration) {
        throw this.manifestConflict();
      }
      values.set(chunk.sourceId, chunk.sourceGeneration);
    }
    return [...values].map(([sourceId, generation]) => ({ sourceId, generation }));
  }

  private manifestConflict() {
    return knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_PUBLICATION_INDEX_MANIFEST_MISMATCH",
      "The publication document manifest changed before index preparation completed.",
    );
  }
}
