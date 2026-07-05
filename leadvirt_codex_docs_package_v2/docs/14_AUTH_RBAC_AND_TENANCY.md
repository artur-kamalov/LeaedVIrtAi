# 14 — Auth, RBAC, and Tenancy

## Identity vs authorization

External auth identifies the user. LeadVirt.ai database decides tenant access.

Even if Clerk or another auth provider is used, never rely only on provider metadata for business permissions.

## Core auth entities

```text
User
Tenant
Membership
Role
Permission
Invitation
ApiKey
```

## Roles

Recommended roles:

```text
OWNER
ADMIN
MANAGER
AGENT
VIEWER
```

## Permission model

Start with role-based permissions.

Later, extend to custom permission sets if needed.

## Role permissions

### Owner

Can do everything in the tenant:

- billing;
- delete tenant;
- manage users;
- manage integrations;
- manage workflows;
- view all data;
- export data;
- manage API keys.

### Admin

Can manage most operational settings:

- users except owner transfer;
- channels;
- workflows;
- integrations;
- all leads/conversations;
- analytics;
- settings.

### Manager

Can manage leads and conversations:

- view assigned and team leads;
- assign leads;
- send to CRM;
- create tasks;
- view analytics basics.

### Agent

Can work conversations:

- view assigned leads;
- reply to conversations;
- update lead status;
- create tasks;
- request handoff.

### Viewer

Read-only access:

- dashboard;
- analytics;
- conversations/leads read-only.

## Tenant context resolution

Every authenticated request must resolve:

```text
userId
tenantId
membershipId
role
permissions
```

Reject request if membership does not exist or tenant is inactive.

## Tenant isolation rules

- All business queries must include tenant scope.
- Do not accept tenantId from request body for mutations.
- Route/header tenantId must be validated against membership.
- API keys must map to exactly one tenant or explicit allowed tenant scope.
- Realtime events must only be sent to tenant members.

## API keys

API keys are used for:

- widget/public integration;
- server-to-server webhooks;
- custom integrations.

API keys must have:

```text
tenantId
name
prefix
hash
scopes
lastUsedAt
expiresAt optional
revokedAt optional
```

Never store raw API keys after creation. Store hash only.

## Invitations

Invitation fields:

```text
tenantId
email
role
tokenHash
expiresAt
acceptedAt
invitedById
```

## Auth modes

Support two implementation modes if needed:

```text
AUTH_MODE=mock
AUTH_MODE=clerk
AUTH_MODE=local
```

### Mock mode

For local demos only. Seed one demo tenant and demo user.

### Clerk mode

Use external identity provider token verification, then load user and membership from LeadVirt DB.

### Local mode

Use email/password + JWT + refresh tokens. This can be implemented later if avoiding external providers.

## Session security

- Use secure cookies where applicable.
- Use CSRF protection where relevant.
- Use refresh token rotation if local auth is implemented.
- Do not expose sensitive tokens to frontend.

## Audit requirements

Audit log these actions:

- login failures beyond threshold;
- role changes;
- user invitations;
- integration connect/disconnect;
- API key creation/revocation;
- billing plan changes;
- workflow publish;
- data export;
- destructive actions.
