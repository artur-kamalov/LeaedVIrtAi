import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

function websiteChannel(title = "LeadVirt.ai") {
  return {
    id: "channel-website",
    tenantId: "tenant-demo",
    type: "WEBSITE",
    status: "ACTIVE",
    name: "Виджет сайта",
    publicKey: "demo-website-widget",
    settings: {
      widget: {
        title,
        subtitle: "AI-администратор",
        businessName: "Демо-компания",
        welcomeMessage: "Здравствуйте! Я AI-администратор LeadVirt.ai.",
        primaryColor: "#34d399",
        accentColor: "#10b981",
        position: "bottom-right",
        locale: "ru-RU",
        suggestedReplies: ["Хочу записаться", "Сколько стоит?", "Позовите менеджера"],
        consentText: "Отправляя сообщение, вы соглашаетесь на связь по заявке.",
        poweredBy: "LeadVirt.ai",
      },
    },
    lastHealthAt: "2026-06-22T10:00:00.000Z",
  };
}

test("settings channels tab saves website widget settings", async ({ page }) => {
  let patchedBody: {
    status?: string;
    settings?: {
      widget?: {
        title?: string;
        suggestedReplies?: string[];
      };
    };
  } | null = null;

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: { id: "tenant-demo", name: "Demo Company", slug: "demo-company", status: "ACTIVE", timezone: "Europe/Paris" },
          owner: { id: "user-demo", email: "admin@leadvirt.ai", name: "Demo Owner" },
          businessName: "Demo Company",
          timezone: "Europe/Paris",
        },
      },
    });
  });
  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({ json: { data: { authMode: "demo", tenantScoped: true, currentRole: "OWNER" } } });
  });
  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/channels/channel-website", async (route) => {
    patchedBody = route.request().postDataJSON() as NonNullable<typeof patchedBody>;
    await route.fulfill({ json: { data: websiteChannel(patchedBody.settings?.widget?.title ?? "Updated") } });
  });

  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        data: [
          websiteChannel(),
          { id: "channel-telegram", tenantId: "tenant-demo", type: "TELEGRAM", status: "ACTIVE", name: "Telegram-бот", publicKey: "demo-telegram-webhook", settings: {}, lastHealthAt: null },
        ],
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Каналы" }).click();
  await expect(page.getByText("Виджет сайта")).toBeVisible();
  await page.getByRole("button", { name: "Настроить Сайт" }).click();
  await expect(page.getByText("Настройки виджета сайта")).toBeVisible();

  await page.getByLabel("Заголовок", { exact: true }).fill("LeadVirt Concierge");
  await page.getByLabel("Быстрые ответы").fill("Хочу демо\nСколько стоит?");
  await page.getByRole("button", { name: "Сохранить виджет" }).click();

  await expect.poll(() => patchedBody?.settings?.widget?.title).toBe("LeadVirt Concierge");
  expect(patchedBody?.settings?.widget?.suggestedReplies).toEqual(["Хочу демо", "Сколько стоит?"]);
});

test("settings channels tab creates Webhook API channel and shows bridge details", async ({ page }) => {
  let createdBody: { type?: string; name?: string; status?: string } | null = null;

  const createdChannel = {
    id: "channel-webhook",
    tenantId: "tenant-clean",
    type: "WEBHOOK",
    status: "ACTIVE",
    name: "Webhook/API",
    publicKey: "lvwh_settings_smoke",
    settings: {
      webhook: {
        publicKey: "lvwh_settings_smoke",
        secret: "settings-smoke-secret",
        autoReply: true,
        acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
      },
    },
    lastHealthAt: null,
  };

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: { id: "tenant-clean", name: "Clean Company", slug: "clean-company", status: "ACTIVE", timezone: "Europe/Paris" },
          owner: { id: "user-clean", email: "clean@example.com", name: "Clean Owner" },
          businessName: "Clean Company",
          timezone: "Europe/Paris",
        },
      },
    });
  });
  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({ json: { data: { tenantScoped: true, currentRole: "OWNER" } } });
  });
  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/channels", async (route) => {
    if (route.request().method() === "POST") {
      createdBody = route.request().postDataJSON() as NonNullable<typeof createdBody>;
      await route.fulfill({ status: 201, json: { data: createdChannel } });
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.locator("main nav").getByRole("button").nth(2).click();
  await expect(page.getByText("Webhook/API")).toBeVisible();
  await page.getByRole("switch").nth(4).click();

  await expect.poll(() => createdBody?.type).toBe("WEBHOOK");
  expect(createdBody?.status).toBe("ACTIVE");

  await expect(page.getByText("lvwh_settings_smoke", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Webhook\/API/ }).click();

  await expect(page.getByText("http://localhost:4001/api/public/channels/webhook/lvwh_settings_smoke/events")).toBeVisible();
  await expect(page.getByText("x-leadvirt-webhook-secret")).toBeVisible();
  await expect(page.getByText("settings-smoke-secret")).toBeVisible();
});

