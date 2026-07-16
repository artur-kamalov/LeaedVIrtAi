CREATE TABLE "KnowledgeV2LegacyMigration" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "sourceManifest" JSONB NOT NULL,
  "sourceManifestHash" TEXT NOT NULL,
  "sourceCursor" TEXT,
  "expectedSourceCount" INTEGER NOT NULL,
  "migratedSourceCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "requestedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "cutoverAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2LegacyMigration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2LegacyMigration_values_check" CHECK (
    "generation" > 0
    AND "status" IN ('QUEUED', 'RUNNING', 'BLOCKED', 'READY', 'CUTOVER', 'STALE', 'FAILED')
    AND "sourceManifestHash" ~ '^[a-f0-9]{64}$'
    AND "expectedSourceCount" >= 0
    AND "migratedSourceCount" >= 0
    AND "migratedSourceCount" <= "expectedSourceCount"
    AND "reviewCount" >= 0
    AND "conflictCount" >= 0
    AND ("completedAt" IS NULL OR "status" IN ('BLOCKED', 'READY', 'CUTOVER', 'STALE', 'FAILED'))
    AND (("status" = 'CUTOVER' AND "cutoverAt" IS NOT NULL) OR ("status" <> 'CUTOVER' AND "cutoverAt" IS NULL))
  )
);

CREATE TABLE "KnowledgeCorpusSelector" (
  "tenantId" TEXT NOT NULL,
  "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'LEGACY_V1',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "migrationId" TEXT,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selectedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeCorpusSelector_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "KnowledgeCorpusSelector_values_check" CHECK (
    "generation" > 0
    AND (
      ("corpusKind" = 'LEGACY_V1' AND "migrationId" IS NULL)
      OR ("corpusKind" = 'STRUCTURED_V2' AND "migrationId" IS NOT NULL AND char_length("migrationId") > 0)
    )
  )
);

ALTER TABLE "KnowledgeV2DocumentRevision"
  ADD COLUMN "legacyMigrationId" TEXT,
  ADD COLUMN "legacySourceId" TEXT,
  ADD COLUMN "legacySourceVersion" INTEGER,
  ADD COLUMN "legacySnapshotHash" TEXT,
  DROP CONSTRAINT "KnowledgeV2DocumentRevision_values_check",
  ADD CONSTRAINT "KnowledgeV2DocumentRevision_values_check" CHECK (
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
    AND (
      ("legacyMigrationId" IS NULL AND "legacySourceId" IS NULL AND "legacySourceVersion" IS NULL AND "legacySnapshotHash" IS NULL)
      OR (
        "legacyMigrationId" IS NOT NULL
        AND "legacySourceId" IS NOT NULL
        AND "legacySourceVersion" > 0
        AND "legacySnapshotHash" ~ '^[a-f0-9]{64}$'
        AND "parserVersion" = 'legacy-snapshot-v1'
        AND "pipelineVersion" = 'knowledge-v2-legacy-migration-v1'
      )
    )
  );

CREATE UNIQUE INDEX "KnowledgeV2LegacyMigration_tenant_manifest_key"
  ON "KnowledgeV2LegacyMigration"("tenantId", "sourceManifestHash");
CREATE UNIQUE INDEX "KnowledgeV2LegacyMigration_tenant_id_key"
  ON "KnowledgeV2LegacyMigration"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2LegacyMigration_tenant_job_key"
  ON "KnowledgeV2LegacyMigration"("tenantId", "jobId");
CREATE UNIQUE INDEX "KnowledgeV2LegacyMigration_jobId_key"
  ON "KnowledgeV2LegacyMigration"("jobId");
CREATE INDEX "KnowledgeV2LegacyMigration_tenant_status_created_idx"
  ON "KnowledgeV2LegacyMigration"("tenantId", "status", "createdAt");
CREATE INDEX "KnowledgeCorpusSelector_corpus_updated_idx"
  ON "KnowledgeCorpusSelector"("corpusKind", "updatedAt");
CREATE INDEX "KnowledgeCorpusSelector_tenant_migration_idx"
  ON "KnowledgeCorpusSelector"("tenantId", "migrationId");
CREATE INDEX "KnowledgeCorpusSelector_tenant_actor_idx"
  ON "KnowledgeCorpusSelector"("tenantId", "selectedByUserId");
CREATE UNIQUE INDEX "BusinessKnowledgeSource_tenant_id_key"
  ON "BusinessKnowledgeSource"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2DocumentRevision_tenant_legacy_source_version_key"
  ON "KnowledgeV2DocumentRevision"("tenantId", "legacySourceId", "legacySourceVersion");
CREATE INDEX "KnowledgeV2DocumentRevision_tenant_legacy_migration_idx"
  ON "KnowledgeV2DocumentRevision"("tenantId", "legacyMigrationId");

