import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@leadvirt/db";
import {
  createKnowledgeV2QueryHashKeyring,
  KNOWLEDGE_V2_QUERY_HASH_VERSION,
} from "@leadvirt/knowledge";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for the registry smoke.");

const databaseName = `leadvirt_hmac_registry_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceDatabaseUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceDatabaseUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");
const migrationRunnerLockName = `leadvirt.custom-migration-runner.v1:${databaseName}`;

const keyId = "registry-smoke-v1";
const retainedKeyId = "registry-smoke-retained-v1";
const key = Buffer.alloc(32, 0x31).toString("base64");
const wrongKey = Buffer.alloc(32, 0x32).toString("base64");
const retainedKey = Buffer.alloc(32, 0x33).toString("base64");
const keyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: keyId,
  keys: { [keyId]: key },
});
assert(Object.isFrozen(keyring.configuredKeyChecks));
assert(Object.isFrozen(keyring.configuredKeyChecks[0]));
assert.match(keyring.configuredKeyChecks[0]?.keyCheck ?? "", /^[a-f0-9]{64}$/u);

const testCaseMetadataConstraint = `
  ALTER TABLE "KnowledgeV2TestCaseVersion"
  ADD CONSTRAINT "KnowledgeV2TestCaseVersion_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  )
`;
const liveToolMetadataConstraint = `
  ALTER TABLE "KnowledgeV2LiveToolExecution"
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  )
`;

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function command(args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")] : args;
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, commandArgs, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (status) => {
      resolveCommand({ status, stdout, stderr });
    });
  });
}

function output(result: CommandResult) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function assertPassed(result: CommandResult, label: string) {
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function migrate() {
  return command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
    DATABASE_URL: smokeUrl.toString(),
  });
}

async function assertMetadataMigrationRejected(label: string) {
  const result = await migrate();
  assert.notEqual(result.status, 0, `${label} unexpectedly passed.`);
  assert.match(
    output(result),
    /Knowledge v2 query hash metadata is partially installed; refusing to replay its DDL/u,
  );
}

function readiness(keys: Record<string, string>, activeKeyId = keyId) {
  return command(
    [
      "pnpm",
      "--filter",
      "@leadvirt/api",
      "exec",
      "tsx",
      "../../artifacts/scripts/knowledge-query-hmac-retained-keys-ready.ts",
    ],
    {
      DATABASE_URL: smokeUrl.toString(),
      NODE_ENV: "production",
      APP_ENV: "production",
      KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID: activeKeyId,
      KNOWLEDGE_QUERY_HMAC_KEYS: JSON.stringify(keys),
    },
  );
}

async function holdMigrationRunnerLock(maintenance: PrismaClient) {
  let releaseTransaction!: () => void;
  let resolveAcquired!: () => void;
  let rejectAcquired!: (reason: unknown) => void;
  let transactionFailure: unknown;
  const released = new Promise<void>((resolveReleased) => {
    releaseTransaction = resolveReleased;
  });
  const acquired = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  const transaction = maintenance
    .$transaction(
      async (lockTransaction) => {
        await lockTransaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${migrationRunnerLockName}, 0))
        `;
        resolveAcquired();
        await released;
      },
      { maxWait: 10_000, timeout: 60_000 },
    )
    .catch((error: unknown) => {
      transactionFailure = error;
      rejectAcquired(error);
    });
  await acquired;

  return async () => {
    releaseTransaction();
    await transaction;
    if (transactionFailure) throw transactionFailure;
  };
}

async function waitForMigrationLockWaiters(database: PrismaClient) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await database.$queryRaw<Array<{ waiterCount: number }>>`
      SELECT COUNT(*)::int AS "waiterCount"
      FROM pg_stat_activity
      WHERE datname = 'postgres'
        AND usename = current_user
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
        AND query LIKE '%pg_advisory_xact_lock%'
    `;
    if ((rows[0]?.waiterCount ?? 0) >= 2) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Concurrent migration runners did not wait on the global advisory lock.");
}

