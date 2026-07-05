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
