import type { BusinessKnowledgeSourceType } from "@leadvirt/types";

export type KnowledgeRetrievalMode = "database" | "qdrant";
export type KnowledgeRetrievalStatus = "grounded" | "insufficient_grounding" | "unavailable";

export interface KnowledgeRuntimeConfig {
  mode: KnowledgeRetrievalMode;
  qdrantUrl: string;
  qdrantApiKey?: string;
  qdrantCollection: string;
  qdrantTimeoutMs: number;
  minScore: number;
  candidateLimit: number;
  targetKey?: string;
}

export interface KnowledgeRetrieveInput {
  tenantId: string;
  query: string;
  limit: number;
  targetKey?: string;
  publicationId?: string;
  locale?: string;
  channel?: string;
}

export interface KnowledgeEvidence {
  chunkId: string;
  revisionId: string;
  sourceId: string;
  sourceType: BusinessKnowledgeSourceType;
  title: string;
  content: string;
  contentHash: string;
  sourceVersion: number;
  chunkIndex: number;
  tokenEstimate: number;
  embeddingProvider: string;
  embeddingModel: string;
  createdAt: string;
  score: number;
}

export interface KnowledgeRetrievalDiagnostics {
  backend: KnowledgeRetrievalMode;
  candidateCount: number;
  hydratedCount: number;
  durationMs: number;
}

export interface GroundedKnowledgeResult {
  status: "grounded";
  publicationId: string;
  indexSnapshotId: string;
  evidence: KnowledgeEvidence[];
  diagnostics: KnowledgeRetrievalDiagnostics;
}

export interface InsufficientKnowledgeResult {
  status: "insufficient_grounding";
  reason: "no_candidates" | "below_threshold" | "hydration_rejected";
  publicationId: string;
  indexSnapshotId: string;
  evidence: [];
  diagnostics: KnowledgeRetrievalDiagnostics;
}

export interface UnavailableKnowledgeResult {
  status: "unavailable";
  reason: "no_active_publication" | "snapshot_not_ready" | "qdrant_timeout" | "qdrant_error";
  retryable: boolean;
  publicationId?: string;
  indexSnapshotId?: string;
  evidence: [];
  diagnostics: KnowledgeRetrievalDiagnostics;
}

export type KnowledgeRetrievalResult = GroundedKnowledgeResult | InsufficientKnowledgeResult | UnavailableKnowledgeResult;

export interface PublishLegacyKnowledgeInput {
  tenantId: string;
  targetKey?: string;
  actorUserId?: string | null;
  reason: string;
}

export interface PublishLegacyKnowledgeResult {
  status: "activated" | "unchanged";
  publicationId: string;
  indexSnapshotId: string;
  sequence: number;
  revisionCount: number;
  chunkCount: number;
  backend: KnowledgeRetrievalMode;
}
