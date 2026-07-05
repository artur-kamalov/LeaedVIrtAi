import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { TelegramController } from "./telegram.controller.js";
import { TelegramService } from "./telegram.service.js";

@Module({
  imports: [AiModule, WorkflowsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService]
})
export class TelegramModule {}
