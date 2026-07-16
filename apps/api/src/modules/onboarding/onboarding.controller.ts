import { Body, Controller, Get, Inject, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { CompleteOnboardingStepDto, UpdateOnboardingDto } from "./dto/update-onboarding.dto.js";
import { OnboardingService } from "./onboarding.service.js";

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboardingService: OnboardingService) {}

  @Get("state")
  async state(@CurrentContext() context: RequestContext) {
    return { data: await this.onboardingService.state(context) };
  }

  @Patch("state")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async update(@CurrentContext() context: RequestContext, @Body() dto: UpdateOnboardingDto) {
    return { data: await this.onboardingService.update(context, dto) };
  }

  @Post("complete-step")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async completeStep(
    @CurrentContext() context: RequestContext,
    @Body() dto: CompleteOnboardingStepDto,
  ) {
    return { data: await this.onboardingService.completeStep(context, dto) };
  }
}
