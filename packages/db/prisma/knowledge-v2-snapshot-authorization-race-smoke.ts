import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Prisma, PrismaClient } from "@prisma/client";

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
}

interface LockStateRow {
  blockedByWinner: boolean;
  state: string | null;
  waitEvent: string | null;
  waitEventType: string | null;
}

interface BackendPidRow {
  pid: number;
}

interface ItemStateRow {
  pointFingerprint: string;
}

interface SnapshotStateRow {
  status: string;
}

interface PublicationStateRow {
  indexSnapshotId: string | null;
}

interface SnapshotFixture {
  chunkId: string;
  contentHash: string;
  hasItem: boolean;
  key: string;
  originalFingerprint: string;
  snapshotId: string;
  vectorPointId: string;
}

interface PublicationFixture {
  id: string;
  sequence: number;
  targetKey: string;
}

type TransactionAction = (transaction: Prisma.TransactionClient) => Promise<void>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function databaseUrl() {
  const value =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
  const url = new URL(value);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "10");
  return url.toString();
}

function client() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 10_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function transactionBounds(transaction: Prisma.TransactionClient) {
  await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '8s'");
  await transaction.$executeRawUnsafe("SET LOCAL statement_timeout = '12s'");
}

async function backendPid(transaction: Prisma.TransactionClient) {
  const rows = await transaction.$queryRaw<BackendPidRow[]>`
    SELECT pg_backend_pid() AS "pid"
  `;
  assert(rows[0], "The transaction backend PID is unavailable.");
  return rows[0].pid;
}

async function waitForDatabaseLock(
  observer: PrismaClient,
  pid: number,
  winnerPid: number,
  label: string,
) {
  let lastState = "backend missing";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const rows = await observer.$queryRaw<LockStateRow[]>`
      SELECT
        ${winnerPid} = ANY(pg_blocking_pids("pid")) AS "blockedByWinner",
        "state",
        "wait_event_type" AS "waitEventType",
        "wait_event" AS "waitEvent"
      FROM pg_stat_activity
      WHERE "pid" = ${pid}
    `;
    const row = rows[0];
    if (row?.waitEventType === "Lock" && row.blockedByWinner) return;
    lastState = row
      ? `${row.state ?? "unknown"}/${row.waitEventType ?? "none"}/${row.waitEvent ?? "none"}`
      : "backend missing";
    await delay(25);
  }
  throw new Error(`${label} did not block on a PostgreSQL lock; last state: ${lastState}.`);
}

