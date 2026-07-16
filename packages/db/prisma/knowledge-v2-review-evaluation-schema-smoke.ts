import type { Prisma } from "@prisma/client";

const tenantId = "tenant";
const corpusKind = "STRUCTURED_V2" as const;
const conflictId = "conflict";
const candidateId = "candidate";
const evidenceId = "evidence";
const reviewItemId = "review";
const testCaseId = "test-case";
const testCaseVersionId = "test-case-version";
const evaluationRunId = "evaluation-run";
const evaluationResultId = "evaluation-result";
const feedbackId = "feedback";
const retrievalTraceId = "retrieval-trace";

export const evidenceIdentity = {
  tenantId_evidenceKey: { tenantId, evidenceKey: "evidence-key" },
} satisfies Prisma.KnowledgeV2EvidenceReferenceWhereUniqueInput;

export const conflictIdentity = {
  tenantId_conflictKey: { tenantId, conflictKey: "conflict-key" },
} satisfies Prisma.KnowledgeV2ConflictWhereUniqueInput;

export const conflictCandidateIdentity = {
  tenantId_conflictId_candidateKey: { tenantId, conflictId, candidateKey: "candidate-key" },
} satisfies Prisma.KnowledgeV2ConflictCandidateWhereUniqueInput;

export const reviewIdentity = {
  tenantId_reviewKey: { tenantId, reviewKey: "review-key" },
} satisfies Prisma.KnowledgeV2ReviewItemWhereUniqueInput;

export const testCaseIdentity = {
  tenantId_caseKey: { tenantId, caseKey: "case-key" },
} satisfies Prisma.KnowledgeV2TestCaseWhereUniqueInput;

export const testCaseVersionIdentity = {
  tenantId_testCaseId_id: { tenantId, testCaseId, id: testCaseVersionId },
} satisfies Prisma.KnowledgeV2TestCaseVersionWhereUniqueInput;

export const evaluationRunIdentity = {
  tenantId_runKey: { tenantId, runKey: "run-key" },
} satisfies Prisma.KnowledgeV2EvaluationRunWhereUniqueInput;

export const exactEvaluationResultIdentity = {
  tenantId_id_evaluationRunId_corpusKind: {
    tenantId,
    id: evaluationResultId,
    evaluationRunId,
    corpusKind,
  },
} satisfies Prisma.KnowledgeV2EvaluationResultWhereUniqueInput;

export const feedbackIdentity = {
  tenantId_feedbackKey: { tenantId, feedbackKey: "feedback-key" },
} satisfies Prisma.KnowledgeV2FeedbackWhereUniqueInput;

export const retrievalTraceIdentity = {
  tenantId_traceKey: { tenantId, traceKey: "trace-key" },
} satisfies Prisma.KnowledgeV2RetrievalTraceWhereUniqueInput;

export const citationIdentity = {
  tenantId_citationKey: { tenantId, citationKey: "citation-key" },
} satisfies Prisma.KnowledgeV2CitationWhereUniqueInput;

export const evidenceCreate = {
  tenantId,
  corpusKind,
  evidenceKey: "evidence-key",
  targetType: "EXTERNAL_REFERENCE",
  externalReferenceHash: "external-reference-hash",
  safeLabel: "External policy",
} satisfies Prisma.KnowledgeV2EvidenceReferenceUncheckedCreateInput;

export const conflictCreate = {
  tenantId,
  corpusKind,
  conflictKey: "conflict-key",
  conflictType: "FACT_VALUE",
  semanticKey: "business/hours",
  scopeHash: "scope-hash",
  severity: "HIGH",
  candidateSetHash: "candidate-set-hash",
} satisfies Prisma.KnowledgeV2ConflictUncheckedCreateInput;

export const conflictCandidateCreate = {
  tenantId,
  corpusKind,
  conflictId,
  candidateKey: "candidate-key",
  ordinal: 0,
  candidateType: "FACT_VERSION",
  itemVersionHash: "fact-version-hash",
  factVersionId: "fact-version",
  candidateValueHash: "candidate-value-hash",
} satisfies Prisma.KnowledgeV2ConflictCandidateUncheckedCreateInput;

export const conflictEvidenceCreate = {
  tenantId,
  corpusKind,
  conflictCandidateId: candidateId,
  evidenceReferenceId: evidenceId,
  ordinal: 0,
} satisfies Prisma.KnowledgeV2ConflictCandidateEvidenceUncheckedCreateInput;

export const reviewItemCreate = {
  tenantId,
  corpusKind,
  reviewKey: "review-key",
  reason: "CONFLICTING_VALUES",
  riskLevel: "HIGH",
  suggestedAction: "REVIEW_VALUE",
  safeTitle: "Review business hours",
  conflictId,
} satisfies Prisma.KnowledgeV2ReviewItemUncheckedCreateInput;

export const reviewEvidenceCreate = {
  tenantId,
  corpusKind,
  reviewItemId,
  evidenceReferenceId: evidenceId,
  ordinal: 0,
} satisfies Prisma.KnowledgeV2ReviewItemEvidenceUncheckedCreateInput;

export const testCaseCreate = {
  tenantId,
  corpusKind,
  caseKey: "case-key",
  safeLabel: "Business hours question",
  origin: "TENANT",
  riskLevel: "HIGH",
  critical: true,
} satisfies Prisma.KnowledgeV2TestCaseUncheckedCreateInput;

