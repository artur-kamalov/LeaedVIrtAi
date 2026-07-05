import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { ConversationDetailController, ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

@Module({
  imports: [AiModule],
  controllers: [ConversationsController, ConversationDetailController],
  providers: [ConversationsService],
  exports: [ConversationsService]
})
export class ConversationsModule {}
