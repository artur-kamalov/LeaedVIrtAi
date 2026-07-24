import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
  BusinessProfileData,
  BusinessProfilePatchRequest,
  BusinessProfileView,
  KnowledgeV2FactView,
} from "@leadvirt/types";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
}

interface CapturedPatch {
  body: BusinessProfilePatchRequest;
  headers: Record<string, string>;
}

interface ProfileMockState {
  view: BusinessProfileView;
  gets: number;
  patches: CapturedPatch[];
  blockers: Array<Record<string, unknown>>;
  facts: KnowledgeV2FactView[];
  factListRequests: string[];
  bulkVerifications: Array<{
    body: unknown;
    headers: Record<string, string>;
  }>;
}

type FailureMode = "none" | "conflict" | "transient" | "serviceValidation";

const schedule: BusinessProfileData["weeklySchedule"] = [
  { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "TUE", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "WED", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "THU", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "FRI", enabled: true, opensAt: "09:00", closesAt: "17:00" },
  { day: "SAT", enabled: false, opensAt: "10:00", closesAt: "16:00" },
  { day: "SUN", enabled: false, opensAt: "10:00", closesAt: "16:00" },
];

function completedProfile(): BusinessProfileData {
  return {
    businessType: "beauty",
    name: "Northstar Wellness Studio",
    description:
      "A completed customer-facing profile for appointments, consultations, and aftercare.",
    avgCheck: "EUR 95",
    servicesCatalog: "Packages are customized after the initial consultation.",
    services: [
      {
        id: "consultation",
        name: "Initial consultation",
        description: "A structured needs assessment and treatment plan.",
        price: "EUR 45",
        duration: "45 minutes",
      },
      {
        id: "signature-session",
        name: "Signature session",
        description: "The studio's most popular appointment.",
        price: "EUR 120",
        duration: "90 minutes",
      },
    ],
    hours: "Public holidays may use reduced hours.",
    weeklySchedule: schedule.map((entry) => ({ ...entry })),
    availability: "Same-week appointments are normally available Tuesday through Thursday.",
    faq: "Clients should arrive ten minutes before their first appointment.",
    policies: "Changes are free up to 24 hours before an appointment.",
    escalationRules: "Escalate medical, payment dispute, and safety questions to the owner.",
    timezone: "Europe/Paris",
  };
}

function profileView(profile = completedProfile()): BusinessProfileView {
  return {
    profile,
    version: 1,
    etag: '"business-profile-1"',
    updatedAt: "2026-07-16T12:00:00.000Z",
  };
}

function serviceFact(index: number): KnowledgeV2FactView {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `service-fact-${suffix}`,
    versionId: `service-fact-${suffix}-v1`,
    factKey: `business:offering:service-${suffix}`,
    entityType: "BUSINESS_OFFERING",
    entityId: `service-${suffix}`,
    fieldType: "BUSINESS_OFFERING",
    normalizedValue: {
      name: `Service ${suffix}`,
      prices: [{ type: "FIXED", amount: String(100 + index), currency: "EUR" }],
    },
    displayValue: `Service ${suffix}`,
    unit: null,
    currency: "EUR",
    timeZone: null,
    locale: "en",
    localeBehavior: "LANGUAGE_NEUTRAL",
    scope: {
      usesTenantDefault: true,
      brandIds: [],
      locationIds: [],
      channelTypes: [],
      assistantIds: [],
      audiences: [],
      segments: [],
      locales: [],
    },
    effectiveFrom: null,
    effectiveUntil: null,
    riskLevel: "HIGH",
    authority: "IMPORTED",
    lifecycleStatus: "DRAFT",
    verificationStatus: "PENDING_REVIEW",
    evidence: [],
    allowedActions: ["EDIT", "VERIFY", "REJECT", "ARCHIVE"],
    version: 1,
    etag: `"service-fact-${suffix}-v1"`,
    createdAt: "2026-07-24T11:00:00.000Z",
    updatedAt: "2026-07-24T11:00:00.000Z",
    verifiedAt: null,
    verifiedBy: null,
  };
}

function servicePriceBlocker(fact: KnowledgeV2FactView) {
  const resource = { type: "FACT", id: fact.id, label: fact.displayValue };
  return {
    code: "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED",
    status: "BLOCKED",
    title: "High-risk fact needs current evidence",
    message: "High-risk facts require owner-verified authority, evidence, and a future expiry.",
    resource,
    remediation: {
      action: "VERIFY_FACT",
      label: "Verify fact",
      resource,
      destination: {
        view: "business",
        task: "verify-services",
        resource,
      },
    },
  };
}

