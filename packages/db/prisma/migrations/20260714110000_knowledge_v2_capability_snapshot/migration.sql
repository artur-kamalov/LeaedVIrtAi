BEGIN;

CREATE TYPE "KnowledgeV2CapabilityType" AS ENUM (
  'GENERAL_FAQ',
  'LEAD_QUALIFICATION',
  'PRICING',
  'APPOINTMENT_DISCOVERY',
  'APPOINTMENT_BOOKING',
  'ORDER_ACCOUNT_SUPPORT',
  'COMMERCE_RECOMMENDATION',
  'REGULATED_TOPIC'
);

CREATE TYPE "KnowledgeV2CapabilityAutonomy" AS ENUM (
  'ANSWER_ONLY',
  'COLLECT_INFORMATION',
  'PROPOSE_ACTION',
  'ACT_WITH_CONFIRMATION',
  'AUTONOMOUS_ACTION'
);

CREATE TYPE "KnowledgeV2RequirementKind" AS ENUM (
  'FACT',
  'RULE',
  'DOCUMENT_COVERAGE',
  'CONNECTOR',
  'TOOL',
  'PERMISSION',
  'LOCALE',
  'EVALUATION_CASE'
);

CREATE TYPE "KnowledgeV2RequirementSeverity" AS ENUM ('BLOCKER', 'WARNING');

CREATE TYPE "KnowledgeV2RequirementEvaluationStatus" AS ENUM (
  'PENDING',
  'SATISFIED',
  'UNSATISFIED',
  'STALE',
  'CONFLICTED',
  'NOT_APPLICABLE',
  'ERROR'
);

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD COLUMN "capabilitySetHash" TEXT,
  ADD COLUMN "requirementEvaluationSetHash" TEXT;

ALTER TABLE "KnowledgePublication"
  ADD COLUMN "capabilitySetHash" TEXT,
  ADD COLUMN "requirementEvaluationSetHash" TEXT;

ALTER TABLE "Channel"
  ADD COLUMN "automaticRepliesCapabilitySetHash" TEXT;

ALTER TABLE "AiReplyRun"
  ADD COLUMN "capabilitySetHash" TEXT;

CREATE TABLE "KnowledgeV2Capability" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "capabilityType" "KnowledgeV2CapabilityType" NOT NULL,
  "targetKey" TEXT NOT NULL DEFAULT 'workspace-v2',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "allowedAutonomy" "KnowledgeV2CapabilityAutonomy" NOT NULL DEFAULT 'ANSWER_ONLY',
  "scope" JSONB,
  "templateKey" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "serverOwned" BOOLEAN NOT NULL DEFAULT true,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeV2Capability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Capability_values_check" CHECK (
    char_length(btrim("targetKey")) > 0
    AND char_length(btrim("templateKey")) > 0
    AND "templateVersion" >= 1
    AND "generation" >= 1
    AND "etag" >= 1
    AND ("scope" IS NULL OR jsonb_typeof("scope") = 'object')
  )
);

