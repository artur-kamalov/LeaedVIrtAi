import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type {
  OperationStatusReadInput,
  OperationStatusReader,
  OperationStatusReadResult,
} from "@leadvirt/integrations";
import type {
  OperatorOperationItem,
  OperatorOperationKind,
  OperatorOperationList,
  OperatorOperationListQuery,
  OperatorOperationMutationRequest,
  OperatorOperationMutationResult,
  OperatorOperationStatus,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { operatorOperationKinds } from "./dto/operator-operations.dto.js";
import { OPERATOR_OPERATION_STATUS_READER } from "./operator-operation-status-reader.js";
import {
  assertOperatorIfMatch,
  operatorError,
  operatorEtag,
  operatorHash,
} from "./operator-operations.http.js";

const externalTerminalStatuses = ["SUCCEEDED", "FAILED", "UNKNOWN", "RECONCILED"] as const;
const outboxTerminalStatuses = ["FAILED", "DEAD_LETTER"] as const;
const toolPrefixes = ["lead.", "booking.", "task."] as const;
const provenNotExecutedCodes = new Set([
  "OPERATOR_PROVEN_NOT_EXECUTED",
  "RuntimeOutboxDeadlineError",
]);

type DbClient = Prisma.TransactionClient;

interface InternalOperation {
  id: string;
  tenantId: string;
  kind: OperatorOperationKind;
  status: string;
  rawCode: string;
  rawErrorCode: string | null;
  attemptCount: number;
  generation: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  reconcile?: {
    provider?: string;
    operationKind: string;
    externalReference?: string;
    providerIdempotencyKey?: string;
    requestHash: string;
  };
  runtimeOutbox?: {
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    generation: number;
    eventType: string;
    schemaVersion: number;
    dedupeKey: string;
    payloadRef: string | null;
    payload: Prisma.JsonValue | null;
    deadlineAt: Date | null;
    maxAttempts: number;
    traceId: string | null;
    traceParent: string | null;
  };
  knowledgeOutbox?: {
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    eventType: string;
    schemaVersion: number;
    dedupeKey: string;
    payload: Prisma.JsonValue;
    deadlineAt: Date | null;
    traceId: string | null;
    traceParent: string | null;
  };
}

interface CursorValue {
  createdAt: string;
  key: string;
}

interface PreparedReconciliation {
  sourceEtag: string;
  sourceUpdatedAt: Date;
  rowVersion: string;
  generation: number;
  observation: OperationStatusReadResult;
}

type StoredMutationResult = Omit<OperatorOperationMutationResult, "idempotencyReplayed">;

function database(client: PrismaService | Prisma.TransactionClient): DbClient {
  return client;
}

function isToolOperation(aiReplyRunId: string | null, operationKind: string) {
  return aiReplyRunId !== null || toolPrefixes.some((prefix) => operationKind.startsWith(prefix));
}

function publicCode(value: string, fallback: string) {
  const normalized = value
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z\d]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 96);
  return normalized || fallback;
}

function publicErrorCode(value: string | null) {
  if (!value) return null;
  return /^[A-Z][A-Z0-9_]{1,95}$/.test(value)
    ? value
    : "OPERATOR_UPSTREAM_ERROR_REDACTED";
}

function isRuntimeInternalWork(eventType: string) {
  return (
    /^knowledge\.source\.(connect|sync|retry)\.requested$/.test(eventType) ||
    eventType.startsWith("internal.")
  );
}

function isSafeRedrive(operation: InternalOperation) {
  if (!outboxTerminalStatuses.includes(operation.status as (typeof outboxTerminalStatuses)[number])) {
    return false;
  }
  if (!provenNotExecutedCodes.has(operation.rawErrorCode ?? "")) return false;
  if (operation.kind === "RUNTIME_OUTBOX") {
    return Boolean(
      operation.runtimeOutbox && isRuntimeInternalWork(operation.runtimeOutbox.eventType),
    );
  }
  return (
    operation.kind === "KNOWLEDGE_OUTBOX" &&
    operation.knowledgeOutbox?.eventType === "knowledge.publication.requested"
  );
}

