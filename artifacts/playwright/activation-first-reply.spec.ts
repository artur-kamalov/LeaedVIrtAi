import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const conversationId = "activation-first-reply";

function conversation(replyStatus?: "QUEUED" | "SENT") {
  const messages = [
    {
      id: "activation-inbound",
      tenantId: "activation-tenant",
      conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: "Hello, are you open today?",
      status: "RECEIVED",
      createdAt: "2026-07-19T10:00:00.000Z",
    },
  ];
  if (replyStatus) {
    messages.push({
      id: "activation-reply",
      tenantId: "activation-tenant",
      conversationId,
      direction: "OUTBOUND",
      senderType: "USER",
      text: "Yes, we are open until 6 PM.",
      status: replyStatus,
      createdAt: "2026-07-19T10:01:00.000Z",
    });
  }

  return {
    id: conversationId,
    tenantId: "activation-tenant",
    leadId: "activation-lead",
    channel: {
      id: "activation-telegram",
      tenantId: "activation-tenant",
      type: "TELEGRAM",
      status: "ACTIVE",
      name: "Telegram bot",
      automaticRepliesEnabled: false,
    },
    channelType: "TELEGRAM",
    status: "OPEN",
    subject: "First customer",
    lastMessageAt: "2026-07-19T10:01:00.000Z",
    aiEnabled: false,
    handoffRequested: false,
    isInternalSample: false,
    lead: {
      id: "activation-lead",
      tenantId: "activation-tenant",
      name: "First customer",
      source: "Telegram bot",
      channelType: "TELEGRAM",
      status: "NEW",
      temperature: "WARM",
      currency: "RUB",
      interest: "Opening hours",
      createdAt: "2026-07-19T10:00:00.000Z",
    },
    lastMessage: messages.at(-1)?.text,
    unreadCount: 1,
    messages,
    events: [],
  };
}

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "en" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("first reply completes only after provider acceptance", async ({ page }) => {
  let providerAccepted = false;
  let replyQueued = false;
  let submittedText = "";

  await page.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    submittedText = body.text ?? "";
    replyQueued = true;
    await route.fulfill({ json: { data: conversation("QUEUED") } });
  });
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({
      json: {
        data: conversation(replyQueued ? (providerAccepted ? "SENT" : "QUEUED") : undefined),
      },
    });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}?firstRun=1&plan=pro`, {
    waitUntil: "networkidle",
  });

  await expect(page.getByTestId("conversation-first-reply-pending")).toBeVisible();
  await page.getByTestId("conversation-composer").fill("Yes, we are open until 6 PM.");
  await page.getByTestId("conversation-send").click();

  await expect.poll(() => submittedText).toBe("Yes, we are open until 6 PM.");
  await expect(page.getByTestId("conversation-message-status-activation-reply")).toHaveText(
    "Queued",
  );
  await expect(page.getByTestId("conversation-first-reply-complete")).toHaveCount(0);

  providerAccepted = true;
  await expect(page.getByTestId("conversation-first-reply-complete")).toBeVisible({
    timeout: 7_000,
  });
  await expect(page.getByTestId("conversation-message-status-activation-reply")).toHaveText("Sent");
  await expect(page.getByText("Message queued for delivery.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue AI setup" })).toHaveAttribute(
    "href",
    "/app/knowledge?welcome=1",
  );
  await expect(page.getByRole("link", { name: "Choose a plan" })).toHaveAttribute(
    "href",
    "/app/billing?plan=pro",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tmp/conversation-first-reply-complete.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("conversation-first-reply-complete").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("conversation-first-reply-complete")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tmp/conversation-first-reply-complete-mobile.png",
    animations: "disabled",
  });
});
