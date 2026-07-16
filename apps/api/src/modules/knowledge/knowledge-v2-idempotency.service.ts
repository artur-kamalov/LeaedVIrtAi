import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import { PrismaService } from "../database/prisma.service.js";
import {
  canonicalKnowledgeV2Hash,
  knowledgeV2Error,
  requireIdempotencyKey,
} from "./knowledge-v2-http.js";

const defaultRetentionMs = 7 * 24 * 60 * 60 * 1000;
const minimumRetentionMs = 60 * 60 * 1000;
const maximumRetentionMs = 30 * 24 * 60 * 60 * 1000;
const maximumResponseBytes = 256 * 1024;
const preparationLeaseMs = 2 * 60 * 1000;
const preparationLeaseRenewalMs = 30 * 1000;

export interface KnowledgeV2IdempotencyInput {
  tenantId: string;
  endpoint: string;
  key: string;
  request: unknown;
  retentionMs?: number;
  transactionTimeoutMs?: number;
}

export interface KnowledgeV2StoredResponse<T> {
  httpStatus: number;
  responseBody: T;
  responseRef?: string | null;
}

export interface KnowledgeV2IdempotencyResult<T> extends KnowledgeV2StoredResponse<T> {
  idempotencyReplayed: boolean;
}

function retentionMs(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return defaultRetentionMs;
  return Math.min(Math.max(Math.trunc(value), minimumRetentionMs), maximumRetentionMs);
}

function assertEndpoint(endpoint: string) {
  const normalized = endpoint.trim();
  if (!normalized || normalized.length > 240) {
    throw knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_IDEMPOTENCY_ENDPOINT_INVALID",
      "The mutation could not be processed safely.",
    );
  }
  return normalized;
}

function normalizeResponse<T>(response: KnowledgeV2StoredResponse<T>) {
  if (
    !Number.isInteger(response.httpStatus) ||
    response.httpStatus < 100 ||
    response.httpStatus > 599 ||
    (response.responseRef !== undefined &&
      response.responseRef !== null &&
      (typeof response.responseRef !== "string" || response.responseRef.length > 500))
  ) {
    throw knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_IDEMPOTENCY_RESPONSE_INVALID",
      "The mutation response could not be stored safely.",
    );
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(response.responseBody);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maximumResponseBytes) {
    throw knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_IDEMPOTENCY_RESPONSE_INVALID",
      "The mutation response could not be stored safely.",
    );
  }

  const responseBody = JSON.parse(serialized) as T;
  const storedBody =
    responseBody === null ? Prisma.JsonNull : (responseBody as unknown as Prisma.InputJsonValue);
  return { responseBody, storedBody };
}

function deterministicClientError(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const status = error.getStatus();
  if (status < 400 || status >= 500 || [408, 425, 429].includes(status)) return null;
  const response = error.getResponse();
  const responseBody =
    typeof response === "string"
      ? { code: "HTTP_ERROR", message: response, retryable: false }
      : response;
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "retryable" in responseBody &&
    responseBody.retryable === true
  ) {
    return null;
  }
  return { status, responseBody };
}

function exceptionResponse(value: unknown): string | Record<string, unknown> {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { code: "HTTP_ERROR", message: "Mutation failed.", retryable: false };
}

