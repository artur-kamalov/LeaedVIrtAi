import assert from "node:assert/strict";
import {
  assertKnowledgeV2DenseProviderSchema,
  assertKnowledgeV2SparseEncoderSchema,
  KnowledgeV2HybridIndexError,
  KnowledgeV2HybridQdrantClient,
  knowledgeV2HybridCollectionName,
  validateKnowledgeV2DenseEmbeddingBatch,
  validateKnowledgeV2SparseEncodingBatch,
  type KnowledgeV2DenseEmbeddingProvider,
  type KnowledgeV2HybridPointInput,
  type KnowledgeV2HybridQdrantConfig,
  type KnowledgeV2IndexPermissionPartition,
  type KnowledgeV2SparseEncoder,
} from "@leadvirt/knowledge";

interface StoredPoint {
  id: string;
  vector: Record<string, unknown>;
  payload: Record<string, unknown>;
}

interface CapturedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let checks = 0;

function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function values(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function matchValue(actual: unknown, expected: unknown) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function matchesCondition(point: StoredPoint, conditionValue: unknown): boolean {
  const condition = object(conditionValue);
  if (!condition) return false;
  if (Array.isArray(condition.has_id)) return condition.has_id.includes(point.id);
  if (Array.isArray(condition.must) || Array.isArray(condition.should)) {
    return matchesFilter(point, condition);
  }
  if (typeof condition.key !== "string") return false;
  const match = object(condition.match);
  if (!match) return false;
  const actual = point.payload[condition.key];
  if (Object.prototype.hasOwnProperty.call(match, "value")) {
    return matchValue(actual, match.value);
  }
  if (Array.isArray(match.any)) {
    const actualValues = Array.isArray(actual) ? actual : [actual];
    return actualValues.some((item) => match.any!.includes(item));
  }
  return false;
}

function matchesFilter(point: StoredPoint, filterValue: unknown): boolean {
  const filter = object(filterValue);
  if (!filter) return false;
  const must = values(filter.must);
  const should = values(filter.should);
  return (
    must.every((condition) => matchesCondition(point, condition)) &&
    (should.length === 0 || should.some((condition) => matchesCondition(point, condition)))
  );
}

class FakeQdrantV115 {
  readonly requests: CapturedRequest[] = [];
  readonly points = new Map<string, StoredPoint>();
  readonly payloadIndexes = new Map<string, unknown>();
  collectionConfig: Record<string, unknown> | null = null;
  upsertCalls = 0;
  deleteCalls = 0;
  countCalls = 0;
  countFailures = 0;
  deleteNoOp = false;

  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const body =
      typeof init.body === "string" && init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    this.requests.push({ method, path: `${url.pathname}${url.search}`, body });

    if (/^\/collections\/[^/]+$/u.test(url.pathname)) {
      if (method === "GET") {
        if (!this.collectionConfig) return jsonResponse({ status: "not found" }, 404);
        return jsonResponse({
          status: "ok",
          result: {
            config: {
              params: {
                vectors: this.collectionConfig.vectors,
                sparse_vectors: this.collectionConfig.sparse_vectors,
              },
              strict_mode_config: this.collectionConfig.strict_mode_config,
            },
          },
        });
      }
      if (method === "PUT") {
        this.collectionConfig = body;
        return jsonResponse({ status: "ok", result: true });
      }
    }

    if (url.pathname.endsWith("/index") && method === "PUT") {
      if (!body || typeof body.field_name !== "string") return jsonResponse({}, 400);
      this.payloadIndexes.set(body.field_name, body.field_schema);
      return jsonResponse({ status: "ok", result: { status: "acknowledged" } });
    }

    if (url.pathname.endsWith("/points") && method === "POST") {
      const ids = values(body?.ids).filter((value): value is string => typeof value === "string");
      return jsonResponse({
        status: "ok",
        result: ids.flatMap((id) => {
          const point = this.points.get(id);
          return point ? [{ id: point.id, payload: point.payload, vector: point.vector }] : [];
        }),
      });
    }

    if (url.pathname.endsWith("/points") && method === "PUT") {
      this.upsertCalls += 1;
      for (const value of values(body?.points)) {
        const point = object(value);
        const payload = object(point?.payload);
        const vector = object(point?.vector);
        if (typeof point?.id !== "string" || !payload || !vector) return jsonResponse({}, 400);
        this.points.set(point.id, { id: point.id, payload, vector });
      }
      return jsonResponse({ status: "ok", result: { status: "completed" } });
    }

    if (url.pathname.endsWith("/points/count") && method === "POST") {
      this.countCalls += 1;
      if (this.countFailures > 0) {
        this.countFailures -= 1;
        return jsonResponse({ error: "api_key=dependency_secret" }, 503);
      }
      const filter = body?.filter;
      const count = [...this.points.values()].filter((point) =>
        matchesFilter(point, filter),
      ).length;
      return jsonResponse({ status: "ok", result: { count } });
    }

    if (url.pathname.endsWith("/points/scroll") && method === "POST") {
      const filter = body?.filter;
      const limit = typeof body?.limit === "number" ? body.limit : 10;
      const offset = typeof body?.offset === "number" ? body.offset : 0;
      const selected = [...this.points.values()].filter((point) => matchesFilter(point, filter));
      const page = selected.slice(offset, offset + limit);
      const next = offset + page.length < selected.length ? offset + page.length : null;
      return jsonResponse({
        status: "ok",
        result: {
          points: page.map((point) => ({
            id: point.id,
            payload: point.payload,
            vector: point.vector,
          })),
          next_page_offset: next,
        },
      });
    }

    if (url.pathname.endsWith("/points/delete") && method === "POST") {
      this.deleteCalls += 1;
      const filter = body?.filter;
      if (!this.deleteNoOp) {
        for (const point of [...this.points.values()]) {
          if (matchesFilter(point, filter)) this.points.delete(point.id);
        }
      }
      return jsonResponse({ status: "ok", result: { status: "completed" } });
    }

    if (url.pathname.endsWith("/points/query") && method === "POST") {
      const filter = body?.filter;
      const limit = typeof body?.limit === "number" ? body.limit : 10;
      const selected = [...this.points.values()]
        .filter((point) => matchesFilter(point, filter))
        .slice(0, limit);
      return jsonResponse({
        status: "ok",
        result: {
          points: selected.map((point, index) => ({
            id: point.id,
            score: 1 - index / 100,
            payload: point.payload,
          })),
        },
      });
    }

    return jsonResponse({ error: "unsupported fake request" }, 400);
  };
}

