import { HttpException } from "@nestjs/common";
import {
  EmailAdapter,
  GoogleCalendarAdapter,
  IntegrationAdapterUnavailableError,
} from "@leadvirt/integrations";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

const unavailableProviders = [
  { provider: "AMOCRM", capability: "CRM" },
  { provider: "BITRIX24", capability: "CRM" },
  { provider: "RETAILCRM", capability: "CRM" },
  { provider: "WHATSAPP_BUSINESS", capability: "SOCIAL_CHANNEL" },
  { provider: "INSTAGRAM", capability: "SOCIAL_CHANNEL" },
  { provider: "VK", capability: "SOCIAL_CHANNEL" },
  { provider: "EMAIL", capability: "EMAIL_CHANNEL" },
  { provider: "GOOGLE_CALENDAR", capability: "CALENDAR" },
  { provider: "SHOPIFY", capability: "ECOMMERCE" },
  { provider: "SHOP_SCRIPT", capability: "ECOMMERCE" },
  { provider: "OTHER", capability: "CUSTOM" },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const context: RequestContext = {
  tenantId: "tenant-crm-truthful-state",
  userId: "user-crm-truthful-state",
  role: "OWNER",
  authMode: "credentials",
  tenant: {
    id: "tenant-crm-truthful-state",
    name: "CRM Truthful State",
    slug: "crm-truthful-state",
    status: "ACTIVE",
    businessType: null,
    timezone: "UTC",
  },
  user: {
    id: "user-crm-truthful-state",
    email: "crm-truthful-state@leadvirt.test",
    phone: null,
    name: "CRM Truthful State",
    avatarUrl: null,
    passwordChangeRequired: false,
  },
};

function createService(prisma: PrismaService, webhookService = {} as WebhookService) {
  return new IntegrationsService(
    prisma,
    {} as ChannelsService,
    {} as TelegramBotApiService,
    {} as TelegramService,
    webhookService,
  );
}

async function expectUnavailable(
  operation: () => Promise<unknown>,
  capability: string,
  provider?: string,
) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof HttpException,
      "Unavailable boundary did not return an HTTP exception.",
    );
    assert(
      error.getStatus() === 501,
      `Unavailable boundary returned HTTP ${error.getStatus()} instead of 501.`,
    );
    const response = error.getResponse();
    assert(isRecord(response), "Unavailable boundary returned an invalid error response.");
    assert(
      response.code === "INTEGRATION_NOT_AVAILABLE",
      "Unavailable boundary returned the wrong stable error code.",
    );
    assert(response.retryable === false, "Unavailable errors must not be marked retryable.");
    assert(
      typeof response.message === "string" &&
        response.message.includes("live provider implementation"),
      "Unavailable boundary did not explain why the integration is unavailable.",
    );
    assert(isRecord(response.details), "Unavailable boundary omitted structured error details.");
    assert(
      response.details.capability === capability,
      "Unavailable boundary returned the wrong capability.",
    );
    if (provider) {
      assert(
        response.details.provider === provider,
        "Unavailable boundary returned the wrong provider.",
      );
    } else {
      assert(response.details.provider === undefined, "Generic CRM sync exposed a fake provider.");
    }
    return;
  }
  throw new Error("Unavailable boundary unexpectedly succeeded.");
}

async function expectAdapterUnavailable(
  operation: () => Promise<unknown>,
  provider: string,
  adapterOperation: string,
) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof IntegrationAdapterUnavailableError,
      `${provider} adapter returned the wrong error type.`,
    );
    assert(error.code === "INTEGRATION_ADAPTER_NOT_AVAILABLE", "Adapter error code changed.");
    assert(error.retryable === false, "Unavailable adapter error became retryable.");
    assert(error.provider === provider, "Unavailable adapter returned the wrong provider.");
    assert(
      error.operation === adapterOperation,
      "Unavailable adapter returned the wrong operation.",
    );
    return;
  }
  throw new Error(`${provider} adapter fabricated a successful operation.`);
}

