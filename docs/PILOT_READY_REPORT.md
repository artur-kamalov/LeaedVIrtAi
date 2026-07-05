# LeadVirt Pilot Ready Report

Status: passed
Started: 2026-06-27T07:14:11.628Z
Finished: 2026-06-27T07:14:27.676Z
Duration seconds: 16

## Environment

- Local web: http://localhost:3001
- Local API: http://localhost:4001/api
- Public web: not set
- Public API: not set
- Local intake skipped: yes
- Public preflight required: no

## Steps

### Generate pilot packet

- Status: passed
- Command: `corepack pnpm run pilot:packet`
- Exit code: 0
- Duration ms: 1250

Output tail:

```text
> leadvirt@0.1.0 pilot:packet C:\Users\camal\.apps\LeadVirt
> node artifacts/scripts/pilot-packet.mjs
Pilot packet written to C:\Users\camal\.apps\LeadVirt\docs\PILOT_PACKET.md
```

### Fast local doctor

- Status: passed
- Command: `corepack pnpm run pilot:doctor`
- Exit code: 0
- Duration ms: 13705

Output tail:

```text
> leadvirt@0.1.0 pilot:doctor C:\Users\camal\.apps\LeadVirt
> node artifacts/scripts/pilot-doctor.mjs
LeadVirt Pilot Doctor
Local web: http://localhost:3001
Local API: http://localhost:4001/api
PASS Landing route - http://localhost:3001/ (HTTP 200)
PASS Demo route - http://localhost:3001/demo (HTTP 200)
PASS Widget demo route - http://localhost:3001/widget/demo (HTTP 200)
PASS API health - http://localhost:4001/health (HTTP 200)
PASS Channels API - 8 channels
PASS Integrations API - 9 integrations
PASS Telegram channel - ACTIVE / demo-telegram-webhook
PASS Webhook/API channel - ACTIVE / demo-generic-webhook
PASS Website widget channel - ACTIVE / demo-website-widget
PASS Telegram integration - CONNECTED / demo-telegram-webhook
PASS Webhook/API integration - CONNECTED / demo-generic-webhook
PASS Widget config - http://localhost:4001/api/public/widget/demo-website-widget/config (HTTP 200)
PASS Pilot packet - C:\Users\camal\.apps\LeadVirt\docs\PILOT_PACKET.md
NOTE Public URL env is not set; qa:pilot:public will skip until LEADVIRT_PUBLIC_WEB_BASE and LEADVIRT_PUBLIC_API_BASE are configured.
Pilot doctor passed.
```

### Local intake smoke

- Status: skipped
- Reason: Skipped because LEADVIRT_READY_SKIP_LOCAL_INTAKE=1.

### Public URL preflight

- Status: skipped
- Reason: Skipped because LEADVIRT_PUBLIC_WEB_BASE and LEADVIRT_PUBLIC_API_BASE are not both set.

### Pilot cleanup dry run

- Status: passed
- Command: `corepack pnpm run db:cleanup:pilot`
- Exit code: 0
- Duration ms: 1089

Output tail:

```text
> leadvirt@0.1.0 db:cleanup:pilot C:\Users\camal\.apps\LeadVirt
> corepack pnpm --filter @leadvirt/db db:cleanup:pilot
> @leadvirt/db@0.1.0 db:cleanup:pilot C:\Users\camal\.apps\LeadVirt\packages\db
> tsx prisma/cleanup-pilot.ts
Pilot cleanup dry run:
{
  "tenant": "demo-company",
  "leads": 0,
  "conversations": 0,
  "workflows": 0,
  "workflowRuns": 0,
  "webhookEvents": 0
}
Run with --confirm to delete only these prefixed pilot records.
```

## Cleanup Dry Run Counts

```json
{
  "tenant": "demo-company",
  "leads": 0,
  "conversations": 0,
  "workflows": 0,
  "workflowRuns": 0,
  "webhookEvents": 0
}
```

## Next Actions

- Use `docs/PILOT_PACKET.md` for the operator/tester links and manual intake commands.
- If a public URL is configured, confirm `qa:pilot:public` ran instead of being skipped.
- Run `corepack pnpm run db:cleanup:pilot -- --confirm` only when you intentionally want to remove disposable pilot records.
