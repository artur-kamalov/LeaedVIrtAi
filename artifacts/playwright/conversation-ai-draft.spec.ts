import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});
const conversationId = "pw-ai-draft-conversation";
const leadId = "lead-ai-draft";
const draftText = "AI предлагает уточнить удобное время и контакт для записи.";

function lead() {
  return {
    id: leadId,
    tenantId: "tenant-demo",
    name: "AI Draft Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "IN_PROGRESS",
    temperature: "WARM",
    valueAmount: 18000,
    currency: "RUB",
    interest: "AI draft service",
    summary: "Conversation AI draft smoke",
    assignedToUserId: null,
    assignedToName: "API Manager",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z",
  };
}

function conversation(messages = [customerMessage()]) {
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
    status: "OPEN",
    subject: "AI draft dialog",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    aiEnabled: true,
    handoffRequested: false,
    lead: lead(),
    lastMessage: messages.at(-1)?.text ?? null,
    unreadCount: 1,
    messages,
    events: [],
  };
}

function customerMessage() {
  return {
    id: "message-ai-draft-1",
    tenantId: "tenant-demo",
    conversationId,
    direction: "INBOUND",
    senderType: "CUSTOMER",
    text: "Хочу записаться на консультацию завтра",
    status: "RECEIVED",
    createdAt: "2026-06-22T10:00:00.000Z",
  };
}

test("conversation menu drafts an AI reply into the composer", async ({ page }) => {
  let draftCalled = false;
  let sentText = "";

  await page.route(`**/api/conversations/${conversationId}/ai/reply`, async (route) => {
    draftCalled = true;
    await route.fulfill({
      json: {
        data: {
          reply: draftText,
          intent: "booking_request",
          leadFields: { interest: "booking" },
          nextAction: {
            type: "ask_qualifying_question",
            reason: "Нужно уточнить время",
          },
          confidence: 0.91,
          handoffRequired: false,
        },
      },
    });
  });

  await page.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    sentText = body.text ?? "";
    await route.fulfill({
      json: {
        data: conversation([
          customerMessage(),
          {
            id: "message-ai-draft-2",
            tenantId: "tenant-demo",
            conversationId,
            direction: "OUTBOUND",
            senderType: "USER",
            text: sentText,
            status: "SENT",
            createdAt: "2026-06-22T10:01:00.000Z",
          },
        ]),
      },
    });
  });

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: conversation() } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  await expect(page.getByText("AI Draft Client")).toBeVisible();
  await page.getByRole("button", { name: "Действия с диалогом" }).click();
  await page.getByRole("menuitem", { name: "AI-подсказка" }).click();

  await expect.poll(() => draftCalled).toBe(true);
  await expect(page.getByPlaceholder("Написать сообщение...")).toHaveValue(draftText);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect.poll(() => sentText).toBe(draftText);
  await expect(page.getByText(draftText)).toBeVisible();
});

