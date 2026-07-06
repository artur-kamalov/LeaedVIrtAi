CREATE TYPE "BusinessKnowledgeSourceType" AS ENUM (
  'BUSINESS_PROFILE',
  'CATALOG',
  'AVAILABILITY',
  'FAQ',
  'POLICY',
  'ESCALATION'
);

CREATE TYPE "BusinessKnowledgeSourceStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
);

CREATE TABLE "BusinessKnowledgeSource" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "BusinessKnowledgeSourceType" NOT NULL,
  "status" "BusinessKnowledgeSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "sourceKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "structuredData" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "BusinessKnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessKnowledgeSource_tenantId_sourceKey_key"
  ON "BusinessKnowledgeSource"("tenantId", "sourceKey");

CREATE INDEX "BusinessKnowledgeSource_tenantId_type_status_idx"
  ON "BusinessKnowledgeSource"("tenantId", "type", "status");

CREATE INDEX "BusinessKnowledgeSource_tenantId_updatedAt_idx"
  ON "BusinessKnowledgeSource"("tenantId", "updatedAt");

ALTER TABLE "BusinessKnowledgeSource"
  ADD CONSTRAINT "BusinessKnowledgeSource_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
