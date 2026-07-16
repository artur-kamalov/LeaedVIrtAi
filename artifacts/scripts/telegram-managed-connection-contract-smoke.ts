import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  TelegramAdapter,
  TelegramBotApiClient,
} from "@leadvirt/integrations";
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = "telegram-contract-key";

const requests: Array<{ url: string; method: string; payload: Record<string, unknown> }> = [];
let webhookUrl = "";
let webhookAllowedUpdates: string[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = url.split("/").at(-1) ?? "";
  const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  requests.push({ url, method, payload });

  let result: unknown = true;
  if (method === "getMe") {
    result = {
      id: 987654321,
      is_bot: true,
      first_name: "LeadVirt Test",
      username: "leadvirt_test_bot",
    };
  } else if (method === "setWebhook") {
    webhookUrl = String(payload.url ?? "");
    webhookAllowedUpdates = Array.isArray(payload.allowed_updates)
      ? payload.allowed_updates.filter((value): value is string => typeof value === "string")
      : [];
  } else if (method === "getWebhookInfo") {
    result = {
      url: webhookUrl,
      pending_update_count: 0,
      allowed_updates: webhookAllowedUpdates,
    };
  } else if (method === "sendMessage") {
    result = { message_id: 55 };
  }

  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main() {
  const botToken = "987654321:AA-contract-token";
  const encrypted = encryptIntegrationCredentials({ botToken });
  assert(!encrypted.includes(botToken), "Encrypted credentials contain the raw bot token.");
  assert(
    decryptIntegrationCredentials(encrypted).botToken === botToken,
    "Encrypted credential round trip failed.",
  );

  const client = new TelegramBotApiClient(fetcher, "https://telegram.contract.test");
  const profile = await client.getMe(botToken);
  assert(profile.username === "leadvirt_test_bot", "getMe did not return the bot profile.");

  process.env.TELEGRAM_BOT_API_BASE_URL = "https://gateway.contract.test/telegram/";
  const gatewayClient = new TelegramBotApiClient(fetcher);
  await gatewayClient.getMe(botToken);
  assert(
    requests.at(-1)?.url ===
      "https://gateway.contract.test/telegram/bot987654321:AA-contract-token/getMe",
    "Telegram gateway base URL was not applied.",
  );
  delete process.env.TELEGRAM_BOT_API_BASE_URL;

  await client.setWebhook({
    botToken,
    url: "https://leadvirt.com/api/public/channels/telegram/lvtg_contract/webhook",
    secretToken: "generated-secret_token",
    allowedUpdates: ["message", "edited_message"],
  });
  const setWebhook = requests.find((request) => request.method === "setWebhook");
  assert(
    setWebhook?.payload.secret_token === "generated-secret_token",
    "Webhook secret was not registered.",
  );
  assert(
    Array.isArray(setWebhook.payload.allowed_updates) &&
      setWebhook.payload.allowed_updates.length === 2,
    "Allowed Telegram updates were not registered.",
  );

  const webhookInfo = await client.getWebhookInfo(botToken);
  assert(webhookInfo.url === webhookUrl, "Webhook verification returned the wrong URL.");
  assert(
    webhookInfo.allowed_updates?.length === 2 &&
      webhookInfo.allowed_updates.includes("message") &&
      webhookInfo.allowed_updates.includes("edited_message"),
    "Webhook verification did not return the registered allowed_updates.",
  );

  const adapter = new TelegramAdapter(client);
  assert(
    !(await adapter.verifyWebhook({ headers: {}, body: {} })),
    "Telegram webhook verification accepted an unconfigured secret.",
  );
  assert(
    await adapter.verifyWebhook({
      headers: { "x-telegram-bot-api-secret-token": "contract-secret" },
      body: {},
      secret: "contract-secret",
    }),
    "Telegram webhook verification rejected the configured secret.",
  );
  const privateMessage = {
    message_id: 101,
    date: 1_700_000_000,
    chat: { id: 8_173_697_473, type: "private" },
    from: { id: 8_173_697_473, is_bot: false, first_name: "Private" },
    text: "Private Telegram message",
  };
  const normalizedPrivate = await adapter.normalizeInbound({
    update_id: 88_001,
    message: privateMessage,
  });
  assert(
    normalizedPrivate.authenticatedCustomer?.provider === "TELEGRAM" &&
      normalizedPrivate.authenticatedCustomer.subjectSource === "TELEGRAM_MESSAGE_FROM_ID" &&
      normalizedPrivate.authenticatedCustomer.conversationType === "PRIVATE" &&
      normalizedPrivate.authenticatedCustomer.externalSubjectId === "8173697473",
    "Eligible private Telegram message did not expose the authenticated customer claim.",
  );
  assert(normalizedPrivate.eventKind === "MESSAGE", "Telegram message kind was not normalized.");
  const normalizedEditedPrivate = await adapter.normalizeInbound({
    update_id: 88_002,
    edited_message: { ...privateMessage, message_id: 102, text: "Edited private message" },
  });
  assert(
    normalizedEditedPrivate.authenticatedCustomer?.provider === "TELEGRAM" &&
      normalizedEditedPrivate.authenticatedCustomer.subjectSource === "TELEGRAM_MESSAGE_FROM_ID" &&
      normalizedEditedPrivate.authenticatedCustomer.conversationType === "PRIVATE" &&
      normalizedEditedPrivate.authenticatedCustomer.externalSubjectId === "8173697473",
    "Eligible edited private Telegram message did not expose the authenticated customer claim.",
  );
  assert(
    normalizedEditedPrivate.eventKind === "MESSAGE_EDITED",
    "Telegram edited-message kind was not normalized.",
  );
  const ownContact = await adapter.normalizeInbound({
    update_id: 88_016,
    message: {
      ...privateMessage,
      contact: { user_id: 8_173_697_473, phone_number: "+33123456789" },
    },
  });
  assert(ownContact.customerPhone === "+33123456789", "Own Telegram contact was not accepted.");
  const otherContact = await adapter.normalizeInbound({
    update_id: 88_017,
    message: {
      ...privateMessage,
      contact: { user_id: 8_173_697_474, phone_number: "+33987654321" },
    },
  });
  assert(otherContact.customerPhone === undefined, "Another Telegram user's phone was accepted.");
  const unboundContact = await adapter.normalizeInbound({
    update_id: 88_018,
    message: { ...privateMessage, contact: { phone_number: "+33987654321" } },
  });
  assert(unboundContact.customerPhone === undefined, "Unbound Telegram contact was accepted.");

  const deniedIdentityUpdates: Array<{ name: string; update: unknown }> = [
    {
      name: "group chat",
      update: {
        update_id: 88_003,
        message: {
          ...privateMessage,
          chat: { id: -100_001, type: "group" },
        },
      },
    },
    {
      name: "supergroup chat",
      update: {
        update_id: 88_004,
        message: {
          ...privateMessage,
          chat: { id: -100_002, type: "supergroup" },
        },
      },
    },
    {
      name: "channel chat",
      update: {
        update_id: 88_005,
        message: {
          ...privateMessage,
          chat: { id: -100_003, type: "channel" },
        },
      },
    },
    {
      name: "missing chat type",
      update: {
        update_id: 88_006,
        message: { ...privateMessage, chat: { id: 8_173_697_473 } },
      },
    },
    {
      name: "unknown chat type",
      update: {
        update_id: 88_007,
        message: {
          ...privateMessage,
          chat: { id: 8_173_697_473, type: "unknown" },
        },
      },
    },
    {
      name: "missing sender",
      update: {
        update_id: 88_008,
        message: { ...privateMessage, from: undefined },
      },
    },
    {
      name: "bot sender",
      update: {
        update_id: 88_009,
        message: { ...privateMessage, from: { id: 8_173_697_473, is_bot: true } },
      },
    },
    {
      name: "chat and sender mismatch",
      update: {
        update_id: 88_010,
        message: { ...privateMessage, from: { id: 8_173_697_474, is_bot: false } },
      },
    },
    {
      name: "string identifiers",
      update: {
        update_id: 88_011,
        message: {
          ...privateMessage,
          chat: { id: "8173697473", type: "private" },
          from: { id: "8173697473", is_bot: false },
        },
      },
    },
    {
      name: "fractional identifiers",
      update: {
        update_id: 88_012,
        message: {
          ...privateMessage,
          chat: { id: 8_173_697_473.5, type: "private" },
          from: { id: 8_173_697_473.5, is_bot: false },
        },
      },
    },
    {
      name: "unsafe identifiers",
      update: {
        update_id: 88_013,
        message: {
          ...privateMessage,
          chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" },
          from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false },
        },
      },
    },
    {
      name: "zero identifiers",
      update: {
        update_id: 88_014,
        message: {
          ...privateMessage,
          chat: { id: 0, type: "private" },
          from: { id: 0, is_bot: false },
        },
      },
    },
    {
      name: "negative identifiers",
      update: {
        update_id: 88_015,
        message: {
          ...privateMessage,
          chat: { id: -8_173_697_473, type: "private" },
          from: { id: -8_173_697_473, is_bot: false },
        },
      },
    },
  ];
  for (const testCase of deniedIdentityUpdates) {
    const normalized = await adapter.normalizeInbound(testCase.update);
    assert(
      normalized.authenticatedCustomer === undefined,
      `${testCase.name} exposed an authenticated customer claim.`,
    );
  }

  const requestsBeforeMissingCredentials = requests.length;
  let missingCredentialsError: unknown;
  try {
    await adapter.sendMessage({
      tenantId: "tenant-contract",
      channelAccountId: "987654321",
      conversationId: "conversation-contract",
      externalConversationId: "telegram:445566",
      text: "Must not be reported as queued",
    });
  } catch (error) {
    missingCredentialsError = error;
  }
  assert(
    missingCredentialsError instanceof Error &&
      missingCredentialsError.message === "Telegram bot credentials are missing.",
    "Telegram adapter did not fail closed without bot credentials.",
  );
  assert(
    requests.length === requestsBeforeMissingCredentials,
    "Telegram adapter called the provider without bot credentials.",
  );

  const sent = await adapter.sendMessage({
    tenantId: "tenant-contract",
    channelAccountId: "987654321",
    conversationId: "conversation-contract",
    externalConversationId: "telegram:445566",
    text: "Contract reply",
    credentials: { botToken },
    metadata: { sample: true },
  });
  assert(sent.status === "sent", "Telegram adapter did not report a sent message.");
  assert(sent.externalMessageId === "telegram:55", "Telegram message id was not normalized.");
  const sendMessage = requests.find((request) => request.method === "sendMessage");
  assert(sendMessage?.payload.chat_id === "445566", "Telegram chat id was not extracted.");

  await client.deleteWebhook(botToken);
  await client.deleteWebhook(botToken, { dropPendingUpdates: true });
  const deleteWebhookRequests = requests.filter((request) => request.method === "deleteWebhook");
  assert(
    deleteWebhookRequests.length === 2 &&
      deleteWebhookRequests[0]?.payload.drop_pending_updates === false &&
      deleteWebhookRequests[1]?.payload.drop_pending_updates === true,
    "Webhook deletion did not preserve active-drain and forced-retirement semantics.",
  );
  const stagingEnv = readFileSync(
    new URL("../../deploy/env.staging.example", import.meta.url),
    "utf8",
  );
  assert(
    stagingEnv.includes("TELEGRAM_BOT_API_BASE_URL=https://147-90-14-240.sslip.io:8443/telegram"),
    "Staging Telegram Bot API does not use the external gateway.",
  );
  assert(
    stagingEnv.includes(
      "TELEGRAM_WEBHOOK_BASE_URL=https://147-90-14-240.sslip.io:8443/telegram-webhook",
    ),
    "Staging Telegram webhook does not use the external relay.",
  );
  const gatewayConfig = readFileSync(
    new URL("../../deploy/ai-gateway/nginx.conf", import.meta.url),
    "utf8",
  );
  assert(
    gatewayConfig.includes("limit_req_zone $binary_remote_addr zone=telegram_webhook_per_ip"),
    "Telegram webhook relay does not define a per-IP request limit.",
  );
  assert(
    gatewayConfig.includes("limit_req zone=telegram_webhook_per_ip"),
    "Telegram webhook relay does not apply its request limit.",
  );
  const deployWorkflow = readFileSync(
    new URL("../../.github/workflows/deploy-leadvirt-com.yml", import.meta.url),
    "utf8",
  );
  assert(
    deployWorkflow.includes("printenv TELEGRAM_BOT_API_BASE_URL"),
    "Deployment does not verify the live Telegram Bot API gateway.",
  );
  assert(
    deployWorkflow.includes("printenv TELEGRAM_WEBHOOK_BASE_URL"),
    "Deployment does not verify the live Telegram webhook relay.",
  );
  assert(
    deployWorkflow.includes("$telegram_webhook_base/lvtg_deployment_probe/webhook"),
    "Deployment does not probe the external Telegram webhook relay.",
  );
  console.log("Telegram managed connection contract: 39/39 checks passed");
}

void main();
