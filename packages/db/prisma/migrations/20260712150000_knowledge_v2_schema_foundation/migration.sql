BEGIN;

CREATE TYPE "KnowledgeCorpusKind" AS ENUM ('LEGACY_V1', 'STRUCTURED_V2');
CREATE TYPE "KnowledgeV2AutoPublishPolicy" AS ENUM ('OFF', 'TRUSTED_LOW_RISK', 'SCHEDULED');
CREATE TYPE "KnowledgeV2ApprovalPolicy" AS ENUM ('OWNER_ONLY', 'OWNER_OR_ADMIN');
CREATE TYPE "KnowledgeV2RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "KnowledgeV2LifecycleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "KnowledgeV2VerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'CONFLICTED'
);
CREATE TYPE "KnowledgeV2FactAuthority" AS ENUM (
  'INFERRED',
  'IMPORTED',
  'MANUAL',
  'TRUSTED_SOURCE',
  'OWNER_VERIFIED'
);
CREATE TYPE "KnowledgeV2LocaleBehavior" AS ENUM (
  'LANGUAGE_NEUTRAL',
  'LOCALIZED',
  'LOCALE_SPECIFIC'
);
CREATE TYPE "KnowledgeV2GuidanceReviewStatus" AS ENUM (
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'DISABLED'
);
CREATE TYPE "KnowledgeV2GuidanceRuleType" AS ENUM (
  'RESPONSE',
  'PROHIBITION',
  'ESCALATION',
  'APPROVAL',
  'TOOL_USE',
  'STYLE'
);
CREATE TYPE "KnowledgeV2EvidenceKind" AS ENUM (
  'MANUAL',
  'LEGACY_REVISION',
  'EXTERNAL_REFERENCE'
);
CREATE TYPE "KnowledgeV2IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'FAILED');
CREATE TYPE "KnowledgeV2ValidationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'EXPIRED');

ALTER TABLE "KnowledgePublication"
  DROP CONSTRAINT "KnowledgePublication_basePublicationId_fkey",
  ADD COLUMN "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'LEGACY_V1';

ALTER TABLE "KnowledgePublicationItem"
  DROP CONSTRAINT "KnowledgePublicationItem_tenant_publication_fkey",
  DROP CONSTRAINT "KnowledgePublicationItem_legacyRevision_check",
  ADD COLUMN "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'LEGACY_V1',
  ADD COLUMN "itemVersionHash" TEXT,
  ADD COLUMN "factVersionId" TEXT,
  ADD COLUMN "guidanceRuleVersionId" TEXT;

CREATE TABLE "KnowledgeV2Settings" (
  "tenantId" TEXT NOT NULL,
  "defaultLocale" TEXT NOT NULL DEFAULT 'en',
  "supportedLocales" TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
  "autoPublishPolicy" "KnowledgeV2AutoPublishPolicy" NOT NULL DEFAULT 'OFF',
  "publicationApprovalPolicy" "KnowledgeV2ApprovalPolicy" NOT NULL DEFAULT 'OWNER_OR_ADMIN',
  "publicationSchedule" JSONB,
  "retentionPolicyId" TEXT,
  "embeddingRegion" TEXT,
  "modelRegion" TEXT,
  "maxSourceBytes" BIGINT NOT NULL DEFAULT 10485760,
  "maxDocuments" INTEGER NOT NULL DEFAULT 1000,
  "crawlLimits" JSONB,
  "draftGeneration" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeV2Settings_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "KnowledgeV2Settings_values_check" CHECK (
    char_length("defaultLocale") > 0
    AND cardinality("supportedLocales") > 0
    AND "defaultLocale" = ANY ("supportedLocales")
    AND "maxSourceBytes" > 0
    AND "maxDocuments" > 0
    AND "draftGeneration" > 0
    AND "etag" > 0
  )
);

