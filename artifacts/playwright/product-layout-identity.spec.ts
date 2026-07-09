import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.setTimeout(60_000);

async function mockProductIdentity(page: Page) {
  const calls = { authMe: 0, currentTenant: 0 };

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    calls.authMe += 1;
    await route.fulfill({
      json: {
        data: {
          id: "user-owner",
          email: "owner@clinic.test",
          name: "Owner Demo",
          tenantId: "tenant-clinic",
          role: "OWNER",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });

  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    calls.currentTenant += 1;
    await route.fulfill({
      json: {
        data: {
          id: "tenant-clinic",
          name: "LeadVirt Clinic",
          slug: "leadvirt-clinic",
          status: "TRIALING",
          businessType: "clinic",
          timezone: "Europe/Paris",
          role: "OWNER",
        },
      },
    });
  });

  return calls;
}

async function mockDashboardSummary(
  page: Page,
  recentActivity: Array<{ id: string; action: string; title: string; createdAt: string }> = []
) {
  await page.route(/\/api\/dashboard\/summary(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 0,
            aiConversationsCount: 0,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentActivity,
          channelPerformance: [],
          trend: [],
        },
      },
    });
  });
}

async function mockInboxConversations(page: Page) {
  await page.route(/\/api\/inbox\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-search",
            tenantId: "tenant-clinic",
            leadId: "lead-api-search",
            channel: { id: "channel-website", tenantId: "tenant-clinic", type: "WEBSITE", status: "ACTIVE", name: "Website" },
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API Lead conversation",
            lastMessageAt: "2026-06-27T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-api-search",
              tenantId: "tenant-clinic",
              name: "API Lead",
              phone: "+79990000000",
              email: "lead@example.com",
              companyName: null,
              source: "Website widget",
              channelType: "WEBSITE",
              status: "NEW",
              temperature: "WARM",
              valueAmount: 12000,
              currency: "RUB",
              interest: "Consultation",
              summary: "Needs a consultation",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-27T10:00:00.000Z",
              createdAt: "2026-06-27T09:00:00.000Z",
            },
            lastMessage: "Please contact me",
            unreadCount: 1,
            messages: [],
            events: [],
          },
          {
            id: "conversation-other",
            tenantId: "tenant-clinic",
            leadId: "lead-other",
            channel: { id: "channel-telegram", tenantId: "tenant-clinic", type: "TELEGRAM", status: "ACTIVE", name: "Telegram" },
            channelType: "TELEGRAM",
            status: "OPEN",
            subject: "Other Customer conversation",
            lastMessageAt: "2026-06-27T09:30:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-other",
              tenantId: "tenant-clinic",
              name: "Other Customer",
              phone: "+79990000001",
              email: "other@example.com",
              companyName: null,
              source: "Telegram bot",
              channelType: "TELEGRAM",
              status: "NEW",
              temperature: "COLD",
              valueAmount: 0,
              currency: "RUB",
              interest: "Different request",
              summary: "Unrelated message",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-27T09:30:00.000Z",
              createdAt: "2026-06-27T09:00:00.000Z",
            },
            lastMessage: "Different request",
            unreadCount: 0,
            messages: [],
            events: [],
          },
        ],
        pagination: { page: 1, limit: 50, total: 2, hasMore: false },
      },
    });
  });
}

test("product shell renders tenant and user identity from API", async ({ page }) => {
  const calls = await mockProductIdentity(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect.poll(() => calls.authMe).toBeGreaterThan(0);
  await expect.poll(() => calls.currentTenant).toBeGreaterThan(0);
  await expect(page.getByText("LeadVirt Clinic").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("owner@clinic.test")).toBeVisible({ timeout: 10_000 });
});

test("product shell notifications render dashboard activity data", async ({ page }) => {
  await mockProductIdentity(page);
  await mockDashboardSummary(page, [
    {
      id: "activity-api-notification",
      action: "lead.sent_to_crm",
      title: "API dashboard notification",
      createdAt: "2026-06-27T10:00:00.000Z",
    },
  ]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: /LeadVirt Clinic/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("API dashboard notification")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Уведомления" }).click();

  await expect(page.getByText("1 новое")).toBeVisible();
  await expect(page.getByRole("menu").getByText("API dashboard notification")).toBeVisible();
  await page.getByRole("menu").getByText("API dashboard notification").click();
  await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 15_000 });
  await expect(page.getByText("2 новых")).toHaveCount(0);
});

test("product shell global search opens Inbox with a prefilled query", async ({ page }) => {
  await mockProductIdentity(page);
  await mockDashboardSummary(page);
  await mockInboxConversations(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await page.getByLabel("Глобальный поиск").fill("API Lead");
  await page.getByLabel("Глобальный поиск").press("Enter");

  await expect(page).toHaveURL(/\/app\/inbox\?q=API(?:%20|\+)Lead$/, { timeout: 15_000 });
  await expect(page.getByLabel("Поиск в диалогах")).toHaveValue("API Lead");
  await expect(page.getByText("API Lead").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Other Customer")).toHaveCount(0);
});

test("product shell logout calls auth API and clears local session", async ({ page }) => {
  let logoutCalled = false;
  await mockProductIdentity(page);
  await page.route(/\/api\/auth\/logout(?:\?.*)?$/, async (route) => {
    logoutCalled = true;
    await route.fulfill({ json: { data: { loggedOut: true } } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("leadvirt.auth.session", JSON.stringify({ tenantId: "tenant-clinic" }));
    window.localStorage.setItem("leadvirt.demo.session", JSON.stringify({ tenantId: "demo" }));
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /LeadVirt Clinic/ }).click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();

  await expect.poll(() => logoutCalled).toBe(true);
  await expect(page).toHaveURL(`${webBase}/login`, { timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session"))).toBeNull();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.demo.session"))).toBeNull();
});
