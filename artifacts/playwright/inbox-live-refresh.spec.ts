import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const conversationId = "pw-live-telegram-conversation";
const leadId = "pw-live-telegram-lead";
const nextConversationId = "pw-live-next-conversation";
const nextLeadId = "pw-live-next-lead";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

function lead(lastMessageAt: string) {
  return {
    id: leadId,
    tenantId: "tenant-live-refresh",
    name: "Telegram Live Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "NEW",
    temperature: "WARM",
    valueAmount: null,
    currency: "RUB",
    interest: "Live Telegram inquiry",
    summary: "Waiting for a reply",
    assignedToUserId: null,
    assignedToName: null,
    lastMessageAt,
    createdAt: "2026-07-12T08:10:00.000Z",
  };
}

function message(id: string, text: string, createdAt: string) {
  return {
    id,
    tenantId: "tenant-live-refresh",
    conversationId,
    direction: "INBOUND",
    senderType: "CUSTOMER",
    text,
    status: "RECEIVED",
    attachments: [],
    createdAt,
  };
}

function telegramConversation(includeLaterMessage = false) {
  const initialAt = "2026-07-12T08:11:00.000Z";
  const laterAt = "2026-07-12T08:13:00.000Z";
  const initialText = "Initial Telegram message";
  const laterText = "Later Telegram inbound message";
  const lastMessageAt = includeLaterMessage ? laterAt : initialAt;

  return {
    id: conversationId,
    tenantId: "tenant-live-refresh",
    leadId,
    channel: {
      id: "channel-live-telegram",
      tenantId: "tenant-live-refresh",
      type: "TELEGRAM",
      status: "ACTIVE",
      name: "Telegram bot",
      lastHealthAt: laterAt,
    },
    channelType: "TELEGRAM",
    status: "OPEN",
    subject: "Live Telegram dialog",
    lastMessageAt,
    aiEnabled: true,
    handoffRequested: false,
    lead: lead(lastMessageAt),
    lastMessage: includeLaterMessage ? laterText : initialText,
    unreadCount: includeLaterMessage ? 2 : 1,
    messages: [
      message("pw-live-message-initial", initialText, initialAt),
      ...(includeLaterMessage ? [message("pw-live-message-later", laterText, laterAt)] : []),
    ],
    events: [],
  };
}

function telegramConversationWithManagerMessage(text: string) {
  const conversation = telegramConversation(false);
  return {
    ...conversation,
    lastMessage: text,
    lastMessageAt: "2026-07-12T08:14:00.000Z",
    messages: [
      ...conversation.messages,
      {
        id: "pw-live-message-manager",
        tenantId: "tenant-live-refresh",
        conversationId,
        direction: "OUTBOUND",
        senderType: "USER",
        text,
        status: "SENT",
        attachments: [],
        createdAt: "2026-07-12T08:14:00.000Z",
      },
    ],
  };
}

function nextTelegramConversation() {
  const conversation = telegramConversation(false);
  const initialMessage = conversation.messages[0];
  return {
    ...conversation,
    id: nextConversationId,
    leadId: nextLeadId,
    subject: "Next Telegram dialog",
    lead: {
      ...conversation.lead,
      id: nextLeadId,
      name: "Next Telegram Client",
      interest: "Separate Telegram inquiry",
      summary: "Must not receive state from the previous conversation",
    },
    lastMessage: "Next conversation inbound message",
    messages: [
      {
        ...initialMessage,
        id: "pw-live-next-message",
        conversationId: nextConversationId,
        text: "Next conversation inbound message",
      },
    ],
  };
}

function telegramConversationWithHistory(includeLaterMessage = false) {
  const conversation = telegramConversation(false);
  const history = Array.from({ length: 36 }, (_, index) =>
    message(
      `pw-live-history-${index}`,
      `History message ${index + 1}`,
      `2026-07-12T08:${String(index).padStart(2, "0")}:00.000Z`,
    ),
  );
  const later = message(
    "pw-live-history-later",
    "New message while reading history",
    "2026-07-12T09:00:00.000Z",
  );

  return {
    ...conversation,
    lastMessage: includeLaterMessage ? later.text : history[history.length - 1]?.text,
    lastMessageAt: includeLaterMessage ? later.createdAt : history[history.length - 1]?.createdAt,
    messages: includeLaterMessage ? [...history, later] : history,
  };
}

