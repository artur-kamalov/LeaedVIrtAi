# Knowledge V2 Bulk Review

Bulk resolution is owner/admin-only and accepts 1-50 explicit Review item IDs. Query-wide selection is not supported.

`POST /api/knowledge/v2/review-items/bulk-resolve/preview` returns exact IDs, generations, ETags, eligibility reasons, and a five-minute actor/tenant-bound preview hash. Responses are private and no-store.

Eligible items must all be LOW risk, open, non-conflict, unrestricted, from one READY source, and have the same reason, suggested action, and target schema. Only actions supported by the existing decision executor are admitted.

`POST /api/knowledge/v2/review-items/bulk-resolve` requires the preview hash/expiry, explicit IDs, every ETag, and an Idempotency-Key. It reauthorizes the actor, locks every item in stable order, recomputes eligibility, then commits every terminal state, audit, job, and outbox event in one transaction. Any change or failure rolls back the full batch.

The Review UI exposes checkboxes only to owners/admins and only on visible LOW-risk, non-conflict rows. Selection is capped at 50 and is never extended across pages. Preview shows exact eligible/ineligible counts and reasons before explicit confirmation. Rejections, stale previews, and expiry retain the selection and reload server state; terminal UI state appears only after execute succeeds.

Run:

```powershell
corepack pnpm run qa:knowledge:v2:bulk-review
corepack pnpm run qa:knowledge:v2:bulk-review-ui
```
