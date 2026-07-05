# 07 — Data Model

## Data model principle

LeadVirt.ai is a multi-tenant B2B SaaS. Most business records must belong to a tenant.

The default multi-tenancy model:

```text
Shared database
Shared schema
tenantId column on every tenant-owned business table
```

## Core entities

### Tenant

A business account/company using LeadVirt.ai.

### User

A person who logs into LeadVirt.ai.

### Membership

Connects a user to a tenant with a role.

### ChannelAccount

A connected communication channel, such as website widget, Telegram, WhatsApp, Instagram, email, webhook.

### Lead

A structured opportunity created from a conversation or manually created.

### Conversation

A thread of messages with a customer.

### Message

A single inbound, outbound, AI, or system message.

### Workflow

A no-code AI scenario with steps and actions.

### IntegrationAccount

A connected external system such as CRM, calendar, e-commerce platform.

### UsageCounter

Monthly usage tracking per tenant and plan.

## Required common fields

Most business models should include:

```text
id
createdAt
updatedAt
deletedAt optional
tenantId
```

## Important indexes

Add indexes for common access patterns:

```text
tenantId
createdAt
updatedAt
status
source
channelType
tenantId + status
tenantId + createdAt
tenantId + status + createdAt
conversationId + createdAt
leadId + createdAt
```

## Enums

Recommended enums:

```text
PlanCode: START, PROFESSIONAL, BUSINESS, CORPORATE
TenantStatus: ACTIVE, SUSPENDED, TRIALING, CANCELLED
MembershipRole: OWNER, ADMIN, MANAGER, AGENT, VIEWER
ChannelType: WEBSITE, TELEGRAM, WHATSAPP, INSTAGRAM, VK, EMAIL, WEBHOOK, PHONE, DEMO
ChannelStatus: ACTIVE, DISABLED, ERROR, PENDING
LeadStatus: NEW, IN_PROGRESS, QUALIFIED, BOOKED, ORDERED, SENT_TO_CRM, CLOSED, LOST
LeadTemperature: COLD, WARM, HOT
ConversationStatus: OPEN, WAITING_FOR_CUSTOMER, WAITING_FOR_HUMAN, CLOSED
MessageDirection: INBOUND, OUTBOUND
MessageSenderType: CUSTOMER, AI, USER, SYSTEM
MessageStatus: RECEIVED, QUEUED, SENT, DELIVERED, FAILED
WorkflowStatus: DRAFT, ACTIVE, PAUSED, ARCHIVED
WorkflowStepType: TRIGGER, AI_MESSAGE, QUESTION, CONDITION, ACTION, DELAY, HANDOFF, END
IntegrationProvider: AMOCRM, BITRIX24, RETAILCRM, GOOGLE_CALENDAR, SHOPIFY, WEBHOOK, OTHER
IntegrationStatus: CONNECTED, DISCONNECTED, ERROR, PENDING
TaskStatus: TODO, IN_PROGRESS, DONE, CANCELLED
```

## Simplified relationship map

```text
Tenant 1—N Membership N—1 User
Tenant 1—N ChannelAccount
Tenant 1—N Lead
Lead 1—N Conversation
Conversation 1—N Message
Tenant 1—N Workflow
Workflow 1—N WorkflowStep
Conversation 1—N WorkflowRun
Tenant 1—N IntegrationAccount
Tenant 1—N UsageCounter
Tenant 1—N AuditLog
```

## Lead fields

Core lead fields should be explicit:

```text
name
phone
email
companyName
source
channelType
status
temperature
valueAmount
currency
interest
summary
assignedToUserId
lastMessageAt
qualifiedAt
bookedAt
sentToCrmAt
closedAt
```

Use a flexible JSON field for vertical-specific data:

```text
customFields Json
```

Examples:

### Beauty

```json
{
  "service": "Manicure with gel polish",
  "preferredDate": "tomorrow",
  "preferredTime": "18:30",
  "masterPreference": "Anna"
}
```

### Service business

```json
{
  "problemType": "washing machine does not drain",
  "brand": "Bosch",
  "locationArea": "South-West district",
  "urgency": "today"
}
```

### E-commerce

```json
{
  "productSku": "JACKET-M-BLACK",
  "question": "availability and delivery",
  "deliveryCity": "Paris"
}
```

## Webhook idempotency table

Required fields:

```text
provider
externalEventId
payloadHash
status
receivedAt
processedAt
errorMessage
```

Use a unique constraint on:

```text
provider + externalEventId
```

## AI usage logging

Every AI action must create an `AiUsageLog` record.

Fields:

```text
tenantId
conversationId
leadId optional
provider
model optional
actionType
promptVersionId optional
inputTokens optional
outputTokens optional
estimatedCost optional
latencyMs
status
errorMessage optional
createdAt
```

## Prompt versioning

Prompts are product logic. Treat them like code.

Use:

- `AiPrompt`
- `AiPromptVersion`

Never silently overwrite a production prompt. Create a new version.

## Soft delete

Use soft delete for user-facing records where accidental deletion is harmful:

- leads
- conversations
- workflows
- channel accounts
- integrations

Hard delete can be used for temporary events/logs based on retention policy.
