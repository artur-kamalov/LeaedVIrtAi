ALTER TABLE "BusinessImportApplication"
  ADD COLUMN "idempotencyRequestHash" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BusinessImportApplication") THEN
    RAISE EXCEPTION 'Existing business import applications must be recreated before installing the durable idempotency request contract';
  END IF;
END;
$$;

ALTER TABLE "BusinessImportApplication"
  ALTER COLUMN "idempotencyRequestHash" SET NOT NULL,
  ADD CONSTRAINT "BusinessImportApplication_idempotency_request_hash_check"
    CHECK ("idempotencyRequestHash" ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION "business_import_application_idempotency_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BusinessImportApplication idempotency identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."idempotencyKeyHash" IS DISTINCT FROM OLD."idempotencyKeyHash"
    OR NEW."idempotencyRequestHash" IS DISTINCT FROM OLD."idempotencyRequestHash"
  THEN
    RAISE EXCEPTION 'BusinessImportApplication idempotency identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportApplication_idempotency_identity_guard"
BEFORE UPDATE OF "idempotencyKeyHash", "idempotencyRequestHash" OR DELETE
ON "BusinessImportApplication"
FOR EACH ROW EXECUTE FUNCTION "business_import_application_idempotency_identity_guard"();
