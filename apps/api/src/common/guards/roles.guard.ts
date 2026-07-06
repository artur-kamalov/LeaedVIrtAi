import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@leadvirt/db";
import { LEADVIRT_ROLES_KEY } from "../decorators/roles.decorator.js";
import type { RequestWithContext } from "../request-context.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<MembershipRole[]>(LEADVIRT_ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const currentRole = request.leadvirtContext?.role;
    if (currentRole && roles.includes(currentRole)) return true;

    throw new ForbiddenException("Insufficient workspace role.");
  }
}
