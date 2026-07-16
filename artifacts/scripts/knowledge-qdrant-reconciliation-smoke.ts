import { prisma } from "@leadvirt/db";
import { loadEnvFile } from "@leadvirt/config";
import {
  LegacyKnowledgePublisher,
  legacyEmbeddingDimensions,
  type KnowledgeRuntimeConfig,
  type QdrantPoint,
} from "@leadvirt/knowledge";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function filterValue(body: Record<string, unknown>, key: string) {
  const filter = body.filter as
    | { must?: Array<{ key?: string; match?: { value?: string } }> }
    | undefined;
  return filter?.must?.find((item) => item.key === key)?.match?.value;
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const collection = `knowledge_reconcile_${suffix.replaceAll("-", "_")}`;
  const points = new Map<string, QdrantPoint>();
  let collectionReady = false;
  let deleteRequests = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === "GET" && url.pathname === `/collections/${collection}`) {
      return collectionReady
        ? response({
            result: {
              config: {
                params: { vectors: { size: legacyEmbeddingDimensions, distance: "Cosine" } },
              },
            },
          })
        : response({}, 404);
    }
    if (method === "PUT" && url.pathname === `/collections/${collection}`) {
      collectionReady = true;
      return response({ result: true });
    }
    if (method === "PUT" && url.pathname.endsWith("/index")) return response({ result: true });
    if (method === "PUT" && url.pathname.endsWith("/points")) {
      for (const point of (body.points ?? []) as QdrantPoint[]) points.set(String(point.id), point);
      return response({ result: { status: "completed" } });
    }
    if (method === "POST" && url.pathname.endsWith("/points/count")) {
      const tenantId = filterValue(body, "tenantId");
      const indexSnapshotId = filterValue(body, "indexSnapshotId");
      const count = Array.from(points.values()).filter(
        (point) =>
          point.payload.tenantId === tenantId && point.payload.indexSnapshotId === indexSnapshotId,
      ).length;
      return response({ result: { count } });
    }
    if (method === "POST" && url.pathname.endsWith("/points/scroll")) {
      const tenantId = filterValue(body, "tenantId");
      return response({
        result: {
          points: Array.from(points.values())
            .filter((point) => point.payload.tenantId === tenantId)
            .map((point) => ({ id: point.id, payload: point.payload })),
          next_page_offset: null,
        },
      });
    }
    if (method === "POST" && url.pathname.endsWith("/points/delete")) {
      deleteRequests += 1;
      for (const pointId of (body.points ?? []) as string[]) points.delete(String(pointId));
      return response({ result: { status: "completed" } });
    }
    return response({ error: `Unhandled ${method} ${url.pathname}` }, 500);
  };
  const config: KnowledgeRuntimeConfig = {
    mode: "qdrant",
    qdrantUrl: "http://qdrant.test",
    qdrantCollection: collection,
    qdrantTimeoutMs: 1000,
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace",
  };
  let tenantId = "";
  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Qdrant Reconciliation Smoke", slug: `qdrant-reconcile-${suffix}` },
    });
    tenantId = tenant.id;
    const source = await prisma.businessKnowledgeSource.create({
      data: {
        tenantId,
        type: "FAQ",
        source: "manual",
        sourceKey: `reconcile:${suffix}`,
        title: "Reconciliation source",
        content: "markerone service costs 101 EUR.",
      },
    });
    const publisher = new LegacyKnowledgePublisher(prisma, config, fetchImpl);
    await publisher.publish({ tenantId, reason: "qdrant_reconciliation_first" });
    const firstPointIds = new Set(points.keys());
    assert(firstPointIds.size > 0, "First Qdrant snapshot has no points.");

    points.set("00000000-0000-4000-8000-000000000001", {
      id: "00000000-0000-4000-8000-000000000001",
      vector: Array.from({ length: legacyEmbeddingDimensions }, () => 0),
      payload: { tenantId, indexSnapshotId: "orphan", sourceId: source.id },
    });
    await prisma.businessKnowledgeSource.update({
      where: { id: source.id },
      data: { content: "markertwo service costs 202 EUR.", version: { increment: 1 } },
    });
    await publisher.publish({ tenantId, reason: "qdrant_reconciliation_edit" });
    assert(
      !points.has("00000000-0000-4000-8000-000000000001"),
      "Orphan Qdrant point was retained.",
    );
    assert(
      Array.from(firstPointIds).every((pointId) => points.has(pointId)),
      "A retained superseded publication lost its Qdrant points.",
    );

    await prisma.businessKnowledgeSource.update({
      where: { id: source.id },
      data: { status: "ARCHIVED", deletedAt: new Date(), version: { increment: 1 } },
    });
    await publisher.publish({ tenantId, reason: "qdrant_reconciliation_archive" });
    assert(points.size === 0, `Archived source left ${points.size} Qdrant points.`);
    assert(deleteRequests >= 2, "Qdrant cleanup did not issue orphan and archive deletions.");

    console.log(
      JSON.stringify({
        ok: true,
        orphanDeleted: true,
        retainedSnapshotsPreserved: true,
        archiveDeleted: true,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.activeKnowledgePublication.deleteMany({ where: { tenantId } });
      await prisma.knowledgePublication.deleteMany({ where: { tenantId } });
      await prisma.knowledgeIndexSnapshot.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
