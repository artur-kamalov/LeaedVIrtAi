import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { CreateKnowledgeSourceDto } from "./dto/create-knowledge-source.dto.js";
import { SearchKnowledgeDto } from "./dto/search-knowledge.dto.js";
import { UpdateKnowledgeSourceDto } from "./dto/update-knowledge-source.dto.js";
import { KnowledgeService } from "./knowledge.service.js";

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("knowledge/sources")
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext) {
    return { data: await this.knowledgeService.list(context) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Post()
  async create(@CurrentContext() context: RequestContext, @Body() dto: CreateKnowledgeSourceDto) {
    return { data: await this.knowledgeService.create(context, dto) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Post("reindex")
  async reindex(@CurrentContext() context: RequestContext) {
    return { data: await this.knowledgeService.reindex(context) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT")
  @Get("search")
  async search(
    @CurrentContext() context: RequestContext,
    @Query() query: SearchKnowledgeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return { data: await this.knowledgeService.search(context, query.q, query.limit ?? 5) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Patch(":id")
  async update(
    @CurrentContext() context: RequestContext,
    @Param("id") id: string,
    @Body() dto: UpdateKnowledgeSourceDto,
  ) {
    return { data: await this.knowledgeService.update(context, id, dto) };
  }

  @Roles("OWNER", "ADMIN", "MANAGER")
  @Delete(":id")
  async archive(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.knowledgeService.archive(context, id) };
  }
}
