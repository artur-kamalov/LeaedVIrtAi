import { createHash, randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";

loadEnvFile();
process.env.RAG_QDRANT_ENABLED = "false";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function contextFor(tenant: { id: string; name: string; slug: string; status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELED"; businessType: string | null; timezone: string }): RequestContext {
  return {
    tenantId: tenant.id,
    userId: `isolation-user-${tenant.id}`,
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
    user: {
      id: `isolation-user-${tenant.id}`,
      email: `isolation-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "Isolation Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

async function createKnowledge(tenantId: string, sourceKey: string, title: string, content: string) {
  const source = await prisma.businessKnowledgeSource.create({
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

  await prisma.businessKnowledgeChunk.create({
    data: {
      tenantId,
      sourceId: source.id,
      sourceVersion: source.version,
      chunkIndex: 0,
      content,
      contentHash: hash(content),
      tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
      embeddedAt: new Date(),
      indexedAt: new Date()
    }
  });

  return source;
}

async function assertTenantSearch(service: KnowledgeService, context: RequestContext, query: string, expectedMarker: string, forbiddenMarker: string) {
  const results = await service.search(context, query, 10);
  assert(results.length > 0, `Expected results for ${expectedMarker}.`);
  assert(results.every((result) => result.chunk.tenantId === context.tenantId), `Search leaked chunks outside tenant ${context.tenantId}.`);
  assert(results.some((result) => result.chunk.content.includes(expectedMarker)), `Expected result marker ${expectedMarker}.`);
  assert(!results.some((result) => result.chunk.content.includes(forbiddenMarker)), `Search leaked forbidden marker ${forbiddenMarker}.`);
  return results.length;
}

async function assertNoForeignMarker(service: KnowledgeService, context: RequestContext, query: string, forbiddenMarker: string) {
  const results = await service.search(context, query, 10);
  assert(results.every((result) => result.chunk.tenantId === context.tenantId), `Search leaked chunks outside tenant ${context.tenantId}.`);
  assert(!results.some((result) => result.chunk.content.includes(forbiddenMarker)), `Search leaked forbidden marker ${forbiddenMarker}.`);
  return results.length;
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const service = new KnowledgeService(prisma as unknown as PrismaService, new AppConfigService());

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

    const alphaMarker = `alphaisolationprice777-${suffix}`;
    const betaMarker = `betaisolationprice111-${suffix}`;
    await Promise.all([
      createKnowledge(alphaTenant.id, `isolation:${suffix}:catalog`, "Alpha catalog", `${alphaMarker} laser cleanup service costs 777 RUB.`),
      createKnowledge(betaTenant.id, `isolation:${suffix}:catalog`, "Beta catalog", `${betaMarker} ceramic detailing service costs 111 RUB.`)
    ]);

    const alphaContext = contextFor(alphaTenant);
    const betaContext = contextFor(betaTenant);
    const alphaHits = await assertTenantSearch(service, alphaContext, `${alphaMarker} price`, alphaMarker, betaMarker);
    const betaHits = await assertTenantSearch(service, betaContext, `${betaMarker} price`, betaMarker, alphaMarker);
    const alphaForeignHits = await assertNoForeignMarker(service, alphaContext, `${betaMarker} price`, betaMarker);
    const betaForeignHits = await assertNoForeignMarker(service, betaContext, `${alphaMarker} price`, alphaMarker);

    console.log(
      JSON.stringify({
        ok: true,
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
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
