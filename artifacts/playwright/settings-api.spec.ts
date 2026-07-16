import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
});

function accountSettings(businessName = "API Studio") {
  return {
    data: {
      tenant: {
        id: "tenant-demo",
        name: businessName,
        slug: "api-studio",
        status: "TRIALING",
        businessType: "education",
        timezone: "Asia/Novosibirsk",
      },
      owner: {
        id: "user-owner",
        email: "owner@api-studio.test",
        name: "API Owner",
        avatarUrl: null,
      },
      businessName,
      timezone: "Asia/Novosibirsk",
      description: "API-backed education workspace",
      phone: "+33 1 84 80 20 26",
      website: "https://api-studio.example",
    },
  };
}

function authMe(passwordChangeRequired = false, role = "OWNER") {
  return {
    data: {
      id: "user-owner",
      email: "owner@api-studio.test",
      name: "API Owner",
      avatarUrl: null,
      role,
      tenantId: "tenant-demo",
      authMode: "credentials",
      passwordChangeRequired,
    },
  };
}

function currentTenant(role = "OWNER") {
  return {
    data: {
      id: "tenant-demo",
      name: "API Studio",
      slug: "api-studio",
      status: "TRIALING",
      businessType: "education",
      timezone: "Asia/Novosibirsk",
      role,
    },
  };
}

