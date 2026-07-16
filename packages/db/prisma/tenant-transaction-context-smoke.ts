import { MembershipRole, PrismaClient, type Prisma } from "@prisma/client";
import {
  inspectRlsRuntimeRole,
  TenantTransactionContextError,
  type TenantTransactionClient,
  type TenantTransactionContext,
  type TenantTransactionContextErrorCode,
  type TenantTransactionHost,
  withTenantTransaction,
} from "../src/tenant-transaction.js";

interface SettingsRow {
  tenantId: string | null;
  userId: string | null;
  role: string | null;
  source: string | null;
  backendPid: number;
}

interface RlsStateRow {
  enabled: number;
  forced: number;
}

interface CatalogRoleRow {
  currentUser: string;
  bypassRls: boolean;
  isSuperuser: boolean;
  ownedTenantTableCount: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectContextError(
  operation: () => unknown,
  code: TenantTransactionContextErrorCode,
) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof TenantTransactionContextError, `Expected ${code}.`);
    assert(error.code === code, `Expected ${code}, received ${error.code}.`);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

function databaseUrl(connectionLimit: number) {
  const value =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
  const url = new URL(value);
  url.searchParams.set("connection_limit", String(connectionLimit));
  url.searchParams.set("pool_timeout", "5");
  return url.toString();
}

function client(connectionLimit: number) {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl(connectionLimit) } },
  });
}

async function settings(database: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const rows = await database.$queryRaw<SettingsRow[]>`
    SELECT
      nullif(current_setting('app.tenant_id', true), '') AS "tenantId",
      nullif(current_setting('app.user_id', true), '') AS "userId",
      nullif(current_setting('app.user_role', true), '') AS "role",
      nullif(current_setting('app.context_source', true), '') AS "source",
      pg_backend_pid() AS "backendPid"
  `;
  assert(rows[0], "Tenant transaction settings are unavailable.");
  return rows[0];
}

async function rlsState(database: PrismaClient) {
  const rows = await database.$queryRaw<RlsStateRow[]>`
    SELECT
      count(*) FILTER (WHERE table_record.relrowsecurity)::integer AS "enabled",
      count(*) FILTER (WHERE table_record.relforcerowsecurity)::integer AS "forced"
    FROM pg_catalog.pg_class AS table_record
    INNER JOIN pg_catalog.pg_namespace AS schema_record
      ON schema_record.oid = table_record.relnamespace
    WHERE schema_record.nspname = current_schema()
      AND table_record.relkind IN ('r', 'p')
  `;
  assert(rows[0], "RLS state is unavailable.");
  return rows[0];
}

async function catalogRole(database: PrismaClient) {
  const rows = await database.$queryRaw<CatalogRoleRow[]>`
    WITH tenant_tables AS (
      SELECT DISTINCT table_record.oid, table_record.relowner
      FROM pg_catalog.pg_class AS table_record
      INNER JOIN pg_catalog.pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      INNER JOIN pg_catalog.pg_attribute AS column_record
        ON column_record.attrelid = table_record.oid
      WHERE schema_record.nspname = current_schema()
        AND table_record.relkind IN ('r', 'p')
        AND column_record.attname = 'tenantId'
        AND column_record.attnum > 0
        AND NOT column_record.attisdropped
    )
    SELECT
      current_user AS "currentUser",
      role_record.rolbypassrls AS "bypassRls",
      role_record.rolsuper AS "isSuperuser",
      count(tenant_table.oid) FILTER (
        WHERE tenant_table.relowner = role_record.oid
      )::integer AS "ownedTenantTableCount"
    FROM pg_catalog.pg_roles AS role_record
    LEFT JOIN tenant_tables AS tenant_table ON true
    WHERE role_record.rolname = current_user
    GROUP BY role_record.oid, role_record.rolbypassrls, role_record.rolsuper
  `;
  assert(rows[0], "PostgreSQL role catalog state is unavailable.");
  return rows[0];
}

