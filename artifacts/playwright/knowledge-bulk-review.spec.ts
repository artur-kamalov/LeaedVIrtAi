import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  KnowledgeV2BulkReviewExecuteRequest,
  KnowledgeV2BulkReviewPreviewRequest,
  KnowledgeV2OverviewView,
  KnowledgeV2ReviewItemView,
} from "@leadvirt/types";
import { loginAsCleanUser, setCleanUserLocale, type QaLocale } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

interface BulkMockState {
  items: KnowledgeV2ReviewItemView[];
  canBulkReview: boolean;
  previewRequests: KnowledgeV2BulkReviewPreviewRequest[];
  executeRequests: Array<{ body: KnowledgeV2BulkReviewExecuteRequest; idempotencyKey?: string }>;
  listRequests: number;
  executeFailure?: "stale" | "expired";
  executeDelayMs: number;
}

function item(id: string, title: string, sourceId: string): KnowledgeV2ReviewItemView {
  return {
    id,
    corpusKind: "STRUCTURED_V2",
    reviewKey: `review:${id}`,
    reason: "LOW_CONFIDENCE_CONTENT",
    riskLevel: "LOW",
    status: "OPEN",
    suggestedAction: "APPROVE",
    safeTitle: title,
    safeSummary: "Verify the extracted business detail.",
    hasRestrictedPayload: false,
    sourceId,
    documentRevisionId: null,
    factId: `fact-${id}`,
    guidanceRuleId: null,
    conflictId: null,
    evaluationResultId: null,
    feedbackId: null,
    publicationId: null,
    createdBy: null,
    assignedTo: null,
    assignedAt: null,
    dueAt: null,
    freshnessDueAt: null,
    resolutionAction: null,
    resolutionSummaryHash: null,
    hasRestrictedResolution: false,
    resolvedBy: null,
    resolvedAt: null,
    evidence: [],
    etag: `"${id}:1"`,
    generation: 1,
    allowedActions: ["CLAIM", "RESOLVE", "DISMISS"],
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:00:00.000Z",
  };
}

