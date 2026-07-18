import { expect, test, type Page } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function selectLocale(page: Page, locale: string) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
}

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});

test("dashboard renders API metric deltas", async ({ page }) => {
  await page.route("**/api/dashboard/summary", async (route) => {
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 14,
            aiConversationsCount: 22,
            bookingsOrdersCreated: 6,
            leadsSentToCrm: 5,
            averageResponseTimeSeconds: 24,
            conversionRate: 42,
            deltas: {
              newLeadsPercent: 40,
              aiConversationsPercent: 10,
              bookingsOrdersPercent: 100,
              leadsSentToCrmPercent: 25,
              averageResponseTimePercent: -35,
              conversionRatePoints: 4,
            },
          },
          recentActivity: [
            {
              id: "activity-1",
              action: "lead.sent_to_crm",
              title: "Лид отправлен в CRM",
              createdAt: "2026-06-22T10:00:00.000Z",
            },
          ],
          channelPerformance: [
            {
              channelType: "WEBSITE",
              name: "Website",
              leads: 14,
              conversations: 22,
              conversionRate: 42,
              valueAmount: 120000,
            },
          ],
          trend: [
            { name: "Пн", leads: 2, booked: 1 },
            { name: "Вт", leads: 4, booked: 2 },
            { name: "Ср", leads: 3, booked: 1 },
            { name: "Чт", leads: 5, booked: 2 },
          ],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await expect(page.getByText("Новые лиды")).toBeVisible();
  await expect(page.getByText("+40%")).toBeVisible();
  await expect(page.getByText("-35%")).toBeVisible();
  await expect(page.getByText("+4 п.п.")).toBeVisible();
  await expect(page.getByText("24 сек")).toBeVisible();
});

test("dashboard API returns locale-neutral activity and weekday identifiers", async ({ page }) => {
  const response = await page.request.get(`${apiBase}/dashboard/summary`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    data: {
      recentActivity: Array<{ action: string; title?: string }>;
      trend: Array<{ weekday?: number; name?: string }>;
    };
  };

  expect(payload.data.trend).toHaveLength(7);
  expect(payload.data.trend.map((item) => item.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(payload.data.trend.every((item) => item.name === undefined)).toBeTruthy();
  expect(payload.data.recentActivity.every((item) => item.title === undefined)).toBeTruthy();
});

test("dashboard localizes known activity codes before using a legacy title", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.route("**/api/dashboard/summary", async (route) => {
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
            deltas: {
              newLeadsPercent: 100,
              aiConversationsPercent: 100,
              bookingsOrdersPercent: 100,
              leadsSentToCrmPercent: 100,
              averageResponseTimePercent: 100,
              conversionRatePoints: 100,
            },
          },
          recentLeads: [],
          recentActivity: [
            {
              id: "legacy-activity",
              action: "lead.sent_to_crm",
              title: "Лид отправлен в CRM",
              createdAt: "2026-06-22T10:00:00.000Z",
            },
          ],
          channelPerformance: [],
          trend: [],
        },
      },
    });
  });

  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await selectLocale(page, "en");

  await expect(page.getByText("Lead sent to CRM").first()).toBeVisible();
  await expect(page.getByTestId("dashboard-trend-empty")).toBeVisible();
  await expect(page.getByText("0%", { exact: true })).toHaveCount(1);
  await expect(page.getByText("+100%")).toHaveCount(0);
  await expect(page.getByText("+100 pp")).toHaveCount(0);
  await expect(page.getByText("Лид отправлен в CRM")).toHaveCount(0);
});

test("dashboard shows a retryable error instead of fabricated zero metrics", async ({ page }) => {
  let requests = 0;
  let recover = false;
  await page.route("**/api/dashboard/summary", async (route) => {
    requests += 1;
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 14,
            aiConversationsCount: 0,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentLeads: [],
          recentActivity: [],
          channelPerformance: [],
          trend: [],
        },
      },
    });
  });

  await page.goto(`${webBase}/app`);

  const error = page.getByTestId("dashboard-load-error");
  await expect(error).toBeVisible();
  await expect(page.getByText("14", { exact: true })).toHaveCount(0);
  recover = true;
  await error.getByRole("button").click();
  await expect(error).toBeHidden();
  await expect(page.getByText("14", { exact: true })).toBeVisible();
  expect(requests).toBeGreaterThanOrEqual(2);
});
