import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
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
        id: "step-question",
        workflowId: "wf-1",
        type: "QUESTION",
        name: "API qualification",
        positionX: 320,
        positionY: 120,
        config: { requiredFields: ["name", "phone"] }
      },
      {
        id: "step-action",
        workflowId: "wf-1",
        type: "ACTION",
        name: "API CRM action",
        positionX: 560,
        positionY: 120,
        config: { action: "crm" }
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
  await page.getByRole("button", { name: "Добавить блок" }).click();
  await expect(page.getByText("Новый блок").first()).toBeVisible();

  await page.getByRole("button", { name: /^Тест$/ }).click();
  await expect.poll(() => tested).toBe(true);
  await expect(page.getByText("Playwright workflow test completed")).toBeVisible();

  await page.getByLabel("Название сценария").fill("API Workflow Updated");
  await page.getByRole("button", { name: /^Сохранить изменения$/ }).click();

  await expect.poll(() => patchedName).toBe("API Workflow Updated");
  await expect.poll(() => patchedSteps.length).toBeGreaterThan(3);
  expect(patchedSteps.some((step) => step.name === "Новый блок" && step.type === "AI_MESSAGE" && step.config?.blockType === "ai")).toBe(true);
  expect(patchedSteps.find((step) => step.id === "step-trigger")?.config?.keywordFilter).toBe("vip");
  await expect.poll(() => published).toBe(true);
  await expect(page.getByLabel("Название сценария")).toHaveValue("API Workflow Updated");
  await expect(page.getByText("Несохранено")).toHaveCount(0);

  await page.getByRole("button", { name: /^Архив$/ }).click();
  await expect.poll(() => patchedStatus).toBe("ARCHIVED");
  await expect(page.getByLabel("Название сценария")).toHaveValue("Запись на услугу");
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
  await page.getByRole("button", { name: "Оформление заказа" }).click();
  await expect(page.getByLabel("Название сценария")).toHaveValue("Оформление заказа");

  await page.getByRole("button", { name: /^Сохранить$/ }).click();

  await expect.poll(() => createdBody?.name).toBe("Оформление заказа");
  await expect.poll(() => createdBody?.steps?.length ?? 0).toBeGreaterThan(0);
  expect(createdBody?.steps?.some((step) => typeof step.id === "string")).toBe(false);
  expect(createdBody?.steps?.[0]?.type).toBe("TRIGGER");
  expect(createdBody?.steps?.[0]?.config?.blockType).toBe("trigger");
  await expect.poll(() => publishedCreated).toBe(true);
  await expect(page.getByLabel("Название сценария")).toHaveValue("Оформление заказа");
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
  await expect.poll(() => duplicatedBody?.steps?.length ?? 0).toBeGreaterThan(0);
  expect(duplicatedBody?.steps?.some((step) => typeof step.id === "string")).toBe(false);
  await expect.poll(() => publishedDuplicate).toBe(true);
  await expect(page.getByLabel("Название сценария")).toHaveValue("Workflow For Duplicate (копия)");
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
  await page.getByRole("button", { name: /^Восстановить$/ }).click();

  await expect.poll(() => restoreStatus).toBe("PAUSED");
  await expect(page.getByLabel("Название сценария")).toHaveValue("Archived Workflow");
  await expect(page.getByText("Восстановлен").first()).toBeVisible();
});