function genericHighRiskFact(index: number): KnowledgeV2FactView {
  const suffix = String(index).padStart(3, "0");
  return {
    ...serviceFact(index),
    id: `hours-fact-${suffix}`,
    versionId: `hours-fact-${suffix}-v1`,
    factKey: `business:hours:${suffix}`,
    entityType: "BUSINESS_HOURS",
    entityId: null,
    fieldType: "SCHEDULE",
    normalizedValue: `Schedule ${suffix}`,
    displayValue: `Schedule ${suffix}`,
    currency: null,
    etag: `"hours-fact-${suffix}-v1"`,
  };
}

function genericHighRiskBlocker(fact: KnowledgeV2FactView) {
  const resource = { type: "FACT", id: fact.id, label: fact.displayValue };
  return {
    code: "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED",
    status: "BLOCKED",
    title: "High-risk fact needs current evidence",
    message: "High-risk facts require owner-verified authority, evidence, and a future expiry.",
    resource,
    remediation: {
      action: "VERIFY_FACT",
      label: "Verify fact",
      resource,
      destination: {
        view: "business",
        task: "verify-fact",
        resource,
      },
    },
  };
}

function overview(canEdit: boolean, blockers: Array<Record<string, unknown>> = []) {
  const itemCounts = {
    documentRevisions: 0,
    factVersions: blockers.length,
    guidanceRuleVersions: 0,
    sourcePermissionSnapshots: 0,
  };
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 3,
      candidateManifestHash: "a".repeat(64),
      activePublicationId: null,
      activePublicationSequence: null,
      status: blockers.length > 0 ? "BLOCKED" : "NEEDS_REVIEW",
      serving: {
        status: "NOT_READY",
        activePublicationId: null,
        activePublicationSequence: null,
        activeEtag: null,
        itemCounts: {
          documentRevisions: 0,
          factVersions: 0,
          guidanceRuleVersions: 0,
          sourcePermissionSnapshots: 0,
        },
        blockers: [],
        capabilities: [],
      },
      draft: {
        status: "CHANGES_PENDING",
        candidateId: "workspace-v2",
        candidateVersion: 3,
        candidateManifestHash: "a".repeat(64),
        evaluationTestCaseSetHash: "b".repeat(64),
        itemCounts,
        blockers,
        warnings: [],
        latestJob: null,
        capabilitySetHash: "c".repeat(64),
        requirementEvaluationSetHash: "d".repeat(64),
        capabilities: [],
      },
      capabilities: [],
      blockerCount: blockers.length,
      warningCount: 0,
      needsReviewCount: blockers.length,
      evaluatedAt: "2026-07-24T11:55:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: {
      sources: 0,
      facts: blockers.length,
      guidanceRules: 0,
      reviewItems: blockers.length,
      failedJobs: 0,
    },
    recentJobs: [],
    permissions: {
      canViewRestricted: canEdit,
      canEdit,
      canManageSettings: canEdit,
      canVerifyHighRisk: canEdit,
      canPublish: canEdit,
      canRollback: canEdit,
    },
  };
}

function knowledgeSettings() {
  return {
    version: 1,
    etag: '"kv2-settings-1"',
    defaultLocale: "en",
    supportedLocales: ["en"],
    defaultScope: null,
    defaultScopeGeneration: 0,
    defaultScopeHash: null,
    autoPublishPolicy: "OFF",
    publicationApprovalPolicy: "OWNER_OR_ADMIN",
    publicationSchedule: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    updatedBy: { id: "owner-user", displayName: "Profile owner" },
  };
}

