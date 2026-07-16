import type { KnowledgeRuntimeConfig } from "@leadvirt/knowledge";
import type { AppConfigService } from "../../config/app-config.service.js";

export function knowledgeRuntimeConfig(config: AppConfigService): KnowledgeRuntimeConfig {
  return {
    mode: config.ragRetrievalMode,
    qdrantUrl: config.ragQdrantUrl,
    ...(config.ragQdrantApiKey ? { qdrantApiKey: config.ragQdrantApiKey } : {}),
    qdrantCollection: config.ragQdrantCollection,
    qdrantTimeoutMs: config.ragQdrantTimeoutMs,
    minScore: config.ragMinScore,
    candidateLimit: config.ragCandidateLimit,
    targetKey: "workspace"
  };
}
