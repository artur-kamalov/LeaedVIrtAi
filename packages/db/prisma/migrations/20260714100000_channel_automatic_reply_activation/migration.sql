BEGIN;

ALTER TABLE "Channel"
  ADD COLUMN "automaticRepliesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automaticRepliesGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "automaticRepliesPublicationId" TEXT,
  ADD COLUMN "automaticRepliesPublicationEtag" INTEGER,
  ADD COLUMN "automaticRepliesChannelFingerprint" TEXT,
  ADD COLUMN "automaticRepliesActivatedAt" TIMESTAMP(3),
  ADD COLUMN "automaticRepliesActivatedByUserId" TEXT;

UPDATE "Channel"
SET
  "automaticRepliesEnabled" = false,
  "automaticRepliesPublicationId" = NULL,
  "automaticRepliesPublicationEtag" = NULL,
  "automaticRepliesChannelFingerprint" = NULL,
  "automaticRepliesActivatedAt" = NULL,
  "automaticRepliesActivatedByUserId" = NULL;

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_automaticRepliesGeneration_check" CHECK (
    "automaticRepliesGeneration" >= 1
  ),
  ADD CONSTRAINT "Channel_automaticRepliesPublicationEtag_check" CHECK (
    "automaticRepliesPublicationEtag" IS NULL
    OR "automaticRepliesPublicationEtag" >= 1
  ),
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

CREATE INDEX "Channel_tenantId_automaticRepliesEnabled_status_idx"
  ON "Channel"("tenantId", "automaticRepliesEnabled", "status");

CREATE INDEX "Channel_tenantId_automaticRepliesPublicationId_idx"
  ON "Channel"("tenantId", "automaticRepliesPublicationId");

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_automaticRepliesPublication_fkey"
  FOREIGN KEY ("tenantId", "automaticRepliesPublicationId")
  REFERENCES "KnowledgePublication"("tenantId", "id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

ALTER TABLE "Conversation"
  ALTER COLUMN "aiEnabled" SET DEFAULT false;

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
  "errorCode" = 'AUTOMATIC_REPLIES_DISABLED_BY_MIGRATION',
  "errorMessage" = NULL,
  "completedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN (
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'FAILED',
  'CANCEL_REQUESTED'
);

UPDATE "RuntimeOutbox"
SET
  "status" = 'DEAD_LETTER',
  "lastErrorCode" = 'AUTOMATIC_REPLIES_DISABLED_BY_MIGRATION',
  "lastErrorMessage" = NULL,
  "lockedAt" = NULL,
  "lockExpiresAt" = NULL,
  "lockedBy" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventType" = 'ai.reply.requested'
  AND "status" IN ('PENDING', 'PUBLISHING', 'FAILED');

COMMIT;
