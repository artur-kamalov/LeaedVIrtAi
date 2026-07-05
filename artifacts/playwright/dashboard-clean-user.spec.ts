import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const cleanEmail = process.env.LEADVIRT_CLEAN_EMAIL ?? "clean.user.1782990635@yandex.ru";
const cleanPassword = process.env.LEADVIRT_CLEAN_PASSWORD ?? "Clean-1782990635!Aa";

test("clean credential workspace renders honest empty dashboard", async ({ page }) => {
  let login = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: cleanEmail, password: cleanPassword },
  });
  if (!login.ok()) {
    login = await page.request.post(`${apiBase}/auth/signup`, {
      data: { email: cleanEmail, password: cleanPassword, companyName: "Clean Workspace 1782990635" },
    });
  }
  expect(login.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await expect(page.getByText("Clean Workspace 1782990635").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Лидов пока нет")).toBeVisible();
  await expect(page.getByText("Каналы пока не подключены")).toBeVisible();
  await expect(page.getByText("Событий пока нет")).toBeVisible();
  await expect(page.getByText("Тариф не выбран")).toBeVisible();

  await expect(page.getByText("Анна Соколова")).toHaveCount(0);
  await expect(page.getByText("Дмитрий Орлов")).toHaveCount(0);
  await expect(page.getByText("412 лидов")).toHaveCount(0);
  await expect(page.getByText(/auth login/i)).toHaveCount(0);

  await page.screenshot({ path: "artifacts/playwright/dashboard-clean-user-desktop.png", fullPage: true });
});

test("mobile sidebar content stays inside the drawer", async ({ page }) => {
  let login = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: cleanEmail, password: cleanPassword },
  });
  if (!login.ok()) {
    login = await page.request.post(`${apiBase}/auth/signup`, {
      data: { email: cleanEmail, password: cleanPassword, companyName: "Clean Workspace 1782990635" },
    });
  }
  expect(login.ok()).toBeTruthy();

  await page.setViewportSize({ width: 480, height: 1176 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Открыть меню" }).click();

  const sidebar = page.locator("aside:visible").filter({ hasText: "AI Администратор" }).first();
  await expect(sidebar).toBeVisible();

  const overflowing = await sidebar.evaluate((aside) => {
    const bounds = aside.getBoundingClientRect();
    return Array.from(aside.querySelectorAll("*"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const label = node.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? node.tagName;
        return { label, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1));
  });

  expect(overflowing).toEqual([]);
  await page.screenshot({ path: "artifacts/playwright/dashboard-clean-user-mobile-sidebar.png", fullPage: true });
});
