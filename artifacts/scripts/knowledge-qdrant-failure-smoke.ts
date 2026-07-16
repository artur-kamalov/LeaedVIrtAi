import type { PrismaClient } from "@leadvirt/db";
import {
  KnowledgeRetriever,
  type KnowledgeRuntimeConfig,
  type UnavailableKnowledgeResult
} from "@leadvirt/knowledge";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tenantId = "tenant-qdrant-failure";
const publicationId = "publication-qdrant-failure";
const indexSnapshotId = "snapshot-qdrant-failure";

function createPrismaHarness() {
  let retrievalContentReadCalls = 0;
  const publication = {
    id: publicationId,
    tenantId,
    targetKey: "workspace",
    status: "ACTIVE",
    indexSnapshot: {
      id: indexSnapshotId,
      status: "READY"
    }
  };
  const rejectContentRead = async () => {
    retrievalContentReadCalls += 1;
    throw new Error("Database retrieval fallback was attempted.");
  };
  const prisma = {
    activeKnowledgePublication: {
      findUnique: async () => ({ publication })
    },
    knowledgePublication: {
      findFirst: async () => publication
    },
    knowledgePublicationItem: {
      findMany: async () => [{ revisionId: "revision-qdrant-failure" }]
    },
    knowledgeIndexSnapshotItem: {
      findMany: rejectContentRead
    },
    businessKnowledgeChunk: {
      findMany: rejectContentRead
    }
  } as unknown as PrismaClient;

  return {
    prisma,
    getRetrievalContentReadCalls: () => retrievalContentReadCalls
  };
}

function createConfig(timeoutMs: number): KnowledgeRuntimeConfig {
  return {
    mode: "qdrant",
    qdrantUrl: "http://qdrant.invalid",
    qdrantCollection: "knowledge_failure_smoke",
    qdrantTimeoutMs: timeoutMs,
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace"
  };
}

function assertUnavailable(
  result: UnavailableKnowledgeResult,
  expectedReason: "qdrant_error" | "qdrant_timeout",
  contentReadCalls: number
) {
  assert(result.status === "unavailable", `Expected unavailable, received ${result.status}.`);
  assert(result.reason === expectedReason, `Expected ${expectedReason}, received ${result.reason}.`);
  assert(result.retryable, "Qdrant infrastructure failures must be retryable.");
  assert(result.publicationId === publicationId, "Unavailable result lost the publication identity.");
  assert(result.indexSnapshotId === indexSnapshotId, "Unavailable result lost the snapshot identity.");
  assert(result.evidence.length === 0, "Qdrant failure returned arbitrary database evidence.");
  assert(result.diagnostics.backend === "qdrant", "Diagnostics reported a database fallback.");
  assert(result.diagnostics.candidateCount === 0, "Qdrant failure reported candidates.");
  assert(result.diagnostics.hydratedCount === 0, "Qdrant failure hydrated database chunks.");
  assert(contentReadCalls === 0, "Qdrant failure attempted a database content read.");
}

async function testHttpFailure() {
  const harness = createPrismaHarness();
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ status: { error: "unavailable" } }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  const retriever = new KnowledgeRetriever(harness.prisma, createConfig(100), fetchImpl);
  const result = await retriever.retrieve({ tenantId, query: "price for arbitrary service", limit: 5 });

  assert(result.status === "unavailable", `HTTP 503 returned ${result.status}.`);
  assertUnavailable(result, "qdrant_error", harness.getRetrievalContentReadCalls());
  assert(fetchCalls === 1, `HTTP failure issued ${fetchCalls} Qdrant requests.`);
}

async function testTimeout() {
  const harness = createPrismaHarness();
  let fetchCalls = 0;
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
    fetchCalls += 1;
    const signal = init?.signal;
    if (!signal) return Promise.reject(new Error("Qdrant request did not provide an abort signal."));

    return new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
  }) as typeof fetch;
  const retriever = new KnowledgeRetriever(harness.prisma, createConfig(10), fetchImpl);
  const result = await retriever.retrieve({ tenantId, query: "price for arbitrary service", limit: 5 });

  assert(result.status === "unavailable", `Timeout returned ${result.status}.`);
  assertUnavailable(result, "qdrant_timeout", harness.getRetrievalContentReadCalls());
  assert(fetchCalls === 1, `Timeout issued ${fetchCalls} Qdrant requests.`);
}

async function main() {
  await testHttpFailure();
  await testTimeout();
  console.log(JSON.stringify({
    ok: true,
    cases: ["http_503", "timeout"],
    fallbackContentReads: 0
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
