import { Injectable } from "@nestjs/common";
import { getCorsOrigins, loadEnvFile, parseServerEnv } from "@leadvirt/config";
import type { ServerEnv } from "@leadvirt/config";

@Injectable()
export class AppConfigService {
  readonly env: ServerEnv;

  constructor() {
    loadEnvFile();
    this.env = parseServerEnv({
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public",
      ...process.env,
    });
  }

  get port() {
    return this.env.PORT;
  }

  get apiDeploymentPreflight() {
    return this.env.API_DEPLOYMENT_PREFLIGHT;
  }

  get apiUrl() {
    return this.env.API_URL;
  }

  get corsOrigins() {
    return getCorsOrigins(this.env.CORS_ORIGINS);
  }

  get redisUrl() {
    return this.env.REDIS_URL;
  }

  get aiProvider() {
    return this.env.AI_PROVIDER;
  }

  get aiEnableRealProvider() {
    return this.env.AI_ENABLE_REAL_PROVIDER;
  }

  get aiReplyMode() {
    return this.env.AI_REPLY_MODE;
  }

  get aiApiKey() {
    return this.env.AI_API_KEY;
  }

  get aiDefaultModel() {
    return this.env.AI_DEFAULT_MODEL;
  }

  get aiBaseUrl() {
    return this.env.AI_BASE_URL;
  }

  get aiReasoningEffort() {
    return this.env.AI_REASONING_EFFORT;
  }

  get aiVerbosity() {
    return this.env.AI_VERBOSITY;
  }

  get aiTenantDailyTokenBudget() {
    return this.env.AI_TENANT_DAILY_TOKEN_BUDGET;
  }

  get aiTenantMonthlyTokenBudget() {
    return this.env.AI_TENANT_MONTHLY_TOKEN_BUDGET;
  }

  get ragQdrantEnabled() {
    return this.env.RAG_QDRANT_ENABLED;
  }

  get ragRetrievalMode() {
    return this.env.RAG_RETRIEVAL_MODE ?? (this.env.RAG_QDRANT_ENABLED ? "qdrant" : "database");
  }

  get ragQdrantUrl() {
    return this.env.RAG_QDRANT_URL;
  }

  get ragQdrantApiKey() {
    return this.env.RAG_QDRANT_API_KEY;
  }

  get ragQdrantCollection() {
    return this.env.RAG_QDRANT_COLLECTION;
  }

  get ragQdrantTimeoutMs() {
    return this.env.RAG_QDRANT_TIMEOUT_MS;
  }

  get ragMinScore() {
    return this.env.RAG_MIN_SCORE;
  }

  get ragCandidateLimit() {
    return this.env.RAG_CANDIDATE_LIMIT;
  }

