# PostgreSQL RLS Readiness

Status: transaction-context prerequisite implemented; RLS remains disabled.

## Boundary

`@leadvirt/db` exports `withTenantTransaction`. It validates an opaque tenant ID, user ID, membership role, and context source before opening one Prisma interactive transaction. Its first SQL statement sets transaction-local values on that connection:

- `app.tenant_id`
- `app.user_id`
- `app.user_role`
- `app.context_source` (`api_request` or `background_job`)

Only the scoped `Prisma.TransactionClient` reaches the callback. Nested use and reuse after commit or rollback are rejected. `set_config(..., true)` gives `SET LOCAL` semantics, so pooled connections reset on commit and rollback.

API code should enter through `withApiTenantTransaction`; worker jobs should enter through `withWorkerTenantTransaction`. Admin requests and background jobs must still provide an explicit tenant, actor user, current membership role, and source. This boundary does not replace membership revalidation, service tenant filters, composite tenant constraints, or authorization.

## Runtime Role

Before enabling any policy, API and worker deployment credentials must use a dedicated runtime role that:

- is not a superuser;
- has `NOBYPASSRLS`;
- owns no tenant-bearing table;
- receives only required table and sequence grants;
- is separate from migration, maintenance, and break-glass roles.

`inspectRlsRuntimeRole` reports the current PostgreSQL role posture. Local and CI PostgreSQL currently run as the owner/superuser, so `safeForRls=false` is expected until deployment credentials are separated.

## Remaining Migration

1. Inventory every API and worker tenant-bearing query and transaction, including shared package callbacks.
2. Split external HTTP, model, Qdrant, object-storage, and queue work from bounded database phases so connections are not held across network calls.
3. Move tenant database phases to the API or worker helper and remove root Prisma access from inside scoped callbacks.
4. Define explicit pre-auth, cross-tenant operator, metrics, dispatcher, cleanup, and maintenance access; never represent these as an implicit tenant or owner bypass.
5. Provision the non-owner runtime role and make the posture check pass in staging with the production pooler mode.
6. Add policy tests for tenant reads/writes, FK and uniqueness leakage, table ownership, administrative work, pool reuse, and revocation races.
7. Enable and then `FORCE ROW LEVEL SECURITY` in reviewed table groups only after every production path uses the scoped boundary.

The PostgreSQL smoke proves same-connection visibility, commit and rollback reset on a reused pool connection, concurrent isolation, validation before SQL, scoped-client misuse rejection, role posture detection, explicit admin/job contexts, and unchanged RLS state.
