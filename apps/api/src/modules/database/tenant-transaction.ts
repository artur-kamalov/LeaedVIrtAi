import {
  type TenantTransactionClient,
  type TenantTransactionOptions,
  withTenantTransaction,
} from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import type { PrismaService } from "./prisma.service.js";

export function withApiTenantTransaction<T>(
  prisma: PrismaService,
  context: Pick<RequestContext, "tenantId" | "userId" | "role">,
  operation: (transaction: TenantTransactionClient) => Promise<T>,
  options?: TenantTransactionOptions,
) {
  return withTenantTransaction(
    prisma,
    {
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      source: "api_request",
    },
    operation,
    options,
  );
}
