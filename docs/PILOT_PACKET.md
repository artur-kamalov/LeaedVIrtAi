# LeadVirt Pilot Packet

Generated: 2026-07-10T10:22:15.047Z

This packet is for the first controlled test-client sessions. It uses the current local API state when available and falls back to seeded demo keys.

Domain status: live at `https://leadvirt.com`.

## Bases

- Local web: http://localhost:3001 (failed (fetch failed))
- Local API: http://localhost:4001/api (failed (fetch failed))
- Public web: https://leadvirt.com
- Public API: https://leadvirt.com/api
- Active packet web target: https://leadvirt.com
- Active packet API target: https://leadvirt.com/api
- Header secrets: redacted when provided by env

## Operator Links

- Landing: https://leadvirt.com/
- Product demo: https://leadvirt.com/demo
- Login/client cabinet: https://leadvirt.com/login
- Integrations readiness: https://leadvirt.com/app/integrations
- Inbox: https://leadvirt.com/app/inbox
- Pipeline: https://leadvirt.com/app/leads
- Automation: https://leadvirt.com/app/automations
- Widget demo: https://leadvirt.com/widget/demo

## Current Local Readiness

- Telegram channel: missing
- Webhook/API channel: missing
- Website widget channel: missing
- Telegram integration: missing
- Webhook/API integration: missing

## Intake Endpoints

### Telegram

- Endpoint: https://leadvirt.com/api/public/channels/telegram/demo-telegram-webhook/webhook
- Public key: demo-telegram-webhook
- Header: x-telegram-bot-api-secret-token: demo-telegram-secret

```json
{
  "update_id": "pilot-sample-update",
  "message": {
    "chat": {
      "id": "pilot-chat"
    },
    "from": {
      "id": "pilot-user",
      "first_name": "Pilot TG",
      "last_name": "Sample"
    },
    "text": "Pilot Telegram message"
  }
}
```

### Webhook/API

- Endpoint: https://leadvirt.com/api/public/channels/webhook/lvwh_8ebd05e2661fc484/events
- Public key: lvwh_8ebd05e2661fc484
- Header: x-leadvirt-webhook-secret: [set LEADVIRT_PUBLIC_WEBHOOK_SECRET locally]

```json
{
  "eventId": "pilot-sample-event",
  "source": "Pilot social landing webhook",
  "conversationId": "pilot-sample-conversation",
  "customer": {
    "name": "Pilot Webhook Sample",
    "phone": "+79990000000"
  },
  "message": {
    "id": "pilot-sample-message",
    "text": "Pilot webhook message"
  }
}
```

### Website Widget

- Demo page: https://leadvirt.com/widget/demo
- Public key: demo-website-widget
- Config endpoint: https://leadvirt.com/api/public/widget/demo-website-widget/config
- Message endpoint: https://leadvirt.com/api/public/widget/demo-website-widget/messages

```html
<script async src="https://leadvirt.com/widget/embed.js" data-leadvirt-key="demo-website-widget"></script>
```

## Manual Intake Smoke Commands

Run these from PowerShell when you want to create fresh test leads without opening the browser UI.

### Telegram

```powershell
$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$telegramEndpoint = "https://leadvirt.com/api/public/channels/telegram/demo-telegram-webhook/webhook"
$telegramHeaders = @{ "x-telegram-bot-api-secret-token" = "demo-telegram-secret" }
$telegramBody = @"
{
  "update_id": "packet-tg-$pilotId",
  "message": {
    "message_id": "packet-tg-message-$pilotId",
    "date": 1761260000,
    "chat": { "id": "packet-tg-chat-$pilotId", "type": "private" },
    "from": {
      "id": "packet-tg-user-$pilotId",
      "first_name": "Pilot TG",
      "last_name": "Packet $pilotId",
      "username": "pilot_packet_$pilotId"
    },
    "text": "Pilot packet Telegram intake $pilotId"
  }
}
"@
Invoke-RestMethod -Method Post -Uri $telegramEndpoint -Headers $telegramHeaders -ContentType "application/json" -Body $telegramBody
```

### Webhook/API

```powershell
$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$webhookEndpoint = "https://leadvirt.com/api/public/channels/webhook/lvwh_8ebd05e2661fc484/events"
$webhookHeaders = @{ "x-leadvirt-webhook-secret" = "[set LEADVIRT_PUBLIC_WEBHOOK_SECRET locally]" }
$webhookBody = @"
{
  "eventId": "packet-webhook-$pilotId",
  "source": "Pilot packet social landing webhook",
  "conversationId": "packet-webhook-conversation-$pilotId",
  "customer": {
    "id": "packet-webhook-customer-$pilotId",
    "name": "Pilot Webhook Packet $pilotId",
    "phone": "+79990000000"
  },
  "message": {
    "id": "packet-webhook-message-$pilotId",
    "text": "Pilot packet webhook intake $pilotId",
    "timestamp": "2026-06-23T20:00:00.000Z"
  }
}
"@
Invoke-RestMethod -Method Post -Uri $webhookEndpoint -Headers $webhookHeaders -ContentType "application/json" -Body $webhookBody
```

### Website Widget

```powershell
$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$widgetEndpoint = "https://leadvirt.com/api/public/widget/demo-website-widget/messages"
$widgetBody = @"
{
  "sessionId": "packet-widget-session-$pilotId",
  "clientMessageId": "packet-widget-message-$pilotId",
  "text": "Pilot packet widget intake $pilotId",
  "customer": {
    "name": "Pilot Widget Packet $pilotId",
    "phone": "+79991111111"
  },
  "pageUrl": "https://leadvirt.com/widget/demo",
  "referrer": "https://leadvirt.com"
}
"@
Invoke-RestMethod -Method Post -Uri $widgetEndpoint -ContentType "application/json" -Body $widgetBody
```

## Preflight Commands

One-command pilot readiness:

```powershell
corepack pnpm run pilot:ready
```

This writes the latest readiness report to `docs/PILOT_READY_REPORT.md`.

Individual checks:

```powershell
corepack pnpm run pilot:doctor
corepack pnpm --filter @leadvirt/web typecheck
corepack pnpm --filter @leadvirt/web lint
corepack pnpm --filter @leadvirt/web build
corepack pnpm run qa:api
corepack pnpm run qa:pilot:intake
```

Public URL preflight:

```powershell
$env:LEADVIRT_PUBLIC_WEB_BASE="https://leadvirt.com"
$env:LEADVIRT_PUBLIC_API_BASE="https://leadvirt.com/api"
corepack pnpm run qa:pilot:public
```

## Pilot Session Flow

1. Open the product demo with the tester.
2. Send one inbound message through the chosen channel.
3. Confirm the lead appears in Inbox with the correct source/channel.
4. Open the conversation and check timeline, AI draft, handoff/status, and transcript export.
5. Move the lead in Pipeline and create a manager task.
6. Check Automation status and Analytics activity after the interaction.

## Cleanup

```powershell
corepack pnpm run db:cleanup:pilot
corepack pnpm run db:cleanup:pilot -- --confirm
```
