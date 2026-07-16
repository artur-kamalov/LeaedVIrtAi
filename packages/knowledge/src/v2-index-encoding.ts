import { createHash } from "node:crypto";
import type {
  KnowledgeV2DenseEmbeddingProvider,
  KnowledgeV2DenseVectorSchema,
  KnowledgeV2SparseEncoder,
  KnowledgeV2SparseVector,
  KnowledgeV2SparseVectorSchema,
} from "./v2-hybrid-qdrant.js";

const maximumResponseCharacters = 16 * 1024 * 1024;
const maximumTextCharacters = 120_000;
const maximumBatchCharacters = 2_000_000;

const providerMessages = Object.freeze({
  INVALID_CONFIG: "The embedding provider configuration is invalid.",
  INVALID_INPUT: "The embedding input is invalid.",
  REQUEST_ABORTED: "The embedding request was cancelled.",
  REQUEST_TIMEOUT: "The embedding provider timed out.",
  DEPENDENCY_UNAVAILABLE: "The embedding provider is unavailable.",
  DEPENDENCY_REJECTED: "The embedding provider rejected the request.",
  RESPONSE_INVALID: "The embedding provider returned an invalid response.",
});

export type KnowledgeV2EmbeddingProviderErrorCode = keyof typeof providerMessages;

export class KnowledgeV2EmbeddingProviderError extends Error {
  constructor(
    readonly code: KnowledgeV2EmbeddingProviderErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(providerMessages[code]);
    this.name = "KnowledgeV2EmbeddingProviderError";
  }
}

export interface KnowledgeV2OpenAIEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  requestTimeoutMs: number;
  maxBatchSize: number;
  schemaVersion: string;
  vectorName?: string;
}

export interface KnowledgeV2OpenAIEmbeddingDependencies {
  fetchImpl?: typeof fetch;
}

export interface KnowledgeV2DeterministicSparseConfig {
  maxNonZeroValues: number;
  schemaVersion: string;
  vectorName?: string;
}

interface EmbeddingResponse {
  data?: unknown;
}

function fail(
  code: KnowledgeV2EmbeddingProviderErrorCode,
  retryable = false,
  status?: number,
): never {
  throw new KnowledgeV2EmbeddingProviderError(code, retryable, status);
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

function safeOpaque(value: unknown, maximum = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
  );
}

function safeSchemaName(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-z][a-z0-9._-]*$/u.test(value)
  );
}

function finiteVector(value: unknown, dimensions: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === dimensions &&
    value.every(
      (item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1e6,
    )
  );
}

function assertEmbeddingInput(
  input: readonly { id: string; text: string; locale: string }[],
  maximumBatchSize: number,
) {
  if (
    input.length === 0 ||
    input.length > 10_000 ||
    new Set(input.map((item) => item.id)).size !== input.length ||
    input.some(
      (item) =>
        !safeOpaque(item.id) ||
        !safeOpaque(item.locale, 35) ||
        !item.text.trim() ||
        item.text.length > maximumTextCharacters,
    ) ||
    !boundedInteger(maximumBatchSize, 1, 256)
  ) {
    fail("INVALID_INPUT");
  }
}

function providerUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      fail("INVALID_CONFIG");
    }
    return `${url.toString().replace(/\/+$/u, "")}/embeddings`;
  } catch (error) {
    if (error instanceof KnowledgeV2EmbeddingProviderError) throw error;
    fail("INVALID_CONFIG");
  }
}

function retryableStatus(status: number) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

