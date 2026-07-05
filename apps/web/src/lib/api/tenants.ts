import type { Tenant, UserRole } from "@leadvirt/types";
import { apiData } from "./client";

export interface CurrentTenant extends Tenant {
  role: UserRole;
}

export function getCurrentTenant() {
  return apiData<CurrentTenant>("/current-tenant");
}

export function listTenants() {
  return apiData<CurrentTenant[]>("/tenants");
}
