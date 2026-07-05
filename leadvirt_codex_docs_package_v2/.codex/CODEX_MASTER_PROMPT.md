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
