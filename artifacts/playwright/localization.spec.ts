import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.describe("RU/EN localization", () => {
  test.setTimeout(60_000);

  test("language choice updates the public funnel and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(webBase, { waitUntil: "domcontentloaded" });

    const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
    await expect(switcher).toHaveValue("ru");
    await expect(switcher).toBeEnabled();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "AI-администратор для входящих лидов, диалогов и продаж.");
    await switcher.selectOption("en");

    await expect(switcher).toHaveValue("en");
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("An AI administrator for");
    await expect(page.getByRole("link", { name: "Start free" }).first()).toBeVisible();
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({ path: "artifacts/screenshots/localization-landing-en.png", animations: "disabled" });
    }

    const cookies = await page.context().cookies(webBase);
    expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("en");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="language-switcher"]:visible').first()).toHaveValue("en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("An AI administrator for");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "AI administrator for inbound leads, conversations, and sales.");

    await page.goto(`${webBase}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Log in to LeadVirt.ai");
    await expect(page.getByText("Passwordless", { exact: true })).toBeVisible();
  });

  test("English locale covers onboarding and workspace overview on mobile", async ({ context, page }) => {
    await context.addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${webBase}/onboarding`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("What kind of business is this?");
    await expect(page.getByText("Step 1 of 6")).toBeVisible();
    await expect(page.locator('[data-testid="language-switcher"]:visible')).toHaveValue("en");
    await expect(page.getByTestId("onboarding-step-panel")).toHaveCSS("opacity", "1");
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({ path: "artifacts/screenshots/localization-onboarding-en-mobile.png" });
    }

    await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
    await expect(page.getByText(/^Welcome, /)).toBeVisible();
    await expect(page.getByText("New leads", { exact: true }).first()).toBeVisible();
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({ path: "artifacts/screenshots/localization-dashboard-en-mobile.png", animations: "disabled" });
    }
  });
});
