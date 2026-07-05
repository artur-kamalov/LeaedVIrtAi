# 02 — Business Model and Pricing

## Business model

LeadVirt.ai is a B2B SaaS with monthly subscription plans, usage limits, optional overages, and optional implementation/setup services.

The pricing should communicate business value, not raw AI tokens.

## Billable unit

The main billable unit is an **AI conversation**.

Definition:

> An AI conversation is one unique customer conversation where LeadVirt.ai responds, qualifies, follows up, or performs at least one AI-driven action.

Do not expose token pricing to normal customers.

## Public plans

| Plan | Price | Best for | Limits |
|---|---:|---|---|
| Start | 9,900 ₽ / month | small businesses and testing one AI scenario | 500 AI conversations, 2 channels, 3 users, 3 scenarios |
| Professional | 24,900 ₽ / month | main recommended plan | 2,500 AI conversations, 5 channels, 10 users, 15 scenarios |
| Business | 59,900 ₽ / month | active sales teams and businesses with multiple directions | 10,000 AI conversations, 10 channels, 25 users, 50 scenarios |
| Corporate | from 120,000 ₽ / month | chains, clinics, e-commerce companies, holdings | custom limits, SLA, custom integrations |

## Highlighted plan

**Professional** must be visually highlighted as the recommended plan.

Badge text:

```text
Popular
```

or in Russian UI:

```text
Популярный
```

## Corporate plan manager

The “manager” in Corporate is not a seat/user in the app. It means:

> Dedicated implementation and customer success manager.

Better wording:

```text
Dedicated implementation manager
```

Russian UI wording:

```text
Персональный менеджер по внедрению
```

This person helps with onboarding, scenario setup, CRM integrations, training, troubleshooting, and adoption.

## Optional setup services

Offer setup as an optional service, not a mandatory part of every plan.

| Service | Price |
|---|---:|
| Quick launch | 30,000 ₽ |
| Launch with CRM and scenarios | 70,000 ₽ |
| Custom implementation | from 150,000 ₽ |

## Overage pricing

Use simple overage packs:

| Pack | Price |
|---|---:|
| +1,000 AI conversations | 5,000 ₽ |
| +5,000 AI conversations | 20,000 ₽ |

## External provider costs

Messaging provider costs should be separate when applicable.

UI copy:

```text
Third-party costs for WhatsApp, SMS, telephony, or paid messaging providers may be billed separately when applicable.
```

## Trial

Recommended:

```text
14 days free
No credit card required
Cancel anytime
```

Do not offer a permanent free plan in the first version.

## What to show in the pricing UI

### Start

- 500 AI conversations / month
- 2 channels
- 3 users
- 3 AI scenarios
- Basic Inbox
- Basic analytics
- Telegram/email lead forwarding
- 1 CRM or Google Sheets integration

### Professional

- 2,500 AI conversations / month
- 5 channels
- 10 users
- 15 AI scenarios
- Inbox + lead cards
- Booking / orders / qualification
- Follow-ups
- CRM integration
- Google Calendar
- Advanced analytics
- Vertical scenario templates
- Priority support

### Business

- 10,000 AI conversations / month
- 10 channels
- 25 users
- 50 AI scenarios
- Multiple branches or business directions
- Roles and permissions
- API / webhooks
- Advanced integrations
- Advanced analytics
- AI recommendations
- Support SLA

### Corporate

- Custom limits
- Custom scenarios
- Custom integrations
- Dedicated implementation manager
- Dedicated onboarding
- SLA
- Security review support
- Optional private deployment later
- Team training

## Billing implementation requirements

The app must track usage even before payment integration is complete.

Implement:

- plans;
- subscriptions;
- usage counters;
- monthly usage period;
- limit checks;
- overage flags;
- invoices as internal records;
- billing provider abstraction.

Do not block MVP launch on a payment provider. Manual invoicing is acceptable while the billing model is implemented.
