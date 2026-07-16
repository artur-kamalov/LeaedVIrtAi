import { randomUUID } from "node:crypto";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import {
  KnowledgeV2IndexPreparationService,
  type KnowledgeV2IndexClient,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-index-preparation.service.js";
import { isKnowledgeV2Scope } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-validation.js";
import {
  buildKnowledgeV2SnapshotAuthorizationManifest,
  DeterministicMultilingualKnowledgeV2SparseEncoder,
  hashKnowledgeValue,
  knowledgeV2SnapshotAuthorizationManifestHash,
  KnowledgeObjectStoreError,
  KnowledgeV2HybridQdrantClient,
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS,
  parseKnowledgeV2SnapshotAuthorizationManifest,
  stableKnowledgeValue,
  type KnowledgeObjectStore,
  type KnowledgeV2DenseEmbeddingProvider,
  type KnowledgeV2HybridPointInput,
  type KnowledgeV2IndexPermissionPartition,
  type KnowledgeV2PreparedHybridPoint,
  type KnowledgeV2SnapshotAuthorizationManifest,
  type KnowledgeV2SnapshotAuthorizationPoint,
} from "@leadvirt/knowledge";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const denseSchema = {
  vectorName: "content_dense",
  schemaVersion: "knowledge-dense-v1",
  provider: "openai-compatible",
  model: "smoke-embedding-v1",
  dimensions: 3,
  distance: "Cosine",
} as const;

const sparseEncoder = new DeterministicMultilingualKnowledgeV2SparseEncoder({
  maxNonZeroValues: 64,
  schemaVersion: "knowledge-sparse-v1",
});

class SmokeDenseProvider implements KnowledgeV2DenseEmbeddingProvider {
  readonly schema = denseSchema;
  calls = 0;

  constructor(
    public vector: readonly number[],
    private readonly afterCall?: (call: number) => Promise<void>,
  ) {}

  async embedBatch(
    input: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ) {
    if (signal.aborted) throw new Error("aborted");
    this.calls += 1;
    await this.afterCall?.(this.calls);
    return input.map((item) => ({ id: item.id, vector: this.vector }));
  }
}

class MemoryObjectStore implements KnowledgeObjectStore {
  readonly values = new Map<string, Uint8Array>();

  async put(key: string, value: Uint8Array) {
    if (this.values.has(key)) throw new KnowledgeObjectStoreError("OBJECT_EXISTS");
    this.values.set(key, Uint8Array.from(value));
    return {
      key,
      encryptionKeyRef: "smoke-cache-key",
      plaintextBytes: value.byteLength,
      storedBytes: value.byteLength,
    };
  }

  async get(key: string, encryptionKeyRef: string) {
    if (encryptionKeyRef !== "smoke-cache-key") {
      throw new KnowledgeObjectStoreError("OBJECT_CORRUPT");
    }
    const value = this.values.get(key);
    if (!value) throw new KnowledgeObjectStoreError("OBJECT_NOT_FOUND");
    return Uint8Array.from(value);
  }

  async delete(key: string) {
    if (!this.values.delete(key)) throw new KnowledgeObjectStoreError("OBJECT_NOT_FOUND");
  }
}

class MemoryIndexClient implements KnowledgeV2IndexClient {
  private readonly codec = new KnowledgeV2HybridQdrantClient({
    qdrantUrl: "http://qdrant.smoke:6333",
    collectionPrefix: "leadvirt_knowledge_v2_index_smoke",
    dense: denseSchema,
    sparse: sparseEncoder.schema,
    requestTimeoutMs: 1_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1,
    maxBatchSize: 32,
    maxReconcilePoints: 10_000,
  });

  readonly physicalCollectionName = this.codec.physicalCollectionName;
  readonly points = new Map<
    string,
    {
      scope: KnowledgeV2IndexPermissionPartition;
      prepared: KnowledgeV2PreparedHybridPoint;
      point: KnowledgeV2HybridPointInput;
    }
  >();
  snapshotDeletes = 0;
  failNextReconcile = false;
  afterNextCount: (() => Promise<void>) | null = null;

  async ensurePhysicalCollection() {}

  preparePoint(scope: KnowledgeV2IndexPermissionPartition, point: KnowledgeV2HybridPointInput) {
    return this.codec.preparePoint(scope, point);
  }

  async upsertSnapshotPoints(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    points: readonly KnowledgeV2HybridPointInput[];
  }) {
    for (const point of input.points) {
      const prepared = this.preparePoint(input.scope, point);
      const existing = this.points.get(prepared.id);
      if (existing && existing.prepared.pointFingerprint !== prepared.pointFingerprint) {
        throw new Error("immutable point conflict");
      }
      this.points.set(prepared.id, { scope: input.scope, prepared, point });
    }
  }

  async countPermissionPartition(scope: KnowledgeV2IndexPermissionPartition) {
    const count = this.partition(scope).length;
    const afterCount = this.afterNextCount;
    this.afterNextCount = null;
    await afterCount?.();
    return count;
  }

  async reconcilePermissionPartition(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    expected: readonly KnowledgeV2PreparedHybridPoint[];
    deleteUnexpected?: boolean;
  }) {
    if (this.failNextReconcile) {
      this.failNextReconcile = false;
      throw new Error("simulated post-upsert crash");
    }
    const observed = this.partition(input.scope);
    const expectedById = new Map(input.expected.map((item) => [item.id, item]));
    const observedById = new Map(observed.map((item) => [item.prepared.id, item]));
    const missingPointIds = input.expected
      .filter(
        (item) => observedById.get(item.id)?.prepared.pointFingerprint !== item.pointFingerprint,
      )
      .map((item) => item.id);
    const unexpectedPointIds = observed
      .filter(
        (item) =>
          expectedById.get(item.prepared.id)?.pointFingerprint !== item.prepared.pointFingerprint,
      )
      .map((item) => item.prepared.id);
    const deletedUnexpectedPointIds = input.deleteUnexpected ? unexpectedPointIds : [];
    for (const id of deletedUnexpectedPointIds) this.points.delete(id);
    const observedCount = this.partition(input.scope).length;
    return {
      expectedCount: input.expected.length,
      observedCount,
      missingPointIds,
      unexpectedPointIds,
      deletedUnexpectedPointIds,
      consistent: missingPointIds.length === 0 && observedCount === input.expected.length,
    };
  }

  async deleteSnapshotPartition(input: { workspaceId: string; indexSnapshotId: string }) {
    this.snapshotDeletes += 1;
    for (const [id, value] of this.points) {
      if (
        value.scope.workspaceId === input.workspaceId &&
        value.scope.indexSnapshotId === input.indexSnapshotId
      ) {
        this.points.delete(id);
      }
    }
  }

  private partition(scope: KnowledgeV2IndexPermissionPartition) {
    return [...this.points.values()].filter(
      (item) =>
        item.scope.workspaceId === scope.workspaceId &&
        item.scope.indexSnapshotId === scope.indexSnapshotId &&
        item.scope.permissionFingerprint === scope.permissionFingerprint &&
        item.scope.permissionVersion === scope.permissionVersion,
    );
  }
}