function allowedActions(operation: InternalOperation) {
  if (
    ["EXTERNAL_OPERATION", "CHANNEL_DELIVERY", "TOOL_OPERATION"].includes(operation.kind) &&
    operation.status === "UNKNOWN"
  ) {
    return ["RECONCILE" as const];
  }
  return isSafeRedrive(operation) ? ["REDRIVE" as const] : [];
}

function toPublic(operation: InternalOperation): OperatorOperationItem {
  const etag = operatorEtag(
    operation.kind,
    operation.id,
    operation.generation,
    `${operation.status}:${operation.updatedAt.toISOString()}`,
  );
  return {
    id: operation.id,
    kind: operation.kind,
    status: operation.status as OperatorOperationStatus,
    code: publicCode(operation.rawCode, "OPERATION"),
    errorCode: publicErrorCode(operation.rawErrorCode),
    attemptCount: operation.attemptCount,
    generation: operation.generation,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
    etag,
    allowedActions: allowedActions(operation),
  };
}

function encodeCursor(operation: InternalOperation) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      createdAt: operation.createdAt.toISOString(),
      key: `${operation.kind}:${operation.id}`,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value?: string): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.version !== 1 ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.key !== "string" ||
      parsed.key.length < 3 ||
      parsed.key.length > 260
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, key: parsed.key };
  } catch {
    throw operatorError(
      HttpStatus.BAD_REQUEST,
      "OPERATOR_CURSOR_INVALID",
      "The pagination cursor is invalid.",
    );
  }
}

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

