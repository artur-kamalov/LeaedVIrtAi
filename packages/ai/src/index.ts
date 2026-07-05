export type AiActionType =
  | "reply_to_customer"
  | "ask_qualifying_question"
  | "extract_lead_fields"
  | "summarize_conversation"
  | "recommend_next_action"
  | "create_task_draft"
  | "create_booking_draft"
  | "create_order_draft"
  | "send_to_crm_draft"
  | "schedule_follow_up"
  | "request_human_handoff";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiReplyInput {
  tenantId: string;
  businessName: string;
  businessType?: string;
  conversationId: string;
  messages: AiMessage[];
}

export interface AiReplyResult {
  reply: string;
  intent: string;
  leadFields: Record<string, unknown>;
  nextAction: {
    type: AiActionType | "none";
    reason: string;
  };
  confidence: number;
  handoffRequired: boolean;
}

export interface AiExtractionInput {
  tenantId: string;
  conversationId: string;
  text: string;
}

export interface AiExtractionResult {
  fields: Record<string, unknown>;
  confidence: number;
}

export interface AiSummaryInput {
  tenantId: string;
  conversationId: string;
  messages: AiMessage[];
}

export interface AiSummaryResult {
  summary: string;
  nextBestAction: string;
}

export interface AiIntentInput {
  tenantId: string;
  text: string;
}

export interface AiIntentResult {
  intent: string;
  confidence: number;
}

export interface AiRecommendationInput {
  tenantId: string;
  conversationId?: string;
  leadStatus?: string;
  text: string;
}

export interface AiRecommendationResult {
  action: AiActionType | "none";
  reason: string;
  confidence: number;
  handoffRequired: boolean;
}

export interface AiProvider {
  readonly providerName?: string;
  readonly modelName?: string;
  generateReply(input: AiReplyInput): Promise<AiReplyResult>;
  extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult>;
  summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult>;
  classifyIntent(input: AiIntentInput): Promise<AiIntentResult>;
  recommendNextAction(input: AiRecommendationInput): Promise<AiRecommendationResult>;
}

export const AI_PROVIDER_TOKEN = "LEADVIRT_AI_PROVIDER";

export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AiVerbosity = "low" | "medium" | "high";

export class MockAiProvider implements AiProvider {
  readonly providerName = "mock";
  readonly modelName = "leadvirt-local-mock";

  generateReply(input: AiReplyInput): Promise<AiReplyResult> {
    const lastMessage = input.messages.at(-1)?.content.toLowerCase() ?? "";
    const handoffRequired = /refund|angry|human|manager|legal|medical/.test(lastMessage);
    const wantsBooking = /book|appointment|schedule|запис|slot/.test(lastMessage);

    return Promise.resolve({
      reply: handoffRequired
        ? "Я подключу менеджера и сохраню контекст лида."
        : wantsBooking
          ? "Помогу с записью. Какой день и время удобны клиенту?"
          : "Спасибо, я квалифицирую заявку. Уточните услугу, удобное время и контакты.",
      intent: wantsBooking ? "booking_request" : "lead_qualification",
      leadFields: wantsBooking ? { interest: "booking" } : {},
      nextAction: {
        type: handoffRequired ? "request_human_handoff" : "ask_qualifying_question",
        reason: handoffRequired ? "Обнаружен запрос, требующий проверки менеджером" : "Нужно больше деталей по лиду"
      },
      confidence: handoffRequired ? 0.72 : 0.88,
      handoffRequired
    });
  }

  extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult> {
    return Promise.resolve({
      fields: {
        summary: input.text.slice(0, 180),
        source: "mock-ai"
      },
      confidence: 0.76
    });
  }

  summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult> {
    const customerMessages = input.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .slice(-3)
      .join(" ");

    return Promise.resolve({
      summary: customerMessages || "Сообщений от клиента пока нет.",
      nextBestAction: "Задать один уточняющий вопрос и оставить передачу менеджеру доступной."
    });
  }

  classifyIntent(input: AiIntentInput): Promise<AiIntentResult> {
    const text = input.text.toLowerCase();
    if (/book|appointment|schedule|запис/.test(text)) {
      return Promise.resolve({ intent: "booking_request", confidence: 0.86 });
    }
    if (/price|cost|стоим|цена|сколько/.test(text)) {
      return Promise.resolve({ intent: "pricing_question", confidence: 0.82 });
    }
    return Promise.resolve({ intent: "general_lead", confidence: 0.7 });
  }

