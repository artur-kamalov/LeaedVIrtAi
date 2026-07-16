import type { KnowledgeRuntimeConfig } from "./contracts.js";

type QdrantPointPayload = Record<string, unknown>;

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: QdrantPointPayload;
}

export interface QdrantQueryPoint {
  id: string;
  score: number;
  payload: QdrantPointPayload;
}

export interface QdrantScrollPage {
  points: Array<{ id: string; payload: QdrantPointPayload }>;
  nextOffset: string | number | null;
}

export class QdrantRequestError extends Error {
  constructor(
    message: string,
    readonly reason: "qdrant_timeout" | "qdrant_error",
    readonly status?: number,
  ) {
    super(message);
    this.name = "QdrantRequestError";
  }
}

export class KnowledgeQdrantClient {
  constructor(
    private readonly config: KnowledgeRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ensureCollection(dimensions: number) {
    type CollectionResponse = {
      result?: { config?: { params?: { vectors?: { size?: number; distance?: string } } } };
    };
    let collection = await this.request<CollectionResponse>(
      `/collections/${this.config.qdrantCollection}`,
      { method: "GET" },
      true,
    );

    if (!collection) {
      await this.request(
        `/collections/${this.config.qdrantCollection}`,
        {
          method: "PUT",
          body: JSON.stringify({ vectors: { size: dimensions, distance: "Cosine" } }),
        },
        true,
      );
      for (let attempt = 0; attempt < 6 && !collection; attempt += 1) {
        try {
          collection = await this.request<CollectionResponse>(
            `/collections/${this.config.qdrantCollection}`,
            { method: "GET" },
            true,
          );
        } catch (error) {
          if (!(error instanceof QdrantRequestError) || error.status !== 500 || attempt === 5) {
            throw error;
          }
        }
        if (!collection && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(200, 25 * 2 ** attempt)));
        }
      }
    }

    const vectors = collection?.result?.config?.params?.vectors;
    if (!vectors) {
      throw new QdrantRequestError(
        `Qdrant collection ${this.config.qdrantCollection} is unavailable after creation.`,
        "qdrant_error",
      );
    }
    if (vectors.size !== dimensions || vectors.distance !== "Cosine") {
      throw new QdrantRequestError(
        `Qdrant collection ${this.config.qdrantCollection} is incompatible with the requested vector schema.`,
        "qdrant_error",
      );
    }

    await Promise.all([
      this.ensureKeywordIndex("tenantId"),
      this.ensureKeywordIndex("indexSnapshotId"),
    ]);
  }

  async upsert(points: QdrantPoint[]) {
    if (points.length === 0) return;
    await this.request(`/collections/${this.config.qdrantCollection}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    });
  }

  async query(input: {
    tenantId: string;
    indexSnapshotId: string;
    vector: number[];
    limit: number;
  }) {
    const payload = await this.request<{
      result?:
        | { points?: Array<{ id: string | number; score?: number; payload?: QdrantPointPayload }> }
        | Array<{ id: string | number; score?: number; payload?: QdrantPointPayload }>;
    }>(`/collections/${this.config.qdrantCollection}/points/query`, {
      method: "POST",
      body: JSON.stringify({
        query: input.vector,
        filter: {
          must: [
            { key: "tenantId", match: { value: input.tenantId } },
            { key: "indexSnapshotId", match: { value: input.indexSnapshotId } },
          ],
        },
        limit: input.limit,
        with_payload: true,
      }),
    });
    if (!payload) {
      throw new QdrantRequestError("Qdrant query returned no payload.", "qdrant_error");
    }

    const rawPoints = Array.isArray(payload.result)
      ? payload.result
      : (payload.result?.points ?? []);
    return rawPoints.map(
      (point): QdrantQueryPoint => ({
        id: String(point.id),
        score: typeof point.score === "number" ? point.score : 0,
        payload: point.payload ?? {},
      }),
    );
  }

  async count(input: { tenantId: string; indexSnapshotId: string }) {
    const payload = await this.request<{ result?: { count?: number } }>(
      `/collections/${this.config.qdrantCollection}/points/count`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            must: [
              { key: "tenantId", match: { value: input.tenantId } },
              { key: "indexSnapshotId", match: { value: input.indexSnapshotId } },
            ],
          },
          exact: true,
        }),
      },
    );
    if (!payload || typeof payload.result?.count !== "number") {
      throw new QdrantRequestError("Qdrant count returned no count.", "qdrant_error");
    }
    return payload.result.count;
  }

  async scrollTenant(tenantId: string, offset?: string | number): Promise<QdrantScrollPage> {
    const payload = await this.request<{
      result?: {
        points?: Array<{ id: string | number; payload?: QdrantPointPayload }>;
        next_page_offset?: string | number | null;
      };
    }>(`/collections/${this.config.qdrantCollection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        filter: { must: [{ key: "tenantId", match: { value: tenantId } }] },
        limit: 256,
        ...(offset !== undefined ? { offset } : {}),
        with_payload: true,
        with_vector: false,
      }),
    });
    if (!payload?.result)
      throw new QdrantRequestError("Qdrant scroll returned no result.", "qdrant_error");
    return {
      points: (payload.result.points ?? []).map((point) => ({
        id: String(point.id),
        payload: point.payload ?? {},
      })),
      nextOffset: payload.result.next_page_offset ?? null,
    };
  }

  async deletePoints(pointIds: string[]) {
    if (pointIds.length === 0) return;
    await this.request(`/collections/${this.config.qdrantCollection}/points/delete?wait=true`, {
      method: "POST",
      body: JSON.stringify({ points: pointIds }),
    });
  }

  private async ensureKeywordIndex(fieldName: string) {
    await this.request(
      `/collections/${this.config.qdrantCollection}/index?wait=true`,
      {
        method: "PUT",
        body: JSON.stringify({ field_name: fieldName, field_schema: "keyword" }),
      },
      true,
    );
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
    allowNotFoundOrConflict = false,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.qdrantTimeoutMs);

    try {
      const response = await this.fetchImpl(`${this.config.qdrantUrl.replace(/\/+$/, "")}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.config.qdrantApiKey ? { "api-key": this.config.qdrantApiKey } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (allowNotFoundOrConflict && (response.status === 404 || response.status === 409))
        return null;
      if (!response.ok) {
        throw new QdrantRequestError(
          `Qdrant request failed with HTTP ${response.status}.`,
          "qdrant_error",
          response.status,
        );
      }

      return (await response.json().catch(() => ({}))) as T;
    } catch (error) {
      if (error instanceof QdrantRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new QdrantRequestError("Qdrant request timed out.", "qdrant_timeout");
      }
      throw new QdrantRequestError("Qdrant request failed.", "qdrant_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}
