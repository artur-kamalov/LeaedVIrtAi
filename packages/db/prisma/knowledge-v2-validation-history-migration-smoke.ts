import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for the migration smoke.");

const databaseName = `leadvirt_validation_history_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceDatabaseUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceDatabaseUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");
const indexName = "KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key";
const expectedColumns = ["tenantId", "candidateId", "candidateVersion", "validationPolicyVersion"];

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface IndexState {
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  is_live: boolean;
  is_partial: boolean;
  has_expressions: boolean;
  has_owning_constraint: boolean;
  access_method: string;
  key_count: number;
  attribute_count: number;
  columns: string[];
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
    child.once("close", (status) => resolveCommand({ status, stdout, stderr }));
  });
}

function output(result: CommandResult) {
  return `${result.stdout}\n${result.stderr}`;
}

function assertPassed(result: CommandResult, label: string) {
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function migrate() {
  return command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
    DATABASE_URL: smokeUrl.toString(),
  });
}

async function indexState(database: PrismaClient) {
  const rows = await database.$queryRaw<IndexState[]>`
    SELECT
      index_state.indisunique AS "is_unique",
      index_state.indisvalid AS "is_valid",
      index_state.indisready AS "is_ready",
      index_state.indislive AS "is_live",
      index_state.indpred IS NOT NULL AS "is_partial",
      index_state.indexprs IS NOT NULL AS "has_expressions",
      EXISTS (
        SELECT 1 FROM pg_constraint AS owning_constraint
        WHERE owning_constraint.conindid = index_record.oid
      ) AS "has_owning_constraint",
      index_method.amname AS "access_method",
      index_state.indnkeyatts AS "key_count",
      index_state.indnatts AS "attribute_count",
      ARRAY(
        SELECT attribute_record.attname::TEXT
        FROM unnest(index_state.indkey) WITH ORDINALITY
          AS key_record(attribute_number, ordinal_position)
        INNER JOIN pg_attribute AS attribute_record
          ON attribute_record.attrelid = table_record.oid
          AND attribute_record.attnum = key_record.attribute_number
        WHERE key_record.ordinal_position <= index_state.indnkeyatts
        ORDER BY key_record.ordinal_position
      ) AS "columns"
    FROM pg_class AS index_record
    INNER JOIN pg_namespace AS schema_record
      ON schema_record.oid = index_record.relnamespace
      AND schema_record.nspname = 'public'
    INNER JOIN pg_index AS index_state ON index_state.indexrelid = index_record.oid
    INNER JOIN pg_class AS table_record
      ON table_record.oid = index_state.indrelid
      AND table_record.relname = 'KnowledgeV2PublicationValidation'
    INNER JOIN pg_am AS index_method ON index_method.oid = index_record.relam
    WHERE index_record.relname = ${indexName}
  `;
  assert.equal(rows.length, 1, "validation history index is missing or duplicated");
  return rows[0]!;
}

function assertIndexShape(index: IndexState, unique: boolean) {
  assert.equal(index.is_unique, unique);
  assert.equal(index.is_valid, true);
  assert.equal(index.is_ready, true);
  assert.equal(index.is_live, true);
  assert.equal(index.is_partial, false);
  assert.equal(index.has_expressions, false);
  assert.equal(index.has_owning_constraint, false);
  assert.equal(index.access_method, "btree");
  assert.equal(index.key_count, 4);
  assert.equal(index.attribute_count, 4);
  assert.deepEqual(index.columns, expectedColumns);
}

async function main() {
  const maintenance = new PrismaClient({
    datasources: { db: { url: maintenanceUrl.toString() } },
  });
  let database: PrismaClient | null = null;
  let failure: unknown;

  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

    const initialMigration = await migrate();
    assertPassed(initialMigration, "initial migration");
    assert.match(
      output(initialMigration),
      /Applied knowledge_v2_validation_history migration \(2 statements\)/u,
    );

    database = new PrismaClient({ datasources: { db: { url: smokeUrl.toString() } } });
    assertIndexShape(await indexState(database), false);

    const tenantId = "validation-history-tenant";
    const candidateId = "validation-history-candidate";
    const candidateVersion = 7;
    const validationPolicyVersion = "knowledge-v2-history-smoke";
    await database.tenant.create({
      data: {
        id: tenantId,
        name: "Validation history",
        slug: `${databaseName}-tenant`,
        status: "ACTIVE",
      },
    });
    const validationData = {
      tenantId,
      candidateId,
      candidateVersion,
      candidateManifestHash: "a".repeat(64),
      validationPolicyVersion,
      candidateItems: [],
    };
    await database.knowledgeV2PublicationValidation.createMany({
      data: [
        { id: "validation-history-1", ...validationData },
        { id: "validation-history-2", ...validationData },
      ],
    });
    assert.equal(
      await database.knowledgeV2PublicationValidation.count({
        where: { tenantId, candidateId, candidateVersion, validationPolicyVersion },
      }),
      2,
    );

    const repeatedMigration = await migrate();
    assertPassed(repeatedMigration, "repeated migration");
    assert.match(
      output(repeatedMigration),
      /Knowledge v2 validation history already exists; skipping knowledge_v2_validation_history migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied knowledge_v2_validation_history migration/u,
    );

    await database.knowledgeV2PublicationValidation.delete({
      where: { id: "validation-history-2" },
    });
    await database.$executeRawUnsafe(`DROP INDEX "${indexName}"`);
    await database.$executeRawUnsafe(`
      CREATE INDEX "${indexName}"
      ON "KnowledgeV2PublicationValidation"(
        "tenantId", "candidateId", "candidateVersion", "validationPolicyVersion"
      )
      WHERE "status" = 'PENDING'
    `);
    const malformedMigration = await migrate();
    assert.notEqual(malformedMigration.status, 0, "malformed index state unexpectedly passed");
    assert.match(
      output(malformedMigration),
      /Knowledge v2 validation history index is malformed; refusing to skip or replay its destructive DDL/u,
    );

    await database.$executeRawUnsafe(`DROP INDEX "${indexName}"`);
    await database.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${indexName}"
      ON "KnowledgeV2PublicationValidation"(
        "tenantId", "candidateId", "candidateVersion", "validationPolicyVersion"
      )
    `);
    assertIndexShape(await indexState(database), true);

    const legacyUpgrade = await migrate();
    assertPassed(legacyUpgrade, "legacy unique index upgrade");
    assert.match(
      output(legacyUpgrade),
      /Applied knowledge_v2_validation_history migration \(2 statements\)/u,
    );
    assertIndexShape(await indexState(database), false);

    await database.knowledgeV2PublicationValidation.create({
      data: { id: "validation-history-3", ...validationData },
    });
    assert.equal(
      await database.knowledgeV2PublicationValidation.count({
        where: { tenantId, candidateId, candidateVersion, validationPolicyVersion },
      }),
      2,
    );

    const finalMigration = await migrate();
    assertPassed(finalMigration, "final repeated migration");
    assert.match(
      output(finalMigration),
      /Knowledge v2 validation history already exists; skipping knowledge_v2_validation_history migration/u,
    );
    assertIndexShape(await indexState(database), false);

    console.log("Knowledge v2 validation history migration smoke passed.");
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

  if (failure instanceof Error) throw failure;
  if (failure !== undefined) {
    throw new Error("Validation history migration smoke failed.", { cause: failure });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
