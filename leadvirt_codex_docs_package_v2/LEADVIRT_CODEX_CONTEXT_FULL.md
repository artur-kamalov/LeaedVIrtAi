

---

# FILE: README.md

# LeadVirt.ai — Codex Implementation Docs Package

This package is the source-of-truth context for building **LeadVirt.ai**, a universal AI lead assistant SaaS.

LeadVirt.ai turns customer conversations into qualified leads, bookings, orders, CRM records, and manager tasks. The product must feel like an intelligent AI employee that works across customer channels 24/7.

## Primary implementation stack

- **Frontend:** Next.js + React + TypeScript + Tailwind CSS first.
- **Backend:** NestJS + TypeScript.
- **Database:** PostgreSQL + Prisma.
- **Queues:** Redis + BullMQ.
- **Realtime:** WebSocket or SSE from the backend.
- **Storage:** S3-compatible object storage, preferably Cloudflare R2.
- **AI knowledge:** PostgreSQL first; pgvector-compatible architecture for later semantic search.
- **Architecture:** scalable modular monolith with clear module boundaries, adapters, workers, queues, and tenant isolation.

## The most important rule

The Figma Make landing page already exists. Do not break it.

Preserve the existing landing page visual style, animations, sections, motion direction, and generated React/Tailwind components unless explicitly told otherwise. Extend the product UI around it.

## How Codex should use this package

Read these files in order:

1. `.codex/CODEX_MASTER_PROMPT.md`
2. `docs/01_PRODUCT_BRIEF.md`
3. `docs/02_BUSINESS_MODEL_AND_PRICING.md`
4. `docs/03_SCOPE_AND_MVP.md`
5. `docs/04_TECH_STACK_AND_INFRA.md`
6. `docs/05_SCALABLE_ARCHITECTURE.md`
7. `docs/06_MONOREPO_STRUCTURE.md`
8. `docs/07_DATA_MODEL.md`
9. `docs/08_API_DESIGN.md`
10. `docs/09_AI_ORCHESTRATION.md`
11. `docs/10_WORKFLOW_BUILDER.md`
12. `docs/11_CHANNELS_AND_INTEGRATIONS.md`
13. `docs/12_FRONTEND_UI_GUIDELINES.md`
14. `docs/13_MOBILE_RESPONSIVE_GUIDELINES.md`
15. `docs/14_AUTH_RBAC_AND_TENANCY.md`
16. `docs/15_BILLING_USAGE_LIMITS.md`
17. `docs/16_SECURITY_PRIVACY_AND_AI_SAFETY.md`
18. `docs/17_ANALYTICS_EVENTS.md`
19. `docs/18_TESTING_OBSERVABILITY_AND_QA.md`
20. `docs/19_IMPLEMENTATION_ROADMAP.md`
21. `docs/20_ACCEPTANCE_CRITERIA.md`
22. `docs/21_CODEX_TASK_BACKLOG.md`
23. `docs/22_FIGMA_REACT_DESIGN_IMPORT.md`

Use the templates in `templates/` as starting points, not as final production code.


## Figma React design source

A downloaded static React + Tailwind app from Figma will be available in:

```text
LeadVirt-React-design-only/
```

Codex must use this folder as the **visual implementation source for pixel-perfect product layouts**. Codex may copy/refactor JSX, HTML structure, components, and Tailwind classes from this folder. Codex must **not** copy generated routes, route logic, fake app shell code, or Figma-generated architecture. Real routes must be implemented with the planned Next.js App Router structure.

Read `docs/22_FIGMA_REACT_DESIGN_IMPORT.md` before any frontend implementation task.

## Implementation priority

Build in this order:

1. Monorepo and project structure.
2. Shared TypeScript config, linting, formatting, Tailwind config.
3. PostgreSQL + Prisma schema + seed data.
4. NestJS API foundation.
5. Auth, tenants, memberships, RBAC.
6. Frontend app shell and design tokens from the existing Figma export.
7. Dashboard with mocked data, then real API data.
8. Inbox, conversations, leads, pipeline.
9. AI orchestration with mock provider first, then provider adapter.
10. Queue workers, webhook ingestion, website widget, Telegram/webhook MVP adapters.
11. Workflow builder data model and UI.
12. Analytics aggregation.
13. Billing/usage tracking.
14. Integrations and settings.
15. Mobile responsive flows.
16. Tests, security hardening, observability, deployment readiness.

## Non-negotiable engineering principles

- Use TypeScript strict mode.
- Use Tailwind-first UI.
- Use `LeadVirt-React-design-only/` as the pixel-perfect visual source for product UI, but never copy its generated routing or architecture.
- Validate every API input.
- Every business table must have `tenantId` or a strict tenant access path.
- Never trust client-provided `tenantId` without membership checks.
- No raw secrets in logs.
- No provider-specific code in core business modules. Use adapters.
- All external calls must be retryable and observable.
- All webhook processing must be idempotent.
- AI actions must be logged and traceable.
- Prompt templates must be versioned.
- The system must be easy to scale horizontally: stateless API, separate workers, queue-based background jobs, managed Postgres, Redis, object storage.


---

# FILE: .codex/CODEX_MASTER_PROMPT.md

# Codex Master Prompt — LeadVirt.ai

You are Codex implementing **LeadVirt.ai** from an existing Figma Make React + Tailwind-first design.

## Product

LeadVirt.ai is a universal AI lead assistant for businesses. It responds to incoming customer messages 24/7, qualifies leads, books appointments, helps with orders, answers questions, follows up with clients, and sends structured leads to CRM or managers.

The product works for:

- service businesses
- beauty studios
- e-commerce stores
- clinics
- education companies
- auto services
- local businesses
- B2B service companies

## Main product promise

LeadVirt.ai converts customer conversations into revenue actions:

```text
Incoming message → AI qualification → structured lead → booking/order/task/CRM sync → analytics
```

## Hard constraints

1. Preserve the existing landing page and its animations.
2. Do not replace the current visual style with a generic SaaS template.
3. Use the folder `LeadVirt-React-design-only/` as the visual source for pixel-perfect product layouts.
4. You may copy/refactor JSX, HTML structure, components, and Tailwind classes from `LeadVirt-React-design-only/`.
5. Do not copy generated Figma routes, route logic, fake app shell code, or generated architecture from `LeadVirt-React-design-only/`.
6. Rebuild all real routes using the planned Next.js App Router structure.
7. Extract reusable components from the existing Figma-generated code, but keep the original landing stable.
8. Use Next.js + React + TypeScript + Tailwind CSS for the frontend.
9. Use NestJS + TypeScript for the backend API and workers.
10. Use PostgreSQL + Prisma as the main database layer.
11. Use Redis + BullMQ for background jobs and delayed follow-ups.
12. Build a scalable modular monolith, not microservices.
13. Keep all modules separable through interfaces, adapters, queues, and events.
14. Every business operation must be tenant-safe.

## Implementation behavior

Before changing code:

- Inspect existing project structure.
- Inspect `LeadVirt-React-design-only/` and identify available screens/components.
- Identify the landing page files and animation code.
- Mark landing files as protected unless changes are explicitly needed.
- Create a clean app structure around existing assets.
- Create a short design migration plan before frontend implementation.
- Prefer incremental changes over large rewrites.

When writing code:

- Use strict TypeScript.
- Avoid `any` unless documented with a short reason.
- Use small, composable modules.
- Prefer typed DTOs and schemas.
- Put provider-specific logic in adapters.
- Use dependency injection for backend providers.
- Keep business logic out of controllers.
- Keep UI components reusable and accessible.
- Use loading, empty, error, and success states for every important view.

## MVP mindset

Build a production-shaped MVP, not a toy demo.

It is acceptable to use mock providers for external channels and AI at first, but the architecture must allow switching to real providers without rewriting core logic.

Use these provider abstractions:

- `AiProvider`
- `ChannelAdapter`
- `CrmAdapter`
- `BillingProvider`
- `StorageProvider`
- `NotificationProvider`

## Do not build yet

Do not implement these unless explicitly requested:

- microservices
- Kubernetes
- complex enterprise SSO
- voice AI calls
- marketplace
- white-label builder
- mobile native app
- full WhatsApp/Instagram production integration before the adapter layer exists
- custom billing engine before usage tracking exists

## Definition of done for each feature

A feature is complete only when it has:

- UI state
- API endpoint or mocked API contract
- data model if needed
- validation
- error handling
- loading/empty states
- tenant access checks
- audit/event logging when important
- tests for critical logic
- seed/demo data when useful


---

# FILE: CHECKLIST.md

# LeadVirt.ai Implementation Checklist

## Before coding

- [ ] Read `.codex/CODEX_MASTER_PROMPT.md`.
- [ ] Identify protected landing files.
- [ ] Inspect `LeadVirt-React-design-only/`.
- [ ] Create design-to-route/component migration map.
- [ ] Confirm Figma-generated routes will not be copied.
- [ ] Confirm product name: LeadVirt.ai.
- [ ] Confirm stack: Next.js, React, TypeScript, Tailwind, NestJS, PostgreSQL, Prisma, Redis, BullMQ.

## Foundation

- [ ] Monorepo structure.
- [ ] Strict TypeScript.
- [ ] Lint/format scripts.
- [ ] Docker Compose Postgres/Redis.
- [ ] Env validation.
- [ ] Prisma schema and seed.

## Backend

- [ ] NestJS API.
- [ ] Health endpoints.
- [ ] Tenant context.
- [ ] RBAC.
- [ ] Leads.
- [ ] Conversations.
- [ ] Messages.
- [ ] Workflows.
- [ ] Integrations.
- [ ] Usage counters.
- [ ] Audit logs.

## Frontend

- [ ] Pixel-perfect migration from `LeadVirt-React-design-only/`.
- [ ] Clean Next.js App Router structure created without Figma-generated routes.
- [ ] App shell.
- [ ] Dashboard.
- [ ] Inbox.
- [ ] Conversation detail.
- [ ] Leads pipeline.
- [ ] Automation builder.
- [ ] Analytics.
- [ ] Integrations.
- [ ] Settings.
- [ ] Billing.
- [ ] Onboarding.
- [ ] Mobile responsive layouts.

## AI and jobs

- [ ] AI provider interface.
- [ ] Mock AI provider.
- [ ] AI reply job.
- [ ] Field extraction job.
- [ ] Summary job.
- [ ] Usage logging.
- [ ] Follow-up job.

## Quality

