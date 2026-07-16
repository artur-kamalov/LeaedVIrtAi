import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  createKnowledgeV2QueryHashKeyring,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  KNOWLEDGE_V2_QUERY_HASH_VERSION,
} from "@leadvirt/knowledge";
import type { KnowledgeV2CreateTestCaseRequest } from "@leadvirt/types";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2TestService } from "../../apps/api/src/modules/knowledge/knowledge-v2-test.service.js";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks += 1;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function config(input: { rootPath?: string; key?: Buffer; keyId?: string }) {
  return {
    knowledgeObjectStorePath: input.rootPath,
    knowledgeArtifactEncryptionKey: input.key?.toString("base64"),
    knowledgeArtifactEncryptionKeyId: input.keyId,
  } as unknown as AppConfigService;
}

function context(
  tenant: RequestContext["tenant"],
  user: RequestContext["user"],
  role: RequestContext["role"] = "OWNER",
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

async function expectKnowledgeError(action: Promise<unknown>, status: number, code: string) {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof HttpException) || error.getStatus() !== status) throw error;
    const payload = error.getResponse();
    check(
      typeof payload === "object" && payload !== null && "code" in payload && payload.code === code,
      `Expected ${code}, received ${JSON.stringify(payload)}.`,
    );
    return;
  }
  throw new Error(`Expected ${status} ${code}.`);
}

async function cleanup(prisma: PrismaService, tenantIds: string[], userId: string | undefined) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.knowledgeV2TestExpectation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2TestCaseVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2TestCase.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvaluationRun.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Settings.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (userId) await tx.user.deleteMany({ where: { id: userId } });
  });
}

async function storedBytes(rootPath: string): Promise<Buffer> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map((entry) => {
      const path = join(rootPath, entry.name);
      return entry.isDirectory() ? storedBytes(path) : readFile(path);
    }),
  );
  return Buffer.concat(parts);
}

