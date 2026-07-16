ALTER TABLE "KnowledgeV2TestCaseVersion"
  ADD COLUMN "queryHashKeyId" TEXT,
  ADD COLUMN "queryHashVersion" TEXT;

ALTER TABLE "KnowledgeV2EvaluationRun"
  ADD COLUMN "queryHashKeyId" TEXT,
  ADD COLUMN "queryHashVersion" TEXT;

ALTER TABLE "KnowledgeV2RetrievalTrace"
  ADD COLUMN "queryHashKeyId" TEXT,
  ADD COLUMN "queryHashVersion" TEXT;

ALTER TABLE "KnowledgeV2LiveToolExecution"
  ADD COLUMN "queryHashKeyId" TEXT,
  ADD COLUMN "queryHashVersion" TEXT;

ALTER TABLE "KnowledgeV2TestCaseVersion"
  ADD CONSTRAINT "KnowledgeV2TestCaseVersion_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  );

ALTER TABLE "KnowledgeV2EvaluationRun"
  ADD CONSTRAINT "KnowledgeV2EvaluationRun_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHash" IS NOT NULL
      AND "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  );

ALTER TABLE "KnowledgeV2RetrievalTrace"
  ADD CONSTRAINT "KnowledgeV2RetrievalTrace_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  );

ALTER TABLE "KnowledgeV2LiveToolExecution"
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_query_hash_metadata_check" CHECK (
    ("queryHashKeyId" IS NULL AND "queryHashVersion" IS NULL)
    OR (
      "queryHashKeyId" IS NOT NULL
      AND "queryHashVersion" IS NOT NULL
      AND "queryHash" ~ '^[a-f0-9]{64}$'
      AND "queryHashKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND "queryHashVersion" = 'knowledge-query-hmac-sha256-v1'
    )
  );
