import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  KnowledgeV2ConflictView,
  KnowledgeV2OverviewView,
  KnowledgeV2ReviewItemView,
} from "@leadvirt/types";
import { loginAsCleanUser, setCleanUserLocale, type QaLocale } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

interface CapturedMutation {
  pathname: string;
  body: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
}

interface ReviewMockState {
  items: KnowledgeV2ReviewItemView[];
  conflict: KnowledgeV2ConflictView;
  mutations: CapturedMutation[];
  conflictDismissOnce: boolean;
  failListOnce: boolean;
  canReview: boolean;
  canVerifyHighRisk: boolean;
}

function overview(state: ReviewMockState): KnowledgeV2OverviewView {
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 7,
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
        candidateVersion: 7,
        candidateManifestHash: "a".repeat(64),
        evaluationTestCaseSetHash: "d".repeat(64),
        itemCounts: {
          documentRevisions: 1,
          factVersions: 1,
          guidanceRuleVersions: 0,
          sourcePermissionSnapshots: 1,
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
      needsReviewCount: state.items.filter((item) => item.status === "OPEN").length,
      evaluatedAt: "2026-07-12T12:00:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: {
      sources: 1,
      facts: 1,
      guidanceRules: 0,
      reviewItems: state.items.length,
      failedJobs: 0,
    },
    recentJobs: [],
    permissions: {
      canViewRestricted: state.canReview,
      canEdit: state.canReview,
      canManageSettings: false,
      canVerifyHighRisk: state.canVerifyHighRisk,
      canPublish: false,
      canRollback: false,
    },
  };
}

function evidence(id: string, safeLabel: string, restricted = false) {
  return {
    evidence: {
      id,
      corpusKind: "STRUCTURED_V2" as const,
      evidenceKey: restricted ? null : `evidence:${id}`,
      targetType: "DOCUMENT_REVISION" as const,
      itemVersionHash: restricted ? null : `version:${id}`,
      documentRevisionId: restricted ? null : "revision-pricing",
      factVersionId: null,
      guidanceRuleVersionId: null,
      messageId: null,
      externalReferenceHash: null,
      safeLabel,
      locatorHash: null,
      isPublic: !restricted,
      confidence: 0.92,
      observedAt: "2026-07-12T11:45:00.000Z",
      expiresAt: null,
      permissionFingerprint: restricted ? null : "permission-public",
      hasRestrictedPayload: restricted,
      redacted: restricted,
      createdAt: "2026-07-12T11:46:00.000Z",
    },
    ordinal: 0,
    relevanceScore: 0.96,
  };
}

function reviewItems(): KnowledgeV2ReviewItemView[] {
  return [
    {
      id: "review-conflict",
      corpusKind: "STRUCTURED_V2",
      reviewKey: "review:pricing-conflict",
      reason: "CONFLICTING_VALUES",
      riskLevel: "MEDIUM",
      status: "OPEN",
      suggestedAction: "REVIEW_VALUE",
      safeTitle: "Conflicting consultation prices",
      safeSummary: "Two authorized website pages show different consultation prices.",
      hasRestrictedPayload: false,
      sourceId: "source-site",
      documentRevisionId: "revision-pricing",
      factId: "fact-consultation-price",
      guidanceRuleId: null,
      conflictId: "conflict-pricing",
      evaluationResultId: null,
      feedbackId: null,
      publicationId: null,
      createdBy: null,
      assignedTo: null,
      assignedAt: null,
      dueAt: "2026-07-13T12:00:00.000Z",
      freshnessDueAt: null,
      resolutionAction: null,
      resolutionSummaryHash: null,
      hasRestrictedResolution: false,
      resolvedBy: null,
      resolvedAt: null,
      evidence: [evidence("evidence-price", "Pricing page, revision 4")],
      etag: '"review-conflict:1"',
      generation: 1,
      allowedActions: ["CLAIM", "RESOLVE", "DISMISS"],
      createdAt: "2026-07-12T11:50:00.000Z",
      updatedAt: "2026-07-12T11:55:00.000Z",
    },
    {
      id: "review-sensitive",
      corpusKind: "STRUCTURED_V2",
      reviewKey: "review:sensitive-content",
      reason: "SENSITIVE_CONTENT",
      riskLevel: "HIGH",
      status: "OPEN",
      suggestedAction: "EXCLUDE_CONTENT",
      safeTitle: "Sensitive content requires verification",
      safeSummary: null,
      hasRestrictedPayload: true,
      sourceId: "source-site",
      documentRevisionId: "revision-sensitive",
      factId: null,
      guidanceRuleId: null,
      conflictId: null,
      evaluationResultId: null,
      feedbackId: null,
      publicationId: null,
      createdBy: null,
      assignedTo: { id: "user-reviewer", displayName: "Maya Chen" },
      assignedAt: "2026-07-12T11:57:00.000Z",
      dueAt: null,
      freshnessDueAt: null,
      resolutionAction: null,
      resolutionSummaryHash: null,
      hasRestrictedResolution: false,
      resolvedBy: null,
      resolvedAt: null,
      evidence: [evidence("evidence-sensitive", "Protected document excerpt", true)],
      etag: '"review-sensitive:1"',
      generation: 1,
      allowedActions: ["RESOLVE", "DISMISS"],
      createdAt: "2026-07-12T11:56:00.000Z",
      updatedAt: "2026-07-12T11:58:00.000Z",
    },
  ];
}

