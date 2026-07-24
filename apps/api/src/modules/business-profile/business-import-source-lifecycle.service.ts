import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type BusinessInformationState as DbBusinessInformationState } from "@leadvirt/db";
import { createDeterministicKnowledgeObjectKey } from "@leadvirt/knowledge";
import { createRuntimeQueueEvent } from "@leadvirt/runtime-queue";
import type {
  BusinessImportSourceArchivePreview,
  BusinessImportSourceArchiveReceipt,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { canonicalKnowledgeV2Hash } from "../knowledge/knowledge-v2-http.js";
import { lockKnowledgeV2CorpusTransition } from "../knowledge/knowledge-v2-transition-lock.js";
import {
  assertBusinessImportIfMatch,
  businessImportError,
  businessImportSourceEtag,
} from "./business-import-http.js";
import {
  adoptPendingBusinessImportObject,
  cleanupPendingBusinessImportObject,
  putPendingBusinessImportObject,
  reservePendingBusinessImportObject,
  type PendingBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportQueueService } from "./business-import-queue.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";

const ACTIVE_IMPORT_STATES = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "MAPPING_REQUIRED",
  "EXTRACTING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "PARTIALLY_APPLIED",
  "APPLYING",
  "PROJECTING",
  "PROJECTION_DELAYED",
  "FAILED_RETRYABLE",
] as const;
const PURGEABLE_OBJECT_KINDS = [
  "STAGING",
  "RAW_ARTIFACT",
  "PARSED_MANIFEST",
  "EVIDENCE_EXCERPT",
  "APPLICATION_PREVIEW",
] as const;

type HeaderValue = string | string[] | undefined;
type CanonicalOfferingRow = Prisma.BusinessOfferingGetPayload<{
  include: { prices: true; duration: true };
}>;
type SourceRow = Prisma.BusinessImportSourceGetPayload<Record<string, never>>;
type OwnershipBindingRow = Prisma.BusinessOfferingSourceBindingGetPayload<{
  include: {
    offering: {
      include: {
        sourceBindings: { select: { id: true; sourceId: true } };
        attributions: { select: { id: true } };
        prices: { include: { attributions: { select: { id: true } } } };
        duration: { include: { attributions: { select: { id: true } } } };
      };
    };
  };
}>;

interface CanonicalAggregateRows {
  identity: Prisma.BusinessIdentityGetPayload<Record<string, never>>;
  offerings: CanonicalOfferingRow[];
}

interface CanonicalSnapshot {
  schema: "leadvirt.business-information.v2";
  identity: {
    id: string;
    displayName: string;
    legalName: string | null;
    businessType: string | null;
    description: string | null;
    defaultLocale: string;
    timezone: string;
    defaultCurrency: string;
    rowVersion: number;
  };
  offerings: Array<{
    id: string;
    kind: "SERVICE" | "PRODUCT" | "MENU_ITEM";
    category: string | null;
    parentCategory: string | null;
    name: string;
    description: string | null;
    locale: string;
    bookingNotes: string | null;
    active: boolean;
    archivedAt: string | null;
    rowVersion: number;
    prices: Array<{
      id: string;
      type: "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST";
      amount: string | null;
      amountFrom: string | null;
      amountTo: string | null;
      currency: string;
      unit: string | null;
      taxNote: string | null;
      effectiveFrom: string | null;
      effectiveUntil: string | null;
      rowVersion: number;
    }>;
    duration: {
      id: string;
      minimumMinutes: number;
      maximumMinutes: number | null;
      preparationMinutes: number | null;
      bufferMinutes: number | null;
      rowVersion: number;
    } | null;
  }>;
}

interface SourceObjectCandidate {
  id: string;
  objectKind:
    | "STAGING"
    | "RAW_ARTIFACT"
    | "PARSED_MANIFEST"
    | "EVIDENCE_EXCERPT"
    | "APPLICATION_PREVIEW";
  deletionState: "RETAINED" | "TOMBSTONED" | "FAILED";
}

interface ArchiveOwnership {
  bindingIds: string[];
  boundOfferingIds: string[];
  removeOfferingIds: string[];
  retainedOfferingIds: string[];
  sharedOfferingIds: string[];
  manualOfferingIds: string[];
  fingerprintRows: Array<{
    offeringId: string;
    bindingIds: string[];
    active: boolean;
    archivedAt: string | null;
    rowVersion: number;
    sharedBindingIds: string[];
    sharedSourceIds: string[];
    manualAttributionIds: string[];
  }>;
}

interface ArchivePlan {
  sourceId: string;
  sourceEtag: number;
  archivedAt: string;
  state: {
    revision: number;
    currentRevisionId: string;
    canonicalHash: string;
    etag: number;
  } | null;
  before: CanonicalSnapshot | null;
  after: CanonicalSnapshot | null;
  beforeRowsHash: string | null;
  canonicalHash: string | null;
  ownership: ArchiveOwnership;
  objectCandidates: SourceObjectCandidate[];
  fingerprint: string;
}

