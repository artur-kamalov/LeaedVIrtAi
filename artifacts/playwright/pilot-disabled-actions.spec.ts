import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("pilot-disabled conversation toolbar actions show feedback", async ({ page }) => {
  await page.route("**/api/conversations/pilot-action-audit", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "pilot-action-audit",
          tenantId: "tenant-audit",
          leadId: "lead-audit",
          channel: {
            id: "channel-audit",
            tenantId: "tenant-audit",
            type: "WEBSITE",
            status: "ACTIVE",
            name: "Website",
            lastHealthAt: null,
          },
          channelType: "WEBSITE",
          status: "OPEN",
          subject: "Pilot action audit",
          lastMessageAt: "2026-07-09T10:00:00.000Z",
          aiEnabled: true,
          handoffRequested: false,
          lead: {
            id: "lead-audit",
            tenantId: "tenant-audit",
            name: "Pilot Action",
            phone: null,
            email: null,
            companyName: null,
            source: "Website",
            channelType: "WEBSITE",
            status: "IN_PROGRESS",
            temperature: "WARM",
            valueAmount: 0,
            currency: "RUB",
            interest: "Pilot audit",
            summary: "Pilot audit",
            assignedToUserId: null,
            assignedToName: null,
            lastMessageAt: "2026-07-09T10:00:00.000Z",
            createdAt: "2026-07-09T10:00:00.000Z",
          },
          lastMessage: "Hello",
          unreadCount: 0,
          messages: [
            {
              id: "message-audit",
              tenantId: "tenant-audit",
              conversationId: "pilot-action-audit",
              direction: "INBOUND",
              senderType: "CUSTOMER",
              text: "Hello",
              status: "RECEIVED",
              createdAt: "2026-07-09T10:00:00.000Z",
            },
          ],
          events: [],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/pilot-action-audit`, { waitUntil: "networkidle" });

  await page.getByTestId("conversation-attach-file").click();
  await expect(page.getByText("Файлы будут доступны после пилота")).toBeVisible();

  await page.getByTestId("conversation-emoji").click();
  await expect(page.getByText("Эмодзи-панель будет доступна после пилота")).toBeVisible();
});

test("pilot-disabled settings logo upload shows feedback", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.getByTestId("settings-logo-upload").click();
  await expect(page.getByText("Загрузка логотипа будет доступна после пилота")).toBeVisible();
});
