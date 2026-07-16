import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2EvidenceReferenceView,
  KnowledgeV2FeedbackView,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import type { KnowledgeV2CreateFeedbackDto } from "./dto/knowledge-v2-feedback.dto.js";
import { knowledgeV2Error } from "./knowledge-v2-http.js";
import {
  KnowledgeV2IdempotencyService,
  type KnowledgeV2IdempotencyResult,
} from "./knowledge-v2-idempotency.service.js";

const contributorRoles = ["OWNER", "ADMIN", "MANAGER", "AGENT"] as const;
const maximumRestrictedBytes = 32 * 1024;
const restrictedReferencePrefix = "lvobj:v1:";
const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const categoryRiskFloor = {
  INCORRECT_ANSWER: "MEDIUM",
  MISSING_ANSWER: "MEDIUM",
  WRONG_GUIDANCE: "MEDIUM",
  SHOULD_BE_UNANSWERABLE: "MEDIUM",
  SHOULD_HANDOFF: "MEDIUM",
  BAD_CITATION: "MEDIUM",
  STALE_INFORMATION: "MEDIUM",
  SECURITY_CONCERN: "CRITICAL",
  OTHER: "LOW",
} as const satisfies Record<KnowledgeV2CreateFeedbackDto["category"], KnowledgeV2RiskLevel>;

const actorInclude = {
  user: { select: { id: true } },
} satisfies Prisma.MembershipInclude;

const evidenceReferenceInclude = {
  documentRevision: {
    select: {
      sourceId: true,
      document: {
        select: {
          classification: true,
          status: true,
          tombstonedAt: true,
          deletedAt: true,
        },
      },
    },
  },
  factVersion: { select: { factId: true, riskLevel: true } },
  guidanceRuleVersion: { select: { guidanceRuleId: true, riskLevel: true } },
} satisfies Prisma.KnowledgeV2EvidenceReferenceInclude;

const feedbackInclude = {
  actor: { include: actorInclude },
  assignee: { include: actorInclude },
  resolvedBy: { include: actorInclude },
  evidenceLinks: {
    include: { evidenceReference: { include: evidenceReferenceInclude } },
    orderBy: [{ ordinal: "asc" as const }, { evidenceReferenceId: "asc" as const }],
  },
} satisfies Prisma.KnowledgeV2FeedbackInclude;

type FeedbackRecord = Prisma.KnowledgeV2FeedbackGetPayload<{ include: typeof feedbackInclude }>;
type EvidenceRecord = FeedbackRecord["evidenceLinks"][number]["evidenceReference"];

interface RestrictedReferencePayload {
  version: 1;
  key: string;
  encryptionKeyRef: string;
}

interface RestrictedTextInput {
  hash: string;
  value: string;
}

interface StoredRestrictedText {
  hash: string;
  reference: string;
  key: string;
  created: boolean;
}

