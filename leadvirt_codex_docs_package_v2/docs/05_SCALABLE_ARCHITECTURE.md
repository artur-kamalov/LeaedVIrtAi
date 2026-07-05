# 05 — Scalable Architecture

## Architecture style

Use a **scalable modular monolith**.

Do not start with microservices. The codebase should be modular enough that future extraction is possible, but the MVP should remain easy to develop, deploy, and debug.

## High-level system

```text
                       ┌─────────────────────┐
                       │      Next.js Web     │
                       │ Landing + App UI     │
                       └──────────┬──────────┘
                                  │ HTTPS
                                  ▼
┌──────────────────────────────────────────────────────────┐
│                     NestJS API                           │
│ Auth Guards │ REST API │ Webhooks │ Realtime │ RBAC       │
└─────────────┬─────────────────────┬──────────────────────┘
              │                     │
              ▼                     ▼
      ┌──────────────┐       ┌────────────────┐
      │ PostgreSQL   │       │ Redis / BullMQ │
      │ Prisma       │       │ Queues         │
      └──────┬───────┘       └───────┬────────┘
             │                       │
             ▼                       ▼
      ┌──────────────┐       ┌────────────────┐
      │ Object Store │       │ Worker Process │
      │ R2 / S3      │       │ AI, CRM, Jobs  │
      └──────────────┘       └────────────────┘
```

## Core domains

Each domain should be a NestJS module with a clear public service interface.

```text
AuthModule
TenantsModule
UsersModule
MembershipsModule
BillingModule
LeadsModule
ConversationsModule
MessagesModule
InboxModule
ChannelsModule
AIModule
WorkflowsModule
IntegrationsModule
NotificationsModule
AnalyticsModule
FilesModule
AuditLogModule
SettingsModule
```

## Dependency direction

Core business modules must not depend directly on external providers.

Bad:

```text
LeadsService → Telegram SDK
```

Good:

```text
LeadsService → ChannelsService → ChannelAdapter interface → TelegramAdapter
```

## Adapter interfaces

### AI provider

```ts
export interface AiProvider {
  generateReply(input: AiReplyInput): Promise<AiReplyResult>;
  extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult>;
  summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult>;
}
```

### Channel adapter

```ts
export interface ChannelAdapter {
  type: ChannelType;
  verifyWebhook?(input: WebhookVerificationInput): Promise<boolean>;
  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
```

### CRM adapter

```ts
export interface CrmAdapter {
  provider: CrmProvider;
  createLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult>;
  updateLead(input: CrmUpdateLeadInput): Promise<CrmUpdateLeadResult>;
  createTask(input: CrmCreateTaskInput): Promise<CrmCreateTaskResult>;
}
```

### Billing provider

```ts
export interface BillingProvider {
  createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult>;
  createPortalSession(input: PortalInput): Promise<PortalResult>;
  handleWebhook(input: BillingWebhookInput): Promise<BillingWebhookResult>;
}
```

## Request flow: inbound message

```text
1. Channel webhook receives payload.
2. API verifies signature if supported.
3. API stores raw webhook event with external_event_id.
4. API checks idempotency.
5. API normalizes payload through ChannelAdapter.
6. API creates or updates conversation and lead.
7. API enqueues ai.reply job.
8. Worker runs AI orchestration.
9. Worker stores AI message and usage log.
10. Worker enqueues channels.send-message job.
11. Channel adapter sends reply.
12. API emits realtime event to Inbox.
```

## Request flow: dashboard

```text
1. Frontend requests dashboard metrics.
2. API checks tenant membership.
3. API reads pre-aggregated analytics where possible.
4. API falls back to simple queries for MVP.
5. Frontend renders cards, charts, recent activity.
```

## Request flow: CRM sync

```text
1. User clicks “Send to CRM” or workflow triggers action.
2. API validates lead state and tenant permission.
3. API creates integration sync log.
4. API enqueues crm.sync-lead job.
5. Worker calls CrmAdapter.
6. Worker updates sync log and lead status.
7. Worker emits realtime update.
```

## Queues

Recommended queues:

```text
ai.reply
ai.extract-lead-fields
ai.summarize
ai.follow-up
channels.process-webhook
channels.send-message
crm.sync-lead
crm.retry-failed-sync
analytics.aggregate
billing.calculate-usage
notifications.send
files.process-attachment
knowledge.embed-document
```

## Idempotency

Every external event must be processed once.

Use:

- `webhook_events.externalEventId`
- `idempotencyKey` for API mutations where relevant
- unique constraints
- job deduplication keys

## Tenant isolation

Every request must resolve:

```text
userId + tenantId + role + permissions
```

Every business query must include tenant filtering.

Do not trust `tenantId` from request body. Tenant context must come from route, session, membership, or API key validation.

## Internal events

Use internal domain events to decouple modules.

Examples:

```text
lead.created
conversation.message_received
conversation.ai_replied
lead.qualified
booking.created
crm.sync_completed
usage.limit_reached
```

MVP can implement these through a simple event service and queue jobs. Later, this can become an outbox pattern.

## Outbox path for later scaling

For stronger reliability later, add an `outbox_events` table:

```text
id
aggregateType
aggregateId
eventType
payload
status
createdAt
processedAt
```

Workers can process outbox events asynchronously.

## Database scaling requirements

- Use indexes on `tenantId`, status, createdAt, updatedAt, channel, source.
- Use pagination for all lists.
- Use cursor pagination for conversations/messages where possible.
- Do not load all messages for a tenant into memory.
- Store large payloads in object storage when needed.
- Keep raw webhook payloads bounded and purge/archive later.

## Future service extraction boundaries

If the modular monolith grows, these domains can be extracted first:

1. Channel ingestion service.
2. AI orchestration workers.
3. Analytics aggregation service.
4. Billing and usage service.
5. Integration sync service.

The initial codebase should already make these extraction paths easy through adapters and queues.
