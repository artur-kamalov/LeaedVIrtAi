import { createHash } from "node:crypto";
import { compareKnowledgeCanonicalText } from "./canonical-order.js";
import {
  isKnowledgeV2ScopeSegment,
  KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
  KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES,
  KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH,
  KNOWLEDGE_V2_SCOPE_WILDCARD,
} from "./v2-authorization-policy.js";

const MAX_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
const WILDCARD_SCOPE = KNOWLEDGE_V2_SCOPE_WILDCARD;

const errorMessages = Object.freeze({
  INVALID_CONFIG: "The hybrid index configuration is invalid.",
  INVALID_INPUT: "The hybrid index input is invalid.",
  INVALID_VECTOR: "The hybrid vector is invalid.",
  COLLECTION_SCHEMA_MISMATCH: "The physical index collection schema does not match.",
  IMMUTABLE_POINT_CONFLICT: "An immutable index point conflicts with existing data.",
  RESPONSE_INVALID: "The index dependency returned an invalid response.",
  REQUEST_TIMEOUT: "The index dependency timed out.",
  REQUEST_ABORTED: "The index request was cancelled.",
  DEPENDENCY_UNAVAILABLE: "The index dependency is unavailable.",
  DEPENDENCY_REJECTED: "The index dependency rejected the request.",
  RECONCILIATION_LIMIT: "The index reconciliation limit was exceeded.",
  RECONCILIATION_FAILED: "The index dependency did not reconcile the requested mutation.",
});

export type KnowledgeV2HybridIndexErrorCode = keyof typeof errorMessages;

export class KnowledgeV2HybridIndexError extends Error {
  constructor(
    readonly code: KnowledgeV2HybridIndexErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(errorMessages[code]);
    this.name = "KnowledgeV2HybridIndexError";
  }
}

export interface KnowledgeV2DenseVectorSchema {
  vectorName: string;
  schemaVersion: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: "Cosine" | "Dot" | "Euclid";
}

export interface KnowledgeV2SparseVectorSchema {
  vectorName: string;
  schemaVersion: string;
  provider: string;
  model: string;
  maxNonZeroValues: number;
}

export interface KnowledgeV2DenseEmbeddingProvider {
  readonly schema: KnowledgeV2DenseVectorSchema;
  embedBatch(
    input: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ): Promise<readonly { id: string; vector: readonly number[] }[]>;
}

export interface KnowledgeV2SparseEncoder {
  readonly schema: KnowledgeV2SparseVectorSchema;
  encodeBatch(
    input: readonly { id: string; text: string; locale: string }[],
    signal: AbortSignal,
  ): Promise<readonly { id: string; vector: KnowledgeV2SparseVector }[]>;
}

export interface KnowledgeV2SparseVector {
  indices: readonly number[];
  values: readonly number[];
}

export interface KnowledgeV2HybridQdrantConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionPrefix: string;
  dense: KnowledgeV2DenseVectorSchema;
  sparse: KnowledgeV2SparseVectorSchema;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  maxBatchSize: number;
  maxReconcilePoints: number;
}

export interface KnowledgeV2HybridQdrantDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export interface KnowledgeV2IndexPermissionPartition {
  workspaceId: string;
  indexSnapshotId: string;
  permissionFingerprint: string;
  permissionVersion: number;
}

export interface KnowledgeV2HybridPointInput {
  documentId: string;
  revisionId: string;
  chunkId: string;
  locale: string;
  audiences: readonly ("PUBLIC" | "AUTHENTICATED_CUSTOMER" | "INTERNAL")[];
  classification: "PUBLIC" | "INTERNAL" | "CUSTOMER_PERSONAL" | "SENSITIVE" | "SECRET";
  locationIds?: readonly string[];
  brandIds?: readonly string[];
  segmentIds?: readonly string[];
  channelIds?: readonly string[];
  assistantIds?: readonly string[];
  sourceKind: string;
  documentKind: string;
  contentHash: string;
  pipelineVersion: string;
  denseVector: readonly number[];
  sparseVector: KnowledgeV2SparseVector;
}

export type KnowledgeV2HybridPointMetadata = Omit<
  KnowledgeV2HybridPointInput,
  "denseVector" | "sparseVector"
>;

export interface KnowledgeV2PreparedHybridPoint {
  id: string;
  pointFingerprint: string;
}

export interface KnowledgeV2HybridQueryInput {
  workspaceId: string;
  indexSnapshotId: string;
  permissions: readonly { fingerprint: string; version: number }[];
  audiences: readonly ("PUBLIC" | "AUTHENTICATED_CUSTOMER" | "INTERNAL")[];
  classifications: readonly (
    | "PUBLIC"
    | "INTERNAL"
    | "CUSTOMER_PERSONAL"
    | "SENSITIVE"
    | "SECRET"
  )[];
  locales: readonly string[];
  locationIds?: readonly string[];
  brandIds?: readonly string[];
  segmentIds?: readonly string[];
  channelIds?: readonly string[];
  assistantIds?: readonly string[];
  denseVector: readonly number[];
  sparseVector: KnowledgeV2SparseVector;
  candidateLimit: number;
  limit: number;
  signal?: AbortSignal;
}

export interface KnowledgeV2HybridQueryPoint {
  id: string;
  score: number;
  payload: Readonly<Record<string, unknown>>;
}

export interface KnowledgeV2HybridReconcileResult {
  expectedCount: number;
  observedCount: number;
  missingPointIds: string[];
  unexpectedPointIds: string[];
  deletedUnexpectedPointIds: string[];
  consistent: boolean;
}

interface QdrantPayload {
  workspace_id: string;
  index_snapshot_id: string;
  permission_fingerprint: string;
  permission_version: number;
  document_id: string;
  revision_id: string;
  chunk_id: string;
  locale: string;
  audience: string[];
  classification: string;
  location_scope: string[];
  brand_scope: string[];
  segment_scope: string[];
  channel_scope: string[];
  assistant_scope: string[];
  source_kind: string;
  document_kind: string;
  content_hash: string;
  pipeline_version: string;
  dense_schema: string;
  sparse_schema: string;
  point_fingerprint: string;
}