CREATE TABLE "KnowledgeV2RequirementDefinition" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "requirementKey" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "kind" "KnowledgeV2RequirementKind" NOT NULL,
  "severity" "KnowledgeV2RequirementSeverity" NOT NULL,
  "riskLevel" "KnowledgeV2RiskLevel" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "freshnessSlaSeconds" INTEGER,
  "requiredScope" JSONB,
  "localeConstraints" JSONB,
  "satisfactionPredicate" JSONB NOT NULL,
  "predicateVersion" TEXT NOT NULL DEFAULT 'knowledge-requirement-v1',
  "templateOrigin" TEXT NOT NULL,
  "tenantOverride" BOOLEAN NOT NULL DEFAULT false,
  "immutableHash" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeV2RequirementDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2RequirementDefinition_values_check" CHECK (
    char_length(btrim("requirementKey")) > 0
    AND "definitionVersion" >= 1
    AND ("freshnessSlaSeconds" IS NULL OR "freshnessSlaSeconds" >= 0)
    AND ("requiredScope" IS NULL OR jsonb_typeof("requiredScope") = 'object')
    AND ("localeConstraints" IS NULL OR jsonb_typeof("localeConstraints") = 'object')
    AND "predicateVersion" = 'knowledge-requirement-v1'
    AND char_length(btrim("templateOrigin")) > 0
    AND "immutableHash" ~ '^[a-f0-9]{64}$'
    AND (("approvedByUserId" IS NULL AND "approvedAt" IS NULL) OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL))
  ),
  CONSTRAINT "KnowledgeV2RequirementDefinition_predicate_check" CHECK (
    jsonb_typeof("satisfactionPredicate") = 'object'
    AND "satisfactionPredicate" @> '{"schemaVersion": 1}'::jsonb
    AND jsonb_typeof("satisfactionPredicate" -> 'values') = 'array'
    AND jsonb_array_length("satisfactionPredicate" -> 'values') > 0
    AND (
      ("kind" = 'FACT' AND "satisfactionPredicate" ->> 'operator' IN ('FACT_KEY_EQUALS', 'FACT_KEY_PREFIX', 'FIELD_TYPE_IN'))
      OR ("kind" = 'RULE' AND "satisfactionPredicate" ->> 'operator' = 'RULE_TYPE_IN')
      OR ("kind" = 'DOCUMENT_COVERAGE' AND "satisfactionPredicate" ->> 'operator' = 'DOCUMENT_COUNT')
      OR ("kind" = 'CONNECTOR' AND "satisfactionPredicate" ->> 'operator' = 'CONNECTOR_CONNECTED')
      OR ("kind" = 'TOOL' AND "satisfactionPredicate" ->> 'operator' = 'TOOL_AVAILABLE')
      OR ("kind" = 'PERMISSION' AND "satisfactionPredicate" ->> 'operator' = 'PERMISSION_GRANTED')
      OR ("kind" = 'LOCALE' AND "satisfactionPredicate" ->> 'operator' = 'LOCALE_COVERAGE')
      OR ("kind" = 'EVALUATION_CASE' AND "satisfactionPredicate" ->> 'operator' = 'EVALUATION_CASE_PASS')
    )
    AND (
      NOT ("satisfactionPredicate" ? 'minimumCount')
      OR (
        jsonb_typeof("satisfactionPredicate" -> 'minimumCount') = 'number'
        AND ("satisfactionPredicate" ->> 'minimumCount')::INTEGER >= 1
      )
    )
    AND (
      NOT ("satisfactionPredicate" ? 'minimumCoverageBps')
      OR (
        jsonb_typeof("satisfactionPredicate" -> 'minimumCoverageBps') = 'number'
        AND ("satisfactionPredicate" ->> 'minimumCoverageBps')::INTEGER BETWEEN 0 AND 10000
      )
    )
    AND (
      NOT ("satisfactionPredicate" ? 'maxAgeSeconds')
      OR (
        jsonb_typeof("satisfactionPredicate" -> 'maxAgeSeconds') = 'number'
        AND ("satisfactionPredicate" ->> 'maxAgeSeconds')::INTEGER >= 0
      )
    )
  )
);

CREATE TABLE "KnowledgeV2RequirementEvaluation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "validationId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "requirementDefinitionId" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "status" "KnowledgeV2RequirementEvaluationStatus" NOT NULL DEFAULT 'PENDING',
  "evidenceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reasonCode" TEXT,
  "details" JSONB,
  "evaluatorVersion" TEXT NOT NULL DEFAULT 'knowledge-requirement-v1',
  "immutableHash" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeV2RequirementEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2RequirementEvaluation_values_check" CHECK (
    "definitionVersion" >= 1
    AND char_length(btrim("evaluatorVersion")) > 0
    AND "immutableHash" ~ '^[a-f0-9]{64}$'
    AND (("status" = 'PENDING' AND "evaluatedAt" IS NULL) OR ("status" <> 'PENDING' AND "evaluatedAt" IS NOT NULL))
    AND ("details" IS NULL OR jsonb_typeof("details") = 'object')
  )
);