- [ ] Implemented UI visually compared against `LeadVirt-React-design-only/`.
- [ ] Dropdowns styled.
- [ ] Modals styled.
- [ ] Tooltips styled.
- [ ] Light theme contrast fixed.
- [ ] Loading states.
- [ ] Empty states.
- [ ] Error states.
- [ ] Tenant isolation tests.
- [ ] Webhook idempotency tests.
- [ ] Demo flow works.


---

# FILE: docs/01_PRODUCT_BRIEF.md

# 01 — Product Brief

## Product name

**LeadVirt.ai**

## Category

AI lead assistant / AI front desk / AI customer conversation automation platform.

## One-liner

LeadVirt.ai is an AI assistant that turns incoming customer messages into qualified leads, bookings, orders, CRM records, and manager tasks.

## Core value proposition

Businesses already pay for traffic, ads, content, social media, SEO, marketplaces, and referrals. They lose money when customers do not get fast answers. LeadVirt.ai captures those conversations, qualifies intent, takes the next action, and gives the team a structured lead instead of a messy chat.

## Main customer problem

Businesses lose revenue because:

- customers write outside working hours;
- managers respond too slowly;
- messages are scattered across channels;
- leads are not qualified properly;
- follow-ups are forgotten;
- CRM data is incomplete;
- owners cannot see which channels and scripts convert.

## Main product promise

```text
Every customer message becomes a structured business opportunity.
```

## Target segments

LeadVirt.ai is universal, but must support vertical scenarios.

### Initial high-priority segments

1. Service businesses: repair, home services, cleaning, technicians, local services.
2. Beauty studios: salons, manicure, hair, cosmetics, spa.
3. E-commerce: product questions, availability, order status, abandoned conversations.
4. Clinics: appointment requests, basic intake, reminders, human handoff.
5. Education: courses, trial lesson bookings, qualification, FAQ.
6. Auto services: repair intake, booking, vehicle details, reminders.

## Primary personas

### Owner / Founder

Wants more leads converted, fewer missed messages, lower admin load, visibility into revenue and channels.

### Manager / Sales agent

Wants qualified conversations, lead context, quick replies, tasks, CRM sync, fewer repetitive questions.

### Administrator / Receptionist

Wants booking support, reminders, organized queue, fewer manual follow-ups.

### Marketer

Wants channel attribution, conversion metrics, campaign feedback, source quality.

### Operations lead

Wants workflow consistency, SLA, assignments, team performance, automation.

## Core jobs to be done

1. Capture all incoming customer messages.
2. Reply instantly with a relevant response.
3. Understand customer intent.
4. Ask qualifying questions.
5. Collect structured fields.
6. Create a booking, order, task, lead, or CRM record.
7. Handoff to a human when needed.
8. Follow up automatically if the customer stops replying.
9. Show owners what happened and what converted.

## Main product modules

- Landing page
- Interactive demo
- Onboarding
- Dashboard / overview
- Inbox
- Conversation detail
- Leads / CRM pipeline
- AI automation builder
- Analytics
- Integrations
- Settings
- Billing and usage
- Mobile responsive flows

## Product personality

LeadVirt.ai should feel:

- intelligent but controlled;
- premium but practical;
- modern but not generic;
- trustworthy for SMBs and mid-market companies;
- visually distinct from boring dashboards;
- focused on revenue, not just chat automation.

## Primary success metrics

- Time to first AI response.
- Number of AI conversations.
- Number of qualified leads.
- Number of bookings/orders created.
- Number of leads sent to CRM.
- Conversion from conversation to qualified lead.
- Conversion from lead to booking/order.
- Follow-up recovery rate.
- AI handoff rate.
- AI cost per tenant.
- Monthly recurring revenue.
- Net revenue retention later.


---

# FILE: docs/02_BUSINESS_MODEL_AND_PRICING.md

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


---

# FILE: docs/03_SCOPE_AND_MVP.md

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


---

# FILE: docs/04_TECH_STACK_AND_INFRA.md

# 04 — Tech Stack and Infrastructure

## Final stack choice

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS first
- Existing Figma Make React/Tailwind export as visual foundation

### Backend

- NestJS
- TypeScript
- REST API with OpenAPI-compatible structure
- WebSocket or SSE for realtime updates

### Database

- PostgreSQL
- Prisma ORM
- Migrations through Prisma
- Shared database / shared schema multi-tenancy with `tenantId`

### Queue and background processing

- Redis
- BullMQ
- Dedicated worker process

### Object storage

- S3-compatible storage
- Recommended MVP provider: Cloudflare R2

### AI layer

- Provider abstraction
- Mock AI provider for local development and tests
- Real AI provider adapter can be configured through environment variables
- Prompt/version logging
- Usage/cost tracking

### Auth

Recommended approach:

- Provider-agnostic auth boundary.
- MVP may use Clerk or a local JWT/password auth module depending on project readiness.
- Internal authorization must always rely on LeadVirt database memberships, not provider metadata alone.

Implementation rule:

```text
External auth identifies the user.
LeadVirt membership model decides tenant access and permissions.
```

### Billing

- Provider abstraction.
- Manual billing mode for MVP.
- Payment provider can be added later.
- Usage tracking must exist from day one.

## Recommended MVP infra

### Web frontend

- Vercel or equivalent Next.js host.

### Backend API and workers

- Railway, Render, Fly.io, or similar container/process hosting.
- API and worker run as separate processes.

### Database

- Neon Postgres, Supabase Postgres, Railway Postgres, or managed PostgreSQL.

### Redis

- Upstash Redis, Railway Redis, or managed Redis.

### Storage

- Cloudflare R2.

### DNS/CDN/WAF

- Cloudflare.

### Errors and monitoring

- Sentry for application errors.
- Structured logs through provider of choice.
- Health checks for API and workers.

## Local development

Use Docker Compose for local dependencies:

- Postgres
- Redis
- Optional local object storage emulator

Apps run locally:

- `apps/web` on port 3000
- `apps/api` on port 4000
- `apps/worker` as a long-running worker process

## Environment strategy

Environments:

- local
- preview
- staging
- production

Rules:

- Do not share production secrets with preview/local.
- Each environment should have its own database or schema.
- Seed demo data only in local/preview/staging.
- Production seed must only create system plans and safe defaults.

## Easy scalability requirements

The architecture must support horizontal scaling without major rewrites:

- API must be stateless.
- Workers must be independently scalable.
- Queue jobs must be idempotent.
- External calls must be retryable.
- Realtime must work with multiple API instances or have an adapter later.
- Database queries must be indexed by tenant, status, channel, and timestamps.
- Analytics aggregation must be background-job based.
- Integrations must use adapters.
- AI providers must use adapters.
- Billing providers must use adapters.

## Production deployment shape

```text
Cloudflare DNS/CDN
    ↓
Next.js frontend
    ↓
NestJS API replicas
    ↓
PostgreSQL
Redis / BullMQ
Object storage
    ↑
Worker replicas
```

## Scaling path

### Stage 1: MVP

- 1 web deployment
- 1 API instance
- 1 worker instance
- managed Postgres
- managed Redis

### Stage 2: Early customers

- 2+ API replicas
- separate workers per queue type if needed
- query indexes and connection pooling
- better observability
- rate limiting

### Stage 3: Growing SaaS

- AI workers scaled separately
- channel webhook workers scaled separately
- analytics workers scaled separately
- read replicas if needed
- tenant-level usage throttling
- advanced caching

### Stage 4: Enterprise

- dedicated database option
- dedicated storage bucket option
- custom retention policies
- custom SLA
- optional private deployment


---

# FILE: docs/05_SCALABLE_ARCHITECTURE.md

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


---

# FILE: docs/06_MONOREPO_STRUCTURE.md

# 06 — Monorepo Structure

## Recommended repository layout

```text
leadvirt/
  apps/
    web/
      src/
        app/
        components/
        features/
        lib/
        styles/
      public/
      package.json

    api/
      src/
        main.ts
        app.module.ts
        modules/
        common/
        config/
      package.json

    worker/
      src/
        main.ts
        queues/
        processors/
      package.json

  packages/
    db/
      prisma/
        schema.prisma
        migrations/
        seed.ts
      src/
        client.ts
      package.json

    shared/
      src/
        types/
        constants/
        schemas/
        utils/
      package.json

    ui/
      src/
        components/
        tokens/
      package.json

    api-client/
      src/
        client.ts
        generated/
      package.json

    config/
      eslint/
      prettier/
      tsconfig/
      tailwind/

    prompts/
      system/
      workflows/
      policies/

  docs/
  templates/
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  turbo.json
  README.md
```

## Package responsibilities

### `apps/web`

- Landing page.
- Marketing pages.
- App dashboard.
- Mobile responsive layouts.
- Client-side data fetching.
- UI states.
- Uses Tailwind-first components.

### `apps/api`

- REST API.
- Auth guards.
- Tenant resolution.
- Webhook endpoints.
- Realtime gateway.
- Business modules.
- OpenAPI docs later.

### `apps/worker`

- BullMQ processors.
- AI jobs.
- Channel send jobs.
- CRM sync jobs.
- Follow-up jobs.
- Analytics aggregation.
- Billing usage aggregation.

### `packages/db`

- Prisma schema.
- Prisma client.
- Migrations.
- Seed data.
- DB utilities.

### `packages/shared`

- Shared TypeScript types.
- Enums and constants.
- Zod schemas if used across frontend/backend.
- Utility functions.

### `packages/ui`

- Shared UI components.
- Design tokens.
- App shell components.
- Reusable primitives.

### `packages/api-client`

- Typed frontend API client.
- Generated client later if OpenAPI is used.

### `packages/prompts`

- AI system prompts.
- Prompt policies.
- Scenario-specific prompt templates.
- Prompt versions.

## Frontend route structure

```text
/
/demo
/pricing
/solutions
/features
/integrations
/login
/signup

/app/onboarding
/app/dashboard
/app/inbox
/app/inbox/[conversationId]
/app/leads
/app/leads/[leadId]
/app/automations
/app/automations/[workflowId]
/app/analytics
/app/integrations
/app/settings
/app/billing
```

## Backend module structure example

```text
apps/api/src/modules/leads/
  leads.module.ts
  leads.controller.ts
  leads.service.ts
  leads.repository.ts
  dto/
  events/
  policies/
  tests/
```

## Worker structure example

```text
apps/worker/src/processors/ai-reply.processor.ts
apps/worker/src/processors/channel-send.processor.ts
apps/worker/src/processors/crm-sync.processor.ts
apps/worker/src/processors/analytics-aggregate.processor.ts
```

## Naming rules