export class OpenAICompatibleKnowledgeV2EmbeddingProvider implements KnowledgeV2DenseEmbeddingProvider {
  readonly schema: KnowledgeV2DenseVectorSchema;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: KnowledgeV2OpenAIEmbeddingConfig,
    dependencies: KnowledgeV2OpenAIEmbeddingDependencies = {},
  ) {
    if (
      !config.apiKey.trim() ||
      config.apiKey.length > 8_192 ||
      !safeOpaque(config.model) ||
      !boundedInteger(config.dimensions, 1, 65_536) ||
      !boundedInteger(config.requestTimeoutMs, 100, 120_000) ||
      !boundedInteger(config.maxBatchSize, 1, 256) ||
      !safeSchemaName(config.schemaVersion) ||
      !safeSchemaName(config.vectorName ?? "dense")
    ) {
      fail("INVALID_CONFIG");
    }
    this.endpoint = providerUrl(config.baseUrl);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.schema = Object.freeze({
      vectorName: config.vectorName ?? "dense",
      schemaVersion: config.schemaVersion,
      provider: "openai-compatible",
      model: config.model,
      dimensions: config.dimensions,
      distance: "Cosine" as const,
    });
  }

  async embedBatch(
    input: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ) {
    assertEmbeddingInput(input, this.config.maxBatchSize);
    const output: Array<{ id: string; vector: readonly number[] }> = [];
    for (let offset = 0; offset < input.length; offset += this.config.maxBatchSize) {
      const batch = input.slice(offset, offset + this.config.maxBatchSize);
      if (batch.reduce((total, item) => total + item.text.length, 0) > maximumBatchCharacters) {
        fail("INVALID_INPUT");
      }
      const vectors = await this.requestBatch(batch, signal);
      output.push(...batch.map((item, index) => ({ id: item.id, vector: vectors[index]! })));
    }
    return output;
  }

  private async requestBatch(
    batch: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ) {
    if (signal.aborted) fail("REQUEST_ABORTED");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          input: batch.map((item) => item.text),
          dimensions: this.config.dimensions,
          encoding_format: "float",
        }),
      });
      if (!response.ok) {
        fail(
          retryableStatus(response.status) ? "DEPENDENCY_UNAVAILABLE" : "DEPENDENCY_REJECTED",
          retryableStatus(response.status),
          response.status,
        );
      }
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > maximumResponseCharacters) {
        fail("RESPONSE_INVALID");
      }
      const text = await response.text();
      if (text.length > maximumResponseCharacters) fail("RESPONSE_INVALID");
      let body: EmbeddingResponse;
      try {
        body = JSON.parse(text) as EmbeddingResponse;
      } catch {
        fail("RESPONSE_INVALID");
      }
      if (!Array.isArray(body.data) || body.data.length !== batch.length) {
        fail("RESPONSE_INVALID");
      }
      const byIndex = new Map<number, number[]>();
      for (const value of body.data) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          fail("RESPONSE_INVALID");
        }
        const item = value as Record<string, unknown>;
        if (
          !boundedInteger(item.index, 0, batch.length - 1) ||
          byIndex.has(item.index as number) ||
          !finiteVector(item.embedding, this.config.dimensions)
        ) {
          fail("RESPONSE_INVALID");
        }
        byIndex.set(item.index as number, item.embedding);
      }
      return batch.map((_item, index) => byIndex.get(index) ?? fail("RESPONSE_INVALID"));
    } catch (error) {
      if (error instanceof KnowledgeV2EmbeddingProviderError) throw error;
      if (signal.aborted) fail("REQUEST_ABORTED");
      fail(timedOut ? "REQUEST_TIMEOUT" : "DEPENDENCY_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
}

function sparseIndex(value: string) {
  return createHash("sha256").update(value, "utf8").digest().readUInt32BE(0) & 0x7fffffff;
}

function normalizedTerms(value: string) {
  const text = value.normalize("NFKC").toLocaleLowerCase("und");
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}._:/+-]*/gu) ?? [];
  const terms: string[] = [];
  for (const token of tokens) {
    terms.push(`w:${token}`);
    const characters = [...token];
    const containsCjk = characters.some((character) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character),
    );
    const sizes = containsCjk ? [1, 2, 3] : [3, 4];
    if (characters.length <= 48) {
      for (const size of sizes) {
        for (let index = 0; index + size <= characters.length; index += 1) {
          terms.push(`c${size}:${characters.slice(index, index + size).join("")}`);
        }
      }
    }
  }
  if (terms.length === 0 && text.trim()) {
    terms.push(`fallback:${createHash("sha256").update(text, "utf8").digest("hex")}`);
  }
  return terms;
}

export class DeterministicMultilingualKnowledgeV2SparseEncoder implements KnowledgeV2SparseEncoder {
  readonly schema: KnowledgeV2SparseVectorSchema;

  constructor(private readonly config: KnowledgeV2DeterministicSparseConfig) {
    if (
      !boundedInteger(config.maxNonZeroValues, 1, 65_536) ||
      !safeSchemaName(config.schemaVersion) ||
      !safeSchemaName(config.vectorName ?? "sparse")
    ) {
      fail("INVALID_CONFIG");
    }
    this.schema = Object.freeze({
      vectorName: config.vectorName ?? "sparse",
      schemaVersion: config.schemaVersion,
      provider: "leadvirt",
      model: "unicode-hash-tf-v1",
      maxNonZeroValues: config.maxNonZeroValues,
    });
  }

  encodeBatch(
    input: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ): Promise<readonly { id: string; vector: KnowledgeV2SparseVector }[]> {
    assertEmbeddingInput(input, 256);
    if (signal.aborted) fail("REQUEST_ABORTED");
    return Promise.resolve(
      input.map((item) => ({ id: item.id, vector: this.encode(item.text) })),
    );
  }

  private encode(text: string): KnowledgeV2SparseVector {
    const counts = new Map<number, number>();
    for (const term of normalizedTerms(text)) {
      const index = sparseIndex(term);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    const selected = [...counts.entries()]
      .map(([index, count]) => ({ index, value: 1 + Math.log(count) }))
      .sort((left, right) => right.value - left.value || left.index - right.index)
      .slice(0, this.config.maxNonZeroValues)
      .sort((left, right) => left.index - right.index);
    const norm = Math.sqrt(selected.reduce((sum, item) => sum + item.value ** 2, 0)) || 1;
    return {
      indices: selected.map((item) => item.index),
      values: selected.map((item) => item.value / norm),
    };
  }
}