@Injectable()
export class OperatorOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(OPERATOR_OPERATION_STATUS_READER)
    private readonly statusReader: OperationStatusReader,
  ) {}

  async list(
    context: RequestContext,
    query: OperatorOperationListQuery,
  ): Promise<OperatorOperationList> {
    this.assertContextRole(context);
    const cursor = decodeCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const kinds = query.kind ? [query.kind] : [...operatorOperationKinds];
    const batches = await Promise.all(
      kinds.map((kind) =>
        this.listKind(context.tenantId, kind, query.status, cursor?.createdAt, limit + 1),
      ),
    );
    const operations = batches
      .flat()
      .filter((operation) => {
        if (!cursor) return true;
        const createdAt = operation.createdAt.toISOString();
        const key = `${operation.kind}:${operation.id}`;
        return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && key < cursor.key);
      })
      .sort((left, right) => {
        const dateOrder = right.createdAt.getTime() - left.createdAt.getTime();
        if (dateOrder !== 0) return dateOrder;
        return `${right.kind}:${right.id}`.localeCompare(`${left.kind}:${left.id}`);
      });
    const page = operations.slice(0, limit);
    return {
      items: page.map(toPublic),
      nextCursor: operations.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
    };
  }

  async get(context: RequestContext, rawKind: string, operationId: string) {
    this.assertContextRole(context);
    const kind = this.kind(rawKind);
    const operation = await this.load(this.prisma, context.tenantId, kind, operationId);
    if (!operation) this.notFound();
    return toPublic(operation);
  }

  async reconcile(
    context: RequestContext,
    rawKind: string,
    operationId: string,
    input: OperatorOperationMutationRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<OperatorOperationMutationResult> {
    this.assertContextRole(context);
    const kind = this.kind(rawKind);
    if (!["EXTERNAL_OPERATION", "CHANNEL_DELIVERY", "TOOL_OPERATION"].includes(kind)) {
      throw operatorError(
        HttpStatus.CONFLICT,
        "OPERATOR_RECONCILIATION_NOT_SUPPORTED",
        "This record does not support provider reconciliation.",
      );
    }
    const reasonHash = operatorHash({ version: 1, reason: input.reason.trim() });
    const result = await this.idempotency.executePrepared<StoredMutationResult, PreparedReconciliation>(
      {
        tenantId: context.tenantId,
        endpoint: `operator.operations.${kind}.${operationId}.reconcile`,
        key: idempotencyKey,
        request: { kind, operationId, reasonHash, ifMatch },
      },
      () => this.prepareReconciliation(context, kind, operationId, ifMatch),
      (tx, prepared) =>
        this.commitReconciliation(
          tx,
          context,
          kind,
          operationId,
          reasonHash,
          ifMatch,
          prepared,
        ),
    );
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  async redrive(
    context: RequestContext,
    rawKind: string,
    operationId: string,
    input: OperatorOperationMutationRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<OperatorOperationMutationResult> {
    this.assertContextRole(context);
    const kind = this.kind(rawKind);
    if (kind !== "RUNTIME_OUTBOX" && kind !== "KNOWLEDGE_OUTBOX") {
      throw operatorError(
        HttpStatus.CONFLICT,
        "OPERATOR_REDRIVE_EXTERNAL_EFFECT_FORBIDDEN",
        "External operations cannot be redriven from the operator API.",
      );
    }
    const reasonHash = operatorHash({ version: 1, reason: input.reason.trim() });
    const result = await this.idempotency.execute<StoredMutationResult>(
      {
        tenantId: context.tenantId,
        endpoint: `operator.operations.${kind}.${operationId}.redrive`,
        key: idempotencyKey,
        request: { kind, operationId, reasonHash, ifMatch },
      },
      (tx) =>
        this.commitRedrive(tx, context, kind, operationId, reasonHash, ifMatch),
    );
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private async listKind(
    tenantId: string,
    kind: OperatorOperationKind,
    status: OperatorOperationStatus | undefined,
    before: string | undefined,
    take: number,
  ) {
    const createdAt = before ? { lte: new Date(before) } : undefined;
    if (kind === "EXTERNAL_OPERATION" || kind === "TOOL_OPERATION") {
      if (status === "DEAD_LETTER") return [];
      const toolSelectors: Prisma.ExternalOperationWhereInput[] = [
        { aiReplyRunId: { not: null } },
        ...toolPrefixes.map((prefix) => ({ operationKind: { startsWith: prefix } })),
      ];
      const rows = await this.prisma.externalOperation.findMany({
        where: {
          tenantId,
          status: status ? status : { in: [...externalTerminalStatuses] },
          ...(createdAt ? { createdAt } : {}),
          ...(kind === "TOOL_OPERATION"
            ? { OR: toolSelectors }
            : { NOT: { OR: toolSelectors } }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        include: { integration: { select: { provider: true } } },
      });
      return rows.map((row) => this.externalInternal(row, kind));
    }
    if (kind === "CHANNEL_DELIVERY") {
      if (status === "DEAD_LETTER") return [];
      const rows = await this.prisma.channelDeliveryOperation.findMany({
        where: {
          tenantId,
          status: status ? status : { in: [...externalTerminalStatuses] },
          ...(createdAt ? { createdAt } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
      return rows.map((row) => this.channelInternal(row));
    }
    if (status && status !== "FAILED" && status !== "DEAD_LETTER") return [];
    if (kind === "RUNTIME_OUTBOX") {
      const rows = await this.prisma.runtimeOutbox.findMany({
        where: {
          tenantId,
          status: status ?? { in: [...outboxTerminalStatuses] },
          ...(createdAt ? { createdAt } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
      return rows.map((row) => this.runtimeInternal(row));
    }
    const rows = await this.prisma.knowledgeOutbox.findMany({
      where: {
        tenantId,
        status: status ?? { in: [...outboxTerminalStatuses] },
        ...(createdAt ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
    return rows.map((row) => this.knowledgeInternal(row));
  }

  private async load(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    kind: OperatorOperationKind,
    id: string,
  ): Promise<InternalOperation | null> {
    const db = database(client);
    if (kind === "EXTERNAL_OPERATION" || kind === "TOOL_OPERATION") {
      const row = await db.externalOperation.findFirst({
        where: { id, tenantId },
        include: { integration: { select: { provider: true } } },
      });
      if (!row || isToolOperation(row.aiReplyRunId, row.operationKind) !== (kind === "TOOL_OPERATION")) {
        return null;
      }
      return this.externalInternal(row, kind);
    }
    if (kind === "CHANNEL_DELIVERY") {
      const row = await db.channelDeliveryOperation.findFirst({ where: { id, tenantId } });
      return row ? this.channelInternal(row) : null;
    }
    if (kind === "RUNTIME_OUTBOX") {
      const row = await db.runtimeOutbox.findFirst({ where: { id, tenantId } });
      return row ? this.runtimeInternal(row) : null;
    }
    const row = await db.knowledgeOutbox.findFirst({ where: { id, tenantId } });
    return row ? this.knowledgeInternal(row) : null;
  }

  private externalInternal(
    row: Awaited<ReturnType<PrismaService["externalOperation"]["findFirstOrThrow"]>> & {
      integration?: { provider: string } | null;
    },
    kind: "EXTERNAL_OPERATION" | "TOOL_OPERATION",
  ): InternalOperation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind,
      status: row.status,
      rawCode: row.operationKind,
      rawErrorCode: row.errorCode,
      attemptCount: row.attemptCount,
      generation: row.confirmationVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      reconcile: {
        ...(row.integration?.provider ? { provider: row.integration.provider } : {}),
        operationKind: row.operationKind,
        ...(row.externalReference ? { externalReference: row.externalReference } : {}),
        ...(row.providerIdempotencyKey
          ? { providerIdempotencyKey: row.providerIdempotencyKey }
          : {}),
        requestHash: row.requestHash,
      },
    };
  }

  private channelInternal(
    row: Awaited<ReturnType<PrismaService["channelDeliveryOperation"]["findFirstOrThrow"]>>,
  ): InternalOperation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: "CHANNEL_DELIVERY",
      status: row.status,
      rawCode: `${row.provider}.delivery`,
      rawErrorCode: row.errorCode,
      attemptCount: row.attemptCount,
      generation: row.deliveryVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      reconcile: {
        provider: row.provider,
        operationKind: "channel.message.delivery",
        ...(row.providerMessageId ? { externalReference: row.providerMessageId } : {}),
        ...(row.providerIdempotencyKey
          ? { providerIdempotencyKey: row.providerIdempotencyKey }
          : {}),
        requestHash: row.requestHash,
      },
    };
  }

  private runtimeInternal(
    row: Awaited<ReturnType<PrismaService["runtimeOutbox"]["findFirstOrThrow"]>>,
  ): InternalOperation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: "RUNTIME_OUTBOX",
      status: row.status,
      rawCode: row.eventType,
      rawErrorCode: row.lastErrorCode,
      attemptCount: row.attemptCount,
      generation: row.generation,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.publishedAt,
      runtimeOutbox: {
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.aggregateVersion,
        generation: row.generation,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        dedupeKey: row.dedupeKey,
        payloadRef: row.payloadRef,
        payload: row.payload,
        deadlineAt: row.deadlineAt,
        maxAttempts: row.maxAttempts,
        traceId: row.traceId,
        traceParent: row.traceParent,
      },
    };
  }

  private knowledgeInternal(
    row: Awaited<ReturnType<PrismaService["knowledgeOutbox"]["findFirstOrThrow"]>>,
  ): InternalOperation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: "KNOWLEDGE_OUTBOX",
      status: row.status,
      rawCode: row.eventType,
      rawErrorCode: row.lastErrorCode,
      attemptCount: row.attemptCount,
      generation: row.aggregateVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.publishedAt,
      knowledgeOutbox: {
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.aggregateVersion,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        dedupeKey: row.dedupeKey,
        payload: row.payload,
        deadlineAt: row.deadlineAt,
        traceId: row.traceId,
        traceParent: row.traceParent,
      },
    };
  }

  private async prepareReconciliation(
    context: RequestContext,
    kind: OperatorOperationKind,
    operationId: string,
    ifMatch: string[],
  ): Promise<PreparedReconciliation> {
    const operation = await this.load(this.prisma, context.tenantId, kind, operationId);
    if (!operation) this.notFound();
    const source = operation;
    const sourceEtag = toPublic(source).etag;
    assertOperatorIfMatch(ifMatch, sourceEtag);
    if (source.status !== "UNKNOWN" || !source.reconcile) {
      throw operatorError(
        HttpStatus.CONFLICT,
        "OPERATOR_RECONCILIATION_STATE_INVALID",
        "Only an unknown external outcome can be reconciled.",
      );
    }
    let observation: OperationStatusReadResult;
    try {
      const readInput: OperationStatusReadInput = {
        tenantId: context.tenantId,
        operationType: kind as OperationStatusReadInput["operationType"],
        ...(source.reconcile.provider ? { provider: source.reconcile.provider } : {}),
        operationKind: source.reconcile.operationKind,
        ...(source.reconcile.externalReference
          ? { externalReference: source.reconcile.externalReference }
          : {}),
        ...(source.reconcile.providerIdempotencyKey
          ? { providerIdempotencyKey: source.reconcile.providerIdempotencyKey }
          : {}),
        requestHash: source.reconcile.requestHash,
      };
      observation = await this.statusReader.readStatus(readInput);
    } catch {
      observation = {
        supported: true,
        authoritative: false,
        outcome: "UNKNOWN",
        evidenceCode: "OPERATOR_STATUS_READ_UNAVAILABLE",
      };
    }
    return {
      sourceEtag,
      sourceUpdatedAt: source.updatedAt,
      rowVersion: await this.rowVersion(this.prisma, context.tenantId, kind, operationId),
      generation: source.generation,
      observation,
    };
  }

  private async commitReconciliation(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    kind: OperatorOperationKind,
    operationId: string,
    reasonHash: string,
    ifMatch: string[],
    prepared: PreparedReconciliation,
  ) {
    await this.assertCurrentActor(tx, context);
    await this.lockReconciliation(tx, context.tenantId, kind, operationId, prepared);
    const operation = await this.load(tx, context.tenantId, kind, operationId);
    if (!operation) this.notFound();
    const source = operation;
    const currentEtag = toPublic(source).etag;
    assertOperatorIfMatch(ifMatch, currentEtag);
    if (
      source.status !== "UNKNOWN" ||
      source.generation !== prepared.generation ||
      source.updatedAt.getTime() !== prepared.sourceUpdatedAt.getTime() ||
      currentEtag !== prepared.sourceEtag
    ) {
      throw operatorError(
        HttpStatus.PRECONDITION_FAILED,
        "OPERATOR_RECONCILIATION_FENCE_STALE",
        "The operation changed while provider status was being read.",
      );
    }

    const observedOutcome = prepared.observation.supported
      ? prepared.observation.outcome
      : "UNKNOWN";
    const authoritative =
      prepared.observation.supported &&
      prepared.observation.authoritative &&
      (observedOutcome === "SUCCEEDED" || observedOutcome === "FAILED");
    const outcome = authoritative ? observedOutcome : "UNKNOWN";
    const evidenceCode = !prepared.observation.supported
      ? "OPERATOR_STATUS_READ_UNSUPPORTED"
      : !authoritative
        ? "OPERATOR_STATUS_NOT_AUTHORITATIVE"
        : outcome === "SUCCEEDED"
          ? "OPERATOR_PROVIDER_CONFIRMED_SUCCEEDED"
          : "OPERATOR_PROVIDER_CONFIRMED_FAILED";
    const evidenceHash = operatorHash({
      version: 1,
      supported: prepared.observation.supported,
      authoritative,
      outcome,
      evidenceCode,
      evidence:
        prepared.observation.supported && "evidence" in prepared.observation
          ? prepared.observation.evidence
          : null,
    });

    if (authoritative) {
      const data = {
        status: outcome,
        reconciledAt: new Date(),
        completedAt: new Date(),
        errorCode: outcome === "FAILED" ? "OPERATOR_PROVIDER_CONFIRMED_FAILED" : null,
        errorMessage: null,
      } as const;
      const changed =
        kind === "CHANNEL_DELIVERY"
          ? await tx.channelDeliveryOperation.updateMany({
              where: {
                id: operationId,
                tenantId: context.tenantId,
                status: "UNKNOWN",
                deliveryVersion: prepared.generation,
              },
              data,
            })
          : await tx.externalOperation.updateMany({
              where: {
                id: operationId,
                tenantId: context.tenantId,
                status: "UNKNOWN",
                confirmationVersion: prepared.generation,
              },
              data,
            });
      if (changed.count !== 1) {
        throw operatorError(
          HttpStatus.PRECONDITION_FAILED,
          "OPERATOR_RECONCILIATION_FENCE_STALE",
          "The operation changed while provider status was being read.",
        );
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "operator.operation.reconciled",
        entityType: kind,
        entityId: operationId,
        payload: {
          outcome,
          authoritative,
          evidenceCode,
          evidenceHash,
          reasonHash,
          sourceEtagHash: operatorHash(prepared.sourceEtag),
        },
      },
    });
    const current = await this.load(tx, context.tenantId, kind, operationId);
    if (!current) this.notFound();
    return {
      httpStatus: HttpStatus.OK,
      responseBody: {
        resource: toPublic(current),
        outcome:
          outcome === "SUCCEEDED"
            ? "AUTHORITATIVE_SUCCEEDED"
            : outcome === "FAILED"
              ? "AUTHORITATIVE_FAILED"
              : "STILL_UNKNOWN",
      } as StoredMutationResult,
    };
  }

  private async commitRedrive(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    kind: "RUNTIME_OUTBOX" | "KNOWLEDGE_OUTBOX",
    operationId: string,
    reasonHash: string,
    ifMatch: string[],
  ) {
    await this.assertCurrentActor(tx, context);
    const lockKey = `operator-redrive:${context.tenantId}:${kind}:${operationId}`;
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
    `);
    await this.lockRedrive(tx, context.tenantId, kind, operationId);
    const operation = await this.load(tx, context.tenantId, kind, operationId);
    if (!operation) this.notFound();
    const source = operation;
    const sourceEtag = toPublic(source).etag;
    assertOperatorIfMatch(ifMatch, sourceEtag);
    if (!isSafeRedrive(source)) {
      throw operatorError(
        HttpStatus.CONFLICT,
        "OPERATOR_REDRIVE_NOT_PROVEN_SAFE",
        "This work item is not proven to have failed before execution.",
      );
    }
    const sourceEtagHash = operatorHash(sourceEtag);
    const existingAudits = await tx.auditLog.findMany({
      where: {
        tenantId: context.tenantId,
        action: "operator.operation.redriven",
        entityType: kind,
        entityId: operationId,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { payload: true },
    });
    for (const audit of existingAudits) {
      const payload = record(audit.payload);
      if (payload.sourceEtagHash !== sourceEtagHash || typeof payload.replacementId !== "string") {
        continue;
      }
      return {
        httpStatus: HttpStatus.CREATED,
        responseBody: {
          resource: toPublic(source),
          outcome: "REDRIVEN",
          replacementId: payload.replacementId,
        } as StoredMutationResult,
      };
    }

    const replacement =
      kind === "RUNTIME_OUTBOX"
        ? await this.createRuntimeRedrive(tx, source)
        : await this.createKnowledgeRedrive(tx, source);
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "operator.operation.redriven",
        entityType: kind,
        entityId: operationId,
        payload: {
          replacementId: replacement.id,
          replacementGeneration: replacement.generation,
          reasonHash,
          sourceEtagHash,
        },
      },
    });
    return {
      httpStatus: HttpStatus.CREATED,
      responseBody: {
        resource: toPublic(source),
        outcome: "REDRIVEN",
        replacementId: replacement.id,
      } as StoredMutationResult,
    };
  }

  private async createRuntimeRedrive(tx: Prisma.TransactionClient, source: InternalOperation) {
    const event = source.runtimeOutbox!;
    const latest = await tx.runtimeOutbox.aggregate({
      where: {
        tenantId: source.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        eventType: event.eventType,
      },
      _max: { generation: true },
    });
    const generation = Math.max(event.generation, latest._max.generation ?? 0) + 1;
    const suffix = operatorHash({ sourceId: source.id, sourceUpdatedAt: source.updatedAt }).slice(0, 16);
    const ttl = event.deadlineAt
      ? Math.max(60_000, event.deadlineAt.getTime() - source.createdAt.getTime())
      : null;
    const created = await tx.runtimeOutbox.create({
      data: {
        tenantId: source.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        generation,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        dedupeKey: `${event.dedupeKey}:operator-redrive:g${generation}:${suffix}`,
        payloadRef: event.payloadRef,
        payload:
          event.payload === null
            ? Prisma.DbNull
            : (event.payload as Prisma.InputJsonValue),
        availableAt: new Date(),
        ...(ttl ? { deadlineAt: new Date(Date.now() + ttl) } : {}),
        maxAttempts: event.maxAttempts,
        traceId: event.traceId,
        traceParent: event.traceParent,
      },
    });
    return { id: created.id, generation };
  }

  private async createKnowledgeRedrive(tx: Prisma.TransactionClient, source: InternalOperation) {
    const event = source.knowledgeOutbox!;
    const latest = await tx.knowledgeOutbox.aggregate({
      where: {
        tenantId: source.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
      },
      _max: { aggregateVersion: true },
    });
    const generation = Math.max(event.aggregateVersion, latest._max.aggregateVersion ?? 0) + 1;
    const suffix = operatorHash({ sourceId: source.id, sourceUpdatedAt: source.updatedAt }).slice(0, 16);
    const ttl = event.deadlineAt
      ? Math.max(60_000, event.deadlineAt.getTime() - source.createdAt.getTime())
      : null;
    const created = await tx.knowledgeOutbox.create({
      data: {
        tenantId: source.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: generation,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        dedupeKey: `${event.dedupeKey}:operator-redrive:g${generation}:${suffix}`,
        payload: event.payload as Prisma.InputJsonValue,
        availableAt: new Date(),
        ...(ttl ? { deadlineAt: new Date(Date.now() + ttl) } : {}),
        traceId: event.traceId,
        traceParent: event.traceParent,
      },
    });
    return { id: created.id, generation };
  }

  private async lockReconciliation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: OperatorOperationKind,
    id: string,
    prepared: PreparedReconciliation,
  ) {
    const rows =
      kind === "CHANNEL_DELIVERY"
        ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "ChannelDeliveryOperation"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
              AND "status" = 'UNKNOWN'
              AND "deliveryVersion" = ${prepared.generation}
              AND xmin::text = ${prepared.rowVersion}
            FOR UPDATE
          `)
        : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "ExternalOperation"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
              AND "status" = 'UNKNOWN'
              AND "confirmationVersion" = ${prepared.generation}
              AND xmin::text = ${prepared.rowVersion}
            FOR UPDATE
          `);
    if (rows.length !== 1) {
      throw operatorError(
        HttpStatus.PRECONDITION_FAILED,
        "OPERATOR_RECONCILIATION_FENCE_STALE",
        "The operation changed while provider status was being read.",
      );
    }
  }

  private async lockRedrive(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: "RUNTIME_OUTBOX" | "KNOWLEDGE_OUTBOX",
    id: string,
  ) {
    const rows =
      kind === "RUNTIME_OUTBOX"
        ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "RuntimeOutbox"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
              AND "status" IN ('FAILED', 'DEAD_LETTER')
            FOR UPDATE
          `)
        : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "KnowledgeOutbox"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
              AND "status" IN ('FAILED', 'DEAD_LETTER')
            FOR UPDATE
          `);
    if (rows.length !== 1) {
      throw operatorError(
        HttpStatus.CONFLICT,
        "OPERATOR_REDRIVE_STATE_INVALID",
        "Only failed or dead-letter work can be redriven.",
      );
    }
  }

  private async rowVersion(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    kind: OperatorOperationKind,
    id: string,
  ) {
    const db = database(client);
    const rows =
      kind === "CHANNEL_DELIVERY"
        ? await db.$queryRaw<Array<{ rowVersion: string }>>(Prisma.sql`
            SELECT xmin::text AS "rowVersion" FROM "ChannelDeliveryOperation"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
          `)
        : await db.$queryRaw<Array<{ rowVersion: string }>>(Prisma.sql`
            SELECT xmin::text AS "rowVersion" FROM "ExternalOperation"
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
          `);
    if (rows.length !== 1) this.notFound();
    return rows[0]!.rowVersion;
  }

  private async assertCurrentActor(tx: Prisma.TransactionClient, context: RequestContext) {
    const membership = await tx.membership.findFirst({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
        role: { in: ["OWNER", "ADMIN"] },
        user: { deletedAt: null },
        tenant: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!membership) {
      throw operatorError(
        HttpStatus.FORBIDDEN,
        "OPERATOR_ACTOR_REVOKED",
        "Owner or administrator access is required.",
      );
    }
  }

  private assertContextRole(context: RequestContext) {
    if (context.role === "OWNER" || context.role === "ADMIN") return;
    throw operatorError(
      HttpStatus.FORBIDDEN,
      "OPERATOR_ACCESS_DENIED",
      "Owner or administrator access is required.",
    );
  }

  private kind(value: string): OperatorOperationKind {
    if ((operatorOperationKinds as readonly string[]).includes(value)) {
      return value as OperatorOperationKind;
    }
    throw operatorError(
      HttpStatus.BAD_REQUEST,
      "OPERATOR_KIND_INVALID",
      "The operation kind is invalid.",
    );
  }

  private notFound(): never {
    throw operatorError(
      HttpStatus.NOT_FOUND,
      "OPERATOR_OPERATION_NOT_FOUND",
      "The operation was not found.",
    );
  }
}