interface PreparedPoint extends KnowledgeV2PreparedHybridPoint {
  vector: Record<string, readonly number[] | KnowledgeV2SparseVector>;
  payload: QdrantPayload;
}

interface QdrantResponse<T> {
  result?: T;
}

interface RequestResult<T> {
  status: number;
  body: T | null;
}

function fail(code: KnowledgeV2HybridIndexErrorCode, retryable = false, status?: number): never {
  throw new KnowledgeV2HybridIndexError(code, retryable, status);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stableValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareKnowledgeCanonicalText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function uuidFromHash(value: string) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const normalized = hex.join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function safeOpaque(value: unknown, maximum = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)
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

function safeHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

function finiteVector(value: readonly number[], dimensions: number) {
  return (
    Array.isArray(value) &&
    value.length === dimensions &&
    value.every(
      (item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1e6,
    )
  );
}

function validSparseVector(value: KnowledgeV2SparseVector, maximumNonZeroValues: number) {
  if (
    !Array.isArray(value.indices) ||
    !Array.isArray(value.values) ||
    value.indices.length !== value.values.length ||
    value.indices.length > maximumNonZeroValues
  ) {
    return false;
  }
  const indices = value.indices as readonly unknown[];
  const values = value.values as readonly unknown[];
  let previous = -1;
  for (let index = 0; index < indices.length; index += 1) {
    const sparseIndex = indices[index];
    const sparseValue = values[index];
    if (
      typeof sparseIndex !== "number" ||
      !Number.isInteger(sparseIndex) ||
      sparseIndex < 0 ||
      sparseIndex > 2_147_483_647 ||
      sparseIndex <= previous ||
      typeof sparseValue !== "number" ||
      !Number.isFinite(sparseValue) ||
      sparseValue === 0 ||
      Math.abs(sparseValue) > 1e6
    ) {
      return false;
    }
    previous = sparseIndex;
  }
  return true;
}

function float32(value: number) {
  const normalized = Math.fround(value);
  return Object.is(normalized, -0) ? 0 : normalized;
}

function canonicalDenseVector(
  value: readonly number[],
  distance: KnowledgeV2DenseVectorSchema["distance"],
) {
  if (distance !== "Cosine") return value.map(float32);
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) fail("INVALID_VECTOR");
  return value.map((item) => float32(item / norm));
}

function canonicalSparseVector(value: KnowledgeV2SparseVector): KnowledgeV2SparseVector {
  return {
    indices: [...value.indices],
    values: value.values.map(float32),
  };
}

function fingerprintFloat(value: number) {
  const normalized = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(normalized, -0) ? 0 : normalized;
}

interface ScopeValuePolicy {
  maximumLength: number;
  validate: (value: string) => boolean;
}

const scopeIdPolicy: ScopeValuePolicy = {
  maximumLength: KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH,
  validate: (value) => safeOpaque(value, KNOWLEDGE_V2_SCOPE_ID_MAXIMUM_LENGTH),
};
const scopeSegmentPolicy: ScopeValuePolicy = {
  maximumLength: KNOWLEDGE_V2_SCOPE_SEGMENT_MAXIMUM_LENGTH,
  validate: isKnowledgeV2ScopeSegment,
};

function normalizedStrings(values: readonly string[] | undefined, policy: ScopeValuePolicy) {
  if (!values || values.length === 0) return [WILDCARD_SCOPE];
  if (
    values.length > KNOWLEDGE_V2_SCOPE_MAXIMUM_VALUES ||
    values.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > policy.maximumLength ||
        value !== value.trim() ||
        value === WILDCARD_SCOPE ||
        !policy.validate(value),
    ) ||
    new Set(values).size !== values.length
  ) {
    fail("INVALID_INPUT");
  }
  return [...values].sort();
}