function conflict(): KnowledgeV2ConflictView {
  return {
    id: "conflict-pricing",
    corpusKind: "STRUCTURED_V2",
    conflictKey: "conflict:pricing",
    conflictType: "FACT_VALUE",
    semanticKey: "consultation.price",
    scope: null,
    scopeHash: "scope-public",
    effectiveFrom: null,
    effectiveUntil: null,
    severity: "MEDIUM",
    status: "OPEN",
    sourceId: "source-site",
    factId: "fact-consultation-price",
    guidanceRuleId: null,
    publicationId: null,
    candidateSetHash: "candidate-set-pricing",
    candidates: [
      {
        id: "candidate-one",
        candidateKey: "candidate:one",
        ordinal: 0,
        candidateType: "FACT_VERSION",
        itemVersionHash: "fact-version-one",
        documentRevisionId: "revision-pricing",
        factVersionId: "fact-version-one",
        guidanceRuleVersionId: null,
        candidateValueHash: "value-one",
        authorityFingerprint: "authority-one",
        extractionMethod: "website-parser",
        confidence: 0.94,
        scope: null,
        effectiveFrom: null,
        effectiveUntil: null,
        hasRestrictedValue: false,
        redacted: false,
        safeValue: "$100",
        evidence: [evidence("candidate-evidence-one", "Main pricing page")],
        createdAt: "2026-07-12T11:46:00.000Z",
      },
      {
        id: "candidate-two",
        candidateKey: null,
        ordinal: 1,
        candidateType: "DOCUMENT_REVISION",
        itemVersionHash: null,
        documentRevisionId: null,
        factVersionId: null,
        guidanceRuleVersionId: null,
        candidateValueHash: null,
        authorityFingerprint: null,
        extractionMethod: null,
        confidence: null,
        scope: null,
        effectiveFrom: null,
        effectiveUntil: null,
        hasRestrictedValue: true,
        redacted: true,
        safeValue: null,
        evidence: [evidence("candidate-evidence-two", "Restricted campaign page", true)],
        createdAt: "2026-07-12T11:47:00.000Z",
      },
    ],
    assignedTo: null,
    assignedAt: null,
    dueAt: null,
    resolution: null,
    resolutionRationaleHash: null,
    hasRestrictedResolution: false,
    resolvedBy: null,
    resolvedAt: null,
    etag: '"conflict-pricing:1"',
    generation: 1,
    allowedActions: ["CLAIM", "RESOLVE", "DISMISS"],
    detectedAt: "2026-07-12T11:48:00.000Z",
    createdAt: "2026-07-12T11:48:00.000Z",
    updatedAt: "2026-07-12T11:49:00.000Z",
  };
}

async function fulfill(
  route: Route,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
}

function capture(route: Route): CapturedMutation {
  const request = route.request();
  return {
    pathname: new URL(request.url()).pathname,
    body: request.postDataJSON(),
    ifMatch: request.headers()["if-match"],
    idempotencyKey: request.headers()["idempotency-key"],
  };
}

