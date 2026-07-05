# 03 — Scope and MVP

## MVP objective

Build a production-shaped MVP that can be used for demos, pilots, and early paying customers.

MVP should prove:

```text
LeadVirt.ai can receive messages, respond with AI, qualify leads, show them in an Inbox, create structured records, and show analytics.
```

## Must-have MVP features

### 1. Landing page preservation

The existing Figma Make landing page must remain visually intact, including animations.

### 2. Authentication and tenant setup

- Login/signup flow.
- Tenant/company creation.
- User membership.
- Role-based access control.
- Demo tenant seed data.

### 3. Onboarding flow

Steps:

1. Choose business type.
2. Connect first channel or use demo mode.
3. Choose AI scenario.
4. Add company information.
5. Connect CRM or skip.
6. Launch AI Administrator.

### 4. Dashboard

Show:

- new leads;
- AI conversations;
- bookings/orders created;
- leads sent to CRM;
- average response time;
- conversion rate;
- recent activity;
- channel performance;
- quick actions.

### 5. Inbox

Unified list of incoming conversations from different channels.

MVP channels can be:

- website widget;
- Telegram;
- email/webhook;
- demo seeded channels.

The UI can include placeholders for WhatsApp, Instagram, VK, and calls, but they can remain inactive until adapters are implemented.

### 6. Conversation detail

Show:

- chat messages;
- AI replies;
- quick reply chips;
- lead summary;
- source;
- status;
- temperature;
- assigned manager;
- value;
- actions.

Actions:

- send to CRM;
- create task;
- book appointment;
- mark as qualified;
- handoff to human.

### 7. Leads / CRM pipeline

Kanban stages:

- New
- In progress
- Qualified
- Booked / Ordered
- Sent to CRM
- Closed
- Lost

### 8. AI automation builder

MVP can implement a visual builder UI with persisted workflow graph data.

Execution can be limited to simple linear flows in the first version.

### 9. AI orchestration

MVP must support:

- mock AI provider;
- real provider adapter placeholder;
- lead field extraction;
- conversation summary;
- next-step recommendation;
- AI usage logging.

### 10. Integrations

MVP must support:

- website widget/webhook;
- Telegram adapter or stub;
- email adapter or stub;
- generic webhook/API adapter;
- CRM adapter interface;
- demo CRM sync stub.

### 11. Analytics

Show aggregated metrics from real DB/demo data:

- leads by channel;
- response time;
- conversion by scenario;
- bookings/orders;
- revenue estimate;
- best-performing channels.

### 12. Billing and usage

Implement plans and usage counters. Payment provider can be disabled or mocked.

### 13. Settings

- company profile;
- team members;
- roles;
- channels;
- notifications;
- billing;
- security;
- API keys.

### 14. Mobile responsive

Must include responsive layouts for:

- landing;
- dashboard;
- inbox;
- conversation detail;
- lead card;
- onboarding.

## Out of scope for MVP

Do not build unless explicitly requested:

- native iOS/Android apps;
- AI voice calls;
- full official WhatsApp production integration;
- full official Instagram production integration;
- marketplace;
- white-label page builder;
- microservices;
- Kubernetes;
- complex enterprise SSO;
- advanced BI data warehouse;
- full payment-provider automation if manual billing is enough for pilots.

## MVP quality bar

The app should look and feel like a real SaaS product, not a prototype.

Minimum quality requirements:

- realistic seed data;
- loading states;
- empty states;
- error states;
- hover states;
- modals;
- dropdowns;
- tooltips;
- mobile layouts;
- safe AI boundaries;
- tenant isolation;
- basic tests.
