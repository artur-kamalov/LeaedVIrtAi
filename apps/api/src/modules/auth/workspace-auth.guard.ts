import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { RequestWithContext } from "../../common/request-context.js";
import { assertTenantRuntimeActive, isTenantRuntimeActive } from "../../common/tenant-lifecycle.js";
import { AuthService } from "./auth.service.js";

function requestPath(request: Request) {
  const rawPath = request.originalUrl || request.url || "/";
  const path = rawPath.split("?")[0]?.replace(/\/+$/, "") ?? "/";
  return path || "/";
}

const inactiveTenantExactRoutes = new Set([
  "GET /api/auth/me",
  "GET /api/me",
  "GET /api/current-tenant",
  "POST /api/auth/logout",
  "PATCH /api/settings/preferences/locale",
  "GET /api/settings/security",
  "PATCH /api/settings/security/password",
  "POST /api/settings/security/2fa/setup",
  "POST /api/settings/security/2fa/enable",
  "POST /api/settings/security/2fa/disable",
  "POST /api/settings/security/2fa/recovery-codes",
  "POST /api/settings/security/sessions/revoke-others",
  "GET /api/settings/billing",
  "POST /api/billing/payment-method/change-request",
  "PATCH /api/billing/current-subscription",
]);

export function canInactiveTenantAccessRoute(
  request: Pick<Request, "method" | "originalUrl" | "url">,
) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return true;

  const path = requestPath(request as Request);
  if (inactiveTenantExactRoutes.has(`${method} ${path}`)) return true;
  if (method === "GET" && (path === "/api/billing" || path.startsWith("/api/billing/"))) {
    return true;
  }
  return method === "DELETE" && /^\/api\/settings\/security\/sessions\/[^/]+$/.test(path);
}

function canUseTemporaryPasswordRoute(request: Request) {
  const method = request.method.toUpperCase();
  const path = requestPath(request);
  if (method === "OPTIONS") return true;
  if (
    method === "GET" &&
    (path === "/api/auth/me" || path === "/api/me" || path === "/api/current-tenant")
  )
    return true;
  if (method === "POST" && path === "/api/auth/logout") return true;
  if (method === "GET" && path === "/api/settings/security") return true;
  if (method === "PATCH" && path === "/api/settings/security/password") return true;
  return false;
}

@Injectable()
export class WorkspaceAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithContext>();
    const sessionToken = this.authService.readSessionToken(request);
    if (!sessionToken) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const sessionContext = await this.authService.contextForSessionToken(sessionToken);
    if (!sessionContext) {
      throw new UnauthorizedException("Session is invalid or expired.");
    }

    if (
      !isTenantRuntimeActive(sessionContext.tenant.status) &&
      !canInactiveTenantAccessRoute(request)
    ) {
      assertTenantRuntimeActive(sessionContext.tenant.status);
    }

    if (sessionContext.user.passwordChangeRequired && !canUseTemporaryPasswordRoute(request)) {
      throw new ForbiddenException("Password change is required before using the workspace.");
    }

    request.leadvirtContext = sessionContext;
    return true;
  }
}