- Use `tenantId`, not `tenant_id`, in TypeScript.
- Use snake_case only in raw SQL if needed.
- Use explicit DTO names: `CreateLeadDto`, `UpdateLeadStatusDto`.
- Use explicit result names: `CreateLeadResult`, `AiReplyResult`.
- Do not use vague names like `DataService`, `HelperService`, `ManagerService`.

## Protected landing page rule

Once existing Figma landing files are identified, add comments or documentation indicating they are protected.

Example:

```ts
// PROTECTED: Existing Figma Make landing section. Do not rewrite or remove animations without explicit request.
```

Move shared primitives out carefully only if visual behavior remains identical.


---

# FILE: docs/07_DATA_MODEL.md

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


---

# FILE: docs/08_API_DESIGN.md

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


---

# FILE: docs/09_AI_ORCHESTRATION.md

# 09 — AI Orchestration

## AI product principle

LeadVirt.ai is not a generic chatbot.

It is an AI assistant that drives conversations toward business actions:

- qualified lead;
- booking;
- order;
- task;
- CRM record;
- human handoff.

## AI flow

```text
Inbound message
  ↓
Load tenant context
  ↓
Load business profile
  ↓
Load conversation history
  ↓
Load active workflow/scenario
  ↓
Classify intent
  ↓
Extract fields
  ↓
Decide next action
  ↓
Generate controlled reply
  ↓
Log AI usage
  ↓
Execute approved action
  ↓
Send message or request human handoff
```

## AI Provider abstraction

Use an interface:

```ts
export interface AiProvider {
  generateReply(input: AiReplyInput): Promise<AiReplyResult>;
  extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult>;
  summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult>;
  classifyIntent(input: AiIntentInput): Promise<AiIntentResult>;
}
```

## Mock provider

Implement `MockAiProvider` first for local development and tests.

It should produce deterministic replies and extraction results based on simple rules.

This allows product UI and workflows to be built before real AI credentials exist.

## AI actions

Allowed AI actions:

```text
reply_to_customer
ask_qualifying_question
extract_lead_fields
summarize_conversation
recommend_next_action
create_task_draft
create_booking_draft
create_order_draft
send_to_crm_draft
schedule_follow_up
request_human_handoff
```

AI can draft actions, but the system must control execution.

## AI must not do

AI must not:

- guarantee final price unless pricing rules are configured;
- confirm a booking without available slot verification;
- promise delivery without order/delivery data;
- provide medical, legal, or financial conclusions;
- delete records;
- modify billing;
- change permissions;
- export private data;
- send mass marketing messages without explicit tenant configuration and consent logic;
- ignore human handoff triggers.

## Handoff triggers

Request human handoff when:

- AI confidence is low;
- customer is angry or complains;
- customer asks for refund/legal/medical/financial advice;
- requested action requires human approval;
- pricing is ambiguous;
- customer explicitly asks for a person;
- workflow reaches a configured handoff node.

## Prompt versioning

Prompts must be versioned.

Do not overwrite production prompt text silently.

Data model:

```text
AiPrompt
AiPromptVersion
```

Each AI usage log should reference prompt version when possible.

## System prompt structure

Use this structure for scenario prompts:

```text
1. Product role
2. Tenant business context
3. Active scenario goal
4. Allowed actions
5. Forbidden actions
6. Required fields
7. Tone of voice
8. Handoff rules
9. Output format
```

## Output format

For AI orchestration, prefer structured JSON internally.

Example:

```json
{
  "reply": "Sure, I can help. What day would be convenient for you?",
  "intent": "booking_request",
  "leadFields": {
    "interest": "manicure",
    "preferredTime": "tomorrow evening"
  },
  "nextAction": {
    "type": "ask_question",
    "requiredField": "exact_time"
  },
  "confidence": 0.86,
  "handoffRequired": false
}
```

The customer-facing reply is only one part of the AI result.

## Business profile context

Each tenant should have a profile:

```text
businessName
businessType
location/timezone
workingHours
services/products
bookingRules
pricingRules optional
FAQ
handoffContacts
toneOfVoice
forbiddenClaims
```

## Vertical scenarios

### Beauty

Required fields:

```text
service
preferredDate
preferredTime
masterPreference optional
name
phone
```

### Service business

Required fields:

```text
serviceType
problemDescription
locationArea
urgency
preferredTime
photo optional
phone
```

### E-commerce

Required fields:

```text
productInterest
size/model/SKU optional
questionType
deliveryCity optional
contact
```

### Clinic

Required fields:

```text
appointmentType
preferredDate
preferredTime
contact
```

Clinic safety rule:

```text
AI can help with appointment and general administrative questions only. AI must not provide diagnosis or medical treatment advice.
```

## AI usage tracking

Track:

- tenant;
- conversation;
- provider;
- model;
- action type;
- prompt version;
- latency;
- status;
- estimated cost;
- token usage if available.

## Cost control

Implement:

- monthly AI conversation limits;
- tenant-level AI usage counters;
- fail-closed behavior when tenant limit is exceeded;
- admin UI notice when usage approaches plan limit;
- fallback to human handoff if AI is unavailable.

## Error handling

If AI provider fails:

1. Store the error in `AiUsageLog`.
2. Mark conversation as `WAITING_FOR_HUMAN` or retry if safe.
3. Notify assigned manager or tenant owner.
4. Do not drop the customer message.


---

# FILE: docs/10_WORKFLOW_BUILDER.md

# 10 — Workflow Builder

## Purpose

The workflow builder lets businesses configure how LeadVirt.ai handles conversations.

It should feel like a no-code scenario builder, but MVP execution can be simplified.

## Main workflow examples

- Booking request.
- Lead qualification.
- FAQ answer.
- Order support.
- Abandoned conversation follow-up.
- CRM handoff.
- Human handoff.

## Workflow data model

Use:

```text
Workflow
WorkflowStep
WorkflowRun
WorkflowRunEvent
```

## Workflow fields

### Workflow

```text
id
tenantId
name
description
status
businessType optional
version
publishedAt
createdById
```

### WorkflowStep

```text
id
workflowId
type
name
positionX
positionY
config Json
nextStepIds Json
```

### WorkflowRun

```text
id
tenantId
workflowId
conversationId
leadId
status
currentStepId
startedAt
completedAt
```

### WorkflowRunEvent

```text
id
workflowRunId
stepId
eventType
payload Json
createdAt
```

## Step types

```text
TRIGGER
AI_MESSAGE
QUESTION
CONDITION
ACTION
DELAY
HANDOFF
END
```

## MVP workflow execution

MVP can execute a subset:

1. Trigger: new inbound message.
2. AI greeting.
3. AI qualifying question.
4. Condition based on extracted field.
5. Action: create lead update, create task, send to CRM stub, book appointment stub.
6. Follow-up delay.
7. Handoff.

## UI requirements

The automation builder page must include:

- scenario list;
- visual canvas;
- node cards;
- connectors;
- selected node settings panel;
- publish button;
- test button;
- draft/active/paused states;
- unsaved changes indicator.

## Node settings examples

### AI greeting node

Fields:

```text
message template
tone
wait for reply toggle
timeout
next step
```

### Qualification node

Fields:

```text
required fields
question text
retry count
fallback behavior
handoff if missing after N attempts
```

### Condition node

Fields:

```text
field
operator
value
true branch
false branch
```

### Action node

Fields:

```text
action type
integration target
field mapping
requires approval toggle
```

## Workflow publishing rules

A workflow cannot be published if:

- it has no trigger;
- it has orphan nodes;
- it has missing required config;
- it has no end state or handoff path;
- it contains unsupported action configuration.

## Execution safety

AI-generated decisions should be bounded by workflow rules.

Example:

```text
AI can ask a qualifying question, but workflow decides whether booking can be created.
```

## Versioning

Publishing a workflow should create or increment a version.

Existing conversations should continue on their original workflow version unless explicitly migrated.

## Default scenario templates

Create templates for:

- generic lead qualification;
- beauty booking;
- service request;
- e-commerce order support;
- clinic appointment intake;
- education trial lesson;
- auto service booking.


---

# FILE: docs/11_CHANNELS_AND_INTEGRATIONS.md

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


---

# FILE: docs/12_FRONTEND_UI_GUIDELINES.md

# 12 — Frontend UI Guidelines

## Frontend principles

- Next.js + React + TypeScript.
- Tailwind-first styling.
- Preserve existing Figma-generated landing style.
- Do not use a heavy UI framework that overrides the design language.
- Use accessible, reusable components.
- Build real product UI states, not static mockups.


## Figma React design source for pixel-perfect UI

The folder below will exist in the project root:

```text
LeadVirt-React-design-only/
```

It is a static React + Tailwind export from Figma. Use it as the **visual source of truth for product layouts**.

Codex may copy/refactor:

- JSX structure;
- HTML structure;
- Tailwind classes;
- cards, dashboards, chat layouts, tables, forms, modals, dropdowns, tooltips, popovers, and mobile layouts.

Codex must not copy:

- generated routes;
- `react-router` setup;
- generated `App.tsx` route logic;
- fake app shell architecture;
- generated data fetching or business logic.

Real routes must be created with the planned Next.js App Router structure.

Before frontend work, inspect this folder and produce a short migration plan that maps Figma static screens/components to real LeadVirt routes and reusable components.

See `docs/22_FIGMA_REACT_DESIGN_IMPORT.md` for the complete import rules.

## Existing landing page rule

The landing page is the visual source of truth.

Do not break:

- animations;
- section order;
- hero visual language;
- typography feel;
- spacing rhythm;
- button shapes;
- card style;
- gradients;
- interactive elements.

If extracting components, verify that the landing still looks and animates the same.

## Product routes

```text
/app/dashboard
/app/inbox
/app/inbox/[conversationId]
/app/leads
/app/leads/[leadId]
/app/automations
/app/automations/[workflowId]
/app/analytics
/app/integrations
/app/settings
/app/billing
/app/onboarding
```

## Marketing routes

```text
/
/demo
/features
/solutions
/pricing
/integrations
/login
/signup
```

## Required desktop screens

1. Dashboard / Overview.
2. Inbox.
3. Conversation / Lead detail.
4. Leads / CRM pipeline.
5. Automation builder.
6. Analytics.
7. Integrations.
8. Settings.
9. Billing / Pricing.
10. Onboarding.

## Component system

Recommended components:

```text
AppShell
Sidebar
TopBar
PageHeader
MetricCard
StatusBadge
ChannelIcon
LeadCard
ConversationListItem
MessageBubble
LeadInfoPanel
ActionButtonGroup
DataTable
KanbanBoard
KanbanColumn
WorkflowCanvas
WorkflowNode
PropertiesPanel
IntegrationCard
PricingCard
Modal
DropdownMenu
Tooltip
Toast
EmptyState
LoadingSkeleton
ErrorState
```