CREATE TABLE "KnowledgePublicationCapability" (
  "tenantId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "validationId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "capabilityType" "KnowledgeV2CapabilityType" NOT NULL,
  "allowedAutonomy" "KnowledgeV2CapabilityAutonomy" NOT NULL,
  "capabilityEtag" INTEGER NOT NULL,
  "capabilitySnapshotHash" TEXT NOT NULL,
  "requirementEvaluationSetHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgePublicationCapability_pkey" PRIMARY KEY ("publicationId", "capabilityId"),
  CONSTRAINT "KnowledgePublicationCapability_values_check" CHECK (
    "capabilityEtag" >= 1
    AND "capabilitySnapshotHash" ~ '^[a-f0-9]{64}$'
    AND "requirementEvaluationSetHash" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_capabilityHashes_check" CHECK (
    ("capabilitySetHash" IS NULL AND "requirementEvaluationSetHash" IS NULL)
    OR (
      "capabilitySetHash" ~ '^[a-f0-9]{64}$'
      AND "requirementEvaluationSetHash" ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_capabilityHashes_check" CHECK (
    ("capabilitySetHash" IS NULL AND "requirementEvaluationSetHash" IS NULL)
    OR (
      "capabilitySetHash" ~ '^[a-f0-9]{64}$'
      AND "requirementEvaluationSetHash" ~ '^[a-f0-9]{64}$'
    )
  );

UPDATE "Channel"
SET
  "automaticRepliesEnabled" = false,
  "automaticRepliesGeneration" = "automaticRepliesGeneration" + 1,
  "automaticRepliesPublicationId" = NULL,
  "automaticRepliesPublicationEtag" = NULL,
  "automaticRepliesChannelFingerprint" = NULL,
  "automaticRepliesCapabilitySetHash" = NULL,
  "automaticRepliesActivatedAt" = NULL,
  "automaticRepliesActivatedByUserId" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Channel"
  DROP CONSTRAINT "Channel_automaticRepliesBinding_check";

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_automaticRepliesCapabilitySetHash_check" CHECK (
    "automaticRepliesCapabilitySetHash" IS NULL
    OR "automaticRepliesCapabilitySetHash" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "Channel_automaticRepliesBinding_check" CHECK (
    (
      "automaticRepliesEnabled" = false
      AND "automaticRepliesPublicationId" IS NULL
      AND "automaticRepliesPublicationEtag" IS NULL
      AND "automaticRepliesChannelFingerprint" IS NULL
      AND "automaticRepliesCapabilitySetHash" IS NULL
      AND "automaticRepliesActivatedAt" IS NULL
      AND "automaticRepliesActivatedByUserId" IS NULL
    )
    OR (
      "automaticRepliesEnabled" = true
      AND "automaticRepliesPublicationId" IS NOT NULL
      AND "automaticRepliesPublicationEtag" IS NOT NULL
      AND "automaticRepliesChannelFingerprint" IS NOT NULL
      AND "automaticRepliesCapabilitySetHash" IS NOT NULL
      AND "automaticRepliesActivatedAt" IS NOT NULL
      AND "automaticRepliesActivatedByUserId" IS NOT NULL
    )
  );

ALTER TABLE "AiReplyRun"
  ADD CONSTRAINT "AiReplyRun_capabilitySetHash_check" CHECK (
    "capabilitySetHash" IS NULL OR "capabilitySetHash" ~ '^[a-f0-9]{64}$'
  );

CREATE UNIQUE INDEX "KnowledgeV2Capability_tenantId_capabilityType_targetKey_key"
  ON "KnowledgeV2Capability"("tenantId", "capabilityType", "targetKey");
CREATE UNIQUE INDEX "KnowledgeV2Capability_tenantId_id_key"
  ON "KnowledgeV2Capability"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2Capability_tenantId_id_capabilityType_key"
  ON "KnowledgeV2Capability"("tenantId", "id", "capabilityType");
CREATE INDEX "KnowledgeV2Capability_tenantId_enabled_targetKey_idx"
  ON "KnowledgeV2Capability"("tenantId", "enabled", "targetKey");
CREATE INDEX "KnowledgeV2Capability_tenantId_templateKey_templateVersion_idx"
  ON "KnowledgeV2Capability"("tenantId", "templateKey", "templateVersion");

CREATE UNIQUE INDEX "KnowledgeV2RequirementDefinition_tenantId_id_key"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2RequirementDefinition_context_key"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "capabilityId", "id", "definitionVersion");
CREATE UNIQUE INDEX "KnowledgeV2RequirementDefinition_version_key"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "capabilityId", "requirementKey", "definitionVersion");
CREATE UNIQUE INDEX "KnowledgeV2RequirementDefinition_hash_key"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "capabilityId", "requirementKey", "immutableHash");
CREATE INDEX "KnowledgeV2RequirementDefinition_active_idx"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "capabilityId", "active", "requirementKey");
CREATE INDEX "KnowledgeV2RequirementDefinition_tenantId_kind_severity_idx"
  ON "KnowledgeV2RequirementDefinition"("tenantId", "kind", "severity");

