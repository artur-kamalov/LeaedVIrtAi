CREATE TYPE "KnowledgeV2FileUploadStatus" AS ENUM (
  'PENDING',
  'UPLOADING',
  'UPLOADED',
  'FINALIZING',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'REVOKED'
);

CREATE TABLE "KnowledgeV2FileUploadIntent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT,
  "artifactId" TEXT,
  "knowledgeJobId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" "KnowledgeV2FileUploadStatus" NOT NULL DEFAULT 'PENDING',
  "displayName" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "expectedByteSize" BIGINT NOT NULL,
  "defaultScope" JSONB,
  "defaultClassification" "KnowledgeV2SecurityClassification" NOT NULL,
  "defaultLocale" TEXT NOT NULL DEFAULT 'en',
  "stagingObjectKey" TEXT,
  "stagingEncryptionKeyRef" TEXT,
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "uploadedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeV2FileUploadIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2FileUploadIntent_size_check" CHECK (
    "expectedByteSize" BETWEEN 1 AND 10485760
  ),
  CONSTRAINT "KnowledgeV2FileUploadIntent_storage_check" CHECK (
    ("status" IN ('PENDING', 'UPLOADING', 'EXPIRED', 'REVOKED') AND "stagingObjectKey" IS NULL)
    OR
    ("status" IN ('UPLOADED', 'FINALIZING') AND "stagingObjectKey" IS NOT NULL AND "stagingEncryptionKeyRef" IS NOT NULL)
    OR
    ("status" = 'COMPLETED' AND (("stagingObjectKey" IS NULL AND "stagingEncryptionKeyRef" IS NULL) OR ("stagingObjectKey" IS NOT NULL AND "stagingEncryptionKeyRef" IS NOT NULL)))
    OR
    ("status" = 'REJECTED' AND "stagingObjectKey" IS NULL AND "stagingEncryptionKeyRef" IS NULL)
  ),
  CONSTRAINT "KnowledgeV2FileUploadIntent_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "sourceId" IS NOT NULL AND "artifactId" IS NOT NULL AND "knowledgeJobId" IS NOT NULL AND "finalizedAt" IS NOT NULL)
    OR
    ("status" <> 'COMPLETED' AND "sourceId" IS NULL AND "artifactId" IS NULL AND "knowledgeJobId" IS NULL AND "finalizedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "KnowledgeV2FileUploadIntent_tokenHash_key"
  ON "KnowledgeV2FileUploadIntent"("tokenHash");
CREATE UNIQUE INDEX "KnowledgeV2FileUploadIntent_stagingObjectKey_key"
  ON "KnowledgeV2FileUploadIntent"("stagingObjectKey");
CREATE UNIQUE INDEX "KnowledgeV2FileUploadIntent_tenantId_id_key"
  ON "KnowledgeV2FileUploadIntent"("tenantId", "id");
CREATE INDEX "KnowledgeV2FileUploadIntent_tenant_status_expiry_idx"
  ON "KnowledgeV2FileUploadIntent"("tenantId", "status", "expiresAt");
CREATE INDEX "KnowledgeV2FileUploadIntent_tenant_source_idx"
  ON "KnowledgeV2FileUploadIntent"("tenantId", "sourceId");

ALTER TABLE "KnowledgeV2FileUploadIntent"
  ADD CONSTRAINT "KnowledgeV2FileUploadIntent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeV2FileUploadIntent"
  ADD CONSTRAINT "KnowledgeV2FileUploadIntent_tenant_source_fkey"
  FOREIGN KEY ("tenantId", "sourceId") REFERENCES "KnowledgeV2Source"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "KnowledgeV2FileUploadIntent"
  ADD CONSTRAINT "KnowledgeV2FileUploadIntent_tenant_source_artifact_fkey"
  FOREIGN KEY ("tenantId", "sourceId", "artifactId")
  REFERENCES "KnowledgeV2Artifact"("tenantId", "sourceId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "KnowledgeV2FileUploadIntent"
  ADD CONSTRAINT "KnowledgeV2FileUploadIntent_tenant_job_fkey"
  FOREIGN KEY ("tenantId", "knowledgeJobId") REFERENCES "KnowledgeJob"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "KnowledgeV2FileUploadIntent"
  ADD CONSTRAINT "KnowledgeV2FileUploadIntent_creator_membership_fkey"
  FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
