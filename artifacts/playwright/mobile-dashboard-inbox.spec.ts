import { expect, test } from "@playwright/test";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const mobileViewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
] as const;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("mobile demo shows business metrics before the detailed readiness journey", async ({
  page,
}) => {
  for (const viewport of mobileViewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

    const statGrid = page.getByTestId("dashboard-stat-grid");
    const readiness = page.getByTestId("dashboard-readiness");
    await expect(statGrid).toBeVisible();
    await expect(readiness).toBeVisible();

    const [statBox, readinessBox] = await Promise.all([
      statGrid.boundingBox(),
      readiness.boundingBox(),
    ]);
    expect(statBox, `${viewport.width}px stat grid`).not.toBeNull();
    expect(readinessBox, `${viewport.width}px readiness`).not.toBeNull();
    expect(statBox!.y).toBeLessThan(readinessBox!.y);
    expect(statBox!.y).toBeLessThan(viewport.height);
    expect(readinessBox!.height).toBeLessThan(300);

    const readinessAction = page.getByTestId("dashboard-readiness-primary");
    await expect(readinessAction).toBeVisible();
    const readinessActionBox = await readinessAction.boundingBox();
    expect(readinessActionBox).not.toBeNull();
    expect(readinessActionBox!.y + readinessActionBox!.height).toBeLessThan(viewport.height);

    const leadNames = page.getByTestId("dashboard-recent-lead-name");
    await expect(leadNames.first()).toBeVisible();
    const nameWidths = await leadNames.evaluateAll((elements) =>
      elements.map((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    );
    expect(nameWidths.length).toBeGreaterThan(0);
    expect(nameWidths.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(
      true,
    );

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("mobile inbox exposes a usable scroll control for every clipped filter row", async ({
  page,
}) => {
  for (const viewport of mobileViewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${webBase}/demo/inbox`, { waitUntil: "domcontentloaded" });

    for (const filter of [
      {
        label: messages.en["ops.inbox.channelFilters"],
        testId: "inbox-channel-filters",
      },
      {
        label: messages.en["ops.inbox.statusFilters"],
        testId: "inbox-status-filters",
      },
    ]) {
      const group = page.getByRole("group", { name: filter.label });
      await expect(group).toBeVisible();
      await expect(page.getByTestId(filter.testId)).toBeVisible();

      const isClipped = await group.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 2,
      );
      const scrollControl = page.getByTestId(`${filter.testId}-scroll`);

      if (!isClipped) {
        await expect(scrollControl).toHaveCount(0);
        continue;
      }

      await expect(scrollControl).toBeVisible();
      await expect(scrollControl).toHaveAccessibleName(messages.en["ops.inbox.scrollFilters"]);
      const controlBox = await scrollControl.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(controlBox!.width).toBeGreaterThanOrEqual(44);
      expect(controlBox!.height).toBeGreaterThanOrEqual(44);

      await scrollControl.click();
      await expect.poll(() => group.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
