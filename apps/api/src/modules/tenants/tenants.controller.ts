import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";

@UseGuards(WorkspaceAuthGuard)
@Controller()
export class TenantsController {
  @Get("current-tenant")
  current(@CurrentContext() context: RequestContext) {
    return {
      data: {
        ...context.tenant,
        role: context.role
      }
    };
  }

  @Get("tenants")
  list(@CurrentContext() context: RequestContext) {
    return { data: [{ ...context.tenant, role: context.role }] };
  }
}

