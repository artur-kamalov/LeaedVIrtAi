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
  timezone: string;
  services: OnboardingKnowledgeService[];
  weeklySchedule: OnboardingKnowledgeScheduleDay[];
}

export interface OnboardingKnowledgeService {
  id: string;
  name: string;
  description: string;
  price: string;
  duration: string;
}

export interface OnboardingKnowledgeScheduleDay {
  day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  enabled: boolean;
  opensAt: string;
  closesAt: string;
}

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_INDEX = new Map(DAYS.map((day, index) => [day, index]));

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function services(value: unknown): OnboardingKnowledgeService[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const candidate = record(item);
    const id = text(candidate.id);
    const name = text(candidate.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        description: text(candidate.description),
        price: text(candidate.price),
        duration: text(candidate.duration),
      },
    ];
  });
}

function weeklySchedule(value: unknown): OnboardingKnowledgeScheduleDay[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const candidate = record(item);
      const day = text(candidate.day);
      if (!DAY_INDEX.has(day as (typeof DAYS)[number]) || typeof candidate.enabled !== "boolean") {
        return [];
      }
      return [
        {
          day: day as OnboardingKnowledgeScheduleDay["day"],
          enabled: candidate.enabled,
          opensAt: text(candidate.opensAt),
          closesAt: text(candidate.closesAt),
        },
      ];
    })
    .sort((left, right) => (DAY_INDEX.get(left.day) ?? 0) - (DAY_INDEX.get(right.day) ?? 0));
}

function composedServices(items: OnboardingKnowledgeService[], legacyNotes: string) {
  if (items.length === 0) return legacyNotes;
  const structured = items.map((item) => {
    const details = [
      item.description ? `Description: ${item.description}` : "",
      item.price ? `Price: ${item.price}` : "",
      item.duration ? `Duration: ${item.duration}` : "",
    ].filter(Boolean);
    return `- ${item.name}${details.length > 0 ? ` | ${details.join(" | ")}` : ""}`;
  });
  return [
    "Services:",
    ...structured,
    ...(legacyNotes ? ["", "Additional service notes:", legacyNotes] : []),
  ].join("\n");
}

function composedHours(
  schedule: OnboardingKnowledgeScheduleDay[],
  legacyNotes: string,
  timezone: string,
) {
  if (schedule.length === 0) {
    if (!legacyNotes) return "";
    if (!timezone) return legacyNotes;
    return [
      `Timezone: ${timezone}`,
      ...(legacyNotes ? ["", "Additional hours notes:", legacyNotes] : []),
    ].join("\n");
  }
  const structured = schedule.map((entry) =>
    entry.enabled ? `${entry.day}: ${entry.opensAt}-${entry.closesAt}` : `${entry.day}: closed`,
  );
  return [
    `Weekly schedule${timezone ? ` (${timezone})` : ""}:`,
    ...structured,
    ...(legacyNotes ? ["", "Additional hours notes:", legacyNotes] : []),
  ].join("\n");
}

export function onboardingKnowledgeInput(data: Record<string, unknown>): OnboardingKnowledgeInput {
  const companyInfo = record(data.companyInfo);
  const serviceItems = services(companyInfo.services);
  const schedule = weeklySchedule(companyInfo.weeklySchedule);
  const timezone = text(data.timezone);
  return {
    businessName: text(companyInfo.name),
    businessDescription: text(companyInfo.description),
    businessType: text(data.businessType),
    scenario: text(data.scenario),
    hours: composedHours(schedule, text(companyInfo.hours), timezone),
    averageCheck: text(companyInfo.avgCheck),
    servicesCatalog: composedServices(serviceItems, text(companyInfo.servicesCatalog)),
    availability: text(companyInfo.availability),
    faq: text(companyInfo.faq),
    policies: text(companyInfo.policies),
    escalationRules: text(companyInfo.escalationRules),
    timezone,
    services: serviceItems,
    weeklySchedule: schedule,
  };
}
