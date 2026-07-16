BEGIN;

ALTER TABLE "IntegrationAccount"
  ADD COLUMN "permissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "IntegrationAccount_permissionVersion_check" CHECK ("permissionVersion" > 0);

CREATE UNIQUE INDEX "Lead_tenantId_id_key" ON "Lead"("tenantId", "id");
CREATE UNIQUE INDEX "AiReplyRun_liveToolContext_key"
  ON "AiReplyRun"("tenantId", "id", "conversationId", "inboundMessageId");

CREATE TABLE "TenantOperationalAuthorizationState" (
  "tenantId" TEXT NOT NULL,
  "permissionGeneration" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantOperationalAuthorizationState_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "TenantOperationalAuthorizationState_generation_check"
    CHECK ("permissionGeneration" > 0)
);

INSERT INTO "TenantOperationalAuthorizationState" (
  "tenantId",
  "permissionGeneration",
  "updatedAt"
)
SELECT "id", 1, CURRENT_TIMESTAMP
FROM "Tenant"
ON CONFLICT ("tenantId") DO NOTHING;

CREATE TABLE "KnowledgeV2LiveToolExecution" (
  "id" TEXT NOT NULL,
  "executionKey" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "aiReplyRunId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "originatingMessageId" TEXT NOT NULL,
  "leadId" TEXT,
  "executionContextId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "toolKey" TEXT NOT NULL,
  "toolVersion" TEXT NOT NULL,
  "safeName" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "operationalCategory" TEXT NOT NULL,
  "toolPolicyVersion" TEXT NOT NULL,
  "queryHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "authorizationScopeHash" TEXT NOT NULL,
  "authorizationDecisionId" TEXT NOT NULL,
  "permissionGeneration" INTEGER NOT NULL,
  "connectionId" TEXT,
  "connectionPermissionVersion" INTEGER,
  "subjectHash" TEXT NOT NULL,
  "resultType" TEXT NOT NULL,
  "valueHash" TEXT NOT NULL,
  "exactValueHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "envelopeHash" TEXT NOT NULL,
  "payloadObjectKey" TEXT NOT NULL,
  "payloadEncryptionKeyRef" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payloadBytes" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL,
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeV2LiveToolExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeV2LiveToolExecution_values_check" CHECK (
    char_length("id") BETWEEN 1 AND 150
    AND "id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "executionKey" ~ '^[a-f0-9]{64}$'
    AND char_length("executionContextId") BETWEEN 1 AND 200
    AND "executionContextId" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "attemptNumber" > 0
    AND char_length("toolCallId") BETWEEN 1 AND 200
    AND "toolCallId" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND char_length("toolKey") BETWEEN 1 AND 200
    AND "toolKey" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND char_length("toolVersion") BETWEEN 1 AND 200
    AND "toolVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND char_length(btrim("safeName")) BETWEEN 1 AND 500
    AND char_length("sourceSystem") BETWEEN 1 AND 200
    AND "sourceSystem" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "operationalCategory" IN (
      'AVAILABILITY',
      'BOOKING_STATE',
      'INVENTORY',
      'ORDER_STATE',
      'ACCOUNT_STATE'
    )
    AND char_length("toolPolicyVersion") BETWEEN 1 AND 200
    AND "toolPolicyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "queryHash" ~ '^[a-f0-9]{64}$'
    AND "requestHash" ~ '^[a-f0-9]{64}$'
    AND "authorizationScopeHash" ~ '^[a-f0-9]{64}$'
    AND char_length("authorizationDecisionId") BETWEEN 1 AND 200
    AND "authorizationDecisionId" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "permissionGeneration" > 0
    AND (
      ("connectionId" IS NULL AND "connectionPermissionVersion" IS NULL)
      OR (
        "connectionId" IS NOT NULL
        AND "connectionPermissionVersion" IS NOT NULL
        AND "connectionPermissionVersion" > 0
      )
    )
    AND "subjectHash" ~ '^[a-f0-9]{64}$'
    AND char_length("resultType") BETWEEN 1 AND 200
    AND "resultType" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "valueHash" ~ '^[a-f0-9]{64}$'
    AND "exactValueHash" ~ '^[a-f0-9]{64}$'
    AND "contentHash" ~ '^[a-f0-9]{64}$'
    AND "envelopeHash" ~ '^[a-f0-9]{64}$'
    AND char_length(btrim("payloadObjectKey")) BETWEEN 1 AND 1024
    AND char_length(btrim("payloadEncryptionKeyRef")) BETWEEN 1 AND 512
    AND "payloadHash" ~ '^[a-f0-9]{64}$'
    AND "payloadBytes" BETWEEN 1 AND 1048576
    AND "authorizedAt" <= "observedAt"
    AND "observedAt" <= "createdAt" + INTERVAL '1 minute'
    AND "expiresAt" > "createdAt" - INTERVAL '1 minute'
    AND "expiresAt" > "observedAt"
    AND "expiresAt" <= "observedAt" + INTERVAL '5 minutes'
    AND "authorizationExpiresAt" > "createdAt" - INTERVAL '1 minute'
    AND "authorizationExpiresAt" >= "expiresAt"
    AND "authorizationExpiresAt" > "authorizedAt"
    AND "retentionExpiresAt" >= "authorizationExpiresAt"
  )
);

