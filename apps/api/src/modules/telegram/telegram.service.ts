import { createHash } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  TelegramAdapter,
  type NormalizedInboundMessage,
  type SendMessageResult,
} from "@leadvirt/integrations";
import {
  authenticatedCustomerChannelBindingHash,
  authenticatedCustomerIdentityAttestationHash,
  authenticatedCustomerSubjectHash,
} from "@leadvirt/knowledge";
import { Prisma } from "@leadvirt/db";
import type {
  AiReplyEnqueueRequest,
  AuthenticatedCustomerIdentityReference,
} from "@leadvirt/types";
import { PrismaService } from "../database/prisma.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";
import { RuntimeQueueService } from "../ai/runtime-queue.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  completeWebhookEventStage,
  failWebhookEvent,
} from "../../common/webhook-event-claim.js";
import { assertTenantRuntimeActive } from "../../common/tenant-lifecycle.js";
import { withTelegramLifecycleLock } from "../../common/telegram-lifecycle-lock.js";
import {
  buildTelegramActivationWelcome,
  type TelegramActivationWelcomeMode,
  telegramActivationStartParameterHash,
  telegramActivationWelcomeTtlMs,
} from "./telegram-activation-welcome.js";

type TelegramChannel = Prisma.ChannelGetPayload<{
  include: { tenant: true };
}>;

type TelegramConversation = Prisma.ConversationGetPayload<{
  include: { lead: true };
}>;

export interface TelegramWebhookResult {
  ok: true;
  duplicate: boolean;
  conversationId: string;
  leadId: string | null;
  inboundMessageId: string | null;
  aiMessageId: string | null;
  outboundStatus: SendMessageResult["status"] | "skipped";
  reply: string | null;
}

type TelegramAiDispatchResult = {
  messageId: string | null;
  reply: string | null;
  outbound: SendMessageResult | { externalMessageId: string; status: "skipped" };
};

export type TelegramWebhookOrigin = "TELEGRAM_WEBHOOK" | "INTERNAL_SAMPLE";

const providerName = "telegram";
const adapter = new TelegramAdapter();
const telegramSystemCommandReason = "TELEGRAM_SYSTEM_COMMAND";
const telegramActivationWelcomeReason = "TELEGRAM_ACTIVATION_WELCOME";
const telegramActivationWelcomeKind = "TELEGRAM_ACTIVATION_WELCOME";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function payloadHash(payload: Prisma.InputJsonValue) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function shortSubject(text?: string) {
  return (text ?? "Telegram conversation").trim().slice(0, 80) || "Telegram conversation";
}

function jsonPayload(body: unknown): Prisma.InputJsonValue {
  if (body === null) return { value: null };
  if (typeof body === "string" || typeof body === "number" || typeof body === "boolean")
    return body;
  if (Array.isArray(body) || isRecord(body)) return body as Prisma.InputJsonValue;
  return { unsupportedPayloadType: typeof body };
}

function telegramCommandPayload(
  command: NonNullable<NormalizedInboundMessage["telegramCommand"]>,
): Prisma.InputJsonObject {
  return {
    name: command.name,
    raw: command.raw,
    ...(command.botUsername ? { botUsername: command.botUsername } : {}),
    ...(command.payload ? { payload: command.payload } : {}),
  };
}

function telegramInboundMetadata(
  existing: unknown,
  inbound: NormalizedInboundMessage,
  aiIgnoredReason: string | null,
): Prisma.InputJsonObject {
  const metadata: Record<string, unknown> = {
    ...asRecord(existing),
    customerExternalId: inbound.customerExternalId,
    raw: jsonPayload(inbound.raw),
  };
  delete metadata.telegramCommand;
  delete metadata.aiIgnoredReason;
  if (inbound.telegramCommand) {
    metadata.telegramCommand = telegramCommandPayload(inbound.telegramCommand);
  }
  if (aiIgnoredReason) metadata.aiIgnoredReason = aiIgnoredReason;
  return metadata as Prisma.InputJsonObject;
}