const config = {
  knowledgeEmbeddingProviderApproved: true,
  ragQdrantEnabled: true,
  ragRetrievalMode: "qdrant",
  aiApiKey: "smoke-key",
  aiBaseUrl: "https://provider.smoke/v1",
  knowledgeObjectStorePath: "C:/leadvirt-smoke-cache",
  knowledgeArtifactEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
  knowledgeArtifactEncryptionKeyId: "smoke-cache-key",
  knowledgeV2EmbeddingDeployment: "smoke-deployment",
  knowledgeV2EmbeddingRegion: "eu-test-1",
  knowledgeV2EmbeddingPolicyVersion: "external-embedding-v1",
  knowledgeV2ExternalEmbeddingMaxClassification: "INTERNAL",
  knowledgeV2EmbeddingModel: denseSchema.model,
  knowledgeV2EmbeddingDimensions: denseSchema.dimensions,
  knowledgeV2EmbeddingTimeoutMs: 1_000,
  knowledgeV2EmbeddingBatchSize: 1,
  knowledgeV2SparseMaxNonZero: 64,
  knowledgeV2EmbeddingCacheTtlDays: 30,
  ragQdrantUrl: "http://qdrant.smoke:6333",
  ragQdrantCollection: "leadvirt_knowledge_v2_index_smoke",
  ragQdrantTimeoutMs: 1_000,
  ragQdrantApiKey: undefined,
} as unknown as AppConfigService;

function providerPolicy() {
  return {
    schemaVersion: 1,
    policyVersion: "external-embedding-v1",
    approved: true,
    provider: "openai-compatible",
    deployment: "smoke-deployment",
    region: "eu-test-1",
    allowedClassifications: ["PUBLIC", "INTERNAL"],
  };
}

async function createTenant(prisma: PrismaService, suffix: string, approved = true) {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: `Index smoke ${suffix}`, slug: `index-smoke-${suffix}-${stamp}` },
  });
  await prisma.knowledgeV2Settings.create({
    data: {
      tenantId: tenant.id,
      embeddingRegion: "eu-test-1",
      embeddingProviderPolicy: approved ? providerPolicy() : undefined,
    },
  });
  return tenant;
}