async function installMocks(
  page: Page,
  options: {
    empty?: boolean;
    conflictDismissOnce?: boolean;
    failListOnce?: boolean;
    canReview?: boolean;
    canVerifyHighRisk?: boolean;
  } = {},
) {
  const state: ReviewMockState = {
    items: options.empty ? [] : reviewItems(),
    conflict: conflict(),
    mutations: [],
    conflictDismissOnce: options.conflictDismissOnce ?? false,
    failListOnce: options.failListOnce ?? false,
    canReview: options.canReview ?? true,
    canVerifyHighRisk: options.canVerifyHighRisk ?? true,
  };

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await fulfill(route, { data: overview(state) });
      return;
    }
    if (pathname === "/api/knowledge/v2/review-items" && method === "GET") {
      if (state.failListOnce) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await fulfill(
          route,
          { error: { code: "REVIEW_UNAVAILABLE", message: "Review service unavailable." } },
          503,
        );
        return;
      }
      let items = state.items;
      const status = url.searchParams.get("status");
      const reason = url.searchParams.get("reason");
      const risk = url.searchParams.get("riskLevel");
      const query = url.searchParams.get("query")?.toLowerCase();
      if (status) items = items.filter((item) => item.status === status);
      if (reason) items = items.filter((item) => item.reason === reason);
      if (risk) items = items.filter((item) => item.riskLevel === risk);
      if (query) {
        items = items.filter(
          (item) =>
            item.safeTitle.toLowerCase().includes(query) ||
            item.safeSummary?.toLowerCase().includes(query),
        );
      }
      await fulfill(route, {
        data: {
          items,
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }

    const reviewMatch = pathname.match(/^\/api\/knowledge\/v2\/review-items\/([^/]+)$/);
    if (reviewMatch && method === "GET") {
      const item = state.items.find((entry) => entry.id === reviewMatch[1]);
      if (!item) {
        await fulfill(
          route,
          { error: { code: "NOT_FOUND", message: "Review item not found." } },
          404,
        );
        return;
      }
      await fulfill(route, { data: item }, 200, { etag: item.etag });
      return;
    }

    const actionMatch = pathname.match(
      /^\/api\/knowledge\/v2\/review-items\/([^/]+)\/(assign|resolve|dismiss)$/,
    );
    if (actionMatch && method === "POST") {
      state.mutations.push(capture(route));
      const item = state.items.find((entry) => entry.id === actionMatch[1])!;
      const action = actionMatch[2];
      if (action === "dismiss" && state.conflictDismissOnce) {
        state.conflictDismissOnce = false;
        item.safeSummary = "The server received newer security review metadata.";
        item.etag = '"review-sensitive:2"';
        item.generation = 2;
        await fulfill(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This review item changed after it was loaded.",
              details: { currentEtag: item.etag },
            },
          },
          412,
        );
        return;
      }
      if (action === "assign") {
        item.status = "ASSIGNED";
        item.assignedTo = { id: "current-user", displayName: "Current reviewer" };
        item.allowedActions = ["RESOLVE", "DISMISS"];
      } else if (action === "resolve") {
        item.status = "RESOLVED";
        item.resolutionAction = (
          request.postDataJSON() as { action: KnowledgeV2ReviewItemView["resolutionAction"] }
        ).action;
        item.allowedActions = [];
      } else {
        item.status = "DISMISSED";
        item.resolutionAction = "DISMISS";
        item.allowedActions = [];
      }
      item.etag = `"${item.id}:${item.generation + 1}"`;
      item.generation += 1;
      item.updatedAt = "2026-07-12T12:05:00.000Z";
      await fulfill(route, { data: { resource: item, idempotencyReplayed: false } }, 200, {
        etag: item.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/conflicts/conflict-pricing" && method === "GET") {
      await fulfill(route, { data: state.conflict }, 200, { etag: state.conflict.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/conflicts/conflict-pricing/assign" && method === "POST") {
      state.mutations.push(capture(route));
      state.conflict.status = "IN_REVIEW";
      state.conflict.assignedTo = { id: "current-user", displayName: "Current reviewer" };
      state.conflict.allowedActions = ["RESOLVE", "DISMISS"];
      state.conflict.etag = '"conflict-pricing:2"';
      await fulfill(
        route,
        { data: { resource: state.conflict, idempotencyReplayed: false } },
        200,
        { etag: state.conflict.etag },
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/conflicts/conflict-pricing/resolve" && method === "POST") {
      state.mutations.push(capture(route));
      state.conflict.status = "RESOLVED";
      state.conflict.resolution = (
        request.postDataJSON() as { resolution: KnowledgeV2ConflictView["resolution"] }
      ).resolution;
      state.conflict.allowedActions = [];
      state.conflict.etag = '"conflict-pricing:3"';
      await fulfill(
        route,
        { data: { resource: state.conflict, idempotencyReplayed: false } },
        200,
        { etag: state.conflict.etag },
      );
      return;
    }

    await fulfill(
      route,
      { error: { code: "UNMOCKED", message: `${method} ${pathname} is not mocked.` } },
      500,
    );
  });

  return state;
}

async function openReview(page: Page, locale: QaLocale = "en") {
  await setCleanUserLocale(page, apiBase, locale);
  await page.goto(`${webBase}/app/knowledge?view=review`);
  await expect(page.getByTestId("knowledge-review-queue")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("reviewers inspect provenance, claim work, and resolve linked conflicts with mutation guards", async ({
  page,
}) => {
  const state = await installMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReview(page);

  await expect(page.getByTestId("knowledge-review-list")).toContainText(
    "Conflicting consultation prices",
  );
  await expect(page.getByTestId("knowledge-review-detail")).toContainText(
    "Pricing page, revision 4",
  );
  await expect(page.getByTestId("knowledge-review-conflict")).toContainText("Candidate 2");
  await expect(page.getByTestId("knowledge-review-conflict")).toContainText(
    "Candidate value is restricted",
  );

  await page.getByTestId("knowledge-review-claim").click();
  await expect(page.getByTestId("knowledge-review-notice")).toContainText("Review item claimed");
  await page.getByTestId("knowledge-conflict-resolve").click();
  await page
    .getByTestId("knowledge-review-rationale")
    .fill("The main pricing page is authoritative.");
  await page.getByTestId("knowledge-review-confirm-decision").click();
  await expect(page.getByTestId("knowledge-review-notice")).toContainText(
    "Conflict resolution saved",
  );

  expect(state.mutations).toHaveLength(2);
  expect(state.mutations[0]).toMatchObject({
    pathname: "/api/knowledge/v2/review-items/review-conflict/assign",
    body: {},
    ifMatch: '"review-conflict:1"',
  });
  expect(state.mutations[1]).toMatchObject({
    pathname: "/api/knowledge/v2/conflicts/conflict-pricing/resolve",
    body: {
      resolution: "MARK_UNANSWERABLE",
      rationale: "The main pricing page is authoritative.",
    },
    ifMatch: '"conflict-pricing:1"',
  });
  expect(state.mutations.every((entry) => Boolean(entry.idempotencyKey))).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-review-desktop.png",
    fullPage: true,
  });
});

test("dismissal keeps rationale through a 412 reload and retries against the latest ETag", async ({
  page,
}) => {
  const state = await installMocks(page, { conflictDismissOnce: true });
  await openReview(page);
  await page.getByTestId("knowledge-review-item-review-sensitive").click();
  await expect(page.getByTestId("knowledge-review-detail")).toContainText(
    "Restricted content hidden",
  );

  await page.getByTestId("knowledge-review-dismiss").click();
  const rationale = "Verified as an expected security scanner false positive.";
  await page.getByTestId("knowledge-review-rationale").fill(rationale);
  await page.getByTestId("knowledge-review-confirm-decision").click();

  await expect(page.getByRole("dialog")).toContainText("changed in another session");
  await expect(page.getByTestId("knowledge-review-rationale")).toHaveValue(rationale);
  await expect(page.getByRole("dialog")).toContainText(
    "The server received newer security review metadata",
  );
  await page.getByTestId("knowledge-review-confirm-decision").click();
  await expect(page.getByTestId("knowledge-review-notice")).toContainText(
    "dismissed with rationale",
  );

  const dismissals = state.mutations.filter((entry) => entry.pathname.endsWith("/dismiss"));
  expect(dismissals).toHaveLength(2);
  expect(dismissals.map((entry) => entry.body)).toEqual([{ rationale }, { rationale }]);
  expect(dismissals.map((entry) => entry.ifMatch)).toEqual([
    '"review-sensitive:1"',
    '"review-sensitive:2"',
  ]);
  expect(dismissals[0]?.idempotencyKey).not.toBe(dismissals[1]?.idempotencyKey);
});

test("review loading, errors, retry, and an empty queue are explicit", async ({ page }) => {
  const state = await installMocks(page, { empty: true, failListOnce: true });
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await page.goto(`${webBase}/app/knowledge?view=review`);

  await expect(page.getByText("Loading review queue...")).toBeVisible();
  await expect(page.getByText("Review service unavailable.")).toBeVisible();
  state.failListOnce = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Nothing needs review")).toBeVisible();
});

test("restricted review actions are clear and the localized mobile view does not overflow", async ({
  page,
}) => {
  await installMocks(page, { canReview: false, canVerifyHighRisk: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page, "ru");

  const mobileReviewTargetHeights = await page
    .getByTestId("knowledge-review-queue")
    .locator('input[aria-label], button[role="combobox"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter(({ height, width }) => height > 0 && width > 0)
        .map(({ height }) => height),
    );
  expect(mobileReviewTargetHeights).toHaveLength(4);
  expect(Math.min(...mobileReviewTargetHeights)).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("Решения по проверке ограничены")).toBeVisible();
  await page.getByTestId("knowledge-review-item-review-sensitive").click();
  await expect(
    page.getByText("Для решений высокого риска нужен владелец или уполномоченный проверяющий."),
  ).toBeVisible();
  await expect(page.getByTestId("knowledge-review-resolve")).toBeDisabled();
  const viewport = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.viewport + 1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-review-mobile.png",
    fullPage: true,
  });
});
