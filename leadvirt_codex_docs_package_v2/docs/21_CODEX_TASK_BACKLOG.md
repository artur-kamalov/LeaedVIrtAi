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
