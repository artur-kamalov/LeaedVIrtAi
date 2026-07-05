import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const publicWebBase = normalizeBase(process.env.LEADVIRT_PUBLIC_WEB_BASE);
const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE);

const telegramKey = process.env.LEADVIRT_PUBLIC_TELEGRAM_KEY ?? "demo-telegram-webhook";
const telegramSecret = process.env.LEADVIRT_PUBLIC_TELEGRAM_SECRET ?? "demo-telegram-secret";
const webhookKey = process.env.LEADVIRT_PUBLIC_WEBHOOK_KEY ?? "demo-generic-webhook";
const webhookSecret = process.env.LEADVIRT_PUBLIC_WEBHOOK_SECRET ?? "demo-webhook-secret";
const widgetKey = process.env.LEADVIRT_PUBLIC_WIDGET_KEY ?? "demo-website-widget";
const selectedChannels = selectedPublicChannels();

type PublicChannel = "telegram" | "webhook" | "widget";

function normalizeBase(value?: string) {
  const cleaned = value?.trim().replace(/\/$/, "");
  return cleaned ? cleaned : "";
}

function normalizeApiBase(value?: string) {
  const cleaned = normalizeBase(value);
  if (!cleaned) return "";
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function healthUrl() {
  return publicApiBase.replace(/\/api$/, "/health");
}

function uniqueId() {
  return `${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function selectedPublicChannels() {
  const raw = process.env.LEADVIRT_PUBLIC_CHANNELS?.trim();
  const values = raw ? raw.split(",") : ["telegram", "webhook", "widget"];
  return new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is PublicChannel => value === "telegram" || value === "webhook" || value === "widget")
  );
}

function channelEnabled(channel: PublicChannel) {
  return selectedChannels.has(channel);
}

async function expectPublicRoute(page: Page, path: string) {
  const response = await page.goto(`${publicWebBase}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  expect(response?.ok(), `${path} should load through public web URL`).toBe(true);
  await expect(page.locator("body")).toBeVisible();
  await expect.poll(async () => (await page.locator("body").innerText()).trim().length).toBeGreaterThan(20);
}

async function expectIntakeAccepted(
  request: APIRequestContext,
  url: string,
  payload: unknown,
  headers?: Record<string, string>
) {
  const response = await request.post(url, {
    ...(headers ? { headers } : {}),
    data: payload,
    timeout: 20_000,
  });
  expect(response.ok(), `${url} should accept public intake`).toBe(true);
  const body = (await response.json()) as { data?: { conversationId?: string; leadId?: string | null } };
  expect(body.data?.conversationId).toBeTruthy();
  expect(body.data?.leadId).toBeTruthy();
}

test.describe("public URL pilot preflight", () => {
  test.skip(
    !publicWebBase || !publicApiBase,
    "Set LEADVIRT_PUBLIC_WEB_BASE and LEADVIRT_PUBLIC_API_BASE to run public/tunnel pilot preflight."
  );

  test("public web routes load", async ({ page }) => {
    await expectPublicRoute(page, "/");
    await expectPublicRoute(page, "/demo");
    if (channelEnabled("widget")) {
      await expectPublicRoute(page, "/widget/demo");
    }
  });

  test("public API health and selected widget config are reachable", async ({ request }) => {
    const health = await request.get(healthUrl(), { timeout: 10_000 });
    expect(health.ok(), `${healthUrl()} should be healthy`).toBe(true);

    if (!channelEnabled("widget")) return;

    const widgetConfig = await request.get(`${publicApiBase}/public/widget/${widgetKey}/config`, { timeout: 10_000 });
    expect(widgetConfig.ok()).toBe(true);
    const body = (await widgetConfig.json()) as { data?: { publicKey?: string } };
    expect(body.data?.publicKey).toBe(widgetKey);
  });

  test("public intake endpoints accept Telegram, Webhook/API, and Widget traffic", async ({ request }) => {
    test.skip(selectedChannels.size === 0, "No public intake channels selected.");

    const id = uniqueId();

    if (channelEnabled("telegram")) {
      await expectIntakeAccepted(
        request,
        `${publicApiBase}/public/channels/telegram/${telegramKey}/webhook`,
        {
          update_id: `pilot-public-tg-${id}`,
          message: {
            message_id: `pilot-public-tg-message-${id}`,
            date: Math.floor(Date.now() / 1000),
            chat: { id: `pilot-public-tg-chat-${id}`, type: "private" },
            from: {
              id: `pilot-public-tg-customer-${id}`,
              first_name: "Pilot TG",
              last_name: `Public ${id}`,
              username: `pilot_public_tg_${id.replace(/\W/g, "_")}`,
            },
            text: `Pilot public Telegram intake ${id}`,
          },
        },
        { "x-telegram-bot-api-secret-token": telegramSecret }
      );
    }

    if (channelEnabled("webhook")) {
      await expectIntakeAccepted(
        request,
        `${publicApiBase}/public/channels/webhook/${webhookKey}/events`,
        {
          eventId: `pilot-public-webhook-${id}`,
          source: "Pilot public social landing webhook",
          conversationId: `pilot-public-webhook-conversation-${id}`,
          message: {
            id: `pilot-public-webhook-message-${id}`,
            text: `Pilot public webhook intake ${id}`,
            timestamp: new Date().toISOString(),
          },
          customer: {
            id: `pilot-public-webhook-customer-${id}`,
            name: `Pilot Webhook Public ${id}`,
            phone: "+79990000000",
          },
        },
        { "x-leadvirt-webhook-secret": webhookSecret }
      );
    }

    if (channelEnabled("widget")) {
      await expectIntakeAccepted(request, `${publicApiBase}/public/widget/${widgetKey}/messages`, {
        sessionId: `pilot-public-widget-session-${id}`,
        clientMessageId: `pilot-public-widget-message-${id}`,
        text: `Pilot public widget intake ${id}`,
        customer: {
          name: `Pilot Widget Public ${id}`,
          phone: "+79991111111",
        },
        pageUrl: `${publicWebBase}/widget/demo`,
        referrer: publicWebBase,
      });
    }
  });
});
