import { createHash, randomUUID } from "node:crypto";
import type {
  AiProvider,
  GroundedAnswerProcessorAuthorizer,
  GroundedAnswerProvider,
} from "@leadvirt/ai";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";
import {
  admitKnowledgeV2ProcessorQuery,
  classifyOperationalQuery,
  createKnowledgeV2QueryHashKeyring,
  knowledgeLiveToolQueryHash,
  knowledgeOperationalRequirementHash,
  KnowledgeV2GroundedAnswerService,
  KnowledgeV2GroundedOutputPolicy,
  loadKnowledgeOperationalCapabilityProjectionV1,
  projectKnowledgeV2ProcessorQueryAdmissionBinding,
  type KnowledgeEvidenceBundle,
  type KnowledgeRuntimeRetriever,
} from "@leadvirt/knowledge";
import {
  automaticReplyAdmissionReasons,
  automaticReplyAdmissionState,
  automaticReplyChannelFingerprint,
  createAiReplyQueueEvent,
  parseRuntimeQueueEnvelope,
} from "@leadvirt/runtime-queue";
import type { AiReplyJobData } from "@leadvirt/types";
import { runAiReplyGraph } from "../../apps/worker/src/ai/ai-reply-graph.js";
import { beginAiReplyAttempt } from "../../apps/worker/src/ai/ai-reply-reliability.js";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
  activeKeyId: "capability-runtime-smoke-v1",
  keys: { "capability-runtime-smoke-v1": new Uint8Array(32).fill(41) },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface RuntimeLocaleCase {
  locale: string;
  faq: string;
  handoff: string;
  disabled: Readonly<Record<string, string>>;
}

const runtimeLocaleCases: readonly RuntimeLocaleCase[] = [
  {
    locale: "en",
    faq: "What are your business hours?",
    handoff: "I want to speak to a human.",
    disabled: {
      qualification: "Am I eligible for this service?",
      pricing: "How much does it cost?",
      discovery: "What appointment times are available?",
      booking: "Please book an appointment for tomorrow.",
      order: "Where is my order?",
      account: "I forgot my account password.",
      commerce: "Which product should I choose?",
      regulated: "Can you diagnose these symptoms?",
    },
  },
  {
    locale: "ru",
    faq: "Какие у вас часы работы?",
    handoff: "Соедините меня с оператором.",
    disabled: {
      qualification: "Подхожу ли я для этой услуги?",
      pricing: "Сколько это стоит?",
      discovery: "Какие окна доступны для записи?",
      booking: "Запишите меня на завтра.",
      order: "Где мой заказ?",
      account: "Я забыл пароль от аккаунта.",
      commerce: "Какой товар мне выбрать?",
      regulated: "Можете поставить диагноз по этим симптомам?",
    },
  },
  {
    locale: "es",
    faq: "¿Cuál es su horario comercial?",
    handoff: "Quiero hablar con una persona.",
    disabled: {
      qualification: "¿Soy elegible para este servicio?",
      pricing: "¿Cuánto cuesta?",
      discovery: "¿Qué horarios están libres?",
      booking: "Quiero reservar una cita.",
      order: "¿Dónde está mi pedido?",
      account: "Olvidé la contraseña de mi cuenta.",
      commerce: "¿Qué producto debo elegir?",
      regulated: "¿Puede diagnosticar estos síntomas?",
    },
  },
  {
    locale: "fr",
    faq: "Quels sont vos horaires d’ouverture ?",
    handoff: "Je veux parler à un humain.",
    disabled: {
      qualification: "Suis-je éligible à ce service ?",
      pricing: "Combien ça coûte ?",
      discovery: "Quels créneaux sont disponibles ?",
      booking: "Je veux prendre rendez-vous.",
      order: "Où est ma commande ?",
      account: "J’ai oublié le mot de passe de mon compte.",
      commerce: "Quel produit dois-je choisir ?",
      regulated: "Pouvez-vous diagnostiquer ces symptômes ?",
    },
  },
  {
    locale: "de",
    faq: "Was sind Ihre Öffnungszeiten?",
    handoff: "Ich möchte mit einem Menschen sprechen.",
    disabled: {
      qualification: "Bin ich für diesen Service berechtigt?",
      pricing: "Wie viel kostet das?",
      discovery: "Welche Termine sind verfügbar?",
      booking: "Ich möchte einen Termin buchen.",
      order: "Wo ist meine Bestellung?",
      account: "Ich habe mein Konto-Passwort vergessen.",
      commerce: "Welches Produkt soll ich wählen?",
      regulated: "Können Sie diese Symptome diagnostizieren?",
    },
  },
  {
    locale: "pt",
    faq: "Qual é o horário de funcionamento?",
    handoff: "Quero falar com uma pessoa.",
    disabled: {
      qualification: "Sou elegível para este serviço?",
      pricing: "Quanto custa?",
      discovery: "Quais horários estão livres?",
      booking: "Quero agendar uma consulta.",
      order: "Onde está meu pedido?",
      account: "Esqueci a senha da minha conta.",
      commerce: "Qual produto devo escolher?",
      regulated: "Pode diagnosticar estes sintomas?",
    },
  },
];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function admissionFromRows(
  tenantId: string,
  conversationId: string,
  rows: readonly unknown[],
) {
  let call = 0;
  const tx = {
    $queryRaw: () => Promise.resolve(rows[call++] ?? []),
  } as unknown as Prisma.TransactionClient;
  return automaticReplyAdmissionState(tx, { tenantId, conversationId });
}

