import { createHash, randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { ChannelAdapter } from "@leadvirt/integrations";
import {
  admitKnowledgeV2ProcessorQuery,
  createKnowledgeV2QueryHashKeyring,
  knowledgeLiveToolQueryHash,
  knowledgeLiveToolSubjectHash,
  loadKnowledgeOperationalCapabilityProjectionV1,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  type KnowledgeRuntimeRetriever,
  type KnowledgeV2GroundedAnswerService,
} from "@leadvirt/knowledge";
import type { ChannelSendMessageJobData } from "@leadvirt/types";
import { automaticReplyChannelFingerprint } from "@leadvirt/runtime-queue";
import {
  deliverChannelMessage,
  type ChannelDeliveryKnowledgeDependencies,
} from "../../apps/worker/src/channels/channel-delivery.js";
import { localizedKnowledgeHandoffReply } from "../../apps/worker/src/ai/ai-reply-graph.js";
import { knowledgeHandoffReplyV1 } from "../../apps/worker/src/ai/ai-reply-outcome.js";

loadEnvFile();

const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: "structured-delivery-query-key-v1",
  keys: { "structured-delivery-query-key-v1": new Uint8Array(32).fill(89) },
});
const structuredCapabilitySetHash = "3".repeat(64);
const structuredRequirementEvaluationSetHash = "4".repeat(64);

