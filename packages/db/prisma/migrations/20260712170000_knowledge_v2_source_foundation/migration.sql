BEGIN;

CREATE TYPE "KnowledgeV2SourceKind" AS ENUM (
  'MANUAL',
  'WEBSITE',
  'FILE',
  'SPREADSHEET',
  'HELP_CENTER',
  'DRIVE',
  'NOTION',
  'API',
  'LEGACY_ONBOARDING'
);
CREATE TYPE "KnowledgeV2SourceSyncMode" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK');
CREATE TYPE "KnowledgeV2SourceStatus" AS ENUM (
  'CONNECTING',
  'DISCOVERING',
  'SYNCING',
  'READY',
  'NEEDS_REVIEW',
  'PAUSED',
  'FAILED',
  'DISCONNECTED',
  'DELETING',
  'DELETED'
);
CREATE TYPE "KnowledgeV2RevisionStatus" AS ENUM (
  'ACQUIRED',
  'SCANNING',
  'PARSING',
  'NORMALIZING',
  'EXTRACTING',
  'CHUNKING',
  'EMBEDDING',
  'INDEXING',
  'EVALUATING',
  'READY',
  'NEEDS_REVIEW',
  'QUARANTINED',
  'REJECTED',
  'PUBLISHED',
  'SUPERSEDED',
  'FAILED',
  'CANCELLED',
  'DELETED'
);
CREATE TYPE "KnowledgeV2ElementKind" AS ENUM (
  'TITLE',
  'PARAGRAPH',
  'LIST',
  'TABLE',
  'TABLE_ROW_GROUP',
  'IMAGE_CAPTION',
  'CODE',
  'HEADER_FOOTER'
);
CREATE TYPE "KnowledgeV2DeletionStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
);
CREATE TYPE "KnowledgeV2SecurityClassification" AS ENUM (
  'PUBLIC',
  'INTERNAL',
  'CUSTOMER_PERSONAL',
  'SENSITIVE',
  'SECRET'
);
CREATE TYPE "KnowledgeV2ArtifactMalwareStatus" AS ENUM (
  'PENDING',
  'NOT_APPLICABLE',
  'CLEAN',
  'DETECTED',
  'SCAN_FAILED'
);
CREATE TYPE "KnowledgeV2MimeValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');
CREATE TYPE "KnowledgeV2ArtifactDeletionState" AS ENUM (
  'RETAINED',
  'TOMBSTONED',
  'DELETING',
  'DELETED',
  'FAILED'
);
CREATE TYPE "KnowledgeV2DocumentStatus" AS ENUM (
  'DISCOVERED',
  'ACTIVE',
  'NEEDS_REVIEW',
  'TOMBSTONED',
  'DELETED'
);
CREATE TYPE "KnowledgeV2ChunkIndexState" AS ENUM ('PENDING', 'INDEXED', 'FAILED', 'DELETED');

ALTER TABLE "KnowledgeIndexSnapshot"
  ADD COLUMN "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'LEGACY_V1';
ALTER TABLE "KnowledgeIndexSnapshotItem"
  ADD COLUMN "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'LEGACY_V1';

