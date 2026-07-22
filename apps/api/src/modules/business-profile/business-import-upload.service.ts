import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  BusinessImportFileAdmissionError,
  validateBusinessImportUploadMetadata,
} from "@leadvirt/business-import";
import {
  createDeterministicKnowledgeObjectKey,
  KnowledgeObjectStoreError,
} from "@leadvirt/knowledge";
import type {
  BusinessImportCreateIntentRequest,
  BusinessImportUploadIntentView,
  BusinessImportUploadReceiptView,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { businessImportError } from "./business-import-http.js";
import {
  adoptPendingBusinessImportObject,
  cleanupPendingBusinessImportObject,
  putPendingBusinessImportObject,
  reservePendingBusinessImportObject,
  type PendingBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

const ACTIVE_STATES = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "MAPPING_REQUIRED",
  "EXTRACTING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "APPLYING",
  "PROJECTING",
  "FAILED_RETRYABLE",
] as const;

const STAGING_RETENTION_MS = 24 * 60 * 60_000;

class BusinessImportUploadStreamError extends Error {
  constructor(readonly code: "BUSINESS_IMPORT_UPLOAD_ABORTED" | "BUSINESS_IMPORT_UPLOAD_TIMEOUT") {
    super(code);
    this.name = "BusinessImportUploadStreamError";
  }
}

@Injectable()
export class BusinessImportUploadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
    @Inject(BusinessInformationStateService)
    private readonly informationState: BusinessInformationStateService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async createIntent(
    context: RequestContext,
    input: BusinessImportCreateIntentRequest,
    idempotencyKey: string,
  ): Promise<BusinessImportUploadIntentView> {
    this.assertEditor(context);
    const runtime = this.runtimeService.runtime();
    const metadata = this.metadata(input.filename, input.declaredMimeType);
    if (
      (metadata.extension === "xlsx" && !this.config.businessImportXlsxSandboxApproved) ||
      metadata.extension === "pdf"
    ) {
      throw businessImportError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "BUSINESS_IMPORT_FORMAT_NOT_APPROVED",
        "This import format has not passed the production security gate.",
      );
    }
    if (input.byteSize > runtime.maxBytes) {
      throw businessImportError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "BUSINESS_IMPORT_FILE_TOO_LARGE",
        "The file exceeds the workspace import limit.",
        { field: "byteSize" },
      );
    }
    const sourceName = input.sourceName?.trim() || this.defaultSourceName(metadata.filename);
    const result = await this.idempotency.execute<{ importId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/business-profile/imports/intents",
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        });
        if (!membership || !["OWNER", "ADMIN", "MANAGER"].includes(membership.role)) {
          this.permissionDenied();
        }
        const state = await this.informationState.ensureInTransaction(tx, context);
        const pending = await tx.businessImport.count({
          where: { tenantId: context.tenantId, state: { in: [...ACTIVE_STATES] } },
        });
        const reserved = await tx.businessImportQuotaReservation.aggregate({
          where: { tenantId: context.tenantId, status: "RESERVED" },
          _sum: { retainedBytes: true },
        });
        const reservedLimit = BigInt(runtime.maxBytes) * BigInt(runtime.maxPendingPerTenant);
        if (
          pending >= runtime.maxPendingPerTenant ||
          (reserved._sum.retainedBytes ?? 0n) + BigInt(input.byteSize) > reservedLimit
        ) {
          throw businessImportError(
            HttpStatus.TOO_MANY_REQUESTS,
            "BUSINESS_IMPORT_PENDING_QUOTA_EXCEEDED",
            "The workspace already has the maximum number of active imports.",
            { retryable: true },
          );
        }
        const source = input.sourceId
          ? await tx.businessImportSource.findFirst({
              where: {
                id: input.sourceId,
                tenantId: context.tenantId,
                status: "ACTIVE",
              },
            })
          : await tx.businessImportSource.create({
              data: {
                tenantId: context.tenantId,
                lineageKey: `upload:${randomUUID()}`,
                displayName: sourceName,
                createdByUserId: context.userId,
                updatedByUserId: context.userId,
              },
            });
        if (!source) this.notFound();
        const importId = randomUUID();
        const expiresAt = new Date(Date.now() + runtime.uploadTtlMs);
        const uploadToken = this.runtimeService.uploadToken({
          tenantId: context.tenantId,
          importId,
          expiresAt,
        });
        const created = await tx.businessImport.create({
          data: {
            id: importId,
            tenantId: context.tenantId,
            sourceId: source.id,
            purpose: "SERVICES",
            format: this.format(metadata.extension),
            state: "CREATED",
            displayName: source.displayName,
            originalFilename: metadata.filename,
            declaredMimeType: metadata.declaredMimeType,
            expectedByteSize: BigInt(input.byteSize),
            uploadTokenHash: createHash("sha256").update(uploadToken).digest("hex"),
            baseBusinessRevisionId: state.currentRevisionId,
            baseInformationRevision: state.revision,
            baseInformationHash: state.canonicalHash,
            selectedCategories: ["OFFERINGS"],
            schemaVersion: "leadvirt.services.v1",
            expiresAt,
            createdByUserId: context.userId,
          },
        });
        await tx.businessImportQuotaReservation.create({
          data: {
            tenantId: context.tenantId,
            importId: created.id,
            rawBytes: BigInt(input.byteSize),
            retainedBytes: BigInt(input.byteSize),
            expiresAt,
          },
        });
        await tx.businessImportSource.update({
          where: { id: source.id },
          data: {
            latestImportId: created.id,
            etag: { increment: 1 },
            updatedByUserId: context.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.intent_created",
            entityType: "business_import",
            entityId: created.id,
            payload: {
              sourceId: source.id,
              format: created.format,
              expectedByteSize: input.byteSize,
              baseInformationRevision: state.revision,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: { importId: created.id },
          responseRef: created.id,
        };
      },
    );
    const record = await this.prisma.businessImport.findFirst({
      where: { id: result.responseBody.importId, tenantId: context.tenantId },
    });
    if (!record) this.notFound();
    const token = this.runtimeService.uploadToken({
      tenantId: record.tenantId,
      importId: record.id,
      expiresAt: record.expiresAt,
    });
    return {
      id: record.id,
      importId: record.id,
      uploadUrl: `${this.config.apiUrl.replace(/\/$/u, "")}/api/business-profile/imports/${record.id}/content`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": record.declaredMimeType,
        "Content-Length": record.expectedByteSize.toString(),
      },
      policy: {
        maxBytes: runtime.maxBytes,
        expectedBytes: Number(record.expectedByteSize),
        allowedMimeTypes: [record.declaredMimeType],
        expiresAt: record.expiresAt.toISOString(),
        oneTime: true,
      },
      idempotencyReplayed: result.idempotencyReplayed,
    };
  }

  async upload(
    importId: string,
    authorization: string | undefined,
    contentType: string | undefined,
    contentLength: string | undefined,
    stream: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<BusinessImportUploadReceiptView> {
    const runtime = this.runtimeService.runtime();
    const record = await this.prisma.businessImport.findUnique({ where: { id: importId } });
    if (!record) this.notFound();
    const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    this.runtimeService.verifyUploadToken(record.uploadTokenHash, provided);
    if (contentType !== record.declaredMimeType) this.policyMismatch("Content-Type");
    const length = Number(contentLength ?? "");
    if (!Number.isSafeInteger(length) || BigInt(length) !== record.expectedByteSize) {
      this.policyMismatch("Content-Length");
    }
    if (record.uploadedAt) {
      return {
        importId: record.id,
        status: "UPLOADED",
        uploadedAt: record.uploadedAt.toISOString(),
      };
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.businessImport.updateMany({
          where: { id: record.id, state: "CREATED" },
          data: {
            state: "EXPIRED",
            failureCode: "BUSINESS_IMPORT_UPLOAD_EXPIRED",
            etag: { increment: 1 },
          },
        });
        if (expired.count === 1) {
          await tx.businessImportQuotaReservation.updateMany({
            where: { tenantId: record.tenantId, importId: record.id, status: "RESERVED" },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
        }
      });
      throw businessImportError(
        HttpStatus.GONE,
        "BUSINESS_IMPORT_UPLOAD_EXPIRED",
        "The upload link has expired.",
      );
    }
    const claimed = await this.prisma.businessImport.updateMany({
      where: { id: record.id, state: "CREATED", expiresAt: { gt: new Date() } },
      data: { state: "UPLOADING", etag: { increment: 1 }, failureCode: null },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.businessImport.findUnique({ where: { id: record.id } });
      if (current?.uploadedAt) {
        return {
          importId: current.id,
          status: "UPLOADED",
          uploadedAt: current.uploadedAt.toISOString(),
        };
      }
      if (current?.state === "UPLOADING") {
        throw businessImportError(
          HttpStatus.CONFLICT,
          "BUSINESS_IMPORT_UPLOAD_IN_PROGRESS",
          "The original upload is still being processed.",
          { retryable: true },
        );
      }
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_UPLOAD_ALREADY_USED",
        "This one-time upload link has already been used.",
      );
    }
    const objectKey = createDeterministicKnowledgeObjectKey({
      tenantId: record.tenantId,
      sourceId: record.sourceId,
      purpose: "raw",
      identity: `business-import-staging:${record.id}`,
    });
    let reservation: PendingBusinessImportObject | null = null;
    try {
      const bytes = await this.readExact(
        stream,
        length,
        runtime.maxBytes,
        runtime.uploadStreamTimeoutMs,
        signal,
      );
      reservation = await reservePendingBusinessImportObject(this.prisma, {
        tenantId: record.tenantId,
        objectKind: "STAGING",
        objectStorageKey: objectKey,
        encryptionKeyRef: runtime.objectEncryptionKeyId,
        pendingScope: `UPLOAD:${record.id}`,
        retainUntil: new Date(Date.now() + STAGING_RETENTION_MS),
      });
      const write = await putPendingBusinessImportObject(
        this.prisma,
        runtime.store,
        reservation,
        bytes,
      );
      const uploadedAt = new Date();
      const stagingRetainUntil = new Date(uploadedAt.getTime() + STAGING_RETENTION_MS);
      await this.prisma.$transaction(async (tx) => {
        await adoptPendingBusinessImportObject(
          tx,
          reservation!,
          "BUSINESS_IMPORT_STAGING",
          stagingRetainUntil,
        );
        const updated = await tx.businessImport.updateMany({
          where: { id: record.id, state: "UPLOADING" },
          data: {
            state: "UPLOADED",
            stagingObjectKey: objectKey,
            stagingEncryptionKeyRef: write.encryptionKeyRef,
            stagingObjectLedgerId: reservation!.ledgerId,
            stagingObjectKind: "STAGING",
            uploadedAt,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error("BUSINESS_IMPORT_UPLOAD_CLAIM_LOST");
        await tx.auditLog.create({
          data: {
            tenantId: record.tenantId,
            actorUserId: record.createdByUserId,
            action: "business_import.upload_received",
            entityType: "business_import",
            entityId: record.id,
            payload: { byteSize: length, declaredMimeType: record.declaredMimeType },
          },
        });
      });
      return { importId: record.id, status: "UPLOADED", uploadedAt: uploadedAt.toISOString() };
    } catch (error) {
      const code =
        error instanceof BusinessImportUploadStreamError
          ? error.code
          : error instanceof KnowledgeObjectStoreError
            ? "BUSINESS_IMPORT_STORAGE_UNAVAILABLE"
            : "BUSINESS_IMPORT_UPLOAD_INVALID";
      await this.prisma.$transaction(async (tx) => {
        const rejected = await tx.businessImport.updateMany({
          where: { id: record.id, state: "UPLOADING" },
          data: {
            state: "REJECTED",
            failureCode: code,
            failureStage: "UPLOAD",
            stagingObjectKey: null,
            stagingEncryptionKeyRef: null,
            etag: { increment: 1 },
          },
        });
        if (rejected.count === 1) {
          await tx.businessImportQuotaReservation.updateMany({
            where: { tenantId: record.tenantId, importId: record.id, status: "RESERVED" },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
        }
      });
      if (reservation) {
        await cleanupPendingBusinessImportObject(this.prisma, runtime.store, reservation).catch(
          () => undefined,
        );
      }
      if (error instanceof BusinessImportUploadStreamError) {
        throw businessImportError(
          error.code === "BUSINESS_IMPORT_UPLOAD_TIMEOUT"
            ? HttpStatus.REQUEST_TIMEOUT
            : HttpStatus.BAD_REQUEST,
          error.code,
          error.code === "BUSINESS_IMPORT_UPLOAD_TIMEOUT"
            ? "The upload did not complete before its deadline."
            : "The upload stream was interrupted.",
          { retryable: error.code === "BUSINESS_IMPORT_UPLOAD_TIMEOUT" },
        );
      }
      if (error instanceof KnowledgeObjectStoreError) {
        throw businessImportError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
          "Import storage is temporarily unavailable.",
          { retryable: error.code === "STORAGE_FAILED" },
        );
      }
      throw businessImportError(
        HttpStatus.BAD_REQUEST,
        "BUSINESS_IMPORT_UPLOAD_INVALID",
        "The uploaded byte stream did not match the issued policy.",
      );
    }
  }

  admissionError(error: unknown) {
    const admission =
      error instanceof BusinessImportFileAdmissionError
        ? error
        : new BusinessImportFileAdmissionError("BUSINESS_IMPORT_SCANNER_ERROR", true);
    return businessImportError(
      admission.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.UNPROCESSABLE_ENTITY,
      admission.code,
      admission.retryable
        ? "The file security scan is temporarily unavailable."
        : "The file did not pass the import security policy.",
      { retryable: admission.retryable },
    );
  }

  private metadata(filename: string, declaredMimeType: string) {
    try {
      return validateBusinessImportUploadMetadata({ filename, declaredMimeType });
    } catch (error) {
      throw this.admissionError(error);
    }
  }

  private defaultSourceName(filename: string) {
    return filename.slice(0, -extname(filename).length).trim().slice(0, 160) || "Business import";
  }

  private format(extension: "csv" | "xlsx" | "pdf") {
    return extension.toLocaleUpperCase() as "CSV" | "XLSX" | "PDF";
  }

  private async readExact(
    stream: AsyncIterable<Uint8Array>,
    expected: number,
    maximum: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const iterator = stream[Symbol.asyncIterator]();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    timer.unref();
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    try {
      while (true) {
        if (combined.aborted) {
          throw new BusinessImportUploadStreamError(
            deadline.signal.aborted
              ? "BUSINESS_IMPORT_UPLOAD_TIMEOUT"
              : "BUSINESS_IMPORT_UPLOAD_ABORTED",
          );
        }
        const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          const aborted = () =>
            reject(
              new BusinessImportUploadStreamError(
                deadline.signal.aborted
                  ? "BUSINESS_IMPORT_UPLOAD_TIMEOUT"
                  : "BUSINESS_IMPORT_UPLOAD_ABORTED",
              ),
            );
          combined.addEventListener("abort", aborted, { once: true });
          iterator
            .next()
            .then(resolve, reject)
            .finally(() => combined.removeEventListener("abort", aborted));
        });
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new Error("invalid stream");
        size += next.value.byteLength;
        if (size > expected || size > maximum) throw new Error("invalid stream");
        chunks.push(next.value);
      }
    } catch (error) {
      void iterator.return?.().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (size !== expected) throw new Error("invalid stream");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private permissionDenied(): never {
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "Only an owner, administrator, or manager can import business information.",
    );
  }

  private policyMismatch(header: string): never {
    throw businessImportError(
      HttpStatus.BAD_REQUEST,
      "BUSINESS_IMPORT_UPLOAD_POLICY_MISMATCH",
      `The ${header} header does not match the issued upload policy.`,
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }
}
