# LeadVirt AI Runtime Implementation Plan

Status: Phases 1-6 foundations implemented locally with CI acceptance coverage; next external gate is staging acceptance after deploy.

## Goal

Validate the main LeadVirt scenario end to end:

1. A new user creates an account.
2. The user describes the business in detail.
3. LeadVirt stores business knowledge for RAG: profile, catalog, prices, free time slots, policies, FAQ, escalation rules.
4. A real lead writes through a public channel.
5. The AI answers from tenant knowledge, creates or updates CRM records, and records trace, quality, and cost data.

## Core Decisions

- Use LangGraph for production agent orchestration.
- Use AutoGen only for simulations, agent-lab experiments, and regression test generation.
- Use Qdrant as the vector store for multi-tenant RAG.
- Start with dense retrieval plus tenant filters, then add hybrid retrieval and rerank.
- Use RAGAS plus custom business evals for LLMOps.
- Use OpenTelemetry, Prometheus, and Grafana for AI observability.
- Keep Redis/BullMQ for the first async worker queue; add Temporal only if workflow durability becomes a real bottleneck.

## Runtime Architecture

```text
Public channel
  -> API intake endpoint
  -> DB lead/conversation/message
  -> AI job queue
  -> AI worker
  -> LangGraph pipeline
  -> RAG retrieval from Qdrant
  -> guarded LLM/tool calls
  -> CRM/calendar/workflow updates
  -> response delivery
  -> traces, metrics, eval samples, audit log
```

## Data Model Areas

- Business profile: name, description, niche, tone, working rules, forbidden claims.
- Catalog: services, prices, durations, requirements, categories.
- Availability: working hours, free windows, booking constraints.
- Knowledge documents: FAQ, policies, scripts, objections, examples.
- RAG chunks: tenant id, source id, version, type, visibility, PII level, embedding metadata.
- AI events: graph run id, node name, input hash, output, tool calls, latency, token usage, cost.
- Quality records: golden-set case id, expected behavior, actual output, score, pass/fail reason.

## LangGraph Pipeline

Initial production graph:

1. `normalize_message`
2. `load_tenant_context`
3. `pii_classify`
4. `intent_classify`
5. `retrieve_context`
6. `rerank_context`
7. `policy_guard`
8. `draft_response`
9. `decide_tool_calls`
10. `execute_tools`
11. `quality_gate`
12. `send_or_escalate`
13. `persist_audit`

Required graph state:

- tenant id
- channel id
- conversation id
- lead id
- user message
- normalized intent
- retrieved context ids
- draft answer
- planned tool calls
- executed tool calls
- quality result
- final action
- cost and token counters

## RAG Plan

Phase 1:

- Qdrant collection per environment, tenant isolation through payload filters.
- Dense embeddings for all tenant knowledge chunks.
- Strict `tenant_id` filter on every retrieval query.
- Source citations stored internally for audit and debugging.

Phase 2:

- Hybrid retrieval: dense plus sparse.
- Rerank top candidates before response generation.
- Separate indexes or payload filters by knowledge type: catalog, availability, FAQ, policy.

Phase 3:

- Retrieval eval by niche.
- Drift checks after knowledge updates.
- Automatic reindex jobs with versioned chunks.

## Quality Gates

The AI must not send a final answer if:

- tenant context is missing;
- retrieval is empty for catalog, price, policy, or availability questions;
- the answer is not grounded in retrieved or structured tenant data;
- the model tries to book, cancel, refund, discount, or promise availability without a validated tool call;
- PII from another tenant appears anywhere in context or output;
- estimated confidence is below the configured threshold;
- cost or token budget is exceeded.

Fallback actions:

- ask a clarifying question;
- create a human handoff task;
- send a safe short reply that the manager will follow up.

## LLMOps

Golden sets:

- booking request;
- price question;
- service comparison;
- unclear message;
- objection handling;
- cancellation or reschedule;
- unavailable slot;
- out-of-policy request;
- competitor or legal/medical/financial sensitive request.

Metrics:

- groundedness;
- answer relevance;
- context precision;
- context recall;
- booking success;
- hallucination rate;
- escalation correctness;
- tool-call accuracy;
- cost per resolved lead;
- p95 graph latency.

