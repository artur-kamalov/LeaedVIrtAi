BEGIN;

ALTER TABLE "KnowledgeV2Settings"
  ADD COLUMN "defaultScope" JSONB,
  ADD COLUMN "defaultScopeGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "defaultScopeHash" TEXT;

ALTER TABLE "KnowledgePublicationItem"
  ADD COLUMN "usesTenantDefaultScope" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tenantDefaultScopeGeneration" INTEGER,
  ADD COLUMN "tenantDefaultScopeHash" TEXT;

ALTER TABLE "KnowledgeV2Settings"
  ADD CONSTRAINT "KnowledgeV2Settings_default_scope_check" CHECK (
    "defaultScopeGeneration" >= 0
    AND (
      (
        "defaultScope" IS NULL
        AND "defaultScopeHash" IS NULL
      )
      OR (
        "defaultScope" IS NOT NULL
        AND "defaultScopeHash" IS NOT NULL
        AND jsonb_typeof("defaultScope") = 'object'
        AND "defaultScopeGeneration" > 0
        AND "defaultScopeHash" ~ '^[a-f0-9]{64}$'
        AND "defaultScope" ? 'audiences'
        AND jsonb_typeof("defaultScope" -> 'audiences') = 'array'
        AND jsonb_array_length("defaultScope" -> 'audiences') > 0
      )
    )
  );

ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_default_scope_binding_check" CHECK (
    (
      NOT "usesTenantDefaultScope"
      AND "tenantDefaultScopeGeneration" IS NULL
      AND "tenantDefaultScopeHash" IS NULL
    )
    OR (
      "usesTenantDefaultScope"
      AND "corpusKind" = 'STRUCTURED_V2'
      AND "itemType" IN ('FACT_VERSION', 'GUIDANCE_RULE_VERSION')
      AND "tenantDefaultScopeGeneration" IS NOT NULL
      AND "tenantDefaultScopeGeneration" > 0
      AND "tenantDefaultScopeHash" IS NOT NULL
      AND "tenantDefaultScopeHash" ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_structured_scope_check" CHECK (
    "corpusKind" <> 'STRUCTURED_V2'
    OR "itemType" NOT IN ('FACT_VERSION', 'GUIDANCE_RULE_VERSION')
    OR (
      "scope" IS NOT NULL
      AND jsonb_typeof("scope") = 'object'
      AND "scope" ? 'audiences'
      AND jsonb_typeof("scope" -> 'audiences') = 'array'
      AND jsonb_array_length("scope" -> 'audiences') > 0
    )
  ) NOT VALID;

CREATE FUNCTION "KnowledgeV2_enforce_default_scope_generation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_default_scope_generation$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW."defaultScope" IS NULL) <> (NEW."defaultScopeHash" IS NULL) THEN
      RAISE EXCEPTION 'tenant default scope and hash must be set or cleared together'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."defaultScopeHash" IS NULL AND NEW."defaultScopeGeneration" <> 0 THEN
      RAISE EXCEPTION 'unset tenant default scope must start at generation 0'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."defaultScopeHash" IS NOT NULL AND NEW."defaultScopeGeneration" <> 1 THEN
      RAISE EXCEPTION 'tenant default scope must start at generation 1'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF
    (OLD."defaultScope" IS DISTINCT FROM NEW."defaultScope") <>
    (OLD."defaultScopeHash" IS DISTINCT FROM NEW."defaultScopeHash")
  THEN
    RAISE EXCEPTION 'tenant default scope and hash must change together'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."defaultScopeHash" IS DISTINCT FROM NEW."defaultScopeHash" THEN
    IF NEW."defaultScopeGeneration" <> OLD."defaultScopeGeneration" + 1 THEN
      RAISE EXCEPTION 'tenant default scope generation must advance exactly once'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."defaultScopeGeneration" <> OLD."defaultScopeGeneration" THEN
    RAISE EXCEPTION 'tenant default scope generation cannot change without a semantic scope change'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$knowledge_v2_default_scope_generation$;

CREATE TRIGGER "KnowledgeV2Settings_default_scope_generation"
  BEFORE INSERT OR UPDATE OF "defaultScope", "defaultScopeGeneration", "defaultScopeHash"
  ON "KnowledgeV2Settings"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_enforce_default_scope_generation"();

COMMIT;
