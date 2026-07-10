ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "authMode" TEXT NOT NULL DEFAULT 'credentials';

UPDATE "AuthSession" AS session
SET "authMode" = 'telegram'
FROM "User" AS app_user
WHERE session."userId" = app_user."id"
  AND app_user."externalAuthId" LIKE 'telegram:%'
  AND session."authMode" = 'credentials';

CREATE TABLE IF NOT EXISTS "AuthEmailOtpChallenge" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthEmailOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthEmailOtpChallenge_email_createdAt_idx" ON "AuthEmailOtpChallenge"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "AuthEmailOtpChallenge_expiresAt_idx" ON "AuthEmailOtpChallenge"("expiresAt");