ALTER TABLE "KnowledgeV2LegacyMigration"
  ADD CONSTRAINT "KnowledgeV2LegacyMigration_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2LegacyMigration"
  ADD CONSTRAINT "KnowledgeV2LegacyMigration_job_fkey"
  FOREIGN KEY ("tenantId", "jobId") REFERENCES "KnowledgeJob"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LegacyMigration_requester_fkey"
  FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "Membership"("tenantId", "userId")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeCorpusSelector"
  ADD CONSTRAINT "KnowledgeCorpusSelector_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeCorpusSelector"
  ADD CONSTRAINT "KnowledgeCorpusSelector_migration_fkey"
  FOREIGN KEY ("tenantId", "migrationId") REFERENCES "KnowledgeV2LegacyMigration"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeCorpusSelector_actor_fkey"
  FOREIGN KEY ("tenantId", "selectedByUserId") REFERENCES "Membership"("tenantId", "userId")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2DocumentRevision"
  ADD CONSTRAINT "KnowledgeV2DocumentRevision_legacy_migration_fkey"
  FOREIGN KEY ("tenantId", "legacyMigrationId")
  REFERENCES "KnowledgeV2LegacyMigration"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2DocumentRevision"
  ADD CONSTRAINT "KnowledgeV2DocumentRevision_legacy_source_fkey"
  FOREIGN KEY ("tenantId", "legacySourceId")
  REFERENCES "BusinessKnowledgeSource"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE FUNCTION "KnowledgeV2_reject_legacy_migration_input_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."jobId" IS DISTINCT FROM OLD."jobId"
    OR NEW."generation" IS DISTINCT FROM OLD."generation"
    OR NEW."sourceManifest" IS DISTINCT FROM OLD."sourceManifest"
    OR NEW."sourceManifestHash" IS DISTINCT FROM OLD."sourceManifestHash"
    OR NEW."expectedSourceCount" IS DISTINCT FROM OLD."expectedSourceCount"
    OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
  THEN
    RAISE EXCEPTION 'Knowledge v2 legacy migration input is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "KnowledgeV2_reject_legacy_provenance_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."legacyMigrationId" IS DISTINCT FROM OLD."legacyMigrationId"
    OR NEW."legacySourceId" IS DISTINCT FROM OLD."legacySourceId"
    OR NEW."legacySourceVersion" IS DISTINCT FROM OLD."legacySourceVersion"
    OR NEW."legacySnapshotHash" IS DISTINCT FROM OLD."legacySnapshotHash"
  THEN
    RAISE EXCEPTION 'Knowledge v2 legacy migration provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "KnowledgeV2_enforce_one_way_corpus_cutover"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."corpusKind" = 'STRUCTURED_V2' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "KnowledgeV2LegacyMigration" AS migration
      WHERE migration."tenantId" = NEW."tenantId"
        AND migration."id" = NEW."migrationId"
        AND migration."status" = 'READY'
    ) THEN
      RAISE EXCEPTION 'Knowledge corpus cutover requires a ready same-tenant migration';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "ActiveKnowledgePublication" AS pointer
      JOIN "KnowledgePublication" AS publication
        ON publication."tenantId" = pointer."tenantId"
        AND publication."id" = pointer."publicationId"
        AND publication."sequence" = pointer."sequence"
      JOIN "KnowledgeIndexSnapshot" AS snapshot
        ON snapshot."tenantId" = publication."tenantId"
        AND snapshot."id" = publication."indexSnapshotId"
        AND snapshot."corpusKind" = publication."corpusKind"
      WHERE pointer."tenantId" = NEW."tenantId"
        AND pointer."targetKey" = 'workspace-v2'
        AND publication."targetKey" = 'workspace-v2'
        AND publication."corpusKind" = 'STRUCTURED_V2'
        AND publication."status" = 'ACTIVE'
        AND snapshot."status" = 'READY'
        AND snapshot."verifiedAt" IS NOT NULL
        AND snapshot."indexSchema" IS NOT NULL
        AND snapshot."indexSchemaHash" ~ '^[a-f0-9]{64}$'
        AND snapshot."expectedPointCount" = snapshot."observedPointCount"
        AND snapshot."expectedPointCount" = (
          SELECT COUNT(*)
          FROM "KnowledgeV2IndexSnapshotItem" AS snapshot_item
          WHERE snapshot_item."tenantId" = snapshot."tenantId"
            AND snapshot_item."snapshotId" = snapshot."id"
            AND snapshot_item."corpusKind" = snapshot."corpusKind"
        )
        AND EXISTS (
          SELECT 1
          FROM "KnowledgeV2PublicationValidation" AS validation
          WHERE validation."tenantId" = publication."tenantId"
            AND validation."publicationId" = publication."id"
            AND validation."corpusKind" = publication."corpusKind"
            AND validation."status" = 'PASSED'
            AND validation."candidateManifestHash" = publication."manifestHash"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "KnowledgeV2IndexSnapshotItem" AS snapshot_item
          JOIN "KnowledgeV2Chunk" AS chunk
            ON chunk."tenantId" = snapshot_item."tenantId"
            AND chunk."id" = snapshot_item."chunkId"
          WHERE snapshot_item."tenantId" = snapshot."tenantId"
            AND snapshot_item."snapshotId" = snapshot."id"
            AND (
              snapshot_item."contentHash" <> chunk."contentHash"
              OR snapshot_item."vectorPointId" <> chunk."vectorPointId"
              OR snapshot_item."pointFingerprint" !~ '^[a-f0-9]{64}$'
              OR chunk."deletedAt" IS NOT NULL
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "KnowledgePublicationItem" AS item
          LEFT JOIN "KnowledgeV2DocumentRevision" AS revision
            ON revision."tenantId" = item."tenantId"
            AND revision."id" = item."v2DocumentRevisionId"
          LEFT JOIN "KnowledgeV2Document" AS document
            ON document."tenantId" = revision."tenantId"
            AND document."id" = revision."documentId"
          LEFT JOIN "KnowledgeV2Source" AS source
            ON source."tenantId" = document."tenantId"
            AND source."id" = document."sourceId"
          WHERE item."tenantId" = publication."tenantId"
            AND item."publicationId" = publication."id"
            AND item."itemType" = 'DOCUMENT_REVISION'
            AND (
              revision."id" IS NULL
              OR revision."deletedAt" IS NOT NULL
              OR revision."status" NOT IN ('READY', 'PUBLISHED')
              OR item."itemVersionHash" IS DISTINCT FROM revision."contentHash"
              OR item."authorizationFingerprint" IS DISTINCT FROM revision."sourcePermissionFingerprint"
              OR document."deletedAt" IS NOT NULL
              OR document."tombstonedAt" IS NOT NULL
              OR document."status" NOT IN ('ACTIVE', 'DISCOVERED')
              OR document."permissionVersion" <> source."sourcePermissionVersion"
              OR source."deletedAt" IS NOT NULL
              OR source."tombstonedAt" IS NOT NULL
              OR source."status" NOT IN ('READY', 'SYNCING', 'PAUSED')
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "KnowledgePublicationItem" AS item
          JOIN "KnowledgeV2DocumentRevision" AS revision
            ON revision."tenantId" = item."tenantId"
            AND revision."id" = item."v2DocumentRevisionId"
          JOIN "KnowledgeV2Chunk" AS chunk
            ON chunk."tenantId" = revision."tenantId"
            AND chunk."revisionId" = revision."id"
          WHERE item."tenantId" = publication."tenantId"
            AND item."publicationId" = publication."id"
            AND item."itemType" = 'DOCUMENT_REVISION'
            AND chunk."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM "KnowledgeV2IndexSnapshotItem" AS snapshot_item
              WHERE snapshot_item."tenantId" = snapshot."tenantId"
                AND snapshot_item."snapshotId" = snapshot."id"
                AND snapshot_item."chunkId" = chunk."id"
                AND snapshot_item."contentHash" = chunk."contentHash"
                AND snapshot_item."vectorPointId" = chunk."vectorPointId"
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "KnowledgeV2IndexSnapshotItem" AS snapshot_item
          JOIN "KnowledgeV2Chunk" AS chunk
            ON chunk."tenantId" = snapshot_item."tenantId"
            AND chunk."id" = snapshot_item."chunkId"
          WHERE snapshot_item."tenantId" = snapshot."tenantId"
            AND snapshot_item."snapshotId" = snapshot."id"
            AND NOT EXISTS (
              SELECT 1
              FROM "KnowledgePublicationItem" AS item
              WHERE item."tenantId" = publication."tenantId"
                AND item."publicationId" = publication."id"
                AND item."itemType" = 'DOCUMENT_REVISION'
                AND item."v2DocumentRevisionId" = chunk."revisionId"
            )
        )
    ) THEN
      RAISE EXCEPTION 'Knowledge corpus cutover requires an active serving-eligible structured publication';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."corpusKind" = 'STRUCTURED_V2'
      AND (NEW."corpusKind" IS DISTINCT FROM OLD."corpusKind" OR NEW."migrationId" IS DISTINCT FROM OLD."migrationId")
    THEN
      RAISE EXCEPTION 'Knowledge corpus cutover is one-way';
    END IF;
    IF NEW."generation" <= OLD."generation" THEN
      RAISE EXCEPTION 'Knowledge corpus selector generation must advance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "KnowledgeV2LegacyMigration_immutable_input"
BEFORE UPDATE ON "KnowledgeV2LegacyMigration"
FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_legacy_migration_input_mutation"();

CREATE TRIGGER "KnowledgeV2DocumentRevision_immutable_legacy_provenance"
BEFORE UPDATE ON "KnowledgeV2DocumentRevision"
FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_legacy_provenance_mutation"();

CREATE TRIGGER "KnowledgeCorpusSelector_one_way"
BEFORE INSERT OR UPDATE ON "KnowledgeCorpusSelector"
FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_enforce_one_way_corpus_cutover"();
