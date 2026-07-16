BEGIN;

CREATE TYPE "KnowledgeV2CapabilityDecision" AS ENUM ('AUTHORIZED', 'HANDOFF');

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD COLUMN "operationalBindingSchemaVersion" INTEGER,
  ADD COLUMN "operationalRegistryVersion" TEXT,
  ADD COLUMN "operationalRegistryHash" TEXT,
  ADD COLUMN "operationalDependencySetHash" TEXT,
  ADD COLUMN "operationalBindingHash" TEXT,
  ADD COLUMN "operationalPermissionGeneration" INTEGER;

ALTER TABLE "KnowledgePublication"
  ADD COLUMN "operationalBindingSchemaVersion" INTEGER,
  ADD COLUMN "operationalRegistryVersion" TEXT,
  ADD COLUMN "operationalRegistryHash" TEXT,
  ADD COLUMN "operationalDependencySetHash" TEXT,
  ADD COLUMN "operationalBindingHash" TEXT,
  ADD COLUMN "operationalPermissionGeneration" INTEGER;

ALTER TABLE "KnowledgePublicationCapability"
  ADD COLUMN "operationalBindingHash" TEXT,
  ADD COLUMN "operationalPermissionGeneration" INTEGER;

ALTER TABLE "Channel"
  ADD COLUMN "automaticRepliesOperationalBindingHash" TEXT,
  ADD COLUMN "automaticRepliesOperationalPermissionGeneration" INTEGER;

ALTER TABLE "AiReplyRun"
  ADD COLUMN "operationalBindingHash" TEXT,
  ADD COLUMN "operationalPermissionGeneration" INTEGER,
  ADD COLUMN "capabilityType" "KnowledgeV2CapabilityType",
  ADD COLUMN "allowedAutonomy" "KnowledgeV2CapabilityAutonomy",
  ADD COLUMN "requiredAutonomy" "KnowledgeV2CapabilityAutonomy",
  ADD COLUMN "capabilityDecision" "KnowledgeV2CapabilityDecision";

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_operationalBinding_check" CHECK (
    (
      "operationalBindingSchemaVersion" IS NULL
      AND "operationalRegistryVersion" IS NULL
      AND "operationalRegistryHash" IS NULL
      AND "operationalDependencySetHash" IS NULL
      AND "operationalBindingHash" IS NULL
      AND "operationalPermissionGeneration" IS NULL
    )
    OR (
      "operationalBindingSchemaVersion" = 1
      AND char_length(btrim("operationalRegistryVersion")) BETWEEN 1 AND 100
      AND "operationalRegistryHash" ~ '^[a-f0-9]{64}$'
      AND "operationalDependencySetHash" ~ '^[a-f0-9]{64}$'
      AND "operationalBindingHash" ~ '^[a-f0-9]{64}$'
      AND "operationalPermissionGeneration" > 0
    )
  ) NOT VALID;

ALTER TABLE "KnowledgeV2PublicationValidation"
  VALIDATE CONSTRAINT "KnowledgeV2PublicationValidation_operationalBinding_check";

ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_operationalBinding_check" CHECK (
    (
      "operationalBindingSchemaVersion" IS NULL
      AND "operationalRegistryVersion" IS NULL
      AND "operationalRegistryHash" IS NULL
      AND "operationalDependencySetHash" IS NULL
      AND "operationalBindingHash" IS NULL
      AND "operationalPermissionGeneration" IS NULL
    )
    OR (
      "operationalBindingSchemaVersion" = 1
      AND char_length(btrim("operationalRegistryVersion")) BETWEEN 1 AND 100
      AND "operationalRegistryHash" ~ '^[a-f0-9]{64}$'
      AND "operationalDependencySetHash" ~ '^[a-f0-9]{64}$'
      AND "operationalBindingHash" ~ '^[a-f0-9]{64}$'
      AND "operationalPermissionGeneration" > 0
    )
  ) NOT VALID;

