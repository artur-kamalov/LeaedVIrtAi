import { BadRequestException } from "@nestjs/common";
import type { AiProvider } from "@leadvirt/ai";
import {
  WebhookAdapter,
  WebhookDeliveryClient,
  WebhookDeliveryError,
  type WebhookResolver,
  type WebhookTransport,
  type WebhookTransportRequest,
  type WebhookTransportResponse,
} from "@leadvirt/integrations";
import type { RuntimeQueueService } from "../../apps/api/src/modules/ai/runtime-queue.service.js";
import {
  mergeChannelSettings,
  projectChannelSettings,
} from "../../apps/api/src/modules/channels/channel-settings.js";
import { ConversationsService } from "../../apps/api/src/modules/conversations/conversations.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectDeliveryError(
  action: () => Promise<unknown>,
  expected: {
    code: WebhookDeliveryError["code"];
    retryable: boolean;
    outcome: WebhookDeliveryError["outcome"];
  },
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof WebhookDeliveryError, `Expected ${expected.code}, got another error.`);
    assert(error.code === expected.code, `Expected ${expected.code}, got ${error.code}.`);
    assert(
      error.retryable === expected.retryable,
      `${expected.code} returned the wrong retry classification.`,
    );
    assert(
      error.outcome === expected.outcome,
      `${expected.code} returned the wrong provider outcome.`,
    );
    assert(
      !/hooks\.vendor\.com|8\.8\.8\.8|private-auth-secret/u.test(error.message),
      `${expected.code} leaked target or credential details.`,
    );
    return error;
  }
  throw new Error(`Expected ${expected.code}, but delivery succeeded.`);
}

function body(value: unknown): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

function response(input: {
  statusCode: number;
  remoteAddress?: string;
  value?: unknown;
  contentLength?: number;
  cancel?: () => void;
}): WebhookTransportResponse {
  return {
    statusCode: input.statusCode,
    headers:
      input.contentLength === undefined
        ? { "content-type": "application/json" }
        : { "content-length": String(input.contentLength) },
    remoteAddress: input.remoteAddress ?? "8.8.8.8",
    body: body(input.value ?? {}),
    cancel: input.cancel ?? (() => undefined),
  };
}

const publicResolver: WebhookResolver = {
  resolve: async () => [{ address: "8.8.8.8", family: 4 }],
};

const baseInput = {
  tenantId: "tenant-webhook-delivery",
  channelAccountId: "channel-webhook-delivery",
  conversationId: "conversation-internal",
  externalConversationId: "webhook:customer-thread-42",
  text: "A truthful outbound reply",
  metadata: {
    messageId: "message-outbound-42",
    deliveryOperationId: "channel_delivery_contract_42",
    raw: { secret: "raw-inbound-must-not-leak" },
  },
};