CREATE UNIQUE INDEX "KnowledgeV2RequirementEvaluation_tenantId_id_key"
  ON "KnowledgeV2RequirementEvaluation"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2RequirementEvaluation_validation_definition_key"
  ON "KnowledgeV2RequirementEvaluation"("tenantId", "validationId", "requirementDefinitionId");
CREATE INDEX "KnowledgeV2RequirementEvaluation_validation_status_idx"
  ON "KnowledgeV2RequirementEvaluation"("tenantId", "validationId", "status");
CREATE INDEX "KnowledgeV2RequirementEvaluation_capability_status_idx"
  ON "KnowledgeV2RequirementEvaluation"("tenantId", "capabilityId", "status");
CREATE INDEX "KnowledgeV2RequirementEvaluation_definition_idx"
  ON "KnowledgeV2RequirementEvaluation"("tenantId", "requirementDefinitionId");

CREATE UNIQUE INDEX "KnowledgeV2PublicationValidation_result_key"
  ON "KnowledgeV2PublicationValidation"("tenantId", "id", "publicationId");

CREATE UNIQUE INDEX "KnowledgePublicationCapability_context_key"
  ON "KnowledgePublicationCapability"("tenantId", "publicationId", "capabilityId");
CREATE UNIQUE INDEX "KnowledgePublicationCapability_type_key"
  ON "KnowledgePublicationCapability"("tenantId", "publicationId", "capabilityType");
CREATE INDEX "KnowledgePublicationCapability_tenantId_validationId_idx"
  ON "KnowledgePublicationCapability"("tenantId", "validationId");
CREATE INDEX "KnowledgePublicationCapability_tenantId_capabilityId_idx"
  ON "KnowledgePublicationCapability"("tenantId", "capabilityId");