test("Inbox refreshes Telegram conversations and preserves stale data after a failed poll", async ({
  page,
}) => {
  let state: "empty" | "conversation" | "failure" = "empty";
  let requestCount = 0;
  let failedRequestCount = 0;

  await page.route("**/api/inbox/conversations**", async (route) => {
    requestCount += 1;
    if (state === "failure") {
      failedRequestCount += 1;
      await route.fulfill({
        status: 500,
        json: { error: { code: "HTTP_ERROR", message: "Temporary refresh failure" } },
      });
      return;
    }

    const conversations = state === "conversation" ? [telegramConversation()] : [];
    await route.fulfill({
      json: {
        data: conversations,
        pagination: {
          page: 1,
          limit: 50,
          total: conversations.length,
          hasMore: false,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`);

  await expect.poll(() => requestCount).toBeGreaterThan(0);
  await expect(page.getByText("Telegram Live Client")).toHaveCount(0);

  state = "conversation";
  await expect(page.getByText("Telegram Live Client").first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("Initial Telegram message").first()).toBeVisible();

  state = "failure";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => failedRequestCount, { timeout: 12_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("inbox-refresh-error")).toBeVisible();
  await expect(page.getByText("Telegram Live Client").first()).toBeVisible();
  await expect(page.getByText("Initial Telegram message").first()).toBeVisible();

  const failuresBeforeLocaleChange = failedRequestCount;
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  const nextLocale = (await switcher.getAttribute("data-locale")) === "fr" ? "de" : "fr";
  await switcher.click();
  await page.getByTestId(`language-option-${nextLocale}`).click();
  await expect
    .poll(() => failedRequestCount, { timeout: 12_000 })
    .toBeGreaterThan(failuresBeforeLocaleChange);
  await expect(page.getByText("Telegram Live Client").first()).toBeVisible();
  await expect(page.getByText("Initial Telegram message").first()).toBeVisible();

  state = "conversation";
  await page.getByTestId("inbox-refresh-error").getByRole("button").click();
  await expect(page.getByTestId("inbox-refresh-error")).toBeHidden();
  await expect(page.getByText("Telegram Live Client").first()).toBeVisible();
});

test("open conversation refreshes a later Telegram inbound message without reload", async ({
  page,
}) => {
  let includeLaterMessage = false;
  let requestCount = 0;

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    requestCount += 1;
    await route.fulfill({ json: { data: telegramConversation(includeLaterMessage) } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`);

  await expect(page.getByText("Initial Telegram message").first()).toBeVisible();
  const initialRequestCount = requestCount;
  includeLaterMessage = true;

  await expect(page.getByText("Later Telegram inbound message").first()).toBeVisible({
    timeout: 12_000,
  });
  expect(requestCount).toBeGreaterThan(initialRequestCount);
  await expect(page).toHaveURL(`${webBase}/app/inbox/${conversationId}`);
});

test("a delayed poll cannot overwrite a message sent while it was in flight", async ({ page }) => {
  const sentText = "Manager message survives stale refresh";
  let holdNextPoll = false;
  let pollStarted = false;
  let pollReleased = false;
  let releasePoll!: () => void;
  const pollGate = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });

  await page.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    await route.fulfill({ json: { data: telegramConversationWithManagerMessage(sentText) } });
  });

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    if (holdNextPoll) {
      holdNextPoll = false;
      pollStarted = true;
      await pollGate;
      await route.fulfill({ json: { data: telegramConversation(false) } });
      pollReleased = true;
      return;
    }
    await route.fulfill({ json: { data: telegramConversation(false) } });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}`);
  await expect(page.getByText("Initial Telegram message").first()).toBeVisible();

  holdNextPoll = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => pollStarted).toBe(true);

  await page.locator("textarea").fill(sentText);
  await page.locator("textarea").press("Enter");
  await expect(page.getByText(sentText).first()).toBeVisible();

  releasePoll();
  await expect.poll(() => pollReleased).toBe(true);
  await page.waitForTimeout(250);
  await expect(page.getByText(sentText).first()).toBeVisible();
});

test("a delayed failed send cannot contaminate the next conversation", async ({ page }) => {
  const previousText = "Private reply for the previous conversation";
  const nextDraft = "Draft for the next conversation";
  const previousError = "Previous conversation send failed";
  let sendStarted = false;
  let sendReleased = false;
  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  await page.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    sendStarted = true;
    await sendGate;
    await route.fulfill({
      status: 500,
      json: { error: { code: "HTTP_ERROR", message: previousError } },
    });
    sendReleased = true;
  });
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: telegramConversation(false) } });
  });
  await page.route(`**/api/conversations/${nextConversationId}`, async (route) => {
    await route.fulfill({ json: { data: nextTelegramConversation() } });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}`);
  await expect(page.getByText("Telegram Live Client")).toBeVisible();
  await page.locator("textarea").fill(previousText);
  await page.locator("textarea").press("Enter");
  await expect.poll(() => sendStarted).toBe(true);

  await page.evaluate(
    (path) => window.history.pushState(null, "", path),
    `/app/inbox/${nextConversationId}`,
  );
  await expect(page).toHaveURL(`${webBase}/app/inbox/${nextConversationId}`);
  await expect(page.getByText("Next Telegram Client")).toBeVisible();
  await expect(page.getByText("Next conversation inbound message")).toBeVisible();
  await page.locator("textarea").fill(nextDraft);

  releaseSend();
  await expect.poll(() => sendReleased).toBe(true);
  await page.waitForTimeout(250);

  await expect(page.locator("textarea")).toHaveValue(nextDraft);
  await expect(page.getByText(previousText)).toHaveCount(0);
  await expect(page.getByText(previousError)).toHaveCount(0);
  await expect(page.getByText("Next Telegram Client")).toBeVisible();
});

test("polling preserves scroll position while a manager reads message history", async ({
  page,
}) => {
  let includeLaterMessage = false;
  let requestCount = 0;

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    requestCount += 1;
    await route.fulfill({
      json: { data: telegramConversationWithHistory(includeLaterMessage) },
    });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}`);
  await expect(page.getByText("History message 36").first()).toBeVisible();
  const scroll = page.getByTestId("conversation-messages-scroll");
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });

  const unchangedRequestCount = requestCount;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => requestCount).toBeGreaterThan(unchangedRequestCount);
  await page.waitForTimeout(250);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeLessThan(20);

  includeLaterMessage = true;
  const changedRequestCount = requestCount;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => requestCount).toBeGreaterThan(changedRequestCount);
  await expect(page.getByText("New message while reading history").first()).toBeVisible();
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeLessThan(20);
});
