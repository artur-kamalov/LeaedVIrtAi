import { expect, test } from "@playwright/test";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test("onboarding automatically publishes tenant knowledge", async ({ request }) => {
  const stamp = Date.now();
  const signup = await request.post(`${apiBase}/auth/signup`, {
    headers: { "x-leadvirt-qa": "playwright" },
    data: {
      email: `knowledge.${stamp}@yandex.ru`,
      password: `Knowledge-${stamp}!Aa`,
      companyName: "Knowledge Test Workspace",
    },
  });
  expect(signup.ok()).toBeTruthy();

  const onboardingUpdate = {
    currentStep: "company",
    data: {
      businessType: "beauty",
      scenario: "booking",
      companyInfo: {
        name: "Knowledge Test Studio",
        description: "A tenant-owned business profile used for RAG smoke checks.",
        hours: "Mon-Fri 10:00-19:00",
        avgCheck: "3000 RUB",
        servicesCatalog: "Haircut - 2500 RUB, 60 minutes; Coloring - from 6000 RUB.",
        availability: "Free windows: Tuesday 12:00, Wednesday 15:00.",
        faq: "Customers ask about duration, parking, and contraindications.",
        policies: "Do not promise exact final price before consultation.",
        escalationRules: "Escalate refunds, complaints, and custom discounts.",
      },
    },
  };
  const initialState = await request.get(`${apiBase}/onboarding/state`);
  expect(initialState.ok()).toBeTruthy();
  const initialStatePayload = (await initialState.json()) as {
    data: { businessProfileEtag: string };
  };
  const update = await request.patch(`${apiBase}/onboarding/state`, {
    headers: { "If-Match": initialStatePayload.data.businessProfileEtag },
    data: onboardingUpdate,
  });
  expect(update.ok()).toBeTruthy();
  const updatedStatePayload = (await update.json()) as {
    data: { businessProfileEtag: string };
  };

  const sourcesResponse = await request.get(`${apiBase}/knowledge/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();
  const payload = (await sourcesResponse.json()) as {
    data: Array<{ type: string; title: string; source: string; content: string; version: number }>;
  };

  const byType = new Map(payload.data.map((source) => [source.type, source]));
  for (const type of [
    "BUSINESS_PROFILE",
    "CATALOG",
    "AVAILABILITY",
    "FAQ",
    "POLICY",
    "ESCALATION",
  ]) {
    expect(byType.get(type)?.source).toBe("onboarding");
  }
  expect(byType.get("CATALOG")?.content).toContain("Haircut");
  expect(byType.get("AVAILABILITY")?.content).toContain("Tuesday 12:00");

  const initialVersions = new Map(payload.data.map((source) => [source.type, source.version]));
  const repeatedUpdate = await request.patch(`${apiBase}/onboarding/state`, {
    headers: { "If-Match": updatedStatePayload.data.businessProfileEtag },
    data: onboardingUpdate,
  });
  expect(repeatedUpdate.ok()).toBeTruthy();
  const repeatedSources = await request.get(`${apiBase}/knowledge/sources`);
  const repeatedPayload = (await repeatedSources.json()) as typeof payload;
  expect(new Map(repeatedPayload.data.map((source) => [source.type, source.version]))).toEqual(
    initialVersions,
  );
});