CREATE TABLE "KnowledgeV2Source" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" "KnowledgeV2SourceKind" NOT NULL,
  "displayName" TEXT NOT NULL,
  "connectorId" TEXT,
  "externalRootKey" TEXT,
  "canonicalUri" TEXT,
  "syncMode" "KnowledgeV2SourceSyncMode" NOT NULL DEFAULT 'MANUAL',
  "status" "KnowledgeV2SourceStatus" NOT NULL DEFAULT 'CONNECTING',
  "authorityProfileId" TEXT,
  "defaultScope" JSONB,
  "defaultClassification" "KnowledgeV2SecurityClassification" NOT NULL,
  "defaultLocale" TEXT NOT NULL DEFAULT 'en',
  "syncCursorEncrypted" TEXT,
  "sourcePermissionVersion" INTEGER NOT NULL DEFAULT 1,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "sourceObservedAt" TIMESTAMP(3),
  "nextSyncAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "generation" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tombstonedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2Source_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Source_values_check" CHECK (
    char_length("displayName") > 0
    AND char_length("defaultLocale") > 0
    AND "sourcePermissionVersion" > 0
    AND "generation" > 0
    AND "etag" > 0
    AND ("status" NOT IN ('DELETING', 'DELETED') OR "tombstonedAt" IS NOT NULL)
    AND ("status" <> 'DELETED' OR "deletedAt" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeV2Artifact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "objectStorageKey" TEXT NOT NULL,
  "encryptionKeyRef" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "detectedMimeType" TEXT,
  "declaredMimeType" TEXT,
  "originalFilename" TEXT,
  "acquisitionUriHash" TEXT,
  "upstreamEtag" TEXT,
  "upstreamModifiedAt" TIMESTAMP(3),
  "malwareStatus" "KnowledgeV2ArtifactMalwareStatus" NOT NULL DEFAULT 'PENDING',
  "mimeValidationStatus" "KnowledgeV2MimeValidationStatus" NOT NULL DEFAULT 'PENDING',
  "securityClassification" "KnowledgeV2SecurityClassification" NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "deletionState" "KnowledgeV2ArtifactDeletionState" NOT NULL DEFAULT 'RETAINED',
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2Artifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Artifact_values_check" CHECK (
    char_length("objectStorageKey") > 0
    AND char_length("encryptionKeyRef") > 0
    AND char_length("sha256") > 0
    AND "byteSize" >= 0
    AND char_length("retentionClass") > 0
  )
);

CREATE TABLE "KnowledgeV2Document" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "canonicalUri" TEXT,
  "title" TEXT NOT NULL,
  "canonicalLocale" TEXT NOT NULL DEFAULT 'en',
  "translationGroup" TEXT,
  "scope" JSONB,
  "audience" JSONB,
  "classification" "KnowledgeV2SecurityClassification" NOT NULL,
  "permissionVersion" INTEGER NOT NULL DEFAULT 1,
  "currentDraftRevisionId" TEXT,
  "currentPublishedRevisionId" TEXT,
  "sourceCreatedAt" TIMESTAMP(3),
  "sourceUpdatedAt" TIMESTAMP(3),
  "sourceDeletedAt" TIMESTAMP(3),
  "status" "KnowledgeV2DocumentStatus" NOT NULL DEFAULT 'DISCOVERED',
  "deletionGeneration" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tombstonedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2Document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Document_values_check" CHECK (
    char_length("externalKey") > 0
    AND char_length("kind") > 0
    AND char_length("title") > 0
    AND char_length("canonicalLocale") > 0
    AND "permissionVersion" > 0
    AND "deletionGeneration" > 0
  )
);

CREATE TABLE "KnowledgeV2DocumentRevision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "artifactId" TEXT,
  "extractedContentObjectKey" TEXT,
  "status" "KnowledgeV2RevisionStatus" NOT NULL DEFAULT 'ACQUIRED',
  "parserVersion" TEXT,
  "ocrVersion" TEXT,
  "normalizerVersion" TEXT,
  "extractorVersion" TEXT,
  "chunkerVersion" TEXT,
  "embeddingVersion" TEXT,
  "sparseIndexVersion" TEXT,
  "pipelineVersion" TEXT NOT NULL,
  "detectedLocale" TEXT,
  "characterCount" INTEGER NOT NULL DEFAULT 0,
  "tokenCount" INTEGER NOT NULL DEFAULT 0,
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "tableCount" INTEGER NOT NULL DEFAULT 0,
  "imageCount" INTEGER NOT NULL DEFAULT 0,
  "extractionCoverage" DOUBLE PRECISION,
  "parserQuality" JSONB,
  "sourcePermissionFingerprint" TEXT NOT NULL,
  "scopeSnapshot" JSONB,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "staleAfter" TIMESTAMP(3),
  "supersedesRevisionId" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2DocumentRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2DocumentRevision_values_check" CHECK (
    "revisionNumber" > 0
    AND char_length("contentHash") > 0
    AND char_length("pipelineVersion") > 0
    AND char_length("sourcePermissionFingerprint") > 0
    AND "characterCount" >= 0
    AND "tokenCount" >= 0
    AND "pageCount" >= 0
    AND "tableCount" >= 0
    AND "imageCount" >= 0
    AND "generation" > 0
    AND ("extractionCoverage" IS NULL OR ("extractionCoverage" >= 0 AND "extractionCoverage" <= 1))
    AND ("effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND ("supersedesRevisionId" IS NULL OR "supersedesRevisionId" <> "id")
  )
);

