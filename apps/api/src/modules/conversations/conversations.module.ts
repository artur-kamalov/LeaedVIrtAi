import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { AiModule } from "../ai/ai.module.js";
import { ConversationDetailController, ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

@Module({
  imports: [AiModule],
  controllers: [ConversationsController, ConversationDetailController],
  providers: [ConversationsService, RolesGuard],
  exports: [ConversationsService]
})
export class ConversationsModule {}
