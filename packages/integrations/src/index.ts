import { TelegramBotApiClient } from "./telegram-bot-api.js";
import { WebhookDeliveryClient } from "./webhook-delivery.js";

export * from "./credentials.js";
export * from "./telegram-bot-api.js";
export * from "./webhook-delivery.js";

export type IntegrationChannelType =
  | "WEBSITE"
  | "TELEGRAM"
  | "WHATSAPP"
  | "INSTAGRAM"
  | "VK"
  | "EMAIL"
  | "WEBHOOK"
  | "PHONE"
  | "DEMO";

export interface WebhookVerificationInput {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  secret?: string;
}

export interface NormalizedAttachment {
  url: string;
  mimeType?: string;
  fileName?: string;
}

export interface NormalizedAuthenticatedCustomerClaim {
  provider: "TELEGRAM";
  subjectSource: "TELEGRAM_MESSAGE_FROM_ID";
  conversationType: "PRIVATE";
  externalSubjectId: string;
}

export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalConversationId: string;
  customerExternalId: string;
  eventKind?: "MESSAGE" | "MESSAGE_EDITED";
  authenticatedCustomer?: NormalizedAuthenticatedCustomerClaim;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  timestamp: string;
  raw: unknown;
}

export interface SendMessageInput {
  tenantId: string;
  channelAccountId: string;
  conversationId: string;
  externalConversationId: string;
  text: string;
  attachments?: string[];
  settings?: unknown;
  credentials?: unknown;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SendMessageResult {
  externalMessageId: string;
  status: "queued" | "sent" | "failed";
}

export type AuthoritativeOperationOutcome = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface OperationStatusReadInput {
  tenantId: string;
  operationType: "EXTERNAL_OPERATION" | "CHANNEL_DELIVERY" | "TOOL_OPERATION";
  provider?: string;
  operationKind: string;
  externalReference?: string;
  providerIdempotencyKey?: string;
  requestHash: string;
  signal?: AbortSignal;
}

export type OperationStatusReadResult =
  | { supported: false }
  | {
      supported: true;
      authoritative: boolean;
      outcome: AuthoritativeOperationOutcome;
      evidenceCode?: string;
      evidence?: unknown;
    };

export interface OperationStatusReader {
  readStatus(input: OperationStatusReadInput): Promise<OperationStatusReadResult>;
}

export interface ChannelAdapter {
  type: IntegrationChannelType;
  verifyWebhook?(input: WebhookVerificationInput): Promise<boolean>;
  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}

export interface CalendarAdapter {
  provider: string;
  createBooking(input: {
    tenantId: string;
    leadId: string;
    title: string;
    startsAt: string;
    endsAt?: string;
  }): Promise<{ externalId: string; url?: string }>;
}

export type IntegrationAdapterOperation = "NORMALIZE_INBOUND" | "SEND_MESSAGE" | "CREATE_BOOKING";

export class IntegrationAdapterUnavailableError extends Error {
  readonly code = "INTEGRATION_ADAPTER_NOT_AVAILABLE";
  readonly retryable = false;

  constructor(
    readonly provider: string,
    readonly operation: IntegrationAdapterOperation,
  ) {
    super(`${provider} adapter does not implement ${operation}.`);
    this.name = "IntegrationAdapterUnavailableError";
  }
}

abstract class UnavailableChannelAdapter implements ChannelAdapter {
  abstract type: IntegrationChannelType;

  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    void input;
    return Promise.reject(new IntegrationAdapterUnavailableError(this.type, "NORMALIZE_INBOUND"));
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    void input;
    return Promise.reject(new IntegrationAdapterUnavailableError(this.type, "SEND_MESSAGE"));
  }
}

export class WebsiteWidgetAdapter extends UnavailableChannelAdapter {
  type = "WEBSITE" as const;
}

export class TelegramAdapter implements ChannelAdapter {
  type = "TELEGRAM" as const;
  private readonly botApi: TelegramBotApiClient;

  constructor(botApi = new TelegramBotApiClient()) {
    this.botApi = botApi;
  }

  verifyWebhook(input: WebhookVerificationInput): Promise<boolean> {
    if (!input.secret) {
      return Promise.resolve(false);
    }
    const token = readHeader(input.headers, "x-telegram-bot-api-secret-token");
    return Promise.resolve(token === input.secret);
  }

  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    const update = isRecord(input) ? input : {};
    const isEditedMessage = !isRecord(update.message) && isRecord(update.edited_message);
    const message = isRecord(update.message)
      ? update.message
      : isEditedMessage
        ? (update.edited_message as Record<string, unknown>)
        : {};
    const chat = isRecord(message.chat) ? message.chat : {};
    const from = isRecord(message.from) ? message.from : {};
    const contact = isRecord(message.contact) ? message.contact : {};
    const updateId = readScalar(update.update_id, "telegram-update");
    const messageId = readScalar(message.message_id, updateId);
    const chatId = readScalar(chat.id, `unknown:${updateId}`);
    const chatType = typeof chat.type === "string" ? chat.type : "unknown";
    const numericChatId = positiveSafeInteger(chat.id);
    const numericSenderId = positiveSafeInteger(from.id);
    const numericContactUserId = positiveSafeInteger(contact.user_id);
    const authenticatedCustomer =
      chatType === "private" &&
      numericChatId !== null &&
      numericSenderId !== null &&
      numericChatId === numericSenderId &&
      from.is_bot === false
        ? {
            provider: "TELEGRAM" as const,
            subjectSource: "TELEGRAM_MESSAGE_FROM_ID" as const,
            conversationType: "PRIVATE" as const,
            externalSubjectId: String(numericSenderId),
          }
        : undefined;
    const firstName = typeof from.first_name === "string" ? from.first_name : "";
    const lastName = typeof from.last_name === "string" ? from.last_name : "";
    const senderUsername = typeof from.username === "string" ? `@${from.username}` : "";
    const senderName =
      [firstName, lastName].filter(Boolean).join(" ") || senderUsername || undefined;
    const chatTitle = typeof chat.title === "string" ? chat.title.trim() : "";
    const chatUsername = typeof chat.username === "string" ? `@${chat.username}` : "";
    const nonPersonalChat = chatType === "group" || chatType === "supergroup";
    const customerName = nonPersonalChat
      ? chatTitle || chatUsername || `Telegram ${chatType}`
      : senderName;
    const phone =
      authenticatedCustomer &&
      numericContactUserId === numericSenderId &&
      typeof contact.phone_number === "string"
        ? contact.phone_number
        : undefined;
    const text =
      typeof message.text === "string"
        ? message.text
        : typeof message.caption === "string"
          ? message.caption
          : "Telegram message";
    const unixDate = typeof message.date === "number" ? message.date : undefined;

