import { readFileSync } from "node:fs";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { AiProvider } from "@leadvirt/ai";
import { decryptIntegrationCredentials, WebhookAdapter } from "@leadvirt/integrations";
import {
  mergeChannelSettings,
  projectChannelSettings,
} from "../../apps/api/src/modules/channels/channel-settings.js";
import type { AiReplyQueueService } from "../../apps/api/src/modules/ai/ai-reply-queue.service.js";
import { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import type { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import { WebhookController } from "../../apps/api/src/modules/webhook/webhook.controller.js";
import { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";
import type { WorkflowsService } from "../../apps/api/src/modules/workflows/workflows.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectUnauthorized(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof UnauthorizedException,
      `${message}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    return;
  }
  throw new Error(message);
}

async function expectBadRequest(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof BadRequestException, message);
    return;
  }
  throw new Error(message);
}

async function main() {
  const telegramSecrets = {
    telegram: {
      webhookSecret: "telegram-active-secret",
      webhookPendingSecret: "telegram-pending-secret",
      retiredBotEncryptedCredentials: "telegram-retired-credentials",
      botToken: "telegram-bot-token",
      nested: { apiToken: "nested-api-token", visible: "kept" },
    },
  };
  const safeTelegram = projectChannelSettings("TELEGRAM", telegramSecrets);
  const telegramJson = JSON.stringify(safeTelegram);
  for (const secret of [
    "telegram-active-secret",
    "telegram-pending-secret",
    "telegram-retired-credentials",
    "telegram-bot-token",
    "nested-api-token",
  ]) {
    assert(!telegramJson.includes(secret), `Telegram projection leaked ${secret}.`);
  }
  const safeTelegramSettings = safeTelegram.telegram as Record<string, unknown>;
  assert(safeTelegramSettings.webhookConfigured === true, "Telegram configured state was lost.");
  assert(
    safeTelegramSettings.previousBotCleanupPending === true,
    "Telegram cleanup state was lost.",
  );
  assert(
    (safeTelegramSettings.nested as Record<string, unknown>).visible === "kept",
    "Safe nested Telegram settings were removed.",
  );

  const webhookSecrets = {
    secret: "VALUE_ROOT_8f31",
    webhook: {
      secret: "VALUE_CANONICAL_91c2",
      webhookSecret: "VALUE_LEGACY_c77a",
      acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
      nested: { password: "VALUE_PASSWORD_4a66", visible: true },
    },
  };
  const safeWebhook = projectChannelSettings("WEBHOOK", webhookSecrets);
  const webhookJson = JSON.stringify(safeWebhook);
  for (const secret of [
    "VALUE_ROOT_8f31",
    "VALUE_CANONICAL_91c2",
    "VALUE_LEGACY_c77a",
    "VALUE_PASSWORD_4a66",
  ]) {
    assert(!webhookJson.includes(secret), `Webhook projection leaked ${secret}.`);
  }
  const safeWebhookSettings = safeWebhook.webhook as Record<string, unknown>;
  assert(safeWebhookSettings.secretConfigured === true, "Webhook configured state was lost.");
  assert(
    Array.isArray(safeWebhookSettings.acceptedHeaders),
    "Safe webhook header configuration was removed.",
  );

  const preserved = mergeChannelSettings(
    "WEBHOOK",
    { webhook: { secret: "preserved-secret", autoReply: false } },
    { webhook: { autoReply: true, secret: null } },
    () => "unused-generated-secret",
  );
  assert(
    (preserved.webhook as Record<string, unknown>).secret === "preserved-secret",
    "A partial webhook settings update erased the stored secret.",
  );
  const protectedWebhook = mergeChannelSettings(
    "WEBHOOK",
    { webhook: { secret: "server-managed-secret" } },
    { webhook: { secret: "caller-overwrite" } },
    () => "unused-webhook-secret",
  );
  assert(
    (protectedWebhook.webhook as Record<string, unknown>).secret === "server-managed-secret",
    "A generic settings update replaced the managed webhook secret.",
  );
  const repaired = mergeChannelSettings(
    "WEBHOOK",
    { webhook: { secret: { malformed: true } } },
    { webhook: { autoReply: true } },
    () => "repaired-webhook-secret",
  );
  assert(
    (repaired.webhook as Record<string, unknown>).secret === "repaired-webhook-secret",
    "Malformed webhook secret state was preserved.",
  );
  const protectedTelegram = mergeChannelSettings(
    "TELEGRAM",
    { telegram: { webhookSecret: "managed-secret", webhookConfigured: true } },
    { telegram: { webhookSecret: "caller-overwrite", autoReply: true } },
    () => "unused-managed-secret",
  );
  assert(
    (protectedTelegram.telegram as Record<string, unknown>).webhookSecret === "managed-secret",
    "A generic channel update replaced the managed Telegram secret.",
  );

  type TestChannel = {
    id: string;
    tenantId: string;
    type: "WEBHOOK";
    status: "ACTIVE";
    name: string;
    publicKey: string;
    settings: unknown;
    encryptedCredentials: string | null;
    lastHealthAt: Date | null;
    automaticRepliesEnabled: boolean;
    automaticRepliesGeneration: number;
    automaticRepliesPublicationId: string | null;
    automaticRepliesPublicationEtag: number | null;
    automaticRepliesCapabilitySetHash: string | null;
    automaticRepliesOperationalBindingHash: string | null;
    automaticRepliesOperationalPermissionGeneration: number | null;
    automaticRepliesChannelFingerprint: string | null;
    automaticRepliesActivatedAt: Date | null;
  };
  let storedChannel: TestChannel | null = null;
  const channelPrisma = {
    channel: {
      findFirst: async () => null,
      findUnique: async () => null,
      findMany: async () => (storedChannel ? [storedChannel] : []),
      create: async (input: { data: Record<string, unknown> }) => {
        storedChannel = {
          id: "channel-security",
          tenantId: String(input.data.tenantId),
          type: "WEBHOOK",
          status: "ACTIVE",
          name: String(input.data.name),
          publicKey: String(input.data.publicKey),
          settings: input.data.settings,
          encryptedCredentials:
            typeof input.data.encryptedCredentials === "string"
              ? input.data.encryptedCredentials
              : null,
          lastHealthAt: null,
          automaticRepliesEnabled: false,
          automaticRepliesGeneration: 0,
          automaticRepliesPublicationId: null,
          automaticRepliesPublicationEtag: null,
          automaticRepliesCapabilitySetHash: null,
          automaticRepliesOperationalBindingHash: null,
          automaticRepliesOperationalPermissionGeneration: null,
          automaticRepliesChannelFingerprint: null,
          automaticRepliesActivatedAt: null,
        };
        return storedChannel;
      },
    },
    integrationAccount: { upsert: async () => ({}) },
    auditLog: { create: async () => ({}) },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      let queryCount = 0;
      const tx = {
        $queryRaw: async () => {
          queryCount += 1;
          return queryCount === 1 ? [] : [{ id: storedChannel?.id }];
        },
        channel: {
          findFirstOrThrow: async () => storedChannel,
          update: async (input: { data: Record<string, unknown> }) => {
            assert(storedChannel, "Rotation lost the stored channel.");
            storedChannel = { ...storedChannel, ...input.data } as TestChannel;
            return storedChannel;
          },
        },
        auditLog: { create: async () => ({}) },
      };
      return operation(tx);
    },
  } as unknown as PrismaService;
  const channels = new ChannelsService(channelPrisma, {} as KnowledgeV2PublicationService);
  const context = {
    tenantId: "tenant-security",
    userId: "user-security",
    role: "OWNER" as const,
    authMode: "credentials" as const,
    tenant: {
      id: "tenant-security",
      name: "Security",
      slug: "security",
      status: "ACTIVE" as const,
      businessType: null,
      timezone: "UTC",
    },
    user: {
      id: "user-security",
      email: "security@leadvirt.test",
      phone: null,
      name: "Security",
      avatarUrl: null,
      passwordChangeRequired: false,
    },
  };
  const viewerContext = { ...context, role: "VIEWER" as const };
  await expectBadRequest(
    () =>
      channels.create(context, {
        type: "WEBHOOK",
        name: "Unsafe outbound webhook",
        status: "ACTIVE",
        publicKey: "lvwh_unsafe_outbound",
        settings: {
          webhook: { outbound: { targetUrl: "http://169.254.169.254/metadata" } },
        },
      }),
    "Webhook channel creation accepted an unsafe outbound target.",
  );
  const created = await channels.create(context, {
    type: "WEBHOOK",
    name: "Security webhook",
    status: "ACTIVE",
    publicKey: "lvwh_security",
    settings: {
      webhook: {
        secret: "caller-create-secret",
        outbound: {
          targetUrl: "https://hooks.vendor.com/leadvirt/replies?key=hidden",
          auth: {
            headerName: "authorization",
            scheme: "Bearer",
            secret: "outbound-create-secret",
          },
        },
      },
    },
  });
  assert(
    typeof created.oneTimeSecret === "string" && created.oneTimeSecret.length >= 24,
    "Webhook creation did not return its generated one-time secret.",
  );
  assert(
    !JSON.stringify(created.settings).includes(created.oneTimeSecret),
    "Webhook creation duplicated its one-time secret into projected settings.",
  );
  assert(
    !JSON.stringify(created).includes("caller-create-secret"),
    "Webhook creation accepted or returned a caller-controlled managed secret.",
  );
  assert(storedChannel, "Webhook creation did not persist a channel.");
  assert(
    !JSON.stringify(storedChannel.settings).includes("outbound-create-secret") &&
      !JSON.stringify(created.settings).includes("hooks.vendor.com"),
    "Webhook creation stored plaintext outbound credentials or projected target details.",
  );
  assert(
    typeof storedChannel.encryptedCredentials === "string" &&
      decryptIntegrationCredentials(storedChannel.encryptedCredentials).webhookOutboundSecret ===
        "outbound-create-secret",
    "Webhook outbound authentication was not encrypted at rest.",
  );
  const withoutOutboundAuth = await channels.update(context, created.id, {
    settings: { webhook: { outbound: { auth: null } } },
  });
  assert(
    storedChannel.encryptedCredentials === null,
    "Removing outbound authentication retained its encrypted credential.",
  );
  const clearedOutbound = ((withoutOutboundAuth.settings as Record<string, unknown>)
    .webhook as Record<string, unknown>).outbound as Record<string, unknown>;
  assert(
    clearedOutbound.targetConfigured === true &&
      clearedOutbound.authenticationConfigured === false,
    "Removing outbound authentication changed the target or projected the wrong state.",
  );
  const listedAfterCreate = await channels.list(viewerContext);
  assert(
    !JSON.stringify(listedAfterCreate).includes(created.oneTimeSecret),
    "Channel listing returned the one-time creation secret.",
  );
  const rotated = await channels.rotateWebhookSecret(context, created.id);
  assert(
    rotated.oneTimeSecret !== created.oneTimeSecret,
    "Webhook rotation did not generate a new secret.",
  );
  assert(
    !JSON.stringify(rotated.channel).includes(rotated.oneTimeSecret),
    "Webhook rotation duplicated its one-time secret into projected channel settings.",
  );
  const listedAfterRotation = await channels.list(viewerContext);
  assert(
    !JSON.stringify(listedAfterRotation).includes(rotated.oneTimeSecret),
    "Channel listing returned the one-time rotated secret.",
  );

  const adapter = new WebhookAdapter();
  assert(
    !(await adapter.verifyWebhook({ headers: {}, body: {}, secret: undefined })),
    "Generic webhook verification accepted a missing stored secret.",
  );
  assert(
    await adapter.verifyWebhook({
      headers: { "x-leadvirt-webhook-secret": "header-secret" },
      body: {},
      secret: "header-secret",
    }),
    "Generic webhook verification rejected the required header.",
  );

  const secretlessPrisma = {
    channel: {
      findFirst: async () => ({ settings: {}, tenant: { status: "ACTIVE", deletedAt: null } }),
    },
  } as unknown as PrismaService;
  const secretlessService = new WebhookService(
    secretlessPrisma,
    {} as AiProvider,
    {} as AiReplyQueueService,
    {} as WorkflowsService,
  );
  await expectUnauthorized(
    () => secretlessService.handleEvent("secretless", {}, {}),
    "WebhookService did not fail closed for a channel without a secret.",
  );

  const routeSecret = "route-header-secret";
  const routeAdapter = new WebhookAdapter();
  const routeService = {
    handleEvent: async (
      _publicKey: string,
      body: unknown,
      headers: Record<string, string | string[] | undefined>,
    ) => {
      const verified = await routeAdapter.verifyWebhook({ headers, body, secret: routeSecret });
      if (!verified) throw new UnauthorizedException("Webhook secret is invalid.");
      return {
        ok: true as const,
        duplicate: false,
        conversationId: "conversation-security",
        leadId: null,
        inboundMessageId: "message-security",
        aiMessageId: null,
        outboundStatus: "skipped" as const,
        reply: null,
      };
    },
  } as unknown as WebhookService;
  const controller = new WebhookController(routeService);
  await controller.event("header", {}, { "x-leadvirt-webhook-secret": routeSecret });
  const eventWithLegacyQueryArgument = controller.event.bind(controller) as unknown as (
    publicKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    formerQuerySecret?: string,
  ) => Promise<unknown>;
  await expectUnauthorized(
    () => eventWithLegacyQueryArgument("query", {}, {}, routeSecret),
    "A query-string secret was still accepted without an authentication header.",
  );

  const channelsSource = readFileSync(
    new URL("../../apps/api/src/modules/channels/channels.service.ts", import.meta.url),
    "utf8",
  );
  const conversationsSource = readFileSync(
    new URL("../../apps/api/src/modules/conversations/conversations.service.ts", import.meta.url),
    "utf8",
  );
  assert(
    channelsSource.includes("projectChannelSettings(channel.type, channel.settings)"),
    "Channel responses are not wired to the shared safe projection.",
  );
  assert(
    conversationsSource.includes("projectChannelSettings(channel.type, channel.settings)"),
    "Conversation responses are not wired to the shared safe projection.",
  );

  console.log("Channel/webhook security smoke passed");
}

void main();
