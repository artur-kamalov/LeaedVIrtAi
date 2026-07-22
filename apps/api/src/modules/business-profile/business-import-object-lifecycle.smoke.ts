import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { AppConfigService } from "../../config/app-config.service.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { businessImportEtag } from "./business-import-http.js";
import type { BusinessImportQueueService } from "./business-import-queue.service.js";
import {
  adoptPendingBusinessImportObject,
  cleanupPendingBusinessImportObject,
  putPendingBusinessImportObject,
  reservePendingBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportUploadService } from "./business-import-upload.service.js";
import type { BusinessImportViewService } from "./business-import-view.service.js";
import { BusinessImportWorkflowService } from "./business-import-workflow.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

const root = resolve(import.meta.dirname, "../../../../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_object_lifecycle_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

function command(args: string[], env: NodeJS.ProcessEnv) {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")] : args;
  return new Promise<{ status: number | null; output: string }>((resolveCommand, rejectCommand) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (status) => resolveCommand({ status, output }));
  });
}

function runtimeConfig(objectRoot: string, encodedKey: string) {
  return {
    apiUrl: "http://localhost:4001",
    businessImportEnabled: true,
    businessImportMaxFileBytes: 10 * 1024 * 1024,
    businessImportUploadTtlSeconds: 600,
    businessImportMaxPendingPerTenant: 1,
    businessImportXlsxSandboxApproved: false,
    businessImportParserApproved: false,
    businessImportParserUrl: undefined,
    businessImportParserVersion: "smoke-parser-v1",
    businessImportParserTimeoutMs: 5_000,
    knowledgeObjectStorePath: objectRoot,
    knowledgeArtifactEncryptionKey: encodedKey,
    knowledgeArtifactEncryptionKeyId: "smoke-lifecycle-key-v1",
    knowledgeFileUploadStreamTimeoutMs: 5_000,
    knowledgeFileScannerHost: "127.0.0.1",
    knowledgeFileScannerApproved: true,
    knowledgeFileScannerPort: 3310,
    knowledgeFileScannerVersion: "smoke-clamav-v1",
    knowledgeFileScannerTimeoutMs: 5_000,
  } as unknown as AppConfigService;
}

