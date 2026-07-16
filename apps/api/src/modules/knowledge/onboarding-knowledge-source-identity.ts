const compatibilitySourceKeys = new Set([
  "onboarding:business_profile",
  "onboarding:catalog",
  "onboarding:availability",
  "onboarding:faq",
  "onboarding:policy",
  "onboarding:escalation",
]);

export function isOnboardingCompatibilitySource(source: {
  source: string;
  sourceKey: string;
}) {
  return source.source === "onboarding" && compatibilitySourceKeys.has(source.sourceKey);
}