class RejectingLegacyProvider implements AiProvider {
  calls = 0;
  readonly providerName = "legacy-must-not-run";
  readonly modelName = "legacy-must-not-run";

  private reject(): never {
    this.calls += 1;
    throw new Error("Legacy provider was called for a structured capability scenario.");
  }

  generateReply() {
    return Promise.reject(this.reject());
  }

  extractLeadFields() {
    return Promise.reject(this.reject());
  }

  summarizeConversation() {
    return Promise.reject(this.reject());
  }

  classifyIntent() {
    return Promise.reject(this.reject());
  }

  recommendNextAction() {
    return Promise.reject(this.reject());
  }
}

class CountingGroundedProvider implements GroundedAnswerProvider {
  calls = 0;
  readonly identity = {
    provider: "capability-smoke",
    model: "capability-smoke-v1",
    version: "1",
    region: "local",
  };

  constructor(
    private readonly answer: string,
    private readonly evidenceKey: string,
  ) {}

  generate() {
    this.calls += 1;
    return Promise.resolve({
      schemaVersion: 1 as const,
      claims: [
        {
          claimId: "claim-1",
          text: this.answer,
          evidenceKeys: [this.evidenceKey],
          exactValueText: null,
        },
      ],
      citations: [{ claimId: "claim-1", evidenceKey: this.evidenceKey }],
    });
  }
}

class ApprovedProcessor implements GroundedAnswerProcessorAuthorizer {
  authorize() {
    return Promise.resolve({
      provider: "capability-smoke",
      model: "capability-smoke-v1",
      version: "1",
      region: "local",
      policyVersion: "capability-smoke-v1",
      policyHash: "7".repeat(64),
      promptPolicyVersion: "capability-smoke-v1",
    });
  }
}

