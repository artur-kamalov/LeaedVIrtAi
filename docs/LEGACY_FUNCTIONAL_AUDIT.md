# Legacy Functional Audit

Last updated: 2026-07-02

## Status

`apps/web/src/legacy-functional` is archival reference code only. Active Next routes render the copied design shell and API-backed product pages from `apps/web/src/design/product`.

## Findings

- No active `/app/**`, auth, design product, component, or API client code imports `legacy-functional`.
- No active `/app/**`, auth, design product, component, or API client code imports `features/mock`.
- The old legacy app views duplicate flows that are already API-backed in the current shell: dashboard, inbox, conversation actions, pipeline actions, automations, analytics, integrations, settings, billing, and onboarding.
- The remaining release-critical gaps are not in legacy UI code; they are product decisions or backend/provider work: 2FA, password-reset delivery, staging/public tunnel, and first real acquisition channel.

## Guardrail

`corepack pnpm run qa:demo-boundary` fails if active app code imports archived legacy UI, archived mock data, product demo fixtures, or demo-only modules.

## Decision

Keep `legacy-functional` as a temporary archive until after release review. Do not port from it by default. If a missing behavior is discovered, implement it against the current API/design shell and then delete the corresponding legacy reference.
