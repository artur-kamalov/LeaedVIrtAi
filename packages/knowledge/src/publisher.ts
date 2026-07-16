import { Prisma, type PrismaClient } from "@leadvirt/db";
import type {
  KnowledgeRuntimeConfig,
  PublishLegacyKnowledgeInput,
  PublishLegacyKnowledgeResult,
} from "./contracts.js";
import { compareKnowledgeCanonicalText } from "./canonical-order.js";
import { lockKnowledgeCorpusTransition } from "./corpus-transition.js";
import {
  deterministicPointId,
  embedLegacyKnowledge,
  estimateKnowledgeTokens,
  hashKnowledgeValue,
  legacyEmbeddingDimensions,
  legacyEmbeddingModel,
  legacyEmbeddingProvider,
  legacyPipelineVersion,
  splitLegacyKnowledgeContent,
} from "./legacy-hash-embedding.js";
import { KnowledgeQdrantClient } from "./qdrant.js";

type RevisionWithChunks = Prisma.KnowledgeRevisionGetPayload<{ include: { chunks: true } }>;

export const legacyKnowledgeCorpusInactiveCode = "KNOWLEDGE_PUBLICATION_LEGACY_CORPUS_INACTIVE";

export class LegacyKnowledgeCorpusInactiveError extends Error {
  readonly code = legacyKnowledgeCorpusInactiveCode;

  constructor() {
    super("Legacy knowledge publication is disabled after structured corpus cutover.");
    this.name = legacyKnowledgeCorpusInactiveCode;
  }
}