async function json(
  route: Route,
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

async function installMocks(
  page: Page,
  options: {
    canEdit?: boolean;
    failure?: FailureMode;
    profile?: BusinessProfileData;
    blockers?: Array<Record<string, unknown>>;
    facts?: KnowledgeV2FactView[];
  } = {},
) {
  const canEdit = options.canEdit ?? true;
  const failure = options.failure ?? "none";
  const state: ProfileMockState = {
    view: profileView(options.profile),
    gets: 0,
    patches: [],
    blockers: options.blockers ?? [],
    facts: options.facts ?? [],
    factListRequests: [],
    bulkVerifications: [],
  };

  await page.route("**/api/business-profile", async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === "GET") {
      state.gets += 1;
      await json(route, { data: state.view }, 200, { etag: state.view.etag });
      return;
    }

    if (method === "PATCH") {
      const body = request.postDataJSON() as BusinessProfilePatchRequest;
      state.patches.push({ body, headers: request.headers() });

      if (failure === "conflict" && state.patches.length === 1) {
        state.view = {
          ...state.view,
          profile: {
            ...state.view.profile,
            name: "Northstar Wellness Studio - server revision",
            description: "The authoritative profile was updated by another administrator.",
          },
          version: 2,
          etag: '"business-profile-2"',
          updatedAt: "2026-07-16T12:05:00.000Z",
        };
        await json(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This business profile changed after it was loaded.",
              requestId: "request-profile-conflict",
              retryable: false,
              details: {
                currentEtag: state.view.etag,
                currentVersion: state.view.version,
                safeDiff: { changedFields: ["name", "description"] },
              },
            },
          },
          412,
        );
        return;
      }

      if (failure === "transient" && state.patches.length === 1) {
        await json(
          route,
          {
            error: {
              code: "KNOWLEDGE_DEPENDENCY_TEMPORARILY_UNAVAILABLE",
              message: "Business information is temporarily unavailable.",
              requestId: "request-profile-transient",
              retryable: true,
            },
          },
          503,
        );
        return;
      }

      if (failure === "serviceValidation" && state.patches.length === 1) {
        await json(
          route,
          {
            error: {
              code: "KNOWLEDGE_VALIDATION_INPUT_INVALID",
              message: "Technical business profile validation failed.",
              requestId: "request-profile-service-validation",
              retryable: false,
              fieldErrors: [
                {
                  field: "profile.services.0.price",
                  code: "BUSINESS_INFORMATION_COMPATIBILITY_VALUE_INVALID",
                  message: "Use a typed amount such as EUR 45.",
                },
              ],
            },
          },
          400,
        );
        return;
      }

      const version = state.view.version + 1;
      state.view = {
        profile: { ...state.view.profile, ...body.profile },
        version,
        etag: `"business-profile-${version}"`,
        updatedAt: `2026-07-16T12:${String(version).padStart(2, "0")}:00.000Z`,
      };
      await json(route, { data: state.view }, 200, { etag: state.view.etag });
      return;
    }

    await json(route, { error: { code: "HTTP_ERROR", message: "Method not supported." } }, 405);
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await json(route, { data: overview(canEdit, state.blockers) });
      return;
    }
    if (pathname === "/api/knowledge/v2/settings" && method === "GET") {
      const settings = knowledgeSettings();
      await json(route, { data: settings }, 200, { etag: settings.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/facts" && method === "GET") {
      state.factListRequests.push(request.url());
      const url = new URL(request.url());
      const requestedLimit = Math.max(1, Number(url.searchParams.get("limit") ?? 100));
      const cursor = url.searchParams.get("cursor");
      const start = cursor?.startsWith("fact-offset-")
        ? Number(cursor.slice("fact-offset-".length))
        : 0;
      const entityType = url.searchParams.get("entityType");
      const matchingFacts = entityType
        ? state.facts.filter((fact) => fact.entityType === entityType)
        : state.facts;
      const items = matchingFacts.slice(start, start + requestedLimit);
      const nextOffset = start + items.length;
      const hasNextPage = nextOffset < matchingFacts.length;
      await json(route, {
        data: {
          items,
          pageInfo: {
            limit: requestedLimit,
            nextCursor: hasNextPage ? `fact-offset-${nextOffset}` : null,
            hasNextPage,
          },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/facts/bulk-verify" && method === "POST") {
      const body = request.postDataJSON() as {
        items: Array<{ id: string; etag: string }>;
      };
      state.bulkVerifications.push({ body, headers: request.headers() });
      const verifiedAt = "2026-07-24T12:00:00.000Z";
      const verifiedIds = new Set(body.items.map((item) => item.id));
      state.facts = state.facts.map((fact) =>
        verifiedIds.has(fact.id)
          ? {
              ...fact,
              verificationStatus: "VERIFIED",
              authority: "OWNER_VERIFIED",
              allowedActions: ["EDIT", "ARCHIVE"],
              verifiedAt,
            }
          : fact,
      );
      state.blockers = state.blockers.filter((blocker) => {
        const resource = blocker.resource as { id?: string } | undefined;
        return !resource?.id || !verifiedIds.has(resource.id);
      });
      await json(route, {
        data: {
          resource: {
            verifiedCount: body.items.length,
            items: body.items.map((item, index) => ({
              id: item.id,
              version: 2,
              etag: `"fact-verified-${index + 1}"`,
              verificationStatus: "VERIFIED",
              authority: "OWNER_VERIFIED",
              effectiveUntil: "2026-10-22T12:00:00.000Z",
            })),
          },
          idempotencyReplayed: false,
        },
      });
      return;
    }

    await json(
      route,
      {
        error: {
          code: "HTTP_ERROR",
          message: `Unhandled business profile mock: ${method} ${pathname}`,
          retryable: false,
        },
      },
      501,
    );
  });

  return state;
}

async function authenticate(page: Page) {
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "en" },
  });
  expect(localeResponse.ok()).toBeTruthy();
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
}

async function openBusinessProfile(page: Page) {
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("business-profile-editor")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("business-profile-loading")).toHaveCount(0);
}