## Visual states

Every interactive component should include:

- default;
- hover;
- active;
- focus;
- disabled;
- loading;
- error if relevant;
- success if relevant.

## Important UI polish items

The following were previously weak or missing in generated design and must be polished:

- dropdown menus;
- popups;
- modals;
- tooltips;
- hover states;
- empty states;
- loading states;
- error states;
- success states;
- notification toasts;
- confirmation dialogs;
- light-theme text contrast.

## Contrast rule

In light theme, avoid light text on light backgrounds.

Use accessible contrast for:

- nav text;
- labels;
- table rows;
- badges;
- disabled states;
- button text;
- chart labels;
- card descriptions.

## Data fetching states

Every page should handle:

```text
loading
empty
loaded
error
permission denied
```

## Design language

The UI should feel:

- premium;
- intelligent;
- conversion-focused;
- alive;
- not generic;
- not overly corporate;
- not childish.

## Dashboard requirements

Cards:

- New leads
- AI conversations
- Bookings/orders created
- Leads sent to CRM
- Average response time
- Conversion rate

Panels:

- Recent activity
- Channel performance
- Quick actions
- AI insights

## Inbox requirements

Must include:

- channel icons;
- search;
- filters;
- status tabs;
- unread indicators;
- lead status badges;
- right-side summary;
- quick actions;
- live updates later.

## Conversation detail requirements

Must include:

- message bubbles;
- AI/user/customer/system distinction;
- quick replies;
- lead info panel;
- action buttons;
- notes;
- status changes;
- handoff state;
- message composer.

## Pipeline requirements

Must include:

- kanban columns;
- draggable-looking cards, actual drag optional for MVP;
- statuses;
- values;
- source/channel;
- assigned manager;
- quick open lead.

## Automation builder requirements

Must include:

- scenario list;
- canvas;
- nodes;
- connectors;
- zoom controls;
- selected node settings;
- publish/test buttons;
- validation warnings.

## Analytics requirements

Must include:

- KPI cards;
- leads by channel chart;
- conversion chart;
- response time chart;
- best sources;
- AI insights.

## Integrations requirements

Must include:

- grid of integration cards;
- connected/disconnected/error states;
- connect modal;
- settings modal;
- disconnect confirmation;
- API/webhook section.


---

# FILE: docs/13_MOBILE_RESPONSIVE_GUIDELINES.md

# 13 — Mobile Responsive Guidelines

## Goal

LeadVirt.ai must feel usable on mobile, especially for owners and managers checking leads quickly.

Mobile is not a separate native app. It is a responsive web app.

## Breakpoints

Use Tailwind breakpoints consistently.

Recommended mental model:

```text
mobile: 0–767px
tablet: 768–1023px
desktop: 1024px+
wide: 1280px+
```

## Mobile landing

Preserve the existing landing visual identity and animation direction.

Do not remove the core visual metaphor. Adapt layout:

- stacked hero;
- simplified nav with drawer;
- CTA visible early;
- product visual scaled down;
- metrics in scrollable cards;
- categories in horizontal chips;
- final CTA readable.

## Mobile app shell

Recommended:

- top bar with tenant name and quick action;
- bottom navigation for core pages;
- slide-out menu for secondary pages;
- sticky action buttons on detail screens.

Primary bottom nav:

```text
Dashboard
Inbox
Leads
Automations
More
```

## Mobile dashboard

Show:

- compact metric cards in 2-column grid;
- recent leads;
- quick actions;
- AI insights;
- channel performance as simple list or mini chart.

Avoid overly dense charts on small screens.

## Mobile inbox

Conversation list should be optimized for one-handed use.

Requirements:

- large tap targets;
- search at top;
- horizontal status filters;
- channel icons;
- unread indicators;
- lead status badges;
- pull-to-refresh feel if implemented.

## Mobile conversation detail

Chat-first layout.

Requirements:

- sticky conversation header;
- collapsible lead info drawer;
- sticky composer;
- quick action bar;
- action sheet for CRM/task/booking/handoff;
- message bubbles readable.

## Mobile lead card

Compact lead summary should show:

- name;
- status;
- source;
- value;
- interest;
- last message time;
- assigned manager;
- quick actions.

## Mobile onboarding

Use step-by-step flow:

1. Choose business type.
2. Connect channel.
3. Choose scenario.
4. Add business info.
5. Connect CRM or skip.
6. Launch.

Each step should have one primary action.

## Mobile automation builder

Full visual workflow editing can be limited on mobile.

Mobile should allow:

- view workflows;
- enable/disable;
- test scenario;
- edit basic settings;
- open desktop recommendation for full visual editing.

## Mobile analytics

Show:

- main KPI cards;
- simple charts;
- best channels list;
- AI recommendations.

Avoid complex multi-axis charts.

## Responsive implementation rules

- Avoid fixed widths that break on mobile.
- Use container queries or responsive utility classes where possible.
- All modals must be mobile-friendly.
- Dropdowns should become bottom sheets when useful.
- Tables should become cards or horizontal scroll.
- Kanban can become grouped lists on mobile.
- Sidebars should collapse into drawer/bottom nav.

## Accessibility

- Touch targets should be at least comfortable size.
- Focus states should remain visible.
- Text should not become too small.
- Contrast must remain readable in light theme.
- Avoid interactions requiring hover only.


---

# FILE: docs/14_AUTH_RBAC_AND_TENANCY.md

# 14 — Auth, RBAC, and Tenancy

## Identity vs authorization

External auth identifies the user. LeadVirt.ai database decides tenant access.

Even if Clerk or another auth provider is used, never rely only on provider metadata for business permissions.

## Core auth entities

```text
User
Tenant
Membership
Role
Permission
Invitation
ApiKey
```

## Roles

Recommended roles:

```text
OWNER
ADMIN
MANAGER
AGENT
VIEWER
```

## Permission model

Start with role-based permissions.

Later, extend to custom permission sets if needed.

## Role permissions

### Owner

Can do everything in the tenant:

- billing;
- delete tenant;
- manage users;
- manage integrations;
- manage workflows;
- view all data;
- export data;
- manage API keys.

### Admin

Can manage most operational settings:

- users except owner transfer;
- channels;
- workflows;
- integrations;
- all leads/conversations;
- analytics;
- settings.

### Manager

Can manage leads and conversations:

- view assigned and team leads;
- assign leads;
- send to CRM;
- create tasks;
- view analytics basics.

### Agent

Can work conversations:

- view assigned leads;
- reply to conversations;
- update lead status;
- create tasks;
- request handoff.

### Viewer

Read-only access:

- dashboard;
- analytics;
- conversations/leads read-only.

## Tenant context resolution

Every authenticated request must resolve:

```text
userId
tenantId
membershipId
role
permissions
```

Reject request if membership does not exist or tenant is inactive.

## Tenant isolation rules

- All business queries must include tenant scope.
- Do not accept tenantId from request body for mutations.
- Route/header tenantId must be validated against membership.
- API keys must map to exactly one tenant or explicit allowed tenant scope.
- Realtime events must only be sent to tenant members.

## API keys

API keys are used for:

- widget/public integration;
- server-to-server webhooks;
- custom integrations.

API keys must have:

```text
tenantId
name
prefix
hash
scopes
lastUsedAt
expiresAt optional
revokedAt optional
```

Never store raw API keys after creation. Store hash only.

## Invitations

Invitation fields:

```text
tenantId
email
role
tokenHash
expiresAt
acceptedAt
invitedById
```

## Auth modes

Support two implementation modes if needed:

```text
AUTH_MODE=mock
AUTH_MODE=clerk
AUTH_MODE=local
```

### Mock mode

For local demos only. Seed one demo tenant and demo user.

### Clerk mode

Use external identity provider token verification, then load user and membership from LeadVirt DB.

### Local mode

Use email/password + JWT + refresh tokens. This can be implemented later if avoiding external providers.

## Session security

- Use secure cookies where applicable.
- Use CSRF protection where relevant.
- Use refresh token rotation if local auth is implemented.
- Do not expose sensitive tokens to frontend.

## Audit requirements

Audit log these actions:

- login failures beyond threshold;
- role changes;
- user invitations;
- integration connect/disconnect;
- API key creation/revocation;
- billing plan changes;
- workflow publish;
- data export;
- destructive actions.


---

# FILE: docs/15_BILLING_USAGE_LIMITS.md

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


---

# FILE: docs/16_SECURITY_PRIVACY_AND_AI_SAFETY.md

# 16 — Security, Privacy, and AI Safety

## Security principles

- Tenant isolation first.
- Least privilege access.
- No secrets in logs.
- All external events must be verified and idempotent.
- Sensitive tokens must be encrypted.
- AI must be bounded by workflow rules.

## Tenant isolation

Every business record must be tenant-scoped.

Every controller/service must verify tenant access.

Tests must include cross-tenant access attempts.

## Sensitive data

Potentially sensitive data:

- customer names;
- phone numbers;
- emails;
- chat messages;
- order information;
- appointment details;
- integration tokens;
- API keys;
- uploaded files.

## Logging rules

Do not log:

- raw customer phone numbers when not needed;
- raw access tokens;
- refresh tokens;
- API keys;
- webhook secrets;
- full message bodies in error logs unless explicitly redacted.

Use structured logs with:

```text
requestId
tenantId
userId optional
module
action
status
latencyMs
```

## Encryption

Encrypt integration credentials at rest.

Use an environment-provided encryption key.

```text
ENCRYPTION_KEY
```

## API key security

- Show API key only once at creation.
- Store hash, not raw key.
- Use prefixes for identification.
- Support revocation.
- Support scopes.

## Webhook security

- Verify provider signatures when possible.
- Rate-limit webhook endpoints.
- Store events before processing.
- Process asynchronously.
- Enforce idempotency.

## Rate limits

Implement rate limiting for:

- public widget;
- auth endpoints;
- API keys;
- webhooks;
- AI reply requests;
- message sending.

Use tenant-level and IP-level throttling where possible.

## AI safety rules

AI can:

- answer administrative/business FAQs;
- ask qualifying questions;
- collect fields;
- summarize;
- draft actions;
- recommend next steps;
- schedule follow-ups.

AI cannot:

- provide medical diagnosis;
- provide legal conclusions;
- provide financial advice;
- guarantee price unless tenant has explicit configured rules;
- confirm booking without available slot;
- promise delivery without data;
- delete customer data;
- change billing;
- change access rights;
- send mass marketing messages without explicit configured consent.

