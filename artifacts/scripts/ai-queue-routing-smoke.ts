import { Queue } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { loadKnowledgeOperationalCapabilityProjectionV1 } from "@leadvirt/knowledge";
import {
  automaticReplyAdmissionState,
  automaticReplyChannelFingerprint,
  bullMqConnectionFromRedisUrl,
} from "@leadvirt/runtime-queue";
import type { AiReplyJobData } from "@leadvirt/types";

loadEnvFile();

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6380";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const redisUrl = process.env.REDIS_URL;
let assertionCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  assertionCount += 1;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") {
    throw new Error(message);
  }
  return value;
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as { data?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }
  return requireValue(json.data, `${path} response has no data`);
}

async function waitForJob(
  queue: Queue<AiReplyJobData>,
  jobId: string,
  source: AiReplyJobData["source"],
  inboundSentinel: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await queue.getJob(jobId);
    if (job) {
      assert(Boolean(job), `Queued ai.reply job was not found: ${jobId}`);
      assert(
        job.data.source === source,
        `Expected ${jobId} source ${source}, got ${job.data.source}`,
      );
      assert(
        !Object.prototype.hasOwnProperty.call(job.data, "text"),
        `Queued ${jobId} retained a text property`,
      );
      assert(
        !JSON.stringify(job.data).includes(inboundSentinel),
        `Queued ${jobId} retained the inbound text`,
      );
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Queued ai.reply job was not found: ${jobId}`);
}

async function main() {
  const { prisma } = await import("@leadvirt/db");
  const queue = new Queue<AiReplyJobData>("ai.reply", {
    connection: bullMqConnectionFromRedisUrl(requireValue(redisUrl, "REDIS_URL is required"), {
      maxRetriesPerRequest: null,
    }),
  });
  await queue.pause();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: "AI Queue Routing Smoke",
      slug: `ai-queue-routing-${suffix}`,
      status: "TRIALING",
      businessType: "qa",
      timezone: "Europe/Moscow",
      settings: {},
    },
  });

  const publicKeys = {
    widget: `qa-widget-${suffix}`,
    webhook: `qa-webhook-${suffix}`,
    telegram: `qa-telegram-${suffix}`,
  };
  const createdJobIds: string[] = [];

  try {
    await prisma.channel.createMany({
      data: [
        {
          tenantId: tenant.id,
          type: "WEBSITE",
          status: "ACTIVE",
          name: "QA Website Widget",
          publicKey: publicKeys.widget,
          settings: { widget: { businessName: "QA Studio" } },
        },
        {
          tenantId: tenant.id,
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "QA Webhook",
          publicKey: publicKeys.webhook,
          settings: { webhook: { secret: "queue-secret" } },
        },
        {
          tenantId: tenant.id,
          type: "TELEGRAM",
          status: "ACTIVE",
          name: "QA Telegram",
          externalId: "qa-telegram-account",
          publicKey: publicKeys.telegram,
          settings: { telegram: { webhookSecret: "queue-secret" } },
        },
      ],
    });
    const capabilitySetHash = "c".repeat(64);
    const requirementEvaluationSetHash = "d".repeat(64);
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
        pipelineVersion: "ai-queue-routing-smoke-v1",
        retrievalPolicyVersion: "ai-queue-routing-smoke-v1",
        promptPolicyVersion: "ai-queue-routing-smoke-v1",
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
        candidateId: `ai-queue-routing-${suffix}`,
        candidateVersion: 1,
        candidateManifestHash: publication.manifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        capabilitySetHash,
        requirementEvaluationSetHash,
        ...operationalBinding,
        validationPolicyVersion: "ai-queue-routing-smoke-v1",
        evaluatedAt: new Date(),
      },
    });
    const capabilitySnapshot = await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: validation.id,
        capabilityId: capability.id,
        capabilityType: capability.capabilityType,
        allowedAutonomy: capability.allowedAutonomy,
        capabilityEtag: capability.etag,
        capabilitySnapshotHash: "e".repeat(64),
        requirementEvaluationSetHash,
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    assert(
      capabilitySnapshot.publicationId === publication.id &&
        capabilitySnapshot.capabilityType === "GENERAL_FAQ" &&
        capabilitySnapshot.allowedAutonomy === "ANSWER_ONLY",
      "Published capability snapshot does not match the active publication.",
    );
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
          migrationId: `ai-queue-routing-${suffix}`,
        },
      });
    });

    const channels = await prisma.channel.findMany({
      where: { tenantId: tenant.id },
      orderBy: { type: "asc" },
    });
    assert(channels.length === 3, `Expected three QA channels, received ${channels.length}.`);
    for (const channel of channels) {
      const channelFingerprint = automaticReplyChannelFingerprint(channel);
      const activated = await prisma.channel.update({
        where: { id: channel.id },
        data: {
          automaticRepliesEnabled: true,
          automaticRepliesGeneration: { increment: 1 },
          automaticRepliesPublicationId: publication.id,
          automaticRepliesPublicationEtag: pointer.etag,
          automaticRepliesChannelFingerprint: channelFingerprint,
          automaticRepliesCapabilitySetHash: capabilitySetHash,
          automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
          automaticRepliesOperationalPermissionGeneration:
            operationalProjection.permissionGeneration,
          automaticRepliesActivatedAt: new Date(),
          automaticRepliesActivatedByUserId: `qa-actor-${suffix}`,
        },
      });
      assert(
        activated.automaticRepliesEnabled &&
          activated.automaticRepliesPublicationId === publication.id &&
          activated.automaticRepliesPublicationEtag === pointer.etag &&
          activated.automaticRepliesCapabilitySetHash === capabilitySetHash &&
          activated.automaticRepliesOperationalBindingHash === operationalProjection.bindingHash &&
          activated.automaticRepliesOperationalPermissionGeneration ===
            operationalProjection.permissionGeneration &&
          activated.automaticRepliesChannelFingerprint === channelFingerprint,
        `${channel.type} automatic replies were not activated with the exact publication binding.`,
      );
    }

    const widgetInboundSentinel = `opaque-widget-${suffix}`;
    const widgetResponse = (await postJson(`/public/widget/${publicKeys.widget}/messages`, {
      sessionId: `session-${suffix}`,
      clientMessageId: `widget-message-${suffix}`,
      text: widgetInboundSentinel,
      customer: { name: "Queue Customer", email: "queue@example.com" },
    })) as {
      conversationId: string;
      ai: { replied: boolean; intent: string };
      messages: Array<{ id: string; senderType: string }>;
    };
    const widgetTriggerMessageId = requireValue(
      widgetResponse.messages.find((message) => message.senderType === "CUSTOMER")?.id,
      "Widget inbound message id was not returned",
    );
    const widgetAdmission = await prisma.$transaction((tx) =>
      automaticReplyAdmissionState(tx, {
        tenantId: tenant.id,
        conversationId: widgetResponse.conversationId,
      }),
    );
    assert(
      widgetAdmission.admitted,
      `Widget automatic-reply admission was rejected: ${JSON.stringify(widgetAdmission)}`,
    );
    assert(
      !widgetResponse.ai.replied && widgetResponse.ai.intent === "queued",
      `Widget did not return queued AI state: ${JSON.stringify(widgetResponse.ai)}`,
    );
    const widgetJobId = `ai-reply:${widgetResponse.conversationId}:${widgetTriggerMessageId}`;
    createdJobIds.push(widgetJobId);
    await waitForJob(queue, widgetJobId, "widget", widgetInboundSentinel);

    const webhookEventId = `webhook-event-${suffix}`;
    const webhookInboundSentinel = `opaque-webhook-${suffix}`;
    const webhookResponse = (await postJson(
      `/public/channels/webhook/${publicKeys.webhook}/events`,
      {
        eventId: webhookEventId,
        conversationId: `webhook-conversation-${suffix}`,
        customer: { id: `webhook-customer-${suffix}`, name: "Webhook Customer" },
        message: {
          id: `webhook-message-${suffix}`,
          text: webhookInboundSentinel,
          timestamp: new Date().toISOString(),
        },
      },
      { "x-leadvirt-webhook-secret": "queue-secret" },
    )) as {
      conversationId: string;
      inboundMessageId: string | null;
      aiMessageId: string | null;
      outboundStatus: string;
      reply: string | null;
    };
    const webhookAdmission = await prisma.$transaction((tx) =>
      automaticReplyAdmissionState(tx, {
        tenantId: tenant.id,
        conversationId: webhookResponse.conversationId,
      }),
    );
    assert(
      webhookAdmission.admitted,
      `Webhook automatic-reply admission was rejected: ${JSON.stringify(webhookAdmission)}`,
    );
    assert(
      webhookResponse.outboundStatus === "queued" &&
        webhookResponse.reply === null &&
        webhookResponse.aiMessageId === null,
      `Webhook did not return queued result: ${JSON.stringify(webhookResponse)}`,
    );
    const webhookJobId = `ai-reply:${webhookResponse.conversationId}:${requireValue(webhookResponse.inboundMessageId, "Webhook inbound id missing")}`;
    createdJobIds.push(webhookJobId);
    await waitForJob(queue, webhookJobId, "webhook", webhookInboundSentinel);

    const telegramUpdateId = Math.floor(Date.now() / 1000);
    const telegramInboundSentinel = `opaque-telegram-${suffix}`;
    const telegramResponse = (await postJson(
      `/public/channels/telegram/${publicKeys.telegram}/webhook`,
      {
        update_id: telegramUpdateId,
        message: {
          message_id: telegramUpdateId + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramUpdateId + 2 },
          from: { id: telegramUpdateId + 3, first_name: "Telegram", last_name: "Customer" },
          text: telegramInboundSentinel,
        },
      },
      { "x-telegram-bot-api-secret-token": "queue-secret" },
    )) as {
      conversationId: string;
      inboundMessageId: string | null;
      aiMessageId: string | null;
      outboundStatus: string;
      reply: string | null;
    };
    const telegramAdmission = await prisma.$transaction((tx) =>
      automaticReplyAdmissionState(tx, {
        tenantId: tenant.id,
        conversationId: telegramResponse.conversationId,
      }),
    );
    assert(
      telegramAdmission.admitted,
      `Telegram automatic-reply admission was rejected: ${JSON.stringify(telegramAdmission)}`,
    );
    assert(
      telegramResponse.outboundStatus === "queued" &&
        telegramResponse.reply === null &&
        telegramResponse.aiMessageId === null,
      `Telegram did not return queued result: ${JSON.stringify(telegramResponse)}`,
    );
    const telegramJobId = `ai-reply:${telegramResponse.conversationId}:${requireValue(telegramResponse.inboundMessageId, "Telegram inbound id missing")}`;
    createdJobIds.push(telegramJobId);
    await waitForJob(queue, telegramJobId, "telegram", telegramInboundSentinel);

    console.log(
      JSON.stringify(
        {
          ok: true,
          assertions: assertionCount,
          publishedCapability: capabilitySnapshot.capabilityType,
          activatedChannels: channels.map((channel) => channel.type),
          queuedJobs: createdJobIds,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const jobId of createdJobIds) {
      const job = await queue.getJob(jobId);
      await job?.remove().catch(() => undefined);
    }
    await queue.resume().catch(() => undefined);
    await prisma.webhookEvent.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    await queue.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