CREATE TABLE "KnowledgeV2Element" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "kind" "KnowledgeV2ElementKind" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "parentElementId" TEXT,
  "headingPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pageNumber" INTEGER,
  "boundingBox" JSONB,
  "urlAnchor" TEXT,
  "sheetName" TEXT,
  "sheetRange" TEXT,
  "normalizedText" TEXT,
  "objectStorageKey" TEXT,
  "contentHash" TEXT NOT NULL,
  "parserConfidence" DOUBLE PRECISION,
  "locale" TEXT NOT NULL,
  "classification" "KnowledgeV2SecurityClassification" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2Element_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Element_values_check" CHECK (
    "ordinal" >= 0
    AND ("parentElementId" IS NULL OR "parentElementId" <> "id")
    AND ("pageNumber" IS NULL OR "pageNumber" > 0)
    AND char_length("contentHash") > 0
    AND char_length("locale") > 0
    AND ("parserConfidence" IS NULL OR ("parserConfidence" >= 0 AND "parserConfidence" <= 1))
  )
);

CREATE TABLE "KnowledgeV2Chunk" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "parentElementId" TEXT,
  "parentSectionId" TEXT,
  "contentHash" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "locale" TEXT NOT NULL,
  "scope" JSONB,
  "classification" "KnowledgeV2SecurityClassification" NOT NULL,
  "permissionVersion" INTEGER NOT NULL,
  "denseSchemaVersion" TEXT NOT NULL,
  "sparseSchemaVersion" TEXT NOT NULL,
  "pipelineVersion" TEXT NOT NULL,
  "vectorPointId" TEXT NOT NULL,
  "indexState" "KnowledgeV2ChunkIndexState" NOT NULL DEFAULT 'PENDING',
  "indexedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "provenanceRange" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2Chunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Chunk_values_check" CHECK (
    "ordinal" >= 0
    AND "tokenCount" >= 0
    AND char_length("contentHash") > 0
    AND char_length("locale") > 0
    AND "permissionVersion" > 0
    AND char_length("denseSchemaVersion") > 0
    AND char_length("sparseSchemaVersion") > 0
    AND char_length("pipelineVersion") > 0
    AND char_length("vectorPointId") > 0
  )
);

CREATE TABLE "KnowledgeV2IndexSnapshotItem" (
  "tenantId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
  "contentHash" TEXT NOT NULL,
  "vectorPointId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2IndexSnapshotItem_pkey"
    PRIMARY KEY ("tenantId", "snapshotId", "chunkId"),
  CONSTRAINT "KnowledgeV2IndexSnapshotItem_values_check" CHECK (
    char_length("contentHash") > 0 AND char_length("vectorPointId") > 0
  ),
  CONSTRAINT "KnowledgeV2IndexSnapshotItem_corpus_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
  )
);

CREATE TABLE "KnowledgeV2DeletionLedger" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceGeneration" INTEGER NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "subsystem" TEXT NOT NULL,
  "status" "KnowledgeV2DeletionStatus" NOT NULL DEFAULT 'PENDING',
  "deniedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notBefore" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeV2DeletionLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2DeletionLedger_values_check" CHECK (
    "sourceGeneration" > 0
    AND char_length("targetType") > 0
    AND char_length("targetId") > 0
    AND char_length("subsystem") > 0
    AND "attemptCount" >= 0
    AND ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "KnowledgeV2Source_tenantId_id_key"
  ON "KnowledgeV2Source"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Source_tenant_kind_root_key"
  ON "KnowledgeV2Source"("tenantId", "kind", "externalRootKey");
