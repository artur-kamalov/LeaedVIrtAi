BEGIN;

ALTER TABLE "WebhookEvent"
  ADD COLUMN "processingAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseAcquiredAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "intakeCompletedAt" TIMESTAMP(3),
  ADD COLUMN "aiDispatchCompletedAt" TIMESTAMP(3),
  ADD COLUMN "workflowDispatchCompletedAt" TIMESTAMP(3);

UPDATE "WebhookEvent"
SET
  "processingAttempt" = 1,
  "leaseToken" = 'migration:' || "id",
  "leaseAcquiredAt" = "receivedAt",
  "leaseExpiresAt" = "receivedAt" + INTERVAL '5 minutes'
WHERE "status" = 'RECEIVED';

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_processingAttempt_check"
  CHECK ("processingAttempt" >= 0),
  ADD CONSTRAINT "WebhookEvent_lease_pair_check"
  CHECK (
    ("leaseToken" IS NULL AND "leaseAcquiredAt" IS NULL AND "leaseExpiresAt" IS NULL)
    OR (
      "leaseToken" IS NOT NULL
      AND "leaseAcquiredAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > "leaseAcquiredAt"
    )
  );

CREATE INDEX "WebhookEvent_status_leaseExpiresAt_idx"
  ON "WebhookEvent"("status", "leaseExpiresAt");

ALTER TABLE "WorkflowRun"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "inputHash" TEXT;

CREATE UNIQUE INDEX "WorkflowRun_tenantId_workflowId_idempotencyKey_key"
  ON "WorkflowRun"("tenantId", "workflowId", "idempotencyKey");

COMMIT;