async function main() {
  const maintenance = new PrismaService({ datasourceUrl: maintenanceUrl.toString() });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-object-lifecycle-"));
  let prisma: PrismaService | undefined;
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const migrated = await command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
      DATABASE_URL: smokeUrl.toString(),
    });
    assert.equal(migrated.status, 0, migrated.output);
    process.env.DATABASE_URL = smokeUrl.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: "Lifecycle smoke", slug: `lifecycle-${tenantId}` },
    });
    const user = await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, name: "Lifecycle owner" },
    });
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    const context: RequestContext = {
      tenantId,
      userId,
      role: "OWNER",
      sessionId: randomUUID(),
      authMode: "credentials",
      tenant,
      user,
    };
    const config = runtimeConfig(objectRoot, randomBytes(32).toString("base64"));
    const runtimeService = new BusinessImportRuntimeService(config);
    const informationState = new BusinessInformationStateService(prisma);
    const uploadService = new BusinessImportUploadService(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
      runtimeService,
      informationState,
      config,
    );
    const intentInput = {
      filename: "services.csv",
      declaredMimeType: "text/csv" as const,
      byteSize: 128,
      sourceName: "Lifecycle services",
    };
    const concurrent = await Promise.allSettled([
      uploadService.createIntent(context, intentInput, randomUUID()),
      uploadService.createIntent(context, intentInput, randomUUID()),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    assert.equal(
      await prisma.businessImport.count({
        where: { tenantId, state: { in: ["CREATED", "UPLOADING"] } },
      }),
      1,
    );
    const createdImport = await prisma.businessImport.findFirstOrThrow({
      where: { tenantId },
    });
    const retryImportId = randomUUID();
    await prisma.businessImport.create({
      data: {
        id: retryImportId,
        tenantId,
        sourceId: createdImport.sourceId,
        purpose: "SERVICES",
        format: "CSV",
        state: "FAILED_RETRYABLE",
        displayName: "Blocked retry",
        originalFilename: "retry.csv",
        declaredMimeType: "text/csv",
        expectedByteSize: 64n,
        uploadTokenHash: randomBytes(32).toString("hex"),
        baseInformationRevision: createdImport.baseInformationRevision,
        baseInformationHash: createdImport.baseInformationHash,
        selectedCategories: ["OFFERINGS"],
        schemaVersion: "leadvirt.services.v1",
        failureCode: "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
        failureStage: "STORAGE",
        retryable: true,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdByUserId: userId,
      },
    });
    const workflow = new BusinessImportWorkflowService(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
      {
        createParseEvent: () => {
          throw new Error("quota gate did not run");
        },
        dispatch: () => undefined,
      } as unknown as BusinessImportQueueService,
      runtimeService,
      {} as BusinessImportViewService,
    );
    await assert.rejects(
      () =>
        workflow.retry(
          context,
          retryImportId,
          { generation: 1 },
          businessImportEtag(retryImportId, 1),
          randomUUID(),
        ),
      /maximum number of active imports/u,
    );
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: retryImportId } })).state,
      "FAILED_RETRYABLE",
    );
    const quotaTenantId = randomUUID();
    const quotaTenant = await prisma.tenant.create({
      data: { id: quotaTenantId, name: "Quota smoke", slug: `quota-${quotaTenantId}` },
    });
    await prisma.membership.create({
      data: { tenantId: quotaTenantId, userId, role: "OWNER" },
    });
    const quotaContext: RequestContext = {
      ...context,
      tenantId: quotaTenantId,
      tenant: quotaTenant,
    };
    const quotaSource = await prisma.businessImportSource.create({
      data: {
        tenantId: quotaTenantId,
        lineageKey: `quota:${randomUUID()}`,
        displayName: "Leaked quota source",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    const quotaImport = await prisma.businessImport.create({
      data: {
        id: randomUUID(),
        tenantId: quotaTenantId,
        sourceId: quotaSource.id,
        purpose: "SERVICES",
        format: "CSV",
        state: "FAILED",
        displayName: "Leaked quota import",
        originalFilename: "failed.csv",
        declaredMimeType: "text/csv",
        expectedByteSize: BigInt(config.businessImportMaxFileBytes),
        uploadTokenHash: randomBytes(32).toString("hex"),
        baseInformationRevision: 0,
        baseInformationHash: "0".repeat(64),
        selectedCategories: ["OFFERINGS"],
        schemaVersion: "leadvirt.services.v1",
        failureCode: "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
        failureStage: "STORAGE",
        retryable: false,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdByUserId: userId,
      },
    });
    const quotaReservation = await prisma.businessImportQuotaReservation.create({
      data: {
        tenantId: quotaTenantId,
        importId: quotaImport.id,
        rawBytes: BigInt(config.businessImportMaxFileBytes),
        retainedBytes: BigInt(config.businessImportMaxFileBytes),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    await assert.rejects(
      () => uploadService.createIntent(quotaContext, intentInput, randomUUID()),
      /maximum number of active imports/u,
    );
    await prisma.businessImportQuotaReservation.update({
      where: { id: quotaReservation.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    const quotaRecovered = await uploadService.createIntent(
      quotaContext,
      intentInput,
      randomUUID(),
    );
    assert.ok(quotaRecovered.importId);
    const uploadBytes = new Uint8Array(intentInput.byteSize).fill(65);
    const uploadReceipt = await uploadService.upload(
      quotaRecovered.importId,
      quotaRecovered.headers.Authorization,
      quotaRecovered.headers["Content-Type"],
      quotaRecovered.headers["Content-Length"],
      Readable.from([uploadBytes]),
    );
    const replayedReceipt = await uploadService.upload(
      quotaRecovered.importId,
      quotaRecovered.headers.Authorization,
      quotaRecovered.headers["Content-Type"],
      quotaRecovered.headers["Content-Length"],
      Readable.from([uploadBytes]),
    );
    assert.deepEqual(replayedReceipt, uploadReceipt);
    const replayedImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: quotaRecovered.importId },
    });
    assert.equal(replayedImport.state, "UPLOADED");
    assert.ok(replayedImport.stagingObjectLedgerId);
    assert.ok(replayedImport.stagingObjectKey);
    assert.equal(
      await prisma.businessImportObjectLedger.count({
        where: {
          tenantId: quotaTenantId,
          objectKind: "STAGING",
          objectStorageKey: replayedImport.stagingObjectKey,
        },
      }),
      1,
    );
    const runtime = runtimeService.runtime();
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const crashKey = `tenants/smoke/sources/lifecycle/extracted/${randomUUID()}.lvobj`;
    const crashReservation = await reservePendingBusinessImportObject(prisma, {
      tenantId,
      objectKind: "APPLICATION_PREVIEW",
      objectStorageKey: crashKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `SMOKE_CRASH:${createdImport.id}`,
      retainUntil: expiresAt,
    });
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: crashReservation.ledgerId },
        })
      ).retentionClass,
      crashReservation.retentionClass,
    );
    await assert.rejects(() => runtime.store.get(crashKey, runtime.objectEncryptionKeyId));
    const bytes = new TextEncoder().encode("exact pending object");
    await putPendingBusinessImportObject(prisma, runtime.store, crashReservation, bytes);
    await putPendingBusinessImportObject(prisma, runtime.store, crashReservation, bytes);
    assert.deepEqual(await runtime.store.get(crashKey, runtime.objectEncryptionKeyId), bytes);
    await assert.rejects(
      () =>
        prisma!.$transaction(async (tx) => {
          await adoptPendingBusinessImportObject(
            tx,
            crashReservation,
            "BUSINESS_IMPORT_APPLICATION_PREVIEW",
            expiresAt,
          );
          throw new Error("simulated commit crash");
        }),
      /simulated commit crash/u,
    );
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: crashReservation.ledgerId },
        })
      ).retentionClass,
      crashReservation.retentionClass,
    );
    assert.equal(
      await cleanupPendingBusinessImportObject(
        prisma,
        runtime.store,
        crashReservation,
      ),
      true,
    );
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: crashReservation.ledgerId },
        })
      ).deletionState,
      "DELETED",
    );
    const linkedKey = `tenants/smoke/sources/lifecycle/raw/${randomUUID()}.lvobj`;
    const linkedReservation = await reservePendingBusinessImportObject(prisma, {
      tenantId,
      objectKind: "STAGING",
      objectStorageKey: linkedKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `SMOKE_LINKED:${createdImport.id}`,
      retainUntil: expiresAt,
    });
    await putPendingBusinessImportObject(
      prisma,
      runtime.store,
      linkedReservation,
      new TextEncoder().encode("linked object"),
    );
    await prisma.$transaction(async (tx) => {
      await adoptPendingBusinessImportObject(
        tx,
        linkedReservation,
        "BUSINESS_IMPORT_STAGING",
        expiresAt,
      );
      await tx.businessImport.update({
        where: { id: createdImport.id },
        data: {
          state: "UPLOADED",
          stagingObjectKey: linkedKey,
          stagingEncryptionKeyRef: runtime.objectEncryptionKeyId,
          stagingObjectLedgerId: linkedReservation.ledgerId,
          stagingObjectKind: "STAGING",
          uploadedAt: new Date(),
        },
      });
    });
    assert.equal(
      await cleanupPendingBusinessImportObject(
        prisma,
        runtime.store,
        linkedReservation,
      ),
      false,
    );
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: linkedReservation.ledgerId },
        })
      ).retentionClass,
      "BUSINESS_IMPORT_STAGING",
    );
    assert.ok((await runtime.store.get(linkedKey, runtime.objectEncryptionKeyId)).byteLength > 0);
    const revisionKey = `tenants/smoke/sources/lifecycle/extracted/${randomUUID()}.lvobj`;
    const revisionReservation = await reservePendingBusinessImportObject(prisma, {
      tenantId,
      objectKind: "REVISION_DELTA",
      objectStorageKey: revisionKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `SMOKE_REVISION:${createdImport.id}`,
      retainUntil: expiresAt,
    });
    await putPendingBusinessImportObject(
      prisma,
      runtime.store,
      revisionReservation,
      new TextEncoder().encode("durable revision"),
    );
    await prisma.$transaction((tx) =>
      adoptPendingBusinessImportObject(
        tx,
        revisionReservation,
        "BUSINESS_INFORMATION_REVISION",
        null,
      ),
    );
    const durableRevision = await prisma.businessImportObjectLedger.findUniqueOrThrow({
      where: { id: revisionReservation.ledgerId },
    });
    assert.equal(durableRevision.retentionClass, "BUSINESS_INFORMATION_REVISION");
    assert.equal(durableRevision.retainUntil, null);
    console.log("Business import object lifecycle smoke passed (reserve, replay, adoption, quota race).");
  } finally {
    await prisma?.$disconnect();
    await maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.$disconnect();
    await rm(objectRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
