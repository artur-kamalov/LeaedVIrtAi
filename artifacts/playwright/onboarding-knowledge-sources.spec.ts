import { expect, test } from "@playwright/test";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test("onboarding company profile syncs tenant knowledge sources", async ({ request }) => {
  const stamp = Date.now();
  const signup = await request.post(`${apiBase}/auth/signup`, {
    headers: { "x-leadvirt-qa": "playwright" },
    data: {
      email: `knowledge.${stamp}@yandex.ru`,
      password: `Knowledge-${stamp}!Aa`,
      companyName: "Knowledge Test Workspace"
    }
  });
  expect(signup.ok()).toBeTruthy();

  const update = await request.patch(`${apiBase}/onboarding/state`, {
    data: {
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
          escalationRules: "Escalate refunds, complaints, and custom discounts."
        }
      }
    }
  });
  expect(update.ok()).toBeTruthy();

  const sourcesResponse = await request.get(`${apiBase}/knowledge/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();
  const payload = (await sourcesResponse.json()) as {
    data: Array<{ type: string; title: string; source: string; content: string }>;
  };

  const byType = new Map(payload.data.map((source) => [source.type, source]));
  for (const type of ["BUSINESS_PROFILE", "CATALOG", "AVAILABILITY", "FAQ", "POLICY", "ESCALATION"]) {
    expect(byType.get(type)?.source).toBe("onboarding");
  }
  expect(byType.get("CATALOG")?.content).toContain("Haircut");
  expect(byType.get("AVAILABILITY")?.content).toContain("Tuesday 12:00");

  const reindex = await request.post(`${apiBase}/knowledge/sources/reindex`);
  expect(reindex.ok()).toBeTruthy();
  const reindexPayload = (await reindex.json()) as { data: { sources: number; chunks: number; indexed: number } };
  expect(reindexPayload.data.sources).toBeGreaterThanOrEqual(6);
  expect(reindexPayload.data.chunks).toBeGreaterThanOrEqual(6);

  const search = await request.get(`${apiBase}/knowledge/sources/search`, {
    params: { q: "Haircut Tuesday booking window", limit: 5 }
  });
  expect(search.ok()).toBeTruthy();
  const searchPayload = (await search.json()) as {
    data: Array<{ source: { type: string }; chunk: { content: string }; score: number }>;
  };
  expect(searchPayload.data.length).toBeGreaterThan(0);
  expect(searchPayload.data.some((item) => item.source.type === "CATALOG" || item.source.type === "AVAILABILITY")).toBe(true);
  expect(searchPayload.data[0]?.score).toBeGreaterThan(0);
});
