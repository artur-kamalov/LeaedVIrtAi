import { expect, test, type Route } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

function telegramConversation(
  id: string,
  lastMessageAt: string,
  options: {
    isInternalSample?: boolean;
    lastMessage?: string;
    unreadCount?: number;
    activationWelcomeAt?: string | null;
  } = {},
) {
  return {
    id,
    tenantId: "tenant-activation",
    leadId: `lead-${id}`,
    channelType: "TELEGRAM",
    status: "OPEN",
    subject: "Telegram conversation",
    lastMessageAt,
    aiEnabled: false,
    handoffRequested: false,
    lastMessage: options.lastMessage ?? "Hello",
    unreadCount: options.unreadCount ?? 1,
    activationWelcomeAt: options.activationWelcomeAt ?? null,
    lead: {
      id: `lead-${id}`,
      tenantId: "tenant-activation",
      name: "Telegram customer",
      status: "NEW",
      temperature: "WARM",
      currency: "EUR",
      channelType: "TELEGRAM",
      lastMessageAt,
      createdAt: "2026-07-19T10:00:00.000Z",
    },
    messages: [],
    events: [],
    ...options,
  };
}

async function fulfillInbox(route: Route, data: unknown[]) {
  await route.fulfill({
    json: {
      data,
      pagination: { page: 1, limit: 50, total: data.length, hasMore: false },
    },
  });
}

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "en" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("Telegram first run detects an already-queued welcome and ignores newer unread chats", async ({
  page,
}) => {
  let inboxRequests = 0;
  const activationRequestedAt = "2026-07-19T10:00:30.000Z";
  const updatedMessageAt = "2026-07-19T10:01:00.000Z";
  const newerUnreadMessageAt = "2026-07-19T10:02:00.000Z";
  const activationWelcome =
    "Hello, Telegram customer! LeadVirt AI administrator received your message.";

  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "integration-telegram",
            tenantId: "tenant-activation",
            provider: "TELEGRAM",
            status: "CONNECTED",
            name: "Telegram @activation_bot",
            category: "Channels",
            settings: {
              botId: "123456789",
              botUsername: "activation_bot",
              activationStartParameter: "lv_test_activation_123",
              activationWelcomeRequestedAt: activationRequestedAt,
              tokenConfigured: true,
              webhookConfigured: true,
              managedByLeadVirt: true,
            },
            connectedAt: "2026-07-19T09:00:00.000Z",
            lastSyncAt: "2026-07-19T09:00:00.000Z",
            inboundEndpoint: null,
            recentSyncLogs: [],
            recentWebhookEvents: [],
          },
        ],
      },
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/inbox/conversations**", async (route) => {
    inboxRequests += 1;
    await fulfillInbox(route, [
      telegramConversation("conversation-newer-unread", newerUnreadMessageAt, {
        lastMessage: "A newer unrelated customer message",
        unreadCount: 1,
      }),
      telegramConversation("conversation-sample", updatedMessageAt, {
        isInternalSample: true,
        lastMessage: activationWelcome,
        unreadCount: 0,
        activationWelcomeAt: updatedMessageAt,
      }),
      telegramConversation("conversation-existing", updatedMessageAt, {
        lastMessage: activationWelcome,
        unreadCount: 0,
        activationWelcomeAt: updatedMessageAt,
      }),
    ]);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/integrations?setup=telegram&firstRun=1&plan=pro`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("telegram-first-reply-flow")).toBeVisible();
  await expect(page.getByTestId("telegram-first-reply-flow")).toContainText(
    "Confirm your Telegram connection",
  );
  await expect(page.getByTestId("telegram-first-reply-flow")).toContainText(
    "Slash commands are never sent to AI.",
  );

  const openTelegram = page.getByTestId("telegram-open-bot");
  await expect(openTelegram).toHaveAttribute(
    "href",
    "https://t.me/activation_bot?start=lv_test_activation_123",
  );
  await expect(page.getByTestId("telegram-card-open-bot")).toHaveAttribute(
    "href",
    "https://t.me/activation_bot",
  );
  await expect(openTelegram).toBeFocused();
  await expect.poll(() => inboxRequests).toBeGreaterThan(0);

  const conversationLink = page.getByTestId("telegram-first-reply-open-conversation");
  await expect(conversationLink).toHaveAttribute(
    "href",
    "/app/inbox/conversation-existing?firstRun=1&plan=pro",
    { timeout: 8_000 },
  );
  await expect(page.getByTestId("telegram-first-reply-status")).toHaveAttribute(
    "data-status",
    "found",
  );
  await expect(page.getByTestId("telegram-first-reply-status")).toContainText(
    "automatic customer replies remain off",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tmp/telegram-first-reply-mobile.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tmp/telegram-first-reply-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});
