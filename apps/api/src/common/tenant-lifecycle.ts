import { ForbiddenException } from "@nestjs/common";
import type { TenantStatus } from "@leadvirt/db";
import type {
  ActiveTenantStatus,
  InactiveTenantStatus,
  TenantLifecycleAccessErrorCode,
} from "@leadvirt/types";

const activeTenantStatuses = new Set<TenantStatus>(["TRIALING", "ACTIVE"]);

export const tenantInactiveErrorCode = "TENANT_INACTIVE" satisfies TenantLifecycleAccessErrorCode;

export function isTenantRuntimeActive(status: TenantStatus): status is ActiveTenantStatus {
  return activeTenantStatuses.has(status);
}

export function assertTenantRuntimeActive(status: TenantStatus): void {
  if (isTenantRuntimeActive(status)) return;

  throw new ForbiddenException({
    code: tenantInactiveErrorCode,
    message: "Workspace access is unavailable while the tenant is inactive.",
    retryable: false,
    details: { status: status satisfies InactiveTenantStatus },
  });
}