CREATE TABLE "KnowledgeV2Entity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityKey" TEXT NOT NULL,
  "displayName" TEXT,
  "defaultLocale" TEXT NOT NULL DEFAULT 'en',
  "metadata" JSONB,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2Entity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Entity_values_check" CHECK (
    char_length("entityType") > 0
    AND char_length("entityKey") > 0
    AND char_length("defaultLocale") > 0
    AND "generation" > 0
    AND "etag" > 0
  )
);

CREATE TABLE "KnowledgeV2Fact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityId" TEXT,
  "entityType" TEXT NOT NULL,
  "factKey" TEXT NOT NULL,
  "fieldType" TEXT NOT NULL,
  "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2Fact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Fact_values_check" CHECK (
    char_length("entityType") > 0
    AND char_length("factKey") > 0
    AND char_length("fieldType") > 0
    AND "latestVersionNumber" >= 0
    AND "generation" > 0
    AND "etag" > 0
  )
);

CREATE TABLE "KnowledgeV2FactVersion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "normalizedValue" JSONB NOT NULL,
  "displayValue" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "localizedValues" JSONB,
  "unit" TEXT,
  "currency" TEXT,
  "timeZone" TEXT,
  "scope" JSONB,
  "localeBehavior" "KnowledgeV2LocaleBehavior" NOT NULL DEFAULT 'LANGUAGE_NEUTRAL',
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "riskLevel" "KnowledgeV2RiskLevel" NOT NULL DEFAULT 'LOW',
  "authority" "KnowledgeV2FactAuthority" NOT NULL DEFAULT 'MANUAL',
  "lifecycleStatus" "KnowledgeV2LifecycleStatus" NOT NULL DEFAULT 'DRAFT',
  "verificationStatus" "KnowledgeV2VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "extractionConfidence" DOUBLE PRECISION,
  "extractionModelVersion" TEXT,
  "changeReason" TEXT,
  "supersedesVersionId" TEXT,
  "immutableHash" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "verifiedByUserId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2FactVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2FactVersion_values_check" CHECK (
    "versionNumber" > 0
    AND char_length("locale") > 0
    AND char_length("immutableHash") > 0
    AND ("effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND ("extractionConfidence" IS NULL OR ("extractionConfidence" >= 0 AND "extractionConfidence" <= 1))
    AND ("supersedesVersionId" IS NULL OR "supersedesVersionId" <> "id")
    AND ("verificationStatus" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL)
    AND ("verificationStatus" <> 'REJECTED' OR "rejectedAt" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeV2GuidanceRule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "ruleType" "KnowledgeV2GuidanceRuleType" NOT NULL,
  "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "etag" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2GuidanceRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2GuidanceRule_values_check" CHECK (
    char_length("ruleKey") > 0
    AND char_length("title") > 0
    AND "latestVersionNumber" >= 0
    AND "generation" > 0
    AND "etag" > 0
  )
);

CREATE TABLE "KnowledgeV2GuidanceRuleVersion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "guidanceRuleId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "ruleType" "KnowledgeV2GuidanceRuleType" NOT NULL,
  "conditionAst" JSONB NOT NULL,
  "instruction" TEXT NOT NULL,
  "outcome" JSONB,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "tieBreakPolicy" TEXT NOT NULL DEFAULT 'stable_rule_key',
  "tieBreakKey" TEXT NOT NULL,
  "scope" JSONB,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "riskLevel" "KnowledgeV2RiskLevel" NOT NULL DEFAULT 'LOW',
  "requiredApproverRole" "MembershipRole",
  "examples" JSONB,
  "reviewStatus" "KnowledgeV2GuidanceReviewStatus" NOT NULL DEFAULT 'DRAFT',
  "changeReason" TEXT,
  "supersedesVersionId" TEXT,
  "immutableHash" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2GuidanceRuleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2GuidanceRuleVersion_values_check" CHECK (
    "versionNumber" > 0
    AND char_length("title") > 0
    AND char_length("instruction") > 0
    AND char_length("tieBreakKey") > 0
    AND char_length("immutableHash") > 0
    AND ("effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND ("supersedesVersionId" IS NULL OR "supersedesVersionId" <> "id")
    AND ("reviewStatus" <> 'APPROVED' OR "approvedAt" IS NOT NULL)
    AND ("reviewStatus" <> 'REJECTED' OR "rejectedAt" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeV2Evidence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" "KnowledgeV2EvidenceKind" NOT NULL,
  "factVersionId" TEXT,
  "guidanceRuleVersionId" TEXT,
  "legacyRevisionId" TEXT,
  "label" TEXT NOT NULL,
  "locator" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "sourceReference" JSONB,
  "elementReference" JSONB,
  "quoteHash" TEXT,
  "confidence" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2Evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2Evidence_target_check" CHECK (
    (("factVersionId" IS NOT NULL)::INTEGER + ("guidanceRuleVersionId" IS NOT NULL)::INTEGER) = 1
  ),
  CONSTRAINT "KnowledgeV2Evidence_provenance_check" CHECK (
    (
      "kind" = 'LEGACY_REVISION'
      AND "legacyRevisionId" IS NOT NULL
    )
    OR (
      "kind" <> 'LEGACY_REVISION'
      AND "legacyRevisionId" IS NULL
      AND ("kind" <> 'EXTERNAL_REFERENCE' OR "sourceReference" IS NOT NULL)
    )
  ),
  CONSTRAINT "KnowledgeV2Evidence_values_check" CHECK (
    char_length("label") > 0
    AND ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
  )
);

CREATE TABLE "KnowledgeV2IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "KnowledgeV2IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "httpStatus" INTEGER,
  "responseRef" TEXT,
  "responseBody" JSONB,
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeV2IdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2IdempotencyRecord_values_check" CHECK (
    char_length("endpoint") > 0
    AND char_length("key") > 0
    AND char_length("requestHash") > 0
    AND "expiresAt" > "createdAt"
    AND ("httpStatus" IS NULL OR ("httpStatus" >= 100 AND "httpStatus" <= 599))
    AND (
      ("status" = 'IN_PROGRESS' AND "completedAt" IS NULL)
      OR (
        "status" <> 'IN_PROGRESS'
        AND "completedAt" IS NOT NULL
        AND "httpStatus" IS NOT NULL
      )
    )
  )
);