CREATE INDEX "KnowledgeV2Source_tenant_status_updated_idx"
  ON "KnowledgeV2Source"("tenantId", "status", "updatedAt");
CREATE INDEX "KnowledgeV2Source_tenant_nextSync_idx"
  ON "KnowledgeV2Source"("tenantId", "nextSyncAt");

CREATE UNIQUE INDEX "KnowledgeV2Artifact_tenantId_id_key"
  ON "KnowledgeV2Artifact"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Artifact_tenant_source_id_key"
  ON "KnowledgeV2Artifact"("tenantId", "sourceId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Artifact_tenant_storage_key"
  ON "KnowledgeV2Artifact"("tenantId", "objectStorageKey");
CREATE INDEX "KnowledgeV2Artifact_tenant_source_acquired_idx"
  ON "KnowledgeV2Artifact"("tenantId", "sourceId", "acquiredAt");
CREATE INDEX "KnowledgeV2Artifact_tenant_source_sha_idx"
  ON "KnowledgeV2Artifact"("tenantId", "sourceId", "sha256");
CREATE INDEX "KnowledgeV2Artifact_tenant_deletion_idx"
  ON "KnowledgeV2Artifact"("tenantId", "deletionState", "deletedAt");

CREATE UNIQUE INDEX "KnowledgeV2Document_tenantId_id_key"
  ON "KnowledgeV2Document"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Document_tenant_source_id_key"
  ON "KnowledgeV2Document"("tenantId", "sourceId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Document_tenant_source_external_key"
  ON "KnowledgeV2Document"("tenantId", "sourceId", "externalKey");
CREATE UNIQUE INDEX "KnowledgeV2Document_tenant_draft_pointer_key"
  ON "KnowledgeV2Document"("tenantId", "id", "currentDraftRevisionId");
CREATE UNIQUE INDEX "KnowledgeV2Document_tenant_published_pointer_key"
  ON "KnowledgeV2Document"("tenantId", "id", "currentPublishedRevisionId");
CREATE INDEX "KnowledgeV2Document_tenant_source_status_idx"
  ON "KnowledgeV2Document"("tenantId", "sourceId", "status");
CREATE INDEX "KnowledgeV2Document_tenant_source_updated_idx"
  ON "KnowledgeV2Document"("tenantId", "sourceId", "updatedAt");
CREATE INDEX "KnowledgeV2Document_tenant_tombstoned_idx"
  ON "KnowledgeV2Document"("tenantId", "tombstonedAt");

CREATE UNIQUE INDEX "KnowledgeV2Revision_document_number_key"
  ON "KnowledgeV2DocumentRevision"("documentId", "revisionNumber");
CREATE UNIQUE INDEX "KnowledgeV2Revision_document_dedupe_key"
  ON "KnowledgeV2DocumentRevision"("documentId", "contentHash", "pipelineVersion");
CREATE UNIQUE INDEX "KnowledgeV2Revision_tenantId_id_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Revision_tenant_source_id_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "sourceId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Revision_tenant_id_hash_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "id", "contentHash");
CREATE UNIQUE INDEX "KnowledgeV2Revision_tenant_document_id_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Revision_tenant_source_document_id_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "sourceId", "documentId", "id");
CREATE INDEX "KnowledgeV2Revision_tenant_document_status_idx"
  ON "KnowledgeV2DocumentRevision"("tenantId", "documentId", "status", "createdAt");
CREATE INDEX "KnowledgeV2Revision_tenant_source_status_idx"
  ON "KnowledgeV2DocumentRevision"("tenantId", "sourceId", "status");
CREATE INDEX "KnowledgeV2Revision_tenant_hash_idx"
  ON "KnowledgeV2DocumentRevision"("tenantId", "contentHash");
CREATE INDEX "KnowledgeV2Revision_tenant_stale_idx"
  ON "KnowledgeV2DocumentRevision"("tenantId", "staleAfter");

CREATE UNIQUE INDEX "KnowledgeV2Element_revision_ordinal_key"
  ON "KnowledgeV2Element"("revisionId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeV2Element_tenantId_id_key"
  ON "KnowledgeV2Element"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Element_tenant_revision_id_key"
  ON "KnowledgeV2Element"("tenantId", "revisionId", "id");
CREATE INDEX "KnowledgeV2Element_tenant_document_revision_idx"
  ON "KnowledgeV2Element"("tenantId", "documentId", "revisionId", "ordinal");
CREATE INDEX "KnowledgeV2Element_tenant_hash_idx"
  ON "KnowledgeV2Element"("tenantId", "contentHash");

CREATE UNIQUE INDEX "KnowledgeV2Chunk_revision_pipeline_ordinal_key"
  ON "KnowledgeV2Chunk"("revisionId", "pipelineVersion", "ordinal");
CREATE UNIQUE INDEX "KnowledgeV2Chunk_tenantId_id_key"
  ON "KnowledgeV2Chunk"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Chunk_tenant_revision_id_key"
  ON "KnowledgeV2Chunk"("tenantId", "revisionId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Chunk_tenant_vector_key"
  ON "KnowledgeV2Chunk"("tenantId", "vectorPointId");
CREATE UNIQUE INDEX "KnowledgeV2Chunk_tenant_exact_vector_key"
  ON "KnowledgeV2Chunk"("tenantId", "id", "contentHash", "vectorPointId");
CREATE INDEX "KnowledgeV2Chunk_tenant_document_revision_idx"
  ON "KnowledgeV2Chunk"("tenantId", "documentId", "revisionId", "ordinal");
CREATE INDEX "KnowledgeV2Chunk_tenant_hash_idx"
  ON "KnowledgeV2Chunk"("tenantId", "contentHash");
CREATE INDEX "KnowledgeV2Chunk_tenant_index_state_idx"
  ON "KnowledgeV2Chunk"("tenantId", "indexState", "indexedAt");
CREATE INDEX "KnowledgeV2Chunk_tenant_deleted_idx"
  ON "KnowledgeV2Chunk"("tenantId", "deletedAt");

CREATE UNIQUE INDEX "KnowledgeV2IndexSnapshotItem_snapshot_vector_key"
  ON "KnowledgeV2IndexSnapshotItem"("tenantId", "snapshotId", "vectorPointId");
CREATE INDEX "KnowledgeV2IndexSnapshotItem_tenant_chunk_idx"
  ON "KnowledgeV2IndexSnapshotItem"("tenantId", "chunkId");

CREATE UNIQUE INDEX "KnowledgeIndexSnapshot_tenant_id_corpus_key"
  ON "KnowledgeIndexSnapshot"("tenantId", "id", "corpusKind");

CREATE UNIQUE INDEX "KnowledgeV2DeletionLedger_target_key"
  ON "KnowledgeV2DeletionLedger"(
    "tenantId",
    "sourceId",
    "sourceGeneration",
    "targetType",
    "targetId",
    "subsystem"
  );
CREATE UNIQUE INDEX "KnowledgeV2DeletionLedger_tenantId_id_key"
  ON "KnowledgeV2DeletionLedger"("tenantId", "id");
CREATE INDEX "KnowledgeV2DeletionLedger_tenant_status_idx"
  ON "KnowledgeV2DeletionLedger"("tenantId", "status", "notBefore");
CREATE INDEX "KnowledgeV2DeletionLedger_tenant_source_generation_idx"
  ON "KnowledgeV2DeletionLedger"("tenantId", "sourceId", "sourceGeneration");

ALTER TABLE "KnowledgeV2Source"
  ADD CONSTRAINT "KnowledgeV2Source_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2Artifact"
  ADD CONSTRAINT "KnowledgeV2Artifact_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Artifact_tenant_source_fkey"
  FOREIGN KEY ("tenantId", "sourceId")
  REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2Document"
  ADD CONSTRAINT "KnowledgeV2Document_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Document_tenant_source_fkey"
  FOREIGN KEY ("tenantId", "sourceId")
  REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2DocumentRevision"
  ADD CONSTRAINT "KnowledgeV2Revision_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Revision_tenant_source_document_fkey"
  FOREIGN KEY ("tenantId", "sourceId", "documentId")
  REFERENCES "KnowledgeV2Document"("tenantId", "sourceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Revision_tenant_source_artifact_fkey"
  FOREIGN KEY ("tenantId", "sourceId", "artifactId")
  REFERENCES "KnowledgeV2Artifact"("tenantId", "sourceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Revision_same_document_supersedes_fkey"
  FOREIGN KEY ("tenantId", "documentId", "supersedesRevisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2Document"
  ADD CONSTRAINT "KnowledgeV2Document_current_draft_fkey"
  FOREIGN KEY ("tenantId", "id", "currentDraftRevisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2Document_current_published_fkey"
  FOREIGN KEY ("tenantId", "id", "currentPublishedRevisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2Element"
  ADD CONSTRAINT "KnowledgeV2Element_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Element_tenant_document_revision_fkey"
  FOREIGN KEY ("tenantId", "documentId", "revisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Element_same_revision_parent_fkey"
  FOREIGN KEY ("tenantId", "revisionId", "parentElementId")
  REFERENCES "KnowledgeV2Element"("tenantId", "revisionId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2Chunk"
  ADD CONSTRAINT "KnowledgeV2Chunk_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Chunk_tenant_document_fkey"
  FOREIGN KEY ("tenantId", "documentId")
  REFERENCES "KnowledgeV2Document"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2Chunk_tenant_document_revision_fkey"
  FOREIGN KEY ("tenantId", "documentId", "revisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "documentId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2Chunk_same_revision_parent_fkey"
  FOREIGN KEY ("tenantId", "revisionId", "parentElementId")
  REFERENCES "KnowledgeV2Element"("tenantId", "revisionId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2Chunk_same_revision_section_fkey"
  FOREIGN KEY ("tenantId", "revisionId", "parentSectionId")
  REFERENCES "KnowledgeV2Element"("tenantId", "revisionId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeIndexSnapshotItem"
  DROP CONSTRAINT "KnowledgeIndexSnapshotItem_tenant_snapshot_fkey",
  ADD CONSTRAINT "KnowledgeIndexSnapshotItem_corpus_check" CHECK (
    "corpusKind" = 'LEGACY_V1'
  ),
  ADD CONSTRAINT "KnowledgeIndexSnapshotItem_tenant_snapshot_corpus_fkey"
  FOREIGN KEY ("tenantId", "snapshotId", "corpusKind")
  REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id", "corpusKind")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgePublication"
  DROP CONSTRAINT "KnowledgePublication_tenant_snapshot_fkey",
  ADD CONSTRAINT "KnowledgePublication_tenant_snapshot_corpus_fkey"
  FOREIGN KEY ("tenantId", "indexSnapshotId", "corpusKind")
  REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id", "corpusKind")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2IndexSnapshotItem"
  ADD CONSTRAINT "KnowledgeV2IndexSnapshotItem_tenant_snapshot_corpus_fkey"
  FOREIGN KEY ("tenantId", "snapshotId", "corpusKind")
  REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id", "corpusKind")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2IndexSnapshotItem_exact_chunk_fkey"
  FOREIGN KEY ("tenantId", "chunkId", "contentHash", "vectorPointId")
  REFERENCES "KnowledgeV2Chunk"("tenantId", "id", "contentHash", "vectorPointId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2DeletionLedger"
  ADD CONSTRAINT "KnowledgeV2DeletionLedger_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeV2DeletionLedger_tenant_source_fkey"
  FOREIGN KEY ("tenantId", "sourceId")
  REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgePublication" DROP CONSTRAINT "KnowledgePublication_structuredIndex_check";

ALTER TABLE "KnowledgePublicationItem" ADD COLUMN "v2DocumentRevisionId" TEXT;
CREATE INDEX "KnowledgePublicationItem_tenant_v2Revision_idx"
  ON "KnowledgePublicationItem"("tenantId", "v2DocumentRevisionId");
ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenant_v2Revision_hash_fkey"
  FOREIGN KEY ("tenantId", "v2DocumentRevisionId", "itemVersionHash")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "id", "contentHash")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublicationItem"
  DROP CONSTRAINT "KnowledgePublicationItem_typedItem_check",
  ADD CONSTRAINT "KnowledgePublicationItem_typedItem_check" CHECK (
    (
      "corpusKind" = 'LEGACY_V1'
      AND "itemType" = 'LEGACY_REVISION'
      AND "revisionId" IS NOT NULL
      AND "itemId" = "revisionId"
      AND "itemVersionHash" IS NULL
      AND "v2DocumentRevisionId" IS NULL
      AND "factVersionId" IS NULL
      AND "guidanceRuleVersionId" IS NULL
    )
    OR (
      "corpusKind" = 'STRUCTURED_V2'
      AND "revisionId" IS NULL
      AND (
        (
          "itemType" = 'DOCUMENT_REVISION'
          AND "v2DocumentRevisionId" IS NOT NULL
          AND "itemId" = "v2DocumentRevisionId"
          AND "itemVersionHash" IS NOT NULL
          AND "factVersionId" IS NULL
          AND "guidanceRuleVersionId" IS NULL
        )
        OR (
          "itemType" = 'FACT_VERSION'
          AND "factVersionId" IS NOT NULL
          AND "itemId" = "factVersionId"
          AND "itemVersionHash" IS NOT NULL
          AND "v2DocumentRevisionId" IS NULL
          AND "guidanceRuleVersionId" IS NULL
        )
        OR (
          "itemType" = 'GUIDANCE_RULE_VERSION'
          AND "guidanceRuleVersionId" IS NOT NULL
          AND "itemId" = "guidanceRuleVersionId"
          AND "itemVersionHash" IS NOT NULL
          AND "v2DocumentRevisionId" IS NULL
          AND "factVersionId" IS NULL
        )
        OR (
          "itemType" = 'SOURCE_PERMISSION_SNAPSHOT'
          AND "itemVersionHash" IS NOT NULL
          AND "authorizationFingerprint" IS NOT NULL
          AND "v2DocumentRevisionId" IS NULL
          AND "factVersionId" IS NULL
          AND "guidanceRuleVersionId" IS NULL
        )
      )
    )
  );

ALTER TABLE "KnowledgeJob"
  ADD COLUMN "v2SourceId" TEXT,
  ADD COLUMN "v2RevisionId" TEXT,
  ADD CONSTRAINT "KnowledgeJob_v2Revision_source_check" CHECK (
    "v2RevisionId" IS NULL OR "v2SourceId" IS NOT NULL
  );
CREATE INDEX "KnowledgeJob_tenant_v2Source_generation_idx"
  ON "KnowledgeJob"("tenantId", "v2SourceId", "generation");
CREATE INDEX "KnowledgeJob_tenant_v2Revision_generation_idx"
  ON "KnowledgeJob"("tenantId", "v2RevisionId", "generation");
ALTER TABLE "KnowledgeJob"
  ADD CONSTRAINT "KnowledgeJob_tenant_v2Source_fkey"
  FOREIGN KEY ("tenantId", "v2SourceId")
  REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeJob_tenant_v2Source_revision_fkey"
  FOREIGN KEY ("tenantId", "v2SourceId", "v2RevisionId")
  REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "sourceId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
