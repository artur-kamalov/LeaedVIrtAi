import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Lead, LeadEvent, LeadStatus, PaginatedEnvelope } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import { positiveInt } from "../../common/pagination.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import type { BookAppointmentDto } from "./dto/book-appointment.dto.js";
import type { CreateLeadEventDto } from "./dto/create-lead-event.dto.js";
import type { CreateTaskDto } from "./dto/create-task.dto.js";
import type { ListLeadsDto } from "./dto/list-leads.dto.js";
import type { UpdateLeadDto } from "./dto/update-lead.dto.js";

type LeadWithOwner = Prisma.LeadGetPayload<{
  include: { assignedTo: { select: { name: true } } };
}>;

@Injectable()
export class LeadsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IntegrationsService) private readonly integrationsService: IntegrationsService,
  ) {}

  async list(context: RequestContext, query: ListLeadsDto): Promise<PaginatedEnvelope<Lead>> {
    const where: Prisma.LeadWhereInput = {
      tenantId: context.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channelType: query.channel } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              { interest: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const page = positiveInt(query.page, 1, 100);
    const limit = positiveInt(query.limit, 50, 100);
    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: { assignedTo: { select: { name: true } } },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: leads.map((lead) => this.mapLead(lead)),
      pagination: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async get(context: RequestContext, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null },
      include: {
        assignedTo: { select: { name: true } },
        events: { orderBy: { createdAt: "desc" }, take: 30 },
        conversations: {
          include: {
            channel: true,
            messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
          },
          orderBy: { lastMessageAt: "desc" },
        },
        tasks: { orderBy: { createdAt: "desc" } },
        bookings: { orderBy: { startsAt: "desc" } },
        orders: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!lead) {
      throw new NotFoundException("Lead was not found.");
    }
    return {
      ...this.mapLead(lead),
      events: lead.events.map((event) => this.mapEvent(event)),
      conversations: lead.conversations.map((conversation) => ({
        id: conversation.id,
        subject: conversation.subject,
        status: conversation.status,
        channelType: conversation.channel?.type ?? lead.channelType,
        lastMessage: conversation.messages[0]?.text ?? null,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      })),
      tasks: lead.tasks,
      bookings: lead.bookings,
      orders: lead.orders,
    };
  }

  async update(context: RequestContext, id: string, dto: UpdateLeadDto): Promise<Lead> {
    await this.ensureLead(context.tenantId, id);
    const now = new Date();
    const data: Prisma.LeadUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.temperature !== undefined) data.temperature = dto.temperature;
    if (dto.interest !== undefined) data.interest = dto.interest;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === "QUALIFIED") data.qualifiedAt = now;
      if (dto.status === "BOOKED") data.bookedAt = now;
      if (dto.status === "SENT_TO_CRM") data.sentToCrmAt = now;
      if (dto.status === "CLOSED" || dto.status === "LOST") data.closedAt = now;
    }
    const lead = await this.prisma.lead.update({
      where: { id },
      data,
      include: { assignedTo: { select: { name: true } } },
    });
    await this.logLeadAction(context, "lead.updated", id, { status: dto.status ?? lead.status });
    return this.mapLead(lead);
  }

  async createEvent(
    context: RequestContext,
    id: string,
    dto: CreateLeadEventDto,
  ): Promise<LeadEvent> {
    await this.ensureLead(context.tenantId, id);
    const event = await this.prisma.leadEvent.create({
      data: {
        tenantId: context.tenantId,
        leadId: id,
        type: dto.type,
        title: dto.title,
        message: dto.message ?? null,
      },
    });
    await this.logLeadAction(context, "lead.event_created", id, { type: dto.type });
    return this.mapEvent(event);
  }

  async sendToCrm(context: RequestContext, id: string): Promise<Lead> {
    const leadForSync = await this.loadLeadForCrmSync(context.tenantId, id);
    const now = new Date();
    const sync = await this.integrationsService.syncLeadToCrm(context, leadForSync);
    const customFields = this.customFieldsWithCrmSync(leadForSync.customFields, sync);
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        status: "SENT_TO_CRM",
        sentToCrmAt: now,
        customFields,
      },
      include: { assignedTo: { select: { name: true } } },
    });
    await this.prisma.leadEvent.create({
      data: {
        tenantId: context.tenantId,
        leadId: id,
        type: "sent_to_crm",
        title: "Лид отправлен в CRM",
        message: `Лид синхронизирован с ${sync.provider}.`,
        metadata: {
          provider: sync.provider,
          integrationId: sync.integrationId,
          syncLogId: sync.syncLogId,
          externalId: sync.externalId,
          url: sync.url,
        },
      },
    });
    await this.logLeadAction(context, "lead.sent_to_crm", id, {
      provider: sync.provider,
      integrationId: sync.integrationId,
      syncLogId: sync.syncLogId,
      externalId: sync.externalId,
      url: sync.url,
    });
    return this.mapLead(lead);
  }

  async createTask(context: RequestContext, id: string, dto: CreateTaskDto) {
    await this.ensureLead(context.tenantId, id);
    const task = await this.prisma.task.create({
      data: {
        tenantId: context.tenantId,
        leadId: id,
        assignedToUserId: context.userId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? "NORMAL",
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
    });
    await this.logLeadAction(context, "task.created", id, { taskId: task.id });
    return task;
  }

  async bookAppointment(context: RequestContext, id: string, dto: BookAppointmentDto) {
    await this.ensureLead(context.tenantId, id);
    const startsAt = new Date(dto.startsAt);
    const booking = await this.prisma.booking.create({
      data: {
        tenantId: context.tenantId,
        leadId: id,
        title: dto.title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        status: "DRAFT",
        location: dto.location ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.prisma.lead.update({
      where: { id },
      data: { status: "BOOKED", bookedAt: startsAt },
    });
    await this.logLeadAction(context, "booking.created", id, { bookingId: booking.id });
    return booking;
  }

  async pipelineSummary(context: RequestContext) {
    const leads = await this.prisma.lead.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      include: { assignedTo: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
    });
    const stages: LeadStatus[] = [
      "NEW",
      "IN_PROGRESS",
      "QUALIFIED",
      "BOOKED",
      "ORDERED",
      "SENT_TO_CRM",
      "CLOSED",
      "LOST",
    ];
    return {
      stages: stages.map((status) => {
        const stageLeads = leads.filter((lead) => lead.status === status);
        return {
          status,
          count: stageLeads.length,
          valueAmount: stageLeads.reduce((sum, lead) => sum + (lead.valueAmount ?? 0), 0),
          leads: stageLeads.map((lead) => this.mapLead(lead)),
        };
      }),
    };
  }

  private async ensureLead(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException("Lead was not found.");
    }
    return lead;
  }

  private async loadLeadForCrmSync(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        conversations: {
          include: {
            channel: true,
            messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3 },
          },
          orderBy: { lastMessageAt: "desc" },
          take: 3,
        },
      },
    });
    if (!lead) {
      throw new NotFoundException("Lead was not found.");
    }
    return lead;
  }

  private customFieldsWithCrmSync(
    customFields: Prisma.JsonValue,
    sync: Awaited<ReturnType<IntegrationsService["syncLeadToCrm"]>>,
  ): Prisma.InputJsonObject {
    const base =
      typeof customFields === "object" && customFields !== null && !Array.isArray(customFields)
        ? customFields
        : {};
    return {
      ...base,
      crmSync: {
        provider: sync.provider,
        integrationId: sync.integrationId,
        syncLogId: sync.syncLogId,
        externalId: sync.externalId,
        url: sync.url,
        syncedAt: sync.syncedAt.toISOString(),
      },
    };
  }

  private mapLead(lead: LeadWithOwner): Lead {
    return {
      id: lead.id,
      tenantId: lead.tenantId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      companyName: lead.companyName,
      source: lead.source,
      channelType: lead.channelType,
      status: lead.status,
      temperature: lead.temperature,
      valueAmount: lead.valueAmount,
      currency: lead.currency,
      interest: lead.interest,
      summary: lead.summary,
      assignedToUserId: lead.assignedToUserId,
      assignedToName: lead.assignedTo?.name ?? null,
      lastMessageAt: lead.lastMessageAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
    };
  }

  private mapEvent(event: {
    id: string;
    leadId: string;
    type: string;
    title: string;
    message: string | null;
    createdAt: Date;
  }): LeadEvent {
    return {
      id: event.id,
      leadId: event.leadId,
      type: event.type,
      title: event.title,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async logLeadAction(
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.JsonObject,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "lead",
        entityId,
        payload,
      },
    });
  }
}
