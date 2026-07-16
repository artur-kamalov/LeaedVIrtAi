import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  AiExtractionResult,
  AiIntentResult,
  AiMessage,
  AiProvider,
  AiRecommendationResult,
  AiReplyResult,
  GroundedAnswerOrchestrationResult,
} from "@leadvirt/ai";
import { prisma, type Prisma } from "@leadvirt/db";
import {
  authorizeKnowledgeCapabilityEffectV1,
  classifyKnowledgeCapabilityIntentV1,
  type KnowledgeRuntimeRetrievalResult,
  type KnowledgeRuntimeRetriever,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeV2GroundedAnswerService,
  type PreparedKnowledgeV2Trace,
} from "@leadvirt/knowledge";
import { createRuntimeQueueEvent } from "@leadvirt/runtime-queue";
import type {
  AiReplyJobData,
  ChannelSendMessageJobData,
  KnowledgeV2CapabilityType,
} from "@leadvirt/types";
import {
  redactSensitiveData,
  redactSensitiveText,
  SpanKind,
  withSpan,
} from "@leadvirt/observability";
import {
  recordAiGraphRun,
  recordStructuredKnowledgeAnswerGate,
  recordStructuredKnowledgeRetrieval,
} from "../observability/metrics.js";
import {
  AiReplyFenceError,
  beginAiReplyAttempt,
  markAiReplyAttemptFailed,
  withFencedAiReplyTransaction,
  type AiReplyAttempt,
  type AiReplyRuntimeInput,
} from "./ai-reply-reliability.js";
import {
  executeAiToolCalls,
  planAiToolCalls,
  type AiToolCall,
  type AiToolResult,
} from "./ai-tools.js";
import { aiReplyContentHashV1, knowledgeHandoffReplyV1 } from "./ai-reply-outcome.js";

type ConversationRecord = Prisma.ConversationGetPayload<{
  include: {
    tenant: true;
    lead: true;
    channel: true;
    messages: { include: { authenticatedCustomerIdentity: true } };
  };
}>;

interface RetrievedContext {
  chunkId: string;
  revisionId: string;
  sourceId: string;
  sourceType: string;
  title: string;
  content: string;
  contentHash: string;
  score: number;
}

interface QualityGateResult {
  passed: boolean;
  reason: string;
  confidence: number;
  handoffRequired: boolean;
  finalReply: string;
}

interface CapabilityGateResult {
  capabilityType: KnowledgeV2CapabilityType | null;
  allowedAutonomy: AiReplyAttempt["allowedAutonomy"];
  allowed: boolean;
  reason: string;
}

export interface AiReplyGraphResult {
  status: "processed" | "duplicate";
  conversationId: string;
  messageId: string;
  intent?: string;
  handoffRequired?: boolean;
  graphRunId?: string;
  qualityReason?: string;
  qualityPassed?: boolean;
  toolResults?: AiToolResult[];
}

interface RunAiReplyGraphInput {
  data: AiReplyJobData;
  jobId?: string | undefined;
  aiProvider: AiProvider;
  knowledgeRetriever: KnowledgeRuntimeRetriever;
  groundedAnswer?: KnowledgeV2GroundedAnswerService;
  signal?: AbortSignal;
}

const nodeNames = [
  "normalize_message",
  "load_tenant_context",
  "retrieve_context",
  "intent_classify",
  "draft_response",
  "decide_tool_calls",
  "quality_gate",
  "execute_tools",
  "persist_audit",
] as const;

const AiReplyState = Annotation.Root({
  data: Annotation<AiReplyJobData>(),
  jobId: Annotation<string | undefined>(),
  graphRunId: Annotation<string>(),
  externalMessageId: Annotation<string>(),
  aiRun: Annotation<AiReplyAttempt>(),
  runtimeInput: Annotation<AiReplyRuntimeInput>(),
  expectedCorpusKind: Annotation<"LEGACY_V1" | "STRUCTURED_V2">(),
  capabilityGate: Annotation<CapabilityGateResult | undefined>(),
  normalizedText: Annotation<string>(),
  conversation: Annotation<ConversationRecord | undefined>(),
  messages: Annotation<AiMessage[]>(),
  knowledgeRetrieval: Annotation<KnowledgeRuntimeRetrievalResult | undefined>(),
  retrievedContext: Annotation<RetrievedContext[]>(),
  intent: Annotation<AiIntentResult | undefined>(),
  extraction: Annotation<AiExtractionResult | undefined>(),
  aiReply: Annotation<AiReplyResult | undefined>(),
  groundedAnswer: Annotation<GroundedAnswerOrchestrationResult | undefined>(),
  recommendation: Annotation<AiRecommendationResult | undefined>(),
  quality: Annotation<QualityGateResult | undefined>(),
  toolCalls: Annotation<AiToolCall[]>(),
  toolResults: Annotation<AiToolResult[]>(),
  result: Annotation<AiReplyGraphResult | undefined>(),
});

type AiReplyStateValue = typeof AiReplyState.State;
type AiReplyStateUpdate = typeof AiReplyState.Update;

