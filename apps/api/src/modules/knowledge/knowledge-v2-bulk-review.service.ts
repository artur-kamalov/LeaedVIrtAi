import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type {
  KnowledgeV2BulkReviewEligibilityReason,
  KnowledgeV2BulkReviewExecuteRequest,
  KnowledgeV2BulkReviewMutationResult,
  KnowledgeV2BulkReviewPreviewRequest,
  KnowledgeV2BulkReviewPreviewView,
  KnowledgeV2ReviewAction,
} from "@leadvirt/types";
import { AppConfigService } from "../../config/app-config.service.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  canonicalKnowledgeV2Hash,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import { KnowledgeV2ReviewDecisionService } from "./knowledge-v2-review-decision.service.js";
import { knowledgeV2ReviewResolutionActions } from "./knowledge-v2-review.service.js";

const previewLifetimeMs = 5 * 60_000;
const maximumItems = 50;
const supportedActions = new Set<KnowledgeV2ReviewAction>([
  "APPROVE",
  "REJECT",
  "CORRECT_SOURCE",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
]);
const terminalStatuses = new Set(["RESOLVED", "DISMISSED", "SUPERSEDED"]);

type DatabaseClient = PrismaService | Prisma.TransactionClient;

const bulkReviewInclude = {
  source: {
    select: { id: true, kind: true, status: true, tombstonedAt: true, deletedAt: true },
  },
  fact: {
    select: { id: true, entityType: true, fieldType: true, deletedAt: true },
  },
  guidanceRule: {
    select: { id: true, ruleType: true, deletedAt: true },
  },
  documentRevision: {
    select: {
      id: true,
      status: true,
      deletedAt: true,
      document: {
        select: { id: true, kind: true, classification: true, deletedAt: true, tombstonedAt: true },
      },
    },
  },
  evidenceLinks: {
    select: { evidenceReference: { select: { restrictedPayloadRef: true } } },
  },
} satisfies Prisma.KnowledgeV2ReviewItemInclude;

type BulkReviewRecord = Prisma.KnowledgeV2ReviewItemGetPayload<{
  include: typeof bulkReviewInclude;
}>;

interface EligibleItem {
  record: BulkReviewRecord;
  schemaHash: string;
}

function reviewEtag(review: Pick<BulkReviewRecord, "id" | "etag">) {
  return strongKnowledgeV2Etag("review-item", review.id, review.etag);
}

function rationaleHash(value: string | null | undefined) {
  return canonicalKnowledgeV2Hash({ version: 1, rationale: value?.trim() || null });
}

function uniqueSortedIds(values: readonly string[]) {
  if (
    values.length === 0 ||
    values.length > maximumItems ||
    values.some((value) => typeof value !== "string" || !value.trim() || value.length > 128)
  ) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_BULK_REVIEW_ITEMS_INVALID",
      "Select between 1 and 50 review items.",
      { field: "itemIds" },
    );
  }
  const ids = [...new Set(values)].sort();
  if (ids.length !== values.length) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_BULK_REVIEW_ITEMS_DUPLICATE",
      "Each review item may be selected only once.",
      { field: "itemIds" },
    );
  }
  return ids;
}

function addReason(
  reasons: KnowledgeV2BulkReviewEligibilityReason[],
  reason: KnowledgeV2BulkReviewEligibilityReason,
) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function secureEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