  recommendNextAction(input: AiRecommendationInput): Promise<AiRecommendationResult> {
    const text = input.text.toLowerCase();
    if (/врач|операц|медицин|юрист|договор|refund|angry|manager|human/.test(text)) {
      return Promise.resolve({
        action: "request_human_handoff",
        reason: "Сообщение требует проверки менеджером, прежде чем LeadVirt.ai продолжит безопасно.",
        confidence: 0.72,
        handoffRequired: true
      });
    }

    if (/запис|брон|book|appointment|slot|time/.test(text)) {
      return Promise.resolve({
        action: "create_booking_draft",
        reason: "Лид готов выбрать или подтвердить время записи.",
        confidence: 0.88,
        handoffRequired: false
      });
    }

    if (/заказ|оплат|достав|order|invoice|cart/.test(text)) {
      return Promise.resolve({
        action: "create_order_draft",
        reason: "Лид обсуждает заказ, нужны структурированные детали.",
        confidence: 0.84,
        handoffRequired: false
      });
    }

    if (input.leadStatus === "QUALIFIED") {
      return Promise.resolve({
        action: "send_to_crm_draft",
        reason: "Лид достаточно квалифицирован для подготовки синхронизации с CRM.",
        confidence: 0.8,
        handoffRequired: false
      });
    }

    return Promise.resolve({
      action: "ask_qualifying_question",
      reason: "Нужны дополнительные контакты, потребность, сроки или бюджет.",
      confidence: 0.76,
      handoffRequired: false
    });
  }
}

type JsonSchema = Record<string, unknown>;

interface OpenAiResponsePayload {
  output_text?: unknown;
  output?: unknown;
}

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: AiReasoningEffort;
  verbosity?: AiVerbosity;
  timeoutMs?: number;
}

const actionValues: Array<AiActionType | "none"> = [
  "reply_to_customer",
  "ask_qualifying_question",
  "extract_lead_fields",
  "summarize_conversation",
  "recommend_next_action",
  "create_task_draft",
  "create_booking_draft",
  "create_order_draft",
  "send_to_crm_draft",
  "schedule_follow_up",
  "request_human_handoff",
  "none"
];

const replySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "intent", "leadFields", "nextAction", "confidence", "handoffRequired"],
  properties: {
    reply: { type: "string" },
    intent: { type: "string" },
    leadFields: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "interest", "name", "phone", "email"],
      properties: {
        summary: { type: "string" },
        interest: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" }
      }
    },
    nextAction: {
      type: "object",
      additionalProperties: false,
      required: ["type", "reason"],
      properties: {
        type: { type: "string", enum: actionValues },
        reason: { type: "string" }
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    handoffRequired: { type: "boolean" }
  }
};

const extractionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "confidence"],
  properties: {
    fields: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "interest", "name", "phone", "email", "source"],
      properties: {
        summary: { type: "string" },
        interest: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        source: { type: "string" }
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

const summarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "nextBestAction"],
  properties: {
    summary: { type: "string" },
    nextBestAction: { type: "string" }
  }
};

const intentSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence"],
  properties: {
    intent: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

const recommendationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "reason", "confidence", "handoffRequired"],
  properties: {
    action: { type: "string", enum: actionValues },
    reason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    handoffRequired: { type: "boolean" }
  }
};

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function hasContentArray(value: unknown): value is { content: unknown[] } {
  return typeof value === "object" && value !== null && "content" in value && Array.isArray((value as { content?: unknown }).content);
}

function hasText(value: unknown): value is { text: string } {
  return typeof value === "object" && value !== null && "text" in value && typeof (value as { text?: unknown }).text === "string";
}

function outputText(payload: OpenAiResponsePayload): string {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts: string[] = [];
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!hasContentArray(item)) continue;
      for (const content of item.content) {
        if (hasText(content)) {
          parts.push(content.text);
        }
      }
    }
  }

  return parts.join("\n").trim();
}

