# Knowledge V2 Conflict Candidate Hydration

Restricted candidate plaintext is available only in authenticated conflict detail responses. The response is `private, no-store`; conflict lists, mutations, audits, jobs, outbox, inbox, and logs remain metadata-only.

The reader rechecks current reviewer membership and exact tenant/conflict/candidate membership. Document-backed values also require current source, document, revision, evidence, classification, audience, permission fingerprint/version, deletion generation, and content hash. Missing, corrupt, malformed, expired, stale, or revoked inputs return no value.

Managers may hydrate only low/medium-risk public or internal material. Owners and admins retain elevated-risk access, but malformed audience policy denies every role.

Value-selecting decisions validate every candidate before commit. The durable event carries only an authorization hash and exact metadata pins. Execution rehydrates and revalidates the selected value before creating an immutable successor.

Run:

```powershell
corepack pnpm run qa:knowledge:v2:conflict-hydration
```
