import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
  buildKnowledgeV2SnapshotAuthorizationManifest,
  compareKnowledgeCanonicalText,
  hashKnowledgeValue,
  knowledgeV2StructuredAuthorizationFingerprint,
  parseKnowledgeV2SnapshotAuthorizationManifest,
  parseKnowledgeV2TenantDefaultScopePolicy,
  resolveKnowledgeV2StructuredScope,
  stableKnowledgeValue,
  type KnowledgeV2TenantDefaultScopePolicy,
} from "@leadvirt/knowledge";
import type {
  KnowledgeCorpusSelectorView,
  KnowledgeV2CutoverRequest,
  KnowledgeV2LegacyMigrationStatus,
  KnowledgeV2LegacyMigrationView,
  KnowledgeV2MutationResult,
  KnowledgeV2ResumeLegacyMigrationRequest,
  KnowledgeV2StartLegacyMigrationRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  canonicalKnowledgeV2Hash,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import {
  KnowledgeV2IdempotencyService,
  type KnowledgeV2IdempotencyResult,
} from "./knowledge-v2-idempotency.service.js";
import { KnowledgeV2IndexPreparationService } from "./knowledge-v2-index-preparation.service.js";
import { KnowledgeV2ContentReconciliationService } from "./knowledge-v2-content-reconciliation.service.js";
import { KnowledgeV2OnboardingProjectionService } from "./knowledge-v2-onboarding-projection.service.js";
import { lockKnowledgeV2CorpusTransition } from "./knowledge-v2-transition-lock.js";
import { isOnboardingCompatibilitySource } from "./onboarding-knowledge-source-identity.js";

const pipelineVersion = "knowledge-v2-legacy-migration-v1";
const legacyParserVersion = "legacy-snapshot-v1";
const structuredTargetKey = "workspace-v2";
const observableSourceKey = "system:knowledge-v2-current-observables";
const activeReviewStatuses = ["OPEN", "ASSIGNED", "IN_REVIEW"] as const;
const activeConflictStatuses = ["OPEN", "IN_REVIEW"] as const;

const cutoverPublicationInclude = {
  validation: true,
  items: {
    include: {
      v2DocumentRevision: {
        include: {
          chunks: true,
          document: { include: { source: true } },
        },
      },
      factVersion: {
        include: {
          evidence: true,
          fact: {
            include: {
              versions: {
                orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
      guidanceRuleVersion: {
        include: {
          evidence: true,
          guidanceRule: {
            include: {
              versions: {
                orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ itemType: "asc" }, { itemId: "asc" }],
  },
  indexSnapshot: {
    include: {
      v2Items: {
        include: { chunk: true },
        orderBy: { chunkId: "asc" },
      },
    },
  },
} satisfies Prisma.KnowledgePublicationInclude;

type CutoverPublication = Prisma.KnowledgePublicationGetPayload<{
  include: typeof cutoverPublicationInclude;
}>;
type CutoverSource = NonNullable<
  CutoverPublication["items"][number]["v2DocumentRevision"]
>["document"]["source"];

interface LegacyManifestItem {
  sourceId: string;
  sourceVersion: number;
  snapshotHash: string;
}

interface ObservableValue {
  origin: "legacy" | "onboarding" | "tenant";
  value: string;
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function normalizedObservable(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

function isEffective(from: Date | null, until: Date | null, now: Date) {
  return (!from || from <= now) && (!until || until > now);
}

function sourcePermissionFingerprint(source: {
  tenantId: string;
  id: string;
  sourcePermissionVersion: number;
  defaultScope: Prisma.JsonValue | null;
  defaultClassification: string;
  defaultLocale: string;
}) {
  return canonicalKnowledgeV2Hash({
    tenantId: source.tenantId,
    sourceId: source.id,
    permissionVersion: source.sourcePermissionVersion,
    scope: source.defaultScope,
    classification: source.defaultClassification,
    locale: source.defaultLocale,
  });
}

function structuredAuthorizationFingerprint(input: {
  itemType: "FACT_VERSION" | "GUIDANCE_RULE_VERSION";
  persistedScope: Prisma.JsonValue | null;
  publicationScope: Prisma.JsonValue | null;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
  defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  authority: Record<string, unknown>;
  evidence: ReadonlyArray<{
    id: string;
    kind: string;
    label: string;
    locator: string | null;
    isPublic: boolean;
    legacyRevisionId: string | null;
    sourceReference: Prisma.JsonValue | null;
    elementReference: Prisma.JsonValue | null;
    quoteHash: string | null;
    confidence: number | null;
  }>;
}) {
  const binding = resolveKnowledgeV2StructuredScope(
    input.persistedScope,
    input.defaultScopePolicy,
  );
  if (
    !binding ||
    stableKnowledgeValue(binding.scope) !== stableKnowledgeValue(input.publicationScope) ||
    binding.usesTenantDefaultScope !== input.usesTenantDefaultScope ||
    binding.tenantDefaultScopeGeneration !== input.tenantDefaultScopeGeneration ||
    binding.tenantDefaultScopeHash !== input.tenantDefaultScopeHash
  ) {
    return null;
  }
  return knowledgeV2StructuredAuthorizationFingerprint({
    itemType: input.itemType,
    binding,
    riskLevel: input.riskLevel,
    authority: input.authority,
    evidence: input.evidence,
  });
}

function migrationStatus(value: string): KnowledgeV2LegacyMigrationStatus {
  if (["QUEUED", "RUNNING", "BLOCKED", "READY", "CUTOVER", "STALE", "FAILED"].includes(value)) {
    return value as KnowledgeV2LegacyMigrationStatus;
  }
  throw knowledgeV2Error(
    HttpStatus.INTERNAL_SERVER_ERROR,
    "KNOWLEDGE_DEPENDENCY_LEGACY_MIGRATION_INVALID",
    "The legacy migration state could not be read safely.",
  );
}

function mutationResult<T>(result: KnowledgeV2IdempotencyResult<T>): KnowledgeV2MutationResult<T> {
  return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
}

@Injectable()
export class KnowledgeV2MigrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Optional()
    @Inject(KnowledgeV2IndexPreparationService)
    private readonly indexPreparation?: KnowledgeV2IndexPreparationService,
    @Optional()
    @Inject(KnowledgeV2OnboardingProjectionService)
    private readonly onboardingProjection?: KnowledgeV2OnboardingProjectionService,
    @Optional()
    @Inject(KnowledgeV2ContentReconciliationService)
    private readonly contentReconciliation?: KnowledgeV2ContentReconciliationService,
  ) {}

  async start(
    context: RequestContext,
    input: KnowledgeV2StartLegacyMigrationRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2LegacyMigrationView>> {
    this.assertOwner(context);
    const reconciliationEventIds: string[] = [];
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/migrations/legacy",
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
        const selector = await tx.knowledgeCorpusSelector.findUnique({
          where: { tenantId: context.tenantId },
        });
        if (selector?.corpusKind === "STRUCTURED_V2") {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_AFTER_CUTOVER",
            "Legacy migration cannot start after structured corpus cutover.",
          );
        }
        await this.syncObservableSource(tx, context.tenantId);
        const manifest = await this.currentManifest(tx, context.tenantId);
        const sourceManifestHash = canonicalKnowledgeV2Hash({ version: 1, manifest });
        const existing = await tx.knowledgeV2LegacyMigration.findUnique({
          where: {
            tenantId_sourceManifestHash: {
              tenantId: context.tenantId,
              sourceManifestHash,
            },
          },
        });
        if (existing) {
          reconciliationEventIds.push(
            ...(await this.projectOnboardingAtMigrationStart(tx, context)),
          );
          const job = await this.job(tx, context.tenantId, existing.jobId);
          return {
            httpStatus: HttpStatus.OK,
            responseBody: this.migrationView(existing, job),
            responseRef: existing.id,
          };
        }
        await tx.knowledgeCorpusSelector.upsert({
          where: { tenantId: context.tenantId },
          update: {},
          create: {
            tenantId: context.tenantId,
            corpusKind: "LEGACY_V1",
            generation: 1,
            selectedByUserId: context.userId,
          },
        });
        const migrationId = randomUUID();
        const jobId = randomUUID();
        const job = await tx.knowledgeJob.create({
          data: {
            id: jobId,
            tenantId: context.tenantId,
            idempotencyKey: `legacy-migration:${sourceManifestHash}`,
            stage: "MIGRATING_LEGACY",
            pipelineVersion,
            generation: 1,
            status: "QUEUED",
            maxAttempts: Math.max(5, Math.ceil(manifest.length / (input.batchSize ?? 10)) + 2),
            progressTotal: manifest.length,
            payloadRef: `knowledge-v2-legacy-migration:${migrationId}`,
          },
        });
        const migration = await tx.knowledgeV2LegacyMigration.create({
          data: {
            id: migrationId,
            tenantId: context.tenantId,
            jobId,
            generation: 1,
            status: "QUEUED",
            sourceManifest: manifest,
            sourceManifestHash,
            expectedSourceCount: manifest.length,
            requestedByUserId: context.userId,
          },
        });
        reconciliationEventIds.push(...(await this.projectOnboardingAtMigrationStart(tx, context)));
        await this.audit(tx, context, "knowledge.v2.legacy_migration_started", migration.id, {
          generation: migration.generation,
          sourceManifestHash,
          expectedSourceCount: manifest.length,
          jobId,
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: this.migrationView(migration, job),
          responseRef: migration.id,
        };
      },
    );
    await this.dispatchContentReconciliation(reconciliationEventIds);
    return mutationResult(result);
  }

  private async projectOnboardingAtMigrationStart(
    tx: Prisma.TransactionClient,
    context: RequestContext,
  ) {
    if (!this.onboardingProjection) return [];
    const onboarding = await tx.onboardingState.findUnique({
      where: { tenantId: context.tenantId },
      select: { data: true },
    });
    if (!onboarding) return [];
    const data = record(onboarding.data);
    const projection = await this.onboardingProjection.projectInTransaction(
      tx,
      context,
      data,
      data,
    );
    return projection.eventIds;
  }

  private async dispatchContentReconciliation(eventIds: string[]) {
    if (!this.contentReconciliation || eventIds.length === 0) return;
    await Promise.allSettled(eventIds.map((id) => this.contentReconciliation!.dispatch(id)));
  }

  async get(context: RequestContext, migrationId: string) {
    this.assertOwner(context);
    const migration = await this.prisma.knowledgeV2LegacyMigration.findFirst({
      where: { id: migrationId, tenantId: context.tenantId },
    });
    if (!migration) throw this.notFound();
    const job = await this.prisma.knowledgeJob.findFirstOrThrow({
      where: { id: migration.jobId, tenantId: context.tenantId },
    });
    return this.migrationView(migration, job);
  }

  async resume(
    context: RequestContext,
    migrationId: string,
    input: KnowledgeV2ResumeLegacyMigrationRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2LegacyMigrationView>> {
    this.assertOwner(context);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/knowledge/v2/migrations/legacy/${migrationId}/resume`,
        key: idempotencyKey,
        request: input,
        transactionTimeoutMs: 120_000,
      },
      async (tx) => {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
        await this.lockMigration(tx, context.tenantId, migrationId);
        let migration = await tx.knowledgeV2LegacyMigration.findFirst({
          where: { id: migrationId, tenantId: context.tenantId },
        });
        if (!migration) throw this.notFound();
        let job = await this.job(tx, context.tenantId, migration.jobId);
        if (migration.generation !== input.generation || job.generation !== input.generation) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_GENERATION",
            "The migration generation changed before this batch could run.",
          );
        }
        if (migration.status === "BLOCKED") {
          const remaining = await this.migrationBlockCounts(tx, context.tenantId, migration.id);
          if (remaining.reviewCount === 0 && remaining.conflictCount === 0) {
            migration = await tx.knowledgeV2LegacyMigration.update({
              where: { id: migration.id },
              data: { status: "READY", reviewCount: 0, conflictCount: 0 },
            });
          }
          return {
            httpStatus: HttpStatus.OK,
            responseBody: this.migrationView(migration, job),
            responseRef: migration.id,
          };
        }
        if (["READY", "CUTOVER"].includes(migration.status)) {
          return {
            httpStatus: HttpStatus.OK,
            responseBody: this.migrationView(migration, job),
            responseRef: migration.id,
          };
        }
        if (["STALE", "FAILED"].includes(migration.status)) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_TERMINAL",
            "This migration cannot resume from its current state.",
          );
        }
        const manifest = this.parseManifest(migration.sourceManifest);
        const current = await this.currentManifest(tx, context.tenantId);
        if (
          canonicalKnowledgeV2Hash({ version: 1, manifest: current }) !==
          migration.sourceManifestHash
        ) {
          const stale = await this.markStale(tx, context, migration, job, null);
          return {
            httpStatus: HttpStatus.CONFLICT,
            responseBody: this.migrationView(stale.migration, stale.job),
            responseRef: stale.migration.id,
          };
        }
        const batchSize = input.batchSize ?? 10;
        const pending = manifest
          .filter((item) => !migration!.sourceCursor || item.sourceId > migration!.sourceCursor)
          .slice(0, batchSize);
        const attemptNumber = job.attemptCount + 1;
        const startedAt = new Date();
        job = await tx.knowledgeJob.update({
          where: { id: job.id },
          data: {
            status: "RUNNING",
            attemptCount: attemptNumber,
            startedAt: job.startedAt ?? startedAt,
            heartbeatAt: startedAt,
            errorCode: null,
            errorMessage: null,
          },
        });
        const attempt = await tx.knowledgeJobAttempt.create({
          data: {
            tenantId: context.tenantId,
            jobId: job.id,
            attempt: attemptNumber,
            status: "RUNNING",
            workerId: `api:${context.userId}`,
            heartbeatAt: startedAt,
          },
        });
        migration = await tx.knowledgeV2LegacyMigration.update({
          where: { id: migration.id },
          data: { status: "RUNNING" },
        });
        for (const item of pending) {
          const source = await tx.businessKnowledgeSource.findFirst({
            where: {
              id: item.sourceId,
              tenantId: context.tenantId,
              OR: [{ status: "ACTIVE" }, { sourceKey: observableSourceKey }],
              deletedAt: null,
            },
          });
          if (!source || this.legacySnapshotHash(source) !== item.snapshotHash) {
            const stale = await this.markStale(tx, context, migration, job, attempt.id);
            return {
              httpStatus: HttpStatus.CONFLICT,
              responseBody: this.migrationView(stale.migration, stale.job),
              responseRef: stale.migration.id,
            };
          }
          await this.migrateSource(tx, context, migration, source, item.snapshotHash);
        }
        const migratedSourceCount = migration.migratedSourceCount + pending.length;
        const complete = migratedSourceCount === manifest.length;
        const finishedAt = new Date();
        let reviewCount = migration.reviewCount;
        let conflictCount = migration.conflictCount;
        let status = "QUEUED";
        if (complete) {
          const reconciled = await this.reconcileObservableDisagreements(
            tx,
            context,
            migration,
            manifest,
          );
          reviewCount = reconciled.reviewCount;
          conflictCount = reconciled.conflictCount;
          status = conflictCount > 0 || reviewCount > 0 ? "BLOCKED" : "READY";
        }
        migration = await tx.knowledgeV2LegacyMigration.update({
          where: { id: migration.id },
          data: {
            status,
            sourceCursor: pending.at(-1)?.sourceId ?? migration.sourceCursor,
            migratedSourceCount,
            reviewCount,
            conflictCount,
            completedAt: complete ? finishedAt : null,
          },
        });
        job = await tx.knowledgeJob.update({
          where: { id: job.id },
          data: {
            status: complete ? "SUCCEEDED" : "QUEUED",
            progressCompleted: migratedSourceCount,
            heartbeatAt: finishedAt,
            completedAt: complete ? finishedAt : null,
          },
        });
        await tx.knowledgeJobAttempt.update({
          where: { id: attempt.id },
          data: { status: "SUCCEEDED", heartbeatAt: finishedAt, completedAt: finishedAt },
        });
        await this.audit(tx, context, "knowledge.v2.legacy_migration_batch", migration.id, {
          generation: migration.generation,
          processed: pending.length,
          migratedSourceCount,
          expectedSourceCount: migration.expectedSourceCount,
          status: migration.status,
          reviewCount,
          conflictCount,
        });
        return {
          httpStatus: complete ? HttpStatus.OK : HttpStatus.ACCEPTED,
          responseBody: this.migrationView(migration, job),
          responseRef: migration.id,
        };
      },
    );
    return mutationResult(result);
  }

  async selector(context: RequestContext): Promise<KnowledgeCorpusSelectorView> {
    this.assertOwner(context);
    const selector = await this.prisma.knowledgeCorpusSelector.findUnique({
      where: { tenantId: context.tenantId },
    });
    if (!selector) {
      return {
        corpusKind: "LEGACY_V1",
        generation: 0,
        migrationId: null,
        selectedAt: new Date(0).toISOString(),
        selectedByUserId: null,
        etag: strongKnowledgeV2Etag("corpus-selector", context.tenantId, 0),
      };
    }
    return this.selectorView(selector);
  }

  async cutover(
    context: RequestContext,
    input: KnowledgeV2CutoverRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeCorpusSelectorView>> {
    this.assertOwner(context);
    const result = await this.idempotency.executePrepared(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/migrations/corpus-selector/cutover",
        key: idempotencyKey,
        request: input,
      },
      () => this.prepareCutoverPublication(context, input),
      async (tx, prepared) => {
        await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
        await tx.$queryRaw(Prisma.sql`
          SELECT "tenantId"
          FROM "KnowledgeCorpusSelector"
          WHERE "tenantId" = ${context.tenantId}
          FOR UPDATE
        `);
        await tx.knowledgeV2Settings.upsert({
          where: { tenantId: context.tenantId },
          create: { tenantId: context.tenantId },
          update: {},
        });
        await tx.$queryRaw<Array<{ tenantId: string }>>(Prisma.sql`
          SELECT "tenantId"
          FROM "KnowledgeV2Settings"
          WHERE "tenantId" = ${context.tenantId}
          FOR UPDATE
        `);
        const selector = await tx.knowledgeCorpusSelector.findUnique({
          where: { tenantId: context.tenantId },
        });
        const migration = await tx.knowledgeV2LegacyMigration.findFirst({
          where: { id: input.migrationId, tenantId: context.tenantId },
        });
        if (!selector || !migration) throw this.notFound();
        if (
          migration.generation !== input.migrationGeneration ||
          selector.generation !== input.selectorGeneration
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_CORPUS_SELECTOR_GENERATION",
            "The migration or corpus selector changed before cutover.",
          );
        }
        if (selector.corpusKind === "STRUCTURED_V2") {
          if (selector.migrationId !== migration.id) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_CONFLICT_CORPUS_SELECTOR_ALREADY_CUT_OVER",
              "This tenant has already completed a different corpus cutover.",
            );
          }
          return {
            httpStatus: HttpStatus.OK,
            responseBody: this.selectorView(selector),
            responseRef: selector.tenantId,
          };
        }
        if (migration.status !== "READY") {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_NOT_READY",
            "Resolve migration review work and publish the structured candidate before cutover.",
          );
        }
        const currentManifest = await this.currentManifest(tx, context.tenantId);
        if (
          canonicalKnowledgeV2Hash({ version: 1, manifest: currentManifest }) !==
          migration.sourceManifestHash
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_STALE",
            "Legacy knowledge changed after migration. Run migration and publish again before cutover.",
          );
        }
        const [openReviews, openConflicts, pointer, settings] = await Promise.all([
          tx.knowledgeV2ReviewItem.count({
            where: {
              tenantId: context.tenantId,
              OR: [
                { reviewKey: { startsWith: `legacy-migration:${migration.id}:` } },
                { reviewKey: { startsWith: "onboarding-projection-v1:ownership:" } },
              ],
              status: { in: [...activeReviewStatuses] },
            },
          }),
          tx.knowledgeV2Conflict.count({
            where: {
              tenantId: context.tenantId,
              conflictKey: { startsWith: `legacy-migration:${migration.id}:` },
              status: { in: [...activeConflictStatuses] },
            },
          }),
          tx.activeKnowledgePublication.findUnique({
            where: {
              tenantId_targetKey: {
                tenantId: context.tenantId,
                targetKey: structuredTargetKey,
              },
            },
            include: { publication: { include: cutoverPublicationInclude } },
          }),
          tx.knowledgeV2Settings.findUnique({
            where: { tenantId: context.tenantId },
            select: { draftGeneration: true },
          }),
        ]);
        const validation = pointer?.publication.validation;
        const servingEligible = pointer
          ? await this.structuredPublicationServingEligible(
              tx,
              pointer.publication,
              migration.sourceManifest,
            )
          : false;
        if (
          openReviews > 0 ||
          openConflicts > 0 ||
          !pointer ||
          !validation ||
          validation.candidateVersion !== (settings?.draftGeneration ?? 1) ||
          !validation.validUntil ||
          validation.validUntil <= new Date() ||
          !servingEligible ||
          pointer.publication.id !== prepared.publicationId ||
          pointer.publication.indexSnapshotId !== prepared.snapshotId ||
          prepared.expectedPointCount !== prepared.observedPointCount
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
            "The structured corpus is not ready for runtime cutover.",
          );
        }
        const selectedAt = new Date();
        const updated = await tx.knowledgeCorpusSelector.update({
          where: { tenantId: context.tenantId },
          data: {
            corpusKind: "STRUCTURED_V2",
            migrationId: migration.id,
            generation: { increment: 1 },
            selectedAt,
            selectedByUserId: context.userId,
          },
        });
        await tx.knowledgeV2LegacyMigration.update({
          where: { id: migration.id },
          data: { status: "CUTOVER", cutoverAt: selectedAt },
        });
        await this.audit(tx, context, "knowledge.v2.corpus_cutover", migration.id, {
          fromCorpusKind: "LEGACY_V1",
          toCorpusKind: "STRUCTURED_V2",
          selectorGeneration: updated.generation,
          migrationGeneration: migration.generation,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.selectorView(updated),
          responseRef: updated.tenantId,
        };
      },
    );
    return mutationResult(result);
  }

  private async migrateSource(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    migration: { id: string; tenantId: string },
    legacy: {
      id: string;
      tenantId: string;
      type: string;
      source: string;
      sourceKey: string;
      title: string;
      content: string;
      structuredData: Prisma.JsonValue | null;
      version: number;
    },
    snapshotHash: string,
  ) {
    const existing = await tx.knowledgeV2DocumentRevision.findFirst({
      where: {
        tenantId: context.tenantId,
        legacySourceId: legacy.id,
        legacySourceVersion: legacy.version,
      },
    });
    if (existing) {
      if (existing.legacySnapshotHash !== snapshotHash) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_LEGACY_SNAPSHOT_IDENTITY",
          "A migrated legacy snapshot conflicts with its immutable provenance.",
        );
      }
      return existing;
    }
    const sourceKind = isOnboardingCompatibilitySource(legacy)
      ? ("LEGACY_ONBOARDING" as const)
      : ("MANUAL" as const);
    const externalRootKey = `legacy-snapshot:${legacy.id}`;
    let source = await tx.knowledgeV2Source.findUnique({
      where: {
        tenantId_kind_externalRootKey: {
          tenantId: context.tenantId,
          kind: sourceKind,
          externalRootKey,
        },
      },
    });
    const scope = { audiences: ["PUBLIC"], locales: ["en"] };
    if (!source) {
      source = await tx.knowledgeV2Source.create({
        data: {
          tenantId: context.tenantId,
          kind: sourceKind,
          displayName: legacy.title,
          externalRootKey,
          syncMode: "MANUAL",
          status: legacy.content.trim() ? "SYNCING" : "NEEDS_REVIEW",
          defaultScope: scope,
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
        },
      });
    }
    let document = await tx.knowledgeV2Document.findUnique({
      where: {
        tenantId_sourceId_externalKey: {
          tenantId: context.tenantId,
          sourceId: source.id,
          externalKey: `legacy:${legacy.id}`,
        },
      },
    });
    if (!document) {
      document = await tx.knowledgeV2Document.create({
        data: {
          tenantId: context.tenantId,
          sourceId: source.id,
          externalKey: `legacy:${legacy.id}`,
          kind: `LEGACY_${legacy.type}`.slice(0, 100),
          title: legacy.title,
          canonicalLocale: "en",
          scope,
          audience: ["PUBLIC"],
          classification: "PUBLIC",
          permissionVersion: source.sourcePermissionVersion,
          status: legacy.content.trim() ? "DISCOVERED" : "NEEDS_REVIEW",
        },
      });
    }
    const latest = await tx.knowledgeV2DocumentRevision.findFirst({
      where: { tenantId: context.tenantId, documentId: document.id },
      orderBy: { revisionNumber: "desc" },
    });
    const permissionFingerprint = canonicalKnowledgeV2Hash({
      tenantId: context.tenantId,
      sourceId: source.id,
      permissionVersion: source.sourcePermissionVersion,
      scope,
      classification: "PUBLIC",
      locale: "en",
    });
    const content = legacy.content;
    const structuredDataHash = canonicalKnowledgeV2Hash(legacy.structuredData ?? null);
    const revision = await tx.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: context.tenantId,
        sourceId: source.id,
        documentId: document.id,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        contentHash: snapshotHash,
        status: content.trim() ? "CHUNKING" : "NEEDS_REVIEW",
        parserVersion: legacyParserVersion,
        normalizerVersion: legacyParserVersion,
        extractorVersion: legacyParserVersion,
        chunkerVersion: legacyParserVersion,
        pipelineVersion,
        detectedLocale: "en",
        characterCount: content.length,
        tokenCount: Math.max(0, Math.ceil(content.length / 4)),
        parserQuality: {
          schemaVersion: 1,
          origin: "legacy_snapshot",
          legacySourceType: legacy.type,
          legacySourceKeyHash: canonicalKnowledgeV2Hash(legacy.sourceKey),
          structuredDataHash,
        },
        sourcePermissionFingerprint: permissionFingerprint,
        scopeSnapshot: scope,
        supersedesRevisionId: latest?.id ?? null,
        createdByUserId: context.userId,
        legacyMigrationId: migration.id,
        legacySourceId: legacy.id,
        legacySourceVersion: legacy.version,
        legacySnapshotHash: snapshotHash,
      },
    });
    if (content.trim()) {
      const chunkContentHash = hashKnowledgeValue(content);
      const element = await tx.knowledgeV2Element.create({
        data: {
          tenantId: context.tenantId,
          documentId: document.id,
          revisionId: revision.id,
          kind: "PARAGRAPH",
          ordinal: 0,
          normalizedText: content,
          contentHash: chunkContentHash,
          parserConfidence: 1,
          locale: "en",
          classification: "PUBLIC",
        },
      });
      await tx.knowledgeV2Chunk.create({
        data: {
          tenantId: context.tenantId,
          revisionId: revision.id,
          documentId: document.id,
          ordinal: 0,
          parentElementId: element.id,
          contentHash: chunkContentHash,
          tokenCount: Math.max(1, Math.ceil(content.length / 4)),
          locale: "en",
          scope,
          classification: "PUBLIC",
          permissionVersion: source.sourcePermissionVersion,
          denseSchemaVersion: "knowledge-dense-v1",
          sparseSchemaVersion: "knowledge-sparse-v1",
          pipelineVersion,
          vectorPointId: randomUUID(),
          provenanceRange: {
            start: 0,
            end: content.length,
            elementIds: [element.id],
            origin: "legacy_snapshot",
          },
        },
      });
    }
    if (latest && latest.status !== "PUBLISHED") {
      await tx.knowledgeV2DocumentRevision.update({
        where: { id: latest.id },
        data: { status: "SUPERSEDED" },
      });
    }
    await tx.knowledgeV2Document.update({
      where: { id: document.id },
      data: {
        currentDraftRevisionId: revision.id,
        status: content.trim() ? "DISCOVERED" : "NEEDS_REVIEW",
      },
    });
    if (!content.trim()) {
      await tx.knowledgeV2ReviewItem.create({
        data: {
          tenantId: context.tenantId,
          corpusKind: "STRUCTURED_V2",
          reviewKey: `legacy-migration:${migration.id}:empty:${legacy.id}`,
          reason: "MISSING_REQUIRED_INFORMATION",
          riskLevel: "MEDIUM",
          status: "OPEN",
          suggestedAction: "CORRECT_SOURCE",
          safeTitle: "Legacy source has no migratable content",
          safeSummary: "Add current source content before structured publication.",
          sourceId: source.id,
          v2DocumentRevisionId: revision.id,
          createdByUserId: context.userId,
        },
      });
    }
    return revision;
  }

  private async reconcileObservableDisagreements(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    migration: { id: string },
    manifest: readonly LegacyManifestItem[],
  ) {
    const legacyProfile = await tx.businessKnowledgeSource.findFirst({
      where: {
        tenantId: context.tenantId,
        id: { in: manifest.map((item) => item.sourceId) },
        sourceKey: "onboarding:business_profile",
      },
    });
    const observableSource = await tx.businessKnowledgeSource.findFirst({
      where: {
        tenantId: context.tenantId,
        id: { in: manifest.map((item) => item.sourceId) },
        sourceKey: observableSourceKey,
      },
    });
    const anchor = legacyProfile ?? observableSource;
    if (anchor) {
      const [revision, onboarding, tenant] = await Promise.all([
        tx.knowledgeV2DocumentRevision.findFirst({
          where: {
            tenantId: context.tenantId,
            legacySourceId: anchor.id,
            legacySourceVersion: anchor.version,
          },
          include: { document: true },
        }),
        tx.onboardingState.findUnique({ where: { tenantId: context.tenantId } }),
        tx.tenant.findUniqueOrThrow({ where: { id: context.tenantId } }),
      ]);
      if (revision) {
        const legacyData = record(legacyProfile?.structuredData);
        const onboardingData = record(onboarding?.data);
        const companyInfo = record(onboardingData.companyInfo);
        await this.createObservableConflict(tx, context, migration.id, revision, {
          semanticKey: "business.name",
          safeTitle: "Business name differs across imported sources",
          observations: [
            { origin: "legacy", value: text(legacyData.businessName) },
            { origin: "onboarding", value: text(companyInfo.name) },
            { origin: "tenant", value: text(tenant.name) },
          ],
        });
        await this.createObservableConflict(tx, context, migration.id, revision, {
          semanticKey: "business.type",
          safeTitle: "Business type differs across imported sources",
          observations: [
            { origin: "legacy", value: text(legacyData.businessType) },
            { origin: "onboarding", value: text(onboardingData.businessType) },
            { origin: "tenant", value: text(tenant.businessType) },
          ],
        });
      }
    }
    const [reviewCount, conflictCount] = await Promise.all([
      tx.knowledgeV2ReviewItem.count({
        where: {
          tenantId: context.tenantId,
          reviewKey: { startsWith: `legacy-migration:${migration.id}:` },
          status: { in: [...activeReviewStatuses] },
        },
      }),
      tx.knowledgeV2Conflict.count({
        where: {
          tenantId: context.tenantId,
          conflictKey: { startsWith: `legacy-migration:${migration.id}:` },
          status: { in: [...activeConflictStatuses] },
        },
      }),
    ]);
    return { reviewCount, conflictCount };
  }

  private async createObservableConflict(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    migrationId: string,
    revision: {
      id: string;
      contentHash: string;
      sourceId: string;
      document: { scope: Prisma.JsonValue | null };
    },
    input: {
      semanticKey: string;
      safeTitle: string;
      observations: ObservableValue[];
    },
  ) {
    const observations = input.observations.filter((item) => item.value.length > 0);
    if (new Set(observations.map((item) => normalizedObservable(item.value))).size <= 1) return;
    const candidateSetHash = canonicalKnowledgeV2Hash(
      observations.map((item) => ({
        origin: item.origin,
        valueHash: canonicalKnowledgeV2Hash(item.value),
      })),
    );
    const conflictKey = `legacy-migration:${migrationId}:${input.semanticKey}`;
    const existing = await tx.knowledgeV2Conflict.findUnique({
      where: { tenantId_conflictKey: { tenantId: context.tenantId, conflictKey } },
    });
    if (existing) return;
    const conflict = await tx.knowledgeV2Conflict.create({
      data: {
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        conflictKey,
        conflictType: "FACT_VALUE",
        semanticKey: input.semanticKey,
        scope: revision.document.scope ?? Prisma.JsonNull,
        scopeHash: canonicalKnowledgeV2Hash(revision.document.scope ?? null),
        severity: "HIGH",
        status: "OPEN",
        sourceId: revision.sourceId,
        candidateSetHash,
      },
    });
    await tx.knowledgeV2ConflictCandidate.createMany({
      data: observations.map((item, ordinal) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2" as const,
        conflictId: conflict.id,
        candidateKey: `${conflictKey}:${item.origin}`,
        ordinal,
        candidateType: "DOCUMENT_REVISION" as const,
        itemVersionHash: revision.contentHash,
        v2DocumentRevisionId: revision.id,
        candidateValueHash: canonicalKnowledgeV2Hash(item.value),
        authorityFingerprint: canonicalKnowledgeV2Hash({ origin: item.origin }),
        extractionMethod: `legacy_migration:${item.origin}`,
        confidence: 1,
        scope: revision.document.scope ?? Prisma.JsonNull,
      })),
    });
    await tx.knowledgeV2ReviewItem.create({
      data: {
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        reviewKey: `legacy-migration:${migrationId}:conflict:${input.semanticKey}`,
        reason: "CONFLICTING_VALUES",
        riskLevel: "HIGH",
        status: "OPEN",
        suggestedAction: "CORRECT_SOURCE",
        safeTitle: input.safeTitle,
        safeSummary: "Choose the current value before structured publication.",
        conflictId: conflict.id,
        createdByUserId: context.userId,
      },
    });
  }

  private async prepareCutoverPublication(
    context: RequestContext,
    input: KnowledgeV2CutoverRequest,
  ) {
    if (!this.indexPreparation) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_UNAVAILABLE",
        "The structured index cannot be verified for cutover.",
        { retryable: true },
      );
    }
    const [selector, migration, pointer, settings] = await Promise.all([
      this.prisma.knowledgeCorpusSelector.findUnique({
        where: { tenantId: context.tenantId },
      }),
      this.prisma.knowledgeV2LegacyMigration.findFirst({
        where: { id: input.migrationId, tenantId: context.tenantId },
      }),
      this.prisma.activeKnowledgePublication.findUnique({
        where: {
          tenantId_targetKey: {
            tenantId: context.tenantId,
            targetKey: structuredTargetKey,
          },
        },
        include: { publication: { include: { validation: true } } },
      }),
      this.prisma.knowledgeV2Settings.findUnique({
        where: { tenantId: context.tenantId },
        select: { draftGeneration: true },
      }),
    ]);
    if (!selector || !migration) throw this.notFound();
    if (
      selector.generation !== input.selectorGeneration ||
      migration.generation !== input.migrationGeneration
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_CORPUS_SELECTOR_GENERATION",
        "The migration or corpus selector changed before cutover.",
      );
    }
    const alreadyCutOver =
      selector.corpusKind === "STRUCTURED_V2" && selector.migrationId === migration.id;
    if (
      (!alreadyCutOver && migration.status !== "READY") ||
      (alreadyCutOver && migration.status !== "CUTOVER")
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_NOT_READY",
        "Resolve migration review work and publish the structured candidate before cutover.",
      );
    }
    if (
      !pointer ||
      pointer.publication.targetKey !== structuredTargetKey ||
      pointer.publication.corpusKind !== "STRUCTURED_V2" ||
      pointer.publication.status !== "ACTIVE" ||
      !pointer.publication.indexSnapshotId
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
        "The structured corpus is not ready for runtime cutover.",
      );
    }
    const validation = pointer.publication.validation;
    if (
      !alreadyCutOver &&
      (!validation ||
        validation.candidateVersion !== (settings?.draftGeneration ?? 1) ||
        !validation.validUntil ||
        validation.validUntil <= new Date())
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
        "The structured corpus is not ready for runtime cutover.",
      );
    }
    const verified = await this.indexPreparation.preparePublication({
      tenantId: context.tenantId,
      publicationId: pointer.publication.id,
    });
    if (
      verified.snapshotId !== pointer.publication.indexSnapshotId ||
      verified.expectedPointCount !== verified.observedPointCount
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
        "The structured corpus is not ready for runtime cutover.",
      );
    }
    return {
      publicationId: pointer.publication.id,
      snapshotId: verified.snapshotId,
      expectedPointCount: verified.expectedPointCount,
      observedPointCount: verified.observedPointCount,
    };
  }

  private async structuredPublicationServingEligible(
    tx: Prisma.TransactionClient,
    publication: CutoverPublication,
    sourceManifest: Prisma.JsonValue,
  ) {
    const now = new Date();
    if (
      publication.targetKey !== structuredTargetKey ||
      publication.corpusKind !== "STRUCTURED_V2" ||
      publication.status !== "ACTIVE" ||
      publication.items.length === 0 ||
      publication.validation?.status !== "PASSED" ||
      publication.validation.candidateManifestHash !== publication.manifestHash
    ) {
      return false;
    }
    const manifest = this.parseManifest(sourceManifest);
    const [permissionSources, migratedRevisions, settings] = await Promise.all([
      tx.knowledgeV2Source.findMany({
        where: {
          tenantId: publication.tenantId,
          id: {
            in: publication.items
              .filter((item) => item.itemType === "SOURCE_PERMISSION_SNAPSHOT")
              .map((item) => item.itemId),
          },
        },
      }),
      tx.knowledgeV2DocumentRevision.findMany({
        where: {
          tenantId: publication.tenantId,
          legacySourceId: { in: manifest.map((item) => item.sourceId) },
        },
        select: { id: true, legacySourceId: true, legacySourceVersion: true },
      }),
      tx.knowledgeV2Settings.findUnique({
        where: { tenantId: publication.tenantId },
        select: {
          defaultScope: true,
          defaultScopeGeneration: true,
          defaultScopeHash: true,
        },
      }),
    ]);
    const defaultScopePolicy = parseKnowledgeV2TenantDefaultScopePolicy({
      scope: settings?.defaultScope ?? null,
      generation: settings?.defaultScopeGeneration ?? 0,
      hash: settings?.defaultScopeHash ?? null,
    });
    if (!settings || (settings.defaultScope !== null && !defaultScopePolicy)) {
      return false;
    }
    const exactMigratedRevisions = migratedRevisions.filter((revision) =>
      manifest.some(
        (item) =>
          item.sourceId === revision.legacySourceId &&
          item.sourceVersion === revision.legacySourceVersion,
      ),
    );
    const publicationRevisionIds = new Set(
      publication.items.flatMap((item) =>
        item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevisionId
          ? [item.v2DocumentRevisionId]
          : [],
      ),
    );
    if (
      exactMigratedRevisions.length !== manifest.length ||
      exactMigratedRevisions.some((revision) => !publicationRevisionIds.has(revision.id))
    ) {
      return false;
    }
    const permissionSourcesById = new Map(permissionSources.map((source) => [source.id, source]));
    const eligibleDocumentSourceIds = new Set<string>();
    const currentManifest: Array<{
      itemType: string;
      itemId: string;
      itemVersionHash: string;
      scope: Prisma.JsonValue | null;
      usesTenantDefaultScope?: true;
      tenantDefaultScopeGeneration?: number | null;
      tenantDefaultScopeHash?: string | null;
      authorizationFingerprint: string;
    }> = [];
    for (const item of publication.items) {
      const authorization = this.currentItemAuthorization(
        item,
        permissionSourcesById,
        defaultScopePolicy,
      );
      const itemEligible = this.publicationItemEligible(item, now, permissionSourcesById);
      if (
        !item.itemVersionHash ||
        !item.authorizationFingerprint ||
        !authorization ||
        authorization !== item.authorizationFingerprint ||
        !itemEligible
      ) {
        return false;
      }
      if (item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision) {
        eligibleDocumentSourceIds.add(item.v2DocumentRevision.sourceId);
      }
      currentManifest.push({
        itemType: item.itemType,
        itemId: item.itemId,
        itemVersionHash: item.itemVersionHash,
        scope: item.scope,
        ...(item.usesTenantDefaultScope
          ? {
              usesTenantDefaultScope: true as const,
              tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
              tenantDefaultScopeHash: item.tenantDefaultScopeHash,
            }
          : {}),
        authorizationFingerprint: authorization,
      });
    }
    const hasOrphanPermissionSource = publication.items.some(
      (item) =>
        item.itemType === "SOURCE_PERMISSION_SNAPSHOT" &&
        !eligibleDocumentSourceIds.has(item.itemId),
    );
    const currentManifestHash = canonicalKnowledgeV2Hash(
      currentManifest.sort((left, right) =>
        compareKnowledgeCanonicalText(
          `${left.itemType}:${left.itemId}`,
          `${right.itemType}:${right.itemId}`,
        ),
      ),
    );
    const validationManifestMatches = this.validationManifestMatches(
      publication.validation.candidateItems,
      publication.manifestHash,
    );
    if (
      hasOrphanPermissionSource ||
      currentManifestHash !== publication.manifestHash ||
      !validationManifestMatches
    ) {
      return false;
    }
    return this.indexSnapshotServingEligible(publication);
  }

  private currentItemAuthorization(
    item: CutoverPublication["items"][number],
    permissionSources: Map<string, CutoverSource>,
    defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null,
  ) {
    if (item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision) {
      return sourcePermissionFingerprint(item.v2DocumentRevision.document.source);
    }
    if (item.itemType === "FACT_VERSION" && item.factVersion) {
      return structuredAuthorizationFingerprint({
        itemType: "FACT_VERSION",
        persistedScope: item.factVersion.scope,
        publicationScope: item.scope,
        usesTenantDefaultScope: item.usesTenantDefaultScope,
        tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
        tenantDefaultScopeHash: item.tenantDefaultScopeHash,
        defaultScopePolicy,
        riskLevel: item.factVersion.riskLevel,
        authority: {
          authority: item.factVersion.authority,
          verifiedByUserId: item.factVersion.verifiedByUserId,
        },
        evidence: item.factVersion.evidence,
      });
    }
    if (item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersion) {
      return structuredAuthorizationFingerprint({
        itemType: "GUIDANCE_RULE_VERSION",
        persistedScope: item.guidanceRuleVersion.scope,
        publicationScope: item.scope,
        usesTenantDefaultScope: item.usesTenantDefaultScope,
        tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
        tenantDefaultScopeHash: item.tenantDefaultScopeHash,
        defaultScopePolicy,
        riskLevel: item.guidanceRuleVersion.riskLevel,
        authority: {
          requiredApproverRole: item.guidanceRuleVersion.requiredApproverRole,
          approvedByUserId: item.guidanceRuleVersion.approvedByUserId,
        },
        evidence: item.guidanceRuleVersion.evidence,
      });
    }
    const source = permissionSources.get(item.itemId);
    return item.itemType === "SOURCE_PERMISSION_SNAPSHOT" && source
      ? sourcePermissionFingerprint(source)
      : null;
  }

  private publicationItemEligible(
    item: CutoverPublication["items"][number],
    now: Date,
    permissionSources: Map<string, CutoverSource>,
  ) {
    if (item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision) {
      const revision = item.v2DocumentRevision;
      const document = revision.document;
      const source = document.source;
      const fingerprint = sourcePermissionFingerprint(source);
      return (
        !revision.deletedAt &&
        ["READY", "PUBLISHED"].includes(revision.status) &&
        !document.deletedAt &&
        !document.tombstonedAt &&
        ["ACTIVE", "DISCOVERED"].includes(document.status) &&
        source.kind !== "LEGACY_ONBOARDING" &&
        !source.deletedAt &&
        !source.tombstonedAt &&
        ["READY", "SYNCING", "PAUSED"].includes(source.status) &&
        document.permissionVersion === source.sourcePermissionVersion &&
        revision.sourcePermissionFingerprint === fingerprint &&
        item.authorizationFingerprint === fingerprint &&
        item.itemVersionHash === revision.contentHash &&
        isEffective(revision.effectiveFrom, revision.effectiveUntil, now) &&
        (!revision.staleAfter || revision.staleAfter > now)
      );
    }
    if (item.itemType === "FACT_VERSION" && item.factVersion) {
      const version = item.factVersion;
      const head = version.fact.versions[0];
      const highRisk = ["HIGH", "CRITICAL"].includes(version.riskLevel);
      return (
        !version.fact.deletedAt &&
        head?.versionNumber === version.fact.latestVersionNumber &&
        head.lifecycleStatus !== "ARCHIVED" &&
        !["REJECTED", "CONFLICTED"].includes(head.verificationStatus) &&
        version.lifecycleStatus !== "ARCHIVED" &&
        version.verificationStatus === "VERIFIED" &&
        item.itemVersionHash === version.immutableHash &&
        isEffective(version.effectiveFrom, version.effectiveUntil, now) &&
        (!highRisk ||
          (version.evidence.length > 0 &&
            version.authority === "OWNER_VERIFIED" &&
            Boolean(version.verifiedByUserId) &&
            Boolean(version.effectiveUntil && version.effectiveUntil > now)))
      );
    }
    if (item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersion) {
      const version = item.guidanceRuleVersion;
      const head = version.guidanceRule.versions[0];
      const highRisk = ["HIGH", "CRITICAL"].includes(version.riskLevel);
      return (
        !version.guidanceRule.deletedAt &&
        head?.versionNumber === version.guidanceRule.latestVersionNumber &&
        !["REJECTED", "DISABLED"].includes(head.reviewStatus) &&
        version.reviewStatus === "APPROVED" &&
        item.itemVersionHash === version.immutableHash &&
        isEffective(version.effectiveFrom, version.effectiveUntil, now) &&
        (!highRisk ||
          (version.evidence.length > 0 &&
            Boolean(version.approvedByUserId) &&
            ["OWNER", "ADMIN"].includes(version.requiredApproverRole ?? "") &&
            Boolean(version.effectiveUntil && version.effectiveUntil > now)))
      );
    }
    const source = permissionSources.get(item.itemId);
    return Boolean(
      item.itemType === "SOURCE_PERMISSION_SNAPSHOT" &&
      source &&
      !source.deletedAt &&
      !source.tombstonedAt &&
      !["DELETING", "DELETED", "DISCONNECTED"].includes(source.status),
    );
  }

  private validationManifestMatches(value: Prisma.JsonValue, expectedHash: string) {
    if (!Array.isArray(value)) return false;
    const items = value.map((raw) => {
      const item = record(raw);
      if (
        typeof item.itemType !== "string" ||
        typeof item.itemId !== "string" ||
        typeof item.itemVersionHash !== "string" ||
        (item.usesTenantDefaultScope !== undefined &&
          typeof item.usesTenantDefaultScope !== "boolean") ||
        typeof item.authorizationFingerprint !== "string"
      ) {
        return null;
      }
      const usesTenantDefaultScope = item.usesTenantDefaultScope === true;
      const tenantDefaultScopeGeneration =
        typeof item.tenantDefaultScopeGeneration === "number" &&
        Number.isSafeInteger(item.tenantDefaultScopeGeneration)
          ? item.tenantDefaultScopeGeneration
          : null;
      const tenantDefaultScopeHash =
        typeof item.tenantDefaultScopeHash === "string" ? item.tenantDefaultScopeHash : null;
      if (
        usesTenantDefaultScope
          ? !tenantDefaultScopeGeneration ||
            tenantDefaultScopeGeneration < 1 ||
            !tenantDefaultScopeHash ||
            !/^[a-f0-9]{64}$/u.test(tenantDefaultScopeHash)
          : tenantDefaultScopeGeneration !== null || tenantDefaultScopeHash !== null
      ) {
        return null;
      }
      return {
        itemType: item.itemType,
        itemId: item.itemId,
        itemVersionHash: item.itemVersionHash,
        scope: item.scope ?? null,
        ...(usesTenantDefaultScope
          ? {
              usesTenantDefaultScope: true as const,
              tenantDefaultScopeGeneration,
              tenantDefaultScopeHash,
            }
          : {}),
        authorizationFingerprint: item.authorizationFingerprint,
      };
    });
    return (
      items.every((item) => item !== null) &&
      canonicalKnowledgeV2Hash(
        items
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort((left, right) =>
            compareKnowledgeCanonicalText(
              `${left.itemType}:${left.itemId}`,
              `${right.itemType}:${right.itemId}`,
            ),
          ),
      ) === expectedHash
    );
  }

  private indexSnapshotServingEligible(publication: CutoverPublication) {
    const snapshot = publication.indexSnapshot;
    if (
      !snapshot ||
      snapshot.tenantId !== publication.tenantId ||
      snapshot.corpusKind !== "STRUCTURED_V2" ||
      snapshot.status !== "READY" ||
      !snapshot.verifiedAt ||
      !snapshot.indexSchema ||
      !snapshot.indexSchemaHash ||
      canonicalKnowledgeV2Hash(snapshot.indexSchema) !== snapshot.indexSchemaHash ||
      snapshot.authorizationManifestVersion !==
        KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION
    ) {
      return false;
    }
    const documentItems = publication.items.filter(
      (item) => item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision,
    );
    const documentManifestHash = canonicalKnowledgeV2Hash({
      version: 1,
      corpusKind: "STRUCTURED_V2",
      documents: documentItems
        .map((item) => ({
          revisionId: item.itemId,
          contentHash: item.itemVersionHash,
          authorizationFingerprint: item.authorizationFingerprint,
          scope: item.scope,
        }))
        .sort((left, right) => compareKnowledgeCanonicalText(left.revisionId, right.revisionId)),
      indexSchemaHash: snapshot.indexSchemaHash,
    });
    const expected = documentItems
      .flatMap((item) => item.v2DocumentRevision?.chunks ?? [])
      .sort((left, right) => compareKnowledgeCanonicalText(left.id, right.id));
    const observed = [...snapshot.v2Items].sort((left, right) =>
      compareKnowledgeCanonicalText(left.chunkId, right.chunkId),
    );
    if (
      documentManifestHash !== snapshot.manifestHash ||
      expected.length === 0 ||
      snapshot.expectedPointCount !== expected.length ||
      snapshot.observedPointCount !== expected.length ||
      observed.length !== expected.length ||
      expected.some(
        (chunk, index) =>
          chunk.deletedAt ||
          chunk.id !== observed[index]?.chunkId ||
          chunk.contentHash !== observed[index]?.contentHash ||
          chunk.contentHash !== observed[index]?.chunk.contentHash ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
            observed[index]?.vectorPointId ?? "",
          ) ||
          !/^[a-f0-9]{64}$/u.test(observed[index]?.pointFingerprint ?? ""),
      )
    ) {
      return false;
    }
    const expectedPayloadHash = canonicalKnowledgeV2Hash(
      expected.map((chunk) => ({ chunkId: chunk.id, contentHash: chunk.contentHash })),
    );
    const observedPayloadHash = canonicalKnowledgeV2Hash(
      observed.map((item) => ({ chunkId: item.chunkId, contentHash: item.contentHash })),
    );
    if (expectedPayloadHash !== observedPayloadHash) return false;

    const documentItemsByRevisionId = new Map(
      documentItems.flatMap((item) =>
        item.v2DocumentRevision ? [[item.v2DocumentRevision.id, item.v2DocumentRevision] as const] : [],
      ),
    );
    const parsedAuthorizationManifest = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot.authorizationManifest,
      snapshot.authorizationManifestHash,
    );
    if (
      !parsedAuthorizationManifest ||
      parsedAuthorizationManifest.tenantId !== publication.tenantId ||
      parsedAuthorizationManifest.snapshotId !== snapshot.id ||
      parsedAuthorizationManifest.snapshotManifestHash !== snapshot.manifestHash ||
      parsedAuthorizationManifest.indexSchemaHash !== snapshot.indexSchemaHash ||
      parsedAuthorizationManifest.expectedPointCount !== expected.length
    ) {
      return false;
    }
    try {
      const rebuiltAuthorizationManifest = buildKnowledgeV2SnapshotAuthorizationManifest({
        tenantId: publication.tenantId,
        snapshotId: snapshot.id,
        snapshotManifestHash: snapshot.manifestHash,
        indexSchemaHash: snapshot.indexSchemaHash,
        points: observed.map((item) => {
          const revision = documentItemsByRevisionId.get(item.chunk.revisionId);
          if (!revision) throw new Error("Snapshot revision is not part of the publication.");
          const source = revision.document.source;
          return {
            sourceId: source.id,
            sourceGeneration: source.generation,
            authorizationFingerprint: sourcePermissionFingerprint(source),
            permissionVersion: source.sourcePermissionVersion,
            chunkId: item.chunkId,
            documentId: revision.documentId,
            revisionId: revision.id,
            contentHash: item.contentHash,
            vectorPointId: item.vectorPointId,
            pointFingerprint: item.pointFingerprint,
          };
        }),
      });
      return (
        rebuiltAuthorizationManifest.hash === snapshot.authorizationManifestHash &&
        stableKnowledgeValue(rebuiltAuthorizationManifest.manifest) ===
          stableKnowledgeValue(parsedAuthorizationManifest)
      );
    } catch {
      return false;
    }
  }

  private async migrationBlockCounts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    migrationId: string,
  ) {
    const [reviewCount, conflictCount] = await Promise.all([
      tx.knowledgeV2ReviewItem.count({
        where: {
          tenantId,
          reviewKey: { startsWith: `legacy-migration:${migrationId}:` },
          status: { in: [...activeReviewStatuses] },
        },
      }),
      tx.knowledgeV2Conflict.count({
        where: {
          tenantId,
          conflictKey: { startsWith: `legacy-migration:${migrationId}:` },
          status: { in: [...activeConflictStatuses] },
        },
      }),
    ]);
    return { reviewCount, conflictCount };
  }

  private async markStale(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    migration: {
      id: string;
      generation: number;
      sourceManifestHash: string;
    },
    job: { id: string; attemptCount: number; startedAt: Date | null },
    runningAttemptId: string | null,
  ) {
    const completedAt = new Date();
    const attemptNumber = runningAttemptId ? job.attemptCount : job.attemptCount + 1;
    if (runningAttemptId) {
      await tx.knowledgeJobAttempt.update({
        where: { id: runningAttemptId },
        data: {
          status: "FAILED",
          errorCode: "LEGACY_SOURCE_MANIFEST_CHANGED",
          errorMessage: null,
          heartbeatAt: completedAt,
          completedAt,
        },
      });
    } else {
      await tx.knowledgeJobAttempt.create({
        data: {
          tenantId: context.tenantId,
          jobId: job.id,
          attempt: attemptNumber,
          status: "FAILED",
          workerId: `api:${context.userId}`,
          errorCode: "LEGACY_SOURCE_MANIFEST_CHANGED",
          errorMessage: null,
          heartbeatAt: completedAt,
          completedAt,
        },
      });
    }
    const [staleMigration, failedJob] = await Promise.all([
      tx.knowledgeV2LegacyMigration.update({
        where: { id: migration.id },
        data: { status: "STALE", completedAt },
      }),
      tx.knowledgeJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          attemptCount: attemptNumber,
          startedAt: job.startedAt ?? completedAt,
          errorCode: "LEGACY_SOURCE_MANIFEST_CHANGED",
          errorMessage: null,
          completedAt,
          heartbeatAt: completedAt,
        },
      }),
    ]);
    await this.audit(tx, context, "knowledge.v2.legacy_migration_stale", migration.id, {
      generation: migration.generation,
      sourceManifestHash: migration.sourceManifestHash,
      errorCode: "LEGACY_SOURCE_MANIFEST_CHANGED",
    });
    return { migration: staleMigration, job: failedJob };
  }

  private async currentManifest(tx: Prisma.TransactionClient, tenantId: string) {
    const sources = await tx.businessKnowledgeSource.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ status: "ACTIVE" }, { sourceKey: observableSourceKey }],
      },
      orderBy: { id: "asc" },
    });
    const observableSnapshot = await this.currentObservableSnapshot(tx, tenantId);
    return sources
      .filter((source) => !isOnboardingCompatibilitySource(source))
      .map((source) => ({
        sourceId: source.id,
        sourceVersion: source.version,
        snapshotHash: this.legacySnapshotHash(
          source.sourceKey === observableSourceKey ? { ...source, ...observableSnapshot } : source,
        ),
      }));
  }

  private async syncObservableSource(tx: Prisma.TransactionClient, tenantId: string) {
    const snapshot = await this.currentObservableSnapshot(tx, tenantId);
    const existing = await tx.businessKnowledgeSource.findUnique({
      where: { tenantId_sourceKey: { tenantId, sourceKey: observableSourceKey } },
    });
    if (!existing) {
      return tx.businessKnowledgeSource.create({
        data: {
          tenantId,
          type: "BUSINESS_PROFILE",
          status: "DRAFT",
          source: "system",
          sourceKey: observableSourceKey,
          title: snapshot.title,
          content: snapshot.content,
          structuredData: snapshot.structuredData,
        },
      });
    }
    const unchanged =
      existing.deletedAt === null &&
      existing.status === "DRAFT" &&
      existing.title === snapshot.title &&
      existing.content === snapshot.content &&
      canonicalKnowledgeV2Hash(existing.structuredData ?? null) ===
        canonicalKnowledgeV2Hash(snapshot.structuredData);
    if (unchanged) return existing;
    return tx.businessKnowledgeSource.update({
      where: { id: existing.id },
      data: {
        type: "BUSINESS_PROFILE",
        status: "DRAFT",
        source: "system",
        title: snapshot.title,
        content: snapshot.content,
        structuredData: snapshot.structuredData,
        deletedAt: null,
        version: { increment: 1 },
      },
    });
  }

  private async currentObservableSnapshot(tx: Prisma.TransactionClient, tenantId: string) {
    const [tenant, onboarding] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      tx.onboardingState.findUnique({ where: { tenantId } }),
    ]);
    const onboardingData = record(onboarding?.data);
    const companyInfo = record(onboardingData.companyInfo);
    const onboardingName = text(companyInfo.name);
    const onboardingType = text(onboardingData.businessType);
    const content = [
      `Workspace business name: ${tenant.name}`,
      tenant.businessType ? `Workspace business type: ${tenant.businessType}` : "",
      onboardingName ? `Onboarding business name: ${onboardingName}` : "",
      onboardingType ? `Onboarding business type: ${onboardingType}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      title: "Current workspace settings snapshot",
      content,
      structuredData: {
        schemaVersion: 1,
        tenant: {
          businessName: tenant.name,
          businessType: tenant.businessType,
          timezone: tenant.timezone,
          settingsHash: canonicalKnowledgeV2Hash(tenant.settings ?? null),
        },
        onboarding: {
          businessName: onboardingName,
          businessType: onboardingType,
          stateHash: canonicalKnowledgeV2Hash(onboarding?.data ?? null),
        },
      } satisfies Prisma.InputJsonObject,
    };
  }

  private legacySnapshotHash(source: {
    id: string;
    type: string;
    status: string;
    source: string;
    sourceKey: string;
    title: string;
    content: string;
    structuredData: Prisma.JsonValue | null;
    version: number;
  }) {
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      legacySourceId: source.id,
      legacySourceVersion: source.version,
      type: source.type,
      status: source.status,
      source: source.source,
      sourceKey: source.sourceKey,
      title: source.title,
      content: source.content,
      structuredData: source.structuredData,
    });
  }

  private parseManifest(value: Prisma.JsonValue): LegacyManifestItem[] {
    if (!Array.isArray(value)) throw this.invalidManifest();
    const items = value.map((item) => {
      const row = record(item);
      if (
        typeof row.sourceId !== "string" ||
        !row.sourceId ||
        typeof row.sourceVersion !== "number" ||
        !Number.isInteger(row.sourceVersion) ||
        row.sourceVersion <= 0 ||
        typeof row.snapshotHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(row.snapshotHash)
      ) {
        throw this.invalidManifest();
      }
      return {
        sourceId: row.sourceId,
        sourceVersion: row.sourceVersion,
        snapshotHash: row.snapshotHash,
      };
    });
    if (
      new Set(items.map((item) => item.sourceId)).size !== items.length ||
      items.some((item, index) => index > 0 && items[index - 1]!.sourceId >= item.sourceId)
    ) {
      throw this.invalidManifest();
    }
    return items;
  }

  private migrationView(
    migration: {
      id: string;
      generation: number;
      status: string;
      sourceManifestHash: string;
      expectedSourceCount: number;
      migratedSourceCount: number;
      reviewCount: number;
      conflictCount: number;
      jobId: string;
      completedAt: Date | null;
      cutoverAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    job: { status: string },
  ): KnowledgeV2LegacyMigrationView {
    return {
      id: migration.id,
      generation: migration.generation,
      status: migrationStatus(migration.status),
      sourceManifestHash: migration.sourceManifestHash,
      expectedSourceCount: migration.expectedSourceCount,
      migratedSourceCount: migration.migratedSourceCount,
      reviewCount: migration.reviewCount,
      conflictCount: migration.conflictCount,
      jobId: migration.jobId,
      jobStatus: job.status as KnowledgeV2LegacyMigrationView["jobStatus"],
      etag: strongKnowledgeV2Etag(
        "legacy-migration",
        migration.id,
        `${migration.generation}:${migration.status}:${migration.migratedSourceCount}`,
      ),
      completedAt: migration.completedAt?.toISOString() ?? null,
      cutoverAt: migration.cutoverAt?.toISOString() ?? null,
      createdAt: migration.createdAt.toISOString(),
      updatedAt: migration.updatedAt.toISOString(),
    };
  }

  private selectorView(selector: {
    tenantId: string;
    corpusKind: "LEGACY_V1" | "STRUCTURED_V2";
    generation: number;
    migrationId: string | null;
    selectedAt: Date;
    selectedByUserId: string | null;
  }): KnowledgeCorpusSelectorView {
    return {
      corpusKind: selector.corpusKind,
      generation: selector.generation,
      migrationId: selector.migrationId,
      selectedAt: selector.selectedAt.toISOString(),
      selectedByUserId: selector.selectedByUserId,
      etag: strongKnowledgeV2Etag("corpus-selector", selector.tenantId, selector.generation),
    };
  }

  private async job(tx: Prisma.TransactionClient, tenantId: string, jobId: string) {
    const job = await tx.knowledgeJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_LEGACY_MIGRATION_JOB_MISSING",
        "The legacy migration job could not be read safely.",
      );
    }
    return job;
  }

  private async lockMigration(tx: Prisma.TransactionClient, tenantId: string, migrationId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2LegacyMigration"
      WHERE "tenantId" = ${tenantId} AND "id" = ${migrationId}
      FOR UPDATE
    `);
  }

  private assertOwner(context: RequestContext) {
    if (context.role === "OWNER" || context.role === "ADMIN") return;
    throw knowledgeV2Error(
      HttpStatus.FORBIDDEN,
      "KNOWLEDGE_PERMISSION_LEGACY_MIGRATION_DENIED",
      "Only an owner or administrator can migrate legacy knowledge.",
    );
  }

  private invalidManifest() {
    return knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_LEGACY_MIGRATION_MANIFEST_INVALID",
      "The legacy migration manifest could not be read safely.",
    );
  }

  private notFound() {
    return knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_SOURCE_LEGACY_MIGRATION_NOT_FOUND",
      "The legacy migration was not found.",
    );
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
        entityType: "KnowledgeV2LegacyMigration",
        entityId,
        payload,
      },
    });
  }
}
