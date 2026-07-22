import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Prisma, type PrismaClient } from "@leadvirt/db";
import {
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  type KnowledgeObjectStore,
} from "@leadvirt/knowledge";

const PENDING_RETENTION_PATTERN = "BUSINESS_IMPORT_PENDING:%";
const PENDING_RETENTION_PREFIX = "BUSINESS_IMPORT_PENDING:";
const DELETE_CLAIM_PREFIX = "BUSINESS_IMPORT_PENDING_DELETE_CLAIM";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_STALE_DELETING_MS = 15 * 60_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

type DeletionState = "RETAINED" | "TOMBSTONED" | "DELETING" | "DELETED" | "FAILED";
type ObjectKind =
  | "STAGING"
  | "RAW_ARTIFACT"
  | "PARSED_MANIFEST"
  | "EVIDENCE_EXCERPT"
  | "APPLICATION_PREVIEW"
  | "REVISION_DELTA";

interface CandidateRow {
  id: string;
  tenantId: string;
  objectKind: ObjectKind;
  objectStorageKey: string;
  retentionClass: string;
  deletionState: DeletionState;
}

interface UploadRow {
  id: string;
  tenantId: string;
  createdByUserId: string;
  state: "CREATED" | "UPLOADING" | "UPLOADED";
  stagingObjectLedgerId: string | null;
  stagingObjectKey: string | null;
  stagingEncryptionKeyRef: string | null;
}

interface TerminalImportCandidate {
  id: string;
  tenantId: string;
}

interface TerminalStagingImportRow {
  id: string;
  tenantId: string;
  createdByUserId: string;
  state: "FAILED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  retryable: boolean;
  stagingObjectLedgerId: string;
  stagingObjectKey: string;
  stagingEncryptionKeyRef: string;
  stagingObjectKind: "STAGING";
}

interface ClaimedObject {
  id: string;
  tenantId: string;
  objectKind: ObjectKind;
  objectStorageKey: string;
  retentionClass: string;
  claimToken: string;
}

export interface BusinessImportObjectSweeperDependencies {
  prisma: PrismaClient;
  objectStore: KnowledgeObjectStore;
  now: () => Date;
  id: () => string;
  batchSize: number;
  staleDeletingMs: number;
}

export interface BusinessImportObjectSweepResult {
  terminalImports: number;
  repairedImports: number;
  claimedObjects: number;
  deletedObjects: number;
  failedObjects: number;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function databaseTimestamp(value: Date) {
  return value.toISOString().slice(0, -1);
}

async function expireAbandonedImports(dependencies: BusinessImportObjectSweeperDependencies) {
  const now = dependencies.now();
  const cutoff = databaseTimestamp(now);
  const staleCutoff = databaseTimestamp(
    new Date(now.getTime() - dependencies.staleDeletingMs),
  );
  return dependencies.prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<UploadRow[]>(Prisma.sql`
        SELECT
          "id",
          "tenantId",
          "createdByUserId",
          "state"::text AS "state",
          "stagingObjectLedgerId",
          "stagingObjectKey",
          "stagingEncryptionKeyRef"
        FROM "BusinessImport"
        WHERE (
          (
            "state" IN ('CREATED', 'UPLOADING')
            AND "expiresAt" <= CAST(${cutoff} AS timestamp(3))
          )
          OR (
            "state" = 'UPLOADED'
            AND "expiresAt" <= CAST(${cutoff} AS timestamp(3))
            AND "updatedAt" <= CAST(${staleCutoff} AS timestamp(3))
          )
        )
        ORDER BY "expiresAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${dependencies.batchSize}
      `);
      let terminalImports = 0;
      for (const row of rows) {
        await tx.businessImport.update({
          where: { id: row.id },
          data: {
            state: "EXPIRED",
            failureCode: "BUSINESS_IMPORT_UPLOAD_ABANDONED",
            failureStage: "UPLOAD",
            retryable: false,
            ...(row.state === "UPLOADED"
              ? {
                  stagingObjectKey: null,
                  stagingEncryptionKeyRef: null,
                  stagingObjectLedgerId: null,
                  stagingObjectKind: null,
                }
              : {}),
            etag: { increment: 1 },
          },
        });
        terminalImports += 1;
        await tx.businessImportQuotaReservation.updateMany({
          where: { tenantId: row.tenantId, importId: row.id, status: "RESERVED" },
          data: { status: "RELEASED", releasedAt: now },
        });
        if (
          row.state === "UPLOADED" &&
          row.stagingObjectLedgerId &&
          row.stagingObjectKey &&
          row.stagingEncryptionKeyRef
        ) {
          await tx.businessImportObjectLedger.updateMany({
            where: {
              id: row.stagingObjectLedgerId,
              tenantId: row.tenantId,
              objectKind: "STAGING",
              objectStorageKey: row.stagingObjectKey,
              encryptionKeyRef: row.stagingEncryptionKeyRef,
              retentionClass: "BUSINESS_IMPORT_STAGING",
              deletionState: "RETAINED",
              legalHold: false,
            },
            data: {
              deletionState: "TOMBSTONED",
              tombstoneReason: "BUSINESS_IMPORT_UPLOAD_ABANDONED",
              tombstonedAt: now,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            tenantId: row.tenantId,
            actorUserId: row.createdByUserId,
            action: "business_import.upload_expired",
            entityType: "business_import",
            entityId: row.id,
            payload: {
              reason: "BUSINESS_IMPORT_UPLOAD_ABANDONED",
              previousState: row.state,
            },
          },
        });
      }
      return terminalImports;
    },
    { isolationLevel: "ReadCommitted", timeout: 20_000 },
  );
}