test("settings page renders account controls and owner-only inert API-key cleanup", async ({
  page,
}) => {
  let patchedBusinessName = "";
  let patchedProfile: {
    description?: string | null;
    phone?: string | null;
    website?: string | null;
  } = {};
  let patchedRole = "";
  let releaseRolePatch!: () => void;
  const rolePatchGate = new Promise<void>((resolve) => {
    releaseRolePatch = resolve;
  });
  let invitedEmail = "";
  let removedMemberId = "";
  let notificationPatch: Record<string, boolean> = {};
  let apiKeyListRequests = 0;
  let apiKeyCreateRequests = 0;
  let revokedKeyId = "";
  let passwordPatch: { currentPassword?: string; newPassword?: string } = {};
  let revokedSessionId = "";
  let twoFactorSetupRequested = false;
  let twoFactorEnabled = false;
  let twoFactorEnabledCode = "";
  let twoFactorRecoveryPassword = "";
  let twoFactorDisablePassword = "";
  let recoveryCodesRemaining = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        businessName?: string;
        description?: string | null;
        phone?: string | null;
        website?: string | null;
      };
      patchedBusinessName = body.businessName ?? "";
      patchedProfile = {
        description: body.description,
        phone: body.phone,
        website: body.website,
      };
      await route.fulfill({
        json: {
          ...accountSettings(patchedBusinessName),
          data: {
            ...accountSettings(patchedBusinessName).data,
            ...patchedProfile,
          },
        },
      });
      return;
    }

    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team/membership-api", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { role?: string };
      patchedRole = body.role ?? "";
      await rolePatchGate;
      await route.fulfill({
        json: {
          data: {
            id: "membership-api",
            role: patchedRole,
            user: { id: "user-api-manager", email: "api-manager@example.com", name: "API Manager" },
          },
        },
      });
      return;
    }

    if (route.request().method() === "DELETE") {
      removedMemberId = "membership-api";
      await route.fulfill({ json: { data: { id: "membership-api", removed: true } } });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        email?: string;
        name?: string;
        role?: string;
      };
      invitedEmail = body.email ?? "";
      await route.fulfill({
        json: {
          data: {
            id: "membership-invited",
            role: body.role ?? "AGENT",
            user: {
              id: "user-invited",
              email: body.email,
              name: body.name,
            },
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: [
          {
            id: "membership-owner",
            role: "OWNER",
            user: {
              id: "user-owner",
              email: "owner@api-studio.test",
              name: "API Owner",
            },
          },
          {
            id: "membership-api",
            role: "MANAGER",
            user: {
              id: "user-api-manager",
              email: "api-manager@example.com",
              name: "API Manager",
            },
          },
        ],
      },
    });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          twoFactor: {
            enabled: twoFactorEnabled,
            setupPending: false,
            confirmedAt: twoFactorEnabled ? "2026-06-27T08:10:00.000Z" : null,
            recoveryCodesRemaining,
          },
          sessions: [
            {
              id: "session-current",
              current: true,
              ipAddress: "127.0.0.1",
              userAgent: "Mozilla/5.0 Chrome/140 Windows",
              createdAt: "2026-06-27T08:00:00.000Z",
              lastUsedAt: "2026-06-27T08:05:00.000Z",
              expiresAt: "2026-07-27T08:00:00.000Z",
            },
            {
              id: "session-other",
              current: false,
              ipAddress: "10.0.0.2",
              userAgent: "Mozilla/5.0 Mobile Safari iPhone",
              createdAt: "2026-06-26T08:00:00.000Z",
              lastUsedAt: "2026-06-26T08:05:00.000Z",
              expiresAt: "2026-07-26T08:00:00.000Z",
            },
          ],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/setup", async (route) => {
    twoFactorSetupRequested = true;
    await route.fulfill({
      json: {
        data: {
          secret: "JBSWY3DPEHPK3PXP",
          otpauthUri:
            "otpauth://totp/LeadVirt.ai:owner%40api-studio.test?secret=JBSWY3DPEHPK3PXP&issuer=LeadVirt.ai",
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/enable", async (route) => {
    twoFactorEnabledCode = (route.request().postDataJSON() as { code?: string }).code ?? "";
    twoFactorEnabled = true;
    recoveryCodesRemaining = 2;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: true,
            setupPending: false,
            confirmedAt: "2026-06-27T08:10:00.000Z",
            recoveryCodesRemaining,
          },
          recoveryCodes: ["LV-AAAA1111-BBBB2222", "LV-CCCC3333-DDDD4444"],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/recovery-codes", async (route) => {
    twoFactorRecoveryPassword =
      (route.request().postDataJSON() as { currentPassword?: string }).currentPassword ?? "";
    recoveryCodesRemaining = 2;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: true,
            setupPending: false,
            confirmedAt: "2026-06-27T08:10:00.000Z",
            recoveryCodesRemaining,
          },
          recoveryCodes: ["LV-EEEE5555-FFFF6666", "LV-GGGG7777-HHHH8888"],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/disable", async (route) => {
    twoFactorDisablePassword =
      (route.request().postDataJSON() as { currentPassword?: string }).currentPassword ?? "";
    twoFactorEnabled = false;
    recoveryCodesRemaining = 0;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: false,
            setupPending: false,
            confirmedAt: null,
            recoveryCodesRemaining: 0,
          },
        },
      },
    });
  });

  await page.route("**/api/settings/security/password", async (route) => {
    passwordPatch = route.request().postDataJSON() as {
      currentPassword?: string;
      newPassword?: string;
    };
    await route.fulfill({ json: { data: { updated: true, revokedSessions: 1 } } });
  });

  await page.route("**/api/settings/security/sessions/session-other", async (route) => {
    revokedSessionId = "session-other";
    await route.fulfill({ json: { data: { id: "session-other", revoked: true, current: false } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    if (route.request().method() === "PATCH") {
      notificationPatch = route.request().postDataJSON() as Record<string, boolean>;
      await route.fulfill({
        json: {
          data: {
            new_lead: true,
            no_reply: false,
            booking: true,
            daily: false,
            tg_summary: true,
            ...notificationPatch,
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: false,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({
      json: {
        data: {
          billingMode: "manual",
          apiKeys: [],
        },
      },
    });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    if (route.request().method() === "POST") {
      apiKeyCreateRequests += 1;
      await route.fulfill({
        status: 501,
        json: {
          error: {
            code: "API_KEYS_NOT_AVAILABLE",
            message: "Tenant API keys are not available.",
            retryable: false,
          },
        },
      });
      return;
    }

    apiKeyListRequests += 1;
    await route.fulfill({
      json: {
        data: [
          {
            id: "api-key-1",
            name: "Production API",
            keyPrefix: "lv_live_",
            createdAt: "2026-06-22T10:00:00.000Z",
            status: "INERT",
            cleanupOnly: true,
          },
        ],
      },
    });
  });

  await page.route("**/api/settings/api-keys/api-key-1", async (route) => {
    revokedKeyId = "api-key-1";
    await route.fulfill({ json: { data: { id: "api-key-1", revoked: true } } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  const businessNameInput = page.getByPlaceholder("Введите название");
  const descriptionInput = page.getByTestId("settings-profile-description");
  const phoneInput = page.getByTestId("settings-profile-phone");
  const websiteInput = page.getByTestId("settings-profile-website");
  await expect(businessNameInput).toHaveValue("API Studio");
  await expect(descriptionInput).toHaveValue("API-backed education workspace");
  await expect(phoneInput).toHaveValue("+33 1 84 80 20 26");
  await expect(websiteInput).toHaveValue("https://api-studio.example");
  await expect(page.locator('input[type="email"]')).toHaveValue("owner@api-studio.test");

  await businessNameInput.fill("API Studio Updated");
  await descriptionInput.fill("Updated profile description");
  await phoneInput.fill("+1 202 555 0142");
  await websiteInput.fill("https://updated.api-studio.example");
  await page.getByRole("button", { name: /Сохранить изменения/ }).click();
  await expect.poll(() => patchedBusinessName).toBe("API Studio Updated");
  await expect
    .poll(() => patchedProfile)
    .toEqual({
      description: "Updated profile description",
      phone: "+1 202 555 0142",
      website: "https://updated.api-studio.example",
    });
  await expect(businessNameInput).toHaveValue("API Studio Updated");

  await page.getByRole("button", { name: /Команда и роли/ }).click();
  await expect(page.getByTestId("settings-team-member-membership-owner")).toContainText(
    "API Owner",
  );
  await expect(
    page.getByTestId("settings-team-member-membership-owner").getByRole("button"),
  ).toHaveCount(0);
  await expect(page.getByText("API Manager")).toBeVisible();
  await expect(page.getByText("api-manager@example.com")).toBeVisible();
  const managerMenu = page.getByLabel("Управление API Manager");
  const inviteMember = page.getByLabel("Пригласить участника");
  await managerMenu.click();
  await page.getByRole("menuitem").nth(2).click();
  await expect.poll(() => patchedRole).toBe("AGENT");
  await expect(managerMenu).toBeDisabled();
  await expect(inviteMember).toBeDisabled();
  releaseRolePatch();
  await expect(managerMenu).toBeEnabled();
  await expect(inviteMember).toBeEnabled();

  await inviteMember.click();
  await page.getByPlaceholder("name@company.ru").fill("new-agent@example.com");
  await page.getByPlaceholder("Имя участника").fill("New Agent");
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect.poll(() => invitedEmail).toBe("new-agent@example.com");
  await expect(page.getByText("New Agent")).toBeVisible();

  await page.getByLabel("Управление API Manager").click();
  await page.getByRole("menuitem").last().click();
  await page.getByRole("button", { name: "Удалить" }).click();
  await expect.poll(() => removedMemberId).toBe("membership-api");

  await page
    .getByRole("main")
    .getByRole("button", { name: /Уведомления/ })
    .click();
  await page.getByRole("switch").first().click();
  await expect.poll(() => notificationPatch.new_lead).toBe(false);

  await page
    .getByRole("main")
    .getByRole("button", { name: /Безопасность/ })
    .click();
  await expect(page.getByText("Текущая роль")).toBeVisible();
  await expect(page.getByText("credentials")).toBeVisible();
  await expect(page.getByText(/IP 10\.0\.0\.2/)).toBeVisible();
  await page.getByLabel("Текущий пароль").fill("demo-demo");
  await page.getByLabel("Новый пароль").fill("new-demo-pass");
  await page.getByLabel("Повторите пароль").fill("new-demo-pass");
  await page.getByRole("button", { name: /Обновить пароль/ }).click();
  await expect.poll(() => passwordPatch.newPassword).toBe("new-demo-pass");
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect.poll(() => revokedSessionId).toBe("session-other");

  const twoFactorCard = page.getByTestId("settings-two-factor-card");
  await expect(twoFactorCard).toContainText("Выключено");
  await twoFactorCard.getByRole("button", { name: /Настроить 2FA/ }).click();
  await expect.poll(() => twoFactorSetupRequested).toBe(true);
  await expect(twoFactorCard.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  await twoFactorCard.getByLabel("2FA код подтверждения").fill("123456");
  await twoFactorCard.getByRole("button", { name: /Подтвердить и включить/ }).click();
  await expect.poll(() => twoFactorEnabledCode).toBe("123456");
  await expect(twoFactorCard).toContainText("Включено");
  await expect(twoFactorCard.getByText("LV-AAAA1111-BBBB2222")).toBeVisible();
  await twoFactorCard.getByLabel("Пароль для 2FA действий").fill("demo-demo");
  await twoFactorCard.getByRole("button", { name: /Новые recovery codes/ }).click();
  await expect.poll(() => twoFactorRecoveryPassword).toBe("demo-demo");
  await expect(twoFactorCard.getByText("LV-EEEE5555-FFFF6666")).toBeVisible();
  await twoFactorCard.getByLabel("Пароль для 2FA действий").fill("demo-demo");
  await twoFactorCard.getByRole("button", { name: "Отключить 2FA" }).click();
  await expect.poll(() => twoFactorDisablePassword).toBe("demo-demo");
  await expect(twoFactorCard).toContainText("Выключено");

  await page
    .getByRole("main")
    .getByRole("button", { name: /API ключи/ })
    .click();
  const unavailableState = page.getByTestId("settings-api-unavailable");
  const cleanupList = page.getByTestId("settings-api-cleanup-list");
  await expect(unavailableState).toBeVisible();
  await expect(unavailableState).toContainText("API-ключи не активны");
  await expect(cleanupList).toBeVisible();
  await expect.poll(() => apiKeyListRequests).toBeGreaterThan(0);
  await expect(cleanupList.getByText("Production API")).toBeVisible();
  await expect(cleanupList.getByText(/lv_live_/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Создать ключ/ })).toHaveCount(0);
  expect(apiKeyCreateRequests).toBe(0);
  await page.screenshot({
    path: "artifacts/playwright/settings-api-keys-inert-cleanup.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cleanupList).toBeVisible();
  const mobileViewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileViewport.scrollWidth).toBeLessThanOrEqual(mobileViewport.innerWidth);
  await page.screenshot({
    path: "artifacts/playwright/settings-api-keys-inert-cleanup-mobile.png",
    fullPage: true,
  });
  await cleanupList.getByRole("button", { name: "Удалить" }).click();
  await page.getByTestId("confirm-dialog-submit").click();
  await expect.poll(() => revokedKeyId).toBe("api-key-1");
  await expect(page.getByText("Production API")).toBeHidden();
  await expect(page.getByText("lv_created_secret_once")).toHaveCount(0);
  await expect(page.getByText("Производство")).toBeHidden();
});

test("settings API keys tab explains unavailability without legacy rows or creation controls", async ({
  page,
}) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings?tab=api`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("settings-api-unavailable")).toContainText("API-ключи не активны");
  await expect(page.getByTestId("settings-api-cleanup-list")).toBeVisible();
  await expect(page.getByRole("button", { name: /Создать ключ/ })).toHaveCount(0);
  await expect(page.getByText("Производство")).toBeHidden();
  await expect(page.getByText(/sk-live/)).toBeHidden();
});

test("non-admin member cannot see or deep-link into API-key cleanup", async ({ page }) => {
  let apiKeyListRequests = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false, "MANAGER") });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant("MANAGER") });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "MANAGER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    apiKeyListRequests += 1;
    await route.fulfill({
      json: {
        data: [
          {
            id: "must-not-render",
            name: "Hidden legacy key",
            keyPrefix: "lv_hidden_",
            createdAt: "2026-06-22T10:00:00.000Z",
            status: "INERT",
            cleanupOnly: true,
          },
        ],
      },
    });
  });

  await page.goto(`${webBase}/app/settings?tab=api`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("settings-profile-editor")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /API ключи/ })).toHaveCount(0);
  await expect(page.getByText("Hidden legacy key")).toHaveCount(0);
  await expect(page.getByText(/lv_hidden_/)).toHaveCount(0);
  expect(apiKeyListRequests).toBe(0);
});

test("settings account initial failure stays explicit and recovers on retry", async ({ page }) => {
  let accountRequests = 0;
  let accountAvailable = false;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    accountRequests += 1;
    if (!accountAvailable) {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "SETTINGS_UNAVAILABLE",
            message: "Account settings are temporarily unavailable.",
            retryable: true,
          },
        },
      });
      return;
    }
    await route.fulfill({ json: accountSettings("Recovered API Studio") });
  });

  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  const loadError = page.getByTestId("settings-account-load-error");
  await expect(loadError).toBeVisible();
  await expect(page.getByTestId("settings-profile-editor")).toHaveCount(0);
  await expect(page.getByTestId("settings-profile-description")).toHaveCount(0);
  await expect(page.getByTestId("settings-profile-phone")).toHaveCount(0);
  await expect(page.getByTestId("settings-profile-website")).toHaveCount(0);
  await expect(page.getByPlaceholder("Введите название")).toHaveCount(0);

  accountAvailable = true;
  await loadError.getByRole("button").click();

  await expect.poll(() => accountRequests).toBeGreaterThan(1);
  await expect(loadError).toBeHidden();
  await expect(page.getByTestId("settings-profile-editor")).toBeVisible();
  await expect(page.getByPlaceholder("Введите название")).toHaveValue("Recovered API Studio");
  await expect(page.getByTestId("settings-profile-description")).toHaveValue(
    "API-backed education workspace",
  );
  await expect(page.getByTestId("settings-profile-phone")).toHaveValue("+33 1 84 80 20 26");
  await expect(page.getByTestId("settings-profile-website")).toHaveValue(
    "https://api-studio.example",
  );
});

test("temporary password users are routed to Security and clear the warning after changing password", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let passwordPatch: { currentPassword?: string; newPassword?: string } = {};
  let passwordChangeRequired = true;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(passwordChangeRequired) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/security/password", async (route) => {
    passwordPatch = route.request().postDataJSON() as {
      currentPassword?: string;
      newPassword?: string;
    };
    passwordChangeRequired = false;
    await route.fulfill({ json: { data: { updated: true, revokedSessions: 0 } } });
  });

  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/settings\?tab=security/, { timeout: 15_000 });
  await expect(page.getByText("Нужно сменить временный пароль")).toBeVisible();
  await page.screenshot({
    path: "artifacts/playwright/settings-password-change-required.png",
    fullPage: true,
  });

  await page.getByLabel("Текущий пароль").fill("lv-temp-pass-once");
  await page.getByLabel("Новый пароль").fill("new-permanent-pass");
  await page.getByLabel("Повторите пароль").fill("new-permanent-pass");
  await page.getByRole("button", { name: /Обновить пароль/ }).click();

  await expect.poll(() => passwordPatch.currentPassword).toBe("lv-temp-pass-once");
  await expect.poll(() => passwordPatch.newPassword).toBe("new-permanent-pass");
  await expect(page.getByText("Нужно сменить временный пароль")).toBeHidden();
});