async function openServiceEditor(page: Page, index: number) {
  await page.getByTestId(`business-profile-edit-service-${index}`).click();
  await expect(page.getByTestId(`business-profile-service-${index}-editor`)).toBeVisible();
}

test("completed business profile hydrates, saves structured changes, and survives reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    /completed customer-facing profile/,
  );
  await expect(page.locator("#business-profile-business-type").getByRole("combobox")).toContainText(
    /Beauty/i,
  );
  await expect(page.getByTestId("business-profile-timezone").getByRole("combobox")).toContainText(
    "Europe/Paris",
  );
  await openServiceEditor(page, 0);
  await expect(page.getByTestId("business-profile-service-0-name")).toHaveValue(
    "Initial consultation",
  );
  await openServiceEditor(page, 1);
  await expect(page.getByTestId("business-profile-service-1-price")).toHaveValue("EUR 120");
  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeChecked();
  await expect(page.getByTestId("business-profile-day-MON-opens")).toHaveValue("09:00");
  await expect(page.getByTestId("business-profile-day-SAT-enabled")).not.toBeChecked();

  await page.getByTestId("business-profile-name").fill("Northstar Wellness Paris");
  await page
    .getByTestId("business-profile-description")
    .fill("Appointments, consultations, treatments, and detailed aftercare in central Paris.");
  await openServiceEditor(page, 0);
  await page.getByTestId("business-profile-service-0-price").fill("EUR 55");
  await page.getByTestId("business-profile-add-service").click();
  await page.getByTestId("business-profile-service-2-name").fill("Express follow-up");
  await page.getByTestId("business-profile-service-2-price").fill("EUR 30");
  await page.getByTestId("business-profile-service-2-duration").fill("20 minutes");
  await page
    .getByTestId("business-profile-service-2-description")
    .fill("A short progress review after a completed treatment.");
  await page.getByTestId("business-profile-day-SAT-enabled").check();
  await page.getByTestId("business-profile-day-SAT-opens").fill("10:30");
  await page.getByTestId("business-profile-day-SAT-closes").fill("15:30");
  await page
    .getByTestId("business-profile-faq")
    .fill("Arrive ten minutes early. Saturday appointments require confirmation.");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  const request = state.patches[0];
  expect(request.headers["idempotency-key"]).toMatch(/^business-profile-/);
  expect(request.headers["if-match"]).toBe('"business-profile-1"');
  expect(request.body.profile).toMatchObject({
    name: "Northstar Wellness Paris",
    description:
      "Appointments, consultations, treatments, and detailed aftercare in central Paris.",
    faq: "Arrive ten minutes early. Saturday appointments require confirmation.",
  });
  expect(request.body.profile.services).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Initial consultation", price: "EUR 55" }),
      expect.objectContaining({
        name: "Express follow-up",
        price: "EUR 30",
        duration: "20 minutes",
      }),
    ]),
  );
  expect(request.body.profile.weeklySchedule).toEqual(
    expect.arrayContaining([{ day: "SAT", enabled: true, opensAt: "10:30", closesAt: "15:30" }]),
  );
  expect(request.body.profile.weeklySchedule).toHaveLength(7);
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByText(/The profile is saved\./)).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/business-profile-saved-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Paris");
  await openServiceEditor(page, 2);
  await expect(page.getByTestId("business-profile-service-2-name")).toHaveValue(
    "Express follow-up",
  );
  await expect(page.getByTestId("business-profile-day-SAT-enabled")).toBeChecked();
  await expect.poll(() => state.gets).toBeGreaterThanOrEqual(2);
  expect(state.patches).toHaveLength(1);
});

test("an absent weekly schedule is omitted when another profile field is saved", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.weeklySchedule = [];
  const state = await installMocks(page, { profile });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-day-MON-enabled")).not.toBeChecked();
  await page.getByTestId("business-profile-name").fill("Northstar Wellness Renamed");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body.profile).not.toHaveProperty("weeklySchedule");
});