async function createDocumentFixture(
  prisma: PrismaService,
  tenantId: string,
  suffix: string,
  texts: readonly string[],
  scopeOverride?: Record<string, string[]>,
) {
  const scope = scopeOverride ?? { audiences: ["PUBLIC"], locales: ["en"] };
  const source = await prisma.knowledgeV2Source.create({
    data: {
      tenantId,
      kind: "WEBSITE",
      displayName: `Source ${suffix}`,
      externalRootKey: `source-${suffix}-${randomUUID()}`,
      status: "SYNCING",
      defaultScope: scope,
      defaultClassification: "PUBLIC",
      defaultLocale: "en",
    },
  });
  const permissionFingerprint = hashKnowledgeValue(
    stableKnowledgeValue({
      tenantId,
      sourceId: source.id,
      permissionVersion: source.sourcePermissionVersion,
      scope,
      classification: source.defaultClassification,
      locale: source.defaultLocale,
    }),
  );
  const document = await prisma.knowledgeV2Document.create({
    data: {
      tenantId,
      sourceId: source.id,
      externalKey: `document-${suffix}`,
      kind: "WEBSITE_PAGE",
      title: `Document ${suffix}`,
      canonicalLocale: "en",
      scope,
      audience: ["PUBLIC"],
      classification: "PUBLIC",
      permissionVersion: source.sourcePermissionVersion,
      status: "DISCOVERED",
    },
  });
  const revision = await prisma.knowledgeV2DocumentRevision.create({
    data: {
      tenantId,
      sourceId: source.id,
      documentId: document.id,
      revisionNumber: 1,
      contentHash: hashKnowledgeValue(stableKnowledgeValue({ suffix, texts })),
      status: "CHUNKING",
      pipelineVersion: "source-smoke-v1",
      detectedLocale: "en",
      characterCount: texts.reduce((total, text) => total + text.length, 0),
      tokenCount: texts.length * 4,
      sourcePermissionFingerprint: permissionFingerprint,
      scopeSnapshot: scope,
    },
  });
  for (const [ordinal, text] of texts.entries()) {
    const contentHash = hashKnowledgeValue(text);
    const element = await prisma.knowledgeV2Element.create({
      data: {
        tenantId,
        documentId: document.id,
        revisionId: revision.id,
        kind: "PARAGRAPH",
        ordinal,
        normalizedText: text,
        contentHash,
        locale: "en",
        classification: "PUBLIC",
      },
    });
    await prisma.knowledgeV2Chunk.create({
      data: {
        tenantId,
        revisionId: revision.id,
        documentId: document.id,
        ordinal,
        parentElementId: element.id,
        contentHash,
        tokenCount: 4,
        locale: "en",
        scope,
        classification: "PUBLIC",
        permissionVersion: source.sourcePermissionVersion,
        denseSchemaVersion: denseSchema.schemaVersion,
        sparseSchemaVersion: sparseEncoder.schema.schemaVersion,
        pipelineVersion: "source-smoke-v1",
        vectorPointId: randomUUID(),
        provenanceRange: { start: 0, end: text.length, elementIds: [element.id] },
      },
    });
  }
  await prisma.knowledgeV2Document.update({
    where: { id: document.id },
    data: { currentDraftRevisionId: revision.id },
  });
  return {
    source,
    document,
    revision,
    item: {
      itemType: "DOCUMENT_REVISION" as const,
      itemId: revision.id,
      itemVersionHash: revision.contentHash,
      authorizationFingerprint: permissionFingerprint,
      scope,
    },
  };
}

function candidate(item: Awaited<ReturnType<typeof createDocumentFixture>>["item"]) {
  return {
    candidateId: randomUUID(),
    candidateVersion: 1,
    candidateManifestHash: hashKnowledgeValue(stableKnowledgeValue(item)),
    items: [item],
  };
}

function authorizationPoint(index: number): KnowledgeV2SnapshotAuthorizationPoint {
  const sourceId = `source-${index}`;
  const revisionId = `revision-${index}`;
  return {
    sourceId,
    sourceGeneration: index + 1,
    authorizationFingerprint: hashKnowledgeValue(`authorization-${index}`),
    permissionVersion: index + 1,
    chunkId: `chunk-${index}`,
    documentId: `document-${index}`,
    revisionId,
    contentHash: hashKnowledgeValue(`content-${index}`),
    vectorPointId: `vector-${index}`,
    pointFingerprint: hashKnowledgeValue(`point-${index}`),
  };
}