ALTER TABLE "KnowledgeV2Capability"
  ADD CONSTRAINT "KnowledgeV2Capability_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2RequirementDefinition"
  ADD CONSTRAINT "KnowledgeV2RequirementDefinition_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2RequirementDefinition_tenantId_capabilityId_fkey"
  FOREIGN KEY ("tenantId", "capabilityId") REFERENCES "KnowledgeV2Capability"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2RequirementEvaluation"
  ADD CONSTRAINT "KnowledgeV2RequirementEvaluation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2RequirementEvaluation_tenantId_validationId_fkey"
  FOREIGN KEY ("tenantId", "validationId") REFERENCES "KnowledgeV2PublicationValidation"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2RequirementEvaluation_tenantId_capabilityId_fkey"
  FOREIGN KEY ("tenantId", "capabilityId") REFERENCES "KnowledgeV2Capability"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2RequirementEvaluation_definition_fkey"
  FOREIGN KEY ("tenantId", "capabilityId", "requirementDefinitionId", "definitionVersion")
  REFERENCES "KnowledgeV2RequirementDefinition"("tenantId", "capabilityId", "id", "definitionVersion")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgePublicationCapability"
  ADD CONSTRAINT "KnowledgePublicationCapability_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgePublicationCapability_tenantId_publicationId_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "KnowledgePublication"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgePublicationCapability_validation_fkey"
  FOREIGN KEY ("tenantId", "validationId", "publicationId")
  REFERENCES "KnowledgeV2PublicationValidation"("tenantId", "id", "publicationId")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgePublicationCapability_capability_fkey"
  FOREIGN KEY ("tenantId", "capabilityId", "capabilityType")
  REFERENCES "KnowledgeV2Capability"("tenantId", "id", "capabilityType")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TRIGGER "KnowledgeV2RequirementDefinition_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2RequirementDefinition"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_version_mutation"();

CREATE TRIGGER "KnowledgeV2RequirementEvaluation_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2RequirementEvaluation"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();

CREATE TRIGGER "KnowledgePublicationCapability_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgePublicationCapability"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();

WITH live_tenants AS (
  SELECT "id"
  FROM "Tenant"
  WHERE "deletedAt" IS NULL
    AND "status" IN ('TRIALING', 'ACTIVE')
), capability_templates("capabilityType", "templateKey") AS (
  VALUES
    ('GENERAL_FAQ'::"KnowledgeV2CapabilityType", 'platform.capability.general-faq'),
    ('LEAD_QUALIFICATION'::"KnowledgeV2CapabilityType", 'platform.capability.lead-qualification'),
    ('PRICING'::"KnowledgeV2CapabilityType", 'platform.capability.pricing'),
    ('APPOINTMENT_DISCOVERY'::"KnowledgeV2CapabilityType", 'platform.capability.appointment-discovery'),
    ('APPOINTMENT_BOOKING'::"KnowledgeV2CapabilityType", 'platform.capability.appointment-booking'),
    ('ORDER_ACCOUNT_SUPPORT'::"KnowledgeV2CapabilityType", 'platform.capability.order-account-support'),
    ('COMMERCE_RECOMMENDATION'::"KnowledgeV2CapabilityType", 'platform.capability.commerce-recommendation'),
    ('REGULATED_TOPIC'::"KnowledgeV2CapabilityType", 'platform.capability.regulated-topic')
)
INSERT INTO "KnowledgeV2Capability" (
  "id", "tenantId", "capabilityType", "targetKey", "enabled", "allowedAutonomy",
  "templateKey", "templateVersion", "serverOwned", "generation", "etag", "updatedAt"
)
SELECT
  'kvc_v1_' || md5(live_tenants."id" || ':' || capability_templates."capabilityType"::TEXT || ':workspace-v2'),
  live_tenants."id",
  capability_templates."capabilityType",
  'workspace-v2',
  capability_templates."capabilityType" = 'GENERAL_FAQ',
  'ANSWER_ONLY'::"KnowledgeV2CapabilityAutonomy",
  capability_templates."templateKey",
  1,
  true,
  1,
  1,
  CURRENT_TIMESTAMP
FROM live_tenants
CROSS JOIN capability_templates;