function databaseError(error: unknown) {
  const record = error as {
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  return {
    code: typeof record.meta?.code === "string" ? record.meta.code : "",
    text: [record.message, record.meta?.message]
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
  };
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  label: string,
  sqlState: string,
  messageFragment: string,
) {
  try {
    await operation;
  } catch (error) {
    const failure = databaseError(error);
    assert(
      failure.code === sqlState,
      `${label} failed with SQLSTATE ${failure.code || "unknown"}, expected ${sqlState}.`,
    );
    assert(
      failure.text.includes(messageFragment),
      `${label} did not report ${JSON.stringify(messageFragment)}.`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function runBlockingRace(options: {
  contender: PrismaClient;
  contenderAction: TransactionAction;
  contenderError?: { message: string; sqlState: string };
  first: PrismaClient;
  firstAction: TransactionAction;
  label: string;
  observer: PrismaClient;
}) {
  const firstReady = deferred<number>();
  const releaseFirst = deferred<void>();
  const firstRun = options.first
    .$transaction(
      async (transaction) => {
        await transactionBounds(transaction);
        await options.firstAction(transaction);
        firstReady.resolve(await backendPid(transaction));
        await releaseFirst.promise;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    )
    .catch((error) => {
      firstReady.reject(error);
      throw error;
    });
  void firstRun.catch(() => undefined);

  const firstPid = await withDeadline(firstReady.promise, `${options.label} first transaction`);

  const contenderStarted = deferred<number>();
  const contenderRun = options.contender
    .$transaction(
      async (transaction) => {
        await transactionBounds(transaction);
        contenderStarted.resolve(await backendPid(transaction));
        await options.contenderAction(transaction);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    )
    .catch((error) => {
      contenderStarted.reject(error);
      throw error;
    });
  void contenderRun.catch(() => undefined);

  let lockFailure: unknown;
  try {
    const pid = await withDeadline(
      contenderStarted.promise,
      `${options.label} contender transaction`,
    );
    assert(pid !== firstPid, `${options.label} did not use two independent database connections.`);
    await waitForDatabaseLock(options.observer, pid, firstPid, options.label);
  } catch (error) {
    lockFailure = error;
  } finally {
    releaseFirst.resolve(undefined);
  }

  await withDeadline(firstRun, `${options.label} first transaction commit`);
  if (lockFailure) {
    await contenderRun.catch(() => undefined);
    if (lockFailure instanceof Error) throw lockFailure;
    throw new Error(`${options.label} lock observation failed.`, { cause: lockFailure });
  }

  if (options.contenderError) {
    await expectDatabaseError(
      contenderRun,
      options.label,
      options.contenderError.sqlState,
      options.contenderError.message,
    );
  } else {
    await withDeadline(contenderRun, `${options.label} contender commit`);
  }
}

function fixture(runId: string, key: string, hasItem: boolean): SnapshotFixture {
  return {
    chunkId: `snapshot-auth-race-chunk-${key}-${runId}`,
    contentHash: hash(`content:${key}:${runId}`),
    hasItem,
    key,
    originalFingerprint: hash(`point:${key}:${runId}`),
    snapshotId: `snapshot-auth-race-snapshot-${key}-${runId}`,
    vectorPointId: `snapshot-auth-race-vector-${key}-${runId}`,
  };
}

function publication(runId: string, key: string, sequence: number): PublicationFixture {
  return {
    id: `snapshot-auth-race-publication-${key}-${runId}`,
    sequence,
    targetKey: `snapshot-auth-race-${key}`,
  };
}

function readyAction(snapshotId: string): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      UPDATE "KnowledgeIndexSnapshot"
      SET "status" = 'READY'
      WHERE "id" = ${snapshotId}
    `;
  };
}

function statusAction(snapshotId: string, status: "ABANDONED" | "READY"): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      UPDATE "KnowledgeIndexSnapshot"
      SET "status" = ${status}::"KnowledgeIndexSnapshotStatus"
      WHERE "id" = ${snapshotId}
    `;
  };
}

function insertItemAction(tenantId: string, value: SnapshotFixture): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "KnowledgeV2IndexSnapshotItem" (
        "tenantId",
        "snapshotId",
        "chunkId",
        "corpusKind",
        "contentHash",
        "vectorPointId",
        "pointFingerprint"
      ) VALUES (
        ${tenantId},
        ${value.snapshotId},
        ${value.chunkId},
        'STRUCTURED_V2',
        ${value.contentHash},
        ${value.vectorPointId},
        ${value.originalFingerprint}
      )
    `;
  };
}

function updateItemAction(
  tenantId: string,
  value: SnapshotFixture,
  pointFingerprint: string,
): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      UPDATE "KnowledgeV2IndexSnapshotItem"
      SET "pointFingerprint" = ${pointFingerprint}
      WHERE "tenantId" = ${tenantId}
        AND "snapshotId" = ${value.snapshotId}
        AND "chunkId" = ${value.chunkId}
    `;
  };
}

function deleteItemAction(tenantId: string, value: SnapshotFixture): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      DELETE FROM "KnowledgeV2IndexSnapshotItem"
      WHERE "tenantId" = ${tenantId}
        AND "snapshotId" = ${value.snapshotId}
        AND "chunkId" = ${value.chunkId}
    `;
  };
}

function publicationAction(
  tenantId: string,
  snapshotId: string,
  value: PublicationFixture,
): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "KnowledgePublication" (
        "id",
        "tenantId",
        "targetKey",
        "corpusKind",
        "sequence",
        "indexSnapshotId",
        "manifestHash"
      ) VALUES (
        ${value.id},
        ${tenantId},
        ${value.targetKey},
        'STRUCTURED_V2',
        ${value.sequence},
        ${snapshotId},
        ${hash(`publication:${value.id}`)}
      )
    `;
  };
}

