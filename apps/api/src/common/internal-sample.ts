import type { Prisma } from "@leadvirt/db";

type AuditPayload = { payload: Prisma.JsonValue | null };
type ProcessedWebhookAudit = AuditPayload & {
  action: string;
  entityId: string | null;
};

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function payloadString(payload: Prisma.JsonValue | null, key: string) {
  const value = asRecord(payload)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function internalSampleConversationIds(logs: readonly AuditPayload[]) {
  const ids = new Set<string>();
  for (const log of logs) {
    const conversationId = payloadString(log.payload, "conversationId");
    if (conversationId) ids.add(conversationId);
  }
  return ids;
}

export function internalSampleLeadIds(
  conversations: readonly { id: string; leadId: string | null }[],
  sampleConversationIds: ReadonlySet<string>,
) {
  return new Set(
    conversations
      .filter(
        (conversation): conversation is { id: string; leadId: string } =>
          sampleConversationIds.has(conversation.id) && conversation.leadId !== null,
      )
      .map((conversation) => conversation.leadId),
  );
}

export function internalSampleExternalEventIds(
  logs: readonly ProcessedWebhookAudit[],
  sampleConversationIds: ReadonlySet<string>,
) {
  const ids = new Set<string>();
  for (const log of logs) {
    if (
      !log.entityId ||
      !sampleConversationIds.has(log.entityId) ||
      !["telegram.webhook.processed", "webhook.event.processed"].includes(log.action)
    ) {
      continue;
    }
    const externalEventId = payloadString(log.payload, "externalEventId");
    if (externalEventId) ids.add(externalEventId);
  }
  return ids;
}

export function isInternalSampleWebhookEvent(
  event: { provider: string; externalEventId: string },
  sampleExternalEventIds: ReadonlySet<string>,
) {
  return (
    sampleExternalEventIds.has(event.externalEventId) ||
    (event.provider.startsWith("webhook:") &&
      event.externalEventId.startsWith("webhook:event:leadvirt-sample-"))
  );
}
