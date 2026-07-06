import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function nextStep(page: import("@playwright/test").Page) {
  await page.locator("button:visible").last().click();
}

test("onboarding company step exposes RAG business fields", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });

  await page.locator("main button").nth(1).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);

  await expect(page.locator("textarea")).toHaveCount(6);
  await page.screenshot({ path: "artifacts/playwright/onboarding-knowledge-fields.png", fullPage: true });
});
