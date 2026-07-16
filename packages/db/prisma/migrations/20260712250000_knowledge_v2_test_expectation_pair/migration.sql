DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'KnowledgeV2EvaluationResult_test_expectation_pair_check'
  ) THEN
    ALTER TABLE "KnowledgeV2EvaluationResult"
      ADD CONSTRAINT "KnowledgeV2EvaluationResult_test_expectation_pair_check"
      CHECK (
        ("testCaseVersionId" IS NULL AND "expectedBehavior" IS NULL)
        OR ("testCaseVersionId" IS NOT NULL AND "expectedBehavior" IS NOT NULL)
      );
  END IF;
END $$;
