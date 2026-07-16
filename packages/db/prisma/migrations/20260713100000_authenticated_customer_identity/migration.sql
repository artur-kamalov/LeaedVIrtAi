BEGIN;

CREATE TABLE "AuthenticatedCustomerIdentity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "channelId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "webhookEventId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "authenticationMethod" TEXT NOT NULL,
  "subjectSource" TEXT NOT NULL,
  "conversationType" TEXT NOT NULL,
  "subjectHash" TEXT NOT NULL,
  "channelBindingHash" TEXT NOT NULL,
  "eventPayloadHash" TEXT NOT NULL,
  "attestationHash" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthenticatedCustomerIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthenticatedCustomerIdentity_contract_check" CHECK (
    "version" = 1
    AND "provider" = 'TELEGRAM'
    AND "authenticationMethod" = 'TELEGRAM_WEBHOOK_SECRET'
    AND "subjectSource" = 'TELEGRAM_MESSAGE_FROM_ID'
    AND "conversationType" = 'PRIVATE'
    AND "subjectHash" ~ '^[a-f0-9]{64}$'
    AND "channelBindingHash" ~ '^[a-f0-9]{64}$'
    AND "eventPayloadHash" ~ '^[a-f0-9]{64}$'
    AND "attestationHash" ~ '^[a-f0-9]{64}$'
    AND "authenticatedAt" <= "createdAt" + INTERVAL '1 minute'
  )
);

CREATE UNIQUE INDEX "AuthenticatedCustomerIdentity_tenant_id_key"
  ON "AuthenticatedCustomerIdentity"("tenantId", "id");
CREATE UNIQUE INDEX "AuthenticatedCustomerIdentity_tenant_message_key"
  ON "AuthenticatedCustomerIdentity"("tenantId", "messageId");
CREATE UNIQUE INDEX "AuthenticatedCustomerIdentity_tenant_conversation_message_key"
  ON "AuthenticatedCustomerIdentity"("tenantId", "conversationId", "messageId");
CREATE INDEX "AuthenticatedCustomerIdentity_tenant_channel_authenticated_idx"
  ON "AuthenticatedCustomerIdentity"("tenantId", "channelId", "authenticatedAt");
CREATE INDEX "AuthenticatedCustomerIdentity_tenant_subject_authenticated_idx"
  ON "AuthenticatedCustomerIdentity"("tenantId", "subjectHash", "authenticatedAt");
CREATE INDEX "AuthenticatedCustomerIdentity_webhook_event_idx"
  ON "AuthenticatedCustomerIdentity"("webhookEventId");

ALTER TABLE "AuthenticatedCustomerIdentity"
  ADD CONSTRAINT "AuthenticatedCustomerIdentity_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "AuthenticatedCustomerIdentity_conversation_channel_fkey"
  FOREIGN KEY ("tenantId", "conversationId", "channelId")
  REFERENCES "Conversation"("tenantId", "id", "channelId")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "AuthenticatedCustomerIdentity_message_fkey"
  FOREIGN KEY ("tenantId", "conversationId", "messageId")
  REFERENCES "Message"("tenantId", "conversationId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "AuthenticatedCustomerIdentity_webhook_event_fkey"
  FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2LiveToolExecution"
  ADD COLUMN "customerIdentityId" TEXT,
  ADD COLUMN "customerIdentityVersion" INTEGER,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_customer_identity_pair_check" CHECK (
    ("customerIdentityId" IS NULL AND "customerIdentityVersion" IS NULL)
    OR (
      "customerIdentityId" IS NOT NULL
      AND "customerIdentityVersion" = 1
    )
  ),
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_customer_identity_fkey"
  FOREIGN KEY ("tenantId", "customerIdentityId")
  REFERENCES "AuthenticatedCustomerIdentity"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_customer_identity_idx"
  ON "KnowledgeV2LiveToolExecution"(
    "tenantId",
    "customerIdentityId",
    "customerIdentityVersion"
  );

CREATE OR REPLACE FUNCTION "AuthenticatedCustomerIdentity_validate_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $authenticated_customer_identity_validate_insert$
DECLARE
  valid_boundary BOOLEAN;
BEGIN
  SELECT TRUE
  INTO valid_boundary
  FROM "Message" AS message
  JOIN "Conversation" AS conversation
    ON conversation."tenantId" = message."tenantId"
    AND conversation."id" = message."conversationId"
  JOIN "Channel" AS channel
    ON channel."tenantId" = conversation."tenantId"
    AND channel."id" = conversation."channelId"
  JOIN "WebhookEvent" AS event
    ON event."id" = NEW."webhookEventId"
  WHERE message."tenantId" = NEW."tenantId"
    AND message."conversationId" = NEW."conversationId"
    AND message."id" = NEW."messageId"
    AND message."direction" = 'INBOUND'
    AND message."senderType" = 'CUSTOMER'
    AND conversation."channelId" = NEW."channelId"
    AND conversation."deletedAt" IS NULL
    AND conversation."externalConversationId" LIKE 'telegram:%'
    AND channel."type" = 'TELEGRAM'
    AND channel."status" = 'ACTIVE'
    AND channel."deletedAt" IS NULL
    AND channel."externalId" IS NOT NULL
    AND channel."publicKey" IS NOT NULL
    AND event."tenantId" = NEW."tenantId"
    AND event."provider" = 'telegram:' || NEW."channelId"
    AND event."payloadHash" = NEW."eventPayloadHash"
    AND event."receivedAt" = NEW."authenticatedAt"
    AND event."status" IN ('RECEIVED', 'PROCESSED');

  IF valid_boundary IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'authenticated customer identity boundary is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$authenticated_customer_identity_validate_insert$;

CREATE OR REPLACE FUNCTION "AuthenticatedCustomerIdentity_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $authenticated_customer_identity_reject_mutation$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'authenticated customer identity % is immutable', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId"
  ) THEN
    RAISE EXCEPTION 'authenticated customer identity % cannot be deleted directly', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$authenticated_customer_identity_reject_mutation$;

CREATE TRIGGER "AuthenticatedCustomerIdentity_validate"
BEFORE INSERT ON "AuthenticatedCustomerIdentity"
FOR EACH ROW EXECUTE FUNCTION "AuthenticatedCustomerIdentity_validate_insert"();

CREATE TRIGGER "AuthenticatedCustomerIdentity_immutable"
BEFORE UPDATE OR DELETE ON "AuthenticatedCustomerIdentity"
FOR EACH ROW EXECUTE FUNCTION "AuthenticatedCustomerIdentity_reject_mutation"();

COMMIT;
