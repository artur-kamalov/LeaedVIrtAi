# Email OTP Authentication

LeadVirt supports passwordless email authentication alongside Telegram.

## Flow

- `GET /api/auth/email-otp/config` reports availability and resend timing.
- `POST /api/auth/email-otp/request` creates a 6-digit, 10-minute challenge and sends it through the configured provider.
- `POST /api/auth/email-otp/verify` consumes the challenge once, creates or resolves the workspace, and sets the normal HTTP-only session cookie.
- New verified emails create a trial workspace; existing emails open their first active workspace.

Codes are HMAC-hashed with `AUTH_EMAIL_OTP_PEPPER`, limited to five verification attempts, invalidated after use, and never logged. Requests have per-IP/email limits plus a database-backed 60-second resend lock.

Production requires `AUTH_EMAIL_OTP_ENABLED=true`; provider credentials alone do not enable the feature.

## Beget SMTP

Beget SMTP is the active production path while the new domain is not eligible for UniSender sender verification.

```dotenv
AUTH_EMAIL_OTP_ENABLED=true
AUTH_EMAIL_OTP_PEPPER=<at-least-32-random-characters>
EMAIL_OTP_PROVIDER=smtp
EMAIL_FROM=LeadVirt.ai <noreply@leadvirt.com>
SMTP_HOST=smtp.beget.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@leadvirt.com
SMTP_PASSWORD=<mailbox-password>
SMTP_FROM_NAME=LeadVirt.ai
SMTP_FROM_EMAIL=noreply@leadvirt.com
```

Store the mailbox password only in `/opt/leadvirt/secrets/.env`. Port `465` uses TLS from connection start. Run a transport authentication check and a real inbox OTP smoke before exposing the email option.

## UniSender

The classic UniSender `sendEmail` API remains supported as a later fallback. It requires a verified sender email and a contact-list ID.

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

`EMAIL_OTP_PROVIDER` is separate from `EMAIL_PROVIDER`, which remains responsible for password-reset delivery. Supported OTP providers are `smtp`, `unisender`, and non-production `mock`.

Before enabling production:

1. Update `/opt/leadvirt/secrets/.env` and restart the API service.
2. Verify SMTP authentication without sending a message.
3. Run a real inbox delivery smoke.
4. Confirm one-time code consumption and `/api/auth/me` returns `authMode: "email"`.

UniSender enforces at least 60 seconds between emails to one recipient. The classic API also adds recipients to the configured list; move to UniSender Go if authentication volume or transactional-delivery requirements outgrow this API.

## Verification

```powershell
corepack pnpm run qa:auth:smtp-contract
corepack pnpm run qa:auth:unisender-contract
corepack pnpm run qa:auth:email-otp
corepack pnpm dlx @playwright/test test artifacts/playwright/auth-flow.spec.ts --reporter=line --workers=1
```