WITH requirement_templates(
  "capabilityType", "requirementKey", "kind", "severity", "riskLevel", "operator",
  "values", "minimumCount", "minimumCoverageBps", "maxAgeSeconds", "freshnessSlaSeconds"
) AS (
  VALUES
    ('GENERAL_FAQ', 'business_identity', 'FACT', 'BLOCKER', 'LOW', 'FACT_KEY_EQUALS', ARRAY['business/name'], 1, NULL, NULL, NULL),
    ('GENERAL_FAQ', 'contact_route', 'FACT', 'WARNING', 'LOW', 'FACT_KEY_PREFIX', ARRAY['contact/'], 1, NULL, NULL, NULL),
    ('GENERAL_FAQ', 'approved_knowledge', 'DOCUMENT_COVERAGE', 'WARNING', 'LOW', 'DOCUMENT_COUNT', ARRAY['APPROVED'], 1, NULL, NULL, NULL),
    ('GENERAL_FAQ', 'escalation_route', 'RULE', 'BLOCKER', 'MEDIUM', 'RULE_TYPE_IN', ARRAY['ESCALATION'], 1, NULL, NULL, NULL),
    ('GENERAL_FAQ', 'supported_locales', 'LOCALE', 'WARNING', 'LOW', 'LOCALE_COVERAGE', ARRAY['TENANT_SUPPORTED'], NULL, 10000, NULL, NULL),
    ('LEAD_QUALIFICATION', 'qualification_fields', 'FACT', 'BLOCKER', 'MEDIUM', 'FACT_KEY_PREFIX', ARRAY['lead/qualification/'], 1, NULL, NULL, NULL),
    ('LEAD_QUALIFICATION', 'disqualifier_rules', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['PROHIBITION'], 1, NULL, NULL, NULL),
    ('LEAD_QUALIFICATION', 'collection_consent', 'PERMISSION', 'BLOCKER', 'HIGH', 'PERMISSION_GRANTED', ARRAY['lead_data_collection'], 1, NULL, NULL, NULL),
    ('LEAD_QUALIFICATION', 'routing_rules', 'RULE', 'BLOCKER', 'MEDIUM', 'RULE_TYPE_IN', ARRAY['ESCALATION'], 1, NULL, NULL, NULL),
    ('PRICING', 'structured_price', 'FACT', 'BLOCKER', 'HIGH', 'FIELD_TYPE_IN', ARRAY['MONEY'], 1, NULL, NULL, 86400),
    ('PRICING', 'pricing_conditions', 'FACT', 'BLOCKER', 'HIGH', 'FACT_KEY_PREFIX', ARRAY['pricing/'], 1, NULL, NULL, 86400),
    ('PRICING', 'quote_policy', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['APPROVAL', 'PROHIBITION'], 1, NULL, NULL, NULL),
    ('PRICING', 'dynamic_quote_tool', 'TOOL', 'WARNING', 'HIGH', 'TOOL_AVAILABLE', ARRAY['quote.lookup'], 1, NULL, NULL, 300),
    ('APPOINTMENT_DISCOVERY', 'service_details', 'FACT', 'BLOCKER', 'MEDIUM', 'FACT_KEY_PREFIX', ARRAY['service/'], 1, NULL, NULL, 86400),
    ('APPOINTMENT_DISCOVERY', 'business_hours', 'FACT', 'BLOCKER', 'MEDIUM', 'FACT_KEY_PREFIX', ARRAY['location/'], 1, NULL, NULL, 86400),
    ('APPOINTMENT_DISCOVERY', 'booking_policy', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['APPROVAL', 'PROHIBITION'], 1, NULL, NULL, NULL),
    ('APPOINTMENT_DISCOVERY', 'calendar_connector', 'CONNECTOR', 'BLOCKER', 'HIGH', 'CONNECTOR_CONNECTED', ARRAY['calendar'], 1, NULL, NULL, 300),
    ('APPOINTMENT_DISCOVERY', 'availability_tool', 'TOOL', 'BLOCKER', 'HIGH', 'TOOL_AVAILABLE', ARRAY['calendar.availability'], 1, NULL, NULL, 300),
    ('APPOINTMENT_BOOKING', 'booking_constraints', 'FACT', 'BLOCKER', 'HIGH', 'FACT_KEY_PREFIX', ARRAY['booking/'], 1, NULL, NULL, 86400),
    ('APPOINTMENT_BOOKING', 'confirmation_rule', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['APPROVAL'], 1, NULL, NULL, NULL),
    ('APPOINTMENT_BOOKING', 'calendar_connector', 'CONNECTOR', 'BLOCKER', 'HIGH', 'CONNECTOR_CONNECTED', ARRAY['calendar'], 1, NULL, NULL, 300),
    ('APPOINTMENT_BOOKING', 'booking_tool', 'TOOL', 'BLOCKER', 'HIGH', 'TOOL_AVAILABLE', ARRAY['calendar.booking'], 1, NULL, NULL, 300),
    ('APPOINTMENT_BOOKING', 'booking_permission', 'PERMISSION', 'BLOCKER', 'HIGH', 'PERMISSION_GRANTED', ARRAY['calendar.write'], 1, NULL, NULL, NULL),
    ('APPOINTMENT_BOOKING', 'booking_safety_cases', 'EVALUATION_CASE', 'BLOCKER', 'HIGH', 'EVALUATION_CASE_PASS', ARRAY['appointment_booking', 'double_booking', 'confirmation'], NULL, 10000, 604800, 604800),
    ('ORDER_ACCOUNT_SUPPORT', 'support_policy', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['ESCALATION', 'PROHIBITION'], 1, NULL, NULL, NULL),
    ('ORDER_ACCOUNT_SUPPORT', 'account_lookup_tool', 'TOOL', 'BLOCKER', 'HIGH', 'TOOL_AVAILABLE', ARRAY['account.lookup', 'order.lookup'], 1, NULL, NULL, 300),
    ('ORDER_ACCOUNT_SUPPORT', 'customer_state_permission', 'PERMISSION', 'BLOCKER', 'HIGH', 'PERMISSION_GRANTED', ARRAY['customer_state.read'], 1, NULL, NULL, NULL),
    ('ORDER_ACCOUNT_SUPPORT', 'identity_verification_cases', 'EVALUATION_CASE', 'BLOCKER', 'HIGH', 'EVALUATION_CASE_PASS', ARRAY['identity_verification', 'data_disclosure'], NULL, 10000, 604800, 604800),
    ('COMMERCE_RECOMMENDATION', 'product_attributes', 'FACT', 'BLOCKER', 'MEDIUM', 'FACT_KEY_PREFIX', ARRAY['product/'], 1, NULL, NULL, 86400),
    ('COMMERCE_RECOMMENDATION', 'commerce_policies', 'RULE', 'BLOCKER', 'HIGH', 'RULE_TYPE_IN', ARRAY['APPROVAL', 'PROHIBITION'], 1, NULL, NULL, NULL),
    ('COMMERCE_RECOMMENDATION', 'inventory_tool', 'TOOL', 'WARNING', 'HIGH', 'TOOL_AVAILABLE', ARRAY['inventory.lookup'], 1, NULL, NULL, 300),
    ('COMMERCE_RECOMMENDATION', 'catalog_connector', 'CONNECTOR', 'WARNING', 'MEDIUM', 'CONNECTOR_CONNECTED', ARRAY['commerce_catalog'], 1, NULL, NULL, 3600),
    ('REGULATED_TOPIC', 'approved_wording', 'DOCUMENT_COVERAGE', 'BLOCKER', 'CRITICAL', 'DOCUMENT_COUNT', ARRAY['APPROVED', 'REGULATED'], 1, NULL, NULL, 86400),
    ('REGULATED_TOPIC', 'regulated_rules', 'RULE', 'BLOCKER', 'CRITICAL', 'RULE_TYPE_IN', ARRAY['PROHIBITION', 'ESCALATION'], 2, NULL, NULL, NULL),
    ('REGULATED_TOPIC', 'specialist_permission', 'PERMISSION', 'BLOCKER', 'CRITICAL', 'PERMISSION_GRANTED', ARRAY['regulated_specialist_handoff'], 1, NULL, NULL, NULL),
    ('REGULATED_TOPIC', 'regulated_safety_cases', 'EVALUATION_CASE', 'BLOCKER', 'CRITICAL', 'EVALUATION_CASE_PASS', ARRAY['regulated_refusal', 'mandatory_disclaimer', 'specialist_handoff'], NULL, 10000, 604800, 604800)
), predicates AS (
  SELECT
    requirement_templates.*,
    jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'operator', "operator",
      'values', to_jsonb("values"),
      'minimumCount', "minimumCount",
      'minimumCoverageBps', "minimumCoverageBps",
      'maxAgeSeconds', "maxAgeSeconds"
    )) AS "predicate"
  FROM requirement_templates
)
INSERT INTO "KnowledgeV2RequirementDefinition" (
  "id", "tenantId", "capabilityId", "requirementKey", "definitionVersion", "kind",
  "severity", "riskLevel", "active", "freshnessSlaSeconds", "satisfactionPredicate",
  "predicateVersion", "templateOrigin", "tenantOverride", "immutableHash"
)
SELECT
  'kvr_v1_' || md5(capability."id" || ':' || predicates."requirementKey" || ':1'),
  capability."tenantId",
  capability."id",
  predicates."requirementKey",
  1,
  predicates."kind"::"KnowledgeV2RequirementKind",
  predicates."severity"::"KnowledgeV2RequirementSeverity",
  predicates."riskLevel"::"KnowledgeV2RiskLevel",
  true,
  predicates."freshnessSlaSeconds",
  predicates."predicate",
  'knowledge-requirement-v1',
  'PLATFORM_V1',
  false,
  encode(sha256(convert_to(
    concat_ws('|', predicates."capabilityType", predicates."requirementKey", '1', predicates."kind",
      predicates."severity", predicates."riskLevel", predicates."predicate"::TEXT, 'PLATFORM_V1'),
    'UTF8'
  )), 'hex')
