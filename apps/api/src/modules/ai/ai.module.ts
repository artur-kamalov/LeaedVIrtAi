import { Module } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, BudgetedAiProvider, MockAiProvider, OpenAiProvider, type AiProvider } from "@leadvirt/ai";
import { ConfigModule } from "../../config/config.module.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { createAiBudgetStore } from "./ai-budget-store.js";
import { AiReplyQueueService } from "./ai-reply-queue.service.js";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AI_PROVIDER_TOKEN,
      inject: [AppConfigService, PrismaService],
      useFactory: (config: AppConfigService, prisma: PrismaService) => {
        let provider: AiProvider;
        if (config.aiProvider === "openai" && config.aiEnableRealProvider) {
          provider = new OpenAiProvider({
            apiKey: config.aiApiKey ?? "",
            model: config.aiDefaultModel,
            baseUrl: config.aiBaseUrl,
            reasoningEffort: config.aiReasoningEffort,
            verbosity: config.aiVerbosity
          });
        } else {
          provider = new MockAiProvider();
        }

        return new BudgetedAiProvider(provider, createAiBudgetStore(prisma), {
          dailyTokenBudget: config.aiTenantDailyTokenBudget,
          monthlyTokenBudget: config.aiTenantMonthlyTokenBudget
        });
      }
    },
    AiReplyQueueService
  ],
  exports: [AI_PROVIDER_TOKEN, AiReplyQueueService]
})
export class AiModule {}
