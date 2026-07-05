# 16 — Security, Privacy, and AI Safety

## Security principles

- Tenant isolation first.
- Least privilege access.
- No secrets in logs.
- All external events must be verified and idempotent.
- Sensitive tokens must be encrypted.
- AI must be bounded by workflow rules.

## Tenant isolation

Every business record must be tenant-scoped.

Every controller/service must verify tenant access.

Tests must include cross-tenant access attempts.

## Sensitive data

Potentially sensitive data:

- customer names;
- phone numbers;
- emails;
- chat messages;
- order information;
- appointment details;
- integration tokens;
- API keys;
- uploaded files.

## Logging rules

Do not log:

- raw customer phone numbers when not needed;
- raw access tokens;
- refresh tokens;
- API keys;
- webhook secrets;
- full message bodies in error logs unless explicitly redacted.

Use structured logs with:

```text
requestId
tenantId
userId optional
module
action
status
latencyMs
```

## Encryption

Encrypt integration credentials at rest.

Use an environment-provided encryption key.

```text
ENCRYPTION_KEY
```

## API key security

- Show API key only once at creation.
- Store hash, not raw key.
- Use prefixes for identification.
- Support revocation.
- Support scopes.

## Webhook security

- Verify provider signatures when possible.
- Rate-limit webhook endpoints.
- Store events before processing.
- Process asynchronously.
- Enforce idempotency.

## Rate limits

Implement rate limiting for:

- public widget;
- auth endpoints;
- API keys;
- webhooks;
- AI reply requests;
- message sending.

Use tenant-level and IP-level throttling where possible.

## AI safety rules

AI can:

- answer administrative/business FAQs;
- ask qualifying questions;
- collect fields;
- summarize;
- draft actions;
- recommend next steps;
- schedule follow-ups.

AI cannot:

- provide medical diagnosis;
- provide legal conclusions;
- provide financial advice;
- guarantee price unless tenant has explicit configured rules;
- confirm booking without available slot;
- promise delivery without data;
- delete customer data;
- change billing;
- change access rights;
- send mass marketing messages without explicit configured consent.

## High-risk verticals

For clinics, finance, legal, insurance, and regulated businesses:

- AI should handle intake and administrative scheduling only;
- AI must avoid professional advice;
- human handoff should be easier and more frequent;
- disclaimers may be needed in tenant templates.

## Human handoff

Handoff required when:

- confidence is low;
- user asks for a human;
- user is angry;
- refund/cancellation dispute appears;
- regulated advice appears;
- workflow requires approval;
- AI provider error occurs.

## Data retention

MVP can implement soft retention settings only.

Later:

- retention policy per tenant;
- automatic deletion/archive;
- export tools;
- DPA/security docs.

## Audit logs

Audit these actions:

- tenant settings changes;
- integration connect/disconnect;
- API key create/revoke;
- user role changes;
- workflow publish;
- billing plan changes;
- destructive actions;
- data export.

## Frontend security

- Escape/render user-generated message content safely.
- Do not use dangerouslySetInnerHTML for messages unless sanitized.
- Avoid exposing backend secrets to frontend.
- Keep public widget token limited and scoped.

## Development security checklist

Before production:

- env secrets are not committed;
- CORS is restricted;
- cookies are secure;
- auth guards cover all protected routes;
- tenant checks are tested;
- rate limits exist;
- Sentry/logging redaction exists;
- webhook idempotency exists;
- integration secrets encrypted;
- backups configured.
