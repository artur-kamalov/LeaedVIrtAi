import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Queue, type ConnectionOptions } from "bullmq";
import type { AiExtractionResult, AiIntentResult, AiMessage, AiProvider, AiRecommendationResult, AiReplyResult } from "@leadvirt/ai";
import { prisma, type Prisma } from "@leadvirt/db";
import type { AiReplyJobData, ChannelSendMessageJobData } from "@leadvirt/types";
import { redactSensitiveData, SpanKind, withSpan } from "@leadvirt/observability";
import { recordAiGraphRun } from "../observability/metrics.js";
import { executeAiToolCalls, planAiToolCalls, type AiToolCall, type AiToolResult } from "./ai-tools.js";

type ConversationRecord = Prisma.ConversationGetPayload<{
  include: {
    tenant: true;
    lead: true;
    messages: true;
  };
}>;

interface RetrievedContext {
  chunkId: string;
  sourceId: string;
  sourceType: string;
  title: string;
  content: string;
  score: number;
}

interface QualityGateResult {
  passed: boolean;
  reason: string;
  confidence: number;
  handoffRequired: boolean;
  finalReply: string;
}

export interface AiReplyGraphResult {
  status: "processed" | "duplicate";
  conversationId: string;
  messageId: string;
  intent?: string;
  handoffRequired?: boolean;
  graphRunId?: string;
  qualityReason?: string;
  qualityPassed?: boolean;
  toolResults?: AiToolResult[];
}

interface RunAiReplyGraphInput {
  data: AiReplyJobData;
  jobId?: string | undefined;
  aiProvider: AiProvider;
}

const nodeNames = [
  "normalize_message",
  "load_tenant_context",
  "retrieve_context",
  "intent_classify",
  "draft_response",
  "decide_tool_calls",
  "quality_gate",
  "execute_tools",
  "persist_audit"
] as const;

const AiReplyState = Annotation.Root({
  data: Annotation<AiReplyJobData>(),
  jobId: Annotation<string | undefined>(),
  graphRunId: Annotation<string>(),
  externalMessageId: Annotation<string>(),
  normalizedText: Annotation<string>(),
  conversation: Annotation<ConversationRecord | undefined>(),
  messages: Annotation<AiMessage[]>(),
  retrievedContext: Annotation<RetrievedContext[]>(),
  intent: Annotation<AiIntentResult | undefined>(),
  extraction: Annotation<AiExtractionResult | undefined>(),
  aiReply: Annotation<AiReplyResult | undefined>(),
  recommendation: Annotation<AiRecommendationResult | undefined>(),
  quality: Annotation<QualityGateResult | undefined>(),
  toolCalls: Annotation<AiToolCall[]>(),
  toolResults: Annotation<AiToolResult[]>(),
  result: Annotation<AiReplyGraphResult | undefined>()
});

type AiReplyStateValue = typeof AiReplyState.State;
type AiReplyStateUpdate = typeof AiReplyState.Update;

