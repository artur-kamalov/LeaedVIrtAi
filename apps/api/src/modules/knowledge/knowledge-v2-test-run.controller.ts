import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import type { KnowledgeV2CreateTestRunRequest } from "@leadvirt/types";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { KnowledgeV2CreateTestRunDto } from "./dto/knowledge-v2-test-run.dto.js";
import { requireIdempotencyKey } from "./knowledge-v2-http.js";
import { KnowledgeV2TestRunService } from "./knowledge-v2-test-run.service.js";
import { knowledgeV2ValidationPipe } from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles("OWNER", "ADMIN", "MANAGER")
@Controller("knowledge/v2/test-runs")
export class KnowledgeV2TestRunController {
  constructor(
    @Inject(KnowledgeV2TestRunService)
    private readonly runs: KnowledgeV2TestRunService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateTestRunDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.runs.createRun(
      context,
      dto as KnowledgeV2CreateTestRunRequest,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", data.resource.etag);
    response.setHeader("Cache-Control", "no-store, private");
    return { data };
  }

  @Get(":runId")
  async detail(
    @CurrentContext() context: RequestContext,
    @Param("runId") runId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.runs.getRun(context, runId);
    response.setHeader("ETag", data.etag);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return { data };
  }
}
