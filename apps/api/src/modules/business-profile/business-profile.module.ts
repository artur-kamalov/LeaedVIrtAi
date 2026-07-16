import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { BusinessProfileController } from "./business-profile.controller.js";
import { BusinessProfileService } from "./business-profile.service.js";

@Module({
  imports: [KnowledgeModule],
  controllers: [BusinessProfileController],
  providers: [BusinessProfileService, RolesGuard],
  exports: [BusinessProfileService],
})
export class BusinessProfileModule {}
