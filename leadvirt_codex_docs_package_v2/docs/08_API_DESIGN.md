# 08 — API Design

## API style

Use REST for MVP.

Base path:

```text
/api/v1
```

Use JSON request/response bodies.

Use typed DTOs and validation for every endpoint.

## Standard response shape

For single resources:

```json
{
  "data": {}
}
```

For lists:

```json
{
  "data": [],
  "pagination": {
    "cursor": "next_cursor",
    "hasMore": true
  }
}
```

For errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": {}
  }
}
```

## Required headers

```text
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
Idempotency-Key: <optional-for-mutations>
```

Do not trust `X-Tenant-Id` alone. Verify user membership.

## Auth endpoints

If using external auth, these may be minimal. If using local auth, implement:

```text
POST /auth/signup
POST /auth/login
POST /auth/logout
POST /auth/refresh
GET  /auth/me
```

## Tenant endpoints

```text
GET    /tenants
POST   /tenants
GET    /tenants/:tenantId
PATCH  /tenants/:tenantId
GET    /tenants/:tenantId/members
POST   /tenants/:tenantId/invitations
PATCH  /tenants/:tenantId/members/:membershipId
DELETE /tenants/:tenantId/members/:membershipId
```

## Onboarding endpoints

```text
GET   /onboarding/state
PATCH /onboarding/state
POST  /onboarding/complete-step
POST  /onboarding/finish
```

## Dashboard endpoints

```text
GET /dashboard/summary
GET /dashboard/recent-activity
GET /dashboard/channel-performance
GET /dashboard/quick-actions
```

## Inbox endpoints

```text
GET /inbox/conversations
GET /inbox/conversations/:conversationId
GET /inbox/conversations/:conversationId/messages
POST /inbox/conversations/:conversationId/messages
PATCH /inbox/conversations/:conversationId/status
POST /inbox/conversations/:conversationId/handoff
```

## Lead endpoints

```text
GET    /leads
POST   /leads
GET    /leads/:leadId
PATCH  /leads/:leadId
PATCH  /leads/:leadId/status
POST   /leads/:leadId/assign
POST   /leads/:leadId/qualify
POST   /leads/:leadId/send-to-crm
POST   /leads/:leadId/create-task
POST   /leads/:leadId/book
DELETE /leads/:leadId
```

## Conversation AI endpoints

```text
POST /conversations/:conversationId/ai/reply
POST /conversations/:conversationId/ai/summarize
POST /conversations/:conversationId/ai/extract-fields
POST /conversations/:conversationId/ai/recommend-next-action
```

## Workflow endpoints

```text
GET    /workflows
POST   /workflows
GET    /workflows/:workflowId
PATCH  /workflows/:workflowId
DELETE /workflows/:workflowId
POST   /workflows/:workflowId/publish
POST   /workflows/:workflowId/pause
POST   /workflows/:workflowId/test
GET    /workflows/:workflowId/runs
GET    /workflows/:workflowId/runs/:runId
```

## Channel endpoints

```text
GET    /channels
POST   /channels
GET    /channels/:channelId
PATCH  /channels/:channelId
DELETE /channels/:channelId
POST   /channels/:channelId/test
GET    /channels/:channelId/health
```

## Public widget endpoints

These endpoints may use API keys or public tenant widget tokens.

```text
GET  /public/widget/config/:publicKey
POST /public/widget/messages
POST /public/widget/conversations
```

## Webhook endpoints

Provider-specific webhooks:

```text
POST /webhooks/channels/telegram/:channelAccountId
POST /webhooks/channels/website/:channelAccountId
POST /webhooks/channels/email/:channelAccountId
POST /webhooks/channels/generic/:channelAccountId
POST /webhooks/billing/:provider
POST /webhooks/crm/:provider/:integrationAccountId
```

Every webhook endpoint must:

1. verify signature if supported;
2. store raw event;
3. check idempotency;
4. enqueue processing;
5. return quickly.

## Integration endpoints

```text
GET    /integrations
POST   /integrations/:provider/connect
POST   /integrations/:provider/disconnect
POST   /integrations/:provider/test
GET    /integrations/:integrationId/sync-logs
POST   /integrations/:integrationId/sync-lead/:leadId
```

## Analytics endpoints

```text
GET /analytics/overview
GET /analytics/leads-by-channel
GET /analytics/conversion-by-scenario
GET /analytics/response-time
GET /analytics/revenue-estimate
GET /analytics/insights
```

## Billing endpoints

```text
GET  /billing/plans
GET  /billing/subscription
POST /billing/checkout
POST /billing/portal
GET  /billing/usage
GET  /billing/invoices
```

## Settings endpoints

```text
GET   /settings/company
PATCH /settings/company
GET   /settings/security
PATCH /settings/security
GET   /settings/notifications
PATCH /settings/notifications
GET   /settings/api-keys
POST  /settings/api-keys
DELETE /settings/api-keys/:apiKeyId
```

## Pagination

Use cursor pagination for lists that can grow:

- conversations;
- messages;
- leads;
- audit logs;
- webhook events;
- sync logs.

Example query:

```text
GET /leads?limit=50&cursor=abc&status=NEW
```

## Realtime events

Use WebSocket or SSE events:

```text
conversation.created
conversation.message_received
conversation.ai_typing
conversation.ai_replied
lead.created
lead.updated
lead.status_changed
workflow.run_updated
crm.sync_completed
notification.created
```

Every realtime event must include:

```json
{
  "event": "lead.updated",
  "tenantId": "...",
  "payload": {},
  "createdAt": "..."
}
```

Only send events to users with access to the tenant.
