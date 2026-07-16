import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  admitWebsiteSourceUrl,
  createKnowledgeAcceptanceWebsiteFixture,
  decodeKnowledgeObjectEncryptionKey,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2AcceptedMutation,
  KnowledgeV2ChunkView,
  KnowledgeV2CreateSourceRequest,
  KnowledgeV2DocumentListQuery,
  KnowledgeV2DocumentPage,
  KnowledgeV2DocumentView,
  KnowledgeV2ElementView,
  KnowledgeV2ErrorCode,
  KnowledgeV2ExcludeRevisionRequest,
  KnowledgeV2JsonValue,
  KnowledgeV2MutationResult,
  KnowledgeV2RevisionListQuery,
  KnowledgeV2RevisionPage,
  KnowledgeV2RevisionPreviewView,
  KnowledgeV2RevisionView,
  KnowledgeV2SourceListQuery,
  KnowledgeV2SourceMutationResult,
  KnowledgeV2SourcePage,
  KnowledgeV2SourceView,
  KnowledgeV2UpdateSourceRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  KnowledgeV2DeleteSourceDto,
  KnowledgeV2SourceActionDto,
} from "./dto/knowledge-v2-source.dto.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import {
  KnowledgeV2IdempotencyService,
  type KnowledgeV2IdempotencyResult,
} from "./knowledge-v2-idempotency.service.js";
import {
  canonicalKnowledgeV2Locale,
  canonicalKnowledgeV2Scope,
  knowledgeV2ScopeView,
} from "./knowledge-v2-scope.js";
import { KnowledgeSourceQueueService } from "./knowledge-source-queue.service.js";

const pipelineVersion = "knowledge-v2";
const deferredPausedSyncCode = "KNOWLEDGE_SOURCE_SYNC_DEFERRED_PAUSED";
const deletionSubsystems = ["POSTGRES_CONTENT", "OBJECT_STORAGE", "VECTOR_INDEX", "CACHE"];
const reconciliationSubsystems = ["VECTOR_INDEX", "CACHE"];
const managerVisibleClassifications = ["PUBLIC", "INTERNAL"] as const;
const customerFacingRevisionStatuses = ["READY", "PUBLISHED", "SUPERSEDED"] as const;

const sourceWithCount = {
  _count: { select: { documents: { where: { deletedAt: null } } } },
} satisfies Prisma.KnowledgeV2SourceInclude;

type SourceRecord = Prisma.KnowledgeV2SourceGetPayload<object>;
type SourceWithCount = Prisma.KnowledgeV2SourceGetPayload<{ include: typeof sourceWithCount }>;
type DocumentRecord = Prisma.KnowledgeV2DocumentGetPayload<object>;
type RevisionRecord = Prisma.KnowledgeV2DocumentRevisionGetPayload<object>;
type ElementRecord = Prisma.KnowledgeV2ElementGetPayload<object>;
type ChunkRecord = Prisma.KnowledgeV2ChunkGetPayload<object>;

interface QueuedMutation {
  accepted: KnowledgeV2AcceptedMutation;
  eventId: string;
}

interface SourceMutationBody {
  resource: KnowledgeV2SourceView;
  job: KnowledgeV2AcceptedMutation | null;
}

function knowledgeJson(value: Prisma.JsonValue): KnowledgeV2JsonValue {
  return value as unknown as KnowledgeV2JsonValue;
}

function databaseJson(value: Prisma.InputJsonObject | null) {
  return value === null ? Prisma.DbNull : value;
}

function safeErrorCode(value: string | null): KnowledgeV2ErrorCode | null {
  if (!value) return null;
  return value === "IDEMPOTENCY_KEY_REUSED" ||
    value === "REVISION_CONFLICT" ||
    /^KNOWLEDGE_(VALIDATION|SOURCE|UPLOAD|PARSE|SECURITY|CONFLICT|PUBLICATION|PERMISSION|QUOTA|DEPENDENCY)_/.test(
      value,
    )
    ? (value as KnowledgeV2ErrorCode)
    : null;
}

function dateValue(value: Date | null) {
  return value?.toISOString() ?? null;
}

function safeCanonicalUri(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function hasQueryComponent(value: string) {
  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  return queryIndex >= 0 && (fragmentIndex < 0 || queryIndex < fragmentIndex);
}

function audienceValues(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is "PUBLIC" | "AUTHENTICATED_CUSTOMER" | "INTERNAL" =>
      item === "PUBLIC" || item === "AUTHENTICATED_CUSTOMER" || item === "INTERNAL",
  );
}

function sourceEtag(source: Pick<SourceRecord, "id" | "etag">) {
  return strongKnowledgeV2Etag("source", source.id, source.etag);
}

function documentEtag(document: Pick<DocumentRecord, "id" | "deletionGeneration" | "updatedAt">) {
  return strongKnowledgeV2Etag(
    "document",
    document.id,
    `${document.deletionGeneration}:${document.updatedAt.toISOString()}`,
  );
}

function revisionEtag(
  revision: Pick<RevisionRecord, "id" | "generation" | "status" | "contentHash">,
) {
  return strongKnowledgeV2Etag(
    "revision",
    revision.id,
    `${revision.generation}:${revision.status}:${revision.contentHash}`,
  );
}

function mutationResult<T>(result: KnowledgeV2IdempotencyResult<T>): KnowledgeV2MutationResult<T> {
  return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
}