ALTER TABLE "KnowledgePublication"
  VALIDATE CONSTRAINT "KnowledgePublication_operationalBinding_check";

ALTER TABLE "KnowledgePublicationCapability"
  ADD CONSTRAINT "KnowledgePublicationCapability_operationalBinding_check" CHECK (
    (
      "operationalBindingHash" IS NULL
      AND "operationalPermissionGeneration" IS NULL
    )
    OR (
      "operationalBindingHash" ~ '^[a-f0-9]{64}$'
      AND "operationalPermissionGeneration" > 0
    )
  ) NOT VALID;

ALTER TABLE "KnowledgePublicationCapability"
  VALIDATE CONSTRAINT "KnowledgePublicationCapability_operationalBinding_check";

UPDATE "Channel"
SET
  "automaticRepliesEnabled" = false,
  "automaticRepliesGeneration" = "automaticRepliesGeneration" + 1,
  "automaticRepliesPublicationId" = NULL,
  "automaticRepliesPublicationEtag" = NULL,
  "automaticRepliesChannelFingerprint" = NULL,
  "automaticRepliesCapabilitySetHash" = NULL,
  "automaticRepliesOperationalBindingHash" = NULL,
  "automaticRepliesOperationalPermissionGeneration" = NULL,
  "automaticRepliesActivatedAt" = NULL,
  "automaticRepliesActivatedByUserId" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Channel"
  DROP CONSTRAINT "Channel_automaticRepliesBinding_check",
  DROP CONSTRAINT "Channel_automaticRepliesPublication_fkey";

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_automaticRepliesOperationalBindingHash_check" CHECK (
    "automaticRepliesOperationalBindingHash" IS NULL
    OR "automaticRepliesOperationalBindingHash" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "Channel_automaticRepliesOperationalPermissionGeneration_check" CHECK (
    "automaticRepliesOperationalPermissionGeneration" IS NULL
    OR "automaticRepliesOperationalPermissionGeneration" > 0
  ),
  ADD CONSTRAINT "Channel_automaticRepliesBinding_check" CHECK (
    (
      "automaticRepliesEnabled" = false
      AND "automaticRepliesPublicationId" IS NULL
      AND "automaticRepliesPublicationEtag" IS NULL
      AND "automaticRepliesChannelFingerprint" IS NULL
      AND "automaticRepliesCapabilitySetHash" IS NULL
      AND "automaticRepliesOperationalBindingHash" IS NULL
      AND "automaticRepliesOperationalPermissionGeneration" IS NULL
      AND "automaticRepliesActivatedAt" IS NULL
      AND "automaticRepliesActivatedByUserId" IS NULL
    )
    OR (
      "automaticRepliesEnabled" = true
      AND "automaticRepliesPublicationId" IS NOT NULL
      AND "automaticRepliesPublicationEtag" IS NOT NULL
      AND "automaticRepliesChannelFingerprint" IS NOT NULL
      AND "automaticRepliesCapabilitySetHash" IS NOT NULL
      AND "automaticRepliesOperationalBindingHash" IS NOT NULL
      AND "automaticRepliesOperationalPermissionGeneration" IS NOT NULL
      AND "automaticRepliesActivatedAt" IS NOT NULL
      AND "automaticRepliesActivatedByUserId" IS NOT NULL
    )
  );

ALTER TABLE "AiReplyRun"
  DROP CONSTRAINT "AiReplyRun_tenant_publication_fkey";

