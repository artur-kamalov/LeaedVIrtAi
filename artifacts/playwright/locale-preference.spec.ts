import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function mockWorkspace(page: Page, locale: string | null) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/u, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "locale-user",
          email: "owner@locale.test",
          name: "Locale Owner",
          locale,
          tenantId: "locale-tenant",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route(/\/api\/current-tenant(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: {
        data: {
          id: "locale-tenant",
          name: "Locale Workspace",
          slug: "locale-workspace",
          status: "ACTIVE",
          businessType: "services",
          timezone: "Europe/Paris",
          role: "OWNER",
        },
      },
    }),
  );
  await page.route(/\/api\/billing\/current-subscription(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.route(/\/api\/dashboard\/summary(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 0,
            aiConversationsCount: 0,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentActivity: [],
          channelPerformance: [],
          trend: [],
        },
      },
    }),
  );
}

test("signed-in preference replaces a stale browser locale", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockWorkspace(page, "fr");

  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-testid="language-switcher"]:visible').first()).toHaveAttribute(
    "data-locale",
    "fr",
  );
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("fr");
  const cookies = await context.cookies(webBase);
  expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("fr");
});

test("authenticated locale selection survives client navigation", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockWorkspace(page, "fr");
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const writes: string[] = [];
  await page.route(/\/api\/settings\/preferences\/locale(?:\?.*)?$/u, async (route) => {
    const body = route.request().postDataJSON() as { locale: string };
    writes.push(body.locale);
    await writeGate;
    await route.fulfill({ json: { data: { locale: body.locale } } });
  });
  await page.route(/\/api\/inbox\/conversations(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: {
        data: [],
        pagination: { page: 1, limit: 100, total: 0, hasMore: false },
      },
    }),
  );

  try {
    await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
    const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
    await expect(switcher).toHaveAttribute("data-locale", "fr");
    await switcher.click();
    await page.getByTestId("language-option-pt").click();
    await expect(switcher).toHaveAttribute("data-locale", "pt");
    await expect.poll(() => writes).toEqual(["pt"]);
    await expect(switcher).toHaveAttribute("data-persistence-status", "saving");

    releaseWrite();
    await expect(switcher).toHaveAttribute("data-persistence-status", "idle");
    await page.getByTestId("product-topbar-open-inbox").click();
    await expect(page).toHaveURL(/\/app\/inbox$/u, { timeout: 15_000 });
    const remountedSwitcher = page.locator('[data-testid="language-switcher"]:visible').first();
    await expect(remountedSwitcher).toHaveAttribute("data-locale", "pt");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");

    await expect(remountedSwitcher).toHaveAttribute("data-persistence-status", "idle");
    const cookies = await context.cookies(webBase);
    expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("pt");
  } finally {
    releaseWrite();
  }
});

test("rapid authenticated selections persist the final locale in order", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockWorkspace(page, "fr");
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const writes: string[] = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let persistedLocale: string | null = null;
  await page.route(/\/api\/settings\/preferences\/locale(?:\?.*)?$/u, async (route) => {
    const body = route.request().postDataJSON() as { locale: string };
    writes.push(body.locale);
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    if (body.locale === "de") await firstWriteGate;
    persistedLocale = body.locale;
    activeWrites -= 1;
    await route.fulfill({ json: { data: { locale: body.locale } } });
  });

  try {
    await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
    const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
    await expect(switcher).toHaveAttribute("data-locale", "fr");
    await switcher.click();
    await page.getByTestId("language-option-de").click();
    await expect.poll(() => writes).toEqual(["de"]);

    await switcher.click();
    await page.getByTestId("language-option-pt").click();
    await expect(switcher).toHaveAttribute("data-locale", "pt");
    const immediateCookies = await context.cookies(webBase);
    expect(immediateCookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("pt");

    await page.waitForTimeout(100);
    expect(writes).toEqual(["de"]);
    releaseFirstWrite();

    await expect.poll(() => writes).toEqual(["de", "pt"]);
    await expect.poll(() => persistedLocale).toBe("pt");
    await expect(switcher).toHaveAttribute("data-persistence-status", "idle");
    expect(maxActiveWrites).toBe(1);
  } finally {
    releaseFirstWrite();
  }
});

test("failed authenticated preference is visible and retryable", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockWorkspace(page, "fr");
  let attempts = 0;
  await page.route(/\/api\/settings\/preferences\/locale(?:\?.*)?$/u, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Locale preference could not be saved." } }),
      });
      return;
    }
    await route.fulfill({ json: { data: { locale: "pt" } } });
  });

  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  await expect(switcher).toHaveAttribute("data-locale", "fr");
  await switcher.click();
  await page.getByTestId("language-option-pt").click();

  await expect(switcher).toHaveAttribute("data-locale", "pt");
  await expect(switcher).toHaveAttribute("data-persistence-status", "error");
  await expect(switcher.getByTestId("language-persistence-error-indicator")).toBeVisible();
  const cookies = await context.cookies(webBase);
  expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("pt");

  await switcher.click();
  await expect(page.getByTestId("language-persistence-error")).toContainText(
    "Locale preference could not be saved.",
  );
  await page.getByTestId("language-persistence-retry").click();

  await expect.poll(() => attempts).toBe(2);
  await expect(switcher).toHaveAttribute("data-persistence-status", "idle");
  await expect(switcher.getByTestId("language-persistence-error-indicator")).toHaveCount(0);
});

test("public language selection stays local without a preference PATCH", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let preferencePatchCount = 0;
  await page.route(/\/api\/settings\/preferences\/locale(?:\?.*)?$/u, async (route) => {
    preferencePatchCount += 1;
    await route.fulfill({ json: { data: { locale: "es" } } });
  });

  await page.goto(`${webBase}/login`, { waitUntil: "domcontentloaded" });
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  await expect(switcher).toHaveAttribute("data-persistence-status", "local-only");
  await switcher.click();
  await page.getByTestId("language-option-es").click();

  await expect(switcher).toHaveAttribute("data-locale", "es");
  await page.waitForTimeout(100);
  expect(preferencePatchCount).toBe(0);
  const cookies = await context.cookies(webBase);
  expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("es");
});

test("a missing user preference preserves the browser locale", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "es", url: webBase, sameSite: "Lax" },
  ]);
  await mockWorkspace(page, null);

  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-testid="language-switcher"]:visible').first()).toHaveAttribute(
    "data-locale",
    "es",
  );
});
