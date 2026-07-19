import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiProvider } from "@leadvirt/ai";
import {
  decryptIntegrationCredentials,
  readWebhookOutboundConfiguration,
} from "@leadvirt/integrations";
import type {
  AiDraftReply,
  Channel,
  ChannelSendMessageJobData,
  ConversationDetail,
  Lead,
  Message,
  PaginatedEnvelope,
} from "@leadvirt/types";
import { Prisma } from "@leadvirt/db";
import { resolveAiBusinessIdentity } from "@leadvirt/knowledge";
import { positiveInt } from "../../common/pagination.js";
import { internalSampleConversationIds } from "../../common/internal-sample.js";
import type { RequestContext } from "../../common/request-context.js";
import { RuntimeQueueService } from "../ai/runtime-queue.service.js";
import { projectChannelSettings } from "../channels/channel-settings.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AssignConversationDto } from "./dto/assign-conversation.dto.js";
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
    messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }]; take: 1 };
  };
}>;

type ConversationWithDetail = Prisma.ConversationGetPayload<{
  include: {
    lead: {
      include: {
        assignedTo: { select: { name: true } };
        events: { orderBy: { createdAt: "desc" }; take: 20 };
      };
    };
    channel: true;
    messages: {
      orderBy: [{ createdAt: "asc" }, { id: "asc" }];
      include: { attachments: true };
    };
  };
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function telegramActivationWelcomeAt(metadata: unknown) {
  const value = isRecord(metadata) ? metadata.telegramActivationWelcomeAt : undefined;
  return typeof value === "string" ? value : null;
}

function channelSendSource(
  channel: ConversationWithDetail["channel"],
): ChannelSendMessageJobData["source"] | null {
  if (!channel) return null;
  if (channel.type === "WEBHOOK" && channel.status !== "ACTIVE") {
    throw new BadRequestException("Activate the webhook channel before sending replies.");
  }
  if (channel.status !== "ACTIVE") return null;
  if (channel.type === "TELEGRAM") return "telegram";
  if (channel.type === "WEBHOOK") {
    try {
      readWebhookOutboundConfiguration(
        channel.settings,
        channel.encryptedCredentials
          ? decryptIntegrationCredentials(channel.encryptedCredentials)
          : undefined,
      );
    } catch {
      throw new BadRequestException(
        "Configure a valid outbound webhook target before sending replies.",
      );
    }
    return "webhook";
  }
  return null;
}

function attachmentKind(mimeType?: string) {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  return "file";
}

function attachmentSummary(attachments: NonNullable<SendMessageDto["attachments"]>) {
  return attachments.map((attachment) => attachment.filename ?? "attachment").join(", ");
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(RuntimeQueueService) private readonly runtimeQueue: RuntimeQueueService,
  ) {}

  async list(
    context: RequestContext,
    query: ListConversationsDto,
  ): Promise<PaginatedEnvelope<ConversationDetail>> {
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
              { messages: { some: { text: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const page = positiveInt(query.page, 1, 100);
    const limit = positiveInt(query.limit, 20, 100);
    const [total, rows, sampleConversationIds] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          lead: { include: { assignedTo: { select: { name: true } } } },
          channel: true,
          messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.loadInternalSampleConversationIds(context.tenantId),
    ]);

    return {
      data: rows.map((row) => this.mapConversationPreview(row, sampleConversationIds.has(row.id))),
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
    };
  }

  async get(context: RequestContext, id: string): Promise<ConversationDetail> {
    const [conversation, sampleConversationIds] = await Promise.all([
      this.loadConversation(context.tenantId, id),
      this.loadInternalSampleConversationIds(context.tenantId),
    ]);
    return this.mapConversationDetail(conversation, sampleConversationIds.has(id));
  }

  async draftAiReply(context: RequestContext, id: string): Promise<AiDraftReply> {
    const conversation = await this.loadConversation(context.tenantId, id);
    const identity = await resolveAiBusinessIdentity(this.prisma, {
      tenantId: context.tenantId,
      legacyIdentity: () => ({
        businessName: context.tenant.name,
        businessType: context.tenant.businessType,
      }),
    });
    return this.aiProvider.generateReply({
      tenantId: context.tenantId,
      businessName: identity.businessName,
      conversationId: conversation.id,
      ...(identity.businessType ? { businessType: identity.businessType } : {}),
      messages: conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? "assistant" : "user",
        content: message.text ?? "",
      })),
    });
  }

  async sendMessage(
    context: RequestContext,
    id: string,
    dto: SendMessageDto,
  ): Promise<ConversationDetail> {
    const conversation = await this.loadConversation(context.tenantId, id);
    const createdAt = new Date();
    const attachments = dto.attachments ?? [];
    const text = dto.text?.trim() ?? "";
    if (!text && attachments.length === 0) {
      throw new BadRequestException("Message text or attachment is required.");
    }
    const deliverySource = text ? channelSendSource(conversation.channel) : null;

    const persisted = await this.prisma.$transaction(async (tx) => {
      await this.fencePendingAiReply(tx, context.tenantId, conversation.id, "HUMAN_MESSAGE_SENT");
      const userMessage = await tx.message.create({
        data: {
          tenantId: context.tenantId,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "USER",
          senderUserId: context.userId,
          text: text || null,
          status: deliverySource ? "QUEUED" : "SENT",
          ...(deliverySource
            ? {
                metadata: {
                  outboundStatus: "queued",
                  attachmentCount: attachments.length,
                },
              }
            : {}),
          createdAt,
          updatedAt: createdAt,
        },
      });
      const deliveryJobId = deliverySource ? `channel-send-${userMessage.id}` : null;

      if (attachments.length > 0) {
        await tx.messageAttachment.createMany({
          data: attachments.map((attachment) => ({
            tenantId: context.tenantId,
            messageId: userMessage.id,
            kind: attachmentKind(attachment.mimeType),
            url: attachment.dataUrl,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
            ...(typeof attachment.sizeBytes === "number"
              ? { sizeBytes: attachment.sizeBytes }
              : {}),
          })),
        });
      }

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: createdAt, updatedAt: createdAt },
      });

      const deliveryEvent = deliverySource
        ? await this.runtimeQueue.createChannelDeliveryEvent(tx, {
            tenantId: context.tenantId,
            conversationId: conversation.id,
            messageId: userMessage.id,
            source: deliverySource,
            requestedByUserId: context.userId,
            requestedAt: createdAt.toISOString(),
          })
        : null;
      if (deliveryEvent && deliveryJobId) {
        await tx.message.update({
          where: { id: userMessage.id },
          data: {
            metadata: {
              outboundStatus: "queued",
              deliveryJobId,
              deliveryOutboxId: deliveryEvent.id,
              attachmentCount: attachments.length,
            },
          },
        });
      }

      if (conversation.leadId) {
        await tx.leadEvent.create({
          data: {
            tenantId: context.tenantId,
            leadId: conversation.leadId,
            type: "message_sent",
            title: "Message sent",
            message: text || attachmentSummary(attachments),
            metadata: { conversationId: conversation.id },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "message.sent",
          entityType: "conversation",
          entityId: conversation.id,
          payload: {
            deliverySource,
            deliveryJobId,
            deliveryOutboxId: deliveryEvent?.id ?? null,
            attachmentCount: attachments.length,
          },
        },
      });
      return { deliveryEventId: deliveryEvent?.id ?? null };
    });

    if (persisted.deliveryEventId) this.runtimeQueue.dispatch(persisted.deliveryEventId);

    return this.get(context, id);
  }

  async updateStatus(
    context: RequestContext,
    id: string,
    dto: UpdateConversationStatusDto,
  ): Promise<ConversationDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.fencePendingAiReply(tx, context.tenantId, id, "HUMAN_STATUS_CHANGED");
      await tx.conversation.update({
        where: { id },
        data: {
          status: dto.status,
          handoffRequested: dto.status === "WAITING_FOR_HUMAN",
        },
      });
      await this.logConversationAction(
        context,
        "conversation.status_changed",
        id,
        { status: dto.status },
        tx,
      );
    });
    return this.get(context, id);
  }

  async assign(
    context: RequestContext,
    id: string,
    dto: AssignConversationDto,
  ): Promise<ConversationDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.fencePendingAiReply(tx, context.tenantId, id, "HUMAN_ASSIGNED");
      await tx.conversation.update({
        where: { id },
        data: {
          assignedToUserId: dto.userId ?? context.userId,
          status: "WAITING_FOR_HUMAN",
          handoffRequested: true,
        },
      });
      await this.logConversationAction(
        context,
        "conversation.assigned",
        id,
        { userId: dto.userId ?? context.userId },
        tx,
      );
    });
    return this.get(context, id);
  }

  async handoff(context: RequestContext, id: string): Promise<ConversationDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.fencePendingAiReply(tx, context.tenantId, id, "HUMAN_HANDOFF_REQUESTED");
      await tx.conversation.update({
        where: { id },
        data: {
          handoffRequested: true,
          status: "WAITING_FOR_HUMAN",
        },
      });
      await this.logConversationAction(context, "conversation.handoff_requested", id, {}, tx);
    });
    return this.get(context, id);
  }

  private async loadConversation(tenantId: string, id: string): Promise<ConversationWithDetail> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        lead: {
          include: {
            assignedTo: { select: { name: true } },
            events: { orderBy: { createdAt: "desc" }, take: 20 },
          },
        },
        channel: true,
        messages: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { attachments: true },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found.");
    }
    return conversation;
  }

  private mapConversationPreview(
    conversation: ConversationWithPreview,
    isInternalSample: boolean,
  ): ConversationDetail {
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
      unreadCount:
        conversation.status !== "CLOSED" && conversation.messages[0]?.direction === "INBOUND"
          ? 1
          : 0,
      activationWelcomeAt: telegramActivationWelcomeAt(conversation.metadata),
      isInternalSample,
      messages: [],
      events: [],
    };
  }

  private mapConversationDetail(
    conversation: ConversationWithDetail,
    isInternalSample: boolean,
  ): ConversationDetail {
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
      unreadCount:
        conversation.status !== "CLOSED" && conversation.messages.at(-1)?.direction === "INBOUND"
          ? 1
          : 0,
      activationWelcomeAt: telegramActivationWelcomeAt(conversation.metadata),
      isInternalSample,
      messages: conversation.messages.map((message) => this.mapMessage(message)),
      events:
        conversation.lead?.events.map((event) => ({
          id: event.id,
          leadId: event.leadId,
          type: event.type,
          title: event.title,
          message: event.message,
          createdAt: event.createdAt.toISOString(),
        })) ?? [],
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

  private mapMessage(message: ConversationWithDetail["messages"][number]): Message {
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      text: message.text,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        tenantId: attachment.tenantId,
        messageId: attachment.messageId,
        kind: attachment.kind,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        url: attachment.url,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt.toISOString(),
      })),
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
      publicKey: channel.publicKey,
      settings: projectChannelSettings(channel.type, channel.settings),
      lastHealthAt: channel.lastHealthAt?.toISOString() ?? null,
      automaticRepliesEnabled: channel.automaticRepliesEnabled,
      automaticRepliesGeneration: channel.automaticRepliesGeneration,
      automaticRepliesPublicationId: channel.automaticRepliesPublicationId,
      automaticRepliesPublicationEtag: channel.automaticRepliesPublicationEtag,
      automaticRepliesActivatedAt: channel.automaticRepliesActivatedAt?.toISOString() ?? null,
    };
  }

  private async loadInternalSampleConversationIds(tenantId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { tenantId, action: "integration.sample_inbound" },
      select: { payload: true },
    });
    return internalSampleConversationIds(logs);
  }

  private async fencePendingAiReply(
    tx: Prisma.TransactionClient,
    tenantId: string,
    conversationId: string,
    reason: string,
  ) {
    const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Conversation"
      WHERE "id" = ${conversationId}
        AND "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (conversations.length !== 1) {
      throw new NotFoundException("Conversation was not found.");
    }
    await tx.aiReplyRun.updateMany({
      where: {
        tenantId,
        conversationId,
        status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"] },
      },
      data: {
        status: "SUPERSEDED",
        completedAt: new Date(),
        errorCode: reason,
        errorMessage: null,
      },
    });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "RuntimeOutbox" AS outbox
      SET "status" = 'DEAD_LETTER'::"RuntimeOutboxStatus",
          "lastErrorCode" = ${reason},
          "lastErrorMessage" = NULL,
          "lockedAt" = NULL,
          "lockExpiresAt" = NULL,
          "lockedBy" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE outbox."tenantId" = ${tenantId}
        AND outbox."eventType" = 'ai.reply.requested'
        AND outbox."status" IN (
          'PENDING'::"RuntimeOutboxStatus",
          'PUBLISHING'::"RuntimeOutboxStatus",
          'FAILED'::"RuntimeOutboxStatus"
        )
        AND EXISTS (
          SELECT 1
          FROM "Message" AS message
          WHERE message."tenantId" = outbox."tenantId"
            AND message."id" = outbox."aggregateId"
            AND message."conversationId" = ${conversationId}
        )
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET "aiGeneration" = "aiGeneration" + 1,
          "aiReplySequence" = "aiReplySequence" + 1,
          "aiReplyFence" = "aiReplySequence" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${conversationId}
        AND "tenantId" = ${tenantId}
    `);
  }

  private async logConversationAction(
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.JsonObject,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await db.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "conversation",
        entityId,
        payload,
      },
    });
  }
}
