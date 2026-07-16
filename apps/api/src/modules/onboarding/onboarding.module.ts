import { Module } from "@nestjs/common";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";

@Module({
  imports: [KnowledgeModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, RolesGuard],
})
export class OnboardingModule {}
