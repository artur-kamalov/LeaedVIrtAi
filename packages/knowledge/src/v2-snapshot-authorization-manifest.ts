import { hashKnowledgeValue } from "./legacy-hash-embedding.js";
import { stableKnowledgeValue } from "./publisher.js";

export const KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION = 1 as const;
export const KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS = 512;
export const KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS = 100_000;

const maximumIdLength = 200;
const maximumGeneration = 2_147_483_647;
const sha256 = /^[a-f0-9]{64}$/u;
const opaqueId = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;

export interface KnowledgeV2SnapshotAuthorizationMembershipItem {
  chunkId: string;
  documentId: string;
  revisionId: string;
  contentHash: string;
  vectorPointId: string;
  pointFingerprint: string;
}

export interface KnowledgeV2SnapshotAuthorizationPoint extends KnowledgeV2SnapshotAuthorizationMembershipItem {
  sourceId: string;
  sourceGeneration: number;
  authorizationFingerprint: string;
  permissionVersion: number;
}

export interface KnowledgeV2SnapshotAuthorizationPartition {
  sourceId: string;
  sourceGeneration: number;
  authorizationFingerprint: string;
  permissionVersion: number;
  revisionIds: string[];
  pointCount: number;
  membershipHash: string;
}

export interface KnowledgeV2SnapshotAuthorizationManifest {
  version: typeof KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION;
  tenantId: string;
  snapshotId: string;
  snapshotManifestHash: string;
  indexSchemaHash: string;
  expectedPointCount: number;
  revisionIds: string[];
  partitions: KnowledgeV2SnapshotAuthorizationPartition[];
}

export interface BuildKnowledgeV2SnapshotAuthorizationManifestInput {
  tenantId: string;
  snapshotId: string;
  snapshotManifestHash: string;
  indexSchemaHash: string;
  points: readonly KnowledgeV2SnapshotAuthorizationPoint[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumIdLength &&
    opaqueId.test(value)
  );
}

function safeHash(value: unknown): value is string {
  return typeof value === "string" && sha256.test(value);
}

function positiveInteger(value: unknown, maximum = maximumGeneration): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueIds(value: unknown, maximum: number): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) return false;
  let previous: string | null = null;
  for (const item of value) {
    if (!safeId(item) || (previous !== null && compareCanonicalText(previous, item) >= 0)) {
      return false;
    }
    previous = item;
  }
  return true;
}

function compareMembership(
  left: KnowledgeV2SnapshotAuthorizationMembershipItem,
  right: KnowledgeV2SnapshotAuthorizationMembershipItem,
) {
  return (
    compareCanonicalText(left.chunkId, right.chunkId) ||
    compareCanonicalText(left.documentId, right.documentId) ||
    compareCanonicalText(left.revisionId, right.revisionId) ||
    compareCanonicalText(left.contentHash, right.contentHash) ||
    compareCanonicalText(left.vectorPointId, right.vectorPointId) ||
    compareCanonicalText(left.pointFingerprint, right.pointFingerprint)
  );
}

function comparePartitions(
  left: KnowledgeV2SnapshotAuthorizationPartition,
  right: KnowledgeV2SnapshotAuthorizationPartition,
) {
  return (
    compareCanonicalText(left.authorizationFingerprint, right.authorizationFingerprint) ||
    left.permissionVersion - right.permissionVersion ||
    compareCanonicalText(left.sourceId, right.sourceId)
  );
}

function membershipHash(items: readonly KnowledgeV2SnapshotAuthorizationMembershipItem[]) {
  return hashKnowledgeValue(
    stableKnowledgeValue({
      version: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
      items: [...items].sort(compareMembership),
    }),
  );
}

export function knowledgeV2SnapshotAuthorizationManifestHash(
  manifest: KnowledgeV2SnapshotAuthorizationManifest,
) {
  return hashKnowledgeValue(stableKnowledgeValue(manifest));
}

