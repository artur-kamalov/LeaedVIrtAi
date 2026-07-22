import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  type BusinessImportFileScanner,
} from "@leadvirt/business-import";
import { PrismaClient } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
} from "@leadvirt/knowledge";
import {
  createBusinessImportDependencies,
  processBusinessImportJob,
} from "./business-import-processor.js";
import { workerJobTimeoutMs } from "../reliability/worker-reliability.js";

const root = resolve(import.meta.dirname, "../../../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_import_capacity_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

const serviceCount = 200;
const evidencePerService = BUSINESS_SERVICES_CSV_HEADERS.length;
const expectedEvidenceCount = serviceCount * evidencePerService;
const requiredDeadlineMarginMs = 60_000;

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

function hash(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function cuid(value: string) {
  return `c${hash(value).slice(0, 24)}`;
}

function serviceValues(index: number) {
  const ordinal = String(index + 1).padStart(3, "0");
  return [
    `service-${ordinal}`,
    "Consulting",
    `Capacity service ${ordinal}`,
    `Detailed capacity description ${ordinal}`,
    "RANGE",
    "100.0000",
    "80.0000",
    "120.0000",
    "USD",
    "session",
    "VAT included",
    "30",
    "60",
    "main-location",
    "Advance booking required",
    "true",
    "2026-01-01",
    "2026-12-31",
    "en-US",
  ];
}

function maximumCsvFixture() {
  const rows = Array.from({ length: serviceCount }, (_, index) => serviceValues(index));
  assert.ok(rows.every((row) => row.length === BUSINESS_SERVICES_CSV_HEADERS.length));
  assert.ok(rows.every((row) => row.every((value) => value.length > 0)));
  const source = [BUSINESS_SERVICES_CSV_HEADERS, ...rows]
    .map((row) => row.join(","))
    .join("\r\n");
  return {
    bytes: new TextEncoder().encode(`${source}\r\n`),
    evidenceBytes: rows.flat().reduce((total, value) => total + Buffer.byteLength(value), 0),
    extractedCharacters: rows.flat().reduce((total, value) => total + value.length, 0),
  };
}

async function main() {
  const maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-import-capacity-"));
  const prismaErrors: string[] = [];
  let prisma: PrismaClient | undefined;
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const migrated = await command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
      DATABASE_URL: smokeUrl.toString(),
    });
    assert.equal(migrated.status, 0, migrated.output);
    const connectedPrisma = new PrismaClient({
      datasourceUrl: smokeUrl.toString(),
      log: [{ emit: "event", level: "error" }],
    });
    connectedPrisma.$on("error", (event) => prismaErrors.push(event.message));
    prisma = connectedPrisma;

    const fixture = maximumCsvFixture();
    const identity = randomUUID();
    const tenantId = cuid(`tenant:${identity}`);
    const userId = cuid(`user:${identity}`);
    const sourceId = randomUUID();
    const importId = randomUUID();
    const stagingLedgerId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const keyId = "capacity-smoke-key-v1";
    const objectStore = new EncryptedFileKnowledgeObjectStore({
      rootPath: objectRoot,
      activeKey: { id: keyId, key: randomBytes(32) },
      maxPlaintextBytes: 10 * 1024 * 1024,
    });
    const stagingObjectKey = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId,
      purpose: "raw",
      identity: `business-import-capacity-staging:${importId}`,
    });
    await objectStore.put(stagingObjectKey, fixture.bytes);

    await prisma.tenant.create({
      data: { id: tenantId, name: "Import capacity smoke", slug: `capacity-${tenantId}` },
    });
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, name: "Capacity owner" },
    });
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    await prisma.businessImportSource.create({
      data: {
        id: sourceId,
        tenantId,
        lineageKey: `capacity-smoke:${identity}`,
        displayName: "Maximum services CSV",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    await prisma.businessImportObjectLedger.create({
      data: {
        id: stagingLedgerId,
        tenantId,
        objectKind: "STAGING",
        objectStorageKey: stagingObjectKey,
        encryptionKeyRef: keyId,
        retentionClass: "BUSINESS_IMPORT_STAGING",
        retainUntil: expiresAt,
      },
    });
    await prisma.businessImport.create({
      data: {
        id: importId,
        tenantId,
        sourceId,
        purpose: "SERVICES",
        format: "CSV",
        state: "SCANNING",
        displayName: "Maximum services CSV",
        originalFilename: "maximum-services.csv",
        declaredMimeType: "text/csv",
        expectedByteSize: BigInt(fixture.bytes.byteLength),
        uploadTokenHash: hash(`capacity-upload:${identity}`),
        stagingObjectKey,
        stagingEncryptionKeyRef: keyId,
        stagingObjectLedgerId: stagingLedgerId,
        stagingObjectKind: "STAGING",
        baseInformationRevision: 0,
        baseInformationHash: hash("empty-business-information"),
        selectedCategories: ["OFFERINGS"],
        schemaVersion: "leadvirt.services.v1",
        expiresAt,
        uploadedAt: now,
        finalizedAt: now,
        createdByUserId: userId,
      },
    });
    await prisma.businessImportQuotaReservation.create({
      data: {
        tenantId,
        importId,
        rawBytes: BigInt(fixture.bytes.byteLength),
        retainedBytes: BigInt(fixture.bytes.byteLength),
        expiresAt,
      },
    });

    const jobId = `business-import:${importId}:1`;
    const runtimeEventId = randomUUID();
    const persistedJobData = {
      tenantId,
      sourceId,
      importId,
      generation: 1,
      operation: "PARSE" as const,
      requestedByUserId: userId,
      requestedAt: now.toISOString(),
    };
    await prisma.runtimeOutbox.create({
      data: {
        id: runtimeEventId,
        tenantId,
        aggregateType: "business-import",
        aggregateId: importId,
        aggregateVersion: 1,
        generation: 1,
        eventType: "business.import.parse.requested",
        schemaVersion: 1,
        dedupeKey: jobId,
        payload: {
          queueName: "business.import",
          jobName: "parse",
          jobId,
          data: persistedJobData,
          attempts: 5,
          backoffMs: 2_000,
        },
        status: "PUBLISHED",
        deadlineAt: new Date(now.getTime() + 24 * 60 * 60_000),
        publishedAt: now,
      },
    });

    let scannerCalls = 0;
    const scanner: BusinessImportFileScanner = {
      identity: {
        provider: "leadvirt-deterministic-clean-smoke",
        version: "capacity-v1",
        approvedForProduction: true,
      },
      scan: ({ bytes, filename, mimeType, signal }) => {
        scannerCalls += 1;
        assert.equal(signal.aborted, false);
        assert.equal(filename, "maximum-services.csv");
        assert.equal(mimeType, "text/csv");
        assert.equal(hash(bytes), hash(fixture.bytes));
        return Promise.resolve({ verdict: "CLEAN" as const });
      },
    };
    const dependencies = createBusinessImportDependencies(prisma, {
      objectStore,
      objectEncryptionKeyId: keyId,
      scanner,
      maxFileBytes: 10 * 1024 * 1024,
      maxPendingPerTenant: 5,
      scannerTimeoutMs: 10_000,
      now: () => new Date(),
      id: () => randomUUID(),
    });
    const job = {
      id: jobId,
      name: "parse",
      data: {
        ...persistedJobData,
        runtimeEventId,
        runtimeGeneration: 1,
      },
    };
    const workerDeadlineMs = workerJobTimeoutMs("business.import");
    const capacityBudgetMs = Math.min(300_000, workerDeadlineMs - requiredDeadlineMarginMs);
    assert.ok(capacityBudgetMs > 0, "Worker deadline leaves no capacity-test margin");
    const startedAt = performance.now();
    let result: Awaited<ReturnType<typeof processBusinessImportJob>>;
    try {
      result = await processBusinessImportJob(
        { ...job, signal: AbortSignal.timeout(capacityBudgetMs) },
        dependencies,
      );
    } catch (error) {
      const failedImport = await prisma.businessImport.findUnique({ where: { id: importId } });
      const ledgerCounts = await prisma.businessImportObjectLedger.groupBy({
        by: ["objectKind", "retentionClass", "deletionState"],
        where: { tenantId },
        _count: true,
      });
      throw new Error(
        `Maximum CSV processing failed: ${JSON.stringify({
          state: failedImport?.state,
          failureCode: failedImport?.failureCode,
          failureStage: failedImport?.failureStage,
          candidates: await prisma.businessImportCandidate.count({ where: { tenantId, importId } }),
          evidence: await prisma.businessImportCandidateEvidence.count({ where: { tenantId, importId } }),
          ledgerCounts,
          prismaErrors,
        })}`,
        { cause: error },
      );
    }
    const durationMs = Math.ceil(performance.now() - startedAt);
    assert.ok(
      durationMs < capacityBudgetMs,
      `Maximum CSV took ${durationMs}ms; budget is ${capacityBudgetMs}ms`,
    );
    assert.ok(
      durationMs + requiredDeadlineMarginMs < workerDeadlineMs,
      `Maximum CSV leaves less than ${requiredDeadlineMarginMs}ms before the worker deadline`,
    );
    assert.deepEqual(result, {
      status: "succeeded",
      importId,
      generation: 1,
      state: "READY_FOR_REVIEW",
      candidateCount: serviceCount,
    });
    assert.equal(scannerCalls, 1);

    const persistedImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: importId },
    });
    assert.equal(persistedImport.state, "READY_FOR_REVIEW");
    assert.equal(persistedImport.stagingObjectKey, null);
    assert.equal(persistedImport.stagingObjectLedgerId, null);
    assert.ok(persistedImport.parsedRevisionId);
    assert.ok(persistedImport.parsedManifestObjectKey);
    assert.ok(persistedImport.parsedManifestEncryptionKeyRef);
    assert.ok(persistedImport.parsedManifestHash);

    assert.equal(
      await prisma.businessImportCandidate.count({ where: { tenantId, importId } }),
      serviceCount,
    );
    assert.equal(
      await prisma.businessImportCandidate.count({
        where: { tenantId, importId, action: "ADD", decision: "PENDING", version: 1 },
      }),
      serviceCount,
    );
    assert.equal(
      await prisma.businessImportCandidateRevision.count({ where: { tenantId, importId } }),
      serviceCount,
    );
    assert.equal(
      await prisma.businessImportCandidateEvidence.count({ where: { tenantId, importId } }),
      expectedEvidenceCount,
    );
    assert.equal(
      await prisma.businessImportCandidateEvidence.count({
        where: { tenantId, importId, candidateVersion: 1, excerptObjectKind: "EVIDENCE_EXCERPT" },
      }),
      expectedEvidenceCount,
    );

    const manifestBytes = await objectStore.get(
      persistedImport.parsedManifestObjectKey,
      persistedImport.parsedManifestEncryptionKeyRef,
    );
    assert.equal(hash(manifestBytes), persistedImport.parsedManifestHash);
    const quota = await prisma.businessImportQuotaReservation.findUniqueOrThrow({
      where: { tenantId_importId: { tenantId, importId } },
    });
    assert.equal(quota.status, "CONSUMED");
    assert.equal(quota.rawBytes, BigInt(fixture.bytes.byteLength));
    assert.equal(quota.expandedBytes, 0n);
    assert.equal(quota.sheetCount, 1);
    assert.equal(quota.rowCount, serviceCount);
    assert.equal(quota.columnCount, evidencePerService);
    assert.equal(quota.cellCount, BigInt(expectedEvidenceCount));
    assert.equal(quota.extractedCharacters, fixture.extractedCharacters);
    assert.equal(quota.candidateCount, serviceCount);
    assert.equal(
      quota.retainedBytes,
      BigInt(fixture.bytes.byteLength + manifestBytes.byteLength + fixture.evidenceBytes),
    );
    assert.ok(quota.consumedAt);
    assert.ok(quota.processorSeconds >= 1);
    assert.ok(quota.processorSeconds * 1_000 <= capacityBudgetMs);

    assert.equal(
      await prisma.businessImportObjectLedger.count({ where: { tenantId } }),
      expectedEvidenceCount + 3,
    );
    assert.equal(
      await prisma.businessImportObjectLedger.count({
        where: {
          tenantId,
          objectKind: "STAGING",
          deletionState: "DELETED",
          tombstoneReason: "PROMOTED_TO_RAW_ARTIFACT",
        },
      }),
      1,
    );
    assert.equal(
      await prisma.businessImportObjectLedger.count({
        where: {
          tenantId,
          objectKind: "RAW_ARTIFACT",
          retentionClass: "BUSINESS_IMPORT_RAW",
          deletionState: "RETAINED",
        },
      }),
      1,
    );
    assert.equal(
      await prisma.businessImportObjectLedger.count({
        where: {
          tenantId,
          objectKind: "PARSED_MANIFEST",
          retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
          deletionState: "RETAINED",
        },
      }),
      1,
    );
    assert.equal(
      await prisma.businessImportObjectLedger.count({
        where: {
          tenantId,
          objectKind: "EVIDENCE_EXCERPT",
          retentionClass: "BUSINESS_IMPORT_EVIDENCE",
          deletionState: "RETAINED",
        },
      }),
      expectedEvidenceCount,
    );
    await assert.rejects(
      () => objectStore.get(stagingObjectKey, keyId),
      (error) => error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_NOT_FOUND",
    );
    const storedFiles = (await readdir(objectRoot, { recursive: true, withFileTypes: true })).filter(
      (entry) => entry.isFile(),
    );
    assert.equal(storedFiles.length, expectedEvidenceCount + 2);

    const countsBeforeReplay = {
      ledgers: await prisma.businessImportObjectLedger.count({ where: { tenantId } }),
      candidates: await prisma.businessImportCandidate.count({ where: { tenantId, importId } }),
      revisions: await prisma.businessImportCandidateRevision.count({ where: { tenantId, importId } }),
      evidence: await prisma.businessImportCandidateEvidence.count({ where: { tenantId, importId } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
    };
    const replay = await processBusinessImportJob(
      { ...job, signal: AbortSignal.timeout(capacityBudgetMs) },
      dependencies,
    );
    assert.deepEqual(replay, {
      status: "already_succeeded",
      importId,
      generation: 1,
      state: "READY_FOR_REVIEW",
    });
    assert.equal(scannerCalls, 1);
    assert.deepEqual(
      {
        ledgers: await prisma.businessImportObjectLedger.count({ where: { tenantId } }),
        candidates: await prisma.businessImportCandidate.count({ where: { tenantId, importId } }),
        revisions: await prisma.businessImportCandidateRevision.count({ where: { tenantId, importId } }),
        evidence: await prisma.businessImportCandidateEvidence.count({ where: { tenantId, importId } }),
        audits: await prisma.auditLog.count({ where: { tenantId } }),
      },
      countsBeforeReplay,
    );

    process.stdout.write(
      `${JSON.stringify({
        status: "business_import_capacity_smoke_passed",
        services: serviceCount,
        columns: evidencePerService,
        evidence: expectedEvidenceCount,
        ledgers: expectedEvidenceCount + 3,
        retainedBytes: quota.retainedBytes.toString(),
        durationMs,
        capacityBudgetMs,
        workerDeadlineMs,
      })}\n`,
    );
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await maintenance
      .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      .catch(() => undefined);
    await maintenance.$disconnect().catch(() => undefined);
    await rm(objectRoot, { recursive: true, force: true });
  }
}

await main();
