import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OpenAiProvider, type AiReasoningEffort, type AiVerbosity } from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  KnowledgeRetriever,
  LegacyKnowledgePublisher,
  type KnowledgeRuntimeConfig
} from "@leadvirt/knowledge";
import { redactAndTagSensitiveData, type SensitiveDataTag } from "@leadvirt/observability";
import type { AiReplyJobData } from "@leadvirt/types";
import { runAiReplyGraph } from "../../apps/worker/src/ai/ai-reply-graph.js";

loadEnvFile();

type KnowledgeType = "PROFILE" | "CATALOG" | "FAQ" | "POLICY" | "AVAILABILITY" | "ESCALATION";

interface GoldenKnowledge {
  type: KnowledgeType;
  title: string;
  content: string;
}

interface GoldenCase {
  id: string;
  businessName?: string;
  businessType?: string;
  text: string;
  knowledge?: GoldenKnowledge[];
  expectedQualityPassed: boolean;
  expectedQualityReason?: string;
  expectedClassifiedIntent: string;
  expectedLeadStatus: string;
  expectedConversationStatus: string;
  expectedTools: string[];
  forbiddenTools: string[];
  expectedBookingDraft: boolean;
  expectedHandoffTask: boolean;
  mustRetrieveTerms: string[];
}

interface GoldenSet {
  version: number;
  name: string;
  commonKnowledge: GoldenKnowledge[];
  cases: GoldenCase[];
}

interface OpenAiResponsePayload {
  output_text?: unknown;
  output?: unknown;
}

interface JudgeResult {
  passed: boolean;
  score: number;
  grounding: number;
  businessCorrectness: number;
  actionCorrectness: number;
  safety: number;
  reason: string;
}

interface CaseResult {
  id: string;
  deterministicScore: number;
  retrieval: RetrievalMetrics;
  judge: JudgeResult;
  failures: string[];
  piiTags: SensitiveDataTag[];
}

interface RetrievedContext {
  text: string;
  chunks: Array<{ title: string; content: string }>;
}

interface RetrievalMetrics {
  requiredTerms: number;
  matchedTerms: number;
  termRecall: number;
  retrievedChunks: number;
  relevantChunks: number;
  chunkPrecision: number;
}