export function parseKnowledgeV2SnapshotAuthorizationManifest(
  value: unknown,
  expectedHash: unknown,
): KnowledgeV2SnapshotAuthorizationManifest | null {
  const manifest = record(value);
  if (
    !manifest ||
    !safeHash(expectedHash) ||
    !exactKeys(manifest, [
      "version",
      "tenantId",
      "snapshotId",
      "snapshotManifestHash",
      "indexSchemaHash",
      "expectedPointCount",
      "revisionIds",
      "partitions",
    ]) ||
    manifest.version !== KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION ||
    !safeId(manifest.tenantId) ||
    !safeId(manifest.snapshotId) ||
    !safeHash(manifest.snapshotManifestHash) ||
    !safeHash(manifest.indexSchemaHash) ||
    !positiveInteger(
      manifest.expectedPointCount,
      KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS,
    ) ||
    !sortedUniqueIds(manifest.revisionIds, KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS) ||
    !Array.isArray(manifest.partitions) ||
    manifest.partitions.length === 0 ||
    manifest.partitions.length > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS
  ) {
    return null;
  }

  const partitions: KnowledgeV2SnapshotAuthorizationPartition[] = [];
  const partitionKeys = new Set<string>();
  const partitionSourceIds = new Set<string>();
  const partitionRevisionIds = new Set<string>();
  let pointCount = 0;
  for (const raw of manifest.partitions) {
    const partition = record(raw);
    if (
      !partition ||
      !exactKeys(partition, [
        "sourceId",
        "sourceGeneration",
        "authorizationFingerprint",
        "permissionVersion",
        "revisionIds",
        "pointCount",
        "membershipHash",
      ]) ||
      !safeId(partition.sourceId) ||
      !positiveInteger(partition.sourceGeneration) ||
      !safeHash(partition.authorizationFingerprint) ||
      !positiveInteger(partition.permissionVersion) ||
      !sortedUniqueIds(partition.revisionIds, KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS) ||
      !positiveInteger(partition.pointCount, KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS) ||
      partition.pointCount < partition.revisionIds.length ||
      !safeHash(partition.membershipHash)
    ) {
      return null;
    }
    const parsed: KnowledgeV2SnapshotAuthorizationPartition = {
      sourceId: partition.sourceId,
      sourceGeneration: partition.sourceGeneration,
      authorizationFingerprint: partition.authorizationFingerprint,
      permissionVersion: partition.permissionVersion,
      revisionIds: [...partition.revisionIds],
      pointCount: partition.pointCount,
      membershipHash: partition.membershipHash,
    };
    const key = `${parsed.authorizationFingerprint}:${parsed.permissionVersion}`;
    if (partitionKeys.has(key) || partitionSourceIds.has(parsed.sourceId)) return null;
    partitionKeys.add(key);
    partitionSourceIds.add(parsed.sourceId);
    for (const revisionId of parsed.revisionIds) {
      if (partitionRevisionIds.has(revisionId)) return null;
      partitionRevisionIds.add(revisionId);
    }
    pointCount += parsed.pointCount;
    if (pointCount > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS) return null;
    partitions.push(parsed);
  }

  const revisionIds = manifest.revisionIds;
  const canonicalPartitions = [...partitions].sort(comparePartitions);
  if (
    pointCount !== manifest.expectedPointCount ||
    partitionRevisionIds.size !== revisionIds.length ||
    revisionIds.some((revisionId) => !partitionRevisionIds.has(revisionId)) ||
    partitions.some((partition, index) => partition !== canonicalPartitions[index])
  ) {
    return null;
  }

  const parsed: KnowledgeV2SnapshotAuthorizationManifest = {
    version: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
    tenantId: manifest.tenantId,
    snapshotId: manifest.snapshotId,
    snapshotManifestHash: manifest.snapshotManifestHash,
    indexSchemaHash: manifest.indexSchemaHash,
    expectedPointCount: manifest.expectedPointCount,
    revisionIds: [...revisionIds],
    partitions,
  };
  if (
    stableKnowledgeValue(value) !== stableKnowledgeValue(parsed) ||
    knowledgeV2SnapshotAuthorizationManifestHash(parsed) !== expectedHash
  ) {
    return null;
  }
  return parsed;
}

