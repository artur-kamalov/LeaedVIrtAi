import { createHash } from "node:crypto";

export const legacyEmbeddingDimensions = 64;
export const legacyEmbeddingProvider = "leadvirt-local-hash";
export const legacyEmbeddingModel = "hash-v1";
export const legacyPipelineVersion = "legacy-v2";

const maxChunkChars = 900;
const chunkOverlapChars = 120;

export function hashKnowledgeValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicPointId(value: string) {
  const hash = hashKnowledgeValue(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function tokenizeKnowledgeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function uniqueKnowledgeTokens(value: string) {
  return Array.from(new Set(tokenizeKnowledgeText(value)));
}

export function lexicalKnowledgeScore(query: string, content: string) {
  const queryTokens = uniqueKnowledgeTokens(query);
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenizeKnowledgeText(content));
  return queryTokens.reduce((score, token) => score + (contentTokens.has(token) ? 1 : 0), 0) / queryTokens.length;
}

export function embedLegacyKnowledge(value: string) {
  const vector = Array.from({ length: legacyEmbeddingDimensions }, () => 0);
  for (const token of tokenizeKnowledgeText(value)) {
    const digest = createHash("sha256").update(token).digest();
    const index = (digest[0] ?? 0) % legacyEmbeddingDimensions;
    const sign = (digest[1] ?? 0) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => Number((item / norm).toFixed(8)));
}

export function cosineKnowledgeScore(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

export function splitLegacyKnowledgeContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
    if (paragraph.length > maxChunkChars) {
      if (current) chunks.push(current);
      current = "";
      for (let offset = 0; offset < paragraph.length; offset += maxChunkChars - chunkOverlapChars) {
        const chunk = paragraph.slice(offset, offset + maxChunkChars).trim();
        if (chunk) chunks.push(chunk);
      }
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

export function estimateKnowledgeTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4));
}