async function repairTerminalStagingPointers(
  dependencies: BusinessImportObjectSweeperDependencies,
) {
  const candidates = await dependencies.prisma.$queryRaw<TerminalImportCandidate[]>(Prisma.sql`
    SELECT "id", "tenantId"
    FROM "BusinessImport"
    WHERE "state" IN ('FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED')
      AND "retryable" = false
      AND "stagingObjectLedgerId" IS NOT NULL
    ORDER BY "updatedAt" ASC, "id" ASC
    LIMIT ${dependencies.batchSize}
  `);
  let repairedImports = 0;
  for (const candidate of candidates) {
    repairedImports += await dependencies.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT TRUE AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(
            ${`business-information-state:${candidate.tenantId}`},
            0
          ))) AS business_information_state_lock
        `);
        const rows = await tx.$queryRaw<TerminalStagingImportRow[]>(Prisma.sql`
          SELECT
            "id",
            "tenantId",
            "createdByUserId",
            "state"::text AS "state",
            "retryable",
            "stagingObjectLedgerId",
            "stagingObjectKey",
            "stagingEncryptionKeyRef",
            "stagingObjectKind"::text AS "stagingObjectKind"
          FROM "BusinessImport"
          WHERE "id" = ${candidate.id}
            AND "tenantId" = ${candidate.tenantId}
          FOR UPDATE
        `);
        const row = rows[0];
        if (
          !row ||
          row.retryable ||
          !["FAILED", "REJECTED", "CANCELLED", "EXPIRED"].includes(row.state) ||
          row.stagingObjectKind !== "STAGING"
        ) {
          return 0;
        }
        const now = dependencies.now();
        const cleared = await tx.businessImport.updateMany({
          where: {
            id: row.id,
            tenantId: row.tenantId,
            state: row.state,
            retryable: false,
            stagingObjectLedgerId: row.stagingObjectLedgerId,
            stagingObjectKey: row.stagingObjectKey,
            stagingEncryptionKeyRef: row.stagingEncryptionKeyRef,
            stagingObjectKind: "STAGING",
          },
          data: {
            stagingObjectLedgerId: null,
            stagingObjectKey: null,
            stagingEncryptionKeyRef: null,
            stagingObjectKind: null,
            etag: { increment: 1 },
          },
        });
        if (cleared.count !== 1) return 0;
        await tx.businessImportQuotaReservation.updateMany({
          where: { tenantId: row.tenantId, importId: row.id, status: "RESERVED" },
          data: { status: "RELEASED", releasedAt: now },
        });
        const tombstoned = await tx.businessImportObjectLedger.updateMany({
          where: {
            id: row.stagingObjectLedgerId,
            tenantId: row.tenantId,
            objectKind: "STAGING",
            objectStorageKey: row.stagingObjectKey,
            encryptionKeyRef: row.stagingEncryptionKeyRef,
            retentionClass: "BUSINESS_IMPORT_STAGING",
            deletionState: "RETAINED",
            legalHold: false,
          },
          data: {
            deletionState: "TOMBSTONED",
            tombstoneReason: "BUSINESS_IMPORT_TERMINAL_STAGING_REPAIR",
            tombstonedAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: row.tenantId,
            actorUserId: row.createdByUserId,
            action: "business_import.terminal_staging_repaired",
            entityType: "business_import",
            entityId: row.id,
            payload: {
              state: row.state,
              stagingLedgerTombstoned: tombstoned.count === 1,
            },
          },
        });
        return 1;
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000 },
    );
  }
  return repairedImports;
}

async function claimExpiredObjects(dependencies: BusinessImportObjectSweeperDependencies) {
  const now = dependencies.now();
  const staleBefore = new Date(now.getTime() - dependencies.staleDeletingMs);
  const cutoff = databaseTimestamp(now);
  const staleCutoff = databaseTimestamp(staleBefore);
  return dependencies.prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT
          ledger."id",
          ledger."tenantId",
          ledger."objectKind"::text AS "objectKind",
          ledger."objectStorageKey",
          ledger."retentionClass",
          ledger."deletionState"::text AS "deletionState"
        FROM "BusinessImportObjectLedger" ledger
        WHERE ledger."legalHold" = false
          AND (
            (
            ledger."retentionClass" LIKE ${PENDING_RETENTION_PATTERN}
            AND (
              (
                ledger."deletionState" = 'RETAINED'
                AND ledger."retainUntil" <= CAST(${cutoff} AS timestamp(3))
              )
              OR ledger."deletionState" IN ('TOMBSTONED', 'FAILED')
              OR (
                ledger."deletionState" = 'DELETING'
                AND ledger."updatedAt" <= CAST(${staleCutoff} AS timestamp(3))
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImport" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."stagingObjectLedgerId" = ledger."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImportArtifact" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."objectLedgerId" = ledger."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImportParsedRevision" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."manifestObjectLedgerId" = ledger."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImportCandidateEvidence" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."excerptObjectLedgerId" = ledger."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImportApplication" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."previewObjectLedgerId" = ledger."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessInformationRevision" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."deltaObjectLedgerId" = ledger."id"
            )
          )
          OR (
            ledger."objectKind" = 'STAGING'::"BusinessImportObjectKind"
            AND ledger."retentionClass" = 'BUSINESS_IMPORT_STAGING'
            AND (
              ledger."deletionState" IN ('TOMBSTONED', 'FAILED')
              OR (
                ledger."deletionState" = 'DELETING'
                AND ledger."updatedAt" <= CAST(${staleCutoff} AS timestamp(3))
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BusinessImport" value
              WHERE value."tenantId" = ledger."tenantId"
                AND value."stagingObjectLedgerId" = ledger."id"
            )
          )
          OR (
            (
              (ledger."objectKind" = 'RAW_ARTIFACT'::"BusinessImportObjectKind"
                AND ledger."retentionClass" = 'BUSINESS_IMPORT_RAW')
              OR (ledger."objectKind" = 'PARSED_MANIFEST'::"BusinessImportObjectKind"
                AND ledger."retentionClass" = 'BUSINESS_IMPORT_PARSED_MANIFEST')
              OR (ledger."objectKind" = 'EVIDENCE_EXCERPT'::"BusinessImportObjectKind"
                AND ledger."retentionClass" = 'BUSINESS_IMPORT_EVIDENCE')
              OR (ledger."objectKind" = 'APPLICATION_PREVIEW'::"BusinessImportObjectKind"
                AND ledger."retentionClass" = 'BUSINESS_IMPORT_APPLICATION_PREVIEW')
            )
            AND ledger."retainUntil" IS NOT NULL
            AND ledger."retainUntil" <= CAST(${cutoff} AS timestamp(3))
            AND (
              ledger."deletionState" IN ('RETAINED', 'TOMBSTONED', 'FAILED')
              OR (
                ledger."deletionState" = 'DELETING'
                AND ledger."updatedAt" <= CAST(${staleCutoff} AS timestamp(3))
              )
            )
          )
        )
        ORDER BY ledger."retainUntil" ASC NULLS FIRST, ledger."createdAt" ASC, ledger."id" ASC
        FOR UPDATE OF ledger SKIP LOCKED
        LIMIT ${dependencies.batchSize}
      `);
      const claimed: ClaimedObject[] = [];
      for (const row of rows) {
        let state = row.deletionState;
        if (state === "DELETING") {
          const abandoned = await tx.businessImportObjectLedger.updateMany({
            where: {
              id: row.id,
              tenantId: row.tenantId,
              objectKind: row.objectKind,
              objectStorageKey: row.objectStorageKey,
              retentionClass: row.retentionClass,
              deletionState: "DELETING",
              updatedAt: { lte: staleBefore },
              legalHold: false,
            },
            data: {
              deletionState: "FAILED",
              lastErrorCode: "BUSINESS_IMPORT_PENDING_DELETE_ABANDONED",
            },
          });
          if (abandoned.count !== 1) continue;
          state = "FAILED";
        }
        if (state === "RETAINED") {
          const tombstoned = await tx.businessImportObjectLedger.updateMany({
            where: {
              id: row.id,
              tenantId: row.tenantId,
              objectKind: row.objectKind,
              objectStorageKey: row.objectStorageKey,
              retentionClass: row.retentionClass,
              deletionState: "RETAINED",
              retainUntil: { lte: now },
              legalHold: false,
            },
            data: {
              deletionState: "TOMBSTONED",
              tombstoneReason: row.retentionClass.startsWith(PENDING_RETENTION_PREFIX)
                ? "BUSINESS_IMPORT_PENDING_RETENTION_EXPIRED"
                : "BUSINESS_IMPORT_RETENTION_EXPIRED",
              tombstonedAt: now,
            },
          });
          if (tombstoned.count !== 1) continue;
          state = "TOMBSTONED";
        }
        if (state !== "TOMBSTONED" && state !== "FAILED") continue;
        const claimToken = `${DELETE_CLAIM_PREFIX}:${dependencies.id()}`;
        const deleting = await tx.businessImportObjectLedger.updateMany({
          where: {
            id: row.id,
            tenantId: row.tenantId,
            objectKind: row.objectKind,
            objectStorageKey: row.objectStorageKey,
            retentionClass: row.retentionClass,
            deletionState: state,
            legalHold: false,
          },
          data: {
            deletionState: "DELETING",
            ...(state === "TOMBSTONED" ? { deletionStartedAt: now } : {}),
            lastErrorCode: claimToken,
          },
        });
        if (deleting.count !== 1) continue;
        claimed.push({ ...row, claimToken });
      }
      return claimed;
    },
    { isolationLevel: "ReadCommitted", timeout: 20_000 },
  );
}

