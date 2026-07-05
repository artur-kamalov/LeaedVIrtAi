# 17 — Analytics and Events

## Analytics goal

LeadVirt.ai analytics should help owners understand:

- where leads come from;
- how fast AI responds;
- which scenarios convert;
- how many bookings/orders are created;
- which channels perform best;
- where humans need to intervene.

## Product analytics vs customer analytics

There are two types:

### Customer-facing analytics

Shown to tenant users inside LeadVirt.ai.

### Internal product analytics

Used by LeadVirt.ai team to improve retention and product usage.

MVP should focus on customer-facing analytics.

## Customer-facing metrics

Dashboard metrics:

```text
new leads
AI conversations
bookings/orders created
leads sent to CRM
average response time
conversion rate
follow-up recovered leads
handoff rate
```

Analytics page metrics:

```text
leads by channel
conversion by scenario
response time trend
bookings/orders trend
revenue estimate
best-performing channels
lead status distribution
AI insights
```

## Event taxonomy

Recommended domain events:

```text
tenant.created
user.invited
user.joined
channel.connected
channel.disconnected
conversation.created
conversation.message_received
conversation.ai_reply_queued
conversation.ai_replied
conversation.handoff_requested
lead.created
lead.updated
lead.status_changed
lead.qualified
booking.created
order.created
task.created
crm.sync_started
crm.sync_completed
crm.sync_failed
workflow.created
workflow.published
workflow.run_started
workflow.run_completed
usage.limit_warning
usage.limit_reached
subscription.updated
```

## Event fields

Each event should include:

```text
id
tenantId
eventType
actorUserId optional
leadId optional
conversationId optional
workflowId optional
channelAccountId optional
payload Json
createdAt
```

## Aggregation strategy

MVP:

- simple SQL queries for dashboard;
- background aggregation job for analytics if needed.

Later:

- pre-aggregated daily metrics table;
- event outbox;
- separate analytics warehouse if scale requires it.

## Daily metrics table

Optional table:

```text
DailyTenantMetric
- tenantId
- date
- newLeads
- aiConversations
- bookingsCreated
- ordersCreated
- crmSyncs
- averageResponseTimeMs
- conversionRate
- aiCostEstimate
```

## Channel performance

Track per channel:

```text
channelType
channelAccountId
leads
conversations
qualifiedLeads
bookings
orders
responseTimeMs
conversionRate
```

## Scenario performance

Track per workflow/scenario:

```text
workflowId
runs
completedRuns
qualifiedLeads
bookings
orders
handoffs
conversionRate
averageSteps
```

## AI insights

AI insights should be generated from analytics and phrased as recommendations.

Examples:

```text
WhatsApp has the highest booking conversion this week.
Most leads arrive between 14:00 and 18:00.
The beauty booking scenario converts 12% better after adding quick replies.
Follow-up messages recovered 18 conversations this month.
```

For MVP, insights can be rule-based, not AI-generated.

## Revenue estimate

Revenue estimate is optional and should be clearly labeled as an estimate.

Use:

```text
bookingCount * averageOrderValue
```

Tenant can configure average order value.

## Data retention for analytics

MVP can keep all events.

Later, aggregate and archive old raw events.
