export interface OnboardingKnowledgeInput {
  businessName: string;
  businessDescription: string;
  businessType: string;
  scenario: string;
  hours: string;
  averageCheck: string;
  servicesCatalog: string;
  availability: string;
  faq: string;
  policies: string;
  escalationRules: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function onboardingKnowledgeInput(data: Record<string, unknown>): OnboardingKnowledgeInput {
  const companyInfo = record(data.companyInfo);
  return {
    businessName: text(companyInfo.name),
    businessDescription: text(companyInfo.description),
    businessType: text(data.businessType),
    scenario: text(data.scenario),
    hours: text(companyInfo.hours),
    averageCheck: text(companyInfo.avgCheck),
    servicesCatalog: text(companyInfo.servicesCatalog),
    availability: text(companyInfo.availability),
    faq: text(companyInfo.faq),
    policies: text(companyInfo.policies),
    escalationRules: text(companyInfo.escalationRules),
  };
}
