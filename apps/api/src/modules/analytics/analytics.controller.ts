import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { AnalyticsService } from "./analytics.service.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  @Get("overview")
  async overview(@CurrentContext() context: RequestContext, @Query("period") period?: string) {
    return { data: await this.analyticsService.overview(context, period ? { period } : {}) };
  }
}

