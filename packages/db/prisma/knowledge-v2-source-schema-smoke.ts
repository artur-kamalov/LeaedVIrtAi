import type { Prisma } from "@prisma/client";

const tenantId = "tenant";
const sourceId = "source";
const documentId = "document";
const revisionId = "revision";
const artifactId = "artifact";
const elementId = "element";
const chunkId = "chunk";
const snapshotId = "snapshot";

export const sourceTenantIdentity = {
  tenantId_id: { tenantId, id: sourceId },
} satisfies Prisma.KnowledgeV2SourceWhereUniqueInput;

export const artifactSourceIdentity = {
  tenantId_sourceId_id: { tenantId, sourceId, id: artifactId },
} satisfies Prisma.KnowledgeV2ArtifactWhereUniqueInput;

export const documentSourceIdentity = {
  tenantId_sourceId_id: { tenantId, sourceId, id: documentId },
} satisfies Prisma.KnowledgeV2DocumentWhereUniqueInput;

export const revisionSourceIdentity = {
  tenantId_sourceId_id: { tenantId, sourceId, id: revisionId },
} satisfies Prisma.KnowledgeV2DocumentRevisionWhereUniqueInput;

export const revisionManifestIdentity = {
  tenantId_id_contentHash: { tenantId, id: revisionId, contentHash: "revision-hash" },
} satisfies Prisma.KnowledgeV2DocumentRevisionWhereUniqueInput;

export const elementRevisionIdentity = {
  tenantId_revisionId_id: { tenantId, revisionId, id: elementId },
} satisfies Prisma.KnowledgeV2ElementWhereUniqueInput;

export const chunkVectorIdentity = {
  tenantId_id_contentHash_vectorPointId: {
    tenantId,
    id: chunkId,
    contentHash: "chunk-hash",
    vectorPointId: "vector-point",
  },
} satisfies Prisma.KnowledgeV2ChunkWhereUniqueInput;

export const snapshotCorpusIdentity = {
  tenantId_id_corpusKind: {
    tenantId,
    id: snapshotId,
    corpusKind: "STRUCTURED_V2",
  },
} satisfies Prisma.KnowledgeIndexSnapshotWhereUniqueInput;

export const sourceCreate = {
  tenantId,
  kind: "WEBSITE",
  displayName: "Documentation",
  externalRootKey: "https://example.com/",
  canonicalUri: "https://example.com/",
  defaultClassification: "PUBLIC",
} satisfies Prisma.KnowledgeV2SourceUncheckedCreateInput;

export const artifactCreate = {
  tenantId,
  sourceId,
  objectStorageKey: "tenant/source/artifact",
  encryptionKeyRef: "key-ref",
  sha256: "artifact-hash",
  byteSize: 1024n,
  securityClassification: "PUBLIC",
  retentionClass: "standard",
} satisfies Prisma.KnowledgeV2ArtifactUncheckedCreateInput;

export const documentCreate = {
  tenantId,
  sourceId,
  externalKey: "page:/",
  kind: "WEBSITE_PAGE",
  canonicalUri: "https://example.com/",
  title: "Documentation",
  classification: "PUBLIC",
} satisfies Prisma.KnowledgeV2DocumentUncheckedCreateInput;

export const revisionCreate = {
  tenantId,
  sourceId,
  documentId,
  revisionNumber: 1,
  contentHash: "revision-hash",
  artifactId,
  pipelineVersion: "source-v1",
  sourcePermissionFingerprint: "permission-v1",
} satisfies Prisma.KnowledgeV2DocumentRevisionUncheckedCreateInput;

export const elementCreate = {
  tenantId,
  documentId,
  revisionId,
  kind: "PARAGRAPH",
  ordinal: 0,
  normalizedText: "Example content",
  contentHash: "element-hash",
  locale: "en",
  classification: "PUBLIC",
} satisfies Prisma.KnowledgeV2ElementUncheckedCreateInput;

export const chunkCreate = {
  tenantId,
  revisionId,
  documentId,
  ordinal: 0,
  parentElementId: elementId,
  contentHash: "chunk-hash",
  tokenCount: 2,
  locale: "en",
  classification: "PUBLIC",
  permissionVersion: 1,
  denseSchemaVersion: "dense-v1",
  sparseSchemaVersion: "sparse-v1",
  pipelineVersion: "source-v1",
  vectorPointId: "vector-point",
  provenanceRange: { elementIds: [elementId] },
} satisfies Prisma.KnowledgeV2ChunkUncheckedCreateInput;

export const snapshotItemCreate = {
  tenantId,
  snapshotId,
  chunkId,
  corpusKind: "STRUCTURED_V2",
  contentHash: "chunk-hash",
  vectorPointId: "vector-point",
  pointFingerprint: "a".repeat(64),
} satisfies Prisma.KnowledgeV2IndexSnapshotItemUncheckedCreateInput;

export const publicationItemCreate = {
  tenantId,
  publicationId: "publication",
  corpusKind: "STRUCTURED_V2",
  itemType: "DOCUMENT_REVISION",
  itemId: revisionId,
  itemVersionHash: "revision-hash",
  v2DocumentRevisionId: revisionId,
} satisfies Prisma.KnowledgePublicationItemUncheckedCreateInput;

export const sourceJobCreate = {
  tenantId,
  idempotencyKey: "source-sync",
  stage: "ACQUIRING",
  v2SourceId: sourceId,
  v2RevisionId: revisionId,
} satisfies Prisma.KnowledgeJobUncheckedCreateInput;

export const deletionLedgerCreate = {
  tenantId,
  sourceId,
  sourceGeneration: 2,
  targetType: "ARTIFACT",
  targetId: artifactId,
  subsystem: "OBJECT_STORAGE",
} satisfies Prisma.KnowledgeV2DeletionLedgerUncheckedCreateInput;