## High-risk verticals

For clinics, finance, legal, insurance, and regulated businesses:

- AI should handle intake and administrative scheduling only;
- AI must avoid professional advice;
- human handoff should be easier and more frequent;
- disclaimers may be needed in tenant templates.

## Human handoff

Handoff required when:

- confidence is low;
- user asks for a human;
- user is angry;
- refund/cancellation dispute appears;
- regulated advice appears;
- workflow requires approval;
- AI provider error occurs.

## Data retention

MVP can implement soft retention settings only.

Later:

- retention policy per tenant;
- automatic deletion/archive;
- export tools;
- DPA/security docs.

## Audit logs

Audit these actions:

- tenant settings changes;
- integration connect/disconnect;
- API key create/revoke;
- user role changes;
- workflow publish;
- billing plan changes;
- destructive actions;
- data export.

## Frontend security

- Escape/render user-generated message content safely.
- Do not use dangerouslySetInnerHTML for messages unless sanitized.
- Avoid exposing backend secrets to frontend.
- Keep public widget token limited and scoped.

## Development security checklist

Before production:

- env secrets are not committed;
- CORS is restricted;
- cookies are secure;
- auth guards cover all protected routes;
- tenant checks are tested;
- rate limits exist;
- Sentry/logging redaction exists;
- webhook idempotency exists;
- integration secrets encrypted;
- backups configured.


---

# FILE: docs/17_ANALYTICS_EVENTS.md

# 17 — Analytics and Events

## Analytics goal

LeadVirt.ai analytics should help owners understand:

- where leads come from;
- how fast AI responds;
- which scenarios convert;
- how many bookings/orders are created;
- which channels perform best;
- where humans need to intervene.

## Product analytics vs customer analytics

There are two types:

### Customer-facing analytics

Shown to tenant users inside LeadVirt.ai.

### Internal product analytics

Used by LeadVirt.ai team to improve retention and product usage.

MVP should focus on customer-facing analytics.

## Customer-facing metrics

Dashboard metrics:

```text
new leads
AI conversations
bookings/orders created
leads sent to CRM
average response time
conversion rate
follow-up recovered leads
handoff rate
```

Analytics page metrics:

```text
leads by channel
conversion by scenario
response time trend
bookings/orders trend
revenue estimate
best-performing channels
lead status distribution
AI insights
```

## Event taxonomy

Recommended domain events:

```text
tenant.created
user.invited
user.joined
channel.connected
channel.disconnected
conversation.created
conversation.message_received
conversation.ai_reply_queued
conversation.ai_replied
conversation.handoff_requested
lead.created
lead.updated
lead.status_changed
lead.qualified
booking.created
order.created
task.created
crm.sync_started
crm.sync_completed
crm.sync_failed
workflow.created
workflow.published
workflow.run_started
workflow.run_completed
usage.limit_warning
usage.limit_reached
subscription.updated
```

## Event fields

Each event should include:

```text
id
tenantId
eventType
actorUserId optional
leadId optional
conversationId optional
workflowId optional
channelAccountId optional
payload Json
createdAt
```

## Aggregation strategy

MVP:

- simple SQL queries for dashboard;
- background aggregation job for analytics if needed.

Later:

- pre-aggregated daily metrics table;
- event outbox;
- separate analytics warehouse if scale requires it.

## Daily metrics table

Optional table:

```text
DailyTenantMetric
- tenantId
- date
- newLeads
- aiConversations
- bookingsCreated
- ordersCreated
- crmSyncs
- averageResponseTimeMs
- conversionRate
- aiCostEstimate
```

## Channel performance

Track per channel:

```text
channelType
channelAccountId
leads
conversations
qualifiedLeads
bookings
orders
responseTimeMs
conversionRate
```

## Scenario performance

Track per workflow/scenario:

```text
workflowId
runs
completedRuns
qualifiedLeads
bookings
orders
handoffs
conversionRate
averageSteps
```

## AI insights

AI insights should be generated from analytics and phrased as recommendations.

Examples:

```text
WhatsApp has the highest booking conversion this week.
Most leads arrive between 14:00 and 18:00.
The beauty booking scenario converts 12% better after adding quick replies.
Follow-up messages recovered 18 conversations this month.
```

For MVP, insights can be rule-based, not AI-generated.

## Revenue estimate

Revenue estimate is optional and should be clearly labeled as an estimate.

Use:

```text
bookingCount * averageOrderValue
```

Tenant can configure average order value.

## Data retention for analytics

MVP can keep all events.

Later, aggregate and archive old raw events.


---

# FILE: docs/18_TESTING_OBSERVABILITY_AND_QA.md

# 18 — Testing, Observability, and QA

## Testing philosophy

Test critical business and security logic first.

Do not aim for perfect coverage before MVP, but do not skip tenant isolation, webhook idempotency, usage limits, and AI safety logic.

## Test types

### Unit tests

Use for:

- lead status transitions;
- usage limit calculations;
- permission checks;
- AI orchestration decisions;
- adapter normalization;
- workflow validation;
- pricing/plan logic.

### Integration tests

Use for:

- API endpoints;
- database repositories;
- webhook ingestion;
- queue job processors;
- CRM sync stubs;
- auth + tenant guards.

### E2E tests

Use for critical flows:

1. signup/onboarding;
2. dashboard loads;
3. inbound message creates conversation;
4. AI reply is generated;
5. lead is qualified;
6. lead is sent to CRM stub;
7. usage counter increments.

## Mandatory security tests

- User from tenant A cannot access tenant B lead.
- User from tenant A cannot receive tenant B realtime event.
- API key scoped to tenant A cannot write tenant B data.
- Webhook duplicate event does not create duplicate message.
- Integration token is not returned in API response.

## UI QA checklist

Every page should include:

- loading state;
- empty state;
- error state;
- success state;
- mobile layout;
- keyboard focus states;
- readable contrast;
- styled dropdowns;
- styled modals;
- styled tooltips;
- no broken text overflow.

## Observability

Add structured logging.

Log fields:

```text
requestId
tenantId
userId optional
module
action
status
latencyMs
errorCode optional
```

## Error tracking

Use Sentry or equivalent for:

- frontend exceptions;
- backend exceptions;
- worker job failures.

## Health checks

API:

```text
GET /health
GET /health/ready
```

Worker:

- logs startup;
- exposes health endpoint if deployed as HTTP process;
- reports queue connection status.

## Queue monitoring

Track:

- waiting jobs;
- active jobs;
- failed jobs;
- retry count;
- dead-letter jobs.

## Audit logs

Critical actions must create audit records.

Examples:

- workflow published;
- integration connected;
- API key created;
- billing plan changed;
- lead exported;
- user role changed.

## QA acceptance before demo

Before using for sales demos:

- demo tenant can be reset/seeded;
- all primary pages load;
- mobile views are usable;
- no console errors on landing;
- animations still work;
- lead flow demo works end-to-end;
- pricing is correct;
- product name LeadVirt.ai appears consistently.


---

# FILE: docs/19_IMPLEMENTATION_ROADMAP.md

# 19 — Implementation Roadmap

## Phase 0 — Project inspection and preservation

1. Inspect existing Figma Make React/Tailwind code.
2. Inspect `LeadVirt-React-design-only/` as the pixel-perfect product UI source.
3. Identify landing page files.
4. Identify animations and dependencies.
5. Mark landing sections/components as protected.
6. Create a design migration map from `LeadVirt-React-design-only/` screens/components to real Next.js routes/components.
7. Replace placeholder product name with LeadVirt.ai where appropriate.
8. Fix obvious visual contrast issues without redesigning the landing.

## Phase 1 — Foundation

1. Create or normalize monorepo structure.
2. Add strict TypeScript configs.
3. Add linting and formatting.
4. Add environment config system.
5. Add shared constants/types package.
6. Add Docker Compose for Postgres/Redis.
7. Add Prisma schema and seed.

## Phase 2 — Backend core

1. Create NestJS API app.
2. Add config module.
3. Add database module.
4. Add auth guard/mode.
5. Add tenant/membership resolution.
6. Add RBAC service.
7. Add common error handling.
8. Add request logging.
9. Add health endpoints.

## Phase 3 — Core product data

1. Tenants.
2. Users/memberships.
3. Leads.
4. Conversations.
5. Messages.
6. Channel accounts.
7. Workflows.
8. Integrations.
9. Usage counters.
10. Audit logs.

## Phase 4 — Frontend app shell

1. Use `LeadVirt-React-design-only/` as the visual source for pixel-perfect UI.
2. Extract/refactor useful static React + Tailwind components.
3. Create app layout.
4. Sidebar/topbar.
5. Responsive nav.
6. Protected app routes using Next.js App Router, not Figma-generated routes.
7. Shared cards/badges/buttons/dropdowns/modals.
8. Loading/empty/error states.

## Phase 5 — Main app pages

1. Dashboard.
2. Inbox.
3. Conversation detail.
4. Leads pipeline.
5. Automations builder.
6. Analytics.
7. Integrations.
8. Settings.
9. Billing.
10. Onboarding.

## Phase 6 — AI and queues

1. Add Redis/BullMQ.
2. Add worker app.
3. Add AI provider interface.
4. Add Mock AI provider.
5. Add AI reply job.
6. Add field extraction job.
7. Add summary job.
8. Add usage logging.
9. Add handoff behavior.

## Phase 7 — Channels and integrations

1. Demo channel.
2. Website widget or public web form.
3. Generic webhook adapter.
4. Telegram adapter/stub.
5. CRM adapter/stub.
6. Send-to-CRM workflow.
7. Integration settings and test connection UI.

## Phase 8 — Billing and usage

1. Plans seed.
2. Subscription model.
3. Usage counters.
4. Limit checks.
5. Billing UI.
6. Manual billing mode.
7. Provider abstraction.

## Phase 9 — Analytics

1. Dashboard metrics endpoints.
2. Analytics endpoints.
3. Rule-based insights.
4. Daily aggregation job optional.

## Phase 10 — Mobile and polish

1. Mobile dashboard.
2. Mobile inbox.
3. Mobile conversation.
4. Mobile lead card.
5. Mobile onboarding.
6. Dropdowns/modals/tooltips polish.
7. Contrast fixes.
8. Accessibility pass.

## Phase 11 — QA and deployment readiness

1. Unit tests.
2. Integration tests.
3. E2E happy path.
4. Tenant isolation tests.
5. Webhook idempotency tests.
6. Seed/demo reset script.
7. Deployment docs.
8. Production env checklist.

## Recommended first vertical demo

