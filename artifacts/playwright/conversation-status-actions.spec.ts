import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});
const conversationId = "pw-status-conversation";
const leadId = "lead-status";

function lead() {
  return {
    id: leadId,
    tenantId: "tenant-demo",
    name: "Status API Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "IN_PROGRESS",
    temperature: "HOT",
    valueAmount: 24000,
    currency: "RUB",
    interest: "Status action service",
    summary: "Conversation status action smoke",
    assignedToUserId: null,
    assignedToName: "API Manager",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z",
  };
}

function conversation(status: string) {
  return {
    id: conversationId,
    tenantId: "tenant-demo",
    leadId,
    channel: {
      id: "channel-demo",
      tenantId: "tenant-demo",
      type: "TELEGRAM",
      status: "ACTIVE",
      name: "Telegram bot",
      lastHealthAt: null,
    },
    channelType: "TELEGRAM",
    status,
    subject: "Status API dialog",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    aiEnabled: status !== "WAITING_FOR_HUMAN",
    handoffRequested: status === "WAITING_FOR_HUMAN",
    lead: lead(),
    lastMessage: "Нужна консультация по услуге",
    unreadCount: status === "OPEN" ? 1 : 0,
    messages: [
      {
        id: "message-status-1",
        tenantId: "tenant-demo",
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Нужна консультация по услуге",
        status: "RECEIVED",
        createdAt: "2026-06-22T10:00:00.000Z",
      },
    ],
    events: [],
  };
}

test("conversation menu calls handoff and status APIs", async ({ page }) => {
  let currentStatus = "OPEN";
  let handoffCalled = false;
  const patchedStatuses: string[] = [];
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route(`**/api/conversations/${conversationId}/handoff`, async (route) => {
    handoffCalled = true;
    currentStatus = "WAITING_FOR_HUMAN";
    await route.fulfill({ json: { data: conversation(currentStatus) } });
  });

  await page.route(`**/api/conversations/${conversationId}/status`, async (route) => {
    const body = route.request().postDataJSON() as { status?: string };
    currentStatus = body.status ?? currentStatus;
    patchedStatuses.push(currentStatus);
    await route.fulfill({ json: { data: conversation(currentStatus) } });
  });

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: conversation(currentStatus) } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  expect(pageErrors).toEqual([]);
  await expect(page.getByText("Status API Client")).toBeVisible();

  await page.getByRole("button", { name: "Действия с диалогом" }).click();
  await page.getByRole("menuitem", { name: "Передать менеджеру" }).click();
  await expect.poll(() => handoffCalled).toBe(true);
  await expect(page.getByText("Передано менеджеру")).toBeVisible();

  await page.getByRole("button", { name: "Действия с диалогом" }).click();
  await page.getByRole("menuitem", { name: "Закрыть диалог" }).click();
  await expect.poll(() => patchedStatuses).toContain("CLOSED");
  await expect(page.locator("main").getByText("Диалог закрыт")).toBeVisible();

  await page.getByRole("button", { name: "Действия с диалогом" }).click();
  await page.getByRole("menuitem", { name: "Открыть диалог" }).click();
  await expect.poll(() => patchedStatuses).toContain("OPEN");
  await expect(page.getByText("AI ведёт диалог")).toBeVisible();
});