interface ResolvedFeedbackReferences {
  responseMessageId: string | null;
  evaluationRunId: string | null;
  evaluationResultId: string | null;
  publicationId: string | null;
  retrievalTraceId: string | null;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function encodeRestrictedReference(input: { key: string; encryptionKeyRef: string }) {
  const payload: RestrictedReferencePayload = {
    version: 1,
    key: input.key,
    encryptionKeyRef: input.encryptionKeyRef,
  };
  return `${restrictedReferencePrefix}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function mutationResult<T>(result: KnowledgeV2IdempotencyResult<T>) {
  return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
}

@Injectable()
export class KnowledgeV2FeedbackService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async createFeedback(
    context: RequestContext,
    input: KnowledgeV2CreateFeedbackDto,
    idempotencyKey: string,
  ) {
    this.assertInputShape(input);
    await this.assertCurrentContributor(this.prisma, context);
    const note = input.note === undefined ? null : this.restrictedText(input.note, "note");
    const feedbackId = randomUUID();
    const feedbackKey = `tenant:${feedbackId}`;
    const preparation: { note: StoredRestrictedText | null } = { note: null };
    try {
      const result = await this.idempotency.executePrepared<
        KnowledgeV2FeedbackView,
        StoredRestrictedText | null
      >(
        {
          tenantId: context.tenantId,
          endpoint: "POST:/knowledge/v2/feedback",
          key: idempotencyKey,
          request: this.sanitizedRequest(input, note),
        },
        async () => {
          preparation.note = note
            ? await this.storeRestrictedNote(context.tenantId, idempotencyKey, note)
            : null;
          return preparation.note;
        },
        async (tx, storedNote) => {
          await this.assertCurrentContributor(tx, context);
          const references = await this.resolveReferences(tx, context.tenantId, input);
          const evidence = await this.resolveEvidence(tx, context.tenantId, references, input);
          await this.assertCorrectionTarget(tx, context.tenantId, references, input, evidence);

          const riskLevel = await this.feedbackRisk(tx, context.tenantId, references, input);
          const feedback = await tx.knowledgeV2Feedback.create({
            data: {
              id: feedbackId,
              tenantId: context.tenantId,
              corpusKind: "STRUCTURED_V2",
              feedbackKey,
              category: input.category,
              status: "OPEN",
              riskLevel,
              ...references,
              actorUserId: context.userId,
              noteHash: storedNote?.hash ?? null,
              restrictedNoteRef: storedNote?.reference ?? null,
              proposedAction: input.proposedAction ?? null,
              correctionTargetType: input.correctionTargetType ?? null,
              sourceId: input.sourceId ?? null,
              v2DocumentRevisionId: input.documentRevisionId ?? null,
              factId: input.factId ?? null,
              guidanceRuleId: input.guidanceRuleId ?? null,
              evidenceLinks: {
                create: evidence.map((item, ordinal) => ({
                  evidenceReferenceId: item.record.id,
                  ordinal,
                  relevanceScore: item.relevanceScore,
                })),
              },
            },
            include: feedbackInclude,
          });

          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.feedback.created",
              entityType: "knowledge_v2_feedback",
              entityId: feedback.id,
              payload: {
                feedbackKey: feedback.feedbackKey,
                category: feedback.category,
                riskLevel: feedback.riskLevel,
                responseMessageId: feedback.responseMessageId,
                evaluationRunId: feedback.evaluationRunId,
                evaluationResultId: feedback.evaluationResultId,
                publicationId: feedback.publicationId,
                retrievalTraceId: feedback.retrievalTraceId,
                noteHash: feedback.noteHash,
                proposedAction: feedback.proposedAction,
                correctionTargetType: feedback.correctionTargetType,
                sourceId: feedback.sourceId,
                documentRevisionId: feedback.v2DocumentRevisionId,
                factId: feedback.factId,
                guidanceRuleId: feedback.guidanceRuleId,
                evidenceReferenceIds: feedback.evidenceLinks.map(
                  (link) => link.evidenceReferenceId,
                ),
              },
            },
          });

          return {
            httpStatus: HttpStatus.CREATED,
            responseBody: this.feedbackView(feedback),
          };
        },
      );
      return mutationResult(result);
    } catch (error) {
      if (preparation.note?.created) {
        const committed = await this.prisma.knowledgeV2Feedback
          .findFirst({
            where: { tenantId: context.tenantId, feedbackKey },
            select: { id: true },
          })
          .catch(() => undefined);
        if (committed === null) {
          await this.deleteRestrictedNote(preparation.note).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private assertInputShape(input: KnowledgeV2CreateFeedbackDto) {
    const anchors = [
      input.responseMessageId,
      input.evaluationRunId,
      input.evaluationResultId,
      input.publicationId,
      input.retrievalTraceId,
    ].filter(Boolean);
    if (anchors.length === 0) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_FEEDBACK_TARGET_REQUIRED",
        "Choose the response or knowledge operation this feedback applies to.",
      );
    }
    if (input.evaluationResultId && !input.evaluationRunId && !input.retrievalTraceId) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_FEEDBACK_TARGET_INVALID",
        "The feedback references are incomplete.",
        { field: "evaluationRunId" },
      );
    }
    const targetIds = [
      input.sourceId,
      input.documentRevisionId,
      input.factId,
      input.guidanceRuleId,
    ].filter(Boolean);
    const target = input.correctionTargetType;
    const validTarget =
      (!target && targetIds.length === 0) ||
      (target === "SOURCE" && Boolean(input.sourceId) && targetIds.length === 1) ||
      (target === "DOCUMENT_REVISION" &&
        Boolean(input.documentRevisionId) &&
        targetIds.length === 1) ||
      (target === "FACT" && Boolean(input.factId) && targetIds.length === 1) ||
      (target === "GUIDANCE_RULE" && Boolean(input.guidanceRuleId) && targetIds.length === 1) ||
      ((target === "MARK_UNANSWERABLE" || target === "REQUIRE_HANDOFF") && targetIds.length === 0);
    if (!validTarget) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_FEEDBACK_CORRECTION_TARGET_INVALID",
        "Choose one valid correction target.",
        { field: "correctionTargetType" },
      );
    }
    if (
      (target === "MARK_UNANSWERABLE" || target === "REQUIRE_HANDOFF") &&
      input.proposedAction !== undefined &&
      input.proposedAction !== target
    ) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_FEEDBACK_ACTION_INVALID",
        "The proposed action does not match the correction target.",
        { field: "proposedAction" },
      );
    }
  }

  private async assertCurrentContributor(
    client: PrismaService | Prisma.TransactionClient,
    context: RequestContext,
  ) {
    const membership = await client.membership.findFirst({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
        role: { in: [...contributorRoles] },
        user: { deletedAt: null },
        tenant: { deletedAt: null, status: { in: ["TRIALING", "ACTIVE"] } },
      },
      select: { id: true },
    });
    if (!membership) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_FEEDBACK_DENIED",
        "Feedback is unavailable for this workspace member.",
      );
    }
  }

  private async resolveReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: KnowledgeV2CreateFeedbackDto,
  ): Promise<ResolvedFeedbackReferences> {
    const references: ResolvedFeedbackReferences = {
      responseMessageId: input.responseMessageId ?? null,
      evaluationRunId: input.evaluationRunId ?? null,
      evaluationResultId: input.evaluationResultId ?? null,
      publicationId: input.publicationId ?? null,
      retrievalTraceId: input.retrievalTraceId ?? null,
    };

    if (!references.retrievalTraceId && references.responseMessageId) {
      const matchingTraces = await tx.knowledgeV2RetrievalTrace.findMany({
        where: {
          tenantId,
          responseMessageId: references.responseMessageId,
          corpusKind: "STRUCTURED_V2",
        },
        select: { id: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2,
      });
      if (matchingTraces.length > 1) {
        throw knowledgeV2Error(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "KNOWLEDGE_VALIDATION_FEEDBACK_TRACE_REQUIRED",
          "Choose the exact retrieval trace for this response.",
          { field: "retrievalTraceId" },
        );
      }
      references.retrievalTraceId = matchingTraces[0]?.id ?? null;
    }

    if (references.retrievalTraceId) {
      const trace = await tx.knowledgeV2RetrievalTrace.findFirst({
        where: {
          tenantId,
          id: references.retrievalTraceId,
          corpusKind: "STRUCTURED_V2",
        },
        select: {
          responseMessageId: true,
          evaluationRunId: true,
          evaluationResultId: true,
          publicationId: true,
        },
      });
      if (!trace) this.referenceNotFound();
      this.mergeTraceReference(
        input.responseMessageId,
        trace.responseMessageId,
        "responseMessageId",
        references,
      );
      this.mergeTraceReference(
        input.evaluationRunId,
        trace.evaluationRunId,
        "evaluationRunId",
        references,
      );
      this.mergeTraceReference(
        input.evaluationResultId,
        trace.evaluationResultId,
        "evaluationResultId",
        references,
      );
      this.mergeTraceReference(
        input.publicationId,
        trace.publicationId,
        "publicationId",
        references,
      );
    }

    if (references.evaluationResultId) {
      const result = await tx.knowledgeV2EvaluationResult.findFirst({
        where: {
          tenantId,
          id: references.evaluationResultId,
          corpusKind: "STRUCTURED_V2",
        },
        select: { evaluationRunId: true },
      });
      if (!result) this.referenceNotFound();
      if (references.evaluationRunId && references.evaluationRunId !== result.evaluationRunId) {
        this.referenceMismatch();
      }
      references.evaluationRunId = result.evaluationRunId;
    }

    if (references.evaluationRunId) {
      const run = await tx.knowledgeV2EvaluationRun.findFirst({
        where: { tenantId, id: references.evaluationRunId, corpusKind: "STRUCTURED_V2" },
        select: { publicationId: true },
      });
      if (!run) this.referenceNotFound();
      if (input.publicationId !== undefined && input.publicationId !== run.publicationId) {
        this.referenceMismatch();
      }
      if (references.publicationId && run.publicationId !== references.publicationId) {
        this.referenceMismatch();
      }
      references.publicationId = run.publicationId;
    }

    if (references.responseMessageId) {
      const message = await tx.message.findFirst({
        where: { tenantId, id: references.responseMessageId },
        select: { direction: true, senderType: true },
      });
      if (!message) this.referenceNotFound();
      if (message.direction !== "OUTBOUND" || message.senderType !== "AI") {
        throw knowledgeV2Error(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "KNOWLEDGE_VALIDATION_FEEDBACK_RESPONSE_INVALID",
          "Feedback can only target an AI response.",
          { field: "responseMessageId" },
        );
      }
      if (!references.retrievalTraceId && this.nonMessageReferenceCount(references) > 0) {
        this.referenceMismatch();
      }
    }

    if (references.publicationId) {
      const publication = await tx.knowledgePublication.findFirst({
        where: { tenantId, id: references.publicationId, corpusKind: "STRUCTURED_V2" },
        select: { id: true },
      });
      if (!publication) this.referenceNotFound();
    }
    return references;
  }

  private mergeTraceReference(
    requested: string | undefined,
    traced: string | null,
    field: keyof Omit<ResolvedFeedbackReferences, "retrievalTraceId">,
    references: ResolvedFeedbackReferences,
  ) {
    if (requested !== undefined && requested !== traced) this.referenceMismatch();
    references[field] = traced;
  }

  private nonMessageReferenceCount(references: ResolvedFeedbackReferences) {
    return [
      references.evaluationRunId,
      references.evaluationResultId,
      references.publicationId,
    ].filter(Boolean).length;
  }

  private async resolveEvidence(
    tx: Prisma.TransactionClient,
    tenantId: string,
    references: ResolvedFeedbackReferences,
    input: KnowledgeV2CreateFeedbackDto,
  ) {
    const ids = input.evidenceReferenceIds ?? [];
    if (ids.length === 0) return [];
    const [citations, evaluationLinks, evidence] = await Promise.all([
      references.retrievalTraceId
        ? tx.knowledgeV2Citation.findMany({
            where: {
              tenantId,
              retrievalTraceId: references.retrievalTraceId,
              evidenceReferenceId: { in: ids },
              corpusKind: "STRUCTURED_V2",
            },
            select: { evidenceReferenceId: true, confidence: true },
          })
        : Promise.resolve([]),
      references.evaluationResultId
        ? tx.knowledgeV2EvaluationResultEvidence.findMany({
            where: {
              tenantId,
              evaluationResultId: references.evaluationResultId,
              evidenceReferenceId: { in: ids },
              corpusKind: "STRUCTURED_V2",
            },
            select: { evidenceReferenceId: true, relevanceScore: true },
          })
        : Promise.resolve([]),
      tx.knowledgeV2EvidenceReference.findMany({
        where: { tenantId, id: { in: ids }, corpusKind: "STRUCTURED_V2" },
        include: evidenceReferenceInclude,
      }),
    ]);
    const allowed = new Set([
      ...citations.map((item) => item.evidenceReferenceId),
      ...evaluationLinks.map((item) => item.evidenceReferenceId),
    ]);
    if (evidence.length !== ids.length || ids.some((id) => !allowed.has(id))) {
      this.referenceNotFound();
    }
    const evidenceById = new Map(evidence.map((record) => [record.id, record]));
    const scoreById = new Map<string, number | null>();
    for (const item of citations) scoreById.set(item.evidenceReferenceId, item.confidence);
    for (const item of evaluationLinks) {
      if (!scoreById.has(item.evidenceReferenceId)) {
        scoreById.set(item.evidenceReferenceId, item.relevanceScore);
      }
    }
    return ids.map((id) => ({
      record: evidenceById.get(id)!,
      relevanceScore: scoreById.get(id) ?? null,
    }));
  }

  private async assertCorrectionTarget(
    tx: Prisma.TransactionClient,
    tenantId: string,
    references: ResolvedFeedbackReferences,
    input: KnowledgeV2CreateFeedbackDto,
    evidence: Array<{ record: EvidenceRecord }>,
  ) {
    const target = input.correctionTargetType;
    if (!target || target === "MARK_UNANSWERABLE" || target === "REQUIRE_HANDOFF") return;

    let exists = false;
    let supportedByEvidence = false;
    let supportedByPublication = false;
    if (target === "SOURCE") {
      const sourceId = input.sourceId!;
      exists = Boolean(
        await tx.knowledgeV2Source.findFirst({
          where: { tenantId, id: sourceId },
          select: { id: true },
        }),
      );
      supportedByEvidence = evidence.some(
        (item) => item.record.documentRevision?.sourceId === sourceId,
      );
      supportedByPublication = await this.publicationContains(
        tx,
        tenantId,
        references.publicationId,
        {
          itemType: "SOURCE_PERMISSION_SNAPSHOT",
          itemId: sourceId,
        },
      );
    } else if (target === "DOCUMENT_REVISION") {
      const documentRevisionId = input.documentRevisionId!;
      exists = Boolean(
        await tx.knowledgeV2DocumentRevision.findFirst({
          where: { tenantId, id: documentRevisionId },
          select: { id: true },
        }),
      );
      supportedByEvidence = evidence.some(
        (item) => item.record.v2DocumentRevisionId === documentRevisionId,
      );
      supportedByPublication = await this.publicationContains(
        tx,
        tenantId,
        references.publicationId,
        {
          itemType: "DOCUMENT_REVISION",
          v2DocumentRevisionId: documentRevisionId,
        },
      );
    } else if (target === "FACT") {
      const factId = input.factId!;
      exists = Boolean(
        await tx.knowledgeV2Fact.findFirst({
          where: { tenantId, id: factId },
          select: { id: true },
        }),
      );
      supportedByEvidence = evidence.some((item) => item.record.factVersion?.factId === factId);
      supportedByPublication = await this.publicationContains(
        tx,
        tenantId,
        references.publicationId,
        {
          itemType: "FACT_VERSION",
          factVersion: { factId },
        },
      );
    } else {
      const guidanceRuleId = input.guidanceRuleId!;
      exists = Boolean(
        await tx.knowledgeV2GuidanceRule.findFirst({
          where: { tenantId, id: guidanceRuleId },
          select: { id: true },
        }),
      );
      supportedByEvidence = evidence.some(
        (item) => item.record.guidanceRuleVersion?.guidanceRuleId === guidanceRuleId,
      );
      supportedByPublication = await this.publicationContains(
        tx,
        tenantId,
        references.publicationId,
        {
          itemType: "GUIDANCE_RULE_VERSION",
          guidanceRuleVersion: { guidanceRuleId },
        },
      );
    }
    if (!exists) this.referenceNotFound();
    if (!supportedByEvidence && !supportedByPublication) this.referenceMismatch();
  }

  private async publicationContains(
    tx: Prisma.TransactionClient,
    tenantId: string,
    publicationId: string | null,
    where: Prisma.KnowledgePublicationItemWhereInput,
  ) {
    if (!publicationId) return false;
    return Boolean(
      await tx.knowledgePublicationItem.findFirst({
        where: {
          tenantId,
          publicationId,
          corpusKind: "STRUCTURED_V2",
          ...where,
        },
        select: { itemId: true },
      }),
    );
  }

  private async feedbackRisk(
    tx: Prisma.TransactionClient,
    tenantId: string,
    references: ResolvedFeedbackReferences,
    input: KnowledgeV2CreateFeedbackDto,
  ): Promise<KnowledgeV2RiskLevel> {
    const factId = input.correctionTargetType === "FACT" ? (input.factId ?? null) : null;
    const guidanceRuleId =
      input.correctionTargetType === "GUIDANCE_RULE" ? (input.guidanceRuleId ?? null) : null;
    const documentRevisionId =
      input.correctionTargetType === "DOCUMENT_REVISION"
        ? (input.documentRevisionId ?? null)
        : null;
    const rows = await tx.$queryRaw<Array<{ riskFloor: number }>>(Prisma.sql`
      SELECT COALESCE(MAX(context_risk."riskFloor"), 0)::int AS "riskFloor"
      FROM (
        SELECT GREATEST(
          CASE evidence_fact."riskLevel"::text
            WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 1 ELSE 0 END,
          CASE evidence_guidance."riskLevel"::text
            WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 1 ELSE 0 END,
          CASE evidence_document."classification"::text
            WHEN 'SECRET' THEN 3 WHEN 'SENSITIVE' THEN 2 WHEN 'CUSTOMER_PERSONAL' THEN 2 ELSE 0 END
        ) AS "riskFloor"
        FROM "KnowledgeV2EvidenceReference" AS evidence
        LEFT JOIN "KnowledgeV2FactVersion" AS evidence_fact
          ON evidence_fact."tenantId" = evidence."tenantId"
          AND evidence_fact."id" = evidence."factVersionId"
        LEFT JOIN "KnowledgeV2GuidanceRuleVersion" AS evidence_guidance
          ON evidence_guidance."tenantId" = evidence."tenantId"
          AND evidence_guidance."id" = evidence."guidanceRuleVersionId"
        LEFT JOIN "KnowledgeV2DocumentRevision" AS evidence_revision
          ON evidence_revision."tenantId" = evidence."tenantId"
          AND evidence_revision."id" = evidence."v2DocumentRevisionId"
        LEFT JOIN "KnowledgeV2Document" AS evidence_document
          ON evidence_document."tenantId" = evidence_revision."tenantId"
          AND evidence_document."id" = evidence_revision."documentId"
        WHERE evidence."tenantId" = ${tenantId}
          AND evidence."corpusKind" = 'STRUCTURED_V2'
          AND (
            (
              ${references.retrievalTraceId}::text IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM "KnowledgeV2Citation" AS citation
                WHERE citation."tenantId" = evidence."tenantId"
                  AND citation."retrievalTraceId" = ${references.retrievalTraceId}
                  AND citation."evidenceReferenceId" = evidence."id"
              )
            )
            OR (
              ${references.evaluationResultId}::text IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM "KnowledgeV2EvaluationResultEvidence" AS evaluation_evidence
                WHERE evaluation_evidence."tenantId" = evidence."tenantId"
                  AND evaluation_evidence."evaluationResultId" = ${references.evaluationResultId}
                  AND evaluation_evidence."evidenceReferenceId" = evidence."id"
              )
            )
          )

