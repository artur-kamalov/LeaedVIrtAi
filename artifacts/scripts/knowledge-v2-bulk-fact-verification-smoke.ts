import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import {
  knowledgeV2FactReadinessLabel,
  knowledgeV2ReadinessRemediation,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

const prisma = new PrismaService();

function context(
  tenant: RequestContext["tenant"],
  user: RequestContext["user"],
  role: RequestContext["role"],
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "credentials",
    tenant,
    user,
  };
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : null;
}

async function expectError(action: Promise<unknown>, status: number, code: string) {
  try {
    await action;
  } catch (error) {
    assert(error instanceof HttpException);
    assert.equal(error.getStatus(), status);
    assert.equal(errorCode(error), code);
    return;
  }
  assert.fail(`Expected ${status} ${code}.`);
}

async function cleanup(tenantId: string | null, userIds: string[]) {
  if (!tenantId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const tables = [
      "KnowledgeInbox",
      "KnowledgeJobAttempt",
      "KnowledgeOutbox",
      "KnowledgeJob",
      "KnowledgeV2IdempotencyRecord",
      "KnowledgeV2Evidence",
      "KnowledgeV2FactVersion",
      "KnowledgeV2Fact",
      "KnowledgeV2Settings",
      "AuditLog",
      "Membership",
    ];
    for (const table of tables) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
    }
    await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    for (const userId of userIds) {
      await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', userId);
    }
  });
}