function overview(state: BulkMockState): KnowledgeV2OverviewView {
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 1,
      candidateManifestHash: "a".repeat(64),
      activePublicationId: null,
      activePublicationSequence: null,
      status: "NEEDS_REVIEW",
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
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      draft: {
        status: "CHANGES_PENDING",
        candidateId: "workspace-v2",
        candidateVersion: 1,
        candidateManifestHash: "a".repeat(64),
        evaluationTestCaseSetHash: "d".repeat(64),
        itemCounts: {
          documentRevisions: 0,
          factVersions: 3,
          guidanceRuleVersions: 0,
          sourcePermissionSnapshots: 2,
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
      needsReviewCount: state.items.filter((entry) => entry.status === "OPEN").length,
      evaluatedAt: "2026-07-13T01:00:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: {
      sources: 2,
      facts: 3,
      guidanceRules: 0,
      reviewItems: state.items.length,
      failedJobs: 0,
    },
    recentJobs: [],
    permissions: {
      canViewRestricted: true,
      canEdit: true,
      canManageSettings: state.canBulkReview,
      canVerifyHighRisk: state.canBulkReview,
      canPublish: false,
      canRollback: false,
    },
  };
}

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function installMocks(
  page: Page,
  options: {
    canBulkReview?: boolean;
    executeFailure?: "stale" | "expired";
    executeDelayMs?: number;
  } = {},
) {
  const state: BulkMockState = {
    items: [
      item("bulk-one", "Consultation duration", "source-primary"),
      item("bulk-two", "Service availability", "source-primary"),
      item("bulk-mixed", "Remote support region", "source-secondary"),
    ],
    canBulkReview: options.canBulkReview ?? true,
    previewRequests: [],
    executeRequests: [],
    listRequests: 0,
    executeFailure: options.executeFailure,
    executeDelayMs: options.executeDelayMs ?? 0,
  };

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await fulfill(route, { data: overview(state) });
      return;
    }
    if (pathname === "/api/knowledge/v2/review-items" && method === "GET") {
      state.listRequests += 1;
      await fulfill(route, {
        data: {
          items: state.items,
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/review-items/bulk-resolve/preview" && method === "POST") {
      const body = request.postDataJSON() as KnowledgeV2BulkReviewPreviewRequest;
      state.previewRequests.push(body);
      const mixed = body.itemIds.includes("bulk-mixed");
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await fulfill(route, {
        data: {
          eligible: !mixed,
          action: body.action,
          sourceId: "source-primary",
          reason: "LOW_CONFIDENCE_CONTENT",
          targetSchemaHash: "schema-text",
          previewHash: mixed ? null : "a".repeat(64),
          expiresAt: mixed ? null : expiresAt,
          items: body.itemIds.map((id) => {
            const current = state.items.find((entry) => entry.id === id)!;
            return {
              id,
              etag: current.etag,
              generation: current.generation,
              eligible: id !== "bulk-mixed",
              reasons: id === "bulk-mixed" ? ["SOURCE_MISMATCH"] : [],
            };
          }),
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/review-items/bulk-resolve" && method === "POST") {
      const body = request.postDataJSON() as KnowledgeV2BulkReviewExecuteRequest;
      state.executeRequests.push({
        body,
        idempotencyKey: request.headers()["idempotency-key"],
      });
      if (state.executeDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, state.executeDelayMs));
      }
      if (state.executeFailure === "stale") {
        state.items[0]!.etag = '"bulk-one:2"';
        state.items[0]!.generation = 2;
        await fulfill(
          route,
          { error: { code: "REVISION_CONFLICT", message: "Review item changed." } },
          412,
        );
        return;
      }
      if (state.executeFailure === "expired") {
        await fulfill(
          route,
          {
            error: {
              code: "KNOWLEDGE_CONFLICT_BULK_REVIEW_PREVIEW_EXPIRED",
              message: "Preview expired.",
            },
          },
          409,
        );
        return;
      }
      for (const selected of body.items) {
        const current = state.items.find((entry) => entry.id === selected.id)!;
        current.status = "RESOLVED";
        current.resolutionAction = body.action;
        current.allowedActions = [];
        current.generation += 1;
        current.etag = `"${current.id}:${current.generation}"`;
      }
      await fulfill(route, {
        data: {
          resource: {
            batchHash: "batch-hash",
            items: body.items.map((selected) => {
              const current = state.items.find((entry) => entry.id === selected.id)!;
              return { id: current.id, etag: current.etag, generation: current.generation };
            }),
          },
          idempotencyReplayed: false,
        },
      });
      return;
    }
    const detail = pathname.match(/^\/api\/knowledge\/v2\/review-items\/([^/]+)$/);
    if (detail && method === "GET") {
      const current = state.items.find((entry) => entry.id === detail[1]);
      await fulfill(
        route,
        current ? { data: current } : { error: { code: "NOT_FOUND" } },
        current ? 200 : 404,
      );
      return;
    }
    await fulfill(route, { error: { code: "UNMOCKED", message: `${method} ${pathname}` } }, 500);
  });
  return state;
}

async function openReview(page: Page, locale: QaLocale = "en") {
  await setCleanUserLocale(page, apiBase, locale);
  await page.goto(`${webBase}/app/knowledge?view=review`);
  await expect(page.getByTestId("knowledge-review-queue")).toBeVisible();
}

async function selectItems(page: Page, ...ids: string[]) {
  for (const id of ids) await page.getByTestId(`knowledge-review-bulk-checkbox-${id}`).check();
}

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("eligible bulk review waits for confirmation and server success", async ({ page }) => {
  const state = await installMocks(page, { executeDelayMs: 350 });
  await openReview(page);
  await selectItems(page, "bulk-one", "bulk-two");
  await page.getByTestId("knowledge-review-bulk-preview").click();
  await expect(page.getByTestId("knowledge-review-bulk-modal")).toContainText("Eligible: 2");
  await page.getByTestId("knowledge-review-bulk-confirm").click();
  await expect(page.getByTestId("knowledge-review-item-bulk-one")).toContainText("Open");
  await expect(page.getByTestId("knowledge-review-notice")).toContainText(
    "Bulk decision saved for 2 items",
  );
  expect(state.previewRequests[0]).toEqual({
    itemIds: ["bulk-one", "bulk-two"],
    action: "APPROVE",
  });
  expect(state.executeRequests[0]?.body).toMatchObject({
    action: "APPROVE",
    previewHash: "a".repeat(64),
    items: [
      { id: "bulk-one", etag: '"bulk-one:1"' },
      { id: "bulk-two", etag: '"bulk-two:1"' },
    ],
  });
  expect(state.executeRequests[0]?.idempotencyKey).toBeTruthy();
});

test("mixed preview explains rejection and retains explicit selection", async ({ page }) => {
  const state = await installMocks(page);
  await openReview(page);
  await selectItems(page, "bulk-one", "bulk-mixed");
  const listBefore = state.listRequests;
  await page.getByTestId("knowledge-review-bulk-preview").click();
  await expect(page.getByTestId("knowledge-review-bulk-modal")).toContainText("Blocked: 1");
  await expect(page.getByTestId("knowledge-review-bulk-modal")).toContainText(
    "Selected items use different sources",
  );
  await expect(page.getByTestId("knowledge-review-bulk-confirm")).toHaveCount(0);
  await expect(page.getByTestId("knowledge-review-bulk-checkbox-bulk-one")).toBeChecked();
  await expect(page.getByTestId("knowledge-review-bulk-checkbox-bulk-mixed")).toBeChecked();
  expect(state.listRequests).toBeGreaterThan(listBefore);
});

for (const failure of ["stale", "expired"] as const) {
  test(`${failure} execution reloads state without clearing selection`, async ({ page }) => {
    const state = await installMocks(page, { executeFailure: failure });
    await openReview(page);
    await selectItems(page, "bulk-one", "bulk-two");
    await page.getByTestId("knowledge-review-bulk-preview").click();
    const listBefore = state.listRequests;
    await page.getByTestId("knowledge-review-bulk-confirm").click();
    await expect(page.getByTestId("knowledge-review-bulk-error")).toContainText(
      failure === "stale" ? "current server state was reloaded" : "preview expired",
    );
    await expect(page.getByTestId("knowledge-review-bulk-checkbox-bulk-one")).toBeChecked();
    await expect(page.getByTestId("knowledge-review-bulk-checkbox-bulk-two")).toBeChecked();
    expect(state.listRequests).toBeGreaterThan(listBefore);
    expect(state.items.filter((entry) => entry.status === "RESOLVED")).toHaveLength(0);
  });
}

test("bulk controls are hidden from managers", async ({ page }) => {
  await installMocks(page, { canBulkReview: false });
  await openReview(page);
  await expect(page.getByTestId("knowledge-review-bulk-toolbar")).toHaveCount(0);
  await expect(page.locator('[data-testid^="knowledge-review-bulk-checkbox-"]')).toHaveCount(0);
});

test("remount discards the local selection and preview capability", async ({ page }) => {
  await installMocks(page);
  await openReview(page);
  await selectItems(page, "bulk-one");
  await expect(page.getByTestId("knowledge-review-bulk-toolbar")).toContainText("1 of 50 selected");
  await page.goto(`${webBase}/app/knowledge?view=overview`);
  await page.goto(`${webBase}/app/knowledge?view=review`);
  await expect(page.getByTestId("knowledge-review-bulk-toolbar")).toContainText("0 of 50 selected");
  await expect(page.getByTestId("knowledge-review-bulk-preview")).toBeDisabled();
});

test("bulk controls are localized in six locales and do not overflow mobile", async ({ page }) => {
  test.setTimeout(90_000);
  await installMocks(page);
  const labels = {
    en: "Bulk review",
    ru: "Массовая проверка",
    es: "Revisión en lote",
    fr: "Vérification groupée",
    de: "Sammelprüfung",
    pt: "Revisão em lote",
  } as const;
  for (const [locale, label] of Object.entries(labels)) {
    await openReview(page, locale);
    await expect(page.getByTestId("knowledge-review-bulk-toolbar")).toContainText(label);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page, "pt");
  await selectItems(page, "bulk-one", "bulk-two");
  await page.getByTestId("knowledge-review-bulk-preview").click();
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
});
