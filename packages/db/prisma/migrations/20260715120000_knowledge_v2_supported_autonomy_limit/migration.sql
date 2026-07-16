BEGIN;

DO $knowledge_v2_reply_disposition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS enum_type
    INNER JOIN pg_namespace AS enum_schema ON enum_schema.oid = enum_type.typnamespace
    WHERE enum_schema.nspname = 'public'
      AND enum_type.typname = 'KnowledgeV2ReplyDisposition'
  ) THEN
    CREATE TYPE "KnowledgeV2ReplyDisposition" AS ENUM ('AUTO_SEND', 'HANDOFF');
  END IF;
END;
$knowledge_v2_reply_disposition$;

ALTER TABLE "AiReplyRun"
  ADD COLUMN IF NOT EXISTS "replyDisposition" "KnowledgeV2ReplyDisposition",
  ADD COLUMN IF NOT EXISTS "replyContentHash" TEXT,
  ADD COLUMN IF NOT EXISTS "replyTemplateVersion" TEXT;

DROP TRIGGER IF EXISTS "AiReplyRun_binding_immutable" ON "AiReplyRun";

CREATE TEMP TABLE "_KnowledgeV2ReplyOutcomeFence" ON COMMIT DROP AS
SELECT run."id", run."tenantId", run."replyMessageId"
FROM "AiReplyRun" AS run
WHERE run."publicationId" IS NOT NULL
  AND run."status" = 'SUCCEEDED'::"AiReplyRunStatus"
  AND (
    run."replyContentHash" ~ '^[a-f0-9]{64}$'
    AND (
      (
        run."replyDisposition" = 'AUTO_SEND'::"KnowledgeV2ReplyDisposition"
        AND run."replyTemplateVersion" IS NULL
      )
      OR (
        run."replyDisposition" = 'HANDOFF'::"KnowledgeV2ReplyDisposition"
        AND char_length(btrim(run."replyTemplateVersion")) BETWEEN 1 AND 100
      )
    )
  ) IS NOT TRUE;

UPDATE "RuntimeOutbox" AS outbox
SET
  "status" = 'DEAD_LETTER'::"RuntimeOutboxStatus",
  "lastErrorCode" = 'REPLY_OUTCOME_REQUIRED_BY_MIGRATION',
  "lastErrorMessage" = NULL,
  "lockedAt" = NULL,
  "lockExpiresAt" = NULL,
  "lockedBy" = NULL,
  "publishedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE outbox."eventType" = 'channels.send-message.requested'
  AND outbox."status" IN (
    'PENDING'::"RuntimeOutboxStatus",
    'PUBLISHING'::"RuntimeOutboxStatus",
    'PUBLISHED'::"RuntimeOutboxStatus",
    'FAILED'::"RuntimeOutboxStatus"
  )
  AND EXISTS (
    SELECT 1
    FROM "_KnowledgeV2ReplyOutcomeFence" AS fenced
    WHERE fenced."tenantId" = outbox."tenantId"
      AND fenced."replyMessageId" = outbox."aggregateId"
  );

UPDATE "Message" AS message
SET
  "status" = 'FAILED'::"MessageStatus",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE message."status" IN (
    'RECEIVED'::"MessageStatus",
    'QUEUED'::"MessageStatus"
  )
  AND EXISTS (
    SELECT 1
    FROM "_KnowledgeV2ReplyOutcomeFence" AS fenced
    WHERE fenced."tenantId" = message."tenantId"
      AND fenced."replyMessageId" = message."id"
  );

UPDATE "AiReplyRun" AS run
SET
  "status" = 'SUPERSEDED'::"AiReplyRunStatus",
  "replyDisposition" = NULL,
  "replyContentHash" = NULL,
  "replyTemplateVersion" = NULL,
  "errorCode" = 'REPLY_OUTCOME_REQUIRED_BY_MIGRATION',
  "errorMessage" = NULL,
  "completedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "_KnowledgeV2ReplyOutcomeFence" AS fenced
  WHERE fenced."id" = run."id"
);

ALTER TABLE "AiReplyRun"
  DROP CONSTRAINT IF EXISTS "AiReplyRun_replyOutcome_check";

