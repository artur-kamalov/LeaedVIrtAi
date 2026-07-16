import { Inject, Injectable } from "@nestjs/common";
import type { DashboardMetricDeltas, DashboardSummary } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";

const productActivityActions: string[] = [
  "seed.completed",
  "lead.sent_to_crm",
  "booking.created",
  "task.created",
  "integration.connected",
  "integration.sample_inbound",
  "integration.test_connection",
  "workflow.published",
  "onboarding.step_completed",
  "widget.message.received",
];

const convertedLeadStatuses = ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"] as const;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function inRange(date: Date | null | undefined, start: Date, end: Date) {
  return Boolean(date && date >= start && date < end);
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function percentDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return roundOne(((current - previous) / previous) * 100);
}

function pointDelta(current: number, previous: number) {
  return roundOne(current - previous);
}

function conversionRateForLeads(leads: { status: string }[]) {
  if (leads.length === 0) return 0;
  const converted = leads.filter((lead) => convertedLeadStatuses.includes(lead.status as (typeof convertedLeadStatuses)[number])).length;
  return roundOne((converted / leads.length) * 100);
}

function averageFirstResponseSeconds(
  messages: { conversationId: string; direction: string; senderType: string; createdAt: Date }[],
  start: Date,
  end: Date
) {
  const pendingInboundByConversation = new Map<string, Date>();
  const samples: number[] = [];

  for (const message of messages) {
    if (message.createdAt < start || message.createdAt >= end) continue;

    if (message.direction === "INBOUND" && message.senderType === "CUSTOMER") {
      if (!pendingInboundByConversation.has(message.conversationId)) {
        pendingInboundByConversation.set(message.conversationId, message.createdAt);
      }
      continue;
    }

    if (message.direction === "OUTBOUND" && ["AI", "USER"].includes(message.senderType)) {
      const inboundAt = pendingInboundByConversation.get(message.conversationId);
      if (!inboundAt) continue;
      samples.push(Math.max(0, (message.createdAt.getTime() - inboundAt.getTime()) / 1000));
      pendingInboundByConversation.delete(message.conversationId);
    }
  }

  if (samples.length === 0) return null;
  return roundOne(samples.reduce((sum, sample) => sum + sample, 0) / samples.length);
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSummary(context: RequestContext): Promise<DashboardSummary> {
    const tenantId = context.tenantId;
    const now = new Date();
    const currentPeriodStart = addDays(now, -7);
    const previousPeriodStart = addDays(now, -14);
    const [
      newLeadsCount,
      aiConversationsCount,
      bookingsCreated,
      ordersCreated,
      leadsSentToCrm,
      qualifiedLeads,
      totalLeads,
      recentAuditLogs,
      recentLeads,
      leads,
      conversations,
      channels,
      periodBookings,
      periodOrders,
      periodMessages
    ] = await Promise.all([
      this.prisma.lead.count({ where: { tenantId, status: "NEW", deletedAt: null } }),
      this.prisma.conversation.count({ where: { tenantId, aiEnabled: true, deletedAt: null } }),
      this.prisma.booking.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.order.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.lead.count({ where: { tenantId, sentToCrmAt: { not: null }, deletedAt: null } }),
      this.prisma.lead.count({
        where: { tenantId, deletedAt: null, status: { in: ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"] } }
      }),
      this.prisma.lead.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.auditLog.findMany({
        where: { tenantId, action: { in: productActivityActions } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, entityType: true, createdAt: true, payload: true }
      }),
      this.prisma.lead.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: {
          id: true,
          name: true,
          source: true,
          channelType: true,
          status: true,
          temperature: true,
          valueAmount: true,
          currency: true,
          interest: true,
          summary: true,
          createdAt: true,
          lastMessageAt: true,
          conversations: {
            where: { deletedAt: null },
            orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { id: true }
          }
        }
      }),
      this.prisma.lead.findMany({
        where: { tenantId, deletedAt: null },
        select: { channelType: true, status: true, valueAmount: true, createdAt: true, bookedAt: true, sentToCrmAt: true }
      }),
      this.prisma.conversation.findMany({
        where: { tenantId, deletedAt: null },
        select: { channelId: true, aiEnabled: true, createdAt: true }
      }),
      this.prisma.channel.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, type: true, name: true }
      }),
      this.prisma.booking.findMany({
        where: { tenantId, deletedAt: null, createdAt: { gte: previousPeriodStart } },
        select: { createdAt: true }
      }),
      this.prisma.order.findMany({
        where: { tenantId, deletedAt: null, createdAt: { gte: previousPeriodStart } },
        select: { createdAt: true }
      }),
      this.prisma.message.findMany({
        where: { tenantId, createdAt: { gte: previousPeriodStart }, senderType: { in: ["CUSTOMER", "AI", "USER"] } },
        orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
        select: { conversationId: true, direction: true, senderType: true, createdAt: true }
      })
    ]);

    const conversionRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 1000) / 10 : 0;
    const currentLeads = leads.filter((lead) => inRange(lead.createdAt, currentPeriodStart, now));
    const previousLeads = leads.filter((lead) => inRange(lead.createdAt, previousPeriodStart, currentPeriodStart));
    const currentAiConversations = conversations.filter((conversation) => conversation.aiEnabled && inRange(conversation.createdAt, currentPeriodStart, now));
    const previousAiConversations = conversations.filter((conversation) => conversation.aiEnabled && inRange(conversation.createdAt, previousPeriodStart, currentPeriodStart));
    const currentBookingsOrders =
      periodBookings.filter((booking) => inRange(booking.createdAt, currentPeriodStart, now)).length +
      periodOrders.filter((order) => inRange(order.createdAt, currentPeriodStart, now)).length;
    const previousBookingsOrders =
      periodBookings.filter((booking) => inRange(booking.createdAt, previousPeriodStart, currentPeriodStart)).length +
      periodOrders.filter((order) => inRange(order.createdAt, previousPeriodStart, currentPeriodStart)).length;
    const currentLeadsSentToCrm = leads.filter((lead) => inRange(lead.sentToCrmAt, currentPeriodStart, now)).length;
    const previousLeadsSentToCrm = leads.filter((lead) => inRange(lead.sentToCrmAt, previousPeriodStart, currentPeriodStart)).length;
    const currentConversionRate = conversionRateForLeads(currentLeads);
    const previousConversionRate = conversionRateForLeads(previousLeads);
    const currentAverageResponse = averageFirstResponseSeconds(periodMessages, currentPeriodStart, now);
    const previousAverageResponse = averageFirstResponseSeconds(periodMessages, previousPeriodStart, currentPeriodStart);
    const averageResponseTimeSeconds = Math.round(currentAverageResponse ?? previousAverageResponse ?? 0);
    const deltas: DashboardMetricDeltas = {
      newLeadsPercent: percentDelta(currentLeads.length, previousLeads.length),
      aiConversationsPercent: percentDelta(currentAiConversations.length, previousAiConversations.length),
      bookingsOrdersPercent: percentDelta(currentBookingsOrders, previousBookingsOrders),
      leadsSentToCrmPercent: percentDelta(currentLeadsSentToCrm, previousLeadsSentToCrm),
      averageResponseTimePercent: percentDelta(currentAverageResponse ?? 0, previousAverageResponse ?? 0),
      conversionRatePoints: pointDelta(currentConversionRate, previousConversionRate)
    };
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));

    const performance = channels.map((channel) => {
      const channelLeads = leads.filter((lead) => lead.channelType === channel.type);
      const channelConversations = conversations.filter((conversation) => channelById.get(conversation.channelId ?? "")?.type === channel.type);
      const converted = channelLeads.filter((lead) =>
        ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"].includes(lead.status)
      ).length;
      return {
        channelType: channel.type,
        name: channel.name,
        leads: channelLeads.length,
        conversations: channelConversations.length,
        conversionRate: channelLeads.length > 0 ? Math.round((converted / channelLeads.length) * 1000) / 10 : 0,
        valueAmount: channelLeads.reduce((sum, lead) => sum + (lead.valueAmount ?? 0), 0)
      };
    });

    const trend = Array.from({ length: 7 }, (_, weekday) => {
      const leadsForSlot = leads.filter((_, leadIndex) => leadIndex % 7 === weekday);
      return {
        weekday,
        leads: leadsForSlot.length,
        booked: leadsForSlot.filter((lead) => lead.bookedAt || ["BOOKED", "ORDERED"].includes(lead.status)).length
      };
    });

    return {
      metrics: {
        newLeadsCount,
        aiConversationsCount,
        bookingsOrdersCreated: bookingsCreated + ordersCreated,
        leadsSentToCrm,
        averageResponseTimeSeconds,
        conversionRate,
        deltas
      },
      recentLeads: recentLeads.map((lead) => ({
        id: lead.id,
        conversationId: lead.conversations[0]?.id ?? null,
        name: lead.name,
        source: lead.source,
        channelType: lead.channelType,
        status: lead.status,
        temperature: lead.temperature,
        valueAmount: lead.valueAmount,
        currency: lead.currency,
        interest: lead.interest,
        summary: lead.summary,
        createdAt: lead.createdAt.toISOString(),
        lastMessageAt: lead.lastMessageAt?.toISOString() ?? null
      })),
      recentActivity: recentAuditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        createdAt: log.createdAt.toISOString()
      })),
      channelPerformance: performance,
      trend
    };
  }
}