Use beauty studio demo data because it is easy to understand visually:

```text
Customer asks for manicure appointment.
AI asks service/time.
AI creates booking.
Lead card is updated.
Manager sees the booking in dashboard.
```

Also include service business and e-commerce seeded examples.


---

# FILE: docs/20_ACCEPTANCE_CRITERIA.md

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


---

# FILE: docs/21_CODEX_TASK_BACKLOG.md

# 21 — Codex Task Backlog

Use this as the implementation backlog.

## Task 1 — Inspect design sources and protect landing

- Locate landing files.
- Locate animation code.
- Inspect `LeadVirt-React-design-only/`.
- List available static React + Tailwind screens/components.
- Create a map from design components to real Next.js routes/components.
- Replace placeholder product naming with LeadVirt.ai where safe.
- Do not change landing layout unless explicitly needed.
- Do not copy generated Figma routes.
- Add comments marking protected landing sections.

## Task 2 — Create project foundation

- Normalize monorepo.
- Add pnpm workspace if not present.
- Add TypeScript strict config.
- Add lint/format scripts.
- Add shared packages.
- Add environment validation.

## Task 3 — Add backend API app

- Create NestJS API app.
- Add health endpoints.
- Add config module.
- Add Prisma database module.
- Add common error filter.
- Add request logging.

## Task 4 — Add database schema and seed

- Create Prisma schema.
- Add migrations.
- Seed plans.
- Seed demo tenant.
- Seed demo users.
- Seed demo leads/conversations/messages.
- Seed demo workflows/integrations.

## Task 5 — Auth and tenancy

- Implement auth mode.
- Implement tenant resolver.
- Implement membership model.
- Implement RBAC guard.
- Add cross-tenant tests.

## Task 6 — Frontend app shell

- Build `/app` layout using Next.js App Router.
- Use `LeadVirt-React-design-only/` for pixel-perfect visuals.
- Copy/refactor useful JSX, HTML structure, and Tailwind classes.
- Do not copy Figma-generated routes or fake app shell logic.
- Sidebar/topbar.
- Mobile nav.
- Shared components.
- Loading/empty/error states.
- Preserve landing design language and animations.

## Task 7 — Dashboard

- Backend summary endpoint.
- Frontend dashboard page.
- Metric cards.
- Recent activity.
- Channel performance.
- Quick actions.

## Task 8 — Inbox and conversations

- Conversation list API.
- Message list API.
- Send message API.
- Inbox UI.
- Conversation detail UI.
- Lead info panel.
- Mobile views.

## Task 9 — Leads pipeline

- Leads CRUD API.
- Status updates.
- Assignment.
- Pipeline UI.
- Lead detail drawer/page.

## Task 10 — AI mock provider

- Add AI provider interface.
- Add mock provider.
- Add AI reply endpoint/job.
- Add extraction endpoint/job.
- Add summary endpoint/job.
- Log usage.

## Task 11 — Queue workers

- Add Redis/BullMQ.
- Add worker app.
- Add queues.
- Add processors.
- Add retries and failure logging.

## Task 12 — Channels MVP

- Demo channel.
- Generic webhook endpoint.
- Website widget/public endpoint.
- Telegram adapter or stub.
- Channel account settings.

## Task 13 — Workflow builder

- Workflow data model.
- Workflow API.
- Builder UI.
- Node settings panel.
- Publish/test actions.
- Basic validation.

## Task 14 — Integrations

- Integration account model.
- Integration grid UI.
- Connect/settings modals.
- CRM adapter interface.
- CRM sync stub.
- Webhook/API settings.

## Task 15 — Billing and usage

- Plan model.
- Subscription model.
- Usage counters.
- Limit checks.
- Billing settings page.
- Pricing page updates.

## Task 16 — Analytics

- Analytics API.
- Charts.
- Channel performance.
- Scenario performance.
- Insights.

## Task 17 — Settings

- Company profile.
- Team members.
- Roles.
- Notifications.
- Security.
- API keys.

## Task 18 — UI polish

- Compare implemented UI against `LeadVirt-React-design-only/` for pixel-perfect alignment.
- Dropdown styling.
- Modal styling.
- Tooltip styling.
- Toasts.
- Contrast fixes.
- Hover/focus states.
- Empty/error/loading states.

## Task 19 — Mobile responsive

- Mobile landing check.
- Mobile dashboard.
- Mobile inbox.
- Mobile conversation detail.
- Mobile onboarding.

## Task 20 — QA and deployment

- Unit tests.
- Integration tests.
- E2E happy path.
- Seed reset script.
- Env example.
- Deployment checklist.


---

# FILE: docs/22_FIGMA_REACT_DESIGN_IMPORT.md

# 22 — Figma React Design Import Guide

A ready static React + Tailwind layout exported from Figma will be available in the project folder:

```text
LeadVirt-React-design-only/
```

This folder is a **visual implementation source**, not an application architecture source.

Codex must use it to create pixel-perfect LeadVirt.ai layouts. Codex may copy and refactor components, JSX structure, HTML structure, and Tailwind classes from this folder. Codex must not copy generated routing or generated application architecture from this folder.

---

## Purpose

`LeadVirt-React-design-only/` contains the approved Figma design as a small static React + Tailwind app.

Use it to:

- match the approved design as closely as possible;
- preserve exact visual style, spacing, typography, colors, shadows, border radius, gradients, and responsive behavior;
- reuse component markup and Tailwind utility classes;
- avoid rebuilding the UI from memory;
- ensure the product app looks consistent with the approved landing page.

---

## Allowed to copy/refactor

Codex may copy and refactor:

- JSX structure;
- static HTML layout;
- Tailwind classes;
- visual sections;
- component markup;
- cards;
- tables;
- lists;
- dashboards;
- chat layouts;
- lead cards;
- kanban cards;
- workflow nodes;
- pricing cards;
- modals;
- dropdowns;
- tooltips;
- popovers;
- forms;
- mobile layouts;
- simple animation classes or transitions when clean and compatible.

When copying, convert static generated markup into clean, typed, reusable production components.

---

## Not allowed to copy

Do **not** copy the Figma export as the real application.

Do not copy:

- generated route structure;
- generated route maps;
- `react-router` setup;
- generated `App.tsx` routing logic;
- fake page switching logic;
- random generated state management;
- messy generated data fetching;
- business logic from the Figma export;
- hardcoded architecture decisions;
- duplicate low-quality components without refactoring;
- generated file structure when it conflicts with the planned monorepo and Next.js architecture.

Figma-generated route code is considered low quality. The final app must use the planned Next.js App Router structure.

---

## Source-of-truth priority

When sources conflict, use this priority:

1. **LeadVirt architecture documentation** for app structure, routing, backend contracts, tenancy, security, data flow, and business logic.
2. **Existing landing page implementation** for landing page animations and marketing visual behavior.
3. **`LeadVirt-React-design-only/`** for visual layout, JSX structure, Tailwind classes, components, and pixel-perfect product UI.
4. **Codex judgment** only for glue code, accessibility fixes, responsive improvements, and production refactoring.

Never allow generated Figma routes to override the planned Next.js architecture.

---

## Required workflow before frontend implementation

Before implementing or modifying any product UI, Codex must:

1. Inspect `LeadVirt-React-design-only/`.
2. List the available screens and reusable components.
3. Identify which design component maps to which real product page.
4. Create a short migration plan.
5. Extract/refactor UI into the real app structure.
6. Preserve the existing landing page and animations.

---

## Target Next.js route structure

Use the real app routes below. Do not use Figma-generated routes.

```text
apps/web/src/app/
  (marketing)/
    page.tsx
    demo/page.tsx
    features/page.tsx
    solutions/page.tsx
    pricing/page.tsx
    integrations/page.tsx
  (auth)/
    login/page.tsx
    signup/page.tsx
  (app)/
    layout.tsx
    dashboard/page.tsx
    inbox/page.tsx
    inbox/[conversationId]/page.tsx
    leads/page.tsx
    leads/[leadId]/page.tsx
    automations/page.tsx
    automations/[workflowId]/page.tsx
    analytics/page.tsx
    integrations/page.tsx
    settings/page.tsx
    billing/page.tsx
    onboarding/page.tsx
```

The Figma export may provide visual content for these pages, but it must not define the routing system.

---

## Component extraction targets

Refactor useful design code into production components such as:

```text
apps/web/src/components/ui/
apps/web/src/components/layout/
apps/web/src/components/marketing/
apps/web/src/components/leadvirt/
apps/web/src/features/dashboard/components/
apps/web/src/features/inbox/components/
apps/web/src/features/leads/components/
apps/web/src/features/automations/components/
apps/web/src/features/analytics/components/
apps/web/src/features/integrations/components/
apps/web/src/features/settings/components/
apps/web/src/features/onboarding/components/
```

Examples:

```text
MetricCard
StatusBadge
ChannelIcon
LeadCard
ConversationListItem
MessageBubble
LeadInfoPanel
KanbanColumn
WorkflowNode
PropertiesPanel
IntegrationCard
PricingCard
Modal
DropdownMenu
Tooltip
Popover
Toast
EmptyState
LoadingSkeleton
```

---

## Refactoring rules

When migrating from `LeadVirt-React-design-only/`:

- keep Tailwind-first styling;
- preserve exact visual classes where useful;
- remove duplicated generated components;
- convert static markup into typed reusable components;
- move repeated raw values into Tailwind theme tokens or CSS variables when helpful;
- use a `cn()` utility for conditional class names;
- avoid `any`;
- avoid hardcoded business data inside reusable components;
- separate visual components from data loading;
- keep feature-specific mock data in feature-level mock files;
- keep accessibility for buttons, inputs, dialogs, menus, tabs, and forms;
- support keyboard navigation for dropdowns, dialogs, and popovers.

Example typed component direction:

```tsx
export type MetricCardProps = {
  label: string;
  value: string;
  change?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};
```

---

## Landing page protection

The landing page already exists and may contain animations.

Codex must:

- not break existing landing animations;
- not remove animated layers;
- not rename animation-dependent components unless necessary;
- not simplify hero/demo animations;
- not replace the landing with Figma export code unless explicitly requested;
- keep marketing animations isolated from app dashboard code if needed.

If `LeadVirt-React-design-only/` includes a landing version, compare it with the existing landing and migrate only safe improvements.

---

## Mobile responsive rules

If the Figma export includes mobile layouts, use them as the visual source.

If mobile layouts are missing for a screen, adapt the desktop design using the same visual language:

- one-column layout;
- compact app header;
- bottom navigation or compact drawer where appropriate;
- chat-first conversation view;
- collapsible lead details;
- sticky primary actions;
- large touch targets;
- no horizontal overflow;
- readable light-theme contrast.

