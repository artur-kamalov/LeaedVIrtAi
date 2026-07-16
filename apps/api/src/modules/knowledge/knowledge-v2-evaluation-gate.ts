import { HttpStatus } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import { compareKnowledgeCanonicalText } from "@leadvirt/knowledge";
import { canonicalKnowledgeV2Hash, knowledgeV2Error } from "./knowledge-v2-http.js";
import { canonicalKnowledgeV2Locale } from "./knowledge-v2-scope.js";

export async function knowledgeV2CurrentEvaluationSet(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  const testCases = await tx.knowledgeV2TestCase.findMany({
    where: {
      tenantId,
      corpusKind: "STRUCTURED_V2",
      status: "ACTIVE",
      currentVersionId: { not: null },
    },
    select: {
      id: true,
      caseKey: true,
      critical: true,
      currentVersionId: true,
      currentVersion: {
        select: {
          immutableHash: true,
          locale: true,
          queryHash: true,
          queryHashKeyId: true,
          queryHashVersion: true,
        },
      },
    },
    orderBy: [{ caseKey: "asc" }, { id: "asc" }],
  });
  const cases = testCases.map((testCase) => {
    if (!testCase.currentVersionId || !testCase.currentVersion) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED",
        "The current knowledge evaluation test set is inconsistent.",
      );
    }
    return {
      testCaseId: testCase.id,
      testCaseVersionId: testCase.currentVersionId,
      immutableHash: testCase.currentVersion.immutableHash,
      queryHash: testCase.currentVersion.queryHash,
      queryHashKeyId: testCase.currentVersion.queryHashKeyId,
      queryHashVersion: testCase.currentVersion.queryHashVersion,
      locale: canonicalKnowledgeV2Locale(testCase.currentVersion.locale),
      critical: testCase.critical,
    };
  });
  return {
    cases,
    testCaseSetHash: canonicalKnowledgeV2Hash(
      cases.map(
        ({
          testCaseId,
          testCaseVersionId,
          immutableHash,
          queryHash,
          queryHashKeyId,
          queryHashVersion,
        }) => ({
          testCaseId,
          testCaseVersionId,
          immutableHash,
          queryHash,
          queryHashKeyId,
          queryHashVersion,
        }),
      ),
    ),
  };
}

export async function assertKnowledgeV2PublicationEvaluationGate(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash: string;
  },
) {
  const currentSet = await knowledgeV2CurrentEvaluationSet(tx, input.tenantId);
  const current = currentSet.cases;
  const critical = current.filter((testCase) => testCase.critical);
  if (critical.length === 0) return;
  const byLocale = new Map<string, typeof critical>();
  for (const testCase of critical) {
    byLocale.set(testCase.locale, [...(byLocale.get(testCase.locale) ?? []), testCase]);
  }
  const localeRequirements = [...byLocale].sort(([left], [right]) =>
    compareKnowledgeCanonicalText(left, right),
  );
  const testCaseSetHash = currentSet.testCaseSetHash;
  const passedRun = await tx.knowledgeV2EvaluationRun.findFirst({
    where: {
      tenantId: input.tenantId,
      corpusKind: "STRUCTURED_V2",
      runKind: "PUBLICATION",
      status: "SUCCEEDED",
      completedAt: { not: null },
      snapshotKind: "DRAFT_CANDIDATE",
      targetKey: "workspace-v2",
      candidateId: input.candidateId,
      candidateVersion: input.candidateVersion,
      candidateManifestHash: input.candidateManifestHash,
      testCaseSetHash,
      AND: localeRequirements.map(([, testCasesForLocale]) => ({
        AND: testCasesForLocale.map((testCase) => ({
          results: {
            some: {
              tenantId: input.tenantId,
              testCaseVersionId: testCase.testCaseVersionId,
              status: "PASSED",
            },
          },
        })),
      })),
    },
    select: { id: true },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
  });
  if (!passedRun) {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED",
      "Run and pass the current critical knowledge tests for this exact publication candidate.",
      {
        details: {
          criticalCount: critical.length,
          criticalLocales: localeRequirements.map(([locale]) => locale),
          testCaseSetHash,
        },
      },
    );
  }
}
