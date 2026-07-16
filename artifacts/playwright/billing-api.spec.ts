import { readFileSync } from "node:fs";
import { loginAsCleanUser } from "./helpers/auth";
import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function selectLocale(page: Page, locale: string) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});

const professionalPlan = {
  code: "PROFESSIONAL",
  name: "Professional",
  priceMonthlyRub: 7700,
  aiConversations: 1000,
  channelsLimit: 8,
  usersLimit: 6,
  scenariosLimit: 12,
  popular: true,
  bestFor: "Для салонов с несколькими администраторами",
  features: ["1000 AI-диалогов", "8 каналов", "6 участников", "12 сценариев"],
};

const corporatePlan = {
  code: "CORPORATE",
  name: "Corporate",
  priceMonthlyRub: 25000,
  aiConversations: null,
  channelsLimit: null,
  usersLimit: null,
  scenariosLimit: null,
  popular: false,
  bestFor: "Для сети филиалов",
  features: ["Индивидуальные лимиты", "SLA", "Выделенный менеджер"],
};

async function mockBillingApi(page: Page) {
  const billingRequests = {
    selectedPlanCode: null as string | null,
    canceled: false,
    paymentMethodChangeRequested: false,
  };

  await page.route("**/api/billing/plans", async (route) => {
    await route.fulfill({
      json: {
        data: [professionalPlan, corporatePlan],
      },
    });
  });

  await page.route("**/api/billing/current-subscription", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { planCode?: string };
      billingRequests.selectedPlanCode = body.planCode ?? null;
      await route.fulfill({
        json: {
          data: {
            id: "sub-playwright",
            status: "ACTIVE",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            plan: corporatePlan,
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: {
          id: "sub-playwright",
          status: "ACTIVE",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-07-01T00:00:00.000Z",
          plan: professionalPlan,
        },
      },
    });
  });

  await page.route("**/api/billing/current-subscription/cancel", async (route) => {
    billingRequests.canceled = route.request().method() === "POST";
    await route.fulfill({
      json: {
        data: {
          id: "sub-playwright",
          status: "CANCELED",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-07-01T00:00:00.000Z",
          plan: corporatePlan,
        },
      },
    });
  });

  await page.route("**/api/billing/payment-method", async (route) => {
    await route.fulfill({
      json: {
        data: {
          mode: "manual_invoice",
          label: "Безналичный расчёт по счёту",
          description: "Счёт выставляется вручную менеджером LeadVirt.ai.",
          status: "configured",
          updatedAt: "2026-06-01T00:00:00.000Z",
          nextActionLabel: "Запросить изменение",
        },
      },
    });
  });

  await page.route("**/api/billing/payment-method/change-request", async (route) => {
    billingRequests.paymentMethodChangeRequested = route.request().method() === "POST";
    await route.fulfill({
      json: {
        data: {
          requested: true,
          requestedAt: "2026-06-27T12:00:00.000Z",
          mode: "manual_invoice",
        },
      },
    });
  });

  await page.route("**/api/billing/invoices", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "invoice-playwright-2026-06",
            issuedAt: "2026-06-01T00:00:00.000Z",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            amountRub: 7700,
            status: "PAID",
            plan: professionalPlan,
            downloadName: "leadvirt-invoice-2026-06.txt",
          },
        ],
      },
    });
  });

  await page.route("**/api/billing/usage", async (route) => {
    await route.fulfill({
      json: {
        data: {
          aiConversations: 321,
          aiConversationsLimit: 1000,
          messagesSent: 120,
          messagesReceived: 248,
          leadsCreated: 64,
          bookingsCreated: 18,
          ordersCreated: 5,
          crmSyncs: 44,
          workflowRuns: 39,
          channels: 3,
          channelsLimit: 8,
          users: 4,
          usersLimit: 6,
          scenarios: 7,
          scenariosLimit: 12,
        },
      },
    });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-demo",
            name: "Billing Studio",
            slug: "billing-studio",
            status: "TRIALING",
            businessType: "beauty",
            timezone: "Europe/Moscow",
          },
          owner: {
            id: "owner-demo",
            email: "owner@billing.test",
            name: "Owner",
            avatarUrl: null,
          },
          businessName: "Billing Studio",
          timezone: "Europe/Moscow",
        },
      },
    });
  });

  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: { data: { authMode: "demo", tenantScoped: true, currentRole: "OWNER" } },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  return billingRequests;
}

