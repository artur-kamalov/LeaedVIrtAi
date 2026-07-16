ALTER TABLE "KnowledgeV2EvaluationResult"
  DROP CONSTRAINT IF EXISTS "KnowledgeV2EvaluationResult_values_check";

ALTER TABLE "KnowledgeV2EvaluationResult"
  ADD CONSTRAINT "KnowledgeV2EvaluationResult_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("resultKey") > 0
    AND "repeatIndex" >= 0
    AND char_length("metricManifestHash") > 0
    AND char_length("evidenceManifestHash") > 0
    AND (
      ("testCaseVersionId" IS NULL AND "expectedBehavior" IS NULL)
      OR ("testCaseVersionId" IS NOT NULL AND "expectedBehavior" IS NOT NULL)
    )
    AND ("status" IN ('ERROR', 'SKIPPED') OR "observedBehavior" IS NOT NULL)
    AND ("status" <> 'ERROR' OR "errorCode" IS NOT NULL)
    AND (
      ("restrictedResultRef" IS NULL AND "restrictedResultHash" IS NULL)
      OR (
        "restrictedResultRef" IS NOT NULL
        AND char_length("restrictedResultRef") > 0
        AND "restrictedResultHash" ~ '^[a-f0-9]{64}$'
      )
    )
    AND ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("costMicros" IS NULL OR "costMicros" >= 0)
  );

ALTER TABLE "KnowledgeV2EvaluationResult"
  ADD CONSTRAINT "KnowledgeV2EvaluationResult_answer_role_check" CHECK (
    ("gateOutcome" = 'AUTO_SEND' AND "responseHash" ~ '^[a-f0-9]{64}$')
    OR ("gateOutcome" IN ('HANDOFF', 'BLOCKED') AND "responseHash" IS NULL)
    OR (
      ("gateOutcome" IS NULL OR "gateOutcome" = 'HOLD_FOR_APPROVAL')
      AND ("responseHash" IS NULL OR "responseHash" ~ '^[a-f0-9]{64}$')
    )
  );
