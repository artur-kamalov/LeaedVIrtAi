import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { RequestContext, RequestWithContext } from "../request-context.js";

export const CurrentContext = createParamDecorator((_data: unknown, context: ExecutionContext): RequestContext => {
  const request = context.switchToHttp().getRequest<Request & RequestWithContext>();
  if (!request.leadvirtContext) {
    throw new Error("RequestContext is not available. Did you forget WorkspaceAuthGuard?");
  }
  return request.leadvirtContext;
});