function service(
  prisma: PrismaService,
  provider: SmokeDenseProvider,
  client: MemoryIndexClient,
  store: MemoryObjectStore,
) {
  return new KnowledgeV2IndexPreparationService(prisma, config, {
    denseProvider: provider,
    sparseEncoder,
    client,
    cacheStore: store,
  });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const tenantIds: string[] = [];
  let checks = 0;
  try {
    const manifestInput = {
      tenantId: "tenant-manifest",
      snapshotId: "snapshot-manifest",
      snapshotManifestHash: hashKnowledgeValue("snapshot-manifest"),
      indexSchemaHash: hashKnowledgeValue("index-schema"),
      points: [authorizationPoint(1), authorizationPoint(0)],
    };
    const authorizationManifest = buildKnowledgeV2SnapshotAuthorizationManifest(manifestInput);
    const reorderedAuthorizationManifest = buildKnowledgeV2SnapshotAuthorizationManifest({
      ...manifestInput,
      points: [...manifestInput.points].reverse(),
    });
    check(
      authorizationManifest.hash === reorderedAuthorizationManifest.hash &&
        stableKnowledgeValue(authorizationManifest.manifest) ===
          stableKnowledgeValue(reorderedAuthorizationManifest.manifest),
      "authorization manifest depended on point order",
    );
    const textOrderManifest = buildKnowledgeV2SnapshotAuthorizationManifest({
      ...manifestInput,
      points: ["revision-a", "revision-Z", "revision-A"].map((revisionId, index) => ({
        ...authorizationPoint(index + 100),
        sourceId: "source-text-order",
        sourceGeneration: 1,
        authorizationFingerprint: "f".repeat(64),
        permissionVersion: 1,
        revisionId,
      })),
    });
    check(
      JSON.stringify(textOrderManifest.manifest.revisionIds) ===
        JSON.stringify(["revision-A", "revision-Z", "revision-a"]),
      "authorization manifest ordering depended on host locale collation",
    );
    check(
      stableKnowledgeValue({ a: 1, Z: 2, A: 3 }) === '{"A":3,"Z":2,"a":1}',
      "stable knowledge object ordering depended on host locale collation",
    );
    check(
      parseKnowledgeV2SnapshotAuthorizationManifest(
        authorizationManifest.manifest,
        authorizationManifest.hash,
      ) !== null,
      "canonical authorization manifest did not parse",
    );
    const tamperedManifest: KnowledgeV2SnapshotAuthorizationManifest = {
      ...authorizationManifest.manifest,
      partitions: authorizationManifest.manifest.partitions.map((partition, index) =>
        index === 0 ? { ...partition, membershipHash: "0".repeat(64) } : partition,
      ),
    };
    check(
      parseKnowledgeV2SnapshotAuthorizationManifest(
        tamperedManifest,
        authorizationManifest.hash,
      ) === null,
      "tampered authorization manifest passed its stored hash",
    );
    check(
      parseKnowledgeV2SnapshotAuthorizationManifest(null, authorizationManifest.hash) === null &&
        parseKnowledgeV2SnapshotAuthorizationManifest(authorizationManifest.manifest, null) ===
          null,
      "missing authorization manifest or hash was accepted",
    );
    const countTamperedManifest: KnowledgeV2SnapshotAuthorizationManifest = {
      ...authorizationManifest.manifest,
      expectedPointCount: authorizationManifest.manifest.expectedPointCount + 1,
    };
    check(
      parseKnowledgeV2SnapshotAuthorizationManifest(
        countTamperedManifest,
        knowledgeV2SnapshotAuthorizationManifestHash(countTamperedManifest),
      ) === null,
      "authorization manifest accepted an inconsistent point count",
    );
    const unsortedManifest: KnowledgeV2SnapshotAuthorizationManifest = {
      ...authorizationManifest.manifest,
      partitions: [...authorizationManifest.manifest.partitions].reverse(),
    };
    check(
      parseKnowledgeV2SnapshotAuthorizationManifest(
        unsortedManifest,
        knowledgeV2SnapshotAuthorizationManifestHash(unsortedManifest),
      ) === null,
      "authorization manifest accepted noncanonical partition order",
    );
    let partitionOverflowRejected = false;
    try {
      buildKnowledgeV2SnapshotAuthorizationManifest({
        ...manifestInput,
        points: Array.from(
          { length: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS + 1 },
          (_value, index) => authorizationPoint(index),
        ),
      });
    } catch {
      partitionOverflowRejected = true;
    }
    check(partitionOverflowRejected, "authorization manifest accepted more than 512 partitions");
    checks += 9;

    const maximumScopeIds = Array.from({ length: 50 }, (_, index) => `brand-${index}`);
    check(
      isKnowledgeV2Scope({
        brandIds: maximumScopeIds,
        assistantIds: ["a".repeat(128)],
        segments: ["priority customer"],
      }),
      "API scope validation rejected declared boundaries",
    );
    check(
      !isKnowledgeV2Scope({ brandIds: [...maximumScopeIds, "brand-overflow"] }),
      "API scope validation accepted cardinality overflow",
    );
    check(
      !isKnowledgeV2Scope({ segments: ["*"] }),
      "API scope validation accepted the reserved wildcard",
    );
    checks += 3;

    const tenant = await createTenant(prisma, "lifecycle");
    tenantIds.push(tenant.id);
    const fixture = await createDocumentFixture(prisma, tenant.id, "lifecycle", [
      "Appointments require confirmation by email.",
    ]);
    const provider = new SmokeDenseProvider([1, 0, 0]);
    const client = new MemoryIndexClient();
    const store = new MemoryObjectStore();
    const preparation = service(prisma, provider, client, store);
    const request = candidate(fixture.item);
    const prepared = await preparation.prepareCandidate({ tenantId: tenant.id, ...request });
    check(prepared.snapshotId && prepared.expectedPointCount === 1, "candidate was not indexed");
    const [source, document, revision, chunk, snapshot] = await Promise.all([
      prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: fixture.source.id } }),
      prisma.knowledgeV2Document.findUniqueOrThrow({ where: { id: fixture.document.id } }),
      prisma.knowledgeV2DocumentRevision.findUniqueOrThrow({ where: { id: fixture.revision.id } }),
      prisma.knowledgeV2Chunk.findFirstOrThrow({ where: { revisionId: fixture.revision.id } }),
      prisma.knowledgeIndexSnapshot.findUniqueOrThrow({ where: { id: prepared.snapshotId! } }),
    ]);
    check(
      source.status === "READY" &&
        document.status === "ACTIVE" &&
        revision.status === "READY" &&
        chunk.indexState === "INDEXED",
      "candidate readiness was not finalized",
    );
    const persistedAuthorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot.authorizationManifest,
      snapshot.authorizationManifestHash,
    );
    check(
      snapshot.authorizationManifestVersion === 1 &&
        persistedAuthorizationManifest?.tenantId === tenant.id &&
        persistedAuthorizationManifest.snapshotId === snapshot.id &&
        persistedAuthorizationManifest.snapshotManifestHash === snapshot.manifestHash &&
        persistedAuthorizationManifest.indexSchemaHash === snapshot.indexSchemaHash &&
        persistedAuthorizationManifest.expectedPointCount === snapshot.expectedPointCount &&
        persistedAuthorizationManifest.revisionIds[0] === fixture.revision.id,
      "READY snapshot did not persist its exact authorization manifest",
    );
    checks += 3;

    const callsAfterFirst = provider.calls;
    const replay = await preparation.prepareCandidate({ tenantId: tenant.id, ...request });
    check(replay.reused && provider.calls === callsAfterFirst, "READY replay called the provider");
    checks += 1;

    await client.deleteSnapshotPartition({
      workspaceId: tenant.id,
      indexSnapshotId: prepared.snapshotId,
    });
    const repaired = await preparation.prepareCandidate({ tenantId: tenant.id, ...request });
    check(
      repaired.reused && repaired.observedPointCount === 1 && provider.calls === callsAfterFirst,
      "missing READY vectors were not rebuilt from the canonical cache",
    );
    checks += 1;

    const cache = await prisma.knowledgeV2EmbeddingCache.findFirstOrThrow({
      where: { tenantId: tenant.id, deletedAt: null },
    });
    await prisma.knowledgeV2EmbeddingCache.update({
      where: { id: cache.id },
      data: { expiresAt: new Date(cache.createdAt.getTime() + 1) },
    });
    await client.deleteSnapshotPartition({
      workspaceId: tenant.id,
      indexSnapshotId: prepared.snapshotId,
    });
    const callsBeforeExpiryRepair = provider.calls;
    await preparation.prepareCandidate({ tenantId: tenant.id, ...request });
    check(
      provider.calls === callsBeforeExpiryRepair + 1 &&
        (await prisma.knowledgeV2EmbeddingCache.count({
          where: { tenantId: tenant.id, deletedAt: null },
        })) === 1,
      "expired cache for live content was not rebuilt",
    );
    checks += 1;

    const rollbackManifestHash = hashKnowledgeValue(
      stableKnowledgeValue({ operation: "ROLLBACK", item: fixture.item }),
    );
    const rollbackPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "VALIDATING",
        manifestHash: rollbackManifestHash,
        pipelineVersion: "knowledge-v2-hybrid-v1",
        retrievalPolicyVersion: "knowledge-v2-hybrid-v1",
        promptPolicyVersion: "knowledge-v2-hybrid-v1",
        qualitySummary: { schemaVersion: 1, operation: "ROLLBACK" },
        items: {
          create: {
            itemType: "DOCUMENT_REVISION",
            itemId: fixture.revision.id,
            itemVersionHash: fixture.revision.contentHash,
            v2DocumentRevisionId: fixture.revision.id,
            scope: fixture.item.scope,
            authorizationFingerprint: fixture.item.authorizationFingerprint,
          },
        },
      },
    });
    const rollbackValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        candidateId: randomUUID(),
        candidateVersion: 1,
        candidateManifestHash: rollbackManifestHash,
        publicationId: rollbackPublication.id,
        candidateItems: [fixture.item],
        status: "PASSED",
        blockers: [],
        warnings: [],
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60_000),
      },
    });
    const rollbackPrepared = await preparation.preparePublication({
      tenantId: tenant.id,
      publicationId: rollbackPublication.id,
    });
    const [attachedRollback, attachedValidation] = await Promise.all([
      prisma.knowledgePublication.findUniqueOrThrow({
        where: { id: rollbackPublication.id },
      }),
      prisma.knowledgeV2PublicationValidation.findUniqueOrThrow({
        where: { id: rollbackValidation.id },
      }),
    ]);
    check(
      rollbackPrepared.snapshotId === prepared.snapshotId &&
        attachedRollback.status === "READY" &&
        attachedRollback.readyAt !== null &&
        attachedRollback.indexSnapshotId === prepared.snapshotId &&
        attachedValidation.indexSnapshotId === prepared.snapshotId,
      "rollback publication became READY before its exact index snapshot was attached",
    );
    checks += 1;

    const crashTenant = await createTenant(prisma, "post-upsert-crash");
    tenantIds.push(crashTenant.id);
    const crashFixture = await createDocumentFixture(prisma, crashTenant.id, "post-upsert-crash", [
      "A retry must use the canonical cached vector.",
    ]);
    const crashProvider = new SmokeDenseProvider([1, 0, 0]);
    const crashClient = new MemoryIndexClient();
    const crashStore = new MemoryObjectStore();
    const crashService = service(prisma, crashProvider, crashClient, crashStore);
    const crashRequest = candidate(crashFixture.item);
    crashClient.failNextReconcile = true;
    let postUpsertFailed = false;
    try {
      await crashService.prepareCandidate({ tenantId: crashTenant.id, ...crashRequest });
    } catch {
      postUpsertFailed = true;
    }
    const crashCalls = crashProvider.calls;
    crashProvider.vector = [0, 1, 0];
    const crashRetry = await crashService.prepareCandidate({
      tenantId: crashTenant.id,
      ...crashRequest,
    });
    check(
      postUpsertFailed &&
        crashClient.snapshotDeletes > 0 &&
        crashRetry.observedPointCount === 1 &&
        crashProvider.calls === crashCalls,
      "post-upsert failure did not compensate and retry from canonical cache",
    );
    checks += 1;

    const deniedTenant = await createTenant(prisma, "denied", false);
    tenantIds.push(deniedTenant.id);
    const deniedFixture = await createDocumentFixture(prisma, deniedTenant.id, "denied", [
      "Public help content.",
    ]);
    const deniedProvider = new SmokeDenseProvider([1, 0, 0]);
    let denied = false;
    try {
      await service(
        prisma,
        deniedProvider,
        new MemoryIndexClient(),
        new MemoryObjectStore(),
      ).prepareCandidate({ tenantId: deniedTenant.id, ...candidate(deniedFixture.item) });
    } catch {
      denied = true;
    }
    check(
      denied &&
        deniedProvider.calls === 0 &&
        (await prisma.knowledgeIndexSnapshot.count({ where: { tenantId: deniedTenant.id } })) === 0,
      "default-deny policy leaked content to the provider",
    );
    checks += 1;

    const revokedTenant = await createTenant(prisma, "revoked");
    tenantIds.push(revokedTenant.id);
    const revokedFixture = await createDocumentFixture(prisma, revokedTenant.id, "revoked", [
      "First provider batch.",
      "Second provider batch must not leave.",
    ]);
    const revokedProvider = new SmokeDenseProvider([1, 0, 0], async (call) => {
      if (call === 1) {
        await prisma.$executeRaw`
          UPDATE "KnowledgeV2Settings"
          SET "embeddingProviderPolicy" = NULL
          WHERE "tenantId" = ${revokedTenant.id}
        `;
      }
    });
    let revoked = false;
    try {
      await service(
        prisma,
        revokedProvider,
        new MemoryIndexClient(),
        new MemoryObjectStore(),
      ).prepareCandidate({ tenantId: revokedTenant.id, ...candidate(revokedFixture.item) });
    } catch {
      revoked = true;
    }
    check(revoked && revokedProvider.calls === 1, "revoked consent allowed another provider call");
    checks += 1;

    type DocumentFixture = Awaited<ReturnType<typeof createDocumentFixture>>;
    const malformedPolicyScenarios: string[] = [];
    const assertMalformedPolicyRejected = async (
      label: string,
      mutate: (fixture: DocumentFixture) => Promise<void>,
      itemScope?: unknown,
    ) => {
      const policyTenant = await createTenant(prisma, `malformed-${label}`);
      tenantIds.push(policyTenant.id);
      const policyFixture = await createDocumentFixture(prisma, policyTenant.id, label, [
        "This content must not leave under malformed authorization policy.",
      ]);
      await mutate(policyFixture);
      const policyProvider = new SmokeDenseProvider([1, 0, 0]);
      const policyClient = new MemoryIndexClient();
      const request = candidate(policyFixture.item);
      if (itemScope !== undefined) {
        (request.items[0] as { scope: unknown }).scope = itemScope;
      }
      let rejected = false;
      try {
        await service(
          prisma,
          policyProvider,
          policyClient,
          new MemoryObjectStore(),
        ).prepareCandidate({ tenantId: policyTenant.id, ...request } as never);
      } catch {
        rejected = true;
      }
      check(
        rejected &&
          policyProvider.calls === 0 &&
          policyClient.points.size === 0 &&
          (await prisma.knowledgeIndexSnapshot.count({ where: { tenantId: policyTenant.id } })) ===
            0,
        `malformed ${label} policy reached an embedding or index boundary`,
      );
      checks += 1;
      malformedPolicyScenarios.push(label);
    };

    await assertMalformedPolicyRejected("source-scope", async (fixture) => {
      await prisma.knowledgeV2Source.update({
        where: { id: fixture.source.id },
        data: { defaultScope: { audiences: "PUBLIC" } },
      });
    });
    await assertMalformedPolicyRejected("document-scope", async (fixture) => {
      await prisma.knowledgeV2Document.update({
        where: { id: fixture.document.id },
        data: { scope: { locationIds: "private" } },
      });
    });
    const invalidRevisionScope = { locales: ["en", 7] };
    await assertMalformedPolicyRejected(
      "revision-scope",
      async (fixture) => {
        await prisma.knowledgeV2DocumentRevision.update({
          where: { id: fixture.revision.id },
          data: { scopeSnapshot: invalidRevisionScope },
        });
      },
      invalidRevisionScope,
    );
    await assertMalformedPolicyRejected("chunk-scope", async (fixture) => {
      await prisma.knowledgeV2Chunk.updateMany({
        where: { revisionId: fixture.revision.id },
        data: { scope: { audiences: ["PUBLIC", 7] } },
      });
    });
    await assertMalformedPolicyRejected("chunk-scope-inheritance", async (fixture) => {
      await prisma.knowledgeV2Chunk.updateMany({
        where: { revisionId: fixture.revision.id },
        data: { scope: { audiences: ["INTERNAL"], locales: ["en"] } },
      });
    });
    const internalScope = { audiences: ["INTERNAL"], locales: ["en"] };
    await assertMalformedPolicyRejected(
      "document-prefilter-audience",
      async (fixture) => {
        await prisma.knowledgeV2Document.update({
          where: { id: fixture.document.id },
          data: { scope: internalScope },
        });
        await prisma.knowledgeV2DocumentRevision.update({
          where: { id: fixture.revision.id },
          data: { scopeSnapshot: internalScope },
        });
        await prisma.knowledgeV2Chunk.updateMany({
          where: { revisionId: fixture.revision.id },
          data: { scope: internalScope },
        });
      },
      internalScope,
    );
    const regionalScope = { audiences: ["PUBLIC"], locales: ["en-US"] };
    await assertMalformedPolicyRejected(
      "document-prefilter-locale",
      async (fixture) => {
        await prisma.knowledgeV2Document.update({
          where: { id: fixture.document.id },
          data: { scope: regionalScope },
        });
        await prisma.knowledgeV2DocumentRevision.update({
          where: { id: fixture.revision.id },
          data: { scopeSnapshot: regionalScope },
        });
        await prisma.knowledgeV2Chunk.updateMany({
          where: { revisionId: fixture.revision.id },
          data: { scope: regionalScope },
        });
      },
      regionalScope,
    );
    await assertMalformedPolicyRejected("manifest-scope", async () => undefined, {
      audience: ["PUBLIC"],
    });
    await assertMalformedPolicyRejected("document-audience", async (fixture) => {
      await prisma.knowledgeV2Document.update({
        where: { id: fixture.document.id },
        data: { audience: [] },
      });
    });
    await assertMalformedPolicyRejected("reserved-wildcard-segment", async (fixture) => {
      await prisma.knowledgeV2Source.update({
        where: { id: fixture.source.id },
        data: { defaultScope: { segments: ["*"] } },
      });
    });
    await assertMalformedPolicyRejected("point-metadata-locale", async (fixture) => {
      await prisma.knowledgeV2Chunk.updateMany({
        where: { revisionId: fixture.revision.id },
        data: { locale: "x".repeat(36) },
      });
    });

    const boundaryTenant = await createTenant(prisma, "scope-boundary");
    tenantIds.push(boundaryTenant.id);
    const boundaryScope = {
      audiences: ["PUBLIC"],
      locales: ["en"],
      brandIds: maximumScopeIds,
      assistantIds: ["a".repeat(128)],
      segments: ["priority customer"],
    };
    const boundaryFixture = await createDocumentFixture(
      prisma,
      boundaryTenant.id,
      "scope-boundary",
      ["Boundary-scoped content remains indexable."],
      boundaryScope,
    );
    const boundaryProvider = new SmokeDenseProvider([1, 0, 0]);
    const boundaryClient = new MemoryIndexClient();
    const boundaryResult = await service(
      prisma,
      boundaryProvider,
      boundaryClient,
      new MemoryObjectStore(),
    ).prepareCandidate({
      tenantId: boundaryTenant.id,
      ...candidate(boundaryFixture.item),
    });
    check(
      boundaryResult.expectedPointCount === 1 &&
        boundaryProvider.calls === 1 &&
        [...boundaryClient.points.values()][0]?.point.brandIds?.length === 50 &&
        [...boundaryClient.points.values()][0]?.point.segmentIds?.[0] === "priority customer",
      "accepted scope boundaries did not reach the index intact",
    );
    checks += 1;

    const permissionRaceTenant = await createTenant(prisma, "permission-race");
    tenantIds.push(permissionRaceTenant.id);
    const permissionRaceFixture = await createDocumentFixture(
      prisma,
      permissionRaceTenant.id,
      "permission-race",
      ["Permission changes after reconciliation must block READY."],
    );
    const permissionRaceProvider = new SmokeDenseProvider([1, 0, 0]);
    const permissionRaceClient = new MemoryIndexClient();
    permissionRaceClient.afterNextCount = async () => {
      await prisma.knowledgeV2Source.update({
        where: { id: permissionRaceFixture.source.id },
        data: {
          sourcePermissionVersion: { increment: 1 },
          generation: { increment: 1 },
          defaultLocale: "fr",
        },
      });
    };
    let permissionRaceRejected = false;
    try {
      await service(
        prisma,
        permissionRaceProvider,
        permissionRaceClient,
        new MemoryObjectStore(),
      ).prepareCandidate({
        tenantId: permissionRaceTenant.id,
        ...candidate(permissionRaceFixture.item),
      });
    } catch {
      permissionRaceRejected = true;
    }
    const permissionRaceSnapshot = await prisma.knowledgeIndexSnapshot.findFirstOrThrow({
      where: { tenantId: permissionRaceTenant.id },
    });
    check(
      permissionRaceRejected &&
        permissionRaceSnapshot.status === "PREPARING" &&
        permissionRaceSnapshot.authorizationManifest === null &&
        permissionRaceSnapshot.authorizationManifestHash === null &&
        permissionRaceClient.points.size === 0,
      "permission change after Qdrant reconciliation committed a READY snapshot",
    );
    checks += 1;

    const concurrentTenant = await createTenant(prisma, "concurrent");
    tenantIds.push(concurrentTenant.id);
    const sharedText = "Shared canonical embedding content.";
    const [left, right] = await Promise.all([
      createDocumentFixture(prisma, concurrentTenant.id, "left", [sharedText]),
      createDocumentFixture(prisma, concurrentTenant.id, "right", [sharedText]),
    ]);
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothArrived;
    };
    const concurrentClient = new MemoryIndexClient();
    const concurrentStore = new MemoryObjectStore();
    const leftProvider = new SmokeDenseProvider([1, 0, 0], barrier);
    const rightProvider = new SmokeDenseProvider([0, 1, 0], barrier);
    await Promise.all([
      service(prisma, leftProvider, concurrentClient, concurrentStore).prepareCandidate({
        tenantId: concurrentTenant.id,
        ...candidate(left.item),
      }),
      service(prisma, rightProvider, concurrentClient, concurrentStore).prepareCandidate({
        tenantId: concurrentTenant.id,
        ...candidate(right.item),
      }),
    ]);
    const denseVectors = [...concurrentClient.points.values()].map((item) =>
      item.point.denseVector.join(","),
    );
    check(
      new Set(denseVectors).size === 1 &&
        (await prisma.knowledgeV2EmbeddingCache.count({
          where: { tenantId: concurrentTenant.id, deletedAt: null },
        })) === 1 &&
        concurrentStore.values.size === 1,
      "concurrent cache writers did not converge on the first canonical payload",
    );
    checks += 1;

    console.log(
      JSON.stringify({
        ok: true,
        checks,
        providerCalls: provider.calls,
        scenarios: [
          "authorization-manifest-canonical-order",
          "authorization-manifest-strict-hash-and-shape",
          "authorization-manifest-count-reconciliation",
          "authorization-manifest-partition-ceiling",
          "candidate-readiness",
          "ready-authorization-manifest-persistence",
          "ready-reuse-without-provider",
          "ready-vector-repair",
          "rollback-ready-after-snapshot-commit",
          "live-content-cache-expiry",
          "post-upsert-compensation-and-retry",
          "default-deny-provider-policy",
          "mid-batch-policy-revocation",
          "post-reconciliation-permission-race",
          ...malformedPolicyScenarios.map((label) => `malformed-${label}-denied`),
          "concurrent-cache-first-writer-wins",
        ],
      }),
    );
  } finally {
    for (const tenantId of tenantIds.reverse()) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
