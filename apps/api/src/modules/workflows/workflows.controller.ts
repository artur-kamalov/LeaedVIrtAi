import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { UpsertWorkflowDto } from "./dto/upsert-workflow.dto.js";
import { WorkflowsService } from "./workflows.service.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("workflows")
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly workflowsService: WorkflowsService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext, @Query("includeArchived") includeArchived?: string) {
    return { data: await this.workflowsService.list(context, { includeArchived: includeArchived === "true" }) };
  }

  @Get(":id")
  async get(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.workflowsService.get(context, id) };
  }

  @Post()
  async create(@CurrentContext() context: RequestContext, @Body() dto: UpsertWorkflowDto) {
    return { data: await this.workflowsService.create(context, dto) };
  }

  @Patch(":id")
  async update(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: UpsertWorkflowDto) {
    return { data: await this.workflowsService.update(context, id, dto) };
  }

  @Post(":id/publish")
  async publish(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.workflowsService.publish(context, id) };
  }

  @Post(":id/test")
  async test(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.workflowsService.test(context, id) };
  }
}

