# Knowledge v2 Real-Provider Gate

This protected staging gate evaluates the deployed structured-v2 path. It is separate from `qa:ai:real-eval`, which uses the legacy corpus and is not a Knowledge v2 release gate.

## What Runs

1. Authenticate to a dedicated OWNER/ADMIN evaluation tenant.
2. Re-sync configured Website sources through normal acquisition, scanning, object storage, revision, chunk, and job processing.
3. Validate the exact draft candidate and reconcile its immutable Qdrant snapshot with real multilingual dense embeddings and sparse encoding.
4. Start the existing `PUBLICATION` evaluation over the pinned ACTIVE test-case set.
5. Verify ANSWER traces used dense and sparse candidates, the approved real reranker, the grounded-answer provider, and exact processor/policy pins.
6. Apply the versioned per-locale and risk-sliced policy and write a content-free report.

The gate never publishes the candidate. A successful report informs a release decision; it is not publication authorization.

## Staging Dataset

Use a dedicated tenant with reviewed multilingual Website sources and at least these ACTIVE cases for each of `en`, `ru`, `es`, `fr`, `de`, and `pt`:

- one `ANSWER` case with at least one `REQUIRED_EVIDENCE` expectation;
- one `ABSTAIN` case;
- one `HANDOFF` case;
- tenant-designated critical cases covering the highest applicable risk.

Questions, expected evidence, and source content stay in the protected tenant. Synthetic cases cannot be the only ground truth. Set `KNOWLEDGE_REAL_PROVIDER_EXPECTED_TEST_SET_HASH` to the exact `draft.evaluationTestCaseSetHash` from `/api/knowledge/v2/readiness` after review. Any case edit fails the gate until the new set is reviewed and repinned.

## Required Environment

Store these only in `/opt/leadvirt/secrets/.env` on staging:

```text
KNOWLEDGE_REAL_PROVIDER_API_BASE=http://api:4001/api
KNOWLEDGE_REAL_PROVIDER_API_HOST_ALLOWLIST=api
KNOWLEDGE_REAL_PROVIDER_API_ALLOW_HTTP=true
KNOWLEDGE_REAL_PROVIDER_API_REQUEST_TIMEOUT_MS=30000
KNOWLEDGE_REAL_PROVIDER_EMAIL=<dedicated owner/admin>
KNOWLEDGE_REAL_PROVIDER_PASSWORD=<secret>
KNOWLEDGE_REAL_PROVIDER_SOURCE_IDS=<comma-separated source IDs>
KNOWLEDGE_REAL_PROVIDER_EXPECTED_TEST_SET_HASH=<64 hex>
KNOWLEDGE_REAL_PROVIDER_TIMEOUT_MS=900000
```

The API hostname must match the exact allowlist before credentials are sent. Plain HTTP requires the explicit opt-in shown above and is intended only for the private Docker service name; use HTTPS for a remote host. Every request has a bounded timeout.

The real embedding, reranker, grounded-answer, Qdrant, object-store, website-egress, and database settings must also be present and approved. The runner currently accepts Website sources only and rejects other kinds before sync. It fails before login when credentials or admission are missing, `APP_ENV` is not `staging`/`production`, Qdrant mode is disabled, or an identity contains `dev`, `mock`, `fixture`, `acceptance`, `deterministic`, `local`, `unknown`, or `unconfigured`.

Keep `KNOWLEDGE_REAL_PROVIDER_GATE_ENABLED=false` in the environment file. The protected workflow enables it only for the manual run.

## Running

Deterministic contract verification for PR/main CI:

```bash
corepack pnpm run qa:knowledge:v2:real-provider-contract
```

Real execution requires approval for the GitHub environment `leadvirt-knowledge-quality`. Run `Protected Knowledge Real-Provider Gate` manually after the intended release is on staging. It executes `qa:knowledge:v2:real-provider` inside the worker container and uploads `knowledge-v2-real-provider-gate.json`. It never uses the acceptance fixture and does not run in ordinary CI.

## Gate Rules

- Every locale must contain ANSWER, ABSTAIN, and HANDOFF cases.
- Every tenant critical case must pass; critical pass rate is exactly `1`.
- English retrieval recall is at least `0.90`; other locales are at least `0.85`.
- Grounded ANSWER and safe ABSTAIN/HANDOFF rates are at least `0.95` per locale.
- A global or English aggregate cannot compensate for a failed locale.
- ANSWER cases without retrieval expectations, provider/gate hashes, `AUTO_SEND`, or hybrid trace evidence fail closed.

Thresholds live in `artifacts/evals/knowledge-v2-real-provider-gate.json`. Changing its policy version or floors requires review and a new baseline.

## Report

The report records provider/model/version identities; exact test-set, candidate, index, processor-policy, config, slice, and report hashes; locale, risk, and critical-status aggregates; and latency/token/cost usage where persisted. Tenant, source, run, validation, and case identities are hashed.

It never contains credentials, tenant/source IDs, URLs, questions, source text, excerpts, answers, restricted references, customer identifiers, or provider payloads.
