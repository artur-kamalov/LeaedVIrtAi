# 11 — Channels and Integrations

## Principle

Channels and integrations must be adapter-based.

Core business logic should not know provider SDK details.

## Channel types

Supported UI list:

- Website widget
- Telegram
- WhatsApp Business
- Instagram
- VK
- Email
- Webhook/API
- Phone/calls later
- Demo channel

## MVP channel priority

### Implement first

1. Demo channel.
2. Website widget or public web form.
3. Generic webhook/API.
4. Telegram if practical.
5. Email inbound/outbound stub.

### Placeholder UI first

- WhatsApp Business
- Instagram
- VK
- Calls

These can be visible in the Integrations page as “Coming soon” or “Connect” states, but backend adapter can be stubbed.

## Channel adapter interface

```ts
export interface ChannelAdapter {
  type: ChannelType;
  verifyWebhook?(input: WebhookVerificationInput): Promise<boolean>;
  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
```

## Normalized inbound message

```ts
export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalConversationId: string;
  customerExternalId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  timestamp: string;
  raw: unknown;
}
```

## Send message input

```ts
export interface SendMessageInput {
  tenantId: string;
  channelAccountId: string;
  conversationId: string;
  externalConversationId: string;
  text: string;
  attachments?: string[];
  metadata?: Record<string, unknown>;
}
```

## Webhook processing requirements

Every inbound webhook must:

1. verify signature if possible;
2. store raw event;
3. check `externalEventId` idempotency;
4. normalize payload;
5. create/update conversation;
6. create message;
7. enqueue AI processing;
8. return quickly.

Do not run slow AI calls inside webhook request lifecycle.

## CRM integrations

UI should show:

- amoCRM
- Bitrix24
- RetailCRM
- Google Calendar
- Shopify
- Shop-Script
- Webhook/API

MVP can implement:

- generic CRM webhook;
- demo CRM adapter;
- Google Calendar stub;
- manual “send to CRM” simulated status.

## CRM adapter interface

```ts
export interface CrmAdapter {
  provider: string;
  createLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult>;
  updateLead(input: CrmUpdateLeadInput): Promise<CrmUpdateLeadResult>;
  createTask(input: CrmCreateTaskInput): Promise<CrmCreateTaskResult>;
}
```

## Integration secret storage

Integration credentials must be encrypted before storage.

Store metadata separately from secrets:

```text
provider
status
displayName
scopes
connectedAt
lastSyncAt
encryptedCredentials
```

Do not log tokens, API keys, webhook secrets, or refresh tokens.

## Integration states

```text
CONNECTED
DISCONNECTED
ERROR
PENDING
EXPIRED
COMING_SOON
```

## Integration UI requirements

Each integration card should show:

- icon/logo placeholder;
- provider name;
- short description;
- connected/available/error state;
- action button;
- last sync if connected;
- settings modal;
- test connection button;
- disconnect confirmation modal.

## API keys and webhooks

LeadVirt.ai should support outgoing webhooks for customers.

Use:

```text
WebhookEndpoint
ApiKey
```

Events customers can subscribe to:

```text
lead.created
lead.qualified
booking.created
conversation.closed
crm.sync.completed
```

## Website widget MVP

The public widget should allow:

- loading tenant config by public key;
- creating visitor conversation;
- sending message;
- receiving AI replies through polling or simple SSE later;
- styling basic theme from tenant settings.

Widget should not expose private tenant data.
