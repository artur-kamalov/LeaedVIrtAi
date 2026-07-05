import {
  MockAiProvider,
  OpenAiProvider,
  type AiActionType,
  type AiProvider,
  type AiReasoningEffort,
  type AiRecommendationResult,
  type AiReplyResult,
  type AiVerbosity
} from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";

loadEnvFile();

type CheckLevel = "PASS" | "WARN" | "FAIL";

interface Check {
  level: CheckLevel;
  name: string;
  detail?: string;
}

const checks: Check[] = [];
const providerName = process.env.AI_PROVIDER?.trim() || "mock";
const realProviderEnabled = isTruthy(process.env.AI_ENABLE_REAL_PROVIDER);
const appEnv = process.env.APP_ENV?.trim() || "local";
const nodeEnv = process.env.NODE_ENV?.trim() || "development";
const strict =
  isTruthy(process.env.LEADVIRT_AI_PROVIDER_SMOKE_STRICT) ||
  nodeEnv === "production" ||
  ["staging", "production", "public"].includes(appEnv.toLowerCase());

const validActions = new Set<AiActionType | "none">([
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
]);

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function record(level: CheckLevel, name: string, detail?: string) {
  checks.push({ level, name, ...(detail ? { detail } : {}) });
}

function pass(name: string, detail?: string) {
  record("PASS", name, detail);
}

function warn(name: string, detail?: string) {
  record("WARN", name, detail);
}

function fail(name: string, detail?: string) {
  record("FAIL", name, detail);
}

function requireCheck(condition: boolean, name: string, passDetail: string, failDetail = passDetail) {
  if (condition) pass(name, passDetail);
  else fail(name, failDetail);
}

