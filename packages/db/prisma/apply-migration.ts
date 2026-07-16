import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const migrationUrl = new URL(
  "./migrations/20260619154500_phase_2_core/migration.sql",
  import.meta.url,
);
const authSessionsMigrationUrl = new URL(
  "./migrations/20260627120000_auth_sessions/migration.sql",
  import.meta.url,
);
const authSessionMetadataMigrationUrl = new URL(
  "./migrations/20260627123000_auth_session_metadata/migration.sql",
  import.meta.url,
);
const passwordChangeRequiredMigrationUrl = new URL(
  "./migrations/20260627124500_password_change_required/migration.sql",
  import.meta.url,
);
const userTwoFactorMigrationUrl = new URL(
  "./migrations/20260702140000_user_two_factor/migration.sql",
  import.meta.url,
);
const passwordResetTokensMigrationUrl = new URL(
  "./migrations/20260702143000_password_reset_tokens/migration.sql",
  import.meta.url,
);
const userPhoneMigrationUrl = new URL(
  "./migrations/20260705120000_user_phone/migration.sql",
  import.meta.url,
);
const businessKnowledgeSourcesMigrationUrl = new URL(
  "./migrations/20260705133000_business_knowledge_sources/migration.sql",
  import.meta.url,
);
const businessKnowledgeChunksMigrationUrl = new URL(
  "./migrations/20260705143000_business_knowledge_chunks/migration.sql",
  import.meta.url,
);
const emailOtpAuthMigrationUrl = new URL(
  "./migrations/20260710190000_email_otp_auth/migration.sql",
  import.meta.url,
);
const businessKnowledgePublicationFoundationMigrationUrl = new URL(
  "./migrations/20260712120000_business_knowledge_publication_foundation/migration.sql",
  import.meta.url,
);
const aiReplyReliabilityFoundationMigrationUrl = new URL(
  "./migrations/20260712130000_ai_reply_reliability_foundation/migration.sql",
  import.meta.url,
);
const runtimeRelationshipHardeningMigrationUrl = new URL(
  "./migrations/20260712140000_runtime_relationship_hardening/migration.sql",
  import.meta.url,
);
const knowledgeV2SchemaFoundationMigrationUrl = new URL(
  "./migrations/20260712150000_knowledge_v2_schema_foundation/migration.sql",
  import.meta.url,
);
const knowledgeV2IntegrityHardeningMigrationUrl = new URL(
  "./migrations/20260712160000_knowledge_v2_integrity_hardening/migration.sql",
  import.meta.url,
);
const knowledgeV2SourceFoundationMigrationUrl = new URL(
  "./migrations/20260712170000_knowledge_v2_source_foundation/migration.sql",
  import.meta.url,
);
const knowledgeV2ReviewEvaluationFoundationMigrationUrl = new URL(
  "./migrations/20260712180000_knowledge_v2_review_evaluation_foundation/migration.sql",
  import.meta.url,
);
const knowledgeV2SnapshotPointIdentityMigrationUrl = new URL(
  "./migrations/20260712190000_knowledge_v2_snapshot_point_identity/migration.sql",
  import.meta.url,
);
const knowledgeV2EmbeddingCacheMigrationUrl = new URL(
  "./migrations/20260712200000_knowledge_v2_embedding_cache/migration.sql",
  import.meta.url,
);
const knowledgeV2ModelProcessorPolicyMigrationUrl = new URL(
  "./migrations/20260712210000_knowledge_v2_model_processor_policy/migration.sql",
  import.meta.url,
);
const knowledgeV2LegacyMigrationUrl = new URL(
  "./migrations/20260712220000_knowledge_v2_legacy_migration/migration.sql",
  import.meta.url,
);
const knowledgeV2RestrictedResultHashMigrationUrl = new URL(
  "./migrations/20260712230000_knowledge_v2_restricted_result_hash/migration.sql",
  import.meta.url,
);
const knowledgeV2ResultAnswerRolesMigrationUrl = new URL(
  "./migrations/20260712240000_knowledge_v2_result_answer_roles/migration.sql",
  import.meta.url,
);
const knowledgeV2TestExpectationPairMigrationUrl = new URL(
  "./migrations/20260712250000_knowledge_v2_test_expectation_pair/migration.sql",
  import.meta.url,
);
const knowledgeV2FileUploadIntentsMigrationUrl = new URL(
  "./migrations/20260713010000_knowledge_v2_file_upload_intents/migration.sql",
  import.meta.url,
);
const userLocalePreferenceMigrationUrl = new URL(
  "./migrations/20260713020000_user_locale_preference/migration.sql",
  import.meta.url,
);
const knowledgeV2LiveToolLedgerMigrationUrl = new URL(
  "./migrations/20260713030000_knowledge_v2_live_tool_ledger/migration.sql",
  import.meta.url,
);
const authenticatedCustomerIdentityMigrationUrl = new URL(
  "./migrations/20260713100000_authenticated_customer_identity/migration.sql",
  import.meta.url,
);
const knowledgeV2TenantDefaultScopeMigrationUrl = new URL(
  "./migrations/20260713110000_knowledge_v2_tenant_default_scope/migration.sql",
  import.meta.url,
);
const knowledgeV2SnapshotAuthorizationManifestMigrationUrl = new URL(
  "./migrations/20260713120000_knowledge_v2_snapshot_authorization_manifest/migration.sql",
  import.meta.url,
);
const knowledgeV2QueryHashMetadataMigrationUrl = new URL(
  "./migrations/20260713130000_knowledge_v2_query_hash_metadata/migration.sql",
  import.meta.url,
);
const knowledgeV2QueryHashKeyRegistryMigrationUrl = new URL(
  "./migrations/20260713140000_knowledge_v2_query_hash_key_registry/migration.sql",
  import.meta.url,
);
const channelAutomaticReplyActivationMigrationUrl = new URL(
  "./migrations/20260714100000_channel_automatic_reply_activation/migration.sql",
  import.meta.url,
);
const knowledgeV2CapabilitySnapshotMigrationUrl = new URL(
  "./migrations/20260714110000_knowledge_v2_capability_snapshot/migration.sql",
  import.meta.url,
);
const knowledgeV2ValidationHistoryMigrationUrl = new URL(
  "./migrations/20260715100000_knowledge_v2_validation_history/migration.sql",
  import.meta.url,
);
const knowledgeV2OperationalAutonomyBindingMigrationUrl = new URL(
  "./migrations/20260715110000_knowledge_v2_operational_autonomy_binding/migration.sql",
  import.meta.url,
);
const knowledgeV2SupportedAutonomyLimitMigrationUrl = new URL(
  "./migrations/20260715120000_knowledge_v2_supported_autonomy_limit/migration.sql",
  import.meta.url,
);
const webhookProcessingFenceMigrationUrl = new URL(
  "./migrations/20260715130000_webhook_processing_fence/migration.sql",
  import.meta.url,
);
const knowledgeV2SnapshotCutoverIdentityMigrationUrl = new URL(
  "./migrations/20260715140000_knowledge_v2_snapshot_cutover_identity/migration.sql",
  import.meta.url,
);
const migrationRunnerLockPrefix = "leadvirt.custom-migration-runner.v1";
const migrationRunnerMaxWaitMs = 30_000;
const migrationRunnerTimeoutMs = 15 * 60_000;
type MigrationTestStopAfter = "channel_automatic_reply_activation";

function getMigrationTestStopAfter(): MigrationTestStopAfter | null {
  const value = process.env.LEADVIRT_MIGRATION_TEST_STOP_AFTER;
  if (!value) return null;
  if (process.env.NODE_ENV !== "test") {
    throw new Error("LEADVIRT_MIGRATION_TEST_STOP_AFTER is only available in NODE_ENV=test.");
  }
  if (value !== "channel_automatic_reply_activation") {
    throw new Error(`Unsupported LEADVIRT_MIGRATION_TEST_STOP_AFTER value: ${value}.`);
  }
  return value;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to apply database migrations.");
  }

  return databaseUrl;
}

function getDatabaseName(databaseUrl: string) {
  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return databaseName;
}

function getMaintenanceDatabaseUrl(databaseUrl: string) {
  const parsedUrl = new URL(databaseUrl);
  parsedUrl.pathname = "/postgres";
  return parsedUrl.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureDatabaseExists(databaseUrl: string) {
  const databaseName = getDatabaseName(databaseUrl);

  if (databaseName === "postgres") {
    return;
  }

  const maintenanceClient = new PrismaClient({
    datasources: { db: { url: getMaintenanceDatabaseUrl(databaseUrl) } },
  });

  try {
    const rows = await maintenanceClient.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
      databaseName,
    );

    if (!rows[0]?.exists) {
      await maintenanceClient.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`Created database "${databaseName}".`);
    }
  } finally {
    await maintenanceClient.$disconnect();
  }
}

async function hasCoreSchema(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'Tenant'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasAuthSessionSchema(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_table: boolean; has_password_hash: boolean }>>`
    SELECT
      EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'AuthSession'
      ) AS "has_table",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'passwordHash'
      ) AS "has_password_hash"
  `;

  return (rows[0]?.has_table ?? false) && (rows[0]?.has_password_hash ?? false);
}

async function hasAuthSessionMetadata(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_ip_address: boolean; has_user_agent: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthSession'
          AND column_name = 'ipAddress'
      ) AS "has_ip_address",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthSession'
          AND column_name = 'userAgent'
      ) AS "has_user_agent"
  `;

  return (rows[0]?.has_ip_address ?? false) && (rows[0]?.has_user_agent ?? false);
}

async function hasPasswordChangeRequired(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'passwordChangeRequired'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasUserTwoFactor(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      has_enabled: boolean;
      has_secret: boolean;
      has_recovery: boolean;
      has_confirmed: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorEnabled'
      ) AS "has_enabled",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorSecretEncrypted'
      ) AS "has_secret",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorRecoveryCodes'
      ) AS "has_recovery",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorConfirmedAt'
      ) AS "has_confirmed"
  `;

  const row = rows[0];
  return Boolean(row?.has_enabled && row.has_secret && row.has_recovery && row.has_confirmed);
}

async function hasPasswordResetTokens(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'AuthPasswordResetToken'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasUserPhone(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'phone'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasBusinessKnowledgeSources(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'BusinessKnowledgeSource'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasBusinessKnowledgeChunks(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'BusinessKnowledgeChunk'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasEmailOtpAuth(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_challenges: boolean; has_auth_mode: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'AuthEmailOtpChallenge'
      ) AS "has_challenges",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthSession'
          AND column_name = 'authMode'
      ) AS "has_auth_mode"
  `;

  return Boolean(rows[0]?.has_challenges && rows[0]?.has_auth_mode);
}

async function hasBusinessKnowledgePublicationFoundation(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ table_count: bigint }>>`
    SELECT COUNT(*) AS "table_count"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'KnowledgeRevision',
        'KnowledgeRevisionChunk',
        'KnowledgeIndexSnapshot',
        'KnowledgeIndexSnapshotItem',
        'KnowledgePublication',
        'ActiveKnowledgePublication',
        'KnowledgePublicationItem',
        'KnowledgeJob',
        'KnowledgeJobAttempt',
        'KnowledgeOutbox',
        'KnowledgeInbox'
      )
  `;

  return rows[0]?.table_count === 11n;
}

async function hasAiReplyReliabilityFoundation(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      conversation_column_count: bigint;
      enum_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'AiReplyRun',
            'ExternalOperation',
            'ChannelDeliveryOperation',
            'RuntimeOutbox',
            'RuntimeInbox'
          )
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Conversation'
          AND column_name IN ('aiGeneration', 'aiReplySequence', 'aiReplyFence')
      ) AS "conversation_column_count",
      (
        SELECT COUNT(*)
        FROM pg_type
        WHERE typname IN ('AiReplyRunStatus', 'ExternalOperationStatus', 'RuntimeOutboxStatus', 'RuntimeInboxStatus')
      ) AS "enum_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'Conversation_aiReplyFence_check',
          'AiReplyRun_sequenceRetry_check',
          'ExternalOperation_attempt_check',
          'ChannelDeliveryOperation_attempt_check',
          'RuntimeOutbox_versionRetry_check',
          'RuntimeInbox_generationAttempt_check',
          'AiReplyRun_tenant_conversation_fkey',
          'AiReplyRun_tenant_inbound_fkey',
          'AiReplyRun_tenant_reply_fkey',
          'AiReplyRun_tenant_publication_fkey',
          'ExternalOperation_tenant_run_fkey',
          'ExternalOperation_tenant_conversation_fkey',
          'ExternalOperation_tenant_message_fkey',
          'ExternalOperation_tenant_integration_fkey',
          'ChannelDeliveryOperation_tenant_message_fkey',
          'ChannelDeliveryOperation_tenant_conversation_fkey',
          'ChannelDeliveryOperation_tenant_channel_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'AiReplyRun_tenantId_idempotencyKey_key',
            'AiReplyRun_tenantId_inboundMessageId_key',
            'AiReplyRun_conversationId_sequence_key',
            'ChannelDeliveryOperation_deliveryIdentity_key',
            'RuntimeOutbox_tenantId_dedupeKey_key',
            'RuntimeOutbox_aggregateEvent_key',
            'RuntimeInbox_consumerName_eventId_key'
          )
      ) AS "index_count"
  `;

  const row = rows[0];
  const present = Boolean(
    row && (row.table_count > 0n || row.conversation_column_count > 0n || row.enum_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 5n &&
      row.conversation_column_count === 3n &&
      row.enum_count === 4n &&
      row.constraint_count === 17n &&
      row.index_count === 7n,
    ),
  };
}

async function hasRuntimeRelationshipHardening(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      index_count: bigint;
      constraint_count: bigint;
      required_channel_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'Conversation_tenantId_id_channelId_key',
            'Message_tenantId_conversationId_id_key',
            'AiReplyRun_tenantId_conversationId_replyMessageId_key',
            'Conversation_activeExternalIdentity_key'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'Message_tenant_conversation_fkey',
          'AiReplyRun_tenant_inbound_fkey',
          'AiReplyRun_tenant_reply_fkey',
          'ChannelDeliveryOperation_tenant_message_fkey',
          'ChannelDeliveryOperation_tenant_conversation_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ChannelDeliveryOperation'
          AND column_name = 'channelId'
          AND is_nullable = 'NO'
      ) AS "required_channel_count"
  `;
  const row = rows[0];
  const present = Boolean(row && (row.index_count > 0n || row.required_channel_count > 0n));
  return {
    present,
    complete: Boolean(
      row &&
      row.index_count === 4n &&
      row.constraint_count === 5n &&
      row.required_channel_count === 1n,
    ),
  };
}

async function hasKnowledgeV2SchemaFoundation(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      column_count: bigint;
      enum_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'KnowledgeV2Settings',
            'KnowledgeV2Entity',
            'KnowledgeV2Fact',
            'KnowledgeV2FactVersion',
            'KnowledgeV2GuidanceRule',
            'KnowledgeV2GuidanceRuleVersion',
            'KnowledgeV2Evidence',
            'KnowledgeV2IdempotencyRecord',
            'KnowledgeV2PublicationValidation'
          )
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'KnowledgePublication' AND column_name = 'corpusKind')
            OR (
              table_name = 'KnowledgePublicationItem'
              AND column_name IN (
                'corpusKind',
                'itemVersionHash',
                'factVersionId',
                'guidanceRuleVersionId'
              )
            )
          )
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_type
        WHERE typname IN (
          'KnowledgeCorpusKind',
          'KnowledgeV2AutoPublishPolicy',
          'KnowledgeV2ApprovalPolicy',
          'KnowledgeV2RiskLevel',
          'KnowledgeV2LifecycleStatus',
          'KnowledgeV2VerificationStatus',
          'KnowledgeV2FactAuthority',
          'KnowledgeV2LocaleBehavior',
          'KnowledgeV2GuidanceReviewStatus',
          'KnowledgeV2GuidanceRuleType',
          'KnowledgeV2EvidenceKind',
          'KnowledgeV2IdempotencyStatus',
          'KnowledgeV2ValidationStatus'
        )
      ) AS "enum_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2Settings_values_check',
          'KnowledgeV2Entity_values_check',
          'KnowledgeV2Fact_values_check',
          'KnowledgeV2FactVersion_values_check',
          'KnowledgeV2GuidanceRule_values_check',
          'KnowledgeV2GuidanceRuleVersion_values_check',
          'KnowledgeV2Evidence_target_check',
          'KnowledgeV2Evidence_provenance_check',
          'KnowledgeV2Evidence_values_check',
          'KnowledgeV2IdempotencyRecord_values_check',
          'KnowledgeV2PublicationValidation_values_check',
          'KnowledgePublicationItem_typedItem_check',
          'KnowledgeV2Settings_tenantId_fkey',
          'KnowledgeV2Entity_tenantId_fkey',
          'KnowledgeV2Fact_tenantId_fkey',
          'KnowledgeV2Fact_tenantId_entityId_fkey',
          'KnowledgeV2FactVersion_tenantId_fkey',
          'KnowledgeV2FactVersion_tenantId_factId_fkey',
          'KnowledgeV2FactVersion_tenantId_supersedesVersionId_fkey',
          'KnowledgeV2FactVersion_sameFactSupersedes_fkey',
          'KnowledgeV2GuidanceRule_tenantId_fkey',
          'KnowledgeV2GuidanceRuleVersion_tenantId_fkey',
          'KnowledgeV2GuidanceRuleVersion_tenantId_guidanceRuleId_fkey',
          'KnowledgeV2GuidanceRuleVersion_tenantId_supersedesVersionI_fkey',
          'KnowledgeV2GuidanceRuleVersion_sameRuleSupersedes_fkey',
          'KnowledgeV2Evidence_tenantId_fkey',
          'KnowledgeV2Evidence_tenantId_factVersionId_fkey',
          'KnowledgeV2Evidence_tenantId_guidanceRuleVersionId_fkey',
          'KnowledgeV2Evidence_tenantId_legacyRevisionId_fkey',
          'KnowledgeV2IdempotencyRecord_tenantId_fkey',
          'KnowledgeV2PublicationValidation_tenantId_fkey',
          'KnowledgeV2PublicationValidation_tenantId_basePublicationI_fkey',
          'KnowledgeV2PublicationValidation_tenantId_publicationId_co_fkey',
          'KnowledgePublication_tenantId_basePublicationId_corpusKind_fkey',
          'KnowledgePublicationItem_tenantId_publicationId_corpusKind_fkey',
          'KnowledgePublicationItem_tenantId_factVersionId_itemVersio_fkey',
          'KnowledgePublicationItem_tenantId_guidanceRuleVersionId_it_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgeV2Entity_tenantId_id_key',
            'KnowledgeV2Fact_tenantId_id_key',
            'KnowledgeV2FactVersion_tenantId_id_immutableHash_key',
            'KnowledgeV2GuidanceRule_tenantId_id_key',
            'KnowledgeV2GuidanceRuleVersion_tenantId_id_immutableHash_key',
            'KnowledgeV2Evidence_tenantId_id_key',
            'KnowledgeV2IdempotencyRecord_tenantId_endpoint_key_key',
            'KnowledgeV2PublicationValidation_tenantId_publicationId_cor_key',
            'KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key',
            'KnowledgePublication_tenantId_id_corpusKind_key'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'KnowledgeV2FactVersion_immutable',
            'KnowledgeV2GuidanceRuleVersion_immutable'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname = 'KnowledgeV2_reject_version_mutation'
      ) AS "function_count"
  `;

  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.column_count > 0n ||
      row.enum_count > 0n ||
      row.trigger_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 9n &&
      row.column_count === 5n &&
      row.enum_count === 13n &&
      row.constraint_count === 35n &&
      row.index_count === 10n &&
      row.trigger_count === 2n &&
      row.function_count === 1n,
    ),
  };
}

