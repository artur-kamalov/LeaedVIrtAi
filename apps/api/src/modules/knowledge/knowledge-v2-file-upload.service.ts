import {
  createHash,
  createHmac,
  hkdfSync,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  admitKnowledgeFile,
  ClamAvKnowledgeFileScanner,
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeFileAdmissionError,
  KnowledgeObjectStoreError,
  validateKnowledgeFileUploadMetadata,
  type AcceptedKnowledgeFile,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2AcceptedMutation,
  KnowledgeV2CreateFileUploadIntentRequest,
  KnowledgeV2FileUploadIntentView,
  KnowledgeV2FileUploadReceiptView,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { knowledgeV2Error } from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import { canonicalKnowledgeV2Locale, canonicalKnowledgeV2Scope } from "./knowledge-v2-scope.js";
import { KnowledgeSourceQueueService } from "./knowledge-source-queue.service.js";

const pipelineVersion = "knowledge-v2";
const allowedMimeTypes = ["text/plain", "text/csv"] as const;

class UploadStreamError extends Error {
  constructor(readonly code: "KNOWLEDGE_UPLOAD_STREAM_ABORTED" | "KNOWLEDGE_UPLOAD_STREAM_TIMEOUT") {
    super(code);
    this.name = "UploadStreamError";
  }
}

function databaseJson(value: Prisma.InputJsonObject | null) {
  return value === null ? Prisma.DbNull : value;
}

function opaqueId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

@Injectable()
export class KnowledgeV2FileUploadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeSourceQueueService)
    private readonly queue: KnowledgeSourceQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async createIntent(
    context: RequestContext,
    input: KnowledgeV2CreateFileUploadIntentRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2FileUploadIntentView> {
    this.assertEditor(context);
    const runtime = this.runtime();
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_DISPLAY_NAME_REQUIRED",
        "A file source name is required.",
        { field: "displayName" },
      );
    }
    const metadata = this.validateMetadata(input.filename, input.declaredMimeType);
    if (input.byteSize > runtime.maxBytes) {
      throw knowledgeV2Error(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "KNOWLEDGE_UPLOAD_FILE_TOO_LARGE",
        "The file exceeds the workspace upload limit.",
        { field: "byteSize" },
      );
    }
    this.assertClassification(input.defaultClassification, input.defaultScope?.audiences ?? []);
    const result = await this.idempotency.execute<{ intentId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/file-uploads/intents",
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        });
        if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) this.permissionDenied();
        const intentId = randomUUID();
        const expiresAt = new Date(Date.now() + runtime.ttlMs);
        const token = this.token(intentId, context.tenantId, expiresAt, runtime.signingKey);
        await tx.knowledgeV2FileUploadIntent.create({
          data: {
            id: intentId,
            tenantId: context.tenantId,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            displayName,
            originalFilename: metadata.filename,
            declaredMimeType: metadata.declaredMimeType,
            expectedByteSize: BigInt(input.byteSize),
            defaultScope: databaseJson(canonicalKnowledgeV2Scope(input.defaultScope)),
            defaultClassification: input.defaultClassification,
            defaultLocale: canonicalKnowledgeV2Locale(input.defaultLocale),
            expiresAt,
            createdByUserId: context.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "knowledge.v2.file_upload.intent_created",
            entityType: "knowledge_v2_file_upload_intent",
            entityId: intentId,
            payload: {
              expectedByteSize: input.byteSize,
              declaredMimeType: metadata.declaredMimeType,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: { intentId },
          responseRef: intentId,
        };
      },
    );
    const intent = await this.prisma.knowledgeV2FileUploadIntent.findFirst({
      where: { id: result.responseBody.intentId, tenantId: context.tenantId },
    });
    if (!intent) this.notFound();
    const token = this.token(intent.id, intent.tenantId, intent.expiresAt, runtime.signingKey);
    return {
      id: intent.id,
      uploadUrl: `${this.config.apiUrl.replace(/\/$/u, "")}/api/knowledge/v2/file-uploads/${intent.id}/content`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": intent.declaredMimeType as (typeof allowedMimeTypes)[number],
        "Content-Length": intent.expectedByteSize.toString(),
      },
      policy: {
        maxBytes: runtime.maxBytes,
        expectedBytes: Number(intent.expectedByteSize),
        allowedMimeTypes,
        expiresAt: intent.expiresAt.toISOString(),
        oneTime: true,
      },
      idempotencyReplayed: result.idempotencyReplayed,
    };
  }

  async upload(
    intentId: string,
    authorization: string | undefined,
    contentType: string | undefined,
    contentLength: string | undefined,
    stream: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<KnowledgeV2FileUploadReceiptView> {
    const runtime = this.runtime();
    const intent = await this.prisma.knowledgeV2FileUploadIntent.findUnique({
      where: { id: intentId },
    });
    if (!intent) this.notFound();
    this.assertToken(intent, authorization);
    if (intent.expiresAt.getTime() <= Date.now()) {
      await this.prisma.knowledgeV2FileUploadIntent.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: { status: "EXPIRED", errorCode: "KNOWLEDGE_UPLOAD_INTENT_EXPIRED" },
      });
      throw knowledgeV2Error(
        HttpStatus.GONE,
        "KNOWLEDGE_UPLOAD_INTENT_EXPIRED",
        "The upload link has expired.",
      );
    }
    if (contentType !== intent.declaredMimeType) this.uploadPolicyMismatch("Content-Type");
    const parsedLength = Number(contentLength ?? "");
    if (!Number.isSafeInteger(parsedLength) || BigInt(parsedLength) !== intent.expectedByteSize) {
      this.uploadPolicyMismatch("Content-Length");
    }
    const claimed = await this.prisma.knowledgeV2FileUploadIntent.updateMany({
      where: { id: intent.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "UPLOADING", errorCode: null },
    });
    if (claimed.count !== 1) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED",
        "This one-time upload link has already been used.",
      );
    }
    const stagingObjectKey = createDeterministicKnowledgeObjectKey({
      tenantId: intent.tenantId,
      sourceId: intent.id,
      purpose: "raw",
      identity: `file-upload-staging:${intent.id}`,
    });
    try {
      const bytes = await this.readExact(
        stream,
        parsedLength,
        runtime.maxBytes,
        runtime.streamTimeoutMs,
        signal,
      );
      const write = await runtime.store.put(stagingObjectKey, bytes);
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.knowledgeV2FileUploadIntent.updateMany({
          where: { id: intent.id, status: "UPLOADING" },
          data: {
            status: "UPLOADED",
            stagingObjectKey,
            stagingEncryptionKeyRef: write.encryptionKeyRef,
            uploadedAt: now,
          },
        });
        if (updated.count !== 1) throw new Error("upload claim lost");
        await tx.auditLog.create({
          data: {
            tenantId: intent.tenantId,
            actorUserId: intent.createdByUserId,
            action: "knowledge.v2.file_upload.received",
            entityType: "knowledge_v2_file_upload_intent",
            entityId: intent.id,
            payload: { byteSize: parsedLength, declaredMimeType: intent.declaredMimeType },
          },
        });
      });
      return { uploadIntentId: intent.id, status: "UPLOADED", uploadedAt: now.toISOString() };
    } catch (error) {
      await runtime.store.delete(stagingObjectKey).catch(() => undefined);
      const streamErrorCode =
        error instanceof UploadStreamError ? error.code : "KNOWLEDGE_UPLOAD_STREAM_INVALID";
      await this.prisma.knowledgeV2FileUploadIntent.updateMany({
        where: { id: intent.id, status: "UPLOADING" },
        data: {
          status: "REJECTED",
          stagingObjectKey: null,
          stagingEncryptionKeyRef: null,
          errorCode: streamErrorCode,
        },
      });
      if (error instanceof Error && error.message === "upload claim lost") {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED",
          "This one-time upload link is no longer available.",
        );
      }
      if (error instanceof UploadStreamError && error.code === "KNOWLEDGE_UPLOAD_STREAM_TIMEOUT") {
        throw knowledgeV2Error(
          HttpStatus.REQUEST_TIMEOUT,
          error.code,
          "The upload stream did not complete before its deadline.",
          { retryable: true },
        );
      }
      if (error instanceof UploadStreamError) {
        throw knowledgeV2Error(
          HttpStatus.BAD_REQUEST,
          error.code,
          "The upload stream was interrupted before completion.",
        );
      }
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_UPLOAD_STREAM_INVALID",
        "The uploaded byte stream did not match the issued policy.",
      );
    }
  }

  async complete(
    context: RequestContext,
    intentId: string,
    idempotencyKey: string,
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertEditor(context);
    const runtime = this.runtime();
    let eventId: string | null = null;
    let result;
    try {
      result = await this.idempotency.executePrepared<KnowledgeV2AcceptedMutation, {
      intentId: string;
      sourceId: string;
      artifactId: string;
      accepted: AcceptedKnowledgeFile;
      objectStorageKey: string;
      encryptionKeyRef: string;
    }>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/file-uploads/:intentId/complete",
        key: idempotencyKey,
        request: { intentId },
      },
      async () => {
        const intent = await this.prisma.knowledgeV2FileUploadIntent.findFirst({
          where: { id: intentId, tenantId: context.tenantId },
        });
        if (!intent) this.notFound();
        const membership = await this.prisma.membership.findUnique({
          where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        });
        if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) this.permissionDenied();
        if (intent.status !== "UPLOADED" || !intent.stagingObjectKey || !intent.stagingEncryptionKeyRef) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_UPLOAD_NOT_READY",
            "The file upload is not ready to finalize.",
          );
        }
        const claimed = await this.prisma.knowledgeV2FileUploadIntent.updateMany({
          where: { id: intent.id, tenantId: context.tenantId, status: "UPLOADED" },
          data: { status: "FINALIZING", errorCode: null },
        });
        if (claimed.count !== 1) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_UPLOAD_FINALIZATION_IN_PROGRESS",
            "The file upload is already being finalized.",
            { retryable: true },
          );
        }
        try {
          const bytes = await runtime.store.get(
            intent.stagingObjectKey,
            intent.stagingEncryptionKeyRef,
          );
          const accepted = await admitKnowledgeFile(
            {
              filename: intent.originalFilename,
              declaredMimeType: intent.declaredMimeType,
              stream: Readable.from([bytes]),
            },
            {
              maxBytes: runtime.maxBytes,
              scannerTimeoutMs: this.config.knowledgeFileScannerTimeoutMs,
              scanner: runtime.scanner,
              audit: (event) =>
                this.prisma.auditLog.create({
                  data: {
                    tenantId: intent.tenantId,
                    actorUserId: intent.createdByUserId,
                    action: `knowledge.v2.file_upload.admission_${event.outcome.toLowerCase()}`,
                    entityType: "knowledge_v2_file_upload_intent",
                    entityId: intent.id,
                    payload: event as unknown as Prisma.InputJsonObject,
                  },
                }).then(() => undefined),
            },
          );
          if (accepted.provenance.byteSize !== Number(intent.expectedByteSize)) {
            throw new KnowledgeFileAdmissionError("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
          }
          const sourceId = opaqueId("kfs", intent.id);
          const artifactId = opaqueId("kfa", intent.id);
          return {
            intentId: intent.id,
            sourceId,
            artifactId,
            accepted,
            objectStorageKey: intent.stagingObjectKey,
            encryptionKeyRef: intent.stagingEncryptionKeyRef,
          };
        } catch (error) {
          const retryable =
            (error instanceof KnowledgeFileAdmissionError && error.retryable) ||
            (error instanceof KnowledgeObjectStoreError && error.code === "STORAGE_FAILED");
          await this.finishRejectedPreparation(intent, runtime.store, error, retryable);
          throw this.admissionHttpError(error);
        }
      },
      async (tx, prepared) => {
        const intent = await tx.knowledgeV2FileUploadIntent.findFirst({
          where: { id: prepared.intentId, tenantId: context.tenantId },
        });
        if (!intent || intent.status !== "FINALIZING" || intent.sourceId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_UPLOAD_FINALIZATION_STALE",
            "The file upload finalization was superseded.",
          );
        }
        const membership = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        });
        if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) this.permissionDenied();
        await this.assertCreateQuota(tx, context.tenantId);
        const now = new Date();
        const source = await tx.knowledgeV2Source.create({
          data: {
            id: prepared.sourceId,
            tenantId: context.tenantId,
            kind: "FILE",
            displayName: intent.displayName,
            externalRootKey: `file:${intent.id}`,
            syncMode: "MANUAL",
            status: "CONNECTING",
            defaultScope: intent.defaultScope ?? Prisma.DbNull,
            defaultClassification: intent.defaultClassification,
            defaultLocale: intent.defaultLocale,
            lastAttemptAt: now,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
        });
        const artifact = await tx.knowledgeV2Artifact.create({
          data: {
            id: prepared.artifactId,
            tenantId: context.tenantId,
            sourceId: source.id,
            objectStorageKey: prepared.objectStorageKey,
            encryptionKeyRef: prepared.encryptionKeyRef,
            sha256: prepared.accepted.provenance.sha256,
            byteSize: BigInt(prepared.accepted.provenance.byteSize),
            detectedMimeType: prepared.accepted.provenance.detectedMimeType,
            declaredMimeType: prepared.accepted.provenance.declaredMimeType,
            originalFilename: prepared.accepted.provenance.filename,
            malwareStatus: "CLEAN",
            mimeValidationStatus: "VALID",
            securityClassification: source.defaultClassification,
            retentionClass: "KNOWLEDGE_SOURCE_STANDARD",
            scannedAt: now,
          },
        });
        const job = await tx.knowledgeJob.create({
          data: {
            id: randomUUID(),
            tenantId: context.tenantId,
            idempotencyKey: `knowledge-source:import:${source.id}:${source.generation}`,
            stage: "ACQUIRING",
            pipelineVersion,
            generation: source.generation,
            status: "QUEUED",
            deadlineAt: new Date(now.getTime() + 30 * 60_000),
            maxAttempts: 5,
            v2SourceId: source.id,
          },
        });
        const event = await this.queue.createEvent(tx, {
          tenantId: context.tenantId,
          sourceId: source.id,
          knowledgeJobId: job.id,
          generation: source.generation,
          operation: "IMPORT",
          requestedByUserId: context.userId,
          requestedAt: now.toISOString(),
        });
        eventId = event.id;
        await tx.knowledgeJob.update({
          where: { id: job.id },
          data: { payloadRef: `runtime-outbox:${event.id}` },
        });
        await tx.knowledgeV2FileUploadIntent.update({
          where: { id: intent.id },
          data: {
            status: "COMPLETED",
            sourceId: source.id,
            artifactId: artifact.id,
            knowledgeJobId: job.id,
            finalizedAt: now,
            stagingObjectKey: null,
            stagingEncryptionKeyRef: null,
          },
        });
        await tx.knowledgeV2Settings.upsert({
          where: { tenantId: context.tenantId },
          create: { tenantId: context.tenantId, draftGeneration: 2 },
          update: { draftGeneration: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "knowledge.v2.file_upload.finalized",
            entityType: "knowledge_v2_file_upload_intent",
            entityId: intent.id,
            payload: {
              sourceId: source.id,
              artifactId: artifact.id,
              knowledgeJobId: job.id,
              sha256: prepared.accepted.provenance.sha256,
            },
          },
        });
        const accepted: KnowledgeV2AcceptedMutation = {
          jobId: job.id,
          status: job.status,
          acceptedAt: job.createdAt.toISOString(),
          resource: { type: "SOURCE", id: source.id },
          idempotencyReplayed: false,
        };
        return { httpStatus: HttpStatus.ACCEPTED, responseBody: accepted, responseRef: job.id };
      },
      );
    } catch (error) {
      await this.prisma.knowledgeV2FileUploadIntent.updateMany({
        where: {
          id: intentId,
          tenantId: context.tenantId,
          status: "FINALIZING",
          sourceId: null,
        },
        data: { status: "UPLOADED" },
      }).catch(() => undefined);
      throw error;
    }
    if (eventId && !result.idempotencyReplayed) this.queue.dispatch(eventId);
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private runtime() {
    const path = this.config.knowledgeObjectStorePath?.trim();
    const encodedKey = this.config.knowledgeArtifactEncryptionKey?.trim();
    const scannerHost = this.config.knowledgeFileScannerHost?.trim();
    if (
      !this.config.knowledgeFileImportEnabled ||
      !this.config.knowledgeFileScannerApproved ||
      !path ||
      !isAbsolute(path) ||
      !encodedKey ||
      !scannerHost
    ) {
      this.disabled();
    }
    let key: Uint8Array;
    try {
      key = decodeKnowledgeObjectEncryptionKey(encodedKey);
    } catch {
      this.disabled();
    }
    const maxBytes = this.config.knowledgeMaxFileBytes;
    return {
      signingKey: new Uint8Array(
        hkdfSync(
          "sha256",
          key!,
          Buffer.from("leadvirt-knowledge-file-upload-v1", "utf8"),
          Buffer.from("signed-one-time-upload-token", "utf8"),
          32,
        ),
      ),
      maxBytes,
      ttlMs: this.config.knowledgeFileUploadTtlSeconds * 1000,
      streamTimeoutMs: this.config.knowledgeFileUploadStreamTimeoutMs,
      store: new EncryptedFileKnowledgeObjectStore({
        rootPath: path,
        activeKey: { id: this.config.knowledgeArtifactEncryptionKeyId, key: key! },
        maxPlaintextBytes: maxBytes,
      }),
      scanner: new ClamAvKnowledgeFileScanner({
        host: scannerHost,
        port: this.config.knowledgeFileScannerPort,
        version: this.config.knowledgeFileScannerVersion,
        approvedForProduction: this.config.knowledgeFileScannerApproved,
      }),
    };
  }

  private validateMetadata(filename: string, declaredMimeType: string) {
    try {
      const metadata = validateKnowledgeFileUploadMetadata({ filename, declaredMimeType });
      if (metadata.extension === "pdf") {
        throw knowledgeV2Error(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "KNOWLEDGE_PARSE_PDF_SANDBOX_REQUIRED",
          "PDF import is unavailable until a sandboxed parser is configured.",
          { field: "declaredMimeType" },
        );
      }
      return metadata;
    } catch (error) {
      if (error instanceof KnowledgeFileAdmissionError) throw this.admissionHttpError(error);
      throw error;
    }
  }

  private token(intentId: string, tenantId: string, expiresAt: Date, signingKey: Uint8Array) {
    return createHmac("sha256", signingKey)
      .update(`knowledge-file-upload-v1\0${tenantId}\0${intentId}\0${expiresAt.toISOString()}`)
      .digest("base64url");
  }

  private assertToken(
    intent: { id: string; tenantId: string; expiresAt: Date; tokenHash: string },
    authorization: string | undefined,
  ) {
    const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const providedHash = createHash("sha256").update(provided).digest();
    const expectedHash = Buffer.from(intent.tokenHash, "hex");
    if (!provided || expectedHash.byteLength !== providedHash.byteLength || !timingSafeEqual(providedHash, expectedHash)) this.notFound();
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
    const combinedSignal = signal
      ? AbortSignal.any([signal, deadline.signal])
      : deadline.signal;
    try {
      while (true) {
        if (combinedSignal.aborted) {
          throw new UploadStreamError(
            deadline.signal.aborted ? "KNOWLEDGE_UPLOAD_STREAM_TIMEOUT" : "KNOWLEDGE_UPLOAD_STREAM_ABORTED",
          );
        }
        const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          const onAbort = () => {
            reject(
              new UploadStreamError(
                deadline.signal.aborted
                  ? "KNOWLEDGE_UPLOAD_STREAM_TIMEOUT"
                  : "KNOWLEDGE_UPLOAD_STREAM_ABORTED",
              ),
            );
          };
          combinedSignal.addEventListener("abort", onAbort, { once: true });
          iterator.next().then(
            (value) => {
              combinedSignal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (error: unknown) => {
              combinedSignal.removeEventListener("abort", onAbort);
              reject(error instanceof Error ? error : new Error("invalid stream"));
            },
          );
        });
        if (next.done) break;
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) throw new Error("invalid stream");
        size += chunk.byteLength;
        if (size > expected || size > maximum) throw new Error("invalid stream");
        chunks.push(chunk);
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

  private async finishRejectedPreparation(
    intent: { id: string; stagingObjectKey: string | null },
    store: EncryptedFileKnowledgeObjectStore,
    error: unknown,
    retryable: boolean,
  ) {
    if (retryable) {
      await this.prisma.knowledgeV2FileUploadIntent.updateMany({
        where: { id: intent.id, status: "FINALIZING" },
        data: {
          status: "UPLOADED",
          errorCode:
            error instanceof KnowledgeFileAdmissionError
              ? error.code
              : "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
        },
      });
      return;
    }
    if (intent.stagingObjectKey) await store.delete(intent.stagingObjectKey).catch(() => undefined);
    await this.prisma.knowledgeV2FileUploadIntent.updateMany({
      where: { id: intent.id, status: "FINALIZING" },
      data: {
        status: "REJECTED",
        stagingObjectKey: null,
        stagingEncryptionKeyRef: null,
        errorCode:
          error instanceof KnowledgeFileAdmissionError
            ? error.code
            : "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      },
    });
  }

  private admissionHttpError(error: unknown) {
    if (error instanceof KnowledgeObjectStoreError) {
      return knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
        "Knowledge artifact storage is temporarily unavailable.",
        { retryable: error.code === "STORAGE_FAILED" },
      );
    }
    const admission =
      error instanceof KnowledgeFileAdmissionError
        ? error
        : new KnowledgeFileAdmissionError("KNOWLEDGE_UPLOAD_SCANNER_ERROR", true);
    return knowledgeV2Error(
      admission.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.UNPROCESSABLE_ENTITY,
      admission.code,
      admission.retryable
        ? "The file security scan is temporarily unavailable."
        : "The file did not pass the upload security policy.",
      { retryable: admission.retryable },
    );
  }

  private async assertCreateQuota(tx: Prisma.TransactionClient, tenantId: string) {
    const settings = await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: { maxDocuments: true },
    });
    const [documents, emptySources] = await Promise.all([
      tx.knowledgeV2Document.count({ where: { tenantId, deletedAt: null } }),
      tx.knowledgeV2Source.count({
        where: {
          tenantId,
          status: { notIn: ["DELETING", "DELETED"] },
          documents: { none: { deletedAt: null } },
        },
      }),
    ]);
    if (documents + emptySources >= settings.maxDocuments) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_QUOTA_DOCUMENTS_EXCEEDED",
        "The workspace knowledge document limit has been reached.",
      );
    }
  }

  private assertClassification(classification: string, audiences: readonly string[]) {
    if (classification === "PUBLIC" || (audiences.length > 0 && audiences.every((value) => value === "INTERNAL"))) return;
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_SCOPE_CLASSIFICATION_CONFLICT",
      "Internal source content must use an internal audience.",
      { field: "defaultScope" },
    );
  }

  private assertEditor(context: RequestContext) {
    if (context.role !== "OWNER" && context.role !== "ADMIN") this.permissionDenied();
  }

  private permissionDenied(): never {
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
      "Only an owner or administrator can upload knowledge files.",
    );
  }

  private uploadPolicyMismatch(header: string): never {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_UPLOAD_POLICY_MISMATCH",
      `The ${header} header does not match the issued upload policy.`,
    );
  }

  private disabled(): never {
    throw knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_FILE_INGESTION_DISABLED",
      "File source ingestion is not available.",
      { retryable: false },
    );
  }

  private notFound(): never {
    throw knowledgeV2Error(HttpStatus.NOT_FOUND, "KNOWLEDGE_SOURCE_NOT_FOUND", "Upload not found.");
  }
}