function evidenceBundle(input: {
  tenantId: string;
  publicationId: string;
  question: string;
  evidenceKey: string;
  answer: string;
}): KnowledgeEvidenceBundle {
  const queryHash = knowledgeLiveToolQueryHash({
    tenantId: input.tenantId,
    query: input.question,
    queryHashKeyring,
  });
  const classification = classifyOperationalQuery(input.question);
  const admission = admitKnowledgeV2ProcessorQuery(
    { tenantId: input.tenantId, query: input.question, classification: "PUBLIC" },
    queryHashKeyring,
  );
  assert(admission.admitted, "Static FAQ query was not admitted for grounded processing.");
  return {
    schemaVersion: 1,
    corpusKind: "STRUCTURED_V2",
    target: {
      corpusKind: "STRUCTURED_V2",
      snapshotKind: "PUBLICATION",
      targetKey: "workspace-v2",
      publicationId: input.publicationId,
      publicationSequence: 1,
      publicationManifestHash: "a".repeat(64),
      indexSnapshotId: null,
      retrievalPolicyVersion: "capability-smoke-v1",
      promptPolicyVersion: "capability-smoke-v1",
      pipelineVersion: "capability-smoke-v1",
    },
    outcome: "ANSWERED",
    gateOutcome: "AUTO_SEND",
    gateReasons: ["EVIDENCE_READY"],
    facts: [
      {
        kind: "FACT",
        evidenceKey: input.evidenceKey,
        factId: "capability-smoke-fact",
        versionId: "capability-smoke-version",
        versionHash: sha256(input.answer),
        safeLabel: "Support information",
        value: input.answer,
        valueHash: sha256(input.answer),
        riskLevel: "LOW",
        authority: "OWNER_VERIFIED",
        verificationStatus: "VERIFIED",
        score: 1,
      },
    ],
    guidance: [],
    documents: [],
    conflicts: [],
    missingSupport: [],
    suppressedEvidence: [],
    citations: [],
    liveToolResults: [],
    answerPolicy: {
      requirementHash: knowledgeOperationalRequirementHash({ queryHash, classification }),
      operationalCategory: classification.category,
      queryHash,
      processorQueryAdmission: projectKnowledgeV2ProcessorQueryAdmissionBinding(admission),
      requiresLiveEvidence: false,
      staticEvidenceMayAnswer: true,
      allowAutoSend: true,
    },
  };
}