async function hasKnowledgeV2IntegrityHardening(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2FactVersion_sameFactSupersedes_fkey',
          'KnowledgeV2GuidanceRuleVersion_sameRuleSupersedes_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgeV2FactVersion_tenant_fact_id_key',
            'KnowledgeV2GuidanceRuleVersion_tenant_rule_id_key'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'KnowledgeV2Evidence_immutable',
            'KnowledgeV2Evidence_publication_guard',
            'KnowledgePublication_immutable',
            'KnowledgePublicationItem_immutable',
            'KnowledgePublicationItem_insert_guard'
          )
          AND (
            tgname <> 'KnowledgePublication_immutable'
            OR ((tgtype & 8) = 0 AND (tgtype & 16) = 16)
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname IN (
          'KnowledgeV2_reject_evidence_mutation',
          'KnowledgeV2_guard_evidence_insert',
          'Knowledge_reject_publication_mutation',
          'Knowledge_reject_publication_item_mutation',
          'Knowledge_guard_publication_item_insert'
        )
      ) AS "function_count"
  `;

  const row = rows[0];
  const present = Boolean(
    row &&
    (row.constraint_count > 0n ||
      row.index_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.constraint_count === 2n &&
      row.index_count === 2n &&
      row.trigger_count === 5n &&
      row.function_count === 5n,
    ),
  };
}

async function hasKnowledgeV2SourceFoundation(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      column_count: bigint;
      enum_count: bigint;
      integrity_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'KnowledgeV2Source',
            'KnowledgeV2Artifact',
            'KnowledgeV2Document',
            'KnowledgeV2DocumentRevision',
            'KnowledgeV2Element',
            'KnowledgeV2Chunk',
            'KnowledgeV2IndexSnapshotItem',
            'KnowledgeV2DeletionLedger'
          )
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'KnowledgePublicationItem' AND column_name = 'v2DocumentRevisionId')
            OR (table_name = 'KnowledgeJob' AND column_name IN ('v2SourceId', 'v2RevisionId'))
            OR (table_name = 'KnowledgeIndexSnapshot' AND column_name = 'corpusKind')
            OR (table_name = 'KnowledgeIndexSnapshotItem' AND column_name = 'corpusKind')
            OR (table_name = 'KnowledgeV2IndexSnapshotItem' AND column_name = 'corpusKind')
          )
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_type
        WHERE typname IN (
          'KnowledgeV2SourceKind',
          'KnowledgeV2SourceSyncMode',
          'KnowledgeV2SourceStatus',
          'KnowledgeV2RevisionStatus',
          'KnowledgeV2ElementKind',
          'KnowledgeV2DeletionStatus',
          'KnowledgeV2SecurityClassification',
          'KnowledgeV2ArtifactMalwareStatus',
          'KnowledgeV2MimeValidationStatus',
          'KnowledgeV2ArtifactDeletionState',
          'KnowledgeV2DocumentStatus',
          'KnowledgeV2ChunkIndexState'
        )
      ) AS "enum_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2Artifact_tenant_source_fkey',
          'KnowledgeV2Revision_tenant_source_document_fkey',
          'KnowledgeV2Revision_tenant_source_artifact_fkey',
          'KnowledgeV2Revision_same_document_supersedes_fkey',
          'KnowledgeV2Document_current_draft_fkey',
          'KnowledgeV2Document_current_published_fkey',
          'KnowledgeV2Element_tenant_document_revision_fkey',
          'KnowledgeV2Element_same_revision_parent_fkey',
          'KnowledgeV2Chunk_tenant_document_fkey',
          'KnowledgeV2Chunk_tenant_document_revision_fkey',
          'KnowledgeV2Chunk_same_revision_parent_fkey',
          'KnowledgeV2Chunk_same_revision_section_fkey',
          'KnowledgeIndexSnapshotItem_corpus_check',
          'KnowledgeIndexSnapshotItem_tenant_snapshot_corpus_fkey',
          'KnowledgeV2IndexSnapshotItem_corpus_check',
          'KnowledgeV2IndexSnapshotItem_tenant_snapshot_corpus_fkey',
          'KnowledgeV2IndexSnapshotItem_exact_chunk_fkey',
          'KnowledgePublication_tenant_snapshot_corpus_fkey',
          'KnowledgeV2DeletionLedger_tenant_source_fkey',
          'KnowledgePublicationItem_tenant_v2Revision_hash_fkey',
          'KnowledgeJob_tenant_v2Source_fkey',
          'KnowledgeJob_tenant_v2Source_revision_fkey',
          'KnowledgeJob_v2Revision_source_check'
        )
      ) AS "integrity_count"
  `;

  const row = rows[0];
  const present = Boolean(
    row && (row.table_count > 0n || row.column_count > 0n || row.enum_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 8n &&
      row.column_count === 6n &&
      row.enum_count === 12n &&
      row.integrity_count === 23n,
    ),
  };
}

async function hasKnowledgeV2ReviewEvaluationFoundation(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      enum_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'KnowledgeV2EvidenceReference',
            'KnowledgeV2Conflict',
            'KnowledgeV2ConflictCandidate',
            'KnowledgeV2ConflictCandidateEvidence',
            'KnowledgeV2ReviewItem',
            'KnowledgeV2ReviewItemEvidence',
            'KnowledgeV2TestCase',
            'KnowledgeV2TestCaseVersion',
            'KnowledgeV2TestExpectation',
            'KnowledgeV2EvaluationRun',
            'KnowledgeV2EvaluationResult',
            'KnowledgeV2EvaluationMetric',
            'KnowledgeV2EvaluationResultEvidence',
            'KnowledgeV2Feedback',
            'KnowledgeV2FeedbackEvidence',
            'KnowledgeV2RetrievalTrace',
            'KnowledgeV2RetrievalCandidate',
            'KnowledgeV2Citation'
          )
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM pg_type
        WHERE typname IN (
          'KnowledgeV2Audience',
          'KnowledgeV2EvidenceTargetType',
          'KnowledgeV2ConflictType',
          'KnowledgeV2ConflictStatus',
          'KnowledgeV2ConflictResolution',
          'KnowledgeV2ConflictCandidateType',
          'KnowledgeV2ReviewReason',
          'KnowledgeV2ReviewStatus',
          'KnowledgeV2ReviewAction',
          'KnowledgeV2TestCaseStatus',
          'KnowledgeV2TestCaseOrigin',
          'KnowledgeV2ExpectedBehavior',
          'KnowledgeV2TestExpectationKind',
          'KnowledgeV2EvaluationRunKind',
          'KnowledgeV2EvaluationRunStatus',
          'KnowledgeV2EvaluationResultStatus',
          'KnowledgeV2MetricCategory',
          'KnowledgeV2MetricComparator',
          'KnowledgeV2SnapshotKind',
          'KnowledgeV2FeedbackCategory',
          'KnowledgeV2FeedbackStatus',
          'KnowledgeV2CorrectionTargetType',
          'KnowledgeV2RetrievalOutcome',
          'KnowledgeV2GateOutcome',
          'KnowledgeV2RetrievalRejectionReason',
          'KnowledgeV2CitationSupport'
        )
      ) AS "enum_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2EvidenceReference_values_check',
          'KnowledgeV2Conflict_values_check',
          'KnowledgeV2ConflictCandidate_values_check',
          'KnowledgeV2ConflictEvidence_values_check',
          'KnowledgeV2ReviewItem_values_check',
          'KnowledgeV2ReviewEvidence_values_check',
          'KnowledgeV2TestCase_values_check',
          'KnowledgeV2TestCaseVersion_values_check',
          'KnowledgeV2TestExpectation_values_check',
          'KnowledgeV2EvaluationRun_values_check',
          'KnowledgeV2EvaluationResult_values_check',
          'KnowledgeV2EvaluationMetric_values_check',
          'KnowledgeV2EvaluationEvidence_values_check',
          'KnowledgeV2Feedback_values_check',
          'KnowledgeV2FeedbackEvidence_values_check',
          'KnowledgeV2RetrievalTrace_values_check',
          'KnowledgeV2RetrievalCandidate_values_check',
          'KnowledgeV2Citation_values_check',
          'KnowledgeV2Feedback_exact_result_fkey',
          'KnowledgeV2RetrievalTrace_exact_result_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgeV2EvaluationResult_exact_run_key',
            'KnowledgeV2Conflict_tenantId_conflictKey_key',
            'KnowledgeV2ReviewItem_tenantId_reviewKey_key',
            'KnowledgeV2TestCase_tenantId_caseKey_key',
            'KnowledgeV2EvaluationRun_tenantId_runKey_key',
            'KnowledgeV2Feedback_tenantId_feedbackKey_key',
            'KnowledgeV2RetrievalTrace_tenantId_traceKey_key',
            'KnowledgeV2Citation_tenantId_citationKey_key'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'KnowledgeV2EvidenceReference_immutable',
            'KnowledgeV2ConflictCandidate_immutable',
            'KnowledgeV2ConflictEvidence_immutable',
            'KnowledgeV2ReviewEvidence_immutable',
            'KnowledgeV2TestCaseVersion_immutable',
            'KnowledgeV2TestExpectation_immutable',
            'KnowledgeV2EvaluationResult_immutable',
            'KnowledgeV2EvaluationMetric_immutable',
            'KnowledgeV2EvaluationEvidence_immutable',
            'KnowledgeV2FeedbackEvidence_immutable',
            'KnowledgeV2RetrievalTrace_immutable',
            'KnowledgeV2RetrievalCandidate_immutable',
            'KnowledgeV2Citation_immutable'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname = 'KnowledgeV2_reject_audit_mutation'
      ) AS "function_count"
  `;

  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.enum_count > 0n ||
      row.constraint_count > 0n ||
      row.trigger_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 18n &&
      row.enum_count === 26n &&
      row.constraint_count === 20n &&
      row.index_count === 8n &&
      row.trigger_count === 13n &&
      row.function_count === 1n,
    ),
  };
}

async function hasKnowledgeV2SnapshotPointIdentity(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      index_ready: boolean;
      vector_identity_ready: boolean;
      constraint_ready: boolean;
      snapshot_metadata_ready: boolean;
      snapshot_constraints_ready: boolean;
      evaluation_columns_ready: boolean;
      evaluation_result_nullable: boolean;
      evaluation_checks_ready: boolean;
      present: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'KnowledgeV2Chunk_tenant_exact_content_key'
      ) AS "index_ready",
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'KnowledgeV2IndexSnapshotItem_vectorPointId_key'
          AND indexdef LIKE '%UNIQUE INDEX%'
          AND indexdef LIKE '%("vectorPointId")%'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'KnowledgeV2IndexSnapshotItem_snapshot_vector_key'
      ) AS "vector_identity_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgeV2IndexSnapshotItem_exact_chunk_fkey'
          AND contype = 'f'
          AND confupdtype = 'a'
          AND confdeltype = 'r'
          AND pg_get_constraintdef(oid) LIKE '%("tenantId", "chunkId", "contentHash")%'
          AND pg_get_constraintdef(oid) NOT LIKE '%"vectorPointId"%'
      ) AS "constraint_ready",
      (
        SELECT COUNT(*) = 3
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'KnowledgeIndexSnapshot' AND column_name = 'preparationStartedAt')
            OR (table_name = 'KnowledgeV2IndexSnapshotItem' AND column_name = 'pointFingerprint')
            OR (table_name = 'KnowledgeV2PublicationValidation' AND column_name = 'indexSnapshotId')
          )
      ) AS "snapshot_metadata_ready",
      (
        SELECT COUNT(*) = 2
        FROM pg_constraint
        WHERE (
          conname = 'KnowledgeV2IndexSnapshotItem_values_check'
          AND pg_get_constraintdef(oid) LIKE '%"pointFingerprint"%'
        ) OR (
          conname = 'KnowledgeV2PublicationValidation_tenant_snapshot_corpus_fkey'
          AND contype = 'f'
          AND confupdtype = 'a'
          AND confdeltype = 'r'
          AND pg_get_constraintdef(oid) LIKE '%("tenantId", "indexSnapshotId", "corpusKind")%'
        )
      ) AS "snapshot_constraints_ready",
      (
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2EvaluationRun'
          AND column_name IN ('queryHash', 'restrictedInputRef')
      ) AS "evaluation_columns_ready",
      (
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2EvaluationResult'
          AND column_name IN ('testCaseVersionId', 'expectedBehavior')
          AND is_nullable = 'YES'
      ) AS "evaluation_result_nullable",
      (
        SELECT COUNT(*) = 2
        FROM pg_constraint
        WHERE (
          conname = 'KnowledgeV2EvaluationRun_values_check'
          AND pg_get_constraintdef(oid) LIKE '%"queryHash" IS NULL%'
          AND pg_get_constraintdef(oid) LIKE '%"restrictedInputRef" IS NULL%'
        ) OR (
          conname = 'KnowledgeV2EvaluationResult_values_check'
          AND (
            (
              pg_get_constraintdef(oid) LIKE '%"testCaseVersionId" IS NULL%'
              AND pg_get_constraintdef(oid) LIKE '%"expectedBehavior" IS NULL%'
            )
            OR (
              pg_get_constraintdef(oid) LIKE '%"restrictedResultHash"%'
              AND EXISTS (
                SELECT 1 FROM pg_constraint answer_role
                WHERE answer_role.conname = 'KnowledgeV2EvaluationResult_answer_role_check'
                  AND answer_role.conrelid = '"KnowledgeV2EvaluationResult"'::regclass
              )
              AND EXISTS (
                SELECT 1 FROM pg_constraint result_pair
                WHERE result_pair.conname = 'KnowledgeV2EvaluationResult_restrictedResult_pair_check'
                  AND result_pair.conrelid = '"KnowledgeV2EvaluationResult"'::regclass
              )
            )
          )
        )
      ) AS "evaluation_checks_ready",
      (
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'KnowledgeV2Chunk_tenant_exact_content_key',
              'KnowledgeV2IndexSnapshotItem_vectorPointId_key'
            )
        )
        OR EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'KnowledgeIndexSnapshot' AND column_name = 'preparationStartedAt')
              OR (table_name = 'KnowledgeV2IndexSnapshotItem' AND column_name = 'pointFingerprint')
              OR (table_name = 'KnowledgeV2PublicationValidation' AND column_name = 'indexSnapshotId')
              OR (table_name = 'KnowledgeV2EvaluationRun' AND column_name IN ('queryHash', 'restrictedInputRef'))
            )
        )
      ) AS "present"
  `;
  const row = rows[0];
  const checks = {
    index: Boolean(row?.index_ready),
    vectorIdentity: Boolean(row?.vector_identity_ready),
    exactChunkConstraint: Boolean(row?.constraint_ready),
    snapshotMetadata: Boolean(row?.snapshot_metadata_ready),
    snapshotConstraints: Boolean(row?.snapshot_constraints_ready),
    evaluationColumns: Boolean(row?.evaluation_columns_ready),
    evaluationResultNullable: Boolean(row?.evaluation_result_nullable),
    evaluationChecks: Boolean(row?.evaluation_checks_ready),
  };
  return {
    present: Boolean(row?.present),
    complete: Object.values(checks).every(Boolean),
    checks,
  };
}

