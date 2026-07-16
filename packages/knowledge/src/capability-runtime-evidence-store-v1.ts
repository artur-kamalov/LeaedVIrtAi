import { Prisma, type PrismaClient } from "@leadvirt/db";
import { projectKnowledgeOperationalCapabilitiesV1 } from "./capability-runtime-evidence-v1.js";

interface OperationalAuthorizationRow {
  tenantId: string;
  permissionGeneration: number;
  updatedAt: Date;
}

interface OperationalConnectionRow {
  id: string;
  provider: string;
  status: string;
  permissionVersion: number;
  credentialsConfigured: boolean;
  updatedAt: Date;
}

export async function loadKnowledgeOperationalCapabilityProjectionV1(
  tx: Prisma.TransactionClient | PrismaClient,
  input: { tenantId: string; evaluatedAt?: Date; lock?: boolean },
) {
  const lock = input.lock ? Prisma.sql`FOR SHARE` : Prisma.empty;
  const authorizationRows = await tx.$queryRaw<OperationalAuthorizationRow[]>(Prisma.sql`
    SELECT "tenantId", "permissionGeneration", "updatedAt"
    FROM "TenantOperationalAuthorizationState"
    WHERE "tenantId" = ${input.tenantId}
    ${lock}
  `);
  const connections = await tx.$queryRaw<OperationalConnectionRow[]>(Prisma.sql`
    SELECT
      "id",
      "provider"::text AS "provider",
      "status"::text AS "status",
      "permissionVersion",
      ("encryptedCredentials" IS NOT NULL) AS "credentialsConfigured",
      "updatedAt"
    FROM "IntegrationAccount"
    WHERE "tenantId" = ${input.tenantId}
      AND "deletedAt" IS NULL
    ORDER BY "id"
  `);

  return projectKnowledgeOperationalCapabilitiesV1({
    tenantId: input.tenantId,
    evaluatedAt: input.evaluatedAt ?? new Date(),
    authorizationState: authorizationRows[0] ?? null,
    connections: connections.map((connection) => ({
      ...connection,
      serverVerifiedCapabilities: [],
      healthy: false,
      observedAt: connection.updatedAt,
    })),
  });
}
