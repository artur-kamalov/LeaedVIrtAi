import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { WebhookController } from "./webhook.controller.js";
import { WebhookService } from "./webhook.service.js";

@Module({
  imports: [AiModule, WorkflowsModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService]
})
export class WebhookModule {}
