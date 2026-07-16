# Generic Webhook Outbound Delivery

Webhook/API intake and outbound delivery are separate. Intake uses the server-managed inbound secret. Replies require an explicit outbound target on the `WEBHOOK` channel.

## Channel Configuration

An authorized channel manager configures the target through `PATCH /api/channels/:id`:

```json
{
  "settings": {
    "webhook": {
      "outbound": {
        "targetUrl": "https://hooks.customer.com/leadvirt/replies",
        "timeoutMs": 10000,
        "auth": {
          "headerName": "authorization",
          "scheme": "Bearer",
          "secret": "replace-with-customer-secret"
        }
      }
    }
  }
}
```

`auth` is optional. `headerName` must be `authorization` or an `x-*` header. `scheme`, when present, must be `Bearer`. Send `auth: null` to remove authentication and `targetUrl: null` to disable outbound delivery. Blank secret updates preserve the stored value.

The authentication secret is moved from settings into the AES-GCM channel credential field before persistence. Channel responses never return the target URL, path/query, or credential. They expose only `targetConfigured`, `authenticationConfigured`, and the safe timeout.

## Request Contract

LeadVirt sends `POST` with `Content-Type: application/json`:

```json
{
  "schemaVersion": 1,
  "event": "leadvirt.message.outbound",
  "deliveryId": "channel_delivery_...",
  "data": {
    "channelAccountId": "customer-channel-id",
    "conversationId": "customer-thread-id",
    "leadVirtConversationId": "leadvirt-conversation-id",
    "message": {
      "id": "leadvirt-message-id",
      "text": "Reply text"
    }
  }
}
```

The same delivery id is sent in `Idempotency-Key` and `X-LeadVirt-Delivery-Id`. Receivers must deduplicate by this value because retryable delivery is at-least-once. `X-LeadVirt-Event` is `leadvirt.message.outbound`.

A `2xx` response accepts the delivery; `202` is recorded as provider-queued. A JSON response may return `externalMessageId`, `messageId`, or `id`. Otherwise LeadVirt uses a stable fallback id.

## Security And Retry

- Targets require HTTPS on port 443, no URL credentials or fragments, and a public destination.
- DNS answers are validated before each attempt, the connection is pinned to an approved address, TLS verifies the configured hostname, redirects are rejected, and the connected address is rechecked.
- Request payloads are limited to 256 KiB. Response headers are limited to 32 KiB/100 fields and response bodies to 64 KiB.
- DNS/connect failures, `408`, `425`, `429`, `500`, `502`, `503`, and `504` retry within the queue attempt budget.
- Terminal configuration/HTTP failures settle the message as failed. A failure after the request may have reached the receiver becomes `UNKNOWN` and is not retried automatically.
- Raw inbound payloads, channel settings, credentials, and provider response bodies are never copied into delivery audit/error records.