    return Promise.resolve({
      externalMessageId: `telegram:${messageId}`,
      externalConversationId: `telegram:${chatId}`,
      customerExternalId: `telegram:${authenticatedCustomer?.externalSubjectId ?? chatId}`,
      eventKind: isEditedMessage ? "MESSAGE_EDITED" : "MESSAGE",
      ...(authenticatedCustomer ? { authenticatedCustomer } : {}),
      ...(customerName ? { customerName } : {}),
      ...(phone ? { customerPhone: phone } : {}),
      text,
      timestamp: unixDate ? new Date(unixDate * 1000).toISOString() : new Date().toISOString(),
      raw: input,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = isRecord(input.credentials) ? input.credentials : {};
    const botToken = firstString(credentials.botToken, credentials.token);
    if (!botToken) throw new Error("Telegram bot credentials are missing.");

    const chatId = input.externalConversationId.replace(/^telegram:/, "").trim();
    if (!chatId) throw new Error("Telegram chat id is missing.");
    const message = await this.botApi.sendMessage({
      botToken,
      chatId,
      text: input.text,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      externalMessageId: `telegram:${message.message_id}`,
      status: "sent",
    };
  }
}

export class EmailAdapter extends UnavailableChannelAdapter {
  type = "EMAIL" as const;
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  provider = "GOOGLE_CALENDAR" as const;

  createBooking(input: {
    tenantId: string;
    leadId: string;
    title: string;
    startsAt: string;
    endsAt?: string;
  }): Promise<{ externalId: string; url?: string }> {
    void input;
    return Promise.reject(new IntegrationAdapterUnavailableError(this.provider, "CREATE_BOOKING"));
  }
}

export class WebhookAdapter extends UnavailableChannelAdapter {
  type = "WEBHOOK" as const;

  constructor(private readonly delivery = new WebhookDeliveryClient()) {
    super();
  }

  verifyWebhook(input: WebhookVerificationInput): Promise<boolean> {
    if (!input.secret) {
      return Promise.resolve(false);
    }

    const explicitSecret =
      readHeader(input.headers, "x-leadvirt-webhook-secret") ??
      readHeader(input.headers, "x-webhook-secret");
    const authHeader = readHeader(input.headers, "authorization");
    const bearerSecret = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    return Promise.resolve(explicitSecret === input.secret || bearerSecret === input.secret);
  }

  override normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    const payload = isRecord(input) ? input : {};
    const message = isRecord(payload.message) ? payload.message : {};
    const customer = firstRecord(payload.customer, payload.contact, payload.lead, payload.from);
    const eventId = readScalar(
      firstValue(payload.eventId, payload.event_id, payload.id),
      "webhook-event",
    );
    const messageId = readScalar(
      firstValue(
        message.id,
        message.messageId,
        message.message_id,
        payload.messageId,
        payload.message_id,
      ),
      eventId,
    );
    const conversationId = readScalar(
      firstValue(
        payload.conversationId,
        payload.conversation_id,
        payload.threadId,
        payload.sessionId,
        payload.orderId,
        customer.id,
        customer.externalId,
      ),
      messageId,
    );
    const customerId = readScalar(
      firstValue(
        customer.id,
        customer.externalId,
        customer.external_id,
        customer.email,
        customer.phone,
      ),
      conversationId,
    );
    const firstName =
      typeof customer.firstName === "string"
        ? customer.firstName
        : typeof customer.first_name === "string"
          ? customer.first_name
          : "";
    const lastName =
      typeof customer.lastName === "string"
        ? customer.lastName
        : typeof customer.last_name === "string"
          ? customer.last_name
          : "";
    const fallbackName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
    const customerName =
      (typeof customer.name === "string" ? customer.name : undefined) ?? fallbackName;
    const customerPhone = typeof customer.phone === "string" ? customer.phone : undefined;
    const customerEmail = typeof customer.email === "string" ? customer.email : undefined;
    const textValue = firstValue(
      message.text,
      payload.text,
      typeof payload.message === "string" ? payload.message : undefined,
      payload.body,
    );
    const text =
      typeof textValue === "string" && textValue.trim().length > 0 ? textValue : "Webhook message";
    const timestampValue = firstValue(
      message.timestamp,
      message.createdAt,
      message.created_at,
      payload.timestamp,
      payload.createdAt,
      payload.created_at,
    );

    return Promise.resolve({
      externalMessageId: `webhook:${messageId}`,
      externalConversationId: `webhook:${conversationId}`,
      customerExternalId: `webhook:${customerId}`,
      ...(customerName ? { customerName } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(customerEmail ? { customerEmail } : {}),
      text,
      timestamp: normalizeTimestamp(timestampValue),
      raw: input,
    });
  }

  override sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.delivery.send(input);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readScalar(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstString(...values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}