ALTER TABLE "AiReplyRun"
  ADD CONSTRAINT "AiReplyRun_operationalBinding_check" CHECK (
    (
      "operationalBindingHash" IS NULL
      AND "operationalPermissionGeneration" IS NULL
    )
    OR (
      "publicationId" IS NOT NULL
      AND "capabilitySetHash" ~ '^[a-f0-9]{64}$'
      AND "operationalBindingHash" ~ '^[a-f0-9]{64}$'
      AND "operationalPermissionGeneration" > 0
    )
  ) NOT VALID,
  ADD CONSTRAINT "AiReplyRun_capabilityDecision_check" CHECK (
    (
      "capabilityDecision" IS NULL
      AND "capabilityType" IS NULL
      AND "allowedAutonomy" IS NULL
      AND "requiredAutonomy" IS NULL
    )
    OR (
      "capabilityDecision" = 'HANDOFF'
      AND "capabilityType" IS NULL
      AND "allowedAutonomy" IS NULL
      AND "requiredAutonomy" = 'ANSWER_ONLY'
    )
    OR (
      "capabilityDecision" = 'AUTHORIZED'
      AND "capabilityType" IS NOT NULL
      AND "allowedAutonomy" IS NOT NULL
      AND "requiredAutonomy" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "AiReplyRun"
  VALIDATE CONSTRAINT "AiReplyRun_operationalBinding_check";
ALTER TABLE "AiReplyRun"
  VALIDATE CONSTRAINT "AiReplyRun_capabilityDecision_check";

CREATE UNIQUE INDEX "KnowledgePublication_runtimeBinding_key"
  ON "KnowledgePublication"(
    "tenantId",
    "id",
    "capabilitySetHash",
    "operationalBindingHash",
    "operationalPermissionGeneration"
  );

CREATE UNIQUE INDEX "KnowledgePublicationCapability_runtime_key"
  ON "KnowledgePublicationCapability"(
    "tenantId",
    "publicationId",
    "capabilityType",
    "allowedAutonomy"
  );

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_automaticRepliesPublication_fkey"
  FOREIGN KEY (
    "tenantId",
    "automaticRepliesPublicationId",
    "automaticRepliesCapabilitySetHash",
    "automaticRepliesOperationalBindingHash",
    "automaticRepliesOperationalPermissionGeneration"
  )
  REFERENCES "KnowledgePublication"(
    "tenantId",
    "id",
    "capabilitySetHash",
    "operationalBindingHash",
    "operationalPermissionGeneration"
  )
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

ALTER TABLE "AiReplyRun"
  ADD CONSTRAINT "AiReplyRun_tenant_publication_fkey"
  FOREIGN KEY (
    "tenantId",
    "publicationId",
    "capabilitySetHash",
    "operationalBindingHash",
    "operationalPermissionGeneration"
  )
  REFERENCES "KnowledgePublication"(
    "tenantId",
    "id",
    "capabilitySetHash",
    "operationalBindingHash",
    "operationalPermissionGeneration"
  )
  ON DELETE NO ACTION
  ON UPDATE NO ACTION,
  ADD CONSTRAINT "AiReplyRun_runtimeCapability_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "capabilityType", "allowedAutonomy")
  REFERENCES "KnowledgePublicationCapability"(
    "tenantId",
    "publicationId",
    "capabilityType",
    "allowedAutonomy"
  )
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

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
      OLD."capabilitySetHash", OLD."requirementEvaluationSetHash",
      OLD."operationalBindingSchemaVersion", OLD."operationalRegistryVersion",
      OLD."operationalRegistryHash", OLD."operationalDependencySetHash",
      OLD."operationalBindingHash", OLD."operationalPermissionGeneration",
      OLD."qualitySummary", OLD."createdAt"
    ) IS DISTINCT FROM ROW(
      NEW."id", NEW."tenantId", NEW."targetKey", NEW."corpusKind", NEW."sequence",
      NEW."indexSnapshotId", NEW."basePublicationId", NEW."manifestHash",
      NEW."pipelineVersion", NEW."retrievalPolicyVersion", NEW."promptPolicyVersion",
      NEW."capabilitySetHash", NEW."requirementEvaluationSetHash",
      NEW."operationalBindingSchemaVersion", NEW."operationalRegistryVersion",
      NEW."operationalRegistryHash", NEW."operationalDependencySetHash",
      NEW."operationalBindingHash", NEW."operationalPermissionGeneration",
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

CREATE OR REPLACE FUNCTION "KnowledgeV2_reject_validation_operational_binding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_validation_operational_binding_immutable$
BEGIN
  IF OLD."evaluatedAt" IS NOT NULL AND ROW(
    OLD."capabilitySetHash", OLD."requirementEvaluationSetHash",
    OLD."operationalBindingSchemaVersion", OLD."operationalRegistryVersion",
    OLD."operationalRegistryHash", OLD."operationalDependencySetHash",
    OLD."operationalBindingHash", OLD."operationalPermissionGeneration"
  ) IS DISTINCT FROM ROW(
    NEW."capabilitySetHash", NEW."requirementEvaluationSetHash",
    NEW."operationalBindingSchemaVersion", NEW."operationalRegistryVersion",
    NEW."operationalRegistryHash", NEW."operationalDependencySetHash",
    NEW."operationalBindingHash", NEW."operationalPermissionGeneration"
  ) THEN
    RAISE EXCEPTION 'knowledge validation % binding is immutable after evaluation', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$knowledge_v2_validation_operational_binding_immutable$;

CREATE TRIGGER "KnowledgeV2PublicationValidation_operational_binding_immutable"
BEFORE UPDATE ON "KnowledgeV2PublicationValidation"
FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_validation_operational_binding_mutation"();

CREATE OR REPLACE FUNCTION "AiReplyRun_reject_binding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $ai_reply_run_binding_immutable$
BEGIN
  IF ROW(
    OLD."publicationId", OLD."capabilitySetHash", OLD."operationalBindingHash",
    OLD."operationalPermissionGeneration"
  ) IS DISTINCT FROM ROW(
    NEW."publicationId", NEW."capabilitySetHash", NEW."operationalBindingHash",
    NEW."operationalPermissionGeneration"
  ) THEN
    RAISE EXCEPTION 'AI reply run % publication binding is immutable', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."capabilityDecision" IS NOT NULL AND ROW(
    OLD."capabilityDecision", OLD."capabilityType", OLD."allowedAutonomy", OLD."requiredAutonomy"
  ) IS DISTINCT FROM ROW(
    NEW."capabilityDecision", NEW."capabilityType", NEW."allowedAutonomy", NEW."requiredAutonomy"
  ) THEN
    RAISE EXCEPTION 'AI reply run % capability binding is immutable', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."capabilityDecision" IS NULL
     AND NEW."capabilityDecision" IS NOT NULL
     AND OLD."status" <> 'QUEUED' THEN
    RAISE EXCEPTION 'AI reply run % capability binding cannot be attached in this state', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$ai_reply_run_binding_immutable$;

CREATE TRIGGER "AiReplyRun_binding_immutable"
BEFORE UPDATE ON "AiReplyRun"
FOR EACH ROW EXECUTE FUNCTION "AiReplyRun_reject_binding_mutation"();

UPDATE "Conversation"
SET
  "aiEnabled" = false,
  "aiGeneration" = "aiGeneration" + 1,
  "aiReplySequence" = "aiReplySequence" + 1,
  "aiReplyFence" = "aiReplySequence" + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "AiReplyRun"
SET
  "status" = 'SUPERSEDED',
  "errorCode" = 'OPERATIONAL_AUTONOMY_BINDING_REQUIRED_BY_MIGRATION',
  "errorMessage" = NULL,
  "completedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'FAILED', 'CANCEL_REQUESTED');

UPDATE "RuntimeOutbox"
SET
  "status" = 'DEAD_LETTER',
  "lastErrorCode" = 'OPERATIONAL_AUTONOMY_BINDING_REQUIRED_BY_MIGRATION',
  "lastErrorMessage" = NULL,
  "lockedAt" = NULL,
  "lockExpiresAt" = NULL,
  "lockedBy" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventType" = 'ai.reply.requested'
  AND "status" IN ('PENDING', 'PUBLISHING', 'FAILED');

COMMIT;
