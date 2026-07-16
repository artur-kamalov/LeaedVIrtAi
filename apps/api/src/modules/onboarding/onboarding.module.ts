import { Module } from "@nestjs/common";
import { BusinessProfileModule } from "../business-profile/business-profile.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";

@Module({
  imports: [BusinessProfileModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, RolesGuard],
})
export class OnboardingModule {}
