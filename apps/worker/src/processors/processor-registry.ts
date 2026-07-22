import { UnrecoverableError, type Job } from "bullmq";
import {
  BudgetedAiProvider,
  OpenAICompatibleGroundedAnswerProvider,
  createConfiguredAiProvider,
  type AiExtractionInput,
  type AiProvider,
  type AiReasoningEffort,
  type AiVerbosity,
} from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  decodeKnowledgeObjectEncryptionKey,
  DeterministicMultilingualKnowledgeV2SparseEncoder,
  EncryptedFileKnowledgeObjectStore,
  EncryptedKnowledgeV2RestrictedContentStore,
  HttpKnowledgeV2Reranker,
  KnowledgeRetriever,
  KnowledgeRuntimeRetriever,
  KnowledgeV2GroundedAnswerService,
  KnowledgeV2GroundedOutputPolicy,
  KnowledgeV2HybridQdrantClient,
  KnowledgeV2Retriever,
  OpenAICompatibleKnowledgeV2EmbeddingProvider,
  createPrismaKnowledgeV2LiveTools,
  createKnowledgeV2QueryHashKeyringFromEnvironment,
  PrismaKnowledgeV2DraftSnapshotResolver,
  PrismaKnowledgeV2ModelProcessorAuthorizer,
  PrismaKnowledgeV2ProcessorPolicyResolver,
  type KnowledgeRuntimeConfig,
} from "@leadvirt/knowledge";
import type {
  AiReplyJobData,
  ChannelSendMessageJobData,
  KnowledgeV2SecurityClassification,
} from "@leadvirt/types";
import { createAiBudgetStore } from "../ai/ai-budget-store.js";
import { runAiReplyGraph } from "../ai/ai-reply-graph.js";
import { deliverChannelMessage } from "../channels/channel-delivery.js";
import {
  businessImportSafeError,
  createBusinessImportDependencies,
  isBusinessImportRuntimeData,
  processBusinessImportJob,
} from "../business-import/business-import-processor.js";
import {
  businessInformationProjectionSafeError,
  createBusinessInformationProjectionDependencies,
  isBusinessInformationProjectionRuntimeData,
  processBusinessInformationProjectionJob,
} from "../business-import/business-information-projection-processor.js";
import {
  createKnowledgeIngestionDependencies,
  isKnowledgeIngestionRuntimeData,
  knowledgeIngestionErrorType,
  knowledgeIngestionSafeError,
  processKnowledgeIngestionJob,
} from "../knowledge/knowledge-ingestion-processor.js";
import { recordKnowledgeIngestion } from "../observability/metrics.js";
import type { LeadVirtQueueName } from "../queues/queue-names.js";

