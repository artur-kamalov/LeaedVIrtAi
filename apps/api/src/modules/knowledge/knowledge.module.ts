import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgeService } from "./knowledge.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, RolesGuard],
  exports: [KnowledgeService]
})
export class KnowledgeModule {}