function strictCheck(condition: boolean, name: string, passDetail: string, failDetail = passDetail) {
  if (condition) {
    pass(name, passDetail);
    return;
  }

  if (strict) fail(name, failDetail);
  else warn(name, failDetail);
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasFields(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAction(value: unknown): value is AiActionType | "none" {
  return typeof value === "string" && validActions.has(value as AiActionType | "none");
}

function createProvider(): AiProvider | null {
  if (providerName === "mock") {
    return new MockAiProvider();
  }

  if (providerName === "openai") {
    if (!realProviderEnabled) {
      if (strict) fail("AI_ENABLE_REAL_PROVIDER", "must be true for strict OpenAI provider smoke");
      else warn("AI_ENABLE_REAL_PROVIDER", "false; using mock provider without external OpenAI calls");
      return new MockAiProvider();
    }

    const apiKey = process.env.AI_API_KEY?.trim() ?? "";
    if (!apiKey) {
      fail("AI_API_KEY", "missing; required when AI_PROVIDER=openai");
      return null;
    }

    return new OpenAiProvider({
      apiKey,
      ...(process.env.AI_DEFAULT_MODEL?.trim() ? { model: process.env.AI_DEFAULT_MODEL.trim() } : {}),
      ...(process.env.AI_BASE_URL?.trim() ? { baseUrl: process.env.AI_BASE_URL.trim() } : {}),
      ...(process.env.AI_REASONING_EFFORT?.trim() ? { reasoningEffort: process.env.AI_REASONING_EFFORT.trim() as AiReasoningEffort } : {}),
      ...(process.env.AI_VERBOSITY?.trim() ? { verbosity: process.env.AI_VERBOSITY.trim() as AiVerbosity } : {})
    });
  }

  fail("AI_PROVIDER", `${providerName} is not implemented; use mock locally or openai for public release`);
  return null;
}

function checkReply(reply: AiReplyResult) {
  requireCheck(hasText(reply.reply), "generateReply.reply", "non-empty", "empty or missing");
  requireCheck(hasText(reply.intent), "generateReply.intent", reply.intent || "present", "empty or missing");
  requireCheck(hasFields(reply.leadFields), "generateReply.leadFields", "object", "not an object");
  requireCheck(validAction(reply.nextAction.type), "generateReply.nextAction.type", reply.nextAction.type, "invalid action");
  requireCheck(hasText(reply.nextAction.reason), "generateReply.nextAction.reason", "non-empty", "empty or missing");
  requireCheck(hasConfidence(reply.confidence), "generateReply.confidence", String(reply.confidence), "outside 0..1");
  requireCheck(typeof reply.handoffRequired === "boolean", "generateReply.handoffRequired", String(reply.handoffRequired), "not boolean");
}

function checkRecommendation(recommendation: AiRecommendationResult) {
  requireCheck(validAction(recommendation.action), "recommendNextAction.action", recommendation.action, "invalid action");
  requireCheck(hasText(recommendation.reason), "recommendNextAction.reason", "non-empty", "empty or missing");
  requireCheck(hasConfidence(recommendation.confidence), "recommendNextAction.confidence", String(recommendation.confidence), "outside 0..1");
  requireCheck(
    typeof recommendation.handoffRequired === "boolean",
    "recommendNextAction.handoffRequired",
    String(recommendation.handoffRequired),
    "not boolean"
  );
}

async function main() {
  console.log("LeadVirt AI Provider Smoke");
  console.log(`Provider: ${providerName}`);
  console.log(`Real provider enabled: ${realProviderEnabled ? "true" : "false"}`);
  console.log(`Mode: ${strict ? "strict" : "local/warn"}`);
  console.log(`Model: ${process.env.AI_DEFAULT_MODEL?.trim() || (providerName === "openai" ? "gpt-5.5" : "leadvirt-local-mock")}`);
  console.log(`Reasoning effort: ${process.env.AI_REASONING_EFFORT?.trim() || (providerName === "openai" ? "low" : "n/a")}`);
  console.log(`Verbosity: ${process.env.AI_VERBOSITY?.trim() || (providerName === "openai" ? "low" : "n/a")}`);
  console.log("");

  strictCheck(providerName === "openai" || !strict, "Public AI provider", providerName, "strict mode requires AI_PROVIDER=openai");

  const provider = createProvider();
  if (!provider) {
    printAndExit();
    return;
  }

  pass("Provider constructed", `${provider.providerName ?? providerName}/${provider.modelName ?? "unknown"}`);

  const messages = [
    {
      role: "user" as const,
      content: "Hello! I want to book a consultation tomorrow. How much does it cost, and do you have an available time?"
    }
  ];

  const reply = await provider.generateReply({
    tenantId: "ai-smoke-tenant",
    businessName: "LeadVirt Smoke Clinic",
    businessType: "appointments",
    conversationId: "ai-smoke-conversation",
    messages
  });
  checkReply(reply);

  const extraction = await provider.extractLeadFields({
    tenantId: "ai-smoke-tenant",
    conversationId: "ai-smoke-conversation",
    text: messages[0].content
  });
  requireCheck(hasFields(extraction.fields), "extractLeadFields.fields", "object", "not an object");
  requireCheck(hasConfidence(extraction.confidence), "extractLeadFields.confidence", String(extraction.confidence), "outside 0..1");

  const recommendation = await provider.recommendNextAction({
    tenantId: "ai-smoke-tenant",
    conversationId: "ai-smoke-conversation",
    leadStatus: "NEW",
    text: messages[0].content
  });
  checkRecommendation(recommendation);

  const summary = await provider.summarizeConversation({
    tenantId: "ai-smoke-tenant",
    conversationId: "ai-smoke-conversation",
    messages
  });
  requireCheck(hasText(summary.summary), "summarizeConversation.summary", "non-empty", "empty or missing");
  requireCheck(hasText(summary.nextBestAction), "summarizeConversation.nextBestAction", "non-empty", "empty or missing");

  const intent = await provider.classifyIntent({
    tenantId: "ai-smoke-tenant",
    text: messages[0].content
  });
  requireCheck(hasText(intent.intent), "classifyIntent.intent", intent.intent || "present", "empty or missing");
  requireCheck(hasConfidence(intent.confidence), "classifyIntent.confidence", String(intent.confidence), "outside 0..1");

  printAndExit();
}

function printAndExit() {
  for (const check of checks) {
    console.log(`${check.level} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  const failures = checks.filter((check) => check.level === "FAIL");
  const warnings = checks.filter((check) => check.level === "WARN");
  console.log("");

  if (failures.length > 0) {
    console.log(`AI provider smoke failed: ${failures.length} failure(s), ${warnings.length} warning(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(`AI provider smoke passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail("AI provider call", message);
  printAndExit();
});
