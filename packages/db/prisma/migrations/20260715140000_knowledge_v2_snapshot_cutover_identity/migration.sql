BEGIN;

CREATE OR REPLACE FUNCTION "KnowledgeV2_enforce_one_way_corpus_cutover"()
RETURNS TRIGGER AS $knowledge_v2_corpus_cutover$
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
        AND snapshot."authorizationManifest" IS NOT NULL
        AND jsonb_typeof(snapshot."authorizationManifest") = 'object'
        AND snapshot."authorizationManifestHash" ~ '^[a-f0-9]{64}$'
        AND snapshot."authorizationManifestVersion" = 1
        AND snapshot."authorizationManifest" ->> 'tenantId' = snapshot."tenantId"
        AND snapshot."authorizationManifest" ->> 'snapshotId' = snapshot."id"
        AND snapshot."authorizationManifest" ->> 'snapshotManifestHash' = snapshot."manifestHash"
        AND snapshot."authorizationManifest" ->> 'indexSchemaHash' = snapshot."indexSchemaHash"
        AND (snapshot."authorizationManifest" ->> 'expectedPointCount')::INTEGER = snapshot."expectedPointCount"
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
              OR snapshot_item."vectorPointId" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
      AND (
        NEW."corpusKind" IS DISTINCT FROM OLD."corpusKind"
        OR NEW."migrationId" IS DISTINCT FROM OLD."migrationId"
      )
    THEN
      RAISE EXCEPTION 'Knowledge corpus cutover is one-way';
    END IF;
    IF NEW."generation" <= OLD."generation" THEN
      RAISE EXCEPTION 'Knowledge corpus selector generation must advance';
    END IF;
  END IF;

  RETURN NEW;
END;
$knowledge_v2_corpus_cutover$ LANGUAGE plpgsql;

COMMIT;