function evaluationRun(input: {
  id: string;
  tenantId: string;
  queryHash: string | null;
  queryHashKeyId?: string | null;
  queryHashVersion?: string | null;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    runKey: input.id,
    runKind: "PLAYGROUND" as const,
    snapshotKind: "DRAFT_CANDIDATE" as const,
    candidateId: `${input.id}-candidate`,
    candidateVersion: 1,
    candidateManifestHash: "f".repeat(64),
    datasetVersion: "registry-smoke-dataset-v1",
    testCaseSetHash: "a".repeat(64),
    configHash: "b".repeat(64),
    queryHash: input.queryHash,
    queryHashKeyId: input.queryHashKeyId ?? null,
    queryHashVersion: input.queryHashVersion ?? null,
    restrictedInputRef: input.queryHash === null ? null : `registry-smoke://input/${input.id}`,
    retrievalPolicyVersion: "registry-smoke-retrieval-v1",
    promptPolicyVersion: "registry-smoke-prompt-v1",
    graphVersion: "registry-smoke-graph-v1",
    codeCommit: "registry-smoke",
    environment: "test",
  };
}

async function main() {
  const maintenance = new PrismaClient({
    datasources: { db: { url: maintenanceUrl.toString() } },
  });
  let database: PrismaClient | null = null;
  let failure: unknown;

  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    database = new PrismaClient({ datasources: { db: { url: smokeUrl.toString() } } });

    const releaseMigrationRunnerLock = await holdMigrationRunnerLock(maintenance);
    const concurrentMigrations = [migrate(), migrate()];
    let waiterFailure: unknown;
    try {
      await waitForMigrationLockWaiters(database);
    } catch (error) {
      waiterFailure = error;
    }
    try {
      await releaseMigrationRunnerLock();
    } catch (error) {
      waiterFailure ??= error;
    }
    const concurrentResults = await Promise.all(concurrentMigrations);
    concurrentResults.forEach((result, index) =>
      assertPassed(result, `concurrent migration ${index + 1}`),
    );
    if (waiterFailure) throw waiterFailure;
    const concurrentOutput = concurrentResults.map(output).join("\n");
    assert.equal(
      concurrentOutput.match(/Applied knowledge_v2_query_hash_metadata migration/gu)?.length ?? 0,
      1,
    );
    assert.equal(concurrentOutput.match(/query hash metadata already exists/gu)?.length ?? 0, 1);
    assert.equal(
      concurrentOutput.match(/Applied knowledge_v2_query_hash_key_registry migration/gu)?.length ??
        0,
      1,
    );
    assert.equal(
      concurrentOutput.match(/query hash key registry already exists/gu)?.length ?? 0,
      1,
    );

    const repeatedMigration = await migrate();
    assertPassed(repeatedMigration, "repeat migration");
    assert.match(output(repeatedMigration), /query hash key registry already exists/u);

    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2TestCaseVersion"
      ALTER COLUMN "queryHashVersion" TYPE VARCHAR(128)
    `);
    await assertMetadataMigrationRejected("wrong metadata column type");
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2TestCaseVersion"
      ALTER COLUMN "queryHashVersion" TYPE TEXT
    `);
    assertPassed(await migrate(), "metadata column type restoration");

    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2TestCaseVersion"
      ALTER COLUMN "queryHashKeyId" SET NOT NULL
    `);
    await assertMetadataMigrationRejected("wrong metadata column nullability");
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2TestCaseVersion"
      ALTER COLUMN "queryHashKeyId" DROP NOT NULL
    `);
    assertPassed(await migrate(), "metadata column nullability restoration");

    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2TestCaseVersion"
      DROP CONSTRAINT "KnowledgeV2TestCaseVersion_query_hash_metadata_check"
    `);
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2EvaluationRun"
      ADD CONSTRAINT "KnowledgeV2TestCaseVersion_query_hash_metadata_check" CHECK (TRUE)
    `);
    await assertMetadataMigrationRejected("wrong metadata constraint target");
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2EvaluationRun"
      DROP CONSTRAINT "KnowledgeV2TestCaseVersion_query_hash_metadata_check"
    `);
    await database.$executeRawUnsafe(testCaseMetadataConstraint);
    assertPassed(await migrate(), "metadata constraint target restoration");

    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2LiveToolExecution"
      DROP CONSTRAINT "KnowledgeV2LiveToolExecution_query_hash_metadata_check"
    `);
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2LiveToolExecution"
      ADD CONSTRAINT "KnowledgeV2LiveToolExecution_query_hash_metadata_check"
      CHECK ("queryHashKeyId" IS NULL OR "queryHashVersion" IS NOT NULL)
    `);
    await assertMetadataMigrationRejected("wrong metadata constraint definition");
    await database.$executeRawUnsafe(`
      ALTER TABLE "KnowledgeV2LiveToolExecution"
      DROP CONSTRAINT "KnowledgeV2LiveToolExecution_query_hash_metadata_check"
    `);
    await database.$executeRawUnsafe(liveToolMetadataConstraint);
    assertPassed(await migrate(), "metadata constraint definition restoration");

    const firstRegistration = await readiness({ [keyId]: key });
    assertPassed(firstRegistration, "first key registration");
    assert.match(output(firstRegistration), /1 new registry entries/u);
    const repeatedRegistration = await readiness({ [keyId]: key });
    assertPassed(repeatedRegistration, "repeated key registration");
    assert.match(output(repeatedRegistration), /0 new registry entries/u);

    const wrongMaterial = await readiness({ [keyId]: wrongKey });
    assert.notEqual(wrongMaterial.status, 0);
    assert.match(output(wrongMaterial), /does not match the immutable registry/u);

    for (const operation of [
      () =>
        database!.knowledgeV2QueryHashKeyRegistry.update({
          where: { keyId },
          data: { keyCheck: "c".repeat(64) },
        }),
      () => database!.knowledgeV2QueryHashKeyRegistry.delete({ where: { keyId } }),
    ]) {
      await assert.rejects(operation, (error) => {
        const message = String(error);
        return message.includes('code: "55000"') && message.includes("registry rows are immutable");
      });
    }

    const tenantId = "registry-smoke-tenant";
    await database.tenant.create({
      data: { id: tenantId, name: "Registry smoke", slug: `${databaseName}-tenant` },
    });
    await database.knowledgeV2EvaluationRun.create({
      data: evaluationRun({
        id: "registry-smoke-retained-run",
        tenantId,
        queryHash: "d".repeat(64),
        queryHashKeyId: retainedKeyId,
        queryHashVersion: KNOWLEDGE_V2_QUERY_HASH_VERSION,
      }),
    });

    const missingVerifier = await readiness({ [keyId]: key });
    assert.notEqual(missingVerifier.status, 0);
    assert.match(
      output(missingVerifier),
      /Missing query HMAC verifier keys required by retained records/u,
    );
    assert.match(output(missingVerifier), new RegExp(retainedKeyId, "u"));

    const unregisteredRetained = await readiness({ [keyId]: key, [retainedKeyId]: retainedKey });
    assert.notEqual(unregisteredRetained.status, 0);
    assert.match(output(unregisteredRetained), /refusing first-use adoption/u);
    assert.match(output(unregisteredRetained), new RegExp(retainedKeyId, "u"));

    await database.knowledgeV2EvaluationRun.delete({
      where: { id: "registry-smoke-retained-run" },
    });
    await database.knowledgeV2EvaluationRun.createMany({
      data: [
        evaluationRun({
          id: "registry-smoke-null-batch",
          tenantId,
          queryHash: null,
        }),
        evaluationRun({
          id: "registry-smoke-legacy-query",
          tenantId,
          queryHash: "e".repeat(64),
        }),
      ],
    });

    const legacy = await readiness({ [keyId]: key });
    assert.notEqual(legacy.status, 0);
    assert.match(
      output(legacy),
      /Legacy query hashes without HMAC key metadata must be remediated before deploy \(1 total\); KnowledgeV2TestCaseVersion=0; KnowledgeV2EvaluationRun=1; KnowledgeV2RetrievalTrace=0; KnowledgeV2LiveToolExecution=0/u,
    );

    await database.knowledgeV2EvaluationRun.delete({
      where: { id: "registry-smoke-legacy-query" },
    });
    const nullBatchIgnored = await readiness({ [keyId]: key });
    assertPassed(nullBatchIgnored, "null-query evaluation batch readiness");

    console.log("Knowledge query HMAC registry smoke passed.");
  } catch (error) {
    failure = error;
  }

  for (const cleanup of [
    async () => database?.$disconnect(),
    async () =>
      maintenance.$queryRawUnsafe(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        databaseName,
      ),
    async () => maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`),
    async () => maintenance.$disconnect(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