interface PreparedMetadataArchive {
  kind: "metadata";
  plan: ArchivePlan;
}

interface PreparedMutationArchive {
  kind: "mutation";
  plan: ArchivePlan;
  revisionId: string;
  objectLedgerId: string;
  objectKey: string;
  encryptionKeyRef: string;
  reservation: PendingBusinessImportObject;
  deltaHash: string;
}

type PreparedArchive = PreparedMetadataArchive | PreparedMutationArchive;

function normalizedIfMatch(value: HeaderValue) {
  return (Array.isArray(value) ? value : (value ?? "").split(","))
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .sort();
}

function isoDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function canonicalSnapshot(rows: CanonicalAggregateRows): CanonicalSnapshot {
  return {
    schema: "leadvirt.business-information.v2",
    identity: {
      id: rows.identity.id,
      displayName: rows.identity.displayName,
      legalName: rows.identity.legalName,
      businessType: rows.identity.businessType,
      description: rows.identity.description,
      defaultLocale: rows.identity.defaultLocale,
      timezone: rows.identity.timezone,
      defaultCurrency: rows.identity.defaultCurrency,
      rowVersion: rows.identity.rowVersion,
    },
    offerings: rows.offerings
      .map((offering) => ({
        id: offering.id,
        kind: offering.kind,
        category: offering.category,
        parentCategory: offering.parentCategory,
        name: offering.name,
        description: offering.description,
        locale: offering.locale,
        bookingNotes: offering.bookingNotes,
        active: offering.active,
        archivedAt: offering.archivedAt?.toISOString() ?? null,
        rowVersion: offering.rowVersion,
        prices: offering.prices
          .map((price) => ({
            id: price.id,
            type: price.type,
            amount: price.amount?.toString() ?? null,
            amountFrom: price.amountFrom?.toString() ?? null,
            amountTo: price.amountTo?.toString() ?? null,
            currency: price.currency,
            unit: price.unit,
            taxNote: price.taxNote,
            effectiveFrom: isoDate(price.effectiveFrom),
            effectiveUntil: isoDate(price.effectiveUntil),
            rowVersion: price.rowVersion,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        duration: offering.duration
          ? {
              id: offering.duration.id,
              minimumMinutes: offering.duration.minimumMinutes,
              maximumMinutes: offering.duration.maximumMinutes,
              preparationMinutes: offering.duration.preparationMinutes,
              bufferMinutes: offering.duration.bufferMinutes,
              rowVersion: offering.duration.rowVersion,
            }
          : null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function canonicalContent(snapshot: CanonicalSnapshot) {
  return {
    schema: snapshot.schema,
    identity: {
      id: snapshot.identity.id,
      displayName: snapshot.identity.displayName,
      legalName: snapshot.identity.legalName,
      businessType: snapshot.identity.businessType,
      description: snapshot.identity.description,
      defaultLocale: snapshot.identity.defaultLocale,
      timezone: snapshot.identity.timezone,
      defaultCurrency: snapshot.identity.defaultCurrency,
    },
    offerings: snapshot.offerings.map((offering) => ({
      id: offering.id,
      kind: offering.kind,
      category: offering.category,
      parentCategory: offering.parentCategory,
      name: offering.name,
      description: offering.description,
      locale: offering.locale,
      bookingNotes: offering.bookingNotes,
      active: offering.active,
      archivedAt: offering.archivedAt,
      prices: offering.prices.map((price) => ({
        id: price.id,
        type: price.type,
        amount: price.amount,
        amountFrom: price.amountFrom,
        amountTo: price.amountTo,
        currency: price.currency,
        unit: price.unit,
        taxNote: price.taxNote,
        effectiveFrom: price.effectiveFrom,
        effectiveUntil: price.effectiveUntil,
      })),
      duration: offering.duration
        ? {
            id: offering.duration.id,
            minimumMinutes: offering.duration.minimumMinutes,
            maximumMinutes: offering.duration.maximumMinutes,
            preparationMinutes: offering.duration.preparationMinutes,
            bufferMinutes: offering.duration.bufferMinutes,
          }
        : null,
    })),
  };
}

function cloneSnapshot(snapshot: CanonicalSnapshot): CanonicalSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CanonicalSnapshot;
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

@Injectable()
export class BusinessImportSourceLifecycleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Optional()
    @Inject(BusinessImportRuntimeService)
    private readonly runtime?: BusinessImportRuntimeService,
    @Optional()
    @Inject(BusinessImportQueueService)
    private readonly queue?: BusinessImportQueueService,
  ) {}

  async preview(
    context: RequestContext,
    sourceId: string,
  ): Promise<BusinessImportSourceArchivePreview> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertEditor(tx, context);
        await this.lockCatalog(tx, context.tenantId);
        const source = await this.requireSource(tx, context.tenantId, sourceId);
        if (source.status === "ARCHIVED") this.sourceArchived();
        const [ownership, objectCandidates, activeImports] = await Promise.all([
          this.loadOwnership(tx, context.tenantId, sourceId),
          this.loadObjectCandidates(tx, context.tenantId, sourceId),
          this.loadActiveImports(tx, context.tenantId, sourceId),
        ]);
        return {
          sourceId,
          sourceEtag: businessImportSourceEtag(source.id, source.etag),
          status: source.status,
          canArchive: activeImports.length === 0,
          impact: this.impact(ownership, objectCandidates),
          activeImports: {
            count: activeImports.length,
            items: activeImports.map((item) => ({
              id: item.id,
              state: item.state,
              displayName: item.displayName,
              href: `/app/knowledge/imports/${encodeURIComponent(item.id)}`,
            })),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async archive(
    context: RequestContext,
    sourceId: string,
    idempotencyKey: string,
    ifMatch: HeaderValue,
  ): Promise<BusinessImportSourceArchiveReceipt> {
    let reservation: PendingBusinessImportObject | null = null;
    let committed = false;
    try {
      const outcome = await this.idempotency.executePrepared(
        {
          tenantId: context.tenantId,
          endpoint: "DELETE:/business-profile/imports/sources/:sourceId",
          key: idempotencyKey,
          request: { sourceId, ifMatch: normalizedIfMatch(ifMatch) },
          transactionTimeoutMs: 120_000,
        },
        async () => {
          const prepared = await this.prepare(context, sourceId, ifMatch);
          if (prepared.kind === "mutation") reservation = prepared.reservation;
          return prepared;
        },
        (tx, prepared) => this.apply(tx, context, sourceId, ifMatch, prepared),
      );
      committed = true;
      const receipt = outcome.responseBody;
      if (receipt.businessInformationRevisionId && this.queue) {
        const event = await this.prisma.runtimeOutbox.findFirst({
          where: {
            tenantId: context.tenantId,
            aggregateType: "BusinessInformationRevision",
            aggregateId: receipt.businessInformationRevisionId,
            eventType: "business.information.project.requested",
          },
          select: { id: true },
        });
        if (event) this.queue.dispatch(event.id);
      }
      return receipt;
    } finally {
      if (reservation && !committed && this.runtime) {
        const runtime = this.runtime.runtime();
        await cleanupPendingBusinessImportObject(this.prisma, runtime.store, reservation).catch(
          () => undefined,
        );
      }
    }
  }

  private async prepare(
    context: RequestContext,
    sourceId: string,
    ifMatch: HeaderValue,
  ): Promise<PreparedArchive> {
    const plan = await this.prisma.$transaction(
      async (tx) => {
        await this.assertEditor(tx, context);
        const source = await this.requireSource(tx, context.tenantId, sourceId);
        assertBusinessImportIfMatch(ifMatch, businessImportSourceEtag(source.id, source.etag), {
          sourceId,
        });
        if (source.status === "ARCHIVED") this.sourceArchived();
        await this.assertIdle(tx, context.tenantId, sourceId);
        return this.buildPlan(tx, context.tenantId, source, new Date().toISOString());
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (plan.ownership.removeOfferingIds.length === 0) return { kind: "metadata", plan };
    if (!plan.state || !plan.before || !plan.after || !plan.canonicalHash) {
      this.integrityConflict(sourceId);
    }
    if (!this.runtime) this.storageUnavailable();

    const revisionId = randomUUID();
    const revision = plan.state.revision + 1;
    const delta = {
      schema: "leadvirt.business-information-revision-delta.v1",
      tenantId: context.tenantId,
      revision,
      parentRevisionId: plan.state.currentRevisionId,
      parentRevision: plan.state.revision,
      origin: "MANUAL",
      operation: "ARCHIVE_IMPORT_SOURCE",
      actorUserId: context.userId,
      sourceId,
      before: { canonical: plan.before },
      after: { canonical: plan.after },
      changedCanonicalFields: plan.ownership.removeOfferingIds.flatMap((offeringId) => [
        { resourceType: "OFFERING", resourceKey: offeringId, fieldPath: "/active" },
        { resourceType: "OFFERING", resourceKey: offeringId, fieldPath: "/archivedAt" },
      ]),
    };
    const deltaHash = canonicalKnowledgeV2Hash(delta);
    const objectKey = createDeterministicKnowledgeObjectKey({
      tenantId: context.tenantId,
      sourceId: "business-information-revisions",
      purpose: "extracted",
      identity: `${revisionId}:${deltaHash}`,
    });
    const runtime = this.runtime.runtime();
    const reservation = await reservePendingBusinessImportObject(this.prisma, {
      tenantId: context.tenantId,
      objectKind: "REVISION_DELTA",
      objectStorageKey: objectKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `SOURCE_ARCHIVE_REVISION_DELTA:${revisionId}`,
      retainUntil: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const write = await putPendingBusinessImportObject(
      this.prisma,
      runtime.store,
      reservation,
      new TextEncoder().encode(JSON.stringify(delta)),
    );
    return {
      kind: "mutation",
      plan,
      revisionId,
      objectLedgerId: reservation.ledgerId,
      objectKey,
      encryptionKeyRef: write.encryptionKeyRef,
      reservation,
      deltaHash,
    };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    sourceId: string,
    ifMatch: HeaderValue,
    prepared: PreparedArchive,
  ) {
    await this.lockCatalog(tx, context.tenantId);
    await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
    await this.lockCanonicalAggregate(tx, context.tenantId);
    await this.assertEditor(tx, context);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImportSource"
      WHERE "tenantId" = ${context.tenantId} AND "id" = ${sourceId}
      FOR UPDATE
    `);
    const source = await this.requireSource(tx, context.tenantId, sourceId);
    assertBusinessImportIfMatch(ifMatch, businessImportSourceEtag(source.id, source.etag), {
      sourceId,
    });
    if (source.status === "ARCHIVED") this.sourceArchived();
    await this.assertIdle(tx, context.tenantId, sourceId);

    const finalPlan = await this.buildPlan(tx, context.tenantId, source, prepared.plan.archivedAt);
    if (finalPlan.fingerprint !== prepared.plan.fingerprint) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_INFORMATION_INTEGRITY_CONFLICT",
        "Catalog ownership changed while the catalog was being archived.",
        { retryable: true, details: { sourceId } },
      );
    }

    let businessInformationRevisionId: string | null = null;
    let businessInformationRevision: number | null = null;
    let projectionEventId: string | null = null;
    if (prepared.kind === "mutation") {
      if (!finalPlan.state || !finalPlan.before || !finalPlan.after || !finalPlan.canonicalHash) {
        this.integrityConflict(sourceId);
      }
      for (const offeringId of finalPlan.ownership.removeOfferingIds) {
        const before = finalPlan.before.offerings.find((item) => item.id === offeringId);
        if (!before) this.integrityConflict(sourceId, offeringId);
        const archived = await tx.businessOffering.updateMany({
          where: {
            id: offeringId,
            tenantId: context.tenantId,
            active: true,
            archivedAt: null,
            rowVersion: before.rowVersion,
          },
          data: {
            active: false,
            archivedAt: new Date(finalPlan.archivedAt),
            rowVersion: { increment: 1 },
          },
        });
        if (archived.count !== 1) this.integrityConflict(sourceId, offeringId);
      }
      await adoptPendingBusinessImportObject(
        tx,
        prepared.reservation,
        "BUSINESS_INFORMATION_REVISION",
        null,
      );
      businessInformationRevision = finalPlan.state.revision + 1;
      const revision = await tx.businessInformationRevision.create({
        data: {
          id: prepared.revisionId,
          tenantId: context.tenantId,
          revision: businessInformationRevision,
          parentRevisionId: finalPlan.state.currentRevisionId,
          parentRevision: finalPlan.state.revision,
          canonicalHash: finalPlan.canonicalHash,
          origin: "MANUAL",
          deltaObjectKey: prepared.objectKey,
          deltaEncryptionKeyRef: prepared.encryptionKeyRef,
          deltaObjectLedgerId: prepared.objectLedgerId,
          deltaHash: prepared.deltaHash,
          affectedResources: {
            schema: "leadvirt.business-information-affected-resources.v1",
            resources: finalPlan.ownership.removeOfferingIds.map((resourceKey) => ({
              resourceType: "OFFERING",
              resourceKey,
            })),
            profileFields: [],
          },
          createdByUserId: context.userId,
        },
      });
      await this.reconcileArchiveAttributions(tx, context, finalPlan, revision);
      const projectionData = {
        tenantId: context.tenantId,
        businessRevisionId: revision.id,
        businessRevision: revision.revision,
        generation: revision.revision,
        requestedByUserId: context.userId,
        requestedAt: revision.createdAt.toISOString(),
      };
      const event = this.queue
        ? await this.queue.createRevisionProjectionEvent(tx, projectionData, context.sessionId)
        : await createRuntimeQueueEvent(tx, {
            tenantId: context.tenantId,
            aggregateType: "BusinessInformationRevision",
            aggregateId: revision.id,
            aggregateVersion: revision.revision,
            generation: revision.revision,
            eventType: "business.information.project.requested",
            dedupeKey: `business-information-project:${revision.id}:${revision.revision}`,
            deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
            ...(context.sessionId !== undefined ? { traceId: context.sessionId } : {}),
            envelope: {
              queueName: "business.import",
              jobName: "project-revision",
              jobId: `business-information-project:${revision.id}:${revision.revision}`,
              data: projectionData,
              attempts: 10,
              backoffMs: 2_000,
            },
          });
      const stateUpdate = await tx.businessInformationState.updateMany({
        where: {
          tenantId: context.tenantId,
          revision: finalPlan.state.revision,
          currentRevisionId: finalPlan.state.currentRevisionId,
          canonicalHash: finalPlan.state.canonicalHash,
          etag: finalPlan.state.etag,
        },
        data: {
          revision: businessInformationRevision,
          currentRevisionId: revision.id,
          canonicalHash: finalPlan.canonicalHash,
          etag: { increment: 1 },
          updatedByUserId: context.userId,
        },
      });
      if (stateUpdate.count !== 1) this.revisionConflict();
      businessInformationRevisionId = revision.id;
      projectionEventId = event.id;
    } else if (finalPlan.state && finalPlan.after) {
      await this.reconcileArchiveAttributions(tx, context, finalPlan, {
        id: finalPlan.state.currentRevisionId,
        revision: finalPlan.state.revision,
        canonicalHash: finalPlan.state.canonicalHash,
      });
    }

    const detached = await tx.businessOfferingSourceBinding.updateMany({
      where: {
        tenantId: context.tenantId,
        sourceId,
        id: { in: finalPlan.ownership.bindingIds },
        active: true,
      },
      data: { active: false },
    });
    if (detached.count !== finalPlan.ownership.bindingIds.length) {
      this.integrityConflict(sourceId);
    }

    await tx.businessImport.updateMany({
      where: {
        tenantId: context.tenantId,
        sourceId,
        stagingObjectLedgerId: { not: null },
      },
      data: {
        stagingObjectKey: null,
        stagingEncryptionKeyRef: null,
        stagingObjectLedgerId: null,
        stagingObjectKind: null,
      },
    });
    if (finalPlan.objectCandidates.length > 0) {
      const purgeAt = new Date(finalPlan.archivedAt);
      await tx.businessImportObjectLedger.updateMany({
        where: {
          tenantId: context.tenantId,
          id: { in: finalPlan.objectCandidates.map((item) => item.id) },
          objectKind: { in: [...PURGEABLE_OBJECT_KINDS] },
          deletionState: "RETAINED",
          legalHold: false,
        },
        data: {
          deletionState: "TOMBSTONED",
          tombstoneReason: "BUSINESS_IMPORT_SOURCE_ARCHIVED",
          tombstonedAt: purgeAt,
          lastErrorCode: null,
        },
      });
    }

    const archivedSource = await tx.businessImportSource.updateMany({
      where: {
        id: sourceId,
        tenantId: context.tenantId,
        etag: source.etag,
        status: { not: "ARCHIVED" },
      },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(finalPlan.archivedAt),
        updatedByUserId: context.userId,
        etag: { increment: 1 },
      },
    });
    if (archivedSource.count !== 1) this.revisionConflict();

    const impact = this.impact(finalPlan.ownership, finalPlan.objectCandidates);
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "business_import.source_archived",
        entityType: "business_import_source",
        entityId: sourceId,
        payload: {
          ...impact,
          businessInformationRevision,
          projectionEventId,
        },
      },
    });
    return {
      httpStatus: HttpStatus.OK,
      responseBody: {
        sourceId,
        status: "ARCHIVED" as const,
        sourceEtag: businessImportSourceEtag(sourceId, source.etag + 1),
        archivedAt: finalPlan.archivedAt,
        detachedOfferingBindings: impact.detachedOfferingBindings,
        archivedOfferings: impact.removeOfferings,
        retainedOfferings: impact.retainedOfferings,
        sharedOfferings: impact.sharedOfferings,
        manualOfferings: impact.manualOfferings,
        objectsScheduledForDeletion: impact.objectsScheduledForDeletion,
        businessInformationRevisionId,
        businessInformationRevision,
        projectionQueued: projectionEventId !== null,
      },
      responseRef: sourceId,
    };
  }

  private async reconcileArchiveAttributions(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    plan: ArchivePlan,
    revision: {
      id: string;
      revision: number;
      canonicalHash: string;
    },
  ) {
    const attributedAt = new Date(plan.archivedAt);
    if (!plan.after) this.integrityConflict(plan.sourceId);
    const sourceAttributions = await tx.businessInformationAttribution.findMany({
      where: {
        tenantId: context.tenantId,
        sourceId: plan.sourceId,
        supersededAt: null,
        OR: [
          {
            resourceType: "OFFERING",
            offeringId: { in: plan.ownership.boundOfferingIds },
          },
          {
            resourceType: "OFFERING_PRICE",
            offeringPrice: { offeringId: { in: plan.ownership.boundOfferingIds } },
          },
          {
            resourceType: "OFFERING_DURATION",
            offeringDuration: { offeringId: { in: plan.ownership.boundOfferingIds } },
          },
        ],
      },
      select: {
        id: true,
        resourceType: true,
        resourceKey: true,
        fieldPath: true,
      },
      orderBy: { id: "asc" },
    });
    const fields = new Map<
      string,
      {
        resourceType: "OFFERING" | "OFFERING_PRICE" | "OFFERING_DURATION";
        resourceKey: string;
        fieldPath: string;
        value: unknown;
      }
    >();
    for (const attribution of sourceAttributions) {
      if (attribution.resourceType === "BUSINESS_IDENTITY") {
        this.integrityConflict(plan.sourceId);
      }
      const value = this.archiveAttributionValue(
        plan.after,
        plan.sourceId,
        attribution.resourceType,
        attribution.resourceKey,
        attribution.fieldPath,
      );
      fields.set(
        `${attribution.resourceType}:${attribution.resourceKey}:${attribution.fieldPath}`,
        {
          resourceType: attribution.resourceType,
          resourceKey: attribution.resourceKey,
          fieldPath: attribution.fieldPath,
          value,
        },
      );
      const superseded = await tx.businessInformationAttribution.updateMany({
        where: {
          id: attribution.id,
          tenantId: context.tenantId,
          sourceId: plan.sourceId,
          supersededAt: null,
        },
        data: { supersededAt: attributedAt },
      });
      if (superseded.count !== 1) this.integrityConflict(plan.sourceId);
    }
    for (const offeringId of plan.ownership.removeOfferingIds) {
      for (const field of [
        { fieldPath: "/active", value: false },
        { fieldPath: "/archivedAt", value: plan.archivedAt },
      ] as const) {
        fields.set(`OFFERING:${offeringId}:${field.fieldPath}`, {
          resourceType: "OFFERING",
          resourceKey: offeringId,
          fieldPath: field.fieldPath,
          value: field.value,
        });
        await tx.businessInformationAttribution.updateMany({
          where: {
            tenantId: context.tenantId,
            resourceType: "OFFERING",
            resourceKey: offeringId,
            fieldPath: field.fieldPath,
            supersededAt: null,
          },
          data: { supersededAt: attributedAt },
        });
      }
    }
    for (const field of fields.values()) {
      await tx.businessInformationAttribution.create({
        data: {
          tenantId: context.tenantId,
          resourceType: field.resourceType,
          resourceKey: field.resourceKey,
          ...(field.resourceType === "OFFERING"
            ? { offeringId: field.resourceKey }
            : field.resourceType === "OFFERING_PRICE"
              ? { offeringPriceId: field.resourceKey }
              : { offeringDurationId: field.resourceKey }),
          fieldPath: field.fieldPath,
          currentValueHash: canonicalKnowledgeV2Hash(field.value),
          authority: "SYSTEM",
          businessRevisionId: revision.id,
          businessRevision: revision.revision,
          businessRevisionHash: revision.canonicalHash,
          attributedAt,
        },
      });
    }
  }

  private archiveAttributionValue(
    snapshot: CanonicalSnapshot,
    sourceId: string,
    resourceType: "OFFERING" | "OFFERING_PRICE" | "OFFERING_DURATION",
    resourceKey: string,
    fieldPath: string,
  ) {
    const offering =
      resourceType === "OFFERING"
        ? snapshot.offerings.find((item) => item.id === resourceKey)
        : snapshot.offerings.find((item) =>
            resourceType === "OFFERING_PRICE"
              ? item.prices.some((price) => price.id === resourceKey)
              : item.duration?.id === resourceKey,
          );
    const resource =
      resourceType === "OFFERING"
        ? offering
        : resourceType === "OFFERING_PRICE"
          ? offering?.prices.find((price) => price.id === resourceKey)
          : offering?.duration;
    const property = fieldPath.startsWith("/") ? fieldPath.slice(1) : fieldPath;
    if (
      !resource ||
      property.length === 0 ||
      property.includes("/") ||
      !Object.prototype.hasOwnProperty.call(resource, property)
    ) {
      this.integrityConflict(sourceId, resourceKey);
    }
    return (resource as unknown as Record<string, unknown>)[property];
  }

  private async buildPlan(
    tx: Prisma.TransactionClient,
    tenantId: string,
    source: SourceRow,
    archivedAt: string,
  ): Promise<ArchivePlan> {
    const [state, ownership, objectCandidates] = await Promise.all([
      tx.businessInformationState.findUnique({ where: { tenantId } }),
      this.loadOwnership(tx, tenantId, source.id),
      this.loadObjectCandidates(tx, tenantId, source.id),
    ]);
    if (!state || state.revision < 1 || !state.currentRevisionId) {
      if (ownership.boundOfferingIds.length > 0) this.integrityConflict(source.id);
      const planBase = {
        sourceId: source.id,
        sourceEtag: source.etag,
        archivedAt,
        state: null,
        before: null,
        after: null,
        beforeRowsHash: null,
        canonicalHash: null,
        ownership,
        objectCandidates,
      };
      return {
        ...planBase,
        fingerprint: canonicalKnowledgeV2Hash({
          sourceId: planBase.sourceId,
          sourceEtag: planBase.sourceEtag,
          state: null,
          beforeRowsHash: null,
          ownership: planBase.ownership.fingerprintRows,
          objectCandidates: planBase.objectCandidates,
        }),
      };
    }
    const canonicalState = state as DbBusinessInformationState & {
      currentRevisionId: string;
    };
    const rows = await this.loadCanonicalRows(tx, tenantId);
    const before = canonicalSnapshot(rows);
    const after = cloneSnapshot(before);
    for (const offeringId of ownership.removeOfferingIds) {
      const offering = after.offerings.find((item) => item.id === offeringId);
      if (!offering) this.integrityConflict(source.id, offeringId);
      offering.active = false;
      offering.archivedAt = archivedAt;
      offering.rowVersion += 1;
    }
    const planBase = {
      sourceId: source.id,
      sourceEtag: source.etag,
      archivedAt,
      state: {
        revision: canonicalState.revision,
        currentRevisionId: canonicalState.currentRevisionId,
        canonicalHash: canonicalState.canonicalHash,
        etag: canonicalState.etag,
      },
      before,
      after,
      beforeRowsHash: canonicalKnowledgeV2Hash(before),
      canonicalHash: canonicalKnowledgeV2Hash(canonicalContent(after)),
      ownership,
      objectCandidates,
    };
    return {
      ...planBase,
      fingerprint: canonicalKnowledgeV2Hash({
        sourceId: planBase.sourceId,
        sourceEtag: planBase.sourceEtag,
        state: planBase.state,
        beforeRowsHash: planBase.beforeRowsHash,
        ownership: planBase.ownership.fingerprintRows,
        objectCandidates: planBase.objectCandidates,
      }),
    };
  }

  private async loadOwnership(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceId: string,
  ): Promise<ArchiveOwnership> {
    const bindings: OwnershipBindingRow[] = await tx.businessOfferingSourceBinding.findMany({
      where: { tenantId, sourceId, active: true },
      include: {
        offering: {
          include: {
            sourceBindings: {
              where: { active: true },
              select: { id: true, sourceId: true },
            },
            attributions: {
              where: { authority: "MANUAL", supersededAt: null },
              select: { id: true },
            },
            prices: {
              include: {
                attributions: {
                  where: { authority: "MANUAL", supersededAt: null },
                  select: { id: true },
                },
              },
            },
            duration: {
              include: {
                attributions: {
                  where: { authority: "MANUAL", supersededAt: null },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });
    const byOffering = new Map<string, OwnershipBindingRow[]>();
    for (const binding of bindings) {
      const group = byOffering.get(binding.offeringId) ?? [];
      group.push(binding);
      byOffering.set(binding.offeringId, group);
    }

    const removeOfferingIds: string[] = [];
    const retainedOfferingIds: string[] = [];
    const sharedOfferingIds: string[] = [];
    const manualOfferingIds: string[] = [];
    const fingerprintRows: ArchiveOwnership["fingerprintRows"] = [];
    for (const [offeringId, group] of [...byOffering.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const offering = group[0]!.offering;
      const sharedBindings = offering.sourceBindings.filter(
        (binding) => binding.sourceId !== sourceId,
      );
      const manualAttributionIds = uniqueSorted([
        ...offering.attributions.map((item) => item.id),
        ...offering.prices.flatMap((price) => price.attributions.map((item) => item.id)),
        ...(offering.duration?.attributions.map((item) => item.id) ?? []),
      ]);
      const shared = sharedBindings.length > 0;
      const manual = manualAttributionIds.length > 0;
      const removable = !shared && !manual && offering.active && offering.archivedAt === null;
      if (shared) sharedOfferingIds.push(offeringId);
      if (manual) manualOfferingIds.push(offeringId);
      if (removable) removeOfferingIds.push(offeringId);
      else retainedOfferingIds.push(offeringId);
      fingerprintRows.push({
        offeringId,
        bindingIds: uniqueSorted(group.map((item) => item.id)),
        active: offering.active,
        archivedAt: offering.archivedAt?.toISOString() ?? null,
        rowVersion: offering.rowVersion,
        sharedBindingIds: uniqueSorted(sharedBindings.map((item) => item.id)),
        sharedSourceIds: uniqueSorted(sharedBindings.map((item) => item.sourceId)),
        manualAttributionIds,
      });
    }
    return {
      bindingIds: bindings.map((binding) => binding.id),
      boundOfferingIds: uniqueSorted(bindings.map((binding) => binding.offeringId)),
      removeOfferingIds,
      retainedOfferingIds,
      sharedOfferingIds,
      manualOfferingIds,
      fingerprintRows,
    };
  }

  private async loadObjectCandidates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceId: string,
  ): Promise<SourceObjectCandidate[]> {
    return tx.businessImportObjectLedger.findMany({
      where: {
        tenantId,
        objectKind: { in: [...PURGEABLE_OBJECT_KINDS] },
        deletionState: { in: ["RETAINED", "TOMBSTONED", "FAILED"] },
        legalHold: false,
        OR: [
          { stagingImports: { some: { sourceId } } },
          { artifacts: { some: { sourceId } } },
          { parsedRevisions: { some: { sourceId } } },
          { candidateEvidence: { some: { sourceId } } },
          { applicationPreviews: { some: { sourceId } } },
        ],
      },
      select: { id: true, objectKind: true, deletionState: true },
      orderBy: { id: "asc" },
    }) as Promise<SourceObjectCandidate[]>;
  }

  private loadActiveImports(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    return tx.businessImport.findMany({
      where: { tenantId, sourceId, state: { in: [...ACTIVE_IMPORT_STATES] } },
      select: { id: true, state: true, displayName: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  }

  private impact(ownership: ArchiveOwnership, objectCandidates: readonly SourceObjectCandidate[]) {
    return {
      detachedOfferingBindings: ownership.bindingIds.length,
      removeOfferings: ownership.removeOfferingIds.length,
      retainedOfferings: ownership.retainedOfferingIds.length,
      sharedOfferings: ownership.sharedOfferingIds.length,
      manualOfferings: ownership.manualOfferingIds.length,
      objectsScheduledForDeletion: objectCandidates.length,
    };
  }

  private async loadCanonicalRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<CanonicalAggregateRows> {
    const [identity, offerings] = await Promise.all([
      tx.businessIdentity.findUnique({ where: { tenantId } }),
      tx.businessOffering.findMany({
        where: { tenantId },
        include: { prices: true, duration: true },
      }),
    ]);
    if (!identity) {
      throw businessImportError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "BUSINESS_INFORMATION_IDENTITY_MISSING",
        "Canonical business identity is unavailable.",
        { retryable: true },
      );
    }
    return { identity, offerings };
  }

  private async lockCanonicalAggregate(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(
        ${`business-information-state:${tenantId}`},
        0
      ))) AS business_information_state_lock
    `);
  }

  private async lockCatalog(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`business-import-catalog:${tenantId}`}, 0)
        )
      ) AS catalog_lock
    `);
  }

  private async assertEditor(tx: Prisma.TransactionClient, context: RequestContext) {
    const membership = await tx.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: context.tenantId,
          userId: context.userId,
        },
      },
      select: { role: true },
    });
    if (membership && ["OWNER", "ADMIN"].includes(membership.role)) return;
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "You do not have permission to archive service catalogs.",
    );
  }

  private async assertIdle(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    const activeImports = await this.loadActiveImports(tx, tenantId, sourceId);
    if (activeImports.length === 0) return;
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_SOURCE_BUSY",
      "Finish or cancel the active catalog import before archiving this catalog.",
      {
        retryable: true,
        details: {
          sourceId,
          activeImports: activeImports.map((item) => ({
            id: item.id,
            state: item.state,
            href: `/app/knowledge/imports/${encodeURIComponent(item.id)}`,
          })),
        },
      },
    );
  }

  private async requireSource(tx: Prisma.TransactionClient, tenantId: string, sourceId: string) {
    const source = await tx.businessImportSource.findFirst({
      where: { id: sourceId, tenantId },
    });
    if (!source) {
      throw businessImportError(
        HttpStatus.NOT_FOUND,
        "BUSINESS_IMPORT_SOURCE_NOT_FOUND",
        "The service catalog was not found.",
      );
    }
    return source;
  }

  private sourceArchived(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_SOURCE_ARCHIVED",
      "The service catalog is already archived.",
    );
  }

  private storageUnavailable(): never {
    throw businessImportError(
      HttpStatus.SERVICE_UNAVAILABLE,
      "BUSINESS_INFORMATION_REVISION_STORAGE_UNAVAILABLE",
      "Business information revision storage is not configured.",
      { retryable: true },
    );
  }

  private revisionConflict(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_INFORMATION_REVISION_CONFLICT",
      "Business information changed while the catalog was being archived.",
      { retryable: true },
    );
  }

  private integrityConflict(sourceId: string, offeringId?: string): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_INFORMATION_INTEGRITY_CONFLICT",
      "Catalog ownership changed while the catalog was being archived.",
      {
        retryable: true,
        details: {
          sourceId,
          ...(offeringId ? { offeringId } : {}),
        },
      },
    );
  }
}
