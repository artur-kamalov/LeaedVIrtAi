# 18 — Testing, Observability, and QA

## Testing philosophy

Test critical business and security logic first.

Do not aim for perfect coverage before MVP, but do not skip tenant isolation, webhook idempotency, usage limits, and AI safety logic.

## Test types

### Unit tests

Use for:

- lead status transitions;
- usage limit calculations;
- permission checks;
- AI orchestration decisions;
- adapter normalization;
- workflow validation;
- pricing/plan logic.

### Integration tests

Use for:

- API endpoints;
- database repositories;
- webhook ingestion;
- queue job processors;
- CRM sync stubs;
- auth + tenant guards.

### E2E tests

Use for critical flows:

1. signup/onboarding;
2. dashboard loads;
3. inbound message creates conversation;
4. AI reply is generated;
5. lead is qualified;
6. lead is sent to CRM stub;
7. usage counter increments.

## Mandatory security tests

- User from tenant A cannot access tenant B lead.
- User from tenant A cannot receive tenant B realtime event.
- API key scoped to tenant A cannot write tenant B data.
- Webhook duplicate event does not create duplicate message.
- Integration token is not returned in API response.

## UI QA checklist

Every page should include:

- loading state;
- empty state;
- error state;
- success state;
- mobile layout;
- keyboard focus states;
- readable contrast;
- styled dropdowns;
- styled modals;
- styled tooltips;
- no broken text overflow.

## Observability

Add structured logging.

Log fields:

```text
requestId
tenantId
userId optional
module
action
status
latencyMs
errorCode optional
```

## Error tracking

Use Sentry or equivalent for:

- frontend exceptions;
- backend exceptions;
- worker job failures.

## Health checks

API:

```text
GET /health
GET /health/ready
```

Worker:

- logs startup;
- exposes health endpoint if deployed as HTTP process;
- reports queue connection status.

## Queue monitoring

Track:

- waiting jobs;
- active jobs;
- failed jobs;
- retry count;
- dead-letter jobs.

## Audit logs

Critical actions must create audit records.

Examples:

- workflow published;
- integration connected;
- API key created;
- billing plan changed;
- lead exported;
- user role changed.

## QA acceptance before demo

Before using for sales demos:

- demo tenant can be reset/seeded;
- all primary pages load;
- mobile views are usable;
- no console errors on landing;
- animations still work;
- lead flow demo works end-to-end;
- pricing is correct;
- product name LeadVirt.ai appears consistently.
