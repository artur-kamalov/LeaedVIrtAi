BEGIN;

CREATE TYPE "AiReplyRunStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'SUCCEEDED',
  'SKIPPED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'TIMED_OUT',
  'SUPERSEDED',
  'DEAD_LETTER'
);

CREATE TYPE "ExternalOperationStatus" AS ENUM (
  'REQUESTED',
  'STARTED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'RECONCILED'
);

CREATE TYPE "RuntimeOutboxStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TYPE "RuntimeInboxStatus" AS ENUM (
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

ALTER TABLE "Conversation"
  ADD COLUMN "aiGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "aiReplySequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aiReplyFence" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Conversation_aiReplyFence_check" CHECK (
    "aiGeneration" > 0
    AND "aiReplySequence" >= 0
    AND "aiReplyFence" >= 0
    AND "aiReplyFence" <= "aiReplySequence"
  );

CREATE TABLE "AiReplyRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "inboundMessageId" TEXT NOT NULL,
  "replyMessageId" TEXT,
  "publicationId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "AiReplyRunStatus" NOT NULL DEFAULT 'QUEUED',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3),
  "payloadRef" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "traceId" TEXT,
  "traceParent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "cancelRequestedAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "AiReplyRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiReplyRun_sequenceRetry_check" CHECK (
    "generation" > 0
    AND "sequence" > 0
    AND "schemaVersion" > 0
    AND "attemptCount" >= 0
    AND "maxAttempts" > 0
  )
);

CREATE TABLE "ExternalOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "aiReplyRunId" TEXT,
  "conversationId" TEXT,
  "originatingMessageId" TEXT,
  "integrationId" TEXT,
  "operationKind" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "confirmationVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "ExternalOperationStatus" NOT NULL DEFAULT 'REQUESTED',
  "providerIdempotencyKey" TEXT,
  "externalReference" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "deadlineAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),

  CONSTRAINT "ExternalOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalOperation_attempt_check" CHECK (
    "confirmationVersion" > 0 AND "attemptCount" >= 0
  )
);

CREATE TABLE "ChannelDeliveryOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "channelId" TEXT,
  "provider" TEXT NOT NULL,
  "channelKey" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "deliveryVersion" INTEGER NOT NULL DEFAULT 1,
  "requestHash" TEXT NOT NULL,
  "status" "ExternalOperationStatus" NOT NULL DEFAULT 'REQUESTED',
  "providerIdempotencyKey" TEXT,
  "providerMessageId" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "deadlineAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),

  CONSTRAINT "ChannelDeliveryOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelDeliveryOperation_attempt_check" CHECK (
    "deliveryVersion" > 0 AND "attemptCount" >= 0
  )
);

CREATE TABLE "RuntimeOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "aggregateVersion" INTEGER NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "dedupeKey" TEXT NOT NULL,
  "payloadRef" TEXT,
  "payload" JSONB,
  "status" "RuntimeOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3),
  "maxAttempts" INTEGER NOT NULL DEFAULT 10,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lockExpiresAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "traceId" TEXT,
  "traceParent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RuntimeOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RuntimeOutbox_versionRetry_check" CHECK (
    "aggregateVersion" >= 0
    AND "generation" > 0
    AND "schemaVersion" > 0
    AND "maxAttempts" > 0
    AND "attemptCount" >= 0
  )
);

CREATE TABLE "RuntimeInbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "consumerName" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" "RuntimeInboxStatus" NOT NULL DEFAULT 'PROCESSING',
  "resultRef" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lockExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RuntimeInbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RuntimeInbox_generationAttempt_check" CHECK (
    "generation" > 0 AND "attemptCount" > 0
  )
);

CREATE UNIQUE INDEX "Channel_tenantId_id_key" ON "Channel"("tenantId", "id");
CREATE UNIQUE INDEX "Conversation_tenantId_id_key" ON "Conversation"("tenantId", "id");
CREATE UNIQUE INDEX "Message_tenantId_id_key" ON "Message"("tenantId", "id");
CREATE UNIQUE INDEX "IntegrationAccount_tenantId_id_key" ON "IntegrationAccount"("tenantId", "id");

CREATE UNIQUE INDEX "AiReplyRun_tenantId_replyMessageId_key" ON "AiReplyRun"("tenantId", "replyMessageId");
CREATE UNIQUE INDEX "AiReplyRun_tenantId_idempotencyKey_key" ON "AiReplyRun"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "AiReplyRun_tenantId_inboundMessageId_key" ON "AiReplyRun"("tenantId", "inboundMessageId");
CREATE UNIQUE INDEX "AiReplyRun_conversationId_sequence_key" ON "AiReplyRun"("conversationId", "sequence");
CREATE UNIQUE INDEX "AiReplyRun_tenantId_id_key" ON "AiReplyRun"("tenantId", "id");
CREATE INDEX "AiReplyRun_status_availableAt_createdAt_idx" ON "AiReplyRun"("status", "availableAt", "createdAt");
CREATE INDEX "AiReplyRun_tenantId_conversationId_generation_sequence_idx" ON "AiReplyRun"("tenantId", "conversationId", "generation", "sequence");
CREATE INDEX "AiReplyRun_tenantId_publicationId_idx" ON "AiReplyRun"("tenantId", "publicationId");

