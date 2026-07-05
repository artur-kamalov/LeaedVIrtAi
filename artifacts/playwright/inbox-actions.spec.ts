import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("inbox right-panel quick actions call lead APIs by lead id", async ({ page }) => {
  let crmLeadId = "";
  let taskLeadId = "";
  let taskTitle = "";

  await page.route("**/api/inbox/conversations?*", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-1",
            tenantId: "tenant-demo",
            leadId: "lead-api-1",
            channel: { id: "channel-website", tenantId: "tenant-demo", type: "WEBSITE", status: "ACTIVE", name: "Website" },
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API lead conversation",
            lastMessageAt: "2026-06-23T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-api-1",
              tenantId: "tenant-demo",
              name: "API Lead",
              phone: "+79990000000",
              email: "lead@example.com",
              companyName: null,
              source: "Website widget",
              channelType: "WEBSITE",
              status: "NEW",
              temperature: "WARM",
              valueAmount: 12000,
              currency: "RUB",
              interest: "Consultation",
              summary: "Needs a consultation",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-23T10:00:00.000Z",
              createdAt: "2026-06-23T09:00:00.000Z"
            },
            lastMessage: "Please contact me",
            unreadCount: 1,
            messages: [],
            events: []
          }
        ],
        pagination: { page: 1, limit: 50, total: 1, hasMore: false }
      }
    });
  });

  await page.route("**/api/leads/lead-api-1/actions/send-to-crm", async (route) => {
    crmLeadId = "lead-api-1";
    await route.fulfill({
      json: {
        data: {
          id: "lead-api-1",
          tenantId: "tenant-demo",
          name: "API Lead",
          source: "Website widget",
          channelType: "WEBSITE",
          status: "SENT_TO_CRM",
          temperature: "WARM",
          valueAmount: 12000,
          currency: "RUB",
          interest: "Consultation",
          summary: "Needs a consultation",
          assignedToUserId: null,
          assignedToName: null,
          lastMessageAt: "2026-06-23T10:00:00.000Z",
          createdAt: "2026-06-23T09:00:00.000Z"
        }
      }
    });
  });

  await page.route("**/api/leads/lead-api-1/actions/create-task", async (route) => {
    const body = route.request().postDataJSON() as { title?: string };
    taskLeadId = "lead-api-1";
    taskTitle = body.title ?? "";
    await route.fulfill({
      json: {
        data: {
          id: "task-api-1",
          title: taskTitle,
          status: "OPEN"
        }
      }
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByText("API Lead").first()).toBeVisible();
  await page.getByRole("button", { name: "В CRM", exact: true }).click();
  await expect.poll(() => crmLeadId).toBe("lead-api-1");

  await page.getByRole("button", { name: /Создать задачу/ }).click();
  await expect.poll(() => taskLeadId).toBe("lead-api-1");
  expect(taskTitle).toContain("API Lead");
});