CREATE UNIQUE INDEX "KnowledgeV2LiveToolExecution_tenant_execution_key"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "executionKey");
CREATE UNIQUE INDEX "KnowledgeV2LiveToolExecution_tenant_id_key"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "id");
CREATE UNIQUE INDEX "KnowledgeV2LiveToolExecution_payload_object_key"
  ON "KnowledgeV2LiveToolExecution"("payloadObjectKey");
CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_run_attempt_idx"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "aiReplyRunId", "attemptNumber");
CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_conversation_created_idx"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "conversationId", "createdAt");
CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_connection_version_idx"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "connectionId", "connectionPermissionVersion");
CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_category_created_idx"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "operationalCategory", "createdAt");
CREATE INDEX "KnowledgeV2LiveToolExecution_expiresAt_idx"
  ON "KnowledgeV2LiveToolExecution"("expiresAt");
CREATE INDEX "KnowledgeV2LiveToolExecution_retentionExpiresAt_idx"
  ON "KnowledgeV2LiveToolExecution"("retentionExpiresAt");
CREATE INDEX "KnowledgeV2LiveToolExecution_tenant_decision_idx"
  ON "KnowledgeV2LiveToolExecution"("tenantId", "authorizationDecisionId");

ALTER TABLE "TenantOperationalAuthorizationState"
  ADD CONSTRAINT "TenantOperationalAuthorizationState_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2LiveToolExecution"
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_run_context_fkey"
  FOREIGN KEY ("tenantId", "aiReplyRunId", "conversationId", "originatingMessageId")
  REFERENCES "AiReplyRun"("tenantId", "id", "conversationId", "inboundMessageId")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_conversation_fkey"
  FOREIGN KEY ("tenantId", "conversationId")
  REFERENCES "Conversation"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_message_fkey"
  FOREIGN KEY ("tenantId", "conversationId", "originatingMessageId")
  REFERENCES "Message"("tenantId", "conversationId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_lead_fkey"
  FOREIGN KEY ("tenantId", "leadId") REFERENCES "Lead"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "KnowledgeV2LiveToolExecution_connection_fkey"
  FOREIGN KEY ("tenantId", "connectionId")
  REFERENCES "IntegrationAccount"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeV2EvidenceReference"
  ADD CONSTRAINT "KnowledgeV2EvidenceReference_liveToolExecution_fkey"
  FOREIGN KEY ("tenantId", "toolResultRef")
  REFERENCES "KnowledgeV2LiveToolExecution"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

DO $knowledge_v2_live_tool_validate_reference$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "KnowledgeV2EvidenceReference" AS evidence
    LEFT JOIN "KnowledgeV2LiveToolExecution" AS execution
      ON execution."tenantId" = evidence."tenantId"
      AND execution."id" = evidence."toolResultRef"
    WHERE evidence."targetType" = 'TOOL_RESULT'
      AND execution."id" IS NULL
  ) THEN
    ALTER TABLE "KnowledgeV2EvidenceReference"
      VALIDATE CONSTRAINT "KnowledgeV2EvidenceReference_liveToolExecution_fkey";
  END IF;
