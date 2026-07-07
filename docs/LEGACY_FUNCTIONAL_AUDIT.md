# Legacy Functional Audit

Last updated: 2026-07-07

## Status

The archived `apps/web/src/legacy-functional` and `apps/web/src/features/mock` trees were removed after the active Next routes moved to API-backed product pages under `apps/web/src/design/product`.

## Findings

- No active `/app/**`, auth, design product, component, or API client code imports the removed legacy/mock paths.
- The old legacy app views duplicated flows that are already API-backed in the current shell: dashboard, inbox, conversation actions, pipeline actions, automations, analytics, integrations, settings, billing, and onboarding.

## Guardrail

`corepack pnpm run qa:demo-boundary` fails if active app code reintroduces archived legacy UI, archived mock data, product demo fixtures, or demo-only modules.

## Decision

Do not restore the legacy archive. If a missing behavior is discovered, implement it against the current API/design shell.
