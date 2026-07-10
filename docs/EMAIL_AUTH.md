# Email OTP Authentication

LeadVirt supports passwordless email authentication alongside Telegram.

## Flow

- `GET /api/auth/email-otp/config` reports availability and resend timing.
- `POST /api/auth/email-otp/request` creates a 6-digit, 10-minute challenge and sends it through the configured provider.
- `POST /api/auth/email-otp/verify` consumes the challenge once, creates or resolves the workspace, and sets the normal HTTP-only session cookie.
- New verified emails create a trial workspace; existing emails open their first active workspace.

Codes are HMAC-hashed with `AUTH_EMAIL_OTP_PEPPER`, limited to five verification attempts, invalidated after use, and never logged. Requests have per-IP/email limits plus a database-backed 60-second resend lock.

Production requires `AUTH_EMAIL_OTP_ENABLED=true`; provider credentials alone do not enable the feature.

## UniSender

The classic UniSender `sendEmail` API requires a verified sender email and a contact-list ID. The LeadVirt account has a dedicated `LeadVirt authentication` list; configure its ID in the server secret file.

```dotenv
AUTH_EMAIL_OTP_ENABLED=true
AUTH_EMAIL_OTP_PEPPER=<at-least-32-random-characters>
EMAIL_OTP_PROVIDER=unisender
EMAIL_FROM=LeadVirt.ai <noreply@leadvirt.com>
UNISENDER_API_KEY=<rotated-key>
UNISENDER_LIST_ID=<authentication-list-id>
UNISENDER_SENDER_NAME=LeadVirt.ai
UNISENDER_SENDER_EMAIL=noreply@leadvirt.com
```

`EMAIL_OTP_PROVIDER` is separate from `EMAIL_PROVIDER`, which remains responsible for password-reset delivery.

Before enabling production:

1. Rotate any API key shared outside the secret manager.
2. Verify `UNISENDER_SENDER_EMAIL` in the UniSender web interface.
3. Update `/opt/leadvirt/secrets/.env` and restart API/web services.
4. Run a real inbox delivery smoke, then confirm `/api/auth/me` returns `authMode: "email"`.

UniSender enforces at least 60 seconds between emails to one recipient. The classic API also adds recipients to the configured list; move to UniSender Go if authentication volume or transactional-delivery requirements outgrow this API.

## Verification

```powershell
corepack pnpm run qa:auth:unisender-contract
corepack pnpm run qa:auth:email-otp
corepack pnpm dlx @playwright/test test artifacts/playwright/auth-flow.spec.ts --reporter=line --workers=1
```
