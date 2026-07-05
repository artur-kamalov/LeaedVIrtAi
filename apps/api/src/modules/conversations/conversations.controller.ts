import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { AssignConversationDto } from "./dto/assign-conversation.dto.js";
import { ListConversationsDto } from "./dto/list-conversations.dto.js";
import { SendMessageDto } from "./dto/send-message.dto.js";
import { UpdateConversationStatusDto } from "./dto/update-conversation-status.dto.js";
import { ConversationsService } from "./conversations.service.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("inbox/conversations")
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly conversationsService: ConversationsService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext, @Query() query: ListConversationsDto) {
    return this.conversationsService.list(context, query);
  }
}

@UseGuards(WorkspaceAuthGuard)
@Controller("conversations")
export class ConversationDetailController {
  constructor(@Inject(ConversationsService) private readonly conversationsService: ConversationsService) {}

  @Get(":id")
  async get(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.conversationsService.get(context, id) };
  }

  @Post(":id/messages")
  async sendMessage(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return { data: await this.conversationsService.sendMessage(context, id, dto) };
  }

  @Post(":id/ai/reply")
  async draftAiReply(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.conversationsService.draftAiReply(context, id) };
  }

  @Patch(":id/status")
  async updateStatus(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
    @Body() dto: UpdateConversationStatusDto
  ) {
    return { data: await this.conversationsService.updateStatus(context, id, dto) };
  }

  @Post(":id/assign")
  async assign(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: AssignConversationDto) {
    return { data: await this.conversationsService.assign(context, id, dto) };
  }

  @Post(":id/handoff")
  async handoff(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.conversationsService.handoff(context, id) };
  }
}