export function buildKnowledgeV2SnapshotAuthorizationManifest(
  input: BuildKnowledgeV2SnapshotAuthorizationManifestInput,
): { manifest: KnowledgeV2SnapshotAuthorizationManifest; hash: string } {
  if (
    !safeId(input.tenantId) ||
    !safeId(input.snapshotId) ||
    !safeHash(input.snapshotManifestHash) ||
    !safeHash(input.indexSchemaHash) ||
    input.points.length === 0 ||
    input.points.length > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_POINTS
  ) {
    throw new Error("Knowledge v2 snapshot authorization manifest input is invalid.");
  }

  const chunkIds = new Set<string>();
  const vectorPointIds = new Set<string>();
  const revisionPartitionKeys = new Map<string, string>();
  const revisionDocumentIds = new Map<string, string>();
  const sourcePartitionKeys = new Map<string, string>();
  const partitionInputs = new Map<
    string,
    {
      sourceId: string;
      sourceGeneration: number;
      authorizationFingerprint: string;
      permissionVersion: number;
      revisionIds: Set<string>;
      items: KnowledgeV2SnapshotAuthorizationMembershipItem[];
    }
  >();
  for (const point of input.points) {
    if (
      !safeId(point.chunkId) ||
      !safeId(point.documentId) ||
      !safeId(point.revisionId) ||
      !safeHash(point.contentHash) ||
      !safeId(point.vectorPointId) ||
      !safeHash(point.pointFingerprint) ||
      !safeId(point.sourceId) ||
      !positiveInteger(point.sourceGeneration) ||
      !safeHash(point.authorizationFingerprint) ||
      !positiveInteger(point.permissionVersion) ||
      chunkIds.has(point.chunkId) ||
      vectorPointIds.has(point.vectorPointId)
    ) {
      throw new Error("Knowledge v2 snapshot authorization point is invalid.");
    }
    chunkIds.add(point.chunkId);
    vectorPointIds.add(point.vectorPointId);
    const partitionKey = `${point.authorizationFingerprint}:${point.permissionVersion}`;
    const sourcePartitionKey = sourcePartitionKeys.get(point.sourceId);
    if (sourcePartitionKey && sourcePartitionKey !== partitionKey) {
      throw new Error("Knowledge v2 source spans authorization partitions.");
    }
    sourcePartitionKeys.set(point.sourceId, partitionKey);
    const revisionPartitionKey = revisionPartitionKeys.get(point.revisionId);
    const revisionDocumentId = revisionDocumentIds.get(point.revisionId);
    if (revisionPartitionKey && revisionPartitionKey !== partitionKey) {
      throw new Error("Knowledge v2 revision spans authorization partitions.");
    }
    if (revisionDocumentId && revisionDocumentId !== point.documentId) {
      throw new Error("Knowledge v2 revision spans documents.");
    }
    revisionPartitionKeys.set(point.revisionId, partitionKey);
    revisionDocumentIds.set(point.revisionId, point.documentId);
    const partition = partitionInputs.get(partitionKey) ?? {
      sourceId: point.sourceId,
      sourceGeneration: point.sourceGeneration,
      authorizationFingerprint: point.authorizationFingerprint,
      permissionVersion: point.permissionVersion,
      revisionIds: new Set<string>(),
      items: [],
    };
    if (
      partition.sourceId !== point.sourceId ||
      partition.sourceGeneration !== point.sourceGeneration
    ) {
      throw new Error("Knowledge v2 permission partition identity is inconsistent.");
    }
    partition.revisionIds.add(point.revisionId);
    partition.items.push({
      chunkId: point.chunkId,
      documentId: point.documentId,
      revisionId: point.revisionId,
      contentHash: point.contentHash,
      vectorPointId: point.vectorPointId,
      pointFingerprint: point.pointFingerprint,
    });
    partitionInputs.set(partitionKey, partition);
  }
  if (partitionInputs.size > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS) {
    throw new Error("Knowledge v2 snapshot has too many permission partitions.");
  }

  const partitions = [...partitionInputs.values()]
    .map(
      (partition): KnowledgeV2SnapshotAuthorizationPartition => ({
        sourceId: partition.sourceId,
        sourceGeneration: partition.sourceGeneration,
        authorizationFingerprint: partition.authorizationFingerprint,
        permissionVersion: partition.permissionVersion,
        revisionIds: [...partition.revisionIds].sort(compareCanonicalText),
        pointCount: partition.items.length,
        membershipHash: membershipHash(partition.items),
      }),
    )
    .sort(comparePartitions);
  const manifest: KnowledgeV2SnapshotAuthorizationManifest = {
    version: KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
    tenantId: input.tenantId,
    snapshotId: input.snapshotId,
    snapshotManifestHash: input.snapshotManifestHash,
    indexSchemaHash: input.indexSchemaHash,
    expectedPointCount: input.points.length,
    revisionIds: [...revisionPartitionKeys.keys()].sort(compareCanonicalText),
    partitions,
  };
  const hash = knowledgeV2SnapshotAuthorizationManifestHash(manifest);
  if (!parseKnowledgeV2SnapshotAuthorizationManifest(manifest, hash)) {
    throw new Error("Knowledge v2 snapshot authorization manifest is not canonical.");
  }
  return { manifest, hash };
}
