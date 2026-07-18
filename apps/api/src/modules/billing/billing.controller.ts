import { Body, Controller, Get, Inject, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { BillingService } from "./billing.service.js";
import { ChangeSubscriptionPlanDto } from "./dto/change-subscription-plan.dto.js";

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("billing")
export class BillingController {
  constructor(@Inject(BillingService) private readonly billingService: BillingService) {}

  @Get("plans")
  plans() {
    return { data: this.billingService.plans() };
  }

  @Get("payment-method")
  async paymentMethod(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.paymentMethod(context) };
  }

  @Roles("OWNER", "ADMIN")
  @Post("payment-method/change-request")
  async requestPaymentMethodChange(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.requestPaymentMethodChange(context) };
  }

  @Get("invoices")
  invoices() {
    return { data: this.billingService.invoices() };
  }

  @Get("current-subscription")
  async currentSubscription(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.currentSubscription(context) };
  }

  @Get("plan-selection")
  async planSelection(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.planSelection(context) };
  }

  @Roles("OWNER", "ADMIN")
  @Post("plan-selection")
  async selectPlan(@CurrentContext() context: RequestContext, @Body() dto: ChangeSubscriptionPlanDto) {
    return { data: await this.billingService.selectPlan(context, dto) };
  }

  @Roles("OWNER", "ADMIN")
  @Patch("current-subscription")
  async changeSubscriptionPlan(@CurrentContext() context: RequestContext, @Body() dto: ChangeSubscriptionPlanDto) {
    return { data: await this.billingService.changePlan(context, dto) };
  }

  @Roles("OWNER", "ADMIN")
  @Post("current-subscription/cancel")
  async cancelSubscription(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.cancelSubscription(context) };
  }

  @Get("usage")
  async usage(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.usage(context) };
  }
}

