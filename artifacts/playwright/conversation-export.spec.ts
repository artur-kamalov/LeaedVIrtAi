import { readFile } from "node:fs/promises";
import { loginAsCleanUser } from "./helpers/auth";
import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});
const conversationId = "pw-export-conversation";

const exportConversation = {
  id: conversationId,
  tenantId: "tenant-demo",
  leadId: "lead-export",
  channel: {
    id: "channel-demo",
    tenantId: "tenant-demo",
    type: "TELEGRAM",
    status: "ACTIVE",
    name: "Telegram bot",
    lastHealthAt: null,
  },
  channelType: "TELEGRAM",
  status: "OPEN",
  subject: "Export dialog",
  lastMessageAt: "2026-06-22T10:02:00.000Z",
  aiEnabled: true,
  handoffRequested: false,
  lead: {
    id: "lead-export",
    tenantId: "tenant-demo",
    name: "Export Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "IN_PROGRESS",
    temperature: "WARM",
    valueAmount: 12000,
    currency: "RUB",
    interest: "Pricing details",
    summary: "Export transcript smoke",
    assignedToUserId: null,
    assignedToName: "Manager Demo",
    lastMessageAt: "2026-06-22T10:02:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z",
  },
  lastMessage: "I will send details",
  unreadCount: 1,
  messages: [
    {
      id: "message-export-1",
      tenantId: "tenant-demo",
      conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: "Need pricing details",
      status: "RECEIVED",
      createdAt: "2026-06-22T10:00:00.000Z",
    },
    {
      id: "message-export-2",
      tenantId: "tenant-demo",
      conversationId,
      direction: "OUTBOUND",
      senderType: "AI",
      text: "Sure, I can help",
      status: "SENT",
      createdAt: "2026-06-22T10:01:00.000Z",
    },
    {
      id: "message-export-3",
      tenantId: "tenant-demo",
      conversationId,
      direction: "OUTBOUND",
      senderType: "USER",
      text: "I will send details",
      status: "SENT",
      createdAt: "2026-06-22T10:02:00.000Z",
    },
  ],
  events: [],
};

test("conversation menu exports the visible transcript as a text file", async ({ page }) => {
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: exportConversation } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  await expect(page.getByText("Export Client")).toBeVisible();
  await page.getByRole("button", { name: "Действия с диалогом" }).click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Экспорт переписки" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^leadvirt-export-client-pw-export-conversation\.txt$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const content = await readFile(downloadPath!, "utf8");
  expect(content).toContain("Conversation ID: pw-export-conversation");
  expect(content).toContain("Lead: Export Client");
  expect(content).toContain("Service: Pricing details");
  expect(content).toContain("Клиент: Need pricing details");
  expect(content).toContain("AI: Sure, I can help");
  expect(content).toContain("Менеджер: I will send details");
});