CREATE TABLE "KnowledgeV2PublicationValidation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL DEFAULT 'workspace-v2',
  "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
  "candidateId" TEXT NOT NULL,
  "candidateVersion" INTEGER NOT NULL,
  "candidateManifestHash" TEXT NOT NULL,
  "basePublicationId" TEXT,
  "publicationId" TEXT,
  "candidateItems" JSONB NOT NULL,
  "status" "KnowledgeV2ValidationStatus" NOT NULL DEFAULT 'PENDING',
  "blockers" JSONB,
  "warnings" JSONB,
  "validationPolicyVersion" TEXT NOT NULL DEFAULT 'knowledge-v2',
  "validatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedAt" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),

  CONSTRAINT "KnowledgeV2PublicationValidation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2PublicationValidation_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("targetKey") > 0
    AND char_length("candidateId") > 0
    AND "candidateVersion" > 0
    AND char_length("candidateManifestHash") > 0
    AND char_length("validationPolicyVersion") > 0
    AND ("validUntil" IS NULL OR "validUntil" > "createdAt")
    AND (
      ("status" = 'PENDING' AND "evaluatedAt" IS NULL)
      OR ("status" <> 'PENDING' AND "evaluatedAt" IS NOT NULL)
    )
    AND ("publicationId" IS NULL OR "status" = 'PASSED')
  )
);

CREATE INDEX "KnowledgeV2Entity_tenantId_entityType_updatedAt_idx"
  ON "KnowledgeV2Entity"("tenantId", "entityType", "updatedAt");
CREATE UNIQUE INDEX "KnowledgeV2Entity_tenantId_entityType_entityKey_key"
  ON "KnowledgeV2Entity"("tenantId", "entityType", "entityKey");
CREATE UNIQUE INDEX "KnowledgeV2Entity_tenantId_id_key"
  ON "KnowledgeV2Entity"("tenantId", "id");

