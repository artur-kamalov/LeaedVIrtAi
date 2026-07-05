import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const migrationUrl = new URL(
  "./migrations/20260619154500_phase_2_core/migration.sql",
  import.meta.url,
);
const authSessionsMigrationUrl = new URL(
  "./migrations/20260627120000_auth_sessions/migration.sql",
  import.meta.url,
);
const authSessionMetadataMigrationUrl = new URL(
  "./migrations/20260627123000_auth_session_metadata/migration.sql",
  import.meta.url,
);
const passwordChangeRequiredMigrationUrl = new URL(
  "./migrations/20260627124500_password_change_required/migration.sql",
  import.meta.url,
);
const userTwoFactorMigrationUrl = new URL(
  "./migrations/20260702140000_user_two_factor/migration.sql",
  import.meta.url,
);
const passwordResetTokensMigrationUrl = new URL(
  "./migrations/20260702143000_password_reset_tokens/migration.sql",
  import.meta.url,
);
const userPhoneMigrationUrl = new URL(
  "./migrations/20260705120000_user_phone/migration.sql",
  import.meta.url,
);

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to apply database migrations.");
  }

  return databaseUrl;
}

function getDatabaseName(databaseUrl: string) {
  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return databaseName;
}

function getMaintenanceDatabaseUrl(databaseUrl: string) {
  const parsedUrl = new URL(databaseUrl);
  parsedUrl.pathname = "/postgres";
  return parsedUrl.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureDatabaseExists(databaseUrl: string) {
  const databaseName = getDatabaseName(databaseUrl);

  if (databaseName === "postgres") {
    return;
  }

  const maintenanceClient = new PrismaClient({
    datasources: { db: { url: getMaintenanceDatabaseUrl(databaseUrl) } },
  });

  try {
    const rows = await maintenanceClient.$queryRawUnsafe<Array<{ exists: boolean }>>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS \"exists\"",
      databaseName,
    );

    if (!rows[0]?.exists) {
      await maintenanceClient.$executeRawUnsafe(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
      console.log(`Created database "${databaseName}".`);
    }
  } finally {
    await maintenanceClient.$disconnect();
  }
}

async function hasCoreSchema(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'Tenant'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasAuthSessionSchema(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_table: boolean; has_password_hash: boolean }>>`
    SELECT
      EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'AuthSession'
      ) AS "has_table",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'passwordHash'
      ) AS "has_password_hash"
  `;

  return (rows[0]?.has_table ?? false) && (rows[0]?.has_password_hash ?? false);
}

async function hasAuthSessionMetadata(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_ip_address: boolean; has_user_agent: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthSession'
          AND column_name = 'ipAddress'
      ) AS "has_ip_address",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AuthSession'
          AND column_name = 'userAgent'
      ) AS "has_user_agent"
  `;

  return (rows[0]?.has_ip_address ?? false) && (rows[0]?.has_user_agent ?? false);
}

async function hasPasswordChangeRequired(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'passwordChangeRequired'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasUserTwoFactor(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ has_enabled: boolean; has_secret: boolean; has_recovery: boolean; has_confirmed: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorEnabled'
      ) AS "has_enabled",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorSecretEncrypted'
      ) AS "has_secret",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorRecoveryCodes'
      ) AS "has_recovery",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'twoFactorConfirmedAt'
      ) AS "has_confirmed"
  `;

  const row = rows[0];
  return Boolean(row?.has_enabled && row.has_secret && row.has_recovery && row.has_confirmed);
}

async function hasPasswordResetTokens(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'AuthPasswordResetToken'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function hasUserPhone(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'phone'
    ) AS "exists"
  `;

  return rows[0]?.exists ?? false;
}

async function applySqlFile(prisma: PrismaClient, url: URL) {
  const sql = await readFile(url, "utf8");
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  return statements.length;
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  await ensureDatabaseExists(databaseUrl);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    if (await hasCoreSchema(prisma)) {
      console.log("Database schema already exists; skipping phase_2_core migration.");
    } else {
      const statementCount = await applySqlFile(prisma, migrationUrl);
      console.log(`Applied phase_2_core migration (${statementCount} statements).`);
    }

    if (await hasAuthSessionSchema(prisma)) {
      console.log("Auth session schema already exists; skipping auth_sessions migration.");
    } else {
      const statementCount = await applySqlFile(prisma, authSessionsMigrationUrl);
      console.log(`Applied auth_sessions migration (${statementCount} statements).`);
    }

    if (await hasAuthSessionMetadata(prisma)) {
      console.log("Auth session metadata columns already exist; skipping auth_session_metadata migration.");
    } else {
      const statementCount = await applySqlFile(prisma, authSessionMetadataMigrationUrl);
      console.log(`Applied auth_session_metadata migration (${statementCount} statements).`);
    }

    if (await hasPasswordChangeRequired(prisma)) {
      console.log("Password change required column already exists; skipping password_change_required migration.");
    } else {
      const statementCount = await applySqlFile(prisma, passwordChangeRequiredMigrationUrl);
      console.log(`Applied password_change_required migration (${statementCount} statements).`);
    }

    if (await hasUserTwoFactor(prisma)) {
      console.log("User two-factor columns already exist; skipping user_two_factor migration.");
    } else {
      const statementCount = await applySqlFile(prisma, userTwoFactorMigrationUrl);
      console.log(`Applied user_two_factor migration (${statementCount} statements).`);
    }

    if (await hasPasswordResetTokens(prisma)) {
      console.log("Password reset token schema already exists; skipping password_reset_tokens migration.");
    } else {
      const statementCount = await applySqlFile(prisma, passwordResetTokensMigrationUrl);
      console.log(`Applied password_reset_tokens migration (${statementCount} statements).`);
    }

    if (await hasUserPhone(prisma)) {
      console.log("User phone column already exists; skipping user_phone migration.");
    } else {
      const statementCount = await applySqlFile(prisma, userPhoneMigrationUrl);
      console.log(`Applied user_phone migration (${statementCount} statements).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
