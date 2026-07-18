import type { PricingPlan, PricingPlanCode } from "@leadvirt/types";

const plans: Record<PricingPlanCode, PricingPlan> = {
  START: {
    code: "START",
    name: "Start",
    priceMonthlyRub: 9900,
    aiConversations: 500,
    channelsLimit: 2,
    usersLimit: 3,
    scenariosLimit: 3,
    features: [],
  },
  PROFESSIONAL: {
    code: "PROFESSIONAL",
    name: "Professional",
    priceMonthlyRub: 24900,
    aiConversations: 2500,
    channelsLimit: 5,
    usersLimit: 10,
    scenariosLimit: 15,
    popular: true,
    features: [],
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    priceMonthlyRub: 59900,
    aiConversations: 10000,
    channelsLimit: 10,
    usersLimit: 25,
    scenariosLimit: 50,
    features: [],
  },
  CORPORATE: {
    code: "CORPORATE",
    name: "Corporate",
    priceMonthlyRub: 120000,
    aiConversations: null,
    channelsLimit: null,
    usersLimit: null,
    scenariosLimit: null,
    features: [],
  },
};

function clonePlan(plan: PricingPlan): PricingPlan {
  return { ...plan, features: [...plan.features] };
}

export function billingPlanCatalog(): PricingPlan[] {
  return [plans.START, plans.PROFESSIONAL, plans.BUSINESS, plans.CORPORATE].map(clonePlan);
}

export function billingPlanByCode(code: PricingPlanCode): PricingPlan {
  return clonePlan(plans[code]);
}

export function isPricingPlanCode(value: unknown): value is PricingPlanCode {
  return value === "START" || value === "PROFESSIONAL" || value === "BUSINESS" || value === "CORPORATE";
}
