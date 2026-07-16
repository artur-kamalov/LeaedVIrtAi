BEGIN;

ALTER TABLE "KnowledgeV2FactVersion"
  DROP CONSTRAINT IF EXISTS "KnowledgeV2FactVersion_tenantId_supersedesVersionId_fkey";
ALTER TABLE "KnowledgeV2FactVersion"
  DROP CONSTRAINT IF EXISTS "KnowledgeV2FactVersion_sameFactSupersedes_fkey";
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeV2FactVersion_tenant_fact_id_key"
  ON "KnowledgeV2FactVersion"("tenantId", "factId", "id");
ALTER TABLE "KnowledgeV2FactVersion"
  ADD CONSTRAINT "KnowledgeV2FactVersion_sameFactSupersedes_fkey"
  FOREIGN KEY ("tenantId", "factId", "supersedesVersionId")
  REFERENCES "KnowledgeV2FactVersion"("tenantId", "factId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  DROP CONSTRAINT IF EXISTS "KnowledgeV2GuidanceRuleVersion_tenantId_supersedesVersionI_fkey";
ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  DROP CONSTRAINT IF EXISTS "KnowledgeV2GuidanceRuleVersion_sameRuleSupersedes_fkey";
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeV2GuidanceRuleVersion_tenant_rule_id_key"
  ON "KnowledgeV2GuidanceRuleVersion"("tenantId", "guidanceRuleId", "id");
ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  ADD CONSTRAINT "KnowledgeV2GuidanceRuleVersion_sameRuleSupersedes_fkey"
  FOREIGN KEY ("tenantId", "guidanceRuleId", "supersedesVersionId")
  REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "guidanceRuleId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "KnowledgeV2_reject_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_evidence_immutable$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'knowledge evidence % is immutable', OLD."id" USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'knowledge evidence % cannot be deleted directly', OLD."id" USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$knowledge_v2_evidence_immutable$;

CREATE OR REPLACE FUNCTION "KnowledgeV2_guard_evidence_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_evidence_insert$
DECLARE
  publication_status "KnowledgePublicationStatus";
BEGIN
  FOR publication_status IN
    SELECT publication."status"
    FROM "KnowledgePublicationItem" AS item
    JOIN "KnowledgePublication" AS publication
      ON publication."tenantId" = item."tenantId"
     AND publication."id" = item."publicationId"
     AND publication."corpusKind" = item."corpusKind"
    WHERE item."tenantId" = NEW."tenantId"
      AND (
        (NEW."factVersionId" IS NOT NULL AND item."factVersionId" = NEW."factVersionId")
        OR (
          NEW."guidanceRuleVersionId" IS NOT NULL
          AND item."guidanceRuleVersionId" = NEW."guidanceRuleVersionId"
        )
      )
    FOR SHARE OF publication
  LOOP
    IF publication_status IN ('ACTIVE', 'SUPERSEDED', 'ROLLED_BACK') THEN
      RAISE EXCEPTION 'knowledge evidence cannot be attached after publication activation'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$knowledge_v2_evidence_insert$;

DROP TRIGGER IF EXISTS "KnowledgeV2Evidence_immutable" ON "KnowledgeV2Evidence";
CREATE TRIGGER "KnowledgeV2Evidence_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2Evidence"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_evidence_mutation"();
DROP TRIGGER IF EXISTS "KnowledgeV2Evidence_publication_guard" ON "KnowledgeV2Evidence";
CREATE TRIGGER "KnowledgeV2Evidence_publication_guard"
  BEFORE INSERT ON "KnowledgeV2Evidence"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_guard_evidence_insert"();

CREATE OR REPLACE FUNCTION "Knowledge_reject_publication_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_publication_immutable$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK')
       AND pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'knowledge publication % cannot be deleted after validation', OLD."id"
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK') THEN
    IF ROW(
      OLD."id",
      OLD."tenantId",
      OLD."targetKey",
      OLD."corpusKind",
      OLD."sequence",
      OLD."indexSnapshotId",
      OLD."basePublicationId",
      OLD."manifestHash",
      OLD."pipelineVersion",
      OLD."retrievalPolicyVersion",
      OLD."promptPolicyVersion",
      OLD."qualitySummary",
      OLD."createdAt"
    ) IS DISTINCT FROM ROW(
      NEW."id",
      NEW."tenantId",
      NEW."targetKey",
      NEW."corpusKind",
      NEW."sequence",
      NEW."indexSnapshotId",
      NEW."basePublicationId",
      NEW."manifestHash",
      NEW."pipelineVersion",
      NEW."retrievalPolicyVersion",
      NEW."promptPolicyVersion",
      NEW."qualitySummary",
      NEW."createdAt"
    ) THEN
      RAISE EXCEPTION 'knowledge publication % manifest is immutable after validation', OLD."id"
        USING ERRCODE = '55000';
    END IF;
    IF NEW."status" = 'VALIDATING' THEN
      RAISE EXCEPTION 'knowledge publication % cannot return to validation', OLD."id"
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$knowledge_publication_immutable$;

DROP TRIGGER IF EXISTS "KnowledgePublication_immutable" ON "KnowledgePublication";
CREATE TRIGGER "KnowledgePublication_immutable"
  BEFORE UPDATE ON "KnowledgePublication"
  FOR EACH ROW EXECUTE FUNCTION "Knowledge_reject_publication_mutation"();

CREATE OR REPLACE FUNCTION "Knowledge_reject_publication_item_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_publication_item_immutable$
DECLARE
  source_status "KnowledgePublicationStatus";
  target_status "KnowledgePublicationStatus";
BEGIN
  SELECT publication."status"
    INTO source_status
  FROM "KnowledgePublication" AS publication
  WHERE publication."tenantId" = OLD."tenantId"
    AND publication."id" = OLD."publicationId"
    AND publication."corpusKind" = OLD."corpusKind"
  FOR SHARE;

  IF source_status IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK') THEN
    IF TG_OP = 'UPDATE' OR pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'knowledge publication item is immutable after validation'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT publication."status"
      INTO target_status
    FROM "KnowledgePublication" AS publication
    WHERE publication."tenantId" = NEW."tenantId"
      AND publication."id" = NEW."publicationId"
      AND publication."corpusKind" = NEW."corpusKind"
    FOR SHARE;
    IF target_status IN ('READY', 'PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK') THEN
      RAISE EXCEPTION 'knowledge publication item is immutable after validation'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$knowledge_publication_item_immutable$;

CREATE OR REPLACE FUNCTION "Knowledge_guard_publication_item_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_publication_item_insert$
DECLARE
  publication_status "KnowledgePublicationStatus";
BEGIN
  SELECT publication."status"
    INTO publication_status
  FROM "KnowledgePublication" AS publication
  WHERE publication."tenantId" = NEW."tenantId"
    AND publication."id" = NEW."publicationId"
    AND publication."corpusKind" = NEW."corpusKind"
  FOR SHARE;

  IF publication_status IN ('PUBLISHING', 'ACTIVE', 'SUPERSEDED', 'FAILED', 'ROLLED_BACK') THEN
    RAISE EXCEPTION 'knowledge publication items cannot be added after activation starts'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$knowledge_publication_item_insert$;

DROP TRIGGER IF EXISTS "KnowledgePublicationItem_immutable" ON "KnowledgePublicationItem";
CREATE TRIGGER "KnowledgePublicationItem_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgePublicationItem"
  FOR EACH ROW EXECUTE FUNCTION "Knowledge_reject_publication_item_mutation"();
DROP TRIGGER IF EXISTS "KnowledgePublicationItem_insert_guard" ON "KnowledgePublicationItem";
CREATE TRIGGER "KnowledgePublicationItem_insert_guard"
  BEFORE INSERT ON "KnowledgePublicationItem"
  FOR EACH ROW EXECUTE FUNCTION "Knowledge_guard_publication_item_insert"();

COMMIT;
