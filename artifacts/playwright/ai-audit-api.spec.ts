import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function mockAppShell(page: Page, role = "MANAGER") {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-ai-audit",
          email: "audit.manager@example.test",
          name: "AI Audit Manager",
          avatarUrl: null,
          role,
          tenantId: "tenant-ai-audit",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });

  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "tenant-ai-audit",
          name: "AI Audit Workspace",
          slug: "ai-audit-workspace",
          status: "TRIALING",
          businessType: "services",
          timezone: "Europe/Moscow",
          role,
        },
      },
    });
  });

  await page.route("**/api/billing/current-subscription", async (route) => {
    await route.fulfill({ json: { data: null } });
  });

  await page.route("**/api/dashboard/summary", async (route) => {
    await route.fulfill({ json: { data: { recentActivity: [] } } });
  });
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("ai audit page renders API-backed events with redacted payloads", async ({ page }) => {
  await mockAppShell(page);

  await page.route("**/api/ai-audit*", async (route) => {
    await route.fulfill({
      json: {
        data: {
          summary: {
            totalEvents: 2,
            usageLogs: 1,
            auditLogs: 1,
            success: 1,
            handoff: 0,
            failed: 0,
            budgetBlocked: 0,
            toolCalls: 2,
            lastEventAt: "2026-07-06T10:00:00.000Z",
          },
          items: [
            {
              id: "usage-1",
              kind: "usage",
              createdAt: "2026-07-06T10:00:00.000Z",
              action: "langgraph_queued_reply",
              status: "SUCCESS",
              provider: "mock",
              model: "mock-v1",
              conversationId: "conv-1",
              conversationSubject: "AI audit smoke",
              leadId: "lead-1",
              leadName: "Lead One",
              inputTokens: 12,
              outputTokens: 20,
              latencyMs: 35,
              graphRunId: "graph-1",
              payload: {
                graphRunId: "graph-1",
                toolCalls: [
                  {
                    type: "lead.note.create",
                    input: {
                      email: "[redacted-email]",
                      phone: "[redacted-phone]",
                      secret: "[redacted-secret]",
                    },
                  },
                ],
                quality: { passed: true },
              },
              toolCalls: [{ type: "lead.note.create" }],
              toolResults: [{ status: "SUCCESS" }],
              retrievedContext: [{ chunkId: "chunk-1" }],
            },
            {
              id: "audit-1",
              kind: "audit",
              createdAt: "2026-07-06T10:01:00.000Z",
              action: "ai.langgraph_reply.processed",
              status: "AUDIT",
              payload: {
                webhookSecret: "[redacted-secret]",
                leadEmail: "[redacted-email]",
              },
            },
          ],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/audit`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "AI audit" }).first()).toBeVisible();
  await expect(page.getByText("Tenant-scoped audit")).toBeVisible();
  await expect(page.getByText("langgraph_queued_reply")).toBeVisible();
  await expect(page.getByText("ai.langgraph_reply.processed")).toBeVisible();
  await expect(page.getByText("graph: graph-1")).toBeVisible();
  await expect(page.getByText("tools: 2")).toBeVisible();
  await expect(
    page.getByTestId("ai-audit-item-audit-audit-1").getByText("-", { exact: true }),
  ).toHaveCount(3);

  await page.getByText("Payload").first().click();
  await expect(page.getByText("[redacted-email]").first()).toBeVisible();
  await expect(page.getByText("[redacted-phone]").first()).toBeVisible();
  await expect(page.getByText("[redacted-secret]").first()).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("lead@example.com");
  expect(body).not.toContain("+7 999 111 22 33");
  expect(body).not.toContain("secret-should-not-leak");

  await page.screenshot({ path: "artifacts/playwright/ai-audit-api.png", fullPage: true });
});

test("ai audit page shows an access error for forbidden roles", async ({ page }) => {
  await mockAppShell(page, "AGENT");

  await page.route("**/api/ai-audit*", async (route) => {
    await route.fulfill({
      status: 403,
      json: { message: "Forbidden" },
    });
  });

  await page.goto(`${webBase}/app/audit`, { waitUntil: "networkidle" });

  await expect(
    page.getByText("AI audit is unavailable for this workspace role or session."),
  ).toBeVisible();
  await expect(page.getByTestId("ai-audit-load-error").getByRole("button")).toHaveCount(0);
});

test("ai audit keeps metrics hidden until a failed request is retried", async ({ page }) => {
  await mockAppShell(page);
  let recover = false;

  await page.route("**/api/ai-audit*", async (route) => {
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          summary: {
            totalEvents: 0,
            usageLogs: 0,
            auditLogs: 0,
            success: 0,
            handoff: 0,
            failed: 0,
            budgetBlocked: 0,
            toolCalls: 0,
            lastEventAt: null,
          },
          items: [],
        },
      },
    });
  });

  await page.goto(`${webBase}/app/audit`);

  const error = page.getByTestId("ai-audit-load-error");
  await expect(error).toBeVisible();
  await expect(page.getByText("Tenant-scoped audit")).toHaveCount(0);
  recover = true;
  await error.getByRole("button").click();
  await expect(error).toBeHidden();
  await expect(page.getByText("Tenant-scoped audit")).toBeVisible();
});