async function main() {
  const single = client(1);
  const concurrent = client(2);
  let checks = 0;
  try {
    const before = await rlsState(single);
    assert(before.enabled === 0, "The current schema already has RLS enabled.");
    assert(before.forced === 0, "The current schema already has FORCE RLS enabled.");
    checks += 2;
    const adminContext: TenantTransactionContext = {
      tenantId: "tenant_admin",
      userId: "user_admin",
      role: MembershipRole.ADMIN,
      source: "api_request",
    };
    const jobContext: TenantTransactionContext = {
      tenantId: "tenant_job",
      userId: "user_job_actor",
      role: MembershipRole.AGENT,
      source: "background_job",
    };

    const adminSettings = await withTenantTransaction(single, adminContext, async (transaction) => {
      assert(!("$transaction" in transaction), "The callback received a root Prisma client.");
      return settings(transaction);
    });
    assert(adminSettings.tenantId === adminContext.tenantId, "Admin tenant context is missing.");
    assert(adminSettings.userId === adminContext.userId, "Admin user context is missing.");
    assert(adminSettings.role === adminContext.role, "Admin role context is missing.");
    assert(adminSettings.source === adminContext.source, "API context source is missing.");
    checks += 5;

    const afterCommit = await settings(single);
    assert(
      afterCommit.backendPid === adminSettings.backendPid,
      "Commit reset did not reuse the pool connection.",
    );
    assert(
      !afterCommit.tenantId && !afterCommit.userId && !afterCommit.role && !afterCommit.source,
      "Tenant context leaked after commit.",
    );
    checks += 2;

    const rollbackMarker = new Error("rollback-marker");
    let rollbackSeen = false;
    try {
      await withTenantTransaction(single, jobContext, async (transaction) => {
        const value = await settings(transaction);
        assert(value.tenantId === jobContext.tenantId, "Background tenant context is missing.");
        assert(value.userId === jobContext.userId, "Background actor context is missing.");
        assert(value.role === jobContext.role, "Background role context is missing.");
        assert(value.source === jobContext.source, "Background source context is missing.");
        checks += 4;
        throw rollbackMarker;
      });
    } catch (error) {
      rollbackSeen = error === rollbackMarker;
    }
    assert(rollbackSeen, "Transaction rollback did not preserve the callback error.");
    const afterRollback = await settings(single);
    assert(
      afterRollback.backendPid === adminSettings.backendPid,
      "Rollback reset did not reuse the pool connection.",
    );
    assert(
      !afterRollback.tenantId &&
        !afterRollback.userId &&
        !afterRollback.role &&
        !afterRollback.source,
      "Tenant context leaked after rollback.",
    );
    checks += 3;

    let transactionStarts = 0;
    let invalidCallbackRuns = 0;
    const noSqlHost: TenantTransactionHost = {
      $transaction() {
        transactionStarts += 1;
        return Promise.reject(new Error("Unexpected transaction start."));
      },
    };
    const invalidContexts = [
      { ...adminContext, tenantId: "" },
      { ...adminContext, userId: "user with spaces" },
      { ...adminContext, role: "ROOT" },
      { ...adminContext, source: "cron" },
      null,
    ];
    for (const invalidContext of invalidContexts) {
      await expectContextError(
        () =>
          withTenantTransaction(noSqlHost, invalidContext as TenantTransactionContext, () => {
            invalidCallbackRuns += 1;
            return Promise.resolve(undefined);
          }),
        "INVALID_CONTEXT",
      );
      checks += 1;
    }
    for (const invalidHost of [null, {}]) {
      await expectContextError(
        () =>
          withTenantTransaction(
            invalidHost as unknown as TenantTransactionHost,
            adminContext,
            () => {
              invalidCallbackRuns += 1;
              return Promise.resolve(undefined);
            },
          ),
        "INVALID_TRANSACTION_HOST",
      );
      checks += 1;
    }
    assert(transactionStarts === 0, "Invalid context reached SQL.");
    assert(invalidCallbackRuns === 0, "An invalid context or host reached the callback.");
    checks += 2;

    let expired: TenantTransactionClient | undefined;
    await withTenantTransaction(single, adminContext, async (transaction) => {
      expired = transaction;
      await expectContextError(
        () =>
          withTenantTransaction(transaction as unknown as TenantTransactionHost, jobContext, () =>
            Promise.resolve(undefined),
          ),
        "NESTED_TENANT_TRANSACTION",
      );
      checks += 1;
    });
    assert(expired, "Scoped transaction was not captured for expiry verification.");
    await expectContextError(
      () => settings(expired as TenantTransactionClient),
      "EXPIRED_TENANT_TRANSACTION",
    );
    await expectContextError(
      () =>
        withTenantTransaction(expired as unknown as TenantTransactionHost, jobContext, () =>
          Promise.resolve(undefined),
        ),
      "EXPIRED_TENANT_TRANSACTION",
    );
    checks += 2;

    let ready = 0;
    let release: (() => void) | undefined;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isolated = async (context: TenantTransactionContext) =>
      withTenantTransaction(
        concurrent,
        context,
        async (transaction) => {
          const first = await settings(transaction);
          ready += 1;
          if (ready === 2) release?.();
          await bothReady;
          const second = await settings(transaction);
          return { first, second };
        },
        { timeout: 10_000 },
      );
    const [adminIsolated, jobIsolated] = await Promise.all([
      isolated(adminContext),
      isolated(jobContext),
    ]);
    assert(
      adminIsolated.first.backendPid !== jobIsolated.first.backendPid,
      "Concurrent tenant contexts did not occupy distinct connections.",
    );
    for (const value of [adminIsolated.first, adminIsolated.second]) {
      assert(value.tenantId === adminContext.tenantId, "Admin context crossed tenants.");
      assert(value.userId === adminContext.userId, "Admin actor context crossed transactions.");
    }
    for (const value of [jobIsolated.first, jobIsolated.second]) {
      assert(value.tenantId === jobContext.tenantId, "Job context crossed tenants.");
      assert(value.userId === jobContext.userId, "Job actor context crossed transactions.");
    }
    checks += 9;

    const posture = await inspectRlsRuntimeRole(single);
    const catalog = await catalogRole(single);
    assert(posture.currentUser === catalog.currentUser, "Runtime role identity detection differs.");
    assert(posture.bypassRls === catalog.bypassRls, "BYPASSRLS detection differs.");
    assert(posture.isSuperuser === catalog.isSuperuser, "Superuser detection differs.");
    assert(
      posture.ownedTenantTableCount === catalog.ownedTenantTableCount,
      "Tenant-table owner detection differs.",
    );
    assert(
      posture.safeForRls ===
        (!catalog.bypassRls && !catalog.isSuperuser && catalog.ownedTenantTableCount === 0),
      "Runtime role safety classification is incorrect.",
    );
    assert(posture.tenantTableCount > 0, "No tenant-bearing tables were inspected.");
    checks += 6;
    if (posture.currentUser === "postgres") {
      assert(posture.isSuperuser, "The postgres role was not detected as superuser.");
      assert(posture.bypassRls, "The postgres role was not detected with BYPASSRLS.");
      assert(
        posture.ownedTenantTableCount > 0,
        "The postgres role was not detected as table owner.",
      );
      assert(!posture.safeForRls, "The postgres owner role was classified as safe for RLS.");
      checks += 4;
    }

    const after = await rlsState(single);
    assert(after.enabled === before.enabled, "The context smoke enabled RLS.");
    assert(after.forced === before.forced, "The context smoke forced RLS.");
    checks += 2;

    console.log(
      JSON.stringify({
        ok: true,
        checks,
        runtimeRole: {
          safeForRls: posture.safeForRls,
          isSuperuser: posture.isSuperuser,
          bypassRls: posture.bypassRls,
          ownsTenantTables: posture.ownedTenantTableCount > 0,
        },
      }),
    );
  } finally {
    await Promise.all([single.$disconnect(), concurrent.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
