CREATE OR REPLACE FUNCTION "business_import_field_provenance_valid"(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  entry RECORD;
  path_count INTEGER := 0;
  expected_paths TEXT[] := ARRAY[
    '/active', '/archivedAt', '/bookingNotes', '/category', '/description',
    '/duration/maximumMinutes', '/duration/minimumMinutes', '/externalId', '/kind',
    '/language', '/locationExternalId', '/name', '/price/amount', '/price/currency',
    '/price/from', '/price/taxNote', '/price/to', '/price/type', '/price/unit',
    '/validFrom', '/validUntil'
  ];
BEGIN
  IF jsonb_typeof(value) <> 'object' OR NOT value ?& expected_paths THEN
    RETURN FALSE;
  END IF;
  FOR entry IN SELECT key, item FROM jsonb_each(value) AS fields(key, item) LOOP
    path_count := path_count + 1;
    IF jsonb_typeof(entry.item) <> 'object'
      OR NOT entry.item ? 'authority'
      OR jsonb_typeof(entry.item->'authority') <> 'string' THEN
      RETURN FALSE;
    END IF;
    IF entry.item->>'authority' = 'IMPORTED' THEN
      IF (entry.item - 'authority' - 'evidenceId') <> '{}'::jsonb
        OR jsonb_typeof(entry.item->'evidenceId') <> 'string'
        OR length(entry.item->>'evidenceId') = 0 THEN
        RETURN FALSE;
      END IF;
    ELSIF entry.item->>'authority' IN ('MANUAL', 'SYSTEM') THEN
      IF (entry.item - 'authority') <> '{}'::jsonb THEN
        RETURN FALSE;
      END IF;
    ELSE
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN path_count = cardinality(expected_paths);
END;
$$;

ALTER TABLE "BusinessImportCandidateRevision"
  ADD COLUMN IF NOT EXISTS "fieldProvenance" JSONB;

DROP TRIGGER "BusinessImportCandidateRevision_immutable"
  ON "BusinessImportCandidateRevision";

UPDATE "BusinessImportCandidateRevision"
SET "fieldProvenance" = (
  SELECT jsonb_object_agg(path, '{"authority":"SYSTEM"}'::jsonb)
  FROM unnest(ARRAY[
    '/active', '/archivedAt', '/bookingNotes', '/category', '/description',
    '/duration/maximumMinutes', '/duration/minimumMinutes', '/externalId', '/kind',
    '/language', '/locationExternalId', '/name', '/price/amount', '/price/currency',
    '/price/from', '/price/taxNote', '/price/to', '/price/type', '/price/unit',
    '/validFrom', '/validUntil'
  ]) AS path
)
WHERE "fieldProvenance" IS NULL;

CREATE TRIGGER "BusinessImportCandidateRevision_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportCandidateRevision"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();

ALTER TABLE "BusinessImportCandidateRevision"
  ALTER COLUMN "fieldProvenance" SET NOT NULL;

ALTER TABLE "BusinessImportCandidateRevision"
  DROP CONSTRAINT "BusinessImportCandidateRevision_value_check";

ALTER TABLE "BusinessImportCandidateRevision"
  ADD CONSTRAINT "BusinessImportCandidateRevision_value_check" CHECK (
    "version" > 0
    AND "importGeneration" > 0
    AND "normalizedValueHash" ~ '^[a-f0-9]{64}$'
    AND "artifactSha256" ~ '^[a-f0-9]{64}$'
    AND "parsedManifestHash" ~ '^[a-f0-9]{64}$'
    AND "business_import_field_provenance_valid"("fieldProvenance")
    AND (("requiresApproval" AND length("requiredPermission") > 0) OR (NOT "requiresApproval" AND "requiredPermission" = ''))
  );