function publicationReferenceUpdateAction(
  publicationId: string,
  snapshotId: string,
): TransactionAction {
  return async (transaction) => {
    await transaction.$executeRaw`
      UPDATE "KnowledgePublication"
      SET "indexSnapshotId" = ${snapshotId}
      WHERE "id" = ${publicationId}
    `;
  };
}

function sequenceActions(...actions: TransactionAction[]): TransactionAction {
  return async (transaction) => {
    for (const action of actions) await action(transaction);
  };
}

async function itemState(database: PrismaClient, tenantId: string, value: SnapshotFixture) {
  return database.$queryRaw<ItemStateRow[]>`
    SELECT "pointFingerprint"
    FROM "KnowledgeV2IndexSnapshotItem"
    WHERE "tenantId" = ${tenantId}
      AND "snapshotId" = ${value.snapshotId}
      AND "chunkId" = ${value.chunkId}
  `;
}

async function snapshotState(database: PrismaClient, snapshotId: string) {
  const rows = await database.$queryRaw<SnapshotStateRow[]>`
    SELECT "status"::text AS "status"
    FROM "KnowledgeIndexSnapshot"
    WHERE "id" = ${snapshotId}
  `;
  assert(rows[0], `Snapshot ${snapshotId} is unavailable.`);
  return rows[0].status;
}

