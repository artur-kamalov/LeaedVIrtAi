CREATE TABLE "BusinessKnowledgeChunk" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "embeddingProvider" TEXT NOT NULL DEFAULT 'leadvirt-local-hash',
  "embeddingModel" TEXT NOT NULL DEFAULT 'hash-v1',
  "vectorPointId" TEXT,
  "metadata" JSONB,
  "embeddedAt" TIMESTAMP(3),
  "indexedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "BusinessKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessKnowledgeChunk_vectorPointId_key"
  ON "BusinessKnowledgeChunk"("vectorPointId");

CREATE UNIQUE INDEX "BusinessKnowledgeChunk_sourceId_chunkIndex_key"
  ON "BusinessKnowledgeChunk"("sourceId", "chunkIndex");

CREATE INDEX "BusinessKnowledgeChunk_tenantId_sourceId_idx"
  ON "BusinessKnowledgeChunk"("tenantId", "sourceId");

CREATE INDEX "BusinessKnowledgeChunk_tenantId_updatedAt_idx"
  ON "BusinessKnowledgeChunk"("tenantId", "updatedAt");

ALTER TABLE "BusinessKnowledgeChunk"
  ADD CONSTRAINT "BusinessKnowledgeChunk_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessKnowledgeChunk"
  ADD CONSTRAINT "BusinessKnowledgeChunk_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "BusinessKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
