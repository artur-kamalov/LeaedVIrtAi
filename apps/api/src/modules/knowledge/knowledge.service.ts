import { randomUUID } from "node:crypto";
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  BusinessKnowledgeSource,
  KnowledgeV2DiagnosticSearchView,
  KnowledgeV2SecurityClassification,
} from "@leadvirt/types";
import type {
  BusinessKnowledgeSource as PrismaBusinessKnowledgeSource,
  BusinessKnowledgeSourceType as PrismaBusinessKnowledgeSourceType,
  Prisma,
} from "@leadvirt/db";
import {
  type KnowledgeCapturedTarget,
  type KnowledgeRuntimeAuthorizationContext,
  type KnowledgeRuntimeRetrievalResult,
  type KnowledgeRuntimeRetriever,
  type KnowledgeV2TraceDraft,
  LegacyKnowledgeCorpusInactiveError,
  stableKnowledgeValue,
} from "@leadvirt/knowledge";
import { AppConfigService } from "../../config/app-config.service.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { CreateKnowledgeSourceDto } from "./dto/create-knowledge-source.dto.js";
import type { UpdateKnowledgeSourceDto } from "./dto/update-knowledge-source.dto.js";
import { KnowledgePublicationDispatcherService } from "./knowledge-publication-dispatcher.service.js";
import { KnowledgeV2ContentReconciliationService } from "./knowledge-v2-content-reconciliation.service.js";
import { knowledgeV2Error } from "./knowledge-v2-http.js";
import { KnowledgeV2OnboardingProjectionService } from "./knowledge-v2-onboarding-projection.service.js";
import { lockKnowledgeV2CorpusTransition } from "./knowledge-v2-transition-lock.js";
import { KNOWLEDGE_V2_RUNTIME_RETRIEVER } from "./knowledge.tokens.js";
import { onboardingKnowledgeInput } from "./onboarding-knowledge-input.js";
import { isOnboardingCompatibilitySource } from "./onboarding-knowledge-source-identity.js";

type KnowledgeSourceRow = PrismaBusinessKnowledgeSource;
type DiagnosticRetrievalResult = Extract<
  KnowledgeRuntimeRetrievalResult,
  { status: "grounded" | "insufficient_grounding" }
>;
type ActiveDiagnosticPublication = {
  publicationId: string;
  sequence: number;
  publication: {
    id: string;
    targetKey: string;
    corpusKind: string;
    sequence: number;
    status: string;
    indexSnapshotId: string | null;
  };
};