@Injectable()
export class KnowledgeV2IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async execute<T>(
    input: KnowledgeV2IdempotencyInput,
    mutation: (tx: Prisma.TransactionClient) => Promise<KnowledgeV2StoredResponse<T>>,
  ): Promise<KnowledgeV2IdempotencyResult<T>> {
    return this.executePrepared(
      input,
      () => Promise.resolve(undefined),
      (tx) => mutation(tx),
    );
  }

  async executePrepared<T, P>(
    input: KnowledgeV2IdempotencyInput,
    prepare: () => Promise<P>,
    mutation: (tx: Prisma.TransactionClient, prepared: P) => Promise<KnowledgeV2StoredResponse<T>>,
  ): Promise<KnowledgeV2IdempotencyResult<T>> {
    const endpoint = assertEndpoint(input.endpoint);
    const key = requireIdempotencyKey(input.key);
    const requestHash = canonicalKnowledgeV2Hash({ version: 1, endpoint, request: input.request });
    const lockKey = `knowledge-v2:idempotency:${input.tenantId}:${endpoint}:${key}`;
    const timeout = Math.min(Math.max(input.transactionTimeoutMs ?? 30_000, 30_000), 120_000);
    const claim = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT TRUE AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
        `);

        const now = new Date();
        await tx.$executeRaw(Prisma.sql`
          WITH expired AS (
            SELECT "id"
            FROM "KnowledgeV2IdempotencyRecord"
            WHERE "expiresAt" <= ${now}
            ORDER BY "expiresAt" ASC, "id" ASC
            LIMIT 32
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM "KnowledgeV2IdempotencyRecord" AS record
          USING expired
          WHERE record."id" = expired."id"
        `);
        const existing = await tx.knowledgeV2IdempotencyRecord.findUnique({
          where: {
            tenantId_endpoint_key: { tenantId: input.tenantId, endpoint, key },
          },
        });

        if (existing && existing.expiresAt > now) {
          if (existing.requestHash !== requestHash) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "IDEMPOTENCY_KEY_REUSED",
              "This Idempotency-Key was already used with different parameters.",
            );
          }
          if (existing.status !== "IN_PROGRESS" && existing.httpStatus !== null) {
            if (existing.status === "FAILED") {
              return {
                kind: "error" as const,
                status: existing.httpStatus,
                responseBody: existing.responseBody,
              };
            }
            return {
              kind: "response" as const,
              value: {
                httpStatus: existing.httpStatus,
                responseBody: existing.responseBody as unknown as T,
                responseRef: existing.responseRef,
                idempotencyReplayed: true,
              },
            };
          }
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_IDEMPOTENCY_IN_PROGRESS",
            "The original mutation is still being processed.",
            { retryable: true },
          );
        }

        if (existing) {
          await tx.knowledgeV2IdempotencyRecord.delete({ where: { id: existing.id } });
        }
        const record = await tx.knowledgeV2IdempotencyRecord.create({
          data: {
            tenantId: input.tenantId,
            endpoint,
            key,
            requestHash,
            status: "IN_PROGRESS",
            expiresAt: new Date(now.getTime() + preparationLeaseMs),
          },
        });
        return { kind: "claimed" as const, recordId: record.id };
      },
      { maxWait: 5_000, timeout },
    );
    if (claim.kind === "error") {
      throw new HttpException(exceptionResponse(claim.responseBody), claim.status);
    }
    if (claim.kind === "response") return claim.value;

    let prepared: P;
    let leaseLost = false;
    let renewal = Promise.resolve();
    const renewLease = () => {
      renewal = renewal
        .then(async () => {
          const renewed = await this.prisma.knowledgeV2IdempotencyRecord.updateMany({
            where: {
              id: claim.recordId,
              tenantId: input.tenantId,
              endpoint,
              key,
              requestHash,
              status: "IN_PROGRESS",
            },
            data: { expiresAt: new Date(Date.now() + preparationLeaseMs) },
          });
          if (renewed.count !== 1) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    };
    const leaseTimer = setInterval(renewLease, preparationLeaseRenewalMs);
    leaseTimer.unref();
    try {
      prepared = await prepare();
    } catch (error) {
      clearInterval(leaseTimer);
      await renewal;
      await this.finishPreparationFailure(claim.recordId, error, input.retentionMs);
      throw error;
    }
    clearInterval(leaseTimer);
    await renewal;
    if (leaseLost) {
      await this.prisma.knowledgeV2IdempotencyRecord
        .deleteMany({ where: { id: claim.recordId, status: "IN_PROGRESS" } })
        .catch(() => undefined);
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_IDEMPOTENCY_IN_PROGRESS",
        "The original mutation claim is unavailable.",
        { retryable: true },
      );
    }

    let outcome:
      | { kind: "error"; status: number; responseBody: unknown }
      | { kind: "response"; value: KnowledgeV2IdempotencyResult<T> };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`
            SELECT TRUE AS "locked"
            FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
          `);
          const mutationLease = new Date(
            Date.now() + Math.max(preparationLeaseMs, timeout + 30_000),
          );
          const renewed = await tx.knowledgeV2IdempotencyRecord.updateMany({
            where: {
              id: claim.recordId,
              tenantId: input.tenantId,
              endpoint,
              key,
              requestHash,
              status: "IN_PROGRESS",
            },
            data: { expiresAt: mutationLease },
          });
          if (renewed.count !== 1) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_CONFLICT_IDEMPOTENCY_IN_PROGRESS",
              "The original mutation claim is unavailable.",
              { retryable: true },
            );
          }
          const record = await tx.knowledgeV2IdempotencyRecord.findUniqueOrThrow({
            where: { id: claim.recordId },
          });
          await tx.$executeRawUnsafe("SAVEPOINT knowledge_v2_mutation");
          let response: KnowledgeV2StoredResponse<T>;
          try {
            response = await mutation(tx, prepared);
          } catch (error) {
            const terminal = deterministicClientError(error);
            if (!terminal) throw error;
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT knowledge_v2_mutation");
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT knowledge_v2_mutation");
            const normalized = normalizeResponse({
              httpStatus: terminal.status,
              responseBody: terminal.responseBody,
            });
            const body = normalized.responseBody as Record<string, unknown>;
            await tx.knowledgeV2IdempotencyRecord.update({
              where: { id: record.id },
              data: {
                status: "FAILED",
                httpStatus: terminal.status,
                responseBody: normalized.storedBody,
                errorCode: typeof body.code === "string" ? body.code : "HTTP_ERROR",
                completedAt: new Date(),
                expiresAt: new Date(Date.now() + retentionMs(input.retentionMs)),
              },
            });
            return {
              kind: "error" as const,
              status: terminal.status,
              responseBody: normalized.responseBody,
            };
          }
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT knowledge_v2_mutation");
          const normalized = normalizeResponse(response);
          await tx.knowledgeV2IdempotencyRecord.update({
            where: { id: record.id },
            data: {
              status:
                response.httpStatus >= 200 && response.httpStatus < 400 ? "SUCCEEDED" : "FAILED",
              httpStatus: response.httpStatus,
              responseRef: response.responseRef ?? null,
              responseBody: normalized.storedBody,
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + retentionMs(input.retentionMs)),
            },
          });
          if (response.httpStatus >= 400) {
            return {
              kind: "error" as const,
              status: response.httpStatus,
              responseBody: normalized.responseBody,
            };
          }
          return {
            kind: "response" as const,
            value: {
              httpStatus: response.httpStatus,
              responseBody: normalized.responseBody,
              responseRef: response.responseRef ?? null,
              idempotencyReplayed: false,
            },
          };
        },
        { maxWait: 5_000, timeout },
      );
    } catch (error) {
      await this.prisma.knowledgeV2IdempotencyRecord
        .deleteMany({ where: { id: claim.recordId, status: "IN_PROGRESS" } })
        .catch(() => undefined);
      throw error;
    }
    if (outcome.kind === "error") {
      throw new HttpException(exceptionResponse(outcome.responseBody), outcome.status);
    }
    return outcome.value;
  }

  private async finishPreparationFailure(
    recordId: string,
    error: unknown,
    requestedRetentionMs?: number,
  ) {
    const terminal = deterministicClientError(error);
    if (!terminal) {
      await this.prisma.knowledgeV2IdempotencyRecord.deleteMany({
        where: { id: recordId, status: "IN_PROGRESS" },
      });
      return;
    }
    const normalized = normalizeResponse({
      httpStatus: terminal.status,
      responseBody: terminal.responseBody,
    });
    const body = normalized.responseBody as Record<string, unknown>;
    await this.prisma.knowledgeV2IdempotencyRecord.updateMany({
      where: { id: recordId, status: "IN_PROGRESS" },
      data: {
        status: "FAILED",
        httpStatus: terminal.status,
        responseBody: normalized.storedBody,
        errorCode: typeof body.code === "string" ? body.code : "HTTP_ERROR",
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + retentionMs(requestedRetentionMs)),
      },
    });
  }
}
