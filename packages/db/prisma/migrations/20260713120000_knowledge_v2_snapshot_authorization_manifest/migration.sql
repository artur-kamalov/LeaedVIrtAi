BEGIN;

ALTER TABLE "KnowledgeIndexSnapshot"
  ADD COLUMN "authorizationManifest" JSONB,
  ADD COLUMN "authorizationManifestHash" TEXT,
  ADD COLUMN "authorizationManifestVersion" INTEGER;

DROP INDEX "KnowledgeIndexSnapshot_reuse_key";

CREATE UNIQUE INDEX "KnowledgeIndexSnapshot_reuse_key"
  ON "KnowledgeIndexSnapshot"(
    "tenantId",
    "manifestHash",
    "collectionName",
    "embeddingProvider",
    "embeddingModel",
    "pipelineVersion",
    "authorizationManifestVersion"
  );

CREATE UNIQUE INDEX "KnowledgeIndexSnapshot_legacy_reuse_key"
  ON "KnowledgeIndexSnapshot"(
    "tenantId",
    "manifestHash",
    "collectionName",
    "embeddingProvider",
    "embeddingModel",
    "pipelineVersion"
  )
  WHERE "authorizationManifestVersion" IS NULL;

ALTER TABLE "KnowledgeIndexSnapshot"
  ADD CONSTRAINT "KnowledgeIndexSnapshot_authorization_manifest_check" CHECK (
    (
      "authorizationManifest" IS NULL
      AND "authorizationManifestHash" IS NULL
      AND "authorizationManifestVersion" IS NULL
    )
    OR (
      "corpusKind" = 'STRUCTURED_V2'
      AND "status" <> 'READY'
      AND "authorizationManifest" IS NULL
      AND "authorizationManifestHash" IS NULL
      AND "authorizationManifestVersion" = 1
    )
    OR (
      "authorizationManifest" IS NOT NULL
      AND jsonb_typeof("authorizationManifest") = 'object'
      AND "authorizationManifestHash" IS NOT NULL
      AND "authorizationManifestHash" ~ '^[a-f0-9]{64}$'
      AND "authorizationManifestVersion" IS NOT NULL
      AND "authorizationManifestVersion" >= 1
    )
  ),
  ADD CONSTRAINT "KnowledgeIndexSnapshot_structured_ready_authorization_check" CHECK (
    "corpusKind" <> 'STRUCTURED_V2'
    OR "status" <> 'READY'
    OR (
      "authorizationManifest" IS NOT NULL
      AND jsonb_typeof("authorizationManifest") = 'object'
      AND "authorizationManifestHash" IS NOT NULL
      AND "authorizationManifestHash" ~ '^[a-f0-9]{64}$'
      AND "authorizationManifestVersion" IS NOT NULL
      AND "authorizationManifestVersion" = 1
    )
  ) NOT VALID;

CREATE FUNCTION "KnowledgeIndexSnapshot_guard_authorization_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_index_snapshot_authorization_guard$
DECLARE
  authorization_changed BOOLEAN;
  status_changed BOOLEAN;
