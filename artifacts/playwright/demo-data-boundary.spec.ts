import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test("tenant-scoped API requires a credential session", async ({ request }) => {
  for (const path of ["/auth/me", "/current-tenant", "/dashboard/summary"]) {
    const response = await request.get(`${apiBase}${path}`);
    expect(response.status(), path).toBe(401);
  }
});

test("unauthenticated app visit redirects to login", async ({ page }) => {
  await page.goto(`${webBase}/app`);
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});

test("demo preview is static and does not call credential workspace APIs", async ({ page }) => {
  const forbiddenCalls: string[] = [];
  const forbiddenPatterns = [
    "**/api/auth/me",
    "**/api/current-tenant",
    "**/api/dashboard/summary",
    "**/api/billing/current-subscription",
  ];

  for (const pattern of forbiddenPatterns) {
    await page.route(pattern, async (route) => {
      forbiddenCalls.push(route.request().url());
      await route.abort();
    });
  }

  await page.goto(`${webBase}/demo`, { waitUntil: "networkidle" });

  await expect(page.getByText("Read-only demo").first()).toBeVisible();
  await expect(page.getByText("Эти данные статичны и не относятся к вашему аккаунту или базе.")).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});
