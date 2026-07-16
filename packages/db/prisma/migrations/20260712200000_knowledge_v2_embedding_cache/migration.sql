ALTER TABLE "KnowledgeIndexSnapshot"
  ADD COLUMN "indexSchema" JSONB,
  ADD COLUMN "indexSchemaHash" TEXT;

ALTER TABLE "KnowledgeV2Settings"
  ADD COLUMN "embeddingProviderPolicy" JSONB,
  ADD COLUMN "retrievalProcessorPolicy" JSONB;

ALTER TABLE "KnowledgeV2EvaluationRun"
  ADD COLUMN "retrievalProcessorPolicyHash" TEXT;

ALTER TABLE "KnowledgeV2RetrievalTrace"
  ADD COLUMN "retrievalProcessorPolicyHash" TEXT;

CREATE TABLE "KnowledgeV2EmbeddingCache" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "schemaFingerprint" TEXT NOT NULL,
  "objectStorageKey" TEXT NOT NULL,
  "encryptionKeyRef" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "denseDimensions" INTEGER NOT NULL,
  "denseProvider" TEXT NOT NULL,
  "denseModel" TEXT NOT NULL,
  "denseSchemaVersion" TEXT NOT NULL,
  "sparseProvider" TEXT NOT NULL,
  "sparseModel" TEXT NOT NULL,
  "sparseSchemaVersion" TEXT NOT NULL,
  "providerRegion" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeV2EmbeddingCache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2EmbeddingCache_values_check" CHECK (
    "contentHash" ~ '^[a-f0-9]{64}$'
    AND "schemaFingerprint" ~ '^[a-f0-9]{64}$'
    AND "payloadHash" ~ '^[a-f0-9]{64}$'
    AND char_length("objectStorageKey") > 0
    AND char_length("encryptionKeyRef") > 0
    AND "denseDimensions" > 0
    AND char_length("denseProvider") > 0
    AND char_length("denseModel") > 0
    AND char_length("denseSchemaVersion") > 0
    AND char_length("sparseProvider") > 0
    AND char_length("sparseModel") > 0
    AND char_length("sparseSchemaVersion") > 0
    AND char_length("providerRegion") > 0
    AND "expiresAt" > "createdAt"
  )
);

CREATE UNIQUE INDEX "KnowledgeV2EmbeddingCache_tenant_content_schema_key"
  ON "KnowledgeV2EmbeddingCache"("tenantId", "contentHash", "schemaFingerprint");
CREATE UNIQUE INDEX "KnowledgeV2EmbeddingCache_tenant_id_key"
  ON "KnowledgeV2EmbeddingCache"("tenantId", "id");
CREATE INDEX "KnowledgeV2EmbeddingCache_tenant_expiry_idx"
  ON "KnowledgeV2EmbeddingCache"("tenantId", "expiresAt", "deletedAt");
CREATE INDEX "KnowledgeV2EmbeddingCache_expiry_idx"
  ON "KnowledgeV2EmbeddingCache"("expiresAt", "deletedAt");

ALTER TABLE "KnowledgeV2EmbeddingCache"
  ADD CONSTRAINT "KnowledgeV2EmbeddingCache_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
