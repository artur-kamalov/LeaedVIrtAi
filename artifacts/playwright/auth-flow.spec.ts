import { expect, type Page, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const authResponse = {
  data: {
    id: "user-demo",
    tenantId: "tenant-demo",
    email: "telegram-100000001@telegram.leadvirt.internal",
    phone: null,
    name: "Студия Glow",
    avatarUrl: null,
    role: "OWNER",
    authMode: "telegram",
    passwordChangeRequired: false,
    expiresAt: "2026-07-27T00:00:00.000Z"
  }
};

const currentTenantResponse = {
  data: {
    id: "tenant-demo",
    name: "API Studio",
    slug: "api-studio",
    status: "TRIALING",
    businessType: "education",
    timezone: "Europe/Moscow",
    role: "OWNER"
  }
};

const apiMockHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "content-type": "application/json"
};

const telegramPayload = {
  id: 100000001,
  first_name: "Local",
  last_name: "Telegram",
  username: "leadvirt_local",
  auth_date: Math.floor(Date.now() / 1000),
  hash: "local-playwright-mock"
};

async function completeTelegramAuth(page: Page) {
  const authButton = page.getByTestId("telegram-auth-button");
  const isFallbackButton = await authButton.evaluate((element) => element.tagName === "BUTTON");
  if (isFallbackButton) {
    await authButton.click();
    return;
  }

  await expect
    .poll(async () =>
      page.evaluate(() => typeof (window as Window & { leadvirtTelegramAuth?: unknown }).leadvirtTelegramAuth)
    )
    .toBe("function");

  await page.evaluate((payload) => {
    (window as Window & { leadvirtTelegramAuth?: (value: typeof payload) => void }).leadvirtTelegramAuth?.(payload);
  }, telegramPayload);
}

test.describe("telegram auth flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/telegram", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.route("**/api/auth/telegram/config", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: { data: { botId: "123456" } } });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.route("**/api/current-tenant", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: currentTenantResponse });
    });
  });

  test("login through Telegram opens the app", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15000 });
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "");
    }).toContain("telegram");
  });

  test("switch account clears local session and keeps Telegram logout open", async ({ page }) => {
    let logoutRequests = 0;
    await page.route("**/api/auth/logout", async (route) => {
      logoutRequests += 1;
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.addInitScript(() => {
      window.open = ((url?: string | URL) => {
        const state = window as Window & {
          leadvirtTelegramLogoutUrl?: string;
          leadvirtTelegramPopupClosed?: boolean;
        };
        state.leadvirtTelegramLogoutUrl = String(url ?? "");
        state.leadvirtTelegramPopupClosed = false;
        return {
          close: () => {
            state.leadvirtTelegramPopupClosed = true;
          },
          focus: () => undefined
        } as Window;
      }) as typeof window.open;
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.localStorage.setItem("leadvirt.auth.session", "cached"));
    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    const switchAccountButton = page.getByTestId("telegram-switch-account");
    if ((await switchAccountButton.count()) === 0) {
      await expect(page.getByText("Telegram bot username")).toBeVisible();
      return;
    }

    await switchAccountButton.click();

    await expect
      .poll(() => page.evaluate(() => (window as Window & { leadvirtTelegramLogoutUrl?: string }).leadvirtTelegramLogoutUrl ?? ""))
      .toContain("https://oauth.telegram.org/auth/logout");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
    expect(logoutRequests).toBe(1);
    await page.waitForTimeout(2100);
    await expect
      .poll(() => page.evaluate(() => (window as Window & { leadvirtTelegramPopupClosed?: boolean }).leadvirtTelegramPopupClosed))
      .toBe(false);
  });

  test("signup through Telegram opens onboarding", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webBase}/signup`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/onboarding`, { timeout: 15000 });
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "");
    }).toContain("telegram");
  });
});
