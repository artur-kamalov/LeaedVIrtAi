import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function nextStep(page: import("@playwright/test").Page) {
  await page.locator("button:visible").last().click();
}

test("onboarding keeps the company step minimal and defers details to Business Information", async ({
  page,
}) => {
  const onboardingState = {
    businessProfileVersion: 1,
    businessProfileEtag: '"business-profile-knowledge-ui-1"',
    businessProfileUpdatedAt: "2026-07-18T12:00:00.000Z",
    currentStep: "business",
    completedSteps: [],
    data: {},
    completedAt: null,
  };
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "knowledge-onboarding-owner",
          tenantId: "knowledge-onboarding-tenant",
          email: "owner@knowledge-onboarding.test",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({ json: { data: onboardingState } });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    await route.fulfill({ json: { data: onboardingState } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });

  await page.locator("main button").nth(1).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);

  await expect(page.getByRole("heading", { name: "What is your business called?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-timezone")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "About the company", exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "artifacts/playwright/onboarding-minimal-company-step.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "What is your business called?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "artifacts/playwright/onboarding-minimal-company-step-mobile.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/demo/knowledge?view=business`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("business-profile-description")).toBeVisible();
  await expect(page.getByTestId("business-profile-services")).toBeVisible();
  await expect(page.getByTestId("business-profile-additional-details")).toBeVisible();
});