CREATE INDEX "ExternalOperation_tenantId_status_nextRetryAt_idx" ON "ExternalOperation"("tenantId", "status", "nextRetryAt");
CREATE INDEX "ExternalOperation_tenantId_aiReplyRunId_idx" ON "ExternalOperation"("tenantId", "aiReplyRunId");
CREATE INDEX "ExternalOperation_origin_idx" ON "ExternalOperation"("tenantId", "conversationId", "originatingMessageId");
CREATE INDEX "ExternalOperation_tenantId_integrationId_operationKind_idx" ON "ExternalOperation"("tenantId", "integrationId", "operationKind");
CREATE INDEX "ExternalOperation_status_retentionExpiresAt_idx" ON "ExternalOperation"("status", "retentionExpiresAt");

CREATE UNIQUE INDEX "ChannelDeliveryOperation_deliveryIdentity_key"
  ON "ChannelDeliveryOperation"("tenantId", "messageId", "channelKey", "recipientKey", "deliveryVersion");
CREATE INDEX "ChannelDeliveryOperation_tenantId_status_nextRetryAt_idx" ON "ChannelDeliveryOperation"("tenantId", "status", "nextRetryAt");
CREATE INDEX "ChannelDeliveryOperation_tenantId_conversationId_createdAt_idx" ON "ChannelDeliveryOperation"("tenantId", "conversationId", "createdAt");
CREATE INDEX "ChannelDeliveryOperation_tenantId_channelId_provider_idx" ON "ChannelDeliveryOperation"("tenantId", "channelId", "provider");
CREATE INDEX "ChannelDeliveryOperation_provider_providerMessageId_idx" ON "ChannelDeliveryOperation"("provider", "providerMessageId");
CREATE INDEX "ChannelDeliveryOperation_status_retentionExpiresAt_idx" ON "ChannelDeliveryOperation"("status", "retentionExpiresAt");

CREATE UNIQUE INDEX "RuntimeOutbox_tenantId_dedupeKey_key" ON "RuntimeOutbox"("tenantId", "dedupeKey");
CREATE UNIQUE INDEX "RuntimeOutbox_aggregateEvent_key"
  ON "RuntimeOutbox"("tenantId", "aggregateType", "aggregateId", "aggregateVersion", "generation", "eventType");
CREATE INDEX "RuntimeOutbox_status_availableAt_createdAt_idx" ON "RuntimeOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "RuntimeOutbox_status_lockExpiresAt_idx" ON "RuntimeOutbox"("status", "lockExpiresAt");
CREATE INDEX "RuntimeOutbox_aggregateVersion_idx"
  ON "RuntimeOutbox"("tenantId", "aggregateType", "aggregateId", "aggregateVersion");

CREATE UNIQUE INDEX "RuntimeInbox_consumerName_eventId_key" ON "RuntimeInbox"("consumerName", "eventId");
CREATE INDEX "RuntimeInbox_tenantId_status_receivedAt_idx" ON "RuntimeInbox"("tenantId", "status", "receivedAt");
CREATE INDEX "RuntimeInbox_status_lockExpiresAt_updatedAt_idx" ON "RuntimeInbox"("status", "lockExpiresAt", "updatedAt");

ALTER TABLE "AiReplyRun"
  ADD CONSTRAINT "AiReplyRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AiReplyRun_tenant_conversation_fkey"
  FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "AiReplyRun_tenant_inbound_fkey"
  FOREIGN KEY ("tenantId", "inboundMessageId") REFERENCES "Message"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "AiReplyRun_tenant_reply_fkey"
  FOREIGN KEY ("tenantId", "replyMessageId") REFERENCES "Message"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "AiReplyRun_tenant_publication_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "KnowledgePublication"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ExternalOperation"
  ADD CONSTRAINT "ExternalOperation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalOperation_tenant_run_fkey"
  FOREIGN KEY ("tenantId", "aiReplyRunId") REFERENCES "AiReplyRun"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalOperation_tenant_conversation_fkey"
  FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalOperation_tenant_message_fkey"
  FOREIGN KEY ("tenantId", "originatingMessageId") REFERENCES "Message"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalOperation_tenant_integration_fkey"
  FOREIGN KEY ("tenantId", "integrationId") REFERENCES "IntegrationAccount"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ChannelDeliveryOperation"
  ADD CONSTRAINT "ChannelDeliveryOperation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChannelDeliveryOperation_tenant_message_fkey"
  FOREIGN KEY ("tenantId", "messageId") REFERENCES "Message"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ChannelDeliveryOperation_tenant_conversation_fkey"
  FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ChannelDeliveryOperation_tenant_channel_fkey"
  FOREIGN KEY ("tenantId", "channelId") REFERENCES "Channel"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "RuntimeOutbox"
  ADD CONSTRAINT "RuntimeOutbox_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RuntimeInbox"
  ADD CONSTRAINT "RuntimeInbox_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
