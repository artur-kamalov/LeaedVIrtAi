import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const cleanEmail = process.env.LEADVIRT_CLEAN_EMAIL ?? "clean.user.1782990635@yandex.ru";
const cleanPassword = process.env.LEADVIRT_CLEAN_PASSWORD ?? "Clean-1782990635!Aa";

const appRoutes = [
  "/app",
  "/app/inbox",
  "/app/inbox/demo",
  "/app/leads",
  "/app/analytics",
  "/app/integrations",
  "/app/settings",
  "/app/billing",
  "/app/automations",
];

const forbiddenDemoText = [
  "Анна Соколова",
  "Дмитрий Орлов",
  "Елена Васнецова",
  "Игорь Лебедев",
  "Ольга Кравцова",
  "412 лидов",
  "fallback-2025",
  "Demo-подключён",
  "demo-режим",
  "auth login",
  "Студия Glow",
];

test("clean credential workspace does not render demo user data on app routes", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  let login = await page.request.post(`${apiBase}/auth/login`, {
    headers: { "x-leadvirt-qa": "playwright" },
    data: { email: cleanEmail, password: cleanPassword },
  });
  if (!login.ok()) {
    login = await page.request.post(`${apiBase}/auth/signup`, {
      headers: { "x-leadvirt-qa": "playwright" },
      data: { email: cleanEmail, password: cleanPassword, companyName: "Clean Workspace 1782990635" },
    });
  }
  expect(login.ok()).toBeTruthy();

  for (const route of appRoutes) {
    await test.step(route, async () => {
      pageErrors.length = 0;
      await page.goto(`${webBase}${route}`, { waitUntil: "domcontentloaded" });
      expect(pageErrors, route).toEqual([]);
      await expect(page.getByText("Clean Workspace 1782990635").first()).toBeVisible({ timeout: 15_000 });

      for (const text of forbiddenDemoText) {
        await expect(page.getByText(text)).toHaveCount(0);
      }
    });
  }
});
