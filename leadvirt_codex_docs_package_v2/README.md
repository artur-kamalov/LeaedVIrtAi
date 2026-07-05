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