async function main() {
  const databaseAccesses: string[] = [];
  const unavailablePrisma = new Proxy(
    {},
    {
      get(_target, property) {
        databaseAccesses.push(String(property));
        throw new Error(`Unexpected database access: ${String(property)}`);
      },
    },
  ) as PrismaService;
  const service = createService(unavailablePrisma);

  for (const { provider, capability } of unavailableProviders) {
    await expectUnavailable(() => service.connect(context, provider), capability, provider);
    await expectUnavailable(() => service.disconnect(context, provider), capability, provider);
    await expectUnavailable(
      () => service.updateSettings(context, provider, { settings: { apiToken: "must-not-save" } }),
      capability,
      provider,
    );
    await expectUnavailable(() => service.testConnection(context, provider), capability, provider);
    await expectUnavailable(
      () => service.sendSampleInbound(context, provider),
      capability,
      provider,
    );
  }
  await expectUnavailable(() => service.syncLeadToCrm(context, null as never), "CRM");
  assert(
    databaseAccesses.length === 0,
    "An unavailable integration operation touched persistence.",
  );

  const emailAdapter = new EmailAdapter();
  await expectAdapterUnavailable(
    () => emailAdapter.normalizeInbound({ message: "must-not-normalize" }),
    "EMAIL",
    "NORMALIZE_INBOUND",
  );
  await expectAdapterUnavailable(
    () =>
      emailAdapter.sendMessage({
        tenantId: context.tenantId,
        channelAccountId: "email-account",
        conversationId: "conversation-email",
        externalConversationId: "person@example.com",
        text: "must-not-send",
      }),
    "EMAIL",
    "SEND_MESSAGE",
  );
  await expectAdapterUnavailable(
    () =>
      new GoogleCalendarAdapter().createBooking({
        tenantId: context.tenantId,
        leadId: "lead-calendar",
        title: "Must not create",
        startsAt: "2026-07-15T12:00:00.000Z",
      }),
    "GOOGLE_CALENDAR",
    "CREATE_BOOKING",
  );

  const staleTimestamp = new Date("2026-07-01T10:00:00.000Z");
  const staleUnavailableAccounts = unavailableProviders.map(({ provider, capability }) => ({
    id: `integration-${provider.toLowerCase()}`,
    tenantId: context.tenantId,
    provider,
    status: "CONNECTED",
    name: provider,
    category: capability,
    settings: { apiToken: "legacy-plaintext-token", syncEnabled: true },
    encryptedCredentials: "legacy-encrypted-credentials",
    connectedAt: staleTimestamp,
    lastSyncAt: staleTimestamp,
    deletedAt: null,
    syncLogs: [
      {
        id: `sync-${provider.toLowerCase()}`,
        action: "synthetic.operation",
        status: "SUCCESS",
        message: "Synthetic success",
        createdAt: staleTimestamp,
      },
    ],
  }));
  const telegramAccount = {
    id: "integration-telegram",
    tenantId: context.tenantId,
    provider: "TELEGRAM",
    status: "DISCONNECTED",
    name: "Telegram",
    category: "Channel",
    settings: { botId: "42", botUsername: "truthful_bot", managedByLeadVirt: true },
    encryptedCredentials: null,
    connectedAt: null,
    lastSyncAt: staleTimestamp,
    deletedAt: null,
    syncLogs: [],
  };
  const telegramChannel = {
    id: "channel-telegram-history",
    type: "TELEGRAM",
    publicKey: "telegram-history-public-key",
    settings: { telegram: { webhookSecret: "telegram-history-secret" } },
    encryptedCredentials: "encrypted-telegram-token",
    createdAt: staleTimestamp,
  };
  const webhookAccount = {
    id: "integration-webhook-api",
    tenantId: context.tenantId,
    provider: "WEBHOOK_API",
    status: "DISCONNECTED",
    name: "Webhook/API",
    category: "Developers",
    settings: { syncDirection: "inbound" },
    encryptedCredentials: null,
    connectedAt: null,
    lastSyncAt: null,
    deletedAt: null,
    syncLogs: [],
  };
  const webhookChannel = {
    id: "channel-webhook-authority",
    type: "WEBHOOK",
    publicKey: "webhook-authority-public-key",
    settings: { webhook: { webhookSecret: "webhook-authority-secret" } },
    encryptedCredentials: null,
    createdAt: staleTimestamp,
  };
  const scopedTelegramEvent = {
    id: "event-telegram-scoped",
    provider: `telegram:${telegramChannel.id}`,
    externalEventId: "update-scoped",
    status: "PROCESSED",
    errorMessage: null,
    receivedAt: new Date("2026-07-15T10:01:00.000Z"),
    processedAt: new Date("2026-07-15T10:01:01.000Z"),
  };
  const legacyTelegramEvent = {
    id: "event-telegram-legacy",
    provider: "telegram",
    externalEventId: "update-legacy",
    status: "PROCESSED",
    errorMessage: null,
    receivedAt: new Date("2026-07-15T10:00:00.000Z"),
    processedAt: new Date("2026-07-15T10:00:01.000Z"),
  };
  let queriedWebhookProviders: string[] = [];
  const readPrisma = {
    integrationAccount: {
      findMany: () =>
        Promise.resolve([...staleUnavailableAccounts, telegramAccount, webhookAccount]),
      findFirst: (args: { where: { provider: string } }) =>
        Promise.resolve(args.where.provider === "WEBHOOK_API" ? webhookAccount : null),
    },
    channel: {
      findMany: () => Promise.resolve([telegramChannel, webhookChannel]),
      findFirst: (args: { where: { type: string } }) =>
        Promise.resolve(args.where.type === "WEBHOOK" ? webhookChannel : null),
    },
    webhookEvent: {
      findMany: (args: { where: { provider: { in: string[] } } }) => {
        queriedWebhookProviders = args.where.provider.in;
        return Promise.resolve([scopedTelegramEvent, legacyTelegramEvent]);
      },
    },
    integrationSyncLog: {
      create: () => Promise.resolve({ id: "sync-webhook-sample" }),
    },
    auditLog: {
      create: () => Promise.resolve({ id: "audit-webhook-sample" }),
    },
  } as unknown as PrismaService;
  let webhookSampleCalls = 0;
  const webhookService = {
    handleEvent: () => {
      webhookSampleCalls += 1;
      return Promise.resolve({
        ok: true as const,
        duplicate: false,
        conversationId: "conversation-webhook-sample",
        leadId: "lead-webhook-sample",
        inboundMessageId: "message-webhook-sample",
        aiMessageId: null,
        outboundStatus: "skipped" as const,
        reply: null,
      });
    },
  } as unknown as WebhookService;
  const readService = createService(readPrisma, webhookService);
  const projected = await readService.list(context);

  for (const { provider } of unavailableProviders) {
    const account = projected.find((item) => item.provider === provider);
    assert(account, `Projected ${provider} account is missing.`);
    assert(account.status === "COMING_SOON", `${provider} still projects as connected.`);
    assert(account.connectedAt === null, `${provider} still exposes a connected timestamp.`);
    assert(account.lastSyncAt === null, `${provider} still exposes a synthetic sync timestamp.`);
    assert(
      account.recentSyncLogs.length === 0,
      `${provider} still exposes synthetic success logs.`,
    );
    assert(
      account.settings.implementationStatus === "NOT_AVAILABLE" &&
        account.settings.selfServe === false,
      `${provider} does not expose truthful availability metadata.`,
    );
    assert(account.settings.apiToken === undefined, `${provider} exposed legacy credentials.`);
  }

  const telegram = projected.find((item) => item.provider === "TELEGRAM");
  assert(telegram?.status === "CONNECTED", "Telegram connection behavior regressed.");
  assert(telegram.connectedAt === staleTimestamp.toISOString(), "Telegram timestamps regressed.");
  assert(
    queriedWebhookProviders.includes(`telegram:${telegramChannel.id}`) &&
      queriedWebhookProviders.includes("telegram"),
    "Telegram history query omitted a scoped or legacy provider key.",
  );
  assert(
    telegram.recentWebhookEvents?.map((event) => event.id).join(",") ===
      "event-telegram-scoped,event-telegram-legacy",
    "Telegram integration history did not preserve scoped and legacy webhook events.",
  );

  const webhook = projected.find((item) => item.provider === "WEBHOOK_API");
  assert(
    webhook?.status === "CONNECTED",
    "Active Webhook channel did not override stale account state.",
  );
  assert(
    webhook.connectedAt === staleTimestamp.toISOString() && webhook.inboundEndpoint !== null,
    "Webhook projection did not expose the active channel endpoint.",
  );
  const sample = await readService.sendSampleInbound(context, "WEBHOOK_API");
  assert(
    sample.ok && webhookSampleCalls === 1,
    "Stale account status blocked the real channel sample.",
  );

  console.log(
    JSON.stringify({
      ok: true,
      providers: unavailableProviders.map(({ provider }) => provider),
      rejectedBoundaries: unavailableProviders.length * 5 + 1,
      rejectedAdapterOperations: 3,
      telegramWebhookHistoryKeys: queriedWebhookProviders,
      webhookChannelAuthority: true,
      databaseAccessesBeforeRejection: databaseAccesses.length,
    }),
  );
}

void main();
