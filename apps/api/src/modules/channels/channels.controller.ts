import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { ChannelsService } from "./channels.service.js";
import { CreateChannelDto } from "./dto/create-channel.dto.js";
import { UpdateChannelDto } from "./dto/update-channel.dto.js";

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("channels")
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channelsService: ChannelsService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext) {
    return { data: await this.channelsService.list(context) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Post()
  @Header("Cache-Control", "no-store")
  async create(@CurrentContext() context: RequestContext, @Body() dto: CreateChannelDto) {
    return { data: await this.channelsService.create(context, dto) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Patch(":id")
  async update(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return { data: await this.channelsService.update(context, id, dto) };
  }

  @Roles("OWNER", "ADMIN")
  @Post(":id/webhook-secret/rotate")
  @Header("Cache-Control", "no-store")
  async rotateWebhookSecret(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.channelsService.rotateWebhookSecret(context, id) };
  }

  @Get(":id/automatic-replies/readiness")
  async automaticReplyReadiness(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
  ) {
    return { data: await this.channelsService.getAutomaticReplyReadiness(context, id) };
  }

  @Roles("OWNER", "ADMIN")
  @Post(":id/automatic-replies/activate")
  async activateAutomaticReplies(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
  ) {
    return { data: await this.channelsService.activateAutomaticReplies(context, id) };
  }

  @Roles("OWNER", "ADMIN")
  @Post(":id/automatic-replies/deactivate")
  async deactivateAutomaticReplies(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
  ) {
    return { data: await this.channelsService.deactivateAutomaticReplies(context, id) };
  }
}
