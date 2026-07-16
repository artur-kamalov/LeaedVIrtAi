DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KnowledgeV2IndexSnapshotItem" LIMIT 1) THEN
    RAISE EXCEPTION 'knowledge v2 snapshot point identity migration requires an empty KnowledgeV2IndexSnapshotItem table';
  END IF;
END
$$;

CREATE UNIQUE INDEX "KnowledgeV2Chunk_tenant_exact_content_key"
  ON "KnowledgeV2Chunk"("tenantId", "id", "contentHash");

DROP INDEX "KnowledgeV2IndexSnapshotItem_snapshot_vector_key";

CREATE UNIQUE INDEX "KnowledgeV2IndexSnapshotItem_vectorPointId_key"
  ON "KnowledgeV2IndexSnapshotItem"("vectorPointId");

ALTER TABLE "KnowledgeIndexSnapshot"
  ADD COLUMN "preparationStartedAt" TIMESTAMP(3);

ALTER TABLE "KnowledgeV2IndexSnapshotItem"
  ADD COLUMN "pointFingerprint" TEXT NOT NULL,
  DROP CONSTRAINT "KnowledgeV2IndexSnapshotItem_exact_chunk_fkey",
  DROP CONSTRAINT "KnowledgeV2IndexSnapshotItem_values_check",
  ADD CONSTRAINT "KnowledgeV2IndexSnapshotItem_values_check" CHECK (
    char_length("contentHash") > 0
    AND char_length("vectorPointId") > 0
    AND "pointFingerprint" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "KnowledgeV2IndexSnapshotItem_exact_chunk_fkey"
  FOREIGN KEY ("tenantId", "chunkId", "contentHash")
  REFERENCES "KnowledgeV2Chunk"("tenantId", "id", "contentHash")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD COLUMN "indexSnapshotId" TEXT;

CREATE INDEX "KnowledgeV2PublicationValidation_tenant_index_snapshot_idx"
  ON "KnowledgeV2PublicationValidation"("tenantId", "indexSnapshotId");

ALTER TABLE "KnowledgeV2PublicationValidation"
  ADD CONSTRAINT "KnowledgeV2PublicationValidation_tenant_snapshot_corpus_fkey"
  FOREIGN KEY ("tenantId", "indexSnapshotId", "corpusKind")
  REFERENCES "KnowledgeIndexSnapshot"("tenantId", "id", "corpusKind")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2EvaluationRun"
  ADD COLUMN "queryHash" TEXT,
  ADD COLUMN "restrictedInputRef" TEXT,
  DROP CONSTRAINT "KnowledgeV2EvaluationRun_values_check",
  ADD CONSTRAINT "KnowledgeV2EvaluationRun_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("runKey") > 0
    AND char_length("targetKey") > 0
    AND char_length("datasetVersion") > 0
    AND char_length("testCaseSetHash") > 0
    AND char_length("configHash") > 0
    AND char_length("retrievalPolicyVersion") > 0
    AND char_length("promptPolicyVersion") > 0
    AND char_length("graphVersion") > 0
    AND char_length("codeCommit") > 0
    AND char_length("environment") > 0
    AND ("restrictedConfigRef" IS NULL OR char_length("restrictedConfigRef") > 0)
    AND (
      ("queryHash" IS NULL AND "restrictedInputRef" IS NULL)
      OR ("queryHash" IS NOT NULL AND char_length("queryHash") > 0 AND "restrictedInputRef" IS NOT NULL AND char_length("restrictedInputRef") > 0)
    )
    AND (
      ("snapshotKind" = 'PUBLICATION' AND "publicationId" IS NOT NULL AND "candidateId" IS NULL AND "candidateVersion" IS NULL AND "candidateManifestHash" IS NULL)
      OR ("snapshotKind" = 'DRAFT_CANDIDATE' AND "publicationId" IS NULL AND "candidateId" IS NOT NULL AND char_length("candidateId") > 0 AND "candidateVersion" > 0 AND "candidateManifestHash" IS NOT NULL AND char_length("candidateManifestHash") > 0)
    )
    AND (
      ("status" = 'QUEUED' AND "startedAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
      OR ("status" = 'RUNNING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
      OR ("status" IN ('SUCCEEDED', 'FAILED') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
      OR ("status" = 'CANCELLED' AND "completedAt" IS NULL AND "cancelledAt" IS NOT NULL)
    )
  );

ALTER TABLE "KnowledgeV2EvaluationResult"
  DROP CONSTRAINT "KnowledgeV2EvaluationResult_tenantId_testCaseVersionId_cor_fkey",
  DROP CONSTRAINT "KnowledgeV2EvaluationResult_values_check",
  ALTER COLUMN "testCaseVersionId" DROP NOT NULL,
  ALTER COLUMN "expectedBehavior" DROP NOT NULL,
  ADD CONSTRAINT "KnowledgeV2EvaluationResult_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("resultKey") > 0
    AND "repeatIndex" >= 0
    AND char_length("metricManifestHash") > 0
    AND char_length("evidenceManifestHash") > 0
    AND (("testCaseVersionId" IS NULL AND "expectedBehavior" IS NULL) OR ("testCaseVersionId" IS NOT NULL AND "expectedBehavior" IS NOT NULL))
    AND ("status" IN ('ERROR', 'SKIPPED') OR "observedBehavior" IS NOT NULL)
    AND ("status" <> 'ERROR' OR "errorCode" IS NOT NULL)
    AND ("restrictedResultRef" IS NULL OR (char_length("restrictedResultRef") > 0 AND "responseHash" IS NOT NULL))
    AND ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("costMicros" IS NULL OR "costMicros" >= 0)
  ),
  ADD CONSTRAINT "KnowledgeV2EvaluationResult_tenantId_testCaseVersionId_cor_fkey"
  FOREIGN KEY ("tenantId", "testCaseVersionId", "corpusKind")
  REFERENCES "KnowledgeV2TestCaseVersion"("tenantId", "id", "corpusKind")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