CREATE INDEX "KnowledgeV2Fact_tenantId_entityId_fieldType_idx"
  ON "KnowledgeV2Fact"("tenantId", "entityId", "fieldType");
CREATE INDEX "KnowledgeV2Fact_tenantId_updatedAt_idx"
  ON "KnowledgeV2Fact"("tenantId", "updatedAt");
CREATE UNIQUE INDEX "KnowledgeV2Fact_tenantId_factKey_key"
  ON "KnowledgeV2Fact"("tenantId", "factKey");
CREATE UNIQUE INDEX "KnowledgeV2Fact_tenantId_id_key"
  ON "KnowledgeV2Fact"("tenantId", "id");

CREATE INDEX "KnowledgeV2FactVersion_tenantId_factId_verificationStatus_idx"
  ON "KnowledgeV2FactVersion"("tenantId", "factId", "verificationStatus");
CREATE INDEX "KnowledgeV2FactVersion_tenantId_effectiveFrom_effectiveUnti_idx"
  ON "KnowledgeV2FactVersion"("tenantId", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "KnowledgeV2FactVersion_factId_versionNumber_key"
  ON "KnowledgeV2FactVersion"("factId", "versionNumber");
CREATE UNIQUE INDEX "KnowledgeV2FactVersion_factId_immutableHash_key"
  ON "KnowledgeV2FactVersion"("factId", "immutableHash");
CREATE UNIQUE INDEX "KnowledgeV2FactVersion_tenantId_id_key"
  ON "KnowledgeV2FactVersion"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2FactVersion_tenantId_id_immutableHash_key"
  ON "KnowledgeV2FactVersion"("tenantId", "id", "immutableHash");

CREATE INDEX "KnowledgeV2GuidanceRule_tenantId_ruleType_updatedAt_idx"
  ON "KnowledgeV2GuidanceRule"("tenantId", "ruleType", "updatedAt");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRule_tenantId_ruleKey_key"
  ON "KnowledgeV2GuidanceRule"("tenantId", "ruleKey");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRule_tenantId_id_key"
  ON "KnowledgeV2GuidanceRule"("tenantId", "id");

CREATE INDEX "KnowledgeV2GuidanceRuleVersion_tenantId_guidanceRuleId_revi_idx"
  ON "KnowledgeV2GuidanceRuleVersion"("tenantId", "guidanceRuleId", "reviewStatus");
CREATE INDEX "KnowledgeV2GuidanceRuleVersion_tenantId_effectiveFrom_effec_idx"
  ON "KnowledgeV2GuidanceRuleVersion"("tenantId", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRuleVersion_guidanceRuleId_versionNumber_key"
  ON "KnowledgeV2GuidanceRuleVersion"("guidanceRuleId", "versionNumber");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRuleVersion_guidanceRuleId_immutableHash_key"
  ON "KnowledgeV2GuidanceRuleVersion"("guidanceRuleId", "immutableHash");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRuleVersion_tenantId_id_key"
  ON "KnowledgeV2GuidanceRuleVersion"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2GuidanceRuleVersion_tenantId_id_immutableHash_key"
  ON "KnowledgeV2GuidanceRuleVersion"("tenantId", "id", "immutableHash");

CREATE INDEX "KnowledgeV2Evidence_tenantId_factVersionId_idx"
  ON "KnowledgeV2Evidence"("tenantId", "factVersionId");
CREATE INDEX "KnowledgeV2Evidence_tenantId_guidanceRuleVersionId_idx"
  ON "KnowledgeV2Evidence"("tenantId", "guidanceRuleVersionId");
CREATE INDEX "KnowledgeV2Evidence_tenantId_legacyRevisionId_idx"
  ON "KnowledgeV2Evidence"("tenantId", "legacyRevisionId");
CREATE UNIQUE INDEX "KnowledgeV2Evidence_tenantId_id_key"
  ON "KnowledgeV2Evidence"("tenantId", "id");

CREATE INDEX "KnowledgeV2IdempotencyRecord_status_expiresAt_idx"
  ON "KnowledgeV2IdempotencyRecord"("status", "expiresAt");
CREATE INDEX "KnowledgeV2IdempotencyRecord_tenantId_createdAt_idx"
  ON "KnowledgeV2IdempotencyRecord"("tenantId", "createdAt");
CREATE UNIQUE INDEX "KnowledgeV2IdempotencyRecord_tenantId_endpoint_key_key"
  ON "KnowledgeV2IdempotencyRecord"("tenantId", "endpoint", "key");
CREATE UNIQUE INDEX "KnowledgeV2IdempotencyRecord_tenantId_id_key"
  ON "KnowledgeV2IdempotencyRecord"("tenantId", "id");

CREATE INDEX "KnowledgeV2PublicationValidation_tenantId_targetKey_status__idx"
  ON "KnowledgeV2PublicationValidation"("tenantId", "targetKey", "status", "createdAt");
CREATE INDEX "KnowledgeV2PublicationValidation_tenantId_basePublicationId_idx"
  ON "KnowledgeV2PublicationValidation"("tenantId", "basePublicationId");
CREATE INDEX "KnowledgeV2PublicationValidation_status_validUntil_idx"
  ON "KnowledgeV2PublicationValidation"("status", "validUntil");
CREATE UNIQUE INDEX "KnowledgeV2PublicationValidation_tenantId_id_key"
  ON "KnowledgeV2PublicationValidation"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2PublicationValidation_tenantId_publicationId_cor_key"
  ON "KnowledgeV2PublicationValidation"("tenantId", "publicationId", "corpusKind");
CREATE UNIQUE INDEX "KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key"
  ON "KnowledgeV2PublicationValidation"(
    "tenantId",
    "candidateId",
    "candidateVersion",
    "validationPolicyVersion"
  );

CREATE UNIQUE INDEX "KnowledgePublication_tenantId_id_corpusKind_key"
  ON "KnowledgePublication"("tenantId", "id", "corpusKind");
CREATE INDEX "KnowledgePublicationItem_tenantId_factVersionId_idx"
  ON "KnowledgePublicationItem"("tenantId", "factVersionId");
CREATE INDEX "KnowledgePublicationItem_tenantId_guidanceRuleVersionId_idx"
  ON "KnowledgePublicationItem"("tenantId", "guidanceRuleVersionId");

ALTER TABLE "KnowledgeV2Settings"
  ADD CONSTRAINT "KnowledgeV2Settings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Entity"
  ADD CONSTRAINT "KnowledgeV2Entity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Fact"
  ADD CONSTRAINT "KnowledgeV2Fact_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Fact"
  ADD CONSTRAINT "KnowledgeV2Fact_tenantId_entityId_fkey"
  FOREIGN KEY ("tenantId", "entityId")
  REFERENCES "KnowledgeV2Entity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2FactVersion"
  ADD CONSTRAINT "KnowledgeV2FactVersion_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2FactVersion"
  ADD CONSTRAINT "KnowledgeV2FactVersion_tenantId_factId_fkey"
  FOREIGN KEY ("tenantId", "factId")
  REFERENCES "KnowledgeV2Fact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2FactVersion"
  ADD CONSTRAINT "KnowledgeV2FactVersion_tenantId_supersedesVersionId_fkey"
  FOREIGN KEY ("tenantId", "supersedesVersionId")
  REFERENCES "KnowledgeV2FactVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2GuidanceRule"
  ADD CONSTRAINT "KnowledgeV2GuidanceRule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  ADD CONSTRAINT "KnowledgeV2GuidanceRuleVersion_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  ADD CONSTRAINT "KnowledgeV2GuidanceRuleVersion_tenantId_guidanceRuleId_fkey"
  FOREIGN KEY ("tenantId", "guidanceRuleId")
  REFERENCES "KnowledgeV2GuidanceRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2GuidanceRuleVersion"
  ADD CONSTRAINT "KnowledgeV2GuidanceRuleVersion_tenantId_supersedesVersionI_fkey"
  FOREIGN KEY ("tenantId", "supersedesVersionId")
  REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Evidence"
  ADD CONSTRAINT "KnowledgeV2Evidence_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Evidence"
  ADD CONSTRAINT "KnowledgeV2Evidence_tenantId_factVersionId_fkey"
  FOREIGN KEY ("tenantId", "factVersionId")
  REFERENCES "KnowledgeV2FactVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Evidence"
  ADD CONSTRAINT "KnowledgeV2Evidence_tenantId_guidanceRuleVersionId_fkey"
  FOREIGN KEY ("tenantId", "guidanceRuleVersionId")
  REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2Evidence"
  ADD CONSTRAINT "KnowledgeV2Evidence_tenantId_legacyRevisionId_fkey"
  FOREIGN KEY ("tenantId", "legacyRevisionId")
  REFERENCES "KnowledgeRevision"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2IdempotencyRecord"
  ADD CONSTRAINT "KnowledgeV2IdempotencyRecord_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_tenantId_basePublicationI_fkey"
  FOREIGN KEY ("tenantId", "basePublicationId", "corpusKind")
  REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_tenantId_publicationId_co_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "corpusKind")
  REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_tenantId_basePublicationId_corpusKind_fkey"
  FOREIGN KEY ("tenantId", "basePublicationId", "corpusKind")
  REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenantId_publicationId_corpusKind_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "corpusKind")
  REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenantId_factVersionId_itemVersio_fkey"
  FOREIGN KEY ("tenantId", "factVersionId", "itemVersionHash")
  REFERENCES "KnowledgeV2FactVersion"("tenantId", "id", "immutableHash")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_tenantId_guidanceRuleVersionId_it_fkey"
  FOREIGN KEY ("tenantId", "guidanceRuleVersionId", "itemVersionHash")
  REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "id", "immutableHash")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgePublication"
  ADD CONSTRAINT "KnowledgePublication_structuredIndex_check" CHECK (
    "corpusKind" <> 'STRUCTURED_V2' OR "indexSnapshotId" IS NULL
  );