const customerIdentity = {
  id: "customer-identity-structured-delivery",
  version: 1 as const,
  subjectHash: "7".repeat(64),
  attestationHash: "8".repeat(64),
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

class DeliveryVerifier {
  evidenceCalls = 0;
  processorCalls = 0;
  processorAllowed = true;
  readonly queries: string[] = [];
  providerCalls = 0;

  private readonly adapter: ChannelAdapter = {
    type: "WEBHOOK",
    normalizeInbound: async () => {
      throw new Error("Inbound normalization is not used by this smoke.");
    },
    sendMessage: async (input) => {
      this.providerCalls += 1;
      const operationId = input.metadata?.deliveryOperationId;
      return {
        externalMessageId: `structured-test:${
          typeof operationId === "string" ? operationId : this.providerCalls
        }`,
        status: "sent",
      };
    },
  };

  dependencies(): ChannelDeliveryKnowledgeDependencies {
    return {
      knowledgeRetriever: {
        revalidatePersistedReply: (
          input: Parameters<KnowledgeRuntimeRetriever["revalidatePersistedReply"]>[0],
        ) => {
          this.evidenceCalls += 1;
          this.queries.push(input.query);
          return Promise.resolve({
            valid: true,
            reason: "VALID" as const,
            evidenceManifestHash: "9".repeat(64),
            promptPolicyVersion: "grounded-answer-v1",
            classifications: ["CUSTOMER_PERSONAL" as const],
          });
        },
      } as unknown as KnowledgeRuntimeRetriever,
      groundedAnswer: {
        revalidateProcessorAdmission: () => {
          this.processorCalls += 1;
          return Promise.resolve(this.processorAllowed);
        },
      } as unknown as KnowledgeV2GroundedAnswerService,
      adapterFactory: () => this.adapter,
    };
  }
}

async function createReply(input: {
  tenantId: string;
  conversationId: string;
  publicationId: string;
  operationalBindingHash: string;
  operationalPermissionGeneration: number;
  sequence: number;
  suffix: string;
}) {
  const inbound = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: `Question ${input.sequence}`,
      status: "RECEIVED",
    },
  });
  const answer = "Support is available on weekdays.";
  const query = inbound.text ?? "";
  const queryHash = knowledgeLiveToolQueryHash({
    tenantId: input.tenantId,
    query,
    queryHashKeyring,
  });
  const processorQueryAdmission = admitKnowledgeV2ProcessorQuery(
    {
      tenantId: input.tenantId,
      query,
      classification: "CUSTOMER_PERSONAL",
    },
    queryHashKeyring,
  );
  assert(processorQueryAdmission.admitted, "Delivery query was not admitted.");
  const reply = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      senderType: "AI",
      text: answer,
      status: "QUEUED",
      metadata: { outboundStatus: "queued" },
    },
  });
  const createdRun = await prisma.aiReplyRun.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      inboundMessageId: inbound.id,
      replyMessageId: reply.id,
      publicationId: input.publicationId,
      capabilitySetHash: structuredCapabilitySetHash,
      operationalBindingHash: input.operationalBindingHash,
      operationalPermissionGeneration: input.operationalPermissionGeneration,
      capabilityType: "GENERAL_FAQ",
      allowedAutonomy: "ANSWER_ONLY",
      requiredAutonomy: "ANSWER_ONLY",
      capabilityDecision: "AUTHORIZED",
      idempotencyKey: `delivery:${input.suffix}:${input.sequence}`,
      inputHash: sha256(inbound.text ?? ""),
      generation: 1,
      sequence: input.sequence,
      status: "RUNNING",
      attemptCount: 1,
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
  const run = await prisma.aiReplyRun.update({
    where: { id: createdRun.id },
    data: {
      status: "SUCCEEDED",
      replyDisposition: "AUTO_SEND",
      replyContentHash: sha256(answer),
      replyTemplateVersion: null,
      completedAt: new Date(),
    },
  });
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { aiGeneration: 1, aiReplySequence: input.sequence, aiReplyFence: input.sequence },
  });
  const evidenceHash = "a".repeat(64);
  const executionKey = sha256(`live-tool:${input.suffix}:${input.sequence}`);
  const toolResultRef = `live:${executionKey}`;
  const observedAt = new Date(Date.now() - 1_000);
  const expiresAt = new Date(Date.now() + 60_000);
  const authorizationExpiresAt = new Date(Date.now() + 120_000);
  const [authorizationState, conversation] = await Promise.all([
    prisma.tenantOperationalAuthorizationState.findUniqueOrThrow({
      where: { tenantId: input.tenantId },
    }),
    prisma.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { leadId: true, channelId: true, externalConversationId: true },
    }),
  ]);
  await prisma.knowledgeV2LiveToolExecution.create({
    data: {
      id: toolResultRef,
      executionKey,
      tenantId: input.tenantId,
      aiReplyRunId: run.id,
      conversationId: input.conversationId,
      originatingMessageId: inbound.id,
      leadId: conversation.leadId,
      executionContextId: `langgraph:${run.id}`,
      attemptNumber: run.attemptCount,
      toolCallId: `delivery:${input.sequence}`,
      toolKey: "availability.lookup",
      toolVersion: "smoke-v1",
      safeName: "Availability lookup",
      sourceSystem: "smoke.fixture",
      operationalCategory: "AVAILABILITY",
      toolPolicyVersion: "smoke-v1",
      queryHash: queryHash.hash,
      queryHashKeyId: queryHash.keyId,
      queryHashVersion: queryHash.version,
      requestHash: sha256(`request:${input.suffix}:${input.sequence}`),
      authorizationScopeHash: sha256(`scope:${input.suffix}:${input.sequence}`),
      authorizationDecisionId: `auth:${sha256(`decision:${input.suffix}:${input.sequence}`)}`,
      permissionGeneration: authorizationState.permissionGeneration,
      subjectHash: knowledgeLiveToolSubjectHash({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        leadId: conversation.leadId,
        channelId: conversation.channelId,
        externalConversationId: conversation.externalConversationId,
        customerIdentity,
      }),
      resultType: "availability.status",
      valueHash: sha256("available"),
      exactValueHash: sha256("available"),
      contentHash: sha256("Support is available."),
      envelopeHash: sha256(`envelope:${input.suffix}:${input.sequence}`),
      payloadObjectKey: `smoke/live-tool/${executionKey}.enc`,
      payloadEncryptionKeyRef: "smoke-key-v1",
      payloadHash: sha256(`payload:${input.suffix}:${input.sequence}`),
      payloadBytes: 1,
      observedAt,
      expiresAt,
      authorizedAt: observedAt,
      authorizationExpiresAt,
      retentionExpiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const evidence = await prisma.knowledgeV2EvidenceReference.create({
    data: {
      tenantId: input.tenantId,
      corpusKind: "STRUCTURED_V2",
      evidenceKey: `v2:tool:availability-${input.sequence}:${evidenceHash}`,
      targetType: "TOOL_RESULT",
      toolResultRef,
      safeLabel: "availability.lookup",
      isPublic: false,
      observedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const trace = await prisma.knowledgeV2RetrievalTrace.create({
    data: {
      tenantId: input.tenantId,
      corpusKind: "STRUCTURED_V2",
      traceKey: sha256(`trace:${input.suffix}:${input.sequence}`),
      distributedTraceId: `langgraph:delivery:${input.suffix}:${input.sequence}`,
      snapshotKind: "PUBLICATION",
      targetKey: "workspace-v2",
      publicationId: input.publicationId,
      responseMessageId: reply.id,
      queryHash: queryHash.hash,
      queryHashKeyId: queryHash.keyId,
      queryHashVersion: queryHash.version,
      restrictedQueryRef: `restricted-query-${input.sequence}`,
      filters: {
        locale: "en",
        channelType: "WEBHOOK",
        audience: "PUBLIC",
        classifications: ["PUBLIC"],
        queryClassification: "CUSTOMER_PERSONAL",
        queryHash,
        processorQueryAdmission:
          projectKnowledgeV2ProcessorQueryAdmissionBinding(processorQueryAdmission),
      },
      filtersHash: "c".repeat(64),
      permissionFingerprint: "d".repeat(64),
      candidateCount: 1,
      selectedCount: 1,
      retrievalPolicyVersion: "structured-v2-v1",
      retrievalProcessorPolicyHash: "e".repeat(64),
      modelProcessorPolicyHash: "1".repeat(64),
      rerankerVersion: "reranker-v1",
      promptPolicyVersion: "grounded-answer-v1",
      graphVersion: "ai-reply-graph-v2",
      provider: "smoke-grounded",
      generatorModel: "grounded-v1",
      providerOutputHash: "2".repeat(64),
      gateInputHash: "3".repeat(64),
      gateResultHash: "4".repeat(64),
      outcome: "ANSWERED",
      gateOutcome: "AUTO_SEND",
      answerHash: sha256(answer),
      restrictedTraceRef: `restricted-answer-${input.sequence}`,
      retrievalCandidateManifestHash: "5".repeat(64),
      citationManifestHash: "6".repeat(64),
      retentionClass: "runtime-v1",
      retentionExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.knowledgeV2Citation.create({
    data: {
      tenantId: input.tenantId,
      corpusKind: "STRUCTURED_V2",
      citationKey: sha256(`citation:${input.suffix}:${input.sequence}`),
      retrievalTraceId: trace.id,
      evidenceReferenceId: evidence.id,
      ordinal: 0,
      claimHash: sha256(answer),
      support: "SUPPORTS",
    },
  });
  await prisma.message.update({
    where: { id: reply.id },
    data: {
      metadata: {
        outboundStatus: "queued",
        retrievalTraceId: trace.id,
        groundedAnswer: {
          disposition: "AUTO_SEND",
          provider: "smoke-grounded",
          model: "grounded-v1",
          providerVersion: "2026-07-13",
          region: "eu-west",
          processorPolicyVersion: "model-policy-v1",
          processorPolicyHash: "1".repeat(64),
          promptPolicyVersion: "grounded-answer-v1",
          providerOutputHash: "2".repeat(64),
          gateInputHash: "3".repeat(64),
          gateResultHash: "4".repeat(64),
          evidenceManifestHash: "9".repeat(64),
          citationKeys: [evidence.evidenceKey],
          requiresLiveEvidence: true,
        },
      },
    },
  });
  const data: ChannelSendMessageJobData = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    messageId: reply.id,
    source: "webhook",
    graphRunId: trace.distributedTraceId,
    triggerMessageId: inbound.id,
    aiReplyRunId: run.id,
    aiReplyGeneration: run.generation,
    aiReplySequence: run.sequence,
    requestedAt: new Date().toISOString(),
  };
  return { data, inbound, reply, run, trace };
}

async function createHandoffReply(input: {
  tenantId: string;
  conversationId: string;
  publicationId: string;
  operationalBindingHash: string;
  operationalPermissionGeneration: number;
  sequence: number;
  suffix: string;
  authorized?: boolean;
}) {
  const handoffTemplate = knowledgeHandoffReplyV1("en");
  const inbound = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: `Handoff question ${input.sequence}`,
      status: "RECEIVED",
    },
  });
  const reply = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      senderType: "AI",
      text: handoffTemplate.text,
      status: "QUEUED",
      metadata: {
        outboundStatus: "queued",
        intent: "knowledge_handoff",
        quality: { passed: false, handoffRequired: true },
      },
    },
  });
  const createdRun = await prisma.aiReplyRun.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      inboundMessageId: inbound.id,
      replyMessageId: reply.id,
      publicationId: input.publicationId,
      capabilitySetHash: structuredCapabilitySetHash,
      operationalBindingHash: input.operationalBindingHash,
      operationalPermissionGeneration: input.operationalPermissionGeneration,
      capabilityType: input.authorized ? "GENERAL_FAQ" : null,
      allowedAutonomy: input.authorized ? "ANSWER_ONLY" : null,
      requiredAutonomy: "ANSWER_ONLY",
      capabilityDecision: input.authorized ? "AUTHORIZED" : "HANDOFF",
      idempotencyKey: `delivery-handoff:${input.suffix}:${input.sequence}`,
      inputHash: sha256(inbound.text ?? ""),
      generation: 1,
      sequence: input.sequence,
      status: "RUNNING",
      attemptCount: 1,
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
  const run = await prisma.aiReplyRun.update({
    where: { id: createdRun.id },
    data: {
      status: "SUCCEEDED",
      replyDisposition: "HANDOFF",
      replyContentHash: sha256(handoffTemplate.text),
      replyTemplateVersion: handoffTemplate.templateVersion,
      completedAt: new Date(),
    },
  });
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      status: "WAITING_FOR_HUMAN",
      handoffRequested: true,
      aiGeneration: run.generation,
      aiReplySequence: run.sequence,
      aiReplyFence: run.sequence,
    },
  });
  const data: ChannelSendMessageJobData = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    messageId: reply.id,
    source: "webhook",
    graphRunId: `langgraph:${run.id}`,
    triggerMessageId: inbound.id,
    aiReplyRunId: run.id,
    aiReplyGeneration: run.generation,
    aiReplySequence: run.sequence,
    requestedAt: new Date().toISOString(),
  };
  return { data, inbound, reply, run };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Structured delivery smoke", slug: `structured-delivery-${suffix}` },
    });
    tenantId = tenant.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Structured delivery webhook",
        externalId: `structured-delivery-${suffix}`,
        publicKey: `demo-structured-delivery-${suffix}`,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "Structured delivery lead",
        source: "smoke",
        channelType: "WEBHOOK",
        status: "NEW",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: `webhook:${suffix}`,
        status: "OPEN",
        aiEnabled: true,
      },
    });
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Structured delivery authorization generation is missing.",
    );
    const operationalBinding = {
      operationalBindingSchemaVersion: operationalProjection.schemaVersion,
      operationalRegistryVersion: operationalProjection.registryVersion,
      operationalRegistryHash: operationalProjection.registryHash,
      operationalDependencySetHash: operationalProjection.dependencySetHash,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
    };
    const capability = await prisma.knowledgeV2Capability.create({
      data: {
        tenantId: tenant.id,
        capabilityType: "GENERAL_FAQ",
        enabled: true,
        templateKey: "structured-delivery-general-faq-v1",
      },
    });
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "7".repeat(64),
        capabilitySetHash: structuredCapabilitySetHash,
        requirementEvaluationSetHash: structuredRequirementEvaluationSetHash,
        ...operationalBinding,
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "structured-v2-v1",
        promptPolicyVersion: "grounded-answer-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const validation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        candidateId: "workspace-v2",
        candidateVersion: 1,
        candidateManifestHash: publication.manifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash: structuredCapabilitySetHash,
        requirementEvaluationSetHash: structuredRequirementEvaluationSetHash,
        ...operationalBinding,
        validationPolicyVersion: "structured-delivery-smoke-v1",
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: capability.id,
        capabilityType: capability.capabilityType,
        allowedAutonomy: capability.allowedAutonomy,
        capabilityEtag: capability.etag,
        capabilitySnapshotHash: "5".repeat(64),
        requirementEvaluationSetHash: "6".repeat(64),
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: publication.id,
        sequence: publication.sequence,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeCorpusSelector.create({
        data: {
          tenantId: tenant.id,
          corpusKind: "STRUCTURED_V2",
          generation: 1,
          migrationId: `structured-delivery-${suffix}`,
        },
      });
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesPublicationId: publication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesCapabilitySetHash: structuredCapabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(channel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: `structured-delivery-${suffix}`,
      },
    });

    const first = await createReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 1,
      suffix,
    });
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Newer question that must not replace the trigger",
        status: "RECEIVED",
      },
    });
    const verifier = new DeliveryVerifier();
    const jobId = `channel-send-${first.reply.id}`;
    const sent = await deliverChannelMessage(first.data, jobId, undefined, verifier.dependencies());
    assert(sent.status === "sent", "Structured reply was not delivered.");
    assert(
      verifier.evidenceCalls === 2 && verifier.processorCalls === 2,
      "Delivery was not revalidated twice.",
    );
    assert(
      verifier.queries.length === 2 && verifier.queries.every((query) => query === "Question 1"),
      "Structured delivery revalidated against a newer inbound message.",
    );
    const duplicate = await deliverChannelMessage(
      first.data,
      jobId,
      undefined,
      verifier.dependencies(),
    );
    assert(duplicate.status === "already_delivered", "Duplicate delivery was not deduplicated.");
    const operation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: first.reply.id },
    });
    assert(operation.attemptCount === 1, "Duplicate delivery called the provider twice.");

    const second = await createReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 2,
      suffix,
    });
    const missingTriggerVerifier = new DeliveryVerifier();
    const missingTrigger = await deliverChannelMessage(
      { ...second.data, triggerMessageId: undefined },
      `channel-send-${second.reply.id}`,
      undefined,
      missingTriggerVerifier.dependencies(),
    );
    assert(
      missingTrigger.status === "skipped" &&
        missingTrigger.reason === "structured_delivery_trigger_missing" &&
        missingTriggerVerifier.evidenceCalls === 0 &&
        missingTriggerVerifier.processorCalls === 0,
      "Missing structured trigger did not fail closed before revalidation.",
    );
    assert(
      (await prisma.channelDeliveryOperation.count({ where: { messageId: second.reply.id } })) ===
        0,
      "Missing trigger created a provider operation.",
    );

    const third = await createReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 3,
      suffix,
    });
    const wrongInbound = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Wrong trigger message",
        status: "RECEIVED",
      },
    });
    const wrongTriggerVerifier = new DeliveryVerifier();
    const wrongTrigger = await deliverChannelMessage(
      { ...third.data, triggerMessageId: wrongInbound.id },
      `channel-send-${third.reply.id}`,
      undefined,
      wrongTriggerVerifier.dependencies(),
    );
    assert(
      wrongTrigger.status === "skipped" &&
        wrongTrigger.reason === "structured_delivery_trigger_mismatch" &&
        wrongTriggerVerifier.evidenceCalls === 0 &&
        wrongTriggerVerifier.processorCalls === 0,
      "Wrong structured trigger did not fail closed before revalidation.",
    );
    assert(
      (await prisma.channelDeliveryOperation.count({ where: { messageId: third.reply.id } })) === 0,
      "Wrong trigger created a provider operation.",
    );

    const fourth = await createReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 4,
      suffix,
    });
    const revoked = new DeliveryVerifier();
    revoked.processorAllowed = false;
    const denied = await deliverChannelMessage(
      fourth.data,
      `channel-send-${fourth.reply.id}`,
      undefined,
      revoked.dependencies(),
    );
    assert(
      denied.status === "skipped" && denied.reason === "structured_delivery_model_policy_revoked",
      "Delivery-time policy revocation did not fail closed.",
    );
    assert(
      (await prisma.channelDeliveryOperation.count({ where: { messageId: fourth.reply.id } })) ===
        0,
      "Denied delivery created a provider operation.",
    );

    const handoff = await createHandoffReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 5,
      suffix,
    });
    const deliveredHandoff = await deliverChannelMessage(
      handoff.data,
      `channel-send-${handoff.reply.id}`,
      undefined,
      new DeliveryVerifier().dependencies(),
    );
    assert(
      deliveredHandoff.status === "sent" &&
        handoff.reply.text === localizedKnowledgeHandoffReply("en"),
      "A completed structured HANDOFF run did not deliver its localized reply.",
    );
    const persistedHandoff = await prisma.message.findUniqueOrThrow({
      where: { id: handoff.reply.id },
    });
    const persistedHandoffMetadata =
      typeof persistedHandoff.metadata === "object" &&
      persistedHandoff.metadata !== null &&
      !Array.isArray(persistedHandoff.metadata)
        ? persistedHandoff.metadata
        : {};
    assert(
      !("groundedAnswer" in persistedHandoffMetadata) && persistedHandoff.status === "SENT",
      "HANDOFF delivery required or fabricated a grounded-answer audit.",
    );

    const groundedFailureHandoff = await createHandoffReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 6,
      suffix,
      authorized: true,
    });
    const deliveredGroundedFailureHandoff = await deliverChannelMessage(
      groundedFailureHandoff.data,
      `channel-send-${groundedFailureHandoff.reply.id}`,
      undefined,
      new DeliveryVerifier().dependencies(),
    );
    assert(
      deliveredGroundedFailureHandoff.status === "sent",
      "An authorized capability grounding failure did not deliver its handoff reply.",
    );

    const mismatchedHandoff = await createHandoffReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 7,
      suffix,
    });
    const deniedMismatchedHandoff = await deliverChannelMessage(
      { ...mismatchedHandoff.data, aiReplyRunId: handoff.run.id },
      `channel-send-${mismatchedHandoff.reply.id}`,
      undefined,
      new DeliveryVerifier().dependencies(),
    );
    assert(
      deniedMismatchedHandoff.status === "skipped" &&
        deniedMismatchedHandoff.reason === "ai_reply_delivery_identity_mismatch" &&
        (await prisma.channelDeliveryOperation.count({
          where: { messageId: mismatchedHandoff.reply.id },
        })) === 0,
      "HANDOFF delivery accepted a mismatched run identity.",
    );

    const revokedHandoff = await createHandoffReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      publicationId: publication.id,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
      sequence: 8,
      suffix,
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: { settings: { deliveryMode: "revoked" } },
    });
    const deniedHandoff = await deliverChannelMessage(
      revokedHandoff.data,
      `channel-send-${revokedHandoff.reply.id}`,
      undefined,
      new DeliveryVerifier().dependencies(),
    );
    assert(
      deniedHandoff.status === "skipped" &&
        deniedHandoff.reason === "ai_reply_automatic_reply_admission_revoked",
      "HANDOFF delivery ignored a revoked channel or operational binding.",
    );
    const deniedHandoffOperation = await prisma.channelDeliveryOperation.findFirstOrThrow({
      where: { messageId: revokedHandoff.reply.id },
    });
    assert(
      deniedHandoffOperation.status === "RECONCILED" &&
        deniedHandoffOperation.providerMessageId === null &&
        deniedHandoffOperation.errorCode === "ai_reply_automatic_reply_admission_revoked",
      "Revoked HANDOFF delivery reached the provider.",
    );
    console.log(
      JSON.stringify({
        ok: true,
        deliveryRevalidations: verifier.evidenceCalls,
        processorRevalidations: verifier.processorCalls,
        duplicateStatus: duplicate.status,
        providerAttempts: operation.attemptCount,
        exactTriggerQueries: verifier.queries,
        missingTriggerStatus: missingTrigger.status,
        wrongTriggerStatus: wrongTrigger.status,
        revokedStatus: denied.status,
        handoffStatus: deliveredHandoff.status,
        groundedFailureHandoffStatus: deliveredGroundedFailureHandoff.status,
        mismatchedHandoffStatus: deniedMismatchedHandoff.status,
        revokedHandoffStatus: deniedHandoff.status,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.knowledgeV2Citation.deleteMany({ where: { tenantId } });
        await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId } });
        await tx.knowledgeV2RetrievalTrace.deleteMany({ where: { tenantId } });
        await tx.knowledgeV2LiveToolExecution.deleteMany({ where: { tenantId } });
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
