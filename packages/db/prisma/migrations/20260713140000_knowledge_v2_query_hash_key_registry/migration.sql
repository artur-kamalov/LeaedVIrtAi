BEGIN;

CREATE TABLE "KnowledgeV2QueryHashKeyRegistry" (
  "keyId" TEXT NOT NULL,
  "queryHashVersion" TEXT NOT NULL,
  "keyCheck" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2QueryHashKeyRegistry_pkey" PRIMARY KEY ("keyId"),
  CONSTRAINT "KnowledgeV2QueryHashKeyRegistry_metadata_check" CHECK (
    "keyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    AND "keyCheck" ~ '^[a-f0-9]{64}$'
  )
);

CREATE FUNCTION "KnowledgeV2QueryHashKeyRegistry_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_query_hmac_key_registry_immutable$
BEGIN
  RAISE EXCEPTION 'knowledge query HMAC key registry rows are immutable'
    USING ERRCODE = '55000';
  RETURN OLD;
END;
$knowledge_query_hmac_key_registry_immutable$;

CREATE TRIGGER "KnowledgeV2QueryHashKeyRegistry_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2QueryHashKeyRegistry"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2QueryHashKeyRegistry_reject_mutation"();

COMMIT;