function boundedConfidence(value: unknown, fallback = 0.7) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function actionValue(value: unknown, fallback: AiActionType | "none"): AiActionType | "none" {
  return typeof value === "string" && actionValues.includes(value as AiActionType | "none") ? (value as AiActionType | "none") : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

export class OpenAiProvider implements AiProvider {
  readonly providerName = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly reasoningEffort: AiReasoningEffort;
  private readonly verbosity: AiVerbosity;
  private readonly timeoutMs: number;

  constructor(options: OpenAiProviderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) {
      throw new Error("AI_API_KEY is required when AI_PROVIDER=openai");
    }
    this.modelName = options.model?.trim() || "gpt-5.5";
    this.baseUrl = trimBaseUrl(options.baseUrl?.trim() || "https://api.openai.com/v1");
    this.reasoningEffort = options.reasoningEffort ?? "low";
    this.verbosity = options.verbosity ?? "low";
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  async generateReply(input: AiReplyInput): Promise<AiReplyResult> {
    const parsed = await this.callJson<Record<string, unknown>>("leadvirt_reply", replySchema, [
      "You are LeadVirt.ai, an AI administrator for inbound business leads.",
      "Reply in the customer's language, defaulting to Russian when unclear.",
      "Be concise, useful, and honest. Ask at most one qualifying question.",
      "Do not make legal, medical, financial, refund, or availability guarantees.",
      "Set handoffRequired=true when the customer explicitly asks for a human, is upset, or the topic is high risk.",
      `Business: ${input.businessName}${input.businessType ? ` (${input.businessType})` : ""}.`,
      "Return only the requested structured JSON."
    ].join("\n"), input.messages);

    const nextAction = objectValue(parsed.nextAction);
    return {
      reply: stringField(parsed, "reply") || "Спасибо, я передам запрос менеджеру и сохраню контекст.",
      intent: stringField(parsed, "intent") || "general_lead",
      leadFields: objectValue(parsed.leadFields),
      nextAction: {
        type: actionValue(nextAction.type, "ask_qualifying_question"),
        reason: stringField(nextAction, "reason")
      },
      confidence: boundedConfidence(parsed.confidence),
      handoffRequired: parsed.handoffRequired === true
    };
  }

  async extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult> {
    const parsed = await this.callJson<Record<string, unknown>>("leadvirt_extract_lead_fields", extractionSchema, [
      "Extract structured lead fields from the customer message.",
      "Use empty strings for fields that are not present.",
      "Keep summary short and factual.",
      "Return only the requested structured JSON."
    ].join("\n"), [{ role: "user", content: input.text }]);

    return {
      fields: objectValue(parsed.fields),
      confidence: boundedConfidence(parsed.confidence, 0.6)
    };
  }

  async summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult> {
    const parsed = await this.callJson<Record<string, unknown>>("leadvirt_summary", summarySchema, [
      "Summarize the lead conversation for a manager.",
      "Mention the customer's need, known constraints, open questions, and the best next action.",
      "Return only the requested structured JSON."
    ].join("\n"), input.messages);

    return {
      summary: stringField(parsed, "summary") || "Нет достаточного контекста для резюме.",
      nextBestAction: stringField(parsed, "nextBestAction") || "Попросить менеджера проверить диалог вручную."
    };
  }

  async classifyIntent(input: AiIntentInput): Promise<AiIntentResult> {
    const parsed = await this.callJson<Record<string, unknown>>("leadvirt_intent", intentSchema, [
      "Classify the customer's business intent in 1-3 lowercase words.",
      "Return only the requested structured JSON."
    ].join("\n"), [{ role: "user", content: input.text }]);

    return {
      intent: stringField(parsed, "intent") || "general_lead",
      confidence: boundedConfidence(parsed.confidence)
    };
  }

  async recommendNextAction(input: AiRecommendationInput): Promise<AiRecommendationResult> {
    const parsed = await this.callJson<Record<string, unknown>>("leadvirt_recommendation", recommendationSchema, [
      "Recommend the safest next operational action for this lead.",
      "Prefer ask_qualifying_question unless the lead is ready for booking/order/CRM or needs human handoff.",
      `Current lead status: ${input.leadStatus ?? "unknown"}.`,
      "Return only the requested structured JSON."
    ].join("\n"), [{ role: "user", content: input.text }]);

    return {
      action: actionValue(parsed.action, "ask_qualifying_question"),
      reason: stringField(parsed, "reason"),
      confidence: boundedConfidence(parsed.confidence),
      handoffRequired: parsed.handoffRequired === true
    };
  }

  private async callJson<T>(name: string, schema: JsonSchema, instructions: string, messages: AiMessage[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.modelName,
          input: [
            { role: "system", content: [{ type: "input_text", text: instructions }] },
            ...messages.map((message) => ({
              role: message.role === "assistant" ? "assistant" : "user",
              content: [{ type: "input_text", text: message.content }]
            }))
          ],
          reasoning: { effort: this.reasoningEffort },
          text: {
            format: {
              type: "json_schema",
              name,
              strict: true,
              schema
            },
            verbosity: this.verbosity
          },
          store: false
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => null)) as OpenAiResponsePayload | null;
      if (!response.ok) {
        throw new Error(`OpenAI responses API failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
      }

      const text = payload ? outputText(payload) : "";
      if (!text) {
        throw new Error("OpenAI responses API returned no output text");
      }

      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