function isTelegramActivationStart(
  inbound: NormalizedInboundMessage,
  telegramSettings: Record<string, unknown>,
) {
  const command = inbound.telegramCommand;
  const payload = command?.payload;
  const tokenHash = telegramSettings.activationWelcomeTokenHash;
  const botUsername = telegramSettings.botUsername;
  if (
    command?.name !== "start" ||
    !payload ||
    typeof tokenHash !== "string" ||
    (command.botUsername &&
      (typeof botUsername !== "string" ||
        command.botUsername.toLowerCase() !== botUsername.toLowerCase()))
  ) {
    return false;
  }
  return telegramActivationStartParameterHash(payload) === tokenHash;
}

function isTelegramActivationWindowActive(telegramSettings: Record<string, unknown>) {
  const requestedAt = telegramSettings.activationWelcomeRequestedAt;
  if (typeof requestedAt !== "string") return false;
  const requestedAtMs = Date.parse(requestedAt);
  const ageMs = Date.now() - requestedAtMs;
  return (
    Number.isFinite(requestedAtMs) && ageMs >= -60_000 && ageMs <= telegramActivationWelcomeTtlMs
  );
}

function assertTelegramInboundPayload(body: unknown) {
  const update = asRecord(body);
  const message = isRecord(update.message)
    ? update.message
    : isRecord(update.edited_message)
      ? update.edited_message
      : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const updateId = update.update_id;
  const messageId = message?.message_id;
  const chatId = chat?.id;
  if (
    typeof updateId !== "number" ||
    !Number.isSafeInteger(updateId) ||
    updateId < 0 ||
    !message ||
    typeof messageId !== "number" ||
    !Number.isSafeInteger(messageId) ||
    messageId <= 0 ||
    !chat ||
    typeof chatId !== "number" ||
    !Number.isSafeInteger(chatId) ||
    chatId === 0
  ) {
    throw new BadRequestException("Telegram update payload is invalid.");
  }
}