async function deleteClaimedObject(
  object: ClaimedObject,
  dependencies: BusinessImportObjectSweeperDependencies,
) {
  try {
    await dependencies.objectStore.delete(object.objectStorageKey);
    const completed = await dependencies.prisma.businessImportObjectLedger.updateMany({
      where: {
        id: object.id,
        tenantId: object.tenantId,
        objectKind: object.objectKind,
        objectStorageKey: object.objectStorageKey,
        retentionClass: object.retentionClass,
        deletionState: "DELETING",
        lastErrorCode: object.claimToken,
      },
      data: {
        deletionState: "DELETED",
        deletedAt: dependencies.now(),
        lastErrorCode: null,
      },
    });
    return completed.count === 1 ? "deleted" : "skipped";
  } catch {
    const failed = await dependencies.prisma.businessImportObjectLedger.updateMany({
      where: {
        id: object.id,
        tenantId: object.tenantId,
        objectKind: object.objectKind,
        objectStorageKey: object.objectStorageKey,
        retentionClass: object.retentionClass,
        deletionState: "DELETING",
        lastErrorCode: object.claimToken,
      },
      data: {
        deletionState: "FAILED",
        lastErrorCode: "BUSINESS_IMPORT_PENDING_OBJECT_DELETE_FAILED",
      },
    });
    return failed.count === 1 ? "failed" : "skipped";
  }
}

