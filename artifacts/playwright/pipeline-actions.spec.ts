import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

const baseLead = {
  id: "lead-api-1",
  tenantId: "tenant-demo",
  name: "API Лид",
  phone: null,
  email: null,
  companyName: null,
  source: "Website widget",
  channelType: "WEBSITE",
  status: "NEW",
  temperature: "WARM",
  valueAmount: 42000,
  currency: "RUB",
  interest: "Демо сделка",
  summary: "Проверяем воронку",
  assignedToUserId: null,
  assignedToName: "Мария К.",
  lastMessageAt: "2026-06-22T10:00:00.000Z",
  createdAt: "2026-06-22T09:55:00.000Z"
};

function pipelineSummary(lead = baseLead) {
  const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"];
  return {
    data: {
      stages: statuses.map((status) => ({
        status,
        count: lead.status === status ? 1 : 0,
        valueAmount: lead.status === status ? lead.valueAmount : 0,
        leads: lead.status === status ? [lead] : []
      }))
    }
  };
}

test("pipeline advances API leads through the update adapter", async ({ page }) => {
  let patchedStatus = "";
  const updatedLead = { ...baseLead, status: "IN_PROGRESS" };

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary() });
  });

  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-1",
            tenantId: "tenant-demo",
            leadId: "lead-api-1",
            channel: null,
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API Лид",
            lastMessageAt: "2026-06-22T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: baseLead,
            lastMessage: "Проверяем воронку",
            unreadCount: 1,
            messages: [],
            events: []
          }
        ],
        pagination: { page: 1, limit: 100, total: 1, hasMore: false }
      }
    });
  });

  await page.route("**/api/leads/lead-api-1", async (route) => {
    const body = route.request().postDataJSON() as { status?: string };
    patchedStatus = body.status ?? "";
    await route.fulfill({ json: { data: updatedLead } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByText("API Лид").first()).toBeVisible();
  await page.getByRole("button", { name: "Переместить лид: API Лид" }).click();

  await expect.poll(() => patchedStatus).toBe("IN_PROGRESS");
  await expect(page.getByText("В работе").first()).toBeVisible();
});

