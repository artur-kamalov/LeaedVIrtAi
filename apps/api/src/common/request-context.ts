import type { MembershipRole, Tenant, User } from "@leadvirt/db";

export interface RequestContext {
  tenantId: string;
  userId: string;
  sessionId?: string;
  role: MembershipRole;
  authMode: "credentials" | "telegram";
  tenant: Pick<Tenant, "id" | "name" | "slug" | "status" | "businessType" | "timezone">;
  user: Pick<User, "id" | "email" | "phone" | "name" | "avatarUrl" | "passwordChangeRequired">;
}

export interface RequestWithContext {
  leadvirtContext?: RequestContext;
}
