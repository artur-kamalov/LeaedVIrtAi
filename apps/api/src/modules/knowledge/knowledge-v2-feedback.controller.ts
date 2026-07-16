import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { KnowledgeV2CreateFeedbackDto } from "./dto/knowledge-v2-feedback.dto.js";
import { KnowledgeV2FeedbackService } from "./knowledge-v2-feedback.service.js";
import { requireIdempotencyKey, strongKnowledgeV2Etag } from "./knowledge-v2-http.js";
import { knowledgeV2ValidationPipe } from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles("OWNER", "ADMIN", "MANAGER", "AGENT")
@Controller("knowledge/v2/feedback")
export class KnowledgeV2FeedbackController {
  constructor(
    @Inject(KnowledgeV2FeedbackService)
    private readonly feedback: KnowledgeV2FeedbackService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateFeedbackDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.feedback.createFeedback(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader(
      "ETag",
      strongKnowledgeV2Etag("feedback", data.resource.id, data.resource.etag),
    );
    response.setHeader("Cache-Control", "no-store, private");
    return { data };
  }
}
