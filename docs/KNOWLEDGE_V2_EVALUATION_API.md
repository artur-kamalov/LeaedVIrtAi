# Knowledge v2 evaluation API

## Batch runs

- `POST /api/knowledge/v2/evaluation-runs` creates an idempotent async `MANUAL` or `PUBLICATION` run for every current ACTIVE saved test-case version.
- `GET /api/knowledge/v2/evaluation-runs` and `GET /api/knowledge/v2/evaluation-runs/:runId` return safe metadata, result statuses, deterministic aggregates, and no questions, answers, or restricted references.
- `POST /api/knowledge/v2/evaluation-runs/:runId/cancel` fences queued or running work.

`DRAFT` creation requires the exact `candidateId`, `candidateVersion`, and `candidateManifestHash`. Readiness exposes those values with the current `validationId` and `evaluationTestCaseSetHash`; clients must match them to the recovered run before enabling publish.

## Aggregate slices

Each run returns sorted slices for:

- canonical locale (`LOCALE:en`);
- immutable test risk (`RISK_LEVEL:HIGH`);
- pinned critical status (`CRITICAL_STATUS:CRITICAL`).

Every slice has status counts, critical counts, pass rate, and `aggregateHash`. The parent aggregate has `sliceManifestHash` and `aggregateHash`. Hashes use sorted immutable result signatures and are independent of database return order.

## Publication gate

Activation requires one completed exact-target `PUBLICATION` run where every current critical case passes inside its canonical locale. A high global pass rate cannot mask one failed locale. Zero current critical cases pass without a run.

Publish and rollback requests create or reuse a durable server-owned evaluation run. Activation delivery waits while evaluation is queued or running. A failed evaluation leaves the active publication pointer unchanged.

## Verification scope

`qa:knowledge:v2:evaluation-publication` uses PostgreSQL and the shared production retriever/grounded-answer execution path for EN, FR, DE, ES, PT, and RU answer, abstain, and handoff contracts. It does not claim real-provider multilingual dense/sparse retrieval quality; those measured floors remain separate release work.