async function main() {
  const prisma = new PrismaService();
  const rootPath = await mkdtemp(join(tmpdir(), "leadvirt-kv2-test-"));
  const tenantIds: string[] = [];
  let userId: string | undefined;
  await prisma.$connect();
  try {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: "Knowledge v2 test smoke",
        slug: `kv2-test-${stamp}`,
        businessType: "services",
        timezone: "Europe/Paris",
      },
    });
    tenantIds.push(tenant.id);
    const otherTenant = await prisma.tenant.create({
      data: { name: "Knowledge v2 test isolation", slug: `kv2-test-other-${stamp}` },
    });
    tenantIds.push(otherTenant.id);
    const user = await prisma.user.create({
      data: { email: `kv2-test-${stamp}@example.test`, name: "Test owner" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });

    const owner = context(tenant, user);
    const manager = context(tenant, user, "MANAGER");
    const agent = context(tenant, user, "AGENT");
    const otherOwner = context(otherTenant, user);
    const key = randomBytes(32);
    const keyId = "knowledge-v2-test-smoke";
    const question = `Private test question ${stamp}`;
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const previousQueryKeyId = "test-query-old";
    const activeQueryKeyId = "test-query-current";
    const previousQueryKey = randomBytes(32);
    const activeQueryKey = randomBytes(32);
    const previousQueryHashes = createKnowledgeV2QueryHashKeyring({
      activeKeyId: previousQueryKeyId,
      keys: { [previousQueryKeyId]: previousQueryKey },
    });
    const rotatedQueryHashes = createKnowledgeV2QueryHashKeyring({
      activeKeyId: activeQueryKeyId,
      keys: {
        [previousQueryKeyId]: previousQueryKey,
        [activeQueryKeyId]: activeQueryKey,
      },
    });
    const activeOnlyQueryHashes = createKnowledgeV2QueryHashKeyring({
      activeKeyId: activeQueryKeyId,
      keys: { [activeQueryKeyId]: activeQueryKey },
    });
    const service = new KnowledgeV2TestService(
      prisma,
      idempotency,
      config({ rootPath, key, keyId }),
      previousQueryHashes,
    );
    const rotatedService = new KnowledgeV2TestService(
      prisma,
      idempotency,
      config({ rootPath, key, keyId }),
      rotatedQueryHashes,
    );
    const activeOnlyService = new KnowledgeV2TestService(
      prisma,
      idempotency,
      config({ rootPath, key, keyId }),
      activeOnlyQueryHashes,
    );
    const disabledService = new KnowledgeV2TestService(
      prisma,
      idempotency,
      config({}),
      previousQueryHashes,
    );
    const input: KnowledgeV2CreateTestCaseRequest = {
      safeLabel: "Private pricing refusal",
      status: "ACTIVE",
      riskLevel: "HIGH",
      critical: true,
      question,
      expectedBehavior: "REFUSE",
      locale: "en",
      channelType: "WEBSITE",
      audience: "PUBLIC",
      scope: null,
      sliceKeys: ["pricing", "public"],
      datasetVersion: "draft-current",
      expectations: [
        {
          kind: "FORBIDDEN_CLAIM",
          semanticKey: "claim.private_price",
          restrictedExpectedValue: question,
        },
        {
          kind: "REQUIRED_TOOL",
          semanticKey: "tool.handoff",
          expectedValueHash: sha256("handoff"),
        },
      ],
    };

    await expectKnowledgeError(
      disabledService.createTestCase(owner, input, `disabled-${stamp}`),
      503,
      "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
    );
    await expectKnowledgeError(
      service.createTestCase(
        owner,
        {
          ...input,
          expectations: [
            {
              kind: "FORBIDDEN_CLAIM",
              semanticKey: "claim.ambiguous",
              expectedValueHash: sha256("already-hashed"),
              restrictedExpectedValue: "raw value",
            },
          ],
        },
        `ambiguous-${stamp}`,
      ),
      400,
      "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_RESTRICTED_PAIR_INVALID",
    );

    const createKey = `create-${stamp}`;
    const created = await service.createTestCase(owner, input, createKey);
    const initialQueryBinding = previousQueryHashes.hash({
      tenantId: tenant.id,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
      value: question,
    });
    check(!created.idempotencyReplayed, "first create is not replayed");
    check(created.resource.status === "ACTIVE", "active test case is created atomically");
    check(created.resource.currentVersion?.versionNumber === 1, "initial version is current");
    check(
      created.resource.currentVersion?.queryHash === initialQueryBinding.hash &&
        created.resource.currentVersion.queryHashKeyId === initialQueryBinding.keyId &&
        created.resource.currentVersion.queryHashVersion === initialQueryBinding.version,
      "server persists the tenant-scoped restricted question binding",
    );
    check(
      created.resource.currentVersion?.queryHash !== sha256(question),
      "query metadata does not persist a raw SHA-256 digest",
    );
    check(created.resource.currentVersion?.scope === null, "tenant-default scope stays null");
    check(created.resource.currentVersion?.hasRestrictedInput, "input is marked restricted");
    check(
      created.resource.currentVersion?.expectations[0]?.hasRestrictedExpectedValue,
      "restricted expected value is marked without exposing its reference",
    );
    check(
      !JSON.stringify(created.resource).includes("restrictedInputRef") &&
        !JSON.stringify(created.resource).includes("restrictedExpectedRef"),
      "restricted references are redacted from API views",
    );
    check(
      (await rotatedService.getTestCaseInput(owner, created.resource.id)).question === question,
      "a configured verify-only previous key keeps the old version readable",
    );
    await expectKnowledgeError(
      activeOnlyService.getTestCaseInput(owner, created.resource.id),
      503,
      "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
    );

    const replay = await service.createTestCase(owner, input, createKey);
    check(replay.idempotencyReplayed, "same create request is replayed");
    check(replay.resource.id === created.resource.id, "replay returns the original test case");
    await expectKnowledgeError(
      service.createTestCase(
        owner,
        { ...input, question: "Different private question" },
        createKey,
      ),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    await expectKnowledgeError(
      service.createTestCase(manager, input, `manager-${stamp}`),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );
    await expectKnowledgeError(
      service.listTestCases(agent, {}),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );

    const managerPage = await service.listTestCases(manager, {
      query: "PRIVATE PRICING",
      status: "ACTIVE",
    });
    check(managerPage.items.length === 1, "manager can find tenant test cases");
    check(
      (await service.listTestCases(otherOwner, {})).items.length === 0,
      "list is tenant isolated",
    );
    await expectKnowledgeError(
      service.getTestCase(otherOwner, created.resource.id),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );
    const metadataUpdate = await rotatedService.updateTestCase(
      owner,
      created.resource.id,
      { safeLabel: "Private pricing safe refusal" },
      `metadata-${stamp}`,
      [created.resource.etag],
    );
    check(
      metadataUpdate.resource.currentVersion?.versionNumber === 1,
      "metadata update does not create a content version",
    );
    check(metadataUpdate.resource.etag !== created.resource.etag, "metadata update advances ETag");
    await expectKnowledgeError(
      service.updateTestCase(owner, created.resource.id, { critical: false }, `stale-${stamp}`, [
        created.resource.etag,
      ]),
      412,
      "REVISION_CONFLICT",
    );
    const originalVersion = await prisma.knowledgeV2TestCaseVersion.findFirstOrThrow({
      where: { tenantId: tenant.id, testCaseId: created.resource.id, versionNumber: 1 },
    });
    const versionUpdate = await rotatedService.updateTestCase(
      owner,
      created.resource.id,
      { question, locale: "fr" },
      `version-${stamp}`,
      [metadataUpdate.resource.etag],
    );
    check(
      versionUpdate.resource.currentVersion?.versionNumber === 2,
      "content update adds a version",
    );
    check(versionUpdate.resource.currentVersion?.locale === "fr", "new version has updated locale");
    const rotatedBinding = rotatedQueryHashes.hash({
      tenantId: tenant.id,
      purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
      value: question,
    });
    check(
      versionUpdate.resource.currentVersion?.queryHash === rotatedBinding.hash &&
        versionUpdate.resource.currentVersion.queryHashKeyId === activeQueryKeyId &&
        versionUpdate.resource.currentVersion.queryHashVersion === KNOWLEDGE_V2_QUERY_HASH_VERSION,
      "explicitly resubmitting a question re-keys it into a new immutable version",
    );
    check(
      (await activeOnlyService.getTestCaseInput(owner, created.resource.id)).question === question,
      "the re-keyed current version no longer depends on the previous key",
    );
    check(
      versionUpdate.resource.currentVersion?.scope === null,
      "content update preserves tenant-default scope",
    );
    const originalAfterUpdate = await prisma.knowledgeV2TestCaseVersion.findUniqueOrThrow({
      where: { id: originalVersion.id },
    });
    check(
      originalAfterUpdate.immutableHash === originalVersion.immutableHash &&
        originalAfterUpdate.locale === "en",
      "superseded version remains immutable",
    );
    check(
      (await prisma.knowledgeV2TestCaseVersion.count({
        where: { tenantId: tenant.id, testCaseId: created.resource.id },
      })) === 2,
      "both immutable versions are retained",
    );
    await expectKnowledgeError(
      Promise.resolve().then(() =>
        (
          activeOnlyService as unknown as {
            queryBinding: (value: {
              queryHash: string;
              queryHashKeyId: string | null;
              queryHashVersion: string | null;
            }) => unknown;
          }
        ).queryBinding({
          queryHash: rotatedBinding.hash,
          queryHashKeyId: null,
          queryHashVersion: null,
        }),
      ),
      503,
      "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
    );

    const archived = await rotatedService.archiveTestCase(
      owner,
      created.resource.id,
      { reason: "Case retired after policy update" },
      `archive-${stamp}`,
      [versionUpdate.resource.etag],
    );
    check(archived.resource.status === "ARCHIVED", "test case is archived");
    check(archived.resource.allowedActions.length === 0, "archived case has no edit actions");
    check(
      (await service.listTestCases(owner, {})).items.length === 0,
      "default list excludes archived cases",
    );
    check(
      (await service.listTestCases(owner, { status: "ARCHIVED" })).items.length === 1,
      "archived filter returns the case",
    );
    await expectKnowledgeError(
      service.updateTestCase(
        owner,
        created.resource.id,
        { safeLabel: "Cannot edit archived" },
        `archived-edit-${stamp}`,
        [archived.resource.etag],
      ),
      409,
      "KNOWLEDGE_CONFLICT_TEST_CASE_ARCHIVED",
    );

    const [versions, idempotencyRows, audits, evaluationRunCount] = await Promise.all([
      prisma.knowledgeV2TestCaseVersion.findMany({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2IdempotencyRecord.findMany({ where: { tenantId: tenant.id } }),
      prisma.auditLog.findMany({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2EvaluationRun.count({ where: { tenantId: tenant.id } }),
    ]);
    const persisted = JSON.stringify({ versions, idempotencyRows, audits });
    check(!persisted.includes(question), "raw question is absent from ordinary database records");
    check(
      versions.every(
        (version) =>
          version.queryHashKeyId !== null &&
          version.queryHashVersion === KNOWLEDGE_V2_QUERY_HASH_VERSION,
      ),
      "every new immutable version persists complete query HMAC metadata",
    );
    check(
      JSON.stringify(audits).includes(previousQueryKeyId) &&
        JSON.stringify(audits).includes(activeQueryKeyId),
      "audit records retain the exact query HMAC key bindings across rotation",
    );
    const restrictedRefs = versions.map((version) => version.restrictedInputRef);
    check(
      restrictedRefs.every((reference) => !JSON.stringify(idempotencyRows).includes(reference)),
      "idempotency records do not expose restricted references",
    );
    check(
      restrictedRefs.every((reference) => !JSON.stringify(audits).includes(reference)),
      "audit records do not expose restricted references",
    );
    check(
      !(await storedBytes(rootPath)).includes(Buffer.from(question, "utf8")),
      "object-store files do not contain plaintext questions",
    );
    check(evaluationRunCount === 0, "CRUD does not create unsupported playground runs");
  } finally {
    await cleanup(prisma, tenantIds, userId).catch(() => undefined);
    await prisma.$disconnect();
    await rm(rootPath, { recursive: true, force: true });
  }
  console.log(`Knowledge v2 test API smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
