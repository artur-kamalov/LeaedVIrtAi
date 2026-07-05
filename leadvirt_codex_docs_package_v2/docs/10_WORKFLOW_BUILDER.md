# 10 — Workflow Builder

## Purpose

The workflow builder lets businesses configure how LeadVirt.ai handles conversations.

It should feel like a no-code scenario builder, but MVP execution can be simplified.

## Main workflow examples

- Booking request.
- Lead qualification.
- FAQ answer.
- Order support.
- Abandoned conversation follow-up.
- CRM handoff.
- Human handoff.

## Workflow data model

Use:

```text
Workflow
WorkflowStep
WorkflowRun
WorkflowRunEvent
```

## Workflow fields

### Workflow

```text
id
tenantId
name
description
status
businessType optional
version
publishedAt
createdById
```

### WorkflowStep

```text
id
workflowId
type
name
positionX
positionY
config Json
nextStepIds Json
```

### WorkflowRun

```text
id
tenantId
workflowId
conversationId
leadId
status
currentStepId
startedAt
completedAt
```

### WorkflowRunEvent

```text
id
workflowRunId
stepId
eventType
payload Json
createdAt
```

## Step types

```text
TRIGGER
AI_MESSAGE
QUESTION
CONDITION
ACTION
DELAY
HANDOFF
END
```

## MVP workflow execution

MVP can execute a subset:

1. Trigger: new inbound message.
2. AI greeting.
3. AI qualifying question.
4. Condition based on extracted field.
5. Action: create lead update, create task, send to CRM stub, book appointment stub.
6. Follow-up delay.
7. Handoff.

## UI requirements

The automation builder page must include:

- scenario list;
- visual canvas;
- node cards;
- connectors;
- selected node settings panel;
- publish button;
- test button;
- draft/active/paused states;
- unsaved changes indicator.

## Node settings examples

### AI greeting node

Fields:

```text
message template
tone
wait for reply toggle
timeout
next step
```

### Qualification node

Fields:

```text
required fields
question text
retry count
fallback behavior
handoff if missing after N attempts
```

### Condition node

Fields:

```text
field
operator
value
true branch
false branch
```

### Action node

Fields:

```text
action type
integration target
field mapping
requires approval toggle
```

## Workflow publishing rules

A workflow cannot be published if:

- it has no trigger;
- it has orphan nodes;
- it has missing required config;
- it has no end state or handoff path;
- it contains unsupported action configuration.

## Execution safety

AI-generated decisions should be bounded by workflow rules.

Example:

```text
AI can ask a qualifying question, but workflow decides whether booking can be created.
```

## Versioning

Publishing a workflow should create or increment a version.

Existing conversations should continue on their original workflow version unless explicitly migrated.

## Default scenario templates

Create templates for:

- generic lead qualification;
- beauty booking;
- service request;
- e-commerce order support;
- clinic appointment intake;
- education trial lesson;
- auto service booking.
