BEGIN;

CREATE TYPE "KnowledgeRevisionStatus" AS ENUM (
  'ACQUIRED',
  'SCANNING',
  'PARSING',
  'NORMALIZING',
  'EXTRACTING',
  'CHUNKING',
  'EMBEDDING',
  'EVALUATING',
  'NEEDS_REVIEW',
  'READY',
  'REJECTED',
  'SUPERSEDED',
  'DELETED'
);

CREATE TYPE "KnowledgeIndexSnapshotStatus" AS ENUM (
  'PREPARING',
  'READY',
  'ABANDONED',
  'DELETING',
  'DELETED'
);

CREATE TYPE "KnowledgePublicationStatus" AS ENUM (
  'VALIDATING',
  'READY',
  'PUBLISHING',
  'ACTIVE',
  'SUPERSEDED',
  'FAILED',
  'ROLLED_BACK'
);

CREATE TYPE "KnowledgePublicationItemType" AS ENUM (
  'LEGACY_REVISION',
  'DOCUMENT_REVISION',
  'FACT_VERSION',
  'GUIDANCE_RULE_VERSION',
  'SOURCE_PERMISSION_SNAPSHOT'
);

CREATE TYPE "KnowledgeJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'DEAD_LETTER'
);

CREATE TYPE "KnowledgeJobAttemptStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT'
);

CREATE TYPE "KnowledgeOutboxStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TYPE "KnowledgeInboxStatus" AS ENUM (
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "KnowledgeRevision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceType" "BusinessKnowledgeSourceType" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "structuredData" JSONB,
  "contentHash" TEXT NOT NULL,
  "status" "KnowledgeRevisionStatus" NOT NULL DEFAULT 'ACQUIRED',
  "pipelineVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "supersedesRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeRevision_sourceVersion_check" CHECK ("sourceVersion" > 0)
);

CREATE TABLE "KnowledgeRevisionChunk" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "embeddingProvider" TEXT NOT NULL DEFAULT 'leadvirt-local-hash',
  "embeddingModel" TEXT NOT NULL DEFAULT 'hash-v1',
  "metadata" JSONB,
  "embeddedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeRevisionChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeRevisionChunk_chunkIndex_check" CHECK ("chunkIndex" >= 0),
  CONSTRAINT "KnowledgeRevisionChunk_tokenEstimate_check" CHECK ("tokenEstimate" >= 0)
);

CREATE TABLE "KnowledgeIndexSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "status" "KnowledgeIndexSnapshotStatus" NOT NULL DEFAULT 'PREPARING',
  "collectionName" TEXT NOT NULL,
  "embeddingProvider" TEXT NOT NULL,
  "embeddingModel" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "pipelineVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "expectedPointCount" INTEGER NOT NULL DEFAULT 0,
  "observedPointCount" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "deleteAfter" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeIndexSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeIndexSnapshot_pointCounts_check" CHECK (
    "expectedPointCount" >= 0 AND ("observedPointCount" IS NULL OR "observedPointCount" >= 0)
  )
);

CREATE TABLE "KnowledgeIndexSnapshotItem" (
  "tenantId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "vectorPointId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeIndexSnapshotItem_pkey" PRIMARY KEY ("snapshotId", "chunkId")
);

CREATE TABLE "KnowledgePublication" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL DEFAULT 'workspace',
  "sequence" INTEGER NOT NULL,
  "status" "KnowledgePublicationStatus" NOT NULL DEFAULT 'VALIDATING',
  "indexSnapshotId" TEXT,
  "basePublicationId" TEXT,
  "manifestHash" TEXT NOT NULL,
  "pipelineVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "retrievalPolicyVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "promptPolicyVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "qualitySummary" JSONB,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgePublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgePublication_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "ActiveKnowledgePublication" (
  "tenantId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL DEFAULT 'workspace',
  "publicationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,

  CONSTRAINT "ActiveKnowledgePublication_pkey" PRIMARY KEY ("tenantId", "targetKey"),
  CONSTRAINT "ActiveKnowledgePublication_versions_check" CHECK ("sequence" > 0 AND "etag" > 0)
);

