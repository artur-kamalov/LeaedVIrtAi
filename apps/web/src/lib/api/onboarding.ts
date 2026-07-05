import type { OnboardingState } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function getOnboardingState() {
  return apiData<OnboardingState>("/onboarding/state");
}

export function updateOnboardingState(body: Partial<Pick<OnboardingState, "currentStep" | "data">>) {
  return apiData<OnboardingState>("/onboarding/state", { method: "PATCH", ...jsonBody(body) });
}

export function completeOnboardingStep(step: string) {
  return apiData<OnboardingState>("/onboarding/complete-step", { method: "POST", ...jsonBody({ step }) });
}
