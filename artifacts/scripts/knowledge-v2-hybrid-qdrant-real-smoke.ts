import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  KnowledgeV2HybridQdrantClient,
  type KnowledgeV2HybridPointInput,
  type KnowledgeV2HybridQdrantConfig,
  type KnowledgeV2IndexPermissionPartition,
} from "@leadvirt/knowledge";

const qdrantUrl = process.env.RAG_QDRANT_URL ?? "http://localhost:6333";
const fingerprint = createHash("sha256").update("leadvirt-real-qdrant-smoke").digest("hex");
const runId = randomUUID();

const config: KnowledgeV2HybridQdrantConfig = {
  qdrantUrl,
  ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
  collectionPrefix: "leadvirt_knowledge_v2_real_smoke",
  dense: {
    vectorName: "content_dense",
    schemaVersion: "real-smoke-dense-v1",
    provider: "leadvirt-test",
    model: "multilingual-dense-fixture-v1",
    dimensions: 4,
    distance: "Cosine",
  },
  sparse: {
    vectorName: "content_sparse",
    schemaVersion: "real-smoke-sparse-v1",
    provider: "leadvirt-test",
    model: "multilingual-sparse-fixture-v1",
    maxNonZeroValues: 32,
  },
  requestTimeoutMs: 5_000,
  maxAttempts: 3,
  retryBaseDelayMs: 50,
  maxBatchSize: 16,
  maxReconcilePoints: 100,
};

const scope: KnowledgeV2IndexPermissionPartition = {
  workspaceId: `workspace-${runId}`,
  indexSnapshotId: `snapshot-${runId}`,
  permissionFingerprint: fingerprint,
  permissionVersion: 7,
};

function point(
  suffix: string,
  classification: KnowledgeV2HybridPointInput["classification"],
  audiences: KnowledgeV2HybridPointInput["audiences"],
  denseVector: readonly number[],
  sparseIndex: number,
  segmentIds?: readonly string[],
): KnowledgeV2HybridPointInput {
  return {
    documentId: `document-${suffix}`,
    revisionId: `revision-${suffix}`,
    chunkId: `chunk-${suffix}`,
    locale: "en",
    audiences,
    classification,
    ...(segmentIds ? { segmentIds } : {}),
    sourceKind: "WEBSITE",
    documentKind: "WEBSITE_PAGE",
    contentHash: createHash("sha256").update(`content-${suffix}`).digest("hex"),
    pipelineVersion: "real-qdrant-smoke-v1",
    denseVector,
    sparseVector: { indices: [sparseIndex], values: [1] },
  };
}

async function main() {
  const client = new KnowledgeV2HybridQdrantClient(config);
  const points = [
    point("public", "PUBLIC", ["PUBLIC"], [1, 0, 0, 0], 11, ["customer-a"]),
    point("other-segment", "PUBLIC", ["PUBLIC"], [0.9, 0.1, 0, 0], 12, ["customer-b"]),
    point("internal", "INTERNAL", ["INTERNAL"], [0, 1, 0, 0], 22),
  ];
  const expected = points.map((item) => client.preparePoint(scope, item));
  let partitionTouched = false;

  try {
    const collection = await client.ensurePhysicalCollection();
    assert.equal(collection.physicalCollectionName, client.physicalCollectionName);

    partitionTouched = true;
    const prepared = await client.upsertSnapshotPoints({ scope, points });
    assert.equal(prepared.requested, 3);
    assert.equal(await client.countPermissionPartition(scope), 3);
    const replayed = await client.upsertSnapshotPoints({ scope, points });
    assert.equal(replayed.upserted, 0);
    assert.equal(replayed.unchanged, 3);

    const reconciliation = await client.reconcilePermissionPartition({
      scope,
      expected,
    });
    assert.equal(reconciliation.consistent, true);
    assert.equal(reconciliation.observedCount, 3);

    const results = await client.queryHybrid({
      workspaceId: scope.workspaceId,
      indexSnapshotId: scope.indexSnapshotId,
      permissions: [{ fingerprint: scope.permissionFingerprint, version: scope.permissionVersion }],
      audiences: ["PUBLIC"],
      classifications: ["PUBLIC"],
      locales: ["en"],
      segmentIds: ["customer-a"],
      denseVector: [1, 0, 0, 0],
      sparseVector: { indices: [11], values: [1] },
      candidateLimit: 10,
      limit: 5,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.payload.classification, "PUBLIC");
    assert.equal(results[0]?.payload.chunk_id, "chunk-public");

    console.log(
      JSON.stringify({
        ok: true,
        qdrantUrl,
        collection: client.physicalCollectionName,
        upserted: prepared.upserted,
        replayUnchanged: replayed.unchanged,
        queried: results.length,
      }),
    );
  } finally {
    if (partitionTouched) {
      await client.deleteSnapshotPartition({
        workspaceId: scope.workspaceId,
        indexSnapshotId: scope.indexSnapshotId,
      });
      assert.equal(await client.countPermissionPartition(scope), 0);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