function authorizedStrings(values: readonly string[] | undefined, policy: ScopeValuePolicy) {
  const normalized = !values || values.length === 0 ? [] : normalizedStrings(values, policy);
  return [WILDCARD_SCOPE, ...normalized];
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requiredString(value: unknown) {
  if (typeof value !== "string") fail("RESPONSE_INVALID");
  return value;
}

function strictStringArray(value: unknown) {
  if (!Array.isArray(value)) fail("RESPONSE_INVALID");
  return (value as readonly unknown[]).map((item) => {
    if (typeof item !== "string") fail("RESPONSE_INVALID");
    return item;
  });
}

function decodedScope(value: unknown) {
  const values = strictStringArray(value);
  if (values.length === 1 && values[0] === WILDCARD_SCOPE) return undefined;
  if (values.length === 0 || values.includes(WILDCARD_SCOPE)) fail("RESPONSE_INVALID");
  return values;
}

function minimalPayload(value: unknown) {
  const payload = record(value);
  if (!payload) fail("RESPONSE_INVALID");
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = Object.keys(payloadIndexes).sort();
  if (stableValue(actualKeys) !== stableValue(expectedKeys)) fail("RESPONSE_INVALID");
  return payload;
}

function queryPayloadAuthorized(
  payload: Record<string, unknown>,
  input: KnowledgeV2HybridQueryInput,
) {
  const intersects = (left: string[], right: readonly string[]) =>
    left.some((value) => right.includes(value));
  return (
    intersects(stringValues(payload.audience), input.audiences) &&
    typeof payload.classification === "string" &&
    input.classifications.includes(
      payload.classification as KnowledgeV2HybridQueryInput["classifications"][number],
    ) &&
    typeof payload.locale === "string" &&
    input.locales.includes(payload.locale) &&
    intersects(
      stringValues(payload.location_scope),
      authorizedStrings(input.locationIds, scopeIdPolicy),
    ) &&
    intersects(
      stringValues(payload.brand_scope),
      authorizedStrings(input.brandIds, scopeIdPolicy),
    ) &&
    intersects(
      stringValues(payload.segment_scope),
      authorizedStrings(input.segmentIds, scopeSegmentPolicy),
    ) &&
    intersects(
      stringValues(payload.channel_scope),
      authorizedStrings(input.channelIds, scopeIdPolicy),
    ) &&
    intersects(
      stringValues(payload.assistant_scope),
      authorizedStrings(input.assistantIds, scopeIdPolicy),
    )
  );
}

function assertSchema(config: KnowledgeV2HybridQdrantConfig) {
  let url: URL;
  try {
    url = new URL(config.qdrantUrl);
  } catch {
    fail("INVALID_CONFIG");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !safeSchemaName(config.collectionPrefix) ||
    !safeSchemaName(config.dense.vectorName) ||
    !safeSchemaName(config.sparse.vectorName) ||
    config.dense.vectorName === config.sparse.vectorName ||
    !safeSchemaName(config.dense.schemaVersion) ||
    !safeSchemaName(config.sparse.schemaVersion) ||
    !safeOpaque(config.dense.provider, 100) ||
    !safeOpaque(config.dense.model, 100) ||
    !safeOpaque(config.sparse.provider, 100) ||
    !safeOpaque(config.sparse.model, 100) ||
    !boundedInteger(config.dense.dimensions, 1, 65_536) ||
    !["Cosine", "Dot", "Euclid"].includes(config.dense.distance) ||
    !boundedInteger(config.sparse.maxNonZeroValues, 1, 65_536) ||
    !boundedInteger(config.requestTimeoutMs, 100, 60_000) ||
    !boundedInteger(config.maxAttempts, 1, 5) ||
    !boundedInteger(config.retryBaseDelayMs, 1, 5_000) ||
    !boundedInteger(config.maxBatchSize, 1, 256) ||
    !boundedInteger(config.maxReconcilePoints, 1, 1_000_000)
  ) {
    fail("INVALID_CONFIG");
  }
}

export function knowledgeV2HybridCollectionName(
  config: Pick<KnowledgeV2HybridQdrantConfig, "collectionPrefix" | "dense" | "sparse">,
) {
  if (!safeSchemaName(config.collectionPrefix)) fail("INVALID_CONFIG");
  const fingerprint = sha256(
    stableValue({
      dense: config.dense,
      sparse: config.sparse,
      transportSchema: "leadvirt-v2-hybrid-qdrant-v1",
    }),
  ).slice(0, 20);
  return `${config.collectionPrefix}__${fingerprint}`;
}

export function assertKnowledgeV2DenseProviderSchema(
  provider: KnowledgeV2DenseEmbeddingProvider,
  expected: KnowledgeV2DenseVectorSchema,
) {
  if (stableValue(provider.schema) !== stableValue(expected)) fail("INVALID_CONFIG");
}

export function assertKnowledgeV2SparseEncoderSchema(
  encoder: KnowledgeV2SparseEncoder,
  expected: KnowledgeV2SparseVectorSchema,
) {
  if (stableValue(encoder.schema) !== stableValue(expected)) fail("INVALID_CONFIG");
}

export function validateKnowledgeV2DenseEmbeddingBatch(
  schema: KnowledgeV2DenseVectorSchema,
  requestedIds: readonly string[],
  output: readonly { id: string; vector: readonly number[] }[],
) {
  if (
    new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => !safeOpaque(id)) ||
    output.length !== requestedIds.length ||
    new Set(output.map((item) => item.id)).size !== output.length ||
    output.some(
      (item) => !requestedIds.includes(item.id) || !finiteVector(item.vector, schema.dimensions),
    )
  ) {
    fail("INVALID_VECTOR");
  }
}

export function validateKnowledgeV2SparseEncodingBatch(
  schema: KnowledgeV2SparseVectorSchema,
  requestedIds: readonly string[],
  output: readonly { id: string; vector: KnowledgeV2SparseVector }[],
) {
  if (
    new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => !safeOpaque(id)) ||
    output.length !== requestedIds.length ||
    new Set(output.map((item) => item.id)).size !== output.length ||
    output.some(
      (item) =>
        !requestedIds.includes(item.id) || !validSparseVector(item.vector, schema.maxNonZeroValues),
    )
  ) {
    fail("INVALID_VECTOR");
  }
}

function assertPartition(scope: KnowledgeV2IndexPermissionPartition) {
  if (
    !safeOpaque(scope.workspaceId) ||
    !safeOpaque(scope.indexSnapshotId) ||
    !safeHash(scope.permissionFingerprint) ||
    !boundedInteger(scope.permissionVersion, 1, 2_147_483_647)
  ) {
    fail("INVALID_INPUT");
  }
}

function partitionConditions(scope: KnowledgeV2IndexPermissionPartition) {
  assertPartition(scope);
  return [
    { key: "workspace_id", match: { value: scope.workspaceId } },
    { key: "index_snapshot_id", match: { value: scope.indexSnapshotId } },
    { key: "permission_fingerprint", match: { value: scope.permissionFingerprint } },
    { key: "permission_version", match: { value: scope.permissionVersion } },
  ];
}

function payloadMatchesPartition(
  payload: Record<string, unknown>,
  scope: KnowledgeV2IndexPermissionPartition,
) {
  return (
    payload.workspace_id === scope.workspaceId &&
    payload.index_snapshot_id === scope.indexSnapshotId &&
    payload.permission_fingerprint === scope.permissionFingerprint &&
    payload.permission_version === scope.permissionVersion
  );
}

