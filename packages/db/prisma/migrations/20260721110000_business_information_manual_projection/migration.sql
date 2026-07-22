ALTER TABLE "BusinessInformationProjectionReceipt"
  ALTER COLUMN "sourceId" DROP NOT NULL,
  ALTER COLUMN "importId" DROP NOT NULL,
  ALTER COLUMN "applicationId" DROP NOT NULL;

ALTER TABLE "BusinessInformationProjectionReceipt"
  DROP CONSTRAINT "BusinessInformationProjectionReceipt_value_check",
  ADD CONSTRAINT "BusinessInformationProjectionReceipt_value_check" CHECK (
    "businessRevision" > 0
    AND "knowledgeDraftGeneration" > 0
    AND length("knowledgeTargetKey") > 0
    AND "businessRevisionHash" ~ '^[a-f0-9]{64}$'
    AND "knowledgeDraftManifestHash" ~ '^[a-f0-9]{64}$'
    AND "receiptHash" ~ '^[a-f0-9]{64}$'
    AND (
      ("sourceId" IS NULL AND "importId" IS NULL AND "applicationId" IS NULL)
      OR
      ("sourceId" IS NOT NULL AND "importId" IS NOT NULL AND "applicationId" IS NOT NULL)
    )
    AND (
      ("runtimeOutboxId" IS NOT NULL AND "runtimeOutboxPrunedAt" IS NULL)
      OR
      ("runtimeOutboxId" IS NULL AND "runtimeOutboxPrunedAt" IS NOT NULL)
    )
  );

ALTER TABLE "BusinessImportApplication"
  DROP CONSTRAINT "BusinessImportApplication_receipt_check",
  ADD CONSTRAINT "BusinessImportApplication_receipt_check" CHECK (
    (
      "projectionReceiptHash" IS NULL
      AND "projectedAt" IS NULL
      AND "state" IN ('COMMITTED', 'PROJECTING', 'PROJECTION_DELAYED')
    )
    OR (
      "projectionReceiptHash" IS NULL
      AND "projectedAt" IS NULL
      AND "state" = 'SUPERSEDED'
      AND "supersededAt" IS NOT NULL
    )
    OR (
      "projectionReceiptHash" IS NOT NULL
      AND "projectedAt" IS NOT NULL
      AND "state" IN ('READY', 'REVERTED', 'SUPERSEDED')
    )
  );

CREATE OR REPLACE FUNCTION "business_information_projection_receipt_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  application_outbox_id TEXT;
  outbox_event_type TEXT;
  outbox_payload JSONB;
  outbox_generation INTEGER;
  revision_origin TEXT;
  revision_created_by TEXT;
  revision_created_at TIMESTAMP(3);