loadEnvFile();
const knowledgeQueryHashKeyring = createKnowledgeV2QueryHashKeyringFromEnvironment(process.env);

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function positiveIntEnv(name: string) {
  const value = Number(process.env[name] ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function createBaseAiProvider(): AiProvider {
  return createConfiguredAiProvider({
    ...(process.env.AI_PROVIDER ? { provider: process.env.AI_PROVIDER } : {}),
    realProviderEnabled: isTruthy(process.env.AI_ENABLE_REAL_PROVIDER),
    production: process.env.NODE_ENV === "production",
    apiKey: process.env.AI_API_KEY ?? "",
    ...(process.env.AI_DEFAULT_MODEL ? { model: process.env.AI_DEFAULT_MODEL } : {}),
    ...(process.env.AI_BASE_URL ? { baseUrl: process.env.AI_BASE_URL } : {}),
    ...(process.env.AI_REASONING_EFFORT
      ? { reasoningEffort: process.env.AI_REASONING_EFFORT as AiReasoningEffort }
      : {}),
    ...(process.env.AI_VERBOSITY ? { verbosity: process.env.AI_VERBOSITY as AiVerbosity } : {}),
  });
}

function createAiProvider(): AiProvider {
  return new BudgetedAiProvider(createBaseAiProvider(), createAiBudgetStore(), {
    dailyTokenBudget: positiveIntEnv("AI_TENANT_DAILY_TOKEN_BUDGET"),
    monthlyTokenBudget: positiveIntEnv("AI_TENANT_MONTHLY_TOKEN_BUDGET"),
  });
}

const aiProvider = createAiProvider();

function createGroundedAnswerService() {
  const identity = {
    provider: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER ?? "unconfigured",
    model: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL ?? "unconfigured",
    version: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION ?? "unconfigured",
    region: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_REGION ?? "unconfigured",
  };
  const configured = Boolean(
    isTruthy(process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED) &&
    process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL &&
    process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY &&
    Object.values(identity).every((value) => value && value !== "unconfigured"),
  );
  const provider = configured
    ? new OpenAICompatibleGroundedAnswerProvider({
        baseUrl: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL!,
        apiKey: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY!,
        ...identity,
        timeoutMs: Math.max(
          100,
          Math.floor(numericEnv("KNOWLEDGE_V2_GROUNDED_ANSWER_TIMEOUT_MS", 20_000)),
        ),
      })
    : {
        identity,
        generate: () => Promise.reject(new Error("Grounded answer generation is not configured.")),
      };
  const authorizer = new PrismaKnowledgeV2ModelProcessorAuthorizer(prisma, {
    policyVersion: process.env.KNOWLEDGE_V2_MODEL_PROCESSOR_POLICY_VERSION ?? "external-model-v1",
    promptPolicyVersion:
      process.env.KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION ?? "grounded-answer-v1",
    ...identity,
    maxClassification: classificationEnv(
      "KNOWLEDGE_V2_MODEL_PROCESSOR_MAX_CLASSIFICATION",
      "INTERNAL",
    ),
  });
  return new KnowledgeV2GroundedAnswerService(
    provider,
    authorizer,
    new KnowledgeV2GroundedOutputPolicy(),
    knowledgeQueryHashKeyring,
  );
}

function numericEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function classificationEnv(
  name: string,
  fallback: KnowledgeV2SecurityClassification,
): KnowledgeV2SecurityClassification {
  const value = process.env[name];
  return ["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"].includes(value ?? "")
    ? (value as KnowledgeV2SecurityClassification)
    : fallback;
}

function knowledgeRuntimeConfig(): KnowledgeRuntimeConfig {
  const mode =
    process.env.RAG_RETRIEVAL_MODE === "qdrant" || process.env.RAG_RETRIEVAL_MODE === "database"
      ? process.env.RAG_RETRIEVAL_MODE
      : isTruthy(process.env.RAG_QDRANT_ENABLED)
        ? "qdrant"
        : "database";
  return {
    mode,
    qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
    ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
    qdrantCollection: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
    qdrantTimeoutMs: Math.max(1, Math.floor(numericEnv("RAG_QDRANT_TIMEOUT_MS", 3000))),
    minScore: Math.max(-1, Math.min(1, numericEnv("RAG_MIN_SCORE", 0.05))),
    candidateLimit: Math.max(1, Math.min(200, Math.floor(numericEnv("RAG_CANDIDATE_LIMIT", 50)))),
    targetKey: "workspace",
  };
}

function createStructuredKnowledgeRetriever() {
  if (
    !isTruthy(process.env.KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED) ||
    !isTruthy(process.env.RAG_QDRANT_ENABLED) ||
    !isTruthy(process.env.KNOWLEDGE_V2_RERANKER_APPROVED) ||
    process.env.RAG_RETRIEVAL_MODE !== "qdrant" ||
    !process.env.AI_API_KEY ||
    !process.env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT ||
    process.env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT === "unconfigured" ||
    !process.env.KNOWLEDGE_V2_EMBEDDING_REGION ||
    process.env.KNOWLEDGE_V2_EMBEDDING_REGION === "unconfigured" ||
    !process.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ||
    !process.env.KNOWLEDGE_V2_RERANKER_ENDPOINT ||
    !process.env.KNOWLEDGE_V2_RERANKER_PROVIDER ||
    !process.env.KNOWLEDGE_V2_RERANKER_MODEL ||
    !process.env.KNOWLEDGE_V2_RERANKER_VERSION ||
    !process.env.KNOWLEDGE_V2_RERANKER_REGION ||
    !process.env.KNOWLEDGE_OBJECT_STORE_PATH ||
    !process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY ||
    !process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID
  ) {
    return undefined;
  }
  const denseProvider = new OpenAICompatibleKnowledgeV2EmbeddingProvider({
    baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY,
    model: process.env.KNOWLEDGE_V2_EMBEDDING_MODEL ?? "text-embedding-3-small",
    dimensions: Math.max(1, Math.floor(numericEnv("KNOWLEDGE_V2_EMBEDDING_DIMENSIONS", 1536))),
    requestTimeoutMs: Math.max(100, Math.floor(numericEnv("RAG_QDRANT_TIMEOUT_MS", 3000))),
    maxBatchSize: Math.max(
      1,
      Math.min(256, Math.floor(numericEnv("KNOWLEDGE_V2_EMBEDDING_BATCH_SIZE", 64))),
    ),
    schemaVersion: "knowledge-dense-v1",
  });
  const sparseEncoder = new DeterministicMultilingualKnowledgeV2SparseEncoder({
    maxNonZeroValues: Math.max(1, Math.floor(numericEnv("KNOWLEDGE_V2_SPARSE_MAX_NON_ZERO", 2048))),
    schemaVersion: "knowledge-sparse-v1",
  });
  const hybridClient = new KnowledgeV2HybridQdrantClient({
    qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
    ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
    collectionPrefix: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
    dense: denseProvider.schema,
    sparse: sparseEncoder.schema,
    requestTimeoutMs: Math.max(100, Math.floor(numericEnv("RAG_QDRANT_TIMEOUT_MS", 3000))),
    maxAttempts: 3,
    retryBaseDelayMs: 250,
    maxBatchSize: Math.max(
      1,
      Math.min(256, Math.floor(numericEnv("KNOWLEDGE_V2_EMBEDDING_BATCH_SIZE", 64))),
    ),
    maxReconcilePoints: 100_000,
  });
  const objectStore = new EncryptedFileKnowledgeObjectStore({
    rootPath: process.env.KNOWLEDGE_OBJECT_STORE_PATH,
    activeKey: {
      id: process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID,
      key: decodeKnowledgeObjectEncryptionKey(process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY),
    },
    maxPlaintextBytes: 128 * 1024,
  });
  const liveTools = createPrismaKnowledgeV2LiveTools({
    prisma,
    objectStore,
    encryptionKeyId: process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID,
    queryHashKeyring: knowledgeQueryHashKeyring,
  });
  return new KnowledgeV2Retriever(
    prisma,
    {
      hybridClient,
      denseProvider,
      sparseEncoder,
      reranker: new HttpKnowledgeV2Reranker({
        endpoint: process.env.KNOWLEDGE_V2_RERANKER_ENDPOINT,
        ...(process.env.KNOWLEDGE_V2_RERANKER_API_KEY
          ? { apiKey: process.env.KNOWLEDGE_V2_RERANKER_API_KEY }
          : {}),
        provider: process.env.KNOWLEDGE_V2_RERANKER_PROVIDER ?? "unconfigured",
        model: process.env.KNOWLEDGE_V2_RERANKER_MODEL ?? "unconfigured",
        version: process.env.KNOWLEDGE_V2_RERANKER_VERSION ?? "unconfigured",
        region: process.env.KNOWLEDGE_V2_RERANKER_REGION ?? "unconfigured",
        timeoutMs: Math.max(100, Math.floor(numericEnv("KNOWLEDGE_V2_RERANKER_TIMEOUT_MS", 5000))),
      }),
      restrictedStore: new EncryptedKnowledgeV2RestrictedContentStore(
        objectStore,
        process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID,
      ),
      liveToolResultExecutor: liveTools.gateway,
      liveToolResultResolver: liveTools.ledger,
      processorPolicy: new PrismaKnowledgeV2ProcessorPolicyResolver(prisma, {
        policyVersion: process.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ?? "knowledge-v2",
        queryEmbedding: {
          provider: "openai-compatible",
          deployment: process.env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT ?? "unconfigured",
          region: process.env.KNOWLEDGE_V2_EMBEDDING_REGION ?? "unconfigured",
          maxClassification: classificationEnv(
            "KNOWLEDGE_V2_QUERY_EMBEDDING_MAX_CLASSIFICATION",
            "INTERNAL",
          ),
        },
        reranker: {
          provider: process.env.KNOWLEDGE_V2_RERANKER_PROVIDER ?? "unconfigured",
          model: process.env.KNOWLEDGE_V2_RERANKER_MODEL ?? "unconfigured",
          version: process.env.KNOWLEDGE_V2_RERANKER_VERSION ?? "unconfigured",
          region: process.env.KNOWLEDGE_V2_RERANKER_REGION ?? "unconfigured",
          maxClassification: classificationEnv(
            "KNOWLEDGE_V2_RERANKER_MAX_CLASSIFICATION",
            "INTERNAL",
          ),
        },
      }),
      draftResolver: new PrismaKnowledgeV2DraftSnapshotResolver(prisma),
      queryHashKeyring: knowledgeQueryHashKeyring,
    },
    {
      candidateLimit: Math.max(1, Math.min(200, Math.floor(numericEnv("RAG_CANDIDATE_LIMIT", 50)))),
      documentLimit: 4,
      maximumChunksPerDocument: 2,
      maximumFacts: 12,
      maximumGuidance: 12,
      minimumRerankScore: Math.max(-1, Math.min(1, numericEnv("RAG_MIN_SCORE", 0.05))),
      maximumParentCharacters: 4_000,
      retentionMs: 30 * 24 * 60 * 60_000,
      graphVersion: "ai-reply-graph-v2",
    },
  );
}

const legacyKnowledgeRetriever = new KnowledgeRetriever(prisma, knowledgeRuntimeConfig());
const knowledgeRetriever = new KnowledgeRuntimeRetriever(
  prisma,
  legacyKnowledgeRetriever,
  createStructuredKnowledgeRetriever(),
  knowledgeQueryHashKeyring,
);
const groundedAnswerService = createGroundedAnswerService();
const knowledgeIngestionDependencies = createKnowledgeIngestionDependencies(prisma);
const businessImportDependencies = createBusinessImportDependencies(prisma);
const businessInformationProjectionDependencies =
  createBusinessInformationProjectionDependencies(prisma);

export type LeadVirtJobData = Record<string, unknown>;

const aiReplyJobDataKeys = new Set([
  "tenantId",
  "conversationId",
  "triggerMessageId",
  "source",
  "customerIdentity",
  "requestedByUserId",
  "runtimeEventId",
  "runtimeGeneration",
]);
const customerIdentityKeys = new Set(["id", "version", "subjectHash", "attestationHash"]);

function validDatabaseId(value: unknown): value is string {
  return typeof value === "string" && /^c[a-z0-9]{24}$/u.test(value);
}

const aiExtractionJobDataKeys = new Set(["tenantId", "conversationId", "text"]);
const channelSendMessageJobDataKeys = new Set([
  "tenantId",
  "conversationId",
  "messageId",
  "source",
  "graphRunId",
  "triggerMessageId",
  "aiReplyRunId",
  "aiReplyGeneration",
  "aiReplySequence",
  "requestedByUserId",
  "requestedAt",
  "runtimeEventId",
  "runtimeGeneration",
]);

function isAiExtractionJobData(data: LeadVirtJobData): data is AiExtractionInput & LeadVirtJobData {
  return (
    Object.keys(data).length === aiExtractionJobDataKeys.size &&
    Object.keys(data).every((key) => aiExtractionJobDataKeys.has(key)) &&
    validDatabaseId(data.tenantId) &&
    validDatabaseId(data.conversationId) &&
    typeof data.text === "string" &&
    data.text.trim().length > 0 &&
    data.text.length <= 100_000
  );
}

function validCustomerIdentity(value: unknown) {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    Object.keys(identity).length === customerIdentityKeys.size &&
    Object.keys(identity).every((key) => customerIdentityKeys.has(key)) &&
    validDatabaseId(identity.id) &&
    identity.version === 1 &&
    typeof identity.subjectHash === "string" &&
    /^[a-f0-9]{64}$/u.test(identity.subjectHash) &&
    typeof identity.attestationHash === "string" &&
    /^[a-f0-9]{64}$/u.test(identity.attestationHash)
  );
}

function optionalDatabaseId(value: unknown) {
  return value === undefined || value === null || validDatabaseId(value);
}

function optionalPositiveInteger(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function validIsoTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isAiReplyJobData(data: LeadVirtJobData): data is AiReplyJobData & LeadVirtJobData {
  return (
    Object.keys(data).every((key) => aiReplyJobDataKeys.has(key)) &&
    validDatabaseId(data.tenantId) &&
    validDatabaseId(data.conversationId) &&
    validDatabaseId(data.triggerMessageId) &&
    ["inbox", "widget", "webhook", "telegram", "worker-test"].includes(String(data.source)) &&
    validDatabaseId(data.runtimeEventId) &&
    typeof data.runtimeGeneration === "number" &&
    Number.isInteger(data.runtimeGeneration) &&
    data.runtimeGeneration > 0 &&
    (data.requestedByUserId === undefined ||
      data.requestedByUserId === null ||
      validDatabaseId(data.requestedByUserId)) &&
    validCustomerIdentity(data.customerIdentity)
  );
}

function isChannelSendMessageJobData(
  data: LeadVirtJobData,
): data is ChannelSendMessageJobData & LeadVirtJobData {
  const aiFenceValues = [data.aiReplyRunId, data.aiReplyGeneration, data.aiReplySequence];
  const aiFenceConfigured = aiFenceValues.some((value) => value !== undefined && value !== null);
  return (
    Object.keys(data).every((key) => channelSendMessageJobDataKeys.has(key)) &&
    validDatabaseId(data.tenantId) &&
    validDatabaseId(data.conversationId) &&
    validDatabaseId(data.messageId) &&
    (data.source === "telegram" || data.source === "webhook") &&
    (data.graphRunId === undefined ||
      data.graphRunId === null ||
      (typeof data.graphRunId === "string" &&
        data.graphRunId.trim().length > 0 &&
        data.graphRunId.length <= 512)) &&
    optionalDatabaseId(data.triggerMessageId) &&
    optionalDatabaseId(data.aiReplyRunId) &&
    optionalPositiveInteger(data.aiReplyGeneration) &&
    optionalPositiveInteger(data.aiReplySequence) &&
    (!aiFenceConfigured ||
      (validDatabaseId(data.aiReplyRunId) &&
        typeof data.aiReplyGeneration === "number" &&
        Number.isInteger(data.aiReplyGeneration) &&
        data.aiReplyGeneration > 0 &&
        typeof data.aiReplySequence === "number" &&
        Number.isInteger(data.aiReplySequence) &&
        data.aiReplySequence > 0)) &&
    optionalDatabaseId(data.requestedByUserId) &&
    validIsoTimestamp(data.requestedAt) &&
    validDatabaseId(data.runtimeEventId) &&
    typeof data.runtimeGeneration === "number" &&
    Number.isInteger(data.runtimeGeneration) &&
    data.runtimeGeneration > 0
  );
}

export function processLeadVirtJob(
  queueName: LeadVirtQueueName,
  job: Job<LeadVirtJobData>,
  signal?: AbortSignal,
) {
  const data = job.data;

  switch (queueName) {
    case "ai.reply":
      if (isAiReplyJobData(data)) {
        return runAiReplyGraph({
          data,
          jobId: job.id,
          aiProvider,
          knowledgeRetriever,
          groundedAnswer: groundedAnswerService,
          ...(signal ? { signal } : {}),
        });
      }
      throw new UnrecoverableError("Invalid ai.reply job data.");
    case "ai.extractLeadFields":
      if (!isAiExtractionJobData(data)) {
        throw new UnrecoverableError("Invalid ai.extractLeadFields job data.");
      }
      return aiProvider.extractLeadFields({
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        text: data.text,
      });
    case "channels.sendMessage":
      if (isChannelSendMessageJobData(data)) {
        return deliverChannelMessage(data, job.id, signal, {
          knowledgeRetriever,
          groundedAnswer: groundedAnswerService,
          maxDeliveryAttempts:
            typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1,
        });
      }
      throw new UnrecoverableError("Invalid channels.sendMessage job data.");
    case "knowledge.ingest": {
      const startedAt = Date.now();
      const operation = ["IMPORT", "SYNC", "RECONCILE", "DELETE"].includes(String(data.operation))
        ? String(data.operation)
        : "INVALID";
      if (!isKnowledgeIngestionRuntimeData(data) || typeof job.id !== "string") {
        recordKnowledgeIngestion({
          operation,
          stage: "QUEUED",
          result: "failed",
          errorType: "validation",
          durationMs: Date.now() - startedAt,
        });
        throw new UnrecoverableError("The knowledge ingestion queue payload is invalid.");
      }
      const maxAttempts =
        typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
      return processKnowledgeIngestionJob(
        {
          id: job.id,
          name: job.name,
          data,
          attemptsMade: job.attemptsMade,
          maxAttempts,
          signal: signal ?? new AbortController().signal,
        },
        knowledgeIngestionDependencies,
      )
        .then((result) => {
          recordKnowledgeIngestion({
            operation: result.operation,
            stage: result.stage,
            result: result.status === "already_succeeded" ? "unchanged" : result.status,
            errorType: "none",
            durationMs: Date.now() - startedAt,
          });
          return result;
        })
        .catch((error: unknown) => {
          const safe = knowledgeIngestionSafeError(error);
          recordKnowledgeIngestion({
            operation: data.operation,
            stage: safe.stage,
            result: "failed",
            errorType: knowledgeIngestionErrorType(error),
            durationMs: Date.now() - startedAt,
          });
          if (!safe.retryable) {
            const terminal = new UnrecoverableError(safe.message);
            Object.defineProperty(terminal, "knowledgeCode", { value: safe.code });
            Object.defineProperty(terminal, "knowledgeStage", { value: safe.stage });
            throw terminal;
          }
          throw error;
        });
    }
    case "business.import": {
      if (job.name === "project" || job.name === "project-revision") {
        if (!isBusinessInformationProjectionRuntimeData(data) || typeof job.id !== "string") {
          throw new UnrecoverableError("The Business Information projection payload is invalid.");
        }
        return processBusinessInformationProjectionJob(
          {
            id: job.id,
            name: job.name,
            data,
            signal: signal ?? new AbortController().signal,
          },
          businessInformationProjectionDependencies,
        ).catch((error: unknown) => {
          const safe = businessInformationProjectionSafeError(error);
          if (!safe.retryable) {
            const terminal = new UnrecoverableError(safe.message);
            Object.defineProperty(terminal, "businessInformationProjectionCode", {
              value: safe.code,
            });
            Object.defineProperty(terminal, "businessInformationProjectionStage", {
              value: safe.stage,
            });
            throw terminal;
          }
          throw error;
        });
      }
      if (
        !isBusinessImportRuntimeData(data) ||
        typeof job.id !== "string" ||
        job.name !== "parse"
      ) {
        throw new UnrecoverableError("The business import queue payload is invalid.");
      }
      return processBusinessImportJob(
        {
          id: job.id,
          name: job.name,
          data,
          signal: signal ?? new AbortController().signal,
        },
        businessImportDependencies,
      ).catch((error: unknown) => {
        const safe = businessImportSafeError(error);
        if (!safe.retryable) {
          const terminal = new UnrecoverableError(safe.message);
          Object.defineProperty(terminal, "businessImportCode", { value: safe.code });
          Object.defineProperty(terminal, "businessImportStage", { value: safe.stage });
          throw terminal;
        }
        throw error;
      });
    }
    default:
      throw new UnrecoverableError(`No processor is implemented for ${queueName}.`);
  }
}