FROM "KnowledgeV2Capability" AS capability
INNER JOIN predicates
  ON predicates."capabilityType"::"KnowledgeV2CapabilityType" = capability."capabilityType"
WHERE capability."serverOwned" = true
  AND capability."templateVersion" = 1
  AND capability."targetKey" = 'workspace-v2';

UPDATE "KnowledgeV2PublicationValidation"
SET "capabilitySetHash" = NULL,
    "requirementEvaluationSetHash" = NULL
WHERE "corpusKind" = 'STRUCTURED_V2';

UPDATE "KnowledgePublication"
SET "capabilitySetHash" = NULL,
    "requirementEvaluationSetHash" = NULL
WHERE "corpusKind" = 'STRUCTURED_V2';

UPDATE "Conversation"
SET
  "aiEnabled" = false,
  "aiGeneration" = "aiGeneration" + 1,
  "aiReplySequence" = "aiReplySequence" + 1,
  "aiReplyFence" = "aiReplySequence" + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "AiReplyRun"
SET
  "status" = 'SUPERSEDED',
  "capabilitySetHash" = NULL,
  "errorCode" = 'CAPABILITY_SNAPSHOT_REQUIRED_BY_MIGRATION',
  "errorMessage" = NULL,
  "completedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'FAILED', 'CANCEL_REQUESTED');

UPDATE "RuntimeOutbox"
SET
  "status" = 'DEAD_LETTER',
  "lastErrorCode" = 'CAPABILITY_SNAPSHOT_REQUIRED_BY_MIGRATION',
  "lastErrorMessage" = NULL,
  "lockedAt" = NULL,
  "lockExpiresAt" = NULL,
  "lockedBy" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventType" = 'ai.reply.requested'
  AND "status" IN ('PENDING', 'PUBLISHING', 'FAILED');

COMMIT;