export const testCaseVersionCreate = {
  tenantId,
  corpusKind,
  testCaseId,
  versionNumber: 1,
  queryHash: "a".repeat(64),
  queryHashKeyId: "schema-smoke-key-v1",
  queryHashVersion: "knowledge-query-hmac-sha256-v1",
  restrictedInputRef: "restricted://tests/case-key/1",
  expectedBehavior: "ANSWER",
  locale: "en",
  channelType: "WEBSITE",
  audience: "PUBLIC",
  datasetVersion: "dataset-v1",
  immutableHash: "test-case-version-hash",
} satisfies Prisma.KnowledgeV2TestCaseVersionUncheckedCreateInput;

export const testExpectationCreate = {
  tenantId,
  corpusKind,
  testCaseVersionId,
  ordinal: 0,
  kind: "REQUIRED_FACT",
  factId: "fact",
} satisfies Prisma.KnowledgeV2TestExpectationUncheckedCreateInput;

export const evaluationRunCreate = {
  tenantId,
  corpusKind,
  runKey: "run-key",
  runKind: "DEPLOY",
  snapshotKind: "DRAFT_CANDIDATE",
  candidateId: "candidate-snapshot",
  candidateVersion: 1,
  candidateManifestHash: "candidate-manifest-hash",
  datasetVersion: "dataset-v1",
  testCaseSetHash: "test-case-set-hash",
  configHash: "config-hash",
  retrievalPolicyVersion: "retrieval-v1",
  promptPolicyVersion: "prompt-v1",
  graphVersion: "graph-v1",
  codeCommit: "commit-sha",
  environment: "smoke",
} satisfies Prisma.KnowledgeV2EvaluationRunUncheckedCreateInput;

export const evaluationResultCreate = {
  tenantId,
  corpusKind,
  resultKey: "result-key",
  evaluationRunId,
  testCaseVersionId,
  status: "PASSED",
  expectedBehavior: "ANSWER",
  observedBehavior: "ANSWER",
  responseHash: "a".repeat(64),
  restrictedResultRef: "restricted://evaluation/result-key",
  restrictedResultHash: "b".repeat(64),
  metricManifestHash: "metric-manifest-hash",
  evidenceManifestHash: "evidence-manifest-hash",
} satisfies Prisma.KnowledgeV2EvaluationResultUncheckedCreateInput;

export const evaluationMetricCreate = {
  tenantId,
  corpusKind,
  evaluationResultId,
  metricKey: "retrieval.recall",
  category: "RETRIEVAL",
  value: 1,
  threshold: 0.9,
  comparator: "GREATER_THAN_OR_EQUAL",
  status: "PASSED",
} satisfies Prisma.KnowledgeV2EvaluationMetricUncheckedCreateInput;

export const evaluationEvidenceCreate = {
  tenantId,
  corpusKind,
  evaluationResultId,
  evidenceReferenceId: evidenceId,
  ordinal: 0,
} satisfies Prisma.KnowledgeV2EvaluationResultEvidenceUncheckedCreateInput;

export const feedbackCreate = {
  tenantId,
  corpusKind,
  feedbackKey: "feedback-key",
  category: "INCORRECT_ANSWER",
  evaluationRunId,
  evaluationResultId,
  noteHash: "feedback-note-hash",
  restrictedNoteRef: "restricted://feedback/feedback-key",
} satisfies Prisma.KnowledgeV2FeedbackUncheckedCreateInput;

export const feedbackEvidenceCreate = {
  tenantId,
  corpusKind,
  feedbackId,
  evidenceReferenceId: evidenceId,
  ordinal: 0,
} satisfies Prisma.KnowledgeV2FeedbackEvidenceUncheckedCreateInput;

export const retrievalTraceCreate = {
  tenantId,
  corpusKind,
  traceKey: "trace-key",
  snapshotKind: "DRAFT_CANDIDATE",
  candidateId: "candidate-snapshot",
  candidateVersion: 1,
  candidateManifestHash: "candidate-manifest-hash",
  evaluationRunId,
  evaluationResultId,
  queryHash: "b".repeat(64),
  queryHashKeyId: "schema-smoke-key-v1",
  queryHashVersion: "knowledge-query-hmac-sha256-v1",
  restrictedQueryRef: "restricted://traces/trace-key/query",
  filters: {},
  filtersHash: "filters-hash",
  permissionFingerprint: "permission-fingerprint",
  retrievalPolicyVersion: "retrieval-v1",
  promptPolicyVersion: "prompt-v1",
  graphVersion: "graph-v1",
  outcome: "ANSWERED",
  gateOutcome: "AUTO_SEND",
  retrievalCandidateManifestHash: "candidate-result-manifest-hash",
  citationManifestHash: "citation-manifest-hash",
  retentionClass: "evaluation",
  retentionExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
} satisfies Prisma.KnowledgeV2RetrievalTraceUncheckedCreateInput;

export const retrievalCandidateCreate = {
  tenantId,
  corpusKind,
  retrievalTraceId,
  candidateKey: "retrieval-candidate-key",
  evidenceReferenceId: evidenceId,
  fusedRank: 1,
  fusedScore: 0.99,
  selected: true,
} satisfies Prisma.KnowledgeV2RetrievalCandidateUncheckedCreateInput;

export const citationCreate = {
  tenantId,
  corpusKind,
  citationKey: "citation-key",
  retrievalTraceId,
  evidenceReferenceId: evidenceId,
  ordinal: 0,
  claimHash: "claim-hash",
  support: "SUPPORTS",
  confidence: 0.99,
} satisfies Prisma.KnowledgeV2CitationUncheckedCreateInput;
