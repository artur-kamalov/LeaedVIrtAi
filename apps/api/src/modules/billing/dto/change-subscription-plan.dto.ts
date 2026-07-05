import type { PricingPlanCode } from "@leadvirt/types";
import { IsIn } from "class-validator";

export const billingPlanCodes: PricingPlanCode[] = ["START", "PROFESSIONAL", "BUSINESS", "CORPORATE"];

export class ChangeSubscriptionPlanDto {
  @IsIn(billingPlanCodes)
  planCode!: PricingPlanCode;
}
