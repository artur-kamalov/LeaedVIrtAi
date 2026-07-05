# 20 — Acceptance Criteria

## Global acceptance criteria

The product is acceptable when:

- LeadVirt.ai branding is consistent.
- Existing landing page animations are not broken.
- Main product pages exist and are responsive.
- Backend has tenant-safe data access.
- Seed data makes the product look real.
- API has validation and error handling.
- AI flow works with mock provider.
- Usage counters work.
- Basic analytics show real/demo data.
- Integrations page has realistic states.
- Pricing reflects approved plans.

## Landing page

- Existing design preserved.
- Product name is LeadVirt.ai.
- CTA buttons work.
- “Watch demo” opens or scrolls to an interactive demo/simulation.
- No contrast issues in light theme.
- Mobile landing is usable.

## Dashboard

Must show:

- New leads.
- AI conversations.
- Bookings/orders created.
- Leads sent to CRM.
- Average response time.
- Conversion rate.
- Recent activity.
- Channel performance.

## Inbox

Must support:

- list conversations;
- filter by status;
- search;
- channel icons;
- unread state;
- selected conversation;
- right-side lead summary on desktop;
- mobile conversation list.

## Conversation detail

Must show:

- message history;
- AI/customer/user/system message styles;
- lead info;
- status;
- assigned manager;
- source;
- value;
- actions.

Actions:

- send manual message;
- request AI reply;
- create task;
- mark qualified;
- send to CRM stub;
- handoff.

## Leads pipeline

Must show stages:

- New
- In progress
- Qualified
- Booked / Ordered
- Sent to CRM
- Closed
- Lost

Lead cards must show source/channel, status, customer, interest, value, and last activity.

## Automation builder

Must show:

- scenario list;
- workflow canvas;
- nodes;
- selected node settings;
- publish/test controls;
- validation warnings.

MVP does not need full drag/drop execution but should persist workflow graph data.

## Analytics

Must show:

- leads by channel;
- conversion by scenario;
- response time;
- bookings/orders;
- revenue estimate;
- best-performing channels;
- rule-based insights.

## Integrations

Must show:

- amoCRM;
- Bitrix24;
- RetailCRM;
- Telegram;
- WhatsApp Business;
- Instagram;
- VK;
- Email;
- Google Calendar;
- Shopify;
- Webhook/API.

Each card must have connected/disconnected/error/coming soon states.

## Billing

Must show:

- Start: 9,900 ₽/month.
- Professional: 24,900 ₽/month, highlighted Popular.
- Business: 59,900 ₽/month.
- Corporate: from 120,000 ₽/month.
- Usage limits.
- Current usage progress.

## Security

Must pass:

- cross-tenant access blocked;
- webhook idempotency;
- integration secrets not exposed;
- API keys are hashed;
- protected routes require auth;
- role permissions enforced.

## Mobile

Must be usable on mobile for:

- landing;
- dashboard;
- inbox;
- conversation detail;
- lead card;
- onboarding.

## Demo readiness

A demo user should be able to:

1. Log in.
2. See dashboard.
3. Open Inbox.
4. Open a conversation.
5. Trigger/generate AI reply with mock provider.
6. Qualify a lead.
7. Send lead to CRM stub.
8. See metrics updated or represented in analytics.
