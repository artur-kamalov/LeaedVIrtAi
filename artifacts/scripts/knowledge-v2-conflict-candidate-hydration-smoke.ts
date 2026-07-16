import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
} from "@leadvirt/knowledge";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeSourceQueueService } from "../../apps/api/src/modules/knowledge/knowledge-source-queue.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "../../apps/api/src/modules/knowledge/knowledge-v2-conflict-candidate-reader.service.js";
import {
  strongKnowledgeV2Etag,
  canonicalKnowledgeV2Hash,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2ReviewDecisionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.js";
import { KnowledgeV2ReviewService } from "../../apps/api/src/modules/knowledge/knowledge-v2-review.service.js";
import { KnowledgeV2SourceService } from "../../apps/api/src/modules/knowledge/knowledge-v2-source.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks += 1;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

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

function code(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : null;
}

async function expectError(action: Promise<unknown>, status: number, expectedCode: string) {
  try {
    await action;
  } catch (error) {
    check(
      error instanceof HttpException && error.getStatus() === status,
      `Expected HTTP ${status}.`,
    );
    check(
      code(error) === expectedCode,
      `Expected ${expectedCode}, received ${String(code(error))}.`,
    );
    return;
  }
  throw new Error(`Expected ${status} ${expectedCode}.`);
}

function sourcePermissionFingerprint(input: {
  tenantId: string;
  sourceId: string;
  permissionVersion: number;
  scope: Prisma.InputJsonValue | null;
  classification: string;
  locale: string;
}) {
  return canonicalKnowledgeV2Hash({
    tenantId: input.tenantId,
    sourceId: input.sourceId,
    permissionVersion: input.permissionVersion,
    scope: input.scope,
    classification: input.classification,
    locale: input.locale,
  });
}

function encodeReference(input: { key: string; encryptionKeyRef: string }) {
  return `lvobj:v1:${Buffer.from(JSON.stringify({ version: 1, ...input }), "utf8").toString("base64url")}`;
}

async function cleanup(prisma: PrismaService, tenantIds: string[], userIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.knowledgeV2ReviewItemEvidence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2ConflictCandidateEvidence.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await tx.knowledgeV2ReviewItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2ConflictCandidate.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Conflict.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2FactVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Fact.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Chunk.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Element.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2DocumentRevision.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Document.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Artifact.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2DeletionLedger.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Source.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeInbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.runtimeOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeJobAttempt.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function main() {
  const prisma = new PrismaService();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const objectRoot = join(tmpdir(), `leadvirt-conflict-hydration-${stamp}`);
  const keyId = `conflict-hydration-${stamp}`;
  const keyValue = randomBytes(32).toString("base64");
  const config = {
    knowledgeObjectStorePath: objectRoot,
    knowledgeArtifactEncryptionKey: keyValue,
    knowledgeArtifactEncryptionKeyId: keyId,
  } as AppConfigService;
  const objectStore = new EncryptedFileKnowledgeObjectStore({
    rootPath: objectRoot,
    activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(keyValue) },
    maxPlaintextBytes: 32 * 1024,
  });
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  await prisma.$connect();
  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Conflict hydration", slug: `conflict-hydration-${stamp}` },
    });
    const otherTenant = await prisma.tenant.create({
      data: { name: "Conflict hydration other", slug: `conflict-hydration-other-${stamp}` },
    });
    tenantIds.push(tenant.id, otherTenant.id);
    const [ownerUser, managerUser, otherOwnerUser] = await Promise.all([
      prisma.user.create({
        data: { email: `conflict-owner-${stamp}@example.test`, name: "Owner" },
      }),
      prisma.user.create({
        data: { email: `conflict-manager-${stamp}@example.test`, name: "Manager" },
      }),
      prisma.user.create({
        data: { email: `conflict-other-${stamp}@example.test`, name: "Other" },
      }),
    ]);
    userIds.push(ownerUser.id, managerUser.id, otherOwnerUser.id);
    await prisma.membership.createMany({
      data: [
        { tenantId: tenant.id, userId: ownerUser.id, role: "OWNER" },
        { tenantId: tenant.id, userId: managerUser.id, role: "MANAGER" },
        { tenantId: otherTenant.id, userId: otherOwnerUser.id, role: "OWNER" },
      ],
    });
    const owner = context(tenant, ownerUser, "OWNER");
    const manager = context(tenant, managerUser, "MANAGER");
    const otherOwner = context(otherTenant, otherOwnerUser, "OWNER");
    const reader = new KnowledgeV2ConflictCandidateReaderService(prisma, config);
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const decisions = new KnowledgeV2ReviewDecisionService(
      prisma,
      new KnowledgeV2Service(prisma, idempotency),
      {} as KnowledgeV2SourceService,
      {} as KnowledgeSourceQueueService,
      reader,
    );
    decisions.dispatchSoon = () => undefined;
    const reviews = new KnowledgeV2ReviewService(prisma, idempotency, decisions, reader);

    let fixtureSequence = 0;
    const seedFixture = async (input: {
      label: string;
      secret?: string;
      expectedHash?: string;
      documentAudience?: Prisma.InputJsonValue;
      sourceScope?: Prisma.InputJsonValue;
      classification?: "PUBLIC" | "INTERNAL" | "CUSTOMER_PERSONAL" | "SENSITIVE" | "SECRET";
    }) => {
      fixtureSequence += 1;
      const classification = input.classification ?? "INTERNAL";
      const sourceScope = input.sourceScope ?? { audiences: ["INTERNAL"] };
      const source = await prisma.knowledgeV2Source.create({
        data: {
          tenantId: tenant.id,
          kind: "MANUAL",
          displayName: input.label,
          externalRootKey: `conflict-source-${fixtureSequence}-${stamp}`,
          status: "READY",
          defaultScope: sourceScope,
          defaultClassification: classification,
          defaultLocale: "en",
          createdByUserId: ownerUser.id,
          updatedByUserId: ownerUser.id,
        },
      });
      const document = await prisma.knowledgeV2Document.create({
        data: {
          tenantId: tenant.id,
          sourceId: source.id,
          externalKey: `conflict-document-${fixtureSequence}`,
          kind: "policy",
          title: input.label,
          audience: input.documentAudience ?? ["INTERNAL"],
          classification,
          permissionVersion: source.sourcePermissionVersion,
          status: "ACTIVE",
        },
      });
      const fingerprint = sourcePermissionFingerprint({
        tenantId: tenant.id,
        sourceId: source.id,
        permissionVersion: source.sourcePermissionVersion,
        scope: sourceScope,
        classification,
        locale: source.defaultLocale,
      });
      const revision = await prisma.knowledgeV2DocumentRevision.create({
        data: {
          tenantId: tenant.id,
          sourceId: source.id,
          documentId: document.id,
          revisionNumber: 1,
          contentHash: sha256(`revision:${input.label}:${stamp}`),
          status: "READY",
          pipelineVersion: "conflict-hydration-smoke-v1",
          sourcePermissionFingerprint: fingerprint,
          createdByUserId: ownerUser.id,
        },
      });
      await prisma.knowledgeV2Document.update({
        where: { id: document.id },
        data: { currentDraftRevisionId: revision.id },
      });
      const fact = await prisma.knowledgeV2Fact.create({
        data: {
          tenantId: tenant.id,
          factKey: `conflict.fact.${fixtureSequence}.${stamp}`,
          entityType: "business",
          fieldType: "text",
          latestVersionNumber: 2,
          createdByUserId: ownerUser.id,
          updatedByUserId: ownerUser.id,
        },
      });
      const leftVersion = await prisma.knowledgeV2FactVersion.create({
        data: {
          tenantId: tenant.id,
          factId: fact.id,
          versionNumber: 1,
          normalizedValue: "Restricted candidate",
          displayValue: "Restricted candidate",
          immutableHash: sha256(`left:${input.label}:${stamp}`),
          createdByUserId: ownerUser.id,
        },
      });
      const rightVersion = await prisma.knowledgeV2FactVersion.create({
        data: {
          tenantId: tenant.id,
          factId: fact.id,
          versionNumber: 2,
          normalizedValue: "Public candidate",
          displayValue: "Public candidate",
          immutableHash: sha256(`right:${input.label}:${stamp}`),
          supersedesVersionId: leftVersion.id,
          createdByUserId: ownerUser.id,
        },
      });
      const secret = input.secret ?? `Restricted ${input.label} ${stamp}`;
      const bytes = Buffer.from(secret, "utf8");
      const objectKey = createDeterministicKnowledgeObjectKey({
        tenantId: tenant.id,
        sourceId: source.id,
        purpose: "raw",
        identity: `${input.label}:${stamp}`,
      });
      const written = await objectStore.put(objectKey, bytes);
      const restrictedValueRef = encodeReference(written);
      const conflict = await prisma.knowledgeV2Conflict.create({
        data: {
          tenantId: tenant.id,
          conflictKey: `conflict:${fixtureSequence}:${stamp}`,
          conflictType: "FACT_VALUE",
          semanticKey: `pricing.${fixtureSequence}`,
          scopeHash: sha256(`scope:${fixtureSequence}:${stamp}`),
          severity: "MEDIUM",
          factId: fact.id,
          sourceId: source.id,
          candidateSetHash: sha256(`candidate-set:${fixtureSequence}:${stamp}`),
        },
      });
      const left = await prisma.knowledgeV2ConflictCandidate.create({
        data: {
          tenantId: tenant.id,
          conflictId: conflict.id,
          candidateKey: `left:${fixtureSequence}`,
          ordinal: 0,
          candidateType: "FACT_VERSION",
          itemVersionHash: leftVersion.immutableHash,
          factVersionId: leftVersion.id,
          candidateValueHash: input.expectedHash ?? sha256(bytes),
          restrictedValueRef,
        },
      });
      const right = await prisma.knowledgeV2ConflictCandidate.create({
        data: {
          tenantId: tenant.id,
          conflictId: conflict.id,
          candidateKey: `right:${fixtureSequence}`,
          ordinal: 1,
          candidateType: "FACT_VERSION",
          itemVersionHash: rightVersion.immutableHash,
          factVersionId: rightVersion.id,
          candidateValueHash: sha256("Public candidate"),
        },
      });
      const evidence = await prisma.knowledgeV2EvidenceReference.create({
        data: {
          tenantId: tenant.id,
          evidenceKey: `conflict-evidence:${fixtureSequence}:${stamp}`,
          targetType: "DOCUMENT_REVISION",
          itemVersionHash: revision.contentHash,
          v2DocumentRevisionId: revision.id,
          safeLabel: "Restricted source evidence",
          isPublic: classification === "PUBLIC",
          permissionFingerprint: fingerprint,
        },
      });
      await prisma.knowledgeV2ConflictCandidateEvidence.create({
        data: {
          tenantId: tenant.id,
          conflictCandidateId: left.id,
          evidenceReferenceId: evidence.id,
          ordinal: 0,
        },
      });
      return {
        source,
        document,
        revision,
        fact,
        conflict,
        left,
        right,
        evidence,
        secret,
        restrictedValueRef,
        objectKey,
      };
    };

    const primary = await seedFixture({ label: "primary" });
    const ownerDetail = await reviews.getConflict(owner, primary.conflict.id);
    check(
      ownerDetail.candidates?.[0]?.safeValue === primary.secret,
      "Owner did not hydrate restricted value.",
    );
    check(
      ownerDetail.candidates?.[1]?.safeValue === "Public candidate",
      "Public value was not readable.",
    );
    const managerDetail = await reviews.getConflict(manager, primary.conflict.id);
    check(
      managerDetail.candidates?.[0]?.safeValue === primary.secret,
      "Manager could not read low-risk internal value.",
    );

    await expectError(
      reviews.getConflict(otherOwner, primary.conflict.id),
      404,
      "KNOWLEDGE_CONFLICT_ITEM_NOT_FOUND",
    );

    await prisma.membership.delete({
      where: { tenantId_userId: { tenantId: tenant.id, userId: managerUser.id } },
    });
    const removedActorDetail = await reviews.getConflict(manager, primary.conflict.id);
    check(
      removedActorDetail.candidates?.[0]?.safeValue === null,
      "Removed actor retained restricted value.",
    );
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: managerUser.id, role: "MANAGER" },
    });

    await prisma.knowledgeV2Document.update({
      where: { id: primary.document.id },
      data: { audience: ["AUTHENTICATED_CUSTOMER"] },
    });
    check(
      (await reviews.getConflict(manager, primary.conflict.id)).candidates?.[0]?.safeValue === null,
      "Manager crossed the document audience boundary.",
    );
    check(
      (await reviews.getConflict(owner, primary.conflict.id)).candidates?.[0]?.safeValue ===
        primary.secret,
      "Owner lost authorized customer-audience access.",
    );
    await prisma.knowledgeV2Document.update({
      where: { id: primary.document.id },
      data: { audience: ["INTERNAL"], classification: "SENSITIVE" },
    });
    check(
      (await reviews.getConflict(manager, primary.conflict.id)).candidates?.[0]?.safeValue === null,
      "Manager crossed the classification boundary.",
    );
    check(
      (await reviews.getConflict(owner, primary.conflict.id)).candidates?.[0]?.safeValue ===
        primary.secret,
      "Owner lost authorized sensitive access.",
    );
    await prisma.knowledgeV2Document.update({
      where: { id: primary.document.id },
      data: { audience: ["UNKNOWN_AUDIENCE"], classification: "INTERNAL" },
    });
    check(
      (await reviews.getConflict(owner, primary.conflict.id)).candidates?.[0]?.safeValue === null,
      "Malformed document audience widened access.",
    );
    await prisma.knowledgeV2Document.update({
      where: { id: primary.document.id },
      data: { audience: ["INTERNAL"] },
    });

    const malformedSource = await seedFixture({
      label: "malformed-source",
      documentAudience: Prisma.DbNull,
      sourceScope: { audiences: ["UNKNOWN_AUDIENCE"] },
    });
    check(
      (await reviews.getConflict(owner, malformedSource.conflict.id)).candidates?.[0]?.safeValue ===
        null,
      "Malformed source audience widened absent document policy.",
    );

    const missing = await seedFixture({ label: "missing-object" });
    await objectStore.delete(missing.objectKey);
    check(
      (await reviews.getConflict(owner, missing.conflict.id)).candidates?.[0]?.safeValue === null,
      "Missing encrypted object was treated as readable.",
    );
    const tampered = await seedFixture({ label: "tampered-object" });
    const tamperedPath = join(objectRoot, ...tampered.objectKey.split("/"));
    const tamperedBytes = await readFile(tamperedPath);
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    await writeFile(tamperedPath, tamperedBytes);
    check(
      (await reviews.getConflict(owner, tampered.conflict.id)).candidates?.[0]?.safeValue === null,
      "Hash-mismatched object was treated as readable.",
    );

    const stale = await seedFixture({ label: "stale-etag" });
    await prisma.knowledgeV2Conflict.update({
      where: { id: stale.conflict.id },
      data: { etag: { increment: 1 }, generation: { increment: 1 } },
    });
    await expectError(
      reviews.resolveConflict(
        owner,
        stale.conflict.id,
        { resolution: "KEEP_LEFT", rationale: "Use the protected value." },
        `stale-${stamp}`,
        [strongKnowledgeV2Etag("conflict", stale.conflict.id, stale.conflict.etag)],
      ),
      412,
      "REVISION_CONFLICT",
    );

    const success = await seedFixture({ label: "success" });
    const resolved = await reviews.resolveConflict(
      owner,
      success.conflict.id,
      { resolution: "KEEP_LEFT", rationale: "Use the protected value." },
      `success-${stamp}`,
      [strongKnowledgeV2Etag("conflict", success.conflict.id, success.conflict.etag)],
    );
    check(resolved.resource.status === "IN_REVIEW", "Restricted conflict was not queued safely.");
    const successEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: { tenantId: tenant.id, aggregateId: success.conflict.id },
    });
    await decisions.dispatch(successEvent.id);
    const successor = await prisma.knowledgeV2FactVersion.findFirstOrThrow({
      where: { tenantId: tenant.id, factId: success.fact.id },
      orderBy: { versionNumber: "desc" },
    });
    check(
      successor.displayValue === success.secret &&
        (
          await prisma.knowledgeV2Conflict.findUniqueOrThrow({
            where: { id: success.conflict.id },
          })
        ).status === "RESOLVED",
      "Decision execution did not use the rehydrated value before settlement.",
    );
    const versionCount = await prisma.knowledgeV2FactVersion.count({
      where: { tenantId: tenant.id, factId: success.fact.id },
    });
    await decisions.dispatch(successEvent.id);
    check(
      (await prisma.knowledgeV2FactVersion.count({
        where: { tenantId: tenant.id, factId: success.fact.id },
      })) === versionCount,
      "Decision replay created another successor.",
    );

    const permissionRace = await seedFixture({ label: "permission-race" });
    await reviews.resolveConflict(
      owner,
      permissionRace.conflict.id,
      { resolution: "KEEP_LEFT", rationale: "Use the protected value." },
      `permission-race-${stamp}`,
      [strongKnowledgeV2Etag("conflict", permissionRace.conflict.id, permissionRace.conflict.etag)],
    );
    const permissionEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: { tenantId: tenant.id, aggregateId: permissionRace.conflict.id },
    });
    await prisma.knowledgeV2Source.update({
      where: { id: permissionRace.source.id },
      data: { sourcePermissionVersion: { increment: 1 } },
    });
    await decisions.dispatch(permissionEvent.id);
    check(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: permissionEvent.id } }))
        .status === "DEAD_LETTER" &&
        (
          await prisma.knowledgeV2Conflict.findUniqueOrThrow({
            where: { id: permissionRace.conflict.id },
          })
        ).status === "IN_REVIEW",
      "Permission race did not fail closed at execution.",
    );

    const deletionRace = await seedFixture({ label: "deletion-race" });
    await reviews.resolveConflict(
      owner,
      deletionRace.conflict.id,
      { resolution: "KEEP_LEFT", rationale: "Use the protected value." },
      `deletion-race-${stamp}`,
      [strongKnowledgeV2Etag("conflict", deletionRace.conflict.id, deletionRace.conflict.etag)],
    );
    const deletionEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: { tenantId: tenant.id, aggregateId: deletionRace.conflict.id },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: deletionRace.document.id },
      data: { deletionGeneration: { increment: 1 } },
    });
    await decisions.dispatch(deletionEvent.id);
    check(
      (await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: deletionEvent.id } }))
        .status === "DEAD_LETTER",
      "Deletion-generation race was not denied at execution.",
    );

    const durable = JSON.stringify({
      jobs: await prisma.knowledgeJob.findMany({ where: { tenantId: tenant.id } }),
      outbox: await prisma.knowledgeOutbox.findMany({ where: { tenantId: tenant.id } }),
      inbox: await prisma.knowledgeInbox.findMany({ where: { tenantId: tenant.id } }),
      audits: await prisma.auditLog.findMany({ where: { tenantId: tenant.id } }),
    });
    check(!durable.includes(success.secret), "Plaintext leaked into durable operations.");
    check(
      !durable.includes(success.restrictedValueRef),
      "Restricted reference leaked into durable operations.",
    );
    check(!durable.includes(success.objectKey), "Object key leaked into durable operations.");
  } finally {
    await cleanup(prisma, tenantIds, userIds).catch(() => undefined);
    await prisma.$disconnect();
    await rm(objectRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(`Knowledge v2 conflict candidate hydration smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(code(error) ?? error);
  process.exitCode = 1;
});
