export const acquisitionPlanIds = ["start", "pro", "business", "corporate"] as const;

export type AcquisitionPlanId = (typeof acquisitionPlanIds)[number];

export interface AcquisitionIntent {
  plan?: string | null;
  returnTo?: string | null;
}

function normalizedPlan(value: string | null | undefined): AcquisitionPlanId | null {
  return acquisitionPlanIds.includes(value as AcquisitionPlanId)
    ? (value as AcquisitionPlanId)
    : null;
}

function onboardingDestination(plan: AcquisitionPlanId | null) {
  return plan ? `/onboarding?plan=${encodeURIComponent(plan)}` : "/onboarding";
}

export function signupHref(plan?: AcquisitionPlanId) {
  const params = new URLSearchParams();
  if (plan) params.set("plan", plan);
  params.set("returnTo", onboardingDestination(plan ?? null));
  return `/signup?${params.toString()}`;
}

export function resolveAcquisitionIntent(intent?: AcquisitionIntent | null) {
  const plan = normalizedPlan(intent?.plan);
  const requestedReturnTo = intent?.returnTo?.trim();

  if (!requestedReturnTo) {
    return {
      plan,
      returnTo: plan ? onboardingDestination(plan) : null,
    };
  }

  try {
    const url = new URL(requestedReturnTo, "https://leadvirt.com");
    if (url.origin !== "https://leadvirt.com" || url.pathname !== "/onboarding") {
      return { plan, returnTo: plan ? onboardingDestination(plan) : null };
    }

    const destinationPlan = normalizedPlan(url.searchParams.get("plan")) ?? plan;
    return {
      plan: destinationPlan,
      returnTo: onboardingDestination(destinationPlan),
    };
  } catch {
    return { plan, returnTo: plan ? onboardingDestination(plan) : null };
  }
}

export function authHref(pathname: "/login" | "/signup", intent?: AcquisitionIntent | null) {
  const resolved = resolveAcquisitionIntent(intent);
  if (!resolved.returnTo) return pathname;

  const params = new URLSearchParams();
  if (resolved.plan) params.set("plan", resolved.plan);
  params.set("returnTo", resolved.returnTo);
  return `${pathname}?${params.toString()}`;
}