  get knowledgeV2EmbeddingModel() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_MODEL;
  }

  get knowledgeV2EmbeddingDimensions() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_DIMENSIONS;
  }

  get knowledgeV2EmbeddingBatchSize() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_BATCH_SIZE;
  }

  get knowledgeV2EmbeddingTimeoutMs() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_TIMEOUT_MS;
  }

  get knowledgeV2EmbeddingDeployment() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT;
  }

  get knowledgeV2EmbeddingRegion() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_REGION;
  }

  get knowledgeV2EmbeddingPolicyVersion() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION;
  }

  get knowledgeV2ExternalEmbeddingMaxClassification() {
    return this.env.KNOWLEDGE_V2_EXTERNAL_EMBEDDING_MAX_CLASSIFICATION;
  }

  get knowledgeV2RetrievalPolicyVersion() {
    return this.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION;
  }

  get knowledgeV2QueryEmbeddingMaxClassification() {
    return this.env.KNOWLEDGE_V2_QUERY_EMBEDDING_MAX_CLASSIFICATION;
  }

  get knowledgeV2RerankerMaxClassification() {
    return this.env.KNOWLEDGE_V2_RERANKER_MAX_CLASSIFICATION;
  }

  get knowledgeV2SparseMaxNonZero() {
    return this.env.KNOWLEDGE_V2_SPARSE_MAX_NON_ZERO;
  }

  get knowledgeV2EmbeddingCacheTtlDays() {
    return this.env.KNOWLEDGE_V2_EMBEDDING_CACHE_TTL_DAYS;
  }

  get knowledgeV2RerankerApproved() {
    return this.env.KNOWLEDGE_V2_RERANKER_APPROVED;
  }

  get knowledgeV2RerankerEndpoint() {
    return this.env.KNOWLEDGE_V2_RERANKER_ENDPOINT;
  }

  get knowledgeV2RerankerApiKey() {
    return this.env.KNOWLEDGE_V2_RERANKER_API_KEY;
  }

  get knowledgeV2RerankerProvider() {
    return this.env.KNOWLEDGE_V2_RERANKER_PROVIDER;
  }

  get knowledgeV2RerankerModel() {
    return this.env.KNOWLEDGE_V2_RERANKER_MODEL;
  }

  get knowledgeV2RerankerVersion() {
    return this.env.KNOWLEDGE_V2_RERANKER_VERSION;
  }

  get knowledgeV2GroundedAnswerApproved() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_APPROVED;
  }

  get knowledgeV2GroundedAnswerBaseUrl() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_BASE_URL;
  }

  get knowledgeV2GroundedAnswerApiKey() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_API_KEY;
  }

  get knowledgeV2GroundedAnswerProvider() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER;
  }

  get knowledgeV2GroundedAnswerModel() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL;
  }

  get knowledgeV2GroundedAnswerVersion() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION;
  }

  get knowledgeV2GroundedAnswerRegion() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_REGION;
  }

  get knowledgeV2ModelProcessorPolicyVersion() {
    return this.env.KNOWLEDGE_V2_MODEL_PROCESSOR_POLICY_VERSION;
  }

  get knowledgeV2GroundedPromptPolicyVersion() {
    return this.env.KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION;
  }

  get knowledgeV2ModelProcessorMaxClassification() {
    return this.env.KNOWLEDGE_V2_MODEL_PROCESSOR_MAX_CLASSIFICATION;
  }

  get knowledgeV2GroundedAnswerTimeoutMs() {
    return this.env.KNOWLEDGE_V2_GROUNDED_ANSWER_TIMEOUT_MS;
  }

  get knowledgeV2RerankerRegion() {
    return this.env.KNOWLEDGE_V2_RERANKER_REGION;
  }

  get knowledgeV2RerankerTimeoutMs() {
    return this.env.KNOWLEDGE_V2_RERANKER_TIMEOUT_MS;
  }

  get knowledgeEmbeddingProviderApproved() {
    return this.env.KNOWLEDGE_EMBEDDING_PROVIDER_APPROVED;
  }

  get knowledgeWebsiteImportEnabled() {
    return this.env.KNOWLEDGE_WEBSITE_IMPORT_ENABLED;
  }

  get knowledgeWebsiteEgressReady() {
    return this.env.KNOWLEDGE_WEBSITE_EGRESS_READY;
  }

  get knowledgeObjectStorePath() {
    return this.env.KNOWLEDGE_OBJECT_STORE_PATH;
  }

  get knowledgeArtifactEncryptionKey() {
    return this.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY;
  }

  get knowledgeArtifactEncryptionKeyId() {
    return this.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID;
  }

  get knowledgeQueryHmacActiveKeyId() {
    return this.env.KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID;
  }

  get knowledgeQueryHmacKeys() {
    return this.env.KNOWLEDGE_QUERY_HMAC_KEYS;
  }

  get knowledgeMaxWebsiteBytes() {
    return this.env.KNOWLEDGE_MAX_WEBSITE_BYTES;
  }

  get knowledgeWebsiteFetchTimeoutMs() {
    return this.env.KNOWLEDGE_WEBSITE_FETCH_TIMEOUT_MS;
  }

  get knowledgeAcceptanceWebsiteFixtureEnabled() {
    return this.env.KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_ENABLED;
  }

  get knowledgeFileImportEnabled() {
    return this.env.KNOWLEDGE_FILE_IMPORT_ENABLED;
  }

  get businessImportEnabled() {
    return this.env.BUSINESS_IMPORT_ENABLED;
  }

  get businessImportMaxFileBytes() {
    return this.env.BUSINESS_IMPORT_MAX_FILE_BYTES;
  }

  get businessImportUploadTtlSeconds() {
    return this.env.BUSINESS_IMPORT_UPLOAD_TTL_SECONDS;
  }

  get businessImportMaxPendingPerTenant() {
    return this.env.BUSINESS_IMPORT_MAX_PENDING_PER_TENANT;
  }

  get businessImportXlsxSandboxApproved() {
    return this.env.BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED;
  }

  get businessImportParserApproved() {
    return this.env.BUSINESS_IMPORT_PARSER_APPROVED;
  }

  get businessImportParserUrl() {
    return this.env.BUSINESS_IMPORT_PARSER_URL;
  }

  get businessImportParserVersion() {
    return this.env.BUSINESS_IMPORT_PARSER_VERSION;
  }

  get businessImportParserTimeoutMs() {
    return this.env.BUSINESS_IMPORT_PARSER_TIMEOUT_MS;
  }

  get knowledgeMaxFileBytes() {
    return this.env.KNOWLEDGE_MAX_FILE_BYTES;
  }

  get knowledgeFileUploadTtlSeconds() {
    return this.env.KNOWLEDGE_FILE_UPLOAD_TTL_SECONDS;
  }

  get knowledgeFileUploadStreamTimeoutMs() {
    return this.env.KNOWLEDGE_FILE_UPLOAD_STREAM_TIMEOUT_MS;
  }

  get knowledgeFileScannerHost() {
    return this.env.KNOWLEDGE_FILE_SCANNER_HOST;
  }

  get knowledgeFileScannerApproved() {
    return this.env.KNOWLEDGE_FILE_SCANNER_APPROVED;
  }

  get knowledgeFileScannerPort() {
    return this.env.KNOWLEDGE_FILE_SCANNER_PORT;
  }

  get knowledgeFileScannerVersion() {
    return this.env.KNOWLEDGE_FILE_SCANNER_VERSION;
  }

  get knowledgeFileScannerTimeoutMs() {
    return this.env.KNOWLEDGE_FILE_SCANNER_TIMEOUT_MS;
  }

  get otelEnabled() {
    return this.env.OTEL_ENABLED;
  }

  get otelCollectorHealthUrl() {
    return this.env.OTEL_COLLECTOR_HEALTH_URL;
  }
}