ALTER TABLE "AiReplyRun"
  ADD CONSTRAINT "AiReplyRun_replyOutcome_check" CHECK (
    (
      "replyDisposition" IS NULL
      AND "replyContentHash" IS NULL
      AND "replyTemplateVersion" IS NULL
      AND (
        "publicationId" IS NULL
        OR "status" <> 'SUCCEEDED'::"AiReplyRunStatus"
      )
    )
    OR (
      "replyDisposition" IS NOT NULL
      AND "replyContentHash" ~ '^[a-f0-9]{64}$'
      AND "status" = 'SUCCEEDED'::"AiReplyRunStatus"
      AND "replyMessageId" IS NOT NULL
      AND (
        (
          "replyDisposition" = 'AUTO_SEND'::"KnowledgeV2ReplyDisposition"
          AND "replyTemplateVersion" IS NULL
        )
        OR (
          "replyDisposition" = 'HANDOFF'::"KnowledgeV2ReplyDisposition"
          AND char_length(btrim("replyTemplateVersion")) BETWEEN 1 AND 100
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "AiReplyRun"
  VALIDATE CONSTRAINT "AiReplyRun_replyOutcome_check";

CREATE OR REPLACE FUNCTION "AiReplyRun_reject_binding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $ai_reply_run_binding_immutable$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."replyDisposition" IS NOT NULL THEN
      RAISE EXCEPTION 'AI reply run % reply outcome must attach during completion', NEW."id"
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
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
  IF OLD."replyDisposition" IS NOT NULL AND ROW(
    OLD."replyMessageId", OLD."replyDisposition", OLD."replyContentHash",
    OLD."replyTemplateVersion"
  ) IS DISTINCT FROM ROW(
    NEW."replyMessageId", NEW."replyDisposition", NEW."replyContentHash",
    NEW."replyTemplateVersion"
  ) THEN
    RAISE EXCEPTION 'AI reply run % reply outcome is immutable', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."replyDisposition" IS NULL
     AND NEW."replyDisposition" IS NOT NULL
     AND NOT (
       OLD."status" = 'RUNNING'
       AND NEW."status" = 'SUCCEEDED'
       AND NEW."replyMessageId" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'AI reply run % reply outcome must attach during completion', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$ai_reply_run_binding_immutable$;

CREATE TRIGGER "AiReplyRun_binding_immutable"
BEFORE INSERT OR UPDATE ON "AiReplyRun"
FOR EACH ROW EXECUTE FUNCTION "AiReplyRun_reject_binding_mutation"();

CREATE TEMP TABLE "_KnowledgeV2AutonomyDowngradeTenant" ON COMMIT DROP AS
SELECT DISTINCT capability."tenantId"
FROM "KnowledgeV2Capability" AS capability
WHERE capability."allowedAutonomy" IN (
  'ACT_WITH_CONFIRMATION'::"KnowledgeV2CapabilityAutonomy",
  'AUTONOMOUS_ACTION'::"KnowledgeV2CapabilityAutonomy"
);

INSERT INTO "KnowledgeV2Settings" (
  "tenantId",
  "draftGeneration",
  "etag",
  "createdAt",
  "updatedAt"
)
SELECT affected."tenantId", 2, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_KnowledgeV2AutonomyDowngradeTenant" AS affected
ON CONFLICT ("tenantId") DO UPDATE
SET
  "draftGeneration" = "KnowledgeV2Settings"."draftGeneration" + 1,
  "etag" = "KnowledgeV2Settings"."etag" + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "KnowledgeV2PublicationValidation" AS validation
SET
  "status" = 'EXPIRED'::"KnowledgeV2ValidationStatus",
  "evaluatedAt" = CASE
    WHEN validation."status" = 'PENDING'::"KnowledgeV2ValidationStatus"
      THEN CURRENT_TIMESTAMP
    ELSE validation."evaluatedAt"
  END
WHERE validation."targetKey" = 'workspace-v2'
  AND validation."corpusKind" = 'STRUCTURED_V2'::"KnowledgeCorpusKind"
  AND validation."publicationId" IS NULL
  AND validation."status" IN (
    'PENDING'::"KnowledgeV2ValidationStatus",
    'PASSED'::"KnowledgeV2ValidationStatus"
  )
  AND EXISTS (
    SELECT 1
    FROM "_KnowledgeV2AutonomyDowngradeTenant" AS affected
    WHERE affected."tenantId" = validation."tenantId"
  );

CREATE TEMP TABLE "_KnowledgeV2AutonomyDowngradeChannel" ON COMMIT DROP AS
SELECT channel."id", channel."tenantId"
FROM "Channel" AS channel
WHERE channel."automaticRepliesEnabled" = true
  AND EXISTS (
    SELECT 1
    FROM "_KnowledgeV2AutonomyDowngradeTenant" AS affected
    WHERE affected."tenantId" = channel."tenantId"
  );

UPDATE "Channel" AS channel
SET
  "automaticRepliesEnabled" = false,
  "automaticRepliesGeneration" = channel."automaticRepliesGeneration" + 1,
  "automaticRepliesPublicationId" = NULL,
  "automaticRepliesPublicationEtag" = NULL,
  "automaticRepliesChannelFingerprint" = NULL,
  "automaticRepliesCapabilitySetHash" = NULL,
  "automaticRepliesOperationalBindingHash" = NULL,
  "automaticRepliesOperationalPermissionGeneration" = NULL,
  "automaticRepliesActivatedAt" = NULL,
  "automaticRepliesActivatedByUserId" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "_KnowledgeV2AutonomyDowngradeChannel" AS affected
  WHERE affected."id" = channel."id"
);

UPDATE "RuntimeOutbox" AS outbox
SET
  "status" = 'DEAD_LETTER'::"RuntimeOutboxStatus",
  "lastErrorCode" = 'CAPABILITY_CONFIGURATION_CHANGED',
  "lastErrorMessage" = NULL,
  "lockedAt" = NULL,
  "lockExpiresAt" = NULL,
  "lockedBy" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE outbox."eventType" = 'ai.reply.requested'
  AND outbox."status" IN (
    'PENDING'::"RuntimeOutboxStatus",
    'PUBLISHING'::"RuntimeOutboxStatus",
    'FAILED'::"RuntimeOutboxStatus"
  )
  AND EXISTS (
    SELECT 1
    FROM "Message" AS message
    INNER JOIN "Conversation" AS conversation
      ON conversation."tenantId" = message."tenantId"
      AND conversation."id" = message."conversationId"
    INNER JOIN "_KnowledgeV2AutonomyDowngradeChannel" AS affected
      ON affected."tenantId" = conversation."tenantId"
      AND affected."id" = conversation."channelId"
    WHERE message."tenantId" = outbox."tenantId"
      AND message."id" = outbox."aggregateId"
  );

UPDATE "AiReplyRun" AS run
SET
  "status" = 'SUPERSEDED'::"AiReplyRunStatus",
  "errorCode" = 'CAPABILITY_CONFIGURATION_CHANGED',
  "errorMessage" = NULL,
  "completedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE run."status" IN (
    'QUEUED'::"AiReplyRunStatus",
    'RUNNING'::"AiReplyRunStatus",
    'RETRY_SCHEDULED'::"AiReplyRunStatus",
    'FAILED'::"AiReplyRunStatus",
    'CANCEL_REQUESTED'::"AiReplyRunStatus"
  )
  AND EXISTS (
    SELECT 1
    FROM "Conversation" AS conversation
    INNER JOIN "_KnowledgeV2AutonomyDowngradeChannel" AS affected
      ON affected."tenantId" = conversation."tenantId"
      AND affected."id" = conversation."channelId"
    WHERE conversation."tenantId" = run."tenantId"
      AND conversation."id" = run."conversationId"
  );

UPDATE "Conversation" AS conversation
SET
  "aiEnabled" = false,
  "aiGeneration" = conversation."aiGeneration" + 1,
  "aiReplySequence" = conversation."aiReplySequence" + 1,
  "aiReplyFence" = conversation."aiReplySequence" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE conversation."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "_KnowledgeV2AutonomyDowngradeChannel" AS affected
    WHERE affected."tenantId" = conversation."tenantId"
      AND affected."id" = conversation."channelId"
  );

UPDATE "KnowledgeV2Capability" AS capability
SET
  "allowedAutonomy" = 'PROPOSE_ACTION'::"KnowledgeV2CapabilityAutonomy",
  "generation" = capability."generation" + 1,
  "etag" = capability."etag" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE capability."allowedAutonomy" IN (
  'ACT_WITH_CONFIRMATION'::"KnowledgeV2CapabilityAutonomy",
  'AUTONOMOUS_ACTION'::"KnowledgeV2CapabilityAutonomy"
);

COMMIT;
