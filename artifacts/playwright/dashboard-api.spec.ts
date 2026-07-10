import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await loginAsCleanUser(page, apiBase);
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

  await expect(page.getByText("Новые лиды")).toBeVisible();
  await expect(page.getByText("+40%")).toBeVisible();
  await expect(page.getByText("-35%")).toBeVisible();
  await expect(page.getByText("+4 п.п.")).toBeVisible();
  await expect(page.getByText("24 сек")).toBeVisible();
});

