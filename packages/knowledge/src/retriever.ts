import type { Prisma, PrismaClient } from "@leadvirt/db";
import type {
  KnowledgeEvidence,
  KnowledgeRetrievalDiagnostics,
  KnowledgeRetrievalResult,
  KnowledgeRetrieveInput,
  KnowledgeRuntimeConfig
} from "./contracts.js";
import {
  cosineKnowledgeScore,
  embedLegacyKnowledge,
  lexicalKnowledgeScore
} from "./legacy-hash-embedding.js";
import { KnowledgeQdrantClient, QdrantRequestError, type QdrantQueryPoint } from "./qdrant.js";

type HydratedSnapshotItem = Prisma.KnowledgeIndexSnapshotItemGetPayload<{
  include: {
    chunk: {
      include: {
        revision: {
          include: { source: true };
        };
      };
    };
  };
}>;

const allowedRevisionStatuses = new Set(["READY", "SUPERSEDED"]);

function diagnostics(
  backend: KnowledgeRuntimeConfig["mode"],
  startedAt: number,
  candidateCount: number,
  hydratedCount: number
): KnowledgeRetrievalDiagnostics {
  return {
    backend,
    candidateCount,
    hydratedCount,
    durationMs: Date.now() - startedAt
  };
}

function payloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export class KnowledgeRetriever {
  private readonly qdrant: KnowledgeQdrantClient;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: KnowledgeRuntimeConfig,
    fetchImpl?: typeof fetch
  ) {
    this.qdrant = new KnowledgeQdrantClient(config, fetchImpl);
  }

  async retrieve(input: KnowledgeRetrieveInput): Promise<KnowledgeRetrievalResult> {
    const startedAt = Date.now();
    const targetKey = input.targetKey ?? this.config.targetKey ?? "workspace";
    const query = input.query.trim();
    const limit = Math.max(1, Math.min(20, Math.floor(input.limit)));
    const publication = input.publicationId
      ? await this.prisma.knowledgePublication.findFirst({
          where: {
            id: input.publicationId,
            tenantId: input.tenantId,
            targetKey,
            status: { in: ["ACTIVE", "SUPERSEDED"] }
          },
          include: { indexSnapshot: true }
        })
      : (
          await this.prisma.activeKnowledgePublication.findUnique({
            where: { tenantId_targetKey: { tenantId: input.tenantId, targetKey } },
            include: { publication: { include: { indexSnapshot: true } } }
          })
        )?.publication ?? null;

    if (!publication) {
      return {
        status: "unavailable",
        reason: "no_active_publication",
        retryable: false,
        evidence: [],
        diagnostics: diagnostics(this.config.mode, startedAt, 0, 0)
      };
    }

    const snapshot = publication.indexSnapshot;
    if (!snapshot || snapshot.status !== "READY") {
      return {
        status: "unavailable",
        reason: "snapshot_not_ready",
        retryable: true,
        publicationId: publication.id,
        ...(snapshot ? { indexSnapshotId: snapshot.id } : {}),
        evidence: [],
        diagnostics: diagnostics(this.config.mode, startedAt, 0, 0)
      };
    }

    if (!query) {
      return {
        status: "insufficient_grounding",
        reason: "no_candidates",
        publicationId: publication.id,
        indexSnapshotId: snapshot.id,
        evidence: [],
        diagnostics: diagnostics(this.config.mode, startedAt, 0, 0)
      };
    }

    const revisionIds = new Set(
      (
        await this.prisma.knowledgePublicationItem.findMany({
          where: {
            tenantId: input.tenantId,
            publicationId: publication.id,
            itemType: "LEGACY_REVISION",
            revisionId: { not: null }
          },
          select: { revisionId: true }
        })
      )
        .map((item) => item.revisionId)
        .filter((revisionId): revisionId is string => Boolean(revisionId))
    );

    if (this.config.mode === "database") {
      return this.retrieveFromDatabase({
        tenantId: input.tenantId,
        query,
        limit,
        publicationId: publication.id,
        indexSnapshotId: snapshot.id,
        revisionIds,
        startedAt
      });
    }

    return this.retrieveFromQdrant({
      tenantId: input.tenantId,
      query,
      limit,
      publicationId: publication.id,
      indexSnapshotId: snapshot.id,
      revisionIds,
      startedAt
    });
  }

  private async retrieveFromDatabase(input: {
    tenantId: string;
    query: string;
    limit: number;
    publicationId: string;
    indexSnapshotId: string;
    revisionIds: Set<string>;
    startedAt: number;
  }): Promise<KnowledgeRetrievalResult> {
    const items = await this.loadSnapshotItems(input.tenantId, input.indexSnapshotId);
    if (items.length === 0) {
      return this.insufficient(input, "no_candidates", 0, 0);
    }

    const queryVector = embedLegacyKnowledge(input.query);
    const scored = items
      .filter((item) => this.isAuthorizedItem(item, input.revisionIds))
      .map((item) => {
        const lexicalScore = lexicalKnowledgeScore(input.query, `${item.chunk.revision.title} ${item.chunk.content}`);
        const vectorScore = cosineKnowledgeScore(queryVector, embedLegacyKnowledge(item.chunk.content));
        return {
          item,
          lexicalScore,
          score: Number((lexicalScore * 0.7 + Math.max(0, vectorScore) * 0.3).toFixed(8))
        };
      });
    const hydratedCount = scored.length;
    const selected = scored
      .filter((candidate) => candidate.lexicalScore > 0 && candidate.score >= this.config.minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit)
      .map(({ item, score }) => this.toEvidence(item, score));

    if (selected.length === 0) {
      const reason = hydratedCount === 0 ? "hydration_rejected" : "below_threshold";
      return this.insufficient(input, reason, items.length, hydratedCount);
    }

    return {
      status: "grounded",
      publicationId: input.publicationId,
      indexSnapshotId: input.indexSnapshotId,
      evidence: selected,
      diagnostics: diagnostics(this.config.mode, input.startedAt, items.length, hydratedCount)
    };
  }

  private async retrieveFromQdrant(input: {
    tenantId: string;
    query: string;
    limit: number;
    publicationId: string;
    indexSnapshotId: string;
    revisionIds: Set<string>;
    startedAt: number;
  }): Promise<KnowledgeRetrievalResult> {
    let points: QdrantQueryPoint[];
    try {
      points = await this.qdrant.query({
        tenantId: input.tenantId,
        indexSnapshotId: input.indexSnapshotId,
        vector: embedLegacyKnowledge(input.query),
        limit: Math.max(input.limit, this.config.candidateLimit)
      });
    } catch (error) {
      const reason = error instanceof QdrantRequestError ? error.reason : "qdrant_error";
      return {
        status: "unavailable",
        reason,
        retryable: true,
        publicationId: input.publicationId,
        indexSnapshotId: input.indexSnapshotId,
        evidence: [],
        diagnostics: diagnostics(this.config.mode, input.startedAt, 0, 0)
      };
    }

    if (points.length === 0) {
      return this.insufficient(input, "no_candidates", 0, 0);
    }

    const scoreByPointId = new Map(points.map((point) => [point.id, point]));
    const items = await this.loadSnapshotItems(
      input.tenantId,
      input.indexSnapshotId,
      points.map((point) => point.id)
    );
    const selected = items
      .filter((item) => this.isAuthorizedItem(item, input.revisionIds))
      .map((item) => {
        const point = scoreByPointId.get(item.vectorPointId);
        if (!point || !this.payloadMatches(point, item, input.tenantId, input.indexSnapshotId)) return null;
        const lexicalScore = lexicalKnowledgeScore(input.query, `${item.chunk.revision.title} ${item.chunk.content}`);
        if (lexicalScore <= 0 || point.score < this.config.minScore) return null;
        return this.toEvidence(item, point.score);
      })
      .filter((evidence): evidence is KnowledgeEvidence => evidence !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);

    if (selected.length === 0) {
      const reason = items.length === 0 ? "hydration_rejected" : "below_threshold";
      return this.insufficient(input, reason, points.length, items.length);
    }

    return {
      status: "grounded",
      publicationId: input.publicationId,
      indexSnapshotId: input.indexSnapshotId,
      evidence: selected,
      diagnostics: diagnostics(this.config.mode, input.startedAt, points.length, items.length)
    };
  }

  private loadSnapshotItems(tenantId: string, snapshotId: string, pointIds?: string[]) {
    return this.prisma.knowledgeIndexSnapshotItem.findMany({
      where: {
        tenantId,
        snapshotId,
        ...(pointIds ? { vectorPointId: { in: pointIds } } : {})
      },
      include: {
        chunk: {
          include: {
            revision: {
              include: { source: true }
            }
          }
        }
      }
    });
  }

  private isAuthorizedItem(item: HydratedSnapshotItem, revisionIds: Set<string>) {
    return (
      item.contentHash === item.chunk.contentHash &&
      item.tenantId === item.chunk.tenantId &&
      item.tenantId === item.chunk.revision.tenantId &&
      revisionIds.has(item.chunk.revisionId) &&
      allowedRevisionStatuses.has(item.chunk.revision.status) &&
      item.chunk.revision.source.status === "ACTIVE" &&
      item.chunk.revision.source.deletedAt === null
    );
  }

  private payloadMatches(
    point: QdrantQueryPoint,
    item: HydratedSnapshotItem,
    tenantId: string,
    indexSnapshotId: string
  ) {
    return (
      payloadText(point.payload, "tenantId") === tenantId &&
      payloadText(point.payload, "indexSnapshotId") === indexSnapshotId &&
      payloadText(point.payload, "chunkId") === item.chunkId &&
      payloadText(point.payload, "revisionId") === item.chunk.revisionId &&
      payloadText(point.payload, "sourceId") === item.chunk.revision.sourceId &&
      payloadText(point.payload, "contentHash") === item.contentHash
    );
  }

  private toEvidence(item: HydratedSnapshotItem, score: number): KnowledgeEvidence {
    return {
      chunkId: item.chunk.id,
      revisionId: item.chunk.revisionId,
      sourceId: item.chunk.revision.sourceId,
      sourceType: item.chunk.revision.sourceType,
      title: item.chunk.revision.title,
      content: item.chunk.content,
      contentHash: item.chunk.contentHash,
      sourceVersion: item.chunk.revision.sourceVersion,
      chunkIndex: item.chunk.chunkIndex,
      tokenEstimate: item.chunk.tokenEstimate,
      embeddingProvider: item.chunk.embeddingProvider,
      embeddingModel: item.chunk.embeddingModel,
      createdAt: item.chunk.createdAt.toISOString(),
      score: Number(score.toFixed(8))
    };
  }

  private insufficient(
    input: {
      publicationId: string;
      indexSnapshotId: string;
      startedAt: number;
    },
    reason: "no_candidates" | "below_threshold" | "hydration_rejected",
    candidateCount: number,
    hydratedCount: number
  ): KnowledgeRetrievalResult {
    return {
      status: "insufficient_grounding",
      reason,
      publicationId: input.publicationId,
      indexSnapshotId: input.indexSnapshotId,
      evidence: [],
      diagnostics: diagnostics(this.config.mode, input.startedAt, candidateCount, hydratedCount)
    };
  }
}

export * from "./v2-retriever.js";
