import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import { LegacyKnowledgePublisher, type KnowledgeRuntimeConfig } from "@leadvirt/knowledge";
import { redactAndTagSensitiveData } from "@leadvirt/observability";
import type { AiReplyJobData } from "@leadvirt/types";

loadEnvFile();
process.env.AI_PROVIDER = "mock";
process.env.AI_ENABLE_REAL_PROVIDER = "false";
process.env.RAG_RETRIEVAL_MODE = "database";

const knowledgeConfig: KnowledgeRuntimeConfig = {
  mode: "database",
  qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
  qdrantCollection: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
  qdrantTimeoutMs: 1000,
  minScore: 0.05,
  candidateLimit: 20,
  targetKey: "workspace"
};

type ProcessLeadVirtJob = typeof import("../../apps/worker/src/processors/processor-registry.js").processLeadVirtJob;

interface GoldenKnowledge {
  type: "PROFILE" | "CATALOG" | "FAQ" | "POLICY" | "AVAILABILITY" | "ESCALATION";
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
  thresholds: {
    minPassRate: number;
    minAverageScore: number;
    minRetrievalHitRate: number;
  };
  commonKnowledge: GoldenKnowledge[];
  cases: GoldenCase[];
}

interface CaseResult {
  id: string;
  passed: boolean;
  score: number;
  retrievalHit: boolean;
  retrieval: RetrievalMetrics;
  failures: string[];
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function readGoldenSet() {
  const raw = readFileSync(new URL("../evals/ai-golden-set.json", import.meta.url), "utf8");
  return JSON.parse(raw) as GoldenSet;
}

function lower(value: unknown) {
  return jsonString(value).toLowerCase();
}

function toolTypes(metadata: Record<string, unknown>) {
  const results = Array.isArray(metadata.toolResults) ? metadata.toolResults : [];
  return results
    .filter(isRecord)
    .filter((result) => result.status === "SUCCESS")
    .map((result) => result.type)
    .filter((type): type is string => typeof type === "string");
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

function evalArtifact<T extends Record<string, unknown>>(summary: T) {
  const scan = redactAndTagSensitiveData(summary);
  return {
    ...scan.redacted,
    piiTags: scan.tags,
    redactionApplied: scan.redactedCount > 0
  };
}

async function retrievedContext(tenantId: string, metadata: Record<string, unknown>): Promise<RetrievedContext> {
  const context = Array.isArray(metadata.retrievedContext) ? metadata.retrievedContext : [];
  const refs = context.filter(isRecord);
  const chunkIds = refs.map((item) => item.chunkId).filter((id): id is string => typeof id === "string");
  const rows =
    chunkIds.length > 0
      ? await prisma.knowledgeRevisionChunk.findMany({
          where: { tenantId, id: { in: chunkIds } },
          select: { content: true, revision: { select: { title: true } } }
        })
      : [];

  const chunks = rows.map((chunk) => ({ title: chunk.revision.title, content: chunk.content }));
  return {
    text: [
      ...refs.map((item) => jsonString(item)),
      ...chunks.map((chunk) => `${chunk.title}: ${chunk.content}`)
    ].join("\n"),
    chunks
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

function addCheck(failures: string[], condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

async function seedKnowledge(tenantId: string, suffix: string, entries: GoldenKnowledge[]) {
  let index = 0;
  for (const entry of entries) {
    await prisma.businessKnowledgeSource.create({
      data: {
        tenantId,
        type: entry.type === "PROFILE" ? "BUSINESS_PROFILE" : entry.type,
        status: "ACTIVE",
        source: "golden-set",
        sourceKey: `golden:${suffix}:${index}`,
        title: entry.title,
        content: entry.content,
        structuredData: { goldenSet: true }
      }
    });
    index += 1;
  }
  await new LegacyKnowledgePublisher(prisma, knowledgeConfig).publish({
    tenantId,
    reason: `quality_gate:${suffix}`
  });
}

async function runCase(processLeadVirtJob: ProcessLeadVirtJob, golden: GoldenSet, goldenCase: GoldenCase): Promise<CaseResult> {
  const suffix = `${goldenCase.id}-${Date.now()}-${randomUUID().slice(0, 8)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  let tenantId: string | null = null;
  const failures: string[] = [];

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: goldenCase.businessName ?? `AI Quality ${goldenCase.id}`,
        slug: `ai-quality-${suffix}`,
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
        name: "AI Quality Webhook",
        publicKey: `lvwh_quality_${suffix}`
      }
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: `AI Quality Lead ${goldenCase.id}`,
        source: "ai-quality-gate",
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
        externalMessageId: `inbound-${suffix}`,
        text: goldenCase.text,
        status: "RECEIVED"
      }
    });

    await seedKnowledge(tenant.id, suffix, goldenCase.knowledge ?? golden.commonKnowledge);

    const data: AiReplyJobData = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      triggerMessageId: inbound.id,
      source: "worker-test"
    };
    const jobId = `ai-quality:${goldenCase.id}:${conversation.id}:${inbound.id}`;
    const result = await processLeadVirtJob("ai.reply", {
      id: jobId,
      data: {
        ...data,
        runtimeEventId: `c${"0".repeat(24)}`,
        runtimeGeneration: 1,
      },
    } as Parameters<typeof processLeadVirtJob>[1]);
    assert(isRecord(result), `${goldenCase.id}: graph result is not an object`);
    assert(result.status === "processed", `${goldenCase.id}: expected processed result`);
    assert(typeof result.messageId === "string", `${goldenCase.id}: graph result has no message id`);

    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    assert(isRecord(message.metadata), `${goldenCase.id}: AI message metadata is not an object`);
    const metadata = message.metadata;
    const quality = isRecord(metadata.quality) ? metadata.quality : {};
    const tools = toolTypes(metadata);
    const context = await retrievedContext(tenant.id, metadata);
    const retrieval = retrievalMetrics(goldenCase, context);
    const contextText = context.text;
    const contextTextLower = contextText.toLowerCase();
    const retrievedAllTerms = goldenCase.mustRetrieveTerms.every((term) => contextTextLower.includes(term.toLowerCase()));

    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const updatedConversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    const booking = await prisma.booking.findFirst({ where: { tenantId: tenant.id, leadId: lead.id, status: "DRAFT" } });
    const task = await prisma.task.findFirst({ where: { tenantId: tenant.id, leadId: lead.id } });
    const usage = await prisma.aiUsageLog.findFirst({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        actionType: "langgraph_queued_reply"
      }
    });

    addCheck(failures, quality.passed === goldenCase.expectedQualityPassed, `quality.passed expected ${goldenCase.expectedQualityPassed}, got ${quality.passed}`);
    if (goldenCase.expectedQualityReason) {
      addCheck(failures, quality.reason === goldenCase.expectedQualityReason, `quality.reason expected ${goldenCase.expectedQualityReason}, got ${quality.reason}`);
    }
    addCheck(failures, metadata.classifiedIntent === goldenCase.expectedClassifiedIntent, `classifiedIntent expected ${goldenCase.expectedClassifiedIntent}, got ${metadata.classifiedIntent}`);
    addCheck(failures, updatedLead.status === goldenCase.expectedLeadStatus, `lead status expected ${goldenCase.expectedLeadStatus}, got ${updatedLead.status}`);
    addCheck(
      failures,
      updatedConversation.status === goldenCase.expectedConversationStatus,
      `conversation status expected ${goldenCase.expectedConversationStatus}, got ${updatedConversation.status}`
    );
    for (const expectedTool of goldenCase.expectedTools) {
      addCheck(failures, tools.includes(expectedTool), `missing expected tool ${expectedTool}`);
    }
    for (const forbiddenTool of goldenCase.forbiddenTools) {
      addCheck(failures, !tools.includes(forbiddenTool), `forbidden tool executed ${forbiddenTool}`);
    }
    addCheck(failures, Boolean(booking) === goldenCase.expectedBookingDraft, `booking draft expected ${goldenCase.expectedBookingDraft}`);
    addCheck(failures, Boolean(task) === goldenCase.expectedHandoffTask, `handoff task expected ${goldenCase.expectedHandoffTask}`);
    addCheck(failures, Boolean(usage), "usage log missing");
    if (goldenCase.mustRetrieveTerms.length > 0) {
      addCheck(failures, retrievedAllTerms, `retrieved context missing terms: ${goldenCase.mustRetrieveTerms.join(", ")}`);
    }

    const totalChecks =
      8 + goldenCase.expectedTools.length + goldenCase.forbiddenTools.length + (goldenCase.expectedQualityReason ? 1 : 0) + (goldenCase.mustRetrieveTerms.length > 0 ? 1 : 0);
    const score = Number(((totalChecks - failures.length) / totalChecks).toFixed(4));
    return {
      id: goldenCase.id,
      passed: failures.length === 0,
      score,
      retrievalHit: goldenCase.mustRetrieveTerms.length === 0 || retrievedAllTerms,
      retrieval,
      failures
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
  const golden = readGoldenSet();
  const { processLeadVirtJob } = (await import("../../apps/worker/src/processors/processor-registry.js")) as {
    processLeadVirtJob: ProcessLeadVirtJob;
  };

  const results: CaseResult[] = [];
  for (const goldenCase of golden.cases) {
    results.push(await runCase(processLeadVirtJob, golden, goldenCase));
  }

  const passedCount = results.filter((result) => result.passed).length;
  const passRate = passedCount / results.length;
  const averageScore = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const retrievalHitRate = results.filter((result) => result.retrievalHit).length / results.length;
  const averageTermRecall = results.reduce((sum, result) => sum + result.retrieval.termRecall, 0) / results.length;
  const averageChunkPrecision = results.reduce((sum, result) => sum + result.retrieval.chunkPrecision, 0) / results.length;
  const summary = {
    ok:
      passRate >= golden.thresholds.minPassRate &&
      averageScore >= golden.thresholds.minAverageScore &&
      retrievalHitRate >= golden.thresholds.minRetrievalHitRate,
    goldenSet: golden.name,
    version: golden.version,
    passRate: Number(passRate.toFixed(4)),
    averageScore: Number(averageScore.toFixed(4)),
    retrievalHitRate: Number(retrievalHitRate.toFixed(4)),
    averageTermRecall: Number(averageTermRecall.toFixed(4)),
    averageChunkPrecision: Number(averageChunkPrecision.toFixed(4)),
    thresholds: golden.thresholds,
    results
  };

  const report = evalArtifact(summary);
  console.log(JSON.stringify(report, null, 2));
  writeReport(reportPath("ai-quality-gate-report.json"), report);
  assert(summary.ok, "AI quality gate failed");
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
