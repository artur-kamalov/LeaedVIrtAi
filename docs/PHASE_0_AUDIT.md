# Phase 0 Audit

## Repository

The workspace started with three primary items:

- `first_promp` - the build brief.
- `leadvirt_codex_docs_package_v2/` - source-of-truth product, architecture, data model, UI, roadmap, and template docs.
- `LeadVirt-React-design-only/` - read-only static React/Tailwind export from Figma.

There was no initialized Git repository and no existing production app structure.

## Documentation Summary

The docs define LeadVirt.ai as a multi-tenant B2B SaaS that turns customer conversations into structured business opportunities. Phase 1 requires a strict TypeScript pnpm monorepo, a Next.js App Router frontend, NestJS API, BullMQ-ready worker, Prisma/PostgreSQL schema, Redis queues, adapter-based AI/integrations, tenant-scoped business tables, no hardcoded secrets, and a UI that follows the Figma export without copying its generated router.

## Protected Design Sources

The following files in `LeadVirt-React-design-only/` are protected visual references and must not be modified:

- `src/app/components/LandingPage.tsx`
- `src/app/components/HeroVisual.tsx`
- `src/app/components/NichesSection.tsx`
- `src/app/components/PricingSection.tsx`
- `src/app/product/ProductLayout.tsx`
- `src/app/product/shared.tsx`
- `src/app/product/ui.tsx`
- `src/app/product/pages/*.tsx`
- `src/styles/*.css`

## Design Export Map

- Landing page: `LandingPage`, `HeroVisual`, `NichesSection`, `PricingSection`.
- Dashboard: `product/pages/DashboardPage.tsx`.
- Inbox: `product/pages/InboxPage.tsx`.
- Conversation detail: `product/pages/ConversationPage.tsx`.
- Leads pipeline: `product/pages/PipelinePage.tsx`.
- Automation builder: `product/pages/AutomationPage.tsx`.
- Analytics: `product/pages/AnalyticsPage.tsx`.
- Integrations/settings: `product/pages/IntegrationsPage.tsx`, `SettingsPage.tsx`.
- Onboarding/mobile patterns: `OnboardingPage.tsx`, `ProductLayout.tsx`.
- Reusable primitives: `shared.tsx`, `ui.tsx`, `components/ui/*`.
- Animation dependencies: `motion/react`, Tailwind animation utilities, `tw-animate-css`, animated hero SVG/path layers, Radix portaled UI transitions.

## Migration Plan

1. Rebuild real routes with Next.js App Router instead of the Figma in-memory route switcher.
2. Preserve the zinc/emerald visual language, dark app shell, card rhythm, animated landing feel, and styled dropdown/modal/tooltip patterns.
3. Convert static design ideas into typed components in `apps/web/src/components` and shared primitives in `packages/ui`.
4. Use mocked feature data for Phase 1 pages while keeping backend contracts and Prisma models ready for Phase 2.
5. Keep the design export read-only and isolated from production architecture.