CI quality gate:

- fast smoke on every PR;
- niche golden-set subset before deploy;
- full eval manually or nightly.

## Reliability

- Idempotency key: channel id plus external message id.
- Retry policy per graph node with bounded backoff.
- Timeout per graph node and per full graph run.
- DLQ for failed AI jobs.
- Audit log for every tool call and final response.
- No direct tool mutation without schema validation and tenant authorization.

## Observability

OpenTelemetry traces:

- intake request;
- queue publish;
- worker job;
- graph run;
- each graph node;
- retrieval;
- LLM call;
- tool call;
- final delivery.

Prometheus metrics:

- `ai_graph_runs_total`
- `ai_graph_run_duration_seconds`
- `ai_node_duration_seconds`
- `ai_llm_tokens_total`
- `ai_llm_cost_total`
- `ai_retrieval_empty_total`
- `ai_quality_gate_fail_total`
- `ai_jobs_dlq_total`
- `ai_tool_call_fail_total`

Grafana dashboards:

- AI health;
- cost control;
- quality gates;
- RAG retrieval quality;
- worker reliability;
- tenant usage.

## Security

- Tenant filter is mandatory on every DB and vector query.
- RBAC roles: owner, admin, operator, viewer.
- ABAC checks for tenant-scoped resources and channel ownership.
- PII tagging before logging or tracing.
- Redact PII and secrets from logs, traces, prompts, and eval artifacts.
- Prompt/tool schemas validated before execution.
- Human handoff for sensitive or low-confidence operations.

## Cost Control

- Per-tenant daily and monthly token budgets.
- Per-run maximum graph steps.
- Per-node maximum retries.
- Model routing by task: small model for classification, stronger model for final answer and eval.
- Cache stable business context and retrieval results where safe.
- Alert when tenant cost or retrieval failure rate spikes.

## Implementation Phases

### Phase 1: Knowledge Onboarding

Status: implemented.

- Extend onboarding to collect business profile, services, prices, availability, FAQ, and policies.
- Persist structured business data in Postgres.
- Add first tenant knowledge-source API.
- Add clean-user smoke for a fully filled business profile.

### Phase 2: Qdrant RAG

Status: foundation implemented.

- Add Qdrant to local and deploy compose.
- Add knowledge chunking and embedding/reindex API.
- Add tenant-filtered retrieval service.
- Add RAG smoke tests for catalog, price, and availability questions.
- Current embedding provider is a deterministic local hash vector for plumbing and isolation tests; semantic embeddings and rerank remain follow-up work before production-quality answers.

### Phase 3: LangGraph Worker

Status: foundation implemented.

- Add AI worker graph runtime. Initial queued `ai.reply` path now runs through LangGraph.js.
- Replace direct sync AI reply paths with queued graph runs where appropriate. Public Widget, Webhook/API, and Telegram intake now publish `ai.reply` jobs in queue mode.
- Deliver queued public-channel AI replies through `channels.sendMessage`. Implemented for Webhook/API and Telegram with tenant/channel checks, adapter send, message status transitions, and audit logging.
- Add tool schemas for lead update, note creation, status change, and booking proposal. Implemented as tenant-scoped zod-validated worker tools.
- Add idempotency, retries, timeouts, and DLQ. Implemented for queued worker jobs with `WORKER_JOB_TIMEOUT_MS`, final-attempt DLQ audit logging, and `worker:dlq:inspect`.
- Add full public-loop smoke. Implemented as `qa:ai:public-loop` for clean tenant session, onboarding knowledge, RAG reindex/search, public Webhook/API intake, queued LangGraph reply, channel delivery, booking draft, inbox, dashboard, and queue completion checks.

### Phase 4: Quality And Evals

Status: foundation started.

- Add golden sets for the first pilot niches. Initial core golden set is implemented in `artifacts/evals/ai-golden-set.json` and now covers beauty, auto detailing, education/course booking, and clinic handoff cases.
- Add RAGAS evaluation where it fits retrieval quality. Initial RAGAS-style metrics now include required-term recall and retrieved-chunk precision in eval reports.
- Add custom business eval for booking correctness, escalation, and policy safety. Initial deterministic gate is implemented as `qa:ai:quality`; optional real-provider judge runs are available through `qa:ai:real-eval`.
- Add CI quality gate with a small required eval subset. `qa:ai:quality` is now part of the LeadVirt.ru GitHub Actions verify job and uploads `artifacts/reports/*.json` as `ai-eval-report`.

