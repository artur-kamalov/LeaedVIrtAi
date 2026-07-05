import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";
import { readFileSync } from "node:fs";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

const overview = {
  data: {
    leadsOverTime: [
      { name: "Пн", leads: 2, booked: 1 },
      { name: "Вт", leads: 4, booked: 2 },
      { name: "Ср", leads: 4, booked: 1 }
    ],
    leadsByChannel: [
      { channelType: "WEBSITE", leads: 6, conversionRate: 50 },
      { channelType: "TELEGRAM", leads: 4, conversionRate: 25 }
    ],
    conversionByScenario: [
      { scenario: "Playwright сценарий", conversionRate: 42, runs: 11 }
    ],
    responseTime: { averageSeconds: 11, p90Seconds: 29 },
    bookingsOrders: { bookings: 3, orders: 2 },
    estimatedRevenue: 987000,
    bestPerformingChannels: [
      { channelType: "WEBSITE", score: 50 },
      { channelType: "TELEGRAM", score: 25 }
    ],
    aiInsights: ["Playwright insight from analytics API"]
  }
};

const emptyOverview = {
  data: {
    leadsOverTime: [
      { name: "1", leads: 0, booked: 0 },
      { name: "2", leads: 0, booked: 0 },
      { name: "3", leads: 0, booked: 0 },
      { name: "4", leads: 0, booked: 0 },
      { name: "5", leads: 0, booked: 0 },
      { name: "6", leads: 0, booked: 0 },
      { name: "7", leads: 0, booked: 0 }
    ],
    leadsByChannel: [],
    conversionByScenario: [],
    responseTime: { averageSeconds: 0, p90Seconds: 0 },
    bookingsOrders: { bookings: 0, orders: 0 },
    estimatedRevenue: 0,
    bestPerformingChannels: [],
    aiInsights: []
  }
};

test("analytics page keeps response time at zero for empty workspaces", async ({ page }) => {
  await page.route("**/api/analytics/overview*", async (route) => {
    await route.fulfill({ json: emptyOverview });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/analytics`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("analytics-kpi-2-value")).toContainText(/^0/);
});

test("analytics page renders API overview data", async ({ page }) => {
  let requested = false;
  const requestedPeriods: string[] = [];

  await page.route("**/api/analytics/overview*", async (route) => {
    requested = true;
    requestedPeriods.push(new URL(route.request().url()).searchParams.get("period") ?? "");
    await route.fulfill({ json: overview });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/analytics`, { waitUntil: "networkidle" });

  await expect.poll(() => requested).toBe(true);
  await expect.poll(() => requestedPeriods).toContain("30d");
  await expect(page.getByText("Playwright сценарий").first()).toBeVisible();
  await expect(page.getByText("Playwright insight from analytics API")).toBeVisible();
  await expect(page.getByText("987 тыс ₽")).toBeVisible();

  await page.getByRole("button", { name: "7 дней" }).click();
  await expect.poll(() => requestedPeriods).toContain("7d");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Экспорт/ }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^leadvirt-analytics-\d{4}-\d{2}-\d{2}\.csv$/);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = readFileSync(downloadPath!, "utf8");
  expect(csv).toContain("7 дней");
  expect(csv).toContain("Playwright сценарий");
  expect(csv).toContain("Playwright insight from analytics API");
  expect(csv).toContain("987 тыс ₽");
});

