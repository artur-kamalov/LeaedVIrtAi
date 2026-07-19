import { expect, test, type Route } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

function telegramConversation(
  id: string,
  lastMessageAt: string,
  options: { isInternalSample?: boolean } = {},
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
    lastMessage: "Hello",
    unreadCount: 1,
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

test("Telegram first run baselines before opening and finds a real update", async ({ page }) => {
  let inboxRequests = 0;
  let releaseBaseline!: () => void;
  const baselineGate = new Promise<void>((resolve) => {
    releaseBaseline = resolve;
  });
  const originalMessageAt = "2026-07-19T10:00:00.000Z";
  const updatedMessageAt = "2026-07-19T10:01:00.000Z";

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
    if (inboxRequests === 1) {
      await baselineGate;
      await fulfillInbox(route, [telegramConversation("conversation-existing", originalMessageAt)]);
      return;
    }

    await fulfillInbox(route, [
      telegramConversation("conversation-sample", updatedMessageAt, {
        isInternalSample: true,
      }),
      telegramConversation("conversation-existing", updatedMessageAt),
    ]);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/integrations?setup=telegram&firstRun=1&plan=pro`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("telegram-first-reply-flow")).toBeVisible();
  await expect(page.getByTestId("telegram-open-bot-preparing")).toBeDisabled();
  await expect(page.getByTestId("telegram-open-bot")).toHaveCount(0);
  await expect.poll(() => inboxRequests).toBe(1);

  releaseBaseline();

  const openTelegram = page.getByTestId("telegram-open-bot");
  await expect(openTelegram).toHaveAttribute("href", "https://t.me/activation_bot?start=leadvirt");
  await expect(openTelegram).toBeFocused();
  await expect(page.getByTestId("telegram-first-reply-status")).toHaveAttribute(
    "data-status",
    "waiting",
  );

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
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tmp/telegram-first-reply-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
