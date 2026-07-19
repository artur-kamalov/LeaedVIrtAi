import assert from "node:assert/strict";
import {
  internalSampleConversationIds,
  internalSampleExternalEventIds,
  internalSampleLeadIds,
  isInternalSampleWebhookEvent,
} from "../../apps/api/src/common/internal-sample.js";
import { dashboardUtcWeekdayTrend } from "../../apps/api/src/modules/dashboard/dashboard-metrics.js";

const sampleConversationIds = internalSampleConversationIds([
  { payload: { provider: "TELEGRAM", conversationId: "sample-telegram" } },
  { payload: { provider: "WEBHOOK_API", conversationId: "sample-webhook" } },
  { payload: null },
  { payload: { conversationId: 42 } },
]);

assert.deepEqual([...sampleConversationIds], ["sample-telegram", "sample-webhook"]);
assert.deepEqual(
  [
    ...internalSampleLeadIds(
      [
        { id: "sample-telegram", leadId: "lead-telegram" },
        { id: "sample-webhook", leadId: "lead-webhook" },
        { id: "real-conversation", leadId: "lead-real" },
        { id: "sample-without-lead", leadId: null },
      ],
      sampleConversationIds,
    ),
  ],
  ["lead-telegram", "lead-webhook"],
);

const sampleExternalEventIds = internalSampleExternalEventIds(
  [
    {
      action: "telegram.webhook.processed",
      entityId: "sample-telegram",
      payload: { externalEventId: "telegram:bot:1:update:123" },
    },
    {
      action: "webhook.event.processed",
      entityId: "sample-webhook",
      payload: { externalEventId: "webhook:event:leadvirt-sample-123" },
    },
    {
      action: "telegram.webhook.processed",
      entityId: "real-conversation",
      payload: { externalEventId: "telegram:bot:1:update:456" },
    },
  ],
  sampleConversationIds,
);

assert.equal(
  isInternalSampleWebhookEvent(
    { provider: "telegram:channel-1", externalEventId: "telegram:bot:1:update:123" },
    sampleExternalEventIds,
  ),
  true,
);
assert.equal(
  isInternalSampleWebhookEvent(
    {
      provider: "webhook:channel-1",
      externalEventId: "webhook:event:leadvirt-sample-legacy",
    },
    new Set(),
  ),
  true,
);
assert.equal(
  isInternalSampleWebhookEvent(
    { provider: "telegram:channel-1", externalEventId: "telegram:bot:1:update:456" },
    sampleExternalEventIds,
  ),
  false,
);

const trend = dashboardUtcWeekdayTrend(
  [
    {
      status: "BOOKED",
      createdAt: new Date("2026-07-19T23:30:00.000Z"),
      bookedAt: null,
    },
    {
      status: "NEW",
      createdAt: new Date("2026-07-13T10:00:00.000Z"),
      bookedAt: new Date("2026-07-14T10:00:00.000Z"),
    },
    {
      status: "ORDERED",
      createdAt: new Date("2026-07-12T23:59:59.999Z"),
      bookedAt: null,
    },
  ],
  new Date("2026-07-13T00:00:00.000Z"),
  new Date("2026-07-20T00:00:00.000Z"),
);

assert.deepEqual(trend[0], { weekday: 0, leads: 1, booked: 1 });
assert.deepEqual(trend[6], { weekday: 6, leads: 1, booked: 1 });
assert.equal(
  trend.reduce((sum, day) => sum + day.leads, 0),
  2,
);

console.log("Internal sample evidence smoke checks passed.");
