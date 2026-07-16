# Operator Operations

Owner/admin routes:

- `GET /api/operator/operations`
- `GET /api/operator/operations/:kind/:id`
- `POST /api/operator/operations/:kind/:id/reconcile`
- `POST /api/operator/operations/:kind/:id/redrive`

Mutations require `Idempotency-Key`, `If-Match`, and `{ "reason": "..." }`.

Reconcile uses only the configured `OperationStatusReader`. Authoritative `SUCCEEDED` or `FAILED` evidence may resolve `UNKNOWN`; every other result stays `UNKNOWN`.

Redrive rejects external, tool, channel-delivery, AI-reply, outbound-message, deletion, and unproven failures. An eligible internal outbox creates a new generation while the source remains terminal.

Run the PostgreSQL contract:

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public'
corepack pnpm run qa:operator:operations
```
