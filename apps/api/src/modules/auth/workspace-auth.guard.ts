import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { RequestWithContext } from "../../common/request-context.js";
import { AuthService } from "./auth.service.js";

function requestPath(request: Request) {
  const rawPath = request.originalUrl || request.url || "/";
  return rawPath.split("?")[0] ?? "/";
}

function canUseTemporaryPasswordRoute(request: Request) {
  const method = request.method.toUpperCase();
  const path = requestPath(request);
  if (method === "OPTIONS") return true;
  if (method === "GET" && (path === "/api/auth/me" || path === "/api/me" || path === "/api/current-tenant")) return true;
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

    if (sessionContext.user.passwordChangeRequired && !canUseTemporaryPasswordRoute(request)) {
      throw new ForbiddenException("Password change is required before using the workspace.");
    }

    request.leadvirtContext = sessionContext;
    return true;
  }
}

