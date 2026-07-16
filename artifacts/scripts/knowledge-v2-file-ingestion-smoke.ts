import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeSourceQueueService } from "../../apps/api/src/modules/knowledge/knowledge-source-queue.service.js";
import { KnowledgeV2FileUploadService } from "../../apps/api/src/modules/knowledge/knowledge-v2-file-upload.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import {
  createKnowledgeIngestionDependencies,
  processKnowledgeIngestionJob,
} from "../../apps/worker/src/knowledge/knowledge-ingestion-processor.js";
import { EncryptedFileKnowledgeObjectStore } from "@leadvirt/knowledge";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

let checks = 0;
let scanCalls = 0;

function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

async function expectHttp(action: Promise<unknown>, status: number, code: string) {
  await assert.rejects(action, (error) => {
    checks += 1;
    if (!(error instanceof HttpException) || error.getStatus() !== status) return false;
    const response = error.getResponse();
    return typeof response === "object" && response !== null && "code" in response && response.code === code;
  });
}

async function scannerServer() {
  let verdict: "clean" | "malicious" = "clean";
  const server = createServer((socket) => {
    scanCalls += 1;
    socket.on("data", () => undefined);
    socket.on("end", () => {
      socket.end(verdict === "clean" ? "stream: OK\0" : "stream: Eicar-Test-Signature FOUND\0");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Scanner test server did not bind.");
  return {
    server,
    port: address.port,
    setVerdict(value: "clean" | "malicious") { verdict = value; },
  };
}

function context(tenant: RequestContext["tenant"], user: RequestContext["user"], role: RequestContext["role"]): RequestContext {
  return { tenantId: tenant.id, userId: user.id, role, authMode: "credentials", tenant, user };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function storedFileCount(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    count += entry.isDirectory()
      ? await storedFileCount(join(path, entry.name))
      : entry.isFile()
        ? 1
        : 0;
  }
  return count;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const root = await mkdtemp(join(tmpdir(), "leadvirt-file-ingestion-"));
  const key = { id: "file-smoke-v1", key: randomBytes(32) };
  const scanner = await scannerServer();
  const queueConfig = {
    redisUrl: "redis://localhost:6380",
  } as unknown as AppConfigService;
  const config = {
    redisUrl: "redis://localhost:6380",
    apiUrl: "http://localhost:4001",
    knowledgeFileImportEnabled: true,
    knowledgeMaxFileBytes: 1024 * 1024,
    knowledgeFileUploadTtlSeconds: 600,
    knowledgeFileUploadStreamTimeoutMs: 200,
    knowledgeFileScannerApproved: true,
    knowledgeFileScannerHost: "127.0.0.1",
    knowledgeFileScannerPort: scanner.port,
    knowledgeFileScannerVersion: "smoke-clamav-v1",
    knowledgeFileScannerTimeoutMs: 2_000,
    knowledgeObjectStorePath: root,
    knowledgeArtifactEncryptionKey: Buffer.from(key.key).toString("base64"),
    knowledgeArtifactEncryptionKeyId: key.id,
  } as unknown as AppConfigService;
  const queue = new KnowledgeSourceQueueService(queueConfig, prisma);
  const dispatched: string[] = [];
  queue.dispatch = (eventId: string) => { dispatched.push(eventId); };
  const service = new KnowledgeV2FileUploadService(
    prisma,
    new KnowledgeV2IdempotencyService(prisma),
    queue,
    config,
  );
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId = "";
  let otherTenantId = "";
  let auditFailureTriggerInstalled = false;
  try {
    const ownerUser = await prisma.user.create({
      data: { email: `file-owner-${stamp}@example.test`, name: "File owner" },
    });
    const managerUser = await prisma.user.create({
      data: { email: `file-manager-${stamp}@example.test`, name: "File manager" },
    });
    const tenant = await prisma.tenant.create({
      data: {
        name: "File ingestion smoke",
        slug: `file-ingestion-${stamp}`,
        status: "ACTIVE",
        memberships: {
          create: [
            { userId: ownerUser.id, role: "OWNER" },
            { userId: managerUser.id, role: "MANAGER" },
          ],
        },
      },
    });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({
      data: {
        name: "File ingestion isolation",
        slug: `file-ingestion-other-${stamp}`,
        status: "ACTIVE",
        memberships: { create: { userId: ownerUser.id, role: "OWNER" } },
      },
    });
    otherTenantId = otherTenant.id;
    const owner = context(tenant, ownerUser, "OWNER");
    const manager = context(tenant, managerUser, "MANAGER");
    const otherOwner = context(otherTenant, ownerUser, "OWNER");
    const text = new TextEncoder().encode("Appointments are available Monday through Friday.\n\nCall support for changes.");
    const request = {
      displayName: "Support notes",
      filename: "support.txt",
      declaredMimeType: "text/plain" as const,
      byteSize: text.byteLength,
      defaultScope: { audiences: ["PUBLIC" as const] },
      defaultClassification: "PUBLIC" as const,
      defaultLocale: "en",
    };

    await expectHttp(
      service.createIntent(manager, request, `manager-${stamp}`),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );
    await expectHttp(
      service.createIntent(owner, { ...request, displayName: "   " }, `blank-name-${stamp}`),
      400,
      "KNOWLEDGE_VALIDATION_DISPLAY_NAME_REQUIRED",
    );
    await expectHttp(
      service.createIntent(owner, { ...request, filename: "../secret.txt" }, `path-${stamp}`),
      422,
      "KNOWLEDGE_UPLOAD_PATH_TRAVERSAL",
    );
    await expectHttp(
      service.createIntent(
        owner,
        {
          ...request,
          filename: "unsafe.pdf",
          declaredMimeType: "application/pdf",
        },
        `pdf-${stamp}`,
      ),
      422,
      "KNOWLEDGE_PARSE_PDF_SANDBOX_REQUIRED",
    );

    const intent = await service.createIntent(owner, request, `intent-${stamp}`);
    check(intent.policy.oneTime && intent.policy.expectedBytes === text.byteLength, "Intent must expose exact one-time policy.");
    check(!intent.uploadUrl.includes("support.txt"), "Upload URL must not contain a filename.");
    const replay = await service.createIntent(owner, request, `intent-${stamp}`);
    check(replay.id === intent.id && replay.idempotencyReplayed, "Intent replay must be stable.");
    check(replay.headers.Authorization === intent.headers.Authorization, "Replayed signed token must be deterministic.");
    const idempotency = await prisma.knowledgeV2IdempotencyRecord.findFirst({
      where: { tenantId: tenant.id, endpoint: "POST:/knowledge/v2/file-uploads/intents" },
    });
    check(
      JSON.stringify(idempotency?.responseBody).includes(intent.headers.Authorization) === false,
      "Stored idempotency response must not contain the bearer token.",
    );
    await expectHttp(
      service.upload(intent.id, "Bearer invalid", "text/plain", String(text.byteLength), (async function* () { yield text; })()),
      404,
      "KNOWLEDGE_SOURCE_NOT_FOUND",
    );
    await expectHttp(
      service.upload(intent.id, intent.headers.Authorization, "text/plain", String(text.byteLength + 1), (async function* () { yield text; })()),
      400,
      "KNOWLEDGE_UPLOAD_POLICY_MISMATCH",
    );
    const receipt = await service.upload(
      intent.id,
      intent.headers.Authorization,
      "text/plain",
      String(text.byteLength),
      (async function* () { yield text; })(),
    );
    check(receipt.status === "UPLOADED", "Exact upload must be accepted.");
    await expectHttp(
      service.upload(intent.id, intent.headers.Authorization, "text/plain", String(text.byteLength), (async function* () { yield text; })()),
      409,
      "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED",
    );
    await expectHttp(
      service.complete(otherOwner, intent.id, `cross-tenant-${stamp}`),
      404,
      "KNOWLEDGE_SOURCE_NOT_FOUND",
    );
    const accepted = await service.complete(owner, intent.id, `complete-${stamp}`);
    check(accepted.resource?.type === "SOURCE", "Finalization must return a source job.");
    check(dispatched.length === 1, "Finalization must dispatch exactly one durable event.");
    const completed = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({ where: { id: intent.id } });
    check(completed.status === "COMPLETED" && completed.sourceId && completed.artifactId, "Intent must retain finalized tenant-scoped references.");
    const artifact = await prisma.knowledgeV2Artifact.findUniqueOrThrow({ where: { id: completed.artifactId! } });
    check(artifact.malwareStatus === "CLEAN" && artifact.mimeValidationStatus === "VALID", "Artifact must persist admission verdicts.");
    const runtimeEvent = await prisma.runtimeOutbox.findFirstOrThrow({
      where: { tenantId: tenant.id, aggregateType: "knowledge-source", aggregateId: completed.sourceId! },
    });
    check(!JSON.stringify(runtimeEvent.payload).includes("Appointments"), "Queue payload must not contain file content.");
    check(!JSON.stringify(runtimeEvent.payload).includes("support.txt"), "Queue payload must not contain the filename.");
    const callsBeforeReplay = scanCalls;
    const completedReplay = await service.complete(owner, intent.id, `complete-${stamp}`);
    check(completedReplay.idempotencyReplayed && scanCalls === callsBeforeReplay, "Complete replay must not rescan or dispatch.");

    const store = new EncryptedFileKnowledgeObjectStore({
      rootPath: root,
      activeKey: key,
      maxPlaintextBytes: 1024 * 1024,
    });
    const workerResult = await processKnowledgeIngestionJob(
      {
        id: `knowledge-source:${accepted.jobId}`,
        name: "import",
        data: {
          tenantId: tenant.id,
          sourceId: completed.sourceId!,
          knowledgeJobId: accepted.jobId,
          generation: 1,
          operation: "IMPORT",
          requestedByUserId: ownerUser.id,
          requestedAt: new Date().toISOString(),
          runtimeEventId: runtimeEvent.id,
          runtimeGeneration: 1,
        },
        attemptsMade: 0,
        maxAttempts: 5,
        signal: new AbortController().signal,
      },
      createKnowledgeIngestionDependencies(prisma, {
        objectStore: store,
        objectEncryptionKeyRef: key.id,
        objectStoreConfigured: true,
        fileImportEnabled: true,
        maxFileBytes: 1024 * 1024,
        websiteImportEnabled: false,
        websiteEgressReady: false,
      }),
    );
    check(workerResult.status === "succeeded" && workerResult.revisionId, "Worker must parse the accepted file asynchronously.");
    const revision = await prisma.knowledgeV2DocumentRevision.findUniqueOrThrow({ where: { id: workerResult.revisionId! } });
    check(revision.artifactId === artifact.id && revision.parserVersion === "plain-text-v1", "Revision must reuse the admitted immutable artifact.");
    const chunks = await prisma.knowledgeV2Chunk.count({ where: { tenantId: tenant.id, revisionId: revision.id } });
    check(chunks > 0, "TXT import must create retrieval chunks.");

    const slowIntent = await service.createIntent(
      owner,
      { ...request, filename: "slow.txt", byteSize: 1 },
      `slow-intent-${stamp}`,
    );
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
          return: () => Promise.resolve({ done: true, value: undefined }),
        };
      },
    };
    await expectHttp(
      service.upload(
        slowIntent.id,
        slowIntent.headers.Authorization,
        "text/plain",
        "1",
        stalled,
      ),
      408,
      "KNOWLEDGE_UPLOAD_STREAM_TIMEOUT",
    );
    const slowRejected = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({
      where: { id: slowIntent.id },
    });
    check(slowRejected.status === "REJECTED", "Timed-out streams must consume and reject the intent.");

    const abortedIntent = await service.createIntent(
      owner,
      { ...request, filename: "aborted.txt", byteSize: 1 },
      `aborted-intent-${stamp}`,
    );
    const abortController = new AbortController();
    abortController.abort();
    await expectHttp(
      service.upload(
        abortedIntent.id,
        abortedIntent.headers.Authorization,
        "text/plain",
        "1",
        stalled,
        abortController.signal,
      ),
      400,
      "KNOWLEDGE_UPLOAD_STREAM_ABORTED",
    );

    const auditFailureIntent = await service.createIntent(
      owner,
      { ...request, filename: "audit-failure.txt" },
      `audit-failure-intent-${stamp}`,
    );
    const objectsBeforeAuditFailure = await storedFileCount(root);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION file_upload_audit_failure_smoke() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'knowledge.v2.file_upload.received'
           AND NEW."entityId" = '${auditFailureIntent.id}' THEN
          RAISE EXCEPTION 'file upload audit failure smoke';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER file_upload_audit_failure_smoke_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION file_upload_audit_failure_smoke()
    `);
    auditFailureTriggerInstalled = true;
    await expectHttp(
      service.upload(
        auditFailureIntent.id,
        auditFailureIntent.headers.Authorization,
        "text/plain",
        String(text.byteLength),
        (async function* () { yield text; })(),
      ),
      400,
      "KNOWLEDGE_UPLOAD_STREAM_INVALID",
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER file_upload_audit_failure_smoke_trigger ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION file_upload_audit_failure_smoke() ");
    auditFailureTriggerInstalled = false;
    const auditFailureRow = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({
      where: { id: auditFailureIntent.id },
    });
    check(
      auditFailureRow.status === "REJECTED" && !auditFailureRow.stagingObjectKey,
      "Receipt audit failure must roll back UPLOADED and clear staging.",
    );
    check(
      (await storedFileCount(root)) === objectsBeforeAuditFailure,
      "Receipt audit failure must not leave an encrypted object orphan.",
    );

    const csvBytes = new TextEncoder().encode("service,price\nConsultation,45");
    const csvIntent = await service.createIntent(
      owner,
      {
        ...request,
        displayName: "Service catalog",
        filename: "catalog.csv",
        declaredMimeType: "text/csv",
        byteSize: csvBytes.byteLength,
      },
      `csv-intent-${stamp}`,
    );
    await service.upload(
      csvIntent.id,
      csvIntent.headers.Authorization,
      "text/csv",
      String(csvBytes.byteLength),
      (async function* () { yield csvBytes; })(),
    );
    await prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.id },
      data: { maxDocuments: 1 },
    });
    const objectsBeforeQuotaFailure = await storedFileCount(root);
    await expectHttp(
      service.complete(owner, csvIntent.id, `csv-quota-${stamp}`),
      422,
      "KNOWLEDGE_QUOTA_DOCUMENTS_EXCEEDED",
    );
    const quotaIntent = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({
      where: { id: csvIntent.id },
    });
    check(
      quotaIntent.status === "UPLOADED" && Boolean(quotaIntent.stagingObjectKey),
      "Mutation failure must restore the scanned upload to a retryable referenced state.",
    );
    check(
      (await storedFileCount(root)) === objectsBeforeQuotaFailure,
      "Mutation failure must not create a second final-object orphan.",
    );
    await prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.id },
      data: { maxDocuments: 100 },
    });
    const csvAccepted = await service.complete(owner, csvIntent.id, `csv-complete-${stamp}`);
    const csvCompleted = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({
      where: { id: csvIntent.id },
    });
    const csvEvent = await prisma.runtimeOutbox.findFirstOrThrow({
      where: { tenantId: tenant.id, aggregateId: csvCompleted.sourceId! },
    });
    const csvWorker = await processKnowledgeIngestionJob(
      {
        id: `knowledge-source:${csvAccepted.jobId}`,
        name: "import",
        data: {
          tenantId: tenant.id,
          sourceId: csvCompleted.sourceId!,
          knowledgeJobId: csvAccepted.jobId,
          generation: 1,
          operation: "IMPORT",
          requestedByUserId: ownerUser.id,
          requestedAt: new Date().toISOString(),
          runtimeEventId: csvEvent.id,
          runtimeGeneration: 1,
        },
        attemptsMade: 0,
        maxAttempts: 5,
        signal: new AbortController().signal,
      },
      createKnowledgeIngestionDependencies(prisma, {
        objectStore: store,
        objectEncryptionKeyRef: key.id,
        objectStoreConfigured: true,
        fileImportEnabled: true,
        maxFileBytes: 1024 * 1024,
        websiteImportEnabled: false,
        websiteEgressReady: false,
      }),
    );
    const csvRevision = await prisma.knowledgeV2DocumentRevision.findUniqueOrThrow({
      where: { id: csvWorker.revisionId! },
    });
    check(csvRevision.parserVersion === "csv-text-v1", "CSV must reach the asynchronous revision path.");

    const revokedIntent = await service.createIntent(
      owner,
      { ...request, filename: "revoked.txt" },
      `revoked-intent-${stamp}`,
    );
    await service.upload(
      revokedIntent.id,
      revokedIntent.headers.Authorization,
      "text/plain",
      String(text.byteLength),
      (async function* () { yield text; })(),
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: ownerUser.id } },
      data: { role: "AGENT" },
    });
    const scansBeforeRevocation = scanCalls;
    await expectHttp(
      service.complete(owner, revokedIntent.id, `revoked-complete-${stamp}`),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );
    check(scanCalls === scansBeforeRevocation, "Revoked membership must fail before scanner or storage work.");
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: ownerUser.id } },
      data: { role: "OWNER" },
    });

    scanner.setVerdict("malicious");
    const maliciousText = new TextEncoder().encode("EICAR test content");
    const maliciousIntent = await service.createIntent(
      owner,
      { ...request, filename: "malicious.txt", byteSize: maliciousText.byteLength },
      `malicious-intent-${stamp}`,
    );
    await service.upload(
      maliciousIntent.id,
      maliciousIntent.headers.Authorization,
      "text/plain",
      String(maliciousText.byteLength),
      (async function* () { yield maliciousText; })(),
    );
    await expectHttp(
      service.complete(owner, maliciousIntent.id, `malicious-complete-${stamp}`),
      422,
      "KNOWLEDGE_UPLOAD_MALWARE_DETECTED",
    );
    const rejected = await prisma.knowledgeV2FileUploadIntent.findUniqueOrThrow({ where: { id: maliciousIntent.id } });
    check(
      rejected.status === "REJECTED" && !rejected.stagingObjectKey && !rejected.sourceId,
      "Rejected malware must clear staging and create no source.",
    );

    console.log(`Knowledge v2 file ingestion smoke passed (${checks} checks).`);
  } finally {
    if (auditFailureTriggerInstalled) {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS file_upload_audit_failure_smoke_trigger ON "AuditLog"',
      ).catch(() => undefined);
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS file_upload_audit_failure_smoke()",
      ).catch(() => undefined);
    }
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (otherTenantId) await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => undefined);
    await queue.onModuleDestroy();
    await closeServer(scanner.server);
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
