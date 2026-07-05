import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("inbox shows a real empty state when the API returns zero conversations", async ({ page }) => {
  await page.route("**/api/inbox/conversations**", async (route) => {
    await route.fulfill({
      json: {
        data: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          hasMore: false,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByText("Диалогов пока нет")).toBeVisible();
  await expect(page.getByText("Когда клиенты напишут в подключённые каналы")).toBeVisible();
  await expect(page.getByText("Нет выбранного диалога")).toBeVisible();
  await expect(page.getByText("Анна Соколова")).toHaveCount(0);
});

