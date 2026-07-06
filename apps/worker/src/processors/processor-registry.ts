import type { Job } from "bullmq";
import { BudgetedAiProvider, MockAiProvider, OpenAiProvider, type AiProvider, type AiReasoningEffort, type AiVerbosity } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import type { AiReplyJobData, ChannelSendMessageJobData } from "@leadvirt/types";
import { createAiBudgetStore } from "../ai/ai-budget-store.js";
import { runAiReplyGraph } from "../ai/ai-reply-graph.js";
import { deliverChannelMessage } from "../channels/channel-delivery.js";
import type { LeadVirtQueueName } from "../queues/queue-names.js";

loadEnvFile();

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function positiveIntEnv(name: string) {
  const value = Number(process.env[name] ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function createBaseAiProvider(): AiProvider {
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

function createAiProvider(): AiProvider {
  return new BudgetedAiProvider(createBaseAiProvider(), createAiBudgetStore(), {
    dailyTokenBudget: positiveIntEnv("AI_TENANT_DAILY_TOKEN_BUDGET"),
    monthlyTokenBudget: positiveIntEnv("AI_TENANT_MONTHLY_TOKEN_BUDGET")
  });
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

function isChannelSendMessageJobData(data: LeadVirtJobData): data is ChannelSendMessageJobData & LeadVirtJobData {
  return (
    typeof data.tenantId === "string" &&
    typeof data.conversationId === "string" &&
    typeof data.messageId === "string" &&
    (data.source === "telegram" || data.source === "webhook") &&
    typeof data.requestedAt === "string"
  );
}

export function processLeadVirtJob(queueName: LeadVirtQueueName, job: Job<LeadVirtJobData>) {
  const data = job.data;

  switch (queueName) {
    case "ai.reply":
      if (isAiReplyJobData(data)) {
        return runAiReplyGraph({ data, jobId: job.id, aiProvider });
      }
      throw new Error("Invalid ai.reply job data.");
    case "ai.extractLeadFields":
      return aiProvider.extractLeadFields({
        tenantId: readString(data, "tenantId", "tenant-demo"),
        conversationId: readString(data, "conversationId", "conversation-demo"),
        text: readString(data, "text", "")
      });
    case "channels.sendMessage":
      if (isChannelSendMessageJobData(data)) {
        return deliverChannelMessage(data, job.id);
      }
      throw new Error("Invalid channels.sendMessage job data.");
    default:
      return Promise.resolve({
        status: "placeholder",
        queueName,
        jobId: job.id
      });
  }
}