type OnboardingKnowledgeSpec = {
  type: PrismaBusinessKnowledgeSourceType;
  sourceKey: string;
  title: string;
  content: string;
  structuredData: Prisma.InputJsonObject;
};

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(KNOWLEDGE_V2_RUNTIME_RETRIEVER)
    private readonly runtime: KnowledgeRuntimeRetriever,
    @Inject(KnowledgePublicationDispatcherService)
    private readonly dispatcher: KnowledgePublicationDispatcherService,
    @Inject(KnowledgeV2OnboardingProjectionService)
    private readonly onboardingProjection: KnowledgeV2OnboardingProjectionService,
    @Inject(KnowledgeV2ContentReconciliationService)
    private readonly contentReconciliation: KnowledgeV2ContentReconciliationService,
  ) {}

  async list(context: RequestContext): Promise<BusinessKnowledgeSource[]> {
    const rows = await this.prisma.businessKnowledgeSource.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map((row) => this.mapSource(row));
  }

  async create(
    context: RequestContext,
    dto: CreateKnowledgeSourceDto,
  ): Promise<BusinessKnowledgeSource> {
    const { source, eventId } = await this.prisma.$transaction(async (tx) => {
      await this.assertLegacyCorpusWritable(tx, context.tenantId);
      const created = await tx.businessKnowledgeSource.create({
        data: {
          tenantId: context.tenantId,
          type: dto.type,
          source: "manual",
          sourceKey: `manual:${randomUUID()}`,
          title: dto.title.trim(),
          content: dto.content.trim(),
          ...(dto.structuredData
            ? { structuredData: dto.structuredData as Prisma.InputJsonObject }
            : {}),
        },
      });
      await this.audit(tx, context, "knowledge.source_created", created.id, {
        type: created.type,
        title: created.title,
      });
      const event = await this.dispatcher.createEvent(tx, {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        reason: "source_created",
        stateParts: [created.id, created.version],
      });
      return { source: created, eventId: event.id };
    });
    await this.dispatchRequired(eventId);
    return this.mapSource(source);
  }

  async update(
    context: RequestContext,
    id: string,
    dto: UpdateKnowledgeSourceDto,
  ): Promise<BusinessKnowledgeSource> {
    const { source, eventId } = await this.prisma.$transaction(async (tx) => {
      await this.assertPublicLegacySourceMutable(tx, context.tenantId, id);
      const hasMaterialChange =
        dto.type !== undefined ||
        dto.title !== undefined ||
        dto.content !== undefined ||
        dto.structuredData !== undefined;
      const updated = await tx.businessKnowledgeSource.update({
        where: { id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.status !== undefined
            ? {
                status: dto.status,
                deletedAt: dto.status === "ARCHIVED" ? new Date() : null,
              }
            : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
          ...(dto.structuredData !== undefined
            ? { structuredData: dto.structuredData as Prisma.InputJsonObject }
            : {}),
          ...(hasMaterialChange ? { version: { increment: 1 } } : {}),
        },
      });
      await this.audit(tx, context, "knowledge.source_updated", updated.id, {
        type: updated.type,
        status: updated.status,
        version: updated.version,
      });
      const event = await this.dispatcher.createEvent(tx, {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        reason: "source_updated",
        stateParts: [updated.id, updated.version, updated.status],
      });
      return { source: updated, eventId: event.id };
    });
    await this.dispatchRequired(eventId);
    return this.mapSource(source);
  }

  async archive(context: RequestContext, id: string) {
    const { source, eventId } = await this.prisma.$transaction(async (tx) => {
      await this.assertPublicLegacySourceMutable(tx, context.tenantId, id);
      const archived = await tx.businessKnowledgeSource.update({
        where: { id },
        data: { status: "ARCHIVED", deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit(tx, context, "knowledge.source_archived", archived.id, {
        type: archived.type,
        version: archived.version,
      });
      const event = await this.dispatcher.createEvent(tx, {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        reason: "source_archived",
        stateParts: [archived.id, archived.version, archived.status],
      });
      return { source: archived, eventId: event.id };
    });
    await this.dispatchRequired(eventId);
    return { id: source.id, archived: true };
  }

  async reindex(context: RequestContext) {
    const { state, event } = await this.prisma.$transaction(async (tx) => {
      await this.assertLegacyCorpusWritable(tx, context.tenantId);
      const state = await tx.businessKnowledgeSource.findMany({
        where: { tenantId: context.tenantId, status: "ACTIVE", deletedAt: null },
        select: { id: true, version: true },
        orderBy: { id: "asc" },
      });
      const event = await this.dispatcher.createEvent(tx, {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        reason: "compatibility_reindex",
        stateParts: state.flatMap((source) => [source.id, source.version]),
      });
      return { state, event };
    });
    await this.dispatchRequired(event.id);

    const active = await this.prisma.activeKnowledgePublication.findUnique({
      where: { tenantId_targetKey: { tenantId: context.tenantId, targetKey: "workspace" } },
      include: { publication: { include: { indexSnapshot: true } } },
    });
    const snapshot = active?.publication.indexSnapshot;
    const chunks = snapshot
      ? await this.prisma.knowledgeIndexSnapshotItem.count({
          where: { tenantId: context.tenantId, snapshotId: snapshot.id },
        })
      : 0;
    return {
      sources: state.length,
      chunks,
      indexed: this.config.ragRetrievalMode === "qdrant" ? (snapshot?.observedPointCount ?? 0) : 0,
      qdrant: this.config.ragRetrievalMode === "qdrant",
      publicationId: active?.publicationId ?? null,
      indexSnapshotId: snapshot?.id ?? null,
      sequence: active?.sequence ?? null,
    };
  }

  async search(
    context: RequestContext,
    query: string,
    limit: number,
  ): Promise<KnowledgeV2DiagnosticSearchView> {
    const responseLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const authorization = this.diagnosticAuthorization(context);
    const active = await this.prisma.activeKnowledgePublication.findUnique({
      where: {
        tenantId_targetKey: { tenantId: context.tenantId, targetKey: "workspace-v2" },
      },
      select: {
        publicationId: true,
        sequence: true,
        publication: {
          select: {
            id: true,
            targetKey: true,
            corpusKind: true,
            sequence: true,
            status: true,
            indexSnapshotId: true,
          },
        },
      },
    });
    if (
      !active ||
      active.publicationId !== active.publication.id ||
      active.sequence !== active.publication.sequence ||
      active.publication.targetKey !== "workspace-v2" ||
      active.publication.corpusKind !== "STRUCTURED_V2" ||
      active.publication.status !== "ACTIVE"
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_UNAVAILABLE",
        "Structured knowledge is not ready for diagnostics.",
        {
          retryable: true,
          details: { reason: "ACTIVE_PUBLICATION_UNAVAILABLE" },
        },
      );
    }

    let traceDraft: KnowledgeV2TraceDraft | undefined;
    try {
      const result = await this.runtime.retrieve({
        tenantId: context.tenantId,
        targetKey: "workspace-v2",
        publicationId: active.publicationId,
        query,
        limit: responseLimit,
        authorization,
        graphVersion: "knowledge-api-diagnostics-v1",
      });
      traceDraft = result.traceDraft;
      if (result.status === "unavailable") {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_RETRIEVAL_UNAVAILABLE",
          "Knowledge diagnostics are temporarily unavailable.",
          {
            retryable: result.retryable,
            details: { reason: result.reason },
          },
        );
      }
      if (
        !this.diagnosticTargetMatches(result.bundle.target, active) ||
        result.bundle.corpusKind !== "STRUCTURED_V2" ||
        result.diagnostics.corpusKind !== "STRUCTURED_V2" ||
        result.diagnostics.backend !== "qdrant" ||
        result.bundle.documents.some((item) => item.kind !== "DOCUMENT")
      ) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_DIAGNOSTIC_TARGET_CHANGED",
          "The active knowledge changed during diagnostics.",
          { retryable: true },
        );
      }
      const revalidation = await this.runtime.revalidateEvidence({
        tenantId: context.tenantId,
        query,
        bundle: result.bundle,
        authorization,
      });
      if (!revalidation.valid) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_DIAGNOSTIC_EVIDENCE_CHANGED",
          "The diagnostic evidence changed before it could be returned.",
          {
            retryable: true,
            details: { reason: revalidation.reason },
          },
        );
      }
      return this.mapDiagnosticSearch(result, authorization, responseLimit);
    } finally {
      if (traceDraft) await this.runtime.cleanupTraceArtifacts({ draft: traceDraft });
    }
  }

  private diagnosticAuthorization(context: RequestContext): KnowledgeRuntimeAuthorizationContext {
    if (!["OWNER", "ADMIN", "MANAGER", "AGENT"].includes(context.role)) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_DIAGNOSTIC_DENIED",
        "You do not have permission to run knowledge diagnostics.",
      );
    }
    const privileged = context.role === "OWNER" || context.role === "ADMIN";
    const classifications: KnowledgeV2SecurityClassification[] = privileged
      ? ["PUBLIC", "INTERNAL", "SENSITIVE"]
      : ["PUBLIC"];
    return {
      locale: this.diagnosticLocale(context.user.locale),
      channelType: "DEMO",
      audience: privileged ? "INTERNAL" : "PUBLIC",
      classifications,
      queryClassification: "SECRET",
    };
  }

  private diagnosticLocale(value: string | null | undefined) {
    try {
      return Intl.getCanonicalLocales(value ?? "en")[0] ?? "en";
    } catch {
      return "en";
    }
  }

  private diagnosticTargetMatches(
    target: KnowledgeCapturedTarget,
    active: ActiveDiagnosticPublication,
  ) {
    return (
      target.corpusKind === "STRUCTURED_V2" &&
      target.snapshotKind === "PUBLICATION" &&
      target.targetKey === "workspace-v2" &&
      target.publicationId === active.publicationId &&
      target.publicationSequence === active.sequence &&
      target.indexSnapshotId === active.publication.indexSnapshotId
    );
  }

  private mapDiagnosticSearch(
    result: DiagnosticRetrievalResult,
    authorization: KnowledgeRuntimeAuthorizationContext,
    responseLimit: number,
  ): KnowledgeV2DiagnosticSearchView {
    const target = result.bundle.target;
    if (target.snapshotKind !== "PUBLICATION" || target.corpusKind !== "STRUCTURED_V2") {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_DIAGNOSTIC_TARGET_CHANGED",
        "The active knowledge changed during diagnostics.",
        { retryable: true },
      );
    }
    const facts = result.bundle.facts.slice(0, responseLimit).map((item) => {
      const text = this.diagnosticText(item.value, 2_000);
      return {
        factId: item.factId,
        safeLabel: item.safeLabel,
        safeValue: text.value,
        truncated: text.truncated,
        riskLevel: item.riskLevel,
        score: item.score,
        observedAt: item.observedAt ?? null,
        expiresAt: item.expiresAt ?? null,
      };
    });
    const guidance = result.bundle.guidance.slice(0, responseLimit).map((item) => {
      const text = this.diagnosticText(item.instruction, 2_000);
      return {
        guidanceRuleId: item.guidanceRuleId,
        safeLabel: item.safeLabel,
        safeSummary: text.value,
        truncated: text.truncated,
        riskLevel: item.riskLevel,
        priority: item.priority,
        score: item.score,
      };
    });
    const documents = result.bundle.documents.slice(0, responseLimit).flatMap((item) => {
      if (item.kind !== "DOCUMENT") return [];
      const text = this.diagnosticText(item.content, 4_000);
      return [
        {
          documentId: item.documentId,
          revisionId: item.revisionId,
          chunkId: item.chunkId,
          sourceId: item.sourceId,
          sourceKind: item.sourceKind,
          safeLabel: item.title,
          safeExcerpt: text.value,
          truncated: text.truncated,
          classification: item.classification,
          locale: item.locale,
          confidence: item.rerankScore,
          anchor: {
            headingPath: item.headingPath,
            pageNumber: item.pageNumber ?? null,
            urlAnchor: item.urlAnchor ?? null,
            publicUrl: item.publicUrl ?? null,
          },
        },
      ];
    });
    const conflicts = result.bundle.conflicts.slice(0, responseLimit).map((item) => ({
      conflictId: item.conflictId,
      safeLabel: item.safeLabel,
      riskLevel: item.riskLevel,
      status: item.status,
    }));
    return {
      schemaVersion: 1,
      status: result.status,
      reason: result.status === "insufficient_grounding" ? result.reason : null,
      context: {
        locale: authorization.locale,
        channelType: "DEMO",
        audience: authorization.audience,
        classifications: [...authorization.classifications],
        queryClassification: "SECRET",
      },
      target: {
        corpusKind: "STRUCTURED_V2",
        targetKey: "workspace-v2",
        publicationId: target.publicationId,
        publicationSequence: target.publicationSequence,
        indexSnapshotId: target.indexSnapshotId,
        retrievalPolicyVersion: target.retrievalPolicyVersion,
        pipelineVersion: target.pipelineVersion,
      },
      outcome: result.bundle.outcome,
      gateOutcome: result.bundle.gateOutcome,
      gateReasons: result.bundle.gateReasons,
      facts,
      guidance,
      documents,
      conflicts,
      missingSupport: result.bundle.missingSupport,
      suppressedEvidence: result.bundle.suppressedEvidence,
      diagnostics: {
        backend: "qdrant",
        candidateCount: result.diagnostics.candidateCount,
        hydratedCount: result.diagnostics.hydratedCount,
        selectedCount: result.diagnostics.selectedCount,
        durationMs: result.diagnostics.durationMs,
        degradedReason: result.diagnostics.degradedReason ?? null,
        retrievalPolicyVersion: result.diagnostics.retrievalPolicyVersion ?? null,
        rerankerVersion: result.diagnostics.rerankerVersion ?? null,
        responseLimit,
        returnedCounts: {
          facts: facts.length,
          guidance: guidance.length,
          documents: documents.length,
          conflicts: conflicts.length,
        },
      },
    };
  }

  private diagnosticText(value: string, maximum: number) {
    return value.length <= maximum
      ? { value, truncated: false }
      : { value: value.slice(0, maximum), truncated: true };
  }

  async syncOnboardingSources(context: RequestContext, data: Record<string, unknown>) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
      const current = await tx.onboardingState.findUnique({
        where: { tenantId: context.tenantId },
      });
      const previousData = this.jsonRecord(current?.data);
      return this.syncOnboardingSourcesInTransaction(tx, context, previousData, data);
    });
    await this.dispatchOnboardingSync(result.eventId, result.reconciliationEventIds);
    return result.touched;
  }

  async syncOnboardingSourcesInTransaction(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    previousData: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    const specs = this.buildOnboardingSources(data);
    const changed: Array<{ id: string; version: number; status: string }> = [];

    for (const spec of specs) {
      const content = spec.content.trim();
      const existing = await tx.businessKnowledgeSource.findUnique({
        where: { tenantId_sourceKey: { tenantId: context.tenantId, sourceKey: spec.sourceKey } },
      });
      if (!content) {
        if (existing && existing.deletedAt === null) {
          const archived = await tx.businessKnowledgeSource.update({
            where: { id: existing.id },
            data: { status: "ARCHIVED", deletedAt: new Date(), version: { increment: 1 } },
          });
          changed.push({ id: archived.id, version: archived.version, status: archived.status });
        }
        continue;
      }

      const unchanged =
        existing?.status === "ACTIVE" &&
        existing.deletedAt === null &&
        existing.type === spec.type &&
        existing.title === spec.title &&
        existing.content === content &&
        stableKnowledgeValue(existing.structuredData) === stableKnowledgeValue(spec.structuredData);
      if (unchanged) continue;

      const source = existing
        ? await tx.businessKnowledgeSource.update({
            where: { id: existing.id },
            data: {
              type: spec.type,
              status: "ACTIVE",
              title: spec.title,
              content,
              structuredData: spec.structuredData,
              version: { increment: 1 },
              deletedAt: null,
            },
          })
        : await tx.businessKnowledgeSource.create({
            data: {
              tenantId: context.tenantId,
              type: spec.type,
              status: "ACTIVE",
              source: "onboarding",
              sourceKey: spec.sourceKey,
              title: spec.title,
              content,
              structuredData: spec.structuredData,
            },
          });
      changed.push({ id: source.id, version: source.version, status: source.status });
    }

    if (changed.length > 0) {
      await this.audit(tx, context, "knowledge.onboarding_synced", context.tenantId, {
        sourceIds: changed.map((source) => source.id),
        count: changed.length,
      });
    }
    const projection = await this.onboardingProjection.projectInTransaction(
      tx,
      context,
      previousData,
      data,
    );
    let eventId: string | null = null;
    if (!projection.structured && changed.length > 0) {
      const currentSources = await tx.businessKnowledgeSource.findMany({
        where: { tenantId: context.tenantId, status: "ACTIVE", deletedAt: null },
        select: { id: true, version: true, status: true },
        orderBy: { id: "asc" },
      });
      const event = await this.dispatcher.createEvent(tx, {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        reason: "onboarding_synced",
        stateParts: currentSources.flatMap((source) => [source.id, source.version, source.status]),
      });
      eventId = event.id;
    }
    return {
      touched: changed.length,
      eventId,
      reconciliationEventIds: projection.eventIds,
    };
  }

  async dispatchOnboardingSync(eventId: string | null, reconciliationEventIds: string[] = []) {
    await Promise.all([
      ...(eventId ? [this.dispatchRequired(eventId)] : []),
      ...reconciliationEventIds.map((id) => this.contentReconciliation.dispatch(id)),
    ]);
  }

  private async dispatchRequired(eventId: string) {
    try {
      const result = await this.dispatcher.dispatch(eventId);
      if (!result) throw new Error("Knowledge publication is not ready.");
      return result;
    } catch (error) {
      if (error instanceof LegacyKnowledgeCorpusInactiveError) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
          "Legacy knowledge sources are read-only after structured corpus cutover.",
        );
      }
      throw new ServiceUnavailableException({
        code: "KNOWLEDGE_PUBLICATION_PENDING",
        message: "The information was saved, but the knowledge update is still processing.",
        retryable: true,
      });
    }
  }

  private async assertLegacyCorpusWritable(tx: Prisma.TransactionClient, tenantId: string) {
    await lockKnowledgeV2CorpusTransition(tx, tenantId);
    const selector = await tx.knowledgeCorpusSelector.findUnique({
      where: { tenantId },
      select: { corpusKind: true },
    });
    if (selector?.corpusKind === "STRUCTURED_V2") {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
        "Legacy knowledge sources are read-only after structured corpus cutover.",
      );
    }
  }

  private async assertPublicLegacySourceMutable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ) {
    await this.assertLegacyCorpusWritable(tx, tenantId);
    const source = await tx.businessKnowledgeSource.findFirst({
      where: { id, tenantId },
      select: { id: true, source: true, sourceKey: true, deletedAt: true },
    });
    if (!source || source.deletedAt) {
      throw new NotFoundException("Knowledge source was not found.");
    }
    if (isOnboardingCompatibilitySource(source)) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_ONBOARDING_SOURCE_MANAGED",
        "Onboarding knowledge must be changed through onboarding.",
      );
    }
  }

  private mapSource(row: KnowledgeSourceRow): BusinessKnowledgeSource {
    return {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type,
      status: row.status,
      source: row.source,
      sourceKey: row.sourceKey,
      title: row.title,
      content: row.content,
      structuredData: row.structuredData,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildOnboardingSources(data: Record<string, unknown>): OnboardingKnowledgeSpec[] {
    const {
      businessName,
      businessDescription,
      businessType,
      scenario,
      hours,
      averageCheck: avgCheck,
      servicesCatalog,
      availability,
      faq,
      policies,
      escalationRules,
    } = onboardingKnowledgeInput(data);
    const baseStructuredData = { source: "onboarding", businessType, scenario };

    return [
      {
        type: "BUSINESS_PROFILE",
        sourceKey: "onboarding:business_profile",
        title: "Business profile",
        content: this.lines([
          businessName ? `Business name: ${businessName}` : "",
          businessType ? `Business type: ${businessType}` : "",
          scenario ? `Primary AI scenario: ${scenario}` : "",
          businessDescription ? `Description: ${businessDescription}` : "",
          avgCheck ? `Average check: ${avgCheck}` : "",
        ]),
        structuredData: { ...baseStructuredData, businessName, businessDescription, avgCheck },
      },
      {
        type: "CATALOG",
        sourceKey: "onboarding:catalog",
        title: "Catalog and prices",
        content: servicesCatalog,
        structuredData: { ...baseStructuredData, servicesCatalog },
      },
      {
        type: "AVAILABILITY",
        sourceKey: "onboarding:availability",
        title: "Working hours and free windows",
        content: this.lines([hours ? `Working hours: ${hours}` : "", availability]),
        structuredData: { ...baseStructuredData, hours, availability },
      },
      {
        type: "FAQ",
        sourceKey: "onboarding:faq",
        title: "FAQ",
        content: faq,
        structuredData: { ...baseStructuredData, faq },
      },
      {
        type: "POLICY",
        sourceKey: "onboarding:policy",
        title: "Policies and constraints",
        content: policies,
        structuredData: { ...baseStructuredData, policies },
      },
      {
        type: "ESCALATION",
        sourceKey: "onboarding:escalation",
        title: "Escalation rules",
        content: escalationRules,
        structuredData: { ...baseStructuredData, escalationRules },
      },
    ];
  }

  private jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }

  private lines(values: string[]) {
    return values
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
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
        entityType: "business_knowledge_source",
        entityId,
        payload,
      },
    });
  }
}