function graphNodeSpan<T>(nodeName: string, state: AiReplyStateValue, run: () => Promise<T>): Promise<T> {
  return withSpan(`ai.graph.node ${nodeName}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "leadvirt.graph_run_id": state.graphRunId,
      "leadvirt.tenant_id": state.data.tenantId,
      "leadvirt.conversation_id": state.data.conversationId,
      "leadvirt.source": state.data.source,
      "leadvirt.graph_node": nodeName
    }
  }, run);
}

function requiredGrounding(text: string) {
  return /price|cost|catalog|service|available|availability|slot|policy|refund|discount|цена|стоим|сколько|прайс|услуг|каталог|окн|запис|доступ|график|возврат|скид/i.test(text);
}

function tokenize(text: string) {
  return Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));
}

function scoreText(queryTokens: string[], content: string) {
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  return queryTokens.reduce((score, token) => score + (contentTokens.has(token) ? 1 : 0), 0) / queryTokens.length;
}

function compactContent(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 900);
}

function buildMessages(state: AiReplyStateValue): AiMessage[] {
  const contextText = state.retrievedContext
    .map((item, index) => `[${index + 1}] ${item.title}: ${item.content}`)
    .join("\n");

  if (!contextText) return state.messages;

  return [
    {
      role: "user",
      content: `Контекст бизнеса для ответа. Используй только эти факты, если вопрос про цены, услуги, расписание, правила или доступность.\n${contextText}`
    },
    ...state.messages
  ];
}

function safeFallbackReply() {
  return "Я уточню этот вопрос у менеджера и сохраню контекст обращения, чтобы вам ответили без потери деталей.";
}

function queuedPublicSource(source: AiReplyJobData["source"]) {
  return source === "telegram" || source === "webhook";
}

function channelSendSource(source: AiReplyJobData["source"]): ChannelSendMessageJobData["source"] | null {
  if (source === "telegram" || source === "webhook") return source;
  return null;
}

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6380),
    maxRetriesPerRequest: null
  };

  if (parsed.username) {
    connection.username = decodeURIComponent(parsed.username);
  }

  if (parsed.password) {
    connection.password = decodeURIComponent(parsed.password);
  }

  return connection;
}

async function enqueueChannelDelivery(state: AiReplyStateValue, messageId: string) {
  const source = channelSendSource(state.data.source);
  if (!source) return null;

  const jobId = `channel-send-${messageId}`;
  const queue = new Queue<ChannelSendMessageJobData>("channels.sendMessage", {
    connection: connectionFromRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6380")
  });

  try {
    const job = await queue.add(
      "send-message",
      {
        tenantId: state.data.tenantId,
        conversationId: state.data.conversationId,
        messageId,
        source,
        graphRunId: state.graphRunId,
        triggerMessageId: state.data.triggerMessageId,
        requestedAt: new Date().toISOString()
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
      }
    );

    return job.id ?? jobId;
  } finally {
    await queue.close().catch(() => undefined);
  }
}

function createGraph(aiProvider: AiProvider) {
  return new StateGraph(AiReplyState)
    .addNode("normalize_message", (state): AiReplyStateUpdate => ({
      normalizedText: state.data.text.replace(/\s+/g, " ").trim()
    }))
    .addNode("load_tenant_context", async (state): Promise<AiReplyStateUpdate> => {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: state.data.conversationId,
          tenantId: state.data.tenantId,
          deletedAt: null
        },
        include: {
          tenant: true,
          lead: true,
          messages: { orderBy: { createdAt: "asc" } }
        }
      });

      if (!conversation) {
        throw new Error(`Conversation ${state.data.conversationId} was not found for queued AI reply.`);
      }

      const existingReply = await prisma.message.findFirst({
        where: {
          tenantId: state.data.tenantId,
          conversationId: state.data.conversationId,
          externalMessageId: state.externalMessageId
        },
        select: { id: true }
      });

      if (existingReply) {
        await enqueueChannelDelivery(state, existingReply.id);
        return {
          conversation,
          result: {
            status: "duplicate",
            conversationId: state.data.conversationId,
            messageId: existingReply.id,
            graphRunId: state.graphRunId
          }
        };
      }

      return {
        conversation,
        messages: conversation.messages.map((message) => ({
          role: message.senderType === "AI" ? "assistant" : "user",
          content: message.text ?? ""
        }))
      };
    })
    .addNode("retrieve_context", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("retrieve_context", state, async () => {
      if (state.result) return {};

      const chunks = await prisma.businessKnowledgeChunk.findMany({
        where: {
          tenantId: state.data.tenantId,
          deletedAt: null,
          source: {
            status: "ACTIVE",
            deletedAt: null
          }
        },
        include: {
          source: {
            select: {
              id: true,
              type: true,
              title: true
            }
          }
        },
        orderBy: [{ indexedAt: "desc" }, { updatedAt: "desc" }],
        take: 40
      });

      const queryTokens = tokenize(state.normalizedText);
      const scored = chunks
        .map((chunk) => ({
          chunkId: chunk.id,
          sourceId: chunk.sourceId,
          sourceType: chunk.source.type,
          title: chunk.source.title,
          content: compactContent(chunk.content),
          score: scoreText(queryTokens, `${chunk.source.title} ${chunk.content}`)
        }))
        .sort((left, right) => right.score - left.score);

      const withMatches = scored.filter((chunk) => chunk.score > 0);
      return { retrievedContext: (withMatches.length > 0 ? withMatches : scored).slice(0, 4) };
    }))
    .addNode("intent_classify", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("intent_classify", state, async () => {
      if (state.result) return {};
      return {
        intent: await aiProvider.classifyIntent({
          tenantId: state.data.tenantId,
          text: state.normalizedText
        })
      };
    }))
    .addNode("draft_response", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("draft_response", state, async () => {
      if (state.result) return {};
      return {
        aiReply: await aiProvider.generateReply({
          tenantId: state.data.tenantId,
          businessName: state.data.businessName,
          ...(state.data.businessType ? { businessType: state.data.businessType } : {}),
          conversationId: state.data.conversationId,
          messages: buildMessages(state)
        })
      };
    }))
    .addNode("decide_tool_calls", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("decide_tool_calls", state, async () => {
      if (state.result) return {};
      const [extraction, recommendation] = await Promise.all([
        aiProvider.extractLeadFields({
          tenantId: state.data.tenantId,
          conversationId: state.data.conversationId,
          text: state.normalizedText
        }),
        aiProvider.recommendNextAction({
          tenantId: state.data.tenantId,
          conversationId: state.data.conversationId,
          ...(state.data.leadStatus ? { leadStatus: state.data.leadStatus } : {}),
          text: state.normalizedText
        })
      ]);
      return { extraction, recommendation };
    }))
    .addNode("quality_gate", (state): AiReplyStateUpdate => {
      if (state.result) return {};
      if (!state.aiReply || !state.recommendation) {
        throw new Error("AI graph reached quality_gate without a draft reply or recommendation.");
      }

      const confidence = Math.min(state.aiReply.confidence, state.recommendation.confidence);
      const missingGrounding = requiredGrounding(state.normalizedText) && state.retrievedContext.length === 0;
      const lowConfidence = confidence < 0.45;
      const passed = !missingGrounding && !lowConfidence;
      const handoffRequired = !passed || state.aiReply.handoffRequired || state.recommendation.handoffRequired;

      return {
        quality: {
          passed,
          reason: missingGrounding ? "missing_grounding" : lowConfidence ? "low_confidence" : "passed",
          confidence,
          handoffRequired,
          finalReply: passed ? state.aiReply.reply : safeFallbackReply()
        }
      };
    })
    .addNode("execute_tools", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("execute_tools", state, async () => {
      if (state.result) return {};
      if (!state.conversation || !state.extraction || !state.recommendation || !state.quality) {
        throw new Error("AI graph reached execute_tools with incomplete state.");
      }

      const toolCalls = planAiToolCalls({
        tenantId: state.data.tenantId,
        leadId: state.conversation.leadId,
        currentLeadStatus: state.conversation.lead?.status ?? state.data.leadStatus ?? null,
        requestedByUserId: state.data.requestedByUserId ?? null,
        graphRunId: state.graphRunId,
        conversationId: state.data.conversationId,
        normalizedText: state.normalizedText,
        extractedFields: state.extraction.fields,
        recommendationAction: state.recommendation.action,
        recommendationReason: state.recommendation.reason,
        qualityPassed: state.quality.passed,
        handoffRequired: state.quality.handoffRequired,
        retrievedContext: state.retrievedContext.map((item) => ({ title: item.title, content: item.content }))
      });

      const toolResults = await executeAiToolCalls({
        tenantId: state.data.tenantId,
        graphRunId: state.graphRunId,
        conversationId: state.data.conversationId,
        calls: toolCalls
      });

      return { toolCalls, toolResults };
    }))
    .addNode("persist_audit", async (state): Promise<AiReplyStateUpdate> => graphNodeSpan("persist_audit", state, async () => {
      if (state.result) return {};
      if (!state.conversation || !state.aiReply || !state.recommendation || !state.extraction || !state.quality) {
        throw new Error("AI graph reached persist_audit with incomplete state.");
      }

      const receivedAt = Number.isNaN(Date.parse(state.data.receivedAt)) ? new Date() : new Date(state.data.receivedAt);
      const aiCreatedAt = new Date(receivedAt.getTime() + 1000);
      const contextRefs = state.retrievedContext.map((item) => ({
        chunkId: item.chunkId,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        title: item.title,
        score: item.score
      }));
      const qualityPayload = {
        passed: state.quality.passed,
        reason: state.quality.reason,
        confidence: state.quality.confidence,
        handoffRequired: state.quality.handoffRequired
      };
      const toolCallPayloads = state.toolCalls.map((call) => ({
        id: call.id,
        type: call.type,
        input: call.input
      }));
      const redactedToolCallPayloads = redactSensitiveData(toolCallPayloads);
      const toolResultPayloads = state.toolResults.map((result) => ({
        callId: result.callId,
        type: result.type,
        status: result.status,
        entityType: result.entityType ?? null,
        entityId: result.entityId ?? null,
        reason: result.reason ?? null
      }));

      const messageMetadata: Prisma.InputJsonObject = {
        graphRunId: state.graphRunId,
        graphNodes: [...nodeNames],
        intent: state.aiReply.intent,
        classifiedIntent: state.intent?.intent ?? null,
        confidence: state.quality.confidence,
        nextAction: state.recommendation.action,
        quality: qualityPayload,
        retrievedContext: contextRefs,
        toolCalls: redactedToolCallPayloads,
        toolResults: toolResultPayloads,
        source: state.data.source,
        outboundStatus: queuedPublicSource(state.data.source) ? "queued" : "sent",
        triggerMessageId: state.data.triggerMessageId,
        jobId: state.externalMessageId
      };

      const aiMessage = await prisma.message.create({
        data: {
          tenantId: state.data.tenantId,
          conversationId: state.data.conversationId,
          direction: "OUTBOUND",
          senderType: "AI",
          externalMessageId: state.externalMessageId,
          text: state.quality.finalReply,
          status: queuedPublicSource(state.data.source) ? "QUEUED" : "SENT",
          metadata: messageMetadata,
          createdAt: aiCreatedAt,
          updatedAt: aiCreatedAt
        }
      });

      const deliveryJobId = await enqueueChannelDelivery(state, aiMessage.id);
      if (deliveryJobId) {
        await prisma.message.update({
          where: { id: aiMessage.id },
          data: {
            metadata: {
              ...messageMetadata,
              deliveryJobId
            }
          }
        });
      }

      await prisma.aiUsageLog.create({
        data: {
          tenantId: state.data.tenantId,
          conversationId: state.data.conversationId,
          leadId: state.conversation.leadId,
          provider: aiProvider.providerName ?? "unknown",
          model: aiProvider.modelName ?? "unknown",
          actionType: "langgraph_queued_reply",
          inputTokens: Math.max(24, Math.round(state.normalizedText.length / 4)),
          outputTokens: Math.max(18, Math.round(state.quality.finalReply.length / 4)),
          estimatedCost: "0.000000",
          latencyMs: 35,
          status: state.quality.passed ? "SUCCESS" : "HANDOFF",
          metadata: {
            graphRunId: state.graphRunId,
            graphNodes: [...nodeNames],
            recommendation: state.recommendation.action,
            reason: state.recommendation.reason,
            extractionConfidence: state.extraction.confidence,
            quality: qualityPayload,
            retrievedContext: contextRefs,
            toolCalls: redactedToolCallPayloads,
            toolResults: toolResultPayloads
          }
        }
      });

      await prisma.conversation.update({
        where: { id: state.data.conversationId },
        data: {
          lastMessageAt: aiCreatedAt,
          handoffRequested: state.conversation.handoffRequested || state.quality.handoffRequired,
          status: state.quality.handoffRequired ? "WAITING_FOR_HUMAN" : state.conversation.status,
          updatedAt: aiCreatedAt
        }
      });

      if (state.conversation.leadId) {
        const leadData: Prisma.LeadUpdateInput = {
          lastMessageAt: aiCreatedAt,
          updatedAt: aiCreatedAt
        };
        await prisma.lead.update({ where: { id: state.conversation.leadId }, data: leadData });

        await prisma.leadEvent.create({
          data: {
            tenantId: state.data.tenantId,
            leadId: state.conversation.leadId,
            type: "langgraph_ai_reply_generated",
            title: "LangGraph AI reply generated",
            message: state.quality.finalReply,
            metadata: {
              conversationId: state.data.conversationId,
              messageId: aiMessage.id,
              deliveryJobId,
              graphRunId: state.graphRunId,
              jobId: state.externalMessageId,
              intent: state.aiReply.intent,
              nextAction: state.recommendation.action,
              quality: qualityPayload,
              toolCalls: redactedToolCallPayloads,
              toolResults: toolResultPayloads,
              handoffRequired: state.quality.handoffRequired
            }
          }
        });
      }

      await prisma.auditLog.create({
        data: {
          tenantId: state.data.tenantId,
          actorUserId: state.data.requestedByUserId ?? null,
          action: "ai.langgraph_reply.processed",
          entityType: "conversation",
          entityId: state.data.conversationId,
          payload: {
            source: state.data.source,
            messageId: aiMessage.id,
            deliveryJobId,
            triggerMessageId: state.data.triggerMessageId,
            graphRunId: state.graphRunId,
            jobId: state.externalMessageId,
            graphNodes: [...nodeNames],
            intent: state.aiReply.intent,
            retrievedContext: contextRefs,
            toolCalls: redactedToolCallPayloads,
            toolResults: toolResultPayloads,
            quality: qualityPayload,
            handoffRequired: state.quality.handoffRequired
          }
        }
      });

      return {
        result: {
          status: "processed",
          conversationId: state.data.conversationId,
          messageId: aiMessage.id,
          intent: state.aiReply.intent,
          handoffRequired: state.quality.handoffRequired,
          graphRunId: state.graphRunId,
          qualityReason: state.quality.reason,
          qualityPassed: state.quality.passed,
          toolResults: state.toolResults
        }
      };
    }))
    .addEdge(START, "normalize_message")
    .addEdge("normalize_message", "load_tenant_context")
    .addEdge("load_tenant_context", "retrieve_context")
    .addEdge("retrieve_context", "intent_classify")
    .addEdge("intent_classify", "draft_response")
    .addEdge("draft_response", "decide_tool_calls")
    .addEdge("decide_tool_calls", "quality_gate")
    .addEdge("quality_gate", "execute_tools")
    .addEdge("execute_tools", "persist_audit")
    .addEdge("persist_audit", END)
    .compile();
}

export async function runAiReplyGraph(input: RunAiReplyGraphInput): Promise<AiReplyGraphResult> {
  const startedAt = Date.now();
  const externalMessageId = input.jobId ?? `ai-reply:${input.data.conversationId}:${input.data.triggerMessageId}`;
  const graphRunId = `langgraph:${externalMessageId}`;
  const graph = createGraph(input.aiProvider);
  try {
    const state = await withSpan("ai.graph run", {
      kind: SpanKind.INTERNAL,
      attributes: {
        "leadvirt.graph_run_id": graphRunId,
        "leadvirt.tenant_id": input.data.tenantId,
        "leadvirt.conversation_id": input.data.conversationId,
        "leadvirt.source": input.data.source
      }
    }, async () => graph.invoke({
        data: input.data,
        jobId: input.jobId,
        graphRunId,
        externalMessageId,
        normalizedText: "",
        conversation: undefined,
        messages: [],
        retrievedContext: [],
        intent: undefined,
        extraction: undefined,
        aiReply: undefined,
        recommendation: undefined,
        quality: undefined,
        toolCalls: [],
        toolResults: [],
        result: undefined
      })
    );

    if (!state.result) {
      throw new Error(`AI graph ${graphRunId} finished without a result.`);
    }

    recordAiGraphRun({
      source: input.data.source,
      status: state.result.status,
      handoffRequired: state.result.handoffRequired ?? false,
      qualityReason: state.result.qualityReason ?? (state.result.status === "duplicate" ? "duplicate" : undefined),
      qualityPassed: state.result.qualityPassed ?? (state.result.status === "duplicate"),
      durationMs: Date.now() - startedAt
    });
    return state.result;
  } catch (error) {
    recordAiGraphRun({
      source: input.data.source,
      status: "failed",
      handoffRequired: true,
      qualityReason: "failed",
      qualityPassed: false,
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}
