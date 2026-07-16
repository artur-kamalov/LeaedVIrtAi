import {
  decodeKnowledgeObjectEncryptionKey,
  DeterministicMultilingualKnowledgeV2SparseEncoder,
  EncryptedFileKnowledgeObjectStore,
  EncryptedKnowledgeV2RestrictedContentStore,
  HttpKnowledgeV2Reranker,
  KnowledgeRetriever,
  KnowledgeRuntimeRetriever,
  KnowledgeV2HybridQdrantClient,
  KnowledgeV2Retriever,
  OpenAICompatibleKnowledgeV2EmbeddingProvider,
  PrismaKnowledgeV2DraftSnapshotResolver,
  createPrismaKnowledgeV2LiveTools,
  PrismaKnowledgeV2ProcessorPolicyResolver,
  type KnowledgeV2QueryHashKeyring,
} from "@leadvirt/knowledge";
import type { AppConfigService } from "../../config/app-config.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import { knowledgeRuntimeConfig } from "./knowledge-runtime.js";

export function createKnowledgeV2RuntimeRetriever(
  prisma: PrismaService,
  config: AppConfigService,
  queryHashKeyring: KnowledgeV2QueryHashKeyring,
) {
  const legacy = new KnowledgeRetriever(prisma, knowledgeRuntimeConfig(config));
  if (
    !config.knowledgeEmbeddingProviderApproved ||
    !config.ragQdrantEnabled ||
    !config.knowledgeV2RerankerApproved ||
    config.ragRetrievalMode !== "qdrant" ||
    !config.aiApiKey ||
    config.knowledgeV2EmbeddingDeployment === "unconfigured" ||
    config.knowledgeV2EmbeddingRegion === "unconfigured" ||
    !config.knowledgeV2RerankerEndpoint ||
    config.knowledgeV2RerankerProvider === "unconfigured" ||
    config.knowledgeV2RerankerModel === "unconfigured" ||
    config.knowledgeV2RerankerVersion === "unconfigured" ||
    config.knowledgeV2RerankerRegion === "unconfigured" ||
    !config.knowledgeObjectStorePath ||
    !config.knowledgeArtifactEncryptionKey ||
    !config.knowledgeArtifactEncryptionKeyId
  ) {
    return new KnowledgeRuntimeRetriever(prisma, legacy, undefined, queryHashKeyring);
  }
  try {
    const denseProvider = new OpenAICompatibleKnowledgeV2EmbeddingProvider({
      baseUrl: config.aiBaseUrl,
      apiKey: config.aiApiKey,
      model: config.knowledgeV2EmbeddingModel,
      dimensions: config.knowledgeV2EmbeddingDimensions,
      requestTimeoutMs: config.ragQdrantTimeoutMs,
      maxBatchSize: config.knowledgeV2EmbeddingBatchSize,
      schemaVersion: "knowledge-dense-v1",
    });
    const sparseEncoder = new DeterministicMultilingualKnowledgeV2SparseEncoder({
      maxNonZeroValues: config.knowledgeV2SparseMaxNonZero,
      schemaVersion: "knowledge-sparse-v1",
    });
    const hybridClient = new KnowledgeV2HybridQdrantClient({
      qdrantUrl: config.ragQdrantUrl,
      ...(config.ragQdrantApiKey ? { qdrantApiKey: config.ragQdrantApiKey } : {}),
      collectionPrefix: config.ragQdrantCollection,
      dense: denseProvider.schema,
      sparse: sparseEncoder.schema,
      requestTimeoutMs: config.ragQdrantTimeoutMs,
      maxAttempts: 3,
      retryBaseDelayMs: 250,
      maxBatchSize: Math.min(config.knowledgeV2EmbeddingBatchSize, 256),
      maxReconcilePoints: 100_000,
    });
    const objectStore = new EncryptedFileKnowledgeObjectStore({
      rootPath: config.knowledgeObjectStorePath,
      activeKey: {
        id: config.knowledgeArtifactEncryptionKeyId,
        key: decodeKnowledgeObjectEncryptionKey(config.knowledgeArtifactEncryptionKey),
      },
      maxPlaintextBytes: 128 * 1024,
    });
    const liveTools = createPrismaKnowledgeV2LiveTools({
      prisma,
      objectStore,
      encryptionKeyId: config.knowledgeArtifactEncryptionKeyId,
      queryHashKeyring,
    });
    const structured = new KnowledgeV2Retriever(
      prisma,
      {
        hybridClient,
        denseProvider,
        sparseEncoder,
        reranker: new HttpKnowledgeV2Reranker({
          endpoint: config.knowledgeV2RerankerEndpoint,
          ...(config.knowledgeV2RerankerApiKey ? { apiKey: config.knowledgeV2RerankerApiKey } : {}),
          provider: config.knowledgeV2RerankerProvider,
          model: config.knowledgeV2RerankerModel,
          version: config.knowledgeV2RerankerVersion,
          region: config.knowledgeV2RerankerRegion,
          timeoutMs: config.knowledgeV2RerankerTimeoutMs,
        }),
        restrictedStore: new EncryptedKnowledgeV2RestrictedContentStore(
          objectStore,
          config.knowledgeArtifactEncryptionKeyId,
        ),
        liveToolResultExecutor: liveTools.gateway,
        liveToolResultResolver: liveTools.ledger,
        processorPolicy: new PrismaKnowledgeV2ProcessorPolicyResolver(prisma, {
          policyVersion: config.knowledgeV2RetrievalPolicyVersion,
          queryEmbedding: {
            provider: "openai-compatible",
            deployment: config.knowledgeV2EmbeddingDeployment,
            region: config.knowledgeV2EmbeddingRegion,
            maxClassification: config.knowledgeV2QueryEmbeddingMaxClassification,
          },
          reranker: {
            provider: config.knowledgeV2RerankerProvider,
            model: config.knowledgeV2RerankerModel,
            version: config.knowledgeV2RerankerVersion,
            region: config.knowledgeV2RerankerRegion,
            maxClassification: config.knowledgeV2RerankerMaxClassification,
          },
        }),
        draftResolver: new PrismaKnowledgeV2DraftSnapshotResolver(prisma),
        queryHashKeyring,
      },
      {
        candidateLimit: config.ragCandidateLimit,
        documentLimit: 4,
        maximumChunksPerDocument: 2,
        maximumFacts: 12,
        maximumGuidance: 12,
        minimumRerankScore: config.ragMinScore,
        maximumParentCharacters: 4_000,
        retentionMs: 30 * 24 * 60 * 60_000,
        graphVersion: "knowledge-v2-test-v1",
      },
    );
    return new KnowledgeRuntimeRetriever(prisma, legacy, structured, queryHashKeyring);
  } catch {
    return new KnowledgeRuntimeRetriever(prisma, legacy, undefined, queryHashKeyring);
  }
}
