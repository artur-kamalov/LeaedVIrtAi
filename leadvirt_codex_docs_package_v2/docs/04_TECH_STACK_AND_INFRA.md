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
