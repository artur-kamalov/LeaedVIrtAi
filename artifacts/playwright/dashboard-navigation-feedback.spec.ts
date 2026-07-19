import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("dashboard routes leads correctly and exposes refresh progress", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("link", { name: "All leads", exact: true })).toHaveAttribute(
    "href",
    "/demo/leads",
  );

  const refresh = page.getByTestId("dashboard-readiness-refresh");
  await expect(refresh).toBeEnabled();
  await refresh.click();

  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(refresh).toContainText("Check again");
  await expect(refresh.locator("svg")).toHaveClass(/animate-spin/u);
  await expect(page.getByTestId("dashboard-readiness")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("dashboard-readiness").getByRole("status")).toHaveText(
    "Checking launch readiness",
  );

  await expect(refresh).toBeEnabled({ timeout: 3_000 });
  await expect(refresh).toHaveAttribute("aria-busy", "false");
  await expect(refresh).toContainText("Check again");
});