async function publicationExists(database: PrismaClient, publicationId: string) {
  const rows = await database.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "KnowledgePublication" WHERE "id" = ${publicationId}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function publicationSnapshotId(database: PrismaClient, publicationId: string) {
  const rows = await database.$queryRaw<PublicationStateRow[]>`
    SELECT "indexSnapshotId"
    FROM "KnowledgePublication"
    WHERE "id" = ${publicationId}
  `;
  assert(rows[0], `Publication ${publicationId} is unavailable.`);
  return rows[0].indexSnapshotId;
}

async function main() {
  const setup = client();
  const first = client();
  const contender = client();
  const runId = randomUUID();
  const tenantId = `snapshot-auth-race-tenant-${runId}`;
  const sourceId = `snapshot-auth-race-source-${runId}`;
  const documentId = `snapshot-auth-race-document-${runId}`;
  const revisionId = `snapshot-auth-race-revision-${runId}`;
  const fixtures = {
    itemWinsReference: fixture(runId, "item-wins-reference", true),
    itemWinsStatus: fixture(runId, "item-wins-status", true),
    publicationWinsStatus: fixture(runId, "publication-wins-status", false),
    readyDelete: fixture(runId, "ready-delete", true),
    readyInsert: fixture(runId, "ready-insert", false),
    readyUpdate: fixture(runId, "ready-update", true),
    referenceDelete: fixture(runId, "reference-delete", true),
    referenceInsert: fixture(runId, "reference-insert", false),
    referenceUpdate: fixture(runId, "reference-update", true),
    statusWinsPublication: fixture(runId, "status-wins-publication", false),
  };
  const fixtureList = Object.values(fixtures);
  const publicationWinsStatus = publication(runId, "publication-wins-status", 5);
  const statusWinsPublication = publication(runId, "status-wins-publication", 6);
  let checks = 0;

  try {
    const lockFunctions = await setup.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS "count"
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'KnowledgeIndexSnapshot_guard_authorization_mutation',
          'KnowledgeIndexSnapshot_assert_v2_items_mutable'
        )
        AND pg_get_functiondef(oid) LIKE '%FOR UPDATE OF snapshot%'
    `;
    assert(lockFunctions[0]?.count === 2, "Snapshot authorization lock guards are not installed.");
    checks += 1;

    await setup.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`
          INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
          VALUES (
            ${tenantId},
            'Snapshot authorization race smoke',
            ${`snapshot-auth-race-${runId}`},
            CURRENT_TIMESTAMP
          )
        `;
        await transaction.$executeRaw`
          INSERT INTO "KnowledgeV2Source" (
            "id", "tenantId", "kind", "displayName", "defaultClassification", "updatedAt"
          ) VALUES (
            ${sourceId}, ${tenantId}, 'MANUAL', 'Snapshot authorization race smoke',
            'PUBLIC', CURRENT_TIMESTAMP
          )
        `;
        await transaction.$executeRaw`
          INSERT INTO "KnowledgeV2Document" (
            "id", "tenantId", "sourceId", "externalKey", "kind", "title", "classification", "updatedAt"
          ) VALUES (
            ${documentId}, ${tenantId}, ${sourceId}, 'race-document', 'FAQ',
            'Snapshot authorization race document', 'PUBLIC', CURRENT_TIMESTAMP
          )
        `;
        await transaction.$executeRaw`
          INSERT INTO "KnowledgeV2DocumentRevision" (
            "id", "tenantId", "sourceId", "documentId", "revisionNumber", "contentHash",
            "pipelineVersion", "sourcePermissionFingerprint"
          ) VALUES (
            ${revisionId}, ${tenantId}, ${sourceId}, ${documentId}, 1,
            ${hash(`revision:${runId}`)}, 'pipeline-v1', ${hash(`permission:${runId}`)}
          )
        `;

        for (const [ordinal, value] of fixtureList.entries()) {
          await transaction.$executeRaw`
            INSERT INTO "KnowledgeV2Chunk" (
              "id", "tenantId", "revisionId", "documentId", "ordinal", "contentHash",
              "tokenCount", "locale", "classification", "permissionVersion",
              "denseSchemaVersion", "sparseSchemaVersion", "pipelineVersion",
              "vectorPointId", "provenanceRange"
            ) VALUES (
              ${value.chunkId}, ${tenantId}, ${revisionId}, ${documentId}, ${ordinal},
              ${value.contentHash}, 10, 'en', 'PUBLIC', 1, 'dense-v1', 'sparse-v1',
              'pipeline-v1', ${value.vectorPointId},
              ${JSON.stringify({ end: ordinal * 10 + 10, start: ordinal * 10 })}::jsonb
            )
          `;
          await transaction.$executeRaw`
            INSERT INTO "KnowledgeIndexSnapshot" (
              "id", "tenantId", "corpusKind", "status", "collectionName",
              "embeddingProvider", "embeddingModel", "manifestHash", "pipelineVersion",
              "authorizationManifest", "authorizationManifestHash",
              "authorizationManifestVersion", "expectedPointCount"
            ) VALUES (
              ${value.snapshotId}, ${tenantId}, 'STRUCTURED_V2', 'PREPARING',
              ${`snapshot-auth-race-${value.key}`}, 'provider', 'model',
              ${hash(`manifest:${value.key}:${runId}`)}, 'pipeline-v1',
              ${JSON.stringify({ audiences: ["public"] })}::jsonb,
              ${hash(`authorization:${value.key}:${runId}`)}, 1, ${value.hasItem ? 1 : 0}
            )
          `;
          if (value.hasItem) {
            await insertItemAction(tenantId, value)(transaction);
          }
        }

        for (const value of [
          fixtures.publicationWinsStatus,
          fixtures.referenceDelete,
          fixtures.referenceInsert,
          fixtures.referenceUpdate,
          fixtures.statusWinsPublication,
        ]) {
          await readyAction(value.snapshotId)(transaction);
        }
        for (const value of [publicationWinsStatus, statusWinsPublication]) {
          await transaction.$executeRaw`
            INSERT INTO "KnowledgePublication" (
              "id", "tenantId", "targetKey", "corpusKind", "sequence", "manifestHash"
            ) VALUES (
              ${value.id}, ${tenantId}, ${value.targetKey}, 'STRUCTURED_V2',
              ${value.sequence}, ${hash(`publication:${value.id}`)}
            )
          `;
        }
      },
      { timeout: 30_000 },
    );

    const readyFailure = {
      message: "moving it out of READY",
      sqlState: "55000",
    };
    const referenceFailure = {
      message: "immutable after publication",
      sqlState: "55000",
    };

    await runBlockingRace({
      contender,
      contenderAction: insertItemAction(tenantId, fixtures.readyInsert),
      contenderError: readyFailure,
      first,
      firstAction: readyAction(fixtures.readyInsert.snapshotId),
      label: "READY wins against item insert",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.readyInsert)).length === 0,
      "Failed READY insert committed.",
    );
    checks += 3;

    await runBlockingRace({
      contender,
      contenderAction: updateItemAction(
        tenantId,
        fixtures.readyUpdate,
        hash(`ready-update-contender:${runId}`),
      ),
      contenderError: readyFailure,
      first,
      firstAction: readyAction(fixtures.readyUpdate.snapshotId),
      label: "READY wins against item update",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.readyUpdate))[0]?.pointFingerprint ===
        fixtures.readyUpdate.originalFingerprint,
      "Failed READY update committed.",
    );
    checks += 3;

    await runBlockingRace({
      contender,
      contenderAction: deleteItemAction(tenantId, fixtures.readyDelete),
      contenderError: readyFailure,
      first,
      firstAction: readyAction(fixtures.readyDelete.snapshotId),
      label: "READY wins against item delete",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.readyDelete)).length === 1,
      "Failed READY delete committed.",
    );
    checks += 3;

    const referenceInsertPublication = publication(runId, "reference-insert", 1);
    await runBlockingRace({
      contender,
      contenderAction: insertItemAction(tenantId, fixtures.referenceInsert),
      contenderError: referenceFailure,
      first,
      firstAction: publicationAction(
        tenantId,
        fixtures.referenceInsert.snapshotId,
        referenceInsertPublication,
      ),
      label: "publication wins against item insert",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.referenceInsert)).length === 0,
      "Failed published insert committed.",
    );
    checks += 3;

    const referenceUpdatePublication = publication(runId, "reference-update", 2);
    await runBlockingRace({
      contender,
      contenderAction: updateItemAction(
        tenantId,
        fixtures.referenceUpdate,
        hash(`reference-update-contender:${runId}`),
      ),
      contenderError: referenceFailure,
      first,
      firstAction: publicationAction(
        tenantId,
        fixtures.referenceUpdate.snapshotId,
        referenceUpdatePublication,
      ),
      label: "publication wins against item update",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.referenceUpdate))[0]?.pointFingerprint ===
        fixtures.referenceUpdate.originalFingerprint,
      "Failed published update committed.",
    );
    checks += 3;

    const referenceDeletePublication = publication(runId, "reference-delete", 3);
    await runBlockingRace({
      contender,
      contenderAction: deleteItemAction(tenantId, fixtures.referenceDelete),
      contenderError: referenceFailure,
      first,
      firstAction: publicationAction(
        tenantId,
        fixtures.referenceDelete.snapshotId,
        referenceDeletePublication,
      ),
      label: "publication wins against item delete",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.referenceDelete)).length === 1,
      "Failed published delete committed.",
    );
    checks += 3;

    const itemWinsStatusFingerprint = hash(`item-wins-status:${runId}`);
    await runBlockingRace({
      contender,
      contenderAction: readyAction(fixtures.itemWinsStatus.snapshotId),
      first,
      firstAction: updateItemAction(tenantId, fixtures.itemWinsStatus, itemWinsStatusFingerprint),
      label: "item update wins before READY",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.itemWinsStatus))[0]?.pointFingerprint ===
        itemWinsStatusFingerprint,
      "Winning item update did not commit.",
    );
    assert(
      (await snapshotState(setup, fixtures.itemWinsStatus.snapshotId)) === "READY",
      "READY transition did not commit after the item lock released.",
    );
    checks += 4;

    const itemWinsReferencePublication = publication(runId, "item-wins-reference", 4);
    const itemWinsReferenceFingerprint = hash(`item-wins-reference:${runId}`);
    await runBlockingRace({
      contender,
      contenderAction: publicationAction(
        tenantId,
        fixtures.itemWinsReference.snapshotId,
        itemWinsReferencePublication,
      ),
      first,
      firstAction: sequenceActions(
        updateItemAction(tenantId, fixtures.itemWinsReference, itemWinsReferenceFingerprint),
        readyAction(fixtures.itemWinsReference.snapshotId),
      ),
      label: "item update wins before publication attachment",
      observer: setup,
    });
    assert(
      (await itemState(setup, tenantId, fixtures.itemWinsReference))[0]?.pointFingerprint ===
        itemWinsReferenceFingerprint,
      "Winning item update before publication did not commit.",
    );
    assert(
      await publicationExists(setup, itemWinsReferencePublication.id),
      "Publication did not attach after the item lock released.",
    );
    checks += 4;

    await runBlockingRace({
      contender,
      contenderAction: statusAction(fixtures.publicationWinsStatus.snapshotId, "ABANDONED"),
      contenderError: {
        message: "snapshot authorization fields or status are immutable after publication",
        sqlState: "55000",
      },
      first,
      firstAction: publicationReferenceUpdateAction(
        publicationWinsStatus.id,
        fixtures.publicationWinsStatus.snapshotId,
      ),
      label: "publication attachment wins against status mutation",
      observer: setup,
    });
    assert(
      (await snapshotState(setup, fixtures.publicationWinsStatus.snapshotId)) === "READY",
      "Status mutation committed after publication attachment won.",
    );
    assert(
      (await publicationSnapshotId(setup, publicationWinsStatus.id)) ===
        fixtures.publicationWinsStatus.snapshotId,
      "Publication reference update did not commit before the rejected status mutation.",
    );
    checks += 4;

    await runBlockingRace({
      contender,
      contenderAction: publicationReferenceUpdateAction(
        statusWinsPublication.id,
        fixtures.statusWinsPublication.snapshotId,
      ),
      contenderError: {
        message: "publication snapshot must be READY",
        sqlState: "55000",
      },
      first,
      firstAction: statusAction(fixtures.statusWinsPublication.snapshotId, "ABANDONED"),
      label: "non-READY status mutation wins before publication attachment",
      observer: setup,
    });
    assert(
      (await snapshotState(setup, fixtures.statusWinsPublication.snapshotId)) === "ABANDONED",
      "Winning status mutation did not commit.",
    );
    assert(
      (await publicationSnapshotId(setup, statusWinsPublication.id)) === null,
      "Publication attached after the snapshot became non-READY.",
    );
    checks += 4;

    console.log(`Snapshot authorization race smoke passed (${checks} checks).`);
  } finally {
    try {
      await setup.$executeRaw`
        DELETE FROM "KnowledgePublication" WHERE "tenantId" = ${tenantId}
      `;
      await setup.$executeRaw`
        UPDATE "KnowledgeIndexSnapshot"
        SET "status" = 'PREPARING'
        WHERE "tenantId" = ${tenantId} AND "status" = 'READY'
      `;
      await setup.$executeRaw`
        DELETE FROM "KnowledgeV2IndexSnapshotItem" WHERE "tenantId" = ${tenantId}
      `;
      await setup.$executeRaw`
        DELETE FROM "Tenant" WHERE "id" = ${tenantId}
      `;
    } finally {
      await Promise.all([setup.$disconnect(), first.$disconnect(), contender.$disconnect()]);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
