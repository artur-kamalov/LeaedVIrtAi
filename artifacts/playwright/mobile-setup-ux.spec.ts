import { expect, test, type Page } from "@playwright/test";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const mobileViewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
] as const;

async function expectInsideViewport(page: Page, testId: string, bottomGap = 0) {
  const control = page.getByTestId(testId);
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) - bottomGap,
  );
  return box!;
}

for (const viewport of mobileViewports) {
  test(`setup journeys keep primary actions usable at ${viewport.width}px`, async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
    ]);
    await page.setViewportSize(viewport);

    await page.goto(`${webBase}/demo/onboarding`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("progressbar", { name: "Step 6 of 6" })).toBeVisible();
    await expectInsideViewport(page, "onboarding-restart-mobile", 12);
    const launch = page.getByRole("button", { name: messages.en["onboarding.launch"] });
    await expect(launch).toBeVisible();
    const launchBox = await launch.boundingBox();
    expect(launchBox).not.toBeNull();
    expect(launchBox!.y + launchBox!.height).toBeLessThanOrEqual(viewport.height - 12);

    await page.getByTestId("onboarding-restart-mobile").click();
    await expect(page.getByRole("progressbar", { name: "Step 1 of 6" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: messages.en["onboarding.business.title"] }),
    ).toBeVisible();

    await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });
    const connect = page
      .getByTestId("integration-card-webhook")
      .getByRole("link", { name: messages.en["integrations.demoConnect"] });
    await expect(connect).toBeVisible();
    await connect.evaluate((element) => element.scrollIntoView({ block: "end" }));
    const connectBox = await connect.boundingBox();
    const navigationBox = await page
      .getByTestId("product-mobile-bottom-navigation")
      .boundingBox();
    expect(connectBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect(connectBox!.y + connectBox!.height).toBeLessThanOrEqual(navigationBox!.y - 16);

    await page.goto(`${webBase}/demo/knowledge`, { waitUntil: "domcontentloaded" });
    const mobileTitle = page.getByRole("heading", {
      level: 1,
      name: messages.en["knowledge.page.mobileTitle"],
    });
    await expect(mobileTitle).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: messages.en["knowledge.page.title"] }),
    ).not.toBeVisible();
    const titleOverflow = await mobileTitle.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(titleOverflow).toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });
}
