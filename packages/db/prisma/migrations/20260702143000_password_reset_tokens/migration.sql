CREATE TABLE IF NOT EXISTS "AuthPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthPasswordResetToken_tokenHash_key" ON "AuthPasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AuthPasswordResetToken_userId_expiresAt_idx" ON "AuthPasswordResetToken"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "AuthPasswordResetToken_expiresAt_idx" ON "AuthPasswordResetToken"("expiresAt");

ALTER TABLE "AuthPasswordResetToken"
  ADD CONSTRAINT "AuthPasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
