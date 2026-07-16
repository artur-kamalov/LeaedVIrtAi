import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { BookAppointmentDto } from "./dto/book-appointment.dto.js";
import { CreateLeadEventDto } from "./dto/create-lead-event.dto.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { ListLeadsDto } from "./dto/list-leads.dto.js";
import { UpdateLeadDto } from "./dto/update-lead.dto.js";
import { LeadsService } from "./leads.service.js";

const leadMutationRoles = ["OWNER", "ADMIN", "MANAGER", "AGENT"] as const;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("leads")
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leadsService: LeadsService) {}

  @Get()
  async list(@CurrentContext() context: RequestContext, @Query() query: ListLeadsDto) {
    return this.leadsService.list(context, query);
  }

  @Get("pipeline/summary")
  async pipelineSummary(@CurrentContext() context: RequestContext) {
    return { data: await this.leadsService.pipelineSummary(context) };
  }

  @Get(":id")
  async get(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.leadsService.get(context, id) };
  }

  @Roles(...leadMutationRoles)
  @Patch(":id")
  async update(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: UpdateLeadDto) {
    return { data: await this.leadsService.update(context, id, dto) };
  }

  @Roles(...leadMutationRoles)
  @Post(":id/events")
  async createEvent(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: CreateLeadEventDto) {
    return { data: await this.leadsService.createEvent(context, id, dto) };
  }

  @Roles(...leadMutationRoles)
  @Post(":id/actions/send-to-crm")
  async sendToCrm(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.leadsService.sendToCrm(context, id) };
  }

  @Roles(...leadMutationRoles)
  @Post(":id/actions/create-task")
  async createTask(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: CreateTaskDto) {
    return { data: await this.leadsService.createTask(context, id, dto) };
  }

  @Roles(...leadMutationRoles)
  @Post(":id/actions/book-appointment")
  async bookAppointment(@CurrentContext() context: RequestContext, @Param("id") id: string, @Body() dto: BookAppointmentDto) {
    return { data: await this.leadsService.bookAppointment(context, id, dto) };
  }
}

