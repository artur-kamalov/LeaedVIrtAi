import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS,
  businessImportEvidenceRecordHash,
} from "@leadvirt/business-import";
import { Prisma, PrismaClient, type BusinessImport } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  EncryptedFileKnowledgeObjectStore,
  type KnowledgeObjectStore,
} from "@leadvirt/knowledge";
import { sweepBusinessImportPendingObjects } from "./business-import-object-sweeper.js";
import {
  BusinessImportProcessorError,
  cleanupBusinessImportPendingLedgerRows,
  createBusinessImportDependencies,
  processBusinessImportJob,
} from "./business-import-processor.js";

const root = resolve(import.meta.dirname, "../../../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_object_sweep_${process.pid}_${randomBytes(4).toString("hex")}`;
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

class FailOnceStore implements KnowledgeObjectStore {
  private failed = false;

  constructor(
    private readonly delegate: KnowledgeObjectStore,
    private readonly failKey: string,
  ) {}

  put(key: string, value: Uint8Array) {
    return this.delegate.put(key, value);
  }

  get(key: string, encryptionKeyRef: string) {
    return this.delegate.get(key, encryptionKeyRef);
  }

  async delete(key: string) {
    if (key === this.failKey && !this.failed) {
      this.failed = true;
      throw new Error("injected delete failure");
    }
    await this.delegate.delete(key);
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cuid(value: string) {
  return `c${hash(value).slice(0, 24)}`;
}

async function createWorkspace(prisma: PrismaClient, label: string) {
  const identity = randomUUID();
  const tenantId = cuid(`tenant:${label}:${identity}`);
  const userId = cuid(`user:${label}:${identity}`);
  const sourceId = randomUUID();
  await prisma.tenant.create({
    data: { id: tenantId, name: label, slug: `${label.toLowerCase()}-${tenantId}` },
  });
  await prisma.user.create({
    data: { id: userId, email: `${userId}@example.test`, name: `${label} owner` },
  });
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  await prisma.businessImportSource.create({
    data: {
      id: sourceId,
      tenantId,
      lineageKey: `smoke:${label}`,
      displayName: `${label} source`,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  return { tenantId, userId, sourceId };
}

async function main() {
  const maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-object-sweep-"));
  let prisma: PrismaClient | undefined;
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const migrated = await command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
      DATABASE_URL: smokeUrl.toString(),
    });
    assert.equal(migrated.status, 0, migrated.output);
    prisma = new PrismaClient({ datasourceUrl: smokeUrl.toString() });
    const first = await createWorkspace(prisma, "SweepOne");
    const second = await createWorkspace(prisma, "SweepTwo");
    const keyId = "smoke-object-key-v1";
    const store = new EncryptedFileKnowledgeObjectStore({
      rootPath: objectRoot,
      activeKey: { id: keyId, key: randomBytes(32) },
      maxPlaintextBytes: 1024,
    });
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60_000);
    const future = new Date(now.getTime() + 60 * 60_000);
    const objectKey = (tenantId: string, sourceId: string, name: string) =>
      createDeterministicKnowledgeObjectKey({
        tenantId,
        sourceId,
        purpose: "extracted",
        identity: `object-sweeper-smoke:${name}`,
      });
    const keys = {
      failed: objectKey(first.tenantId, first.sourceId, "failed"),
      crossTenant: objectKey(second.tenantId, second.sourceId, "cross-tenant"),
      crashBeforeWrite: objectKey(first.tenantId, first.sourceId, "crash-before-write"),
      legalHold: objectKey(first.tenantId, first.sourceId, "legal-hold"),
      adopted: objectKey(first.tenantId, first.sourceId, "adopted"),
      abandonedUploaded: objectKey(first.tenantId, first.sourceId, "abandoned-uploaded"),
      terminalRepair: objectKey(first.tenantId, first.sourceId, "terminal-repair"),
      terminalLegalHold: objectKey(first.tenantId, first.sourceId, "terminal-legal-hold"),
      referenced: objectKey(first.tenantId, first.sourceId, "referenced"),
      retry: objectKey(first.tenantId, first.sourceId, "retry"),
      stale: objectKey(second.tenantId, second.sourceId, "stale-deleting"),
      processorRetained: objectKey(first.tenantId, first.sourceId, "processor-retained"),
      processorTombstoned: objectKey(first.tenantId, first.sourceId, "processor-tombstoned"),
      processorFailed: objectKey(first.tenantId, first.sourceId, "processor-failed"),
      processorDeleting: objectKey(first.tenantId, first.sourceId, "processor-deleting"),
      durableRaw: objectKey(first.tenantId, first.sourceId, "durable-raw"),
      durableManifest: objectKey(first.tenantId, first.sourceId, "durable-manifest"),
      durableEvidence: objectKey(first.tenantId, first.sourceId, "durable-evidence"),
      durablePreview: objectKey(first.tenantId, first.sourceId, "durable-preview"),
      durableFuture: objectKey(first.tenantId, first.sourceId, "durable-future"),
      durableLegalHold: objectKey(first.tenantId, first.sourceId, "durable-legal-hold"),
      durableNullRetention: objectKey(first.tenantId, first.sourceId, "durable-null-retention"),
      durableWrongClass: objectKey(first.tenantId, first.sourceId, "durable-wrong-class"),
      revisionDelta: objectKey(first.tenantId, first.sourceId, "revision-delta"),
    };
    for (const key of Object.values(keys).filter((key) => key !== keys.crashBeforeWrite)) {
      await store.put(key, new TextEncoder().encode(key));
    }
    const ledger = async (
      tenantId: string,
      key: string,
      data: Partial<Prisma.BusinessImportObjectLedgerUncheckedCreateInput> = {},
    ) =>
      prisma!.businessImportObjectLedger.create({
        data: {
          id: randomUUID(),
          tenantId,
          objectKind: "STAGING",
          objectStorageKey: key,
          encryptionKeyRef: keyId,
          retentionClass: `BUSINESS_IMPORT_PENDING:SMOKE:${randomUUID()}`,
          retainUntil: old,
          createdAt: new Date(old.getTime() - 60_000),
          ...data,
        },
      });
    const failed = await ledger(first.tenantId, keys.failed);
    const crossTenant = await ledger(second.tenantId, keys.crossTenant);
    const crashBeforeWrite = await ledger(first.tenantId, keys.crashBeforeWrite);
    const legalHold = await ledger(first.tenantId, keys.legalHold, {
      legalHold: true,
      retainUntil: old,
    });
    const adopted = await ledger(first.tenantId, keys.adopted, {
      retentionClass: "BUSINESS_IMPORT_STAGING",
      retainUntil: old,
    });
    const abandonedUploaded = await ledger(first.tenantId, keys.abandonedUploaded, {
      retentionClass: "BUSINESS_IMPORT_STAGING",
      retainUntil: future,
    });
    const terminalRepair = await ledger(first.tenantId, keys.terminalRepair, {
      retentionClass: "BUSINESS_IMPORT_STAGING",
      retainUntil: future,
    });
    const terminalLegalHold = await ledger(first.tenantId, keys.terminalLegalHold, {
      retentionClass: "BUSINESS_IMPORT_STAGING",
      retainUntil: future,
      legalHold: true,
    });
    const referenced = await ledger(first.tenantId, keys.referenced);
    const retryLedger = await ledger(first.tenantId, keys.retry, {
      retentionClass: "BUSINESS_IMPORT_STAGING",
      retainUntil: future,
    });
    const stale = await ledger(second.tenantId, keys.stale, {
      deletionState: "DELETING",
      tombstoneReason: "SMOKE_STALE_DELETION",
      tombstonedAt: new Date(old.getTime() + 1_000),
      deletionStartedAt: new Date(old.getTime() + 2_000),
      lastErrorCode: "BUSINESS_IMPORT_PENDING_DELETE_CLAIM:old-worker",
    });
    const processorRetained = await ledger(first.tenantId, keys.processorRetained);
    const processorTombstoned = await ledger(first.tenantId, keys.processorTombstoned, {
      deletionState: "TOMBSTONED",
      tombstoneReason: "PROCESSOR_CLEANUP_SMOKE",
      tombstonedAt: new Date(old.getTime() + 1_000),
    });
    const processorFailed = await ledger(first.tenantId, keys.processorFailed, {
      deletionState: "FAILED",
      tombstoneReason: "PROCESSOR_CLEANUP_SMOKE",
      tombstonedAt: new Date(old.getTime() + 1_000),
      deletionStartedAt: new Date(old.getTime() + 2_000),
      lastErrorCode: "PROCESSOR_CLEANUP_PREVIOUS_FAILURE",
    });
    const processorDeleting = await ledger(first.tenantId, keys.processorDeleting, {
      deletionState: "DELETING",
      tombstoneReason: "PROCESSOR_CLEANUP_SMOKE",
      tombstonedAt: new Date(old.getTime() + 1_000),
      deletionStartedAt: new Date(old.getTime() + 2_000),
      lastErrorCode: "BUSINESS_IMPORT_PENDING_DELETE_CLAIM:abandoned",
    });
    const durableRaw = await ledger(first.tenantId, keys.durableRaw, {
      objectKind: "RAW_ARTIFACT",
      retentionClass: "BUSINESS_IMPORT_RAW",
    });
    const durableManifest = await ledger(first.tenantId, keys.durableManifest, {
      objectKind: "PARSED_MANIFEST",
      retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
    });
    const durableEvidence = await ledger(first.tenantId, keys.durableEvidence, {
      objectKind: "EVIDENCE_EXCERPT",
      retentionClass: "BUSINESS_IMPORT_EVIDENCE",
    });
    const durablePreview = await ledger(first.tenantId, keys.durablePreview, {
      objectKind: "APPLICATION_PREVIEW",
      retentionClass: "BUSINESS_IMPORT_APPLICATION_PREVIEW",
    });
    const durableFuture = await ledger(first.tenantId, keys.durableFuture, {
      objectKind: "RAW_ARTIFACT",
      retentionClass: "BUSINESS_IMPORT_RAW",
      retainUntil: future,
    });
    const durableLegalHold = await ledger(first.tenantId, keys.durableLegalHold, {
      objectKind: "EVIDENCE_EXCERPT",
      retentionClass: "BUSINESS_IMPORT_EVIDENCE",
      legalHold: true,
    });
    const durableNullRetention = await ledger(first.tenantId, keys.durableNullRetention, {
      objectKind: "RAW_ARTIFACT",
      retentionClass: "BUSINESS_IMPORT_RAW",
      retainUntil: null,
    });
    const durableWrongClass = await ledger(first.tenantId, keys.durableWrongClass, {
      objectKind: "RAW_ARTIFACT",
      retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
    });
    const revisionDelta = await ledger(first.tenantId, keys.revisionDelta, {
      objectKind: "REVISION_DELTA",
      retentionClass: "BUSINESS_INFORMATION_REVISION",
      retainUntil: null,
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "BusinessImportObjectLedger"
      SET "updatedAt" = ${old}
      WHERE "id" = ${stale.id}
    `);
    const importData = (
      workspace: typeof first,
      id: string,
      state: "CREATED" | "UPLOADING" | "UPLOADED",
      expiresAt: Date,
    ): Prisma.BusinessImportUncheckedCreateInput => ({
      id,
      tenantId: workspace.tenantId,
      sourceId: workspace.sourceId,
      purpose: "SERVICES",
      format: "CSV",
      state,
      displayName: "Sweep smoke import",
      originalFilename: "services.csv",
      declaredMimeType: "text/csv",
      expectedByteSize: 128n,
      uploadTokenHash: hash(`upload:${id}`),
      baseInformationRevision: 0,
      baseInformationHash: hash(`base:${id}`),
      selectedCategories: ["OFFERINGS"],
      schemaVersion: "leadvirt.services.v1",
      expiresAt,
      createdByUserId: workspace.userId,
    });
    const terminalRepairImportId = randomUUID();
    const terminalLegalHoldImportId = randomUUID();
    for (const terminal of [
      {
        id: terminalRepairImportId,
        state: "FAILED" as const,
        ledger: terminalRepair,
        failureCode: "BUSINESS_IMPORT_LEGACY_TERMINAL_FAILURE",
      },
      {
        id: terminalLegalHoldImportId,
        state: "REJECTED" as const,
        ledger: terminalLegalHold,
        failureCode: "BUSINESS_IMPORT_LEGACY_TERMINAL_REJECTION",
      },
    ]) {
      await prisma.businessImport.create({
        data: {
          ...importData(first, terminal.id, "UPLOADED", future),
          state: terminal.state,
          stagingObjectKey: terminal.ledger.objectStorageKey,
          stagingEncryptionKeyRef: terminal.ledger.encryptionKeyRef,
          stagingObjectLedgerId: terminal.ledger.id,
          stagingObjectKind: "STAGING",
          uploadedAt: old,
          failureCode: terminal.failureCode,
          failureStage: "STORAGE",
          retryable: false,
        },
      });
      await prisma.businessImportQuotaReservation.create({
        data: {
          tenantId: first.tenantId,
          importId: terminal.id,
          rawBytes: 128n,
          retainedBytes: 128n,
          expiresAt: future,
        },
      });
    }
    const durableArtifactId = randomUUID();
    const durableArtifactHash = hash("durable-artifact");
    const durableImportId = randomUUID();
    const durableParsedRevisionId = randomUUID();
    const durableManifestHash = hash("durable-manifest");
    await prisma.businessImportArtifact.create({
      data: {
        id: durableArtifactId,
        tenantId: first.tenantId,
        sourceId: first.sourceId,
        objectStorageKey: durableRaw.objectStorageKey,
        encryptionKeyRef: durableRaw.encryptionKeyRef,
        objectLedgerId: durableRaw.id,
        objectKind: "RAW_ARTIFACT",
        sha256: durableArtifactHash,
        byteSize: 128n,
        declaredMimeType: "text/csv",
        originalFilename: "durable-services.csv",
        malwareStatus: "CLEAN",
        mimeValidationStatus: "VALID",
        scannedAt: now,
      },
    });
    await prisma.businessImport.create({
      data: {
        ...importData(first, durableImportId, "UPLOADED", future),
        state: "PARSING",
        artifactId: durableArtifactId,
        artifactSha256: durableArtifactHash,
        uploadedAt: now,
      },
    });
    await prisma.businessImportParsedRevision.create({
      data: {
        id: durableParsedRevisionId,
        tenantId: first.tenantId,
        sourceId: first.sourceId,
        importId: durableImportId,
        importGeneration: 1,
        artifactId: durableArtifactId,
        artifactSha256: durableArtifactHash,
        manifestObjectLedgerId: durableManifest.id,
        manifestObjectKind: "PARSED_MANIFEST",
        manifestObjectKey: durableManifest.objectStorageKey,
        manifestEncryptionKeyRef: durableManifest.encryptionKeyRef,
        manifestHash: durableManifestHash,
        parserVersion: "sweeper-smoke-parser-v1",
        mapperVersion: "sweeper-smoke-mapper-v1",
        schemaVersion: "leadvirt.services.v1",
        extractionContractVersion: "sweeper-smoke-extraction-v1",
      },
    });
    await prisma.businessImport.update({
      where: { id: durableImportId },
      data: {
        state: "READY_FOR_REVIEW",
        parsedRevisionId: durableParsedRevisionId,
        parsedManifestObjectLedgerId: durableManifest.id,
        parsedManifestObjectKind: "PARSED_MANIFEST",
        parsedManifestObjectKey: durableManifest.objectStorageKey,
        parsedManifestEncryptionKeyRef: durableManifest.encryptionKeyRef,
        parsedManifestHash: durableManifestHash,
        parserVersion: "sweeper-smoke-parser-v1",
        mapperVersion: "sweeper-smoke-mapper-v1",
        parsedAt: now,
        reviewReadyAt: now,
      },
    });
    const systemProvenance = Object.fromEntries(
      BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [path, { authority: "SYSTEM" }]),
    ) as Prisma.InputJsonObject;
    const durableEvidenceIds: string[] = [];
    for (const index of [1, 2]) {
      const candidateId = randomUUID();
      const evidenceId = randomUUID();
      const normalizedValue = { name: `Shared evidence service ${index}`, active: true };
      const normalizedValueHash = hash(JSON.stringify(normalizedValue));
      await prisma.businessImportCandidate.create({
        data: {
          id: candidateId,
          tenantId: first.tenantId,
          sourceId: first.sourceId,
          importId: durableImportId,
          candidateKey: hash(`durable-candidate:${index}`),
          targetCategory: "OFFERINGS",
          semanticTargetKey: `offering:durable:${index}`,
          action: "ADD",
          normalizedValue,
          normalizedValueHash,
          risk: "LOW",
          confidence: "HIGH",
        },
      });
      await prisma.businessImportCandidateRevision.create({
        data: {
          tenantId: first.tenantId,
          sourceId: first.sourceId,
          importId: durableImportId,
          candidateId,
          version: 1,
          parsedRevisionId: durableParsedRevisionId,
          importGeneration: 1,
          artifactId: durableArtifactId,
          artifactSha256: durableArtifactHash,
          parsedManifestHash: durableManifestHash,
          targetCategory: "OFFERINGS",
          semanticTargetKey: `offering:durable:${index}`,
          action: "ADD",
          normalizedValue,
          normalizedValueHash,
          fieldProvenance: systemProvenance,
          risk: "LOW",
          confidence: "HIGH",
        },
      });
      const evidenceRecord = {
        id: evidenceId,
        tenantId: first.tenantId,
        sourceId: first.sourceId,
        importId: durableImportId,
        candidateId,
        candidateVersion: 1,
        candidateValueHash: normalizedValueHash,
        artifactId: durableArtifactId,
        artifactSha256: durableArtifactHash,
        importGeneration: 1,
        parsedRevisionId: durableParsedRevisionId,
        parsedManifestHash: durableManifestHash,
        semanticElementId: null,
        semanticTableId: null,
        locator: { row: index + 1, field: "name" },
        sourceValueHash: hash(`durable-source-value:${index}`),
        excerptHash: hash(`durable-excerpt:${index}`),
        excerptObjectKey: durableEvidence.objectStorageKey,
        excerptEncryptionKeyRef: durableEvidence.encryptionKeyRef,
        excerptObjectLedgerId: durableEvidence.id,
        excerptObjectKind: "EVIDENCE_EXCERPT" as const,
        parserVersion: "sweeper-smoke-parser-v1",
        ocrVersion: null,
        extractionContractVersion: "sweeper-smoke-extraction-v1",
      };
      await prisma.businessImportCandidateEvidence.create({
        data: {
          ...evidenceRecord,
          evidenceRecordHash: businessImportEvidenceRecordHash(evidenceRecord),
        },
      });
      durableEvidenceIds.push(evidenceId);
    }
    const informationRevisionId = randomUUID();
    const informationHash = hash("durable-information-revision");
    await prisma.businessInformationRevision.create({
      data: {
        id: informationRevisionId,
        tenantId: first.tenantId,
        revision: 1,
        canonicalHash: informationHash,
        origin: "IMPORT",
        deltaObjectKey: revisionDelta.objectStorageKey,
        deltaEncryptionKeyRef: revisionDelta.encryptionKeyRef,
        deltaObjectLedgerId: revisionDelta.id,
        deltaObjectKind: "REVISION_DELTA",
        deltaHash: hash("durable-revision-delta"),
        affectedResources: [],
        createdByUserId: first.userId,
      },
    });
    const durableApplicationId = randomUUID();
    const projectionOutboxDedupeKey = `sweeper-smoke:${durableApplicationId}`;
    const projectionOutbox = await prisma.runtimeOutbox.create({
      data: {
        tenantId: first.tenantId,
        aggregateType: "BusinessInformationRevision",
        aggregateId: informationRevisionId,
        aggregateVersion: 1,
        eventType: "business_information.projection.requested",
        dedupeKey: projectionOutboxDedupeKey,
        payload: { revisionId: informationRevisionId },
      },
    });
    await prisma.businessImportApplication.create({
      data: {
        id: durableApplicationId,
        tenantId: first.tenantId,
        sourceId: first.sourceId,
        importId: durableImportId,
        previewManifestHash: hash("durable-preview-manifest"),
        previewObjectLedgerId: durablePreview.id,
        previewObjectKind: "APPLICATION_PREVIEW",
        previewObjectKey: durablePreview.objectStorageKey,
        previewEncryptionKeyRef: durablePreview.encryptionKeyRef,
        candidateManifestHash: hash("durable-candidate-manifest"),
        idempotencyKeyHash: hash("durable-application-idempotency"),
        idempotencyRequestHash: hash("durable-application-idempotency-request"),
        baseInformationRevision: 0,
        baseInformationHash: hash("durable-base-information"),
        resultingInformationRevision: 1,
        resultingInformationHash: informationHash,
        businessRevisionId: informationRevisionId,
        affectedResourceVersions: {},
        projectionOutboxDedupeKey,
        projectionOutboxId: projectionOutbox.id,
        createdByUserId: first.userId,
      },
    });
    const stuckImportId = randomUUID();
    await prisma.businessImport.create({
      data: importData(first, stuckImportId, "UPLOADING", old),
    });
    await prisma.businessImportQuotaReservation.create({
      data: {
        tenantId: first.tenantId,
        importId: stuckImportId,
        rawBytes: 128n,
        retainedBytes: 128n,
        expiresAt: future,
      },
    });
    const retryImportId = randomUUID();
    await prisma.businessImport.create({
      data: {
        ...importData(first, retryImportId, "UPLOADING", future),
        state: "FAILED_RETRYABLE",
        stagingObjectKey: retryLedger.objectStorageKey,
        stagingEncryptionKeyRef: retryLedger.encryptionKeyRef,
        stagingObjectLedgerId: retryLedger.id,
        stagingObjectKind: "STAGING",
        failureCode: "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
        failureStage: "STORAGE",
        retryable: true,
      },
    });
    const retryJobId = `business-import:${retryImportId}:1`;
    const retryRuntimeEventId = randomUUID();
    const retryJobData = {
      tenantId: first.tenantId,
      sourceId: first.sourceId,
      importId: retryImportId,
      generation: 1,
      operation: "PARSE" as const,
      requestedByUserId: first.userId,
      requestedAt: now.toISOString(),
    };
    await prisma.runtimeOutbox.create({
      data: {
        id: retryRuntimeEventId,
        tenantId: first.tenantId,
        aggregateType: "business-import",
        aggregateId: retryImportId,
        aggregateVersion: 1,
        generation: 1,
        eventType: "business.import.parse.requested",
        schemaVersion: 1,
        dedupeKey: retryJobId,
        payload: {
          queueName: "business.import",
          jobName: "parse",
          jobId: retryJobId,
          data: retryJobData,
          attempts: 5,
          backoffMs: 2_000,
        },
        status: "PUBLISHED",
        deadlineAt: future,
        publishedAt: now,
      },
    });
    const abandonedCreatedId = randomUUID();
    await prisma.businessImport.create({
      data: importData(first, abandonedCreatedId, "CREATED", old),
    });
    await prisma.businessImportQuotaReservation.create({
      data: {
        tenantId: first.tenantId,
        importId: abandonedCreatedId,
        rawBytes: 128n,
        retainedBytes: 128n,
        expiresAt: future,
      },
    });
    const abandonedUploadedId = randomUUID();
    await prisma.businessImport.create({
      data: {
        ...importData(first, abandonedUploadedId, "UPLOADED", old),
        stagingObjectKey: abandonedUploaded.objectStorageKey,
        stagingEncryptionKeyRef: abandonedUploaded.encryptionKeyRef,
        stagingObjectLedgerId: abandonedUploaded.id,
        stagingObjectKind: "STAGING",
        uploadedAt: old,
      },
    });
    await prisma.businessImportQuotaReservation.create({
      data: {
        tenantId: first.tenantId,
        importId: abandonedUploadedId,
        rawBytes: 128n,
        retainedBytes: 128n,
        expiresAt: future,
      },
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "BusinessImport"
      SET "updatedAt" = ${old}
      WHERE "id" = ${abandonedUploadedId}
    `);
    const processorDependencies = createBusinessImportDependencies(prisma, {
      objectStore: store,
      objectEncryptionKeyId: keyId,
      scanner: null,
      maxPendingPerTenant: 1,
    });
    const processorCleanupRows = [
      processorRetained,
      processorTombstoned,
      processorFailed,
      processorDeleting,
    ];
    await cleanupBusinessImportPendingLedgerRows(
      first.tenantId,
      processorCleanupRows.map((row) => row.id),
      processorDependencies,
    );
    for (const row of processorCleanupRows) {
      const cleaned: { deletionState: string; retainUntil: Date | null } =
        await prisma.businessImportObjectLedger.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(cleaned.deletionState, "DELETED");
      assert.equal(cleaned.retainUntil?.getTime(), old.getTime());
      await assert.rejects(() => store.get(row.objectStorageKey, keyId));
    }
    await cleanupBusinessImportPendingLedgerRows(
      first.tenantId,
      processorCleanupRows.map((row) => row.id),
      processorDependencies,
    );
    await assert.rejects(
      () =>
        processBusinessImportJob(
          {
            id: retryJobId,
            name: "parse",
            data: {
              ...retryJobData,
              runtimeEventId: retryRuntimeEventId,
              runtimeGeneration: 1,
            },
            signal: new AbortController().signal,
          },
          processorDependencies,
        ),
      (error) =>
        error instanceof BusinessImportProcessorError &&
        error.code === "BUSINESS_IMPORT_PENDING_QUOTA_EXCEEDED",
    );
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: retryImportId } })).state,
      "FAILED_RETRYABLE",
    );
    const referencedImportId = randomUUID();
    await prisma.businessImport.create({
      data: {
        ...importData(first, referencedImportId, "UPLOADED", future),
        stagingObjectKey: referenced.objectStorageKey,
        stagingEncryptionKeyRef: referenced.encryptionKeyRef,
        stagingObjectLedgerId: referenced.id,
        stagingObjectKind: "STAGING",
        uploadedAt: now,
      },
    });
    const dependencies = {
      prisma,
      objectStore: new FailOnceStore(store, failed.objectStorageKey),
      now: () => now,
      id: () => randomUUID(),
      batchSize: 20,
      staleDeletingMs: 15 * 60_000,
    };
    const stuckBeforeSweep = await prisma.businessImport.findUniqueOrThrow({
      where: { id: stuckImportId },
    });
    assert.equal(stuckBeforeSweep.state, "UPLOADING");
    assert.ok(stuckBeforeSweep.expiresAt <= now);
    const firstSweep = await sweepBusinessImportPendingObjects(dependencies);
    assert.equal(firstSweep.terminalImports, 3);
    assert.equal(firstSweep.repairedImports, 2);
    assert.equal(firstSweep.claimedObjects, 10);
    assert.equal(firstSweep.failedObjects, 1);
    assert.equal(firstSweep.deletedObjects, 9);
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: stuckImportId } })).state,
      "EXPIRED",
    );
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: abandonedCreatedId } })).state,
      "EXPIRED",
    );
    const expiredUploaded = await prisma.businessImport.findUniqueOrThrow({
      where: { id: abandonedUploadedId },
    });
    assert.equal(expiredUploaded.state, "EXPIRED");
    assert.equal(expiredUploaded.stagingObjectLedgerId, null);
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: abandonedUploaded.id },
        })
      ).deletionState,
      "DELETED",
    );
    assert.equal(
      (
        await prisma.businessImportQuotaReservation.findUniqueOrThrow({
          where: { tenantId_importId: { tenantId: first.tenantId, importId: stuckImportId } },
        })
      ).status,
      "RELEASED",
    );
    for (const terminal of [
      { importId: terminalRepairImportId, ledger: terminalRepair },
      { importId: terminalLegalHoldImportId, ledger: terminalLegalHold },
    ]) {
      const repaired: BusinessImport = await prisma.businessImport.findUniqueOrThrow({
        where: { id: terminal.importId },
      });
      assert.equal(repaired.stagingObjectLedgerId, null);
      assert.equal(repaired.stagingObjectKey, null);
      assert.equal(repaired.stagingEncryptionKeyRef, null);
      assert.equal(repaired.stagingObjectKind, null);
      assert.equal(repaired.etag, 2);
      assert.equal(
        (
          await prisma.businessImportQuotaReservation.findUniqueOrThrow({
            where: {
              tenantId_importId: {
                tenantId: first.tenantId,
                importId: terminal.importId,
              },
            },
          })
        ).status,
        "RELEASED",
      );
    }
    const deletedRepair = await prisma.businessImportObjectLedger.findUniqueOrThrow({
      where: { id: terminalRepair.id },
    });
    assert.equal(deletedRepair.deletionState, "DELETED");
    assert.equal(deletedRepair.tombstoneReason, "BUSINESS_IMPORT_TERMINAL_STAGING_REPAIR");
    await assert.rejects(() => store.get(terminalRepair.objectStorageKey, keyId));
    const heldRepair = await prisma.businessImportObjectLedger.findUniqueOrThrow({
      where: { id: terminalLegalHold.id },
    });
    assert.equal(heldRepair.legalHold, true);
    assert.equal(heldRepair.deletionState, "RETAINED");
    assert.ok((await store.get(terminalLegalHold.objectStorageKey, keyId)).byteLength > 0);
    const retryAfterSweep = await prisma.businessImport.findUniqueOrThrow({
      where: { id: retryImportId },
    });
    assert.equal(retryAfterSweep.state, "FAILED_RETRYABLE");
    assert.equal(retryAfterSweep.stagingObjectLedgerId, retryLedger.id);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          tenantId: first.tenantId,
          action: "business_import.terminal_staging_repaired",
          entityId: { in: [terminalRepairImportId, terminalLegalHoldImportId] },
        },
      }),
      2,
    );
    assert.equal(
      (await prisma.businessImportObjectLedger.findUniqueOrThrow({ where: { id: failed.id } }))
        .deletionState,
      "FAILED",
    );
    assert.equal(
      (await prisma.businessImportObjectLedger.findUniqueOrThrow({ where: { id: crossTenant.id } }))
        .deletionState,
      "DELETED",
    );
    assert.equal(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: crashBeforeWrite.id },
        })
      ).deletionState,
      "DELETED",
    );
    assert.equal(
      (await prisma.businessImportObjectLedger.findUniqueOrThrow({ where: { id: stale.id } }))
        .deletionState,
      "DELETED",
    );
    for (const durable of [durableRaw, durableManifest, durableEvidence, durablePreview]) {
      const deletedLedger: {
        deletionState: string;
        createdAt: Date;
        retainUntil: Date | null;
        tombstoneReason: string | null;
        tombstonedAt: Date | null;
        deletionStartedAt: Date | null;
        deletedAt: Date | null;
      } = await prisma.businessImportObjectLedger.findUniqueOrThrow({
        where: { id: durable.id },
      });
      assert.equal(deletedLedger.deletionState, "DELETED");
      assert.equal(deletedLedger.createdAt.getTime(), durable.createdAt.getTime());
      assert.equal(deletedLedger.retainUntil?.getTime(), old.getTime());
      assert.equal(deletedLedger.tombstoneReason, "BUSINESS_IMPORT_RETENTION_EXPIRED");
      assert.equal(deletedLedger.tombstonedAt?.getTime(), now.getTime());
      assert.equal(deletedLedger.deletionStartedAt?.getTime(), now.getTime());
      assert.equal(deletedLedger.deletedAt?.getTime(), now.getTime());
      await assert.rejects(() => store.get(durable.objectStorageKey, keyId));
    }
    assert.ok(await prisma.businessImportArtifact.findUnique({ where: { id: durableArtifactId } }));
    assert.ok(
      await prisma.businessImportParsedRevision.findUnique({
        where: { id: durableParsedRevisionId },
      }),
    );
    assert.equal(
      await prisma.businessImportCandidateEvidence.count({
        where: {
          id: { in: durableEvidenceIds },
          excerptObjectLedgerId: durableEvidence.id,
        },
      }),
      2,
    );
    assert.ok(
      await prisma.businessImportApplication.findUnique({
        where: { id: durableApplicationId },
      }),
    );
    assert.ok(
      await prisma.businessInformationRevision.findUnique({
        where: { id: informationRevisionId },
      }),
    );
    const staleWriter = await prisma.businessImportObjectLedger.updateMany({
      where: {
        id: stale.id,
        deletionState: "DELETING",
        lastErrorCode: "BUSINESS_IMPORT_PENDING_DELETE_CLAIM:old-worker",
      },
      data: {
        deletionState: "FAILED",
        lastErrorCode: "OLD_WORKER_FAILURE",
      },
    });
    assert.equal(staleWriter.count, 0);
    for (const id of [
      legalHold.id,
      terminalLegalHold.id,
      adopted.id,
      referenced.id,
      durableFuture.id,
      durableLegalHold.id,
      durableNullRetention.id,
      durableWrongClass.id,
      revisionDelta.id,
    ]) {
      assert.equal(
        (await prisma.businessImportObjectLedger.findUniqueOrThrow({ where: { id } }))
          .deletionState,
        "RETAINED",
      );
    }
    for (const key of [
      keys.legalHold,
      keys.terminalLegalHold,
      keys.adopted,
      keys.referenced,
      keys.durableFuture,
      keys.durableLegalHold,
      keys.durableNullRetention,
      keys.durableWrongClass,
      keys.revisionDelta,
    ]) {
      assert.ok((await store.get(key, keyId)).byteLength > 0);
    }
    const replay = await sweepBusinessImportPendingObjects(dependencies);
    assert.equal(replay.terminalImports, 0);
    assert.equal(replay.repairedImports, 0);
    assert.equal(replay.claimedObjects, 1);
    assert.equal(replay.deletedObjects, 1);
    const settled = await sweepBusinessImportPendingObjects(dependencies);
    assert.deepEqual(settled, {
      terminalImports: 0,
      repairedImports: 0,
      claimedObjects: 0,
      deletedObjects: 0,
      failedObjects: 0,
    });
    assert.equal(
      await prisma.auditLog.count({
        where: {
          tenantId: first.tenantId,
          action: "business_import.terminal_staging_repaired",
          entityId: { in: [terminalRepairImportId, terminalLegalHoldImportId] },
        },
      }),
      2,
    );
    console.log(
      "Business import object sweeper smoke passed (terminal repair, durable expiry, references, holds, fencing, replay).",
    );
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
