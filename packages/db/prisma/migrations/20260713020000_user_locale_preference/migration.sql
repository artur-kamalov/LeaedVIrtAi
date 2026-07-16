ALTER TABLE "User" ADD COLUMN "locale" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_locale_check"
  CHECK ("locale" IS NULL OR "locale" IN ('en', 'es', 'fr', 'de', 'pt', 'ru'));
