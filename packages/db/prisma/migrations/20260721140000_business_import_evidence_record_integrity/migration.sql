ALTER TABLE "BusinessImportCandidateEvidence"
  ADD COLUMN "evidenceRecordHash" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BusinessImportCandidateEvidence") THEN
    RAISE EXCEPTION 'Existing business import evidence must be re-imported before installing the evidence record hash contract';
  END IF;
END;
$$;

ALTER TABLE "BusinessImportCandidateEvidence"
  ALTER COLUMN "evidenceRecordHash" SET NOT NULL,
  ADD CONSTRAINT "BusinessImportEvidence_record_hash_check"
    CHECK ("evidenceRecordHash" ~ '^[a-f0-9]{64}$');

CREATE TRIGGER "BusinessImportCandidateEvidence_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportCandidateEvidence"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();