async function main() {
  let tenantId: string | null = null;
  const userIds: string[] = [];
  try {
    await prisma.$connect();
    const stamp = randomUUID();
    const tenant = await prisma.tenant.create({
      data: { name: "Bulk fact verification smoke", slug: `bulk-fact-${stamp}` },
    });
    tenantId = tenant.id;
    const [ownerUser, managerUser] = await Promise.all([
      prisma.user.create({
        data: { email: `bulk-fact-owner-${stamp}@example.test`, name: "Owner" },
      }),
      prisma.user.create({
        data: { email: `bulk-fact-manager-${stamp}@example.test`, name: "Manager" },
      }),
    ]);
    userIds.push(ownerUser.id, managerUser.id);
    await prisma.membership.createMany({
      data: [
        { tenantId, userId: ownerUser.id, role: "OWNER" },
        { tenantId, userId: managerUser.id, role: "MANAGER" },
      ],
    });
    const owner = context(tenant, ownerUser, "OWNER");
    const manager = context(tenant, managerUser, "MANAGER");
    const knowledge = new KnowledgeV2Service(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
    );
    let sequence = 0;
    const createServiceFact = async (
      label: string,
      effectiveUntil: string | null = null,
    ) => {
      sequence += 1;
      return knowledge.createFact(
        owner,
        {
          factKey: `bulk-fact/service-${sequence}-${stamp}`,
          entityType: "BUSINESS_OFFERING",
          fieldType: "OFFERING",
          normalizedValue: {
            name: label,
            prices: [{ amount: "1000", currency: "RUB" }],
          },
          displayValue: label,
          locale: "en",
          localeBehavior: "LOCALE_SPECIFIC",
          scope: { audiences: ["PUBLIC"], locales: ["en"] },
          effectiveUntil,
          riskLevel: "HIGH",
          authority: "MANUAL",
        },
        `create-${sequence}-${stamp}`,
      );
    };

    const [missingExpiry, longExpiry] = await Promise.all([
      createServiceFact("Heating installation"),
      createServiceFact("Boiler service", "2028-01-01T00:00:00.000Z"),
    ]);
    const beforeVerification = Date.now();
    const request = {
      items: [
        { id: missingExpiry.resource.id, etag: missingExpiry.resource.etag },
        { id: longExpiry.resource.id, etag: longExpiry.resource.etag },
      ],
      note: "Prices checked by the owner",
    };
    const verified = await knowledge.bulkVerifyFacts(
      owner,
      request,
      `verify-${stamp}`,
    );
    const afterVerification = Date.now();
    assert.equal(verified.resource.verifiedCount, 2);
    assert.equal(verified.idempotencyReplayed, false);
    for (const item of verified.resource.items) {
      const expiry = Date.parse(item.effectiveUntil);
      assert(expiry >= beforeVerification + 90 * 24 * 60 * 60_000);
      assert(expiry <= afterVerification + 90 * 24 * 60 * 60_000);
      assert.equal(item.authority, "OWNER_VERIFIED");
      assert.equal(item.verificationStatus, "VERIFIED");
    }
    const replay = await knowledge.bulkVerifyFacts(owner, request, `verify-${stamp}`);
    assert.equal(replay.idempotencyReplayed, true);
    assert.deepEqual(replay.resource, verified.resource);

    const latestVersions = await prisma.knowledgeV2FactVersion.findMany({
      where: {
        tenantId,
        factId: { in: [missingExpiry.resource.id, longExpiry.resource.id] },
        verificationStatus: "VERIFIED",
      },
      include: { evidence: true },
    });
    assert.equal(latestVersions.length, 2);
    assert(
      latestVersions.every(
        (version) =>
          version.authority === "OWNER_VERIFIED" &&
          version.evidence.some((item) => item.label === "Workspace owner verification"),
      ),
    );

    const managerFact = await createServiceFact("Manager-only attempt");
    await expectError(
      knowledge.bulkVerifyFacts(
        manager,
        { items: [{ id: managerFact.resource.id, etag: managerFact.resource.etag }] },
        `manager-${stamp}`,
      ),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );
    assert.equal(
      (
        await prisma.knowledgeV2Fact.findUniqueOrThrow({
          where: { id: managerFact.resource.id },
        })
      ).latestVersionNumber,
      1,
    );

    const staleFact = await createServiceFact("Stale selection");
    const untouchedFact = await createServiceFact("Atomic companion");
    await knowledge.updateFact(
      owner,
      staleFact.resource.id,
      { displayValue: "Stale selection updated" },
      `update-${stamp}`,
      [staleFact.resource.etag],
    );
    await expectError(
      knowledge.bulkVerifyFacts(
        owner,
        {
          items: [
            { id: staleFact.resource.id, etag: staleFact.resource.etag },
            { id: untouchedFact.resource.id, etag: untouchedFact.resource.etag },
          ],
        },
        `stale-${stamp}`,
      ),
      412,
      "REVISION_CONFLICT",
    );
    assert.equal(
      (
        await prisma.knowledgeV2Fact.findUniqueOrThrow({
          where: { id: untouchedFact.resource.id },
        })
      ).latestVersionNumber,
      1,
    );

    const remediation = knowledgeV2ReadinessRemediation(
      "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED",
      { type: "FACT", id: missingExpiry.resource.id, label: "Heating installation" },
    );
    assert.deepEqual(remediation.destination, {
      view: "business",
      task: "verify-services",
      resource: {
        type: "FACT",
        id: missingExpiry.resource.id,
        label: "Heating installation",
      },
    });
    assert.deepEqual(
      knowledgeV2ReadinessRemediation(
        "KNOWLEDGE_DEPENDENCY_DOCUMENT_INDEX_INPUT_INVALID",
        { type: "DOCUMENT", id: "document-1", label: "Price list" },
        {
          sourceId: "source-1",
          documentId: "document-1",
          revisionId: "revision-1",
        },
      ).destination,
      {
        view: "sources",
        task: null,
        resource: { type: "DOCUMENT", id: "document-1", label: "Price list" },
        sourceId: "source-1",
        documentId: "document-1",
        revisionId: "revision-1",
      },
    );
    assert.equal(
      knowledgeV2FactReadinessLabel("business-information:offering:opaque-id", " Boiler service "),
      "Boiler service",
    );

    console.log("knowledge v2 bulk fact verification smoke passed");
  } finally {
    await cleanup(tenantId, userIds);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