export async function sweepBusinessImportPendingObjects(
  dependencies: BusinessImportObjectSweeperDependencies,
): Promise<BusinessImportObjectSweepResult> {
  const terminalImports = await expireAbandonedImports(dependencies);
  const repairedImports = await repairTerminalStagingPointers(dependencies);
  const claimed = await claimExpiredObjects(dependencies);
  let deletedObjects = 0;
  let failedObjects = 0;
  for (let offset = 0; offset < claimed.length; offset += 8) {
    const results = await Promise.all(
      claimed
        .slice(offset, offset + 8)
        .map((object) => deleteClaimedObject(object, dependencies)),
    );
    deletedObjects += results.filter((result) => result === "deleted").length;
    failedObjects += results.filter((result) => result === "failed").length;
  }
  return {
    terminalImports,
    repairedImports,
    claimedObjects: claimed.length,
    deletedObjects,
    failedObjects,
  };
}

export function createBusinessImportObjectSweeperDependencies(
  prisma: PrismaClient,
): BusinessImportObjectSweeperDependencies | null {
  const rootPath = process.env.KNOWLEDGE_OBJECT_STORE_PATH?.trim() ?? "";
  const encodedKey = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY?.trim() ?? "";
  const keyId = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID?.trim() ?? "";
  if (!rootPath || !isAbsolute(rootPath) || !encodedKey || !keyId) return null;
  try {
    const objectStore = new EncryptedFileKnowledgeObjectStore({
      rootPath,
      activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(encodedKey) },
      maxPlaintextBytes: positiveInteger(
        process.env.BUSINESS_IMPORT_MAX_FILE_BYTES,
        10 * 1024 * 1024,
        64 * 1024 * 1024,
      ),
    });
    return {
      prisma,
      objectStore,
      now: () => new Date(),
      id: () => randomUUID(),
      batchSize: positiveInteger(
        process.env.BUSINESS_IMPORT_PENDING_SWEEP_BATCH_SIZE,
        DEFAULT_BATCH_SIZE,
        1_000,
      ),
      staleDeletingMs: positiveInteger(
        process.env.BUSINESS_IMPORT_PENDING_DELETE_STALE_MS,
        DEFAULT_STALE_DELETING_MS,
        24 * 60 * 60_000,
      ),
    };
  } catch {
    return null;
  }
}

export interface BusinessImportObjectSweeperSchedule {
  stop: () => Promise<void>;
}

export function startBusinessImportObjectSweeper(
  dependencies: BusinessImportObjectSweeperDependencies,
): BusinessImportObjectSweeperSchedule {
  const intervalMs = positiveInteger(
    process.env.BUSINESS_IMPORT_PENDING_SWEEP_INTERVAL_MS,
    DEFAULT_SWEEP_INTERVAL_MS,
    60 * 60_000,
  );
  let stopped = false;
  let running: Promise<void> | null = null;
  const run = () => {
    if (stopped || running) return;
    running = sweepBusinessImportPendingObjects(dependencies)
      .then((result) => {
        if (result.terminalImports || result.repairedImports || result.claimedObjects) {
          console.log(JSON.stringify({ status: "business_import_pending_sweep", ...result }));
        }
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            status: "business_import_pending_sweep_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