END;
$knowledge_v2_live_tool_validate_reference$;

CREATE OR REPLACE FUNCTION "TenantOperationalAuthorization_bump"(target_tenant_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $tenant_operational_authorization_bump$
BEGIN
  IF target_tenant_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "TenantOperationalAuthorizationState" (
    "tenantId",
    "permissionGeneration",
    "updatedAt"
  )
  VALUES (target_tenant_id, 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("tenantId") DO UPDATE
  SET
    "permissionGeneration" =
      "TenantOperationalAuthorizationState"."permissionGeneration" + 1,
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$tenant_operational_authorization_bump$;

CREATE OR REPLACE FUNCTION "TenantOperationalAuthorization_initialize_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $tenant_operational_authorization_initialize$
BEGIN
  INSERT INTO "TenantOperationalAuthorizationState" (
    "tenantId",
    "permissionGeneration",
    "updatedAt"
  )
  VALUES (NEW."id", 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("tenantId") DO NOTHING;
  RETURN NEW;
END;
$tenant_operational_authorization_initialize$;

CREATE OR REPLACE FUNCTION "TenantOperationalAuthorization_bump_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $tenant_operational_authorization_bump_tenant$
BEGIN
  PERFORM "TenantOperationalAuthorization_bump"(NEW."id");
  RETURN NEW;
END;
$tenant_operational_authorization_bump_tenant$;

CREATE OR REPLACE FUNCTION "TenantOperationalAuthorization_bump_related"()
RETURNS trigger
LANGUAGE plpgsql
AS $tenant_operational_authorization_bump_related$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId"
    ) THEN
      RETURN OLD;
    END IF;

    PERFORM "TenantOperationalAuthorization_bump"(OLD."tenantId");
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    PERFORM "TenantOperationalAuthorization_bump"(OLD."tenantId");
  END IF;
  PERFORM "TenantOperationalAuthorization_bump"(NEW."tenantId");
  RETURN NEW;
END;
$tenant_operational_authorization_bump_related$;

CREATE OR REPLACE FUNCTION "IntegrationAccount_advance_permission_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $integration_account_permission_version$
BEGIN
  IF (
    OLD."tenantId",
    OLD."provider",
    OLD."status",
    OLD."scopes",
    OLD."settings",
    OLD."encryptedCredentials",
    OLD."connectedAt",
    OLD."deletedAt"
  ) IS DISTINCT FROM (
    NEW."tenantId",
    NEW."provider",
    NEW."status",
    NEW."scopes",
    NEW."settings",
    NEW."encryptedCredentials",
    NEW."connectedAt",
    NEW."deletedAt"
  ) THEN
    NEW."permissionVersion" := OLD."permissionVersion" + 1;
  ELSE
    NEW."permissionVersion" := OLD."permissionVersion";
  END IF;
  RETURN NEW;
END;
$integration_account_permission_version$;

CREATE OR REPLACE FUNCTION "TenantOperationalAuthorization_enforce_monotonic"()
RETURNS trigger
LANGUAGE plpgsql
AS $tenant_operational_authorization_monotonic$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId"
    ) THEN
      RAISE EXCEPTION 'tenant operational authorization state cannot be deleted directly'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."permissionGeneration" <> OLD."permissionGeneration" + 1
  THEN
    RAISE EXCEPTION 'tenant operational authorization generation must advance exactly once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$tenant_operational_authorization_monotonic$;

CREATE OR REPLACE FUNCTION "KnowledgeV2_reject_live_tool_execution_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $knowledge_v2_live_tool_execution_immutable$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'knowledge live-tool execution % is immutable', OLD."id"
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId"
    ) THEN
      RAISE EXCEPTION 'knowledge live-tool execution % cannot be deleted directly', OLD."id"
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN OLD;
END;
$knowledge_v2_live_tool_execution_immutable$;

