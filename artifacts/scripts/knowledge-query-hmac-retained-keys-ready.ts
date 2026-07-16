import { prisma, Prisma } from "@leadvirt/db";
import { createKnowledgeV2QueryHashKeyringFromEnvironment } from "@leadvirt/knowledge";

const advisoryLockName = "leadvirt.knowledge-query-hmac-key-registry.v1";

async function main() {
  const keyring = createKnowledgeV2QueryHashKeyringFromEnvironment(process.env);
  const configuredChecks = new Map(
    keyring.configuredKeyChecks.map((check) => [check.keyId, check] as const),
  );

  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${advisoryLockName}, 0))
      `;

      const legacyCounts = {
        testCaseVersions: await transaction.knowledgeV2TestCaseVersion.count({
          where: { queryHashKeyId: null },
        }),
        evaluationRuns: await transaction.knowledgeV2EvaluationRun.count({
          where: { queryHash: { not: null }, queryHashKeyId: null },
        }),
        retrievalTraces: await transaction.knowledgeV2RetrievalTrace.count({
          where: { queryHashKeyId: null },
        }),
        liveToolExecutions: await transaction.knowledgeV2LiveToolExecution.count({
          where: { queryHashKeyId: null },
        }),
      };
      const legacyTotal = Object.values(legacyCounts).reduce((sum, count) => sum + count, 0);
      if (legacyTotal > 0) {
        throw new Error(
          [
            `Legacy query hashes without HMAC key metadata must be remediated before deploy (${legacyTotal} total)`,
            `KnowledgeV2TestCaseVersion=${legacyCounts.testCaseVersions}`,
            `KnowledgeV2EvaluationRun=${legacyCounts.evaluationRuns}`,
            `KnowledgeV2RetrievalTrace=${legacyCounts.retrievalTraces}`,
            `KnowledgeV2LiveToolExecution=${legacyCounts.liveToolExecutions}`,
          ].join("; "),
        );
      }

      const retainedGroups = await Promise.all([
        transaction.knowledgeV2TestCaseVersion.findMany({
          where: { queryHashKeyId: { not: null } },
          select: { queryHashKeyId: true },
          distinct: ["queryHashKeyId"],
        }),
        transaction.knowledgeV2EvaluationRun.findMany({
          where: { queryHashKeyId: { not: null } },
          select: { queryHashKeyId: true },
          distinct: ["queryHashKeyId"],
        }),
        transaction.knowledgeV2RetrievalTrace.findMany({
          where: { queryHashKeyId: { not: null } },
          select: { queryHashKeyId: true },
          distinct: ["queryHashKeyId"],
        }),
        transaction.knowledgeV2LiveToolExecution.findMany({
          where: { queryHashKeyId: { not: null } },
          select: { queryHashKeyId: true },
          distinct: ["queryHashKeyId"],
        }),
      ]);
      const retained = new Set<string>();
      for (const group of retainedGroups) {
        for (const row of group) {
          if (row.queryHashKeyId) retained.add(row.queryHashKeyId);
        }
      }

      const missingVerifierIds = [...retained]
        .filter((keyId) => !configuredChecks.has(keyId))
        .sort();
      if (missingVerifierIds.length > 0) {
        throw new Error(
          `Missing query HMAC verifier keys required by retained records: ${missingVerifierIds.join(", ")}`,
        );
      }

      const registryRows = await transaction.knowledgeV2QueryHashKeyRegistry.findMany({
        where: { keyId: { in: keyring.verificationKeyIds } },
      });
      const registry = new Map(registryRows.map((row) => [row.keyId, row] as const));
      const mismatchedRegistryIds = keyring.configuredKeyChecks
        .filter((check) => {
          const row = registry.get(check.keyId);
          return Boolean(
            row && (row.queryHashVersion !== check.version || row.keyCheck !== check.keyCheck),
          );
        })
        .map(({ keyId }) => keyId)
        .sort();
      if (mismatchedRegistryIds.length > 0) {
        throw new Error(
          `Query HMAC key material does not match the immutable registry for key IDs: ${mismatchedRegistryIds.join(", ")}`,
        );
      }

      const unregisteredRetainedIds = [...retained].filter((keyId) => !registry.has(keyId)).sort();
      if (unregisteredRetainedIds.length > 0) {
        throw new Error(
          `Retained query hashes reference unregistered HMAC key IDs; refusing first-use adoption: ${unregisteredRetainedIds.join(", ")}`,
        );
      }

      const registrations = keyring.configuredKeyChecks.filter(
        ({ keyId }) => !registry.has(keyId) && !retained.has(keyId),
      );
      if (registrations.length > 0) {
        await transaction.knowledgeV2QueryHashKeyRegistry.createMany({
          data: registrations.map((check) => ({
            keyId: check.keyId,
            queryHashVersion: check.version,
            keyCheck: check.keyCheck,
          })),
        });
      }

      return { retainedCount: retained.size, registeredCount: registrations.length };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  console.log(
    `Knowledge query HMAC readiness passed (${result.retainedCount} retained key IDs, ${result.registeredCount} new registry entries).`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Query HMAC readiness failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
