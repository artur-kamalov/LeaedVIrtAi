# 15 — Billing and Usage Limits

## Principle

Billing may be manual in MVP, but usage tracking must be real.

The product must know whether a tenant is within plan limits.

## Plans

Use these plan codes:

```text
START
PROFESSIONAL
BUSINESS
CORPORATE
```

## Monthly limits

| Plan | AI conversations | Channels | Users | Scenarios |
|---|---:|---:|---:|---:|
| Start | 500 | 2 | 3 | 3 |
| Professional | 2,500 | 5 | 10 | 15 |
| Business | 10,000 | 10 | 25 | 50 |
| Corporate | custom | custom | custom | custom |

## Usage counters

Track monthly:

```text
aiConversations
messagesSent
messagesReceived
leadsCreated
bookingsCreated
crmSyncs
workflowRuns
storageUsedMb optional
```

## Usage period

Use tenant billing cycle:

```text
periodStart
periodEnd
```

For MVP, monthly calendar periods are acceptable.

## Limit behavior

When tenant approaches usage limit:

- show warning at 80%;
- show stronger warning at 95%;
- prevent new AI conversations or require upgrade at 100%, depending on plan;
- always allow human users to view existing data.

Do not silently continue expensive AI usage after a hard limit unless overages are enabled.

## Overage packs

Optional:

```text
+1,000 AI conversations = 5,000 ₽
+5,000 AI conversations = 20,000 ₽
```

## Billing provider abstraction

```ts
export interface BillingProvider {
  createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult>;
  createPortalSession(input: PortalInput): Promise<PortalResult>;
  handleWebhook(input: BillingWebhookInput): Promise<BillingWebhookResult>;
}
```

## Manual billing mode

Use:

```text
BILLING_MODE=manual
```

Manual billing should still support:

- plan assignment;
- subscription status;
- usage tracking;
- invoice records;
- admin-visible billing page.

## Subscription statuses

```text
TRIALING
ACTIVE
PAST_DUE
CANCELLED
SUSPENDED
```

## Billing UI

Settings/billing page should show:

- current plan;
- monthly usage progress;
- renewal date;
- invoices;
- upgrade/downgrade options;
- overage information;
- contact sales for Corporate.

## Trial

Default trial:

```text
14 days
no credit card required
```

Trial tenant should have Professional-like feature access with limited usage.

## Corporate plan

Corporate can have custom limits stored in subscription metadata:

```json
{
  "aiConversations": 50000,
  "channels": 25,
  "users": 100,
  "scenarios": 200,
  "sla": "custom"
}
```
