import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "ru" },
  });
  expect(localeResponse.ok()).toBeTruthy();
  await context.addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
});

type WorkflowRequestStep = {
  id?: string;
  type?: string;
  name?: string;
  positionX?: number;
  positionY?: number;
  config?: { blockType?: string; enabled?: boolean; keywordFilter?: string };
};

type WorkflowRequest = {
  name?: string;
  description?: string;
  status?: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED";
  steps?: WorkflowRequestStep[];
};

function workflow(name = "API Workflow", status: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED" = "ACTIVE") {
  return {
    id: "wf-1",
    tenantId: "tenant-demo",
    name,
    description: "Workflow from Playwright API",
    status,
    version: 1,
    publishedAt: status === "ACTIVE" ? "2026-06-22T10:00:00.000Z" : null,
    steps: [
      {
        id: "step-trigger",
        workflowId: "wf-1",
        type: "TRIGGER",
        name: "API trigger",
        positionX: 80,
        positionY: 120,
        config: { channel: "any", keywordFilter: "seed" }
      },
      {
        id: "step-condition",
        workflowId: "wf-1",
        type: "CONDITION",
        name: "API condition",
        positionX: 320,
        positionY: 120,
        config: { blockType: "condition", rules: [] }
      },
      {
        id: "step-end",
        workflowId: "wf-1",
        type: "END",
        name: "API end",
        positionX: 560,
        positionY: 120,
        config: { blockType: "end" }
      }
    ]
  };
}

function createdWorkflow(body: WorkflowRequest, status: "ACTIVE" | "PAUSED" = "ACTIVE") {
  return {
    ...workflow(body.name ?? "Created Workflow", status),
    id: "wf-created",
    name: body.name ?? "Created Workflow",
    description: body.description ?? "Created from Playwright",
    status,
    publishedAt: status === "ACTIVE" ? "2026-06-23T10:00:00.000Z" : null,
    steps: (body.steps ?? []).map((step, index) => ({
      id: `created-step-${index}`,
      workflowId: "wf-created",
      type: step.type ?? "AI_MESSAGE",
      name: step.name ?? `Created step ${index + 1}`,
      positionX: step.positionX ?? 80 + index * 240,
      positionY: step.positionY ?? 120,
      config: step.config ?? {}
    }))
  };
}

function archivedWorkflow() {
  const base = workflow("Archived Workflow", "ARCHIVED");
  return {
    ...base,
    id: "wf-archived",
    steps: base.steps.map((step, index) => ({
      ...step,
      id: `archived-step-${index}`,
      workflowId: "wf-archived"
    }))
  };
}

function unsupportedWorkflow() {
  const base = workflow("Legacy unsupported workflow", "ACTIVE");
  return {
    ...base,
    execution: {
      executable: false,
      issues: [
        {
          code: "UNSUPPORTED_STEP",
          stepId: "step-ai",
          stepName: "Legacy AI action",
          stepType: "AI_MESSAGE",
          message: "AI message delivery is not implemented for workflows."
        }
      ]
    },
    steps: [
      base.steps[0],
      {
        id: "step-ai",
        workflowId: "wf-1",
        type: "AI_MESSAGE",
        name: "Legacy AI action",
        positionX: 320,
        positionY: 120,
        config: { blockType: "ai", enabled: true }
      },
      base.steps[2]
    ]
  };
}

test("automation page shows workflow status badges", async ({ page }) => {
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({
      json: {
        data: [
          workflow("Active Workflow", "ACTIVE"),
          workflow("Draft Workflow", "DRAFT"),
          workflow("Paused Workflow", "PAUSED")
        ]
      }
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: /Active Workflow\s+Активен/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Draft Workflow\s+Черновик/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Paused Workflow\s+Пауза/ })).toBeVisible();
  await expect(page.getByText("Активен").first()).toBeVisible();
});

test("automation page blocks unsupported legacy actions instead of presenting them as runnable", async ({ page }) => {
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({ json: { data: [unsupportedWorkflow()] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("automation-runtime-blocked")).toBeVisible();
  await expect(page.getByText("Заблокирован").first()).toBeVisible();
  await expect(page.getByText("Только черновик").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Тест$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Сохранить$/ })).toBeDisabled();

  await page.getByRole("button", { name: "Выключить сценарий", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Сохранить/ })).toBeEnabled();
});

