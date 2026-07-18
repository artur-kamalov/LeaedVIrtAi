import assert from "node:assert/strict";
import { BillingService } from "../../apps/api/src/modules/billing/billing.service.js";

const context = {
  tenantId: "tenant-billing-smoke",
  userId: "owner-billing-smoke",
  role: "OWNER",
  authMode: "email",
  tenant: {
    id: "tenant-billing-smoke",
    name: "Billing Smoke Workspace",
    slug: "billing-smoke-workspace",
    status: "ACTIVE",
    businessType: null,
    timezone: "Europe/Paris",
  },
  user: {
    id: "owner-billing-smoke",
    email: "owner@billing-smoke.test",
    phone: "+33102030405",
    name: "Billing Smoke Owner",
    avatarUrl: null,
    passwordChangeRequired: false,
  },
} as const;

let catalogDatabaseReads = 0;
let latestSelection:
  | { id: string; entityId: string; createdAt: Date }
  | null = null;
let latestAuditPayload: Record<string, unknown> | null = null;
const executionOrder: string[] = [];
let deliveredMessage: { email?: string; text: string } | null = null;

const emailDelivery = {
  sendOperationalEmail: async (input: { email?: string; text: string }) => {
    executionOrder.push("delivery");
    deliveredMessage = input;
    return { providerMessageId: "mock:billing-plan-delivery" };
  },
};

const prisma = {
  get billingPlan() {
    catalogDatabaseReads += 1;
    throw new Error("The published billing catalog must not depend on seeded rows.");
  },
  subscription: {
    findFirst: async () => null,
  },
  auditLog: {
    findFirst: async () => latestSelection,
    create: async ({
      data,
    }: {
      data: { entityId: string; createdAt: Date; payload: Record<string, unknown> };
    }) => {
      executionOrder.push("audit");
      latestAuditPayload = data.payload;
      latestSelection = {
        id: "billing-selection-smoke",
        entityId: data.entityId,
        createdAt: data.createdAt,
      };
      return latestSelection;
    },
  },
  usageCounter: { findFirst: async () => null },
  channel: { count: async () => 1 },
  membership: { count: async () => 1 },
  workflow: { count: async () => 0 },
};

async function main() {
  const service = new BillingService(prisma as never, emailDelivery as never);
  const plans = await service.plans();

  assert.equal(catalogDatabaseReads, 0);
  assert.deepEqual(
    plans.map(({ code, priceMonthlyRub }) => [code, priceMonthlyRub]),
    [
      ["START", 9900],
      ["PROFESSIONAL", 24900],
      ["BUSINESS", 59900],
      ["CORPORATE", 120000],
    ],
  );

  assert.equal(await service.currentSubscription(context), null);
  assert.deepEqual(service.invoices(), []);
  const usage = await service.usage(context);
  assert.equal(usage.aiConversationsLimit, null);
  assert.equal(usage.channelsLimit, null);
  assert.equal(usage.usersLimit, null);
  assert.equal(usage.scenariosLimit, null);

  process.env.BILLING_REQUEST_EMAIL = "billing-operator@example.test";
  const selection = await service.selectPlan(context, { planCode: "PROFESSIONAL" });
  assert.equal(selection.plan.code, "PROFESSIONAL");
  assert.equal(selection.status, "CONTACT_REQUIRED");
  assert.equal(selection.checkout.available, false);
  assert.equal(selection.checkout.mode, "manual_invoice");
  assert.equal(deliveredMessage?.email, "billing-operator@example.test");
  assert.match(deliveredMessage?.text ?? "", /Billing Smoke Workspace/u);
  assert.match(deliveredMessage?.text ?? "", /owner@billing-smoke\.test/u);
  assert.match(deliveredMessage?.text ?? "", /\+33102030405/u);
  assert.deepEqual(executionOrder, ["delivery", "audit"]);
  assert.equal(
    latestAuditPayload?.operatorDeliveryMessageId,
    "mock:billing-plan-delivery",
  );

  const restoredSelection = await service.planSelection(context);
  assert.equal(restoredSelection?.reference, selection.reference);
  assert.equal(restoredSelection?.plan.code, "PROFESSIONAL");

  const subscriptionWithoutPaymentEvidence = new BillingService(
    {
      subscription: {
        findFirst: async () => ({
          id: "subscription-without-payment",
          status: "ACTIVE",
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
          periodEnd: new Date("2026-07-01T00:00:00.000Z"),
          plan: {
            code: "PROFESSIONAL",
            name: "Professional",
            priceMonthlyRub: 24900,
            aiConversations: 2500,
            channelsLimit: 5,
            usersLimit: 10,
            scenariosLimit: 15,
            features: {},
          },
        }),
      },
    } as never,
    emailDelivery as never,
  );
  assert.deepEqual(subscriptionWithoutPaymentEvidence.invoices(), []);

  let failedAuditCreates = 0;
  const unavailableDelivery = new BillingService(
    {
      subscription: { findFirst: async () => null },
      auditLog: {
        create: async () => {
          failedAuditCreates += 1;
          throw new Error("Audit must not be written after delivery failure.");
        },
      },
    } as never,
    {
      sendOperationalEmail: async () => {
        throw new Error("Operational delivery unavailable.");
      },
    } as never,
  );
  await assert.rejects(
    unavailableDelivery.selectPlan(context, { planCode: "START" }),
    /Operational delivery unavailable/u,
  );
  assert.equal(failedAuditCreates, 0);

  console.log("billing service smoke: ok");
}

void main();
