import { Module } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, MockAiProvider, OpenAiProvider } from "@leadvirt/ai";
import { ConfigModule } from "../../config/config.module.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AiReplyQueueService } from "./ai-reply-queue.service.js";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AI_PROVIDER_TOKEN,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        if (config.aiProvider === "openai" && config.aiEnableRealProvider) {
          return new OpenAiProvider({
            apiKey: config.aiApiKey ?? "",
            model: config.aiDefaultModel,
            baseUrl: config.aiBaseUrl,
            reasoningEffort: config.aiReasoningEffort,
            verbosity: config.aiVerbosity
          });
        }

        return new MockAiProvider();
      }
    },
    AiReplyQueueService
  ],
  exports: [AI_PROVIDER_TOKEN, AiReplyQueueService]
})
export class AiModule {}