const denseSchema = {
  vectorName: "content_dense",
  schemaVersion: "dense-v1",
  provider: "fixed-test-provider",
  model: "fixed-multilingual-v1",
  dimensions: 3,
  distance: "Cosine",
} as const;

const sparseSchema = {
  vectorName: "content_sparse",
  schemaVersion: "sparse-v1",
  provider: "fixed-test-encoder",
  model: "fixed-lexical-v1",
  maxNonZeroValues: 8,
} as const;

const config: KnowledgeV2HybridQdrantConfig = {
  qdrantUrl: "http://qdrant.test:6333",
  qdrantApiKey: "must-never-appear",
  collectionPrefix: "leadvirt_knowledge_v2",
  dense: denseSchema,
  sparse: sparseSchema,
  requestTimeoutMs: 500,
  maxAttempts: 3,
  retryBaseDelayMs: 2,
  maxBatchSize: 2,
  maxReconcilePoints: 20,
};

const scope: KnowledgeV2IndexPermissionPartition = {
  workspaceId: "workspace-1",
  indexSnapshotId: "snapshot-1",
  permissionFingerprint: "a".repeat(64),
  permissionVersion: 7,
};

function point(
  chunkId: string,
  denseVector: readonly number[],
  locationIds?: readonly string[],
  segmentIds?: readonly string[],
): KnowledgeV2HybridPointInput {
  return {
    documentId: "document-1",
    revisionId: "revision-1",
    chunkId,
    locale: "en",
    audiences: ["PUBLIC"],
    classification: "PUBLIC",
    ...(locationIds ? { locationIds } : {}),
    ...(segmentIds ? { segmentIds } : {}),
    sourceKind: "WEBSITE",
    documentKind: "WEBSITE_PAGE",
    contentHash: "b".repeat(64),
    pipelineVersion: "knowledge-v2",
    denseVector,
    sparseVector: { indices: [1, 9], values: [0.4, 0.9] },
  };
}