---

## Pixel-perfect acceptance checklist

For every implemented frontend screen, verify:

- visual layout matches the Figma export;
- typography scale matches;
- spacing rhythm matches;
- colors and gradients match;
- cards, shadows, and border radius match;
- sidebar and topbar match;
- buttons and badges match;
- modals, dropdowns, tooltips, and popovers are styled;
- mobile layout is clean and usable;
- light-theme text contrast is readable;
- no unstyled native selects, dropdowns, or inputs remain;
- no Figma-generated broken routes are used;
- existing landing animations still work.

---

## Codex frontend instruction snippet

Use this snippet before any frontend task:

```text
Before implementing frontend UI, inspect the folder `LeadVirt-React-design-only/`.
It contains a static React + Tailwind export from Figma and is the visual source for pixel-perfect layouts.
Use it to copy/refactor components, JSX structure, HTML structure, and Tailwind classes.
Do not copy generated routes, generated router logic, fake app shell code, or Figma-generated architecture.
Rebuild routes using the planned Next.js App Router structure.
Preserve the existing landing page and its animations.
Convert useful static components into clean typed reusable components in the real app.
```


---

# FILE: templates/docker-compose.yml

version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: leadvirt-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: leadvirt
    ports:
      - "5432:5432"
    volumes:
      - leadvirt_postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: leadvirt-redis
    ports:
      - "6379:6379"
    volumes:
      - leadvirt_redis_data:/data

volumes:
  leadvirt_postgres_data:
  leadvirt_redis_data:


---

# FILE: templates/env.example

# LeadVirt.ai environment example

# App
NODE_ENV=development
APP_ENV=local
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
PUBLIC_APP_NAME=LeadVirt.ai

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEMO_MODE=true

# Backend
PORT=4000
CORS_ORIGINS=http://localhost:3000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public

# Redis / queues
REDIS_URL=redis://localhost:6379

# Auth
AUTH_MODE=mock
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
JWT_SECRET=dev-change-me
JWT_REFRESH_SECRET=dev-change-me-too

# Encryption
ENCRYPTION_KEY=dev-32-byte-key-change-in-production

# AI
AI_PROVIDER=mock
AI_DEFAULT_MODEL=
AI_API_KEY=
AI_ENABLE_REAL_PROVIDER=false

# Storage
STORAGE_PROVIDER=local
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=leadvirt-dev
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=

# Email
EMAIL_PROVIDER=mock
RESEND_API_KEY=
POSTMARK_SERVER_TOKEN=
EMAIL_FROM=LeadVirt.ai <noreply@leadvirt.ai>

# Billing
BILLING_MODE=manual
BILLING_PROVIDER=manual
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=

# Integrations
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Observability
SENTRY_DSN=
SENTRY_ENVIRONMENT=local

# Feature flags
FEATURE_REALTIME=true
FEATURE_BILLING=false
FEATURE_AI_REAL_PROVIDER=false
FEATURE_TELEGRAM=false
FEATURE_WEBSITE_WIDGET=true


---

# FILE: templates/openapi_outline.yaml

openapi: 3.0.3
info:
  title: LeadVirt.ai API
  version: 0.1.0
servers:
  - url: http://localhost:4000/api/v1
paths:
  /health:
    get:
      summary: Health check
      responses:
        "200":
          description: OK
  /dashboard/summary:
    get:
      summary: Get dashboard summary
      security:
        - bearerAuth: []
      parameters:
        - in: header
          name: X-Tenant-Id
          schema:
            type: string
          required: true
      responses:
        "200":
          description: Dashboard summary
  /inbox/conversations:
    get:
      summary: List conversations
      security:
        - bearerAuth: []
      parameters:
        - in: header
          name: X-Tenant-Id
          schema:
            type: string
          required: true
        - in: query
          name: status
          schema:
            type: string
        - in: query
          name: cursor
          schema:
            type: string
      responses:
        "200":
          description: Conversation list
  /inbox/conversations/{conversationId}:
    get:
      summary: Get conversation
      security:
        - bearerAuth: []
      parameters:
        - in: header
          name: X-Tenant-Id
          schema:
            type: string
          required: true
        - in: path
          name: conversationId
          schema:
            type: string
          required: true
      responses:
        "200":
          description: Conversation detail
  /inbox/conversations/{conversationId}/messages:
    get:
      summary: List conversation messages
      security:
        - bearerAuth: []
      parameters:
        - in: header
          name: X-Tenant-Id
          schema:
            type: string
          required: true
        - in: path
          name: conversationId
          schema:
            type: string
          required: true
      responses:
        "200":
          description: Messages
    post:
      summary: Send manual message
      security:
        - bearerAuth: []
      parameters:
        - in: header
          name: X-Tenant-Id
          schema:
            type: string
          required: true
        - in: path
          name: conversationId
          schema:
            type: string
          required: true
      responses:
        "201":
          description: Message created
  /leads:
    get:
      summary: List leads
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Lead list
    post:
      summary: Create lead
      security:
        - bearerAuth: []
      responses:
        "201":
          description: Lead created
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT


---

# FILE: templates/prisma_schema_start.prisma

// LeadVirt.ai starter Prisma schema
// This is a production-shaped starting point. Codex may adjust field names and relations as implementation evolves.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PlanCode {
  START
  PROFESSIONAL
  BUSINESS
  CORPORATE
}

enum TenantStatus {
  TRIALING
  ACTIVE
  SUSPENDED
  CANCELLED
}

enum MembershipRole {
  OWNER
  ADMIN
  MANAGER
  AGENT
  VIEWER
}

enum ChannelType {
  WEBSITE
  TELEGRAM
  WHATSAPP
  INSTAGRAM
  VK
  EMAIL
  WEBHOOK
  PHONE
  DEMO
}

enum ChannelStatus {
  ACTIVE
  DISABLED
  ERROR
  PENDING
  COMING_SOON
}

enum LeadStatus {
  NEW
  IN_PROGRESS
  QUALIFIED
  BOOKED
  ORDERED
  SENT_TO_CRM
  CLOSED
  LOST
}

enum LeadTemperature {
  COLD
  WARM
  HOT
}

enum ConversationStatus {
  OPEN
  WAITING_FOR_CUSTOMER
  WAITING_FOR_HUMAN
  CLOSED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageSenderType {
  CUSTOMER
  AI
  USER
  SYSTEM
}

enum MessageStatus {
  RECEIVED
  QUEUED
  SENT
  DELIVERED
  FAILED
}

enum WorkflowStatus {
  DRAFT
  ACTIVE
  PAUSED
  ARCHIVED
}

enum WorkflowStepType {
  TRIGGER
  AI_MESSAGE
  QUESTION
  CONDITION
  ACTION
  DELAY
  HANDOFF
  END
}

enum IntegrationProvider {
  AMOCRM
  BITRIX24
  RETAILCRM
  GOOGLE_CALENDAR
  SHOPIFY
  SHOP_SCRIPT
  WEBHOOK
  OTHER
}

enum IntegrationStatus {
  CONNECTED
  DISCONNECTED
  ERROR
  PENDING
  COMING_SOON
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
  CANCELLED
}

model Tenant {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  status      TenantStatus @default(TRIALING)
  businessType String?
  timezone    String       @default("UTC")
  settings    Json?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  deletedAt   DateTime?

  memberships       Membership[]
  channels          ChannelAccount[]
  leads             Lead[]
  conversations     Conversation[]
  workflows         Workflow[]
  integrations      IntegrationAccount[]
  subscriptions     Subscription[]
  usageCounters     UsageCounter[]
  auditLogs         AuditLog[]
  apiKeys           ApiKey[]

  @@index([status])
}

model User {
  id              String   @id @default(cuid())
  externalAuthId  String?  @unique
  email           String   @unique
  name            String?
  avatarUrl       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  memberships Membership[]
  assignedLeads Lead[] @relation("AssignedLeads")
  messages Message[] @relation("UserMessages")
}

model Membership {
  id        String         @id @default(cuid())
  tenantId  String
  userId    String
  role      MembershipRole @default(AGENT)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([tenantId, userId])
  @@index([tenantId, role])
}

model BillingPlan {
  id              String   @id @default(cuid())
  code            PlanCode @unique
  name            String
  priceMonthlyRub Int
  aiConversations Int?
  channelsLimit   Int?
  usersLimit      Int?
  scenariosLimit  Int?
  features        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  subscriptions Subscription[]
}

model Subscription {
  id          String   @id @default(cuid())
  tenantId    String
  planId      String
  status      String   @default("TRIALING")
  periodStart DateTime @default(now())
  periodEnd   DateTime
  trialEndsAt DateTime?
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan   BillingPlan @relation(fields: [planId], references: [id])

  @@index([tenantId, status])
}

model UsageCounter {
  id              String   @id @default(cuid())
  tenantId        String
  periodStart     DateTime
  periodEnd       DateTime
  aiConversations Int      @default(0)
  messagesSent    Int      @default(0)
  messagesReceived Int     @default(0)
  leadsCreated    Int      @default(0)
  bookingsCreated Int      @default(0)
  crmSyncs         Int     @default(0)
  workflowRuns     Int     @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, periodStart, periodEnd])
}

model ChannelAccount {
  id          String        @id @default(cuid())
  tenantId    String
  type        ChannelType
  status      ChannelStatus @default(PENDING)
  name        String
  externalId  String?
  publicKey   String?       @unique
  settings    Json?
  encryptedCredentials String?
  lastHealthAt DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversations Conversation[]

  @@index([tenantId, type, status])
}

model WebhookEvent {
  id              String   @id @default(cuid())
  tenantId         String?
  provider         String
  externalEventId  String
  payloadHash      String
  payload          Json
  status           String   @default("RECEIVED")
  errorMessage     String?
  receivedAt       DateTime @default(now())
  processedAt      DateTime?

  @@unique([provider, externalEventId])
  @@index([tenantId, provider, receivedAt])
}

model Lead {
  id          String          @id @default(cuid())
  tenantId    String
  name        String?
  phone       String?
  email       String?
  companyName String?
  source      String?
  channelType ChannelType?
  status      LeadStatus      @default(NEW)
  temperature LeadTemperature @default(WARM)
  valueAmount Int?
  currency    String          @default("RUB")
  interest    String?
  summary     String?
  customFields Json?
  assignedToUserId String?
  lastMessageAt DateTime?
  qualifiedAt   DateTime?
  bookedAt      DateTime?
  sentToCrmAt   DateTime?
  closedAt      DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assignedTo User? @relation("AssignedLeads", fields: [assignedToUserId], references: [id])
  conversations Conversation[]
  events LeadEvent[]
  tasks Task[]
  bookings Booking[]

  @@index([tenantId, status, createdAt])
  @@index([tenantId, channelType])
  @@index([tenantId, assignedToUserId])
}

