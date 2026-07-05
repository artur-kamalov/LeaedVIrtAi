import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { UpdateIntegrationSettingsDto } from "./dto/update-integration-settings.dto.js";
import { IntegrationsService } from "./integrations.service.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly integrationsService: IntegrationsService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext) {
    return { data: await this.integrationsService.list(context) };
  }

  @Post(":provider/connect")
  async connect(@CurrentContext() context: RequestContext, @Param("provider") provider: string) {
    return { data: await this.integrationsService.connect(context, provider) };
  }

  @Post(":provider/disconnect")
  async disconnect(@CurrentContext() context: RequestContext, @Param("provider") provider: string) {
    return { data: await this.integrationsService.disconnect(context, provider) };
  }

  @Post(":provider/test")
  async testConnection(@CurrentContext() context: RequestContext, @Param("provider") provider: string) {
    return { data: await this.integrationsService.testConnection(context, provider) };
  }

  @Post(":provider/sample-inbound")
  async sendSampleInbound(@CurrentContext() context: RequestContext, @Param("provider") provider: string) {
    return { data: await this.integrationsService.sendSampleInbound(context, provider) };
  }

  @Patch(":provider/settings")
  async updateSettings(
    @CurrentContext() context: RequestContext,
    @Param("provider") provider: string,
    @Body() dto: UpdateIntegrationSettingsDto
  ) {
    return { data: await this.integrationsService.updateSettings(context, provider, dto) };
  }
}

