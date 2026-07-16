import { Module } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, BudgetedAiProvider, createConfiguredAiProvider } from "@leadvirt/ai";
import { ConfigModule } from "../../config/config.module.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { createAiBudgetStore } from "./ai-budget-store.js";
import { AiReplyQueueService } from "./ai-reply-queue.service.js";
import { RuntimeQueueService } from "./runtime-queue.service.js";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AI_PROVIDER_TOKEN,
      inject: [AppConfigService, PrismaService],
      useFactory: (config: AppConfigService, prisma: PrismaService) => {
        const provider = createConfiguredAiProvider({
          provider: config.aiProvider,
          realProviderEnabled: config.aiEnableRealProvider,
          production: config.env.NODE_ENV === "production",
          apiKey: config.aiApiKey ?? "",
          model: config.aiDefaultModel,
          baseUrl: config.aiBaseUrl,
          reasoningEffort: config.aiReasoningEffort,
          verbosity: config.aiVerbosity,
        });

        return new BudgetedAiProvider(provider, createAiBudgetStore(prisma), {
          dailyTokenBudget: config.aiTenantDailyTokenBudget,
          monthlyTokenBudget: config.aiTenantMonthlyTokenBudget,
        });
      },
    },
    RuntimeQueueService,
    AiReplyQueueService,
  ],
  exports: [AI_PROVIDER_TOKEN, AiReplyQueueService, RuntimeQueueService],
})
export class AiModule {}