async function hasKnowledgeV2EmbeddingCache(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_ready: boolean;
      columns_ready: boolean;
      constraints_ready: boolean;
      indexes_ready: boolean;
      snapshot_schema_ready: boolean;
      present: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2EmbeddingCache'
      ) AS "table_ready",
      (
        SELECT COUNT(*) = 20
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2EmbeddingCache'
      ) AS "columns_ready",
      (
        SELECT COUNT(*) = 3
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2EmbeddingCache_pkey',
          'KnowledgeV2EmbeddingCache_values_check',
          'KnowledgeV2EmbeddingCache_tenant_fkey'
        )
      ) AS "constraints_ready",
      (
        SELECT COUNT(*) = 5
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgeV2EmbeddingCache_pkey',
            'KnowledgeV2EmbeddingCache_tenant_content_schema_key',
            'KnowledgeV2EmbeddingCache_tenant_id_key',
            'KnowledgeV2EmbeddingCache_tenant_expiry_idx',
            'KnowledgeV2EmbeddingCache_expiry_idx'
          )
      ) AS "indexes_ready",
      (
        SELECT COUNT(*) = 6
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'KnowledgeIndexSnapshot' AND column_name IN ('indexSchema', 'indexSchemaHash'))
            OR (
              table_name = 'KnowledgeV2Settings'
              AND column_name IN ('embeddingProviderPolicy', 'retrievalProcessorPolicy')
            )
            OR (
              table_name IN ('KnowledgeV2EvaluationRun', 'KnowledgeV2RetrievalTrace')
              AND column_name = 'retrievalProcessorPolicyHash'
            )
          )
      ) AS "snapshot_schema_ready",
      (
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'KnowledgeV2EmbeddingCache'
        )
        OR EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname LIKE 'KnowledgeV2EmbeddingCache%'
        )
        OR EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname LIKE 'KnowledgeV2EmbeddingCache%'
        )
        OR EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'KnowledgeIndexSnapshot'
            AND column_name IN ('indexSchema', 'indexSchemaHash')
        )
        OR EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'KnowledgeV2Settings'
            AND column_name IN ('embeddingProviderPolicy', 'retrievalProcessorPolicy')
        )
        OR EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('KnowledgeV2EvaluationRun', 'KnowledgeV2RetrievalTrace')
            AND column_name = 'retrievalProcessorPolicyHash'
        )
      ) AS "present"
  `;
  const row = rows[0];
  return {
    present: Boolean(row?.present),
    complete: Boolean(
      row?.table_ready &&
      row.columns_ready &&
      row.constraints_ready &&
      row.indexes_ready &&
      row.snapshot_schema_ready,
    ),
  };
}

async function hasKnowledgeV2ModelProcessorPolicy(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      settings_column_count: bigint;
      run_column_count: bigint;
      result_column_count: bigint;
      trace_column_count: bigint;
      has_constraint: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2Settings'
          AND column_name = 'modelProcessorPolicy' AND data_type = 'jsonb'
      ) AS "settings_column_count",
      (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2EvaluationRun'
          AND column_name = 'modelProcessorPolicyHash'
      ) AS "run_column_count",
      (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2EvaluationResult'
          AND column_name IN (
            'provider', 'generatorModel', 'promptPolicyVersion', 'modelProcessorPolicyHash',
            'providerOutputHash', 'gateInputHash', 'gateResultHash'
          )
      ) AS "result_column_count",
      (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'KnowledgeV2RetrievalTrace'
          AND column_name IN (
            'modelProcessorPolicyHash', 'providerOutputHash', 'gateInputHash', 'gateResultHash'
          )
      ) AS "trace_column_count",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'KnowledgeV2Settings_modelProcessorPolicy_check'
          AND conrelid = '"KnowledgeV2Settings"'::regclass
      ) AS "has_constraint"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.settings_column_count > 0n ||
      row.run_column_count > 0n ||
      row.result_column_count > 0n ||
      row.trace_column_count > 0n ||
      row.has_constraint),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.settings_column_count === 1n &&
      row.run_column_count === 1n &&
      row.result_column_count === 7n &&
      row.trace_column_count === 4n &&
      row.has_constraint,
    ),
  };
}

async function hasKnowledgeV2RestrictedResultHash(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_column: boolean; has_constraint: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2EvaluationResult'
          AND column_name = 'restrictedResultHash'
          AND data_type = 'text'
      ) AS "has_column",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'KnowledgeV2EvaluationResult_restrictedResult_pair_check'
          AND conrelid = '"KnowledgeV2EvaluationResult"'::regclass
      ) AS "has_constraint"
  `;
  const row = rows[0];
  return {
    present: Boolean(row?.has_column || row?.has_constraint),
    complete: Boolean(row?.has_column && row?.has_constraint),
  };
}

async function hasKnowledgeV2ResultAnswerRoles(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      has_answer_role_constraint: boolean;
      values_constraint_ready: boolean;
    }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'KnowledgeV2EvaluationResult_answer_role_check'
          AND conrelid = '"KnowledgeV2EvaluationResult"'::regclass
          AND pg_get_constraintdef(oid) LIKE '%AUTO_SEND%'
          AND pg_get_constraintdef(oid) LIKE '%responseHash%'
      ) AS "has_answer_role_constraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'KnowledgeV2EvaluationResult_values_check'
          AND conrelid = '"KnowledgeV2EvaluationResult"'::regclass
          AND pg_get_constraintdef(oid) LIKE '%restrictedResultHash%'
          AND pg_get_constraintdef(oid) NOT LIKE '%responseHash%'
      ) AS "values_constraint_ready"
  `;
  const row = rows[0];
  return {
    present: Boolean(row?.has_answer_role_constraint),
    complete: Boolean(row?.has_answer_role_constraint && row.values_constraint_ready),
  };
}

async function hasKnowledgeV2TestExpectationPair(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ complete: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'KnowledgeV2EvaluationResult_test_expectation_pair_check'
        AND conrelid = '"KnowledgeV2EvaluationResult"'::regclass
        AND pg_get_constraintdef(oid) LIKE '%"testCaseVersionId" IS NULL%'
        AND pg_get_constraintdef(oid) LIKE '%"expectedBehavior" IS NULL%'
    ) AS "complete"
  `;
  return rows[0]?.complete ?? false;
}

