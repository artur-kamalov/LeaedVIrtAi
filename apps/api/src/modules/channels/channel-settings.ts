import type { ChannelType } from "@leadvirt/types";
import {
  webhookOutboundAuthenticationConfigured,
  webhookOutboundConfigured,
} from "@leadvirt/integrations";

type SecretFactory = () => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string) {
  const normalized = normalizedKey(key);
  return (
    normalized === "secret" ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credentials") ||
    normalized.endsWith("apikey") ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("accesskey")
  );
}

function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, nested]) => [key, safeValue(nested)]),
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstSecret(...values: unknown[]) {
  for (const value of values) {
    const secret = nonEmptyString(value);
    if (secret) return secret;
  }
  return null;
}

function generatedSecret(factory: SecretFactory) {
  const secret = nonEmptyString(factory());
  if (!secret) throw new Error("Channel secret generation returned an invalid value.");
  return secret;
}

function removeRootSecretAliases(settings: Record<string, unknown>) {
  const next = { ...settings };
  delete next.secret;
  delete next.webhookSecret;
  delete next.webhookPendingSecret;
  return next;
}

export function webhookSecretFromSettings(value: unknown): string | null {
  const settings = asRecord(value);
  const webhook = asRecord(settings.webhook);
  return firstSecret(
    webhook.secret,
    webhook.webhookSecret,
    settings.secret,
    settings.webhookSecret,
  );
}

export function setWebhookSecret(value: unknown, secretValue: unknown): Record<string, unknown> {
  const secret = nonEmptyString(secretValue);
  if (!secret) throw new Error("Webhook secret is invalid.");

  const settings = removeRootSecretAliases(asRecord(value));
  const webhook = { ...asRecord(settings.webhook) };
  delete webhook.webhookSecret;
  webhook.secret = secret;
  return { ...settings, webhook };
}

export function projectChannelSettings(type: ChannelType, value: unknown): Record<string, unknown> {
  const stored = asRecord(value);
  const projected = asRecord(safeValue(stored));

  if (type === "TELEGRAM") {
    const storedTelegram = asRecord(stored.telegram);
    projected.telegram = {
      ...asRecord(projected.telegram),
      webhookConfigured:
        storedTelegram.webhookConfigured === true ||
        firstSecret(storedTelegram.webhookSecret, storedTelegram.webhookPendingSecret) !== null,
      previousBotCleanupPending:
        storedTelegram.previousBotCleanupPending === true ||
        nonEmptyString(storedTelegram.retiredBotEncryptedCredentials) !== null,
    };
  }

  if (type === "WEBHOOK") {
    const storedWebhook = asRecord(stored.webhook);
    const storedOutbound = asRecord(storedWebhook.outbound);
    const timeoutMs =
      typeof storedOutbound.timeoutMs === "number" && Number.isInteger(storedOutbound.timeoutMs)
        ? storedOutbound.timeoutMs
        : undefined;
    projected.webhook = {
      ...asRecord(projected.webhook),
      secretConfigured: webhookSecretFromSettings(stored) !== null,
      outbound: {
        targetConfigured: webhookOutboundConfigured(stored),
        authenticationConfigured: webhookOutboundAuthenticationConfigured(stored),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    };
  }

  return projected;
}

export function mergeChannelSettings(
  type: ChannelType,
  currentValue: unknown,
  patchValue: unknown,
  secretFactory: SecretFactory,
): Record<string, unknown> {
  const current = asRecord(currentValue);
  const patch = asRecord(patchValue);
  const merged = { ...current, ...patch };

  if (type === "TELEGRAM") {
    const currentTelegram = asRecord(current.telegram);
    const patchTelegram = asRecord(patch.telegram);
    const nextTelegram = { ...currentTelegram, ...patchTelegram };
    const activeSecret =
      firstSecret(currentTelegram.webhookSecret, current.webhookSecret) ??
      generatedSecret(secretFactory);
    const pendingSecret = nonEmptyString(currentTelegram.webhookPendingSecret);
    const pendingBotId = nonEmptyString(currentTelegram.webhookPendingBotId);
    const retiredCredentials = nonEmptyString(currentTelegram.retiredBotEncryptedCredentials);
    const retiredWebhookSecret = nonEmptyString(currentTelegram.retiredBotWebhookSecret);
    const retiredBotId = nonEmptyString(currentTelegram.retiredBotId);

    delete nextTelegram.webhookSecret;
    delete nextTelegram.webhookPendingSecret;
    delete nextTelegram.webhookPendingBotId;
    delete nextTelegram.retiredBotEncryptedCredentials;
    delete nextTelegram.retiredBotWebhookSecret;
    delete nextTelegram.retiredBotId;
    nextTelegram.webhookSecret = activeSecret;
    if (pendingSecret) nextTelegram.webhookPendingSecret = pendingSecret;
    if (pendingBotId) nextTelegram.webhookPendingBotId = pendingBotId;
    if (retiredCredentials) nextTelegram.retiredBotEncryptedCredentials = retiredCredentials;
    if (retiredWebhookSecret) nextTelegram.retiredBotWebhookSecret = retiredWebhookSecret;
    if (retiredBotId) nextTelegram.retiredBotId = retiredBotId;

    return {
      ...removeRootSecretAliases(merged),
      telegram: nextTelegram,
    };
  }

  if (type === "WEBHOOK") {
    const currentWebhook = asRecord(current.webhook);
    const patchWebhook = asRecord(patch.webhook);
    const nextWebhook = { ...currentWebhook, ...patchWebhook };
    if (Object.prototype.hasOwnProperty.call(patchWebhook, "outbound")) {
      if (patchWebhook.outbound === null) {
        delete nextWebhook.outbound;
      } else {
        const currentOutbound = asRecord(currentWebhook.outbound);
        const patchOutbound = asRecord(patchWebhook.outbound);
        const nextOutbound = { ...currentOutbound, ...patchOutbound };
        delete nextOutbound.headers;
        delete nextOutbound.targetConfigured;
        delete nextOutbound.authenticationConfigured;
        if (patchOutbound.targetUrl === null) delete nextOutbound.targetUrl;

        if (Object.prototype.hasOwnProperty.call(patchOutbound, "auth")) {
          if (patchOutbound.auth === null) {
            delete nextOutbound.auth;
          } else {
            const currentAuth = asRecord(currentOutbound.auth);
            const patchAuth = asRecord(patchOutbound.auth);
            const nextAuth = { ...currentAuth, ...patchAuth };
            const patchedSecret = nonEmptyString(patchAuth.secret);
            const currentSecret = nonEmptyString(currentAuth.secret);
            if (patchedSecret) nextAuth.secret = patchedSecret;
            else if (currentSecret) nextAuth.secret = currentSecret;
            else delete nextAuth.secret;
            nextOutbound.auth = nextAuth;
          }
        }
        nextWebhook.outbound = nextOutbound;
      }
    }
    const secret = webhookSecretFromSettings(current) ?? generatedSecret(secretFactory);

    delete nextWebhook.secret;
    delete nextWebhook.webhookSecret;
    return setWebhookSecret(
      {
        ...removeRootSecretAliases(merged),
        webhook: nextWebhook,
      },
      secret,
    );
  }

  return merged;
}
