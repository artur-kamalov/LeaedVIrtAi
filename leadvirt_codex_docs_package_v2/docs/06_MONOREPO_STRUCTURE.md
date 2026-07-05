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