test("service catalog supports compact search, sorting, pagination, stable editing, and focused validation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const profile = completedProfile();
  profile.services = Array.from({ length: 45 }, (_, index) => {
    const number = 45 - index;
    return {
      id: `service-${String(number).padStart(2, "0")}`,
      name: `Service ${String(number).padStart(2, "0")}`,
      description: `Short description for service ${number}.`,
      price: `EUR ${number}`,
      duration: `${20 + number} minutes`,
    };
  });
  const state = await installMocks(page, { profile });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBusinessProfile(page);

  const services = page.getByTestId("business-profile-services");
  const visibleRows = services.locator(
    '[data-testid^="business-profile-service-"]:not([data-testid$="-editor"])',
  );
  await expect(visibleRows).toHaveCount(20);
  await expect(services).toContainText("45 of 45");
  await expect(services).toContainText("Page 1 of 3");
  const firstRowBox = await page.getByTestId("business-profile-service-0").boundingBox();
  expect(firstRowBox).not.toBeNull();
  expect(firstRowBox!.height).toBeLessThanOrEqual(72);

  await page.getByTestId("business-profile-services-search").fill("Service 37");
  await expect(services).toContainText("1 of 45");
  await expect(page.getByTestId("business-profile-service-8")).toBeVisible();
  await expect(page.getByTestId("business-profile-service-0")).toHaveCount(0);

  await page.getByTestId("business-profile-services-search").fill("");
  await page.getByTestId("business-profile-services-sort").click();
  await page.getByRole("option", { name: "Name: A-Z", exact: true }).click();
  await expect(page.getByTestId("business-profile-service-44")).toBeVisible();
  await expect(page.getByTestId("business-profile-service-44")).toContainText("Service 01");

  await page.getByRole("button", { name: "Next service page" }).click();
  await expect(services).toContainText("Page 2 of 3");
  await expect(page.getByTestId("business-profile-service-24")).toBeVisible();
  await openServiceEditor(page, 24);
  const stableName = page.getByTestId("business-profile-service-24-name");
  await stableName.fill("AAA renamed while editing");
  await expect(stableName).toBeVisible();
  await expect(page.getByTestId("business-profile-service-24-editor")).toBeVisible();
  await page.getByTestId("business-profile-edit-service-24").click();
  await expect(page.getByTestId("business-profile-service-24")).toHaveCount(0);

  await page.getByTestId("business-profile-services-search").fill("no matching service");
  await expect(services).toContainText("0 of 45");
  await page.getByTestId("business-profile-add-service").click();
  const addedName = page.getByTestId("business-profile-service-45-name");
  await expect(addedName).toBeFocused();
  await expect(services).toContainText("46 of 46");
  await expect(services).toContainText("Page 3 of 3");

  await page.getByTestId("business-profile-edit-service-45").click();
  await page.getByTestId("business-profile-services-search").fill("Service 01");
  await page.getByTestId("business-profile-save").click();
  await expect(addedName).toBeFocused();
  await expect(addedName).toHaveAttribute("aria-invalid", "true");
  await expect(services).toContainText("46 of 46");
  await expect(services).toContainText("Page 3 of 3");
  expect(state.patches).toHaveLength(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const compactRow = page.getByTestId("business-profile-service-40");
  await expect(compactRow).toBeVisible();
  const compactRowBox = await compactRow.boundingBox();
  expect(compactRowBox).not.toBeNull();
  expect(compactRowBox!.height).toBeLessThanOrEqual(56);
  await page.getByTestId("business-profile-edit-service-45").click();
  await page.screenshot({
    path: "artifacts/screenshots/business-profile-service-catalog-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("readiness groups service blockers, deep-links to the exact fact, and verifies in one request", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const facts = Array.from({ length: 30 }, (_, index) => serviceFact(index + 1));
  const focused = facts[22]!;
  const orderedFacts = [focused, ...facts.filter((fact) => fact.id !== focused.id)];
  const state = await installMocks(page, {
    facts,
    blockers: orderedFacts.map(servicePriceBlocker),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  const groupedGate = page.getByTestId(
    "knowledge-gate-KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED",
  );
  await expect(groupedGate).toHaveCount(1);
  await expect(groupedGate).toContainText("Confirm 30 service prices");
  await expect(page.getByText("High-risk fact needs current evidence")).toHaveCount(0);
  await groupedGate.click();
  await expect(page).toHaveURL(
    new RegExp(`/app/knowledge\\?view=business&task=verify-services&factId=${focused.id}(?:&|$)`),
  );

  const panel = page.getByTestId("knowledge-service-verification");
  const profile = page.getByTestId("business-profile-editor");
  const advanced = page.getByTestId("knowledge-business-advanced");
  await expect(panel).toBeVisible();
  await expect(profile).toBeVisible();
  await expect(advanced).toBeVisible();
  await expect(advanced).not.toHaveAttribute("open", "");
  const focusedRow = panel.locator(`[data-verification-fact-id="${focused.id}"]`);
  await expect(focusedRow).toBeVisible();
  await expect(focusedRow).toBeFocused();
  await expect(panel).toContainText("Page 2 of 2");

  const [panelBox, profileBox, advancedBox] = await Promise.all([
    panel.boundingBox(),
    profile.boundingBox(),
    advanced.boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(profileBox).not.toBeNull();
  expect(advancedBox).not.toBeNull();
  expect(panelBox!.y).toBeLessThan(profileBox!.y);
  expect(panelBox!.y).toBeLessThan(advancedBox!.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);

  await page.getByTestId("knowledge-service-verify-all").click();
  await expect(page.getByRole("dialog", { name: "Confirm current service prices" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and continue" }).click();

  await expect.poll(() => state.bulkVerifications.length).toBe(1);
  const verification = state.bulkVerifications[0]!;
  expect(verification.headers["idempotency-key"]).toMatch(/^kv2:/);
  expect(verification.body).toEqual({
    items: facts.map((fact) => ({ id: fact.id, etag: fact.etag })),
  });
  await expect(panel).toContainText("Service information is confirmed");
  await expect(page.getByTestId("knowledge-service-verify-all")).toHaveCount(0);
});

test("generic high-risk remediation finds and focuses the exact fact beyond the first page", async ({
  page,
}) => {
  await authenticate(page);
  const facts = Array.from({ length: 121 }, (_, index) => genericHighRiskFact(index + 1));
  const focused = facts.at(-1)!;
  const state = await installMocks(page, {
    facts,
    blockers: [genericHighRiskBlocker(focused)],
  });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  await page
    .getByTestId("knowledge-gate-KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED")
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/app/knowledge\\?view=business&task=verify-fact&factId=${focused.id}(?:&|$)`),
  );

  const advanced = page.getByTestId("knowledge-business-advanced");
  await expect(advanced).toHaveAttribute("open", "");
  const focusedRow = page.getByTestId(`knowledge-fact-${focused.id}`);
  await expect(focusedRow).toBeVisible();
  await expect(focusedRow).toBeFocused();
  await expect(focusedRow).toHaveClass(/bg-amber-500/);
  await expect(page.locator(`[data-verification-fact-id="${focused.id}"]`)).toHaveCount(0);
  await expect
    .poll(
      () =>
        state.factListRequests.filter((requestUrl) => {
          const url = new URL(requestUrl);
          return (
            url.searchParams.get("limit") === "100" &&
            url.searchParams.get("cursor") === "fact-offset-100"
          );
        }).length,
    )
    .toBeGreaterThan(0);
});

test("unknown readiness blocker opens understandable details in place", async ({ page }) => {
  await authenticate(page);
  await installMocks(page, {
    blockers: [
      {
        code: 'KNOWLEDGE_UNKNOWN_CHECK_"QUOTED"',
        status: "BLOCKED",
        title: "Internal readiness failure",
        message: "Opaque API detail that must not be shown.",
      },
    ],
  });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  const gate = page.getByRole("button").filter({ hasText: "1 required items need attention" });
  await gate.click();

  await expect(page).toHaveURL(/view=overview/u);
  await expect(page).not.toHaveURL(/view=history/u);
  const details = page.getByTestId("knowledge-gate-in-place-details");
  await expect(details).toBeVisible();
  await expect(details).toBeFocused();
  await expect(details).toContainText("This check is not linked to an editable item");
  await expect(details).toContainText('KNOWLEDGE_UNKNOWN_CHECK_"QUOTED"');
  await expect(page.getByText("Opaque API detail that must not be shown.")).toHaveCount(0);
});

test("source readiness target preserves source, document, and revision IDs", async ({ page }) => {
  await authenticate(page);
  const resource = { type: "REVISION", id: "revision-home-1", label: "Home page revision" };
  await installMocks(page, {
    blockers: [
      {
        code: "KNOWLEDGE_PUBLICATION_REVISION_REVIEW_REQUIRED",
        status: "BLOCKED",
        title: "Revision needs review",
        message: "Review the source revision.",
        resource,
        remediation: {
          action: "REVIEW_REVISION",
          label: "Review source",
          resource,
          destination: {
            view: "sources",
            task: "review-revision",
            resource,
            sourceId: "source-site",
            documentId: "document-home",
            revisionId: "revision-home-1",
          },
        },
      },
    ],
  });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-gate-KNOWLEDGE_PUBLICATION_REVISION_REVIEW_REQUIRED").click();
  await expect(page).toHaveURL(/view=sources/u);
  const url = new URL(page.url());
  expect(url.searchParams.get("view")).toBe("sources");
  expect(url.searchParams.get("task")).toBe("review-revision");
  expect(url.searchParams.get("sourceId")).toBe("source-site");
  expect(url.searchParams.get("documentId")).toBe("document-home");
  expect(url.searchParams.get("revisionId")).toBe("revision-home-1");
});

test("legacy notes cannot look complete while structured services and schedule are missing", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.services = [];
  profile.weeklySchedule = [];
  profile.servicesCatalog = "Consultations from EUR 45 and signature sessions from EUR 120.";
  profile.hours = "Open every day from 10:00 to 21:00.";
  await installMocks(page, { profile });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBusinessProfile(page);

  await expect(page.getByText("Needs details", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-profile-attention")).toBeVisible();
  await expect(page.getByTestId("business-profile-services-conflict")).toBeVisible();
  await expect(page.getByTestId("business-profile-schedule-warning")).toContainText(
    "no working days are enabled",
  );

  const attention = page.getByTestId("business-profile-attention");
  for (const control of [
    page.getByRole("button", { name: "Refresh Knowledge", exact: true }),
    attention.getByRole("button", { name: "Add service", exact: true }),
    attention.getByRole("button", { name: "Open schedule", exact: true }),
    page.getByTestId("business-profile-add-service"),
  ]) {
    await expectTouchTarget(control);
  }

  await page.getByTestId("knowledge-business-advanced").locator("summary").click();
  for (const control of [
    page.getByRole("combobox", { name: "Primary language", exact: true }),
    page.getByRole("combobox", { name: "Filter by verification state", exact: true }),
    page.getByRole("combobox", { name: "Filter by risk level", exact: true }),
    page.getByRole("button", { name: "Refresh facts", exact: true }),
  ]) {
    await expectTouchTarget(control);
  }
  const addFactActions = page.getByRole("button", { name: "Add fact", exact: true });
  await expect(addFactActions).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expectTouchTarget(addFactActions.nth(index));
  }

  await page
    .getByTestId("business-profile-attention")
    .getByRole("button", { name: "Add service" })
    .click();
  const serviceName = page.getByTestId("business-profile-service-0-name");
  await expect(serviceName).toBeFocused();
  await serviceName.fill("Initial consultation");
  await expect(page.getByTestId("business-profile-services-conflict")).toHaveCount(0);

  await page.getByTestId("business-profile-day-MON-enabled").check();
  await expect(page.getByTestId("business-profile-day-MON-opens")).toHaveAttribute(
    "inputmode",
    "numeric",
  );
  await expect(page.getByTestId("business-profile-schedule-warning")).toHaveCount(0);
  await expect(page.getByTestId("business-profile-attention")).toHaveCount(0);
});

test("invalid 24-hour schedule values are rejected inline before save", async ({ page }) => {
  await authenticate(page);
  const state = await installMocks(page);
  await openBusinessProfile(page);

  const opensAt = page.getByTestId("business-profile-day-MON-opens");
  await opensAt.fill("99:99");
  await page.getByTestId("business-profile-save").click();

  await expect(opensAt).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Use 24-hour HH:MM for opening and closing, for example 09:00.").first(),
  ).toBeVisible();
  expect(state.patches).toHaveLength(0);
});

test("server service errors are localized, focused, and keep only the request reference", async ({
  page,
}) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
  const state = await installMocks(page, { failure: "serviceValidation" });
  await openBusinessProfile(page);

  await openServiceEditor(page, 0);
  const price = page.getByTestId("business-profile-service-0-price");
  await price.fill("EUR 55");
  await page.getByTestId("business-profile-save").click();

  await expect(price).toBeFocused();
  await expect(price).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText(
      "Проверьте цену услуги. Укажите простую сумму или отредактируйте расширенные данные цены отдельно.",
    ),
  ).toBeVisible();
  const alert = page.getByTestId("business-profile-save-error");
  await expect(alert).toContainText(
    "Введённые данные остались в форме. Повторите попытку, когда соединение восстановится.",
  );
  await expect(alert).toContainText("request-profile-service-validation");
  await expect(alert).not.toContainText("Technical business profile validation failed.");
  await expect(alert).not.toContainText("Use a typed amount");
  expect(state.patches).toHaveLength(1);
});

test("a partial weekly schedule is omitted when another profile field is saved", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.weeklySchedule = [{ day: "MON", enabled: true, opensAt: "10:00", closesAt: "16:00" }];
  const state = await installMocks(page, { profile });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeChecked();
  await expect(page.getByTestId("business-profile-day-TUE-enabled")).not.toBeChecked();
  await page.getByTestId("business-profile-name").fill("Northstar Partial Schedule");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body.profile).not.toHaveProperty("weeklySchedule");
});

test("a whitespace-only edit is normalized without sending an empty patch", async ({ page }) => {
  await authenticate(page);
  const state = await installMocks(page);
  await openBusinessProfile(page);

  await page.getByTestId("business-profile-name").fill("  Northstar Wellness Studio  ");
  await page.getByTestId("business-profile-save").click();

  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  expect(state.patches).toHaveLength(0);
});

test("stale ETag conflict preserves the draft until explicit authoritative reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page, { failure: "conflict" });
  await openBusinessProfile(page);

  await page.getByTestId("business-profile-name").fill("Local unsaved studio name");
  await page.getByTestId("business-profile-save").click();
  await expect(page.getByTestId("business-profile-conflict")).toBeVisible();
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Local unsaved studio name");
  expect(state.patches[0].headers["if-match"]).toBe('"business-profile-1"');

  await page.getByTestId("business-profile-reload").click();
  await expect(page.getByTestId("business-profile-conflict")).toHaveCount(0);
  await expect(page.getByTestId("business-profile-name")).toHaveValue(
    "Northstar Wellness Studio - server revision",
  );
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    "The authoritative profile was updated by another administrator.",
  );

  await page.getByTestId("business-profile-name").fill("Reviewed merged studio name");
  await page.getByTestId("business-profile-save").click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1].headers["if-match"]).toBe('"business-profile-2"');
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByTestId("business-profile-name")).toHaveValue(
    "Reviewed merged studio name",
  );
});

test("retryable save failure keeps the form editable and reuses the idempotency key", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page, { failure: "transient" });
  await openBusinessProfile(page);

  await page
    .getByTestId("business-profile-description")
    .fill("A locally edited description that must survive a failed save.");
  await page.getByTestId("business-profile-save").click();
  await expect(page.getByTestId("business-profile-retry-save")).toBeVisible();
  await expect(page.getByTestId("business-profile-description")).toBeEditable();
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    "A locally edited description that must survive a failed save.",
  );
  await expect(page.getByTestId("business-profile-save-error")).toContainText(
    "Your entries are still here. Try again when the connection is available.",
  );
  await expect(page.getByTestId("business-profile-save-error")).not.toContainText(
    "Business information is temporarily unavailable.",
  );

  await page.getByTestId("business-profile-retry-save").click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1].headers["idempotency-key"]).toBe(
    state.patches[0].headers["idempotency-key"],
  );
  expect(state.patches[1].body).toEqual(state.patches[0].body);
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByText(/The profile is saved\./)).toBeVisible();
});

test("read-only profile stays visible and the populated mobile layout does not overflow", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const profile = completedProfile();
  profile.description = `${profile.description} ${"Long localized business detail ".repeat(14)}`;
  profile.services[0].description = "Detailed service explanation ".repeat(18);
  const state = await installMocks(page, { canEdit: false, profile });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBusinessProfile(page);

  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-name")).not.toBeEditable();
  await expect(page.getByTestId("business-profile-service-0")).toContainText(
    "Initial consultation",
  );
  await expect(page.getByTestId("business-profile-edit-service-0")).toBeDisabled();
  await expect(page.getByTestId("business-profile-service-0-name")).toHaveCount(0);
  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeDisabled();
  await expect(page.getByTestId("business-profile-add-service")).toBeDisabled();
  await expect(page.getByTestId("business-profile-save")).toHaveCount(0);
  await expect(page.getByTestId("knowledge-business-advanced")).toBeVisible();

  await page.getByTestId("business-profile-schedule").scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("[data-testid='business-profile-editor']");
    const rect = editor?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      editorLeft: rect?.left ?? -1,
      editorRight: rect?.right ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(geometry.viewportWidth).toBe(390);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.editorLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.editorRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(state.patches).toHaveLength(0);
  await page.screenshot({
    path: "artifacts/screenshots/business-profile-read-only-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("mobile profile keeps schedule times together and discloses additional details on demand", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  await installMocks(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await openBusinessProfile(page);

  const additionalDetails = page.getByTestId("business-profile-additional-details");
  const additionalDetailsSummary = page.getByTestId("business-profile-additional-details-summary");
  await expect(additionalDetails).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("business-profile-faq")).not.toBeVisible();

  const summaryBox = await additionalDetailsSummary.boundingBox();
  expect(summaryBox?.height).toBeGreaterThanOrEqual(44);
  await additionalDetailsSummary.click();
  await expect(additionalDetails).toHaveAttribute("open", "");
  await expect(page.getByTestId("business-profile-faq")).toBeVisible();

  const dayLabel = page.getByTestId("business-profile-day-MON-label");
  const opensAt = page.getByTestId("business-profile-day-MON-opens");
  const closesAt = page.getByTestId("business-profile-day-MON-closes");
  await dayLabel.scrollIntoViewIfNeeded();
  const [labelBox, opensBox, closesBox] = await Promise.all([
    dayLabel.boundingBox(),
    opensAt.boundingBox(),
    closesAt.boundingBox(),
  ]);
  expect(labelBox).not.toBeNull();
  expect(opensBox).not.toBeNull();
  expect(closesBox).not.toBeNull();
  expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(opensBox!.y + 1);
  expect(Math.abs(opensBox!.y - closesBox!.y)).toBeLessThanOrEqual(1);
  expect(opensBox!.x).toBeLessThan(closesBox!.x);
  expect(closesBox!.x + closesBox!.width).toBeLessThanOrEqual(320);
});

test("demo business profile uses a concise mobile product title", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/knowledge?view=business`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("business-profile-editor")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("header h1").first()).toHaveAccessibleName("Knowledge");
});
