import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BusinessProfileView,
  KnowledgeV2CreateFactRequest,
  KnowledgeV2CreateGuidanceRuleRequest,
  KnowledgeV2FactView,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2OverviewView,
  KnowledgeV2SettingsView,
  KnowledgeV2UpdateFactRequest,
  KnowledgeV2UpdateSettingsRequest,
} from "@leadvirt/types";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const futureDateTime = "2030-12-31T12:00";
const futureDate = "2030-12-31";

type KnowledgeRole = "OWNER" | "MANAGER";

interface CapturedRequest<T = unknown> {
  body: T;
  headers: Record<string, string>;
}

interface EditorMockState {
  role: KnowledgeRole;
  fact: KnowledgeV2FactView | null;
  rules: KnowledgeV2GuidanceRuleView[];
  settings: KnowledgeV2SettingsView;
  factCreates: Array<CapturedRequest<KnowledgeV2CreateFactRequest>>;
  factUpdates: Array<CapturedRequest<KnowledgeV2UpdateFactRequest>>;
  factVerifications: Array<CapturedRequest<Record<string, never>>>;
  guidanceCreates: Array<CapturedRequest<KnowledgeV2CreateGuidanceRuleRequest>>;
  guidanceApprovals: Array<CapturedRequest<{ note?: string | null }>>;
  guidanceDisables: Array<CapturedRequest<{ note?: string | null }>>;
  settingsUpdates: Array<CapturedRequest<KnowledgeV2UpdateSettingsRequest>>;
  settingsGets: number;
}

function scope(audiences: KnowledgeV2FactView["scope"]["audiences"]) {
  return {
    usesTenantDefault: false,
    brandIds: ["brand-paris"],
    locationIds: ["location-paris"],
    channelTypes: ["WEBSITE" as const],
    assistantIds: [],
    audiences,
    segments: ["retail"],
    locales: [],
  };
}

