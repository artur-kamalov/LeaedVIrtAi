import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test("onboarding hydrates state and persists progress", async ({ page }) => {
  const statePatches: { currentStep?: string; data?: Record<string, unknown> }[] = [];
  const completedSteps: string[] = [];
  let stateLoaded = false;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      stateLoaded = true;
      await route.fulfill({
        json: {
          data: {
            currentStep: "business",
            completedSteps: [],
            data: {},
            completedAt: null,
          },
        },
      });
      return;
    }

    const body = route.request().postDataJSON() as { currentStep?: string; data?: Record<string, unknown> };
    statePatches.push(body);
    await route.fulfill({
      json: {
        data: {
          currentStep: body.currentStep ?? "business",
          completedSteps,
          data: body.data ?? {},
          completedAt: null,
        },
      },
    });
  });

  await page.route("**/api/onboarding/complete-step", async (route) => {
    const body = route.request().postDataJSON() as { step?: string };
    if (body.step) completedSteps.push(body.step);
    await route.fulfill({
      json: {
        data: {
          currentStep: body.step ?? "business",
          completedSteps,
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await expect.poll(() => stateLoaded).toBe(true);
  await expect(page.getByRole("button", { name: /^Далее$/ })).toBeDisabled();

  await page.getByRole("button", { name: /Бьюти-студия/ }).click();
  await expect(page.getByRole("button", { name: /^Далее$/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByText("Откуда приходят клиенты?")).toBeVisible();
  await expect.poll(() => completedSteps).toContain("business");
  await expect
    .poll(() => statePatches.some((patch) => patch.currentStep === "channels" && patch.data?.businessType === "beauty"))
    .toBe(true);
});
