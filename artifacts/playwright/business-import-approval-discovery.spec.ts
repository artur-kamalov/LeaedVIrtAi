import { expect, test, type Page, type Route } from "@playwright/test";
import type { BusinessProfileData, BusinessImportView, UserRole } from "@leadvirt/types";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const pendingImportId = "import-awaiting-owner-approval";

const schedule: BusinessProfileData["weeklySchedule"] = [
  { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "TUE", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "WED", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "THU", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "FRI", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "SAT", enabled: false, opensAt: "09:00", closesAt: "18:00" },
  { day: "SUN", enabled: false, opensAt: "09:00", closesAt: "18:00" },
];

const profile: BusinessProfileData = {
  businessType: "services",
  name: "Approval Discovery Studio",
  description: "A complete profile used to verify import approval discovery.",
  avgCheck: "EUR 100",
  servicesCatalog: "",
  services: [
    {
      id: "consultation",
      name: "Consultation",
      description: "Initial consultation",
      price: "EUR 100",
      duration: "60 minutes",
    },
  ],
  hours: "",
  weeklySchedule: schedule,
  availability: "Weekdays",
  faq: "",
  policies: "",
  escalationRules: "Escalate billing disputes to the owner.",
  timezone: "Europe/Paris",
};

function importView(id: string, filename: string): BusinessImportView {
  return {
    id,
    sourceId: `source-${id}`,
    sourceName: filename,
    format: "CSV",
    state: "AWAITING_APPROVAL",
    generation: 1,
    etag: `"${id}-1"`,
    originalFilename: filename,
    schemaVersion: "services-v1",
    baseBusinessInformationRevision: 1,
    counts: {
      total: 1,
      valid: 1,
      invalid: 0,
      additions: 0,
      updates: 1,
      linked: 0,
      unchanged: 0,
      conflicts: 0,
      pendingApproval: 1,
      applied: 0,
    },
    diagnostics: [],
    projection: { ready: false },
    allowedActions: ["CANCEL"],
    applyEligibility: {
      eligible: false,
      selectedCandidates: 1,
      blockingConflicts: 0,
      blockingInvalid: 0,
      pendingApprovals: 1,
      staleCandidates: 0,
      reasonCodes: ["BUSINESS_IMPORT_APPROVAL_REQUIRED"],
    },
    retryable: false,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:05:00.000Z",
    reviewReadyAt: "2026-07-21T10:05:00.000Z",
  };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

async function installMocks(page: Page, role: UserRole) {
  let pendingQueueRequests = 0;

  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/me") {
      await json(route, {
        id: `user-${role.toLowerCase()}`,
        tenantId: "tenant-approval-discovery",
        email: `${role.toLowerCase()}@approval-discovery.test`,
        name: `${role} User`,
        role,
        locale: "en",
        authMode: "email_otp",
        passwordChangeRequired: false,
      });
      return;
    }
    if (path === "/api/current-tenant") {
      await json(route, {
        id: "tenant-approval-discovery",
        name: "Approval Discovery Workspace",
        slug: "approval-discovery",
        status: "TRIALING",
        role,
      });
      return;
    }
    if (path === "/api/dashboard/summary") {
      await json(route, { metrics: {}, recentActivity: [], channelPerformance: [], trend: [] });
      return;
    }
    if (path === "/api/billing/current-subscription") {
      await json(route, null);
      return;
    }
    if (path === "/api/knowledge/v2/overview") {
      const canEdit = role === "OWNER" || role === "ADMIN" || role === "MANAGER";
      await json(route, {
        readiness: {
          serving: { status: "READY" },
          draft: { status: "UP_TO_DATE" },
        },
        permissions: {
          canViewRestricted: canEdit,
          canEdit,
          canManageSettings: canEdit,
          canVerifyHighRisk: role === "OWNER" || role === "ADMIN",
          canPublish: role === "OWNER" || role === "ADMIN",
          canRollback: role === "OWNER" || role === "ADMIN",
        },
      });
      return;
    }
    if (path === "/api/knowledge/v2/facts") {
      await json(route, {
        items: [],
        pageInfo: { limit: 50, nextCursor: null, hasNextPage: false },
      });
      return;
    }
    if (path === "/api/knowledge/v2/settings") {
      await json(route, {
        version: 1,
        etag: '"knowledge-settings-1"',
        defaultLocale: "en",
        supportedLocales: ["en"],
        defaultScope: null,
        defaultScopeGeneration: 0,
        defaultScopeHash: null,
        autoPublishPolicy: "OFF",
        publicationApprovalPolicy: "OWNER_OR_ADMIN",
        publicationSchedule: null,
        createdAt: "2026-07-21T09:00:00.000Z",
        updatedAt: "2026-07-21T09:00:00.000Z",
        updatedBy: { id: "owner", displayName: "Workspace owner" },
      });
      return;
    }
    if (path === "/api/business-profile") {
      await json(route, {
        profile,
        version: 1,
        etag: '"business-profile-1"',
        updatedAt: "2026-07-21T09:00:00.000Z",
      });
      return;
    }
    if (path === "/api/business-profile/imports") {
      if (url.searchParams.get("state") === "AWAITING_APPROVAL") {
        pendingQueueRequests += 1;
        await json(route, {
          items: [
            importView(pendingImportId, "owner-review.csv"),
            importView("import-second-approval", "second-review.csv"),
          ],
          nextCursor: null,
        });
        return;
      }
      await json(route, { items: [], nextCursor: null });
      return;
    }

    await json(route, null);
  });

  return { pendingQueueRequests: () => pendingQueueRequests };
}

async function openBusinessInformation(page: Page) {
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("business-profile-editor")).toBeVisible();
  await expect(page.getByTestId("business-profile-loading")).toHaveCount(0);
}

test("owner discovers pending import approvals from Business information", async ({ page }) => {
  const requests = await installMocks(page, "OWNER");
  await openBusinessInformation(page);

  const queue = page.getByTestId("business-profile-pending-import-approvals");
  await expect(queue).toContainText("Import approval queue: 2");
  await expect(page.getByTestId("business-profile-review-import-approvals")).toBeVisible();
  await expect.poll(requests.pendingQueueRequests).toBe(1);

  await page.getByTestId("business-profile-review-import-approvals").click();
  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${pendingImportId}$`, "u"));
});

for (const role of ["MANAGER", "VIEWER"] as const) {
  test(`${role} does not receive the import approval CTA`, async ({ page }) => {
    const requests = await installMocks(page, role);
    await openBusinessInformation(page);

    await expect(page.getByTestId("business-profile-pending-import-approvals")).toHaveCount(0);
    await expect(page.getByTestId("business-profile-review-import-approvals")).toHaveCount(0);
    expect(requests.pendingQueueRequests()).toBe(0);
  });
}