@Injectable()
export class KnowledgeV2SourceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeSourceQueueService)
    private readonly queue: KnowledgeSourceQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async listSources(
    context: RequestContext,
    query: KnowledgeV2SourceListQuery,
  ): Promise<KnowledgeV2SourcePage> {
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2SourceWhereInput[] = [this.sourceReadWhere(context)];
    if (query.query) {
      filters.push({
        displayName: { contains: query.query, mode: "insensitive" },
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2Source.findMany({
      where: {
        tenantId: context.tenantId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status
          ? { status: query.status }
          : { status: { not: "DELETED" }, deletedAt: null }),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      include: sourceWithCount,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit).map((source) => this.sourceView(context, source));
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      items,
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getSource(context: RequestContext, sourceId: string): Promise<KnowledgeV2SourceView> {
    const source = await this.prisma.knowledgeV2Source.findFirst({
      where: { id: sourceId, tenantId: context.tenantId, ...this.sourceReadWhere(context) },
      include: sourceWithCount,
    });
    if (!source) this.notFound("source");
    return this.sourceView(context, source);
  }

  async createSource(
    context: RequestContext,
    input: KnowledgeV2CreateSourceRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertSourceEditor(context);
    this.assertSupportedSourceKind(input.kind);
    this.assertClassificationAudienceCompatibility(
      input.defaultClassification,
      input.defaultScope?.audiences ?? [],
    );
    const endpoint = "POST:/knowledge/v2/sources";
    const replayCandidate = await this.isStableReplayCandidate(
      context.tenantId,
      endpoint,
      idempotencyKey,
    );
    const identity = replayCandidate ? null : await this.sourceIdentity(input);
    let eventId: string | null = null;
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint,
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        if (!identity) this.replayPreflightLost();
        await this.lockTenant(tx, context.tenantId);
        await this.assertCreateQuota(tx, context.tenantId);
        const existing = await tx.knowledgeV2Source.findUnique({
          where: {
            tenantId_kind_externalRootKey: {
              tenantId: context.tenantId,
              kind: input.kind,
              externalRootKey: identity.externalRootKey,
            },
          },
          select: { id: true },
        });
        if (existing) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_SOURCE_EXISTS",
            "This source already exists in the workspace.",
          );
        }
        const source = await tx.knowledgeV2Source.create({
          data: {
            tenantId: context.tenantId,
            kind: input.kind,
            displayName: input.displayName.trim(),
            externalRootKey: identity.externalRootKey,
            canonicalUri: identity.canonicalUri,
            syncMode: input.syncMode ?? "MANUAL",
            status: "CONNECTING",
            defaultScope: databaseJson(canonicalKnowledgeV2Scope(input.defaultScope)),
            defaultClassification: input.defaultClassification,
            defaultLocale: canonicalKnowledgeV2Locale(input.defaultLocale),
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
        });
        const queued = await this.enqueue(tx, context, source, "IMPORT", null);
        eventId = queued.eventId;
        await this.bumpDraftGeneration(tx, context.tenantId);
        await this.audit(tx, context, "knowledge.v2.source.import_requested", source.id, {
          kind: source.kind,
          generation: source.generation,
          jobId: queued.accepted.jobId,
          canonicalUriHash: identity.canonicalUri
            ? canonicalKnowledgeV2Hash(identity.canonicalUri)
            : null,
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: queued.accepted,
          responseRef: queued.accepted.jobId,
        };
      },
    );
    this.dispatch(eventId, result.idempotencyReplayed);
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  async updateSource(
    context: RequestContext,
    sourceId: string,
    input: KnowledgeV2UpdateSourceRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2SourceMutationResult> {
    this.assertSourceEditor(context);
    let eventId: string | null = null;
    const result = await this.idempotency.execute<SourceMutationBody>(
      {
        tenantId: context.tenantId,
        endpoint: "PATCH:/knowledge/v2/sources/:sourceId",
        key: idempotencyKey,
        request: { sourceId, body: input, ifMatch },
      },
      async (tx) => {
        const current = await this.lockSource(tx, context.tenantId, sourceId);
        this.assertMutableSource(current);
        assertIfMatch(ifMatch, sourceEtag(current), current.etag, [
          "displayName",
          "syncMode",
          "defaultScope",
          "defaultClassification",
          "defaultLocale",
          "status",
        ]);
        if (Object.values(input).every((value) => value === undefined)) {
          throw knowledgeV2Error(
            HttpStatus.BAD_REQUEST,
            "KNOWLEDGE_VALIDATION_UPDATE_EMPTY",
            "Provide at least one source field to update.",
          );
        }
        const scope =
          input.defaultScope === undefined
            ? current.defaultScope
            : canonicalKnowledgeV2Scope(input.defaultScope);
        const locale =
          input.defaultLocale === undefined
            ? current.defaultLocale
            : canonicalKnowledgeV2Locale(input.defaultLocale);
        const nextClassification = input.defaultClassification ?? current.defaultClassification;
        const nextAudiences =
          input.defaultScope === undefined
            ? knowledgeV2ScopeView(current.defaultScope).audiences
            : (input.defaultScope?.audiences ?? []);
        this.assertClassificationAudienceCompatibility(nextClassification, nextAudiences);
        const materialChanged =
          (input.defaultScope !== undefined &&
            canonicalKnowledgeV2Hash(scope) !== canonicalKnowledgeV2Hash(current.defaultScope)) ||
          (input.defaultClassification !== undefined &&
            input.defaultClassification !== current.defaultClassification) ||
          (input.defaultLocale !== undefined && locale !== current.defaultLocale);
        const scalarChanged =
          (input.displayName !== undefined && input.displayName.trim() !== current.displayName) ||
          (input.syncMode !== undefined && input.syncMode !== current.syncMode) ||
          materialChanged;
        if (!scalarChanged) {
          const count = await this.documentCount(tx, context.tenantId, sourceId);
          return {
            httpStatus: HttpStatus.OK,
            responseBody: { resource: this.sourceView(context, current, count), job: null },
            responseRef: sourceId,
          };
        }

        const deferred =
          materialChanged &&
          (current.status === "PAUSED" || current.lastErrorCode === deferredPausedSyncCode);
        const nextGeneration = current.generation + (materialChanged ? 1 : 0);
        const nextStatus = materialChanged
          ? deferred
            ? "NEEDS_REVIEW"
            : "SYNCING"
          : current.status;
        const updated = await tx.knowledgeV2Source.update({
          where: { id: current.id },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
            ...(input.syncMode !== undefined ? { syncMode: input.syncMode } : {}),
            ...(input.defaultScope !== undefined
              ? { defaultScope: databaseJson(canonicalKnowledgeV2Scope(input.defaultScope)) }
              : {}),
            ...(input.defaultClassification !== undefined
              ? { defaultClassification: input.defaultClassification }
              : {}),
            ...(input.defaultLocale !== undefined ? { defaultLocale: locale } : {}),
            ...(materialChanged
              ? {
                  sourcePermissionVersion: { increment: 1 },
                  generation: { increment: 1 },
                  status: nextStatus,
                  lastErrorCode: deferred ? deferredPausedSyncCode : null,
                  lastErrorAt: deferred ? new Date() : null,
                }
              : {}),
            etag: { increment: 1 },
            updatedByUserId: context.userId,
          },
        });
        if (materialChanged) {
          const deniedAt = new Date();
          await tx.knowledgeV2Document.updateMany({
            where: { tenantId: context.tenantId, sourceId, deletedAt: null },
            data: { deletionGeneration: { increment: 1 } },
          });
          await tx.knowledgeV2Chunk.updateMany({
            where: {
              tenantId: context.tenantId,
              document: { sourceId },
              OR: [{ indexState: { not: "DELETED" } }, { deletedAt: null }],
            },
            data: { indexState: "DELETED", deletedAt: deniedAt },
          });
          await this.ensureReconciliationLedgers(
            tx,
            context.tenantId,
            sourceId,
            current.generation,
            updated.generation,
            "SOURCE",
            sourceId,
            deniedAt,
          );
        }
        let accepted: KnowledgeV2AcceptedMutation | null = null;
        if (materialChanged && !deferred) {
          const queued = await this.enqueue(tx, context, updated, "RECONCILE", null);
          eventId = queued.eventId;
          accepted = queued.accepted;
        }
        if (materialChanged) await this.bumpDraftGeneration(tx, context.tenantId);
        const changedFields = Object.keys(input).filter(
          (key) => input[key as keyof KnowledgeV2UpdateSourceRequest] !== undefined,
        );
        await this.audit(tx, context, "knowledge.v2.source.updated", sourceId, {
          changedFields,
          materialChanged,
          deferred,
          generation: nextGeneration,
          jobId: accepted?.jobId ?? null,
        });
        const count = await this.documentCount(tx, context.tenantId, sourceId);
        return {
          httpStatus: accepted ? HttpStatus.ACCEPTED : HttpStatus.OK,
          responseBody: { resource: this.sourceView(context, updated, count), job: accepted },
          responseRef: accepted?.jobId ?? sourceId,
        };
      },
    );
    this.dispatch(eventId, result.idempotencyReplayed);
    return {
      ...result.responseBody,
      idempotencyReplayed: result.idempotencyReplayed,
      job: result.responseBody.job
        ? {
            ...result.responseBody.job,
            idempotencyReplayed: result.idempotencyReplayed,
          }
        : null,
    };
  }

  async syncSource(
    context: RequestContext,
    sourceId: string,
    input: KnowledgeV2SourceActionDto,
    idempotencyKey: string,
    ifMatch: string[],
  ) {
    return this.queueSourceAction(context, sourceId, "SYNC", input, idempotencyKey, ifMatch);
  }

  async resumeSource(
    context: RequestContext,
    sourceId: string,
    input: KnowledgeV2SourceActionDto,
    idempotencyKey: string,
    ifMatch: string[],
  ) {
    return this.queueSourceAction(context, sourceId, "RESUME", input, idempotencyKey, ifMatch);
  }

  async pauseSource(
    context: RequestContext,
    sourceId: string,
    input: KnowledgeV2SourceActionDto,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2SourceView>> {
    this.assertSourceEditor(context);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/sources/:sourceId/pause",
        key: idempotencyKey,
        request: { sourceId, body: input, ifMatch },
      },
      async (tx) => {
        const current = await this.lockSource(tx, context.tenantId, sourceId);
        assertIfMatch(ifMatch, sourceEtag(current), current.etag, ["status"]);
        if (current.status !== "READY") this.actionNotAllowed("pause");
        const updated = await tx.knowledgeV2Source.update({
          where: { id: current.id },
          data: {
            status: "PAUSED",
            etag: { increment: 1 },
            updatedByUserId: context.userId,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        });
        await this.audit(tx, context, "knowledge.v2.source.paused", sourceId, {
          generation: updated.generation,
          reasonHash: input.reason ? canonicalKnowledgeV2Hash(input.reason) : null,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.sourceView(
            context,
            updated,
            await this.documentCount(tx, context.tenantId, sourceId),
          ),
          responseRef: sourceId,
        };
      },
    );
    return mutationResult(result);
  }

  async deleteSource(
    context: RequestContext,
    sourceId: string,
    input: KnowledgeV2DeleteSourceDto,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertSourceEditor(context);
    let eventId: string | null = null;
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "DELETE:/knowledge/v2/sources/:sourceId",
        key: idempotencyKey,
        request: { sourceId, body: input, ifMatch },
      },
      async (tx) => {
        const current = await this.lockSource(tx, context.tenantId, sourceId);
        assertIfMatch(ifMatch, sourceEtag(current), current.etag, [
          "status",
          "generation",
          "tombstonedAt",
        ]);
        if (current.status === "DELETING" || current.status === "DELETED") {
          this.actionNotAllowed("delete");
        }
        const now = new Date();
        const source = await tx.knowledgeV2Source.update({
          where: { id: current.id },
          data: {
            status: "DELETING",
            generation: { increment: 1 },
            etag: { increment: 1 },
            tombstonedAt: now,
            updatedByUserId: context.userId,
          },
        });
        await Promise.all([
          tx.knowledgeV2Document.updateMany({
            where: { tenantId: context.tenantId, sourceId, deletedAt: null },
            data: {
              status: "TOMBSTONED",
              tombstonedAt: now,
              sourceDeletedAt: now,
              deletionGeneration: { increment: 1 },
            },
          }),
          tx.knowledgeV2Artifact.updateMany({
            where: { tenantId: context.tenantId, sourceId, deletedAt: null },
            data: { deletionState: "TOMBSTONED" },
          }),
          tx.knowledgeV2Chunk.updateMany({
            where: {
              tenantId: context.tenantId,
              document: { sourceId },
              OR: [{ indexState: { not: "DELETED" } }, { deletedAt: null }],
            },
            data: { indexState: "DELETED", deletedAt: now },
          }),
        ]);
        await tx.knowledgeV2DeletionLedger.createMany({
          data: deletionSubsystems.map((subsystem) => ({
            tenantId: context.tenantId,
            sourceId,
            sourceGeneration: source.generation,
            targetType: "SOURCE",
            targetId: sourceId,
            subsystem,
            status: "PENDING" as const,
            deniedAt: now,
          })),
        });
        const queued = await this.enqueue(tx, context, source, "DELETE", null);
        eventId = queued.eventId;
        await this.bumpDraftGeneration(tx, context.tenantId);
        await this.audit(tx, context, "knowledge.v2.source.delete_requested", sourceId, {
          generation: source.generation,
          jobId: queued.accepted.jobId,
          reasonHash: canonicalKnowledgeV2Hash(input.reason),
          deletionLedgerCount: deletionSubsystems.length,
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: queued.accepted,
          responseRef: queued.accepted.jobId,
        };
      },
    );
    this.dispatch(eventId, result.idempotencyReplayed);
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  async listDocuments(
    context: RequestContext,
    query: KnowledgeV2DocumentListQuery,
  ): Promise<KnowledgeV2DocumentPage> {
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2DocumentWhereInput[] = [this.documentReadWhere(context)];
    if (query.query) {
      filters.push({
        title: { contains: query.query, mode: "insensitive" },
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2Document.findMany({
      where: {
        tenantId: context.tenantId,
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status
          ? { status: query.status }
          : { status: { not: "DELETED" }, deletedAt: null }),
        ...(query.locale ? { canonicalLocale: canonicalKnowledgeV2Locale(query.locale) } : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((document) => this.documentView(document)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getDocument(context: RequestContext, documentId: string) {
    const document = await this.prisma.knowledgeV2Document.findFirst({
      where: { id: documentId, tenantId: context.tenantId, ...this.documentReadWhere(context) },
    });
    if (!document) this.notFound("document");
    return this.documentView(document);
  }

  async listDocumentRevisions(
    context: RequestContext,
    documentId: string,
    query: KnowledgeV2RevisionListQuery,
  ): Promise<KnowledgeV2RevisionPage> {
    const document = await this.prisma.knowledgeV2Document.findFirst({
      where: { id: documentId, tenantId: context.tenantId, ...this.documentReadWhere(context) },
      select: { id: true },
    });
    if (!document) this.notFound("document");
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2DocumentRevisionWhereInput[] = [
      this.revisionReadWhere(context),
    ];
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2DocumentRevision.findMany({
      where: {
        tenantId: context.tenantId,
        documentId,
        ...(query.status ? { status: query.status } : {}),
        AND: filters,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((revision) => this.revisionView(context, revision)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async previewRevision(
    context: RequestContext,
    revisionId: string,
  ): Promise<KnowledgeV2RevisionPreviewView> {
    this.assertPreviewReader(context);
    const revision = await this.prisma.knowledgeV2DocumentRevision.findFirst({
      where: {
        id: revisionId,
        tenantId: context.tenantId,
        ...this.revisionReadWhere(context),
        document: {
          AND: [
            this.documentReadWhere(context),
            {
              status: { notIn: ["TOMBSTONED", "DELETED"] },
              tombstonedAt: null,
              deletedAt: null,
              source: {
                status: { notIn: ["DELETING", "DELETED"] },
                tombstonedAt: null,
                deletedAt: null,
              },
            },
          ],
        },
      },
      include: {
        elements: { orderBy: [{ ordinal: "asc" }, { id: "asc" }] },
        chunks: { orderBy: [{ ordinal: "asc" }, { id: "asc" }] },
      },
    });
    if (!revision) this.notFound("revision");
    return {
      revision: this.revisionView(context, revision),
      elements: revision.elements.map((element) => this.elementView(element)),
      chunks: revision.chunks.map((chunk) => this.chunkView(chunk)),
    };
  }

  async excludeRevision(
    context: RequestContext,
    revisionId: string,
    input: KnowledgeV2ExcludeRevisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertSourceEditor(context);
    const revisionSource = await this.prisma.knowledgeV2DocumentRevision.findFirst({
      where: { id: revisionId, tenantId: context.tenantId },
      select: { sourceId: true },
    });
    if (!revisionSource) this.notFound("revision");
    let eventId: string | null = null;
    const result = await this.idempotency.execute<KnowledgeV2AcceptedMutation>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/revisions/:revisionId/exclude",
        key: idempotencyKey,
        request: { revisionId, body: input, ifMatch },
      },
      async (tx) => {
        const source = await this.lockSource(tx, context.tenantId, revisionSource.sourceId);
        const revision = await this.lockRevision(tx, context.tenantId, revisionId);
        if (revision.sourceId !== source.id) this.notFound("revision");
        assertIfMatch(ifMatch, revisionEtag(revision), revision.generation, [
          "status",
          "generation",
        ]);
        if (["REJECTED", "SUPERSEDED", "CANCELLED", "DELETED"].includes(revision.status)) {
          this.actionNotAllowed("exclude");
        }
        this.assertMutableSource(source);
        const now = new Date();
        const updatedRevision = await tx.knowledgeV2DocumentRevision.update({
          where: { id: revision.id },
          data: { status: "REJECTED", generation: { increment: 1 } },
        });
        await Promise.all([
          tx.knowledgeV2Document.updateMany({
            where: {
              id: revision.documentId,
              tenantId: context.tenantId,
              currentDraftRevisionId: revision.id,
            },
            data: { currentDraftRevisionId: null, status: "NEEDS_REVIEW" },
          }),
          tx.knowledgeV2Document.updateMany({
            where: {
              id: revision.documentId,
              tenantId: context.tenantId,
              currentPublishedRevisionId: revision.id,
            },
            data: { currentPublishedRevisionId: null, status: "NEEDS_REVIEW" },
          }),
          tx.knowledgeV2Chunk.updateMany({
            where: {
              tenantId: context.tenantId,
              revisionId: revision.id,
              OR: [{ indexState: { not: "DELETED" } }, { deletedAt: null }],
            },
            data: { indexState: "DELETED", deletedAt: now },
          }),
        ]);
        await tx.knowledgeV2Document.update({
          where: { id: revision.documentId },
          data: { deletionGeneration: { increment: 1 } },
        });
        const updatedSource = await tx.knowledgeV2Source.update({
          where: { id: source.id },
          data: {
            generation: { increment: 1 },
            etag: { increment: 1 },
            status: "SYNCING",
            lastErrorCode: null,
            lastErrorAt: null,
            updatedByUserId: context.userId,
          },
        });
        await tx.knowledgeV2DeletionLedger.createMany({
          data: reconciliationSubsystems.map((subsystem) => ({
            tenantId: context.tenantId,
            sourceId: source.id,
            sourceGeneration: updatedSource.generation,
            targetType: "REVISION",
            targetId: updatedRevision.id,
            subsystem,
            status: "PENDING" as const,
            deniedAt: now,
          })),
        });
        const queued = await this.enqueue(
          tx,
          context,
          updatedSource,
          "RECONCILE",
          updatedRevision.id,
        );
        eventId = queued.eventId;
        await this.bumpDraftGeneration(tx, context.tenantId);
        await this.audit(tx, context, "knowledge.v2.revision.exclude_requested", revision.id, {
          sourceId: source.id,
          documentId: revision.documentId,
          sourceGeneration: updatedSource.generation,
          revisionGeneration: updatedRevision.generation,
          jobId: queued.accepted.jobId,
          reconciliationLedgerCount: reconciliationSubsystems.length,
          reasonHash: canonicalKnowledgeV2Hash(input.reason),
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: {
            ...queued.accepted,
            resource: { type: "REVISION", id: revision.id },
          },
          responseRef: queued.accepted.jobId,
        };
      },
    );
    this.dispatch(eventId, result.idempotencyReplayed);
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private async queueSourceAction(
    context: RequestContext,
    sourceId: string,
    action: "SYNC" | "RESUME",
    input: KnowledgeV2SourceActionDto,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertSourceEditor(context);
    const endpoint = `POST:/knowledge/v2/sources/:sourceId/${action.toLowerCase()}`;
    const replayCandidate = await this.isStableReplayCandidate(
      context.tenantId,
      endpoint,
      idempotencyKey,
    );
    let admissionChecked = false;
    if (!replayCandidate) {
      const admittedSource = await this.prisma.knowledgeV2Source.findFirst({
        where: { id: sourceId, tenantId: context.tenantId },
      });
      if (!admittedSource) this.notFound("source");
      const deferredResume =
        action === "RESUME" &&
        admittedSource.status === "NEEDS_REVIEW" &&
        admittedSource.lastErrorCode === deferredPausedSyncCode;
      if (!deferredResume) await this.assertSourceAdmission(admittedSource);
      admissionChecked = true;
    }
    let eventId: string | null = null;
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint,
        key: idempotencyKey,
        request: { sourceId, body: input, ifMatch },
      },
      async (tx) => {
        const current = await this.lockSource(tx, context.tenantId, sourceId);
        assertIfMatch(ifMatch, sourceEtag(current), current.etag, ["status", "generation"]);
        const deferredResume =
          action === "RESUME" &&
          current.status === "NEEDS_REVIEW" &&
          current.lastErrorCode === deferredPausedSyncCode;
        if (action === "SYNC") {
          const deferredReview =
            current.status === "NEEDS_REVIEW" && current.lastErrorCode === deferredPausedSyncCode;
          if (!["READY", "FAILED", "NEEDS_REVIEW"].includes(current.status) || deferredReview) {
            this.actionNotAllowed("sync");
          }
        } else if (
          current.status !== "PAUSED" &&
          !(current.status === "NEEDS_REVIEW" && current.lastErrorCode === deferredPausedSyncCode)
        ) {
          this.actionNotAllowed("resume");
        }
        const operation = deferredResume ? "RECONCILE" : "SYNC";
        if (operation === "SYNC") {
          if (!admissionChecked) this.replayPreflightLost();
          await this.assertSyncQuota(tx, context.tenantId, sourceId);
        }
        const now = new Date();
        const source = await tx.knowledgeV2Source.update({
          where: { id: current.id },
          data: {
            status: "SYNCING",
            ...(deferredResume ? {} : { generation: { increment: 1 } }),
            etag: { increment: 1 },
            lastAttemptAt: now,
            lastErrorCode: null,
            lastErrorAt: null,
            updatedByUserId: context.userId,
          },
        });
        if (deferredResume) {
          await this.ensureReconciliationLedgers(
            tx,
            context.tenantId,
            sourceId,
            current.generation,
            source.generation,
            "SOURCE",
            sourceId,
            now,
          );
        }
        const queued = await this.enqueue(tx, context, source, operation, null);
        eventId = queued.eventId;
        await this.audit(
          tx,
          context,
          action === "SYNC" ? "knowledge.v2.source.sync_requested" : "knowledge.v2.source.resumed",
          sourceId,
          {
            generation: source.generation,
            operation,
            jobId: queued.accepted.jobId,
            reasonHash: input.reason ? canonicalKnowledgeV2Hash(input.reason) : null,
          },
        );
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: queued.accepted,
          responseRef: queued.accepted.jobId,
        };
      },
    );
    this.dispatch(eventId, result.idempotencyReplayed);
    return { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private async sourceIdentity(input: KnowledgeV2CreateSourceRequest) {
    const canonicalUri = await this.admitWebsiteUri(input.canonicalUri ?? "");
    return {
      canonicalUri,
      externalRootKey: `website:${canonicalKnowledgeV2Hash(canonicalUri)}`,
    };
  }

  private async assertSourceAdmission(source: SourceRecord) {
    this.assertSupportedSourceKind(source.kind);
    this.assertWebsiteIngestionConfigured();
    if (!source.canonicalUri) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_SOURCE_URL_MISSING",
        "This website source has no usable address.",
      );
    }
    await this.admitWebsiteUri(source.canonicalUri);
  }

  private async admitWebsiteUri(value: string) {
    this.assertWebsiteIngestionConfigured();
    try {
      const parsed = new URL(value);
      if (hasQueryComponent(value) || parsed.search) {
        throw knowledgeV2Error(
          HttpStatus.BAD_REQUEST,
          "KNOWLEDGE_SOURCE_URL_QUERY_NOT_ALLOWED",
          "Website addresses with query parameters are not supported yet.",
          { field: "canonicalUri" },
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
    }
    const fixture =
      this.config.env.APP_ENV === "acceptance" &&
      this.config.knowledgeAcceptanceWebsiteFixtureEnabled
        ? createKnowledgeAcceptanceWebsiteFixture()
        : null;
    const result = await admitWebsiteSourceUrl(
      value,
      fixture ? { resolver: fixture.resolver } : undefined,
    );
    if (result.ok) {
      const admitted = new URL(result.value.normalizedUrl);
      if (hasQueryComponent(result.value.normalizedUrl) || admitted.search) {
        throw knowledgeV2Error(
          HttpStatus.BAD_REQUEST,
          "KNOWLEDGE_SOURCE_URL_QUERY_NOT_ALLOWED",
          "Website addresses with query parameters are not supported yet.",
          { field: "canonicalUri" },
        );
      }
      return admitted.href;
    }
    const retryable = result.reason.code === "DNS_LOOKUP_FAILED";
    throw knowledgeV2Error(
      retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_REQUEST,
      retryable ? "KNOWLEDGE_SOURCE_DNS_LOOKUP_FAILED" : "KNOWLEDGE_SOURCE_FETCH_BLOCKED",
      result.reason.message,
      {
        field: "canonicalUri",
        retryable,
        details: { reason: result.reason.code.toLowerCase() },
      },
    );
  }

  private assertWebsiteIngestionConfigured() {
    const objectStorePath = this.config.knowledgeObjectStorePath?.trim();
    const encryptionKey = this.config.knowledgeArtifactEncryptionKey?.trim();
    const encryptionKeyId = this.config.knowledgeArtifactEncryptionKeyId?.trim();
    let encryptionKeyValid = false;
    if (encryptionKey) {
      try {
        decodeKnowledgeObjectEncryptionKey(encryptionKey);
        encryptionKeyValid = true;
      } catch {
        encryptionKeyValid = false;
      }
    }
    if (
      !this.config.knowledgeWebsiteImportEnabled ||
      !this.config.knowledgeWebsiteEgressReady ||
      !objectStorePath ||
      !isAbsolute(objectStorePath) ||
      !encryptionKeyValid ||
      !encryptionKeyId
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
        "Website source ingestion is not available.",
        { retryable: false },
      );
    }
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    source: SourceRecord,
    operation: "IMPORT" | "SYNC" | "RECONCILE" | "DELETE",
    revisionId: string | null,
  ): Promise<QueuedMutation> {
    const now = new Date();
    const job = await tx.knowledgeJob.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        idempotencyKey: `knowledge-source:${operation.toLowerCase()}:${source.id}:${source.generation}`,
        stage:
          operation === "DELETE"
            ? "CLEANING_UP"
            : operation === "RECONCILE"
              ? "RECONCILING"
              : "ACQUIRING",
        pipelineVersion,
        generation: source.generation,
        status: "QUEUED",
        deadlineAt: new Date(
          now.getTime() + (operation === "DELETE" ? 24 * 60 * 60_000 : 30 * 60_000),
        ),
        maxAttempts: 5,
        v2SourceId: source.id,
        v2RevisionId: revisionId,
      },
    });
    const event = await this.queue.createEvent(tx, {
      tenantId: context.tenantId,
      sourceId: source.id,
      knowledgeJobId: job.id,
      generation: source.generation,
      operation,
      requestedByUserId: context.userId,
      requestedAt: now.toISOString(),
    });
    await tx.knowledgeJob.update({
      where: { id: job.id },
      data: { payloadRef: `runtime-outbox:${event.id}` },
    });
    return {
      eventId: event.id,
      accepted: {
        jobId: job.id,
        status: job.status,
        acceptedAt: job.createdAt.toISOString(),
        resource: { type: "SOURCE", id: source.id },
        idempotencyReplayed: false,
      },
    };
  }

  private dispatch(eventId: string | null, replayed: boolean) {
    if (eventId && !replayed) this.queue.dispatch(eventId);
  }

  private sourceReadWhere(context: RequestContext): Prisma.KnowledgeV2SourceWhereInput {
    if (context.role === "OWNER" || context.role === "ADMIN") return {};
    if (context.role === "MANAGER") {
      return { defaultClassification: { in: [...managerVisibleClassifications] } };
    }
    return {
      defaultClassification: "PUBLIC",
      status: { notIn: ["DELETING", "DELETED"] },
      tombstonedAt: null,
      deletedAt: null,
      OR: [
        { defaultScope: { path: ["audiences"], array_contains: ["PUBLIC"] } },
        {
          defaultScope: {
            path: ["audiences"],
            array_contains: ["AUTHENTICATED_CUSTOMER"],
          },
        },
      ],
    };
  }

  private documentReadWhere(context: RequestContext): Prisma.KnowledgeV2DocumentWhereInput {
    if (context.role === "OWNER" || context.role === "ADMIN") return {};
    if (context.role === "MANAGER") {
      return { classification: { in: [...managerVisibleClassifications] } };
    }
    return {
      classification: "PUBLIC",
      status: "ACTIVE",
      tombstonedAt: null,
      deletedAt: null,
      source: {
        status: { in: ["READY", "PAUSED"] },
        tombstonedAt: null,
        deletedAt: null,
      },
      OR: [
        { audience: { array_contains: ["PUBLIC"] } },
        { audience: { array_contains: ["AUTHENTICATED_CUSTOMER"] } },
      ],
    };
  }

  private revisionReadWhere(context: RequestContext): Prisma.KnowledgeV2DocumentRevisionWhereInput {
    if (["OWNER", "ADMIN", "MANAGER"].includes(context.role)) return {};
    return {
      status: { in: [...customerFacingRevisionStatuses] },
      deletedAt: null,
    };
  }

  private assertPreviewReader(context: RequestContext) {
    if (context.role === "VIEWER") {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ACTION_DENIED",
        "This workspace role cannot preview source content.",
      );
    }
  }

  private async isStableReplayCandidate(tenantId: string, endpoint: string, key: string) {
    const record = await this.prisma.knowledgeV2IdempotencyRecord.findUnique({
      where: { tenantId_endpoint_key: { tenantId, endpoint, key } },
      select: { expiresAt: true },
    });
    return Boolean(record && record.expiresAt.getTime() > Date.now() + 60_000);
  }

  private async ensureReconciliationLedgers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceId: string,
    previousGeneration: number,
    generation: number,
    targetType: "SOURCE" | "REVISION",
    targetId: string,
    deniedAt: Date,
  ) {
    if (previousGeneration !== generation) {
      await tx.knowledgeV2DeletionLedger.updateMany({
        where: {
          tenantId,
          sourceId,
          sourceGeneration: previousGeneration,
          targetType,
          targetId,
          subsystem: { in: reconciliationSubsystems },
          status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] },
        },
        data: {
          sourceGeneration: generation,
          status: "PENDING",
          deniedAt,
          notBefore: null,
          startedAt: null,
          completedAt: null,
          attemptCount: 0,
          lastErrorCode: null,
        },
      });
    }
    await tx.knowledgeV2DeletionLedger.createMany({
      data: reconciliationSubsystems.map((subsystem) => ({
        tenantId,
        sourceId,
        sourceGeneration: generation,
        targetType,
        targetId,
        subsystem,
        status: "PENDING" as const,
        deniedAt,
      })),
      skipDuplicates: true,
    });
    const count = await tx.knowledgeV2DeletionLedger.count({
      where: {
        tenantId,
        sourceId,
        sourceGeneration: generation,
        targetType,
        targetId,
        subsystem: { in: reconciliationSubsystems },
      },
    });
    if (count !== reconciliationSubsystems.length) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_RECONCILIATION_LEDGER_INVALID",
        "The source cleanup request could not be recorded safely.",
        { retryable: true },
      );
    }
  }

  private sourceView(
    context: RequestContext,
    source: SourceRecord | SourceWithCount,
    documentCount?: number,
  ): KnowledgeV2SourceView {
    const count = documentCount ?? ("_count" in source ? source._count.documents : 0);
    return {
      id: source.id,
      kind: source.kind,
      displayName: source.displayName,
      canonicalUri: safeCanonicalUri(source.canonicalUri),
      syncMode: source.syncMode,
      status: source.status,
      defaultScope: knowledgeV2ScopeView(source.defaultScope),
      defaultClassification: source.defaultClassification,
      defaultLocale: source.defaultLocale,
      sourcePermissionVersion: source.sourcePermissionVersion,
      generation: source.generation,
      etag: sourceEtag(source),
      lastAttemptAt: dateValue(source.lastAttemptAt),
      lastSuccessAt: dateValue(source.lastSuccessAt),
      sourceObservedAt: dateValue(source.sourceObservedAt),
      nextSyncAt: dateValue(source.nextSyncAt),
      lastErrorCode: safeErrorCode(source.lastErrorCode),
      lastErrorAt: dateValue(source.lastErrorAt),
      documentCount: count,
      allowedActions: this.sourceActions(context, source),
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      tombstonedAt: dateValue(source.tombstonedAt),
      deletedAt: dateValue(source.deletedAt),
    };
  }

  private sourceActions(context: RequestContext, source: SourceRecord) {
    if (!this.canMutateSource(context)) return [];
    const actions: KnowledgeV2SourceView["allowedActions"] = [];
    const deferredReview =
      source.status === "NEEDS_REVIEW" && source.lastErrorCode === deferredPausedSyncCode;
    if (source.status !== "DELETING" && source.status !== "DELETED") actions.push("EDIT");
    if (
      source.kind === "WEBSITE" &&
      ["READY", "FAILED", "NEEDS_REVIEW"].includes(source.status) &&
      !deferredReview
    ) {
      actions.push("SYNC");
    }
    if (source.status === "READY") actions.push("PAUSE");
    if (source.status === "PAUSED" || deferredReview) {
      actions.push("RESUME");
    }
    if (source.status !== "DELETING" && source.status !== "DELETED") actions.push("DELETE");
    return actions;
  }

  private documentView(document: DocumentRecord): KnowledgeV2DocumentView {
    return {
      id: document.id,
      etag: documentEtag(document),
      sourceId: document.sourceId,
      kind: document.kind,
      canonicalUri: safeCanonicalUri(document.canonicalUri),
      title: document.title,
      canonicalLocale: document.canonicalLocale,
      translationGroup: document.translationGroup,
      scope: knowledgeV2ScopeView(document.scope),
      audiences: audienceValues(document.audience),
      classification: document.classification,
      permissionVersion: document.permissionVersion,
      currentDraftRevisionId: document.currentDraftRevisionId,
      currentPublishedRevisionId: document.currentPublishedRevisionId,
      sourceCreatedAt: dateValue(document.sourceCreatedAt),
      sourceUpdatedAt: dateValue(document.sourceUpdatedAt),
      sourceDeletedAt: dateValue(document.sourceDeletedAt),
      status: document.status,
      deletionGeneration: document.deletionGeneration,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      tombstonedAt: dateValue(document.tombstonedAt),
      deletedAt: dateValue(document.deletedAt),
    };
  }

  private revisionView(context: RequestContext, revision: RevisionRecord): KnowledgeV2RevisionView {
    const canPreview =
      context.role !== "VIEWER" &&
      (context.role !== "AGENT" ||
        customerFacingRevisionStatuses.includes(
          revision.status as (typeof customerFacingRevisionStatuses)[number],
        ));
    const canExclude =
      this.canMutateSource(context) &&
      !["REJECTED", "SUPERSEDED", "CANCELLED", "DELETED"].includes(revision.status);
    const allowedActions: KnowledgeV2RevisionView["allowedActions"] = [];
    if (canPreview) allowedActions.push("PREVIEW");
    if (canExclude) allowedActions.push("EXCLUDE");
    return {
      id: revision.id,
      etag: revisionEtag(revision),
      sourceId: revision.sourceId,
      documentId: revision.documentId,
      revisionNumber: revision.revisionNumber,
      contentHash: revision.contentHash,
      status: revision.status,
      parserVersion: revision.parserVersion,
      ocrVersion: revision.ocrVersion,
      normalizerVersion: revision.normalizerVersion,
      extractorVersion: revision.extractorVersion,
      chunkerVersion: revision.chunkerVersion,
      embeddingVersion: revision.embeddingVersion,
      sparseIndexVersion: revision.sparseIndexVersion,
      pipelineVersion: revision.pipelineVersion,
      detectedLocale: revision.detectedLocale,
      characterCount: revision.characterCount,
      tokenCount: revision.tokenCount,
      pageCount: revision.pageCount,
      tableCount: revision.tableCount,
      imageCount: revision.imageCount,
      extractionCoverage: revision.extractionCoverage,
      parserQuality: knowledgeJson(revision.parserQuality),
      scopeSnapshot: knowledgeV2ScopeView(revision.scopeSnapshot),
      effectiveFrom: dateValue(revision.effectiveFrom),
      effectiveUntil: dateValue(revision.effectiveUntil),
      staleAfter: dateValue(revision.staleAfter),
      supersedesRevisionId: revision.supersedesRevisionId,
      generation: revision.generation,
      allowedActions,
      createdBy:
        revision.createdByUserId === context.userId
          ? {
              id: context.userId,
              displayName: context.user.name?.trim() || "Workspace member",
            }
          : null,
      createdAt: revision.createdAt.toISOString(),
      deletedAt: dateValue(revision.deletedAt),
    };
  }

  private elementView(element: ElementRecord): KnowledgeV2ElementView {
    return {
      id: element.id,
      documentId: element.documentId,
      revisionId: element.revisionId,
      kind: element.kind,
      ordinal: element.ordinal,
      parentElementId: element.parentElementId,
      headingPath: element.headingPath,
      pageNumber: element.pageNumber,
      boundingBox: knowledgeJson(element.boundingBox),
      urlAnchor: element.urlAnchor,
      sheetName: element.sheetName,
      sheetRange: element.sheetRange,
      normalizedText: element.normalizedText,
      hasObjectReference: Boolean(element.objectStorageKey),
      contentHash: element.contentHash,
      parserConfidence: element.parserConfidence,
      locale: element.locale,
      classification: element.classification,
    };
  }

  private chunkView(chunk: ChunkRecord): KnowledgeV2ChunkView {
    return {
      id: chunk.id,
      revisionId: chunk.revisionId,
      documentId: chunk.documentId,
      ordinal: chunk.ordinal,
      parentElementId: chunk.parentElementId,
      parentSectionId: chunk.parentSectionId,
      contentHash: chunk.contentHash,
      tokenCount: chunk.tokenCount,
      locale: chunk.locale,
      scope: knowledgeV2ScopeView(chunk.scope),
      classification: chunk.classification,
      permissionVersion: chunk.permissionVersion,
      denseSchemaVersion: chunk.denseSchemaVersion,
      sparseSchemaVersion: chunk.sparseSchemaVersion,
      pipelineVersion: chunk.pipelineVersion,
      indexState: chunk.indexState,
      indexedAt: dateValue(chunk.indexedAt),
      deletedAt: dateValue(chunk.deletedAt),
      provenanceRange: knowledgeJson(chunk.provenanceRange),
    };
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId} AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (rows.length !== 1) this.notFound("workspace");
  }

  private async lockSource(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2Source"
      WHERE "tenantId" = ${tenantId} AND "id" = ${sourceId}
      FOR UPDATE
    `);
    if (rows.length !== 1) this.notFound("source");
    const source = await tx.knowledgeV2Source.findUnique({
      where: { tenantId_id: { tenantId, id: sourceId } },
    });
    if (!source) this.notFound("source");
    return source;
  }

  private async lockRevision(tx: Prisma.TransactionClient, tenantId: string, revisionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2DocumentRevision"
      WHERE "tenantId" = ${tenantId} AND "id" = ${revisionId}
      FOR UPDATE
    `);
    if (rows.length !== 1) this.notFound("revision");
    const revision = await tx.knowledgeV2DocumentRevision.findUnique({
      where: { tenantId_id: { tenantId, id: revisionId } },
    });
    if (!revision) this.notFound("revision");
    return revision;
  }

  private async assertCreateQuota(tx: Prisma.TransactionClient, tenantId: string) {
    const settings = await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: { maxDocuments: true },
    });
    const [documentCount, emptySourceCount] = await Promise.all([
      tx.knowledgeV2Document.count({ where: { tenantId, deletedAt: null } }),
      tx.knowledgeV2Source.count({
        where: {
          tenantId,
          status: { notIn: ["DELETING", "DELETED"] },
          documents: { none: { deletedAt: null } },
        },
      }),
    ]);
    if (documentCount + emptySourceCount >= settings.maxDocuments) this.quotaExceeded();
  }

  private async assertSyncQuota(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    const settings = await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: { maxDocuments: true },
    });
    const [documentCount, sourceDocumentCount] = await Promise.all([
      tx.knowledgeV2Document.count({ where: { tenantId, deletedAt: null } }),
      tx.knowledgeV2Document.count({ where: { tenantId, sourceId, deletedAt: null } }),
    ]);
    if (documentCount >= settings.maxDocuments && sourceDocumentCount === 0) {
      this.quotaExceeded();
    }
  }

  private async documentCount(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    return tx.knowledgeV2Document.count({ where: { tenantId, sourceId, deletedAt: null } });
  }

  private async bumpDraftGeneration(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId, draftGeneration: 2 },
      update: { draftGeneration: { increment: 1 } },
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "knowledge_v2_source",
        entityId,
        payload,
      },
    });
  }

  private canMutateSource(context: RequestContext) {
    return context.role === "OWNER" || context.role === "ADMIN";
  }

  private assertSourceEditor(context: RequestContext) {
    if (!this.canMutateSource(context)) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ACTION_DENIED",
        "Only an owner or administrator can change knowledge sources.",
      );
    }
  }

  private assertSupportedSourceKind(kind: KnowledgeV2CreateSourceRequest["kind"]) {
    if (kind !== "WEBSITE") {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_SOURCE_KIND_UNSUPPORTED",
        "This source type is not available yet.",
        { field: "kind" },
      );
    }
  }

  private assertClassificationAudienceCompatibility(
    classification: KnowledgeV2CreateSourceRequest["defaultClassification"],
    audiences: readonly string[],
  ) {
    if (
      classification === "PUBLIC" ||
      (audiences.length > 0 && audiences.every((audience) => audience === "INTERNAL"))
    ) {
      return;
    }
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_SCOPE_CLASSIFICATION_CONFLICT",
      "Internal source content must use an internal audience.",
      { field: "defaultScope" },
    );
  }

  private replayPreflightLost(): never {
    throw knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_IDEMPOTENCY_REPLAY_UNAVAILABLE",
      "The mutation could not be replayed safely. Please retry.",
      { retryable: true },
    );
  }

  private assertMutableSource(source: SourceRecord) {
    if (source.status === "DELETING" || source.status === "DELETED") {
      this.actionNotAllowed("edit");
    }
  }

  private quotaExceeded(): never {
    throw knowledgeV2Error(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "KNOWLEDGE_QUOTA_DOCUMENT_LIMIT_REACHED",
      "The workspace document limit has been reached.",
    );
  }

  private actionNotAllowed(action: string): never {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_CONFLICT_ACTION_NOT_ALLOWED",
      `The ${action} action is not allowed in the current state.`,
    );
  }

  private notFound(resource: string): never {
    throw knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
      `The ${resource} was not found.`,
    );
  }
}
