import { expect, type Page } from "@playwright/test";

export const cleanEmail = process.env.LEADVIRT_CLEAN_EMAIL ?? "clean.user.1782990635@yandex.ru";
export const cleanPassword = process.env.LEADVIRT_CLEAN_PASSWORD ?? "Clean-1782990635!Aa";

export async function loginAsCleanUser(page: Page, apiBase: string) {
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
}
