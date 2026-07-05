# LeadVirt Public Release Ready Report

Status: failed
Started: 2026-07-03T08:27:23.282Z
Finished: 2026-07-03T08:27:23.285Z
Duration seconds: 0

## Environment

- Public web: not set
- Public API: not set
- Selected channels: webhook
- AI provider: openai
- AI real provider enabled: true
- AI model: gpt-5.5
- AI API key: set (redacted)
- Provision user: not set
- Webhook key captured: no
- Webhook secret captured: no

## Steps

### Environment

- Status: failed
- Reason: Missing required env: LEADVIRT_PUBLIC_WEB_BASE, LEADVIRT_PUBLIC_API_BASE, LEADVIRT_PROVISION_EMAIL, LEADVIRT_PROVISION_PASSWORD

## Stop Reason

Missing required env: LEADVIRT_PUBLIC_WEB_BASE, LEADVIRT_PUBLIC_API_BASE, LEADVIRT_PROVISION_EMAIL, LEADVIRT_PROVISION_PASSWORD

## Next Actions

- Required AI env for public release: `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, `AI_API_KEY`, and optionally `AI_DEFAULT_MODEL`.
- Fix the failed step above, then rerun `corepack pnpm run release:public-ready`.