function normalizedPointAudiences(
  value: unknown,
): Array<KnowledgeV2HybridPointInput["audiences"][number]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) fail("INVALID_INPUT");
  const parsed = value.map((audience): KnowledgeV2HybridPointInput["audiences"][number] => {
    if (
      typeof audience !== "string" ||
      !["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"].includes(audience)
    ) {
      fail("INVALID_INPUT");
    }
    return audience as KnowledgeV2HybridPointInput["audiences"][number];
  });
  if (new Set(parsed).size !== parsed.length) fail("INVALID_INPUT");
  return parsed.sort();
}

function normalizedPointMetadata(point: KnowledgeV2HybridPointMetadata) {
  const audiences = normalizedPointAudiences(point.audiences);
  if (
    !safeOpaque(point.documentId) ||
    !safeOpaque(point.revisionId) ||
    !safeOpaque(point.chunkId) ||
    !safeOpaque(point.locale, 35) ||
    !["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL", "SENSITIVE", "SECRET"].includes(
      point.classification,
    ) ||
    !safeOpaque(point.sourceKind, 100) ||
    !safeOpaque(point.documentKind, 100) ||
    !safeHash(point.contentHash) ||
    !safeSchemaName(point.pipelineVersion)
  ) {
    fail("INVALID_INPUT");
  }
  return {
    documentId: point.documentId,
    revisionId: point.revisionId,
    chunkId: point.chunkId,
    locale: point.locale,
    audiences,
    classification: point.classification,
    locationScope: normalizedStrings(point.locationIds, scopeIdPolicy),
    brandScope: normalizedStrings(point.brandIds, scopeIdPolicy),
    segmentScope: normalizedStrings(point.segmentIds, scopeSegmentPolicy),
    channelScope: normalizedStrings(point.channelIds, scopeIdPolicy),
    assistantScope: normalizedStrings(point.assistantIds, scopeIdPolicy),
    sourceKind: point.sourceKind,
    documentKind: point.documentKind,
    contentHash: point.contentHash,
    pipelineVersion: point.pipelineVersion,
  };
}

export function validateKnowledgeV2HybridPointMetadata(point: KnowledgeV2HybridPointMetadata) {
  normalizedPointMetadata(point);
}

function qdrantRetryableStatus(status: number) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
  );
}

export class KnowledgeV2HybridQdrantClient {
  readonly physicalCollectionName: string;
  readonly runtimeSchema: {
    dense: KnowledgeV2DenseVectorSchema;
    sparse: KnowledgeV2SparseVectorSchema;
  };
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly baseUrl: string;

  constructor(
    private readonly config: KnowledgeV2HybridQdrantConfig,
    dependencies: KnowledgeV2HybridQdrantDependencies = {},
  ) {
    assertSchema(config);
    this.physicalCollectionName = knowledgeV2HybridCollectionName(config);
    this.runtimeSchema = Object.freeze({
      dense: Object.freeze({ ...config.dense }),
      sparse: Object.freeze({ ...config.sparse }),
    });
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = dependencies.random ?? Math.random;
    this.baseUrl = config.qdrantUrl.replace(/\/+$/u, "");
  }

  async ensurePhysicalCollection(signal?: AbortSignal) {
    const path = `/collections/${this.physicalCollectionName}`;
    let existing = await this.request<QdrantResponse<unknown>>(
      path,
      { method: "GET" },
      { acceptedStatuses: [404], signal },
    );
    if (existing.status === 404) {
      const created = await this.request<QdrantResponse<unknown>>(
        path,
        {
          method: "PUT",
          body: JSON.stringify({
            vectors: {
              [this.config.dense.vectorName]: {
                size: this.config.dense.dimensions,
                distance: this.config.dense.distance,
                on_disk: true,
              },
            },
            sparse_vectors: {
              [this.config.sparse.vectorName]: { index: { on_disk: true } },
            },
            strict_mode_config: {
              enabled: true,
              sparse_config: {
                [this.config.sparse.vectorName]: {
                  max_length: this.config.sparse.maxNonZeroValues,
                },
              },
            },
          }),
        },
        { acceptedStatuses: [409], signal },
      );
      if (created.status === 409) {
        existing = await this.request(path, { method: "GET" }, { signal });
      } else {
        existing = await this.request(path, { method: "GET" }, { signal });
      }
    }
    this.assertCollectionResponse(existing.body);
    for (const [fieldName, fieldSchema] of Object.entries(payloadIndexes)) {
      await this.request(
        `/collections/${this.physicalCollectionName}/index?wait=true&ordering=strong`,
        {
          method: "PUT",
          body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
        },
        { acceptedStatuses: [409], signal },
      );
    }
    return {
      physicalCollectionName: this.physicalCollectionName,
      denseVectorName: this.config.dense.vectorName,
      sparseVectorName: this.config.sparse.vectorName,
    };
  }

  preparePoint(
    scope: KnowledgeV2IndexPermissionPartition,
    point: KnowledgeV2HybridPointInput,
  ): KnowledgeV2PreparedHybridPoint {
    return this.prepare(scope, point);
  }