CREATE TABLE "KnowledgePublicationItem" (
  "tenantId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "itemType" "KnowledgePublicationItemType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "revisionId" TEXT,
  "scope" JSONB,
  "authorizationFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgePublicationItem_pkey" PRIMARY KEY ("publicationId", "itemType", "itemId"),
  CONSTRAINT "KnowledgePublicationItem_legacyRevision_check" CHECK (
    "itemType" <> 'LEGACY_REVISION'
    OR ("revisionId" IS NOT NULL AND "itemId" = "revisionId")
  )
);

CREATE TABLE "KnowledgeJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "pipelineVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" "KnowledgeJobStatus" NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "deadlineAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "progressCompleted" INTEGER NOT NULL DEFAULT 0,
  "progressTotal" INTEGER,
  "payloadRef" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "traceId" TEXT,
  "sourceId" TEXT,
  "revisionId" TEXT,
  "indexSnapshotId" TEXT,
  "publicationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeJob_retryProgress_check" CHECK (
    "generation" > 0
    AND "maxAttempts" > 0
    AND "attemptCount" >= 0
    AND "progressCompleted" >= 0
    AND ("progressTotal" IS NULL OR "progressTotal" >= "progressCompleted")
  )
);

CREATE TABLE "KnowledgeJobAttempt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "KnowledgeJobAttemptStatus" NOT NULL DEFAULT 'RUNNING',
  "workerId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "traceId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeJobAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeJobAttempt_attempt_check" CHECK ("attempt" > 0)
);

CREATE TABLE "KnowledgeOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "aggregateVersion" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "KnowledgeOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "traceId" TEXT,
  "traceParent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeOutbox_versions_check" CHECK (
    "aggregateVersion" >= 0 AND "schemaVersion" > 0 AND "attemptCount" >= 0
  )
);

CREATE TABLE "KnowledgeInbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "consumer" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "KnowledgeInboxStatus" NOT NULL DEFAULT 'PROCESSING',
  "result" JSONB,
  "errorCode" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeInbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeInbox_attemptCount_check" CHECK ("attemptCount" > 0)
);

CREATE UNIQUE INDEX "KnowledgeRevision_sourceId_sourceVersion_key"
  ON "KnowledgeRevision"("sourceId", "sourceVersion");
CREATE UNIQUE INDEX "KnowledgeRevision_tenantId_id_key"
  ON "KnowledgeRevision"("tenantId", "id");
CREATE INDEX "KnowledgeRevision_tenantId_status_createdAt_idx"
  ON "KnowledgeRevision"("tenantId", "status", "createdAt");
CREATE INDEX "KnowledgeRevision_tenantId_sourceId_sourceVersion_idx"
  ON "KnowledgeRevision"("tenantId", "sourceId", "sourceVersion");

CREATE UNIQUE INDEX "KnowledgeRevisionChunk_revisionId_chunkIndex_key"
  ON "KnowledgeRevisionChunk"("revisionId", "chunkIndex");
CREATE UNIQUE INDEX "KnowledgeRevisionChunk_tenantId_id_key"
  ON "KnowledgeRevisionChunk"("tenantId", "id");
CREATE INDEX "KnowledgeRevisionChunk_tenantId_revisionId_chunkIndex_idx"
  ON "KnowledgeRevisionChunk"("tenantId", "revisionId", "chunkIndex");
CREATE INDEX "KnowledgeRevisionChunk_tenantId_contentHash_idx"
  ON "KnowledgeRevisionChunk"("tenantId", "contentHash");

CREATE UNIQUE INDEX "KnowledgeIndexSnapshot_reuse_key"
  ON "KnowledgeIndexSnapshot"(
    "tenantId",
    "manifestHash",
    "collectionName",
    "embeddingProvider",
    "embeddingModel",
    "pipelineVersion"
  );