export function stableKnowledgeValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableKnowledgeValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareKnowledgeCanonicalText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableKnowledgeValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSerializationFailure(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export class LegacyKnowledgePublisher {
  private readonly qdrant: KnowledgeQdrantClient;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: KnowledgeRuntimeConfig,
    fetchImpl?: typeof fetch,
  ) {
    this.qdrant = new KnowledgeQdrantClient(config, fetchImpl);
  }

  async publish(input: PublishLegacyKnowledgeInput): Promise<PublishLegacyKnowledgeResult> {
    await this.assertLegacyCorpusActive(this.prisma, input.tenantId);
    const targetKey = input.targetKey ?? this.config.targetKey ?? "workspace";
    const sources = await this.prisma.businessKnowledgeSource.findMany({
      where: { tenantId: input.tenantId, status: "ACTIVE", deletedAt: null },
      orderBy: { id: "asc" },
    });
    const revisions: RevisionWithChunks[] = [];

    for (const source of sources) {
      const contentHash = hashKnowledgeValue(
        stableKnowledgeValue({
          sourceType: source.type,
          title: source.title,
          content: source.content,
          structuredData: source.structuredData,
        }),
      );
      const existing = await this.prisma.knowledgeRevision.findUnique({
        where: { sourceId_sourceVersion: { sourceId: source.id, sourceVersion: source.version } },
        include: { chunks: { orderBy: { chunkIndex: "asc" } } },
      });
      if (existing && existing.contentHash !== contentHash) {
        throw new Error(`Knowledge source ${source.id} changed without incrementing its version.`);
      }

      const revision =
        existing ??
        (await this.prisma.knowledgeRevision.create({
          data: {
            tenant: { connect: { id: input.tenantId } },
            source: { connect: { id: source.id } },
            sourceVersion: source.version,
            sourceType: source.type,
            title: source.title,
            content: source.content,
            ...(source.structuredData !== null ? { structuredData: source.structuredData } : {}),
            contentHash,
            status: "READY",
            pipelineVersion: legacyPipelineVersion,
            chunks: {
              create: splitLegacyKnowledgeContent(source.content).map((content, chunkIndex) => ({
                tenant: { connect: { id: input.tenantId } },
                chunkIndex,
                content,
                contentHash: hashKnowledgeValue(content),
                tokenEstimate: estimateKnowledgeTokens(content),
                embeddingProvider: legacyEmbeddingProvider,
                embeddingModel: legacyEmbeddingModel,
                embeddedAt: new Date(),
                metadata: {
                  sourceType: source.type,
                  sourceTitle: source.title,
                  sourceKey: source.sourceKey,
                },
              })),
            },
          },
          include: { chunks: { orderBy: { chunkIndex: "asc" } } },
        }));
      revisions.push(revision);
    }

    const chunks = revisions.flatMap((revision) => revision.chunks);
    const snapshotManifestHash = hashKnowledgeValue(
      stableKnowledgeValue({
        pipelineVersion: legacyPipelineVersion,
        embeddingProvider: legacyEmbeddingProvider,
        embeddingModel: legacyEmbeddingModel,
        collectionName: this.config.qdrantCollection,
        chunks: chunks
          .map((chunk) => ({ id: chunk.id, contentHash: chunk.contentHash }))
          .sort((a, b) => compareKnowledgeCanonicalText(a.id, b.id)),
      }),
    );
    let snapshot = await this.prisma.knowledgeIndexSnapshot.findFirst({
      where: {
        tenantId: input.tenantId,
        manifestHash: snapshotManifestHash,
        collectionName: this.config.qdrantCollection,
        embeddingProvider: legacyEmbeddingProvider,
        embeddingModel: legacyEmbeddingModel,
        pipelineVersion: legacyPipelineVersion,
      },
    });

    if (!snapshot) {
      snapshot = await this.prisma.knowledgeIndexSnapshot.create({
        data: {
          tenantId: input.tenantId,
          status: "PREPARING",
          collectionName: this.config.qdrantCollection,
          embeddingProvider: legacyEmbeddingProvider,
          embeddingModel: legacyEmbeddingModel,
          manifestHash: snapshotManifestHash,
          pipelineVersion: legacyPipelineVersion,
          expectedPointCount: chunks.length,
        },
      });
    }

    if (snapshot.status !== "READY" || snapshot.observedPointCount !== chunks.length) {
      snapshot = await this.prepareSnapshot(input.tenantId, snapshot.id, revisions);
    }
    if (this.config.mode === "qdrant") {
      await this.reconcileTenantPoints(input.tenantId, snapshot.id);
      const candidatePointCount = await this.qdrant.count({
        tenantId: input.tenantId,
        indexSnapshotId: snapshot.id,
      });
      if (candidatePointCount !== chunks.length) {
        throw new Error(`Knowledge snapshot ${snapshot.id} changed during Qdrant reconciliation.`);
      }
    }

    const publicationManifestHash = hashKnowledgeValue(
      stableKnowledgeValue({
        targetKey,
        indexSnapshotId: snapshot.id,
        revisions: revisions
          .map((revision) => ({ id: revision.id, contentHash: revision.contentHash }))
          .sort((a, b) => compareKnowledgeCanonicalText(a.id, b.id)),
      }),
    );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.activatePublication({
          tenantId: input.tenantId,
          targetKey,
          actorUserId: input.actorUserId ?? null,
          reason: input.reason,
          snapshotId: snapshot.id,
          manifestHash: publicationManifestHash,
          revisions,
          chunkCount: chunks.length,
        });
      } catch (error) {
        if (attempt < 3 && isSerializationFailure(error)) continue;
        throw error;
      }
    }

    throw new Error("Knowledge publication activation exhausted its retry budget.");
  }

  private async prepareSnapshot(
    tenantId: string,
    snapshotId: string,
    revisions: RevisionWithChunks[],
  ) {
    const chunks = revisions.flatMap((revision) => revision.chunks);
    const sourceIdByRevision = new Map(
      revisions.map((revision) => [revision.id, revision.sourceId]),
    );
    await this.prisma.knowledgeIndexSnapshot.update({
      where: { id: snapshotId },
      data: { status: "PREPARING", errorCode: null, observedPointCount: null, verifiedAt: null },
    });
    const items = chunks.map((chunk) => ({
      tenantId,
      snapshotId,
      chunkId: chunk.id,
      contentHash: chunk.contentHash,
      vectorPointId: deterministicPointId(
        `${tenantId}:${snapshotId}:${chunk.id}:${legacyEmbeddingModel}`,
      ),
    }));
    await this.prisma.knowledgeIndexSnapshotItem.createMany({ data: items, skipDuplicates: true });

    try {
      let observedPointCount: number;
      if (this.config.mode === "qdrant") {
        await this.qdrant.ensureCollection(legacyEmbeddingDimensions);
        for (let offset = 0; offset < items.length; offset += 256) {
          const batch = items.slice(offset, offset + 256);
          const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
          await this.qdrant.upsert(
            batch.map((item) => {
              const chunk = chunkById.get(item.chunkId);
              if (!chunk)
                throw new Error(`Knowledge chunk ${item.chunkId} was not found during indexing.`);
              const sourceId = sourceIdByRevision.get(chunk.revisionId);
              if (!sourceId)
                throw new Error(
                  `Knowledge revision ${chunk.revisionId} has no source during indexing.`,
                );
              return {
                id: item.vectorPointId,
                vector: embedLegacyKnowledge(chunk.content),
                payload: {
                  tenantId,
                  indexSnapshotId: snapshotId,
                  chunkId: chunk.id,
                  revisionId: chunk.revisionId,
                  sourceId,
                  contentHash: chunk.contentHash,
                },
              };
            }),
          );
        }
        observedPointCount =
          items.length > 0 ? await this.qdrant.count({ tenantId, indexSnapshotId: snapshotId }) : 0;
      } else {
        observedPointCount = await this.prisma.knowledgeIndexSnapshotItem.count({
          where: { tenantId, snapshotId },
        });
      }

      if (observedPointCount !== items.length) {
        throw new Error(
          `Knowledge snapshot ${snapshotId} expected ${items.length} points but observed ${observedPointCount}.`,
        );
      }

      return await this.prisma.knowledgeIndexSnapshot.update({
        where: { id: snapshotId },
        data: {
          status: "READY",
          observedPointCount,
          verifiedAt: new Date(),
          errorCode: null,
        },
      });
    } catch (error) {
      await this.prisma.knowledgeIndexSnapshot
        .update({
          where: { id: snapshotId },
          data: {
            status: "ABANDONED",
            errorCode: error instanceof Error ? error.name : "SNAPSHOT_PREPARATION_FAILED",
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async reconcileTenantPoints(tenantId: string, candidateSnapshotId: string) {
    const expected = await this.prisma.knowledgeIndexSnapshotItem.findMany({
      where: {
        tenantId,
        snapshot: {
          status: "READY",
          OR: [
            { id: candidateSnapshotId },
            { publications: { some: { status: { in: ["ACTIVE", "SUPERSEDED"] } } } },
          ],
        },
        chunk: {
          revision: {
            source: { status: "ACTIVE", deletedAt: null },
          },
        },
      },
      select: { vectorPointId: true },
    });
    const expectedIds = new Set(expected.map((item) => item.vectorPointId));
    let offset: string | number | undefined;
    do {
      const page = await this.qdrant.scrollTenant(tenantId, offset);
      const orphanIds = page.points
        .filter((point) => !expectedIds.has(point.id))
        .map((point) => point.id);
      for (let index = 0; index < orphanIds.length; index += 256) {
        await this.qdrant.deletePoints(orphanIds.slice(index, index + 256));
      }
      offset = page.nextOffset ?? undefined;
    } while (offset !== undefined);
  }

  private activatePublication(input: {
    tenantId: string;
    targetKey: string;
    actorUserId: string | null;
    reason: string;
    snapshotId: string;
    manifestHash: string;
    revisions: RevisionWithChunks[];
    chunkCount: number;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockKnowledgeCorpusTransition(tx, input.tenantId);
        await this.assertLegacyCorpusActiveForActivation(tx, input.tenantId);
        const active = await tx.activeKnowledgePublication.findUnique({
          where: { tenantId_targetKey: { tenantId: input.tenantId, targetKey: input.targetKey } },
          include: { publication: true },
        });
        if (
          active?.publication.manifestHash === input.manifestHash &&
          active.publication.indexSnapshotId === input.snapshotId &&
          active.publication.status === "ACTIVE"
        ) {
          return {
            status: "unchanged" as const,
            publicationId: active.publicationId,
            indexSnapshotId: input.snapshotId,
            sequence: active.sequence,
            revisionCount: input.revisions.length,
            chunkCount: input.chunkCount,
            backend: this.config.mode,
          };
        }

        const latest = await tx.knowledgePublication.aggregate({
          where: { tenantId: input.tenantId, targetKey: input.targetKey },
          _max: { sequence: true },
        });
        const sequence = (latest._max.sequence ?? 0) + 1;
        const now = new Date();
        const publication = await tx.knowledgePublication.create({
          data: {
            tenant: { connect: { id: input.tenantId } },
            targetKey: input.targetKey,
            sequence,
            status: "READY",
            indexSnapshot: {
              connect: { tenantId_id: { tenantId: input.tenantId, id: input.snapshotId } },
            },
            ...(active ? { basePublication: { connect: { id: active.publicationId } } } : {}),
            manifestHash: input.manifestHash,
            pipelineVersion: legacyPipelineVersion,
            retrievalPolicyVersion: legacyPipelineVersion,
            promptPolicyVersion: legacyPipelineVersion,
            qualitySummary: {
              phase: "phase0",
              backend: this.config.mode,
              revisionCount: input.revisions.length,
              chunkCount: input.chunkCount,
            },
            readyAt: now,
            items: {
              create: input.revisions.map((revision) => ({
                itemType: "LEGACY_REVISION",
                itemId: revision.id,
                revision: {
                  connect: { tenantId_id: { tenantId: input.tenantId, id: revision.id } },
                },
              })),
            },
          },
        });

        if (active) {
          await tx.knowledgePublication.update({
            where: { id: active.publicationId },
            data: { status: "SUPERSEDED", supersededAt: now },
          });
        }
        await tx.knowledgePublication.update({
          where: { id: publication.id },
          data: { status: "ACTIVE", activatedAt: now },
        });
        await tx.activeKnowledgePublication.upsert({
          where: { tenantId_targetKey: { tenantId: input.tenantId, targetKey: input.targetKey } },
          create: {
            tenantId: input.tenantId,
            targetKey: input.targetKey,
            publicationId: publication.id,
            sequence,
            updatedByUserId: input.actorUserId,
          },
          update: {
            publicationId: publication.id,
            sequence,
            etag: { increment: 1 },
            updatedByUserId: input.actorUserId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: "knowledge.publication.activated",
            entityType: "knowledge_publication",
            entityId: publication.id,
            payload: {
              targetKey: input.targetKey,
              sequence,
              indexSnapshotId: input.snapshotId,
              basePublicationId: active?.publicationId ?? null,
              reason: input.reason,
              revisionCount: input.revisions.length,
              chunkCount: input.chunkCount,
              backend: this.config.mode,
            },
          },
        });

        return {
          status: "activated" as const,
          publicationId: publication.id,
          indexSnapshotId: input.snapshotId,
          sequence,
          revisionCount: input.revisions.length,
          chunkCount: input.chunkCount,
          backend: this.config.mode,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async assertLegacyCorpusActive(database: PrismaClient, tenantId: string) {
    const selector = await database.knowledgeCorpusSelector.findUnique({
      where: { tenantId },
      select: { corpusKind: true },
    });
    this.assertLegacyCorpusKind(selector?.corpusKind);
  }

  private async assertLegacyCorpusActiveForActivation(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ) {
    const [selector] = await tx.$queryRaw<Array<{ corpusKind: string }>>(Prisma.sql`
      SELECT "corpusKind"::text AS "corpusKind"
      FROM "KnowledgeCorpusSelector"
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `);
    this.assertLegacyCorpusKind(selector?.corpusKind);
  }

  private assertLegacyCorpusKind(corpusKind: string | undefined) {
    if (corpusKind === "STRUCTURED_V2") {
      throw new LegacyKnowledgeCorpusInactiveError();
    }
  }
}
