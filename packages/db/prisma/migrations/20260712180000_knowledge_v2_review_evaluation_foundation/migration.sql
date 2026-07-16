-- CreateEnum
CREATE TYPE "KnowledgeV2Audience" AS ENUM ('PUBLIC', 'AUTHENTICATED_CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "KnowledgeV2EvidenceTargetType" AS ENUM ('DOCUMENT_REVISION', 'FACT_VERSION', 'GUIDANCE_RULE_VERSION', 'MESSAGE', 'TOOL_RESULT', 'EXTERNAL_REFERENCE');

-- CreateEnum
CREATE TYPE "KnowledgeV2ConflictType" AS ENUM ('FACT_VALUE', 'GUIDANCE_RULE', 'AUTHORITY', 'SCOPE_OVERLAP', 'EFFECTIVE_PERIOD', 'PERMISSION', 'DUPLICATE_IDENTITY');

-- CreateEnum
CREATE TYPE "KnowledgeV2ConflictStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "KnowledgeV2ConflictResolution" AS ENUM ('KEEP_LEFT', 'KEEP_RIGHT', 'MERGE', 'SPLIT_SCOPE', 'MARK_UNANSWERABLE', 'REQUIRE_HANDOFF', 'DISMISS');

-- CreateEnum
CREATE TYPE "KnowledgeV2ConflictCandidateType" AS ENUM ('DOCUMENT_REVISION', 'FACT_VERSION', 'GUIDANCE_RULE_VERSION');

-- CreateEnum
CREATE TYPE "KnowledgeV2ReviewReason" AS ENUM ('MISSING_REQUIRED_INFORMATION', 'CONFLICTING_VALUES', 'INFERRED_HIGH_RISK', 'LOW_CONFIDENCE_CONTENT', 'SENSITIVE_CONTENT', 'STALE_SOURCE', 'INACCESSIBLE_SOURCE', 'FAILING_TEST');

-- CreateEnum
CREATE TYPE "KnowledgeV2ReviewStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "KnowledgeV2ReviewAction" AS ENUM ('REVIEW_VALUE', 'CORRECT_SOURCE', 'ADD_MISSING_ANSWER', 'CHANGE_GUIDANCE', 'MARK_UNANSWERABLE', 'REQUIRE_HANDOFF', 'EXCLUDE_CONTENT', 'RETRY_SOURCE', 'VERIFY_PERMISSION', 'APPROVE', 'REJECT', 'DISMISS');

-- CreateEnum
CREATE TYPE "KnowledgeV2TestCaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeV2TestCaseOrigin" AS ENUM ('PLATFORM', 'INDUSTRY_PACK', 'TENANT', 'ANONYMIZED_FAILURE', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "KnowledgeV2ExpectedBehavior" AS ENUM ('ANSWER', 'ABSTAIN', 'HANDOFF', 'REFUSE', 'TOOL_CALL', 'HOLD_FOR_APPROVAL');

-- CreateEnum
CREATE TYPE "KnowledgeV2TestExpectationKind" AS ENUM ('REQUIRED_FACT', 'FORBIDDEN_FACT', 'REQUIRED_GUIDANCE', 'FORBIDDEN_GUIDANCE', 'REQUIRED_EVIDENCE', 'FORBIDDEN_CLAIM', 'REQUIRED_TOOL', 'FORBIDDEN_TOOL');

-- CreateEnum
CREATE TYPE "KnowledgeV2EvaluationRunKind" AS ENUM ('PULL_REQUEST', 'DEPLOY', 'PUBLICATION', 'MODEL_MIGRATION', 'MANUAL', 'PLAYGROUND');

-- CreateEnum
CREATE TYPE "KnowledgeV2EvaluationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KnowledgeV2EvaluationResultStatus" AS ENUM ('PASSED', 'WARNING', 'FAILED', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "KnowledgeV2MetricCategory" AS ENUM ('INGESTION', 'STRUCTURED_EXTRACTION', 'RETRIEVAL', 'GENERATION', 'POLICY_TOOLS', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "KnowledgeV2MetricComparator" AS ENUM ('GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL', 'EQUAL', 'NOT_EQUAL');

-- CreateEnum
CREATE TYPE "KnowledgeV2SnapshotKind" AS ENUM ('PUBLICATION', 'DRAFT_CANDIDATE');

-- CreateEnum
CREATE TYPE "KnowledgeV2FeedbackCategory" AS ENUM ('INCORRECT_ANSWER', 'MISSING_ANSWER', 'WRONG_GUIDANCE', 'SHOULD_BE_UNANSWERABLE', 'SHOULD_HANDOFF', 'BAD_CITATION', 'STALE_INFORMATION', 'SECURITY_CONCERN', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeV2FeedbackStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "KnowledgeV2CorrectionTargetType" AS ENUM ('SOURCE', 'DOCUMENT_REVISION', 'FACT', 'GUIDANCE_RULE', 'MARK_UNANSWERABLE', 'REQUIRE_HANDOFF');

-- CreateEnum
CREATE TYPE "KnowledgeV2RetrievalOutcome" AS ENUM ('ANSWERED', 'ABSTAINED', 'HANDED_OFF', 'HELD_FOR_APPROVAL', 'REFUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeV2GateOutcome" AS ENUM ('AUTO_SEND', 'HOLD_FOR_APPROVAL', 'HANDOFF', 'BLOCKED');

-- CreateEnum
CREATE TYPE "KnowledgeV2RetrievalRejectionReason" AS ENUM ('BELOW_THRESHOLD', 'DUPLICATE', 'PERMISSION_DENIED', 'STALE', 'DELETED', 'CONFLICTED', 'RERANKED_OUT', 'NOT_SELECTED');

-- CreateEnum
CREATE TYPE "KnowledgeV2CitationSupport" AS ENUM ('SUPPORTS', 'PARTIAL', 'CONTRADICTS', 'NOT_ASSESSED');

-- CreateTable
CREATE TABLE "KnowledgeV2EvidenceReference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "evidenceKey" TEXT NOT NULL,
    "targetType" "KnowledgeV2EvidenceTargetType" NOT NULL,
    "itemVersionHash" TEXT,
    "v2DocumentRevisionId" TEXT,
    "factVersionId" TEXT,
    "guidanceRuleVersionId" TEXT,
    "messageId" TEXT,
    "toolResultRef" TEXT,
    "externalReferenceHash" TEXT,
    "safeLabel" TEXT NOT NULL,
    "locatorHash" TEXT,
    "restrictedPayloadRef" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "permissionFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2EvidenceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2Conflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "conflictKey" TEXT NOT NULL,
    "conflictType" "KnowledgeV2ConflictType" NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "scope" JSONB,
    "scopeHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "severity" "KnowledgeV2RiskLevel" NOT NULL,
    "status" "KnowledgeV2ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "sourceId" TEXT,
    "factId" TEXT,
    "guidanceRuleId" TEXT,
    "publicationId" TEXT,
    "candidateSetHash" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "resolution" "KnowledgeV2ConflictResolution",
    "resolutionRationaleHash" TEXT,
    "restrictedResolutionRef" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "etag" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeV2Conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2ConflictCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "conflictId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "candidateType" "KnowledgeV2ConflictCandidateType" NOT NULL,
    "itemVersionHash" TEXT NOT NULL,
    "v2DocumentRevisionId" TEXT,
    "factVersionId" TEXT,
    "guidanceRuleVersionId" TEXT,
    "candidateValueHash" TEXT NOT NULL,
    "restrictedValueRef" TEXT,
    "authorityFingerprint" TEXT,
    "extractionMethod" TEXT,
    "confidence" DOUBLE PRECISION,
    "scope" JSONB,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2ConflictCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2ConflictCandidateEvidence" (
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "conflictCandidateId" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2ConflictCandidateEvidence_pkey" PRIMARY KEY ("tenantId","conflictCandidateId","evidenceReferenceId")
);

-- CreateTable
CREATE TABLE "KnowledgeV2ReviewItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "reviewKey" TEXT NOT NULL,
    "reason" "KnowledgeV2ReviewReason" NOT NULL,
    "riskLevel" "KnowledgeV2RiskLevel" NOT NULL,
    "status" "KnowledgeV2ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "suggestedAction" "KnowledgeV2ReviewAction" NOT NULL,
    "safeTitle" TEXT NOT NULL,
    "safeSummary" TEXT,
    "restrictedPayloadRef" TEXT,
    "sourceId" TEXT,
    "v2DocumentRevisionId" TEXT,
    "factId" TEXT,
    "guidanceRuleId" TEXT,
    "conflictId" TEXT,
    "evaluationResultId" TEXT,
    "feedbackId" TEXT,
    "publicationId" TEXT,
    "createdByUserId" TEXT,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "freshnessDueAt" TIMESTAMP(3),
    "resolutionAction" "KnowledgeV2ReviewAction",
    "resolutionSummaryHash" TEXT,
    "restrictedResolutionRef" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "etag" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeV2ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2ReviewItemEvidence" (
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "reviewItemId" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2ReviewItemEvidence_pkey" PRIMARY KEY ("tenantId","reviewItemId","evidenceReferenceId")
);

-- CreateTable
CREATE TABLE "KnowledgeV2TestCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "caseKey" TEXT NOT NULL,
    "safeLabel" TEXT NOT NULL,
    "origin" "KnowledgeV2TestCaseOrigin" NOT NULL,
    "status" "KnowledgeV2TestCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "riskLevel" "KnowledgeV2RiskLevel" NOT NULL DEFAULT 'LOW',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" TEXT,
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "archivedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "etag" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeV2TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2TestCaseVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "testCaseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "queryHash" TEXT NOT NULL,
    "restrictedInputRef" TEXT NOT NULL,
    "expectedBehavior" "KnowledgeV2ExpectedBehavior" NOT NULL,
    "locale" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "audience" "KnowledgeV2Audience" NOT NULL,
    "scope" JSONB,
    "sliceKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "datasetVersion" TEXT NOT NULL,
    "riskLevel" "KnowledgeV2RiskLevel" NOT NULL DEFAULT 'LOW',
    "supersedesVersionId" TEXT,
    "immutableHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2TestCaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2TestExpectation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "testCaseVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "KnowledgeV2TestExpectationKind" NOT NULL,
    "factId" TEXT,
    "guidanceRuleId" TEXT,
    "evidenceReferenceId" TEXT,
    "semanticKey" TEXT,
    "expectedValueHash" TEXT,
    "restrictedExpectedRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2TestExpectation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2EvaluationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "runKey" TEXT NOT NULL,
    "runKind" "KnowledgeV2EvaluationRunKind" NOT NULL,
    "status" "KnowledgeV2EvaluationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "snapshotKind" "KnowledgeV2SnapshotKind" NOT NULL,
    "targetKey" TEXT NOT NULL DEFAULT 'workspace-v2',
    "publicationId" TEXT,
    "candidateId" TEXT,
    "candidateVersion" INTEGER,
    "candidateManifestHash" TEXT,
    "datasetVersion" TEXT NOT NULL,
    "testCaseSetHash" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "restrictedConfigRef" TEXT,
    "parserVersion" TEXT,
    "normalizerVersion" TEXT,
    "chunkerVersion" TEXT,
    "embeddingVersion" TEXT,
    "sparseVersion" TEXT,
    "rerankerVersion" TEXT,
    "retrievalPolicyVersion" TEXT NOT NULL,
    "promptPolicyVersion" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL,
    "provider" TEXT,
    "generatorModel" TEXT,
    "judgeModel" TEXT,
    "judgePromptVersion" TEXT,
    "codeCommit" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeV2EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2EvaluationResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "resultKey" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "testCaseVersionId" TEXT NOT NULL,
    "repeatIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgeV2EvaluationResultStatus" NOT NULL,
    "expectedBehavior" "KnowledgeV2ExpectedBehavior" NOT NULL,
    "observedBehavior" "KnowledgeV2ExpectedBehavior",
    "gateOutcome" "KnowledgeV2GateOutcome",
    "responseHash" TEXT,
    "restrictedResultRef" TEXT,
    "safeSummaryHash" TEXT,
    "metricManifestHash" TEXT NOT NULL,
    "evidenceManifestHash" TEXT NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2EvaluationMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "evaluationResultId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "category" "KnowledgeV2MetricCategory" NOT NULL,
    "value" DOUBLE PRECISION,
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "unit" TEXT,
    "threshold" DOUBLE PRECISION,
    "comparator" "KnowledgeV2MetricComparator",
    "status" "KnowledgeV2EvaluationResultStatus" NOT NULL,
    "sliceKey" TEXT,
    "sampleCount" INTEGER,
    "confidenceLower" DOUBLE PRECISION,
    "confidenceUpper" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2EvaluationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2EvaluationResultEvidence" (
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "evaluationResultId" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2EvaluationResultEvidence_pkey" PRIMARY KEY ("tenantId","evaluationResultId","evidenceReferenceId")
);

-- CreateTable
CREATE TABLE "KnowledgeV2Feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "feedbackKey" TEXT NOT NULL,
    "category" "KnowledgeV2FeedbackCategory" NOT NULL,
    "status" "KnowledgeV2FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "riskLevel" "KnowledgeV2RiskLevel" NOT NULL DEFAULT 'LOW',
    "responseMessageId" TEXT,
    "evaluationRunId" TEXT,
    "evaluationResultId" TEXT,
    "publicationId" TEXT,
    "retrievalTraceId" TEXT,
    "actorUserId" TEXT,
    "noteHash" TEXT,
    "restrictedNoteRef" TEXT,
    "proposedAction" "KnowledgeV2ReviewAction",
    "correctionTargetType" "KnowledgeV2CorrectionTargetType",
    "sourceId" TEXT,
    "v2DocumentRevisionId" TEXT,
    "factId" TEXT,
    "guidanceRuleId" TEXT,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolutionAction" "KnowledgeV2ReviewAction",
    "resolutionSummaryHash" TEXT,
    "restrictedResolutionRef" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "etag" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeV2Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2FeedbackEvidence" (
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "feedbackId" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2FeedbackEvidence_pkey" PRIMARY KEY ("tenantId","feedbackId","evidenceReferenceId")
);

-- CreateTable
CREATE TABLE "KnowledgeV2RetrievalTrace" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "traceKey" TEXT NOT NULL,
    "distributedTraceId" TEXT,
    "snapshotKind" "KnowledgeV2SnapshotKind" NOT NULL,
    "targetKey" TEXT NOT NULL DEFAULT 'workspace-v2',
    "publicationId" TEXT,
    "candidateId" TEXT,
    "candidateVersion" INTEGER,
    "candidateManifestHash" TEXT,
    "evaluationRunId" TEXT,
    "evaluationResultId" TEXT,
    "responseMessageId" TEXT,
    "queryHash" TEXT NOT NULL,
    "restrictedQueryRef" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "filtersHash" TEXT NOT NULL,
    "permissionFingerprint" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "retrievalPolicyVersion" TEXT NOT NULL,
    "rerankerVersion" TEXT,
    "promptPolicyVersion" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL,
    "provider" TEXT,
    "generatorModel" TEXT,
    "outcome" "KnowledgeV2RetrievalOutcome" NOT NULL,
    "gateOutcome" "KnowledgeV2GateOutcome" NOT NULL,
    "answerHash" TEXT,
    "restrictedTraceRef" TEXT,
    "retrievalCandidateManifestHash" TEXT NOT NULL,
    "citationManifestHash" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" BIGINT,
    "retentionClass" TEXT NOT NULL,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2RetrievalTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2RetrievalCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "retrievalTraceId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "denseRank" INTEGER,
    "denseScore" DOUBLE PRECISION,
    "sparseRank" INTEGER,
    "sparseScore" DOUBLE PRECISION,
    "fusedRank" INTEGER,
    "fusedScore" DOUBLE PRECISION,
    "rerankRank" INTEGER,
    "rerankScore" DOUBLE PRECISION,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" "KnowledgeV2RetrievalRejectionReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2RetrievalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeV2Citation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "corpusKind" "KnowledgeCorpusKind" NOT NULL DEFAULT 'STRUCTURED_V2',
    "citationKey" TEXT NOT NULL,
    "retrievalTraceId" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "claimHash" TEXT NOT NULL,
    "restrictedClaimRef" TEXT,
    "support" "KnowledgeV2CitationSupport" NOT NULL DEFAULT 'NOT_ASSESSED',
    "confidence" DOUBLE PRECISION,
    "toolObservedAt" TIMESTAMP(3),
    "toolExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeV2Citation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_tenantId_targetType_createdAt_idx" ON "KnowledgeV2EvidenceReference"("tenantId", "targetType", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_tenantId_v2DocumentRevisionId_idx" ON "KnowledgeV2EvidenceReference"("tenantId", "v2DocumentRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_tenantId_factVersionId_idx" ON "KnowledgeV2EvidenceReference"("tenantId", "factVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_tenantId_guidanceRuleVersionId_idx" ON "KnowledgeV2EvidenceReference"("tenantId", "guidanceRuleVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_tenantId_messageId_idx" ON "KnowledgeV2EvidenceReference"("tenantId", "messageId");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvidenceReference_expiresAt_idx" ON "KnowledgeV2EvidenceReference"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvidenceReference_tenantId_evidenceKey_key" ON "KnowledgeV2EvidenceReference"("tenantId", "evidenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvidenceReference_tenantId_id_key" ON "KnowledgeV2EvidenceReference"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvidenceReference_tenantId_id_corpusKind_key" ON "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_status_severity_createdAt_idx" ON "KnowledgeV2Conflict"("tenantId", "status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_semanticKey_status_idx" ON "KnowledgeV2Conflict"("tenantId", "semanticKey", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_assignedToUserId_status_idx" ON "KnowledgeV2Conflict"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_sourceId_idx" ON "KnowledgeV2Conflict"("tenantId", "sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_factId_idx" ON "KnowledgeV2Conflict"("tenantId", "factId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_guidanceRuleId_idx" ON "KnowledgeV2Conflict"("tenantId", "guidanceRuleId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Conflict_tenantId_publicationId_idx" ON "KnowledgeV2Conflict"("tenantId", "publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Conflict_tenantId_conflictKey_key" ON "KnowledgeV2Conflict"("tenantId", "conflictKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Conflict_tenantId_id_key" ON "KnowledgeV2Conflict"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Conflict_tenantId_id_corpusKind_key" ON "KnowledgeV2Conflict"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2ConflictCandidate_tenantId_v2DocumentRevisionId_idx" ON "KnowledgeV2ConflictCandidate"("tenantId", "v2DocumentRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ConflictCandidate_tenantId_factVersionId_idx" ON "KnowledgeV2ConflictCandidate"("tenantId", "factVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ConflictCandidate_tenantId_guidanceRuleVersionId_idx" ON "KnowledgeV2ConflictCandidate"("tenantId", "guidanceRuleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ConflictCandidate_tenantId_conflictId_candidateK_key" ON "KnowledgeV2ConflictCandidate"("tenantId", "conflictId", "candidateKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ConflictCandidate_tenantId_conflictId_ordinal_key" ON "KnowledgeV2ConflictCandidate"("tenantId", "conflictId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ConflictCandidate_tenantId_id_key" ON "KnowledgeV2ConflictCandidate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ConflictCandidate_tenantId_id_corpusKind_key" ON "KnowledgeV2ConflictCandidate"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2ConflictCandidateEvidence_tenantId_evidenceRefer_idx" ON "KnowledgeV2ConflictCandidateEvidence"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ConflictCandidateEvidence_tenantId_conflictCandi_key" ON "KnowledgeV2ConflictCandidateEvidence"("tenantId", "conflictCandidateId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_status_riskLevel_createdAt_idx" ON "KnowledgeV2ReviewItem"("tenantId", "status", "riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_reason_status_idx" ON "KnowledgeV2ReviewItem"("tenantId", "reason", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_assignedToUserId_status_idx" ON "KnowledgeV2ReviewItem"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_sourceId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_v2DocumentRevisionId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "v2DocumentRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_factId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "factId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_guidanceRuleId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "guidanceRuleId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_conflictId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "conflictId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_evaluationResultId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "evaluationResultId");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItem_tenantId_feedbackId_idx" ON "KnowledgeV2ReviewItem"("tenantId", "feedbackId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ReviewItem_tenantId_reviewKey_key" ON "KnowledgeV2ReviewItem"("tenantId", "reviewKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ReviewItem_tenantId_id_key" ON "KnowledgeV2ReviewItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ReviewItem_tenantId_id_corpusKind_key" ON "KnowledgeV2ReviewItem"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2ReviewItemEvidence_tenantId_evidenceReferenceId_idx" ON "KnowledgeV2ReviewItemEvidence"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2ReviewItemEvidence_tenantId_reviewItemId_ordinal_key" ON "KnowledgeV2ReviewItemEvidence"("tenantId", "reviewItemId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestCase_tenantId_status_riskLevel_updatedAt_idx" ON "KnowledgeV2TestCase"("tenantId", "status", "riskLevel", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestCase_tenantId_origin_status_idx" ON "KnowledgeV2TestCase"("tenantId", "origin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCase_tenantId_caseKey_key" ON "KnowledgeV2TestCase"("tenantId", "caseKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCase_tenantId_id_key" ON "KnowledgeV2TestCase"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCase_tenantId_id_corpusKind_key" ON "KnowledgeV2TestCase"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCase_tenantId_id_currentVersionId_key" ON "KnowledgeV2TestCase"("tenantId", "id", "currentVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestCaseVersion_tenantId_testCaseId_createdAt_idx" ON "KnowledgeV2TestCaseVersion"("tenantId", "testCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestCaseVersion_tenantId_datasetVersion_idx" ON "KnowledgeV2TestCaseVersion"("tenantId", "datasetVersion");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestCaseVersion_tenantId_locale_channelType_audi_idx" ON "KnowledgeV2TestCaseVersion"("tenantId", "locale", "channelType", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCaseVersion_testCaseId_versionNumber_key" ON "KnowledgeV2TestCaseVersion"("testCaseId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCaseVersion_testCaseId_immutableHash_key" ON "KnowledgeV2TestCaseVersion"("testCaseId", "immutableHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCaseVersion_tenantId_id_key" ON "KnowledgeV2TestCaseVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCaseVersion_tenantId_id_corpusKind_key" ON "KnowledgeV2TestCaseVersion"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestCaseVersion_tenantId_testCaseId_id_key" ON "KnowledgeV2TestCaseVersion"("tenantId", "testCaseId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestExpectation_tenantId_factId_idx" ON "KnowledgeV2TestExpectation"("tenantId", "factId");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestExpectation_tenantId_guidanceRuleId_idx" ON "KnowledgeV2TestExpectation"("tenantId", "guidanceRuleId");

-- CreateIndex
CREATE INDEX "KnowledgeV2TestExpectation_tenantId_evidenceReferenceId_idx" ON "KnowledgeV2TestExpectation"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestExpectation_tenantId_testCaseVersionId_ordin_key" ON "KnowledgeV2TestExpectation"("tenantId", "testCaseVersionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2TestExpectation_tenantId_id_key" ON "KnowledgeV2TestExpectation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationRun_tenantId_status_createdAt_idx" ON "KnowledgeV2EvaluationRun"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationRun_tenantId_runKind_datasetVersion_idx" ON "KnowledgeV2EvaluationRun"("tenantId", "runKind", "datasetVersion");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationRun_tenantId_publicationId_idx" ON "KnowledgeV2EvaluationRun"("tenantId", "publicationId");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationRun_tenantId_candidateId_candidateVers_idx" ON "KnowledgeV2EvaluationRun"("tenantId", "candidateId", "candidateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationRun_tenantId_runKey_key" ON "KnowledgeV2EvaluationRun"("tenantId", "runKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationRun_tenantId_id_key" ON "KnowledgeV2EvaluationRun"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationRun_tenantId_id_corpusKind_key" ON "KnowledgeV2EvaluationRun"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationResult_tenantId_evaluationRunId_status_idx" ON "KnowledgeV2EvaluationResult"("tenantId", "evaluationRunId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationResult_tenantId_testCaseVersionId_stat_idx" ON "KnowledgeV2EvaluationResult"("tenantId", "testCaseVersionId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationResult_tenantId_gateOutcome_idx" ON "KnowledgeV2EvaluationResult"("tenantId", "gateOutcome");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResult_tenantId_resultKey_key" ON "KnowledgeV2EvaluationResult"("tenantId", "resultKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResult_tenantId_evaluationRunId_testCa_key" ON "KnowledgeV2EvaluationResult"("tenantId", "evaluationRunId", "testCaseVersionId", "repeatIndex");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResult_tenantId_id_key" ON "KnowledgeV2EvaluationResult"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResult_tenantId_id_corpusKind_key" ON "KnowledgeV2EvaluationResult"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResult_exact_run_key" ON "KnowledgeV2EvaluationResult"("tenantId", "id", "evaluationRunId", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationMetric_tenantId_category_status_idx" ON "KnowledgeV2EvaluationMetric"("tenantId", "category", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationMetric_tenantId_metricKey_sliceKey_idx" ON "KnowledgeV2EvaluationMetric"("tenantId", "metricKey", "sliceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationMetric_tenantId_evaluationResultId_met_key" ON "KnowledgeV2EvaluationMetric"("tenantId", "evaluationResultId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationMetric_tenantId_id_key" ON "KnowledgeV2EvaluationMetric"("tenantId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeV2EvaluationResultEvidence_tenantId_evidenceRefere_idx" ON "KnowledgeV2EvaluationResultEvidence"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2EvaluationResultEvidence_tenantId_evaluationResu_key" ON "KnowledgeV2EvaluationResultEvidence"("tenantId", "evaluationResultId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_status_category_createdAt_idx" ON "KnowledgeV2Feedback"("tenantId", "status", "category", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_assignedToUserId_status_idx" ON "KnowledgeV2Feedback"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_responseMessageId_idx" ON "KnowledgeV2Feedback"("tenantId", "responseMessageId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_evaluationRunId_idx" ON "KnowledgeV2Feedback"("tenantId", "evaluationRunId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_evaluationResultId_idx" ON "KnowledgeV2Feedback"("tenantId", "evaluationResultId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_publicationId_idx" ON "KnowledgeV2Feedback"("tenantId", "publicationId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_retrievalTraceId_idx" ON "KnowledgeV2Feedback"("tenantId", "retrievalTraceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_sourceId_idx" ON "KnowledgeV2Feedback"("tenantId", "sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_v2DocumentRevisionId_idx" ON "KnowledgeV2Feedback"("tenantId", "v2DocumentRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_factId_idx" ON "KnowledgeV2Feedback"("tenantId", "factId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Feedback_tenantId_guidanceRuleId_idx" ON "KnowledgeV2Feedback"("tenantId", "guidanceRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Feedback_tenantId_feedbackKey_key" ON "KnowledgeV2Feedback"("tenantId", "feedbackKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Feedback_tenantId_id_key" ON "KnowledgeV2Feedback"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Feedback_tenantId_id_corpusKind_key" ON "KnowledgeV2Feedback"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2FeedbackEvidence_tenantId_evidenceReferenceId_idx" ON "KnowledgeV2FeedbackEvidence"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2FeedbackEvidence_tenantId_feedbackId_ordinal_key" ON "KnowledgeV2FeedbackEvidence"("tenantId", "feedbackId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_publicationId_createdAt_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "publicationId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_candidateId_candidateVer_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "candidateId", "candidateVersion");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_evaluationRunId_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "evaluationRunId");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_evaluationResultId_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "evaluationResultId");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_responseMessageId_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "responseMessageId");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_tenantId_outcome_gateOutcome_crea_idx" ON "KnowledgeV2RetrievalTrace"("tenantId", "outcome", "gateOutcome", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalTrace_retentionExpiresAt_idx" ON "KnowledgeV2RetrievalTrace"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalTrace_tenantId_traceKey_key" ON "KnowledgeV2RetrievalTrace"("tenantId", "traceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalTrace_tenantId_distributedTraceId_key" ON "KnowledgeV2RetrievalTrace"("tenantId", "distributedTraceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalTrace_tenantId_id_key" ON "KnowledgeV2RetrievalTrace"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalTrace_tenantId_id_corpusKind_key" ON "KnowledgeV2RetrievalTrace"("tenantId", "id", "corpusKind");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalCandidate_tenantId_retrievalTraceId_sel_idx" ON "KnowledgeV2RetrievalCandidate"("tenantId", "retrievalTraceId", "selected");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalCandidate_tenantId_evidenceReferenceId_idx" ON "KnowledgeV2RetrievalCandidate"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2RetrievalCandidate_tenantId_rerankRank_idx" ON "KnowledgeV2RetrievalCandidate"("tenantId", "rerankRank");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalCandidate_tenantId_retrievalTraceId_can_key" ON "KnowledgeV2RetrievalCandidate"("tenantId", "retrievalTraceId", "candidateKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2RetrievalCandidate_tenantId_id_key" ON "KnowledgeV2RetrievalCandidate"("tenantId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeV2Citation_tenantId_evidenceReferenceId_idx" ON "KnowledgeV2Citation"("tenantId", "evidenceReferenceId");

-- CreateIndex
CREATE INDEX "KnowledgeV2Citation_tenantId_support_idx" ON "KnowledgeV2Citation"("tenantId", "support");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Citation_tenantId_citationKey_key" ON "KnowledgeV2Citation"("tenantId", "citationKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Citation_tenantId_retrievalTraceId_ordinal_key" ON "KnowledgeV2Citation"("tenantId", "retrievalTraceId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeV2Citation_tenantId_id_key" ON "KnowledgeV2Citation"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvidenceReference" ADD CONSTRAINT "KnowledgeV2EvidenceReference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvidenceReference" ADD CONSTRAINT "KnowledgeV2EvidenceReference_tenantId_v2DocumentRevisionId_fkey" FOREIGN KEY ("tenantId", "v2DocumentRevisionId", "itemVersionHash") REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "id", "contentHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvidenceReference" ADD CONSTRAINT "KnowledgeV2EvidenceReference_tenantId_factVersionId_itemVe_fkey" FOREIGN KEY ("tenantId", "factVersionId", "itemVersionHash") REFERENCES "KnowledgeV2FactVersion"("tenantId", "id", "immutableHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvidenceReference" ADD CONSTRAINT "KnowledgeV2EvidenceReference_tenantId_guidanceRuleVersionI_fkey" FOREIGN KEY ("tenantId", "guidanceRuleVersionId", "itemVersionHash") REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "id", "immutableHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvidenceReference" ADD CONSTRAINT "KnowledgeV2EvidenceReference_tenantId_messageId_fkey" FOREIGN KEY ("tenantId", "messageId") REFERENCES "Message"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_factId_fkey" FOREIGN KEY ("tenantId", "factId") REFERENCES "KnowledgeV2Fact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_guidanceRuleId_fkey" FOREIGN KEY ("tenantId", "guidanceRuleId") REFERENCES "KnowledgeV2GuidanceRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_publicationId_corpusKind_fkey" FOREIGN KEY ("tenantId", "publicationId", "corpusKind") REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_assignedToUserId_fkey" FOREIGN KEY ("tenantId", "assignedToUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Conflict" ADD CONSTRAINT "KnowledgeV2Conflict_tenantId_resolvedByUserId_fkey" FOREIGN KEY ("tenantId", "resolvedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidate" ADD CONSTRAINT "KnowledgeV2ConflictCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidate" ADD CONSTRAINT "KnowledgeV2ConflictCandidate_tenantId_conflictId_corpusKin_fkey" FOREIGN KEY ("tenantId", "conflictId", "corpusKind") REFERENCES "KnowledgeV2Conflict"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidate" ADD CONSTRAINT "KnowledgeV2ConflictCandidate_tenantId_v2DocumentRevisionId_fkey" FOREIGN KEY ("tenantId", "v2DocumentRevisionId", "itemVersionHash") REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "id", "contentHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidate" ADD CONSTRAINT "KnowledgeV2ConflictCandidate_tenantId_factVersionId_itemVe_fkey" FOREIGN KEY ("tenantId", "factVersionId", "itemVersionHash") REFERENCES "KnowledgeV2FactVersion"("tenantId", "id", "immutableHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidate" ADD CONSTRAINT "KnowledgeV2ConflictCandidate_tenantId_guidanceRuleVersionI_fkey" FOREIGN KEY ("tenantId", "guidanceRuleVersionId", "itemVersionHash") REFERENCES "KnowledgeV2GuidanceRuleVersion"("tenantId", "id", "immutableHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidateEvidence" ADD CONSTRAINT "KnowledgeV2ConflictCandidateEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidateEvidence" ADD CONSTRAINT "KnowledgeV2ConflictCandidateEvidence_tenantId_conflictCand_fkey" FOREIGN KEY ("tenantId", "conflictCandidateId", "corpusKind") REFERENCES "KnowledgeV2ConflictCandidate"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ConflictCandidateEvidence" ADD CONSTRAINT "KnowledgeV2ConflictCandidateEvidence_tenantId_evidenceRefe_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_v2DocumentRevisionId_fkey" FOREIGN KEY ("tenantId", "v2DocumentRevisionId") REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_factId_fkey" FOREIGN KEY ("tenantId", "factId") REFERENCES "KnowledgeV2Fact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_guidanceRuleId_fkey" FOREIGN KEY ("tenantId", "guidanceRuleId") REFERENCES "KnowledgeV2GuidanceRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_conflictId_corpusKind_fkey" FOREIGN KEY ("tenantId", "conflictId", "corpusKind") REFERENCES "KnowledgeV2Conflict"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_evaluationResultId_corpusKi_fkey" FOREIGN KEY ("tenantId", "evaluationResultId", "corpusKind") REFERENCES "KnowledgeV2EvaluationResult"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_feedbackId_corpusKind_fkey" FOREIGN KEY ("tenantId", "feedbackId", "corpusKind") REFERENCES "KnowledgeV2Feedback"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_publicationId_corpusKind_fkey" FOREIGN KEY ("tenantId", "publicationId", "corpusKind") REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_assignedToUserId_fkey" FOREIGN KEY ("tenantId", "assignedToUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItem" ADD CONSTRAINT "KnowledgeV2ReviewItem_tenantId_resolvedByUserId_fkey" FOREIGN KEY ("tenantId", "resolvedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItemEvidence" ADD CONSTRAINT "KnowledgeV2ReviewItemEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItemEvidence" ADD CONSTRAINT "KnowledgeV2ReviewItemEvidence_tenantId_reviewItemId_corpus_fkey" FOREIGN KEY ("tenantId", "reviewItemId", "corpusKind") REFERENCES "KnowledgeV2ReviewItem"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2ReviewItemEvidence" ADD CONSTRAINT "KnowledgeV2ReviewItemEvidence_tenantId_evidenceReferenceId_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCase" ADD CONSTRAINT "KnowledgeV2TestCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCase" ADD CONSTRAINT "KnowledgeV2TestCase_tenantId_id_currentVersionId_fkey" FOREIGN KEY ("tenantId", "id", "currentVersionId") REFERENCES "KnowledgeV2TestCaseVersion"("tenantId", "testCaseId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCase" ADD CONSTRAINT "KnowledgeV2TestCase_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCase" ADD CONSTRAINT "KnowledgeV2TestCase_tenantId_archivedByUserId_fkey" FOREIGN KEY ("tenantId", "archivedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCaseVersion" ADD CONSTRAINT "KnowledgeV2TestCaseVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCaseVersion" ADD CONSTRAINT "KnowledgeV2TestCaseVersion_tenantId_testCaseId_corpusKind_fkey" FOREIGN KEY ("tenantId", "testCaseId", "corpusKind") REFERENCES "KnowledgeV2TestCase"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCaseVersion" ADD CONSTRAINT "KnowledgeV2TestCaseVersion_tenantId_testCaseId_supersedesV_fkey" FOREIGN KEY ("tenantId", "testCaseId", "supersedesVersionId") REFERENCES "KnowledgeV2TestCaseVersion"("tenantId", "testCaseId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestCaseVersion" ADD CONSTRAINT "KnowledgeV2TestCaseVersion_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestExpectation" ADD CONSTRAINT "KnowledgeV2TestExpectation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestExpectation" ADD CONSTRAINT "KnowledgeV2TestExpectation_tenantId_testCaseVersionId_corp_fkey" FOREIGN KEY ("tenantId", "testCaseVersionId", "corpusKind") REFERENCES "KnowledgeV2TestCaseVersion"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestExpectation" ADD CONSTRAINT "KnowledgeV2TestExpectation_tenantId_factId_fkey" FOREIGN KEY ("tenantId", "factId") REFERENCES "KnowledgeV2Fact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestExpectation" ADD CONSTRAINT "KnowledgeV2TestExpectation_tenantId_guidanceRuleId_fkey" FOREIGN KEY ("tenantId", "guidanceRuleId") REFERENCES "KnowledgeV2GuidanceRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2TestExpectation" ADD CONSTRAINT "KnowledgeV2TestExpectation_tenantId_evidenceReferenceId_co_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationRun" ADD CONSTRAINT "KnowledgeV2EvaluationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationRun" ADD CONSTRAINT "KnowledgeV2EvaluationRun_tenantId_publicationId_corpusKind_fkey" FOREIGN KEY ("tenantId", "publicationId", "corpusKind") REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationRun" ADD CONSTRAINT "KnowledgeV2EvaluationRun_tenantId_requestedByUserId_fkey" FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResult" ADD CONSTRAINT "KnowledgeV2EvaluationResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResult" ADD CONSTRAINT "KnowledgeV2EvaluationResult_tenantId_evaluationRunId_corpu_fkey" FOREIGN KEY ("tenantId", "evaluationRunId", "corpusKind") REFERENCES "KnowledgeV2EvaluationRun"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResult" ADD CONSTRAINT "KnowledgeV2EvaluationResult_tenantId_testCaseVersionId_cor_fkey" FOREIGN KEY ("tenantId", "testCaseVersionId", "corpusKind") REFERENCES "KnowledgeV2TestCaseVersion"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationMetric" ADD CONSTRAINT "KnowledgeV2EvaluationMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationMetric" ADD CONSTRAINT "KnowledgeV2EvaluationMetric_tenantId_evaluationResultId_co_fkey" FOREIGN KEY ("tenantId", "evaluationResultId", "corpusKind") REFERENCES "KnowledgeV2EvaluationResult"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResultEvidence" ADD CONSTRAINT "KnowledgeV2EvaluationResultEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResultEvidence" ADD CONSTRAINT "KnowledgeV2EvaluationResultEvidence_tenantId_evaluationRes_fkey" FOREIGN KEY ("tenantId", "evaluationResultId", "corpusKind") REFERENCES "KnowledgeV2EvaluationResult"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2EvaluationResultEvidence" ADD CONSTRAINT "KnowledgeV2EvaluationResultEvidence_tenantId_evidenceRefer_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_responseMessageId_fkey" FOREIGN KEY ("tenantId", "responseMessageId") REFERENCES "Message"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_evaluationRunId_corpusKind_fkey" FOREIGN KEY ("tenantId", "evaluationRunId", "corpusKind") REFERENCES "KnowledgeV2EvaluationRun"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_exact_result_fkey" FOREIGN KEY ("tenantId", "evaluationResultId", "evaluationRunId", "corpusKind") REFERENCES "KnowledgeV2EvaluationResult"("tenantId", "id", "evaluationRunId", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_publicationId_corpusKind_fkey" FOREIGN KEY ("tenantId", "publicationId", "corpusKind") REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_retrievalTraceId_corpusKind_fkey" FOREIGN KEY ("tenantId", "retrievalTraceId", "corpusKind") REFERENCES "KnowledgeV2RetrievalTrace"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "KnowledgeV2Source"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_v2DocumentRevisionId_fkey" FOREIGN KEY ("tenantId", "v2DocumentRevisionId") REFERENCES "KnowledgeV2DocumentRevision"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_factId_fkey" FOREIGN KEY ("tenantId", "factId") REFERENCES "KnowledgeV2Fact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_guidanceRuleId_fkey" FOREIGN KEY ("tenantId", "guidanceRuleId") REFERENCES "KnowledgeV2GuidanceRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_assignedToUserId_fkey" FOREIGN KEY ("tenantId", "assignedToUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Feedback" ADD CONSTRAINT "KnowledgeV2Feedback_tenantId_resolvedByUserId_fkey" FOREIGN KEY ("tenantId", "resolvedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2FeedbackEvidence" ADD CONSTRAINT "KnowledgeV2FeedbackEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2FeedbackEvidence" ADD CONSTRAINT "KnowledgeV2FeedbackEvidence_tenantId_feedbackId_corpusKind_fkey" FOREIGN KEY ("tenantId", "feedbackId", "corpusKind") REFERENCES "KnowledgeV2Feedback"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2FeedbackEvidence" ADD CONSTRAINT "KnowledgeV2FeedbackEvidence_tenantId_evidenceReferenceId_c_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalTrace" ADD CONSTRAINT "KnowledgeV2RetrievalTrace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalTrace" ADD CONSTRAINT "KnowledgeV2RetrievalTrace_tenantId_publicationId_corpusKin_fkey" FOREIGN KEY ("tenantId", "publicationId", "corpusKind") REFERENCES "KnowledgePublication"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalTrace" ADD CONSTRAINT "KnowledgeV2RetrievalTrace_tenantId_evaluationRunId_corpusK_fkey" FOREIGN KEY ("tenantId", "evaluationRunId", "corpusKind") REFERENCES "KnowledgeV2EvaluationRun"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalTrace" ADD CONSTRAINT "KnowledgeV2RetrievalTrace_exact_result_fkey" FOREIGN KEY ("tenantId", "evaluationResultId", "evaluationRunId", "corpusKind") REFERENCES "KnowledgeV2EvaluationResult"("tenantId", "id", "evaluationRunId", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalTrace" ADD CONSTRAINT "KnowledgeV2RetrievalTrace_tenantId_responseMessageId_fkey" FOREIGN KEY ("tenantId", "responseMessageId") REFERENCES "Message"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalCandidate" ADD CONSTRAINT "KnowledgeV2RetrievalCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalCandidate" ADD CONSTRAINT "KnowledgeV2RetrievalCandidate_tenantId_retrievalTraceId_co_fkey" FOREIGN KEY ("tenantId", "retrievalTraceId", "corpusKind") REFERENCES "KnowledgeV2RetrievalTrace"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2RetrievalCandidate" ADD CONSTRAINT "KnowledgeV2RetrievalCandidate_tenantId_evidenceReferenceId_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Citation" ADD CONSTRAINT "KnowledgeV2Citation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Citation" ADD CONSTRAINT "KnowledgeV2Citation_tenantId_retrievalTraceId_corpusKind_fkey" FOREIGN KEY ("tenantId", "retrievalTraceId", "corpusKind") REFERENCES "KnowledgeV2RetrievalTrace"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "KnowledgeV2Citation" ADD CONSTRAINT "KnowledgeV2Citation_tenantId_evidenceReferenceId_corpusKin_fkey" FOREIGN KEY ("tenantId", "evidenceReferenceId", "corpusKind") REFERENCES "KnowledgeV2EvidenceReference"("tenantId", "id", "corpusKind") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2EvidenceReference"
  ADD CONSTRAINT "KnowledgeV2EvidenceReference_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("evidenceKey") > 0
    AND char_length("safeLabel") > 0
    AND ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
    AND ("expiresAt" IS NULL OR "observedAt" IS NULL OR "expiresAt" > "observedAt")
    AND ("restrictedPayloadRef" IS NULL OR char_length("restrictedPayloadRef") > 0)
    AND ("permissionFingerprint" IS NULL OR char_length("permissionFingerprint") > 0)
    AND (
      ("targetType" = 'DOCUMENT_REVISION' AND "v2DocumentRevisionId" IS NOT NULL AND "itemVersionHash" IS NOT NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NULL AND "messageId" IS NULL AND "toolResultRef" IS NULL AND "externalReferenceHash" IS NULL)
      OR ("targetType" = 'FACT_VERSION' AND "v2DocumentRevisionId" IS NULL AND "itemVersionHash" IS NOT NULL AND "factVersionId" IS NOT NULL AND "guidanceRuleVersionId" IS NULL AND "messageId" IS NULL AND "toolResultRef" IS NULL AND "externalReferenceHash" IS NULL)
      OR ("targetType" = 'GUIDANCE_RULE_VERSION' AND "v2DocumentRevisionId" IS NULL AND "itemVersionHash" IS NOT NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NOT NULL AND "messageId" IS NULL AND "toolResultRef" IS NULL AND "externalReferenceHash" IS NULL)
      OR ("targetType" = 'MESSAGE' AND "v2DocumentRevisionId" IS NULL AND "itemVersionHash" IS NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NULL AND "messageId" IS NOT NULL AND "toolResultRef" IS NULL AND "externalReferenceHash" IS NULL)
      OR ("targetType" = 'TOOL_RESULT' AND "v2DocumentRevisionId" IS NULL AND "itemVersionHash" IS NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NULL AND "messageId" IS NULL AND "toolResultRef" IS NOT NULL AND char_length("toolResultRef") > 0 AND "externalReferenceHash" IS NULL)
      OR ("targetType" = 'EXTERNAL_REFERENCE' AND "v2DocumentRevisionId" IS NULL AND "itemVersionHash" IS NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NULL AND "messageId" IS NULL AND "toolResultRef" IS NULL AND "externalReferenceHash" IS NOT NULL AND char_length("externalReferenceHash") > 0)
    )
  );

ALTER TABLE "KnowledgeV2Conflict"
  ADD CONSTRAINT "KnowledgeV2Conflict_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("conflictKey") > 0
    AND char_length("semanticKey") > 0
    AND char_length("scopeHash") > 0
    AND char_length("candidateSetHash") > 0
    AND "etag" > 0
    AND "generation" > 0
    AND ("factId" IS NULL OR "guidanceRuleId" IS NULL)
    AND ("effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND (("assignedToUserId" IS NULL AND "assignedAt" IS NULL) OR ("assignedToUserId" IS NOT NULL AND "assignedAt" IS NOT NULL))
    AND (
      ("status" = 'RESOLVED' AND "resolution" IS NOT NULL AND "resolution" <> 'DISMISS' AND "resolutionRationaleHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" = 'DISMISSED' AND "resolution" = 'DISMISS' AND "resolutionRationaleHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" IN ('OPEN', 'IN_REVIEW', 'SUPERSEDED') AND "resolution" IS NULL AND "resolutionRationaleHash" IS NULL AND "restrictedResolutionRef" IS NULL AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL)
    )
    AND ("restrictedResolutionRef" IS NULL OR char_length("restrictedResolutionRef") > 0)
  );

ALTER TABLE "KnowledgeV2ConflictCandidate"
  ADD CONSTRAINT "KnowledgeV2ConflictCandidate_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("candidateKey") > 0
    AND "ordinal" >= 0
    AND char_length("itemVersionHash") > 0
    AND char_length("candidateValueHash") > 0
    AND ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
    AND ("effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND ("restrictedValueRef" IS NULL OR char_length("restrictedValueRef") > 0)
    AND (
      ("candidateType" = 'DOCUMENT_REVISION' AND "v2DocumentRevisionId" IS NOT NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NULL)
      OR ("candidateType" = 'FACT_VERSION' AND "v2DocumentRevisionId" IS NULL AND "factVersionId" IS NOT NULL AND "guidanceRuleVersionId" IS NULL)
      OR ("candidateType" = 'GUIDANCE_RULE_VERSION' AND "v2DocumentRevisionId" IS NULL AND "factVersionId" IS NULL AND "guidanceRuleVersionId" IS NOT NULL)
    )
  );

ALTER TABLE "KnowledgeV2ConflictCandidateEvidence"
  ADD CONSTRAINT "KnowledgeV2ConflictEvidence_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "ordinal" >= 0
    AND ("relevanceScore" IS NULL OR ("relevanceScore" >= 0 AND "relevanceScore" <= 1))
  );

ALTER TABLE "KnowledgeV2ReviewItem"
  ADD CONSTRAINT "KnowledgeV2ReviewItem_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("reviewKey") > 0
    AND char_length("safeTitle") > 0
    AND "etag" > 0
    AND "generation" > 0
    AND (("assignedToUserId" IS NULL AND "assignedAt" IS NULL) OR ("assignedToUserId" IS NOT NULL AND "assignedAt" IS NOT NULL))
    AND ("status" <> 'ASSIGNED' OR "assignedToUserId" IS NOT NULL)
    AND (("sourceId" IS NOT NULL)::INTEGER + ("v2DocumentRevisionId" IS NOT NULL)::INTEGER + ("factId" IS NOT NULL)::INTEGER + ("guidanceRuleId" IS NOT NULL)::INTEGER + ("conflictId" IS NOT NULL)::INTEGER + ("evaluationResultId" IS NOT NULL)::INTEGER + ("feedbackId" IS NOT NULL)::INTEGER + ("publicationId" IS NOT NULL)::INTEGER) >= 1
    AND (
      ("status" = 'RESOLVED' AND "resolutionAction" IS NOT NULL AND "resolutionAction" <> 'DISMISS' AND "resolutionSummaryHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" = 'DISMISSED' AND "resolutionAction" = 'DISMISS' AND "resolutionSummaryHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" IN ('OPEN', 'ASSIGNED', 'IN_REVIEW', 'SUPERSEDED') AND "resolutionAction" IS NULL AND "resolutionSummaryHash" IS NULL AND "restrictedResolutionRef" IS NULL AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL)
    )
    AND ("restrictedPayloadRef" IS NULL OR char_length("restrictedPayloadRef") > 0)
    AND ("restrictedResolutionRef" IS NULL OR char_length("restrictedResolutionRef") > 0)
  );

ALTER TABLE "KnowledgeV2ReviewItemEvidence"
  ADD CONSTRAINT "KnowledgeV2ReviewEvidence_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "ordinal" >= 0
    AND ("relevanceScore" IS NULL OR ("relevanceScore" >= 0 AND "relevanceScore" <= 1))
  );

ALTER TABLE "KnowledgeV2TestCase"
  ADD CONSTRAINT "KnowledgeV2TestCase_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("caseKey") > 0
    AND char_length("safeLabel") > 0
    AND "latestVersionNumber" >= 0
    AND "etag" > 0
    AND ("status" <> 'ACTIVE' OR ("currentVersionId" IS NOT NULL AND "latestVersionNumber" > 0))
    AND (("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL) OR ("status" <> 'ARCHIVED' AND "archivedAt" IS NULL AND "archivedByUserId" IS NULL))
  );

ALTER TABLE "KnowledgeV2TestCaseVersion"
  ADD CONSTRAINT "KnowledgeV2TestCaseVersion_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "versionNumber" > 0
    AND char_length("queryHash") > 0
    AND char_length("restrictedInputRef") > 0
    AND char_length("locale") > 0
    AND char_length("datasetVersion") > 0
    AND char_length("immutableHash") > 0
    AND ("supersedesVersionId" IS NULL OR "supersedesVersionId" <> "id")
  );

ALTER TABLE "KnowledgeV2TestExpectation"
  ADD CONSTRAINT "KnowledgeV2TestExpectation_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "ordinal" >= 0
    AND ("restrictedExpectedRef" IS NULL OR char_length("restrictedExpectedRef") > 0)
    AND (
      ("kind" IN ('REQUIRED_FACT', 'FORBIDDEN_FACT') AND "factId" IS NOT NULL AND "guidanceRuleId" IS NULL AND "evidenceReferenceId" IS NULL AND "semanticKey" IS NULL)
      OR ("kind" IN ('REQUIRED_GUIDANCE', 'FORBIDDEN_GUIDANCE') AND "factId" IS NULL AND "guidanceRuleId" IS NOT NULL AND "evidenceReferenceId" IS NULL AND "semanticKey" IS NULL)
      OR ("kind" = 'REQUIRED_EVIDENCE' AND "factId" IS NULL AND "guidanceRuleId" IS NULL AND "evidenceReferenceId" IS NOT NULL AND "semanticKey" IS NULL)
      OR ("kind" IN ('FORBIDDEN_CLAIM', 'REQUIRED_TOOL', 'FORBIDDEN_TOOL') AND "factId" IS NULL AND "guidanceRuleId" IS NULL AND "evidenceReferenceId" IS NULL AND "semanticKey" IS NOT NULL AND char_length("semanticKey") > 0)
    )
  );

ALTER TABLE "KnowledgeV2EvaluationRun"
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
  ADD CONSTRAINT "KnowledgeV2EvaluationResult_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("resultKey") > 0
    AND "repeatIndex" >= 0
    AND char_length("metricManifestHash") > 0
    AND char_length("evidenceManifestHash") > 0
    AND ("status" IN ('ERROR', 'SKIPPED') OR "observedBehavior" IS NOT NULL)
    AND ("status" <> 'ERROR' OR "errorCode" IS NOT NULL)
    AND ("restrictedResultRef" IS NULL OR (char_length("restrictedResultRef") > 0 AND "responseHash" IS NOT NULL))
    AND ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("costMicros" IS NULL OR "costMicros" >= 0)
  );

ALTER TABLE "KnowledgeV2EvaluationMetric"
  ADD CONSTRAINT "KnowledgeV2EvaluationMetric_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("metricKey") > 0
    AND ("value" IS NOT NULL OR "numerator" IS NOT NULL)
    AND ("denominator" IS NULL OR "denominator" > 0)
    AND (("threshold" IS NULL AND "comparator" IS NULL) OR ("threshold" IS NOT NULL AND "comparator" IS NOT NULL))
    AND ("sampleCount" IS NULL OR "sampleCount" >= 0)
    AND ("confidenceLower" IS NULL OR ("confidenceLower" >= 0 AND "confidenceLower" <= 1))
    AND ("confidenceUpper" IS NULL OR ("confidenceUpper" >= 0 AND "confidenceUpper" <= 1))
    AND ("confidenceLower" IS NULL OR "confidenceUpper" IS NULL OR "confidenceLower" <= "confidenceUpper")
  );

ALTER TABLE "KnowledgeV2EvaluationResultEvidence"
  ADD CONSTRAINT "KnowledgeV2EvaluationEvidence_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "ordinal" >= 0
    AND ("relevanceScore" IS NULL OR ("relevanceScore" >= 0 AND "relevanceScore" <= 1))
  );

ALTER TABLE "KnowledgeV2Feedback"
  ADD CONSTRAINT "KnowledgeV2Feedback_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("feedbackKey") > 0
    AND "actorUserId" IS NOT NULL
    AND (("responseMessageId" IS NOT NULL)::INTEGER + ("evaluationRunId" IS NOT NULL)::INTEGER + ("evaluationResultId" IS NOT NULL)::INTEGER + ("publicationId" IS NOT NULL)::INTEGER + ("retrievalTraceId" IS NOT NULL)::INTEGER) >= 1
    AND ("evaluationResultId" IS NULL OR "evaluationRunId" IS NOT NULL)
    AND (("noteHash" IS NULL AND "restrictedNoteRef" IS NULL) OR ("noteHash" IS NOT NULL AND ("restrictedNoteRef" IS NULL OR char_length("restrictedNoteRef") > 0)))
    AND (("assignedToUserId" IS NULL AND "assignedAt" IS NULL) OR ("assignedToUserId" IS NOT NULL AND "assignedAt" IS NOT NULL))
    AND (
      ("status" = 'RESOLVED' AND "resolutionAction" IS NOT NULL AND "resolutionAction" <> 'DISMISS' AND "resolutionSummaryHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" = 'DISMISSED' AND "resolutionAction" = 'DISMISS' AND "resolutionSummaryHash" IS NOT NULL AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
      OR ("status" IN ('OPEN', 'IN_REVIEW') AND "resolutionAction" IS NULL AND "resolutionSummaryHash" IS NULL AND "restrictedResolutionRef" IS NULL AND "resolvedByUserId" IS NULL AND "resolvedAt" IS NULL)
    )
    AND ("restrictedResolutionRef" IS NULL OR char_length("restrictedResolutionRef") > 0)
    AND (
      ("correctionTargetType" IS NULL AND "sourceId" IS NULL AND "v2DocumentRevisionId" IS NULL AND "factId" IS NULL AND "guidanceRuleId" IS NULL)
      OR ("correctionTargetType" = 'SOURCE' AND "sourceId" IS NOT NULL AND "v2DocumentRevisionId" IS NULL AND "factId" IS NULL AND "guidanceRuleId" IS NULL)
      OR ("correctionTargetType" = 'DOCUMENT_REVISION' AND "sourceId" IS NULL AND "v2DocumentRevisionId" IS NOT NULL AND "factId" IS NULL AND "guidanceRuleId" IS NULL)
      OR ("correctionTargetType" = 'FACT' AND "sourceId" IS NULL AND "v2DocumentRevisionId" IS NULL AND "factId" IS NOT NULL AND "guidanceRuleId" IS NULL)
      OR ("correctionTargetType" = 'GUIDANCE_RULE' AND "sourceId" IS NULL AND "v2DocumentRevisionId" IS NULL AND "factId" IS NULL AND "guidanceRuleId" IS NOT NULL)
      OR ("correctionTargetType" IN ('MARK_UNANSWERABLE', 'REQUIRE_HANDOFF') AND "sourceId" IS NULL AND "v2DocumentRevisionId" IS NULL AND "factId" IS NULL AND "guidanceRuleId" IS NULL)
    )
  );

ALTER TABLE "KnowledgeV2FeedbackEvidence"
  ADD CONSTRAINT "KnowledgeV2FeedbackEvidence_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND "ordinal" >= 0
    AND ("relevanceScore" IS NULL OR ("relevanceScore" >= 0 AND "relevanceScore" <= 1))
  );

ALTER TABLE "KnowledgeV2RetrievalTrace"
  ADD CONSTRAINT "KnowledgeV2RetrievalTrace_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("traceKey") > 0
    AND char_length("targetKey") > 0
    AND char_length("queryHash") > 0
    AND char_length("restrictedQueryRef") > 0
    AND char_length("filtersHash") > 0
    AND char_length("permissionFingerprint") > 0
    AND char_length("retrievalPolicyVersion") > 0
    AND char_length("promptPolicyVersion") > 0
    AND char_length("graphVersion") > 0
    AND char_length("retrievalCandidateManifestHash") > 0
    AND char_length("citationManifestHash") > 0
    AND char_length("retentionClass") > 0
    AND "candidateCount" >= 0
    AND "selectedCount" >= 0
    AND "selectedCount" <= "candidateCount"
    AND "retentionExpiresAt" > "createdAt"
    AND ("responseMessageId" IS NOT NULL OR "evaluationRunId" IS NOT NULL)
    AND ("evaluationResultId" IS NULL OR "evaluationRunId" IS NOT NULL)
    AND ("restrictedTraceRef" IS NULL OR char_length("restrictedTraceRef") > 0)
    AND ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("costMicros" IS NULL OR "costMicros" >= 0)
    AND (
      ("snapshotKind" = 'PUBLICATION' AND "publicationId" IS NOT NULL AND "candidateId" IS NULL AND "candidateVersion" IS NULL AND "candidateManifestHash" IS NULL)
      OR ("snapshotKind" = 'DRAFT_CANDIDATE' AND "publicationId" IS NULL AND "candidateId" IS NOT NULL AND char_length("candidateId") > 0 AND "candidateVersion" > 0 AND "candidateManifestHash" IS NOT NULL AND char_length("candidateManifestHash") > 0)
    )
  );

ALTER TABLE "KnowledgeV2RetrievalCandidate"
  ADD CONSTRAINT "KnowledgeV2RetrievalCandidate_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("candidateKey") > 0
    AND ("denseRank" IS NOT NULL OR "sparseRank" IS NOT NULL OR "fusedRank" IS NOT NULL OR "rerankRank" IS NOT NULL)
    AND ("denseRank" IS NULL OR "denseRank" > 0)
    AND ("sparseRank" IS NULL OR "sparseRank" > 0)
    AND ("fusedRank" IS NULL OR "fusedRank" > 0)
    AND ("rerankRank" IS NULL OR "rerankRank" > 0)
    AND (("selected" AND "rejectionReason" IS NULL) OR (NOT "selected" AND "rejectionReason" IS NOT NULL))
  );

ALTER TABLE "KnowledgeV2Citation"
  ADD CONSTRAINT "KnowledgeV2Citation_values_check" CHECK (
    "corpusKind" = 'STRUCTURED_V2'
    AND char_length("citationKey") > 0
    AND "ordinal" >= 0
    AND char_length("claimHash") > 0
    AND ("restrictedClaimRef" IS NULL OR char_length("restrictedClaimRef") > 0)
    AND ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
    AND ("toolObservedAt" IS NULL OR "toolExpiresAt" IS NULL OR "toolExpiresAt" > "toolObservedAt")
  );

CREATE OR REPLACE FUNCTION "KnowledgeV2_reject_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_audit_immutable$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'knowledge audit record in % is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'knowledge audit record in % cannot be deleted directly', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$knowledge_v2_audit_immutable$;

CREATE TRIGGER "KnowledgeV2EvidenceReference_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2EvidenceReference" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2ConflictCandidate_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2ConflictCandidate" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2ConflictEvidence_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2ConflictCandidateEvidence" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2ReviewEvidence_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2ReviewItemEvidence" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2TestCaseVersion_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2TestCaseVersion" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2TestExpectation_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2TestExpectation" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2EvaluationResult_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2EvaluationResult" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2EvaluationMetric_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2EvaluationMetric" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2EvaluationEvidence_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2EvaluationResultEvidence" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2FeedbackEvidence_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2FeedbackEvidence" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2RetrievalTrace_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2RetrievalTrace" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2RetrievalCandidate_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2RetrievalCandidate" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
CREATE TRIGGER "KnowledgeV2Citation_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeV2Citation" FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_audit_mutation"();