CREATE UNIQUE INDEX "KnowledgeIndexSnapshot_tenantId_id_key"
  ON "KnowledgeIndexSnapshot"("tenantId", "id");
CREATE INDEX "KnowledgeIndexSnapshot_tenantId_status_createdAt_idx"
  ON "KnowledgeIndexSnapshot"("tenantId", "status", "createdAt");
CREATE INDEX "KnowledgeIndexSnapshot_status_deleteAfter_idx"
  ON "KnowledgeIndexSnapshot"("status", "deleteAfter");

CREATE UNIQUE INDEX "KnowledgeIndexSnapshotItem_vectorPointId_key"
  ON "KnowledgeIndexSnapshotItem"("vectorPointId");
CREATE INDEX "KnowledgeIndexSnapshotItem_tenantId_snapshotId_idx"
  ON "KnowledgeIndexSnapshotItem"("tenantId", "snapshotId");
CREATE INDEX "KnowledgeIndexSnapshotItem_tenantId_chunkId_idx"
  ON "KnowledgeIndexSnapshotItem"("tenantId", "chunkId");

CREATE UNIQUE INDEX "KnowledgePublication_tenantId_targetKey_sequence_key"
  ON "KnowledgePublication"("tenantId", "targetKey", "sequence");
CREATE UNIQUE INDEX "KnowledgePublication_tenantId_id_key"
  ON "KnowledgePublication"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgePublication_activePointer_key"
  ON "KnowledgePublication"("tenantId", "targetKey", "id", "sequence");
CREATE INDEX "KnowledgePublication_tenantId_targetKey_status_createdAt_idx"
  ON "KnowledgePublication"("tenantId", "targetKey", "status", "createdAt");
CREATE INDEX "KnowledgePublication_tenantId_indexSnapshotId_idx"
  ON "KnowledgePublication"("tenantId", "indexSnapshotId");

CREATE UNIQUE INDEX "ActiveKnowledgePublication_publicationId_key"
  ON "ActiveKnowledgePublication"("publicationId");
CREATE INDEX "ActiveKnowledgePublication_tenantId_publicationId_idx"
  ON "ActiveKnowledgePublication"("tenantId", "publicationId");

CREATE INDEX "KnowledgePublicationItem_tenantId_publicationId_idx"
  ON "KnowledgePublicationItem"("tenantId", "publicationId");
CREATE INDEX "KnowledgePublicationItem_tenantId_revisionId_idx"
  ON "KnowledgePublicationItem"("tenantId", "revisionId");

CREATE UNIQUE INDEX "KnowledgeJob_tenantId_idempotencyKey_key"
  ON "KnowledgeJob"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "KnowledgeJob_tenantId_id_key"
  ON "KnowledgeJob"("tenantId", "id");
CREATE INDEX "KnowledgeJob_status_availableAt_priority_idx"
  ON "KnowledgeJob"("status", "availableAt", "priority");
CREATE INDEX "KnowledgeJob_tenantId_status_createdAt_idx"
  ON "KnowledgeJob"("tenantId", "status", "createdAt");
CREATE INDEX "KnowledgeJob_tenantId_sourceId_generation_idx"
  ON "KnowledgeJob"("tenantId", "sourceId", "generation");

CREATE UNIQUE INDEX "KnowledgeJobAttempt_jobId_attempt_key"
  ON "KnowledgeJobAttempt"("jobId", "attempt");
CREATE INDEX "KnowledgeJobAttempt_tenantId_jobId_status_idx"
  ON "KnowledgeJobAttempt"("tenantId", "jobId", "status");
CREATE INDEX "KnowledgeJobAttempt_status_heartbeatAt_idx"
  ON "KnowledgeJobAttempt"("status", "heartbeatAt");

CREATE UNIQUE INDEX "KnowledgeOutbox_tenantId_dedupeKey_key"
  ON "KnowledgeOutbox"("tenantId", "dedupeKey");
