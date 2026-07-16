ALTER TABLE "KnowledgeV2EvaluationResult"
  ADD COLUMN IF NOT EXISTS "restrictedResultHash" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'KnowledgeV2EvaluationResult_restrictedResult_pair_check'
  ) THEN
    ALTER TABLE "KnowledgeV2EvaluationResult"
      ADD CONSTRAINT "KnowledgeV2EvaluationResult_restrictedResult_pair_check"
      CHECK (
        ("restrictedResultRef" IS NULL AND "restrictedResultHash" IS NULL)
        OR (
          "restrictedResultRef" IS NOT NULL
          AND char_length("restrictedResultRef") > 0
          AND "restrictedResultHash" ~ '^[a-f0-9]{64}$'
        )
      );
  END IF;
END $$;