@Injectable()
export class TelegramService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService,
    @Inject(RuntimeQueueService) private readonly runtimeQueue: RuntimeQueueService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService,
  ) {}

  async handleWebhook(
    publicKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    origin: TelegramWebhookOrigin,
  ): Promise<TelegramWebhookResult> {
    assertTelegramInboundPayload(body);
    const initialChannel = await this.loadTelegramChannel(publicKey);
    return withTelegramLifecycleLock(
      this.prisma,
      initialChannel.tenantId,
      async (lockBotIdentities) => {
        const channel = await this.loadTelegramChannel(publicKey);
        if (channel.tenantId !== initialChannel.tenantId) {
          throw new ServiceUnavailableException({
            code: "TELEGRAM_WEBHOOK_CHANNEL_CHANGED",
            message: "Telegram channel changed while the update was being accepted.",
            retryable: true,
          });
        }
        await lockBotIdentities([initialChannel.externalId, channel.externalId]);
        return this.handleWebhookLocked(channel, body, headers, origin);
      },
    );
  }

  private async handleWebhookLocked(
    channel: TelegramChannel,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    origin: TelegramWebhookOrigin,
  ): Promise<TelegramWebhookResult> {
    const botId = optionalString(channel.externalId ?? undefined);
    if (!botId || !/^[1-9]\d*$/u.test(botId)) {
      throw new ServiceUnavailableException({
        code: "TELEGRAM_WEBHOOK_IDENTITY_MISSING",
        message: "Telegram webhook identity is not ready.",
        retryable: true,
      });
    }
    const settings = asRecord(channel.settings);
    const telegramSettings = asRecord(settings.telegram);
    const activeSecret = optionalString(
      typeof telegramSettings.webhookSecret === "string"
        ? telegramSettings.webhookSecret
        : undefined,
    );
    const pendingSecret = optionalString(
      typeof telegramSettings.webhookPendingSecret === "string"
        ? telegramSettings.webhookPendingSecret
        : undefined,
    );
    const retiredCredentials = optionalString(
      typeof telegramSettings.retiredBotEncryptedCredentials === "string"
        ? telegramSettings.retiredBotEncryptedCredentials
        : undefined,
    );
    const retiredSecret = optionalString(
      typeof telegramSettings.retiredBotWebhookSecret === "string"
        ? telegramSettings.retiredBotWebhookSecret
        : undefined,
    );
    const retiredBotId = optionalString(
      typeof telegramSettings.retiredBotId === "string" ? telegramSettings.retiredBotId : undefined,
    );
    const hasRetiredState = Boolean(retiredCredentials || retiredSecret || retiredBotId);
    if (
      hasRetiredState &&
      (!retiredCredentials ||
        !retiredSecret ||
        !retiredBotId ||
        retiredSecret === activeSecret ||
        retiredBotId === botId)
    ) {
      throw new ServiceUnavailableException({
        code: "TELEGRAM_WEBHOOK_IDENTITY_CUTOVER_PENDING",
        message: "Telegram bot replacement cleanup is still in progress.",
        retryable: true,
      });
    }
    if (!activeSecret) {
      if (
        pendingSecret &&
        (await adapter.verifyWebhook?.({ headers, body, secret: pendingSecret }))
      ) {
        throw new ServiceUnavailableException({
          code: "TELEGRAM_WEBHOOK_CUTOVER_IN_PROGRESS",
          message: "Telegram bot replacement is still being activated.",
          retryable: true,
        });
      }
      throw new UnauthorizedException("Telegram webhook is not configured.");
    }
    const activeVerified = await adapter.verifyWebhook?.({
      headers,
      body,
      secret: activeSecret,
    });
    if (!activeVerified) {
      if (
        pendingSecret &&
        pendingSecret !== activeSecret &&
        (await adapter.verifyWebhook?.({ headers, body, secret: pendingSecret }))
      ) {
        throw new ServiceUnavailableException({
          code: "TELEGRAM_WEBHOOK_CUTOVER_IN_PROGRESS",
          message: "Telegram bot replacement is still being activated.",
          retryable: true,
        });
      }
      throw new UnauthorizedException("Telegram webhook secret is invalid.");
    }

    const parsedInbound = await adapter.normalizeInbound(body);
    const normalized: NormalizedInboundMessage = {
      ...parsedInbound,
      externalMessageId: this.externalMessageId(body, parsedInbound, botId),
    };
    const payload = jsonPayload(body);
    const eventPayloadHash = payloadHash(payload);
    const externalEventId = this.externalEventId(body, botId);
    const provider = `${providerName}:${channel.id}`;
    const claim = await claimWebhookEvent(this.prisma, {
      tenantId: channel.tenantId,
      provider,
      externalEventId,
      payloadHash: eventPayloadHash,
      payload,
      receivedAt: new Date(),
    });
    if (!claim.claimed) {
      if (claim.event.status === "RECEIVED") {
        throw new ServiceUnavailableException({
          code: "TELEGRAM_WEBHOOK_IN_PROGRESS",
          message: "Telegram update processing is still in progress.",
          retryable: true,
        });
      }
      return this.duplicateResponse(channel, normalized);
    }
    const webhookEvent = claim.event;
    const claimToken = claim.claimToken;

    try {
      const conversation = await this.upsertConversation(channel, normalized);
      const inbound = await this.createInboundMessage(channel, conversation, normalized, {
        origin,
        webhookEventId: webhookEvent.id,
        claimToken,
        eventPayloadHash,
        authenticatedAt: webhookEvent.receivedAt,
      });
      const shouldProcessMessage =
        inbound.created || (claim.resumed && normalized.eventKind !== "MESSAGE_EDITED");
      let aiResult: TelegramAiDispatchResult = {
        messageId: inbound.activationWelcome?.messageId ?? null,
        reply: inbound.activationWelcome?.text ?? null,
        outbound: inbound.activationWelcome
          ? {
              externalMessageId: inbound.activationWelcome.deliveryJobId,
              status: "queued",
            }
          : inbound.aiDispatchPersisted
            ? {
                externalMessageId: `ai-reply:${conversation.id}:${inbound.message.id}`,
                status: "queued",
              }
            : { externalMessageId: "", status: "skipped" as const },
      };
      if (!webhookEvent.aiDispatchCompletedAt && !inbound.aiDispatchCompleted) {
        if (shouldProcessMessage && !normalized.telegramCommand) {
          aiResult = await this.generateAndQueueReply(
            channel,
            conversation,
            normalized,
            inbound.message.id,
          );
        }
        await completeWebhookEventStage(this.prisma, {
          eventId: webhookEvent.id,
          claimToken,
          stage: "aiDispatchCompletedAt",
        });
      }

      if (!webhookEvent.workflowDispatchCompletedAt) {
        if (shouldProcessMessage && !normalized.telegramCommand) {
          await this.workflowsService.runForEvent({
            tenantId: channel.tenantId,
            eventType: "message.received",
            idempotencyKey: `telegram-webhook:${webhookEvent.id}`,
            conversationId: conversation.id,
            leadId: conversation.leadId,
            channelType: "TELEGRAM",
            text: normalized.text ?? null,
            source: "telegram",
            receivedAt: new Date(normalized.timestamp),
            metadata: {
              publicKey: channel.publicKey ?? "",
              externalConversationId: normalized.externalConversationId,
              externalMessageId: normalized.externalMessageId,
            },
          });
        }
        await completeWebhookEventStage(this.prisma, {
          eventId: webhookEvent.id,
          claimToken,
          stage: "workflowDispatchCompletedAt",
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await completeWebhookEvent(tx, { eventId: webhookEvent.id, claimToken });
        await tx.auditLog.create({
          data: {
            tenantId: channel.tenantId,
            action: "telegram.webhook.processed",
            entityType: "conversation",
            entityId: conversation.id,
            payload: {
              publicKey: channel.publicKey ?? "",
              externalEventId,
              externalMessageId: normalized.externalMessageId,
              botId,
              eventKind: normalized.eventKind ?? "MESSAGE",
              ...(normalized.telegramCommand
                ? { telegramCommand: normalized.telegramCommand.name }
                : {}),
              messageCreated: inbound.created,
              activationWelcomeQueued: Boolean(inbound.activationWelcome),
              outboundStatus: aiResult.outbound.status,
              ...(inbound.aiDispatchRejectionReason
                ? { aiDispatchRejectionReason: inbound.aiDispatchRejectionReason }
                : {}),
            },
          },
        });
      });

      return {
        ok: true,
        duplicate: false,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        inboundMessageId: inbound.message.id,
        aiMessageId: aiResult.messageId,
        outboundStatus: aiResult.outbound.status,
        reply: aiResult.reply,
      };
    } catch (error) {
      await failWebhookEvent(this.prisma, {
        eventId: webhookEvent.id,
        claimToken,
        errorMessage:
          error instanceof Error ? error.message : "Unknown Telegram webhook processing error",
      });
      throw error;
    }
  }

  private async loadTelegramChannel(publicKey: string): Promise<TelegramChannel> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        publicKey: publicKey.trim(),
        type: "TELEGRAM",
        status: "ACTIVE",
        deletedAt: null,
        tenant: { deletedAt: null },
      },
      include: { tenant: true },
    });
    if (!channel) {
      throw new NotFoundException("Telegram channel was not found.");
    }
    assertTenantRuntimeActive(channel.tenant.status);
    return channel;
  }

  private externalEventId(body: unknown, botId: string) {
    const update = asRecord(body);
    const updateId = update.update_id;
    if (typeof updateId === "string" || typeof updateId === "number") {
      return `telegram:bot:${botId}:update:${String(updateId)}`;
    }
    return `telegram:bot:${botId}:payload:${payloadHash(jsonPayload(body))}`;
  }

  private externalMessageId(body: unknown, normalized: NormalizedInboundMessage, botId: string) {
    const update = asRecord(body);
    const message = isRecord(update.message)
      ? update.message
      : isRecord(update.edited_message)
        ? update.edited_message
        : null;
    const messageId = message?.message_id;
    return `telegram:bot:${botId}:message:${
      typeof messageId === "number" || typeof messageId === "string"
        ? String(messageId)
        : normalized.externalMessageId
    }`;
  }

  private async duplicateResponse(
    channel: TelegramChannel,
    normalized: NormalizedInboundMessage,
  ): Promise<TelegramWebhookResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalConversationId: normalized.externalConversationId,
        deletedAt: null,
      },
      select: { id: true, leadId: true },
    });
    return {
      ok: true,
      duplicate: true,
      conversationId: conversation?.id ?? "",
      leadId: conversation?.leadId ?? null,
      inboundMessageId: null,
      aiMessageId: null,
      outboundStatus: "skipped",
      reply: null,
    };
  }

  private async upsertConversation(
    channel: TelegramChannel,
    inbound: NormalizedInboundMessage,
  ): Promise<TelegramConversation> {
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `conversation:${channel.tenantId}:${channel.id}:${inbound.externalConversationId}`;
      await tx.$queryRaw(Prisma.sql`
        SELECT TRUE AS "locked"
        FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
      `);
      const channelState = await tx.$queryRaw<Array<{ automaticRepliesEnabled: boolean }>>(
        Prisma.sql`
          SELECT "automaticRepliesEnabled"
          FROM "Channel"
          WHERE "id" = ${channel.id}
            AND "tenantId" = ${channel.tenantId}
            AND "deletedAt" IS NULL
          FOR SHARE
        `,
      );
      const existing = await tx.conversation.findFirst({
        where: {
          tenantId: channel.tenantId,
          channelId: channel.id,
          externalConversationId: inbound.externalConversationId,
          deletedAt: null,
        },
        include: { lead: true },
      });
      const receivedAt = new Date(inbound.timestamp);

      if (existing) return existing;

      const lead = await tx.lead.create({
        data: {
          tenantId: channel.tenantId,
          ...(inbound.customerName ? { name: inbound.customerName } : {}),
          ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
          source: "Telegram-бот",
          channelType: "TELEGRAM",
          status: "NEW",
          temperature: "WARM",
          interest: shortSubject(inbound.text),
          summary: "Новый диалог из Telegram.",
          customFields: {
            telegramCustomerExternalId: inbound.customerExternalId,
            telegramConversationExternalId: inbound.externalConversationId,
          },
          lastMessageAt: receivedAt,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          channelId: channel.id,
          externalConversationId: inbound.externalConversationId,
          status: "OPEN",
          subject: shortSubject(inbound.text),
          lastMessageAt: receivedAt,
          aiEnabled: channelState[0]?.automaticRepliesEnabled ?? false,
          metadata: {
            telegramCustomerExternalId: inbound.customerExternalId,
            telegramConversationExternalId: inbound.externalConversationId,
          },
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
        include: { lead: true },
      });

      await tx.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          type: "conversation_started",
          title: "Telegram conversation started",
          message: inbound.text ?? null,
          metadata: {
            conversationId: conversation.id,
            externalConversationId: inbound.externalConversationId,
          },
        },
      });

      return conversation;
    });
  }

  private async createInboundMessage(
    channel: TelegramChannel,
    conversation: TelegramConversation,
    inbound: NormalizedInboundMessage,
    authentication: {
      origin: TelegramWebhookOrigin;
      webhookEventId: string;
      claimToken: string;
      eventPayloadHash: string;
      authenticatedAt: Date;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const authenticatedCustomer =
        authentication.origin === "TELEGRAM_WEBHOOK" &&
        channel.externalId &&
        channel.publicKey &&
        inbound.authenticatedCustomer
          ? inbound.authenticatedCustomer
          : undefined;
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Conversation"
        WHERE "id" = ${conversation.id} AND "tenantId" = ${channel.tenantId} AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException("Telegram conversation was not found.");
      const lockedChannel = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Channel"
        WHERE "id" = ${channel.id} AND "tenantId" = ${channel.tenantId} AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (lockedChannel.length !== 1)
        throw new NotFoundException("Telegram channel was not found.");
      const currentChannel = await tx.channel.findUniqueOrThrow({
        where: { id: channel.id },
        select: { settings: true },
      });
      const currentSettings = asRecord(currentChannel.settings);
      const currentTelegramSettings = asRecord(currentSettings.telegram);
      const activationWelcomeBaseEligible = Boolean(
        authentication.origin === "TELEGRAM_WEBHOOK" &&
        inbound.eventKind !== "MESSAGE_EDITED" &&
        inbound.authenticatedCustomer &&
        currentTelegramSettings.activationWelcomePending === true,
      );
      const activationWelcomeMode: TelegramActivationWelcomeMode | null =
        activationWelcomeBaseEligible && isTelegramActivationStart(inbound, currentTelegramSettings)
          ? "SETUP_START"
          : activationWelcomeBaseEligible &&
              !inbound.telegramCommand &&
              isTelegramActivationWindowActive(currentTelegramSettings)
            ? "FIRST_MESSAGE"
            : null;
      const activationWelcomeEligible = activationWelcomeMode !== null;
      const aiIgnoredReason = inbound.telegramCommand
        ? telegramSystemCommandReason
        : activationWelcomeEligible
          ? telegramActivationWelcomeReason
          : null;
      const existing = await tx.message.findFirst({
        where: {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          externalMessageId: inbound.externalMessageId,
        },
        select: { id: true, createdAt: true, metadata: true },
      });
      if (existing) {
        const expectedSubjectHash = authenticatedCustomer
          ? authenticatedCustomerSubjectHash({
              tenantId: channel.tenantId,
              channelId: channel.id,
              provider: authenticatedCustomer.provider,
              externalSubjectId: authenticatedCustomer.externalSubjectId,
            })
          : null;
        const customerIdentity = expectedSubjectHash
          ? await tx.authenticatedCustomerIdentity.findFirst({
              where: {
                tenantId: channel.tenantId,
                messageId: existing.id,
                subjectHash: expectedSubjectHash,
              },
              select: { id: true, version: true, subjectHash: true, attestationHash: true },
            })
          : null;
        const message =
          inbound.eventKind === "MESSAGE_EDITED"
            ? await tx.message.update({
                where: { id: existing.id },
                data: {
                  text: inbound.text ?? null,
                  metadata: telegramInboundMetadata(
                    existing.metadata,
                    inbound,
                    inbound.telegramCommand ? telegramSystemCommandReason : null,
                  ),
                  updatedAt: new Date(),
                },
              })
            : existing;
        const latestMessage = await tx.message.findFirst({
          where: {
            tenantId: channel.tenantId,
            conversationId: conversation.id,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, createdAt: true },
        });
        if (inbound.eventKind === "MESSAGE_EDITED" && conversation.leadId) {
          await tx.lead.update({
            where: { id: conversation.leadId },
            data: {
              ...(latestMessage ? { lastMessageAt: latestMessage.createdAt } : {}),
              ...(inbound.customerName ? { name: inbound.customerName } : {}),
              ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
            },
          });
        }
        if (inbound.eventKind === "MESSAGE_EDITED" && latestMessage) {
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: latestMessage.createdAt },
          });
        }
        await completeWebhookEventStage(tx, {
          eventId: authentication.webhookEventId,
          claimToken: authentication.claimToken,
          stage: "intakeCompletedAt",
        });
        return {
          message,
          created: false,
          aiDispatchPersisted: false,
          aiDispatchCompleted: false,
          aiDispatchRejectionReason: null,
          activationWelcome: null,
          ...(customerIdentity?.version === 1
            ? {
                customerIdentity: {
                  id: customerIdentity.id,
                  version: 1 as const,
                  subjectHash: customerIdentity.subjectHash,
                  attestationHash: customerIdentity.attestationHash,
                },
              }
            : {}),
        };
      }

      const receivedAt = new Date(inbound.timestamp);
      const currentConversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { status: true, metadata: true },
      });

      const message = await tx.message.create({
        data: {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          externalMessageId: inbound.externalMessageId,
          text: inbound.text ?? null,
          status: "RECEIVED",
          metadata: telegramInboundMetadata(null, inbound, aiIgnoredReason),
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
      });
      const latestMessage = await tx.message.findFirstOrThrow({
        where: {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      });
      if (conversation.leadId) {
        await tx.lead.update({
          where: { id: conversation.leadId },
          data: {
            lastMessageAt: latestMessage.createdAt,
            ...(inbound.customerName ? { name: inbound.customerName } : {}),
            ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
          },
        });
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: latestMessage.createdAt,
          ...(currentConversation.status === "CLOSED" ? { status: "OPEN" as const } : {}),
          updatedAt: new Date(),
        },
      });

      let customerIdentity: AuthenticatedCustomerIdentityReference | undefined;
      if (authenticatedCustomer) {
        const version = 1 as const;
        const subjectHash = authenticatedCustomerSubjectHash({
          tenantId: channel.tenantId,
          channelId: channel.id,
          provider: authenticatedCustomer.provider,
          externalSubjectId: authenticatedCustomer.externalSubjectId,
        });
        const channelBindingHash = authenticatedCustomerChannelBindingHash({
          tenantId: channel.tenantId,
          channelId: channel.id,
          channelType: channel.type,
          channelExternalId: channel.externalId ?? "",
          channelPublicKey: channel.publicKey ?? "",
        });
        const identity = {
          tenantId: channel.tenantId,
          version,
          channelId: channel.id,
          conversationId: conversation.id,
          messageId: message.id,
          webhookEventId: authentication.webhookEventId,
          provider: authenticatedCustomer.provider,
          authenticationMethod: "TELEGRAM_WEBHOOK_SECRET" as const,
          subjectSource: authenticatedCustomer.subjectSource,
          conversationType: authenticatedCustomer.conversationType,
          subjectHash,
          channelBindingHash,
          eventPayloadHash: authentication.eventPayloadHash,
          authenticatedAt: authentication.authenticatedAt,
        };
        const attestationHash = authenticatedCustomerIdentityAttestationHash(identity);
        const persisted = await tx.authenticatedCustomerIdentity.create({
          data: { ...identity, attestationHash },
          select: { id: true },
        });
        customerIdentity = {
          id: persisted.id,
          version,
          subjectHash,
          attestationHash,
        };
      }

      let activationWelcome: {
        messageId: string;
        text: string;
        deliveryEventId: string;
        deliveryJobId: string;
      } | null = null;
      if (activationWelcomeEligible) {
        const welcome = buildTelegramActivationWelcome({
          customerName: inbound.customerName ?? null,
          businessName: channel.tenant.name,
          customerLocale: inbound.customerLocale ?? null,
          accountLocale:
            typeof currentTelegramSettings.activationWelcomeLocale === "string"
              ? currentTelegramSettings.activationWelcomeLocale
              : null,
          mode: activationWelcomeMode ?? "SETUP_START",
        });
        const queuedAt = new Date();
        const welcomeMessage = await tx.message.create({
          data: {
            tenantId: channel.tenantId,
            conversationId: conversation.id,
            direction: "OUTBOUND",
            senderType: "SYSTEM",
            text: welcome.text,
            status: "QUEUED",
            metadata: {
              kind: telegramActivationWelcomeKind,
              version: 1,
              locale: welcome.locale,
              scenario: activationWelcomeMode,
              triggerMessageId: message.id,
              outboundStatus: "queued",
            },
            createdAt: queuedAt,
            updatedAt: queuedAt,
          },
        });
        const deliveryJobId = `channel-send-${welcomeMessage.id}`;
        const deliveryEvent = await this.runtimeQueue.createChannelDeliveryEvent(tx, {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          messageId: welcomeMessage.id,
          source: "telegram",
          triggerMessageId: message.id,
          requestedAt: queuedAt.toISOString(),
        });
        await tx.message.update({
          where: { id: welcomeMessage.id },
          data: {
            metadata: {
              kind: telegramActivationWelcomeKind,
              version: 1,
              locale: welcome.locale,
              scenario: activationWelcomeMode,
              triggerMessageId: message.id,
              outboundStatus: "queued",
              deliveryJobId,
              deliveryOutboxId: deliveryEvent.id,
            },
          },
        });
        await tx.channel.update({
          where: { id: channel.id },
          data: {
            settings: {
              ...currentSettings,
              telegram: {
                ...currentTelegramSettings,
                activationWelcomePending: false,
                activationWelcomeConsumedAt: queuedAt.toISOString(),
                activationWelcomeTriggerMessageId: message.id,
                activationWelcomeMessageId: welcomeMessage.id,
                activationWelcomeScenario: activationWelcomeMode,
              },
            },
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: queuedAt,
            updatedAt: queuedAt,
            metadata: {
              ...asRecord(currentConversation.metadata),
              telegramActivationWelcomeAt: queuedAt.toISOString(),
            },
          },
        });
        const telegramIntegration = await tx.integrationAccount.findUnique({
          where: {
            tenantId_provider: { tenantId: channel.tenantId, provider: "TELEGRAM" },
          },
          select: { id: true, settings: true },
        });
        if (telegramIntegration) {
          const integrationSettings = { ...asRecord(telegramIntegration.settings) };
          delete integrationSettings.activationStartParameter;
          await tx.integrationAccount.update({
            where: { id: telegramIntegration.id },
            data: { settings: integrationSettings as Prisma.InputJsonObject },
          });
        }
        if (conversation.leadId) {
          await tx.leadEvent.create({
            data: {
              tenantId: channel.tenantId,
              leadId: conversation.leadId,
              type: "telegram_activation_welcome_queued",
              title: "Telegram activation welcome queued",
              message: welcome.text,
              metadata: {
                conversationId: conversation.id,
                triggerMessageId: message.id,
                messageId: welcomeMessage.id,
                deliveryOutboxId: deliveryEvent.id,
              },
            },
          });
        }
        activationWelcome = {
          messageId: welcomeMessage.id,
          text: welcome.text,
          deliveryEventId: deliveryEvent.id,
          deliveryJobId,
        };
      }

      if (conversation.leadId) {
        await tx.leadEvent.create({
          data: {
            tenantId: channel.tenantId,
            leadId: conversation.leadId,
            type: "telegram_message_received",
            title: "Telegram message received",
            message: inbound.text ?? null,
            metadata: {
              conversationId: conversation.id,
              externalMessageId: inbound.externalMessageId,
            },
          },
        });
      }

      await completeWebhookEventStage(tx, {
        eventId: authentication.webhookEventId,
        claimToken: authentication.claimToken,
        stage: "intakeCompletedAt",
      });

      let aiDispatchPersisted = false;
      let aiDispatchCompleted = false;
      let aiDispatchRejectionReason: string | null = null;
      if (inbound.telegramCommand || activationWelcome) {
        aiDispatchRejectionReason = aiIgnoredReason;
        await completeWebhookEventStage(tx, {
          eventId: authentication.webhookEventId,
          claimToken: authentication.claimToken,
          stage: "aiDispatchCompletedAt",
        });
        aiDispatchCompleted = true;
      } else if (this.aiReplyQueue.enabled) {
        const queueResult = await this.aiReplyQueue.createEvent(
          tx,
          this.aiReplyRequest(channel, conversation, message.id, inbound.text ?? ""),
        );
        if (queueResult.created && conversation.leadId) {
          const queuedJobId = `ai-reply:${conversation.id}:${message.id}`;
          await tx.leadEvent.create({
            data: {
              tenantId: channel.tenantId,
              leadId: conversation.leadId,
              type: "telegram_ai_reply_queued",
              title: "Telegram AI reply queued",
              message: inbound.text ?? "",
              metadata: {
                conversationId: conversation.id,
                externalMessageId: queuedJobId,
                outboundStatus: "queued",
              },
            },
          });
        }
        aiDispatchPersisted = queueResult.created;
        if (!queueResult.created) aiDispatchRejectionReason = queueResult.reason;
        await completeWebhookEventStage(tx, {
          eventId: authentication.webhookEventId,
          claimToken: authentication.claimToken,
          stage: "aiDispatchCompletedAt",
        });
        aiDispatchCompleted = true;
      }
      return {
        message,
        created: true,
        aiDispatchPersisted,
        aiDispatchCompleted,
        aiDispatchRejectionReason,
        activationWelcome,
        ...(customerIdentity ? { customerIdentity } : {}),
      };
    });
    if (result.activationWelcome) {
      this.runtimeQueue.dispatch(result.activationWelcome.deliveryEventId);
    }
    return result;
  }

  private aiReplyRequest(
    channel: TelegramChannel,
    conversation: TelegramConversation,
    triggerMessageId: string,
    text: string,
  ): AiReplyEnqueueRequest {
    return {
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      triggerMessageId,
      text,
      source: "telegram",
    };
  }

  private async generateAndQueueReply(
    channel: TelegramChannel,
    conversation: TelegramConversation,
    inbound: NormalizedInboundMessage,
    triggerMessageId: string,
  ) {
    const text = inbound.text ?? "";
    const jobData = this.aiReplyRequest(channel, conversation, triggerMessageId, text);
    if (!this.aiReplyQueue.enabled) {
      return {
        messageId: null,
        reply: null,
        outbound: { externalMessageId: "", status: "skipped" as const },
      };
    }
    const queueResult = await this.aiReplyQueue.enqueue(jobData);
    if (queueResult.queued) {
      const outbound: SendMessageResult = {
        externalMessageId: queueResult.jobId,
        status: "queued",
      };
      if (conversation.leadId) {
        await this.prisma.leadEvent.create({
          data: {
            tenantId: channel.tenantId,
            leadId: conversation.leadId,
            type: "telegram_ai_reply_queued",
            title: "Telegram AI reply queued",
            message: text,
            metadata: {
              conversationId: conversation.id,
              externalMessageId: outbound.externalMessageId,
              outboundStatus: outbound.status,
            },
          },
        });
      }
      return { messageId: null, reply: null, outbound };
    }
    return {
      messageId: null,
      reply: null,
      outbound: { externalMessageId: "", status: "skipped" as const },
    };
  }
}
