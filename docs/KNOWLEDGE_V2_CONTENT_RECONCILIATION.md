# Knowledge v2 content reconciliation

Manual fact and guidance mutations enqueue one durable reconciliation job in the same idempotent database transaction as the immutable version.

Covered actions:

- fact create, edit, verify, and reject;
- guidance create, edit, approve, reject, and disable.

The outbox envelope contains only tenant/resource identifiers, action, exact version/hash, resource and draft generations, actor identity/role, and an idempotency hash. Values, instructions, notes, examples, and restricted content are never copied into the job, outbox, inbox result, or reconciliation audit.

The fenced dispatcher:

- rechecks the current membership and role;
- requires the exact resource generation, latest immutable version/hash, action status, and a non-regressed tenant draft generation;
- records leased job attempts and heartbeats;
- marks abandoned attempts timed out before redrive;
- terminates stale, revoked, cancelled, invalid, or expired work deterministically.

Successful and failed reconciliation only affect durable processing records. They do not create or activate publications. Jobs use the existing `knowledge-v2` pipeline and appear in Overview `recentJobs` with FACT or GUIDANCE_RULE resources.

`draftGeneration` is a monotonic lower-bound fence. A later change to another resource does not invalidate already queued work; a successor of the same resource still makes the older event terminally stale through its exact resource/version/hash fence.

Run `qa:knowledge:v2:content-reconciliation` for the PostgreSQL contract smoke.