function countingRetriever(bundle: KnowledgeEvidenceBundle) {
  const state = { calls: 0, revalidations: 0 };
  const retriever = {
    retrieve: () => {
      state.calls += 1;
      return Promise.resolve({
        status: "grounded" as const,
        bundle,
        diagnostics: {
          backend: "database" as const,
          corpusKind: "STRUCTURED_V2" as const,
          candidateCount: 1,
          hydratedCount: 1,
          selectedCount: 1,
          durationMs: 1,
          retrievalPolicyVersion: "capability-smoke-v1",
          rerankerVersion: null,
        },
      });
    },
    revalidateEvidence: () => {
      state.revalidations += 1;
      return Promise.resolve({
        valid: true,
        reason: "VALID" as const,
        evidenceManifestHash: "8".repeat(64),
      });
    },
  } as unknown as KnowledgeRuntimeRetriever;
  return { retriever, state };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const capabilitySetHash = "c".repeat(64);
  const requirementEvaluationSetHash = "e".repeat(64);
  const tenant = await prisma.tenant.create({
    data: {
      name: "Capability runtime smoke",
      slug: `capability-runtime-${suffix}`,
      settings: { defaultLocale: "en" },
    },
  });

  try {
    const baseSettings = { deliveryMode: "managed", webhookConfigured: true };
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Capability runtime channel",
        publicKey: `capability-runtime-${suffix}`,
        settings: baseSettings,
      },
    });
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Operational permission generation is missing.",
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
        targetKey: "workspace-v2",
        enabled: true,
        allowedAutonomy: "ANSWER_ONLY",
        templateKey: "general-faq-v1",
      },
    });
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: "a".repeat(64),
        pipelineVersion: "capability-smoke-v1",
        retrievalPolicyVersion: "capability-smoke-v1",
        promptPolicyVersion: "capability-smoke-v1",
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const validation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        candidateId: `capability-runtime-${suffix}`,
        candidateVersion: 1,
        candidateManifestHash: publication.manifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        validationPolicyVersion: "capability-smoke-v1",
        evaluatedAt: new Date(),
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
        capabilitySnapshotHash: "f".repeat(64),
        requirementEvaluationSetHash,
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
          generation: 2,
          migrationId: `capability-runtime-${suffix}`,
        },
      });
    });

    const channelFingerprint = automaticReplyChannelFingerprint(channel);
    const activatedAt = new Date();
    const conversationRow = {
      id: `mock-conversation-${suffix}`,
      channelId: channel.id,
      status: "OPEN",
      aiEnabled: true,
      handoffRequested: false,
    };
    const activatedChannelRow = {
      ...channel,
      automaticRepliesEnabled: true,
      automaticRepliesGeneration: 2,
      automaticRepliesPublicationId: publication.id,
      automaticRepliesPublicationEtag: pointer.etag,
      automaticRepliesCapabilitySetHash: capabilitySetHash,
      automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
      automaticRepliesOperationalPermissionGeneration:
        operationalProjection.permissionGeneration,
      automaticRepliesChannelFingerprint: channelFingerprint,
      automaticRepliesActivatedAt: activatedAt,
      automaticRepliesActivatedByUserId: `actor-${suffix}`,
    };
    const selectorRows = [{ corpusKind: "STRUCTURED_V2" }];
    const pointerRows = [{ publicationId: publication.id, etag: pointer.etag }];
    const publicationRow = {
      id: publication.id,
      tenantId: tenant.id,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      status: "ACTIVE",
      capabilitySetHash,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
    };

    const missingChannelHash = await admissionFromRows(tenant.id, conversationRow.id, [
      [conversationRow],
      [{ ...activatedChannelRow, automaticRepliesCapabilitySetHash: null }],
    ]);
    assert(
      !missingChannelHash.admitted &&
        missingChannelHash.reason === automaticReplyAdmissionReasons.channelBindingIncomplete,
      "Admission did not reject a missing channel capability-set hash.",
    );
    const missingPublicationHash = await admissionFromRows(tenant.id, conversationRow.id, [
      [conversationRow],
      [activatedChannelRow],
      selectorRows,
      pointerRows,
      [{ ...publicationRow, capabilitySetHash: null }],
    ]);
    assert(
      !missingPublicationHash.admitted &&
        missingPublicationHash.reason === automaticReplyAdmissionReasons.activePublicationInvalid,
      "Admission did not reject a missing publication capability-set hash.",
    );
    const mismatchedHash = await admissionFromRows(tenant.id, conversationRow.id, [
      [conversationRow],
      [{ ...activatedChannelRow, automaticRepliesCapabilitySetHash: "d".repeat(64) }],
      selectorRows,
      pointerRows,
      [publicationRow],
    ]);
    assert(
      !mismatchedHash.admitted &&
        mismatchedHash.reason === automaticReplyAdmissionReasons.capabilityBindingMismatch,
      "Admission did not reject mismatched capability-set hashes.",
    );

    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: publication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesCapabilitySetHash: capabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration:
          operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: channelFingerprint,
        automaticRepliesActivatedAt: activatedAt,
        automaticRepliesActivatedByUserId: `actor-${suffix}`,
      },
    });

    const createInbound = async (label: string, text: string) => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          channelId: channel.id,
          externalConversationId: `${label}-${suffix}`,
          status: "OPEN",
          aiEnabled: true,
        },
      });
      const inbound = await prisma.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text,
          status: "RECEIVED",
        },
      });
      return { conversation, inbound };
    };
    const enqueue = (fixture: Awaited<ReturnType<typeof createInbound>>) =>
      prisma.$transaction((tx) =>
        createAiReplyQueueEvent(tx, {
          tenantId: tenant.id,
          conversationId: fixture.conversation.id,
          triggerMessageId: fixture.inbound.id,
          text: fixture.inbound.text ?? "",
          source: "worker-test",
        }),
      );

    const fencedFixture = await createInbound("run-hash-drift", "Hello");
    const queued = await enqueue(fencedFixture);
    assert(queued.created, "Exact capability binding did not queue an AI reply.");
    let immutableBindingRejected = false;
    try {
      await prisma.aiReplyRun.update({
        where: { id: queued.run.id },
        data: { capabilitySetHash: "d".repeat(64) },
      });
    } catch {
      immutableBindingRejected = true;
    }
    assert(immutableBindingRejected, "The queued publication binding was mutable.");
    const fenced = await beginAiReplyAttempt(
      parseRuntimeQueueEnvelope(queued.event.payload).data as unknown as AiReplyJobData,
    );
    assert(fenced.disposition === "active", "The immutable exact binding was not admitted.");
    await prisma.aiReplyRun.update({
      where: { id: queued.run.id },
      data: { status: "SUPERSEDED", completedAt: new Date(), errorCode: "SMOKE_COMPLETED" },
    });

    const runScenario = async (label: string, question: string) => {
      const fixture = await createInbound(label, question);
      const answer = "Support information is available in this workspace.";
      const evidenceKey = `capability:${label}`;
      const retrieval = countingRetriever(
        evidenceBundle({
          tenantId: tenant.id,
          publicationId: publication.id,
          question,
          evidenceKey,
          answer,
        }),
      );
      const provider = new CountingGroundedProvider(answer, evidenceKey);
      const legacy = new RejectingLegacyProvider();
      const grounded = new KnowledgeV2GroundedAnswerService(
        provider,
        new ApprovedProcessor(),
        new KnowledgeV2GroundedOutputPolicy(),
        queryHashKeyring,
      );
      const result = await runAiReplyGraph({
        data: {
          tenantId: tenant.id,
          conversationId: fixture.conversation.id,
          triggerMessageId: fixture.inbound.id,
          source: "worker-test",
        },
        aiProvider: legacy,
        knowledgeRetriever: retrieval.retriever,
        groundedAnswer: grounded,
      });
      return { result, retrieval: retrieval.state, provider, legacy };
    };

    let disabledScenarioCount = 0;
    let handoffScenarioCount = 0;
    let faqScenarioCount = 0;
    for (const localeCase of runtimeLocaleCases) {
      for (const [route, question] of Object.entries(localeCase.disabled)) {
        const scenario = await runScenario(`${localeCase.locale}-${route}`, question);
        assert(
          scenario.result.handoffRequired && !scenario.result.qualityPassed,
          `${localeCase.locale}:${route} bypassed its disabled capability.`,
        );
        assert(
          scenario.retrieval.calls === 0 &&
            scenario.provider.calls === 0 &&
            scenario.legacy.calls === 0,
          `${localeCase.locale}:${route} reached retrieval or a provider while disabled.`,
        );
        disabledScenarioCount += 1;
      }

      const handoff = await runScenario(`${localeCase.locale}-handoff`, localeCase.handoff);
      assert(
        handoff.result.handoffRequired && !handoff.result.qualityPassed,
        `${localeCase.locale}:handoff did not request human handling.`,
      );
      assert(
        handoff.retrieval.calls === 0 && handoff.provider.calls === 0 && handoff.legacy.calls === 0,
        `${localeCase.locale}:handoff reached retrieval or a provider.`,
      );
      handoffScenarioCount += 1;

      const faq = await runScenario(`${localeCase.locale}-faq`, localeCase.faq);
      assert(
        faq.result.qualityPassed && !faq.result.handoffRequired,
        `${localeCase.locale}:FAQ did not proceed: ${faq.result.qualityReason ?? "unknown"}.`,
      );
      assert(
        faq.retrieval.calls === 1 && faq.provider.calls === 1 && faq.legacy.calls === 0,
        `${localeCase.locale}:FAQ did not use structured retrieval/provider exactly once.`,
      );
      faqScenarioCount += 1;
    }

    console.log(
      JSON.stringify({
        ok: true,
        missingChannelHashRejected: true,
        missingPublicationHashRejected: true,
        mismatchedHashRejected: true,
        existingRunBindingImmutable: true,
        locales: runtimeLocaleCases.map((item) => item.locale),
        disabledScenarios: disabledScenarioCount,
        handoffScenarios: handoffScenarioCount,
        enabledFaqScenarios: faqScenarioCount,
      }),
    );
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.tenant.deleteMany({ where: { id: tenant.id } });
    });
    await prisma.$disconnect();
  }
}

void main().catch(async (error: unknown) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
