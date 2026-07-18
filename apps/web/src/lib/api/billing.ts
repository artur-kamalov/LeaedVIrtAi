import type {
  BillingInvoice,
  BillingPlanSelection,
  BillingPaymentMethod,
  BillingPaymentMethodUpdateRequest,
  PricingPlan,
  PricingPlanCode,
  Subscription,
  UsageSummary
} from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function listBillingPlans() {
  return apiData<PricingPlan[]>("/billing/plans");
}

export function getBillingPaymentMethod() {
  return apiData<BillingPaymentMethod>("/billing/payment-method");
}

export function requestBillingPaymentMethodChange() {
  return apiData<BillingPaymentMethodUpdateRequest>("/billing/payment-method/change-request", {
    method: "POST"
  });
}

export function listBillingInvoices() {
  return apiData<BillingInvoice[]>("/billing/invoices");
}

export function getCurrentSubscription() {
  return apiData<Subscription | null>("/billing/current-subscription");
}

export function getBillingPlanSelection() {
  return apiData<BillingPlanSelection | null>("/billing/plan-selection");
}

export function selectBillingPlan(planCode: PricingPlanCode) {
  return apiData<BillingPlanSelection>("/billing/plan-selection", {
    method: "POST",
    ...jsonBody({ planCode })
  });
}

export function cancelCurrentSubscription() {
  return apiData<Subscription>("/billing/current-subscription/cancel", {
    method: "POST"
  });
}

export function getBillingUsage() {
  return apiData<UsageSummary>("/billing/usage");
}