CREATE TRIGGER "TenantOperationalAuthorization_initialize"
AFTER INSERT ON "Tenant"
FOR EACH ROW EXECUTE FUNCTION "TenantOperationalAuthorization_initialize_tenant"();

CREATE TRIGGER "TenantOperationalAuthorization_tenant_update"
AFTER UPDATE OF "status", "settings", "deletedAt" ON "Tenant"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."settings" IS DISTINCT FROM NEW."settings"
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
)
EXECUTE FUNCTION "TenantOperationalAuthorization_bump_tenant"();

CREATE TRIGGER "TenantOperationalAuthorization_membership_insert_delete"
AFTER INSERT OR DELETE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "TenantOperationalAuthorization_membership_update"
AFTER UPDATE OF "tenantId", "userId", "role" ON "Membership"
FOR EACH ROW
WHEN (
  OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
  OR OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."role" IS DISTINCT FROM NEW."role"
)
EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "TenantOperationalAuthorization_channel_insert_delete"
AFTER INSERT OR DELETE ON "Channel"
FOR EACH ROW EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "TenantOperationalAuthorization_channel_update"
AFTER UPDATE OF
  "tenantId",
  "type",
  "status",
  "externalId",
  "publicKey",
  "settings",
  "encryptedCredentials",
  "deletedAt"
ON "Channel"
FOR EACH ROW
WHEN (
  OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
  OR OLD."type" IS DISTINCT FROM NEW."type"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."externalId" IS DISTINCT FROM NEW."externalId"
  OR OLD."publicKey" IS DISTINCT FROM NEW."publicKey"
  OR OLD."settings" IS DISTINCT FROM NEW."settings"
  OR OLD."encryptedCredentials" IS DISTINCT FROM NEW."encryptedCredentials"
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
)
EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "IntegrationAccount_permission_version"
BEFORE UPDATE ON "IntegrationAccount"
FOR EACH ROW EXECUTE FUNCTION "IntegrationAccount_advance_permission_version"();

CREATE TRIGGER "TenantOperationalAuthorization_monotonic"
BEFORE UPDATE OR DELETE ON "TenantOperationalAuthorizationState"
FOR EACH ROW EXECUTE FUNCTION "TenantOperationalAuthorization_enforce_monotonic"();

CREATE TRIGGER "TenantOperationalAuthorization_integration_insert_delete"
AFTER INSERT OR DELETE ON "IntegrationAccount"
FOR EACH ROW EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "TenantOperationalAuthorization_integration_update"
AFTER UPDATE OF
  "tenantId",
  "provider",
  "status",
  "scopes",
  "settings",
  "encryptedCredentials",
  "connectedAt",
  "deletedAt"
ON "IntegrationAccount"
FOR EACH ROW
WHEN (
  OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
  OR OLD."provider" IS DISTINCT FROM NEW."provider"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."scopes" IS DISTINCT FROM NEW."scopes"
  OR OLD."settings" IS DISTINCT FROM NEW."settings"
  OR OLD."encryptedCredentials" IS DISTINCT FROM NEW."encryptedCredentials"
  OR OLD."connectedAt" IS DISTINCT FROM NEW."connectedAt"
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
)
EXECUTE FUNCTION "TenantOperationalAuthorization_bump_related"();

CREATE TRIGGER "KnowledgeV2LiveToolExecution_immutable"
BEFORE UPDATE OR DELETE ON "KnowledgeV2LiveToolExecution"
FOR EACH ROW EXECUTE FUNCTION "KnowledgeV2_reject_live_tool_execution_mutation"();

COMMIT;
