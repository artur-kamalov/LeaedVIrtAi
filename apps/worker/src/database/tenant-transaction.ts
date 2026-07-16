import {
  type MembershipRole,
  prisma,
  type TenantTransactionClient,
  type TenantTransactionOptions,
  withTenantTransaction,
} from "@leadvirt/db";

export interface WorkerTenantTransactionContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export function withWorkerTenantTransaction<T>(
  context: WorkerTenantTransactionContext,
  operation: (transaction: TenantTransactionClient) => Promise<T>,
  options?: TenantTransactionOptions,
) {
  return withTenantTransaction(
    prisma,
    { ...context, source: "background_job" },
    operation,
    options,
  );
}
