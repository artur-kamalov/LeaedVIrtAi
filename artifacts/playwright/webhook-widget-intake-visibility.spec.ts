import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await loginAsCleanUser(page, apiBase);
});

type IntakeLead = {
  id: string;
  name: string;
  source: string;
  channelType: "WEBHOOK" | "WEBSITE";
  status: "NEW" | "IN_PROGRESS";
  temperature: "WARM" | "HOT";
  interest: string;
  summary: string;
  valueAmount: number;
  lastMessageAt: string;
  createdAt: string;
};

const webhookLead: IntakeLead = {
  id: "lead-intake-webhook",
  name: "Webhook Pilot",
  source: "Webhook/API",
  channelType: "WEBHOOK",
  status: "NEW",
  temperature: "WARM",
  interest: "External form request",
  summary: "Incoming lead from a social landing webhook",
  valueAmount: 11000,
  lastMessageAt: "2026-06-23T10:15:00.000Z",
  createdAt: "2026-06-23T10:10:00.000Z",
};

const widgetLead: IntakeLead = {
  id: "lead-intake-widget",
  name: "Widget Pilot",
  source: "Website widget",
  channelType: "WEBSITE",
  status: "IN_PROGRESS",
  temperature: "HOT",
  interest: "Widget booking request",
  summary: "Asked for available appointment slots in the widget",
  valueAmount: 18000,
  lastMessageAt: "2026-06-23T10:20:00.000Z",
  createdAt: "2026-06-23T10:12:00.000Z",
};

function apiLead(lead: IntakeLead) {
  return {
    ...lead,
    tenantId: "tenant-demo",
    phone: null,
    email: null,
    companyName: null,
    currency: "RUB",
    assignedToUserId: null,
    assignedToName: null,
  };
}

function conversation(lead: IntakeLead, index: number) {
  return {
    id: `conversation-intake-${index}`,
    tenantId: "tenant-demo",
    leadId: lead.id,
    channel: {
      id: `channel-intake-${index}`,
      tenantId: "tenant-demo",
      type: lead.channelType,
      status: "ACTIVE",
      name: lead.source,
    },
    channelType: lead.channelType,
    status: "OPEN",
    subject: lead.name,
    lastMessageAt: lead.lastMessageAt,
    aiEnabled: true,
    handoffRequested: false,
    lead: apiLead(lead),
    lastMessage: lead.summary,
    unreadCount: index === 0 ? 1 : 0,
    messages: [],
    events: [],
  };
}

function pipelineSummary(leads: IntakeLead[]) {
  const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"];
  return {
    data: {
      stages: statuses.map((status) => {
        const stageLeads = leads.filter((lead) => lead.status === status).map(apiLead);
        return {
          status,
          count: stageLeads.length,
          valueAmount: stageLeads.reduce((sum, lead) => sum + lead.valueAmount, 0),
          leads: stageLeads,
        };
      }),
    },
  };
}

test("webhook and widget intake stay traceable in inbox and pipeline", async ({ page }) => {
  const leads = [webhookLead, widgetLead];

  await page.route("**/api/inbox/conversations?*", async (route) => {
    const limit = route.request().url().includes("limit=100") ? 100 : 50;
    await route.fulfill({
      json: {
        data: leads.map(conversation),
        pagination: { page: 1, limit, total: leads.length, hasMore: false },
      },
    });
  });

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary(leads) });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByText("Webhook Pilot").first()).toBeVisible();
  await expect(page.getByText("Incoming lead from a social landing webhook").first()).toBeVisible();
  await expect(page.getByText("Webhook/API").first()).toBeVisible();
  await expect(page.getByText("Сайт").first()).toBeVisible();

  await page.getByText("Widget Pilot").first().click();
  await expect(page.getByText(widgetLead.source).first()).toBeVisible();
  await expect(page.getByText("Widget booking request").first()).toBeVisible();

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByText("Webhook Pilot").first()).toBeVisible();
  await expect(page.getByText("Webhook/API").first()).toBeVisible();
  await expect(page.getByText("Widget Pilot").first()).toBeVisible();
  await expect(page.getByText(widgetLead.source).first()).toBeVisible();
});