function overview(role: KnowledgeRole): KnowledgeV2OverviewView {
  const manager = role === "MANAGER";
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 12,
      candidateManifestHash: "a".repeat(64),
      activePublicationId: "publication-11",
      activePublicationSequence: 11,
      status: "NEEDS_REVIEW",
      serving: {
        status: "READY",
        activePublicationId: "publication-11",
        activePublicationSequence: 11,
        activeEtag: '"kv2-active-11"',
        itemCounts: {
          documentRevisions: 0,
          factVersions: 3,
          guidanceRuleVersions: 2,
          sourcePermissionSnapshots: 0,
        },
        blockers: [],
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      draft: {
        status: "CHANGES_PENDING",
        candidateId: "workspace-v2",
        candidateVersion: 12,
        candidateManifestHash: "a".repeat(64),
        evaluationTestCaseSetHash: "d".repeat(64),
        itemCounts: {
          documentRevisions: 0,
          factVersions: 4,
          guidanceRuleVersions: 3,
          sourcePermissionSnapshots: 0,
        },
        blockers: [],
        warnings: [],
        latestJob: null,
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      capabilities: [],
      blockerCount: 0,
      warningCount: 0,
      needsReviewCount: 1,
      evaluatedAt: "2026-07-12T12:00:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: { sources: 0, facts: 4, guidanceRules: 3, reviewItems: 1, failedJobs: 0 },
    recentJobs: [],
    permissions: {
      canViewRestricted: true,
      canEdit: true,
      canManageSettings: !manager,
      canVerifyHighRisk: !manager,
      canPublish: !manager,
      canRollback: !manager,
    },
  };
}

function initialSettings(): KnowledgeV2SettingsView {
  return {
    version: 1,
    etag: '"kv2-settings-1"',
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
    defaultScope: null,
    defaultScopeGeneration: 0,
    defaultScopeHash: null,
    autoPublishPolicy: "OFF",
    publicationApprovalPolicy: "OWNER_OR_ADMIN",
    publicationSchedule: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
    updatedBy: { id: "owner-user", displayName: "Alex Morgan" },
  };
}

function businessProfile(): BusinessProfileView {
  return {
    profile: {
      businessType: "services",
      name: "Knowledge editor fixture",
      description: "A deterministic business profile for advanced Knowledge editor tests.",
      avgCheck: "",
      servicesCatalog: "",
      services: [],
      hours: "",
      weeklySchedule: [],
      availability: "",
      faq: "",
      policies: "",
      escalationRules: "",
      timezone: "UTC",
    },
    version: 1,
    etag: '"business-profile-editor-1"',
    updatedAt: "2026-07-12T09:00:00.000Z",
  };
}

function factFromCreate(body: KnowledgeV2CreateFactRequest): KnowledgeV2FactView {
  return {
    id: "fact-price",
    versionId: "fact-price-v1",
    version: 1,
    etag: '"kv2-fact-1"',
    factKey: body.factKey,
    entityType: body.entityType,
    entityId: body.entityId ?? null,
    fieldType: body.fieldType,
    normalizedValue: body.normalizedValue,
    displayValue: body.displayValue ?? null,
    unit: body.unit ?? null,
    currency: body.currency ?? null,
    timeZone: body.timeZone ?? null,
    locale: body.locale ?? null,
    localeBehavior: body.localeBehavior,
    scope: scope(body.scope?.audiences ?? []),
    effectiveFrom: body.effectiveFrom ?? null,
    effectiveUntil: body.effectiveUntil ?? null,
    riskLevel: body.riskLevel,
    authority: body.authority,
    lifecycleStatus: "DRAFT",
    verificationStatus: "UNVERIFIED",
    evidence: [
      {
        id: "evidence-manual-1",
        sourceId: null,
        documentId: null,
        revisionId: null,
        label: "Manual workspace entry",
        locator: null,
        isPublic: false,
      },
    ],
    allowedActions: ["EDIT", "VERIFY", "REJECT"],
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    verifiedAt: null,
    verifiedBy: null,
  };
}

function guidanceFromCreate(
  body: KnowledgeV2CreateGuidanceRuleRequest,
  index: number,
): KnowledgeV2GuidanceRuleView {
  const id = index === 1 ? "guidance-all" : "guidance-high";
  return {
    id,
    versionId: `${id}-v1`,
    version: 1,
    etag: `"kv2-${id}-1"`,
    title: body.title,
    type: body.type,
    condition: body.condition,
    instruction: body.instruction,
    priority: body.priority,
    tieBreakKey: body.tieBreakKey,
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
    effectiveFrom: body.effectiveFrom ?? null,
    effectiveUntil: body.effectiveUntil ?? null,
    riskLevel: body.riskLevel,
    requiredApproverRole: body.requiredApproverRole ?? null,
    examples: body.examples ?? [],
    evidence: [
      {
        id: `${id}-manual-evidence`,
        sourceId: null,
        documentId: null,
        revisionId: null,
        label: "Manual workspace entry",
        locator: null,
        isPublic: false,
      },
    ],
    reviewStatus: "DRAFT",
    allowedActions: ["EDIT", "APPROVE", "REJECT", "DISABLE"],
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
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

async function installEditorMocks(page: Page, role: KnowledgeRole = "OWNER") {
  const state: EditorMockState = {
    role,
    fact: null,
    rules: [],
    settings: initialSettings(),
    factCreates: [],
    factUpdates: [],
    factVerifications: [],
    guidanceCreates: [],
    guidanceApprovals: [],
    guidanceDisables: [],
    settingsUpdates: [],
    settingsGets: 0,
  };

  await page.route("**/api/business-profile", async (route) => {
    const profile = businessProfile();
    await json(route, { data: profile }, 200, { etag: profile.etag });
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    const headers = request.headers();

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await json(route, { data: overview(state.role) });
      return;
    }

    if (pathname === "/api/knowledge/v2/settings" && method === "GET") {
      state.settingsGets += 1;
      await json(route, { data: state.settings }, 200, { etag: state.settings.etag });
      return;
    }

    if (pathname === "/api/knowledge/v2/settings" && method === "PATCH") {
      const body = request.postDataJSON() as KnowledgeV2UpdateSettingsRequest;
      state.settingsUpdates.push({ body, headers });
      const attempt = state.settingsUpdates.length;

      if (attempt === 1) {
        await json(
          route,
          {
            error: {
              code: "KNOWLEDGE_DEPENDENCY_TEMPORARILY_UNAVAILABLE",
              message: "Language settings are temporarily unavailable.",
              requestId: "request-settings-transient",
              retryable: true,
            },
          },
          500,
        );
        return;
      }

      if (attempt === 3) {
        state.settings = {
          ...state.settings,
          version: 3,
          etag: '"kv2-settings-3"',
          defaultLocale: "fr",
          supportedLocales: ["en", "fr", "es"],
          updatedAt: "2026-07-12T12:10:00.000Z",
        };
        await json(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This resource changed after it was loaded.",
              requestId: "request-settings-conflict",
              retryable: false,
              details: {
                currentEtag: state.settings.etag,
                currentVersion: state.settings.version,
                safeDiff: { changedFields: ["defaultLocale", "supportedLocales"] },
              },
            },
          },
          412,
        );
        return;
      }

      state.settings = {
        ...state.settings,
        ...body,
        version: 2,
        etag: '"kv2-settings-2"',
        updatedAt: "2026-07-12T12:05:00.000Z",
      };
      await json(route, { data: { resource: state.settings, idempotencyReplayed: false } }, 200, {
        etag: state.settings.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/facts" && method === "GET") {
      await json(route, {
        data: {
          items: state.fact ? [state.fact] : [],
          pageInfo: { limit: 50, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/facts" && method === "POST") {
      const body = request.postDataJSON() as KnowledgeV2CreateFactRequest;
      state.factCreates.push({ body, headers });
      state.fact = factFromCreate(body);
      await json(route, { data: { resource: state.fact, idempotencyReplayed: false } }, 201, {
        etag: state.fact.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/facts/fact-price/verify" && method === "POST") {
      state.factVerifications.push({
        body: request.postDataJSON() as Record<string, never>,
        headers,
      });
      if (!state.fact) throw new Error("Fact verification mock ran before creation.");
      state.fact = {
        ...state.fact,
        versionId: "fact-price-v2",
        version: 2,
        etag: '"kv2-fact-2"',
        verificationStatus: "VERIFIED",
        allowedActions: ["EDIT", "REJECT"],
        updatedAt: "2026-07-12T12:02:00.000Z",
        verifiedAt: "2026-07-12T12:02:00.000Z",
        verifiedBy: { id: "owner-user", displayName: "Alex Morgan" },
      };
      await json(route, { data: { resource: state.fact, idempotencyReplayed: false } }, 200, {
        etag: state.fact.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/facts/fact-price" && method === "PATCH") {
      const body = request.postDataJSON() as KnowledgeV2UpdateFactRequest;
      state.factUpdates.push({ body, headers });
      if (!state.fact) throw new Error("Fact update mock ran before creation.");

      if (state.factUpdates.length === 1) {
        state.fact = {
          ...state.fact,
          versionId: "fact-price-v3",
          version: 3,
          etag: '"kv2-fact-3"',
          normalizedValue: 155.25,
          verificationStatus: "UNVERIFIED",
          allowedActions: ["EDIT", "VERIFY", "REJECT"],
          updatedAt: "2026-07-12T12:03:00.000Z",
        };
        await json(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This resource changed after it was loaded.",
              requestId: "request-fact-conflict",
              retryable: false,
              details: {
                currentEtag: state.fact.etag,
                currentVersion: state.fact.version,
                safeDiff: { changedFields: ["normalizedValue"] },
              },
            },
          },
          412,
        );
        return;
      }

      const bodyScope = body.scope && "audiences" in body.scope ? (body.scope.audiences ?? []) : [];
      state.fact = {
        ...state.fact,
        versionId: "fact-price-v4",
        version: 4,
        etag: '"kv2-fact-4"',
        normalizedValue: body.normalizedValue ?? state.fact.normalizedValue,
        displayValue: body.displayValue ?? null,
        currency: body.currency ?? state.fact.currency,
        scope: body.scope === null ? state.fact.scope : scope(bodyScope),
        effectiveUntil: body.effectiveUntil ?? state.fact.effectiveUntil,
        riskLevel: body.riskLevel ?? state.fact.riskLevel,
        verificationStatus: "UNVERIFIED",
        allowedActions: ["EDIT", "VERIFY", "REJECT"],
        updatedAt: "2026-07-12T12:04:00.000Z",
        verifiedAt: null,
        verifiedBy: null,
      };
      await json(route, { data: { resource: state.fact, idempotencyReplayed: false } }, 200, {
        etag: state.fact.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/guidance" && method === "GET") {
      await json(route, {
        data: {
          items: state.rules,
          pageInfo: { limit: 100, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/guidance" && method === "POST") {
      const body = request.postDataJSON() as KnowledgeV2CreateGuidanceRuleRequest;
      state.guidanceCreates.push({ body, headers });
      const rule = guidanceFromCreate(body, state.guidanceCreates.length);
      state.rules = [rule, ...state.rules];
      await json(route, { data: { resource: rule, idempotencyReplayed: false } }, 201, {
        etag: rule.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/guidance/guidance-high/approve" && method === "POST") {
      state.guidanceApprovals.push({
        body: request.postDataJSON() as { note?: string | null },
        headers,
      });
      const current = state.rules.find((rule) => rule.id === "guidance-high");
      if (!current) throw new Error("Guidance approval mock ran before creation.");
      const approved: KnowledgeV2GuidanceRuleView = {
        ...current,
        versionId: "guidance-high-v2",
        version: 2,
        etag: '"kv2-guidance-high-2"',
        reviewStatus: "APPROVED",
        allowedActions: ["EDIT", "REJECT", "DISABLE"],
        approvedAt: "2026-07-12T12:06:00.000Z",
        approvedBy: { id: "owner-user", displayName: "Alex Morgan" },
      };
      state.rules = [approved, ...state.rules.filter((rule) => rule.id !== approved.id)];
      await json(route, { data: { resource: approved, idempotencyReplayed: false } }, 200, {
        etag: approved.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/guidance/guidance-high/disable" && method === "POST") {
      state.guidanceDisables.push({
        body: request.postDataJSON() as { note?: string | null },
        headers,
      });
      const current = state.rules.find((rule) => rule.id === "guidance-high");
      if (!current) throw new Error("Guidance disable mock ran before creation.");
      const disabled: KnowledgeV2GuidanceRuleView = {
        ...current,
        versionId: "guidance-high-v3",
        version: 3,
        etag: '"kv2-guidance-high-3"',
        reviewStatus: "DISABLED",
        allowedActions: ["EDIT"],
        approvedAt: null,
        approvedBy: null,
      };
      state.rules = [disabled, ...state.rules.filter((rule) => rule.id !== disabled.id)];
      await json(route, { data: { resource: disabled, idempotencyReplayed: false } }, 200, {
        etag: disabled.etag,
      });
      return;
    }

    await json(
      route,
      {
        error: {
          code: "HTTP_ERROR",
          message: `Unhandled Knowledge editor mock: ${method} ${pathname}`,
          requestId: "request-unhandled-editor-mock",
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

async function choose(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openAdvancedEditors(page: Page) {
  const advanced = page.getByTestId("knowledge-business-advanced");
  await advanced.locator("summary").click();
  await expect(advanced).toHaveAttribute("open", "");
}

test("mobile Knowledge editor search and filter controls keep 44px targets", async ({ page }) => {
  await authenticate(page);
  await installEditorMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await openAdvancedEditors(page);
  const facts = page.getByTestId("business-facts-editor");
  await expect(facts).toBeVisible({ timeout: 15_000 });

  const factTargetHeights = await facts
    .locator('input[aria-label], button[role="combobox"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter(({ height, width }) => height > 0 && width > 0)
        .map(({ height }) => height),
    );
  expect(factTargetHeights.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...factTargetHeights)).toBeGreaterThanOrEqual(44);

  await page.goto(`${webBase}/app/knowledge?view=guidance`, { waitUntil: "domcontentloaded" });
  const guidance = page.getByTestId("knowledge-guidance-editor");
  await expect(guidance).toBeVisible({ timeout: 15_000 });
  const guidanceTargetHeights = await guidance
    .locator('input, button[role="combobox"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter(({ height, width }) => height > 0 && width > 0)
        .map(({ height }) => height),
    );
  expect(guidanceTargetHeights.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...guidanceTargetHeights)).toBeGreaterThanOrEqual(44);
});

test("Business facts preserve manual provenance through create, verify, conflict reload, and scoped price edit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installEditorMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await openAdvancedEditors(page);
  await expect(page.getByTestId("business-facts-editor")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Add fact" }).first().click();
  const createDialog = page.getByRole("dialog", { name: "Add business fact" });
  await expect(createDialog.getByText("Manual entry", { exact: true })).toBeVisible();
  await expect(createDialog.getByRole("combobox", { name: /authority/i })).toHaveCount(0);
  await choose(page, "Fact type", "Price");
  await createDialog.getByLabel("Service name").fill("Consultation");
  await createDialog.getByLabel("Amount").fill("149.50");
  await createDialog.getByLabel("Currency").fill("eur");
  await choose(page, "Fact audience", "Internal only");
  await createDialog.getByRole("button", { name: "Create fact" }).click();
  await expect(createDialog.locator("#business-fact-effective-until-error")).toHaveText(
    "High-risk facts require a future expiry date.",
  );
  await createDialog.getByLabel(/Valid until/).fill(futureDateTime);
  await createDialog.getByRole("button", { name: "Create fact" }).click();

  await expect(page.getByText("service/consultation/base-price", { exact: true })).toBeVisible();
  expect(state.factCreates).toHaveLength(1);
  expect(state.factCreates[0].headers["idempotency-key"]).toMatch(/^kv2:/);
  expect(state.factCreates[0].body).toMatchObject({
    factKey: "service/consultation/base-price",
    entityType: "CATALOG_ITEM",
    fieldType: "MONEY",
    normalizedValue: 149.5,
    currency: "EUR",
    locale: null,
    localeBehavior: "LANGUAGE_NEUTRAL",
    scope: { audiences: ["INTERNAL"] },
    riskLevel: "HIGH",
    authority: "MANUAL",
  });
  expect(typeof state.factCreates[0].body.normalizedValue).toBe("number");
  expect(new Date(state.factCreates[0].body.effectiveUntil ?? 0).getTime()).toBeGreaterThan(
    Date.now(),
  );

  await page.getByRole("button", { name: "Verify service/consultation/base-price" }).click();
  const factRow = page.locator("article").filter({ hasText: "service/consultation/base-price" });
  await expect(factRow.getByText("Verified", { exact: true })).toBeVisible();
  expect(state.factVerifications).toHaveLength(1);
  expect(state.factVerifications[0].body).toEqual({});
  expect(state.factVerifications[0].headers["if-match"]).toBe('"kv2-fact-1"');
  expect(state.factVerifications[0].headers["idempotency-key"]).toMatch(/^kv2:/);

  await page.getByRole("button", { name: "Edit service/consultation/base-price" }).click();
  let editDialog = page.getByRole("dialog", { name: "Edit business fact" });
  await editDialog.getByLabel("Amount").fill("159.75");
  await choose(page, "Fact audience", "Authenticated customers");
  await editDialog.getByLabel("Change reason").fill("Updated consultation price and audience.");
  await editDialog.getByRole("button", { name: "Save changes" }).click();

  await expect(editDialog.getByText("This fact changed after you opened it.")).toBeVisible();
  await editDialog.getByRole("button", { name: "Reload current" }).click();
  await expect(editDialog.getByLabel("Amount")).toHaveValue("155.25");
  await expect(
    editDialog.getByText(
      "Brand, location, channel, assistant, segment, and locale scope remain unchanged.",
    ),
  ).toBeVisible();

  await editDialog.getByLabel("Amount").fill("159.75");
  await choose(page, "Fact audience", "Authenticated customers");
  await editDialog.getByLabel("Change reason").fill("Apply the reviewed customer price.");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(factRow.getByText("159.75", { exact: true })).toBeVisible();
  await expect(factRow.getByText("Authenticated customers", { exact: true })).toBeVisible();

  expect(state.factUpdates).toHaveLength(2);
  expect(state.factUpdates[0].headers["if-match"]).toBe('"kv2-fact-2"');
  expect(state.factUpdates[1].headers["if-match"]).toBe('"kv2-fact-3"');
  expect(state.factUpdates[1].headers["idempotency-key"]).toMatch(/^kv2:/);
  expect(state.factUpdates[1].body.normalizedValue).toBe(159.75);
  expect(state.factUpdates[1].body.scope).toMatchObject({
    brandIds: ["brand-paris"],
    locationIds: ["location-paris"],
    channelTypes: ["WEBSITE"],
    audiences: ["AUTHENTICATED_CUSTOMER"],
    segments: ["retail"],
  });
  expect(state.factUpdates[1].body).not.toHaveProperty("authority");
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-business-controls-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Guidance supports unconditional and predicate rules with high-risk approval and disable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installEditorMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=guidance`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("knowledge-guidance-editor")).toBeVisible();

  await page.getByTestId("guidance-create").click();
  let dialog = page.getByRole("dialog", { name: "New guidance rule" });
  await dialog.getByLabel("Title").fill("Always identify the business clearly");
  await dialog
    .getByLabel("Instruction")
    .fill("State the business name when the customer asks who is responding.");
  await dialog.getByLabel("Priority").fill("10");
  await expect(dialog.getByRole("combobox", { name: "When this rule applies" })).toHaveText(
    "Always",
  );
  await dialog.getByRole("button", { name: "Create rule" }).click();
  const allRow = page.getByTestId("guidance-rule-guidance-all");
  await expect(allRow).toContainText("Always applies");

  expect(state.guidanceCreates[0].body.condition).toEqual({ kind: "ALL", conditions: [] });
  expect(state.guidanceCreates[0].body.requiredApproverRole).toBeNull();
  expect(state.guidanceCreates[0].body.effectiveUntil).toBeNull();
  expect(state.guidanceCreates[0].headers["idempotency-key"]).toMatch(/^kv2:/);

  await page.getByTestId("guidance-create").click();
  dialog = page.getByRole("dialog", { name: "New guidance rule" });
  await dialog.getByLabel("Title").fill("Protect exact pricing claims");
  await dialog
    .getByLabel("Instruction")
    .fill("Do not promise an exact final price before required details are confirmed.");
  await choose(page, "Rule type", "Prohibition");
  await choose(page, "Risk", "High");
  await choose(page, "When this rule applies", "Only when one condition matches");
  await choose(page, "Operator", "In");
  await dialog.getByLabel("Value").fill("pricing, discount");
  await dialog.getByLabel("Priority").fill("200");
  await dialog.getByRole("button", { name: "Create rule" }).click();
  await expect(
    dialog.getByText("High-risk rules need an expiry date in the future."),
  ).toBeVisible();
  await dialog.getByLabel("Effective until").fill(futureDate);
  await choose(page, "Required approver", "Admin");
  await dialog.getByRole("button", { name: "Create rule" }).click();

  const highRow = page.getByTestId("guidance-rule-guidance-high");
  await expect(highRow).toContainText("Intent In pricing, discount");
  await expect(highRow).toContainText("Admin");
  expect(state.guidanceCreates).toHaveLength(2);
  expect(state.guidanceCreates[1].body).toMatchObject({
    title: "Protect exact pricing claims",
    type: "PROHIBITION",
    condition: {
      kind: "PREDICATE",
      field: "INTENT",
      operator: "IN",
      value: ["pricing", "discount"],
    },
    priority: 200,
    riskLevel: "HIGH",
    requiredApproverRole: "ADMIN",
    effectiveUntil: "2030-12-31T23:59:59.999Z",
  });
  expect(state.guidanceCreates[1].body.tieBreakKey).toMatch(
    /^ui\.protect\.exact\.pricing\.claims\./,
  );

  await highRow.getByRole("button", { name: "Approve" }).click();
  await expect(highRow.getByText("Approved", { exact: true })).toBeVisible();
  expect(state.guidanceApprovals).toHaveLength(1);
  expect(state.guidanceApprovals[0].body).toEqual({
    note: "Approved in the Knowledge guidance editor.",
  });
  expect(state.guidanceApprovals[0].headers["if-match"]).toBe('"kv2-guidance-high-1"');
  expect(state.guidanceApprovals[0].headers["idempotency-key"]).toMatch(/^kv2:/);

  await highRow.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("dialog", { name: "Disable this rule?" })).toBeVisible();
  await page.getByRole("button", { name: "Disable rule" }).click();
  await expect(highRow.getByText("Disabled", { exact: true })).toBeVisible();
  expect(state.guidanceDisables).toHaveLength(1);
  expect(state.guidanceDisables[0].body).toEqual({
    note: "Disabled in the Knowledge guidance editor.",
  });
  expect(state.guidanceDisables[0].headers["if-match"]).toBe('"kv2-guidance-high-2"');
  expect(state.guidanceDisables[0].headers["idempotency-key"]).toMatch(/^kv2:/);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-guidance-controls-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Owner language settings retry a transient failure, save conditionally, then reload a conflict", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await authenticate(page);
  const state = await installEditorMocks(page, "OWNER");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await openAdvancedEditors(page);
  const panel = page.getByTestId("knowledge-language-settings");
  await expect(panel).toBeVisible();

  await choose(page, "Primary language", "Spanish");
  await expect(panel.getByText("Not saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByRole("button", { name: "Retry saving language settings" })).toBeVisible();
  expect(state.settingsUpdates).toHaveLength(1);
  expect(state.settingsUpdates[0].body).toEqual({
    defaultLocale: "es",
    supportedLocales: ["en", "fr", "es"],
  });
  expect(state.settingsUpdates[0].headers["if-match"]).toBe('"kv2-settings-1"');
  expect(state.settingsUpdates[0].headers["idempotency-key"]).toMatch(/^kv2:/);

  await panel.getByRole("button", { name: "Retry saving language settings" }).click();
  await expect(panel.getByText("Saved", { exact: true })).toBeVisible();
  expect(state.settingsUpdates).toHaveLength(2);
  expect(state.settingsUpdates[1].body).toEqual(state.settingsUpdates[0].body);
  expect(state.settingsUpdates[1].headers["if-match"]).toBe('"kv2-settings-1"');
  expect(state.settingsUpdates[1].headers["idempotency-key"]).toMatch(/^kv2:/);
  expect(state.settingsUpdates[1].headers["idempotency-key"]).not.toBe(
    state.settingsUpdates[0].headers["idempotency-key"],
  );

  await panel.getByText("German", { exact: true }).click();
  await expect(panel.getByText("Not saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(
    panel.getByText(
      "These language settings changed in another session. Reload before saving again.",
    ),
  ).toBeVisible();
  expect(state.settingsUpdates).toHaveLength(3);
  expect(state.settingsUpdates[2].headers["if-match"]).toBe('"kv2-settings-2"');
  expect(state.settingsUpdates[2].headers["idempotency-key"]).toMatch(/^kv2:/);
  expect(state.settingsUpdates[2].body).toEqual({
    defaultLocale: "es",
    supportedLocales: ["en", "fr", "es", "de"],
  });
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-settings-conflict-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  const getsBeforeReload = state.settingsGets;
  await panel.getByRole("button", { name: "Reload language settings" }).click();
  await expect(panel.getByRole("combobox", { name: "Primary language" })).toHaveText("French");
  await expect.poll(() => state.settingsGets).toBeGreaterThan(getsBeforeReload);
  await expect(panel.getByText("Not saved", { exact: true })).toHaveCount(0);
});

test("Manager sees language settings without mutation controls", async ({ page }) => {
  await authenticate(page);
  const state = await installEditorMocks(page, "MANAGER");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await openAdvancedEditors(page);
  const panel = page.getByTestId("knowledge-language-settings");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText("English", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Primary language" })).toHaveCount(0);

  const localeChecks = panel.getByRole("checkbox");
  await expect(localeChecks).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await expect(localeChecks.nth(index)).toBeDisabled();
  await page.waitForTimeout(900);
  expect(state.settingsUpdates).toHaveLength(0);
});
