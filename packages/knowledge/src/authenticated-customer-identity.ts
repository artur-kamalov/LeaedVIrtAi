import { createHash, createHmac } from "node:crypto";
import type { ChannelType } from "@leadvirt/types";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

function subjectHashKey() {
  const source =
    process.env.CUSTOMER_IDENTITY_HMAC_KEY?.trim() ||
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    process.env.ENCRYPTION_KEY?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "leadvirt-local-customer-identity");
  if (!source) throw new Error("Customer identity hashing is not configured.");
  return createHash("sha256").update(source).digest();
}

function serialized(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

export function authenticatedCustomerSubjectHash(input: {
  tenantId: string;
  channelId: string;
  provider: "TELEGRAM";
  externalSubjectId: string;
}) {
  return createHmac("sha256", subjectHashKey())
    .update(
      serialized([
        "leadvirt.authenticated-customer-subject.v1",
        input.tenantId,
        input.channelId,
        input.provider,
        input.externalSubjectId,
      ]),
    )
    .digest("hex");
}

export function authenticatedCustomerChannelBindingHash(input: {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  channelExternalId: string;
  channelPublicKey: string;
}) {
  return createHash("sha256")
    .update(
      serialized([
        "leadvirt.authenticated-customer-channel.v1",
        input.tenantId,
        input.channelId,
        input.channelType,
        input.channelExternalId,
        input.channelPublicKey,
      ]),
    )
    .digest("hex");
}

export function authenticatedCustomerIdentityAttestationHash(input: {
  tenantId: string;
  version: 1;
  channelId: string;
  conversationId: string;
  messageId: string;
  webhookEventId: string;
  provider: "TELEGRAM";
  authenticationMethod: "TELEGRAM_WEBHOOK_SECRET";
  subjectSource: "TELEGRAM_MESSAGE_FROM_ID";
  conversationType: "PRIVATE";
  subjectHash: string;
  channelBindingHash: string;
  eventPayloadHash: string;
  authenticatedAt: Date | string;
}) {
  const authenticatedAt =
    input.authenticatedAt instanceof Date
      ? input.authenticatedAt.toISOString()
      : new Date(input.authenticatedAt).toISOString();
  return createHash("sha256")
    .update(
      serialized([
        "leadvirt.authenticated-customer-attestation.v1",
        input.tenantId,
        input.version,
        input.channelId,
        input.conversationId,
        input.messageId,
        input.webhookEventId,
        input.provider,
        input.authenticationMethod,
        input.subjectSource,
        input.conversationType,
        input.subjectHash,
        input.channelBindingHash,
        input.eventPayloadHash,
        authenticatedAt,
      ]),
    )
    .digest("hex");
}

export function validAuthenticatedCustomerIdentityReference(value: unknown): value is {
  id: string;
  version: 1;
  subjectHash: string;
  attestationHash: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  return (
    typeof reference.id === "string" &&
    ID_PATTERN.test(reference.id) &&
    reference.version === 1 &&
    typeof reference.subjectHash === "string" &&
    HASH_PATTERN.test(reference.subjectHash) &&
    typeof reference.attestationHash === "string" &&
    HASH_PATTERN.test(reference.attestationHash)
  );
}
