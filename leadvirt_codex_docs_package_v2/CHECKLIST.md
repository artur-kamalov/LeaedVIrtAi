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