async function main() {
  let requests: WebhookTransportRequest[] = [];
  const acceptingTransport: WebhookTransport = {
    request: async (request) => {
      requests.push(request);
      return response({ statusCode: 201, value: { externalMessageId: "provider-message-42" } });
    },
  };
  const adapter = new WebhookAdapter(
    new WebhookDeliveryClient({ resolver: publicResolver, transport: acceptingTransport }),
  );
  const sent = await adapter.sendMessage({
    ...baseInput,
    settings: {
      webhook: {
        secret: "inbound-secret-must-not-leak",
        outbound: {
          targetUrl: "https://hooks.vendor.com/v1/replies?version=1",
          auth: {
            headerName: "authorization",
            scheme: "Bearer",
            configured: true,
          },
        },
      },
    },
    credentials: { webhookOutboundSecret: "private-auth-secret" },
  });
  assert(sent.status === "sent", "A 201 webhook response was not recorded as sent.");
  assert(
    sent.externalMessageId === "provider-message-42",
    "The provider response message id was not preserved.",
  );
  assert(requests.length === 1, "The successful webhook was called more than once.");
  const acceptedRequest = requests[0]!;
  assert(
    acceptedRequest.address === "8.8.8.8" &&
      acceptedRequest.hostname === "hooks.vendor.com" &&
      acceptedRequest.path === "/v1/replies?version=1",
    "The admitted destination was not pinned to the verified address.",
  );
  assert(
    acceptedRequest.headers.authorization === "Bearer private-auth-secret",
    "The configured authorization header was not applied.",
  );
  assert(
    acceptedRequest.headers["Idempotency-Key"] === "channel_delivery_contract_42" &&
      acceptedRequest.headers["X-LeadVirt-Delivery-Id"] === "channel_delivery_contract_42",
    "The delivery idempotency contract was not applied.",
  );
  const payload = new TextDecoder().decode(acceptedRequest.body);
  const parsedPayload = JSON.parse(payload) as {
    data?: { conversationId?: unknown };
  };
  assert(
    parsedPayload.data?.conversationId === "customer-thread-42",
    "The receiver conversation id was not restored from its internal namespace.",
  );
  for (const forbidden of [
    "raw-inbound-must-not-leak",
    "inbound-secret-must-not-leak",
    "private-auth-secret",
  ]) {
    assert(!payload.includes(forbidden), `The outbound payload leaked ${forbidden}.`);
  }

  requests = [];
  await expectDeliveryError(
    () =>
      adapter.sendMessage({
        ...baseInput,
        settings: { webhook: {} },
      }),
    { code: "WEBHOOK_TARGET_MISSING", retryable: false, outcome: "NOT_STARTED" },
  );
  assert(requests.length === 0, "A missing target reached the transport.");

  for (const targetUrl of [
    "http://hooks.vendor.com/replies",
    "https://localhost/replies",
    "https://127.0.0.1/replies",
    "https://user:password@hooks.vendor.com/replies",
    "https://hooks.vendor.com:8443/replies",
  ]) {
    await expectDeliveryError(
      () =>
        adapter.sendMessage({
          ...baseInput,
          settings: { webhook: { outbound: { targetUrl } } },
        }),
      {
        code:
          targetUrl.startsWith("http:")
            ? "WEBHOOK_HTTPS_REQUIRED"
            : targetUrl.includes("127.0.0.1")
              ? "WEBHOOK_TARGET_NOT_PUBLIC"
              : "WEBHOOK_TARGET_INVALID",
        retryable: false,
        outcome: "NOT_STARTED",
      },
    );
  }

  const privateResolver: WebhookResolver = {
    resolve: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
  };
  await expectDeliveryError(
    () =>
      new WebhookDeliveryClient({ resolver: privateResolver, transport: acceptingTransport }).send({
        ...baseInput,
        settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
      }),
    { code: "WEBHOOK_TARGET_NOT_PUBLIC", retryable: false, outcome: "NOT_STARTED" },
  );

  const failedResolver: WebhookResolver = {
    resolve: async () => {
      throw new Error("resolver details must not escape");
    },
  };
  await expectDeliveryError(
    () =>
      new WebhookDeliveryClient({ resolver: failedResolver, transport: acceptingTransport }).send({
        ...baseInput,
        settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
      }),
    { code: "WEBHOOK_DNS_LOOKUP_FAILED", retryable: true, outcome: "NOT_STARTED" },
  );

  await expectDeliveryError(
    () =>
      adapter.sendMessage({
        ...baseInput,
        settings: {
          webhook: {
            outbound: {
              targetUrl: "https://hooks.vendor.com/replies",
              auth: { headerName: "host", secret: "private-auth-secret" },
            },
          },
        },
      }),
    { code: "WEBHOOK_AUTH_INVALID", retryable: false, outcome: "NOT_STARTED" },
  );

  for (const statusCode of [429, 503]) {
    let cancelled = false;
    const rejecting = new WebhookDeliveryClient({
      resolver: publicResolver,
      transport: {
        request: async () =>
          response({ statusCode, cancel: () => (cancelled = true), value: "provider detail" }),
      },
    });
    const error = await expectDeliveryError(
      () =>
        rejecting.send({
          ...baseInput,
          settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
        }),
      { code: "WEBHOOK_HTTP_RETRYABLE", retryable: true, outcome: "FAILED" },
    );
    assert(error.statusCode === statusCode, "The retryable HTTP status was not classified.");
    assert(cancelled, "A rejected response body was not cancelled.");
  }

  await expectDeliveryError(
    () =>
      new WebhookDeliveryClient({
        resolver: publicResolver,
        transport: { request: async () => response({ statusCode: 302 }) },
      }).send({
        ...baseInput,
        settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
      }),
    { code: "WEBHOOK_HTTP_REJECTED", retryable: false, outcome: "FAILED" },
  );

  let oversizedCancelled = false;
  const oversized = await new WebhookDeliveryClient({
    resolver: publicResolver,
    maxResponseBytes: 1_024,
    transport: {
      request: async () =>
        response({
          statusCode: 200,
          contentLength: 2_048,
          cancel: () => (oversizedCancelled = true),
        }),
    },
  }).send({
    ...baseInput,
    settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
  });
  assert(oversized.status === "sent", "A successful oversized response reversed delivery success.");
  assert(oversizedCancelled, "An oversized successful response was not cancelled.");
  assert(
    oversized.externalMessageId === "webhook:channel_delivery_contract_42",
    "An oversized response did not use the bounded fallback id.",
  );

  const callerAbort = new AbortController();
  const hangingTransport: WebhookTransport = {
    request: async (request) => ({
      ...response({ statusCode: 200 }),
      body: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        },
      },
    }),
  };
  const hanging = new WebhookDeliveryClient({ resolver: publicResolver, transport: hangingTransport });
  const hangingDelivery = hanging.send({
    ...baseInput,
    signal: callerAbort.signal,
    settings: { webhook: { outbound: { targetUrl: "https://hooks.vendor.com/replies" } } },
  });
  setTimeout(() => callerAbort.abort(), 10);
  await expectDeliveryError(() => hangingDelivery, {
    code: "WEBHOOK_ABORTED",
    retryable: false,
    outcome: "UNKNOWN",
  });

  const channelSettings = {
    webhook: {
      secret: "inbound-secret",
      outbound: {
        targetUrl: "https://hooks.vendor.com/private/path?token=hidden",
        timeoutMs: 5_000,
        auth: { headerName: "authorization", secret: "private-auth-secret" },
        headers: { Cookie: "must-not-leak" },
      },
    },
  };
  const projected = projectChannelSettings("WEBHOOK", channelSettings);
  const projectedJson = JSON.stringify(projected);
  for (const forbidden of [
    "inbound-secret",
    "private-auth-secret",
    "hooks.vendor.com",
    "must-not-leak",
  ]) {
    assert(!projectedJson.includes(forbidden), `Channel projection leaked ${forbidden}.`);
  }
  const projectedOutbound = (projected.webhook as Record<string, unknown>)
    .outbound as Record<string, unknown>;
  assert(projectedOutbound.targetConfigured === true, "Projected target state was lost.");
  assert(
    projectedOutbound.authenticationConfigured === true,
    "Projected authentication state was lost.",
  );

  const merged = mergeChannelSettings(
    "WEBHOOK",
    channelSettings,
    {
      webhook: {
        outbound: {
          timeoutMs: 7_500,
          auth: { secret: "" },
          targetConfigured: true,
          authenticationConfigured: true,
          headers: { Authorization: "caller-injected" },
        },
      },
    },
    () => "unused-secret",
  );
  const mergedOutbound = (merged.webhook as Record<string, unknown>).outbound as Record<
    string,
    unknown
  >;
  assert(
    mergedOutbound.targetUrl === "https://hooks.vendor.com/private/path?token=hidden",
    "A partial update erased the outbound target.",
  );
  assert(
    ((mergedOutbound.auth as Record<string, unknown>).secret as string) ===
      "private-auth-secret",
    "A blank partial update erased the outbound credential.",
  );
  assert(
    mergedOutbound.headers === undefined &&
      mergedOutbound.targetConfigured === undefined &&
      mergedOutbound.authenticationConfigured === undefined,
    "Untrusted or projection-only outbound settings were persisted.",
  );

  let transactionCalls = 0;
  const conversationPrisma = {
    conversation: {
      findFirst: async () => ({
        id: "conversation-api-contract",
        tenantId: "tenant-api-contract",
        leadId: null,
        channelId: "channel-api-contract",
        status: "OPEN",
        subject: "Webhook API contract",
        lastMessageAt: new Date(),
        aiEnabled: true,
        handoffRequested: false,
        channel: {
          id: "channel-api-contract",
          tenantId: "tenant-api-contract",
          type: "WEBHOOK",
          status: "ACTIVE",
          name: "Webhook",
          settings: { webhook: {} },
        },
        lead: null,
        messages: [],
      }),
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("The invalid send contract reached persistence.");
    },
  } as unknown as PrismaService;
  const conversations = new ConversationsService(
    conversationPrisma,
    {} as AiProvider,
    {} as RuntimeQueueService,
  );
  try {
    await conversations.sendMessage(
      {
        tenantId: "tenant-api-contract",
        userId: "user-api-contract",
        role: "OWNER",
        authMode: "credentials",
        tenant: {
          id: "tenant-api-contract",
          name: "API Contract",
          slug: "api-contract",
          status: "ACTIVE",
          businessType: null,
          timezone: "UTC",
        },
        user: {
          id: "user-api-contract",
          email: "api-contract@example.com",
          phone: null,
          name: "API Contract",
          avatarUrl: null,
          passwordChangeRequired: false,
        },
      },
      "conversation-api-contract",
      { text: "This must not be queued without a target." },
    );
    throw new Error("The API accepted an unconfigured outbound webhook.");
  } catch (error) {
    assert(error instanceof BadRequestException, "The API returned the wrong configuration error.");
  }
  assert(transactionCalls === 0, "The API persisted a message before validating the target.");

  console.log(
    JSON.stringify({
      ok: true,
      pinnedHttps: true,
      boundedResponse: true,
      safeProjection: true,
      truthfulApiContract: true,
    }),
  );
}

void main();
