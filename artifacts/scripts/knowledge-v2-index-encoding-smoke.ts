import assert from "node:assert/strict";
import {
  DeterministicMultilingualKnowledgeV2SparseEncoder,
  KnowledgeV2EmbeddingProviderError,
  KnowledgeV2HybridIndexError,
  KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
  OpenAICompatibleKnowledgeV2EmbeddingProvider,
  parseKnowledgeV2PersistedScope,
  validateKnowledgeV2HybridPointMetadata,
  validateKnowledgeV2SparseEncodingBatch,
  type KnowledgeV2HybridPointMetadata,
} from "@leadvirt/knowledge";

let checks = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

const requests: Array<{ authorization: string | null; body: Record<string, unknown> }> = [];

const pointMetadata: KnowledgeV2HybridPointMetadata = {
  documentId: "document-1",
  revisionId: "revision-1",
  chunkId: "chunk-1",
  locale: "en",
  audiences: ["PUBLIC"],
  classification: "PUBLIC",
  sourceKind: "WEBSITE",
  documentKind: "WEBSITE_PAGE",
  contentHash: "a".repeat(64),
  pipelineVersion: "knowledge-v2",
};

function expectInvalidMetadata(metadata: KnowledgeV2HybridPointMetadata) {
  try {
    validateKnowledgeV2HybridPointMetadata(metadata);
    assert.fail("invalid point metadata was accepted");
  } catch (error) {
    check(
      error instanceof KnowledgeV2HybridIndexError && error.code === "INVALID_INPUT",
      "invalid point metadata used the wrong error",
    );
  }
}

const provider = new OpenAICompatibleKnowledgeV2EmbeddingProvider(
  {
    baseUrl: "https://provider.example/v1",
    apiKey: "provider-secret",
    model: "multilingual-embedding-v1",
    dimensions: 3,
    requestTimeoutMs: 1_000,
    maxBatchSize: 2,
    schemaVersion: "knowledge-dense-v1",
  },
  {
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body,
      });
      const input = body.input as string[];
      return new Response(
        JSON.stringify({
          data: input.map((_text, index) => ({ index, embedding: [index + 1, 0, 0] })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  },
);

async function main() {
  const controller = new AbortController();
  const dense = await provider.embedBatch(
    [
      { id: "one", text: "Hello", locale: "en" },
      { id: "two", text: "Привет", locale: "ru" },
      { id: "three", text: "你好", locale: "zh" },
    ],
    controller.signal,
  );
  check(requests.length === 2, "dense provider did not enforce bounded request batches");
  check(dense.map((item) => item.id).join() === "one,two,three", "dense output order changed");
  check(
    requests.every(
      (request) =>
        request.authorization === "Bearer provider-secret" &&
        request.body.model === "multilingual-embedding-v1" &&
        request.body.dimensions === 3,
    ),
    "OpenAI-compatible request contract changed",
  );

  const sparse = new DeterministicMultilingualKnowledgeV2SparseEncoder({
    maxNonZeroValues: 64,
    schemaVersion: "knowledge-sparse-v1",
  });
  const sparseInput = [
    { id: "latin", text: "Hello support", locale: "en" },
    { id: "cyrillic", text: "Привет поддержка", locale: "ru" },
    { id: "cjk", text: "客户支持", locale: "zh" },
    { id: "symbols", text: "!!!", locale: "und" },
  ];
  const firstSparse = await sparse.encodeBatch(sparseInput, controller.signal);
  const secondSparse = await sparse.encodeBatch(sparseInput, controller.signal);
  validateKnowledgeV2SparseEncodingBatch(
    sparse.schema,
    sparseInput.map((item) => item.id),
    firstSparse,
  );
  check(JSON.stringify(firstSparse) === JSON.stringify(secondSparse), "sparse encoding drifted");
  check(
    firstSparse.every(
      (item) =>
        item.vector.indices.length > 0 &&
        item.vector.indices.every(
          (value, index, values) => index === 0 || values[index - 1]! < value,
        ),
    ),
    "multilingual sparse output was empty or unsorted",
  );

  const maximumIds = Array.from(
    { length: KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES },
    (_, index) => `brand-${index}`,
  );
  check(
    parseKnowledgeV2PersistedScope({
      brandIds: maximumIds,
      assistantIds: ["a".repeat(128)],
      segments: ["priority customer"],
    }).state === "EXPLICIT",
    "declared scope boundaries were rejected",
  );
  check(
    parseKnowledgeV2PersistedScope({ brandIds: [...maximumIds, "brand-overflow"] }).state ===
      "INVALID",
    "scope cardinality overflow was accepted",
  );
  check(
    parseKnowledgeV2PersistedScope({ assistantIds: ["a".repeat(129)] }).state === "INVALID",
    "scope ID length overflow was accepted",
  );
  check(
    parseKnowledgeV2PersistedScope({ segments: ["*"] }).state === "INVALID",
    "reserved wildcard segment was accepted",
  );
  validateKnowledgeV2HybridPointMetadata({
    ...pointMetadata,
    brandIds: maximumIds,
    assistantIds: ["a".repeat(128)],
    segmentIds: ["priority customer"],
  });
  checks += 1;
  expectInvalidMetadata({ ...pointMetadata, brandIds: [...maximumIds, "brand-overflow"] });
  expectInvalidMetadata({ ...pointMetadata, assistantIds: ["a".repeat(129)] });
  expectInvalidMetadata({ ...pointMetadata, segmentIds: ["*"] });

  const invalidProvider = new OpenAICompatibleKnowledgeV2EmbeddingProvider(
    {
      baseUrl: "https://provider.example/v1",
      apiKey: "never-leak-secret",
      model: "multilingual-embedding-v1",
      dimensions: 3,
      requestTimeoutMs: 1_000,
      maxBatchSize: 2,
      schemaVersion: "knowledge-dense-v1",
    },
    {
      fetchImpl: async () =>
        new Response('api_key=never-leak-secret {"data":[{"index":0,"embedding":[1]}]}', {
          status: 200,
        }),
    },
  );
  try {
    await invalidProvider.embedBatch([{ id: "bad", text: "bad", locale: "en" }], controller.signal);
    assert.fail("invalid provider response was accepted");
  } catch (error) {
    check(
      error instanceof KnowledgeV2EmbeddingProviderError && error.code === "RESPONSE_INVALID",
      "invalid provider response used the wrong safe error",
    );
    check(
      error instanceof Error &&
        !error.message.includes("never-leak-secret") &&
        !error.message.includes("api_key"),
      "provider response or credential leaked into the error",
    );
  }

  console.log(JSON.stringify({ ok: true, checks, denseRequests: requests.length }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
