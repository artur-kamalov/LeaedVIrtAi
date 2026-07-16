ALTER TABLE "KnowledgeV2Settings"
  ADD COLUMN IF NOT EXISTS "modelProcessorPolicy" JSONB;

ALTER TABLE "KnowledgeV2EvaluationRun"
  ADD COLUMN IF NOT EXISTS "modelProcessorPolicyHash" TEXT;

ALTER TABLE "KnowledgeV2EvaluationResult"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "generatorModel" TEXT,
  ADD COLUMN IF NOT EXISTS "promptPolicyVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "modelProcessorPolicyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "providerOutputHash" TEXT,
  ADD COLUMN IF NOT EXISTS "gateInputHash" TEXT,
  ADD COLUMN IF NOT EXISTS "gateResultHash" TEXT;

ALTER TABLE "KnowledgeV2RetrievalTrace"
  ADD COLUMN IF NOT EXISTS "modelProcessorPolicyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "providerOutputHash" TEXT,
  ADD COLUMN IF NOT EXISTS "gateInputHash" TEXT,
  ADD COLUMN IF NOT EXISTS "gateResultHash" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'KnowledgeV2Settings_modelProcessorPolicy_check'
  ) THEN
    ALTER TABLE "KnowledgeV2Settings"
      ADD CONSTRAINT "KnowledgeV2Settings_modelProcessorPolicy_check"
      CHECK (
        "modelProcessorPolicy" IS NULL OR (
          jsonb_typeof("modelProcessorPolicy") = 'object'
          AND "modelProcessorPolicy" ?& ARRAY[
            'schemaVersion', 'policyVersion', 'approved', 'promptPolicyVersion', 'groundedAnswer'
          ]
          AND "modelProcessorPolicy" -> 'schemaVersion' = '1'::jsonb
          AND "modelProcessorPolicy" -> 'approved' = 'true'::jsonb
          AND jsonb_typeof("modelProcessorPolicy" -> 'policyVersion') = 'string'
          AND jsonb_typeof("modelProcessorPolicy" -> 'promptPolicyVersion') = 'string'
          AND jsonb_typeof("modelProcessorPolicy" -> 'groundedAnswer') = 'object'
        )
      );
  END IF;
END $$;
