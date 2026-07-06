import { Injectable } from "@nestjs/common";
import { getCorsOrigins, loadEnvFile, parseServerEnv } from "@leadvirt/config";
import type { ServerEnv } from "@leadvirt/config";

@Injectable()
export class AppConfigService {
  readonly env: ServerEnv;

  constructor() {
    loadEnvFile();
    this.env = parseServerEnv({
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public",
      ...process.env
    });
  }

  get port() {
    return this.env.PORT;
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

  get ragQdrantUrl() {
    return this.env.RAG_QDRANT_URL;
  }

  get ragQdrantApiKey() {
    return this.env.RAG_QDRANT_API_KEY;
  }

  get ragQdrantCollection() {
    return this.env.RAG_QDRANT_COLLECTION;
  }
}
