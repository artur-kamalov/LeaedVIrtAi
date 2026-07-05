You are continuing work on LeadVirt.ai.

LeadVirt.ai is a universal AI lead assistant for businesses. It responds to incoming customer messages 24/7, qualifies leads, books appointments, helps with orders, answers questions, follows up with clients, and sends structured leads to CRM or managers.

IMPORTANT SOURCES OF TRUTH

1. Read the documentation again before coding:
- README.md
- .codex/CODEX_MASTER_PROMPT.md
- docs/*
- templates/*
- LEADVIRT_CODEX_CONTEXT_FULL.md if available

2. The product name is:
LeadVirt.ai

Use LeadVirt.ai everywhere in visible UI.

3. The folder:
LeadVirt-React-design-only/

contains the static React + Tailwind design exported from Figma.

Use it as the pixel-perfect visual source.

You MAY copy/refactor:
- JSX structure
- HTML structure
- Tailwind classes
- visual components
- cards
- dashboard sections
- inbox layouts
- conversation UI
- pricing cards
- integration cards
- settings UI
- mobile layouts
- animation-related visual details

You MUST NOT copy:
- generated routes
- generated routing logic
- Figma-generated App.tsx app shell
- messy generated route code
- fake business logic
- fake architecture

Do not modify or delete LeadVirt-React-design-only/. Treat it as read-only.

CURRENT GOAL

Phase 1 created the monorepo foundation.

Now implement Phase 2:

“Make the product usable locally with real database-backed demo data, clean API endpoints, and frontend pages connected to the backend, while preserving pixel-perfect Figma UI.”

Do not implement real production auth, real AI provider calls, real WhatsApp/Instagram integrations, or real payments yet.

For this phase, use:
- seeded demo tenant
- seeded demo user
- seeded demo business data
- clean API architecture
- mocked provider adapters where needed
- deterministic local/mock AI responses where needed

PHASE 2 — CORE DATA, API, AND UI INTEGRATION

BEFORE CODING

1. Inspect the current repository structure.
2. Run available checks if possible:
   - pnpm install
   - pnpm lint
   - pnpm typecheck
   - pnpm build
   - prisma validate/generate if configured
3. Inspect LeadVirt-React-design-only again and identify which components should be reused for:
   - dashboard
   - inbox
   - conversation detail
   - leads pipeline
   - automations
   - analytics
   - integrations
   - settings
   - pricing
   - onboarding
   - mobile screens
4. Summarize the current state and a short implementation plan before making changes.

IMPLEMENTATION REQUIREMENTS

1. Database and Prisma

Complete the initial Prisma schema enough for a functional local MVP.

Required models:

- Tenant
- User
- Membership
- Role or role enum
- Channel
- Lead
- LeadEvent
- Conversation
- Message
- MessageAttachment
- Workflow
- WorkflowStep
- WorkflowRun
- IntegrationAccount
- AiUsageLog
- AuditLog
- WebhookEvent
- Subscription
- UsageCounter
- Task
- Booking
- Order if already planned and simple
- ApiKey if already planned and simple

Rules:
- All business records must support tenant isolation.
- Use tenantId where applicable.
- Use createdAt and updatedAt.
- Add deletedAt where useful.
- Add indexes for tenantId, status, createdAt, channel, leadId, conversationId.
- Use enums for statuses where appropriate.
- Do not over-model edge cases.
- Keep schema practical and easy to evolve.

Add or update:
- Prisma migration scripts
- Prisma generate script
- seed script

Seed data must create:

Tenant:
- name: “Demo Company”
- product-visible name can be generic business demo

User:
- demo owner/admin user

Channels:
- Website
- Instagram
- WhatsApp
- Telegram
- VK
- Email
- Calls

Leads:
Create realistic demo leads across multiple verticals:
- beauty studio
- service business
- e-commerce
- clinic
- education
- auto service

Conversations:
- At least 10 realistic conversations
- Different channels
- Different statuses
- Some handled by AI
- Some needing human attention
- Some already booked or sent to CRM

Messages:
- Include realistic Russian-language message history
- Include customer messages and AI messages
- Include timestamps

Workflows:
- “Lead qualification”
- “Booking appointment”
- “Order assistance”
- “FAQ response”
- “Follow-up”
- “Send to CRM”

Integrations:
- amoCRM connected
- Bitrix24 available
- Telegram connected
- WhatsApp Business available
- Instagram available
- Email connected
- Google Calendar connected
- Shopify available
- Webhook/API connected

Subscription:
Use the recommended plans from docs:
- Start: 9,900 ₽/month
- Professional: 24,900 ₽/month, highlighted as popular
- Business: 59,900 ₽/month
- Corporate: from 120,000 ₽/month

Demo tenant should be on:
Professional

2. Tenant Context and Dev Auth

Do not implement full production auth yet.

Implement a clean development/demo auth layer:

- Create AuthModule structure if not already present.
- Create a DevAuthGuard or DemoAuthGuard.
- In local development, resolve the current user and tenant from seeded demo data.
- Optionally support headers:
  - x-tenant-id
  - x-user-id
- Never expose cross-tenant data.
- Create a reusable TenantContext or RequestContext service/decorator.

Rules:
- Every API query for business data must be tenant-scoped.
- Never return records from another tenant.
- Keep the auth abstraction ready for Clerk/Auth.js/JWT later.
- Do not hardcode tenant IDs inside business services. Use request context.

3. Backend API

Implement clean REST API endpoints in NestJS.

Required endpoints:

Health:
- GET /health

Current context:
- GET /api/me
- GET /api/current-tenant

Dashboard:
- GET /api/dashboard/summary
Returns:
  - new leads count
  - AI conversations count
  - bookings/orders created
  - leads sent to CRM
  - average response time
  - conversion rate
  - recent activity
  - channel performance

Inbox:
- GET /api/inbox/conversations
Supports query params:
  - status
  - channel
  - search
  - limit
  - cursor or page

Conversation detail:
- GET /api/conversations/:id
- POST /api/conversations/:id/messages
- PATCH /api/conversations/:id/status
- POST /api/conversations/:id/assign
- POST /api/conversations/:id/handoff

Leads:
- GET /api/leads
- GET /api/leads/:id
- PATCH /api/leads/:id
- POST /api/leads/:id/events
- POST /api/leads/:id/actions/send-to-crm
- POST /api/leads/:id/actions/create-task
- POST /api/leads/:id/actions/book-appointment
- GET /api/leads/pipeline/summary or equivalent

Workflows:
- GET /api/workflows
- GET /api/workflows/:id
- POST /api/workflows
- PATCH /api/workflows/:id
- POST /api/workflows/:id/publish
- POST /api/workflows/:id/test

Analytics:
- GET /api/analytics/overview
Returns:
  - leads over time
  - leads by channel
  - conversion by scenario
  - response time
  - bookings/orders
  - estimated revenue
  - best-performing channels
  - AI insights/recommendations

Integrations:
- GET /api/integrations
- POST /api/integrations/:provider/connect
- POST /api/integrations/:provider/disconnect
- PATCH /api/integrations/:provider/settings

Settings:
- GET /api/settings/account
- PATCH /api/settings/account
- GET /api/settings/team
- GET /api/settings/security
- GET /api/settings/billing

Pricing:
- GET /api/billing/plans
- GET /api/billing/current-subscription
- GET /api/billing/usage

Onboarding:
- GET /api/onboarding/state
- PATCH /api/onboarding/state
- POST /api/onboarding/complete-step

API rules:
- Use DTO validation.
- Use services, not controllers with direct DB logic.
- Keep controllers thin.
- Use Prisma through a dedicated service/package.
- Return consistent response shapes.
- Return meaningful errors.
- Add pagination where lists can grow.
- Add basic tests for the most important services/endpoints if the test setup exists.
- Do not implement real external provider side effects yet. Use mocked adapter methods and log audit events.

4. Mock AI Behavior

Do not connect a real AI provider yet.

Implement a MockAiProvider or LocalAiProvider in packages/ai.

It should support:

- generateReply(input)
- extractLeadFields(input)
- summarizeConversation(input)
- recommendNextAction(input)

Behavior can be deterministic and simple.

When a user sends a message in:
POST /api/conversations/:id/messages

The backend should:
1. Save the customer/user message.
2. Optionally create/update lead fields.
3. Create a mock AI reply message.
4. Create AiUsageLog with mock token/cost values.
5. Add LeadEvent or AuditLog entry.
6. Return updated conversation.

For this phase, processing can be synchronous or queue-ready.
If BullMQ is already ready and Redis is easy to run, enqueue a job.
If not, keep it synchronous but keep the code structured so it can be moved to a queue later.

AI boundaries:
- AI must not promise exact pricing unless data exists.
- AI must not confirm booking unless the slot/action is available.
- AI must not provide medical/legal/financial advice.
- AI must hand off or recommend handoff when confidence is low.
- Log all AI actions.

5. Frontend API Client

In apps/web, create a clean API client layer.

Add:
- lib/api/client.ts
- lib/api/dashboard.ts
- lib/api/inbox.ts
- lib/api/conversations.ts
- lib/api/leads.ts
- lib/api/workflows.ts
- lib/api/analytics.ts
- lib/api/integrations.ts
- lib/api/billing.ts
- lib/api/onboarding.ts

Use:
- typed responses
- shared types from packages/types where practical
- environment variable for API URL
- graceful error handling

For local dev:
- NEXT_PUBLIC_API_URL or server-side API_URL

Do not scatter fetch calls randomly through UI components.

6. Frontend Pages Connected to API

Replace hardcoded UI data with API-backed data where practical.

Pages:

Marketing:
- /
- /demo
- /pricing

App:
- /app
- /app/inbox
- /app/inbox/[conversationId] if useful
- /app/leads
- /app/leads/[leadId] if useful
- /app/automations
- /app/automations/[workflowId] if useful
- /app/analytics
- /app/integrations
- /app/settings
- /onboarding

Rules:
- Preserve the visual design from LeadVirt-React-design-only.
- Keep Tailwind-first implementation.
- Use Figma layout/components where possible.
- Do not copy Figma routing.
- Do not break landing animations.
- Keep desktop and mobile responsive.
- Use realistic Russian UI copy.
- Replace placeholder product names with LeadVirt.ai.
- Add loading states.
- Add error states.
- Add empty states.
- Style dropdowns, modals, popovers, tooltips, and hover states consistently.
- Fix light-theme contrast issues where text is too light on a light background.
- Keep UI polished and premium.

7. Specific Product UI Behavior

Dashboard:
- Show real seeded metrics from API.
- Show recent activity.
- Show channel performance.
- Show quick actions.

Inbox:
- Show conversation list from API.
- Filters should update the displayed list.
- Search should work at least client-side or API-side.
- Selecting/opening conversation should show detail page or panel.
- Status badges should reflect real statuses.

Conversation detail:
- Show chat messages from API.
- Message input should POST a new message.
- After sending, show mock AI reply.
- Right-side lead information panel should use real lead data.
- Buttons should call mocked endpoints:
  - Send to CRM
  - Create task
  - Book appointment
  - Mark as qualified
- Show success/error notifications.

Leads:
- Show pipeline/kanban or table from API.
- Support changing status if simple.
- Lead cards should show source, status, value, owner, last activity.

Automations:
- Show workflow list from API.
- Show selected workflow with visual blocks.
- Publish/test actions can be mocked but must update UI state and create audit/event logs if reasonable.

Analytics:
- Show seeded analytics from API.
- Charts can use existing design or lightweight chart implementation.
- Keep it visually close to Figma.
- Add AI insights/recommendations from API.

Integrations:
- Show integration cards from API.
- Connect/disconnect actions are mocked but should update status.
- No real third-party OAuth yet.

Settings:
- Show demo account/company/team/security/billing state.
- Forms can submit to mocked PATCH endpoints.

Pricing:
Use these plans exactly:

Start:
- 9,900 ₽ / month
- small businesses and testing one AI scenario
- 500 AI conversations
- 2 channels
- 3 users
- 3 scenarios

Professional:
- 24,900 ₽ / month
- main recommended plan
- 2,500 AI conversations
- 5 channels
- 10 users
- 15 scenarios
- visually highlight as “Popular”

Business:
- 59,900 ₽ / month
- active sales teams and multiple directions
- 10,000 AI conversations
- 10 channels
- 25 users
- 50 scenarios

Corporate:
- from 120,000 ₽ / month
- chains, clinics, e-commerce companies, holdings
- custom limits
- SLA
- custom integrations
- personal implementation manager

Use “personal implementation manager”, not just “manager”.

8. Shared Types

In packages/types, define or refine:

- Tenant
- User
- Membership
- UserRole
- Channel
- ChannelType
- Lead
- LeadStatus
- LeadTemperature
- Conversation
- ConversationStatus
- Message
- MessageDirection
- MessageSenderType
- Workflow
- WorkflowStep
- IntegrationProvider
- IntegrationStatus
- PricingPlan
- Subscription
- UsageSummary
- DashboardSummary
- AnalyticsOverview

Use these types on frontend and backend where practical.

9. Workers and Queues

Keep worker app running.

Add queue names and placeholder processors if not already present:

- ai.reply
- ai.extractLeadFields
- ai.followUp
- channels.processWebhook
- channels.sendMessage
- crm.syncLead
- analytics.aggregate
- billing.calculateUsage

For Phase 2:
- Workers can log job execution.
- Do not require real external APIs.
- Do not crash if Redis is unavailable in frontend-only dev mode, but document the requirement for full backend dev.
- Keep structure ready for Phase 3.

10. Audit Logs and Events

Add basic audit logging for important actions:

- message sent
- AI reply generated
- lead status changed
- lead sent to CRM
- task created
- booking created
- workflow published
- integration connected/disconnected
- onboarding step completed

Audit logs should include:
- tenantId
- userId if available
- action
- entityType
- entityId
- metadata
- createdAt

11. Development UX

Update scripts if needed:

Root scripts should support something like:
- pnpm dev
- pnpm dev:web
- pnpm dev:api
- pnpm dev:worker
- pnpm db:generate
- pnpm db:migrate
- pnpm db:seed
- pnpm lint
- pnpm typecheck
- pnpm build

Update README with local dev steps:
1. pnpm install
2. copy .env.example to .env
3. docker compose up -d
4. pnpm db:migrate
5. pnpm db:seed
6. pnpm dev

12. Do Not Overbuild

Do NOT implement:
- real Clerk/Auth.js production auth
- real Stripe/YooKassa/CloudPayments
- real WhatsApp Business API
- real Instagram API
- real CRM OAuth
- real OpenAI/Anthropic calls
- Kubernetes
- Kafka
- microservices
- complex enterprise SSO
- voice AI
- white-label system

Use clean abstractions and mocks instead.

ACCEPTANCE CRITERIA

After Phase 2:

1. Local development works:
- pnpm install
- docker compose up -d
- pnpm db:migrate
- pnpm db:seed
- pnpm dev:web
- pnpm dev:api
- pnpm dev:worker

2. API works:
- GET /health works
- GET /api/me works
- Dashboard API returns seeded metrics
- Inbox API returns seeded conversations
- Conversation detail API returns messages and lead info
- Sending a message creates a mock AI reply
- Leads API returns real seeded leads
- Workflows API returns real seeded workflows
- Analytics API returns chart-ready data
- Integrations API returns real seeded statuses
- Billing plans API returns the exact pricing plans

3. UI works:
- Landing remains visually intact
- Product name is LeadVirt.ai
- Pricing uses correct tariffs
- Dashboard renders API data
- Inbox renders API conversations
- Conversation page can send a message and show AI reply
- Leads page renders pipeline/table
- Automations page renders workflow builder UI
- Analytics page renders charts/metrics
- Integrations page shows statuses and mocked actions
- Settings page renders account/team/security/billing sections
- Onboarding flow renders and saves mocked/progress state
- Mobile layouts remain usable and visually polished

4. Architecture quality:
- Clean services/controllers/modules
- Tenant-scoped queries
- No hardcoded secrets
- No direct provider logic inside business modules
- No copied Figma trash routes
- Strict TypeScript
- No avoidable `any`
- Consistent response types
- Errors handled gracefully
- UI components reusable

OUTPUT EXPECTED

Before coding:
- Summarize current repo state.
- Summarize relevant design-folder findings.
- Provide concise implementation plan.

After coding:
- List files created/changed.
- List commands to run.
- List what was implemented.
- List known limitations.
- List next recommended task for Phase 3.

NEXT PHASE PREVIEW

Do not implement Phase 3 now, but keep the code ready for it.

Phase 3 will add:
- real authentication
- real AI provider integration
- real queue-based AI orchestration
- website chat widget
- public demo flow
- first real channel integration
- first CRM integration