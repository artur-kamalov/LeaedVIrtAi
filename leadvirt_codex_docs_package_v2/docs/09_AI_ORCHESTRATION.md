# 09 — AI Orchestration

## AI product principle

LeadVirt.ai is not a generic chatbot.

It is an AI assistant that drives conversations toward business actions:

- qualified lead;
- booking;
- order;
- task;
- CRM record;
- human handoff.

## AI flow

```text
Inbound message
  ↓
Load tenant context
  ↓
Load business profile
  ↓
Load conversation history
  ↓
Load active workflow/scenario
  ↓
Classify intent
  ↓
Extract fields
  ↓
Decide next action
  ↓
Generate controlled reply
  ↓
Log AI usage
  ↓
Execute approved action
  ↓
Send message or request human handoff
```

## AI Provider abstraction

Use an interface:

```ts
export interface AiProvider {
  generateReply(input: AiReplyInput): Promise<AiReplyResult>;
  extractLeadFields(input: AiExtractionInput): Promise<AiExtractionResult>;
  summarizeConversation(input: AiSummaryInput): Promise<AiSummaryResult>;
  classifyIntent(input: AiIntentInput): Promise<AiIntentResult>;
}
```

## Mock provider

Implement `MockAiProvider` first for local development and tests.

It should produce deterministic replies and extraction results based on simple rules.

This allows product UI and workflows to be built before real AI credentials exist.

## AI actions

Allowed AI actions:

```text
reply_to_customer
ask_qualifying_question
extract_lead_fields
summarize_conversation
recommend_next_action
create_task_draft
create_booking_draft
create_order_draft
send_to_crm_draft
schedule_follow_up
request_human_handoff
```

AI can draft actions, but the system must control execution.

## AI must not do

AI must not:

- guarantee final price unless pricing rules are configured;
- confirm a booking without available slot verification;
- promise delivery without order/delivery data;
- provide medical, legal, or financial conclusions;
- delete records;
- modify billing;
- change permissions;
- export private data;
- send mass marketing messages without explicit tenant configuration and consent logic;
- ignore human handoff triggers.

## Handoff triggers

Request human handoff when:

- AI confidence is low;
- customer is angry or complains;
- customer asks for refund/legal/medical/financial advice;
- requested action requires human approval;
- pricing is ambiguous;
- customer explicitly asks for a person;
- workflow reaches a configured handoff node.

## Prompt versioning

Prompts must be versioned.

Do not overwrite production prompt text silently.

Data model:

```text
AiPrompt
AiPromptVersion
```

Each AI usage log should reference prompt version when possible.

## System prompt structure

Use this structure for scenario prompts:

```text
1. Product role
2. Tenant business context
3. Active scenario goal
4. Allowed actions
5. Forbidden actions
6. Required fields
7. Tone of voice
8. Handoff rules
9. Output format
```

## Output format

For AI orchestration, prefer structured JSON internally.

Example:

```json
{
  "reply": "Sure, I can help. What day would be convenient for you?",
  "intent": "booking_request",
  "leadFields": {
    "interest": "manicure",
    "preferredTime": "tomorrow evening"
  },
  "nextAction": {
    "type": "ask_question",
    "requiredField": "exact_time"
  },
  "confidence": 0.86,
  "handoffRequired": false
}
```

The customer-facing reply is only one part of the AI result.

## Business profile context

Each tenant should have a profile:

```text
businessName
businessType
location/timezone
workingHours
services/products
bookingRules
pricingRules optional
FAQ
handoffContacts
toneOfVoice
forbiddenClaims
```

## Vertical scenarios

### Beauty

Required fields:

```text
service
preferredDate
preferredTime
masterPreference optional
name
phone
```

### Service business

Required fields:

```text
serviceType
problemDescription
locationArea
urgency
preferredTime
photo optional
phone
```

### E-commerce

Required fields:

```text
productInterest
size/model/SKU optional
questionType
deliveryCity optional
contact
```

### Clinic

Required fields:

```text
appointmentType
preferredDate
preferredTime
contact
```

Clinic safety rule:

```text
AI can help with appointment and general administrative questions only. AI must not provide diagnosis or medical treatment advice.
```

## AI usage tracking

Track:

- tenant;
- conversation;
- provider;
- model;
- action type;
- prompt version;
- latency;
- status;
- estimated cost;
- token usage if available.

## Cost control

Implement:

- monthly AI conversation limits;
- tenant-level AI usage counters;
- fail-closed behavior when tenant limit is exceeded;
- admin UI notice when usage approaches plan limit;
- fallback to human handoff if AI is unavailable.

## Error handling

If AI provider fails:

1. Store the error in `AiUsageLog`.
2. Mark conversation as `WAITING_FOR_HUMAN` or retry if safe.
3. Notify assigned manager or tenant owner.
4. Do not drop the customer message.
