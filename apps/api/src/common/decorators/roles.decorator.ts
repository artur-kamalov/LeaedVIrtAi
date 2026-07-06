import { SetMetadata } from "@nestjs/common";
import type { MembershipRole } from "@leadvirt/db";

export const LEADVIRT_ROLES_KEY = "leadvirt:roles";

export function Roles(...roles: MembershipRole[]) {
  return SetMetadata(LEADVIRT_ROLES_KEY, roles);
}