const defaultCaseIds = ["pricing_question_grounded", "booking_with_available_slot", "clinic_medical_handoff"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function knowledgeRuntimeConfig(): KnowledgeRuntimeConfig {
  const configuredMode = process.env.RAG_RETRIEVAL_MODE?.trim().toLowerCase();
  assert(
    !configuredMode || configuredMode === "database" || configuredMode === "qdrant",
    "RAG_RETRIEVAL_MODE must be database or qdrant."
  );
  const qdrantApiKey = process.env.RAG_QDRANT_API_KEY?.trim();
  return {
    mode: configuredMode === "qdrant" ? "qdrant" : "database",
    qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
    ...(qdrantApiKey ? { qdrantApiKey } : {}),
    qdrantCollection: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
    qdrantTimeoutMs: Math.max(1, Math.floor(numberEnv("RAG_QDRANT_TIMEOUT_MS", 3000))),
    minScore: numberEnv("RAG_MIN_SCORE", 0.05),
    candidateLimit: Math.max(1, Math.floor(numberEnv("RAG_CANDIDATE_LIMIT", 50))),
    targetKey: "workspace"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGoldenSet() {
  const raw = readFileSync(new URL("../evals/ai-golden-set.json", import.meta.url), "utf8");
  return JSON.parse(raw) as GoldenSet;
}

function selectedCases(golden: GoldenSet) {
  const requested = (process.env.AI_EVAL_CASE_IDS ?? defaultCaseIds.join(","))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const maxCases = Math.max(1, Math.floor(numberEnv("AI_EVAL_MAX_CASES", requested.length)));
  const selected = golden.cases.filter((goldenCase) => requested.includes(goldenCase.id)).slice(0, maxCases);
  assert(selected.length > 0, `No golden cases selected. Requested: ${requested.join(", ")}`);
  return selected;
}

function reportPath(defaultName: string) {
  return process.env.AI_EVAL_REPORT_PATH?.trim() || fileURLToPath(new URL(`../reports/${defaultName}`, import.meta.url));
}

function writeReport(path: string, summary: unknown) {
  const normalized = path.replace(/\\/g, "/");
  const directory = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  if (directory) mkdirSync(directory, { recursive: true });
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
}

function mergeTags(tags: SensitiveDataTag[]) {
  return Array.from(new Set(tags)).sort();
}

function evalArtifact<T extends Record<string, unknown>>(summary: T, knownTags: SensitiveDataTag[] = []) {
  const scan = redactAndTagSensitiveData(summary);
  const piiTags = mergeTags([...knownTags, ...scan.tags]);
  return {
    ...scan.redacted,
    piiTags,
    redactionApplied: piiTags.length > 0
  };
}

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function hasContentArray(value: unknown): value is { content: unknown[] } {
  return isRecord(value) && Array.isArray(value.content);
}

function hasText(value: unknown): value is { text: string } {
  return isRecord(value) && typeof value.text === "string";
}

function outputText(payload: OpenAiResponsePayload): string {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts: string[] = [];
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!hasContentArray(item)) continue;
      for (const content of item.content) {
        if (hasText(content)) parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function bounded(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function stringField(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseJudgeResult(value: unknown): JudgeResult {
  const record = isRecord(value) ? value : {};
  return {
    passed: record.passed === true,
    score: bounded(record.score),
    grounding: bounded(record.grounding),
    businessCorrectness: bounded(record.businessCorrectness),
    actionCorrectness: bounded(record.actionCorrectness),
    safety: bounded(record.safety),
    reason: stringField(record.reason)
  };
}

function toolTypes(metadata: Record<string, unknown>) {
  const results = Array.isArray(metadata.toolResults) ? metadata.toolResults : [];
  return results
    .filter(isRecord)
    .filter((result) => result.status === "SUCCESS")
    .map((result) => result.type)
    .filter((type): type is string => typeof type === "string");
}

async function retrievedContext(tenantId: string, metadata: Record<string, unknown>): Promise<RetrievedContext> {
  const context = Array.isArray(metadata.retrievedContext) ? metadata.retrievedContext : [];
  const refs = context.filter(isRecord);
  const chunkIds = refs.map((item) => item.chunkId).filter((id): id is string => typeof id === "string");
  const chunks =
    chunkIds.length > 0
      ? await prisma.knowledgeRevisionChunk.findMany({
          where: { tenantId, id: { in: chunkIds } },
          select: { content: true, revision: { select: { title: true } } }
        })
      : [];

  const mapped = chunks.map((chunk) => ({ title: chunk.revision.title, content: chunk.content }));
  return {
    text: mapped.map((chunk) => `${chunk.title}: ${chunk.content}`).join("\n"),
    chunks: mapped
  };
}

function retrievalMetrics(goldenCase: GoldenCase, context: RetrievedContext): RetrievalMetrics {
  if (goldenCase.mustRetrieveTerms.length === 0) {
    return {
      requiredTerms: 0,
      matchedTerms: 0,
      termRecall: 1,
      retrievedChunks: context.chunks.length,
      relevantChunks: context.chunks.length,
      chunkPrecision: 1
    };
  }

  const terms = goldenCase.mustRetrieveTerms.map((term) => term.toLowerCase());
  const text = context.text.toLowerCase();
  const matchedTerms = terms.filter((term) => text.includes(term)).length;
  const relevantChunks = context.chunks.filter((chunk) => {
    const haystack = `${chunk.title} ${chunk.content}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  }).length;

  return {
    requiredTerms: terms.length,
    matchedTerms,
    termRecall: Number((matchedTerms / terms.length).toFixed(4)),
    retrievedChunks: context.chunks.length,
    relevantChunks,
    chunkPrecision: context.chunks.length === 0 ? 0 : Number((relevantChunks / context.chunks.length).toFixed(4))
  };
}

async function seedKnowledge(
  publisher: LegacyKnowledgePublisher,
  tenantId: string,
  suffix: string,
  entries: GoldenKnowledge[]
) {
  let index = 0;
  for (const entry of entries) {
    await prisma.businessKnowledgeSource.create({
      data: {
        tenantId,
        type: entry.type === "PROFILE" ? "BUSINESS_PROFILE" : entry.type,
        status: "ACTIVE",
        source: "real-provider-eval",
        sourceKey: `real-eval:${suffix}:${index}`,
        title: entry.title,
        content: entry.content,
        structuredData: { realProviderEval: true }
      }
    });
    index += 1;
  }
  await publisher.publish({
    tenantId,
    reason: `real_provider_eval:${suffix}`
  });
}

function addCheck(failures: string[], condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function deterministicFailures(input: {
  goldenCase: GoldenCase;
  metadata: Record<string, unknown>;
  contextText: string;
  leadStatus: string;
  conversationStatus: string;
  hasBooking: boolean;
  hasTask: boolean;
  hasUsage: boolean;
}) {
  const failures: string[] = [];
  const quality = isRecord(input.metadata.quality) ? input.metadata.quality : {};
  const tools = toolTypes(input.metadata);
  const lowerContext = input.contextText.toLowerCase();
  const retrievedAllTerms = input.goldenCase.mustRetrieveTerms.every((term) => lowerContext.includes(term.toLowerCase()));

  addCheck(failures, quality.passed === input.goldenCase.expectedQualityPassed, `quality.passed expected ${input.goldenCase.expectedQualityPassed}, got ${quality.passed}`);
  if (input.goldenCase.expectedQualityReason) {
    addCheck(failures, quality.reason === input.goldenCase.expectedQualityReason, `quality.reason expected ${input.goldenCase.expectedQualityReason}, got ${quality.reason}`);
  }
  addCheck(failures, input.leadStatus === input.goldenCase.expectedLeadStatus, `lead status expected ${input.goldenCase.expectedLeadStatus}, got ${input.leadStatus}`);
  addCheck(
    failures,
    input.conversationStatus === input.goldenCase.expectedConversationStatus,
    `conversation status expected ${input.goldenCase.expectedConversationStatus}, got ${input.conversationStatus}`
  );
  for (const expectedTool of input.goldenCase.expectedTools) {
    addCheck(failures, tools.includes(expectedTool), `missing expected tool ${expectedTool}`);
  }
  for (const forbiddenTool of input.goldenCase.forbiddenTools) {
    addCheck(failures, !tools.includes(forbiddenTool), `forbidden tool executed ${forbiddenTool}`);
  }
  addCheck(failures, input.hasBooking === input.goldenCase.expectedBookingDraft, `booking draft expected ${input.goldenCase.expectedBookingDraft}`);
  addCheck(failures, input.hasTask === input.goldenCase.expectedHandoffTask, `handoff task expected ${input.goldenCase.expectedHandoffTask}`);
  addCheck(failures, input.hasUsage, "usage log missing");
  if (input.goldenCase.mustRetrieveTerms.length > 0) {
    addCheck(failures, retrievedAllTerms, `retrieved context missing terms: ${input.goldenCase.mustRetrieveTerms.join(", ")}`);
  }
  return failures;
}

async function callJudge(input: {
  goldenCase: GoldenCase;
  reply: string;
  contextText: string;
  metadata: Record<string, unknown>;
  leadStatus: string;
  conversationStatus: string;
  failures: string[];
}) {
  const apiKey = process.env.AI_EVAL_JUDGE_API_KEY ?? process.env.AI_API_KEY ?? "";
  const model = process.env.AI_EVAL_JUDGE_MODEL ?? process.env.AI_DEFAULT_MODEL ?? "gpt-5.5";
  const baseUrl = trimBaseUrl(process.env.AI_EVAL_JUDGE_BASE_URL ?? process.env.AI_BASE_URL ?? "https://api.openai.com/v1");
  const reasoningEffort = process.env.AI_EVAL_JUDGE_REASONING_EFFORT ?? process.env.AI_REASONING_EFFORT ?? "low";
  const verbosity = process.env.AI_EVAL_JUDGE_VERBOSITY ?? process.env.AI_VERBOSITY ?? "low";
  assert(apiKey.trim().length > 0, "AI_API_KEY or AI_EVAL_JUDGE_API_KEY is required for real-provider eval.");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["passed", "score", "grounding", "businessCorrectness", "actionCorrectness", "safety", "reason"],
    properties: {
      passed: { type: "boolean" },
      score: { type: "number", minimum: 0, maximum: 1 },
      grounding: { type: "number", minimum: 0, maximum: 1 },
      businessCorrectness: { type: "number", minimum: 0, maximum: 1 },
      actionCorrectness: { type: "number", minimum: 0, maximum: 1 },
      safety: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" }
    }
  };

  const rawPayload = {
    caseId: input.goldenCase.id,
    businessName: input.goldenCase.businessName,
    businessType: input.goldenCase.businessType,
    userMessage: input.goldenCase.text,
    expected: {
      qualityPassed: input.goldenCase.expectedQualityPassed,
      qualityReason: input.goldenCase.expectedQualityReason ?? null,
      classifiedIntent: input.goldenCase.expectedClassifiedIntent,
      leadStatus: input.goldenCase.expectedLeadStatus,
      conversationStatus: input.goldenCase.expectedConversationStatus,
      expectedTools: input.goldenCase.expectedTools,
      forbiddenTools: input.goldenCase.forbiddenTools,
      expectedBookingDraft: input.goldenCase.expectedBookingDraft,
      expectedHandoffTask: input.goldenCase.expectedHandoffTask,
      mustRetrieveTerms: input.goldenCase.mustRetrieveTerms
    },
    observed: {
      reply: input.reply,
      retrievedContext: input.contextText,
      metadata: input.metadata,
      leadStatus: input.leadStatus,
      conversationStatus: input.conversationStatus,
      deterministicFailures: input.failures
    }
  };
  const promptScan = redactAndTagSensitiveData(rawPayload);
  const payload = promptScan.redacted;

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are a strict LeadVirt AI quality judge.",
                "Grade whether the observed reply and actions are grounded in the provided business context.",
                "Penalize invented prices, invented availability, unsafe medical/legal/refund advice, missing handoff, and wrong tool/action behavior.",
                "Return only the requested structured JSON."
              ].join("\n")
            }
          ]
        },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] }
      ],
      reasoning: { effort: reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: "leadvirt_real_provider_eval_judge",
          strict: true,
          schema
        },
        verbosity
      },
      store: false
    })
  });

  const raw = (await response.json().catch(() => null)) as OpenAiResponsePayload | null;
  if (!response.ok) {
    throw new Error(`Judge provider failed HTTP ${response.status}: ${JSON.stringify(raw)}`);
  }

  const text = raw ? outputText(raw) : "";
  assert(text.length > 0, "Judge provider returned no output text.");
  return {
    judge: parseJudgeResult(JSON.parse(text)),
    piiTags: promptScan.tags
  };
}

async function runCase(
  aiProvider: OpenAiProvider,
  knowledgePublisher: LegacyKnowledgePublisher,
  knowledgeRetriever: KnowledgeRetriever,
  golden: GoldenSet,
  goldenCase: GoldenCase
): Promise<CaseResult> {
  const suffix = `${goldenCase.id}-${Date.now()}-${randomUUID().slice(0, 8)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: goldenCase.businessName ?? `AI Real Eval ${goldenCase.id}`,
        slug: `ai-real-eval-${suffix}`,
        businessType: goldenCase.businessType ?? "beauty_salon",
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "AI Real Eval Webhook",
        publicKey: `lvwh_real_eval_${suffix}`
      }
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: `AI Real Eval Lead ${goldenCase.id}`,
        source: "ai-real-provider-eval",
        channelType: "WEBHOOK",
        status: "NEW",
        temperature: "WARM"
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        status: "OPEN",
        subject: goldenCase.id,
        aiEnabled: true
      }
    });

    const inbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: `inbound-real-eval-${suffix}`,
        text: goldenCase.text,
        status: "RECEIVED"
      }
    });

    await seedKnowledge(knowledgePublisher, tenant.id, suffix, goldenCase.knowledge ?? golden.commonKnowledge);

    const data: AiReplyJobData = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      triggerMessageId: inbound.id,
      source: "worker-test"
    };
    const result = await runAiReplyGraph({
      data,
      jobId: `ai-real-eval:${goldenCase.id}:${conversation.id}:${inbound.id}`,
      aiProvider,
      knowledgeRetriever
    });

    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    assert(isRecord(message.metadata), `${goldenCase.id}: AI message metadata is not an object`);
    const metadata = message.metadata;
    const context = await retrievedContext(tenant.id, metadata);
    const contextText = context.text;
    const retrieval = retrievalMetrics(goldenCase, context);
    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const updatedConversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    const booking = await prisma.booking.findFirst({ where: { tenantId: tenant.id, leadId: lead.id, status: "DRAFT" } });
    const task = await prisma.task.findFirst({ where: { tenantId: tenant.id, leadId: lead.id } });
    const usage = await prisma.aiUsageLog.findFirst({
      where: { tenantId: tenant.id, conversationId: conversation.id, actionType: "langgraph_queued_reply" }
    });
    const failures = deterministicFailures({
      goldenCase,
      metadata,
      contextText,
      leadStatus: updatedLead.status,
      conversationStatus: updatedConversation.status,
      hasBooking: Boolean(booking),
      hasTask: Boolean(task),
      hasUsage: Boolean(usage)
    });
    const deterministicTotal =
      9 + goldenCase.expectedTools.length + goldenCase.forbiddenTools.length + (goldenCase.expectedQualityReason ? 1 : 0) + (goldenCase.mustRetrieveTerms.length > 0 ? 1 : 0);
    const deterministicScore = Number(((deterministicTotal - failures.length) / deterministicTotal).toFixed(4));
    const judged = await callJudge({
      goldenCase,
      reply: message.text ?? "",
      contextText,
      metadata,
      leadStatus: updatedLead.status,
      conversationStatus: updatedConversation.status,
      failures
    });

    return {
      id: goldenCase.id,
      deterministicScore,
      retrieval,
      judge: judged.judge,
      failures,
      piiTags: judged.piiTags
    };
  } finally {
    if (tenantId) {
      await prisma.externalOperation.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.runtimeInbox.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.runtimeOutbox.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.channelDeliveryOperation.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.aiReplyRun.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.activeKnowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.knowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.knowledgeIndexSnapshot.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
  }
}

async function main() {
  if (!enabled(process.env.AI_EVAL_ENABLE_REAL_PROVIDER)) {
    const summary = {
      ok: true,
      skipped: true,
      reason: "Set AI_EVAL_ENABLE_REAL_PROVIDER=true to run real-provider eval."
    };
    const report = evalArtifact(summary);
    console.log(JSON.stringify(report));
    writeReport(reportPath("ai-real-provider-eval-report.json"), report);
    return;
  }

  assert(process.env.AI_PROVIDER === "openai", "AI_PROVIDER=openai is required for real-provider eval.");
  assert(enabled(process.env.AI_ENABLE_REAL_PROVIDER), "AI_ENABLE_REAL_PROVIDER=true is required for real-provider eval.");
  assert((process.env.AI_API_KEY ?? "").trim().length > 0, "AI_API_KEY is required for real-provider eval.");

  const golden = readGoldenSet();
  const cases = selectedCases(golden);
  const knowledgeConfig = knowledgeRuntimeConfig();
  const knowledgePublisher = new LegacyKnowledgePublisher(prisma, knowledgeConfig);
  const knowledgeRetriever = new KnowledgeRetriever(prisma, knowledgeConfig);
  const aiProvider = new OpenAiProvider({
    apiKey: process.env.AI_API_KEY ?? "",
    ...(process.env.AI_DEFAULT_MODEL ? { model: process.env.AI_DEFAULT_MODEL } : {}),
    ...(process.env.AI_BASE_URL ? { baseUrl: process.env.AI_BASE_URL } : {}),
    ...(process.env.AI_REASONING_EFFORT ? { reasoningEffort: process.env.AI_REASONING_EFFORT as AiReasoningEffort } : {}),
    ...(process.env.AI_VERBOSITY ? { verbosity: process.env.AI_VERBOSITY as AiVerbosity } : {})
  });

  const results: CaseResult[] = [];
  for (const goldenCase of cases) {
    results.push(await runCase(aiProvider, knowledgePublisher, knowledgeRetriever, golden, goldenCase));
  }

  const judgePassRate = results.filter((result) => result.judge.passed).length / results.length;
  const averageJudgeScore = results.reduce((sum, result) => sum + result.judge.score, 0) / results.length;
  const averageDeterministicScore = results.reduce((sum, result) => sum + result.deterministicScore, 0) / results.length;
  const averageTermRecall = results.reduce((sum, result) => sum + result.retrieval.termRecall, 0) / results.length;
  const averageChunkPrecision = results.reduce((sum, result) => sum + result.retrieval.chunkPrecision, 0) / results.length;
  const thresholds = {
    minJudgePassRate: numberEnv("AI_EVAL_MIN_JUDGE_PASS_RATE", 0.75),
    minAverageJudgeScore: numberEnv("AI_EVAL_MIN_AVERAGE_JUDGE_SCORE", 0.75),
    minAverageDeterministicScore: numberEnv("AI_EVAL_MIN_DETERMINISTIC_SCORE", 0.65)
  };
  const piiTags = mergeTags(results.flatMap((result) => result.piiTags));
  const summary = {
    ok:
      judgePassRate >= thresholds.minJudgePassRate &&
      averageJudgeScore >= thresholds.minAverageJudgeScore &&
      averageDeterministicScore >= thresholds.minAverageDeterministicScore,
    goldenSet: golden.name,
    version: golden.version,
    provider: aiProvider.providerName,
    model: aiProvider.modelName,
    caseIds: cases.map((goldenCase) => goldenCase.id),
    judgePassRate: Number(judgePassRate.toFixed(4)),
    averageJudgeScore: Number(averageJudgeScore.toFixed(4)),
    averageDeterministicScore: Number(averageDeterministicScore.toFixed(4)),
    averageTermRecall: Number(averageTermRecall.toFixed(4)),
    averageChunkPrecision: Number(averageChunkPrecision.toFixed(4)),
    thresholds,
    piiTags,
    results
  };

  const report = evalArtifact(summary, piiTags);
  console.log(JSON.stringify(report, null, 2));
  writeReport(reportPath("ai-real-provider-eval-report.json"), report);
  assert(summary.ok, "AI real-provider eval failed");
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
