import { Body, Controller, Get, Inject, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { BillingService } from "./billing.service.js";
import { ChangeSubscriptionPlanDto } from "./dto/change-subscription-plan.dto.js";

@UseGuards(WorkspaceAuthGuard)
@Controller("billing")
export class BillingController {
  constructor(@Inject(BillingService) private readonly billingService: BillingService) {}

  @Get("plans")
  async plans() {
    return { data: await this.billingService.plans() };
  }

  @Get("payment-method")
  async paymentMethod(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.paymentMethod(context) };
  }

  @Post("payment-method/change-request")
  async requestPaymentMethodChange(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.requestPaymentMethodChange(context) };
  }

  @Get("invoices")
  async invoices(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.invoices(context) };
  }

  @Get("current-subscription")
  async currentSubscription(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.currentSubscription(context) };
  }

  @Patch("current-subscription")
  async changeSubscriptionPlan(@CurrentContext() context: RequestContext, @Body() dto: ChangeSubscriptionPlanDto) {
    return { data: await this.billingService.changePlan(context, dto) };
  }

  @Post("current-subscription/cancel")
  async cancelSubscription(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.cancelSubscription(context) };
  }

  @Get("usage")
  async usage(@CurrentContext() context: RequestContext) {
    return { data: await this.billingService.usage(context) };
  }
}