CREATE UNIQUE INDEX "KnowledgeOutbox_aggregateEvent_key"
  ON "KnowledgeOutbox"("tenantId", "aggregateType", "aggregateId", "aggregateVersion", "eventType");
CREATE INDEX "KnowledgeOutbox_status_availableAt_createdAt_idx"
  ON "KnowledgeOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "KnowledgeOutbox_tenant_aggregate_version_idx"
  ON "KnowledgeOutbox"("tenantId", "aggregateType", "aggregateId", "aggregateVersion");

CREATE UNIQUE INDEX "KnowledgeInbox_consumer_eventId_key"
  ON "KnowledgeInbox"("consumer", "eventId");
CREATE INDEX "KnowledgeInbox_tenantId_status_receivedAt_idx"
  ON "KnowledgeInbox"("tenantId", "status", "receivedAt");
CREATE INDEX "KnowledgeInbox_status_updatedAt_idx"
  ON "KnowledgeInbox"("status", "updatedAt");

ALTER TABLE "KnowledgeRevision"
  ADD CONSTRAINT "KnowledgeRevision_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRevision"
  ADD CONSTRAINT "KnowledgeRevision_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "BusinessKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRevision"
  ADD CONSTRAINT "KnowledgeRevision_supersedesRevisionId_fkey"
  FOREIGN KEY ("supersedesRevisionId") REFERENCES "KnowledgeRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeRevisionChunk"
  ADD CONSTRAINT "KnowledgeRevisionChunk_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRevisionChunk"
  ADD CONSTRAINT "KnowledgeRevisionChunk_tenant_revision_fkey"
  FOREIGN KEY ("tenantId", "revisionId") REFERENCES "KnowledgeRevision"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeIndexSnapshot"
  ADD CONSTRAINT "KnowledgeIndexSnapshot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeIndexSnapshotItem"
  ADD CONSTRAINT "KnowledgeIndexSnapshotItem_tenant_snapshot_fkey"
  FOREIGN KEY ("tenantId", "snapshotId") REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeIndexSnapshotItem"
  ADD CONSTRAINT "KnowledgeIndexSnapshotItem_tenant_chunk_fkey"
  FOREIGN KEY ("tenantId", "chunkId") REFERENCES "KnowledgeRevisionChunk"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_tenant_snapshot_fkey"
  FOREIGN KEY ("tenantId", "indexSnapshotId") REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_basePublicationId_fkey"
  FOREIGN KEY ("basePublicationId") REFERENCES "KnowledgePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActiveKnowledgePublication"
  ADD CONSTRAINT "ActiveKnowledgePublication_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActiveKnowledgePublication"
  ADD CONSTRAINT "ActiveKnowledgePublication_publication_fkey"
  FOREIGN KEY ("tenantId", "targetKey", "publicationId", "sequence")
  REFERENCES "KnowledgePublication"("tenantId", "targetKey", "id", "sequence") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenant_publication_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "KnowledgePublication"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenant_revision_fkey"
  FOREIGN KEY ("tenantId", "revisionId") REFERENCES "KnowledgeRevision"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "BusinessKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "KnowledgeRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_indexSnapshotId_fkey"
  FOREIGN KEY ("indexSnapshotId") REFERENCES "KnowledgeIndexSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_publicationId_fkey"
  FOREIGN KEY ("publicationId") REFERENCES "KnowledgePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeJobAttempt"
  ADD CONSTRAINT "KnowledgeJobAttempt_tenant_job_fkey"
  FOREIGN KEY ("tenantId", "jobId") REFERENCES "KnowledgeJob"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeOutbox"
  ADD CONSTRAINT "KnowledgeOutbox_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeInbox"
  ADD CONSTRAINT "KnowledgeInbox_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "KnowledgeRevision" (
  "id",
  "tenantId",
  "sourceId",
  "sourceVersion",
  "sourceType",
  "title",
  "content",
  "structuredData",
  "contentHash",
  "status",
  "pipelineVersion",
  "createdAt"
)
SELECT
  'krev_' || md5('legacy-source:' || source."id" || ':' || source."version"::text),
  source."tenantId",
  source."id",
  source."version",
  source."type",
  source."title",
  source."content",
  source."structuredData",
  'legacy-md5:' || md5(
    source."title" || chr(31) || source."content" || chr(31) || COALESCE(source."structuredData"::text, 'null')
  ),
  CASE
    WHEN source."deletedAt" IS NOT NULL OR source."status" = 'ARCHIVED'
      THEN 'SUPERSEDED'::"KnowledgeRevisionStatus"
    WHEN source."status" = 'DRAFT'
      THEN 'NEEDS_REVIEW'::"KnowledgeRevisionStatus"
    WHEN EXISTS (
      SELECT 1
      FROM "BusinessKnowledgeChunk" chunk
      WHERE chunk."sourceId" = source."id"
        AND chunk."sourceVersion" = source."version"
        AND chunk."deletedAt" IS NULL
    )
      THEN 'READY'::"KnowledgeRevisionStatus"
    ELSE 'ACQUIRED'::"KnowledgeRevisionStatus"
  END,
  'legacy-v1',
  source."updatedAt"