  async upsertSnapshotPoints(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    points: readonly KnowledgeV2HybridPointInput[];
    signal?: AbortSignal;
  }) {
    assertPartition(input.scope);
    const prepared = input.points.map((point) => this.prepare(input.scope, point));
    if (new Set(prepared.map((point) => point.id)).size !== prepared.length) {
      fail("INVALID_INPUT");
    }
    let upserted = 0;
    let unchanged = 0;
    let batches = 0;
    for (let offset = 0; offset < prepared.length; offset += this.config.maxBatchSize) {
      const batch = prepared.slice(offset, offset + this.config.maxBatchSize);
      const existing = await this.retrievePoints(
        input.scope,
        batch.map((point) => point.id),
        input.signal,
      );
      const existingById = new Map(existing.map((point) => [point.id, point.payload]));
      const pending = batch.filter((point) => {
        const payload = existingById.get(point.id);
        if (!payload) return true;
        if (
          !payloadMatchesPartition(payload, input.scope) ||
          payload.point_fingerprint !== point.pointFingerprint
        ) {
          fail("IMMUTABLE_POINT_CONFLICT");
        }
        unchanged += 1;
        return false;
      });
      if (pending.length === 0) continue;
      await this.request(
        `/collections/${this.physicalCollectionName}/points?wait=true&ordering=strong`,
        {
          method: "PUT",
          body: JSON.stringify({
            points: pending.map((point) => ({
              id: point.id,
              vector: point.vector,
              payload: point.payload,
            })),
          }),
        },
        { signal: input.signal },
      );
      upserted += pending.length;
      batches += 1;
    }
    return {
      requested: prepared.length,
      upserted,
      unchanged,
      batches,
      points: prepared.map(({ id, pointFingerprint }) => ({ id, pointFingerprint })),
    };
  }

  async deletePointIds(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    pointIds: readonly string[];
    signal?: AbortSignal;
  }) {
    assertPartition(input.scope);
    const pointIds = [...new Set(input.pointIds)];
    if (pointIds.some((pointId) => !uuid(pointId))) fail("INVALID_INPUT");
    let batches = 0;
    for (let offset = 0; offset < pointIds.length; offset += this.config.maxBatchSize) {
      const batch = pointIds.slice(offset, offset + this.config.maxBatchSize);
      await this.deleteByFilter(
        {
          must: [...partitionConditions(input.scope), { has_id: batch }],
        },
        input.signal,
      );
      batches += 1;
    }
    const remaining = await this.retrievePoints(input.scope, pointIds, input.signal);
    if (remaining.length > 0) fail("RECONCILIATION_FAILED", true);
    return { deleted: pointIds.length, batches };
  }

  async deletePermissionPartition(
    scope: KnowledgeV2IndexPermissionPartition,
    signal?: AbortSignal,
  ) {
    await this.deleteByFilter({ must: partitionConditions(scope) }, signal);
    if ((await this.countPermissionPartition(scope, signal)) !== 0) {
      fail("RECONCILIATION_FAILED", true);
    }
  }

  async deleteSnapshotPartition(input: {
    workspaceId: string;
    indexSnapshotId: string;
    signal?: AbortSignal;
  }) {
    if (!safeOpaque(input.workspaceId) || !safeOpaque(input.indexSnapshotId)) {
      fail("INVALID_INPUT");
    }
    await this.deleteByFilter(
      {
        must: [
          { key: "workspace_id", match: { value: input.workspaceId } },
          { key: "index_snapshot_id", match: { value: input.indexSnapshotId } },
        ],
      },
      input.signal,
    );
    if ((await this.countSnapshotPartition(input, input.signal)) !== 0) {
      fail("RECONCILIATION_FAILED", true);
    }
  }

  async countPermissionPartition(
    scope: KnowledgeV2IndexPermissionPartition,
    signal?: AbortSignal,
  ): Promise<number> {
    const response = await this.request<QdrantResponse<{ count?: unknown }>>(
      `/collections/${this.physicalCollectionName}/points/count`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: { must: partitionConditions(scope) },
          exact: true,
        }),
      },
      { signal },
    );
    const count = record(response.body)?.result;
    const parsed = record(count)?.count;
    if (!boundedInteger(parsed, 0, Number.MAX_SAFE_INTEGER)) fail("RESPONSE_INVALID");
    return parsed as number;
  }

  async reconcilePermissionPartition(input: {
    scope: KnowledgeV2IndexPermissionPartition;
    expected: readonly KnowledgeV2PreparedHybridPoint[];
    deleteUnexpected?: boolean;
    signal?: AbortSignal;
  }): Promise<KnowledgeV2HybridReconcileResult> {
    assertPartition(input.scope);
    const expected = new Map<string, string>();
    for (const point of input.expected) {
      if (!uuid(point.id) || !safeHash(point.pointFingerprint) || expected.has(point.id)) {
        fail("INVALID_INPUT");
      }
      expected.set(point.id, point.pointFingerprint);
    }
    const observed = await this.scrollPermissionPartition(input.scope, input.signal);
    const observedIds = new Set<string>();
    for (const point of observed) {
      if (observedIds.has(point.id)) fail("RESPONSE_INVALID");
      observedIds.add(point.id);
      const expectedFingerprint = expected.get(point.id);
      if (expectedFingerprint && point.payload.point_fingerprint !== expectedFingerprint) {
        fail("IMMUTABLE_POINT_CONFLICT");
      }
    }
    const missingPointIds = [...expected.keys()].filter((id) => !observedIds.has(id)).sort();
    const unexpectedPointIds = [...observedIds].filter((id) => !expected.has(id)).sort();
    let deletedUnexpectedPointIds: string[] = [];
    let reconciledObservedCount = observed.length;
    if (input.deleteUnexpected && unexpectedPointIds.length > 0) {
      await this.deletePointIds({
        scope: input.scope,
        pointIds: unexpectedPointIds,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      deletedUnexpectedPointIds = unexpectedPointIds;
      reconciledObservedCount = await this.countPermissionPartition(input.scope, input.signal);
    }
    return {
      expectedCount: expected.size,
      observedCount: reconciledObservedCount,
      missingPointIds,
      unexpectedPointIds,
      deletedUnexpectedPointIds,
      consistent:
        missingPointIds.length === 0 &&
        reconciledObservedCount === expected.size &&
        (unexpectedPointIds.length === 0 ||
          deletedUnexpectedPointIds.length === unexpectedPointIds.length),
    };
  }

  async queryHybrid(input: KnowledgeV2HybridQueryInput) {
    this.assertQuery(input);
    const filter = queryFilter(input);
    const response = await this.request<QdrantResponse<{ points?: unknown[] } | unknown[]>>(
      `/collections/${this.physicalCollectionName}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          prefetch: [
            {
              query: input.denseVector,
              using: this.config.dense.vectorName,
              filter,
              limit: input.candidateLimit,
            },
            {
              query: input.sparseVector,
              using: this.config.sparse.vectorName,
              filter,
              limit: input.candidateLimit,
            },
          ],
          query: { fusion: "rrf" },
          filter,
          limit: input.limit,
          with_payload: true,
          with_vector: false,
        }),
      },
      { signal: input.signal },
    );
    const result = record(response.body)?.result;
    const rawPoints = Array.isArray(result) ? result : record(result)?.points;
    if (!Array.isArray(rawPoints)) fail("RESPONSE_INVALID");
    return rawPoints.map((value): KnowledgeV2HybridQueryPoint => {
      const point = record(value);
      const payload = minimalPayload(point?.payload);
      const id = point?.id;
      const score = point?.score;
      if (
        !uuid(typeof id === "number" ? String(id) : id) ||
        typeof score !== "number" ||
        !Number.isFinite(score) ||
        payload.workspace_id !== input.workspaceId ||
        payload.index_snapshot_id !== input.indexSnapshotId ||
        !input.permissions.some(
          (permission) =>
            payload.permission_fingerprint === permission.fingerprint &&
            payload.permission_version === permission.version,
        ) ||
        !queryPayloadAuthorized(payload, input)
      ) {
        fail("RESPONSE_INVALID");
      }
      return { id: String(id), score, payload };
    });
  }

  private prepare(
    scope: KnowledgeV2IndexPermissionPartition,
    point: KnowledgeV2HybridPointInput,
  ): PreparedPoint {
    assertPartition(scope);
    if (
      !finiteVector(point.denseVector, this.config.dense.dimensions) ||
      !validSparseVector(point.sparseVector, this.config.sparse.maxNonZeroValues)
    ) {
      fail("INVALID_VECTOR");
    }
    const normalized = normalizedPointMetadata(point);
    const denseVector = canonicalDenseVector(point.denseVector, this.config.dense.distance);
    const sparseVector = canonicalSparseVector(point.sparseVector);
    const pointFingerprint = sha256(
      stableValue({
        scope,
        metadata: normalized,
        denseVector: denseVector.map(fingerprintFloat),
        sparseVector: {
          indices: sparseVector.indices,
          values: sparseVector.values.map(fingerprintFloat),
        },
        denseSchema: this.config.dense,
        sparseSchema: this.config.sparse,
      }),
    );
    const id = uuidFromHash(
      stableValue({
        workspaceId: scope.workspaceId,
        indexSnapshotId: scope.indexSnapshotId,
        chunkId: point.chunkId,
        denseSchema: this.config.dense.schemaVersion,
        sparseSchema: this.config.sparse.schemaVersion,
      }),
    );
    return {
      id,
      pointFingerprint,
      vector: {
        [this.config.dense.vectorName]: denseVector,
        [this.config.sparse.vectorName]: sparseVector,
      },
      payload: {
        workspace_id: scope.workspaceId,
        index_snapshot_id: scope.indexSnapshotId,
        permission_fingerprint: scope.permissionFingerprint,
        permission_version: scope.permissionVersion,
        document_id: normalized.documentId,
        revision_id: normalized.revisionId,
        chunk_id: normalized.chunkId,
        locale: normalized.locale,
        audience: normalized.audiences,
        classification: normalized.classification,
        location_scope: normalized.locationScope,
        brand_scope: normalized.brandScope,
        segment_scope: normalized.segmentScope,
        channel_scope: normalized.channelScope,
        assistant_scope: normalized.assistantScope,
        source_kind: normalized.sourceKind,
        document_kind: normalized.documentKind,
        content_hash: normalized.contentHash,
        pipeline_version: normalized.pipelineVersion,
        dense_schema: this.config.dense.schemaVersion,
        sparse_schema: this.config.sparse.schemaVersion,
        point_fingerprint: pointFingerprint,
      },
    };
  }

  private assertCollectionResponse(value: unknown) {
    const result = record(record(value)?.result);
    const config = record(result?.config);
    const params = record(config?.params);
    const vectors = record(params?.vectors);
    const sparseVectors = record(params?.sparse_vectors);
    const dense = record(vectors?.[this.config.dense.vectorName]);
    const sparse = record(sparseVectors?.[this.config.sparse.vectorName]);
    const sparseIndex = record(sparse?.index);
    const strict = record(config?.strict_mode_config);
    const strictSparse = record(record(strict?.sparse_config)?.[this.config.sparse.vectorName]);
    if (
      !vectors ||
      !sparseVectors ||
      Object.keys(vectors).length !== 1 ||
      Object.keys(sparseVectors).length !== 1 ||
      !dense ||
      dense.size !== this.config.dense.dimensions ||
      dense.distance !== this.config.dense.distance ||
      dense.on_disk !== true ||
      !sparse ||
      sparseIndex?.on_disk !== true ||
      strict?.enabled !== true ||
      strictSparse?.max_length !== this.config.sparse.maxNonZeroValues
    ) {
      fail("COLLECTION_SCHEMA_MISMATCH");
    }
  }

  private async retrievePoints(
    scope: KnowledgeV2IndexPermissionPartition,
    ids: string[],
    signal?: AbortSignal,
  ) {
    if (ids.length === 0) return [];
    const response = await this.request<QdrantResponse<unknown[]>>(
      `/collections/${this.physicalCollectionName}/points`,
      {
        method: "POST",
        body: JSON.stringify({
          ids,
          with_payload: true,
          with_vector: [this.config.dense.vectorName, this.config.sparse.vectorName],
        }),
      },
      { signal },
    );
    const values = record(response.body)?.result;
    if (!Array.isArray(values)) fail("RESPONSE_INVALID");
    return values.map((value) => this.validateRemotePoint(value, scope));
  }

  private async scrollPermissionPartition(
    scope: KnowledgeV2IndexPermissionPartition,
    signal?: AbortSignal,
  ) {
    const points: Array<{ id: string; payload: Record<string, unknown> }> = [];
    let offset: string | number | undefined;
    do {
      const response = await this.request<
        QdrantResponse<{ points?: unknown[]; next_page_offset?: unknown }>
      >(
        `/collections/${this.physicalCollectionName}/points/scroll`,
        {
          method: "POST",
          body: JSON.stringify({
            filter: { must: partitionConditions(scope) },
            limit: Math.min(256, this.config.maxReconcilePoints),
            ...(offset === undefined ? {} : { offset }),
            with_payload: true,
            with_vector: [this.config.dense.vectorName, this.config.sparse.vectorName],
          }),
        },
        { signal },
      );
      const result = record(record(response.body)?.result);
      if (!result || !Array.isArray(result.points)) fail("RESPONSE_INVALID");
      for (const value of result.points) {
        points.push(this.validateRemotePoint(value, scope));
        if (points.length > this.config.maxReconcilePoints) fail("RECONCILIATION_LIMIT");
      }
      const next = result.next_page_offset;
      if (next === null || next === undefined) offset = undefined;
      else if (typeof next === "string" || typeof next === "number") offset = next;
      else fail("RESPONSE_INVALID");
    } while (offset !== undefined);
    return points;
  }

  private validateRemotePoint(value: unknown, scope: KnowledgeV2IndexPermissionPartition) {
    const point = record(value);
    const id = point?.id;
    const pointId = typeof id === "number" ? String(id) : id;
    const payload = minimalPayload(point?.payload);
    const vector = record(point?.vector);
    const denseRaw = vector?.[this.config.dense.vectorName];
    const sparseRaw = record(vector?.[this.config.sparse.vectorName]);
    const indicesRaw = sparseRaw?.indices;
    const valuesRaw = sparseRaw?.values;
    if (
      !uuid(pointId) ||
      !payloadMatchesPartition(payload, scope) ||
      !Array.isArray(denseRaw) ||
      !Array.isArray(indicesRaw) ||
      !Array.isArray(valuesRaw)
    ) {
      fail("RESPONSE_INVALID");
    }
    const denseVector = (denseRaw as readonly unknown[]).map((item) => {
      if (typeof item !== "number") fail("RESPONSE_INVALID");
      return item;
    });
    const sparseIndices = (indicesRaw as readonly unknown[]).map((item) => {
      if (typeof item !== "number") fail("RESPONSE_INVALID");
      return item;
    });
    const sparseValues = (valuesRaw as readonly unknown[]).map((item) => {
      if (typeof item !== "number") fail("RESPONSE_INVALID");
      return item;
    });
    const audiences = strictStringArray(payload.audience);
    const locationIds = decodedScope(payload.location_scope);
    const brandIds = decodedScope(payload.brand_scope);
    const segmentIds = decodedScope(payload.segment_scope);
    const channelIds = decodedScope(payload.channel_scope);
    const assistantIds = decodedScope(payload.assistant_scope);
    const prepared = this.prepare(scope, {
      documentId: requiredString(payload.document_id),
      revisionId: requiredString(payload.revision_id),
      chunkId: requiredString(payload.chunk_id),
      locale: requiredString(payload.locale),
      audiences: audiences as KnowledgeV2HybridPointInput["audiences"],
      classification: requiredString(
        payload.classification,
      ) as KnowledgeV2HybridPointInput["classification"],
      ...(locationIds ? { locationIds } : {}),
      ...(brandIds ? { brandIds } : {}),
      ...(segmentIds ? { segmentIds } : {}),
      ...(channelIds ? { channelIds } : {}),
      ...(assistantIds ? { assistantIds } : {}),
      sourceKind: requiredString(payload.source_kind),
      documentKind: requiredString(payload.document_kind),
      contentHash: requiredString(payload.content_hash),
      pipelineVersion: requiredString(payload.pipeline_version),
      denseVector,
      sparseVector: { indices: sparseIndices, values: sparseValues },
    });
    const preparedMetadata = Object.fromEntries(
      Object.entries(prepared.payload).filter(([key]) => key !== "point_fingerprint"),
    );
    const { point_fingerprint: remoteFingerprint, ...remoteMetadata } = payload;
    if (
      prepared.id !== pointId ||
      !safeHash(remoteFingerprint) ||
      prepared.pointFingerprint !== remoteFingerprint ||
      stableValue(preparedMetadata) !== stableValue(remoteMetadata)
    ) {
      fail("IMMUTABLE_POINT_CONFLICT");
    }
    return { id: pointId, payload };
  }

  private async deleteByFilter(filter: unknown, signal?: AbortSignal) {
    const response = await this.request<QdrantResponse<unknown>>(
      `/collections/${this.physicalCollectionName}/points/delete?wait=true&ordering=strong`,
      { method: "POST", body: JSON.stringify({ filter }) },
      { signal },
    );
    const body = record(response.body);
    const result = record(body?.result);
    if (
      body?.status !== "ok" ||
      !result ||
      !["acknowledged", "completed"].includes(String(result.status))
    ) {
      fail("RESPONSE_INVALID");
    }
  }

  private async countSnapshotPartition(
    input: { workspaceId: string; indexSnapshotId: string },
    signal?: AbortSignal,
  ) {
    const response = await this.request<QdrantResponse<{ count?: unknown }>>(
      `/collections/${this.physicalCollectionName}/points/count`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            must: [
              { key: "workspace_id", match: { value: input.workspaceId } },
              { key: "index_snapshot_id", match: { value: input.indexSnapshotId } },
            ],
          },
          exact: true,
        }),
      },
      { signal },
    );
    const count = record(record(response.body)?.result)?.count;
    if (!boundedInteger(count, 0, Number.MAX_SAFE_INTEGER)) fail("RESPONSE_INVALID");
    return count as number;
  }

  private assertQuery(input: KnowledgeV2HybridQueryInput) {
    if (
      !safeOpaque(input.workspaceId) ||
      !safeOpaque(input.indexSnapshotId) ||
      input.permissions.length === 0 ||
      input.permissions.length > 64 ||
      input.permissions.some(
        (permission) =>
          !safeHash(permission.fingerprint) ||
          !boundedInteger(permission.version, 1, 2_147_483_647),
      ) ||
      input.audiences.length === 0 ||
      input.classifications.length === 0 ||
      input.locales.length === 0 ||
      input.locales.some((locale) => !safeOpaque(locale, 35)) ||
      !finiteVector(input.denseVector, this.config.dense.dimensions) ||
      !validSparseVector(input.sparseVector, this.config.sparse.maxNonZeroValues) ||
      !boundedInteger(input.candidateLimit, 1, 200) ||
      !boundedInteger(input.limit, 1, input.candidateLimit)
    ) {
      fail(
        finiteVector(input.denseVector, this.config.dense.dimensions) &&
          validSparseVector(input.sparseVector, this.config.sparse.maxNonZeroValues)
          ? "INVALID_INPUT"
          : "INVALID_VECTOR",
      );
    }
    normalizedStrings(input.locationIds, scopeIdPolicy);
    normalizedStrings(input.brandIds, scopeIdPolicy);
    normalizedStrings(input.segmentIds, scopeSegmentPolicy);
    normalizedStrings(input.channelIds, scopeIdPolicy);
    normalizedStrings(input.assistantIds, scopeIdPolicy);
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: { acceptedStatuses?: number[]; signal?: AbortSignal | undefined } = {},
  ): Promise<RequestResult<T>> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      if (options.signal?.aborted) fail("REQUEST_ABORTED");
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(this.config.qdrantApiKey ? { "api-key": this.config.qdrantApiKey } : {}),
            ...(init.headers ?? {}),
          },
        });
        const accepted = options.acceptedStatuses?.includes(response.status) ?? false;
        if (!response.ok && !accepted) {
          if (qdrantRetryableStatus(response.status) && attempt < this.config.maxAttempts) {
            await this.retryDelay(attempt, response.headers.get("retry-after"));
            continue;
          }
          fail(
            qdrantRetryableStatus(response.status)
              ? "DEPENDENCY_UNAVAILABLE"
              : "DEPENDENCY_REJECTED",
            qdrantRetryableStatus(response.status),
            response.status,
          );
        }
        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_CHARACTERS) {
          fail("RESPONSE_INVALID");
        }
        const text = await response.text();
        if (text.length > MAX_RESPONSE_CHARACTERS) fail("RESPONSE_INVALID");
        let body: T | null = null;
        if (text) {
          try {
            body = JSON.parse(text) as T;
          } catch {
            fail("RESPONSE_INVALID");
          }
        }
        return { status: response.status, body };
      } catch (error) {
        if (error instanceof KnowledgeV2HybridIndexError) throw error;
        if (options.signal?.aborted) fail("REQUEST_ABORTED");
        if (attempt < this.config.maxAttempts) {
          await this.retryDelay(attempt, null);
          continue;
        }
        fail(timedOut ? "REQUEST_TIMEOUT" : "DEPENDENCY_UNAVAILABLE", true);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      }
    }
    fail("DEPENDENCY_UNAVAILABLE", true);
  }

  private async retryDelay(attempt: number, retryAfter: string | null) {
    const retryAfterMilliseconds = retryAfter ? Number(retryAfter) * 1_000 : Number.NaN;
    const maximum = Math.min(
      5_000,
      Number.isFinite(retryAfterMilliseconds) && retryAfterMilliseconds >= 0
        ? retryAfterMilliseconds
        : this.config.retryBaseDelayMs * 2 ** Math.min(attempt - 1, 5),
    );
    const random = this.random();
    const boundedRandom = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
    await this.sleep(Math.floor(maximum * boundedRandom));
  }
}

const payloadIndexes = Object.freeze({
  workspace_id: "keyword",
  index_snapshot_id: "keyword",
  permission_fingerprint: "keyword",
  permission_version: "integer",
  document_id: "keyword",
  revision_id: "keyword",
  chunk_id: "keyword",
  locale: "keyword",
  audience: "keyword",
  classification: "keyword",
  location_scope: "keyword",
  brand_scope: "keyword",
  segment_scope: "keyword",
  channel_scope: "keyword",
  assistant_scope: "keyword",
  source_kind: "keyword",
  document_kind: "keyword",
  content_hash: "keyword",
  pipeline_version: "keyword",
  dense_schema: "keyword",
  sparse_schema: "keyword",
  point_fingerprint: "keyword",
});

function queryFilter(input: KnowledgeV2HybridQueryInput) {
  const exact = [
    { key: "workspace_id", match: { value: input.workspaceId } },
    { key: "index_snapshot_id", match: { value: input.indexSnapshotId } },
  ];
  const permissions = input.permissions.map((permission) => ({
    must: [
      { key: "permission_fingerprint", match: { value: permission.fingerprint } },
      { key: "permission_version", match: { value: permission.version } },
    ],
  }));
  return {
    must: [
      ...exact,
      { key: "audience", match: { any: [...new Set(input.audiences)] } },
      { key: "classification", match: { any: [...new Set(input.classifications)] } },
      { key: "locale", match: { any: [...new Set(input.locales)] } },
      {
        key: "location_scope",
        match: { any: authorizedStrings(input.locationIds, scopeIdPolicy) },
      },
      {
        key: "brand_scope",
        match: { any: authorizedStrings(input.brandIds, scopeIdPolicy) },
      },
      {
        key: "segment_scope",
        match: { any: authorizedStrings(input.segmentIds, scopeSegmentPolicy) },
      },
      {
        key: "channel_scope",
        match: { any: authorizedStrings(input.channelIds, scopeIdPolicy) },
      },
      {
        key: "assistant_scope",
        match: { any: authorizedStrings(input.assistantIds, scopeIdPolicy) },
      },
    ],
    should: permissions,
  };
}