        UNION ALL

        SELECT GREATEST(
          CASE publication_fact."riskLevel"::text
            WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 1 ELSE 0 END,
          CASE publication_guidance."riskLevel"::text
            WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 1 ELSE 0 END,
          CASE publication_document."classification"::text
            WHEN 'SECRET' THEN 3 WHEN 'SENSITIVE' THEN 2 WHEN 'CUSTOMER_PERSONAL' THEN 2 ELSE 0 END
        ) AS "riskFloor"
        FROM "KnowledgePublicationItem" AS publication_item
        LEFT JOIN "KnowledgeV2FactVersion" AS publication_fact
          ON publication_fact."tenantId" = publication_item."tenantId"
          AND publication_fact."id" = publication_item."factVersionId"
        LEFT JOIN "KnowledgeV2GuidanceRuleVersion" AS publication_guidance
          ON publication_guidance."tenantId" = publication_item."tenantId"
          AND publication_guidance."id" = publication_item."guidanceRuleVersionId"
        LEFT JOIN "KnowledgeV2DocumentRevision" AS publication_revision
          ON publication_revision."tenantId" = publication_item."tenantId"
          AND publication_revision."id" = publication_item."v2DocumentRevisionId"
        LEFT JOIN "KnowledgeV2Document" AS publication_document
          ON publication_document."tenantId" = publication_revision."tenantId"
          AND publication_document."id" = publication_revision."documentId"
        WHERE publication_item."tenantId" = ${tenantId}
          AND publication_item."publicationId" = ${references.publicationId}
          AND ${references.publicationId}::text IS NOT NULL
          AND (
            (${factId}::text IS NOT NULL AND publication_fact."factId" = ${factId})
            OR (
              ${guidanceRuleId}::text IS NOT NULL
              AND publication_guidance."guidanceRuleId" = ${guidanceRuleId}
            )
            OR (
              ${documentRevisionId}::text IS NOT NULL
              AND publication_item."v2DocumentRevisionId" = ${documentRevisionId}
            )
          )
      ) AS context_risk
    `);
    const referencedFloor = rows[0]?.riskFloor ?? 0;
    const requestedFloor = riskLevels.indexOf(input.riskLevel ?? "LOW");
    const categoryFloor = riskLevels.indexOf(categoryRiskFloor[input.category]);
    return riskLevels[Math.max(referencedFloor, requestedFloor, categoryFloor)] ?? "CRITICAL";
  }

  private sanitizedRequest(input: KnowledgeV2CreateFeedbackDto, note: RestrictedTextInput | null) {
    const { note: rawNote, ...safeInput } = input;
    void rawNote;
    return {
      ...safeInput,
      evidenceReferenceIds: input.evidenceReferenceIds ?? [],
      noteHash: note?.hash ?? null,
    };
  }

  private restrictedText(value: string, field: string): RestrictedTextInput {
    const bytes = new TextEncoder().encode(value);
    if (!value.trim() || bytes.byteLength === 0 || bytes.byteLength > maximumRestrictedBytes) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_RESTRICTED_INPUT_SIZE_INVALID",
        "The restricted text must be non-empty and no larger than 32 KiB.",
        { field },
      );
    }
    return { value, hash: sha256(bytes) };
  }

  private async storeRestrictedNote(
    tenantId: string,
    idempotencyKey: string,
    input: RestrictedTextInput,
  ): Promise<StoredRestrictedText> {
    const bytes = new TextEncoder().encode(input.value);
    const { store, keyId } = this.restrictedStore();
    const key = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: "knowledge-v2-feedback",
      purpose: "raw",
      identity: `${keyId}:${idempotencyKey}:note`,
    });
    try {
      const written = await store.put(key, bytes);
      return {
        hash: input.hash,
        reference: encodeRestrictedReference(written),
        key: written.key,
        created: true,
      };
    } catch (error) {
      if (error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_EXISTS") {
        try {
          const existing = await store.get(key, keyId);
          const actual = Buffer.from(sha256(existing), "hex");
          const expected = Buffer.from(input.hash, "hex");
          if (actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)) {
            return {
              hash: input.hash,
              reference: encodeRestrictedReference({ key, encryptionKeyRef: keyId }),
              key,
              created: false,
            };
          }
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with different restricted input.",
          );
        } catch (readError) {
          if (readError instanceof KnowledgeObjectStoreError) {
            throw this.restrictedStorageUnavailable();
          }
          throw readError;
        }
      }
      if (error instanceof KnowledgeObjectStoreError) throw this.restrictedStorageUnavailable();
      throw error;
    }
  }

  private async deleteRestrictedNote(input: StoredRestrictedText) {
    const { store } = this.restrictedStore();
    await store.delete(input.key);
  }

  private restrictedStore() {
    const rootPath = this.config.knowledgeObjectStorePath;
    const keyValue = this.config.knowledgeArtifactEncryptionKey;
    const keyId = this.config.knowledgeArtifactEncryptionKeyId;
    if (!rootPath || !keyValue || !keyId) throw this.restrictedStorageUnavailable();
    try {
      return {
        keyId,
        store: new EncryptedFileKnowledgeObjectStore({
          rootPath,
          activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(keyValue) },
          maxPlaintextBytes: maximumRestrictedBytes,
        }),
      };
    } catch {
      throw this.restrictedStorageUnavailable();
    }
  }

  private feedbackView(feedback: FeedbackRecord): KnowledgeV2FeedbackView {
    return {
      id: feedback.id,
      corpusKind: "STRUCTURED_V2",
      feedbackKey: feedback.feedbackKey,
      category: feedback.category,
      status: feedback.status,
      riskLevel: feedback.riskLevel,
      responseMessageId: feedback.responseMessageId,
      evaluationRunId: feedback.evaluationRunId,
      evaluationResultId: feedback.evaluationResultId,
      publicationId: feedback.publicationId,
      retrievalTraceId: feedback.retrievalTraceId,
      actor: feedback.actor
        ? { id: feedback.actor.user.id, displayName: "Workspace member" }
        : null,
      noteHash: feedback.noteHash,
      hasRestrictedNote: Boolean(feedback.restrictedNoteRef),
      proposedAction: feedback.proposedAction,
      correctionTargetType: feedback.correctionTargetType,
      sourceId: feedback.sourceId,
      documentRevisionId: feedback.v2DocumentRevisionId,
      factId: feedback.factId,
      guidanceRuleId: feedback.guidanceRuleId,
      assignedTo: feedback.assignee
        ? { id: feedback.assignee.user.id, displayName: "Workspace member" }
        : null,
      assignedAt: dateValue(feedback.assignedAt),
      resolutionAction: feedback.resolutionAction,
      resolutionSummaryHash: feedback.resolutionSummaryHash,
      hasRestrictedResolution: Boolean(feedback.restrictedResolutionRef),
      resolvedBy: feedback.resolvedBy
        ? { id: feedback.resolvedBy.user.id, displayName: "Workspace member" }
        : null,
      resolvedAt: dateValue(feedback.resolvedAt),
      evidence: feedback.evidenceLinks.map((link) => ({
        evidence: this.evidenceView(link.evidenceReference),
        ordinal: link.ordinal,
        relevanceScore: link.relevanceScore,
      })),
      etag: feedback.etag,
      createdAt: feedback.createdAt.toISOString(),
      updatedAt: feedback.updatedAt.toISOString(),
    };
  }

  private evidenceView(evidence: EvidenceRecord): KnowledgeV2EvidenceReferenceView {
    const document = evidence.documentRevision?.document;
    const publicAndLive =
      evidence.isPublic &&
      (!document ||
        ((document.classification === "PUBLIC" || document.classification === "INTERNAL") &&
          document.status !== "TOMBSTONED" &&
          document.status !== "DELETED" &&
          !document.tombstonedAt &&
          !document.deletedAt));
    if (!publicAndLive) {
      return {
        id: evidence.id,
        corpusKind: "STRUCTURED_V2",
        evidenceKey: null,
        targetType: evidence.targetType,
        itemVersionHash: null,
        documentRevisionId: null,
        factVersionId: null,
        guidanceRuleVersionId: null,
        messageId: null,
        externalReferenceHash: null,
        safeLabel: "Restricted evidence",
        locatorHash: null,
        isPublic: false,
        confidence: null,
        observedAt: null,
        expiresAt: null,
        permissionFingerprint: null,
        hasRestrictedPayload: Boolean(evidence.restrictedPayloadRef),
        redacted: true,
        createdAt: evidence.createdAt.toISOString(),
      };
    }
    return {
      id: evidence.id,
      corpusKind: "STRUCTURED_V2",
      evidenceKey: evidence.evidenceKey,
      targetType: evidence.targetType,
      itemVersionHash: evidence.itemVersionHash,
      documentRevisionId: evidence.v2DocumentRevisionId,
      factVersionId: evidence.factVersionId,
      guidanceRuleVersionId: evidence.guidanceRuleVersionId,
      messageId: evidence.messageId,
      externalReferenceHash: evidence.externalReferenceHash,
      safeLabel: evidence.safeLabel,
      locatorHash: evidence.locatorHash,
      isPublic: true,
      confidence: evidence.confidence,
      observedAt: dateValue(evidence.observedAt),
      expiresAt: dateValue(evidence.expiresAt),
      permissionFingerprint: null,
      hasRestrictedPayload: Boolean(evidence.restrictedPayloadRef),
      redacted: false,
      createdAt: evidence.createdAt.toISOString(),
    };
  }

  private referenceNotFound(): never {
    throw knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_FEEDBACK_REFERENCE_NOT_FOUND",
      "A feedback reference is unavailable.",
    );
  }

  private referenceMismatch(): never {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_CONFLICT_FEEDBACK_REFERENCE_MISMATCH",
      "The feedback references do not describe the same knowledge operation.",
    );
  }

  private restrictedStorageUnavailable() {
    return knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
      "Restricted knowledge storage is unavailable.",
    );
  }
}
