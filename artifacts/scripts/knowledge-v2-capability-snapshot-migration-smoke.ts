import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@leadvirt/db";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for the migration smoke.");

const databaseName = `leadvirt_capability_snapshot_${process.pid}_${randomBytes(4).toString("hex")}`;
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

function migrate() {
  return command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
    DATABASE_URL: smokeUrl.toString(),
  });
}

async function assertRejected(operation: Promise<unknown>, label: string) {
  await assert.rejects(operation, (error: unknown) => {
    assert.match(String(error), /immutable|foreign key constraint/iu, `${label}: ${String(error)}`);
    return true;
  });
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarQuote: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }
    if (singleQuoted) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') doubleQuoted = false;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      continue;
    }
    if (character === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u);
      if (match) {
        dollarQuote = match[0];
        index += dollarQuote.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const statement = sql.slice(start).trim();
  if (statement) statements.push(statement);
  return statements;
}

async function executeStatements(database: PrismaClient, sql: string) {
  for (const statement of splitSqlStatements(sql)) {
    await database.$executeRawUnsafe(statement);
  }
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
    assert.match(output(initialMigration), /Applied knowledge_v2_capability_snapshot migration/u);

    database = new PrismaClient({ datasources: { db: { url: smokeUrl.toString() } } });
    const activeTenantId = "capability-snapshot-active";
    const trialTenantId = "capability-snapshot-trial";
    const suspendedTenantId = "capability-snapshot-suspended";
    const cancelledTenantId = "capability-snapshot-cancelled";
    const deletedTenantId = "capability-snapshot-deleted";
    await database.tenant.createMany({
      data: [
        { id: activeTenantId, name: "Active", slug: `${databaseName}-active`, status: "ACTIVE" },
        { id: trialTenantId, name: "Trial", slug: `${databaseName}-trial`, status: "TRIALING" },
        {
          id: suspendedTenantId,
          name: "Suspended",
          slug: `${databaseName}-suspended`,
          status: "SUSPENDED",
        },
        {
          id: cancelledTenantId,
          name: "Cancelled",
          slug: `${databaseName}-cancelled`,
          status: "CANCELLED",
        },
        {
          id: deletedTenantId,
          name: "Deleted",
          slug: `${databaseName}-deleted`,
          status: "ACTIVE",
          deletedAt: new Date(),
        },
      ],
    });

    const publicationId = "capability-snapshot-publication";
    const channelId = "capability-snapshot-channel";
    const conversationId = "capability-snapshot-conversation";
    const messageId = "capability-snapshot-message";
    const runId = "capability-snapshot-run";
    const outboxId = "capability-snapshot-outbox";
    const operationalBindingHash = "e".repeat(64);
    const operationalPermissionGeneration = 1;
    await database.knowledgePublication.create({
      data: {
        id: publicationId,
        tenantId: activeTenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        operationalBindingSchemaVersion: 1,
        operationalRegistryVersion: "capability-snapshot-smoke-v1",
        operationalRegistryHash: "d".repeat(64),
        operationalDependencySetHash: "d".repeat(64),
        operationalBindingHash,
        operationalPermissionGeneration,
      },
    });
    await database.channel.create({
      data: {
        id: channelId,
        tenantId: activeTenantId,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Smoke",
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 4,
        automaticRepliesPublicationId: publicationId,
        automaticRepliesPublicationEtag: 1,
        automaticRepliesChannelFingerprint: "d".repeat(64),
        automaticRepliesCapabilitySetHash: "b".repeat(64),
        automaticRepliesOperationalBindingHash: operationalBindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalPermissionGeneration,
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: "smoke-owner",
      },
    });
    await database.conversation.create({
      data: {
        id: conversationId,
        tenantId: activeTenantId,
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
        tenantId: activeTenantId,
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Capability migration smoke",
      },
    });
    await database.aiReplyRun.create({
      data: {
        id: runId,
        tenantId: activeTenantId,
        conversationId,
        inboundMessageId: messageId,
        publicationId,
        capabilitySetHash: "b".repeat(64),
        operationalBindingHash,
        operationalPermissionGeneration,
        idempotencyKey: "capability-snapshot-smoke",
        inputHash: "e".repeat(64),
        generation: 7,
        sequence: 4,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: new Date(),
      },
    });
    await database.runtimeOutbox.create({
      data: {
        id: outboxId,
        tenantId: activeTenantId,
        aggregateType: "AiReplyRun",
        aggregateId: runId,
        aggregateVersion: 1,
        eventType: "ai.reply.requested",
        dedupeKey: "capability-snapshot-outbox",
      },
    });

    await executeStatements(
      database,
      `
      DROP TRIGGER "KnowledgeV2PublicationValidation_operational_binding_immutable"
        ON "KnowledgeV2PublicationValidation";
      DROP FUNCTION "KnowledgeV2_reject_validation_operational_binding_mutation"();
      DROP TRIGGER "AiReplyRun_binding_immutable" ON "AiReplyRun";
      DROP FUNCTION "AiReplyRun_reject_binding_mutation"();

      ALTER TABLE "Channel"
        DROP CONSTRAINT "Channel_automaticRepliesPublication_fkey",
        DROP CONSTRAINT "Channel_automaticRepliesBinding_check",
        DROP CONSTRAINT "Channel_automaticRepliesOperationalBindingHash_check",
        DROP CONSTRAINT "Channel_automaticRepliesOperationalPermissionGeneration_check";
      ALTER TABLE "AiReplyRun"
        DROP CONSTRAINT "AiReplyRun_tenant_publication_fkey",
        DROP CONSTRAINT "AiReplyRun_runtimeCapability_fkey",
        DROP CONSTRAINT "AiReplyRun_operationalBinding_check",
        DROP CONSTRAINT "AiReplyRun_capabilityDecision_check";
      ALTER TABLE "KnowledgeV2PublicationValidation"
        DROP CONSTRAINT "KnowledgeV2PublicationValidation_operationalBinding_check";
      ALTER TABLE "KnowledgePublication"
        DROP CONSTRAINT "KnowledgePublication_operationalBinding_check";
      ALTER TABLE "KnowledgePublicationCapability"
        DROP CONSTRAINT "KnowledgePublicationCapability_operationalBinding_check";

      ALTER TABLE "KnowledgeV2PublicationValidation"
        DROP COLUMN "operationalBindingSchemaVersion",
        DROP COLUMN "operationalRegistryVersion",
        DROP COLUMN "operationalRegistryHash",
        DROP COLUMN "operationalDependencySetHash",
        DROP COLUMN "operationalBindingHash",
        DROP COLUMN "operationalPermissionGeneration";
      ALTER TABLE "KnowledgePublication"
        DROP COLUMN "operationalBindingSchemaVersion",
        DROP COLUMN "operationalRegistryVersion",
        DROP COLUMN "operationalRegistryHash",
        DROP COLUMN "operationalDependencySetHash",
        DROP COLUMN "operationalBindingHash",
        DROP COLUMN "operationalPermissionGeneration";
      ALTER TABLE "KnowledgePublicationCapability"
        DROP COLUMN "operationalBindingHash",
        DROP COLUMN "operationalPermissionGeneration";
      ALTER TABLE "Channel"
        DROP COLUMN "automaticRepliesOperationalBindingHash",
        DROP COLUMN "automaticRepliesOperationalPermissionGeneration";
      ALTER TABLE "AiReplyRun"
        DROP COLUMN "operationalBindingHash",
        DROP COLUMN "operationalPermissionGeneration",
        DROP COLUMN "capabilityType",
        DROP COLUMN "allowedAutonomy",
        DROP COLUMN "requiredAutonomy",
        DROP COLUMN "capabilityDecision";
      DROP TYPE "KnowledgeV2CapabilityDecision";

      ALTER TABLE "Channel"
        ADD CONSTRAINT "Channel_automaticRepliesBinding_check" CHECK (
          (
            "automaticRepliesEnabled" = false
            AND "automaticRepliesPublicationId" IS NULL
            AND "automaticRepliesPublicationEtag" IS NULL
            AND "automaticRepliesChannelFingerprint" IS NULL
            AND "automaticRepliesCapabilitySetHash" IS NULL
            AND "automaticRepliesActivatedAt" IS NULL
            AND "automaticRepliesActivatedByUserId" IS NULL
          )
          OR (
            "automaticRepliesEnabled" = true
            AND "automaticRepliesPublicationId" IS NOT NULL
            AND "automaticRepliesPublicationEtag" IS NOT NULL
            AND "automaticRepliesChannelFingerprint" IS NOT NULL
            AND "automaticRepliesCapabilitySetHash" IS NOT NULL
            AND "automaticRepliesActivatedAt" IS NOT NULL
            AND "automaticRepliesActivatedByUserId" IS NOT NULL
          )
        ),
        ADD CONSTRAINT "Channel_automaticRepliesPublication_fkey"
          FOREIGN KEY ("tenantId", "automaticRepliesPublicationId")
          REFERENCES "KnowledgePublication"("tenantId", "id")
          ON DELETE NO ACTION ON UPDATE NO ACTION;
      ALTER TABLE "AiReplyRun"
        ADD CONSTRAINT "AiReplyRun_tenant_publication_fkey"
          FOREIGN KEY ("tenantId", "publicationId")
          REFERENCES "KnowledgePublication"("tenantId", "id")
          ON DELETE NO ACTION ON UPDATE CASCADE;

      CREATE OR REPLACE FUNCTION "Knowledge_reject_publication_mutation"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $knowledge_publication_immutable$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD."status" IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK')
             AND pg_trigger_depth() <= 1 THEN
            RAISE EXCEPTION 'knowledge publication % cannot be deleted after validation', OLD."id"
              USING ERRCODE = '55000';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD."status" IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK') THEN
          IF ROW(
            OLD."id", OLD."tenantId", OLD."targetKey", OLD."corpusKind", OLD."sequence",
            OLD."indexSnapshotId", OLD."basePublicationId", OLD."manifestHash",
            OLD."pipelineVersion", OLD."retrievalPolicyVersion", OLD."promptPolicyVersion",
            OLD."qualitySummary", OLD."createdAt"
          ) IS DISTINCT FROM ROW(
            NEW."id", NEW."tenantId", NEW."targetKey", NEW."corpusKind", NEW."sequence",
            NEW."indexSnapshotId", NEW."basePublicationId", NEW."manifestHash",
            NEW."pipelineVersion", NEW."retrievalPolicyVersion", NEW."promptPolicyVersion",
            NEW."qualitySummary", NEW."createdAt"
          ) THEN
            RAISE EXCEPTION 'knowledge publication % manifest is immutable after validation', OLD."id"
              USING ERRCODE = '55000';
          END IF;
          IF NEW."status" = 'VALIDATING' THEN
            RAISE EXCEPTION 'knowledge publication % cannot return to validation', OLD."id"
              USING ERRCODE = '55000';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $knowledge_publication_immutable$;

      DROP TABLE "KnowledgePublicationCapability";
      DROP TABLE "KnowledgeV2RequirementEvaluation";
      DROP TABLE "KnowledgeV2RequirementDefinition";
      DROP TABLE "KnowledgeV2Capability";
      DROP INDEX "KnowledgeV2PublicationValidation_result_key";
      ALTER TABLE "KnowledgeV2PublicationValidation"
        DROP CONSTRAINT "KnowledgeV2PublicationValidation_capabilityHashes_check",
        DROP COLUMN "capabilitySetHash",
        DROP COLUMN "requirementEvaluationSetHash";
      ALTER TABLE "KnowledgePublication"
        DROP CONSTRAINT "KnowledgePublication_capabilityHashes_check",
        DROP COLUMN "capabilitySetHash",
        DROP COLUMN "requirementEvaluationSetHash";
      ALTER TABLE "Channel"
        DROP CONSTRAINT "Channel_automaticRepliesBinding_check",
        DROP CONSTRAINT "Channel_automaticRepliesCapabilitySetHash_check",
        DROP COLUMN "automaticRepliesCapabilitySetHash";
      ALTER TABLE "Channel"
        ADD CONSTRAINT "Channel_automaticRepliesBinding_check" CHECK (
          (
            "automaticRepliesEnabled" = false
            AND "automaticRepliesPublicationId" IS NULL
            AND "automaticRepliesPublicationEtag" IS NULL
            AND "automaticRepliesChannelFingerprint" IS NULL
            AND "automaticRepliesActivatedAt" IS NULL
            AND "automaticRepliesActivatedByUserId" IS NULL
          )
          OR (
            "automaticRepliesEnabled" = true
            AND "automaticRepliesPublicationId" IS NOT NULL
            AND "automaticRepliesPublicationEtag" IS NOT NULL
            AND "automaticRepliesChannelFingerprint" IS NOT NULL
            AND "automaticRepliesActivatedAt" IS NOT NULL
            AND "automaticRepliesActivatedByUserId" IS NOT NULL
          )
        );
      ALTER TABLE "AiReplyRun"
        DROP CONSTRAINT "AiReplyRun_capabilitySetHash_check",
        DROP COLUMN "capabilitySetHash";
      DROP TYPE "KnowledgeV2RequirementEvaluationStatus";
      DROP TYPE "KnowledgeV2RequirementSeverity";
      DROP TYPE "KnowledgeV2RequirementKind";
      DROP TYPE "KnowledgeV2CapabilityAutonomy";
      DROP TYPE "KnowledgeV2CapabilityType";
    `,
    );

    const backfillMigration = await migrate();
    assertPassed(backfillMigration, "backfill migration");
    assert.match(output(backfillMigration), /Applied knowledge_v2_capability_snapshot migration/u);

    const [activeCapabilities, trialCapabilities, excludedCapabilities, requirements] =
      await Promise.all([
        database.knowledgeV2Capability.findMany({
          where: { tenantId: activeTenantId },
          orderBy: { capabilityType: "asc" },
        }),
        database.knowledgeV2Capability.findMany({ where: { tenantId: trialTenantId } }),
        database.knowledgeV2Capability.count({
          where: { tenantId: { in: [suspendedTenantId, cancelledTenantId, deletedTenantId] } },
        }),
        database.knowledgeV2RequirementDefinition.findMany({
          where: { tenantId: activeTenantId },
        }),
      ]);
    assert.equal(activeCapabilities.length, 8);
    assert.equal(trialCapabilities.length, 8);
    assert.equal(excludedCapabilities, 0);
    assert.deepEqual(
      activeCapabilities
        .filter((capability) => capability.enabled)
        .map((capability) => capability.capabilityType),
      ["GENERAL_FAQ"],
    );
    assert.ok(
      activeCapabilities.every((capability) => capability.allowedAutonomy === "ANSWER_ONLY"),
    );
    assert.ok(activeCapabilities.every((capability) => capability.serverOwned));
    assert.equal(requirements.length, 36);
    assert.deepEqual([...new Set(requirements.map((requirement) => requirement.kind))].sort(), [
      "CONNECTOR",
      "DOCUMENT_COVERAGE",
      "EVALUATION_CASE",
      "FACT",
      "LOCALE",
      "PERMISSION",
      "RULE",
      "TOOL",
    ]);
    for (const requirement of requirements) {
      assert.equal(requirement.definitionVersion, 1);
      assert.equal(requirement.active, true);
      assert.match(requirement.immutableHash, /^[a-f0-9]{64}$/u);
      const predicate = requirement.satisfactionPredicate as Record<string, unknown>;
      assert.equal(predicate.schemaVersion, 1);
      assert.equal(typeof predicate.operator, "string");
      assert.ok(Array.isArray(predicate.values) && predicate.values.length > 0);
    }

    const [channel, conversation, run, outbox, publication] = await Promise.all([
      database.channel.findUniqueOrThrow({ where: { id: channelId } }),
      database.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      database.aiReplyRun.findUniqueOrThrow({ where: { id: runId } }),
      database.runtimeOutbox.findUniqueOrThrow({ where: { id: outboxId } }),
      database.knowledgePublication.findUniqueOrThrow({ where: { id: publicationId } }),
    ]);
    assert.equal(channel.automaticRepliesEnabled, false);
    assert.equal(channel.automaticRepliesGeneration, 6);
    assert.equal(channel.automaticRepliesCapabilitySetHash, null);
    assert.equal(channel.automaticRepliesOperationalBindingHash, null);
    assert.equal(channel.automaticRepliesOperationalPermissionGeneration, null);
    assert.equal(channel.automaticRepliesPublicationId, null);
    assert.equal(conversation.aiEnabled, false);
    assert.equal(conversation.aiGeneration, 9);
    assert.equal(conversation.aiReplySequence, 6);
    assert.equal(conversation.aiReplyFence, 6);
    assert.equal(run.status, "SUPERSEDED");
    assert.equal(run.capabilitySetHash, null);
    assert.equal(run.operationalBindingHash, null);
    assert.equal(run.operationalPermissionGeneration, null);
    assert.equal(run.capabilityDecision, null);
    assert.equal(run.errorCode, "CAPABILITY_SNAPSHOT_REQUIRED_BY_MIGRATION");
    assert.equal(outbox.status, "DEAD_LETTER");
    assert.equal(outbox.lastErrorCode, "CAPABILITY_SNAPSHOT_REQUIRED_BY_MIGRATION");
    assert.equal(publication.capabilitySetHash, null);
    assert.equal(publication.requirementEvaluationSetHash, null);
    assert.equal(publication.operationalBindingHash, null);
    assert.equal(publication.operationalPermissionGeneration, null);

    const faqCapability = activeCapabilities.find(
      (capability) => capability.capabilityType === "GENERAL_FAQ",
    );
    assert.ok(faqCapability);
    const faqRequirement = requirements.find(
      (requirement) => requirement.capabilityId === faqCapability.id,
    );
    assert.ok(faqRequirement);
    const secondFaqRequirement = requirements.find(
      (requirement) =>
        requirement.capabilityId === faqCapability.id && requirement.id !== faqRequirement.id,
    );
    assert.ok(secondFaqRequirement);
    const validation = await database.knowledgeV2PublicationValidation.create({
      data: {
        id: "capability-snapshot-validation",
        tenantId: activeTenantId,
        candidateId: "capability-snapshot-candidate",
        candidateVersion: 1,
        candidateManifestHash: "f".repeat(64),
        publicationId,
        candidateItems: [],
        status: "PASSED",
        capabilitySetHash: "1".repeat(64),
        requirementEvaluationSetHash: "2".repeat(64),
        operationalBindingSchemaVersion: 1,
        operationalRegistryVersion: "capability-snapshot-smoke-v1",
        operationalRegistryHash: "7".repeat(64),
        operationalDependencySetHash: "8".repeat(64),
        operationalBindingHash: "9".repeat(64),
        operationalPermissionGeneration: 2,
        evaluatedAt: new Date(),
      },
    });
    const evaluation = await database.knowledgeV2RequirementEvaluation.create({
      data: {
        id: "capability-snapshot-evaluation",
        tenantId: activeTenantId,
        validationId: validation.id,
        capabilityId: faqCapability.id,
        requirementDefinitionId: faqRequirement.id,
        definitionVersion: faqRequirement.definitionVersion,
        status: "STALE",
        reasonCode: "FRESHNESS_EXPIRED",
        immutableHash: "3".repeat(64),
        evaluatedAt: new Date(),
      },
    });
    const conflictedEvaluation = await database.knowledgeV2RequirementEvaluation.create({
      data: {
        id: "capability-snapshot-conflicted-evaluation",
        tenantId: activeTenantId,
        validationId: validation.id,
        capabilityId: faqCapability.id,
        requirementDefinitionId: secondFaqRequirement.id,
        definitionVersion: secondFaqRequirement.definitionVersion,
        status: "CONFLICTED",
        reasonCode: "HIGH_RISK_CONFLICT",
        immutableHash: "6".repeat(64),
        evaluatedAt: new Date(),
      },
    });
    assert.equal(evaluation.status, "STALE");
    assert.equal(conflictedEvaluation.status, "CONFLICTED");
    const snapshot = await database.knowledgePublicationCapability.create({
      data: {
        tenantId: activeTenantId,
        publicationId,
        validationId: validation.id,
        capabilityId: faqCapability.id,
        capabilityType: faqCapability.capabilityType,
        allowedAutonomy: faqCapability.allowedAutonomy,
        capabilityEtag: faqCapability.etag,
        capabilitySnapshotHash: "4".repeat(64),
        requirementEvaluationSetHash: "2".repeat(64),
        operationalBindingHash: "9".repeat(64),
        operationalPermissionGeneration: 2,
      },
    });
    await assertRejected(
      database.knowledgePublication.update({
        where: { id: publicationId },
        data: {
          operationalBindingSchemaVersion: 1,
          operationalRegistryVersion: "capability-snapshot-smoke-v1",
          operationalRegistryHash: "7".repeat(64),
          operationalDependencySetHash: "8".repeat(64),
          operationalBindingHash: "9".repeat(64),
          operationalPermissionGeneration: 2,
        },
      }),
      "publication operational binding mutation",
    );
    await assertRejected(
      database.knowledgeV2PublicationValidation.update({
        where: { id: validation.id },
        data: { operationalBindingHash: "0".repeat(64) },
      }),
      "validation operational binding mutation",
    );
    await assertRejected(
      database.aiReplyRun.update({
        where: { id: run.id },
        data: { operationalBindingHash: "0".repeat(64) },
      }),
      "run operational binding mutation",
    );
    await assertRejected(
      database.knowledgeV2RequirementDefinition.update({
        where: { id: faqRequirement.id },
        data: { active: false },
      }),
      "requirement definition mutation",
    );
    await assertRejected(
      database.knowledgeV2RequirementEvaluation.update({
        where: { id: evaluation.id },
        data: { reasonCode: "changed" },
      }),
      "requirement evaluation mutation",
    );
    await assertRejected(
      database.knowledgePublicationCapability.update({
        where: {
          publicationId_capabilityId: {
            publicationId: snapshot.publicationId,
            capabilityId: snapshot.capabilityId,
          },
        },
        data: { capabilityEtag: 2, operationalPermissionGeneration: 3 },
      }),
      "publication capability mutation",
    );
    const trialCapability = trialCapabilities[0];
    assert.ok(trialCapability);
    await assertRejected(
      database.knowledgeV2RequirementDefinition.create({
        data: {
          id: "cross-tenant-requirement",
          tenantId: activeTenantId,
          capabilityId: trialCapability.id,
          requirementKey: "cross_tenant",
          definitionVersion: 1,
          kind: "FACT",
          severity: "BLOCKER",
          riskLevel: "LOW",
          satisfactionPredicate: {
            schemaVersion: 1,
            operator: "FACT_KEY_EQUALS",
            values: ["business/name"],
            minimumCount: 1,
          },
          templateOrigin: "SMOKE",
          immutableHash: "5".repeat(64),
        },
      }),
      "cross-tenant requirement",
    );

    const repeatedMigration = await migrate();
    assertPassed(repeatedMigration, "repeated migration");
    assert.match(
      output(repeatedMigration),
      /Knowledge v2 capability snapshot already exists; skipping/u,
    );

    await database.$executeRawUnsafe(
      'DROP INDEX "KnowledgeV2RequirementEvaluation_definition_idx"',
    );
    const partialMigration = await migrate();
    assert.notEqual(partialMigration.status, 0, "partial migration unexpectedly passed");
    assert.match(
      output(partialMigration),
      /Knowledge v2 capability snapshot is partially installed; refusing to replay its destructive DDL/u,
    );

    console.log("Knowledge v2 capability snapshot migration smoke passed.");
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