test("automation page saves, publishes, and tests API workflows", async ({ page }) => {
  let patchedName = "";
  let patchedStatus = "";
  let patchedSteps: { id?: string; name?: string; type?: string; config?: { blockType?: string; enabled?: boolean; keywordFilter?: string } }[] = [];
  let published = false;
  let tested = false;

  await page.route("**/api/workflows/wf-1/test", async (route) => {
    tested = true;
    await route.fulfill({
      json: {
        data: {
          runId: "run-playwright",
          status: "COMPLETED",
          message: "Playwright workflow test completed"
        }
      }
    });
  });

  await page.route("**/api/workflows/wf-1/publish", async (route) => {
    published = true;
    await route.fulfill({ json: { data: workflow("API Workflow Updated", "ACTIVE") } });
  });

  await page.route("**/api/workflows/wf-1", async (route) => {
    const body = route.request().postDataJSON() as {
      name?: string;
      status?: string;
      steps?: { id?: string; name?: string; type?: string; config?: { blockType?: string; enabled?: boolean; keywordFilter?: string } }[];
    };
    patchedName = body.name ?? "";
    patchedStatus = body.status ?? "";
    patchedSteps = body.steps ?? [];
    await route.fulfill({ json: { data: workflow(patchedName, body.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE") } });
  });

  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({ json: { data: [workflow()] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "API Workflow" })).toBeVisible();
  await expect(page.getByText("API trigger").first()).toBeVisible();
  await expect(page.getByText("Несохранено")).toHaveCount(0);
  const keywordFilter = page.getByPlaceholder("Оставьте пустым для всех сообщений");
  await expect(keywordFilter).toHaveValue("seed");
  await keywordFilter.fill("vip");
  await expect(keywordFilter).toHaveValue("vip");
  await expect(page.getByText("Несохранено")).toBeVisible();

  await page.getByRole("button", { name: /^Тест$/ }).click();
  await expect.poll(() => tested).toBe(true);
  await expect(page.getByText("Проверка сценария завершена")).toBeVisible();
  await expect(page.getByText("run-playwright")).toHaveCount(0);

  await page.getByRole("button", { name: "Передать менеджеру", exact: true }).click();
  await expect(page.getByText("Передать менеджеру").first()).toBeVisible();

  await page.getByLabel("Название сценария").fill("API Workflow Updated");
  await page.getByRole("button", { name: /^Сохранить изменения$/ }).click();

  await expect.poll(() => patchedName).toBe("API Workflow Updated");
  await expect.poll(() => patchedSteps.length).toBeGreaterThan(3);
  expect(patchedSteps.some((step) => step.name === "Передать менеджеру" && step.type === "HANDOFF" && step.config?.blockType === "handoff")).toBe(true);
  expect(patchedSteps.find((step) => step.id === "step-trigger")?.config?.keywordFilter).toBe("vip");
  await expect.poll(() => published).toBe(true);
  await expect(page.getByLabel("Название сценария")).toHaveValue("API Workflow Updated");
  await expect(page.getByText("Несохранено")).toHaveCount(0);

  await page.getByRole("button", { name: /^Архив$/ }).click();
  await expect.poll(() => patchedStatus).toBe("ARCHIVED");
  await expect(page.getByLabel("Название сценария")).toHaveValue("Сценарий 1");
});

test("automation page creates an API workflow from a copied scenario tab", async ({ page }) => {
  let createdBody: WorkflowRequest | null = null;
  let publishedCreated = false;

  await page.route("**/api/workflows/wf-created/publish", async (route) => {
    publishedCreated = true;
    await route.fulfill({ json: { data: createdWorkflow(createdBody ?? {}, "ACTIVE") } });
  });

  await page.route("**/api/workflows", async (route) => {
    if (route.request().method() === "POST") {
      createdBody = route.request().postDataJSON() as WorkflowRequest;
      await route.fulfill({ json: { data: createdWorkflow(createdBody, "PAUSED") } });
      return;
    }

    await route.fulfill({ json: { data: [workflow()] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "API Workflow" })).toBeVisible();
  await page.getByRole("button", { name: "Сценарий 2" }).click();
  await expect(page.getByLabel("Название сценария")).toHaveValue("Сценарий 2");

  await page.getByRole("button", { name: /^Сохранить$/ }).click();

  await expect.poll(() => createdBody?.name).toBe("Сценарий 2");
  await expect.poll(() => createdBody?.steps?.length ?? 0).toBeGreaterThan(0);
  expect(createdBody?.steps?.some((step) => typeof step.id === "string")).toBe(false);
  expect(createdBody?.steps?.[0]?.type).toBe("TRIGGER");
  expect(createdBody?.steps?.[0]?.config?.blockType).toBe("trigger");
  expect(publishedCreated).toBe(false);
  await expect(page.getByLabel("Название сценария")).toHaveValue("Сценарий 2");
});

test("automation page duplicates the current API workflow through create API", async ({ page }) => {
  let duplicatedBody: WorkflowRequest | null = null;
  let publishedDuplicate = false;

  await page.route("**/api/workflows/wf-created/publish", async (route) => {
    publishedDuplicate = true;
    await route.fulfill({ json: { data: createdWorkflow(duplicatedBody ?? {}, "ACTIVE") } });
  });

  await page.route("**/api/workflows", async (route) => {
    if (route.request().method() === "POST") {
      duplicatedBody = route.request().postDataJSON() as WorkflowRequest;
      await route.fulfill({ json: { data: createdWorkflow(duplicatedBody, "PAUSED") } });
      return;
    }

    await route.fulfill({ json: { data: [workflow("Workflow For Duplicate")] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByLabel("Название сценария")).toHaveValue("Workflow For Duplicate");
  await page.getByRole("button", { name: /^Дублировать$/ }).click();

  await expect.poll(() => duplicatedBody?.name).toBe("Workflow For Duplicate (копия)");
  await expect.poll(() => duplicatedBody?.status).toBe("PAUSED");
  await expect.poll(() => duplicatedBody?.steps?.length ?? 0).toBeGreaterThan(0);
  expect(duplicatedBody?.steps?.some((step) => typeof step.id === "string")).toBe(false);
  expect(publishedDuplicate).toBe(false);
  await expect(page.getByLabel("Название сценария")).toHaveValue("Workflow For Duplicate (копия)");
  await expect(page.getByText("Пауза").first()).toBeVisible();
});

test("automation editor stays usable and honest on mobile", async ({ page }) => {
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({ json: { data: [workflow("Mobile Workflow")] } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  const blockToggle = page.getByRole("button", { name: "Выключить блок" }).first();
  await expect(blockToggle).toHaveAttribute("aria-pressed", "true");
  await blockToggle.click();
  await expect(page.getByRole("button", { name: "Включить блок" }).first()).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Несохранено")).toBeVisible();

  const warningBox = await page.getByTestId("automation-runtime-blocked").boundingBox();
  const firstBlockBox = await page.getByRole("group", { name: "API trigger" }).boundingBox();
  expect(firstBlockBox?.y ?? 0).toBeGreaterThanOrEqual((warningBox?.y ?? 0) + (warningBox?.height ?? 0));

  const testButton = page.getByRole("button", { name: /^Тест$/ });
  const testButtonBox = await testButton.boundingBox();
  expect(testButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("Перетащить блок")).toHaveCount(0);
  await expect(page.getByText(/\{\{variable\}\}/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.screenshot({
    path: "artifacts/playwright/automation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("automation page restores an archived workflow into the builder", async ({ page }) => {
  let restoreStatus = "";
  let requestedArchivedList = false;

  await page.route("**/api/workflows/wf-archived", async (route) => {
    const body = route.request().postDataJSON() as WorkflowRequest;
    restoreStatus = body.status ?? "";
    await route.fulfill({
      json: {
        data: {
          ...archivedWorkflow(),
          status: "PAUSED"
        }
      }
    });
  });

  await page.route("**/api/workflows?*", async (route) => {
    requestedArchivedList = new URL(route.request().url()).searchParams.get("includeArchived") === "true";
    await route.fulfill({ json: { data: [workflow("Visible Workflow"), archivedWorkflow()] } });
  });

  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({ json: { data: [workflow("Visible Workflow")] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByLabel("Название сценария")).toHaveValue("Visible Workflow");
  await page.getByRole("button", { name: /^Архивные$/ }).click();
  await expect.poll(() => requestedArchivedList).toBe(true);
  await expect(page.getByText("Archived Workflow")).toBeVisible();
  await expect(page.getByText(/версия/i)).toHaveCount(0);
  await page.getByRole("button", { name: /^Восстановить$/ }).click();

  await expect.poll(() => restoreStatus).toBe("PAUSED");
  await expect(page.getByLabel("Название сценария")).toHaveValue("Archived Workflow");
  await expect(page.getByText("Восстановлен").first()).toBeVisible();
});

test("automation load failures are retryable and never become empty drafts", async ({ page }) => {
  let failLoad = true;

  await page.route("**/api/workflows", async (route) => {
    if (failLoad) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: [workflow("Recovered Workflow")] } });
  });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("automation-load-error")).toBeVisible();
  await expect(page.getByTestId("automation-editor")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/playwright/automation-load-error.png",
    fullPage: true,
    animations: "disabled",
  });

  failLoad = false;
  await page.getByTestId("automation-load-error").getByRole("button").click();

  await expect(page.getByText("Recovered Workflow")).toBeVisible();
  await expect(page.getByTestId("automation-load-error")).toHaveCount(0);
});

test("archived workflow failures are not presented as an empty archive", async ({ page }) => {
  let failArchive = true;

  await page.route("**/api/workflows?*", async (route) => {
    if (failArchive) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary archive outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: [workflow("Visible Workflow"), archivedWorkflow()] } });
  });
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({ json: { data: [workflow("Visible Workflow")] } });
  });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "networkidle" });
  await page.getByTestId("automation-open-archive").click();

  const archiveDialog = page.getByRole("dialog", { name: "Архивные сценарии" });
  await expect(archiveDialog.getByTestId("automation-archive-load-error")).toBeVisible();
  await expect(archiveDialog.getByText("Archived Workflow", { exact: true })).toHaveCount(0);

  failArchive = false;
  await archiveDialog.getByTestId("automation-archive-load-error").getByRole("button").click();

  await expect(archiveDialog.getByText("Archived Workflow", { exact: true })).toBeVisible();
  await expect(archiveDialog.getByTestId("automation-archive-load-error")).toHaveCount(0);
});

