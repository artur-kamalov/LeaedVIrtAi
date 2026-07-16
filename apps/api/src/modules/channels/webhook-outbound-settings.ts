import { BadRequestException } from "@nestjs/common";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  readWebhookOutboundConfiguration,
  webhookOutboundConfigured,
} from "@leadvirt/integrations";

const WEBHOOK_OUTBOUND_SECRET_KEY = "webhookOutboundSecret";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function prepareWebhookOutboundStorage(
  settingsValue: unknown,
  encryptedCredentials: string | null,
) {
  const settings = asRecord(settingsValue);
  const webhook = asRecord(settings.webhook);
  const outbound = asRecord(webhook.outbound);
  const auth = asRecord(outbound.auth);
  const credentials = encryptedCredentials
    ? decryptIntegrationCredentials(encryptedCredentials)
    : {};
  const incomingSecret = nonEmptyString(auth.secret) ?? nonEmptyString(outbound.secret);
  const existingSecret = nonEmptyString(credentials[WEBHOOK_OUTBOUND_SECRET_KEY]);
  const hasAuthContract = Object.keys(auth).length > 0 || outbound.secret !== undefined;
  let credentialsChanged = false;

  if (incomingSecret && incomingSecret !== existingSecret) {
    credentials[WEBHOOK_OUTBOUND_SECRET_KEY] = incomingSecret;
    credentialsChanged = true;
  } else if (!hasAuthContract && existingSecret) {
    delete credentials[WEBHOOK_OUTBOUND_SECRET_KEY];
    credentialsChanged = true;
  }

  const nextAuth = { ...auth };
  delete nextAuth.secret;
  const managedSecret = incomingSecret ?? existingSecret;
  if (hasAuthContract && managedSecret) nextAuth.configured = true;
  else delete nextAuth.configured;
  const nextOutbound = { ...outbound };
  delete nextOutbound.secret;
  nextOutbound.auth = nextAuth;
  const settingsWithoutCredential = {
    ...settings,
    webhook: {
      ...webhook,
      outbound: nextOutbound,
    },
  };
  const nextEncryptedCredentials = credentialsChanged
    ? Object.keys(credentials).length > 0
      ? encryptIntegrationCredentials(credentials)
      : null
    : encryptedCredentials;
  return {
    settings: settingsWithoutCredential,
    encryptedCredentials: nextEncryptedCredentials,
    credentials,
  };
}

export function validateConfiguredWebhookOutbound(settings: unknown, credentials?: unknown) {
  if (!webhookOutboundConfigured(settings)) return;
  try {
    readWebhookOutboundConfiguration(settings, credentials);
  } catch {
    throw new BadRequestException(
      "Outbound webhook settings require a valid public HTTPS target and header credential.",
    );
  }
}
