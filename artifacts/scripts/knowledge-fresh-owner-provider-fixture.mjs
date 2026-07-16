import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.KNOWLEDGE_ACCEPTANCE_PROVIDER_PORT ?? 4011);
const expectedSentence = "Polar Lantern Studio's signature service code is AURORA-7291.";
const maximumBodyBytes = 2 * 1024 * 1024;

function tokens(value) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
}

function vector(value, dimensions) {
  const result = Array.from({ length: dimensions }, () => 0);
  for (const token of tokens(value)) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    result[index] += digest[4] % 2 === 0 ? 1 : -1;
  }
  const magnitude = Math.sqrt(result.reduce((sum, item) => sum + item * item, 0));
  if (magnitude === 0) result[0] = 1;
  else for (let index = 0; index < result.length; index += 1) result[index] /= magnitude;
  return result;
}

function overlap(query, value) {
  const queryTerms = new Set(tokens(query));
  const valueTerms = new Set(tokens(value));
  let matches = 0;
  for (const term of queryTerms) if (valueTerms.has(term)) matches += 1;
  return queryTerms.size > 0 ? matches / queryTerms.size : 0;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function groundedInput(body) {
  const user = Array.isArray(body.input) ? body.input.find((item) => item?.role === "user") : null;
  const text = Array.isArray(user?.content)
    ? user.content.find((item) => item?.type === "input_text")?.text
    : null;
  if (typeof text !== "string") return null;
  const start = "BEGIN_GROUNDED_INPUT_JSON\n";
  const end = "\nEND_GROUNDED_INPUT_JSON";
  const from = text.indexOf(start);
  const to = text.lastIndexOf(end);
  if (from < 0 || to <= from) return null;
  return JSON.parse(text.slice(from + start.length, to));
}

function groundedOutput(body) {
  const input = groundedInput(body);
  const evidence = Array.isArray(input?.evidence) ? input.evidence : [];
  const selected =
    evidence.find((item) => item?.evidence?.content?.includes(expectedSentence)) ?? null;
  const evidenceKey = selected?.evidence?.evidenceKey;
  if (typeof evidenceKey !== "string") throw new Error("Expected acceptance evidence is missing.");
  return {
    schemaVersion: 1,
    claims: [
      {
        claimId: "acceptance-service-code",
        text: expectedSentence,
        evidenceKeys: [evidenceKey],
        exactValueText: null,
      },
    ],
    citations: [{ claimId: "acceptance-service-code", evidenceKey }],
  };
}

function json(response, status, body) {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(value),
  });
  response.end(value);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/v1/embeddings") {
      const input = Array.isArray(body.input) ? body.input : [];
      const dimensions = Number(body.dimensions);
      if (
        input.length === 0 ||
        input.some((item) => typeof item !== "string") ||
        !Number.isInteger(dimensions) ||
        dimensions < 1 ||
        dimensions > 256
      ) {
        json(response, 400, { error: "invalid embedding request" });
        return;
      }
      json(response, 200, {
        data: input.map((item, index) => ({ index, embedding: vector(item, dimensions) })),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/rerank") {
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      json(response, 200, {
        results: candidates
          .map((candidate) => ({
            id: candidate.id,
            score: overlap(body.query ?? "", `${candidate.title ?? ""} ${candidate.text ?? ""}`),
          }))
          .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
      json(response, 200, { output_text: JSON.stringify(groundedOutput(body)) });
      return;
    }
    json(response, 404, { error: "not found" });
  } catch {
    json(response, 400, { error: "invalid fixture request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Knowledge acceptance provider fixture listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