model LeadEvent {
  id        String   @id @default(cuid())
  tenantId  String
  leadId    String
  type      String
  payload   Json?
  createdAt DateTime @default(now())

  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@index([tenantId, leadId, createdAt])
}

model Conversation {
  id               String             @id @default(cuid())
  tenantId          String
  leadId            String?
  channelAccountId  String?
  externalConversationId String?
  status            ConversationStatus @default(OPEN)
  subject           String?
  lastMessageAt     DateTime?
  aiEnabled         Boolean            @default(true)
  handoffRequested  Boolean            @default(false)
  metadata          Json?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  deletedAt         DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  lead Lead? @relation(fields: [leadId], references: [id])
  channelAccount ChannelAccount? @relation(fields: [channelAccountId], references: [id])
  messages Message[]
  workflowRuns WorkflowRun[]

  @@index([tenantId, status, lastMessageAt])
  @@index([tenantId, leadId])
}

model Message {
  id             String            @id @default(cuid())
  tenantId       String
  conversationId String
  direction      MessageDirection
  senderType     MessageSenderType
  senderUserId   String?
  externalMessageId String?
  text           String?
  status         MessageStatus     @default(RECEIVED)
  metadata       Json?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderUser User? @relation("UserMessages", fields: [senderUserId], references: [id])
  attachments MessageAttachment[]

  @@index([tenantId, conversationId, createdAt])
  @@index([externalMessageId])
}

model MessageAttachment {
  id        String   @id @default(cuid())
  tenantId  String
  messageId String
  fileId    String
  createdAt DateTime @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  file FileAsset @relation(fields: [fileId], references: [id])

  @@index([tenantId, messageId])
}

model Workflow {
  id          String         @id @default(cuid())
  tenantId    String
  name        String
  description String?
  status      WorkflowStatus @default(DRAFT)
  businessType String?
  version     Int            @default(1)
  createdById String?
  publishedAt DateTime?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  deletedAt   DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  steps WorkflowStep[]
  runs WorkflowRun[]

  @@index([tenantId, status])
}

model WorkflowStep {
  id          String           @id @default(cuid())
  tenantId    String
  workflowId  String
  type        WorkflowStepType
  name        String
  positionX   Int              @default(0)
  positionY   Int              @default(0)
  config      Json?
  nextStepIds Json?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  workflow Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@index([tenantId, workflowId])
}

model WorkflowRun {
  id             String   @id @default(cuid())
  tenantId       String
  workflowId     String
  conversationId String?
  leadId         String?
  status         String   @default("RUNNING")
  currentStepId  String?
  startedAt      DateTime @default(now())
  completedAt    DateTime?

  workflow Workflow @relation(fields: [workflowId], references: [id])
  conversation Conversation? @relation(fields: [conversationId], references: [id])
  events WorkflowRunEvent[]

  @@index([tenantId, workflowId, startedAt])
}

model WorkflowRunEvent {
  id            String   @id @default(cuid())
  workflowRunId String
  stepId        String?
  eventType     String
  payload       Json?
  createdAt     DateTime @default(now())

  workflowRun WorkflowRun @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)
}

model AiPrompt {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  versions AiPromptVersion[]
}

model AiPromptVersion {
  id        String   @id @default(cuid())
  promptId  String
  version   Int
  content   String
  metadata  Json?
  createdAt DateTime @default(now())

  prompt AiPrompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  usageLogs AiUsageLog[]

  @@unique([promptId, version])
}

model AiUsageLog {
  id              String   @id @default(cuid())
  tenantId        String
  conversationId  String?
  leadId          String?
  provider        String
  model           String?
  actionType      String
  promptVersionId String?
  inputTokens     Int?
  outputTokens    Int?
  estimatedCost   Decimal? @db.Decimal(12, 6)
  latencyMs       Int?
  status          String
  errorMessage    String?
  createdAt       DateTime @default(now())

  promptVersion AiPromptVersion? @relation(fields: [promptVersionId], references: [id])

  @@index([tenantId, conversationId, createdAt])
}

model IntegrationAccount {
  id          String              @id @default(cuid())
  tenantId    String
  provider    IntegrationProvider
  status      IntegrationStatus   @default(PENDING)
  name        String
  scopes      Json?
  settings    Json?
  encryptedCredentials String?
  connectedAt DateTime?
  lastSyncAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  syncLogs IntegrationSyncLog[]

  @@index([tenantId, provider, status])
}

model IntegrationSyncLog {
  id                   String   @id @default(cuid())
  tenantId              String
  integrationAccountId  String
  entityType            String
  entityId              String
  status                String
  externalId            String?
  errorMessage          String?
  payload               Json?
  createdAt             DateTime @default(now())

  integrationAccount IntegrationAccount @relation(fields: [integrationAccountId], references: [id], onDelete: Cascade)

  @@index([tenantId, integrationAccountId, createdAt])
}

model Booking {
  id        String   @id @default(cuid())
  tenantId  String
  leadId    String?
  title     String
  startsAt  DateTime?
  endsAt    DateTime?
  status    String   @default("DRAFT")
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  lead Lead? @relation(fields: [leadId], references: [id])

  @@index([tenantId, startsAt])
}

model Task {
  id          String     @id @default(cuid())
  tenantId    String
  leadId      String?
  title       String
  description String?
  status      TaskStatus @default(TODO)
  dueAt       DateTime?
  assignedToUserId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  lead Lead? @relation(fields: [leadId], references: [id])

  @@index([tenantId, status, dueAt])
}

model Notification {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String?
  type      String
  title     String
  body      String?
  readAt    DateTime?
  payload   Json?
  createdAt DateTime @default(now())

  @@index([tenantId, userId, readAt])
}

model FileAsset {
  id          String   @id @default(cuid())
  tenantId    String
  key         String
  bucket      String
  fileName    String
  mimeType    String
  sizeBytes   Int
  checksum    String?
  accessLevel String   @default("PRIVATE")
  createdAt   DateTime @default(now())

  attachments MessageAttachment[]

  @@index([tenantId, createdAt])
}

model ApiKey {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  prefix    String
  hash      String
  scopes    Json?
  lastUsedAt DateTime?
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, prefix])
}

model AuditLog {
  id          String   @id @default(cuid())
  tenantId    String
  actorUserId String?
  action      String
  entityType  String?
  entityId    String?
  payload     Json?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, createdAt])
}


---

# FILE: templates/seed_data.json

{
  "plans": [
    {
      "code": "START",
      "name": "Start",
      "priceMonthlyRub": 9900,
      "aiConversations": 500,
      "channelsLimit": 2,
      "usersLimit": 3,
      "scenariosLimit": 3
    },
    {
      "code": "PROFESSIONAL",
      "name": "Professional",
      "priceMonthlyRub": 24900,
      "aiConversations": 2500,
      "channelsLimit": 5,
      "usersLimit": 10,
      "scenariosLimit": 15,
      "popular": true
    },
    {
      "code": "BUSINESS",
      "name": "Business",
      "priceMonthlyRub": 59900,
      "aiConversations": 10000,
      "channelsLimit": 10,
      "usersLimit": 25,
      "scenariosLimit": 50
    },
    {
      "code": "CORPORATE",
      "name": "Corporate",
      "priceMonthlyRub": 120000,
      "aiConversations": null,
      "channelsLimit": null,
      "usersLimit": null,
      "scenariosLimit": null
    }
  ],
  "demoTenant": {
    "name": "BeautyLab Demo",
    "slug": "beautylab-demo",
    "businessType": "beauty",
    "timezone": "Europe/Moscow"
  },
  "demoLeads": [
    {
      "name": "Maria Petrova",
      "source": "Instagram",
      "interest": "Manicure with gel polish",
      "status": "BOOKED",
      "temperature": "HOT",
      "valueAmount": 2200
    },
    {
      "name": "Ivan Kuznetsov",
      "source": "Website",
      "interest": "CRM automation consultation",
      "status": "QUALIFIED",
      "temperature": "WARM",
      "valueAmount": 45000
    },
    {
      "name": "Anna Sokolova",
      "source": "Telegram",
      "interest": "Course trial lesson",
      "status": "NEW",
      "temperature": "WARM",
      "valueAmount": 5000
    },
    {
      "name": "Dmitry Orlov",
      "source": "WhatsApp",
      "interest": "Washing machine repair",
      "status": "IN_PROGRESS",
      "temperature": "HOT",
      "valueAmount": 6000
    }
  ]
}


---

# FILE: templates/system_prompt_for_ai_assistant.md

# LeadVirt.ai — Internal AI Assistant System Prompt Template

You are LeadVirt.ai, an AI lead assistant for a business.

Your job is to help the business respond to customer messages, qualify leads, collect required details, and move the conversation toward a useful business action such as booking, order creation, CRM handoff, or human handoff.

You are not a generic chatbot. You are a controlled business assistant.

## Business context

Business name: {{businessName}}
Business type: {{businessType}}
Timezone: {{timezone}}
Working hours: {{workingHours}}
Tone of voice: {{toneOfVoice}}

## Active scenario

Scenario name: {{scenarioName}}
Goal: {{scenarioGoal}}
Required fields: {{requiredFields}}

## Allowed actions

You may:

- answer general administrative questions;
- ask qualifying questions;
- collect structured lead fields;
- summarize the conversation;
- recommend a next action;
- draft a booking/order/task;
- request human handoff.

## Forbidden actions

You must not:

- guarantee final price unless explicit pricing rules are provided;
- confirm a booking unless available slot data is provided;
- promise delivery unless order/delivery data is provided;
- provide medical, legal, or financial conclusions;
- change billing;
- change permissions;
- delete data;
- send mass marketing messages.

## Handoff rules

Request human handoff when:

- confidence is low;
- customer asks for a human;
- customer is angry;
- request involves refund/dispute;
- request involves regulated advice;
- action requires human approval;
- scenario says handoff is required.

## Output JSON

Return JSON only:

```json
{
  "reply": "customer-facing message",
  "intent": "detected_intent",
  "leadFields": {},
  "nextAction": {
    "type": "ask_question | create_booking_draft | create_order_draft | send_to_crm_draft | handoff | none",
    "reason": "short reason"
  },
  "confidence": 0.0,
  "handoffRequired": false
}
```
