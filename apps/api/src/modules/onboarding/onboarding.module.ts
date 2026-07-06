import { Module } from "@nestjs/common";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

@Module({
  imports: [KnowledgeModule],
  controllers: [OnboardingController],
  providers: [OnboardingService]
})
export class OnboardingModule {}