test("billing route renders API-backed plan and usage inside copied settings UI", async ({
  page,
}) => {
  const billingRequests = await mockBillingApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await expect(page.getByText("Биллинг и подписка")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тариф «Профессиональный»" })).toBeVisible();
  await expect(page.getByText("7 700 ₽").first()).toBeVisible();
  await expect(page.getByText("AI-диалоги")).toBeVisible();
  await expect(page.getByText("321")).toBeVisible();
  await expect(page.getByText("1 000")).toBeVisible();
  await expect(page.getByText("Безналичный расчёт по счёту")).toBeVisible();
  await expect(page.getByText("Ручное выставление счетов")).toBeVisible();
  await expect(page.getByText("7 700 ₽").first()).toBeVisible();

  await page.getByRole("button", { name: "Запросить изменение" }).click();
  await expect(page.getByRole("button", { name: "Запрос отправлен" })).toBeVisible();
  expect(billingRequests.paymentMethodChangeRequested).toBe(true);

  const [invoiceDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Скачать счёт 01 июн. 2026 г." }).click(),
  ]);
  expect(invoiceDownload.suggestedFilename()).toBe("leadvirt-invoice-2026-06.txt");
  const invoicePath = await invoiceDownload.path();
  expect(invoicePath).toBeTruthy();
  const invoiceText = readFileSync(invoicePath!, "utf8");
  expect(invoiceText).toContain("Счёт: invoice-playwright-2026-06");
  expect(invoiceText).toContain("Клиент: Billing Studio");

  await page.getByRole("button", { name: "Изменить тариф" }).click();
  await expect(page.getByText("Для сети филиалов")).toBeVisible();
  await expect(page.getByText("от 25 000 ₽")).toBeVisible();

  const corporateCard = page.locator("div").filter({ hasText: "Для сети филиалов" }).first();
  await corporateCard.getByRole("button", { name: "Выбрать" }).click();
  await expect(page.getByRole("heading", { name: "Тариф «Корпоративный»" })).toBeVisible();
  expect(billingRequests.selectedPlanCode).toBe("CORPORATE");

  await page.getByRole("button", { name: "Отменить подписку" }).click();
  await expect(page.getByRole("dialog", { name: "Отменить подписку?" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить отмену" }).click();
  await expect(page.getByText("Подписка отменена").first()).toBeVisible();
  await expect(page.getByText(/Доступ сохранён до/).first()).toBeVisible();
  expect(billingRequests.canceled).toBe(true);
});

test("billing sidebar link opens the billing route", async ({ page }) => {
  await mockBillingApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await page.getByRole("link", { name: /^(Выбрать тариф|Управлять тарифом)$/ }).click();
  await expect(page).toHaveURL(`${webBase}/app/billing`);
  await expect(page.getByText("Биллинг и подписка")).toBeVisible();
});

test("settings and billing localize six locales without mobile overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await mockBillingApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  const locales = {
    en: {
      tag: "en-US",
      profile: "Company profile",
      team: "Team and roles",
      billing: "Billing",
      billingHeading: "Billing and subscription",
    },
    ru: {
      tag: "ru-RU",
      profile: "Профиль компании",
      team: "Команда и роли",
      billing: "Биллинг",
      billingHeading: "Биллинг и подписка",
    },
    es: {
      tag: "es-ES",
      profile: "Perfil de empresa",
      team: "Equipo y roles",
      billing: "Facturación",
      billingHeading: "Facturación y suscripción",
    },
    fr: {
      tag: "fr-FR",
      profile: "Profil de l’entreprise",
      team: "Équipe et rôles",
      billing: "Facturation",
      billingHeading: "Facturation et abonnement",
    },
    de: {
      tag: "de-DE",
      profile: "Unternehmensprofil",
      team: "Team und Rollen",
      billing: "Abrechnung",
      billingHeading: "Abrechnung und Abonnement",
    },
    pt: {
      tag: "pt-BR",
      profile: "Perfil da empresa",
      team: "Equipe e funções",
      billing: "Faturamento",
      billingHeading: "Faturamento e assinatura",
    },
  } as const;

  for (const [locale, copy] of Object.entries(locales)) {
    await page.goto(`${webBase}/app/settings`, { waitUntil: "domcontentloaded" });
    await selectLocale(page, locale);
    await expect(page.getByRole("heading", { name: copy.profile })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.team, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.team })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.billing, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.billingHeading })).toBeVisible();

    const currency = new Intl.NumberFormat(copy.tag, {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(7700);
    await expect(page.getByText(currency).first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: locales.pt.billingHeading })).toBeVisible({
    timeout: 15_000,
  });
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({
    path: "artifacts/playwright/settings-billing-localized-mobile.png",
    fullPage: true,
  });
});

test("billing failure is actionable in the active locale", async ({ page }) => {
  await mockBillingApi(page);
  let allowRecovery = false;
  await page.route("**/api/billing/current-subscription", async (route) => {
    if (allowRecovery) {
      await route.fulfill({
        json: {
          data: {
            id: "sub-recovered",
            status: "ACTIVE",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            plan: professionalPlan,
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "billing offline" } },
    });
  });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  const error = page.getByTestId("settings-billing-load-error");
  await expect(error).toContainText("Data could not be loaded");
  await expect(page.getByText(new Intl.NumberFormat("en", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(4900))).toHaveCount(0);
  allowRecovery = true;
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Plan “Professional”" })).toBeVisible();
});

test("billing shows a truthful no-subscription state", async ({ page }) => {
  await mockBillingApi(page);
  await page.route("**/api/billing/current-subscription", async (route) => {
    await route.fulfill({ json: { data: null } });
  });

  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  await expect(page.getByText("No active subscription")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a plan to get started" })).toBeVisible();
  await expect(page.getByText("Next charge:")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Plan “Professional”" })).toHaveCount(0);
});