async function expectCode(promise: Promise<unknown> | (() => unknown), code: string) {
  try {
    if (typeof promise === "function") promise();
    else await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    check(
      error instanceof KnowledgeV2HybridIndexError && error.code === code,
      `Expected ${code}, received ${error instanceof Error ? error.name : typeof error}`,
    );
    return error;
  }
}

async function main() {
  const fake = new FakeQdrantV115();
  const retryDelays: number[] = [];
  const client = new KnowledgeV2HybridQdrantClient(config, {
    fetchImpl: fake.fetch,
    sleep: async (milliseconds) => {
      retryDelays.push(milliseconds);
    },
    random: () => 0.5,
  });

  const denseProvider: KnowledgeV2DenseEmbeddingProvider = {
    schema: denseSchema,
    async embedBatch(input) {
      return input.map((item, index) => ({
        id: item.id,
        vector: index === 0 ? [1, 0, 0] : [0, 1, 0],
      }));
    },
  };
  const sparseEncoder: KnowledgeV2SparseEncoder = {
    schema: sparseSchema,
    async encodeBatch(input) {
      return input.map((item) => ({
        id: item.id,
        vector: { indices: [1, 5], values: [0.25, 0.75] },
      }));
    },
  };
  assertKnowledgeV2DenseProviderSchema(denseProvider, denseSchema);
  assertKnowledgeV2SparseEncoderSchema(sparseEncoder, sparseSchema);
  const providerInput = [
    { id: "chunk-a", text: "fixed input", locale: "en" },
    { id: "chunk-b", text: "fixed input", locale: "en" },
  ];
  const providerSignal = new AbortController().signal;
  const denseOutput = await denseProvider.embedBatch(providerInput, providerSignal);
  const sparseOutput = await sparseEncoder.encodeBatch(providerInput, providerSignal);
  validateKnowledgeV2DenseEmbeddingBatch(
    denseSchema,
    providerInput.map((item) => item.id),
    denseOutput,
  );
  validateKnowledgeV2SparseEncodingBatch(
    sparseSchema,
    providerInput.map((item) => item.id),
    sparseOutput,
  );
  checks += 4;
  await expectCode(
    () =>
      validateKnowledgeV2DenseEmbeddingBatch(
        denseSchema,
        ["chunk-a"],
        [{ id: "chunk-a", vector: [1, 0] }],
      ),
    "INVALID_VECTOR",
  );
  await expectCode(
    () =>
      validateKnowledgeV2SparseEncodingBatch(
        sparseSchema,
        ["chunk-a"],
        [{ id: "chunk-a", vector: { indices: [2, 2], values: [1, 1] } }],
      ),
    "INVALID_VECTOR",
  );

  const physicalName = knowledgeV2HybridCollectionName(config);
  check(client.physicalCollectionName === physicalName, "physical collection name was not stable");
  check(
    physicalName !==
      knowledgeV2HybridCollectionName({
        ...config,
        dense: { ...denseSchema, dimensions: 4 },
      }),
    "collection name did not change with the vector schema",
  );
  await client.ensurePhysicalCollection();
  const createRequest = fake.requests.find(
    (request) => request.method === "PUT" && request.path === `/collections/${physicalName}`,
  );
  const vectors = object(createRequest?.body?.vectors);
  const sparseVectors = object(createRequest?.body?.sparse_vectors);
  const strictMode = object(createRequest?.body?.strict_mode_config);
  check(Boolean(vectors?.content_dense), "named dense vector config is missing");
  check(Boolean(sparseVectors?.content_sparse), "named sparse vector config is missing");
  check(strictMode?.enabled === true, "strict mode was not enabled");
  check(
    object(object(strictMode?.sparse_config)?.content_sparse)?.max_length === 8,
    "strict sparse-vector bound is missing",
  );
  for (const field of [
    "workspace_id",
    "index_snapshot_id",
    "permission_fingerprint",
    "permission_version",
  ]) {
    check(fake.payloadIndexes.has(field), `mandatory payload index ${field} is missing`);
  }
  check(fake.payloadIndexes.has("segment_scope"), "segment scope payload index is missing");

  const secret = "api_key=must_not_enter_qdrant_payload";
  const inputPoints = [
    { ...point("chunk-1", [1, 0, 0]), rawContent: secret },
    point("chunk-2", [0, 1, 0], ["location-1"], ["segment-1"]),
    point("chunk-3", [0, 0, 1], ["location-2"]),
    point("chunk-4", [0.5, 0.5, 0], ["location-1"], ["segment-2"]),
  ] as readonly KnowledgeV2HybridPointInput[];
  const first = await client.upsertSnapshotPoints({ scope, points: inputPoints });
  check(first.upserted === 4 && first.batches === 2, "bounded batch upsert failed");
  check(fake.upsertCalls === 2, "unexpected Qdrant upsert batch count");
  const wire = JSON.stringify(fake.requests);
  check(!wire.includes(secret), "raw content leaked into the Qdrant protocol");
  check(!wire.includes("rawContent"), "arbitrary caller payload leaked into Qdrant");
  for (const stored of fake.points.values()) {
    check(
      Object.keys(stored.vector).sort().join(",") === "content_dense,content_sparse",
      "point did not contain both named vectors",
    );
    check(
      stored.payload.workspace_id === scope.workspaceId &&
        stored.payload.index_snapshot_id === scope.indexSnapshotId &&
        stored.payload.permission_fingerprint === scope.permissionFingerprint,
      "point payload lost an immutable authorization partition",
    );
  }
  const repeated = await client.upsertSnapshotPoints({ scope, points: inputPoints });
  check(repeated.upserted === 0 && repeated.unchanged === 4, "upsert was not idempotent");
  check(fake.upsertCalls === 2, "idempotent upsert rewrote immutable points");
  check(
    client.preparePoint(scope, inputPoints[0]!).id === first.points[0]!.id,
    "deterministic point identity changed",
  );
  check(
    client.preparePoint({ ...scope, indexSnapshotId: "snapshot-2" }, inputPoints[0]!).id !==
      first.points[0]!.id,
    "snapshot-bound point identity was not isolated",
  );
  check(
    ![...fake.points.values()].some((point) => "publication_id" in point.payload),
    "mutable publication identity leaked into snapshot points",
  );

  const requestsBeforeInvalid = fake.requests.length;
  await expectCode(
    client.upsertSnapshotPoints({ scope, points: [point("invalid-dense", [1, 0])] }),
    "INVALID_VECTOR",
  );
  await expectCode(
    client.upsertSnapshotPoints({
      scope,
      points: [
        {
          ...point("invalid-sparse", [1, 0, 0]),
          sparseVector: { indices: [3, 3], values: [1, 1] },
        },
      ],
    }),
    "INVALID_VECTOR",
  );
  check(fake.requests.length === requestsBeforeInvalid, "invalid vectors reached Qdrant");

  fake.countFailures = 1;
  const count = await client.countPermissionPartition(scope);
  check(count === 4, "exact partition count failed");
  check(retryDelays.length === 1, "retryable Qdrant failure was not retried once");
  check(
    (await client.countPermissionPartition({
      ...scope,
      permissionFingerprint: "c".repeat(64),
    })) === 0,
    "permission filter widened the count partition",
  );
  const countRequest = [...fake.requests]
    .reverse()
    .find((request) => request.path.endsWith("/points/count"));
  const countFilter = object(countRequest?.body?.filter);
  const countKeys = values(countFilter?.must).flatMap((value) => {
    const condition = object(value);
    return typeof condition?.key === "string" ? [condition.key] : [];
  });
  for (const field of [
    "workspace_id",
    "index_snapshot_id",
    "permission_fingerprint",
    "permission_version",
  ]) {
    check(countKeys.includes(field), `count omitted mandatory filter ${field}`);
  }

  const query = await client.queryHybrid({
    workspaceId: scope.workspaceId,
    indexSnapshotId: scope.indexSnapshotId,
    permissions: [{ fingerprint: scope.permissionFingerprint, version: scope.permissionVersion }],
    audiences: ["PUBLIC"],
    classifications: ["PUBLIC"],
    locales: ["en"],
    locationIds: ["location-1"],
    segmentIds: ["segment-1"],
    denseVector: [1, 0, 0],
    sparseVector: { indices: [1, 9], values: [0.4, 0.9] },
    candidateLimit: 10,
    limit: 5,
  });
  check(query.length === 2, "scope filter did not preserve global and authorized points");
  check(
    !query.some((result) => result.payload.chunk_id === "chunk-3"),
    "location scope leaked an unauthorized point",
  );
  check(
    !query.some((result) => result.payload.chunk_id === "chunk-4"),
    "segment scope leaked an unauthorized point",
  );
  const queryRequest = [...fake.requests]
    .reverse()
    .find((request) => request.path.endsWith("/points/query"));
  const prefetch = values(queryRequest?.body?.prefetch);
  check(prefetch.length === 2, "hybrid query did not issue two prefetches");
  check(
    object(prefetch[0])?.using === "content_dense" &&
      object(prefetch[1])?.using === "content_sparse",
    "hybrid query used the wrong named vectors",
  );
  check(
    JSON.stringify(object(prefetch[0])?.filter) === JSON.stringify(queryRequest?.body?.filter) &&
      JSON.stringify(object(prefetch[1])?.filter) === JSON.stringify(queryRequest?.body?.filter),
    "authorization filter was not applied to every hybrid stage",
  );
  check(
    JSON.stringify(queryRequest?.body?.filter).includes("segment_scope"),
    "mandatory pre-retrieval filter omitted segment scope",
  );
  check(
    object(queryRequest?.body?.query)?.fusion === "rrf",
    "Qdrant 1.15 RRF wire shape is incorrect",
  );

  const rogue = await client.upsertSnapshotPoints({
    scope,
    points: [
      {
        ...inputPoints[0]!,
        chunkId: "rogue",
        contentHash: "d".repeat(64),
      },
    ],
  });
  const rogueId = rogue.points[0]!.id;
  const reconciled = await client.reconcilePermissionPartition({
    scope,
    expected: first.points,
    deleteUnexpected: true,
  });
  check(
    reconciled.unexpectedPointIds.join() === rogueId &&
      reconciled.deletedUnexpectedPointIds.join() === rogueId &&
      reconciled.consistent,
    "reconcile did not remove the unexpected point",
  );
  fake.points.delete(first.points[0]!.id);
  const missing = await client.reconcilePermissionPartition({ scope, expected: first.points });
  check(
    missing.missingPointIds.join() === first.points[0]!.id && !missing.consistent,
    "reconcile did not report the missing point",
  );
  const repaired = await client.upsertSnapshotPoints({ scope, points: inputPoints });
  check(repaired.upserted === 1 && repaired.unchanged === 3, "idempotent repair failed");

  const conflictPoint = fake.points.get(first.points[0]!.id)!;
  const originalFingerprint = conflictPoint.payload.point_fingerprint;
  conflictPoint.payload.point_fingerprint = "e".repeat(64);
  await expectCode(
    client.upsertSnapshotPoints({ scope, points: [inputPoints[0]!] }),
    "IMMUTABLE_POINT_CONFLICT",
  );
  conflictPoint.payload.point_fingerprint = originalFingerprint.toUpperCase();
  await expectCode(
    client.reconcilePermissionPartition({ scope, expected: first.points }),
    "IMMUTABLE_POINT_CONFLICT",
  );
  conflictPoint.payload.point_fingerprint = originalFingerprint;
  const corruptedDense = conflictPoint.vector.content_dense as number[];
  const originalDenseValue = corruptedDense[1]!;
  corruptedDense[1] = 0.5;
  await expectCode(
    client.reconcilePermissionPartition({ scope, expected: first.points }),
    "IMMUTABLE_POINT_CONFLICT",
  );
  corruptedDense[1] = originalDenseValue;

  fake.deleteNoOp = true;
  await expectCode(
    client.deletePointIds({ scope, pointIds: [first.points[0]!.id] }),
    "RECONCILIATION_FAILED",
  );
  fake.deleteNoOp = false;
  check(fake.points.has(first.points[0]!.id), "acknowledged delete no-op was treated as complete");

  const alternateScope = { ...scope, permissionFingerprint: "d".repeat(64) };
  await client.upsertSnapshotPoints({
    scope: alternateScope,
    points: [point("alternate-permission", [0.2, 0.3, 0.5])],
  });
  await client.deleteSnapshotPartition({
    workspaceId: scope.workspaceId,
    indexSnapshotId: scope.indexSnapshotId,
  });
  check(
    (await client.countPermissionPartition(scope)) === 0 &&
      (await client.countPermissionPartition(alternateScope)) === 0,
    "snapshot cleanup left an unknown permission partition behind",
  );

  const deleted = await client.deletePointIds({
    scope,
    pointIds: first.points.map((item) => item.id),
  });
  check(deleted.deleted === 4 && deleted.batches === 2, "bounded delete failed");
  await client.deletePointIds({
    scope,
    pointIds: first.points.map((item) => item.id),
  });
  check((await client.countPermissionPartition(scope)) === 0, "delete was not idempotent");
  const deleteRequest = [...fake.requests]
    .reverse()
    .find((request) => request.path.includes("/points/delete"));
  const deleteFilter = object(deleteRequest?.body?.filter);
  const deleteConditions = values(deleteFilter?.must);
  check(
    deleteConditions.some((value) => Array.isArray(object(value)?.has_id)),
    "batch delete omitted the point-ID condition",
  );
  check(
    deleteConditions.filter((value) => typeof object(value)?.key === "string").length === 4,
    "batch delete omitted a mandatory partition filter",
  );

  const rejectedClient = new KnowledgeV2HybridQdrantClient(
    { ...config, maxAttempts: 1 },
    {
      fetchImpl: async () =>
        jsonResponse({ error: "https://private-host/?api_key=dependency_secret" }, 500),
    },
  );
  const safeError = await expectCode(
    rejectedClient.countPermissionPartition(scope),
    "DEPENDENCY_UNAVAILABLE",
  );
  check(
    !safeError.message.includes("private-host") &&
      !safeError.message.includes("api_key") &&
      !safeError.message.includes(config.qdrantApiKey!),
    "dependency error leaked response or configuration data",
  );

  const timeoutClient = new KnowledgeV2HybridQdrantClient(
    { ...config, requestTimeoutMs: 100, maxAttempts: 1 },
    {
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    },
  );
  const timeoutError = await expectCode(
    timeoutClient.countPermissionPartition(scope),
    "REQUEST_TIMEOUT",
  );
  check(timeoutError.retryable, "timeout was not classified as retryable");

  console.log(
    JSON.stringify({
      ok: true,
      checks,
      protocol: "qdrant-v1.15",
      physicalCollectionName: physicalName,
      scenarios: [
        "provider-contracts",
        "immutable-collection-schema",
        "named-dense-sparse-vectors",
        "minimal-payload",
        "bounded-idempotent-upsert",
        "mandatory-partition-filters",
        "hybrid-rrf-query",
        "scope-isolation",
        "reconcile-delete-repair",
        "immutable-point-conflict",
        "stored-vector-corruption",
        "acknowledged-delete-no-op",
        "snapshot-wide-orphan-cleanup",
        "bounded-idempotent-delete",
        "retry",
        "safe-error",
        "timeout",
      ],
    }),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
