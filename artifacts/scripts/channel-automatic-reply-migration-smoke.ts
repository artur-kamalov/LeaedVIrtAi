import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@leadvirt/db";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for the migration smoke.");

const databaseName = `leadvirt_channel_automation_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceDatabaseUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceDatabaseUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

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
    child.once("close", (status) => resolveCommand({ status, stdout, stderr }));
  });
}

function output(result: CommandResult) {
  return `${result.stdout}\n${result.stderr}`;
}

function assertPassed(result: CommandResult, label: string) {
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function migrate(stopAfterChannelActivation = false) {
  return command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
    DATABASE_URL: smokeUrl.toString(),
    ...(stopAfterChannelActivation
      ? {
          NODE_ENV: "test",
          LEADVIRT_MIGRATION_TEST_STOP_AFTER: "channel_automatic_reply_activation",
        }
      : {}),
  });
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
      /Applied channel_automatic_reply_activation migration \(10 statements\)/u,
    );

    database = new PrismaClient({ datasources: { db: { url: smokeUrl.toString() } } });
    const tenantId = "channel-automation-smoke-tenant";
    const channelId = "channel-automation-smoke-channel";
    const conversationId = "channel-automation-smoke-conversation";
    const messageId = "channel-automation-smoke-message";
    const runId = "channel-automation-smoke-run";

    await database.tenant.create({
      data: { id: tenantId, name: "Channel automation smoke", slug: databaseName },
    });
    await database.channel.create({
      data: { id: channelId, tenantId, type: "TELEGRAM", status: "ACTIVE", name: "Smoke" },
    });
    await database.conversation.create({
      data: {
        id: conversationId,
        tenantId,
        channelId,
        aiEnabled: true,
        aiGeneration: 7,
        aiReplySequence: 4,
        aiReplyFence: 4,
      },
    });
    await database.message.create({
      data: {
        id: messageId,
        tenantId,
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Migration smoke",
      },
    });
    await database.aiReplyRun.create({
      data: {
        id: runId,
        tenantId,
        conversationId,
        inboundMessageId: messageId,
        idempotencyKey: "channel-automation-smoke-idempotency",
        inputHash: "a".repeat(64),
        generation: 7,
        sequence: 4,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: new Date(),
      },
    });

    await database.$executeRawUnsafe(
      'ALTER TABLE "Conversation" ALTER COLUMN "aiEnabled" SET DEFAULT true',
    );
    await database.$executeRawUnsafe(`
      ALTER TABLE "Channel"
        DROP COLUMN "automaticRepliesEnabled",
        DROP COLUMN "automaticRepliesGeneration",
        DROP COLUMN "automaticRepliesPublicationId",
        DROP COLUMN "automaticRepliesPublicationEtag",
        DROP COLUMN "automaticRepliesChannelFingerprint",
        DROP COLUMN "automaticRepliesActivatedAt",
        DROP COLUMN "automaticRepliesActivatedByUserId"
    `);

    const backfillMigration = await migrate(true);
    assertPassed(backfillMigration, "backfill migration");
    assert.match(output(backfillMigration), /Applied channel_automatic_reply_activation migration/u);

    const [channel, conversation, run] = await Promise.all([
      database.channel.findUniqueOrThrow({ where: { id: channelId } }),
      database.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      database.aiReplyRun.findUniqueOrThrow({ where: { id: runId } }),
    ]);
    assert.equal(channel.automaticRepliesEnabled, false);
    assert.equal(channel.automaticRepliesGeneration, 1);
    assert.equal(channel.automaticRepliesPublicationId, null);
    assert.equal(channel.automaticRepliesPublicationEtag, null);
    assert.equal(channel.automaticRepliesChannelFingerprint, null);
    assert.equal(channel.automaticRepliesActivatedAt, null);
    assert.equal(channel.automaticRepliesActivatedByUserId, null);
    assert.equal(conversation.aiEnabled, false);
    assert.equal(conversation.aiGeneration, 8);
    assert.equal(conversation.aiReplySequence, 5);
    assert.equal(conversation.aiReplyFence, 5);
    assert.equal(run.status, "SUPERSEDED");
    assert.equal(run.errorCode, "AUTOMATIC_REPLIES_DISABLED_BY_MIGRATION");
    assert.equal(run.errorMessage, null);
    assert.ok(run.completedAt);

    const repeatedMigration = await migrate(true);
    assertPassed(repeatedMigration, "repeated migration");
    assert.match(
      output(repeatedMigration),
      /Channel automatic reply activation already exists; skipping/u,
    );

    await database.$executeRawUnsafe(
      'DROP INDEX "Channel_tenantId_automaticRepliesPublicationId_idx"',
    );
    const partialMigration = await migrate(true);
    assert.notEqual(partialMigration.status, 0, "partial migration unexpectedly passed");
    assert.match(
      output(partialMigration),
      /Channel automatic reply activation is partially installed; refusing to replay its destructive DDL/u,
    );

    console.log("Channel automatic reply migration smoke passed.");
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