async function hasKnowledgeV2FileUploadIntents(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'KnowledgeV2FileUploadIntent'
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function userLocalePreferenceState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_column: boolean; has_constraint: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'locale'
      ) AS "has_column",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'User_locale_check'
          AND conrelid = '"User"'::regclass
      ) AS "has_constraint"
  `;
  const state = rows[0] ?? { has_column: false, has_constraint: false };
  return {
    present: state.has_column || state.has_constraint,
    complete: state.has_column && state.has_constraint,
  };
}

async function hasKnowledgeV2LegacyMigration(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      revision_column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      revision_check_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('KnowledgeV2LegacyMigration', 'KnowledgeCorpusSelector')
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2DocumentRevision'
          AND column_name IN (
            'legacyMigrationId',
            'legacySourceId',
            'legacySourceVersion',
            'legacySnapshotHash'
          )
      ) AS "revision_column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2LegacyMigration_pkey',
          'KnowledgeV2LegacyMigration_values_check',
          'KnowledgeV2LegacyMigration_tenant_fkey',
          'KnowledgeV2LegacyMigration_job_fkey',
          'KnowledgeV2LegacyMigration_requester_fkey',
          'KnowledgeCorpusSelector_pkey',
          'KnowledgeCorpusSelector_values_check',
          'KnowledgeCorpusSelector_tenant_fkey',
          'KnowledgeCorpusSelector_migration_fkey',
          'KnowledgeCorpusSelector_actor_fkey',
          'KnowledgeV2DocumentRevision_legacy_migration_fkey',
          'KnowledgeV2DocumentRevision_legacy_source_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgeV2LegacyMigration_pkey',
            'KnowledgeV2LegacyMigration_tenant_manifest_key',
            'KnowledgeV2LegacyMigration_tenant_id_key',
            'KnowledgeV2LegacyMigration_tenant_job_key',
            'KnowledgeV2LegacyMigration_jobId_key',
            'KnowledgeV2LegacyMigration_tenant_status_created_idx',
            'KnowledgeCorpusSelector_pkey',
            'KnowledgeCorpusSelector_corpus_updated_idx',
            'KnowledgeCorpusSelector_tenant_migration_idx',
            'KnowledgeCorpusSelector_tenant_actor_idx',
            'BusinessKnowledgeSource_tenant_id_key',
            'KnowledgeV2DocumentRevision_tenant_legacy_source_version_key',
            'KnowledgeV2DocumentRevision_tenant_legacy_migration_idx'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'KnowledgeV2LegacyMigration_immutable_input',
            'KnowledgeV2DocumentRevision_immutable_legacy_provenance',
            'KnowledgeCorpusSelector_one_way'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname IN (
          'KnowledgeV2_reject_legacy_migration_input_mutation',
          'KnowledgeV2_reject_legacy_provenance_mutation',
          'KnowledgeV2_enforce_one_way_corpus_cutover'
        )
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgeV2DocumentRevision_values_check'
          AND pg_get_constraintdef(oid) LIKE '%legacySnapshotHash%'
          AND pg_get_constraintdef(oid) LIKE '%legacy-snapshot-v1%'
      ) AS "revision_check_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.revision_column_count > 0n ||
      row.constraint_count > 0n ||
      row.index_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 2n &&
      row.revision_column_count === 4n &&
      row.constraint_count === 12n &&
      row.index_count === 13n &&
      row.trigger_count === 3n &&
      row.function_count === 3n &&
      row.revision_check_ready,
    ),
  };
}

async function knowledgeV2LiveToolLedgerState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      ledger_column_count: bigint;
      state_column_count: bigint;
      integration_column_count: bigint;
      plaintext_column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      values_check_ready: boolean;
      tenant_cascade_ready: boolean;
      related_delete_guard_ready: boolean;
      state_monotonic_guard_ready: boolean;
      ledger_delete_guard_ready: boolean;
      evidence_fkey_validated: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'TenantOperationalAuthorizationState',
            'KnowledgeV2LiveToolExecution'
          )
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2LiveToolExecution'
          AND column_name IN (
            'id',
            'executionKey',
            'tenantId',
            'aiReplyRunId',
            'conversationId',
            'originatingMessageId',
            'leadId',
            'executionContextId',
            'attemptNumber',
            'toolCallId',
            'toolKey',
            'toolVersion',
            'safeName',
            'sourceSystem',
            'operationalCategory',
            'toolPolicyVersion',
            'queryHash',
            'requestHash',
            'authorizationScopeHash',
            'authorizationDecisionId',
            'permissionGeneration',
            'connectionId',
            'connectionPermissionVersion',
            'subjectHash',
            'resultType',
            'valueHash',
            'exactValueHash',
            'contentHash',
            'envelopeHash',
            'payloadObjectKey',
            'payloadEncryptionKeyRef',
            'payloadHash',
            'payloadBytes',
            'observedAt',
            'expiresAt',
            'authorizedAt',
            'authorizationExpiresAt',
            'retentionExpiresAt',
            'createdAt'
          )
      ) AS "ledger_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'TenantOperationalAuthorizationState'
          AND column_name IN ('tenantId', 'permissionGeneration', 'updatedAt')
      ) AS "state_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'IntegrationAccount'
          AND column_name = 'permissionVersion'
      ) AS "integration_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2LiveToolExecution'
          AND column_name IN ('value', 'exactValue', 'content', 'payload')
      ) AS "plaintext_column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'IntegrationAccount_permissionVersion_check',
          'TenantOperationalAuthorizationState_pkey',
          'TenantOperationalAuthorizationState_generation_check',
          'TenantOperationalAuthorizationState_tenant_fkey',
          'KnowledgeV2LiveToolExecution_pkey',
          'KnowledgeV2LiveToolExecution_values_check',
          'KnowledgeV2LiveToolExecution_tenant_fkey',
          'KnowledgeV2LiveToolExecution_run_context_fkey',
          'KnowledgeV2LiveToolExecution_conversation_fkey',
          'KnowledgeV2LiveToolExecution_message_fkey',
          'KnowledgeV2LiveToolExecution_lead_fkey',
          'KnowledgeV2LiveToolExecution_connection_fkey',
          'KnowledgeV2EvidenceReference_liveToolExecution_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'Lead_tenantId_id_key',
            'AiReplyRun_liveToolContext_key',
            'KnowledgeV2LiveToolExecution_tenant_execution_key',
            'KnowledgeV2LiveToolExecution_tenant_id_key',
            'KnowledgeV2LiveToolExecution_payload_object_key',
            'KnowledgeV2LiveToolExecution_tenant_run_attempt_idx',
            'KnowledgeV2LiveToolExecution_tenant_conversation_created_idx',
            'KnowledgeV2LiveToolExecution_tenant_connection_version_idx',
            'KnowledgeV2LiveToolExecution_tenant_category_created_idx',
            'KnowledgeV2LiveToolExecution_expiresAt_idx',
            'KnowledgeV2LiveToolExecution_retentionExpiresAt_idx',
            'KnowledgeV2LiveToolExecution_tenant_decision_idx'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'TenantOperationalAuthorization_initialize',
            'TenantOperationalAuthorization_tenant_update',
            'TenantOperationalAuthorization_membership_insert_delete',
            'TenantOperationalAuthorization_membership_update',
            'TenantOperationalAuthorization_channel_insert_delete',
            'TenantOperationalAuthorization_channel_update',
            'IntegrationAccount_permission_version',
            'TenantOperationalAuthorization_monotonic',
            'TenantOperationalAuthorization_integration_insert_delete',
            'TenantOperationalAuthorization_integration_update',
            'KnowledgeV2LiveToolExecution_immutable'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname IN (
          'TenantOperationalAuthorization_bump',
          'TenantOperationalAuthorization_initialize_tenant',
          'TenantOperationalAuthorization_bump_tenant',
          'TenantOperationalAuthorization_bump_related',
          'IntegrationAccount_advance_permission_version',
          'TenantOperationalAuthorization_enforce_monotonic',
          'KnowledgeV2_reject_live_tool_execution_mutation'
        )
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgeV2LiveToolExecution_values_check'
          AND pg_get_constraintdef(oid) LIKE '%00:05:00%'
          AND pg_get_constraintdef(oid) LIKE '%00:01:00%'
          AND pg_get_constraintdef(oid) LIKE '%payloadEncryptionKeyRef%'
          AND pg_get_constraintdef(oid) LIKE '%authorizationExpiresAt%'
          AND pg_get_constraintdef(oid) LIKE '%connectionPermissionVersion%'
      ) AS "values_check_ready",
      (
        SELECT COUNT(*) = 2
        FROM pg_constraint
        WHERE conname IN (
          'TenantOperationalAuthorizationState_tenant_fkey',
          'KnowledgeV2LiveToolExecution_tenant_fkey'
        )
          AND confdeltype = 'c'
      ) AS "tenant_cascade_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'TenantOperationalAuthorization_bump_related'
          AND pg_get_functiondef(oid) LIKE '%NOT EXISTS (%'
          AND pg_get_functiondef(oid) LIKE '%FROM "Tenant"%'
      ) AS "related_delete_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'TenantOperationalAuthorization_enforce_monotonic'
          AND pg_get_functiondef(oid) LIKE '%permissionGeneration%+ 1%'
          AND pg_get_functiondef(oid) LIKE '%FROM "Tenant"%'
          AND pg_get_functiondef(oid) LIKE '%RETURN NEW%'
      ) AS "state_monotonic_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'KnowledgeV2_reject_live_tool_execution_mutation'
          AND pg_get_functiondef(oid) LIKE '%FROM "Tenant"%'
      ) AS "ledger_delete_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgeV2EvidenceReference_liveToolExecution_fkey'
          AND convalidated
      ) AS "evidence_fkey_validated"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.ledger_column_count > 0n ||
      row.state_column_count > 0n ||
      row.integration_column_count > 0n ||
      row.constraint_count > 0n ||
      row.index_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 2n &&
      row.ledger_column_count === 39n &&
      row.state_column_count === 3n &&
      row.integration_column_count === 1n &&
      row.plaintext_column_count === 0n &&
      row.constraint_count === 13n &&
      row.index_count === 12n &&
      row.trigger_count === 11n &&
      row.function_count === 7n &&
      row.values_check_ready &&
      row.tenant_cascade_ready &&
      row.related_delete_guard_ready &&
      row.state_monotonic_guard_ready &&
      row.ledger_delete_guard_ready &&
      row.evidence_fkey_validated,
    ),
  };
}

async function authenticatedCustomerIdentityState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      identity_column_count: bigint;
      ledger_column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      boundary_guard_ready: boolean;
      immutable_guard_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'AuthenticatedCustomerIdentity'
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthenticatedCustomerIdentity'
          AND column_name IN (
            'id',
            'tenantId',
            'version',
            'channelId',
            'conversationId',
            'messageId',
            'webhookEventId',
            'provider',
            'authenticationMethod',
            'subjectSource',
            'conversationType',
            'subjectHash',
            'channelBindingHash',
            'eventPayloadHash',
            'attestationHash',
            'authenticatedAt',
            'createdAt'
          )
      ) AS "identity_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2LiveToolExecution'
          AND column_name IN ('customerIdentityId', 'customerIdentityVersion')
      ) AS "ledger_column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'AuthenticatedCustomerIdentity_pkey',
          'AuthenticatedCustomerIdentity_contract_check',
          'AuthenticatedCustomerIdentity_tenant_fkey',
          'AuthenticatedCustomerIdentity_conversation_channel_fkey',
          'AuthenticatedCustomerIdentity_message_fkey',
          'AuthenticatedCustomerIdentity_webhook_event_fkey',
          'KnowledgeV2LiveToolExecution_customer_identity_pair_check',
          'KnowledgeV2LiveToolExecution_customer_identity_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'AuthenticatedCustomerIdentity_tenant_id_key',
            'AuthenticatedCustomerIdentity_tenant_message_key',
            'AuthenticatedCustomerIdentity_tenant_conversation_message_key',
            'AuthenticatedCustomerIdentity_tenant_channel_authenticated_idx',
            'AuthenticatedCustomerIdentity_tenant_subject_authenticated_idx',
            'AuthenticatedCustomerIdentity_webhook_event_idx',
            'KnowledgeV2LiveToolExecution_tenant_customer_identity_idx'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'AuthenticatedCustomerIdentity_validate',
            'AuthenticatedCustomerIdentity_immutable'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname IN (
          'AuthenticatedCustomerIdentity_validate_insert',
          'AuthenticatedCustomerIdentity_reject_mutation'
        )
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'AuthenticatedCustomerIdentity_validate_insert'
          AND pg_get_functiondef(oid) LIKE '%message."direction" = ''INBOUND''%'
          AND pg_get_functiondef(oid) LIKE '%channel."type" = ''TELEGRAM''%'
          AND pg_get_functiondef(oid) LIKE '%event."provider" = ''telegram:''%'
      ) AS "boundary_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'AuthenticatedCustomerIdentity_reject_mutation'
          AND pg_get_functiondef(oid) LIKE '%FROM "Tenant"%'
      ) AS "immutable_guard_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.identity_column_count > 0n ||
      row.ledger_column_count > 0n ||
      row.constraint_count > 0n ||
      row.index_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 1n &&
      row.identity_column_count === 17n &&
      row.ledger_column_count === 2n &&
      row.constraint_count === 8n &&
      row.index_count === 7n &&
      row.trigger_count === 2n &&
      row.function_count === 2n &&
      row.boundary_guard_ready &&
      row.immutable_guard_ready,
    ),
  };
}

async function knowledgeV2TenantDefaultScopeState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      settings_column_count: bigint;
      item_column_count: bigint;
      constraint_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      settings_check_ready: boolean;
      item_binding_check_ready: boolean;
      structured_scope_check_ready: boolean;
      generation_guard_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2Settings'
          AND column_name IN ('defaultScope', 'defaultScopeGeneration', 'defaultScopeHash')
      ) AS "settings_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgePublicationItem'
          AND column_name IN (
            'usesTenantDefaultScope',
            'tenantDefaultScopeGeneration',
            'tenantDefaultScopeHash'
          )
      ) AS "item_column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2Settings_default_scope_check',
          'KnowledgePublicationItem_default_scope_binding_check',
          'KnowledgePublicationItem_structured_scope_check'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'KnowledgeV2Settings_default_scope_generation'
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE proname = 'KnowledgeV2_enforce_default_scope_generation'
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgeV2Settings_default_scope_check'
          AND pg_get_constraintdef(oid) LIKE '%defaultScopeGeneration%'
          AND pg_get_constraintdef(oid) LIKE '%"defaultScopeHash" IS NOT NULL%'
          AND pg_get_constraintdef(oid) LIKE '%jsonb_array_length%'
      ) AS "settings_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgePublicationItem_default_scope_binding_check'
          AND pg_get_constraintdef(oid) LIKE '%usesTenantDefaultScope%'
          AND pg_get_constraintdef(oid) LIKE '%"tenantDefaultScopeGeneration" IS NOT NULL%'
          AND pg_get_constraintdef(oid) LIKE '%tenantDefaultScopeHash%'
      ) AS "item_binding_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'KnowledgePublicationItem_structured_scope_check'
          AND pg_get_constraintdef(oid) LIKE '%FACT_VERSION%'
          AND pg_get_constraintdef(oid) LIKE '%scope IS NOT NULL%'
          AND pg_get_constraintdef(oid) LIKE '%jsonb_array_length%'
      ) AS "structured_scope_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'KnowledgeV2_enforce_default_scope_generation'
          AND pg_get_functiondef(oid) LIKE '%IS DISTINCT FROM%'
          AND pg_get_functiondef(oid) LIKE '%scope and hash must change together%'
          AND pg_get_functiondef(oid) LIKE '%generation must advance exactly once%'
      ) AS "generation_guard_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.settings_column_count > 0n ||
      row.item_column_count > 0n ||
      row.constraint_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.settings_column_count === 3n &&
      row.item_column_count === 3n &&
      row.constraint_count === 3n &&
      row.trigger_count === 1n &&
      row.function_count === 1n &&
      row.settings_check_ready &&
      row.item_binding_check_ready &&
      row.structured_scope_check_ready &&
      row.generation_guard_ready,
    ),
  };
}

async function knowledgeV2SnapshotAuthorizationManifestState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      column_count: bigint;
      constraint_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      pre_migration_reuse_index_ready: boolean;
      reuse_index_ready: boolean;
      legacy_null_reuse_index_ready: boolean;
      manifest_check_ready: boolean;
      structured_ready_check_ready: boolean;
      snapshot_trigger_ready: boolean;
      item_trigger_ready: boolean;
      snapshot_guard_ready: boolean;
      item_assert_ready: boolean;
      item_guard_ready: boolean;
      publication_trigger_ready: boolean;
      publication_guard_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeIndexSnapshot'
          AND column_name IN (
            'authorizationManifest',
            'authorizationManifestHash',
            'authorizationManifestVersion'
          )
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conrelid = '"KnowledgeIndexSnapshot"'::regclass
          AND conname IN (
            'KnowledgeIndexSnapshot_authorization_manifest_check',
            'KnowledgeIndexSnapshot_structured_ready_authorization_check'
          )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgenabled <> 'D'
          AND tgname IN (
            'KnowledgeIndexSnapshot_authorization_immutable',
            'KnowledgeV2IndexSnapshotItem_snapshot_immutable',
            'KnowledgePublication_snapshot_attachment_guard'
          )
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN (
            'KnowledgeIndexSnapshot_guard_authorization_mutation',
            'KnowledgeIndexSnapshot_assert_v2_items_mutable',
            'KnowledgeV2IndexSnapshotItem_guard_mutation',
            'KnowledgePublication_validate_snapshot_attachment'
          )
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'KnowledgeIndexSnapshot_reuse_key'
          AND index_state.indisunique
          AND index_state.indnkeyatts = 6
          AND pg_get_indexdef(index_state.indexrelid) LIKE '%("tenantId", "manifestHash", "collectionName", "embeddingProvider", "embeddingModel", "pipelineVersion")%'
          AND pg_get_indexdef(index_state.indexrelid) NOT LIKE '%authorizationManifestVersion%'
      ) AS "pre_migration_reuse_index_ready",
      EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'KnowledgeIndexSnapshot_reuse_key'
          AND index_state.indisunique
          AND index_state.indnkeyatts = 7
          AND pg_get_indexdef(index_state.indexrelid) LIKE '%("tenantId", "manifestHash", "collectionName", "embeddingProvider", "embeddingModel", "pipelineVersion", "authorizationManifestVersion")%'
      ) AS "reuse_index_ready",
      EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'KnowledgeIndexSnapshot_legacy_reuse_key'
          AND index_state.indisunique
          AND index_state.indnkeyatts = 6
          AND pg_get_indexdef(index_state.indexrelid) LIKE '%("tenantId", "manifestHash", "collectionName", "embeddingProvider", "embeddingModel", "pipelineVersion")%'
          AND pg_get_expr(index_state.indpred, index_state.indrelid) LIKE '%"authorizationManifestVersion" IS NULL%'
      ) AS "legacy_null_reuse_index_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"KnowledgeIndexSnapshot"'::regclass
          AND conname = 'KnowledgeIndexSnapshot_authorization_manifest_check'
          AND convalidated
          AND pg_get_constraintdef(oid) LIKE '%"authorizationManifest" IS NULL%'
          AND pg_get_constraintdef(oid) LIKE '%"authorizationManifestHash" IS NULL%'
          AND pg_get_constraintdef(oid) LIKE '%"authorizationManifestVersion" IS NULL%'
          AND pg_get_constraintdef(oid) LIKE '%"corpusKind" = ''STRUCTURED_V2''%'
          AND pg_get_constraintdef(oid) LIKE '%status <> ''READY''%'
          AND pg_get_constraintdef(oid) LIKE '%"authorizationManifestVersion" = 1%'
          AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof("authorizationManifest")%'
          AND pg_get_constraintdef(oid) LIKE '%authorizationManifestHash%'
          AND pg_get_constraintdef(oid) LIKE '%authorizationManifestVersion%'
          AND pg_get_constraintdef(oid) LIKE '%^[a-f0-9]{64}$%'
          AND pg_get_constraintdef(oid) LIKE '%>= 1%'
      ) AS "manifest_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"KnowledgeIndexSnapshot"'::regclass
          AND conname = 'KnowledgeIndexSnapshot_structured_ready_authorization_check'
          AND NOT convalidated
          AND pg_get_constraintdef(oid) LIKE '%STRUCTURED_V2%'
          AND pg_get_constraintdef(oid) LIKE '%READY%'
          AND pg_get_constraintdef(oid) LIKE '%authorizationManifestVersion%'
          AND pg_get_constraintdef(oid) LIKE '%^[a-f0-9]{64}$%'
          AND pg_get_constraintdef(oid) LIKE '%= 1%'
          AND pg_get_constraintdef(oid) NOT LIKE '%>= 1%'
      ) AS "structured_ready_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgenabled <> 'D'
          AND tgrelid = '"KnowledgeIndexSnapshot"'::regclass
          AND tgname = 'KnowledgeIndexSnapshot_authorization_immutable'
          AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE%'
          AND pg_get_triggerdef(oid) LIKE '%authorizationManifest%'
          AND pg_get_triggerdef(oid) LIKE '%authorizationManifestHash%'
          AND pg_get_triggerdef(oid) LIKE '%authorizationManifestVersion%'
          AND pg_get_triggerdef(oid) LIKE '%status%'
      ) AS "snapshot_trigger_ready",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgenabled <> 'D'
          AND tgrelid = '"KnowledgeV2IndexSnapshotItem"'::regclass
          AND tgname = 'KnowledgeV2IndexSnapshotItem_snapshot_immutable'
          AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE%'
      ) AS "item_trigger_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname = 'KnowledgeIndexSnapshot_guard_authorization_mutation'
          AND pg_get_functiondef(oid) LIKE '%FOR UPDATE OF snapshot%'
          AND pg_get_functiondef(oid) LIKE '%FROM "KnowledgePublication"%'
          AND strpos(pg_get_functiondef(oid), 'FOR UPDATE OF snapshot')
            < strpos(pg_get_functiondef(oid), 'FROM "KnowledgePublication"')
          AND pg_get_functiondef(oid) LIKE '%OLD."status" = ''READY''%'
          AND pg_get_functiondef(oid) LIKE '%snapshot authorization fields or status are immutable after publication%'
          AND pg_get_functiondef(oid) LIKE '%READY snapshot authorization must be repaired only after moving it out of READY%'
      ) AS "snapshot_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname = 'KnowledgeIndexSnapshot_assert_v2_items_mutable'
          AND pg_get_functiondef(oid) LIKE '%FOR UPDATE OF snapshot%'
          AND pg_get_functiondef(oid) LIKE '%IF NOT FOUND THEN%'
          AND pg_get_functiondef(oid) LIKE '%FROM "KnowledgePublication"%'
          AND strpos(pg_get_functiondef(oid), 'FOR UPDATE OF snapshot')
            < strpos(pg_get_functiondef(oid), 'FROM "KnowledgePublication"')
          AND pg_get_functiondef(oid) LIKE '%snapshot_status = ''READY''%'
          AND pg_get_functiondef(oid) LIKE '%snapshot items are immutable after publication%'
          AND pg_get_functiondef(oid) LIKE '%READY snapshot items must be repaired only after moving it out of READY%'
      ) AS "item_assert_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname = 'KnowledgeV2IndexSnapshotItem_guard_mutation'
          AND pg_get_functiondef(oid) LIKE '%TG_OP = ''INSERT''%'
          AND pg_get_functiondef(oid) LIKE '%TG_OP = ''DELETE''%'
          AND pg_get_functiondef(oid) LIKE '%OLD."snapshotId" IS DISTINCT FROM NEW."snapshotId"%'
      ) AS "item_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgenabled <> 'D'
          AND tgrelid = '"KnowledgePublication"'::regclass
          AND tgname = 'KnowledgePublication_snapshot_attachment_guard'
          AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF%'
          AND pg_get_triggerdef(oid) LIKE '%indexSnapshotId%'
      ) AS "publication_trigger_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname = 'KnowledgePublication_validate_snapshot_attachment'
          AND pg_get_functiondef(oid) LIKE '%FOR UPDATE OF snapshot%'
          AND pg_get_functiondef(oid) LIKE '%publication snapshot must be READY%'
          AND pg_get_functiondef(oid) LIKE '%snapshot_authorization_manifest_version IS DISTINCT FROM 1%'
          AND strpos(pg_get_functiondef(oid), 'FOR UPDATE OF snapshot')
            < strpos(pg_get_functiondef(oid), 'snapshot_status <> ''READY''')
      ) AS "publication_guard_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.column_count > 0n ||
      row.constraint_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n ||
      row.reuse_index_ready ||
      row.legacy_null_reuse_index_ready ||
      !row.pre_migration_reuse_index_ready),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.column_count === 3n &&
      row.constraint_count === 2n &&
      row.trigger_count === 3n &&
      row.function_count === 4n &&
      row.reuse_index_ready &&
      row.legacy_null_reuse_index_ready &&
      row.manifest_check_ready &&
      row.structured_ready_check_ready &&
      row.snapshot_trigger_ready &&
      row.item_trigger_ready &&
      row.snapshot_guard_ready &&
      row.item_assert_ready &&
      row.item_guard_ready &&
      row.publication_trigger_ready &&
      row.publication_guard_ready,
    ),
  };
}

async function knowledgeV2QueryHashMetadataState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      column_count: bigint;
      constraint_count: bigint;
      columns_ready: boolean;
      constraints_ready: boolean;
    }>
  >`
    WITH expected_columns("tableName", "columnName") AS (
      VALUES
        ('KnowledgeV2TestCaseVersion', 'queryHashKeyId'),
        ('KnowledgeV2TestCaseVersion', 'queryHashVersion'),
        ('KnowledgeV2EvaluationRun', 'queryHashKeyId'),
        ('KnowledgeV2EvaluationRun', 'queryHashVersion'),
        ('KnowledgeV2RetrievalTrace', 'queryHashKeyId'),
        ('KnowledgeV2RetrievalTrace', 'queryHashVersion'),
        ('KnowledgeV2LiveToolExecution', 'queryHashKeyId'),
        ('KnowledgeV2LiveToolExecution', 'queryHashVersion')
    ),
    expected_constraints("tableName", "constraintName", "definition") AS (
      VALUES
        (
          'KnowledgeV2TestCaseVersion',
          'KnowledgeV2TestCaseVersion_query_hash_metadata_check',
          'CHECK (((('
            || '"queryHashKeyId" IS NULL) AND ("queryHashVersion" IS NULL)) OR '
            || '(("queryHashKeyId" IS NOT NULL) AND ("queryHashVersion" IS NOT NULL) '
            || 'AND ("queryHash" ~ ''^[a-f0-9]{64}$''::text) '
            || 'AND ("queryHashKeyId" ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$''::text) '
            || 'AND ("queryHashVersion" = ''knowledge-query-hmac-sha256-v1''::text))))'
        ),
        (
          'KnowledgeV2EvaluationRun',
          'KnowledgeV2EvaluationRun_query_hash_metadata_check',
          'CHECK (((('
            || '"queryHashKeyId" IS NULL) AND ("queryHashVersion" IS NULL)) OR '
            || '(("queryHash" IS NOT NULL) AND ("queryHashKeyId" IS NOT NULL) '
            || 'AND ("queryHashVersion" IS NOT NULL) '
            || 'AND ("queryHash" ~ ''^[a-f0-9]{64}$''::text) '
            || 'AND ("queryHashKeyId" ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$''::text) '
            || 'AND ("queryHashVersion" = ''knowledge-query-hmac-sha256-v1''::text))))'
        ),
        (
          'KnowledgeV2RetrievalTrace',
          'KnowledgeV2RetrievalTrace_query_hash_metadata_check',
          'CHECK (((('
            || '"queryHashKeyId" IS NULL) AND ("queryHashVersion" IS NULL)) OR '
            || '(("queryHashKeyId" IS NOT NULL) AND ("queryHashVersion" IS NOT NULL) '
            || 'AND ("queryHash" ~ ''^[a-f0-9]{64}$''::text) '
            || 'AND ("queryHashKeyId" ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$''::text) '
            || 'AND ("queryHashVersion" = ''knowledge-query-hmac-sha256-v1''::text))))'
        ),
        (
          'KnowledgeV2LiveToolExecution',
          'KnowledgeV2LiveToolExecution_query_hash_metadata_check',
          'CHECK (((('
            || '"queryHashKeyId" IS NULL) AND ("queryHashVersion" IS NULL)) OR '
            || '(("queryHashKeyId" IS NOT NULL) AND ("queryHashVersion" IS NOT NULL) '
            || 'AND ("queryHash" ~ ''^[a-f0-9]{64}$''::text) '
            || 'AND ("queryHashKeyId" ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$''::text) '
            || 'AND ("queryHashVersion" = ''knowledge-query-hmac-sha256-v1''::text))))'
        )
    )
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'KnowledgeV2TestCaseVersion',
            'KnowledgeV2EvaluationRun',
            'KnowledgeV2RetrievalTrace',
            'KnowledgeV2LiveToolExecution'
          )
          AND column_name IN ('queryHashKeyId', 'queryHashVersion')
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND constraint_record.conname IN (
          'KnowledgeV2TestCaseVersion_query_hash_metadata_check',
          'KnowledgeV2EvaluationRun_query_hash_metadata_check',
          'KnowledgeV2RetrievalTrace_query_hash_metadata_check',
          'KnowledgeV2LiveToolExecution_query_hash_metadata_check'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*) = 8
        FROM expected_columns AS expected
        INNER JOIN information_schema.columns AS column_record
          ON column_record.table_schema = 'public'
          AND column_record.table_name = expected."tableName"
          AND column_record.column_name = expected."columnName"
        WHERE column_record.data_type = 'text'
          AND column_record.udt_schema = 'pg_catalog'
          AND column_record.udt_name = 'text'
          AND column_record.domain_name IS NULL
          AND column_record.is_nullable = 'YES'
          AND column_record.column_default IS NULL
          AND column_record.is_identity = 'NO'
          AND column_record.is_generated = 'NEVER'
      ) AS "columns_ready",
      (
        SELECT COUNT(*) = 4
        FROM expected_constraints AS expected
        INNER JOIN pg_class AS table_record
          ON table_record.relname = expected."tableName"
          AND table_record.relkind = 'r'
        INNER JOIN pg_namespace AS schema_record
          ON schema_record.oid = table_record.relnamespace
          AND schema_record.nspname = 'public'
        INNER JOIN pg_constraint AS constraint_record
          ON constraint_record.conrelid = table_record.oid
          AND constraint_record.conname = expected."constraintName"
        WHERE constraint_record.contype = 'c'
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND NOT constraint_record.connoinherit
          AND pg_get_constraintdef(constraint_record.oid) = expected."definition"
      ) AS "constraints_ready"
  `;
  const row = rows[0];
  const present = Boolean(row && (row.column_count > 0n || row.constraint_count > 0n));
  return {
    present,
    complete: Boolean(
      row &&
      row.column_count === 8n &&
      row.constraint_count === 4n &&
      row.columns_ready &&
      row.constraints_ready,
    ),
  };
}

async function knowledgeV2QueryHashKeyRegistryState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      table_count: bigint;
      column_count: bigint;
      constraint_count: bigint;
      trigger_count: bigint;
      function_count: bigint;
      table_ready: boolean;
      columns_ready: boolean;
      primary_key_ready: boolean;
      metadata_check_ready: boolean;
      trigger_ready: boolean;
      function_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2QueryHashKeyRegistry'
      ) AS "table_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2QueryHashKeyRegistry'
          AND column_name IN ('keyId', 'queryHashVersion', 'keyCheck', 'createdAt')
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND constraint_record.conname IN (
            'KnowledgeV2QueryHashKeyRegistry_pkey',
            'KnowledgeV2QueryHashKeyRegistry_metadata_check'
          )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger AS trigger_record
        INNER JOIN pg_class AS table_record ON table_record.oid = trigger_record.tgrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        INNER JOIN pg_proc AS function_record ON function_record.oid = trigger_record.tgfoid
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND trigger_record.tgname = 'KnowledgeV2QueryHashKeyRegistry_immutable'
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled <> 'D'
          AND (trigger_record.tgtype & 1) = 1
          AND (trigger_record.tgtype & 2) = 2
          AND (trigger_record.tgtype & 8) = 8
          AND (trigger_record.tgtype & 16) = 16
          AND function_record.proname = 'KnowledgeV2QueryHashKeyRegistry_reject_mutation'
      ) AS "trigger_count",
      (
        SELECT COUNT(*)
        FROM pg_proc AS function_record
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
        WHERE schema_record.nspname = 'public'
          AND function_record.proname = 'KnowledgeV2QueryHashKeyRegistry_reject_mutation'
          AND pg_get_function_identity_arguments(function_record.oid) = ''
      ) AS "function_count",
      EXISTS (
        SELECT 1
        FROM pg_class AS table_record
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND table_record.relkind = 'r'
          AND table_record.relpersistence = 'p'
      ) AS "table_ready",
      (
        SELECT
          COUNT(*) = 4
          AND COUNT(*) FILTER (
            WHERE column_name = 'keyId'
              AND ordinal_position = 1
              AND data_type = 'text'
              AND is_nullable = 'NO'
              AND column_default IS NULL
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name = 'queryHashVersion'
              AND ordinal_position = 2
              AND data_type = 'text'
              AND is_nullable = 'NO'
              AND column_default IS NULL
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name = 'keyCheck'
              AND ordinal_position = 3
              AND data_type = 'text'
              AND is_nullable = 'NO'
              AND column_default IS NULL
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name = 'createdAt'
              AND ordinal_position = 4
              AND data_type = 'timestamp without time zone'
              AND datetime_precision = 3
              AND is_nullable = 'NO'
              AND column_default = 'CURRENT_TIMESTAMP'
          ) = 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'KnowledgeV2QueryHashKeyRegistry'
      ) AS "columns_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND constraint_record.conname = 'KnowledgeV2QueryHashKeyRegistry_pkey'
          AND constraint_record.contype = 'p'
          AND pg_get_constraintdef(constraint_record.oid) = 'PRIMARY KEY ("keyId")'
      ) AS "primary_key_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND constraint_record.conname = 'KnowledgeV2QueryHashKeyRegistry_metadata_check'
          AND constraint_record.contype = 'c'
          AND pg_get_constraintdef(constraint_record.oid) =
            'CHECK ((("keyId" ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$''::text) AND ("queryHashVersion" = ''knowledge-query-hmac-sha256-v1''::text) AND ("keyCheck" ~ ''^[a-f0-9]{64}$''::text)))'
      ) AS "metadata_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger_record
        INNER JOIN pg_class AS table_record ON table_record.oid = trigger_record.tgrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        INNER JOIN pg_proc AS function_record ON function_record.oid = trigger_record.tgfoid
        INNER JOIN pg_namespace AS function_schema ON function_schema.oid = function_record.pronamespace
        WHERE schema_record.nspname = 'public'
          AND table_record.relname = 'KnowledgeV2QueryHashKeyRegistry'
          AND trigger_record.tgname = 'KnowledgeV2QueryHashKeyRegistry_immutable'
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled = 'O'
          AND trigger_record.tgtype = 27
          AND function_schema.nspname = 'public'
          AND function_record.proname = 'KnowledgeV2QueryHashKeyRegistry_reject_mutation'
          AND pg_get_function_identity_arguments(function_record.oid) = ''
      ) AS "trigger_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc AS function_record
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
        INNER JOIN pg_language AS language_record ON language_record.oid = function_record.prolang
        WHERE schema_record.nspname = 'public'
          AND function_record.proname = 'KnowledgeV2QueryHashKeyRegistry_reject_mutation'
          AND pg_get_function_identity_arguments(function_record.oid) = ''
          AND function_record.prorettype = 'trigger'::regtype
          AND function_record.pronargs = 0
          AND function_record.provolatile = 'v'
          AND NOT function_record.prosecdef
          AND language_record.lanname = 'plpgsql'
          AND btrim(regexp_replace(function_record.prosrc, '\\s+', ' ', 'g')) =
            'BEGIN RAISE EXCEPTION ''knowledge query HMAC key registry rows are immutable'' USING ERRCODE = ''55000''; RETURN OLD; END;'
      ) AS "function_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.table_count > 0n ||
      row.column_count > 0n ||
      row.constraint_count > 0n ||
      row.trigger_count > 0n ||
      row.function_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.table_count === 1n &&
      row.column_count === 4n &&
      row.constraint_count === 2n &&
      row.trigger_count === 1n &&
      row.function_count === 1n &&
      row.table_ready &&
      row.columns_ready &&
      row.primary_key_ready &&
      row.metadata_check_ready &&
      row.trigger_ready &&
      row.function_ready,
    ),
  };
}

async function channelAutomaticReplyActivationState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      column_count: bigint;
      check_constraint_count: bigint;
      foreign_key_count: bigint;
      index_count: bigint;
      columns_ready: boolean;
      generation_check_ready: boolean;
      publication_etag_check_ready: boolean;
      binding_check_ready: boolean;
      publication_foreign_key_ready: boolean;
      enabled_status_index_ready: boolean;
      publication_index_ready: boolean;
      conversation_default_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Channel'
          AND column_name IN (
            'automaticRepliesEnabled',
            'automaticRepliesGeneration',
            'automaticRepliesPublicationId',
            'automaticRepliesPublicationEtag',
            'automaticRepliesChannelFingerprint',
            'automaticRepliesActivatedAt',
            'automaticRepliesActivatedByUserId'
          )
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.contype = 'c'
          AND constraint_record.conname IN (
            'Channel_automaticRepliesGeneration_check',
            'Channel_automaticRepliesPublicationEtag_check',
            'Channel_automaticRepliesBinding_check'
          )
      ) AS "check_constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.contype = 'f'
          AND constraint_record.conname = 'Channel_automaticRepliesPublication_fkey'
      ) AS "foreign_key_count",
      (
        SELECT COUNT(*)
        FROM pg_index AS index_state
        INNER JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname IN (
            'Channel_tenantId_automaticRepliesEnabled_status_idx',
            'Channel_tenantId_automaticRepliesPublicationId_idx'
          )
      ) AS "index_count",
      (
        SELECT
          COUNT(*) = 7
          AND COUNT(*) FILTER (
            WHERE column_name = 'automaticRepliesEnabled'
              AND data_type = 'boolean'
              AND udt_schema = 'pg_catalog'
              AND udt_name = 'bool'
              AND domain_name IS NULL
              AND is_nullable = 'NO'
              AND column_default = 'false'
              AND is_identity = 'NO'
              AND is_generated = 'NEVER'
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name = 'automaticRepliesGeneration'
              AND data_type = 'integer'
              AND udt_schema = 'pg_catalog'
              AND udt_name = 'int4'
              AND domain_name IS NULL
              AND is_nullable = 'NO'
              AND column_default = '1'
              AND is_identity = 'NO'
              AND is_generated = 'NEVER'
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name IN (
              'automaticRepliesPublicationId',
              'automaticRepliesChannelFingerprint',
              'automaticRepliesActivatedByUserId'
            )
              AND data_type = 'text'
              AND udt_schema = 'pg_catalog'
              AND udt_name = 'text'
              AND domain_name IS NULL
              AND is_nullable = 'YES'
              AND column_default IS NULL
              AND is_identity = 'NO'
              AND is_generated = 'NEVER'
          ) = 3
          AND COUNT(*) FILTER (
            WHERE column_name = 'automaticRepliesPublicationEtag'
              AND data_type = 'integer'
              AND udt_schema = 'pg_catalog'
              AND udt_name = 'int4'
              AND domain_name IS NULL
              AND is_nullable = 'YES'
              AND column_default IS NULL
              AND is_identity = 'NO'
              AND is_generated = 'NEVER'
          ) = 1
          AND COUNT(*) FILTER (
            WHERE column_name = 'automaticRepliesActivatedAt'
              AND data_type = 'timestamp without time zone'
              AND udt_schema = 'pg_catalog'
              AND udt_name = 'timestamp'
              AND domain_name IS NULL
              AND datetime_precision = 3
              AND is_nullable = 'YES'
              AND column_default IS NULL
              AND is_identity = 'NO'
              AND is_generated = 'NEVER'
          ) = 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Channel'
          AND column_name IN (
            'automaticRepliesEnabled',
            'automaticRepliesGeneration',
            'automaticRepliesPublicationId',
            'automaticRepliesPublicationEtag',
            'automaticRepliesChannelFingerprint',
            'automaticRepliesActivatedAt',
            'automaticRepliesActivatedByUserId'
          )
      ) AS "columns_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.conname = 'Channel_automaticRepliesGeneration_check'
          AND constraint_record.contype = 'c'
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND NOT constraint_record.connoinherit
          AND pg_get_constraintdef(constraint_record.oid) =
            'CHECK (("automaticRepliesGeneration" >= 1))'
      ) AS "generation_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.conname = 'Channel_automaticRepliesPublicationEtag_check'
          AND constraint_record.contype = 'c'
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND NOT constraint_record.connoinherit
          AND pg_get_constraintdef(constraint_record.oid) =
            'CHECK ((("automaticRepliesPublicationEtag" IS NULL) OR ("automaticRepliesPublicationEtag" >= 1)))'
      ) AS "publication_etag_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.conname = 'Channel_automaticRepliesBinding_check'
          AND constraint_record.contype = 'c'
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND NOT constraint_record.connoinherit
          AND (
            pg_get_constraintdef(constraint_record.oid) =
              'CHECK (((("automaticRepliesEnabled" = false) AND ("automaticRepliesPublicationId" IS NULL) AND ("automaticRepliesPublicationEtag" IS NULL) AND ("automaticRepliesChannelFingerprint" IS NULL) AND ("automaticRepliesActivatedAt" IS NULL) AND ("automaticRepliesActivatedByUserId" IS NULL)) OR (("automaticRepliesEnabled" = true) AND ("automaticRepliesPublicationId" IS NOT NULL) AND ("automaticRepliesPublicationEtag" IS NOT NULL) AND ("automaticRepliesChannelFingerprint" IS NOT NULL) AND ("automaticRepliesActivatedAt" IS NOT NULL) AND ("automaticRepliesActivatedByUserId" IS NOT NULL))))'
            OR (
              position('automaticRepliesCapabilitySetHash' IN pg_get_constraintdef(constraint_record.oid)) > 0
              AND position('"automaticRepliesEnabled" = false' IN pg_get_constraintdef(constraint_record.oid)) > 0
              AND position('"automaticRepliesEnabled" = true' IN pg_get_constraintdef(constraint_record.oid)) > 0
              AND position('"automaticRepliesCapabilitySetHash" IS NULL' IN pg_get_constraintdef(constraint_record.oid)) > 0
              AND position('"automaticRepliesCapabilitySetHash" IS NOT NULL' IN pg_get_constraintdef(constraint_record.oid)) > 0
            )
          )
      ) AS "binding_check_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.conname = 'Channel_automaticRepliesPublication_fkey'
          AND constraint_record.contype = 'f'
          AND constraint_record.confrelid = 'public."KnowledgePublication"'::regclass
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND constraint_record.confmatchtype = 's'
          AND constraint_record.confupdtype = 'a'
          AND constraint_record.confdeltype = 'a'
          AND NOT constraint_record.condeferrable
          AND NOT constraint_record.condeferred
          AND (
            (
              ARRAY(
                SELECT source_attribute.attname
                FROM unnest(constraint_record.conkey) WITH ORDINALITY AS source_key(attnum, position)
                INNER JOIN pg_attribute AS source_attribute
                  ON source_attribute.attrelid = constraint_record.conrelid
                  AND source_attribute.attnum = source_key.attnum
                ORDER BY source_key.position
              ) = ARRAY['tenantId', 'automaticRepliesPublicationId']::name[]
              AND ARRAY(
                SELECT target_attribute.attname
                FROM unnest(constraint_record.confkey) WITH ORDINALITY AS target_key(attnum, position)
                INNER JOIN pg_attribute AS target_attribute
                  ON target_attribute.attrelid = constraint_record.confrelid
                  AND target_attribute.attnum = target_key.attnum
                ORDER BY target_key.position
              ) = ARRAY['tenantId', 'id']::name[]
            )
            OR (
              ARRAY(
                SELECT source_attribute.attname
                FROM unnest(constraint_record.conkey) WITH ORDINALITY AS source_key(attnum, position)
                INNER JOIN pg_attribute AS source_attribute
                  ON source_attribute.attrelid = constraint_record.conrelid
                  AND source_attribute.attnum = source_key.attnum
                ORDER BY source_key.position
              ) = ARRAY[
                'tenantId',
                'automaticRepliesPublicationId',
                'automaticRepliesCapabilitySetHash',
                'automaticRepliesOperationalBindingHash',
                'automaticRepliesOperationalPermissionGeneration'
              ]::name[]
              AND ARRAY(
                SELECT target_attribute.attname
                FROM unnest(constraint_record.confkey) WITH ORDINALITY AS target_key(attnum, position)
                INNER JOIN pg_attribute AS target_attribute
                  ON target_attribute.attrelid = constraint_record.confrelid
                  AND target_attribute.attnum = target_key.attnum
                ORDER BY target_key.position
              ) = ARRAY[
                'tenantId',
                'id',
                'capabilitySetHash',
                'operationalBindingHash',
                'operationalPermissionGeneration'
              ]::name[]
            )
          )
      ) AS "publication_foreign_key_ready",
      EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        INNER JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        INNER JOIN pg_class AS table_relation ON table_relation.oid = index_state.indrelid
        INNER JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'Channel_tenantId_automaticRepliesEnabled_status_idx'
          AND table_relation.relnamespace = 'public'::regnamespace
          AND table_relation.relname = 'Channel'
          AND access_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
          AND NOT index_state.indisunique
          AND NOT index_state.indisprimary
          AND NOT index_state.indisexclusion
          AND index_state.indnkeyatts = 3
          AND index_state.indnatts = 3
          AND index_state.indpred IS NULL
          AND index_state.indexprs IS NULL
          AND ARRAY(
            SELECT indexed_attribute.attname
            FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed_key(attnum, position)
            INNER JOIN pg_attribute AS indexed_attribute
              ON indexed_attribute.attrelid = index_state.indrelid
              AND indexed_attribute.attnum = indexed_key.attnum
            ORDER BY indexed_key.position
          ) = ARRAY['tenantId', 'automaticRepliesEnabled', 'status']::name[]
      ) AS "enabled_status_index_ready",
      EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        INNER JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        INNER JOIN pg_class AS table_relation ON table_relation.oid = index_state.indrelid
        INNER JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
        WHERE index_relation.relnamespace = 'public'::regnamespace
          AND index_relation.relname = 'Channel_tenantId_automaticRepliesPublicationId_idx'
          AND table_relation.relnamespace = 'public'::regnamespace
          AND table_relation.relname = 'Channel'
          AND access_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
          AND NOT index_state.indisunique
          AND NOT index_state.indisprimary
          AND NOT index_state.indisexclusion
          AND index_state.indnkeyatts = 2
          AND index_state.indnatts = 2
          AND index_state.indpred IS NULL
          AND index_state.indexprs IS NULL
          AND ARRAY(
            SELECT indexed_attribute.attname
            FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed_key(attnum, position)
            INNER JOIN pg_attribute AS indexed_attribute
              ON indexed_attribute.attrelid = index_state.indrelid
              AND indexed_attribute.attnum = indexed_key.attnum
            ORDER BY indexed_key.position
          ) = ARRAY['tenantId', 'automaticRepliesPublicationId']::name[]
      ) AS "publication_index_ready",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Conversation'
          AND column_name = 'aiEnabled'
          AND data_type = 'boolean'
          AND udt_schema = 'pg_catalog'
          AND udt_name = 'bool'
          AND domain_name IS NULL
          AND is_nullable = 'NO'
          AND column_default = 'false'
          AND is_identity = 'NO'
          AND is_generated = 'NEVER'
      ) AS "conversation_default_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.column_count > 0n ||
      row.check_constraint_count > 0n ||
      row.foreign_key_count > 0n ||
      row.index_count > 0n ||
      row.conversation_default_ready),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.column_count === 7n &&
      row.check_constraint_count === 3n &&
      row.foreign_key_count === 1n &&
      row.index_count === 2n &&
      row.columns_ready &&
      row.generation_check_ready &&
      row.publication_etag_check_ready &&
      row.binding_check_ready &&
      row.publication_foreign_key_ready &&
      row.enabled_status_index_ready &&
      row.publication_index_ready &&
      row.conversation_default_ready,
    ),
  };
}

async function knowledgeV2CapabilitySnapshotState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      enum_count: bigint;
      table_count: bigint;
      column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      enums_ready: boolean;
      columns_ready: boolean;
      constraints_ready: boolean;
      indexes_ready: boolean;
      triggers_ready: boolean;
      channel_binding_ready: boolean;
    }>
  >`
    WITH expected_enum_labels("typeName", "label", "sortOrder") AS (
      VALUES
        ('KnowledgeV2CapabilityType', 'GENERAL_FAQ', 1),
        ('KnowledgeV2CapabilityType', 'LEAD_QUALIFICATION', 2),
        ('KnowledgeV2CapabilityType', 'PRICING', 3),
        ('KnowledgeV2CapabilityType', 'APPOINTMENT_DISCOVERY', 4),
        ('KnowledgeV2CapabilityType', 'APPOINTMENT_BOOKING', 5),
        ('KnowledgeV2CapabilityType', 'ORDER_ACCOUNT_SUPPORT', 6),
        ('KnowledgeV2CapabilityType', 'COMMERCE_RECOMMENDATION', 7),
        ('KnowledgeV2CapabilityType', 'REGULATED_TOPIC', 8),
        ('KnowledgeV2CapabilityAutonomy', 'ANSWER_ONLY', 1),
        ('KnowledgeV2CapabilityAutonomy', 'COLLECT_INFORMATION', 2),
        ('KnowledgeV2CapabilityAutonomy', 'PROPOSE_ACTION', 3),
        ('KnowledgeV2CapabilityAutonomy', 'ACT_WITH_CONFIRMATION', 4),
        ('KnowledgeV2CapabilityAutonomy', 'AUTONOMOUS_ACTION', 5),
        ('KnowledgeV2RequirementKind', 'FACT', 1),
        ('KnowledgeV2RequirementKind', 'RULE', 2),
        ('KnowledgeV2RequirementKind', 'DOCUMENT_COVERAGE', 3),
        ('KnowledgeV2RequirementKind', 'CONNECTOR', 4),
        ('KnowledgeV2RequirementKind', 'TOOL', 5),
        ('KnowledgeV2RequirementKind', 'PERMISSION', 6),
        ('KnowledgeV2RequirementKind', 'LOCALE', 7),
        ('KnowledgeV2RequirementKind', 'EVALUATION_CASE', 8),
        ('KnowledgeV2RequirementSeverity', 'BLOCKER', 1),
        ('KnowledgeV2RequirementSeverity', 'WARNING', 2),
        ('KnowledgeV2RequirementEvaluationStatus', 'PENDING', 1),
        ('KnowledgeV2RequirementEvaluationStatus', 'SATISFIED', 2),
        ('KnowledgeV2RequirementEvaluationStatus', 'UNSATISFIED', 3),
        ('KnowledgeV2RequirementEvaluationStatus', 'STALE', 4),
        ('KnowledgeV2RequirementEvaluationStatus', 'CONFLICTED', 5),
        ('KnowledgeV2RequirementEvaluationStatus', 'NOT_APPLICABLE', 6),
        ('KnowledgeV2RequirementEvaluationStatus', 'ERROR', 7)
    ), expected_tables("tableName") AS (
      VALUES
        ('KnowledgeV2Capability'),
        ('KnowledgeV2RequirementDefinition'),
        ('KnowledgeV2RequirementEvaluation'),
        ('KnowledgePublicationCapability')
    ), expected_columns("tableName", "columnName", "udtName", "nullable", "columnDefault") AS (
      VALUES
        ('KnowledgeV2Capability', 'id', 'text', 'NO', NULL),
        ('KnowledgeV2Capability', 'tenantId', 'text', 'NO', NULL),
        ('KnowledgeV2Capability', 'capabilityType', 'KnowledgeV2CapabilityType', 'NO', NULL),
        ('KnowledgeV2Capability', 'targetKey', 'text', 'NO', '''workspace-v2''::text'),
        ('KnowledgeV2Capability', 'enabled', 'bool', 'NO', 'false'),
        ('KnowledgeV2Capability', 'allowedAutonomy', 'KnowledgeV2CapabilityAutonomy', 'NO', '''ANSWER_ONLY''::"KnowledgeV2CapabilityAutonomy"'),
        ('KnowledgeV2Capability', 'scope', 'jsonb', 'YES', NULL),
        ('KnowledgeV2Capability', 'templateKey', 'text', 'NO', NULL),
        ('KnowledgeV2Capability', 'templateVersion', 'int4', 'NO', '1'),
        ('KnowledgeV2Capability', 'serverOwned', 'bool', 'NO', 'true'),
        ('KnowledgeV2Capability', 'generation', 'int4', 'NO', '1'),
        ('KnowledgeV2Capability', 'etag', 'int4', 'NO', '1'),
        ('KnowledgeV2Capability', 'createdByUserId', 'text', 'YES', NULL),
        ('KnowledgeV2Capability', 'updatedByUserId', 'text', 'YES', NULL),
        ('KnowledgeV2Capability', 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'),
        ('KnowledgeV2Capability', 'updatedAt', 'timestamp', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'id', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'tenantId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'capabilityId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'requirementKey', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'definitionVersion', 'int4', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'kind', 'KnowledgeV2RequirementKind', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'severity', 'KnowledgeV2RequirementSeverity', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'riskLevel', 'KnowledgeV2RiskLevel', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'active', 'bool', 'NO', 'true'),
        ('KnowledgeV2RequirementDefinition', 'freshnessSlaSeconds', 'int4', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'requiredScope', 'jsonb', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'localeConstraints', 'jsonb', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'satisfactionPredicate', 'jsonb', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'predicateVersion', 'text', 'NO', '''knowledge-requirement-v1''::text'),
        ('KnowledgeV2RequirementDefinition', 'templateOrigin', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'tenantOverride', 'bool', 'NO', 'false'),
        ('KnowledgeV2RequirementDefinition', 'immutableHash', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementDefinition', 'createdByUserId', 'text', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'approvedByUserId', 'text', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'approvedAt', 'timestamp', 'YES', NULL),
        ('KnowledgeV2RequirementDefinition', 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'),
        ('KnowledgeV2RequirementEvaluation', 'id', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'tenantId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'validationId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'capabilityId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'requirementDefinitionId', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'definitionVersion', 'int4', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'status', 'KnowledgeV2RequirementEvaluationStatus', 'NO', '''PENDING''::"KnowledgeV2RequirementEvaluationStatus"'),
        ('KnowledgeV2RequirementEvaluation', 'evidenceIds', '_text', 'NO', 'ARRAY[]::text[]'),
        ('KnowledgeV2RequirementEvaluation', 'reasonCode', 'text', 'YES', NULL),
        ('KnowledgeV2RequirementEvaluation', 'details', 'jsonb', 'YES', NULL),
        ('KnowledgeV2RequirementEvaluation', 'evaluatorVersion', 'text', 'NO', '''knowledge-requirement-v1''::text'),
        ('KnowledgeV2RequirementEvaluation', 'immutableHash', 'text', 'NO', NULL),
        ('KnowledgeV2RequirementEvaluation', 'evaluatedAt', 'timestamp', 'YES', NULL),
        ('KnowledgeV2RequirementEvaluation', 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'),
        ('KnowledgePublicationCapability', 'tenantId', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'publicationId', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'validationId', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'capabilityId', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'capabilityType', 'KnowledgeV2CapabilityType', 'NO', NULL),
        ('KnowledgePublicationCapability', 'allowedAutonomy', 'KnowledgeV2CapabilityAutonomy', 'NO', NULL),
        ('KnowledgePublicationCapability', 'capabilityEtag', 'int4', 'NO', NULL),
        ('KnowledgePublicationCapability', 'capabilitySnapshotHash', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'requirementEvaluationSetHash', 'text', 'NO', NULL),
        ('KnowledgePublicationCapability', 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'),
        ('KnowledgeV2PublicationValidation', 'capabilitySetHash', 'text', 'YES', NULL),
        ('KnowledgeV2PublicationValidation', 'requirementEvaluationSetHash', 'text', 'YES', NULL),
        ('KnowledgePublication', 'capabilitySetHash', 'text', 'YES', NULL),
        ('KnowledgePublication', 'requirementEvaluationSetHash', 'text', 'YES', NULL),
        ('Channel', 'automaticRepliesCapabilitySetHash', 'text', 'YES', NULL),
        ('AiReplyRun', 'capabilitySetHash', 'text', 'YES', NULL)
    ), expected_constraints("tableName", "constraintName", "constraintType") AS (
      VALUES
        ('KnowledgeV2Capability', 'KnowledgeV2Capability_pkey', 'p'),
        ('KnowledgeV2Capability', 'KnowledgeV2Capability_values_check', 'c'),
        ('KnowledgeV2Capability', 'KnowledgeV2Capability_tenantId_fkey', 'f'),
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_pkey', 'p'),
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_values_check', 'c'),
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_predicate_check', 'c'),
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_tenantId_fkey', 'f'),
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_tenantId_capabilityId_fkey', 'f'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_pkey', 'p'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_values_check', 'c'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_tenantId_fkey', 'f'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_tenantId_validationId_fkey', 'f'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_tenantId_capabilityId_fkey', 'f'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_definition_fkey', 'f'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_pkey', 'p'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_values_check', 'c'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_tenantId_fkey', 'f'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_tenantId_publicationId_fkey', 'f'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_validation_fkey', 'f'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_capability_fkey', 'f'),
        ('KnowledgeV2PublicationValidation', 'KnowledgeV2PublicationValidation_capabilityHashes_check', 'c'),
        ('KnowledgePublication', 'KnowledgePublication_capabilityHashes_check', 'c'),
        ('Channel', 'Channel_automaticRepliesCapabilitySetHash_check', 'c'),
        ('Channel', 'Channel_automaticRepliesBinding_check', 'c'),
        ('AiReplyRun', 'AiReplyRun_capabilitySetHash_check', 'c')
    ), expected_indexes("indexName") AS (
      VALUES
        ('KnowledgeV2Capability_tenantId_capabilityType_targetKey_key'),
        ('KnowledgeV2Capability_tenantId_id_key'),
        ('KnowledgeV2Capability_tenantId_id_capabilityType_key'),
        ('KnowledgeV2Capability_tenantId_enabled_targetKey_idx'),
        ('KnowledgeV2Capability_tenantId_templateKey_templateVersion_idx'),
        ('KnowledgeV2RequirementDefinition_tenantId_id_key'),
        ('KnowledgeV2RequirementDefinition_context_key'),
        ('KnowledgeV2RequirementDefinition_version_key'),
        ('KnowledgeV2RequirementDefinition_hash_key'),
        ('KnowledgeV2RequirementDefinition_active_idx'),
        ('KnowledgeV2RequirementDefinition_tenantId_kind_severity_idx'),
        ('KnowledgeV2RequirementEvaluation_tenantId_id_key'),
        ('KnowledgeV2RequirementEvaluation_validation_definition_key'),
        ('KnowledgeV2RequirementEvaluation_validation_status_idx'),
        ('KnowledgeV2RequirementEvaluation_capability_status_idx'),
        ('KnowledgeV2RequirementEvaluation_definition_idx'),
        ('KnowledgeV2PublicationValidation_result_key'),
        ('KnowledgePublicationCapability_context_key'),
        ('KnowledgePublicationCapability_type_key'),
        ('KnowledgePublicationCapability_tenantId_validationId_idx'),
        ('KnowledgePublicationCapability_tenantId_capabilityId_idx')
    ), expected_triggers("tableName", "triggerName", "functionName") AS (
      VALUES
        ('KnowledgeV2RequirementDefinition', 'KnowledgeV2RequirementDefinition_immutable', 'KnowledgeV2_reject_version_mutation'),
        ('KnowledgeV2RequirementEvaluation', 'KnowledgeV2RequirementEvaluation_immutable', 'KnowledgeV2_reject_audit_mutation'),
        ('KnowledgePublicationCapability', 'KnowledgePublicationCapability_immutable', 'KnowledgeV2_reject_audit_mutation')
    )
    SELECT
      (SELECT COUNT(*) FROM pg_type AS type_record
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = type_record.typnamespace
        INNER JOIN pg_enum AS enum_record ON enum_record.enumtypid = type_record.oid
        WHERE schema_record.nspname = 'public'
          AND type_record.typname IN (SELECT DISTINCT "typeName" FROM expected_enum_labels)) AS "enum_count",
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (SELECT "tableName" FROM expected_tables)) AS "table_count",
      (SELECT COUNT(*) FROM information_schema.columns AS column_record
        INNER JOIN expected_columns AS expected
          ON expected."tableName" = column_record.table_name AND expected."columnName" = column_record.column_name
        WHERE column_record.table_schema = 'public') AS "column_count",
      (SELECT COUNT(*) FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        INNER JOIN expected_constraints AS expected
          ON expected."tableName" = table_record.relname AND expected."constraintName" = constraint_record.conname
        WHERE schema_record.nspname = 'public') AS "constraint_count",
      (SELECT COUNT(*) FROM pg_class AS index_record
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = index_record.relnamespace
        WHERE schema_record.nspname = 'public' AND index_record.relkind = 'i'
          AND index_record.relname IN (SELECT "indexName" FROM expected_indexes)) AS "index_count",
      (SELECT COUNT(*) FROM pg_trigger AS trigger_record
        INNER JOIN pg_class AS table_record ON table_record.oid = trigger_record.tgrelid
        INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
        WHERE schema_record.nspname = 'public' AND NOT trigger_record.tgisinternal
          AND trigger_record.tgname IN (SELECT "triggerName" FROM expected_triggers)) AS "trigger_count",
      NOT EXISTS (
        SELECT 1 FROM expected_enum_labels AS expected
        LEFT JOIN (
          SELECT
            type_record.typname AS "typeName",
            enum_record.enumlabel AS "label",
            row_number() OVER (
              PARTITION BY type_record.oid
              ORDER BY enum_record.enumsortorder
            )::INTEGER AS "sortOrder"
          FROM pg_type AS type_record
          INNER JOIN pg_namespace AS schema_record
            ON schema_record.oid = type_record.typnamespace
            AND schema_record.nspname = 'public'
          INNER JOIN pg_enum AS enum_record ON enum_record.enumtypid = type_record.oid
        ) AS actual
          ON actual."typeName" = expected."typeName"
          AND actual."label" = expected."label"
          AND actual."sortOrder" = expected."sortOrder"
        WHERE actual."label" IS NULL
      ) AS "enums_ready",
      NOT EXISTS (
        SELECT 1 FROM expected_columns AS expected
        LEFT JOIN information_schema.columns AS column_record
          ON column_record.table_schema = 'public'
          AND column_record.table_name = expected."tableName"
          AND column_record.column_name = expected."columnName"
          AND column_record.udt_schema IN ('pg_catalog', 'public')
          AND column_record.udt_name = expected."udtName"
          AND column_record.is_nullable = expected."nullable"
          AND column_record.column_default IS NOT DISTINCT FROM expected."columnDefault"
          AND column_record.is_identity = 'NO'
          AND column_record.is_generated = 'NEVER'
        WHERE column_record.column_name IS NULL
      ) AS "columns_ready",
      NOT EXISTS (
        SELECT 1 FROM expected_constraints AS expected
        LEFT JOIN pg_class AS table_record ON table_record.relname = expected."tableName" AND table_record.relkind = 'r'
        LEFT JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace AND schema_record.nspname = 'public'
        LEFT JOIN pg_constraint AS constraint_record
          ON constraint_record.conrelid = table_record.oid
          AND constraint_record.conname = expected."constraintName"
          AND constraint_record.contype = expected."constraintType"::"char"
          AND constraint_record.convalidated
          AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
        WHERE constraint_record.oid IS NULL
      ) AS "constraints_ready",
      NOT EXISTS (
        SELECT 1 FROM expected_indexes AS expected
        LEFT JOIN pg_class AS index_record ON index_record.relname = expected."indexName" AND index_record.relkind = 'i'
        LEFT JOIN pg_namespace AS schema_record ON schema_record.oid = index_record.relnamespace AND schema_record.nspname = 'public'
        LEFT JOIN pg_index AS index_state
          ON index_state.indexrelid = index_record.oid
          AND index_state.indisvalid AND index_state.indisready AND index_state.indislive
          AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
        WHERE index_state.indexrelid IS NULL
      ) AS "indexes_ready",
      NOT EXISTS (
        SELECT 1 FROM expected_triggers AS expected
        LEFT JOIN pg_class AS table_record ON table_record.relname = expected."tableName" AND table_record.relkind = 'r'
        LEFT JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace AND schema_record.nspname = 'public'
        LEFT JOIN pg_trigger AS trigger_record
          ON trigger_record.tgrelid = table_record.oid
          AND trigger_record.tgname = expected."triggerName"
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled = 'O'
          AND trigger_record.tgtype = 27
        LEFT JOIN pg_proc AS function_record
          ON function_record.oid = trigger_record.tgfoid AND function_record.proname = expected."functionName"
        WHERE function_record.oid IS NULL
      ) AS "triggers_ready",
      EXISTS (
        SELECT 1 FROM pg_constraint AS constraint_record
        WHERE constraint_record.conrelid = 'public."Channel"'::regclass
          AND constraint_record.conname = 'Channel_automaticRepliesBinding_check'
          AND constraint_record.contype = 'c'
          AND constraint_record.convalidated
          AND position('automaticRepliesCapabilitySetHash' IN pg_get_constraintdef(constraint_record.oid)) > 0
      ) AS "channel_binding_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.enum_count > 0n ||
      row.table_count > 0n ||
      row.column_count > 0n ||
      row.index_count > 0n ||
      row.trigger_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.enum_count === 30n &&
      row.table_count === 4n &&
      row.column_count === 67n &&
      row.constraint_count === 25n &&
      row.index_count === 21n &&
      row.trigger_count === 3n &&
      row.enums_ready &&
      row.columns_ready &&
      row.constraints_ready &&
      row.indexes_ready &&
      row.triggers_ready &&
      row.channel_binding_ready,
    ),
  };
}

async function knowledgeV2ValidationHistoryState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      index_count: bigint;
      exact_non_unique_count: bigint;
      exact_legacy_unique_count: bigint;
    }>
  >`
    WITH candidate_index AS (
      SELECT
        index_state.indisunique AS "isUnique",
        (
          index_record.relkind = 'i'
          AND index_record.relpersistence = 'p'
          AND NOT index_record.relispartition
          AND index_record.reloptions IS NULL
          AND index_record.reltablespace = 0
          AND table_record.relkind = 'r'
          AND index_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
          AND NOT index_state.indisprimary
          AND NOT index_state.indisexclusion
          AND NOT index_state.indisreplident
          AND NOT index_state.indnullsnotdistinct
          AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint AS owning_constraint
            WHERE owning_constraint.conindid = index_record.oid
          )
          AND index_state.indpred IS NULL
          AND index_state.indexprs IS NULL
          AND index_state.indnatts = 4
          AND index_state.indnkeyatts = 4
          AND index_state.indoption::TEXT = '0 0 0 0'
          AND ARRAY(
            SELECT attribute_record.attname::TEXT
            FROM unnest(index_state.indkey) WITH ORDINALITY
              AS key_record(attribute_number, ordinal_position)
            INNER JOIN pg_attribute AS attribute_record
              ON attribute_record.attrelid = table_record.oid
              AND attribute_record.attnum = key_record.attribute_number
              AND NOT attribute_record.attisdropped
            WHERE key_record.ordinal_position <= index_state.indnkeyatts
            ORDER BY key_record.ordinal_position
          ) = ARRAY[
            'tenantId',
            'candidateId',
            'candidateVersion',
            'validationPolicyVersion'
          ]::TEXT[]
          AND ARRAY(
            SELECT opclass_record.opcname::TEXT
            FROM unnest(index_state.indclass) WITH ORDINALITY
              AS opclass_key(opclass_id, ordinal_position)
            INNER JOIN pg_opclass AS opclass_record
              ON opclass_record.oid = opclass_key.opclass_id
            INNER JOIN pg_namespace AS opclass_schema
              ON opclass_schema.oid = opclass_record.opcnamespace
              AND opclass_schema.nspname = 'pg_catalog'
            WHERE opclass_key.ordinal_position <= index_state.indnkeyatts
            ORDER BY opclass_key.ordinal_position
          ) = ARRAY['text_ops', 'text_ops', 'int4_ops', 'text_ops']::TEXT[]
        ) AS "shapeReady"
      FROM pg_class AS index_record
      INNER JOIN pg_namespace AS schema_record
        ON schema_record.oid = index_record.relnamespace
        AND schema_record.nspname = 'public'
      INNER JOIN pg_index AS index_state ON index_state.indexrelid = index_record.oid
      INNER JOIN pg_class AS table_record
        ON table_record.oid = index_state.indrelid
        AND table_record.relname = 'KnowledgeV2PublicationValidation'
      INNER JOIN pg_namespace AS table_schema
        ON table_schema.oid = table_record.relnamespace
        AND table_schema.nspname = 'public'
      INNER JOIN pg_am AS index_method ON index_method.oid = index_record.relam
      WHERE index_record.relname = 'KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key'
    )
    SELECT
      (
        SELECT COUNT(*)
        FROM pg_class AS index_record
        INNER JOIN pg_namespace AS schema_record
          ON schema_record.oid = index_record.relnamespace
        WHERE schema_record.nspname = 'public'
          AND index_record.relname = 'KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key'
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM candidate_index
        WHERE "shapeReady" AND NOT "isUnique"
      ) AS "exact_non_unique_count",
      (
        SELECT COUNT(*)
        FROM candidate_index
        WHERE "shapeReady" AND "isUnique"
      ) AS "exact_legacy_unique_count"
  `;
  const row = rows[0];
  return {
    present: Boolean(row && row.index_count > 0n),
    complete: Boolean(row && row.index_count === 1n && row.exact_non_unique_count === 1n),
    legacyUnique: Boolean(row && row.index_count === 1n && row.exact_legacy_unique_count === 1n),
  };
}

async function knowledgeV2OperationalAutonomyBindingState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      enum_ready: boolean;
      column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
      trigger_count: bigint;
      publication_guard_ready: boolean;
      channel_binding_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
        FROM pg_type AS enum_type
        INNER JOIN pg_namespace AS enum_schema
          ON enum_schema.oid = enum_type.typnamespace
          AND enum_schema.nspname = 'public'
        INNER JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
        WHERE enum_type.typname = 'KnowledgeV2CapabilityDecision'
      ) = ARRAY['AUTHORIZED', 'HANDOFF']::name[] AS "enum_ready",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('KnowledgeV2PublicationValidation', 'operationalBindingSchemaVersion'),
            ('KnowledgeV2PublicationValidation', 'operationalRegistryVersion'),
            ('KnowledgeV2PublicationValidation', 'operationalRegistryHash'),
            ('KnowledgeV2PublicationValidation', 'operationalDependencySetHash'),
            ('KnowledgeV2PublicationValidation', 'operationalBindingHash'),
            ('KnowledgeV2PublicationValidation', 'operationalPermissionGeneration'),
            ('KnowledgePublication', 'operationalBindingSchemaVersion'),
            ('KnowledgePublication', 'operationalRegistryVersion'),
            ('KnowledgePublication', 'operationalRegistryHash'),
            ('KnowledgePublication', 'operationalDependencySetHash'),
            ('KnowledgePublication', 'operationalBindingHash'),
            ('KnowledgePublication', 'operationalPermissionGeneration'),
            ('KnowledgePublicationCapability', 'operationalBindingHash'),
            ('KnowledgePublicationCapability', 'operationalPermissionGeneration'),
            ('Channel', 'automaticRepliesOperationalBindingHash'),
            ('Channel', 'automaticRepliesOperationalPermissionGeneration'),
            ('AiReplyRun', 'operationalBindingHash'),
            ('AiReplyRun', 'operationalPermissionGeneration'),
            ('AiReplyRun', 'capabilityType'),
            ('AiReplyRun', 'allowedAutonomy'),
            ('AiReplyRun', 'requiredAutonomy'),
            ('AiReplyRun', 'capabilityDecision')
          )
      ) AS "column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'KnowledgeV2PublicationValidation_operationalBinding_check',
          'KnowledgePublication_operationalBinding_check',
          'KnowledgePublicationCapability_operationalBinding_check',
          'Channel_automaticRepliesOperationalBindingHash_check',
          'Channel_automaticRepliesOperationalPermissionGeneration_check',
          'Channel_automaticRepliesBinding_check',
          'Channel_automaticRepliesPublication_fkey',
          'AiReplyRun_operationalBinding_check',
          'AiReplyRun_capabilityDecision_check',
          'AiReplyRun_tenant_publication_fkey',
          'AiReplyRun_runtimeCapability_fkey'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'KnowledgePublication_runtimeBinding_key',
            'KnowledgePublicationCapability_runtime_key'
          )
      ) AS "index_count",
      (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'KnowledgeV2PublicationValidation_operational_binding_immutable',
            'AiReplyRun_binding_immutable'
          )
      ) AS "trigger_count",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'Knowledge_reject_publication_mutation'
          AND pg_get_functiondef(oid) LIKE '%operationalBindingHash%'
          AND pg_get_functiondef(oid) LIKE '%requirementEvaluationSetHash%'
      ) AS "publication_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Channel_automaticRepliesBinding_check'
          AND pg_get_constraintdef(oid) LIKE '%automaticRepliesOperationalBindingHash%'
          AND pg_get_constraintdef(oid) LIKE '%automaticRepliesOperationalPermissionGeneration%'
      ) AS "channel_binding_ready"
  `;
  const row = rows[0];
  const present = Boolean(row && (row.enum_ready || row.column_count > 0n));
  return {
    present,
    complete: Boolean(
      row &&
      row.enum_ready &&
      row.column_count === 22n &&
      row.constraint_count === 11n &&
      row.index_count === 2n &&
      row.trigger_count === 2n &&
      row.publication_guard_ready &&
      row.channel_binding_ready,
    ),
  };
}

async function knowledgeV2SupportedAutonomyLimitState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      enum_ready: boolean;
      column_count: bigint;
      constraint_ready: boolean;
      outcome_guard_ready: boolean;
      outcome_trigger_ready: boolean;
    }>
  >`
    SELECT
      (
        SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
        FROM pg_type AS enum_type
        INNER JOIN pg_namespace AS enum_schema
          ON enum_schema.oid = enum_type.typnamespace
          AND enum_schema.nspname = 'public'
        INNER JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
        WHERE enum_type.typname = 'KnowledgeV2ReplyDisposition'
      ) = ARRAY['AUTO_SEND', 'HANDOFF']::name[] AS "enum_ready",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AiReplyRun'
          AND column_name IN (
            'replyDisposition',
            'replyContentHash',
            'replyTemplateVersion'
          )
      ) AS "column_count",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'AiReplyRun_replyOutcome_check'
          AND convalidated
          AND pg_get_constraintdef(oid) LIKE '%replyDisposition%'
          AND pg_get_constraintdef(oid) LIKE '%replyContentHash%'
          AND pg_get_constraintdef(oid) LIKE '%replyTemplateVersion%'
          AND pg_get_constraintdef(oid) LIKE '%publicationId%'
          AND pg_get_constraintdef(oid) LIKE '%replyMessageId%'
          AND pg_get_constraintdef(oid) LIKE '%SUCCEEDED%'
          AND pg_get_constraintdef(oid) LIKE '%AUTO_SEND%'
      ) AS "constraint_ready",
      EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'AiReplyRun_reject_binding_mutation'
          AND pg_get_functiondef(oid) LIKE '%replyDisposition%'
          AND pg_get_functiondef(oid) LIKE '%replyContentHash%'
          AND pg_get_functiondef(oid) LIKE '%replyTemplateVersion%'
          AND pg_get_functiondef(oid) LIKE '%TG_OP%'
          AND pg_get_functiondef(oid) LIKE '%RUNNING%'
          AND pg_get_functiondef(oid) LIKE '%SUCCEEDED%'
          AND pg_get_functiondef(oid) LIKE '%replyMessageId%'
      ) AS "outcome_guard_ready",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'AiReplyRun_binding_immutable'
          AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE%'
      ) AS "outcome_trigger_ready"
  `;
  const row = rows[0];
  const present = Boolean(
    row &&
    (row.enum_ready ||
      row.column_count > 0n ||
      row.constraint_ready ||
      row.outcome_guard_ready ||
      row.outcome_trigger_ready),
  );
  return {
    present,
    complete: Boolean(
      row &&
      row.enum_ready &&
      row.column_count === 3n &&
      row.constraint_ready &&
      row.outcome_guard_ready &&
      row.outcome_trigger_ready,
    ),
  };
}

async function hasUnsupportedKnowledgeV2CapabilityAutonomy(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "KnowledgeV2Capability"
      WHERE "allowedAutonomy" IN (
        'ACT_WITH_CONFIRMATION'::"KnowledgeV2CapabilityAutonomy",
        'AUTONOMOUS_ACTION'::"KnowledgeV2CapabilityAutonomy"
      )
    ) AS "present"
  `;
  return rows[0]?.present ?? false;
}

async function webhookProcessingFenceState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<
    Array<{
      webhook_column_count: bigint;
      workflow_column_count: bigint;
      constraint_count: bigint;
      index_count: bigint;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'WebhookEvent'
          AND column_name IN (
            'processingAttempt',
            'leaseToken',
            'leaseAcquiredAt',
            'leaseExpiresAt',
            'intakeCompletedAt',
            'aiDispatchCompletedAt',
            'workflowDispatchCompletedAt'
          )
      ) AS "webhook_column_count",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'WorkflowRun'
          AND column_name IN ('idempotencyKey', 'inputHash')
      ) AS "workflow_column_count",
      (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'WebhookEvent_processingAttempt_check',
          'WebhookEvent_lease_pair_check'
        )
      ) AS "constraint_count",
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'WebhookEvent_status_leaseExpiresAt_idx',
            'WorkflowRun_tenantId_workflowId_idempotencyKey_key'
          )
      ) AS "index_count"
  `;
  const state = rows[0];
  const present = Boolean(
    state &&
    (state.webhook_column_count > 0n ||
      state.workflow_column_count > 0n ||
      state.constraint_count > 0n ||
      state.index_count > 0n),
  );
  return {
    present,
    complete: Boolean(
      state &&
      state.webhook_column_count === 7n &&
      state.workflow_column_count === 2n &&
      state.constraint_count === 2n &&
      state.index_count === 2n,
    ),
  };
}

async function knowledgeV2SnapshotCutoverIdentityState(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ present: boolean; complete: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_proc AS function_record
        INNER JOIN pg_namespace AS schema_record
          ON schema_record.oid = function_record.pronamespace
        WHERE schema_record.nspname = current_schema()
          AND function_record.proname = 'KnowledgeV2_enforce_one_way_corpus_cutover'
          AND function_record.pronargs = 0
      ) AS "present",
      EXISTS (
        SELECT 1
        FROM pg_proc AS function_record
        INNER JOIN pg_namespace AS schema_record
          ON schema_record.oid = function_record.pronamespace
        WHERE schema_record.nspname = current_schema()
          AND function_record.proname = 'KnowledgeV2_enforce_one_way_corpus_cutover'
          AND function_record.pronargs = 0
          AND pg_get_functiondef(function_record.oid) LIKE '%authorizationManifestVersion%'
          AND pg_get_functiondef(function_record.oid) NOT LIKE '%snapshot_item."vectorPointId" <> chunk."vectorPointId"%'
      ) AS "complete"
  `;
  return rows[0] ?? { present: false, complete: false };
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let quote: "'" | '"' | null = null;
  let dollarQuote: string | null = null;
  let lineComment = false;
  let blockCommentDepth = 0;

  while (index < sql.length) {
    if (lineComment) {
      if (sql[index] === "\n") {
        lineComment = false;
      }
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (sql.startsWith("/*", index)) {
        blockCommentDepth += 1;
        index += 2;
      } else if (sql.startsWith("*/", index)) {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        dollarQuote = null;
      } else {
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (sql[index] === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }

    if (sql.startsWith("--", index)) {
      lineComment = true;
      index += 2;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (sql[index] === "'" || sql[index] === '"') {
      quote = sql[index] as "'" | '"';
      index += 1;
      continue;
    }
    if (sql[index] === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarQuote = match[0];
        index += dollarQuote.length;
        continue;
      }
    }
    if (sql[index] === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) {
        statements.push(statement);
      }
      start = index + 1;
    }
    index += 1;
  }

  const tail = sql.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

async function applySqlFile(prisma: PrismaClient, url: URL) {
  const sql = await readFile(url, "utf8");
  const statements = splitSqlStatements(sql).filter(
    (statement) => !["BEGIN", "COMMIT"].includes(statement.toUpperCase()),
  );

  await prisma.$transaction(
    async (tx) => {
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
    },
    { timeout: 120_000 },
  );

  return statements.length;
}

async function runMigrations(databaseUrl: string, testStopAfter: MigrationTestStopAfter | null) {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    if (await hasCoreSchema(prisma)) {
      console.log("Database schema already exists; skipping phase_2_core migration.");
    } else {
      const statementCount = await applySqlFile(prisma, migrationUrl);
      console.log(`Applied phase_2_core migration (${statementCount} statements).`);
    }

    if (await hasAuthSessionSchema(prisma)) {
      console.log("Auth session schema already exists; skipping auth_sessions migration.");
    } else {
      const statementCount = await applySqlFile(prisma, authSessionsMigrationUrl);
      console.log(`Applied auth_sessions migration (${statementCount} statements).`);
    }

    if (await hasAuthSessionMetadata(prisma)) {
      console.log(
        "Auth session metadata columns already exist; skipping auth_session_metadata migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, authSessionMetadataMigrationUrl);
      console.log(`Applied auth_session_metadata migration (${statementCount} statements).`);
    }

    if (await hasPasswordChangeRequired(prisma)) {
      console.log(
        "Password change required column already exists; skipping password_change_required migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, passwordChangeRequiredMigrationUrl);
      console.log(`Applied password_change_required migration (${statementCount} statements).`);
    }

    if (await hasUserTwoFactor(prisma)) {
      console.log("User two-factor columns already exist; skipping user_two_factor migration.");
    } else {
      const statementCount = await applySqlFile(prisma, userTwoFactorMigrationUrl);
      console.log(`Applied user_two_factor migration (${statementCount} statements).`);
    }

    if (await hasPasswordResetTokens(prisma)) {
      console.log(
        "Password reset token schema already exists; skipping password_reset_tokens migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, passwordResetTokensMigrationUrl);
      console.log(`Applied password_reset_tokens migration (${statementCount} statements).`);
    }

    if (await hasUserPhone(prisma)) {
      console.log("User phone column already exists; skipping user_phone migration.");
    } else {
      const statementCount = await applySqlFile(prisma, userPhoneMigrationUrl);
      console.log(`Applied user_phone migration (${statementCount} statements).`);
    }

    if (await hasBusinessKnowledgeSources(prisma)) {
      console.log(
        "Business knowledge source schema already exists; skipping business_knowledge_sources migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, businessKnowledgeSourcesMigrationUrl);
      console.log(`Applied business_knowledge_sources migration (${statementCount} statements).`);
    }

    if (await hasBusinessKnowledgeChunks(prisma)) {
      console.log(
        "Business knowledge chunk schema already exists; skipping business_knowledge_chunks migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, businessKnowledgeChunksMigrationUrl);
      console.log(`Applied business_knowledge_chunks migration (${statementCount} statements).`);
    }

    if (await hasEmailOtpAuth(prisma)) {
      console.log("Email OTP auth schema already exists; skipping email_otp_auth migration.");
    } else {
      const statementCount = await applySqlFile(prisma, emailOtpAuthMigrationUrl);
      console.log(`Applied email_otp_auth migration (${statementCount} statements).`);
    }

    if (await hasBusinessKnowledgePublicationFoundation(prisma)) {
      console.log(
        "Business knowledge publication foundation already exists; skipping business_knowledge_publication_foundation migration.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        businessKnowledgePublicationFoundationMigrationUrl,
      );
      console.log(
        `Applied business_knowledge_publication_foundation migration (${statementCount} statements).`,
      );
    }

    const aiReplyReliabilityFoundation = await hasAiReplyReliabilityFoundation(prisma);
    if (aiReplyReliabilityFoundation.complete) {
      console.log(
        "AI reply reliability foundation already exists; skipping ai_reply_reliability_foundation migration.",
      );
    } else if (aiReplyReliabilityFoundation.present) {
      throw new Error(
        "AI reply reliability foundation is partially installed; refusing to skip or replay destructive DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, aiReplyReliabilityFoundationMigrationUrl);
      console.log(
        `Applied ai_reply_reliability_foundation migration (${statementCount} statements).`,
      );
    }

    const runtimeRelationshipHardening = await hasRuntimeRelationshipHardening(prisma);
    if (runtimeRelationshipHardening.complete) {
      console.log(
        "Runtime relationship hardening already exists; skipping runtime_relationship_hardening migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, runtimeRelationshipHardeningMigrationUrl);
      console.log(
        `Applied runtime_relationship_hardening migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2SchemaFoundation = await hasKnowledgeV2SchemaFoundation(prisma);
    if (knowledgeV2SchemaFoundation.complete) {
      console.log(
        "Knowledge v2 schema foundation already exists; skipping knowledge_v2_schema_foundation migration.",
      );
    } else if (knowledgeV2SchemaFoundation.present) {
      throw new Error(
        "Knowledge v2 schema foundation is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2SchemaFoundationMigrationUrl);
      console.log(
        `Applied knowledge_v2_schema_foundation migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2IntegrityHardening = await hasKnowledgeV2IntegrityHardening(prisma);
    if (knowledgeV2IntegrityHardening.complete) {
      console.log(
        "Knowledge v2 integrity hardening already exists; skipping knowledge_v2_integrity_hardening migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2IntegrityHardeningMigrationUrl);
      console.log(
        `Applied knowledge_v2_integrity_hardening migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2SourceFoundation = await hasKnowledgeV2SourceFoundation(prisma);
    if (knowledgeV2SourceFoundation.complete) {
      console.log(
        "Knowledge v2 source foundation already exists; skipping knowledge_v2_source_foundation migration.",
      );
    } else if (knowledgeV2SourceFoundation.present) {
      throw new Error(
        "Knowledge v2 source foundation is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2SourceFoundationMigrationUrl);
      console.log(
        `Applied knowledge_v2_source_foundation migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2ReviewEvaluationFoundation =
      await hasKnowledgeV2ReviewEvaluationFoundation(prisma);
    if (knowledgeV2ReviewEvaluationFoundation.complete) {
      console.log(
        "Knowledge v2 review and evaluation foundation already exists; skipping knowledge_v2_review_evaluation_foundation migration.",
      );
    } else if (knowledgeV2ReviewEvaluationFoundation.present) {
      throw new Error(
        "Knowledge v2 review and evaluation foundation is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2ReviewEvaluationFoundationMigrationUrl,
      );
      console.log(
        `Applied knowledge_v2_review_evaluation_foundation migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2SnapshotPointIdentity = await hasKnowledgeV2SnapshotPointIdentity(prisma);
    if (knowledgeV2SnapshotPointIdentity.complete) {
      console.log(
        "Knowledge v2 snapshot point identity already exists; skipping knowledge_v2_snapshot_point_identity migration.",
      );
    } else if (knowledgeV2SnapshotPointIdentity.present) {
      const missingChecks = Object.entries(knowledgeV2SnapshotPointIdentity.checks)
        .filter(([, ready]) => !ready)
        .map(([name]) => name)
        .join(", ");
      throw new Error(
        `Knowledge v2 snapshot point identity is partially installed (${missingChecks}); refusing to replay its DDL.`,
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2SnapshotPointIdentityMigrationUrl,
      );
      console.log(
        `Applied knowledge_v2_snapshot_point_identity migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2EmbeddingCache = await hasKnowledgeV2EmbeddingCache(prisma);
    if (knowledgeV2EmbeddingCache.complete) {
      console.log(
        "Knowledge v2 embedding cache already exists; skipping knowledge_v2_embedding_cache migration.",
      );
    } else if (knowledgeV2EmbeddingCache.present) {
      throw new Error(
        "Knowledge v2 embedding cache is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2EmbeddingCacheMigrationUrl);
      console.log(`Applied knowledge_v2_embedding_cache migration (${statementCount} statements).`);
    }

    const knowledgeV2ModelProcessorPolicy = await hasKnowledgeV2ModelProcessorPolicy(prisma);
    if (knowledgeV2ModelProcessorPolicy.complete) {
      console.log(
        "Knowledge v2 model processor policy already exists; skipping knowledge_v2_model_processor_policy migration.",
      );
    } else if (knowledgeV2ModelProcessorPolicy.present) {
      throw new Error(
        "Knowledge v2 model processor policy is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2ModelProcessorPolicyMigrationUrl,
      );
      console.log(
        `Applied knowledge_v2_model_processor_policy migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2LegacyMigration = await hasKnowledgeV2LegacyMigration(prisma);
    if (knowledgeV2LegacyMigration.complete) {
      console.log(
        "Knowledge v2 legacy migration already exists; skipping knowledge_v2_legacy_migration migration.",
      );
    } else if (knowledgeV2LegacyMigration.present) {
      throw new Error(
        "Knowledge v2 legacy migration is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2LegacyMigrationUrl);
      console.log(
        `Applied knowledge_v2_legacy_migration migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2RestrictedResultHash = await hasKnowledgeV2RestrictedResultHash(prisma);
    if (knowledgeV2RestrictedResultHash.complete) {
      console.log(
        "Knowledge v2 restricted result hash already exists; skipping knowledge_v2_restricted_result_hash migration.",
      );
    } else if (knowledgeV2RestrictedResultHash.present) {
      throw new Error(
        "Knowledge v2 restricted result hash is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2RestrictedResultHashMigrationUrl,
      );
      console.log(
        `Applied knowledge_v2_restricted_result_hash migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2ResultAnswerRoles = await hasKnowledgeV2ResultAnswerRoles(prisma);
    if (knowledgeV2ResultAnswerRoles.complete) {
      console.log(
        "Knowledge v2 result answer roles already exist; skipping knowledge_v2_result_answer_roles migration.",
      );
    } else if (knowledgeV2ResultAnswerRoles.present) {
      throw new Error(
        "Knowledge v2 result answer roles are partially installed; refusing to replay their DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2ResultAnswerRolesMigrationUrl);
      console.log(
        `Applied knowledge_v2_result_answer_roles migration (${statementCount} statements).`,
      );
    }

    if (await hasKnowledgeV2TestExpectationPair(prisma)) {
      console.log(
        "Knowledge v2 test expectation pair already exists; skipping knowledge_v2_test_expectation_pair migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2TestExpectationPairMigrationUrl);
      console.log(
        `Applied knowledge_v2_test_expectation_pair migration (${statementCount} statements).`,
      );
    }

    if (await hasKnowledgeV2FileUploadIntents(prisma)) {
      console.log(
        "Knowledge v2 file upload intents already exist; skipping knowledge_v2_file_upload_intents migration.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2FileUploadIntentsMigrationUrl);
      console.log(
        `Applied knowledge_v2_file_upload_intents migration (${statementCount} statements).`,
      );
    }

    const userLocalePreference = await userLocalePreferenceState(prisma);
    if (userLocalePreference.complete) {
      console.log(
        "User locale preference already exists; skipping user_locale_preference migration.",
      );
    } else if (userLocalePreference.present) {
      throw new Error("User locale preference is partially installed; refusing to replay its DDL.");
    } else {
      const statementCount = await applySqlFile(prisma, userLocalePreferenceMigrationUrl);
      console.log(`Applied user_locale_preference migration (${statementCount} statements).`);
    }

    const knowledgeV2LiveToolLedger = await knowledgeV2LiveToolLedgerState(prisma);
    if (knowledgeV2LiveToolLedger.complete) {
      console.log(
        "Knowledge v2 live-tool ledger already exists; skipping knowledge_v2_live_tool_ledger migration.",
      );
    } else if (knowledgeV2LiveToolLedger.present) {
      throw new Error(
        "Knowledge v2 live-tool ledger is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2LiveToolLedgerMigrationUrl);
      const installed = await knowledgeV2LiveToolLedgerState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 live-tool ledger DDL completed without a validated evidence foreign key; reconcile historical tool references before deployment.",
        );
      }
      console.log(
        `Applied knowledge_v2_live_tool_ledger migration (${statementCount} statements).`,
      );
    }

    const authenticatedCustomerIdentity = await authenticatedCustomerIdentityState(prisma);
    if (authenticatedCustomerIdentity.complete) {
      console.log(
        "Authenticated customer identity already exists; skipping authenticated_customer_identity migration.",
      );
    } else if (authenticatedCustomerIdentity.present) {
      throw new Error(
        "Authenticated customer identity is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, authenticatedCustomerIdentityMigrationUrl);
      const installed = await authenticatedCustomerIdentityState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Authenticated customer identity DDL completed without the full boundary contract.",
        );
      }
      console.log(
        `Applied authenticated_customer_identity migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2TenantDefaultScope = await knowledgeV2TenantDefaultScopeState(prisma);
    if (knowledgeV2TenantDefaultScope.complete) {
      console.log(
        "Knowledge v2 tenant default scope already exists; skipping knowledge_v2_tenant_default_scope migration.",
      );
    } else if (knowledgeV2TenantDefaultScope.present) {
      throw new Error(
        "Knowledge v2 tenant default scope is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2TenantDefaultScopeMigrationUrl);
      const installed = await knowledgeV2TenantDefaultScopeState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 tenant default scope DDL completed without its full generation contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_tenant_default_scope migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2SnapshotAuthorizationManifest =
      await knowledgeV2SnapshotAuthorizationManifestState(prisma);
    if (knowledgeV2SnapshotAuthorizationManifest.complete) {
      console.log(
        "Knowledge v2 snapshot authorization manifest already exists; skipping knowledge_v2_snapshot_authorization_manifest migration.",
      );
    } else if (knowledgeV2SnapshotAuthorizationManifest.present) {
      throw new Error(
        "Knowledge v2 snapshot authorization manifest is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2SnapshotAuthorizationManifestMigrationUrl,
      );
      const installed = await knowledgeV2SnapshotAuthorizationManifestState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 snapshot authorization manifest DDL completed without its full immutability contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_snapshot_authorization_manifest migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2QueryHashMetadata = await knowledgeV2QueryHashMetadataState(prisma);
    if (knowledgeV2QueryHashMetadata.complete) {
      console.log(
        "Knowledge v2 query hash metadata already exists; skipping knowledge_v2_query_hash_metadata migration.",
      );
    } else if (knowledgeV2QueryHashMetadata.present) {
      throw new Error(
        "Knowledge v2 query hash metadata is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2QueryHashMetadataMigrationUrl);
      const installed = await knowledgeV2QueryHashMetadataState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 query hash metadata DDL completed without its full paired metadata contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_query_hash_metadata migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2QueryHashKeyRegistry = await knowledgeV2QueryHashKeyRegistryState(prisma);
    if (knowledgeV2QueryHashKeyRegistry.complete) {
      console.log(
        "Knowledge v2 query hash key registry already exists; skipping knowledge_v2_query_hash_key_registry migration.",
      );
    } else if (knowledgeV2QueryHashKeyRegistry.present) {
      throw new Error(
        "Knowledge v2 query hash key registry is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2QueryHashKeyRegistryMigrationUrl,
      );
      const installed = await knowledgeV2QueryHashKeyRegistryState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 query hash key registry DDL completed without its full immutability contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_query_hash_key_registry migration (${statementCount} statements).`,
      );
    }

    const channelAutomaticReplyActivation = await channelAutomaticReplyActivationState(prisma);
    if (channelAutomaticReplyActivation.complete) {
      console.log(
        "Channel automatic reply activation already exists; skipping channel_automatic_reply_activation migration.",
      );
    } else if (channelAutomaticReplyActivation.present) {
      throw new Error(
        "Channel automatic reply activation is partially installed; refusing to replay its destructive DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        channelAutomaticReplyActivationMigrationUrl,
      );
      const installed = await channelAutomaticReplyActivationState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Channel automatic reply activation DDL completed without its full fail-closed contract.",
        );
      }
      console.log(
        `Applied channel_automatic_reply_activation migration (${statementCount} statements).`,
      );
    }
    if (testStopAfter === "channel_automatic_reply_activation") return;

    const knowledgeV2CapabilitySnapshot = await knowledgeV2CapabilitySnapshotState(prisma);
    if (knowledgeV2CapabilitySnapshot.complete) {
      console.log(
        "Knowledge v2 capability snapshot already exists; skipping knowledge_v2_capability_snapshot migration.",
      );
    } else if (knowledgeV2CapabilitySnapshot.present) {
      throw new Error(
        "Knowledge v2 capability snapshot is partially installed; refusing to replay its destructive DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2CapabilitySnapshotMigrationUrl);
      const installed = await knowledgeV2CapabilitySnapshotState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 capability snapshot DDL completed without its full immutable snapshot contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_capability_snapshot migration (${statementCount} statements).`,
      );
    }

    const knowledgeV2ValidationHistory = await knowledgeV2ValidationHistoryState(prisma);
    if (knowledgeV2ValidationHistory.complete) {
      console.log(
        "Knowledge v2 validation history already exists; skipping knowledge_v2_validation_history migration.",
      );
    } else if (!knowledgeV2ValidationHistory.legacyUnique) {
      throw new Error(
        `Knowledge v2 validation history index is ${
          knowledgeV2ValidationHistory.present ? "malformed" : "missing"
        }; refusing to skip or replay its destructive DDL.`,
      );
    } else {
      const statementCount = await applySqlFile(prisma, knowledgeV2ValidationHistoryMigrationUrl);
      const installed = await knowledgeV2ValidationHistoryState(prisma);
      if (!installed.complete || installed.legacyUnique) {
        throw new Error(
          "Knowledge v2 validation history DDL completed without its exact non-unique history index.",
        );
      }
      console.log(
        `Applied knowledge_v2_validation_history migration (${statementCount} statements).`,
      );
    }

    const operationalAutonomyBinding = await knowledgeV2OperationalAutonomyBindingState(prisma);
    if (operationalAutonomyBinding.complete) {
      console.log(
        "Knowledge v2 operational autonomy binding already exists; skipping knowledge_v2_operational_autonomy_binding migration.",
      );
    } else if (operationalAutonomyBinding.present) {
      throw new Error(
        "Knowledge v2 operational autonomy binding is partially installed; refusing to replay its destructive DDL.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2OperationalAutonomyBindingMigrationUrl,
      );
      const installed = await knowledgeV2OperationalAutonomyBindingState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 operational autonomy binding DDL completed without its full fail-closed contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_operational_autonomy_binding migration (${statementCount} statements).`,
      );
    }

    const supportedAutonomyLimit = await knowledgeV2SupportedAutonomyLimitState(prisma);
    if (supportedAutonomyLimit.complete) {
      console.log(
        "Knowledge v2 supported autonomy limit already exists; skipping knowledge_v2_supported_autonomy_limit migration.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2SupportedAutonomyLimitMigrationUrl,
      );
      const installed = await knowledgeV2SupportedAutonomyLimitState(prisma);
      if (!installed.complete || (await hasUnsupportedKnowledgeV2CapabilityAutonomy(prisma))) {
        throw new Error(
          "Knowledge v2 supported autonomy limit migration completed without its full immutable reply-outcome contract or capability downgrade.",
        );
      }
      console.log(
        `Applied knowledge_v2_supported_autonomy_limit migration (${statementCount} statements).`,
      );
    }

    const webhookProcessingFence = await webhookProcessingFenceState(prisma);
    if (webhookProcessingFence.complete) {
      console.log(
        "Webhook processing fence already exists; skipping webhook_processing_fence migration.",
      );
    } else if (webhookProcessingFence.present) {
      throw new Error(
        "Webhook processing fence is partially installed; refusing to replay its DDL.",
      );
    } else {
      const statementCount = await applySqlFile(prisma, webhookProcessingFenceMigrationUrl);
      const installed = await webhookProcessingFenceState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Webhook processing fence DDL completed without its full lease and idempotency contract.",
        );
      }
      console.log(`Applied webhook_processing_fence migration (${statementCount} statements).`);
    }

    const snapshotCutoverIdentity = await knowledgeV2SnapshotCutoverIdentityState(prisma);
    if (snapshotCutoverIdentity.complete) {
      console.log(
        "Knowledge v2 snapshot cutover identity already exists; skipping knowledge_v2_snapshot_cutover_identity migration.",
      );
    } else {
      const statementCount = await applySqlFile(
        prisma,
        knowledgeV2SnapshotCutoverIdentityMigrationUrl,
      );
      const installed = await knowledgeV2SnapshotCutoverIdentityState(prisma);
      if (!installed.complete) {
        throw new Error(
          "Knowledge v2 snapshot cutover identity migration completed without its snapshot-specific point contract.",
        );
      }
      console.log(
        `Applied knowledge_v2_snapshot_cutover_identity migration (${statementCount} statements).`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const testStopAfter = getMigrationTestStopAfter();
  const lockName = `${migrationRunnerLockPrefix}:${getDatabaseName(databaseUrl)}`;
  const lockClient = new PrismaClient({
    datasources: { db: { url: getMaintenanceDatabaseUrl(databaseUrl) } },
  });

  try {
    await lockClient.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
        `;
        await ensureDatabaseExists(databaseUrl);
        await runMigrations(databaseUrl, testStopAfter);
      },
      {
        maxWait: migrationRunnerMaxWaitMs,
        timeout: migrationRunnerTimeoutMs,
      },
    );
  } finally {
    await lockClient.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
