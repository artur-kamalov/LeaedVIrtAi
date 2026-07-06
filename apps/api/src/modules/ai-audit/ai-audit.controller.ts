import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { AiAuditService } from "./ai-audit.service.js";

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("ai-audit")
export class AiAuditController {
  constructor(@Inject(AiAuditService) private readonly aiAuditService: AiAuditService) {}

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Get()
  async list(@CurrentContext() context: RequestContext, @Query("limit") limit?: string) {
    return { data: await this.aiAuditService.list(context, limit) };
  }
}
