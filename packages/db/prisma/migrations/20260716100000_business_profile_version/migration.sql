BEGIN;

ALTER TABLE "OnboardingState"
  ADD COLUMN "businessProfileVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "businessProfileUpdatedAt" TIMESTAMP(3);

UPDATE "OnboardingState"
SET "businessProfileUpdatedAt" = "updatedAt";

ALTER TABLE "OnboardingState"
  ALTER COLUMN "businessProfileUpdatedAt" SET NOT NULL,
  ALTER COLUMN "businessProfileUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