@Injectable()
export class KnowledgeV2BulkReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeV2ReviewDecisionService)
    private readonly decisions: KnowledgeV2ReviewDecisionService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async preview(
    context: RequestContext,
    input: KnowledgeV2BulkReviewPreviewRequest,
  ): Promise<KnowledgeV2BulkReviewPreviewView> {
    await this.assertCurrentAdministrator(this.prisma, context);
    const ids = uniqueSortedIds(input.itemIds);
    return this.buildPreview(
      this.prisma,
      context,
      ids,
      input.action,
      new Date(Date.now() + previewLifetimeMs),
    );
  }

  async execute(
    context: RequestContext,
    input: KnowledgeV2BulkReviewExecuteRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2BulkReviewMutationResult> {
    const ids = uniqueSortedIds(input.items.map((item) => item.id));
    const expiry = new Date(input.previewExpiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_BULK_REVIEW_PREVIEW_EXPIRED",
        "The bulk review preview expired. Create a new preview before resolving.",
      );
    }
    const etags = new Map(input.items.map((item) => [item.id, item.etag]));
    if (etags.size !== input.items.length || input.items.some((item) => !item.etag.trim())) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_BULK_REVIEW_ETAGS_INVALID",
        "Provide one current ETag for every selected review item.",
        { field: "items" },
      );
    }
    const summaryHash = rationaleHash(input.rationale);
    let eventIds: string[] = [];
    const result = await this.idempotency.execute<{
      batchHash: string;
      items: Array<{ id: string; etag: string; generation: number }>;
    }>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/review-items/bulk-resolve",
        key: idempotencyKey,
        request: {
          actorUserId: context.userId,
          action: input.action,
          items: ids.map((id) => ({ id, etag: etags.get(id) })),
          previewHash: input.previewHash,
          previewExpiresAt: expiry.toISOString(),
          summaryHash,
        },
        transactionTimeoutMs: 120_000,
      },
      async (tx) => {
        await this.assertCurrentAdministrator(tx, context);
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeV2ReviewItem"
          WHERE "tenantId" = ${context.tenantId}
            AND "id" IN (${Prisma.join(ids)})
          ORDER BY "id" ASC
          FOR UPDATE
        `);
        if (locked.length !== ids.length) this.stale();
        const preview = await this.buildPreview(tx, context, ids, input.action, expiry);
        if (
          !preview.eligible ||
          !preview.previewHash ||
          !secureEqual(preview.previewHash, input.previewHash)
        ) {
          this.stale();
        }
        for (const item of preview.items) {
          if (!item.etag || etags.get(item.id) !== item.etag) this.stale();
        }

        const rows = await tx.knowledgeV2ReviewItem.findMany({
          where: { tenantId: context.tenantId, id: { in: ids } },
          orderBy: { id: "asc" },
        });
        const responses: Array<{ id: string; etag: string; generation: number }> = [];
        const pendingEvents: string[] = [];
        for (const current of rows) {
          const updated = await tx.knowledgeV2ReviewItem.update({
            where: { tenantId_id: { tenantId: context.tenantId, id: current.id } },
            data: {
              status: "IN_REVIEW",
              resolutionAction: null,
              resolutionSummaryHash: null,
              restrictedResolutionRef: null,
              resolvedByUserId: null,
              resolvedAt: null,
              etag: { increment: 1 },
              generation: { increment: 1 },
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.review.bulk_decision_requested",
              entityType: "knowledge_v2_review_item",
              entityId: current.id,
              payload: {
                previousStatus: current.status,
                status: "IN_REVIEW",
                targetStatus: "RESOLVED",
                resolutionAction: input.action,
                rationaleHash: summaryHash,
                generation: updated.generation,
                batchPreviewHash: input.previewHash,
              },
            },
          });
          pendingEvents.push(
            await this.decisions.enqueueReviewDecision(tx, {
              ...updated,
              status: "RESOLVED",
              resolutionAction: input.action,
              resolutionSummaryHash: summaryHash,
              resolvedByUserId: context.userId,
            }),
          );
          responses.push({
            id: updated.id,
            etag: reviewEtag(updated),
            generation: updated.generation,
          });
        }
        eventIds = pendingEvents;
        const batchHash = canonicalKnowledgeV2Hash({
          version: 1,
          tenantId: context.tenantId,
          action: input.action,
          itemGenerations: responses.map((item) => ({ id: item.id, generation: item.generation })),
          previewHash: input.previewHash,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { batchHash, items: responses },
        };
      },
    );
    if (!result.idempotencyReplayed) {
      for (const eventId of eventIds) this.decisions.dispatchSoon(eventId, false);
    }
    return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
  }

  private async buildPreview(
    db: DatabaseClient,
    context: RequestContext,
    ids: string[],
    action: Exclude<KnowledgeV2ReviewAction, "DISMISS">,
    expiresAt: Date,
  ): Promise<KnowledgeV2BulkReviewPreviewView> {
    const rows = await db.knowledgeV2ReviewItem.findMany({
      where: { tenantId: context.tenantId, id: { in: ids } },
      include: bulkReviewInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const eligible = new Map<string, EligibleItem>();
    const items = ids.map((id) => {
      const record = byId.get(id);
      const reasons: KnowledgeV2BulkReviewEligibilityReason[] = [];
      if (!record) {
        reasons.push("NOT_FOUND");
        return { id, etag: null, generation: null, eligible: false, reasons };
      }
      if (terminalStatuses.has(record.status) || record.status === "IN_REVIEW") {
        reasons.push("STATUS_NOT_OPEN");
      }
      if (record.riskLevel !== "LOW") reasons.push("RISK_NOT_LOW");
      if (!record.sourceId || !record.source) reasons.push("SOURCE_REQUIRED");
      else if (
        record.source.status !== "READY" ||
        record.source.tombstonedAt ||
        record.source.deletedAt
      ) {
        reasons.push("SOURCE_NOT_READY");
      }
      if (record.conflictId) reasons.push("CONFLICT_LINKED");
      if (
        record.restrictedPayloadRef ||
        record.restrictedResolutionRef ||
        record.evidenceLinks.some((link) => link.evidenceReference.restrictedPayloadRef)
      ) {
        reasons.push("RESTRICTED_CONTENT");
      }
      const allowed = knowledgeV2ReviewResolutionActions[
        record.reason
      ] as readonly KnowledgeV2ReviewAction[];
      if (record.suggestedAction !== action || !allowed.includes(action)) {
        reasons.push("ACTION_MISMATCH");
      }
      if (!supportedActions.has(action)) reasons.push("ACTION_UNSUPPORTED");
      const schemaHash = this.targetSchemaHash(record);
      if (!schemaHash || !this.actionTargetAvailable(record, action)) {
        reasons.push("TARGET_SCHEMA_UNAVAILABLE");
      }
      if (reasons.length === 0 && schemaHash) eligible.set(id, { record, schemaHash });
      return {
        id,
        etag: reviewEtag(record),
        generation: record.generation,
        eligible: reasons.length === 0,
        reasons,
      };
    });

    const first = ids.flatMap((id) => (eligible.has(id) ? [eligible.get(id)!] : [])).at(0);
    if (first) {
      for (const item of items) {
        const current = eligible.get(item.id);
        if (!current) continue;
        if (current.record.sourceId !== first.record.sourceId)
          addReason(item.reasons, "SOURCE_MISMATCH");
        if (current.record.reason !== first.record.reason)
          addReason(item.reasons, "REASON_MISMATCH");
        if (current.schemaHash !== first.schemaHash)
          addReason(item.reasons, "TARGET_SCHEMA_MISMATCH");
        item.eligible = item.reasons.length === 0;
      }
    }
    const allEligible = items.length === ids.length && items.every((item) => item.eligible);
    if (!allEligible || !first) {
      return {
        eligible: false,
        action,
        sourceId: first?.record.sourceId ?? null,
        reason: first?.record.reason ?? null,
        targetSchemaHash: first?.schemaHash ?? null,
        previewHash: null,
        expiresAt: null,
        items,
      };
    }
    const canonical = {
      version: 1,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action,
      sourceId: first.record.sourceId,
      reason: first.record.reason,
      targetSchemaHash: first.schemaHash,
      expiresAt: expiresAt.toISOString(),
      items: items.map((item) => ({ id: item.id, etag: item.etag, generation: item.generation })),
    };
    return {
      eligible: true,
      action,
      sourceId: first.record.sourceId,
      reason: first.record.reason,
      targetSchemaHash: first.schemaHash,
      previewHash: this.sign(canonical),
      expiresAt: expiresAt.toISOString(),
      items,
    };
  }

  private targetSchemaHash(review: BulkReviewRecord) {
    if (review.fact && !review.fact.deletedAt) {
      return canonicalKnowledgeV2Hash({
        version: 1,
        kind: "FACT",
        entityType: review.fact.entityType,
        fieldType: review.fact.fieldType,
      });
    }
    if (review.guidanceRule && !review.guidanceRule.deletedAt) {
      return canonicalKnowledgeV2Hash({
        version: 1,
        kind: "GUIDANCE",
        ruleType: review.guidanceRule.ruleType,
      });
    }
    if (
      review.documentRevision &&
      !review.documentRevision.deletedAt &&
      !review.documentRevision.document.deletedAt &&
      !review.documentRevision.document.tombstonedAt
    ) {
      return canonicalKnowledgeV2Hash({
        version: 1,
        kind: "REVISION",
        documentKind: review.documentRevision.document.kind,
        classification: review.documentRevision.document.classification,
      });
    }
    if (review.source) {
      return canonicalKnowledgeV2Hash({
        version: 1,
        kind: "SOURCE",
        sourceKind: review.source.kind,
      });
    }
    return null;
  }

  private actionTargetAvailable(
    review: BulkReviewRecord,
    action: Exclude<KnowledgeV2ReviewAction, "DISMISS">,
  ) {
    if (action === "APPROVE" || action === "REJECT") {
      return Boolean(
        (review.fact && !review.fact.deletedAt) ||
        (review.guidanceRule && !review.guidanceRule.deletedAt),
      );
    }
    if (
      ["CORRECT_SOURCE", "EXCLUDE_CONTENT", "RETRY_SOURCE", "VERIFY_PERMISSION"].includes(action)
    ) {
      return Boolean(review.source || review.documentRevision);
    }
    return action === "MARK_UNANSWERABLE" || action === "REQUIRE_HANDOFF";
  }

  private sign(value: unknown) {
    return createHmac("sha256", this.config.env.JWT_SECRET)
      .update("knowledge-v2-bulk-review-preview-v1\0", "utf8")
      .update(canonicalKnowledgeV2Hash(value), "utf8")
      .digest("hex");
  }

  private async assertCurrentAdministrator(db: DatabaseClient, context: RequestContext) {
    const membership = await db.membership.findFirst({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
        role: { in: ["OWNER", "ADMIN"] },
        user: { deletedAt: null },
        tenant: { deletedAt: null, status: { in: ["TRIALING", "ACTIVE"] } },
      },
      select: { role: true },
    });
    if (!membership) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_BULK_REVIEW_DENIED",
        "Only an owner or administrator can resolve review items in bulk.",
      );
    }
  }

  private stale(): never {
    throw knowledgeV2Error(
      HttpStatus.PRECONDITION_FAILED,
      "REVISION_CONFLICT",
      "One or more review items changed after the preview. Create a new preview.",
    );
  }
}
