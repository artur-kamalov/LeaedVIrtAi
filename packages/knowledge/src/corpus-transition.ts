import { Prisma } from "@leadvirt/db";

export async function lockKnowledgeCorpusTransition(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT TRUE AS "locked"
    FROM (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`knowledge-v2:corpus-transition:${tenantId}`}, 0)
      )
    ) AS corpus_transition_lock
  `);
}