function graphNodeSpan<T>(
  nodeName: string,
  state: AiReplyStateValue,
  run: () => Promise<T>,
): Promise<T> {
  return withSpan(
    `ai.graph.node ${nodeName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "leadvirt.graph_run_id": state.graphRunId,
        "leadvirt.tenant_id": state.data.tenantId,
        "leadvirt.conversation_id": state.data.conversationId,
        "leadvirt.source": state.data.source,
        "leadvirt.graph_node": nodeName,
      },
    },
    run,
  );
}

function requiredGrounding(text: string) {
  return /price|cost|catalog|service|available|availability|slot|policy|refund|discount|\u0446\u0435\u043d\u0430|\u0441\u0442\u043e\u0438\u043c|\u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u043f\u0440\u0430\u0439\u0441|\u0443\u0441\u043b\u0443\u0433|\u043a\u0430\u0442\u0430\u043b\u043e\u0433|\u043e\u043a\u043d|\u0437\u0430\u043f\u0438\u0441|\u0434\u043e\u0441\u0442\u0443\u043f|\u0433\u0440\u0430\u0444\u0438\u043a|\u0432\u043e\u0437\u0432\u0440\u0430\u0442|\u0441\u043a\u0438\u0434/iu.test(
    text,
  );
}

function buildMessages(state: AiReplyStateValue): AiMessage[] {
  const bundle =
    state.knowledgeRetrieval?.status === "grounded" ? state.knowledgeRetrieval.bundle : null;
  const contextText = bundle
    ? JSON.stringify({
        schema: "leadvirt.retrieved-evidence.v1",
        facts: bundle.facts.map((item) => ({
          evidenceKey: item.evidenceKey,
          label: item.safeLabel,
          value: item.value,
        })),
        guidance: bundle.guidance.map((item) => ({
          evidenceKey: item.evidenceKey,
          label: item.safeLabel,
          instruction: item.instruction,
        })),
        documents: bundle.documents.map((item) => ({
          evidenceKey: item.evidenceKey,
          title: item.title,
          content: item.content,
        })),
      })
    : "";

  if (!contextText) return state.messages;

  return [
    {
      role: "user",
      content: `BEGIN_RETRIEVED_EVIDENCE_JSON\n${contextText}\nEND_RETRIEVED_EVIDENCE_JSON`,
    },
    ...state.messages,
  ];
}

export function localizedKnowledgeHandoffReply(locale = "en") {
  return knowledgeHandoffReplyV1(locale).text;
}

export function knowledgeRetrievalAllowsGeneration(
  retrieval: KnowledgeRuntimeRetrievalResult | undefined,
  tenantModelProcessorAuthorized = false,
) {
  return (
    retrieval?.status === "grounded" &&
    retrieval.bundle.gateOutcome === "AUTO_SEND" &&
    (retrieval.bundle.corpusKind !== "STRUCTURED_V2" || tenantModelProcessorAuthorized)
  );
}

function retrievalBlocked(state: AiReplyStateValue) {
  if (structuredBundle(state)) {
    return (
      state.knowledgeRetrieval?.status !== "grounded" ||
      state.knowledgeRetrieval.bundle.gateOutcome !== "AUTO_SEND"
    );
  }
  return Boolean(
    state.knowledgeRetrieval && !knowledgeRetrievalAllowsGeneration(state.knowledgeRetrieval),
  );
}

function structuredBundle(state: AiReplyStateValue) {
  return state.knowledgeRetrieval?.status === "grounded" &&
    state.knowledgeRetrieval.bundle.corpusKind === "STRUCTURED_V2"
    ? state.knowledgeRetrieval.bundle
    : null;
}

function structuredRuntime(state: AiReplyStateValue) {
  return state.expectedCorpusKind === "STRUCTURED_V2";
}

function deterministicIntent(text: string) {
  return classifyKnowledgeCapabilityIntentV1(text).intent;
}

function capabilityGate(
  text: string,
  bindingValid: boolean,
  snapshots: ReadonlyMap<
    KnowledgeV2CapabilityType,
    { allowedAutonomy: AiReplyAttempt["allowedAutonomy"] }
  >,
  run: AiReplyAttempt,
): CapabilityGateResult {
  const classification = classifyKnowledgeCapabilityIntentV1(text);
  const capabilityType = classification.capabilityType;
  if (!bindingValid) {
    return {
      capabilityType,
      allowedAutonomy: null,
      allowed: false,
      reason: "CAPABILITY_BINDING_INVALID",
    };
  }
  if (!capabilityType || run.capabilityDecision === "HANDOFF") {
    return {
      capabilityType,
      allowedAutonomy: null,
      allowed: false,
      reason: "HUMAN_HANDOFF_REQUESTED",
    };
  }
  const snapshot = snapshots.get(capabilityType);
  const answerDecision = authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: snapshot?.allowedAutonomy ?? null,
    effect: "ANSWER",
  });
  const allowed = Boolean(
    snapshot &&
    run.capabilityDecision === "AUTHORIZED" &&
    run.capabilityType === capabilityType &&
    run.allowedAutonomy === snapshot.allowedAutonomy &&
    run.requiredAutonomy === answerDecision.requiredAutonomy &&
    answerDecision.allowed,
  );
  return {
    capabilityType,
    allowedAutonomy: snapshot?.allowedAutonomy ?? null,
    allowed,
    reason: allowed
      ? "CAPABILITY_ENABLED"
      : snapshot
        ? "CAPABILITY_BINDING_INVALID"
        : "CAPABILITY_DISABLED",
  };
}

function generatedReplySupported(state: AiReplyStateValue, reply: string) {
  if (state.knowledgeRetrieval?.status !== "grounded") return false;
  const bundle = state.knowledgeRetrieval.bundle;
  const evidenceText = [
    ...bundle.facts.map((item) => item.value),
    ...bundle.documents.map((item) => item.content),
    ...bundle.liveToolResults.map((item) => item.content),
  ]
    .join("\n")
    .toLocaleLowerCase("und");
  const claims =
    reply.match(/(?:[$\u20ac\u00a3\u20bd]\s*)?\d[\d.,]*(?:\s*(?:%|usd|eur|rub|gbp|\u20bd))?/giu) ??
    [];
  if (claims.some((claim) => !evidenceText.includes(claim.toLocaleLowerCase("und")))) return false;
  return bundle.facts
    .filter((item) => item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL")
    .every((item) => !reply.includes(item.safeLabel) || reply.includes(item.value));
}

function validatedClaimCitations(state: AiReplyStateValue, reply: string) {
  if (state.knowledgeRetrieval?.status !== "grounded") return [];
  return state.knowledgeRetrieval.bundle.facts
    .filter((item) => item.value.length > 1 && reply.includes(item.value))
    .map((item, ordinal) => ({
      evidenceKey: item.evidenceKey,
      claimHash: createHash("sha256").update(item.value).digest("hex"),
      ordinal,
      confidence: 1,
    }));
}

function ensureActive(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("AI reply run was cancelled.");
}

function queuedPublicSource(source: AiReplyJobData["source"]) {
  return source === "telegram" || source === "webhook";
}

function channelSendSource(
  source: AiReplyJobData["source"],
): ChannelSendMessageJobData["source"] | null {
  if (source === "telegram" || source === "webhook") return source;
  return null;
}

function tenantLocale(settings: Prisma.JsonValue | null) {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return "en";
  const locale = (settings as Record<string, Prisma.JsonValue>).defaultLocale;
  return typeof locale === "string" && locale.length <= 35 ? locale : "en";
}

function runtimeAuthorization(state: AiReplyStateValue): KnowledgeRuntimeAuthorizationContext {
  if (!state.conversation) throw new Error("AI graph requires a loaded conversation.");
  const locale = tenantLocale(state.conversation.tenant.settings);
  const channelType = state.conversation.channel?.type ?? "DEMO";
  const customerIdentity = state.data.customerIdentity;
  return {
    locale,
    channelType,
    audience: customerIdentity ? "AUTHENTICATED_CUSTOMER" : "PUBLIC",
    classifications: customerIdentity ? ["PUBLIC", "CUSTOMER_PERSONAL"] : ["PUBLIC"],
    queryClassification: customerIdentity ? "CUSTOMER_PERSONAL" : "PUBLIC",
    executionContextId: state.graphRunId,
    ...(customerIdentity ? { customerIdentity } : {}),
    ...(state.conversation.channelId ? { channelIds: [state.conversation.channelId] } : {}),
    intent: deterministicIntent(state.normalizedText),
    ...(state.runtimeInput.leadStatus ? { leadStage: state.runtimeInput.leadStatus } : {}),
  };
}

function structuredRetrievalMetric(retrieval: KnowledgeRuntimeRetrievalResult) {
  const corpusKind =
    retrieval.status === "unavailable"
      ? (retrieval.target?.corpusKind ?? retrieval.diagnostics.corpusKind)
      : retrieval.bundle.corpusKind;
  if (corpusKind !== "STRUCTURED_V2") {
    return { outcome: "blocked", reason: "corpus_mismatch" };
  }
  if (retrieval.status === "grounded") {
    if (retrieval.diagnostics.degradedReason) {
      return {
        outcome: "degraded",
        reason: retrieval.diagnostics.degradedReason.toLowerCase(),
      };
    }
    return structuredEvidenceCount(retrieval.bundle) > 0
      ? { outcome: "grounded", reason: "evidence_ready" }
      : { outcome: "empty", reason: "no_match" };
  }
  if (retrieval.status === "insufficient_grounding") {
    return {
      outcome: retrieval.reason === "NO_MATCH" ? "empty" : "blocked",
      reason: retrieval.reason.toLowerCase(),
    };
  }
  return {
    outcome: retrieval.retryable ? "degraded" : "blocked",
    reason: retrieval.reason.toLowerCase(),
  };
}

function structuredAnswerRisk(bundle: ReturnType<typeof structuredBundle>) {
  if (!bundle) return "unknown";
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
  let maximum: keyof typeof rank = "LOW";
  for (const item of [...bundle.facts, ...bundle.guidance]) {
    if (rank[item.riskLevel] > rank[maximum]) maximum = item.riskLevel;
  }
  if (
    bundle.liveToolResults.length > 0 ||
    bundle.documents.some(
      (item) =>
        item.kind === "DOCUMENT" &&
        (item.classification === "SENSITIVE" || item.classification === "SECRET"),
    )
  ) {
    maximum = rank[maximum] < rank.HIGH ? "HIGH" : maximum;
  }
  return maximum.toLowerCase();
}

function structuredEvidenceCount(bundle: ReturnType<typeof structuredBundle>) {
  return bundle
    ? bundle.facts.length +
        bundle.guidance.length +
        bundle.documents.length +
        bundle.liveToolResults.length
    : 0;
}

function createGraph(
  aiProvider: AiProvider,
  knowledgeRetriever: KnowledgeRuntimeRetriever,
  groundedAnswer?: KnowledgeV2GroundedAnswerService,
  signal?: AbortSignal,
) {
  const guardedNodeSpan = async <T>(
    nodeName: string,
    state: AiReplyStateValue,
    run: () => Promise<T>,
  ) => {
    ensureActive(signal);
    const result = await graphNodeSpan(nodeName, state, run);
    ensureActive(signal);
    return result;
  };

  return new StateGraph(AiReplyState)
    .addNode(
      "normalize_message",
      (state): AiReplyStateUpdate => ({
        normalizedText: state.runtimeInput.inputText.replace(/\s+/g, " ").trim(),
      }),
    )
    .addNode("load_tenant_context", async (state): Promise<AiReplyStateUpdate> => {
      const [conversation, selector, publicationBinding] = await Promise.all([
        prisma.conversation.findFirst({
          where: {
            id: state.data.conversationId,
            tenantId: state.data.tenantId,
            deletedAt: null,
          },
          include: {
            tenant: true,
            lead: true,
            channel: true,
            messages: {
              include: { authenticatedCustomerIdentity: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
        }),
        prisma.knowledgeCorpusSelector.findUnique({
          where: { tenantId: state.data.tenantId },
          select: { corpusKind: true },
        }),
        state.aiRun.publicationId
          ? prisma.knowledgePublication.findFirst({
              where: {
                id: state.aiRun.publicationId,
                tenantId: state.data.tenantId,
                corpusKind: "STRUCTURED_V2",
                status: "ACTIVE",
              },
              select: {
                capabilitySetHash: true,
                operationalBindingHash: true,
                operationalPermissionGeneration: true,
                capabilitySnapshots: {
                  select: { capabilityType: true, allowedAutonomy: true },
                  orderBy: { capabilityType: "asc" },
                },
              },
            })
          : null,
      ]);

      if (!conversation) {
        throw new Error(
          `Conversation ${state.data.conversationId} was not found for queued AI reply.`,
        );
      }
      const triggerMessage = conversation.messages.find(
        (message) => message.id === state.data.triggerMessageId,
      );
      const persistedIdentity = triggerMessage?.authenticatedCustomerIdentity ?? null;
      const queuedIdentity = state.data.customerIdentity;
      if (
        !triggerMessage ||
        triggerMessage.direction !== "INBOUND" ||
        (persistedIdentity === null) !== (queuedIdentity === undefined) ||
        (persistedIdentity !== null &&
          queuedIdentity !== undefined &&
          (state.data.source !== "telegram" ||
            persistedIdentity.id !== queuedIdentity.id ||
            persistedIdentity.version !== queuedIdentity.version ||
            persistedIdentity.subjectHash !== queuedIdentity.subjectHash ||
            persistedIdentity.attestationHash !== queuedIdentity.attestationHash))
      ) {
        throw new Error("Queued customer identity does not match the inbound message.");
      }

      return {
        conversation,
        expectedCorpusKind: selector?.corpusKind ?? "LEGACY_V1",
        capabilityGate:
          selector?.corpusKind === "STRUCTURED_V2"
            ? capabilityGate(
                state.normalizedText,
                Boolean(
                  publicationBinding &&
                  state.aiRun.capabilitySetHash &&
                  publicationBinding.capabilitySetHash === state.aiRun.capabilitySetHash &&
                  publicationBinding.operationalBindingHash ===
                    state.aiRun.operationalBindingHash &&
                  publicationBinding.operationalPermissionGeneration ===
                    state.aiRun.operationalPermissionGeneration,
                ),
                new Map(
                  publicationBinding?.capabilitySnapshots.map((item) => [
                    item.capabilityType,
                    { allowedAutonomy: item.allowedAutonomy },
                  ]) ?? [],
                ),
                state.aiRun,
              )
            : undefined,
        messages: conversation.messages.map((message) => ({
          role: message.senderType === "AI" ? "assistant" : "user",
          content:
            message.id === state.data.triggerMessageId
              ? state.runtimeInput.inputText
              : (message.text ?? ""),
        })),
      };
    })
    .addNode(
      "retrieve_context",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("retrieve_context", state, async () => {
          if (state.result) return {};
          if (!state.conversation)
            throw new Error("AI graph reached retrieval without a conversation.");
          if (structuredRuntime(state) && !state.capabilityGate?.allowed) {
            return { retrievedContext: [] };
          }
          const locale = tenantLocale(state.conversation.tenant.settings);
          const channelType = state.conversation.channel?.type ?? "DEMO";
          const authorization = runtimeAuthorization(state);
          const retrieval = await knowledgeRetriever.retrieve({
            tenantId: state.data.tenantId,
            query: state.normalizedText,
            limit: 4,
            locale,
            channel: channelType,
            graphVersion: "ai-reply-graph-v2",
            authorization,
            ...(signal ? { signal } : {}),
            ...(state.aiRun.publicationId ? { publicationId: state.aiRun.publicationId } : {}),
          });
          if (state.expectedCorpusKind === "STRUCTURED_V2") {
            const metric = structuredRetrievalMetric(retrieval);
            recordStructuredKnowledgeRetrieval({
              backend: retrieval.diagnostics.backend,
              outcome: metric.outcome,
              reason: metric.reason,
              locale,
              candidateCount: retrieval.diagnostics.candidateCount,
              selectedCount: retrieval.diagnostics.selectedCount,
              durationMs: retrieval.diagnostics.durationMs,
            });
          }
          if (retrieval.status === "unavailable" && retrieval.traceDraft) {
            await knowledgeRetriever.cleanupTraceArtifacts({ draft: retrieval.traceDraft });
          }
          return {
            knowledgeRetrieval: retrieval,
            retrievedContext:
              retrieval.status === "grounded"
                ? retrieval.bundle.documents.map((evidence) => ({
                    chunkId: evidence.chunkId,
                    revisionId: evidence.revisionId,
                    sourceId: evidence.sourceId,
                    sourceType: evidence.sourceKind,
                    title: evidence.title,
                    content: evidence.content,
                    contentHash: evidence.contentHash,
                    score: evidence.kind === "DOCUMENT" ? evidence.rerankScore : evidence.score,
                  }))
                : [],
          };
        }),
    )
    .addNode(
      "intent_classify",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("intent_classify", state, async () => {
          if (state.result) return {};
          if (structuredRuntime(state)) {
            return { intent: { intent: deterministicIntent(state.normalizedText), confidence: 1 } };
          }
          if (retrievalBlocked(state)) {
            return { intent: { intent: "knowledge_handoff", confidence: 1 } };
          }
          return {
            intent: await aiProvider.classifyIntent({
              tenantId: state.data.tenantId,
              text: state.normalizedText,
            }),
          };
        }),
    )
    .addNode(
      "draft_response",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("draft_response", state, async () => {
          if (state.result) return {};
          if (!state.conversation) {
            throw new Error("AI graph reached draft_response without a conversation.");
          }
          if (structuredRuntime(state)) {
            const bundle = structuredBundle(state);
            const locale = tenantLocale(state.conversation.tenant.settings);
            if (!state.capabilityGate?.allowed) {
              return {
                aiReply: {
                  reply: localizedKnowledgeHandoffReply(locale),
                  intent: "knowledge_handoff",
                  leadFields: {},
                  nextAction: {
                    type: "request_human_handoff",
                    reason: state.capabilityGate?.reason ?? "Capability snapshot is unavailable.",
                  },
                  confidence: 1,
                  handoffRequired: true,
                },
              };
            }
            const missingFreshOperationalEvidence = Boolean(
              bundle?.answerPolicy.requiresLiveEvidence && bundle.liveToolResults.length === 0,
            );
            const grounded =
              bundle &&
              groundedAnswer &&
              bundle.gateOutcome === "AUTO_SEND" &&
              !missingFreshOperationalEvidence
                ? await groundedAnswer.answer({
                    tenantId: state.data.tenantId,
                    locale,
                    question: state.normalizedText,
                    queryClassification: runtimeAuthorization(state).queryClassification,
                    promptPolicyVersion: bundle.target.promptPolicyVersion,
                    bundle,
                    now: new Date().toISOString(),
                    ...(signal ? { signal } : {}),
                  })
                : undefined;
            const safeToSend = grounded?.disposition === "AUTO_SEND" && Boolean(grounded.finalText);
            return {
              groundedAnswer: grounded,
              aiReply: {
                reply: safeToSend ? grounded.finalText! : localizedKnowledgeHandoffReply(locale),
                intent: safeToSend
                  ? deterministicIntent(state.normalizedText)
                  : "knowledge_handoff",
                leadFields: {},
                nextAction: safeToSend
                  ? { type: "none", reason: "Structured grounded answer passed." }
                  : {
                      type: "request_human_handoff",
                      reason: missingFreshOperationalEvidence
                        ? "Authorized fresh operational evidence is unavailable."
                        : "Structured grounded answer did not pass.",
                    },
                confidence: 1,
                handoffRequired: !safeToSend,
              },
            };
          }
          if (retrievalBlocked(state)) {
            return {
              aiReply: {
                reply: localizedKnowledgeHandoffReply(
                  state.conversation ? tenantLocale(state.conversation.tenant.settings) : "en",
                ),
                intent: "knowledge_handoff",
                leadFields: {},
                nextAction: {
                  type: "request_human_handoff",
                  reason: "Knowledge evidence did not pass the runtime gate.",
                },
                confidence: 1,
                handoffRequired: true,
              },
            };
          }
          return {
            aiReply: await aiProvider.generateReply({
              tenantId: state.data.tenantId,
              businessName: state.runtimeInput.businessName,
              locale: tenantLocale(state.conversation.tenant.settings),
              ...(state.runtimeInput.businessType
                ? { businessType: state.runtimeInput.businessType }
                : {}),
              conversationId: state.data.conversationId,
              messages: buildMessages(state),
            }),
          };
        }),
    )
    .addNode(
      "decide_tool_calls",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("decide_tool_calls", state, async () => {
          if (state.result) return {};
          if (structuredRuntime(state)) {
            const safeToSend = state.groundedAnswer?.disposition === "AUTO_SEND";
            return {
              extraction: { fields: {}, confidence: 1 },
              recommendation: {
                action: safeToSend ? "none" : "request_human_handoff",
                reason: safeToSend
                  ? "Structured replies default-deny state-changing tools."
                  : "Structured grounded answer requires handoff.",
                confidence: 1,
                handoffRequired: !safeToSend,
              },
            };
          }
          if (retrievalBlocked(state)) {
            return {
              extraction: { fields: {}, confidence: 1 },
              recommendation: {
                action: "request_human_handoff",
                reason: "Knowledge evidence did not pass the runtime gate.",
                confidence: 1,
                handoffRequired: true,
              },
            };
          }
          const [extraction, recommendation] = await Promise.all([
            aiProvider.extractLeadFields({
              tenantId: state.data.tenantId,
              conversationId: state.data.conversationId,
              text: state.normalizedText,
            }),
            aiProvider.recommendNextAction({
              tenantId: state.data.tenantId,
              conversationId: state.data.conversationId,
              ...(state.runtimeInput.leadStatus
                ? { leadStatus: state.runtimeInput.leadStatus }
                : {}),
              text: state.normalizedText,
            }),
          ]);
          return { extraction, recommendation };
        }),
    )
    .addNode("quality_gate", (state): AiReplyStateUpdate => {
      if (state.result) return {};
      if (!state.aiReply || !state.recommendation) {
        throw new Error("AI graph reached quality_gate without a draft reply or recommendation.");
      }

      if (structuredRuntime(state)) {
        const passed =
          state.groundedAnswer?.disposition === "AUTO_SEND" &&
          Boolean(state.groundedAnswer.finalText);
        return {
          quality: {
            passed,
            reason: passed
              ? "grounded_answer_passed"
              : (state.groundedAnswer?.issues[0]?.code ?? "structured_handoff").toLowerCase(),
            confidence: 1,
            handoffRequired: !passed,
            finalReply: passed
              ? state.groundedAnswer!.finalText!
              : localizedKnowledgeHandoffReply(
                  state.conversation ? tenantLocale(state.conversation.tenant.settings) : "en",
                ),
          },
        };
      }

      const confidence = Math.min(state.aiReply.confidence, state.recommendation.confidence);
      const groundingRequired = requiredGrounding(state.normalizedText);
      const retrievalUnavailable = state.knowledgeRetrieval?.status === "unavailable";
      const retrievalGateBlocked =
        state.knowledgeRetrieval?.status !== "grounded" ||
        state.knowledgeRetrieval.bundle.gateOutcome !== "AUTO_SEND";
      const missingGrounding = groundingRequired && retrievalGateBlocked;
      const lowConfidence = confidence < 0.45;
      const supportedClaims = generatedReplySupported(state, state.aiReply.reply);
      const passed =
        !retrievalGateBlocked && !missingGrounding && !lowConfidence && supportedClaims;
      const handoffRequired =
        !passed || state.aiReply.handoffRequired || state.recommendation.handoffRequired;

      return {
        quality: {
          passed,
          reason: retrievalUnavailable
            ? "knowledge_unavailable"
            : retrievalGateBlocked || missingGrounding
              ? "missing_grounding"
              : lowConfidence
                ? "low_confidence"
                : !supportedClaims
                  ? "unsupported_claim"
                  : "passed",
          confidence,
          handoffRequired,
          finalReply: passed
            ? state.aiReply.reply
            : localizedKnowledgeHandoffReply(
                state.conversation ? tenantLocale(state.conversation.tenant.settings) : "en",
              ),
        },
      };
    })
    .addNode(
      "execute_tools",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("execute_tools", state, async () => {
          if (state.result) return {};
          if (retrievalBlocked(state)) return { toolCalls: [], toolResults: [] };
          if (!state.conversation || !state.extraction || !state.recommendation || !state.quality) {
            throw new Error("AI graph reached execute_tools with incomplete state.");
          }

          const toolCalls = planAiToolCalls({
            tenantId: state.data.tenantId,
            leadId: state.runtimeInput.leadId,
            currentLeadStatus: state.runtimeInput.leadStatus,
            requestedByUserId: state.data.requestedByUserId ?? null,
            graphRunId: state.graphRunId,
            conversationId: state.data.conversationId,
            normalizedText: state.normalizedText,
            extractedFields: state.extraction.fields,
            recommendationAction: state.recommendation.action,
            recommendationReason: state.recommendation.reason,
            qualityPassed: state.quality.passed,
            handoffRequired: state.quality.handoffRequired,
            retrievedContext: state.retrievedContext.map((item) => ({
              title: item.title,
              content: item.content,
            })),
            ...(structuredRuntime(state)
              ? {
                  autonomy: {
                    capabilityDecision: state.aiRun.capabilityDecision,
                    allowedAutonomy: state.aiRun.allowedAutonomy,
                    confirmationValid: false,
                    autonomousActionApproved: false,
                  },
                }
              : {}),
          });

          const toolResults = await executeAiToolCalls({
            tenantId: state.data.tenantId,
            graphRunId: state.graphRunId,
            conversationId: state.data.conversationId,
            calls: toolCalls,
            attempt: state.aiRun,
            ...(signal ? { signal } : {}),
          });

          return { toolCalls, toolResults };
        }),
    )
    .addNode(
      "persist_audit",
      async (state): Promise<AiReplyStateUpdate> =>
        guardedNodeSpan("persist_audit", state, async () => {
          if (state.result) return {};
          if (
            !state.conversation ||
            !state.aiReply ||
            !state.recommendation ||
            !state.extraction ||
            !state.quality
          ) {
            throw new Error("AI graph reached persist_audit with incomplete state.");
          }
          const conversation = state.conversation;
          const aiReply = state.aiReply;
          const recommendation = state.recommendation;
          const extraction = state.extraction;
          let quality = state.quality;
          const structured = structuredBundle(state);
          const authorization = state.conversation ? runtimeAuthorization(state) : null;
          let evidenceManifestHash: string | null = null;
          if (
            structured &&
            authorization &&
            quality.passed &&
            state.groundedAnswer?.disposition === "AUTO_SEND"
          ) {
            const [evidence, processor] = await Promise.all([
              knowledgeRetriever.revalidateEvidence({
                tenantId: state.data.tenantId,
                query: state.normalizedText,
                bundle: structured,
                authorization,
              }),
              groundedAnswer?.revalidateProcessor(
                {
                  tenantId: state.data.tenantId,
                  locale: authorization.locale,
                  question: state.normalizedText,
                  queryClassification: authorization.queryClassification,
                  promptPolicyVersion: structured.target.promptPolicyVersion,
                  bundle: structured,
                  now: new Date().toISOString(),
                },
                state.groundedAnswer,
              ) ?? Promise.resolve(false),
            ]);
            evidenceManifestHash = evidence.evidenceManifestHash;
            if (!evidence.valid || !processor) {
              quality = {
                passed: false,
                reason: !evidence.valid
                  ? "structured_evidence_revoked"
                  : "structured_model_revoked",
                confidence: 1,
                handoffRequired: true,
                finalReply: localizedKnowledgeHandoffReply(authorization.locale),
              };
            }
          }

          const replyOutcome = structuredRuntime(state)
            ? quality.passed
              ? {
                  disposition: "AUTO_SEND" as const,
                  contentHash: aiReplyContentHashV1(quality.finalReply),
                  templateVersion: null,
                }
              : (() => {
                  const template = knowledgeHandoffReplyV1(
                    authorization?.locale ?? tenantLocale(conversation.tenant.settings),
                  );
                  if (quality.finalReply !== template.text) {
                    throw new AiReplyFenceError("AI_REPLY_HANDOFF_TEMPLATE_INVALID");
                  }
                  return {
                    disposition: "HANDOFF" as const,
                    contentHash: aiReplyContentHashV1(quality.finalReply),
                    templateVersion: template.templateVersion,
                  };
                })()
            : null;

          const receivedAt = state.runtimeInput.receivedAt;
          const aiCreatedAt = new Date(receivedAt.getTime() + 1000);
          const contextRefs = state.retrievedContext.map((item) => ({
            chunkId: item.chunkId,
            revisionId: item.revisionId,
            sourceId: item.sourceId,
            sourceType: item.sourceType,
            title: item.title,
            contentHash: item.contentHash,
            score: item.score,
          }));
          const groundedCitations =
            quality.passed && state.groundedAnswer?.disposition === "AUTO_SEND"
              ? state.groundedAnswer.citations.map((citation) => ({
                  evidenceKey: citation.evidenceKey,
                  claimHash: citation.claimHash,
                  ordinal: citation.ordinal,
                  confidence: null,
                  support: "SUPPORTS" as const,
                }))
              : [];
          const retrievalTarget = state.knowledgeRetrieval
            ? state.knowledgeRetrieval.status === "unavailable"
              ? (state.knowledgeRetrieval.target ?? null)
              : state.knowledgeRetrieval.bundle.target
            : null;
          const knowledgeRetrievalPayload: Prisma.InputJsonObject | null = state.knowledgeRetrieval
            ? {
                status: state.knowledgeRetrieval.status,
                reason:
                  state.knowledgeRetrieval.status === "grounded"
                    ? null
                    : state.knowledgeRetrieval.reason,
                corpusKind: retrievalTarget?.corpusKind ?? null,
                snapshotKind: retrievalTarget?.snapshotKind ?? null,
                publicationId:
                  retrievalTarget?.snapshotKind === "PUBLICATION"
                    ? retrievalTarget.publicationId
                    : null,
                publicationSequence:
                  retrievalTarget?.snapshotKind === "PUBLICATION"
                    ? retrievalTarget.publicationSequence
                    : null,
                candidateId:
                  retrievalTarget?.snapshotKind === "DRAFT_CANDIDATE"
                    ? retrievalTarget.candidateId
                    : null,
                candidateVersion:
                  retrievalTarget?.snapshotKind === "DRAFT_CANDIDATE"
                    ? retrievalTarget.candidateVersion
                    : null,
                indexSnapshotId: retrievalTarget?.indexSnapshotId ?? null,
                retrievalPolicyVersion: retrievalTarget?.retrievalPolicyVersion ?? null,
                promptPolicyVersion: retrievalTarget?.promptPolicyVersion ?? null,
                graphVersion: "ai-reply-graph-v2",
                gateOutcome:
                  state.knowledgeRetrieval.status === "unavailable"
                    ? "HANDOFF"
                    : structured
                      ? quality.passed
                        ? "AUTO_SEND"
                        : "HANDOFF"
                      : state.knowledgeRetrieval.bundle.gateOutcome,
                citationKeys:
                  state.knowledgeRetrieval.status === "unavailable"
                    ? []
                    : structured
                      ? groundedCitations.map((citation) => citation.evidenceKey)
                      : state.knowledgeRetrieval.bundle.citations.map(
                          (citation) => citation.evidenceKey,
                        ),
                diagnostics: {
                  backend: state.knowledgeRetrieval.diagnostics.backend,
                  candidateCount: state.knowledgeRetrieval.diagnostics.candidateCount,
                  hydratedCount: state.knowledgeRetrieval.diagnostics.hydratedCount,
                  selectedCount: state.knowledgeRetrieval.diagnostics.selectedCount,
                  durationMs: state.knowledgeRetrieval.diagnostics.durationMs,
                },
              }
            : null;
          const qualityPayload = {
            passed: quality.passed,
            reason: quality.reason,
            confidence: quality.confidence,
            handoffRequired: quality.handoffRequired,
          };
          const toolCallPayloads = state.toolCalls.map((call) => ({
            id: call.id,
            type: call.type,
            input: call.input,
          }));
          const redactedToolCallPayloads = redactSensitiveData(toolCallPayloads);
          const toolResultPayloads = state.toolResults.map((result) => ({
            callId: result.callId,
            type: result.type,
            status: result.status,
            entityType: result.entityType ?? null,
            entityId: result.entityId ?? null,
            reason: result.reason ?? null,
          }));
          const persistedBundle = structured
            ? {
                ...structured,
                outcome: quality.passed ? ("ANSWERED" as const) : ("HANDED_OFF" as const),
                gateOutcome: quality.passed ? ("AUTO_SEND" as const) : ("HANDOFF" as const),
                citations: groundedCitations,
              }
            : !structuredRuntime(state) && state.knowledgeRetrieval?.status === "grounded"
              ? state.knowledgeRetrieval.bundle
              : null;
          let preparedTrace: PreparedKnowledgeV2Trace | null = null;
          if (
            state.knowledgeRetrieval?.traceDraft &&
            state.knowledgeRetrieval.status !== "unavailable" &&
            persistedBundle
          ) {
            const citations = structured
              ? groundedCitations
              : validatedClaimCitations(state, quality.finalReply);
            preparedTrace = await knowledgeRetriever.prepareTrace({
              tenantId: state.data.tenantId,
              draft: {
                ...state.knowledgeRetrieval.traceDraft,
                promptPolicyVersion:
                  state.groundedAnswer?.promptPolicyVersion ??
                  state.knowledgeRetrieval.traceDraft.promptPolicyVersion,
                provider:
                  state.groundedAnswer?.provider ??
                  state.knowledgeRetrieval.traceDraft.provider ??
                  null,
                generatorModel:
                  state.groundedAnswer?.model ??
                  state.knowledgeRetrieval.traceDraft.generatorModel ??
                  null,
                modelProcessorPolicyHash:
                  state.groundedAnswer?.processorPolicyHash ??
                  state.knowledgeRetrieval.traceDraft.modelProcessorPolicyHash ??
                  null,
                providerOutputHash: state.groundedAnswer?.providerOutputHash ?? null,
                gateInputHash: state.groundedAnswer?.gateInputHash ?? null,
                gateResultHash: state.groundedAnswer?.gateResultHash ?? null,
                outcome: persistedBundle.outcome,
                gateOutcome: persistedBundle.gateOutcome,
                citations,
              },
              finalAnswer: quality.finalReply,
            });
          }

          const groundedAnswerPayload: Prisma.InputJsonValue | null = state.groundedAnswer
            ? {
                disposition: quality.passed ? "AUTO_SEND" : "HANDOFF",
                provider: state.groundedAnswer.provider,
                model: state.groundedAnswer.model,
                providerVersion: state.groundedAnswer.providerVersion,
                region: state.groundedAnswer.region,
                processorPolicyVersion: state.groundedAnswer.processorPolicyVersion,
                processorPolicyHash: state.groundedAnswer.processorPolicyHash,
                promptPolicyVersion: state.groundedAnswer.promptPolicyVersion,
                providerOutputHash: state.groundedAnswer.providerOutputHash,
                gateInputHash: state.groundedAnswer.gateInputHash,
                gateResultHash: state.groundedAnswer.gateResultHash,
                evidenceManifestHash,
                citationKeys: groundedCitations.map((citation) => citation.evidenceKey),
                requiresLiveEvidence: structured?.answerPolicy.requiresLiveEvidence ?? false,
              }
            : null;
          const messageMetadata: Prisma.InputJsonObject = {
            graphRunId: state.graphRunId,
            graphNodes: [...nodeNames],
            intent: aiReply.intent,
            classifiedIntent: state.intent?.intent ?? null,
            confidence: quality.confidence,
            nextAction: recommendation.action,
            quality: qualityPayload,
            groundedAnswer: groundedAnswerPayload,
            knowledgeRetrieval: knowledgeRetrievalPayload,
            retrievedContext: contextRefs,
            toolCalls: redactedToolCallPayloads,
            toolResults: toolResultPayloads,
            source: state.data.source,
            outboundStatus: queuedPublicSource(state.data.source) ? "queued" : "sent",
            triggerMessageId: state.data.triggerMessageId,
            jobId: state.externalMessageId,
            replyOutcome: replyOutcome
              ? {
                  disposition: replyOutcome.disposition,
                  contentHash: replyOutcome.contentHash,
                  templateVersion: replyOutcome.templateVersion,
                }
              : null,
          };

          const persisted = await withFencedAiReplyTransaction(state.aiRun, async (tx, run) => {
            ensureActive(signal);
            if (
              structured &&
              authorization &&
              persistedBundle?.corpusKind === "STRUCTURED_V2" &&
              quality.passed &&
              state.groundedAnswer?.disposition === "AUTO_SEND"
            ) {
              const finalEvidence = await knowledgeRetriever.revalidateEvidence({
                tenantId: state.data.tenantId,
                query: state.normalizedText,
                bundle: persistedBundle,
                authorization,
                transaction: tx,
              });
              const finalProcessor = await groundedAnswer?.revalidateProcessor(
                {
                  tenantId: state.data.tenantId,
                  locale: authorization.locale,
                  question: state.normalizedText,
                  queryClassification: authorization.queryClassification,
                  promptPolicyVersion: structured.target.promptPolicyVersion,
                  bundle: persistedBundle,
                  now: new Date().toISOString(),
                },
                state.groundedAnswer,
                tx,
              );
              if (
                !finalEvidence.valid ||
                finalEvidence.evidenceManifestHash !== evidenceManifestHash ||
                !finalProcessor
              ) {
                throw new AiReplyFenceError("AI_REPLY_STRUCTURED_TARGET_REVOKED");
              }
            }
            const currentConversation = await tx.conversation.findUniqueOrThrow({
              where: { id: state.data.conversationId },
              select: { status: true, handoffRequested: true, lastMessageAt: true },
            });
            const aiMessage = await tx.message.create({
              data: {
                tenantId: state.data.tenantId,
                conversationId: state.data.conversationId,
                direction: "OUTBOUND",
                senderType: "AI",
                externalMessageId: state.externalMessageId,
                text: quality.finalReply,
                status: queuedPublicSource(state.data.source) ? "QUEUED" : "SENT",
                metadata: messageMetadata,
                createdAt: aiCreatedAt,
                updatedAt: aiCreatedAt,
              },
            });

            let retrievalTraceId: string | null = null;
            if (
              preparedTrace &&
              state.knowledgeRetrieval &&
              state.knowledgeRetrieval.status !== "unavailable" &&
              persistedBundle
            ) {
              const trace = await knowledgeRetriever.persistTrace({
                tenantId: state.data.tenantId,
                prepared: preparedTrace,
                bundle: persistedBundle,
                binding: {
                  responseMessageId: aiMessage.id,
                  distributedTraceId: state.graphRunId,
                },
                transaction: tx,
              });
              retrievalTraceId = trace.id;
              await tx.message.update({
                where: { id: aiMessage.id },
                data: { metadata: { ...messageMetadata, retrievalTraceId } },
              });
            }
            const persistedMessageMetadata: Prisma.InputJsonObject = {
              ...messageMetadata,
              retrievalTraceId,
            };

            const deliverySource = channelSendSource(state.data.source);
            const deliveryJobId = deliverySource ? `channel-send-${aiMessage.id}` : null;
            let deliveryOutboxId: string | null = null;
            if (deliverySource && deliveryJobId) {
              const deliveryOutbox = await createRuntimeQueueEvent(tx, {
                tenantId: state.data.tenantId,
                aggregateType: "message",
                aggregateId: aiMessage.id,
                aggregateVersion: run.sequence,
                generation: run.generation,
                eventType: "channels.send-message.requested",
                dedupeKey: `channels.send-message:${aiMessage.id}:v1`,
                envelope: {
                  queueName: "channels.sendMessage",
                  jobName: "send-message",
                  jobId: deliveryJobId,
                  attempts: 3,
                  backoffMs: 1_000,
                  data: {
                    tenantId: state.data.tenantId,
                    conversationId: state.data.conversationId,
                    messageId: aiMessage.id,
                    source: deliverySource,
                    graphRunId: state.graphRunId,
                    triggerMessageId: state.aiRun.inboundMessageId,
                    aiReplyRunId: run.id,
                    aiReplyGeneration: run.generation,
                    aiReplySequence: run.sequence,
                    requestedAt: aiCreatedAt.toISOString(),
                  },
                },
              });
              deliveryOutboxId = deliveryOutbox.id;
              await tx.message.update({
                where: { id: aiMessage.id },
                data: {
                  metadata: {
                    ...persistedMessageMetadata,
                    deliveryJobId,
                    deliveryOutboxId,
                  },
                },
              });
            }

            await tx.aiUsageLog.create({
              data: {
                tenantId: state.data.tenantId,
                conversationId: state.data.conversationId,
                leadId: conversation.leadId,
                provider: state.groundedAnswer?.provider ?? aiProvider.providerName ?? "unknown",
                model: state.groundedAnswer?.model ?? aiProvider.modelName ?? "unknown",
                actionType: "langgraph_queued_reply",
                inputTokens: Math.max(24, Math.round(state.normalizedText.length / 4)),
                outputTokens: Math.max(18, Math.round(quality.finalReply.length / 4)),
                estimatedCost: "0.000000",
                latencyMs: 35,
                status: quality.passed ? "SUCCESS" : "HANDOFF",
                metadata: {
                  graphRunId: state.graphRunId,
                  graphNodes: [...nodeNames],
                  recommendation: recommendation.action,
                  reason: recommendation.reason,
                  extractionConfidence: extraction.confidence,
                  quality: qualityPayload,
                  groundedAnswer: groundedAnswerPayload,
                  knowledgeRetrieval: knowledgeRetrievalPayload,
                  retrievalTraceId,
                  retrievedContext: contextRefs,
                  toolCalls: redactedToolCallPayloads,
                  toolResults: toolResultPayloads,
                },
              },
            });

            const lastMessageAt =
              currentConversation.lastMessageAt && currentConversation.lastMessageAt > aiCreatedAt
                ? currentConversation.lastMessageAt
                : aiCreatedAt;
            await tx.conversation.update({
              where: { id: state.data.conversationId },
              data: {
                lastMessageAt,
                handoffRequested: currentConversation.handoffRequested || quality.handoffRequired,
                status: quality.handoffRequired ? "WAITING_FOR_HUMAN" : currentConversation.status,
                updatedAt: new Date(),
              },
            });

            if (conversation.leadId) {
              const leadData: Prisma.LeadUpdateInput = {
                lastMessageAt,
                updatedAt: new Date(),
              };
              await tx.lead.update({ where: { id: conversation.leadId }, data: leadData });
              await tx.leadEvent.create({
                data: {
                  tenantId: state.data.tenantId,
                  leadId: conversation.leadId,
                  type: "langgraph_ai_reply_generated",
                  title: "LangGraph AI reply generated",
                  message: quality.finalReply,
                  metadata: {
                    conversationId: state.data.conversationId,
                    messageId: aiMessage.id,
                    deliveryJobId,
                    deliveryOutboxId,
                    graphRunId: state.graphRunId,
                    jobId: state.externalMessageId,
                    intent: aiReply.intent,
                    nextAction: recommendation.action,
                    quality: qualityPayload,
                    groundedAnswer: groundedAnswerPayload,
                    knowledgeRetrieval: knowledgeRetrievalPayload,
                    retrievalTraceId,
                    toolCalls: redactedToolCallPayloads,
                    toolResults: toolResultPayloads,
                    handoffRequired: quality.handoffRequired,
                  },
                },
              });
            }

            await tx.auditLog.create({
              data: {
                tenantId: state.data.tenantId,
                actorUserId: state.data.requestedByUserId ?? null,
                action: "ai.langgraph_reply.processed",
                entityType: "conversation",
                entityId: state.data.conversationId,
                payload: {
                  source: state.data.source,
                  messageId: aiMessage.id,
                  deliveryJobId,
                  deliveryOutboxId,
                  triggerMessageId: state.aiRun.inboundMessageId,
                  graphRunId: state.graphRunId,
                  jobId: state.externalMessageId,
                  graphNodes: [...nodeNames],
                  intent: aiReply.intent,
                  knowledgeRetrieval: knowledgeRetrievalPayload,
                  groundedAnswer: groundedAnswerPayload,
                  retrievalTraceId,
                  retrievedContext: contextRefs,
                  toolCalls: redactedToolCallPayloads,
                  toolResults: toolResultPayloads,
                  quality: qualityPayload,
                  handoffRequired: quality.handoffRequired,
                },
              },
            });

            const retrievalPublicationId =
              retrievalTarget?.snapshotKind === "PUBLICATION"
                ? retrievalTarget.publicationId
                : run.publicationId;
            await tx.aiReplyRun.update({
              where: { id: run.id },
              data: {
                replyMessageId: aiMessage.id,
                publicationId: retrievalPublicationId,
                ...(replyOutcome
                  ? {
                      replyDisposition: replyOutcome.disposition,
                      replyContentHash: replyOutcome.contentHash,
                      replyTemplateVersion: replyOutcome.templateVersion,
                    }
                  : {}),
                status: "SUCCEEDED",
                completedAt: new Date(),
                heartbeatAt: new Date(),
                errorCode: null,
                errorMessage: null,
              },
            });
            ensureActive(signal);
            return { aiMessage, deliveryJobId };
          }).catch(async (error: unknown) => {
            if (preparedTrace && state.knowledgeRetrieval?.traceDraft) {
              await knowledgeRetriever.cleanupTraceArtifacts({
                draft: state.knowledgeRetrieval.traceDraft,
                prepared: preparedTrace,
              });
            }
            throw error;
          });

          if (structuredRuntime(state)) {
            recordStructuredKnowledgeAnswerGate({
              result: quality.passed ? "passed" : "blocked",
              reason: quality.reason,
              risk: structuredAnswerRisk(structured),
              locale: authorization?.locale ?? "other",
              citationCount: groundedCitations.length,
              availableEvidenceCount: structuredEvidenceCount(structured),
            });
          }

          return {
            result: {
              status: "processed",
              conversationId: state.data.conversationId,
              messageId: persisted.aiMessage.id,
              intent: aiReply.intent,
              handoffRequired: quality.handoffRequired,
              graphRunId: state.graphRunId,
              qualityReason: quality.reason,
              qualityPassed: quality.passed,
              toolResults: state.toolResults,
            },
          };
        }),
    )
    .addEdge(START, "normalize_message")
    .addEdge("normalize_message", "load_tenant_context")
    .addEdge("load_tenant_context", "retrieve_context")
    .addEdge("retrieve_context", "intent_classify")
    .addEdge("intent_classify", "draft_response")
    .addEdge("draft_response", "decide_tool_calls")
    .addEdge("decide_tool_calls", "quality_gate")
    .addEdge("quality_gate", "execute_tools")
    .addEdge("execute_tools", "persist_audit")
    .addEdge("persist_audit", END)
    .compile();
}

export async function runAiReplyGraph(input: RunAiReplyGraphInput): Promise<AiReplyGraphResult> {
  ensureActive(input.signal);
  const startedAt = Date.now();
  let attempt: AiReplyAttempt | undefined;
  try {
    const begun = await beginAiReplyAttempt(input.data);
    const activeAttempt = begun.attempt;
    attempt = activeAttempt;
    const graphRunId = `langgraph:${activeAttempt.runId}`;
    const externalMessageId = `ai-reply:${input.data.conversationId}:${activeAttempt.inboundMessageId}`;
    if (begun.disposition !== "active") {
      const result: AiReplyGraphResult = {
        status: "duplicate",
        conversationId: input.data.conversationId,
        messageId: begun.messageId,
        graphRunId,
        qualityReason: begun.disposition === "superseded" ? "superseded" : "duplicate",
      };
      recordAiGraphRun({
        source: input.data.source,
        status: result.status,
        handoffRequired: false,
        qualityReason: result.qualityReason,
        qualityPassed: begun.disposition === "duplicate",
        durationMs: Date.now() - startedAt,
      });
      return result;
    }

    const graph = createGraph(
      input.aiProvider,
      input.knowledgeRetriever,
      input.groundedAnswer,
      input.signal,
    );
    const state = await withSpan(
      "ai.graph run",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "leadvirt.graph_run_id": graphRunId,
          "leadvirt.tenant_id": input.data.tenantId,
          "leadvirt.conversation_id": input.data.conversationId,
          "leadvirt.source": input.data.source,
        },
      },
      async () =>
        graph.invoke({
          data: input.data,
          jobId: input.jobId,
          graphRunId,
          externalMessageId,
          aiRun: activeAttempt,
          runtimeInput: begun.input,
          expectedCorpusKind: "LEGACY_V1",
          normalizedText: "",
          conversation: undefined,
          messages: [],
          knowledgeRetrieval: undefined,
          retrievedContext: [],
          intent: undefined,
          extraction: undefined,
          aiReply: undefined,
          groundedAnswer: undefined,
          recommendation: undefined,
          quality: undefined,
          toolCalls: [],
          toolResults: [],
          result: undefined,
        }),
    );

    if (!state.result) {
      throw new Error(`AI graph ${graphRunId} finished without a result.`);
    }

    recordAiGraphRun({
      source: input.data.source,
      status: state.result.status,
      handoffRequired: state.result.handoffRequired ?? false,
      qualityReason:
        state.result.qualityReason ??
        (state.result.status === "duplicate" ? "duplicate" : undefined),
      qualityPassed: state.result.qualityPassed ?? state.result.status === "duplicate",
      durationMs: Date.now() - startedAt,
    });
    return state.result;
  } catch (error) {
    if (
      error instanceof AiReplyFenceError &&
      (error.code === "AI_REPLY_RUN_SUPERSEDED" || error.code === "AI_REPLY_NEWER_INBOUND") &&
      attempt
    ) {
      const result: AiReplyGraphResult = {
        status: "duplicate",
        conversationId: input.data.conversationId,
        messageId: attempt.inboundMessageId,
        graphRunId: `langgraph:${attempt.runId}`,
        qualityReason: "superseded",
        qualityPassed: false,
      };
      recordAiGraphRun({
        source: input.data.source,
        status: result.status,
        handoffRequired: false,
        qualityReason: result.qualityReason,
        qualityPassed: false,
        durationMs: Date.now() - startedAt,
      });
      return result;
    }
    if (attempt) {
      const message =
        error instanceof Error ? redactSensitiveText(error.message) : "AI reply attempt failed";
      await markAiReplyAttemptFailed(attempt, message, input.signal?.aborted ?? false).catch(
        () => undefined,
      );
    }
    recordAiGraphRun({
      source: input.data.source,
      status: "failed",
      handoffRequired: true,
      qualityReason: "failed",
      qualityPassed: false,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
