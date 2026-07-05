import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { DashboardService } from "./dashboard.service.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get("summary")
  async summary(@CurrentContext() context: RequestContext) {
    return { data: await this.dashboardService.getSummary(context) };
  }
}

