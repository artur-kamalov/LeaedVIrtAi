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

const telegramOidcToken = "mock-telegram-id-token";
const telegramLoginSdkMock = `
  window.Telegram = window.Telegram || {};
  window.Telegram.Login = {
    auth(options, callback) {
      window.leadvirtTelegramSdkCalls = window.leadvirtTelegramSdkCalls || [];
      window.leadvirtTelegramSdkCalls.push({ options });
      const result = window.leadvirtTelegramNextResult || {
        id_token: "${telegramOidcToken}",
        user: { id: 100000001, name: "Local Telegram", preferred_username: "leadvirt_local" }
      };
      window.setTimeout(() => callback(result), 0);
    },
    close() {
      window.leadvirtTelegramClosed = true;
    }
  };
`;

async function completeTelegramAuth(page: Page) {
  const authButton = page.getByTestId("telegram-auth-button");
  await expect(authButton).toBeEnabled({ timeout: 15000 });
  await authButton.click();
}

test.describe("telegram auth flow", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/telegram", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.route("https://telegram.org/js/telegram-login.js", async (route) => {
      await route.fulfill({ contentType: "application/javascript", body: telegramLoginSdkMock });
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
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15000 });
    const sdkCalls = await page.evaluate(() => (window as Window & { leadvirtTelegramSdkCalls?: Array<{ options: { client_id: number; scope: string[]; lang?: string; nonce?: string } }> }).leadvirtTelegramSdkCalls ?? []);
    expect(sdkCalls[0]?.options.client_id).toBe(123456);
    expect(sdkCalls[0]?.options.scope).toEqual(["profile", "write"]);
    expect(sdkCalls[0]?.options.lang).toBe("ru");
    expect(sdkCalls[0]?.options.nonce).toBeTruthy();
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "");
    }).toContain("telegram");
  });

  test("switch account clears local session and logs in through Telegram Login SDK", async ({ page }) => {
    let logoutRequests = 0;
    let oidcRequests = 0;
    await page.route("**/api/auth/logout", async (route) => {
      logoutRequests += 1;
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      oidcRequests += 1;
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.localStorage.setItem("leadvirt.auth.session", "cached"));
    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    const switchAccountButton = page.getByTestId("telegram-switch-account");
    if ((await switchAccountButton.count()) === 0) {
      await expect(page.getByText("Telegram Login client id")).toBeVisible();
      return;
    }

    await switchAccountButton.click();

    const sdkCalls = await page.evaluate(() => (window as Window & { leadvirtTelegramSdkCalls?: Array<{ options: { client_id: number; scope: string[]; lang?: string; nonce?: string } }> }).leadvirtTelegramSdkCalls ?? []);
    expect(sdkCalls).toHaveLength(1);
    expect(sdkCalls[0]?.options.client_id).toBe(123456);
    expect(sdkCalls[0]?.options.scope).toEqual(["profile", "write"]);
    expect(sdkCalls[0]?.options.lang).toBe("ru");
    expect(sdkCalls[0]?.options.nonce).toBeTruthy();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15000 });
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "")).toContain("telegram");
    expect(logoutRequests).toBe(1);
    expect(oidcRequests).toBe(1);
  });

  test("switch account reports Telegram SDK popup close", async ({ page }) => {
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.addInitScript(() => {
      (window as Window & { leadvirtTelegramNextResult?: { error: string } }).leadvirtTelegramNextResult = { error: "popup_closed" };
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    const switchAccountButton = page.getByTestId("telegram-switch-account");
    if ((await switchAccountButton.count()) === 0) {
      await expect(page.getByText("Telegram Login client id")).toBeVisible();
      return;
    }

    await switchAccountButton.click();

    await expect(page).toHaveURL(`${webBase}/login`);
    await expect(page.getByText("Telegram закрыл окно без результата")).toBeVisible();
  });

  test("signup through Telegram opens onboarding", async ({ page }) => {
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
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
