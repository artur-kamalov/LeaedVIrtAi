import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  KnowledgeRetriever,
  LegacyKnowledgePublisher,
  type KnowledgeRuntimeConfig
} from "@leadvirt/knowledge";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createKnowledge(tenantId: string, sourceKey: string, title: string, content: string) {
  return prisma.businessKnowledgeSource.create({
    data: {
      tenantId,
      type: "CATALOG",
      status: "ACTIVE",
      source: "isolation-smoke",
      sourceKey,
      title,
      content
    }
  });
}

async function assertTenantSearch(
  retriever: KnowledgeRetriever,
  tenantId: string,
  query: string,
  expectedMarker: string,
  forbiddenMarker: string
) {
  const result = await retriever.retrieve({ tenantId, query, limit: 10 });
  assert(result.status === "grounded", `Expected grounded results for ${expectedMarker}.`);
  assert(result.evidence.some((item) => item.content.includes(expectedMarker)), `Expected result marker ${expectedMarker}.`);
  assert(!result.evidence.some((item) => item.content.includes(forbiddenMarker)), `Search leaked forbidden marker ${forbiddenMarker}.`);
  return result.evidence.length;
}

async function assertNoForeignMarker(
  retriever: KnowledgeRetriever,
  tenantId: string,
  query: string,
  forbiddenMarker: string
) {
  const result = await retriever.retrieve({ tenantId, query, limit: 10 });
  if (result.status === "grounded") {
    assert(!result.evidence.some((item) => item.content.includes(forbiddenMarker)), `Search leaked forbidden marker ${forbiddenMarker}.`);
    return result.evidence.length;
  }
  assert(result.status === "insufficient_grounding", "Foreign-only query should be a safe no-match.");
  return 0;
}

async function cleanupTenant(tenantId: string) {
  await prisma.activeKnowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.knowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.knowledgeIndexSnapshot.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const config: KnowledgeRuntimeConfig = {
    mode: "database",
    qdrantUrl: "http://localhost:6333",
    qdrantCollection: "leadvirt_knowledge",
    qdrantTimeoutMs: 1000,
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace"
  };
  const publisher = new LegacyKnowledgePublisher(prisma, config);
  const retriever = new KnowledgeRetriever(prisma, config);

  try {
    const [alphaTenant, betaTenant] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: "AI Isolation Alpha",
          slug: `ai-isolation-alpha-${suffix}`,
          businessType: "salon",
          timezone: "Europe/Moscow"
        }
      }),
      prisma.tenant.create({
        data: {
          name: "AI Isolation Beta",
          slug: `ai-isolation-beta-${suffix}`,
          businessType: "detailing",
          timezone: "Europe/Moscow"
        }
      })
    ]);
    tenantIds.push(alphaTenant.id, betaTenant.id);

    const alphaMarker = `alphaisolationprice777${suffix.replaceAll("-", "")}`;
    const betaMarker = `betaisolationprice111${suffix.replaceAll("-", "")}`;
    await Promise.all([
      createKnowledge(alphaTenant.id, `isolation:${suffix}:catalog`, "Alpha catalog", `${alphaMarker} laser cleanup service costs 777 RUB.`),
      createKnowledge(betaTenant.id, `isolation:${suffix}:catalog`, "Beta catalog", `${betaMarker} ceramic detailing service costs 111 RUB.`)
    ]);
    await Promise.all([
      publisher.publish({ tenantId: alphaTenant.id, reason: "tenant_isolation_smoke" }),
      publisher.publish({ tenantId: betaTenant.id, reason: "tenant_isolation_smoke" })
    ]);

    const alphaHits = await assertTenantSearch(retriever, alphaTenant.id, `${alphaMarker} price`, alphaMarker, betaMarker);
    const betaHits = await assertTenantSearch(retriever, betaTenant.id, `${betaMarker} price`, betaMarker, alphaMarker);
    const alphaForeignHits = await assertNoForeignMarker(retriever, alphaTenant.id, `${betaMarker} price`, betaMarker);
    const betaForeignHits = await assertNoForeignMarker(retriever, betaTenant.id, `${alphaMarker} price`, alphaMarker);

    console.log(JSON.stringify({
      ok: true,
      alphaTenantId: alphaTenant.id,
      betaTenantId: betaTenant.id,
      alphaHits,
      betaHits,
      alphaForeignHits,
      betaForeignHits
    }));
  } finally {
    for (const tenantId of tenantIds) await cleanupTenant(tenantId);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
