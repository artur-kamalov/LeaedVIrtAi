import { MembershipRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const contextSources = ["api_request", "background_job"] as const;
const membershipRoles = new Set<string>(Object.values(MembershipRole));

export type TenantTransactionContextSource = (typeof contextSources)[number];

export interface TenantTransactionContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  source: TenantTransactionContextSource;
}

export interface TenantTransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export interface TenantTransactionHost {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: TenantTransactionOptions,
  ): Promise<T>;
}

export type TenantTransactionClient = Prisma.TransactionClient;

export type TenantTransactionContextErrorCode =
  | "INVALID_CONTEXT"
  | "INVALID_TRANSACTION_HOST"
  | "NESTED_TENANT_TRANSACTION"
  | "EXPIRED_TENANT_TRANSACTION";

export class TenantTransactionContextError extends Error {
  constructor(readonly code: TenantTransactionContextErrorCode) {
    super(code);
    this.name = "TenantTransactionContextError";
  }
}

interface ScopedTransactionState {
  active: boolean;
}

interface RlsRuntimeRoleRow {
  currentUser: string;
  sessionUser: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  tenantTableCount: number;
  ownedTenantTableCount: number;
}

export interface RlsRuntimeRolePosture extends RlsRuntimeRoleRow {
  safeForRls: boolean;
}

const scopedTransactions = new WeakMap<object, ScopedTransactionState>();

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function validateTenantTransactionContext(value: unknown): TenantTransactionContext {
  if (!value || typeof value !== "object") {
    throw new TenantTransactionContextError("INVALID_CONTEXT");
  }
  const context = value as Partial<TenantTransactionContext>;
  if (
    !validIdentifier(context.tenantId) ||
    !validIdentifier(context.userId) ||
    !membershipRoles.has(String(context.role)) ||
    !contextSources.includes(context.source as TenantTransactionContextSource)
  ) {
    throw new TenantTransactionContextError("INVALID_CONTEXT");
  }
  return Object.freeze({
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role as MembershipRole,
    source: context.source as TenantTransactionContextSource,
  });
}

function assertTransactionHost(value: unknown): asserts value is TenantTransactionHost {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TenantTransactionContextError("INVALID_TRANSACTION_HOST");
  }
  const state = scopedTransactions.get(value);
  if (state) {
    throw new TenantTransactionContextError(
      state.active ? "NESTED_TENANT_TRANSACTION" : "EXPIRED_TENANT_TRANSACTION",
    );
  }
  if (typeof (value as Partial<TenantTransactionHost>).$transaction !== "function") {
    throw new TenantTransactionContextError("INVALID_TRANSACTION_HOST");
  }
}

function scopedTransaction(
  transaction: Prisma.TransactionClient,
  state: ScopedTransactionState,
): TenantTransactionClient {
  const scoped = new Proxy(transaction, {
    get(target, property, receiver) {
      if (!state.active) {
        throw new TenantTransactionContextError("EXPIRED_TENANT_TRANSACTION");
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (!state.active) {
          throw new TenantTransactionContextError("EXPIRED_TENANT_TRANSACTION");
        }
        return Reflect.apply(value, target, args) as unknown;
      };
    },
  });
  scopedTransactions.set(scoped, state);
  return scoped;
}

export async function withTenantTransaction<T>(
  host: TenantTransactionHost,
  contextValue: TenantTransactionContext,
  operation: (transaction: TenantTransactionClient) => Promise<T>,
  options?: TenantTransactionOptions,
): Promise<T> {
  const context = validateTenantTransactionContext(contextValue);
  assertTransactionHost(host);
  if (typeof operation !== "function") {
    throw new TenantTransactionContextError("INVALID_CONTEXT");
  }

  return host.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.tenant_id', ${context.tenantId}, true),
        set_config('app.user_id', ${context.userId}, true),
        set_config('app.user_role', ${context.role}, true),
        set_config('app.context_source', ${context.source}, true)
    `;
    const state: ScopedTransactionState = { active: true };
    const scoped = scopedTransaction(transaction, state);
    try {
      return await operation(scoped);
    } finally {
      state.active = false;
    }
  }, options);
}

export async function inspectRlsRuntimeRole(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<RlsRuntimeRolePosture> {
  const rows = await client.$queryRaw<RlsRuntimeRoleRow[]>`
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
      session_user AS "sessionUser",
      role_record.rolsuper AS "isSuperuser",
      role_record.rolbypassrls AS "bypassRls",
      count(tenant_table.oid)::integer AS "tenantTableCount",
      count(tenant_table.oid) FILTER (
        WHERE tenant_table.relowner = role_record.oid
      )::integer AS "ownedTenantTableCount"
    FROM pg_catalog.pg_roles AS role_record
    LEFT JOIN tenant_tables AS tenant_table ON true
    WHERE role_record.rolname = current_user
    GROUP BY role_record.oid, role_record.rolsuper, role_record.rolbypassrls
  `;
  const row = rows[0];
  if (!row) throw new Error("PostgreSQL runtime role posture is unavailable.");
  return {
    ...row,
    safeForRls: !row.isSuperuser && !row.bypassRls && row.ownedTenantTableCount === 0,
  };
}