### Phase 5: Observability And Cost

- Status: started.
- Export metrics for Prometheus. Initial foundation is implemented with API `/metrics`, worker `/metrics`, API request counters/latency, worker job/DLQ counters, AI graph duration/status, and channel delivery outcomes.
- Add per-tenant AI cost tracking and budget enforcement. Initial token budget guard is implemented with daily/monthly tenant limits, pre-call blocking, and `BUDGET_BLOCKED` usage logs.
- Add Grafana dashboard definitions. Initial optional observability profile is implemented with Prometheus local/staging scrape configs and a provisioned `LeadVirt AI Runtime` dashboard.
- Add OpenTelemetry spans to API, worker, retrieval, LLM, and tool calls. Initial opt-in OTLP tracing is implemented for API requests, queue publishing, worker jobs, LangGraph graph/nodes, provider stages, tool execution, persistence, and channel delivery.
- Add a trace backend profile. Initial Tempo service and Grafana trace datasource are available through the optional `observability` profile.
- Add cost/quality dashboard panels on top of usage logs and metrics. Initial panels are implemented for quality-gate outcomes, budget blocks, and blocked-token volume.

### Phase 6: Security Hardening

Status: core security hardening and local clean-user acceptance smoke are implemented; staging/production-like acceptance remains.

- DB fallback cross-tenant RAG isolation smoke is implemented as `qa:ai:isolation`.
- Qdrant cross-tenant RAG isolation smoke is implemented as `qa:ai:qdrant-isolation` with a temporary collection.
- Initial PII/secret redaction is implemented for runtime logs, OpenTelemetry error payloads, and AI graph tool-call metadata.
- PII tagging and broader prompt/eval artifact redaction are implemented via `redactAndTagSensitiveData`, sanitized quality/real-provider eval reports, sanitized real-provider judge payloads, and `qa:ai:eval-redaction`.
- Initial RBAC guard is implemented for knowledge source writes/reindex as `qa:rbac:knowledge`.
- Initial channel action RBAC is implemented as `qa:rbac:channels`.
- Initial AI tool ABAC is implemented as `qa:ai:tool-abac`, covering tenant conversation ownership, lead-conversation consistency, and same-tenant task assignees.
- Billing, integrations, and workflows RBAC matrix is implemented as `qa:rbac:product-matrix`.
- Audit UI read access is restricted to OWNER, ADMIN, and MANAGER through `/api/ai-audit`.
- Initial audit UI for AI decisions and tool calls is implemented as `/app/audit` backed by `/api/ai-audit` and `qa:ai:audit`.
- Visual/API and forbidden-role smoke coverage for `/app/audit` is implemented as `qa:ai:audit-ui`.

## First End-To-End Acceptance Test

Given a clean Telegram-auth user:

1. User completes business onboarding for a sample salon.
2. User adds services, prices, available windows, FAQ, and policies.
3. A public widget or webhook message asks for price and a booking slot.
4. AI retrieves only that tenant's knowledge.
5. AI answers with grounded price and available slot.
6. AI creates or updates lead, conversation, and activity records.
7. Trace, metrics, quality result, and cost are stored.
8. Dashboard, inbox, lead detail, and activity timeline show only real tenant data.

Local coverage: implemented as `qa:ai:acceptance`. The smoke signs in through Telegram auth, fills onboarding knowledge, creates a Webhook/API channel, sends public intake, waits for queued LangGraph processing and channel delivery, verifies grounded price/slot output, RAG refs, tool calls, usage/cost, AI audit, worker metrics, dashboard, inbox, lead detail, and activity timeline.

## Non-Goals For The First Build

- AutoGen in production runtime.
- Multiple vector databases.
- Full visual eval dashboard.
- Fully automated scheduling against third-party calendars.
- Complex enterprise ABAC beyond tenant and role checks.