ALTER TABLE "KnowledgePublicationItem"
  ADD CONSTRAINT "KnowledgePublicationItem_typedItem_check" CHECK (
    (
      "corpusKind" = 'LEGACY_V1'
      AND "itemType" = 'LEGACY_REVISION'
      AND "revisionId" IS NOT NULL
      AND "itemId" = "revisionId"
      AND "itemVersionHash" IS NULL
      AND "factVersionId" IS NULL
      AND "guidanceRuleVersionId" IS NULL
    )
    OR (
      "corpusKind" = 'STRUCTURED_V2'
      AND "revisionId" IS NULL
      AND (
        (
          "itemType" = 'FACT_VERSION'
          AND "factVersionId" IS NOT NULL
          AND "itemId" = "factVersionId"
          AND "itemVersionHash" IS NOT NULL
          AND "guidanceRuleVersionId" IS NULL
        )
        OR (
          "itemType" = 'GUIDANCE_RULE_VERSION'
          AND "guidanceRuleVersionId" IS NOT NULL
          AND "itemId" = "guidanceRuleVersionId"
          AND "itemVersionHash" IS NOT NULL
          AND "factVersionId" IS NULL
        )
        OR (
          "itemType" = 'SOURCE_PERMISSION_SNAPSHOT'
          AND "itemVersionHash" IS NOT NULL
          AND "authorizationFingerprint" IS NOT NULL
          AND "factVersionId" IS NULL
          AND "guidanceRuleVersionId" IS NULL
        )
      )
    )
  );

CREATE FUNCTION "KnowledgeV2_reject_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'knowledge version % is immutable', OLD."id" USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'knowledge version % cannot be deleted directly', OLD."id" USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$knowledge_v2$;

CREATE TRIGGER "KnowledgeV2FactVersion_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2FactVersion"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_version_mutation"();
CREATE TRIGGER "KnowledgeV2GuidanceRuleVersion_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeV2GuidanceRuleVersion"
  FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_version_mutation"();

COMMIT;