BEGIN
  authorization_changed :=
    OLD."authorizationManifest" IS DISTINCT FROM NEW."authorizationManifest"
    OR OLD."authorizationManifestHash" IS DISTINCT FROM NEW."authorizationManifestHash"
    OR OLD."authorizationManifestVersion" IS DISTINCT FROM NEW."authorizationManifestVersion";
  status_changed := OLD."status" IS DISTINCT FROM NEW."status";

  IF NOT authorization_changed AND NOT status_changed THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "KnowledgeIndexSnapshot" AS snapshot
  WHERE snapshot."tenantId" = OLD."tenantId"
    AND snapshot."id" = OLD."id"
  FOR UPDATE OF snapshot;

  IF EXISTS (
    SELECT 1
    FROM "KnowledgePublication" AS publication
    WHERE publication."tenantId" = OLD."tenantId"
      AND publication."indexSnapshotId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'snapshot authorization fields or status are immutable after publication'
      USING ERRCODE = '55000';
  END IF;

  IF authorization_changed AND OLD."status" = 'READY' THEN
    RAISE EXCEPTION 'READY snapshot authorization must be repaired only after moving it out of READY'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$knowledge_index_snapshot_authorization_guard$;

CREATE TRIGGER "KnowledgeIndexSnapshot_authorization_immutable"
  BEFORE UPDATE OF
    "authorizationManifest",
    "authorizationManifestHash",
    "authorizationManifestVersion",
    "status"
  ON "KnowledgeIndexSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeIndexSnapshot_guard_authorization_mutation"();

CREATE FUNCTION "KnowledgeIndexSnapshot_assert_v2_items_mutable"(
  snapshot_tenant_id TEXT,
  snapshot_id TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $knowledge_index_snapshot_item_assert$
DECLARE
  snapshot_status "KnowledgeIndexSnapshotStatus";
  snapshot_referenced BOOLEAN;
BEGIN
  PERFORM 1
  FROM "KnowledgeIndexSnapshot" AS snapshot
  WHERE snapshot."tenantId" = snapshot_tenant_id
    AND snapshot."id" = snapshot_id
  FOR UPDATE OF snapshot;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    snapshot."status",
    EXISTS (
      SELECT 1
      FROM "KnowledgePublication" AS publication
      WHERE publication."tenantId" = snapshot."tenantId"
        AND publication."indexSnapshotId" = snapshot."id"
    )
  INTO snapshot_status, snapshot_referenced
  FROM "KnowledgeIndexSnapshot" AS snapshot
  WHERE snapshot."tenantId" = snapshot_tenant_id
    AND snapshot."id" = snapshot_id;

  IF snapshot_referenced THEN
    RAISE EXCEPTION 'snapshot items are immutable after publication'
      USING ERRCODE = '55000';
  END IF;

  IF snapshot_status = 'READY' THEN
    RAISE EXCEPTION 'READY snapshot items must be repaired only after moving it out of READY'
      USING ERRCODE = '55000';
  END IF;
END;
$knowledge_index_snapshot_item_assert$;

CREATE FUNCTION "KnowledgeV2IndexSnapshotItem_guard_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_snapshot_item_guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "KnowledgeIndexSnapshot_assert_v2_items_mutable"(NEW."tenantId", NEW."snapshotId");
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM "KnowledgeIndexSnapshot_assert_v2_items_mutable"(OLD."tenantId", OLD."snapshotId");
    RETURN OLD;
  END IF;

  PERFORM "KnowledgeIndexSnapshot_assert_v2_items_mutable"(OLD."tenantId", OLD."snapshotId");
  IF
    OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
    OR OLD."snapshotId" IS DISTINCT FROM NEW."snapshotId"
  THEN
    PERFORM "KnowledgeIndexSnapshot_assert_v2_items_mutable"(NEW."tenantId", NEW."snapshotId");
  END IF;
  RETURN NEW;
END;
$knowledge_v2_snapshot_item_guard$;

CREATE TRIGGER "KnowledgeV2IndexSnapshotItem_snapshot_immutable"
  BEFORE INSERT OR UPDATE OR DELETE
  ON "KnowledgeV2IndexSnapshotItem"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2IndexSnapshotItem_guard_mutation"();

CREATE FUNCTION "KnowledgePublication_validate_snapshot_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_publication_snapshot_attachment$
DECLARE
  snapshot_authorization_manifest JSONB;
  snapshot_authorization_manifest_hash TEXT;
  snapshot_authorization_manifest_version INTEGER;
  snapshot_corpus_kind "KnowledgeCorpusKind";
  snapshot_status "KnowledgeIndexSnapshotStatus";
BEGIN
  IF NEW."indexSnapshotId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF
    TG_OP = 'UPDATE'
    AND OLD."tenantId" IS NOT DISTINCT FROM NEW."tenantId"
    AND OLD."corpusKind" IS NOT DISTINCT FROM NEW."corpusKind"
    AND OLD."indexSnapshotId" IS NOT DISTINCT FROM NEW."indexSnapshotId"
  THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "KnowledgeIndexSnapshot" AS snapshot
  WHERE snapshot."tenantId" = NEW."tenantId"
    AND snapshot."id" = NEW."indexSnapshotId"
  FOR UPDATE OF snapshot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication snapshot tenant binding is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    snapshot."corpusKind",
    snapshot."status",
    snapshot."authorizationManifest",
    snapshot."authorizationManifestHash",
    snapshot."authorizationManifestVersion"
  INTO
    snapshot_corpus_kind,
    snapshot_status,
    snapshot_authorization_manifest,
    snapshot_authorization_manifest_hash,
    snapshot_authorization_manifest_version
  FROM "KnowledgeIndexSnapshot" AS snapshot
  WHERE snapshot."tenantId" = NEW."tenantId"
    AND snapshot."id" = NEW."indexSnapshotId";

  IF snapshot_corpus_kind IS DISTINCT FROM NEW."corpusKind" THEN
    RAISE EXCEPTION 'publication snapshot corpus binding is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot_status <> 'READY' THEN
    RAISE EXCEPTION 'publication snapshot must be READY'
      USING ERRCODE = '55000';
  END IF;

  IF
    snapshot_corpus_kind = 'STRUCTURED_V2'
    AND (
      snapshot_authorization_manifest IS NULL
      OR jsonb_typeof(snapshot_authorization_manifest) <> 'object'
      OR snapshot_authorization_manifest_hash IS NULL
      OR snapshot_authorization_manifest_hash !~ '^[a-f0-9]{64}$'
      OR snapshot_authorization_manifest_version IS DISTINCT FROM 1
    )
  THEN
    RAISE EXCEPTION 'publication snapshot authorization manifest is incomplete or unsupported'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$knowledge_publication_snapshot_attachment$;

CREATE TRIGGER "KnowledgePublication_snapshot_attachment_guard"
  BEFORE INSERT OR UPDATE OF "tenantId", "corpusKind", "indexSnapshotId"
  ON "KnowledgePublication"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgePublication_validate_snapshot_attachment"();

COMMIT;
