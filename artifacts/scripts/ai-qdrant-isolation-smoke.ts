import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  KnowledgeRetriever,
  LegacyKnowledgePublisher,
  type KnowledgeRuntimeConfig,
} from "@leadvirt/knowledge";

loadEnvFile();

const suffix = `${Date.now()}_${randomUUID().slice(0, 8).replace(/-/g, "_")}`;
const collectionName = `leadvirt_isolation_${suffix}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createSource(tenantId: string, sourceKey: string, title: string, content: string) {
  return prisma.businessKnowledgeSource.create({
    data: {
      tenantId,
      type: "CATALOG",
      status: "ACTIVE",
      source: "qdrant-isolation-smoke",
      sourceKey,
      title,
      content,
    },
  });
}

async function deleteQdrantCollection(config: KnowledgeRuntimeConfig) {
  const response = await fetch(
    `${config.qdrantUrl.replace(/\/+$/, "")}/collections/${collectionName}`,
    {
      method: "DELETE",
      headers: config.qdrantApiKey ? { "api-key": config.qdrantApiKey } : {},
    },
  ).catch(() => null);
  if (response && !response.ok && response.status !== 404) {
    throw new Error(`Qdrant collection cleanup failed with HTTP ${response.status}`);
  }
}

async function cleanupTenant(tenantId: string) {
  await prisma.activeKnowledgePublication
    .deleteMany({ where: { tenantId } })
    .catch(() => undefined);
  await prisma.knowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.knowledgeIndexSnapshot.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}

async function assertTenantSearch(
  retriever: KnowledgeRetriever,
  tenantId: string,
  query: string,
  expectedMarker: string,
  forbiddenMarker: string,
) {
  const result = await retriever.retrieve({ tenantId, query, limit: 10 });
  assert(result.status === "grounded", `Expected Qdrant results for ${expectedMarker}.`);
  assert(
    result.evidence.some((item) => item.content.includes(expectedMarker)),
    `Expected Qdrant marker ${expectedMarker}.`,
  );
  assert(
    !result.evidence.some((item) => item.content.includes(forbiddenMarker)),
    `Qdrant leaked forbidden marker ${forbiddenMarker}.`,
  );
  return result.evidence.length;
}

async function assertNoForeignMarker(
  retriever: KnowledgeRetriever,
  tenantId: string,
  query: string,
  forbiddenMarker: string,
) {
  const result = await retriever.retrieve({ tenantId, query, limit: 10 });
  if (result.status === "grounded") {
    assert(
      !result.evidence.some((item) => item.content.includes(forbiddenMarker)),
      `Qdrant leaked forbidden marker ${forbiddenMarker}.`,
    );
    return result.evidence.length;
  }
  assert(
    result.status === "insufficient_grounding",
    "Foreign-only Qdrant query should be a safe no-match.",
  );
  return 0;
}

async function main() {
  const tenantIds: string[] = [];
  const config: KnowledgeRuntimeConfig = {
    mode: "qdrant",
    qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
    ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
    qdrantCollection: collectionName,
    qdrantTimeoutMs: Number(process.env.RAG_QDRANT_TIMEOUT_MS ?? "3000"),
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace",
  };
  const publisher = new LegacyKnowledgePublisher(prisma, config);
  const retriever = new KnowledgeRetriever(prisma, config);

  try {
    const [alphaTenant, betaTenant] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: "Qdrant Isolation Alpha",
          slug: `qdrant-alpha-${suffix}`,
          businessType: "salon",
        },
      }),
      prisma.tenant.create({
        data: {
          name: "Qdrant Isolation Beta",
          slug: `qdrant-beta-${suffix}`,
          businessType: "detailing",
        },
      }),
    ]);
    tenantIds.push(alphaTenant.id, betaTenant.id);

    const alphaMarker = `qdrantalpha777${suffix}`;
    const betaMarker = `qdrantbeta111${suffix}`;
    await Promise.all([
      createSource(
        alphaTenant.id,
        `qdrant:${suffix}:alpha`,
        "Qdrant alpha catalog",
        `${alphaMarker} laser cleanup service costs 777 RUB.`,
      ),
      createSource(
        betaTenant.id,
        `qdrant:${suffix}:beta`,
        "Qdrant beta catalog",
        `${betaMarker} ceramic detailing service costs 111 RUB.`,
      ),
    ]);
    const publicationResults = await Promise.allSettled([
      publisher.publish({ tenantId: alphaTenant.id, reason: "qdrant_isolation_smoke" }),
      publisher.publish({ tenantId: betaTenant.id, reason: "qdrant_isolation_smoke" }),
    ]);
    const [alphaResult, betaResult] = publicationResults;
    if (!alphaResult || !betaResult) throw new Error("Qdrant publication results are incomplete.");
    if (alphaResult.status === "rejected") throw alphaResult.reason;
    if (betaResult.status === "rejected") throw betaResult.reason;
    const alphaPublication = alphaResult.value;
    const betaPublication = betaResult.value;

    const alphaHits = await assertTenantSearch(
      retriever,
      alphaTenant.id,
      `${alphaMarker} price`,
      alphaMarker,
      betaMarker,
    );
    const betaHits = await assertTenantSearch(
      retriever,
      betaTenant.id,
      `${betaMarker} price`,
      betaMarker,
      alphaMarker,
    );
    const alphaForeignHits = await assertNoForeignMarker(
      retriever,
      alphaTenant.id,
      `${betaMarker} price`,
      betaMarker,
    );
    const betaForeignHits = await assertNoForeignMarker(
      retriever,
      betaTenant.id,
      `${alphaMarker} price`,
      alphaMarker,
    );

    console.log(
      JSON.stringify({
        ok: true,
        collection: collectionName,
        alphaPublicationId: alphaPublication.publicationId,
        betaPublicationId: betaPublication.publicationId,
        alphaHits,
        betaHits,
        alphaForeignHits,
        betaForeignHits,
      }),
    );
  } finally {
    for (const tenantId of tenantIds) await cleanupTenant(tenantId);
    await deleteQdrantCollection(config).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
