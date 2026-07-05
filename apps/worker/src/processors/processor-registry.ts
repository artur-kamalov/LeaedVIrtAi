import type { Job } from "bullmq";
import { MockAiProvider, OpenAiProvider, type AiProvider, type AiReasoningEffort, type AiVerbosity } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import type { AiReplyJobData } from "@leadvirt/types";
import type { LeadVirtQueueName } from "../queues/queue-names.js";

loadEnvFile();

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function createAiProvider(): AiProvider {
  if (process.env.AI_PROVIDER === "openai" && isTruthy(process.env.AI_ENABLE_REAL_PROVIDER)) {
    return new OpenAiProvider({
      apiKey: process.env.AI_API_KEY ?? "",
      ...(process.env.AI_DEFAULT_MODEL ? { model: process.env.AI_DEFAULT_MODEL } : {}),
      ...(process.env.AI_BASE_URL ? { baseUrl: process.env.AI_BASE_URL } : {}),
      ...(process.env.AI_REASONING_EFFORT ? { reasoningEffort: process.env.AI_REASONING_EFFORT as AiReasoningEffort } : {}),
      ...(process.env.AI_VERBOSITY ? { verbosity: process.env.AI_VERBOSITY as AiVerbosity } : {})
    });
  }

  return new MockAiProvider();
}

const aiProvider = createAiProvider();

export type LeadVirtJobData = Record<string, unknown>;

function readString(data: LeadVirtJobData, key: string, fallback: string): string {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isAiReplyJobData(data: LeadVirtJobData): data is AiReplyJobData & LeadVirtJobData {
  return (
    typeof data.tenantId === "string" &&
    typeof data.conversationId === "string" &&
    typeof data.triggerMessageId === "string" &&
    typeof data.text === "string" &&
    typeof data.businessName === "string" &&
    typeof data.source === "string" &&
    typeof data.receivedAt === "string"
  );
}

async function processAiReplyJob(data: AiReplyJobData, jobId: string | undefined) {
  const externalMessageId = jobId ?? `ai-reply:${data.conversationId}:${data.triggerMessageId}`;
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: data.conversationId,
      tenantId: data.tenantId,
      deletedAt: null
    },
    include: {
      tenant: true,
      lead: true,
      messages: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!conversation) {
    throw new Error(`Conversation ${data.conversationId} was not found for queued AI reply.`);
  }

  const existingReply = await prisma.message.findFirst({
    where: {
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      externalMessageId
    },
    select: { id: true }
  });

  if (existingReply) {
    return {
      status: "duplicate",
      conversationId: data.conversationId,
      messageId: existingReply.id
    };
  }

  const messages = conversation.messages.map((message) => ({
    role: message.senderType === "AI" ? ("assistant" as const) : ("user" as const),
    content: message.text ?? ""
  }));

  const [extraction, aiReply, recommendation] = await Promise.all([
    aiProvider.extractLeadFields({
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      text: data.text
    }),
    aiProvider.generateReply({
      tenantId: data.tenantId,
      businessName: data.businessName,
      ...(data.businessType ? { businessType: data.businessType } : {}),
      conversationId: data.conversationId,
      messages
    }),
    aiProvider.recommendNextAction({
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      ...(data.leadStatus ? { leadStatus: data.leadStatus } : {}),
      text: data.text
    })
  ]);

  const receivedAt = Number.isNaN(Date.parse(data.receivedAt)) ? new Date() : new Date(data.receivedAt);
  const aiCreatedAt = new Date(receivedAt.getTime() + 1000);
  const handoffRequired = aiReply.handoffRequired || recommendation.handoffRequired;

  const aiMessage = await prisma.message.create({
    data: {
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      direction: "OUTBOUND",
      senderType: "AI",
      externalMessageId,
      text: aiReply.reply,
      status: "SENT",
      metadata: {
        intent: aiReply.intent,
        confidence: aiReply.confidence,
        nextAction: recommendation.action,
        source: data.source,
        triggerMessageId: data.triggerMessageId,
        jobId: externalMessageId
      },
      createdAt: aiCreatedAt,
      updatedAt: aiCreatedAt
    }
  });

  await prisma.aiUsageLog.create({
    data: {
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      leadId: conversation.leadId,
      provider: aiProvider.providerName ?? "unknown",
      model: aiProvider.modelName ?? "unknown",
      actionType: "queued_generate_reply",
      inputTokens: Math.max(24, Math.round(data.text.length / 4)),
      outputTokens: Math.max(18, Math.round(aiReply.reply.length / 4)),
      estimatedCost: "0.000000",
      latencyMs: 35,
      status: "SUCCESS",
      metadata: {
        jobId: externalMessageId,
        recommendation: recommendation.action,
        reason: recommendation.reason,
        extractionConfidence: extraction.confidence
      }
    }
  });

  await prisma.conversation.update({
    where: { id: data.conversationId },
    data: {
      lastMessageAt: aiCreatedAt,
      handoffRequested: conversation.handoffRequested || handoffRequired,
      status: handoffRequired ? "WAITING_FOR_HUMAN" : conversation.status,
      updatedAt: aiCreatedAt
    }
  });

  if (conversation.leadId) {
    const leadData: Prisma.LeadUpdateInput = {
      lastMessageAt: aiCreatedAt,
      updatedAt: aiCreatedAt
    };
    if (conversation.lead?.status === "NEW") {
      leadData.status = "IN_PROGRESS";
    }
    if (typeof extraction.fields.summary === "string") {
      leadData.summary = extraction.fields.summary;
    }
    await prisma.lead.update({ where: { id: conversation.leadId }, data: leadData });

    await prisma.leadEvent.create({
      data: {
        tenantId: data.tenantId,
        leadId: conversation.leadId,
        type: "queued_ai_reply_generated",
        title: "Queued AI reply generated",
        message: aiReply.reply,
        metadata: {
          conversationId: data.conversationId,
          messageId: aiMessage.id,
          jobId: externalMessageId,
          intent: aiReply.intent,
          nextAction: recommendation.action,
          handoffRequired
        }
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: data.tenantId,
      actorUserId: data.requestedByUserId ?? null,
      action: "ai.reply.processed",
      entityType: "conversation",
      entityId: data.conversationId,
      payload: {
        source: data.source,
        messageId: aiMessage.id,
        triggerMessageId: data.triggerMessageId,
        jobId: externalMessageId,
        intent: aiReply.intent,
        handoffRequired
      }
    }
  });

  return {
    status: "processed",
    conversationId: data.conversationId,
    messageId: aiMessage.id,
    intent: aiReply.intent,
    handoffRequired
  };
}

export function processLeadVirtJob(queueName: LeadVirtQueueName, job: Job<LeadVirtJobData>) {
  const data = job.data;

  switch (queueName) {
    case "ai.reply":
      if (isAiReplyJobData(data)) {
        return processAiReplyJob(data, job.id);
      }
      return aiProvider.generateReply({
        tenantId: readString(data, "tenantId", "tenant-demo"),
        businessName: readString(data, "businessName", "BeautyLab Demo"),
        conversationId: readString(data, "conversationId", "conversation-demo"),
        messages: [{ role: "user", content: readString(data, "text", "New customer message") }]
      });
    case "ai.extractLeadFields":
      return aiProvider.extractLeadFields({
        tenantId: readString(data, "tenantId", "tenant-demo"),
        conversationId: readString(data, "conversationId", "conversation-demo"),
        text: readString(data, "text", "")
      });
    default:
      return Promise.resolve({
        status: "placeholder",
        queueName,
        jobId: job.id
      });
  }
}
