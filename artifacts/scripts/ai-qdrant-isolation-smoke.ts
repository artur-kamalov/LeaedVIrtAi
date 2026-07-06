import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { Tenant, User } from "@leadvirt/db";
import { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";

loadEnvFile();

const suffix = `${Date.now()}_${randomUUID().slice(0, 8).replace(/-/g, "_")}`;
const collectionName = `leadvirt_isolation_${suffix}`;
process.env.RAG_QDRANT_ENABLED = "true";
process.env.RAG_QDRANT_COLLECTION = collectionName;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFor(tenant: Pick<Tenant, "id" | "name" | "slug" | "status" | "businessType" | "timezone">, user: Pick<User, "id" | "email" | "phone" | "name" | "avatarUrl" | "passwordChangeRequired">): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role: "OWNER",
    authMode: "credentials",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      businessType: tenant.businessType,
      timezone: tenant.timezone
    },
    user
  };
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
      content
    }
  });
}

async function deleteQdrantCollection(config: AppConfigService) {
  const response = await fetch(`${config.ragQdrantUrl.replace(/\/+$/, "")}/collections/${collectionName}`, {
    method: "DELETE",
    headers: {
      ...(config.ragQdrantApiKey ? { "api-key": config.ragQdrantApiKey } : {})
    }
  }).catch(() => null);

  if (response && !response.ok && response.status !== 404) {
    throw new Error(`Qdrant collection cleanup failed with HTTP ${response.status}`);
  }
}

async function assertTenantSearch(service: KnowledgeService, context: RequestContext, query: string, expectedMarker: string, forbiddenMarker: string) {
  const results = await service.search(context, query, 10);
  assert(results.length > 0, `Expected Qdrant results for ${expectedMarker}.`);
  assert(results.every((result) => result.chunk.tenantId === context.tenantId), `Qdrant search leaked chunks outside tenant ${context.tenantId}.`);
  assert(results.some((result) => result.chunk.content.includes(expectedMarker)), `Expected Qdrant marker ${expectedMarker}.`);
  assert(!results.some((result) => result.chunk.content.includes(forbiddenMarker)), `Qdrant search leaked forbidden marker ${forbiddenMarker}.`);
  return results.length;
}

async function assertNoForeignMarker(service: KnowledgeService, context: RequestContext, query: string, forbiddenMarker: string) {
  const results = await service.search(context, query, 10);
  assert(results.every((result) => result.chunk.tenantId === context.tenantId), `Qdrant search leaked chunks outside tenant ${context.tenantId}.`);
  assert(!results.some((result) => result.chunk.content.includes(forbiddenMarker)), `Qdrant search leaked forbidden marker ${forbiddenMarker}.`);
  return results.length;
}

async function main() {
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const config = new AppConfigService();
  const service = new KnowledgeService(prisma as unknown as PrismaService, config);

  try {
    const [alphaTenant, betaTenant] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: "Qdrant Isolation Alpha",
          slug: `qdrant-isolation-alpha-${suffix}`,
          businessType: "salon",
          timezone: "Europe/Moscow"
        }
      }),
      prisma.tenant.create({
        data: {
          name: "Qdrant Isolation Beta",
          slug: `qdrant-isolation-beta-${suffix}`,
          businessType: "detailing",
          timezone: "Europe/Moscow"
        }
      })
    ]);
    tenantIds.push(alphaTenant.id, betaTenant.id);

    const [alphaUser, betaUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: `qdrant-isolation-alpha-${suffix}@leadvirt.ai`,
          name: "Qdrant Isolation Alpha"
        }
      }),
      prisma.user.create({
        data: {
          email: `qdrant-isolation-beta-${suffix}@leadvirt.ai`,
          name: "Qdrant Isolation Beta"
        }
      })
    ]);
    userIds.push(alphaUser.id, betaUser.id);
    await Promise.all([
      prisma.membership.create({ data: { tenantId: alphaTenant.id, userId: alphaUser.id, role: "OWNER" } }),
      prisma.membership.create({ data: { tenantId: betaTenant.id, userId: betaUser.id, role: "OWNER" } })
    ]);

    const alphaMarker = `qdrantalpha777_${suffix}`;
    const betaMarker = `qdrantbeta111_${suffix}`;
    await Promise.all([
      createSource(alphaTenant.id, `qdrant-isolation:${suffix}:catalog`, "Qdrant alpha catalog", `${alphaMarker} laser cleanup service costs 777 RUB.`),
      createSource(betaTenant.id, `qdrant-isolation:${suffix}:catalog`, "Qdrant beta catalog", `${betaMarker} ceramic detailing service costs 111 RUB.`)
    ]);

    const alphaContext = contextFor(alphaTenant, alphaUser);
    const betaContext = contextFor(betaTenant, betaUser);
    const alphaReindex = await service.reindex(alphaContext);
    const betaReindex = await service.reindex(betaContext);
    assert(alphaReindex.qdrant === true && alphaReindex.indexed > 0, "Expected alpha tenant chunks to be indexed in Qdrant.");
    assert(betaReindex.qdrant === true && betaReindex.indexed > 0, "Expected beta tenant chunks to be indexed in Qdrant.");

    const alphaHits = await assertTenantSearch(service, alphaContext, `${alphaMarker} price`, alphaMarker, betaMarker);
    const betaHits = await assertTenantSearch(service, betaContext, `${betaMarker} price`, betaMarker, alphaMarker);
    const alphaForeignHits = await assertNoForeignMarker(service, alphaContext, `${betaMarker} price`, betaMarker);
    const betaForeignHits = await assertNoForeignMarker(service, betaContext, `${alphaMarker} price`, alphaMarker);

    console.log(
      JSON.stringify({
        ok: true,
        collection: collectionName,
        alphaTenantId: alphaTenant.id,
        betaTenantId: betaTenant.id,
        alphaHits,
        betaHits,
        alphaForeignHits,
        betaForeignHits
      })
    );
  } finally {
    if (tenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await deleteQdrantCollection(config).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