FROM "BusinessKnowledgeSource" source;

INSERT INTO "KnowledgeRevision" (
  "id",
  "tenantId",
  "sourceId",
  "sourceVersion",
  "sourceType",
  "title",
  "content",
  "contentHash",
  "status",
  "pipelineVersion",
  "createdAt"
)
SELECT
  'krev_' || md5('legacy-source:' || source."id" || ':' || chunk."sourceVersion"::text),
  source."tenantId",
  source."id",
  chunk."sourceVersion",
  source."type",
  source."title",
  string_agg(chunk."content", E'\n\n' ORDER BY chunk."chunkIndex"),
  'legacy-chunks-md5:' || md5(string_agg(chunk."contentHash", '|' ORDER BY chunk."chunkIndex")),
  'SUPERSEDED'::"KnowledgeRevisionStatus",
  'legacy-v1',
  min(chunk."createdAt")
FROM "BusinessKnowledgeChunk" chunk
JOIN "BusinessKnowledgeSource" source ON source."id" = chunk."sourceId"
WHERE chunk."sourceVersion" <> source."version"
GROUP BY source."id", source."tenantId", source."type", source."title", chunk."sourceVersion"
ON CONFLICT ("sourceId", "sourceVersion") DO NOTHING;

UPDATE "KnowledgeRevision" current_revision
SET "supersedesRevisionId" = (
  SELECT previous_revision."id"
  FROM "KnowledgeRevision" previous_revision
  WHERE previous_revision."sourceId" = current_revision."sourceId"
    AND previous_revision."sourceVersion" < current_revision."sourceVersion"
  ORDER BY previous_revision."sourceVersion" DESC
  LIMIT 1
)
WHERE current_revision."supersedesRevisionId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "KnowledgeRevision" previous_revision
    WHERE previous_revision."sourceId" = current_revision."sourceId"
      AND previous_revision."sourceVersion" < current_revision."sourceVersion"
  );

INSERT INTO "KnowledgeRevisionChunk" (
  "id",
  "tenantId",
  "revisionId",
  "chunkIndex",
  "content",
  "contentHash",
  "tokenEstimate",
  "embeddingProvider",
  "embeddingModel",
  "metadata",
  "embeddedAt",
  "createdAt"
)
SELECT
  'krch_' || md5('legacy-chunk:' || chunk."id"),
  chunk."tenantId",
  revision."id",
  chunk."chunkIndex",
  chunk."content",
  chunk."contentHash",
  chunk."tokenEstimate",
  chunk."embeddingProvider",
  chunk."embeddingModel",
  chunk."metadata",
  chunk."embeddedAt",
  chunk."createdAt"
FROM "BusinessKnowledgeChunk" chunk
JOIN "KnowledgeRevision" revision
  ON revision."sourceId" = chunk."sourceId"
 AND revision."sourceVersion" = chunk."sourceVersion";

COMMIT;
