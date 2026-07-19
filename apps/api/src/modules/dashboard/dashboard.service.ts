import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import type { DashboardMetricDeltas, DashboardSummary } from "@leadvirt/types";
import {
  internalSampleConversationIds,
  internalSampleLeadIds,
} from "../../common/internal-sample.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { dashboardUtcWeekdayTrend } from "./dashboard-metrics.js";

const productActivityActions: string[] = [
  "seed.completed",
  "lead.sent_to_crm",
  "booking.created",
  "task.created",
  "integration.connected",
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
  const converted = leads.filter((lead) =>
    convertedLeadStatuses.includes(lead.status as (typeof convertedLeadStatuses)[number]),
  ).length;
  return roundOne((converted / leads.length) * 100);
}

function averageFirstResponseSeconds(
  messages: { conversationId: string; direction: string; senderType: string; createdAt: Date }[],
  start: Date,
  end: Date,
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
    const sampleAuditLogs = await this.prisma.auditLog.findMany({
      where: { tenantId, action: "integration.sample_inbound" },
      select: { payload: true },
    });
    const sampleConversationIds = internalSampleConversationIds(sampleAuditLogs);
    const sampleConversations =
      sampleConversationIds.size > 0
        ? await this.prisma.conversation.findMany({
            where: { tenantId, id: { in: [...sampleConversationIds] } },
            select: { id: true, leadId: true },
          })
        : [];
    const sampleLeadIds = internalSampleLeadIds(sampleConversations, sampleConversationIds);
    const sampleConversationIdList = [...sampleConversationIds];
    const sampleLeadIdList = [...sampleLeadIds];
    const realLeadWhere: Prisma.LeadWhereInput = {
      tenantId,
      deletedAt: null,
      ...(sampleLeadIdList.length > 0 ? { id: { notIn: sampleLeadIdList } } : {}),
    };
    const realConversationWhere: Prisma.ConversationWhereInput = {
      tenantId,
      deletedAt: null,
      AND: [
        ...(sampleConversationIdList.length > 0
          ? [{ id: { notIn: sampleConversationIdList } }]
          : []),
        ...(sampleLeadIdList.length > 0
          ? [{ OR: [{ leadId: null }, { leadId: { notIn: sampleLeadIdList } }] }]
          : []),
      ],
    };
    const realRelatedLeadWhere =
      sampleLeadIdList.length > 0
        ? { OR: [{ leadId: null }, { leadId: { notIn: sampleLeadIdList } }] }
        : {};
    const realActivityWhere: Prisma.AuditLogWhereInput = {
      tenantId,
      action: { in: productActivityActions },
      NOT: [
        ...(sampleConversationIdList.length > 0
          ? [
              {
                entityType: "conversation",
                entityId: { in: sampleConversationIdList },
              },
            ]
          : []),
        ...(sampleLeadIdList.length > 0
          ? [{ entityType: "lead", entityId: { in: sampleLeadIdList } }]
          : []),
      ],
    };
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
      periodMessages,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { ...realLeadWhere, status: "NEW" } }),
      this.prisma.conversation.count({
        where: { ...realConversationWhere, aiEnabled: true },
      }),
      this.prisma.booking.count({
        where: { tenantId, deletedAt: null, ...realRelatedLeadWhere },
      }),
      this.prisma.order.count({
        where: { tenantId, deletedAt: null, ...realRelatedLeadWhere },
      }),
      this.prisma.lead.count({ where: { ...realLeadWhere, sentToCrmAt: { not: null } } }),
      this.prisma.lead.count({
        where: {
          ...realLeadWhere,
          status: { in: ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"] },
        },
      }),
      this.prisma.lead.count({ where: realLeadWhere }),
      this.prisma.auditLog.findMany({
        where: realActivityWhere,
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, entityType: true, createdAt: true, payload: true },
      }),
      this.prisma.lead.findMany({
        where: realLeadWhere,
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
            where: {
              deletedAt: null,
              ...(sampleConversationIdList.length > 0
                ? { id: { notIn: sampleConversationIdList } }
                : {}),
            },
            orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { id: true },
          },
        },
      }),
      this.prisma.lead.findMany({
        where: realLeadWhere,
        select: {
          channelType: true,
          status: true,
          valueAmount: true,
          createdAt: true,
          bookedAt: true,
          sentToCrmAt: true,
        },
      }),
      this.prisma.conversation.findMany({
        where: realConversationWhere,
        select: { channelId: true, aiEnabled: true, createdAt: true },
      }),
      this.prisma.channel.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, type: true, name: true },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId,
          deletedAt: null,
          createdAt: { gte: previousPeriodStart },
          ...realRelatedLeadWhere,
        },
        select: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          tenantId,
          deletedAt: null,
          createdAt: { gte: previousPeriodStart },
          ...realRelatedLeadWhere,
        },
        select: { createdAt: true },
      }),
      this.prisma.message.findMany({
        where: {
          tenantId,
          createdAt: { gte: previousPeriodStart },
          senderType: { in: ["CUSTOMER", "AI", "USER"] },
          conversation: realConversationWhere,
        },
        orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
        select: { conversationId: true, direction: true, senderType: true, createdAt: true },
      }),
    ]);
    const [latestRealInbound, providerReply] = await Promise.all([
      this.prisma.message.findFirst({
        where: {
          tenantId,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          conversation: realConversationWhere,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { conversationId: true, createdAt: true },
      }),
      this.prisma.message.findFirst({
        where: {
          tenantId,
          direction: "OUTBOUND",
          senderType: { in: ["AI", "USER"] },
          status: { in: ["SENT", "DELIVERED"] },
          conversation: realConversationWhere,
        },
        select: { id: true },
      }),
    ]);

    const conversionRate =
      totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 1000) / 10 : 0;
    const currentLeads = leads.filter((lead) => inRange(lead.createdAt, currentPeriodStart, now));
    const previousLeads = leads.filter((lead) =>
      inRange(lead.createdAt, previousPeriodStart, currentPeriodStart),
    );
    const currentAiConversations = conversations.filter(
      (conversation) =>
        conversation.aiEnabled && inRange(conversation.createdAt, currentPeriodStart, now),
    );
    const previousAiConversations = conversations.filter(
      (conversation) =>
        conversation.aiEnabled &&
        inRange(conversation.createdAt, previousPeriodStart, currentPeriodStart),
    );
    const currentBookingsOrders =
      periodBookings.filter((booking) => inRange(booking.createdAt, currentPeriodStart, now))
        .length +
      periodOrders.filter((order) => inRange(order.createdAt, currentPeriodStart, now)).length;
    const previousBookingsOrders =
      periodBookings.filter((booking) =>
        inRange(booking.createdAt, previousPeriodStart, currentPeriodStart),
      ).length +
      periodOrders.filter((order) =>
        inRange(order.createdAt, previousPeriodStart, currentPeriodStart),
      ).length;
    const currentLeadsSentToCrm = leads.filter((lead) =>
      inRange(lead.sentToCrmAt, currentPeriodStart, now),
    ).length;
    const previousLeadsSentToCrm = leads.filter((lead) =>
      inRange(lead.sentToCrmAt, previousPeriodStart, currentPeriodStart),
    ).length;
    const currentConversionRate = conversionRateForLeads(currentLeads);
    const previousConversionRate = conversionRateForLeads(previousLeads);
    const currentAverageResponse = averageFirstResponseSeconds(
      periodMessages,
      currentPeriodStart,
      now,
    );
    const previousAverageResponse = averageFirstResponseSeconds(
      periodMessages,
      previousPeriodStart,
      currentPeriodStart,
    );
    const averageResponseTimeSeconds = Math.round(
      currentAverageResponse ?? previousAverageResponse ?? 0,
    );
    const deltas: DashboardMetricDeltas = {
      newLeadsPercent: percentDelta(currentLeads.length, previousLeads.length),
      aiConversationsPercent: percentDelta(
        currentAiConversations.length,
        previousAiConversations.length,
      ),
      bookingsOrdersPercent: percentDelta(currentBookingsOrders, previousBookingsOrders),
      leadsSentToCrmPercent: percentDelta(currentLeadsSentToCrm, previousLeadsSentToCrm),
      averageResponseTimePercent: percentDelta(
        currentAverageResponse ?? 0,
        previousAverageResponse ?? 0,
      ),
      conversionRatePoints: pointDelta(currentConversionRate, previousConversionRate),
    };
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));

    const performance = channels.map((channel) => {
      const channelLeads = leads.filter((lead) => lead.channelType === channel.type);
      const channelConversations = conversations.filter(
        (conversation) => channelById.get(conversation.channelId ?? "")?.type === channel.type,
      );
      const converted = channelLeads.filter((lead) =>
        ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"].includes(lead.status),
      ).length;
      return {
        channelType: channel.type,
        name: channel.name,
        leads: channelLeads.length,
        conversations: channelConversations.length,
        conversionRate:
          channelLeads.length > 0 ? Math.round((converted / channelLeads.length) * 1000) / 10 : 0,
        valueAmount: channelLeads.reduce((sum, lead) => sum + (lead.valueAmount ?? 0), 0),
      };
    });

    const trend = dashboardUtcWeekdayTrend(leads, currentPeriodStart, now);

    return {
      activation: {
        hasRealInbound: latestRealInbound !== null,
        hasProviderReply: providerReply !== null,
        latestRealConversationId: latestRealInbound?.conversationId ?? null,
        latestRealInboundAt: latestRealInbound?.createdAt.toISOString() ?? null,
      },
      metrics: {
        newLeadsCount,
        aiConversationsCount,
        bookingsOrdersCreated: bookingsCreated + ordersCreated,
        leadsSentToCrm,
        averageResponseTimeSeconds,
        conversionRate,
        deltas,
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
        lastMessageAt: lead.lastMessageAt?.toISOString() ?? null,
      })),
      recentActivity: recentAuditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        createdAt: log.createdAt.toISOString(),
      })),
      channelPerformance: performance,
      trend,
    };
  }
}
