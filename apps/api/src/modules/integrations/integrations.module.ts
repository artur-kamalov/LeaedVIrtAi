import { Module } from "@nestjs/common";
import { TelegramModule } from "../telegram/telegram.module.js";
import { WebhookModule } from "../webhook/webhook.module.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";

@Module({
  imports: [TelegramModule, WebhookModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService]
})
export class IntegrationsModule {}
