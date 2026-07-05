import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiProvider } from "@leadvirt/ai";
import type { AiDraftReply, AiReplyJobData, Channel, ConversationDetail, Lead, Message, PaginatedEnvelope } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import { positiveInt } from "../../common/pagination.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AssignConversationDto } from "./dto/assign-conversation.dto.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";
import type { ListConversationsDto } from "./dto/list-conversations.dto.js";
import type { SendMessageDto } from "./dto/send-message.dto.js";
import type { UpdateConversationStatusDto } from "./dto/update-conversation-status.dto.js";

type LeadWithOwner = Prisma.LeadGetPayload<{
  include: { assignedTo: { select: { name: true } } };
}>;

type ConversationWithPreview = Prisma.ConversationGetPayload<{
  include: {
    lead: { include: { assignedTo: { select: { name: true } } } };
    channel: true;
    messages: { orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

type ConversationWithDetail = Prisma.ConversationGetPayload<{
  include: {
    lead: { include: { assignedTo: { select: { name: true } }; events: { orderBy: { createdAt: "desc" }; take: 20 } } };
    channel: true;
    messages: { orderBy: { createdAt: "asc" } };
  };
}>;

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService
  ) {}

  async list(context: RequestContext, query: ListConversationsDto): Promise<PaginatedEnvelope<ConversationDetail>> {
    const where: Prisma.ConversationWhereInput = {
      tenantId: context.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: { type: query.channel } } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: "insensitive" } },
              { lead: { name: { contains: query.search, mode: "insensitive" } } },
              { messages: { some: { text: { contains: query.search, mode: "insensitive" } } } }
            ]
          }
        : {})
    };

    const page = positiveInt(query.page, 1, 100);
    const limit = positiveInt(query.limit, 20, 100);
    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          lead: { include: { assignedTo: { select: { name: true } } } },
          channel: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      data: rows.map((row) => this.mapConversationPreview(row)),
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total
      }
    };
  }

  async get(context: RequestContext, id: string): Promise<ConversationDetail> {
    const conversation = await this.loadConversation(context.tenantId, id);
    return this.mapConversationDetail(conversation);
  }

  async draftAiReply(context: RequestContext, id: string): Promise<AiDraftReply> {
    const conversation = await this.loadConversation(context.tenantId, id);
    return this.aiProvider.generateReply({
      tenantId: context.tenantId,
      businessName: context.tenant.name,
      conversationId: conversation.id,
      ...(context.tenant.businessType ? { businessType: context.tenant.businessType } : {}),
      messages: conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? "assistant" : "user",
        content: message.text ?? ""
      }))
    });
  }

  async sendMessage(context: RequestContext, id: string, dto: SendMessageDto): Promise<ConversationDetail> {
    const conversation = await this.loadConversation(context.tenantId, id);
    const createdAt = new Date();

    const userMessage = await this.prisma.message.create({
      data: {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        senderUserId: context.userId,
        text: dto.text,
        status: "SENT",
        createdAt,
        updatedAt: createdAt
      }
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: createdAt, updatedAt: createdAt }
    });

    let aiReplyQueued = false;
    let aiReplyQueueReason: string | undefined;

    if (conversation.aiEnabled && this.aiReplyQueue.enabled) {
      const jobData: AiReplyJobData = {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        triggerMessageId: userMessage.id,
        text: dto.text,
        businessName: context.tenant.name,
        ...(context.tenant.businessType ? { businessType: context.tenant.businessType } : {}),
        leadId: conversation.leadId,
        ...(conversation.lead?.status ? { leadStatus: conversation.lead.status } : {}),
        source: "inbox",
        requestedByUserId: context.userId,
        receivedAt: createdAt.toISOString()
      };
      const queueResult = await this.aiReplyQueue.enqueue(jobData);
      aiReplyQueued = queueResult.queued;
      aiReplyQueueReason = queueResult.reason;

      if (aiReplyQueued && conversation.leadId) {
        await this.prisma.leadEvent.create({
          data: {
            tenantId: context.tenantId,
            leadId: conversation.leadId,
            type: "ai_reply_queued",
            title: "AI reply queued",
            message: dto.text,
            metadata: { conversationId: conversation.id, jobId: queueResult.jobId ?? null }
          }
        });
      }
    }

    if (conversation.leadId && !aiReplyQueued) {
      const extraction = await this.aiProvider.extractLeadFields({
        tenantId: context.tenantId,
        conversationId: conversation.id,
        text: dto.text
      });

      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: {
          lastMessageAt: createdAt,
          summary: typeof extraction.fields.summary === "string" ? extraction.fields.summary : (conversation.lead?.summary ?? null)
        }
      });
    }

    if (conversation.aiEnabled && !aiReplyQueued) {
      const messages = [...conversation.messages, { senderType: "USER", text: dto.text }];
      const aiReply = await this.aiProvider.generateReply({
        tenantId: context.tenantId,
        businessName: context.tenant.name,
        conversationId: conversation.id,
        ...(context.tenant.businessType ? { businessType: context.tenant.businessType } : {}),
        messages: messages.map((message) => ({
          role: message.senderType === "AI" ? "assistant" : "user",
          content: message.text ?? ""
        }))
      });
      const recommendation = await this.aiProvider.recommendNextAction({
        tenantId: context.tenantId,
        conversationId: conversation.id,
        ...(conversation.lead?.status ? { leadStatus: conversation.lead.status } : {}),
        text: dto.text
      });

      const aiCreatedAt = new Date(createdAt.getTime() + 1000);
      await this.prisma.message.create({
        data: {
          tenantId: context.tenantId,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "AI",
          text: aiReply.reply,
          status: "SENT",
          metadata: {
            intent: aiReply.intent,
            confidence: aiReply.confidence,
            nextAction: recommendation.action
          },
          createdAt: aiCreatedAt,
          updatedAt: aiCreatedAt
        }
      });

      await this.prisma.aiUsageLog.create({
        data: {
          tenantId: context.tenantId,
          conversationId: conversation.id,
          leadId: conversation.leadId,
          provider: this.aiProvider.providerName ?? "unknown",
          model: this.aiProvider.modelName ?? "unknown",
          actionType: "generate_reply",
          inputTokens: 160,
          outputTokens: 74,
          estimatedCost: "0.000000",
          latencyMs: 35,
          status: "SUCCESS",
          metadata: {
            recommendation: recommendation.action,
            reason: recommendation.reason
          }
        }
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: aiCreatedAt,
          handoffRequested: conversation.handoffRequested || aiReply.handoffRequired || recommendation.handoffRequired,
          status: aiReply.handoffRequired || recommendation.handoffRequired ? "WAITING_FOR_HUMAN" : conversation.status
        }
      });
    }

    if (conversation.leadId) {
      await this.prisma.leadEvent.create({
        data: {
          tenantId: context.tenantId,
          leadId: conversation.leadId,
          type: "message_sent",
          title: "Message sent",
          message: dto.text,
          metadata: { conversationId: conversation.id }
        }
      });
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "message.sent",
        entityType: "conversation",
        entityId: conversation.id,
        payload: {
          aiReplyGenerated: conversation.aiEnabled && !aiReplyQueued,
          aiReplyQueued,
          ...(aiReplyQueueReason ? { aiReplyQueueReason } : {})
        }
      }
    });

    return this.get(context, id);
  }

  async updateStatus(context: RequestContext, id: string, dto: UpdateConversationStatusDto): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    const conversation = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: dto.status,
        handoffRequested: dto.status === "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.status_changed", conversation.id, { status: dto.status });
    return this.get(context, id);
  }

  async assign(context: RequestContext, id: string, dto: AssignConversationDto): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        assignedToUserId: dto.userId ?? context.userId,
        status: "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.assigned", id, { userId: dto.userId ?? context.userId });
    return this.get(context, id);
  }

  async handoff(context: RequestContext, id: string): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        handoffRequested: true,
        status: "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.handoff_requested", id, {});
    return this.get(context, id);
  }

  private async loadConversation(tenantId: string, id: string): Promise<ConversationWithDetail> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        lead: {
          include: {
            assignedTo: { select: { name: true } },
            events: { orderBy: { createdAt: "desc" }, take: 20 }
          }
        },
        channel: true,
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found.");
    }
    return conversation;
  }

  private async ensureConversation(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found.");
    }
    return conversation;
  }

  private mapConversationPreview(conversation: ConversationWithPreview): ConversationDetail {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      leadId: conversation.leadId,
      channel: this.mapChannel(conversation.channel),
      channelType: conversation.channel?.type ?? null,
      status: conversation.status,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      aiEnabled: conversation.aiEnabled,
      handoffRequested: conversation.handoffRequested,
      lead: conversation.lead ? this.mapLead(conversation.lead) : null,
      lastMessage: conversation.messages[0]?.text ?? null,
      unreadCount: conversation.status === "OPEN" ? 1 : 0,
      messages: [],
      events: []
    };
  }

  private mapConversationDetail(conversation: ConversationWithDetail): ConversationDetail {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      leadId: conversation.leadId,
      channel: this.mapChannel(conversation.channel),
      channelType: conversation.channel?.type ?? null,
      status: conversation.status,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      aiEnabled: conversation.aiEnabled,
      handoffRequested: conversation.handoffRequested,
      lead: conversation.lead ? this.mapLead(conversation.lead) : null,
      lastMessage: conversation.messages.at(-1)?.text ?? null,
      unreadCount: conversation.status === "OPEN" ? 1 : 0,
      messages: conversation.messages.map((message) => this.mapMessage(message)),
      events:
        conversation.lead?.events.map((event) => ({
          id: event.id,
          leadId: event.leadId,
          type: event.type,
          title: event.title,
          message: event.message,
          createdAt: event.createdAt.toISOString()
        })) ?? []
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
      createdAt: lead.createdAt.toISOString()
    };
  }

  private mapMessage(message: ConversationWithDetail["messages"][number]): Message {
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      text: message.text,
      status: message.status,
      createdAt: message.createdAt.toISOString()
    };
  }

  private mapChannel(channel: ConversationWithDetail["channel"]): Channel | null {
    if (!channel) {
      return null;
    }
    return {
      id: channel.id,
      tenantId: channel.tenantId,
      type: channel.type,
      status: channel.status,
      name: channel.name,
      lastHealthAt: channel.lastHealthAt?.toISOString() ?? null
    };
  }

  private async logConversationAction(context: RequestContext, action: string, entityId: string, payload: Prisma.JsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "conversation",
        entityId,
        payload
      }
    });
  }
}
