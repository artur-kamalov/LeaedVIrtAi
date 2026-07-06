import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { BusinessKnowledgeChunk, BusinessKnowledgeSearchResult, BusinessKnowledgeSource } from "@leadvirt/types";
import type {
  BusinessKnowledgeChunk as PrismaBusinessKnowledgeChunk,
  BusinessKnowledgeSource as PrismaBusinessKnowledgeSource,
  BusinessKnowledgeSourceType as PrismaBusinessKnowledgeSourceType,
  Prisma
} from "@leadvirt/db";
import { AppConfigService } from "../../config/app-config.service.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { CreateKnowledgeSourceDto } from "./dto/create-knowledge-source.dto.js";
import type { UpdateKnowledgeSourceDto } from "./dto/update-knowledge-source.dto.js";

type KnowledgeSourceRow = PrismaBusinessKnowledgeSource;
type KnowledgeChunkRow = PrismaBusinessKnowledgeChunk;
type ChunkWithSource = KnowledgeChunkRow & { source: KnowledgeSourceRow };

const embeddingDimensions = 64;
const embeddingProvider = "leadvirt-local-hash";
const embeddingModel = "hash-v1";
const maxChunkChars = 900;
const chunkOverlapChars = 120;

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
    @Inject(AppConfigService) private readonly config: AppConfigService
  ) {}

  async list(context: RequestContext): Promise<BusinessKnowledgeSource[]> {
    const rows = await this.prisma.businessKnowledgeSource.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }]
    });
    return rows.map((row) => this.mapSource(row));
  }

  async create(context: RequestContext, dto: CreateKnowledgeSourceDto): Promise<BusinessKnowledgeSource> {
    const data: Prisma.BusinessKnowledgeSourceUncheckedCreateInput = {
      tenantId: context.tenantId,
      type: dto.type,
      source: "manual",
      sourceKey: `manual:${randomUUID()}`,
      title: dto.title.trim(),
      content: dto.content.trim()
    };
    if (dto.structuredData) {
      data.structuredData = dto.structuredData as Prisma.InputJsonObject;
    }

    const source = await this.prisma.businessKnowledgeSource.create({
      data
    });
    await this.audit(context, "knowledge.source_created", source.id, { type: source.type, title: source.title });
    return this.mapSource(source);
  }

  async update(context: RequestContext, id: string, dto: UpdateKnowledgeSourceDto): Promise<BusinessKnowledgeSource> {
    await this.ensureSource(context.tenantId, id);
    const source = await this.prisma.businessKnowledgeSource.update({
      where: { id },
      data: {
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.content ? { content: dto.content.trim(), version: { increment: 1 } } : {}),
        ...(dto.structuredData ? { structuredData: dto.structuredData as Prisma.InputJsonObject } : {})
      }
    });
    await this.audit(context, "knowledge.source_updated", source.id, { type: source.type, status: source.status });
    return this.mapSource(source);
  }

  async archive(context: RequestContext, id: string) {
    await this.ensureSource(context.tenantId, id);
    const source = await this.prisma.businessKnowledgeSource.update({
      where: { id },
      data: { status: "ARCHIVED", deletedAt: new Date() }
    });
    await this.audit(context, "knowledge.source_archived", source.id, { type: source.type });
    return { id: source.id, archived: true };
  }

  async reindex(context: RequestContext) {
    const sources = await this.prisma.businessKnowledgeSource.findMany({
      where: { tenantId: context.tenantId, status: "ACTIVE", deletedAt: null },
      orderBy: [{ type: "asc" }, { updatedAt: "asc" }]
    });

    const sourceIds = sources.map((source) => source.id);
    if (sourceIds.length === 0) {
      return { sources: 0, chunks: 0, indexed: 0, qdrant: this.config.ragQdrantEnabled };
    }

    await this.prisma.businessKnowledgeChunk.deleteMany({
      where: { tenantId: context.tenantId, sourceId: { in: sourceIds } }
    });

    const now = new Date();
    const chunks = sources.flatMap((source) =>
      this.splitContent(source.content).map((content, chunkIndex) => ({
        tenantId: context.tenantId,
        sourceId: source.id,
        sourceVersion: source.version,
        chunkIndex,
        content,
        contentHash: this.hash(content),
        tokenEstimate: this.estimateTokens(content),
        embeddingProvider,
        embeddingModel,
        vectorPointId: this.pointId(`${context.tenantId}:${source.id}:${source.version}:${chunkIndex}`),
        metadata: {
          sourceType: source.type,
          sourceTitle: source.title,
          sourceKey: source.sourceKey
        } satisfies Prisma.InputJsonObject,
        embeddedAt: now
      }))
    );

    if (chunks.length === 0) {
      return { sources: sources.length, chunks: 0, indexed: 0, qdrant: this.config.ragQdrantEnabled };
    }

    await this.prisma.businessKnowledgeChunk.createMany({ data: chunks });
    const created = await this.prisma.businessKnowledgeChunk.findMany({
      where: { tenantId: context.tenantId, sourceId: { in: sourceIds } },
      include: { source: true },
      orderBy: [{ sourceId: "asc" }, { chunkIndex: "asc" }]
    });

    const indexed = this.config.ragQdrantEnabled ? await this.indexChunksInQdrant(created) : 0;
    if (indexed > 0) {
      await this.prisma.businessKnowledgeChunk.updateMany({
        where: { id: { in: created.map((chunk) => chunk.id) } },
        data: { indexedAt: new Date() }
      });
    }

    await this.audit(context, "knowledge.reindexed", context.tenantId, {
      sources: sources.length,
      chunks: chunks.length,
      indexed
    });

    return { sources: sources.length, chunks: chunks.length, indexed, qdrant: this.config.ragQdrantEnabled };
  }

  async search(context: RequestContext, query: string, limit: number): Promise<BusinessKnowledgeSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    if (this.config.ragQdrantEnabled) {
      const qdrantResults = await this.searchQdrant(context, normalizedQuery, limit).catch(() => []);
      if (qdrantResults.length > 0) return qdrantResults;
    }

    const chunks = await this.prisma.businessKnowledgeChunk.findMany({
      where: { tenantId: context.tenantId, deletedAt: null, source: { status: "ACTIVE", deletedAt: null } },
      include: { source: true },
      orderBy: { updatedAt: "desc" },
      take: 200
    });
    const queryVector = this.embed(normalizedQuery);
    return chunks
      .map((chunk) => ({ chunk, score: this.cosine(queryVector, this.embed(chunk.content)) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((result) => ({
        chunk: this.mapChunk(result.chunk),
        source: this.mapSource(result.chunk.source),
        score: Number(result.score.toFixed(6))
      }));
  }

  async syncOnboardingSources(context: RequestContext, data: Record<string, unknown>) {
    const specs = this.buildOnboardingSources(data);
    const touched: string[] = [];

    for (const spec of specs) {
      const content = spec.content.trim();
      if (!content) {
        await this.prisma.businessKnowledgeSource.updateMany({
          where: { tenantId: context.tenantId, sourceKey: spec.sourceKey, deletedAt: null },
          data: { status: "ARCHIVED", deletedAt: new Date() }
        });
        continue;
      }

      const source = await this.prisma.businessKnowledgeSource.upsert({
        where: { tenantId_sourceKey: { tenantId: context.tenantId, sourceKey: spec.sourceKey } },
        update: {
          type: spec.type,
          status: "ACTIVE",
          title: spec.title,
          content,
          structuredData: spec.structuredData,
          version: { increment: 1 },
          deletedAt: null
        },
        create: {
          tenantId: context.tenantId,
          type: spec.type,
          status: "ACTIVE",
          source: "onboarding",
          sourceKey: spec.sourceKey,
          title: spec.title,
          content,
          structuredData: spec.structuredData
        }
      });
      touched.push(source.id);
    }

    if (touched.length > 0) {
      await this.audit(context, "knowledge.onboarding_synced", context.tenantId, {
        sourceIds: touched,
        count: touched.length
      });
    }

    return touched.length;
  }

  private async ensureSource(tenantId: string, id: string) {
    const source = await this.prisma.businessKnowledgeSource.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true }
    });
    if (!source) {
      throw new NotFoundException("Knowledge source was not found.");
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
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapChunk(row: KnowledgeChunkRow): BusinessKnowledgeChunk {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sourceId: row.sourceId,
      sourceVersion: row.sourceVersion,
      chunkIndex: row.chunkIndex,
      content: row.content,
      contentHash: row.contentHash,
      tokenEstimate: row.tokenEstimate,
      embeddingProvider: row.embeddingProvider,
      embeddingModel: row.embeddingModel,
      vectorPointId: row.vectorPointId,
      metadata: row.metadata,
      embeddedAt: row.embeddedAt?.toISOString() ?? null,
      indexedAt: row.indexedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private buildOnboardingSources(data: Record<string, unknown>): OnboardingKnowledgeSpec[] {
    const companyInfo = this.record(data.companyInfo);
    const businessName = this.text(companyInfo.name);
    const businessDescription = this.text(companyInfo.description);
    const businessType = this.text(data.businessType);
    const scenario = this.text(data.scenario);
    const hours = this.text(companyInfo.hours);
    const avgCheck = this.text(companyInfo.avgCheck);
    const servicesCatalog = this.text(companyInfo.servicesCatalog);
    const availability = this.text(companyInfo.availability);
    const faq = this.text(companyInfo.faq);
    const policies = this.text(companyInfo.policies);
    const escalationRules = this.text(companyInfo.escalationRules);

    const baseStructuredData = {
      source: "onboarding",
      businessType,
      scenario
    };

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
          avgCheck ? `Average check: ${avgCheck}` : ""
        ]),
        structuredData: { ...baseStructuredData, businessName, businessDescription, avgCheck }
      },
      {
        type: "CATALOG",
        sourceKey: "onboarding:catalog",
        title: "Catalog and prices",
        content: servicesCatalog,
        structuredData: { ...baseStructuredData, servicesCatalog }
      },
      {
        type: "AVAILABILITY",
        sourceKey: "onboarding:availability",
        title: "Working hours and free windows",
        content: this.lines([hours ? `Working hours: ${hours}` : "", availability]),
        structuredData: { ...baseStructuredData, hours, availability }
      },
      {
        type: "FAQ",
        sourceKey: "onboarding:faq",
        title: "FAQ",
        content: faq,
        structuredData: { ...baseStructuredData, faq }
      },
      {
        type: "POLICY",
        sourceKey: "onboarding:policy",
        title: "Policies and constraints",
        content: policies,
        structuredData: { ...baseStructuredData, policies }
      },
      {
        type: "ESCALATION",
        sourceKey: "onboarding:escalation",
        title: "Escalation rules",
        content: escalationRules,
        structuredData: { ...baseStructuredData, escalationRules }
      }
    ];
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }

  private lines(values: string[]) {
    return values.map((value) => value.trim()).filter(Boolean).join("\n");
  }

  private splitContent(content: string) {
    const normalized = content.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (!normalized) return [];

    const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
      if (paragraph.length > maxChunkChars) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        chunks.push(...this.sliceLongText(paragraph));
        continue;
      }

      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > maxChunkChars) {
        chunks.push(current);
        current = paragraph;
      } else {
        current = next;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private sliceLongText(text: string) {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      chunks.push(text.slice(offset, offset + maxChunkChars).trim());
      offset += maxChunkChars - chunkOverlapChars;
    }
    return chunks.filter(Boolean);
  }

  private estimateTokens(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private pointId(value: string) {
    const hash = this.hash(value);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }

  private tokens(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1);
  }

  private embed(value: string) {
    const vector = Array.from({ length: embeddingDimensions }, () => 0);
    for (const token of this.tokens(value)) {
      const digest = createHash("sha256").update(token).digest();
      const index = (digest[0] ?? 0) % embeddingDimensions;
      const sign = (digest[1] ?? 0) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
    return vector.map((item) => Number((item / norm).toFixed(8)));
  }

  private cosine(left: number[], right: number[]) {
    return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  }

  private async indexChunksInQdrant(chunks: ChunkWithSource[]) {
    if (chunks.length === 0) return 0;
    await this.ensureQdrantCollection();
    const points = chunks.map((chunk) => ({
      id: chunk.vectorPointId,
      vector: this.embed(chunk.content),
      payload: {
        tenantId: chunk.tenantId,
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        sourceType: chunk.source.type,
        sourceTitle: chunk.source.title,
        sourceVersion: chunk.sourceVersion,
        content: chunk.content
      }
    }));

    await this.qdrantRequest(`/collections/${this.config.ragQdrantCollection}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points })
    });
    return points.length;
  }

  private async searchQdrant(context: RequestContext, query: string, limit: number): Promise<BusinessKnowledgeSearchResult[]> {
    const payload = await this.qdrantRequest<{ result?: { points?: Array<{ id: string; score?: number }> } | Array<{ id: string; score?: number }> }>(
      `/collections/${this.config.ragQdrantCollection}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          query: this.embed(query),
          filter: { must: [{ key: "tenantId", match: { value: context.tenantId } }] },
          limit,
          with_payload: true
        })
      }
    );
    const rawPoints = Array.isArray(payload.result) ? payload.result : (payload.result?.points ?? []);
    const pointIds = rawPoints.map((point) => String(point.id));
    if (pointIds.length === 0) return [];

    const chunks = await this.prisma.businessKnowledgeChunk.findMany({
      where: { tenantId: context.tenantId, vectorPointId: { in: pointIds }, deletedAt: null },
      include: { source: true }
    });
    const scoreByPointId = new Map(rawPoints.map((point) => [String(point.id), point.score ?? 0]));
    return chunks
      .map((chunk) => ({
        chunk: this.mapChunk(chunk),
        source: this.mapSource(chunk.source),
        score: Number((scoreByPointId.get(chunk.vectorPointId ?? "") ?? 0).toFixed(6))
      }))
      .sort((a, b) => b.score - a.score);
  }

  private async ensureQdrantCollection() {
    const collection = this.config.ragQdrantCollection;
    const exists = await this.qdrantRequest(`/collections/${collection}`, { method: "GET" }).then(
      () => true,
      () => false
    );
    if (exists) return;

    await this.qdrantRequest(`/collections/${collection}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: embeddingDimensions,
          distance: "Cosine"
        }
      })
    });
  }

  private async qdrantRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.ragQdrantUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.config.ragQdrantApiKey ? { "api-key": this.config.ragQdrantApiKey } : {}),
        ...(init.headers ?? {})
      }
    });
    const payload = (await response.json().catch(() => null)) as T;
    if (!response.ok) {
      throw new Error(`Qdrant request failed with HTTP ${response.status}`);
    }
    return payload;
  }

  private async audit(context: RequestContext, action: string, entityId: string, payload: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "business_knowledge_source",
        entityId,
        payload
      }
    });
  }
}
