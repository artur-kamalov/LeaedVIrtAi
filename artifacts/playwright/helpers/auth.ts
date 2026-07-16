import { expect, type Page } from "@playwright/test";

export const cleanEmail = process.env.LEADVIRT_CLEAN_EMAIL ?? "clean.user.1782990635@yandex.ru";
export const cleanPassword = process.env.LEADVIRT_CLEAN_PASSWORD ?? "Clean-1782990635!Aa";

export type QaLocale = "en" | "es" | "fr" | "de" | "pt" | "ru";

export async function setCleanUserLocale(page: Page, apiBase: string, locale: QaLocale) {
  const response = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale },
  });

  expect(response.ok()).toBeTruthy();
  await page.context().addCookies([
    {
      name: "leadvirt-locale",
      value: locale,
      url: new URL(apiBase).origin,
      sameSite: "Lax",
    },
  ]);
}

export async function loginAsCleanUser(
  page: Page,
  apiBase: string,
  options: { locale?: QaLocale } = {},
) {
  let response = await page.request.post(`${apiBase}/auth/login`, {
    headers: { "x-leadvirt-qa": "playwright" },
    data: { email: cleanEmail, password: cleanPassword },
  });

  if (!response.ok()) {
    response = await page.request.post(`${apiBase}/auth/signup`, {
      headers: { "x-leadvirt-qa": "playwright" },
      data: { email: cleanEmail, password: cleanPassword, companyName: "Clean Workspace 1782990635" },
    });
  }

  expect(response.ok()).toBeTruthy();
  await setCleanUserLocale(page, apiBase, options.locale ?? "en");
}