BEGIN
  IF NEW."runtimeOutboxId" IS NULL THEN
    RAISE EXCEPTION 'Projection receipt requires its exact runtime outbox' USING ERRCODE = '23514';
  END IF;

  SELECT "eventType", "payload", "generation"
    INTO outbox_event_type, outbox_payload, outbox_generation
  FROM "RuntimeOutbox"
  WHERE "id" = NEW."runtimeOutboxId"
    AND "tenantId" = NEW."tenantId"
    AND "dedupeKey" = NEW."runtimeOutboxDedupeKey"
    AND "aggregateType" = 'BusinessInformationRevision'
    AND "aggregateId" = NEW."businessRevisionId"
    AND "aggregateVersion" = NEW."businessRevision"
    AND "generation" > 0
    AND "schemaVersion" = 1
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projection receipt does not match its exact runtime outbox' USING ERRCODE = '23514';
  END IF;

  IF NEW."applicationId" IS NOT NULL THEN
    SELECT "projectionOutboxId"
      INTO application_outbox_id
    FROM "BusinessImportApplication"
    WHERE "tenantId" = NEW."tenantId"
      AND "sourceId" = NEW."sourceId"
      AND "importId" = NEW."importId"
      AND "id" = NEW."applicationId"
      AND "businessRevisionId" = NEW."businessRevisionId"
      AND "resultingInformationRevision" = NEW."businessRevision"
      AND "resultingInformationHash" = NEW."businessRevisionHash"
      AND "projectionOutboxDedupeKey" = NEW."runtimeOutboxDedupeKey"
    FOR KEY SHARE;

    IF application_outbox_id IS NULL
      OR application_outbox_id <> NEW."runtimeOutboxId"
      OR outbox_event_type <> 'business.import.project.requested'
    THEN
      RAISE EXCEPTION 'Projection receipt does not match its application and outbox' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "origin"::TEXT, "createdByUserId", "createdAt"
      INTO revision_origin, revision_created_by, revision_created_at
    FROM "BusinessInformationRevision"
    WHERE "tenantId" = NEW."tenantId"
      AND "id" = NEW."businessRevisionId"
      AND "revision" = NEW."businessRevision"
      AND "canonicalHash" = NEW."businessRevisionHash"
    FOR KEY SHARE;

    IF NOT FOUND
      OR revision_origin <> 'MANUAL'
      OR revision_created_by IS NULL
      OR outbox_generation <> NEW."businessRevision"
      OR outbox_event_type <> 'business.information.project.requested'
      OR outbox_payload->>'queueName' <> 'business.import'
      OR outbox_payload->>'jobName' <> 'project-revision'
      OR outbox_payload->>'jobId' <> NEW."runtimeOutboxDedupeKey"
      OR outbox_payload->'attempts' <> '10'::JSONB
      OR outbox_payload->'backoffMs' <> '2000'::JSONB
      OR (SELECT count(*) FROM jsonb_object_keys(outbox_payload)) <> 6
      OR jsonb_typeof(outbox_payload->'data') <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(outbox_payload->'data')) <> 6
      OR outbox_payload#>>'{data,tenantId}' <> NEW."tenantId"
      OR outbox_payload#>>'{data,businessRevisionId}' <> NEW."businessRevisionId"
      OR outbox_payload#>>'{data,businessRevision}' <> NEW."businessRevision"::TEXT
      OR outbox_payload#>>'{data,generation}' <> NEW."businessRevision"::TEXT
      OR outbox_payload#>>'{data,requestedByUserId}' <> revision_created_by
      OR outbox_payload#>>'{data,requestedAt}' <>
        to_char(revision_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    THEN
      RAISE EXCEPTION 'Manual projection receipt does not match its exact revision and outbox' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "business_import_application_ready_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" IN ('READY', 'REVERTED')
    OR (NEW."state" = 'SUPERSEDED' AND NEW."projectionReceiptHash" IS NOT NULL)
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "BusinessInformationProjectionReceipt"
      WHERE "tenantId" = NEW."tenantId"
        AND "sourceId" = NEW."sourceId"
        AND "importId" = NEW."importId"
        AND "applicationId" = NEW."id"
        AND "businessRevisionId" = NEW."businessRevisionId"
        AND "businessRevision" = NEW."resultingInformationRevision"
        AND "businessRevisionHash" = NEW."resultingInformationHash"
        AND "runtimeOutboxDedupeKey" = NEW."projectionOutboxDedupeKey"
        AND "receiptHash" = NEW."projectionReceiptHash"
    ) THEN
      RAISE EXCEPTION 'Ready application requires an exact durable projection receipt' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."state" = 'SUPERSEDED' AND NOT EXISTS (
    SELECT 1
    FROM "BusinessInformationState"
    WHERE "tenantId" = NEW."tenantId"
      AND "revision" > NEW."resultingInformationRevision"
      AND "currentRevisionId" <> NEW."businessRevisionId"
  ) THEN
    RAISE EXCEPTION 'Unprojected application can only be superseded by a newer current revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "business_import_object_ledger_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger is durable and cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId"
    OR NEW."id" <> OLD."id"
    OR NEW."objectKind" <> OLD."objectKind"
    OR NEW."objectStorageKey" <> OLD."objectStorageKey"
    OR NEW."encryptionKeyRef" <> OLD."encryptionKeyRef"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger object identity is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."retainUntil" IS NOT NULL
    AND NEW."retainUntil" IS NOT NULL
    AND NEW."retainUntil" < OLD."retainUntil"
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger retention cannot be shortened' USING ERRCODE = '23514';
  END IF;

  IF OLD."tombstoneReason" IS NOT NULL
    AND NEW."tombstoneReason" IS DISTINCT FROM OLD."tombstoneReason"
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger tombstone reason is immutable' USING ERRCODE = '23514';
  END IF;

  IF (OLD."tombstonedAt" IS NOT NULL AND NEW."tombstonedAt" IS DISTINCT FROM OLD."tombstonedAt")
    OR (OLD."deletionStartedAt" IS NOT NULL AND NEW."deletionStartedAt" IS DISTINCT FROM OLD."deletionStartedAt")
    OR (OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt")
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger lifecycle timestamps are immutable once recorded' USING ERRCODE = '23514';
  END IF;

  IF NEW."deletionState" <> OLD."deletionState" AND NOT (
    (OLD."deletionState" = 'RETAINED' AND NEW."deletionState" = 'TOMBSTONED')
    OR (OLD."deletionState" = 'TOMBSTONED' AND NEW."deletionState" = 'DELETING')
    OR (OLD."deletionState" = 'DELETING' AND NEW."deletionState" IN ('DELETED', 'FAILED'))
    OR (OLD."deletionState" = 'FAILED' AND NEW."deletionState" = 'DELETING')
  ) THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger deletion lifecycle cannot move backward or skip states' USING ERRCODE = '23514';
  END IF;

  IF NEW."legalHold" IS DISTINCT FROM OLD."legalHold"
    AND (OLD."deletionState" <> 'RETAINED' OR NEW."deletionState" <> 'RETAINED')
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger legal hold can only change while retained' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
