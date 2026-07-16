import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "@leadvirt/config";
import { UnrecoverableError } from "bullmq";
import { Prisma, prisma } from "@leadvirt/db";
import {
  buildKnowledgeV2SnapshotAuthorizationManifest,
  EncryptedFileKnowledgeObjectStore,
  hashKnowledgeValue,
  KnowledgeObjectStoreError,
  stableKnowledgeValue,
  type AcquiredWebsiteSourceBody,
} from "@leadvirt/knowledge";
import {
  createKnowledgeIngestionDependencies,
  KnowledgeIngestionCrashError,
  KnowledgeIngestionError,
  processKnowledgeIngestionJob,
  type KnowledgeIngestionDependencies,
  type KnowledgeIngestionJobInput,
} from "../../apps/worker/src/knowledge/knowledge-ingestion-processor.js";
import {
  captureDeadLetterJob,
  isFinalAttempt,
  processLeadVirtJobWithReliability,
  withWorkerJobTimeout,
  WorkerJobTimeoutError,
} from "../../apps/worker/src/reliability/worker-reliability.js";
import { createRuntimeQueueEvent } from "@leadvirt/runtime-queue";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

interface Fixture {
  tenantId: string;
  userId: string;
}

const fixtures: Fixture[] = [];
let checks = 0;
let acquisitionCalls = 0;

function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

async function purgeImmutableReviewFixtures() {
  const tenantIds = fixtures.map((fixture) => fixture.tenantId);
  if (tenantIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "KnowledgeV2ReviewItemEvidence" DISABLE TRIGGER "KnowledgeV2ReviewEvidence_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "KnowledgeV2EvidenceReference" DISABLE TRIGGER "KnowledgeV2EvidenceReference_immutable"',
    );
    await tx.knowledgeV2ReviewItemEvidence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2ReviewItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "KnowledgeV2ReviewItemEvidence" ENABLE TRIGGER "KnowledgeV2ReviewEvidence_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "KnowledgeV2EvidenceReference" ENABLE TRIGGER "KnowledgeV2EvidenceReference_immutable"',
    );
  });
}

function acquiredHtml(html: string): AcquiredWebsiteSourceBody {
  const bytes = new TextEncoder().encode(html);
  return {
    bytes,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "text/html",
    charset: "utf-8",
  };
}

async function fixture(label: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.test`, name: "Knowledge Owner" },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Knowledge ${label}`,
      slug: `knowledge-${label}-${suffix}`,
      status: "ACTIVE",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  fixtures.push({ tenantId: tenant.id, userId: user.id });
  return { tenant, user };
}

async function source(input: {
  tenantId: string;
  userId: string;
  label: string;
  generation?: number;
  status?: "CONNECTING" | "SYNCING";
}) {
  return prisma.knowledgeV2Source.create({
    data: {
      tenantId: input.tenantId,
      kind: "WEBSITE",
      displayName: input.label,
      externalRootKey: `website:${randomUUID()}`,
      canonicalUri: `https://${input.label.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}.example.org/`,
      status: input.status ?? "CONNECTING",
      defaultClassification: "PUBLIC",
      defaultLocale: "en",
      generation: input.generation ?? 1,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    },
  });
}

async function queuedJob(input: {
  tenantId: string;
  userId: string;
  sourceId: string;
  generation: number;
  operation: "IMPORT" | "SYNC" | "RECONCILE" | "DELETE";
  revisionId?: string;
}) {
  const knowledgeJobId = randomUUID();
  const runtimeEventId = randomUUID();
  await prisma.knowledgeJob.create({
    data: {
      id: knowledgeJobId,
      tenantId: input.tenantId,
      idempotencyKey: `knowledge-source:${input.operation.toLowerCase()}:${input.sourceId}:${input.generation}`,
      stage:
        input.operation === "DELETE"
          ? "CLEANING_UP"
          : input.operation === "RECONCILE"
            ? "RECONCILING"
            : "ACQUIRING",
      pipelineVersion: "knowledge-v2",
      generation: input.generation,
      status: "QUEUED",
      maxAttempts: 5,
      deadlineAt: new Date(Date.now() + 30 * 60_000),
      payloadRef: `runtime-outbox:${runtimeEventId}`,
      v2SourceId: input.sourceId,
      ...(input.revisionId ? { v2RevisionId: input.revisionId } : {}),
    },
  });
  return {
    id: `knowledge-source:${knowledgeJobId}`,
    name: input.operation.toLowerCase(),
    data: {
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      knowledgeJobId,
      generation: input.generation,
      operation: input.operation,
      requestedByUserId: input.userId,
      requestedAt: new Date().toISOString(),
      runtimeEventId,
      runtimeGeneration: input.generation,
    },
    attemptsMade: 0,
    maxAttempts: 5,
    signal: new AbortController().signal,
  } satisfies KnowledgeIngestionJobInput;
}

function dependencies(input: {
  store: EncryptedFileKnowledgeObjectStore;
  encryptionKeyRef: string;
  html: string;
  websiteImportEnabled?: boolean;
  failpoint?: KnowledgeIngestionDependencies["failpoint"];
  vectorCleaner?: KnowledgeIngestionDependencies["vectorCleaner"];
  onAcquire?: () => void | Promise<void>;
}) {
  const defaults = createKnowledgeIngestionDependencies(prisma, {
    objectStore: input.store,
    objectEncryptionKeyRef: input.encryptionKeyRef,
    objectStoreConfigured: true,
    websiteImportEnabled: input.websiteImportEnabled ?? true,
    websiteEgressReady: true,
    async acquireWebsite(url, signal) {
      acquisitionCalls += 1;
      assert.equal(signal.aborted, false);
      await input.onAcquire?.();
      return { finalUrl: url, redirectCount: 0, body: acquiredHtml(input.html) };
    },
    ...(input.failpoint ? { failpoint: input.failpoint } : {}),
    ...(input.vectorCleaner ? { vectorCleaner: input.vectorCleaner } : {}),
  });
  return defaults;
}

async function expectIngestionError(promise: Promise<unknown>, code: string, retryable: boolean) {
  await assert.rejects(promise, (error) => {
    checks += 1;
    return (
      error instanceof KnowledgeIngestionError &&
      error.code === code &&
      error.retryable === retryable
    );
  });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "leadvirt-ingestion-worker-"));
  const encryptionKey = { id: "ingestion-smoke-v1", key: randomBytes(32) };
  const store = new EncryptedFileKnowledgeObjectStore({
    rootPath: root,
    activeKey: encryptionKey,
    maxPlaintextBytes: 4 * 1024 * 1024,
  });
  try {
    const primary = await fixture("ingestion-success");
    const primarySource = await source({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      label: "Primary Website",
    });
    const successJob = await queuedJob({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      sourceId: primarySource.id,
      generation: primarySource.generation,
      operation: "IMPORT",
    });
    const successHtml =
      "<html lang='en'><head><title>Primary Help</title></head><body><h1>Primary Help</h1><p>Appointments are available Monday through Friday.</p></body></html>";
    const primaryDependencies = dependencies({
      store,
      encryptionKeyRef: encryptionKey.id,
      html: successHtml,
    });
    const imported = await processKnowledgeIngestionJob(successJob, primaryDependencies);
    check(imported.status === "succeeded", "chunked draft import did not complete");
    const persistedSuccessJob = await prisma.knowledgeJob.findUniqueOrThrow({
      where: { id: successJob.data.knowledgeJobId },
      include: { attempts: true },
    });
    check(persistedSuccessJob.status === "SUCCEEDED", "chunked draft import did not complete");
    check(
      persistedSuccessJob.attempts.length === 1 &&
        persistedSuccessJob.attempts[0]?.status === "SUCCEEDED",
      "chunked draft import attempt did not complete",
    );
    const primaryDocument = await prisma.knowledgeV2Document.findFirstOrThrow({
      where: { tenantId: primary.tenant.id, sourceId: primarySource.id },
      include: {
        currentDraftRevision: { include: { artifact: true, elements: true, chunks: true } },
      },
    });
    const primaryRevision = primaryDocument.currentDraftRevision;
    check(primaryRevision?.status === "CHUNKING", "safe revision skipped pending indexing");
    check((primaryRevision?.elements.length ?? 0) > 0, "elements were not persisted");
    check((primaryRevision?.chunks.length ?? 0) > 0, "draft chunks were not persisted");
    check(
      primaryRevision?.chunks.every((chunk) => chunk.indexState === "PENDING"),
      "unindexed chunks were reported as indexed",
    );
    const unindexedSource = await prisma.knowledgeV2Source.findUniqueOrThrow({
      where: { id: primarySource.id },
    });
    check(unindexedSource.status === "SYNCING", "unindexed source left the draft sync state");
    check(
      unindexedSource.etag > primarySource.etag,
      "worker source transitions did not advance ETag",
    );
    check(unindexedSource.lastSuccessAt === null, "unindexed source reported a successful sync");
    check(Boolean(unindexedSource.sourceObservedAt), "successful acquisition was not recorded");
    const rawArtifact = primaryRevision?.artifact;
    check(Boolean(rawArtifact), "immutable artifact record is missing");
    check(
      Boolean(
        rawArtifact &&
        (await store.get(rawArtifact.objectStorageKey, rawArtifact.encryptionKeyRef)).byteLength >
          0,
      ),
      "raw artifact was not encrypted and readable",
    );
    check(
      Boolean(
        primaryRevision?.extractedContentObjectKey &&
        (await store.get(primaryRevision.extractedContentObjectKey, encryptionKey.id)).byteLength >
          0,
      ),
      "extracted artifact was not encrypted and readable",
    );
    check(Boolean(primaryRevision), "publication fixture has no revision");
    await prisma.knowledgeV2DocumentRevision.update({
      where: { id: primaryRevision!.id },
      data: { status: "READY" },
    });
    const indexedAt = new Date();
    await prisma.knowledgeV2Chunk.updateMany({
      where: { revisionId: primaryRevision!.id },
      data: { indexState: "INDEXED", indexedAt },
    });
    const indexedChunks = await prisma.knowledgeV2Chunk.findMany({
      where: { revisionId: primaryRevision!.id },
      orderBy: { ordinal: "asc" },
    });
    const snapshotSource = await prisma.knowledgeV2Source.findUniqueOrThrow({
      where: { id: primarySource.id },
    });
    const canonicalHash = (value: unknown) => hashKnowledgeValue(stableKnowledgeValue(value));
    const publicationItems = [
      {
        itemType: "DOCUMENT_REVISION" as const,
        itemId: primaryRevision!.id,
        itemVersionHash: primaryRevision!.contentHash,
        authorizationFingerprint: primaryRevision!.sourcePermissionFingerprint,
        scope: primaryRevision!.scopeSnapshot,
      },
    ];
    const indexSchema = {
      schemaVersion: 1,
      dense: { provider: "smoke", model: "smoke-v1", dimensions: 3 },
      sparse: { provider: "smoke", model: "sparse-v1" },
      pipelineVersion: "knowledge-v2-hybrid-v1",
    };
    const indexSchemaHash = canonicalHash(indexSchema);
    const snapshotManifestHash = canonicalHash({
      version: 1,
      corpusKind: "STRUCTURED_V2",
      documents: publicationItems.map((item) => ({
        revisionId: item.itemId,
        contentHash: item.itemVersionHash,
        authorizationFingerprint: item.authorizationFingerprint,
        scope: item.scope,
      })),
      indexSchemaHash,
    });
    const snapshotId = randomUUID();
    const snapshotPoints = indexedChunks.map((chunk) => {
      const vectorPointId = randomUUID();
      return {
        sourceId: primaryRevision!.sourceId,
        sourceGeneration: snapshotSource.generation,
        authorizationFingerprint: primaryRevision!.sourcePermissionFingerprint,
        permissionVersion: chunk.permissionVersion,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        revisionId: chunk.revisionId,
        contentHash: chunk.contentHash,
        vectorPointId,
        pointFingerprint: canonicalHash({ snapshotId, chunkId: chunk.id, vectorPointId }),
      };
    });
    const snapshotPointIds = new Map(
      snapshotPoints.map((point) => [point.chunkId, point.vectorPointId] as const),
    );
    const preparingSnapshot = await prisma.knowledgeIndexSnapshot.create({
      data: {
        id: snapshotId,
        tenantId: primary.tenant.id,
        corpusKind: "STRUCTURED_V2",
        status: "PREPARING",
        collectionName: "knowledge-v2-smoke",
        embeddingProvider: "smoke",
        embeddingModel: "smoke-v1",
        manifestHash: snapshotManifestHash,
        authorizationManifestVersion: 1,
        indexSchema,
        indexSchemaHash,
        pipelineVersion: "knowledge-v2-hybrid-v1",
        expectedPointCount: indexedChunks.length,
        preparationStartedAt: indexedAt,
      },
    });
    await prisma.knowledgeV2IndexSnapshotItem.createMany({
      data: snapshotPoints.map((point) => ({
        tenantId: primary.tenant.id,
        snapshotId: preparingSnapshot.id,
        chunkId: point.chunkId,
        corpusKind: "STRUCTURED_V2",
        contentHash: point.contentHash,
        vectorPointId: point.vectorPointId,
        pointFingerprint: point.pointFingerprint,
      })),
    });
    const snapshotAuthorization = buildKnowledgeV2SnapshotAuthorizationManifest({
      tenantId: primary.tenant.id,
      snapshotId: preparingSnapshot.id,
      snapshotManifestHash,
      indexSchemaHash,
      points: snapshotPoints,
    });
    const indexSnapshot = await prisma.knowledgeIndexSnapshot.update({
      where: { id: preparingSnapshot.id },
      data: {
        status: "READY",
        observedPointCount: snapshotPoints.length,
        verifiedAt: indexedAt,
        preparationStartedAt: null,
        authorizationManifest: snapshotAuthorization.manifest as unknown as Prisma.InputJsonValue,
        authorizationManifestHash: snapshotAuthorization.hash,
      },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: primaryDocument.id },
      data: { currentPublishedRevisionId: primaryRevision!.id },
    });
    const activePublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: primary.tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        indexSnapshotId: indexSnapshot.id,
        manifestHash: canonicalHash(publicationItems),
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        readyAt: new Date(),
        items: {
          create: {
            itemType: "DOCUMENT_REVISION",
            itemId: primaryRevision!.id,
            itemVersionHash: primaryRevision!.contentHash,
            v2DocumentRevisionId: primaryRevision!.id,
            authorizationFingerprint: primaryRevision!.sourcePermissionFingerprint,
            scope: primaryRevision!.scopeSnapshot ?? Prisma.JsonNull,
          },
        },
      },
    });
    await prisma.knowledgePublication.update({
      where: { id: activePublication.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    await prisma.knowledgeV2DocumentRevision.update({
      where: { id: primaryRevision!.id },
      data: { status: "PUBLISHED" },
    });
    await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: primary.tenant.id,
        targetKey: "workspace-v2",
        publicationId: activePublication.id,
        sequence: activePublication.sequence,
        updatedByUserId: primary.user.id,
      },
    });

    const countsBeforeDuplicate = await Promise.all([
      prisma.knowledgeV2Artifact.count({ where: { sourceId: primarySource.id } }),
      prisma.knowledgeV2DocumentRevision.count({ where: { sourceId: primarySource.id } }),
    ]);
    const advancedSource = await prisma.knowledgeV2Source.update({
      where: { id: primarySource.id },
      data: { generation: { increment: 1 }, status: "SYNCING" },
    });
    const duplicateJob = await queuedJob({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      sourceId: primarySource.id,
      generation: advancedSource.generation,
      operation: "SYNC",
    });
    const duplicate = await processKnowledgeIngestionJob(duplicateJob, primaryDependencies);
    check(duplicate.status === "unchanged", "unchanged content was not deduplicated");
    const successfulSyncAt = (
      await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } })
    ).lastSuccessAt?.toISOString();
    check(Boolean(successfulSyncAt), "queryable source did not record its successful sync");
    check(
      (await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } }))
        .status === "READY",
      "fully indexed publication candidate did not make the unchanged source READY",
    );
    const countsAfterDuplicate = await Promise.all([
      prisma.knowledgeV2Artifact.count({ where: { sourceId: primarySource.id } }),
      prisma.knowledgeV2DocumentRevision.count({ where: { sourceId: primarySource.id } }),
    ]);
    check(
      countsBeforeDuplicate.join(":") === countsAfterDuplicate.join(":"),
      "unchanged sync created duplicate immutable records",
    );
    const changedSource = await prisma.knowledgeV2Source.update({
      where: { id: primarySource.id },
      data: { generation: { increment: 1 }, status: "SYNCING" },
    });
    await processKnowledgeIngestionJob(
      await queuedJob({
        tenantId: primary.tenant.id,
        userId: primary.user.id,
        sourceId: primarySource.id,
        generation: changedSource.generation,
        operation: "SYNC",
      }),
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: "<html><body><h1>Changed Help</h1><p>Weekend appointments are now available.</p></body></html>",
      }),
    );
    const revertedSource = await prisma.knowledgeV2Source.update({
      where: { id: primarySource.id },
      data: { generation: { increment: 1 }, status: "SYNCING" },
    });
    const revertedJob = await queuedJob({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      sourceId: primarySource.id,
      generation: revertedSource.generation,
      operation: "SYNC",
    });
    await processKnowledgeIngestionJob(revertedJob, primaryDependencies);
    const revertedDocument = await prisma.knowledgeV2Document.findUniqueOrThrow({
      where: { id: primaryDocument.id },
      include: { currentDraftRevision: true },
    });
    check(
      revertedDocument.currentDraftRevision?.contentHash === primaryRevision?.contentHash &&
        revertedDocument.currentDraftRevisionId !== primaryRevision?.id,
      "historical content reversion did not create an immutable successor",
    );

    const quarantineFixture = await fixture("ingestion-quarantine");
    const quarantineSource = await source({
      tenantId: quarantineFixture.tenant.id,
      userId: quarantineFixture.user.id,
      label: "Quarantine Website",
    });
    const quarantineJob = await queuedJob({
      tenantId: quarantineFixture.tenant.id,
      userId: quarantineFixture.user.id,
      sourceId: quarantineSource.id,
      generation: quarantineSource.generation,
      operation: "IMPORT",
    });
    const quarantined = await processKnowledgeIngestionJob(
      quarantineJob,
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: "<html><head><title>api_key = title_super_secret_value</title></head><body><h1>Private</h1><p>api_key = live_super_secret_value</p></body></html>",
      }),
    );
    check(quarantined.status === "quarantined", "secret content was not quarantined");
    const quarantineRevision = await prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
      where: { sourceId: quarantineSource.id },
      include: { elements: true, chunks: true },
    });
    check(quarantineRevision.status === "QUARANTINED", "quarantine state was not durable");
    check(quarantineRevision.chunks.length === 0, "quarantined content produced chunks");
    check(
      quarantineRevision.elements.every((element) => element.normalizedText === null),
      "quarantined plaintext leaked into element rows",
    );
    check(
      (
        await prisma.knowledgeV2Document.findFirstOrThrow({
          where: { sourceId: quarantineSource.id },
        })
      ).title === quarantineSource.displayName,
      "quarantined title leaked into document metadata",
    );
    const quarantineAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: quarantineFixture.tenant.id,
        action: "knowledge.v2.source.import_completed",
      },
      orderBy: { createdAt: "desc" },
    });
    const quarantineAuditPayload = JSON.stringify(quarantineAudit.payload);
    check(!quarantineAuditPayload.includes("api_key"), "quarantine audit exposed source content");
    check(!quarantineAuditPayload.includes("https://"), "quarantine audit exposed a raw URL");
    const quarantineReview = await prisma.knowledgeV2ReviewItem.findFirstOrThrow({
      where: { tenantId: quarantineFixture.tenant.id, sourceId: quarantineSource.id },
      include: { evidenceLinks: { include: { evidenceReference: true } } },
    });
    check(
      quarantineReview.status === "OPEN" &&
        quarantineReview.reason === "SENSITIVE_CONTENT" &&
        quarantineReview.riskLevel === "CRITICAL" &&
        quarantineReview.suggestedAction === "EXCLUDE_CONTENT",
      "quarantined content did not create the required high-risk review item",
    );
    check(
      quarantineReview.evidenceLinks.length === 1 &&
        quarantineReview.evidenceLinks[0]?.evidenceReference.v2DocumentRevisionId ===
          quarantineRevision.id &&
        quarantineReview.evidenceLinks[0]?.evidenceReference.itemVersionHash ===
          quarantineRevision.contentHash,
      "quarantine review was not bound to immutable revision evidence",
    );
    const quarantineReviewJson = JSON.stringify(quarantineReview);
    check(!quarantineReviewJson.includes("api_key"), "quarantine review exposed source content");
    check(!quarantineReviewJson.includes("https://"), "quarantine review exposed a raw URL");

    const reviewFixture = await fixture("ingestion-needs-review");
    const reviewSource = await source({
      tenantId: reviewFixture.tenant.id,
      userId: reviewFixture.user.id,
      label: "Review Website",
    });
    const reviewResult = await processKnowledgeIngestionJob(
      await queuedJob({
        tenantId: reviewFixture.tenant.id,
        userId: reviewFixture.user.id,
        sourceId: reviewSource.id,
        generation: reviewSource.generation,
        operation: "IMPORT",
      }),
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: "<html><body><h1>Help</h1><p>Appointments require confirmation.</p><div style='display:none'>Archived navigation label</div></body></html>",
      }),
    );
    check(reviewResult.status === "succeeded", "reviewable content import did not complete");
    const reviewableRevision = await prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
      where: { sourceId: reviewSource.id },
      include: { chunks: true },
    });
    check(
      reviewableRevision.status === "NEEDS_REVIEW" && reviewableRevision.chunks.length > 0,
      "reviewable content did not preserve a non-queryable draft",
    );
    const reviewableItem = await prisma.knowledgeV2ReviewItem.findFirstOrThrow({
      where: { tenantId: reviewFixture.tenant.id, sourceId: reviewSource.id },
    });
    check(
      reviewableItem.status === "OPEN" &&
        reviewableItem.reason === "LOW_CONFIDENCE_CONTENT" &&
        reviewableItem.riskLevel === "MEDIUM" &&
        reviewableItem.suggestedAction === "REVIEW_VALUE",
      "reviewable content did not create a medium-risk review item",
    );
    const reviewSourceNext = await prisma.knowledgeV2Source.update({
      where: { id: reviewSource.id },
      data: { generation: { increment: 1 }, status: "SYNCING" },
    });
    const correctedReviewResult = await processKnowledgeIngestionJob(
      await queuedJob({
        tenantId: reviewFixture.tenant.id,
        userId: reviewFixture.user.id,
        sourceId: reviewSource.id,
        generation: reviewSourceNext.generation,
        operation: "SYNC",
      }),
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: "<html><body><h1>Help</h1><p>Appointments are confirmed by email.</p></body></html>",
      }),
    );
    check(correctedReviewResult.status === "succeeded", "corrected review import did not finish");
    check(
      (
        await prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: { id: reviewableItem.id },
        })
      ).status === "SUPERSEDED",
      "a corrected revision left obsolete review work actionable",
    );

    const hiddenFixture = await fixture("ingestion-hidden-change");
    const hiddenSource = await source({
      tenantId: hiddenFixture.tenant.id,
      userId: hiddenFixture.user.id,
      label: "Hidden Change Website",
    });
    const visibleHtml =
      "<html><head><title>Public Help</title></head><body><h1>Public Help</h1><p>Appointments require confirmation.</p></body></html>";
    const visibleImportResult = await processKnowledgeIngestionJob(
      await queuedJob({
        tenantId: hiddenFixture.tenant.id,
        userId: hiddenFixture.user.id,
        sourceId: hiddenSource.id,
        generation: hiddenSource.generation,
        operation: "IMPORT",
      }),
      dependencies({ store, encryptionKeyRef: encryptionKey.id, html: visibleHtml }),
    );
    check(visibleImportResult.status === "succeeded", "visible import did not finish");
    const baselineHiddenRevision = await prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
      where: { sourceId: hiddenSource.id },
      orderBy: { revisionNumber: "desc" },
    });
    const hiddenSourceNext = await prisma.knowledgeV2Source.update({
      where: { id: hiddenSource.id },
      data: { generation: { increment: 1 }, status: "SYNCING" },
    });
    const hiddenResult = await processKnowledgeIngestionJob(
      await queuedJob({
        tenantId: hiddenFixture.tenant.id,
        userId: hiddenFixture.user.id,
        sourceId: hiddenSource.id,
        generation: hiddenSourceNext.generation,
        operation: "SYNC",
      }),
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: visibleHtml.replace(
          "</body>",
          "<div style='display:none'>api_key = live_hidden_secret_value</div></body>",
        ),
      }),
    );
    check(
      hiddenResult.status === "quarantined",
      "hidden secret change was suppressed as unchanged",
    );
    const hiddenDocument = await prisma.knowledgeV2Document.findFirstOrThrow({
      where: { sourceId: hiddenSource.id },
      include: { currentDraftRevision: true },
    });
    check(
      hiddenDocument.currentDraftRevision?.contentHash !== baselineHiddenRevision.contentHash,
      "security-relevant hidden content was omitted from the normalized hash",
    );
    check(
      hiddenDocument.currentDraftRevision?.status === "QUARANTINED",
      "hidden secret did not produce a quarantined successor",
    );
    const heldArtifact = await prisma.knowledgeV2Artifact.findFirstOrThrow({
      where: { sourceId: hiddenSource.id },
      orderBy: { createdAt: "asc" },
    });
    await prisma.knowledgeV2Artifact.update({
      where: { id: heldArtifact.id },
      data: { legalHold: true, deletionState: "TOMBSTONED" },
    });
    const heldDeletingSource = await prisma.knowledgeV2Source.update({
      where: { id: hiddenSource.id },
      data: { generation: { increment: 1 }, status: "DELETING", tombstonedAt: new Date() },
    });
    await prisma.knowledgeV2DeletionLedger.createMany({
      data: ["POSTGRES_CONTENT", "OBJECT_STORAGE", "VECTOR_INDEX", "CACHE"].map((subsystem) => ({
        tenantId: hiddenFixture.tenant.id,
        sourceId: hiddenSource.id,
        sourceGeneration: heldDeletingSource.generation,
        targetType: "SOURCE",
        targetId: hiddenSource.id,
        subsystem,
      })),
    });
    await expectIngestionError(
      processKnowledgeIngestionJob(
        await queuedJob({
          tenantId: hiddenFixture.tenant.id,
          userId: hiddenFixture.user.id,
          sourceId: hiddenSource.id,
          generation: heldDeletingSource.generation,
          operation: "DELETE",
        }),
        dependencies({ store, encryptionKeyRef: encryptionKey.id, html: visibleHtml }),
      ),
      "KNOWLEDGE_SECURITY_LEGAL_HOLD",
      false,
    );
    check(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: { sourceId: hiddenSource.id, status: "PENDING" },
      })) === 4,
      "legal hold allowed physical cleanup to begin",
    );
    check(
      (await store.get(heldArtifact.objectStorageKey, heldArtifact.encryptionKeyRef)).byteLength >
        0,
      "legal hold did not preserve the raw artifact",
    );
    check(
      (await prisma.knowledgeV2Element.count({
        where: { revision: { sourceId: hiddenSource.id }, normalizedText: { not: null } },
      })) > 0,
      "legal hold erased retained database content",
    );

    const staleFixture = await fixture("ingestion-stale");
    const staleSource = await source({
      tenantId: staleFixture.tenant.id,
      userId: staleFixture.user.id,
      label: "Stale Website",
      generation: 2,
    });
    const staleJob = await queuedJob({
      tenantId: staleFixture.tenant.id,
      userId: staleFixture.user.id,
      sourceId: staleSource.id,
      generation: 1,
      operation: "IMPORT",
    });
    const callsBeforeStale = acquisitionCalls;
    const stale = await processKnowledgeIngestionJob(staleJob, primaryDependencies);
    check(
      stale.status === "cancelled" && stale.reason === "stale_generation",
      "stale generation did not cancel",
    );
    check(acquisitionCalls === callsBeforeStale, "stale generation reached the network seam");

    const crashFixture = await fixture("ingestion-crash");
    const crashSource = await source({
      tenantId: crashFixture.tenant.id,
      userId: crashFixture.user.id,
      label: "Crash Website",
    });
    const crashJob = await queuedJob({
      tenantId: crashFixture.tenant.id,
      userId: crashFixture.user.id,
      sourceId: crashSource.id,
      generation: crashSource.generation,
      operation: "IMPORT",
    });
    let crashed = false;
    await expectIngestionError(
      processKnowledgeIngestionJob(
        crashJob,
        dependencies({
          store,
          encryptionKeyRef: encryptionKey.id,
          html: successHtml,
          failpoint(point) {
            if (!crashed && point === "AFTER_OBJECTS") {
              crashed = true;
              throw new KnowledgeIngestionCrashError(point);
            }
          },
        }),
      ),
      "KNOWLEDGE_DEPENDENCY_INGESTION_INTERRUPTED",
      true,
    );
    const retryJobState = await prisma.knowledgeJob.findUniqueOrThrow({
      where: { id: crashJob.data.knowledgeJobId },
    });
    check(retryJobState.status === "RETRY_SCHEDULED", "crash did not schedule a retry");
    const recoveredCrash = await processKnowledgeIngestionJob(
      crashJob,
      dependencies({ store, encryptionKeyRef: encryptionKey.id, html: successHtml }),
    );
    check(recoveredCrash.status === "succeeded", "crash retry did not finish ingestion");
    check(
      (await prisma.knowledgeV2Artifact.count({ where: { sourceId: crashSource.id } })) === 1,
      "retry created duplicate artifacts",
    );
    check(
      (await prisma.knowledgeJobAttempt.count({
        where: { jobId: crashJob.data.knowledgeJobId },
      })) === 2,
      "crash recovery did not preserve attempt history",
    );

    const beforeReconcileFetches = acquisitionCalls;
    const preReconcileChunk = await prisma.knowledgeV2Chunk.findFirstOrThrow({
      where: { revisionId: revertedDocument.currentDraftRevisionId! },
      orderBy: { ordinal: "asc" },
    });
    await prisma.knowledgeV2Chunk.update({
      where: { id: preReconcileChunk.id },
      data: { indexState: "INDEXED", indexedAt: new Date() },
    });
    const reconcileSource = await prisma.knowledgeV2Source.update({
      where: { id: primarySource.id },
      data: {
        generation: { increment: 1 },
        sourcePermissionVersion: { increment: 1 },
        status: "SYNCING",
        defaultClassification: "INTERNAL",
        defaultScope: { audiences: ["INTERNAL"], locales: ["en"] },
      },
    });
    await prisma.knowledgeV2DeletionLedger.createMany({
      data: ["VECTOR_INDEX", "CACHE"].map((subsystem) => ({
        tenantId: primary.tenant.id,
        sourceId: primarySource.id,
        sourceGeneration: reconcileSource.generation,
        targetType: "SOURCE",
        targetId: primarySource.id,
        subsystem,
      })),
    });
    const reconcileJob = await queuedJob({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      sourceId: primarySource.id,
      generation: reconcileSource.generation,
      operation: "RECONCILE",
    });
    const reconciledPointIds: string[] = [];
    const reconcileResult = await processKnowledgeIngestionJob(
      reconcileJob,
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: successHtml,
        vectorCleaner: {
          async deletePoints({ pointIds }) {
            reconciledPointIds.push(...pointIds);
          },
        },
      }),
    );
    check(reconcileResult.status === "succeeded", "reconcile did not finish");
    check(acquisitionCalls === beforeReconcileFetches, "reconcile performed a source fetch");
    check(
      [...snapshotPointIds.values()].every((pointId) => reconciledPointIds.includes(pointId)),
      "reconcile did not remove an acknowledged stale-permission vector",
    );
    check(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: {
          sourceId: primarySource.id,
          sourceGeneration: reconcileSource.generation,
          status: "COMPLETED",
        },
      })) === 2,
      "reconcile cleanup ledger was not completed",
    );
    const reconciledDocument = await prisma.knowledgeV2Document.findUniqueOrThrow({
      where: { id: primaryDocument.id },
      include: { currentDraftRevision: { include: { chunks: true } } },
    });
    check(
      reconciledDocument.permissionVersion === reconcileSource.sourcePermissionVersion &&
        reconciledDocument.classification === "INTERNAL",
      "reconcile did not apply the permission snapshot",
    );
    check(
      reconciledDocument.currentDraftRevisionId !== primaryRevision?.id,
      "reconcile did not preserve revision history",
    );
    check(
      reconciledDocument.currentDraftRevisionId !== revertedDocument.currentDraftRevisionId,
      "reconcile mutated the current revision instead of creating a permission successor",
    );
    check(
      reconciledDocument.currentDraftRevision?.chunks.every(
        (chunk) =>
          chunk.indexState === "PENDING" &&
          chunk.permissionVersion === reconcileSource.sourcePermissionVersion,
      ),
      "reconcile successor was not left reindex-pending",
    );
    check(
      (await prisma.knowledgeV2Chunk.count({
        where: { revisionId: primaryRevision?.id, indexState: "DELETED" },
      })) > 0,
      "reconcile did not immediately deny stale-permission chunks",
    );
    check(
      reconciledDocument.currentDraftRevision?.status === "CHUNKING",
      "reconcile successor reported READY before indexing",
    );
    check(
      (
        await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } })
      ).lastSuccessAt?.toISOString() === successfulSyncAt,
      "permission reconciliation changed the last successful import timestamp",
    );

    const indexedChunk = reconciledDocument.currentDraftRevision?.chunks[0];
    check(Boolean(indexedChunk), "delete test has no chunk");
    await prisma.knowledgeV2Chunk.update({
      where: { id: indexedChunk!.id },
      data: { indexState: "INDEXED", indexedAt: new Date() },
    });
    const deletingSource = await prisma.knowledgeV2Source.update({
      where: { id: primarySource.id },
      data: { generation: { increment: 1 }, status: "DELETING", tombstonedAt: new Date() },
    });
    await Promise.all([
      prisma.knowledgeV2Document.updateMany({
        where: { sourceId: primarySource.id },
        data: { status: "TOMBSTONED", tombstonedAt: new Date(), sourceDeletedAt: new Date() },
      }),
      prisma.knowledgeV2Artifact.updateMany({
        where: { sourceId: primarySource.id },
        data: { deletionState: "TOMBSTONED" },
      }),
      prisma.knowledgeV2Chunk.updateMany({
        where: { document: { sourceId: primarySource.id } },
        data: { indexState: "DELETED", deletedAt: new Date() },
      }),
    ]);
    await prisma.knowledgeV2DeletionLedger.createMany({
      data: ["POSTGRES_CONTENT", "OBJECT_STORAGE", "VECTOR_INDEX", "CACHE"].map((subsystem) => ({
        tenantId: primary.tenant.id,
        sourceId: primarySource.id,
        sourceGeneration: deletingSource.generation,
        targetType: "SOURCE",
        targetId: primarySource.id,
        subsystem,
      })),
    });
    const deleteJob = await queuedJob({
      tenantId: primary.tenant.id,
      userId: primary.user.id,
      sourceId: primarySource.id,
      generation: deletingSource.generation,
      operation: "DELETE",
    });
    const deleteWithoutVector = dependencies({
      store,
      encryptionKeyRef: encryptionKey.id,
      html: successHtml,
    });
    delete deleteWithoutVector.vectorCleaner;
    await expectIngestionError(
      processKnowledgeIngestionJob(deleteJob, deleteWithoutVector),
      "KNOWLEDGE_DEPENDENCY_VECTOR_CLEANUP_UNAVAILABLE",
      true,
    );
    const failedVectorLedger = await prisma.knowledgeV2DeletionLedger.findFirstOrThrow({
      where: {
        sourceId: primarySource.id,
        sourceGeneration: deletingSource.generation,
        subsystem: "VECTOR_INDEX",
      },
    });
    check(failedVectorLedger.status === "FAILED", "unavailable vector cleanup faked success");
    check(
      (await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } }))
        .status === "DELETING",
      "partial deletion incorrectly completed the source",
    );
    check(
      (
        await prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: {
            tenantId_targetKey: { tenantId: primary.tenant.id, targetKey: "workspace-v2" },
          },
        })
      ).publicationId === activePublication.id,
      "failed cleanup changed the active publication pointer",
    );
    const deletedPointIds: string[] = [];
    await processKnowledgeIngestionJob(
      deleteJob,
      dependencies({
        store,
        encryptionKeyRef: encryptionKey.id,
        html: successHtml,
        vectorCleaner: {
          async deletePoints({ pointIds }) {
            deletedPointIds.push(...pointIds);
          },
        },
      }),
    );
    check(
      [...snapshotPointIds.values()].every((pointId) => deletedPointIds.includes(pointId)),
      "indexed vectors were not deleted",
    );
    check(
      (await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } }))
        .status === "DELETED",
      "source deletion did not complete",
    );
    check(
      (
        await prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: primarySource.id } })
      ).lastSuccessAt?.toISOString() === successfulSyncAt,
      "source cleanup changed the last successful import timestamp",
    );
    check(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: {
          sourceId: primarySource.id,
          sourceGeneration: deletingSource.generation,
          status: "COMPLETED",
        },
      })) === 4,
      "deletion ledger did not preserve completed proof",
    );
    check(
      (await prisma.knowledgeV2DocumentRevision.count({ where: { sourceId: primarySource.id } })) >
        0,
      "deletion erased immutable revision proof",
    );
    check(
      (
        await prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: {
            tenantId_targetKey: { tenantId: primary.tenant.id, targetKey: "workspace-v2" },
          },
        })
      ).publicationId === activePublication.id,
      "completed cleanup changed the active publication pointer",
    );
    if (rawArtifact) {
      await assert.rejects(
        store.get(rawArtifact.objectStorageKey, rawArtifact.encryptionKeyRef),
        (error) => error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_NOT_FOUND",
      );
      checks += 1;
    }

    const disabledFixture = await fixture("ingestion-disabled");
    const disabledSource = await source({
      tenantId: disabledFixture.tenant.id,
      userId: disabledFixture.user.id,
      label: "Disabled Website",
    });
    const disabledJob = await queuedJob({
      tenantId: disabledFixture.tenant.id,
      userId: disabledFixture.user.id,
      sourceId: disabledSource.id,
      generation: disabledSource.generation,
      operation: "IMPORT",
    });
    const beforeDisabledFetches = acquisitionCalls;
    await expectIngestionError(
      processKnowledgeIngestionJob(
        disabledJob,
        dependencies({
          store,
          encryptionKeyRef: encryptionKey.id,
          html: successHtml,
          websiteImportEnabled: false,
        }),
      ),
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
      false,
    );
    check(acquisitionCalls === beforeDisabledFetches, "disabled config reached the network seam");
    check(
      (
        await prisma.knowledgeJob.findUniqueOrThrow({
          where: { id: disabledJob.data.knowledgeJobId },
        })
      ).status === "FAILED",
      "config-disabled failure was not durable",
    );

    const storageFixture = await fixture("ingestion-storage-unavailable");
    const storageSource = await source({
      tenantId: storageFixture.tenant.id,
      userId: storageFixture.user.id,
      label: "Storage Unavailable Website",
    });
    const storageJob = await queuedJob({
      tenantId: storageFixture.tenant.id,
      userId: storageFixture.user.id,
      sourceId: storageSource.id,
      generation: storageSource.generation,
      operation: "IMPORT",
    });
    const storageUnavailable = dependencies({
      store,
      encryptionKeyRef: encryptionKey.id,
      html: successHtml,
    });
    storageUnavailable.objectStore = null;
    storageUnavailable.objectStoreConfigured = false;
    const beforeStorageFetches = acquisitionCalls;
    await expectIngestionError(
      processKnowledgeIngestionJob(storageJob, storageUnavailable),
      "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE",
      false,
    );
    check(
      acquisitionCalls === beforeStorageFetches,
      "unavailable object storage reached acquisition",
    );
    check(
      (await prisma.knowledgeV2Artifact.count({ where: { sourceId: storageSource.id } })) === 0,
      "unavailable object storage produced an artifact record",
    );

    const abortFixture = await fixture("ingestion-abort");
    const abortSource = await source({
      tenantId: abortFixture.tenant.id,
      userId: abortFixture.user.id,
      label: "Abort Website",
    });
    const abortJob = await queuedJob({
      tenantId: abortFixture.tenant.id,
      userId: abortFixture.user.id,
      sourceId: abortSource.id,
      generation: abortSource.generation,
      operation: "IMPORT",
    });
    const abortController = new AbortController();
    abortJob.signal = abortController.signal;
    await expectIngestionError(
      processKnowledgeIngestionJob(
        abortJob,
        dependencies({
          store,
          encryptionKeyRef: encryptionKey.id,
          html: successHtml,
          onAcquire: () => abortController.abort(),
        }),
      ),
      "KNOWLEDGE_VALIDATION_ABORTED",
      false,
    );
    check(
      (
        await prisma.knowledgeJob.findUniqueOrThrow({
          where: { id: abortJob.data.knowledgeJobId },
        })
      ).status === "CANCELLED",
      "abort signal did not cancel the durable job",
    );
    check(
      (await prisma.knowledgeV2Artifact.count({ where: { sourceId: abortSource.id } })) === 0,
      "aborted acquisition committed an artifact",
    );
    let timeoutAbortObserved = false;
    let timeoutFenceCompleted = false;
    await assert.rejects(
      withWorkerJobTimeout(
        (signal) =>
          new Promise<string>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                timeoutAbortObserved = true;
                resolve("late-result");
              },
              { once: true },
            );
          }),
        5,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          timeoutFenceCompleted = true;
        },
      ),
      (error) => error instanceof WorkerJobTimeoutError,
    );
    checks += 1;
    check(timeoutAbortObserved, "worker timeout did not propagate cancellation");
    check(timeoutFenceCompleted, "worker timeout rejected before durable fencing completed");

    const revokedFixture = await fixture("ingestion-revoked-actor");
    const revokedSource = await source({
      tenantId: revokedFixture.tenant.id,
      userId: revokedFixture.user.id,
      label: "Revoked Actor Website",
    });
    const revokedJob = await queuedJob({
      tenantId: revokedFixture.tenant.id,
      userId: revokedFixture.user.id,
      sourceId: revokedSource.id,
      generation: revokedSource.generation,
      operation: "IMPORT",
    });
    await expectIngestionError(
      processKnowledgeIngestionJob(
        revokedJob,
        dependencies({
          store,
          encryptionKeyRef: encryptionKey.id,
          html: successHtml,
          onAcquire: async () => {
            await prisma.membership.delete({
              where: {
                tenantId_userId: {
                  tenantId: revokedFixture.tenant.id,
                  userId: revokedFixture.user.id,
                },
              },
            });
          },
        }),
      ),
      "KNOWLEDGE_PERMISSION_ACTOR_NOT_AUTHORIZED",
      false,
    );
    check(
      (await prisma.knowledgeV2Artifact.count({ where: { sourceId: revokedSource.id } })) === 0,
      "revoked actor committed an artifact after acquisition",
    );

    const isolationFixture = await fixture("ingestion-isolation");
    const isolationSource = await source({
      tenantId: isolationFixture.tenant.id,
      userId: isolationFixture.user.id,
      label: "Isolation Website",
    });
    const isolationJob = await queuedJob({
      tenantId: isolationFixture.tenant.id,
      userId: isolationFixture.user.id,
      sourceId: isolationSource.id,
      generation: isolationSource.generation,
      operation: "IMPORT",
    });
    const forged = {
      ...isolationJob,
      data: {
        ...isolationJob.data,
        tenantId: disabledFixture.tenant.id,
        sourceId: disabledSource.id,
        requestedByUserId: disabledFixture.user.id,
      },
    } satisfies KnowledgeIngestionJobInput;
    const beforeIsolationFetches = acquisitionCalls;
    await expectIngestionError(
      processKnowledgeIngestionJob(forged, primaryDependencies),
      "KNOWLEDGE_VALIDATION_JOB_INVALID",
      false,
    );
    check(acquisitionCalls === beforeIsolationFetches, "cross-tenant payload reached acquisition");
    check(
      (
        await prisma.knowledgeJob.findUniqueOrThrow({
          where: { id: isolationJob.data.knowledgeJobId },
        })
      ).status === "QUEUED",
      "cross-tenant payload modified the authoritative tenant job",
    );

    const expiryFixture = await fixture("ingestion-expiry");
    const expirySource = await source({
      tenantId: expiryFixture.tenant.id,
      userId: expiryFixture.user.id,
      label: "Expiry Website",
    });
    const expiryJob = await queuedJob({
      tenantId: expiryFixture.tenant.id,
      userId: expiryFixture.user.id,
      sourceId: expirySource.id,
      generation: expirySource.generation,
      operation: "IMPORT",
    });
    const expiryEvent = await prisma.$transaction((tx) =>
      createRuntimeQueueEvent(tx, {
        tenantId: expiryFixture.tenant.id,
        aggregateType: "knowledge-source",
        aggregateId: expirySource.id,
        aggregateVersion: expirySource.generation,
        generation: expirySource.generation,
        eventType: "knowledge.source.import.requested",
        dedupeKey: `expiry:${expiryJob.data.knowledgeJobId}`,
        deadlineAt: new Date(Date.now() - 1_000),
        envelope: {
          queueName: "knowledge.ingest",
          jobName: "import",
          jobId: expiryJob.id,
          data: {
            tenantId: expiryJob.data.tenantId,
            sourceId: expiryJob.data.sourceId,
            knowledgeJobId: expiryJob.data.knowledgeJobId,
            generation: expiryJob.data.generation,
            operation: expiryJob.data.operation,
            requestedByUserId: expiryJob.data.requestedByUserId,
            requestedAt: expiryJob.data.requestedAt,
          },
          attempts: 5,
          backoffMs: 2_000,
        },
      }),
    );
    await Promise.all([
      prisma.runtimeOutbox.update({
        where: { id: expiryEvent.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      }),
      prisma.knowledgeJob.update({
        where: { id: expiryJob.data.knowledgeJobId },
        data: { payloadRef: `runtime-outbox:${expiryEvent.id}` },
      }),
    ]);
    let expiredExecutions = 0;
    const expiredBullJob = {
      id: expiryJob.id,
      name: "import",
      queueName: "knowledge.ingest",
      data: {
        ...expiryJob.data,
        runtimeEventId: expiryEvent.id,
        runtimeGeneration: expiryEvent.generation,
      },
      opts: { attempts: 5 },
      attemptsMade: 0,
    } as Parameters<typeof processLeadVirtJobWithReliability>[1];
    await assert.rejects(
      processLeadVirtJobWithReliability("knowledge.ingest", expiredBullJob, async () => {
        expiredExecutions += 1;
        return { status: "unexpected" };
      }),
      /expired/iu,
    );
    checks += 1;
    check(expiredExecutions === 0, "expired runtime event invoked ingestion");
    check(
      (
        await prisma.knowledgeJob.findUniqueOrThrow({
          where: { id: expiryJob.data.knowledgeJobId },
        })
      ).status === "DEAD_LETTER",
      "expired runtime event did not terminally update the durable job",
    );

    const dlqFixture = await fixture("ingestion-dlq");
    const dlqSource = await source({
      tenantId: dlqFixture.tenant.id,
      userId: dlqFixture.user.id,
      label: "DLQ Website",
    });
    const dlqJob = await queuedJob({
      tenantId: dlqFixture.tenant.id,
      userId: dlqFixture.user.id,
      sourceId: dlqSource.id,
      generation: dlqSource.generation,
      operation: "IMPORT",
    });
    await prisma.knowledgeJob.update({
      where: { id: dlqJob.data.knowledgeJobId },
      data: {
        status: "FAILED",
        errorCode: "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
        errorMessage: "Website source ingestion is not configured.",
      },
    });
    const dlqBullJob = {
      id: dlqJob.id,
      name: "import",
      queueName: "knowledge.ingest",
      data: dlqJob.data,
      opts: { attempts: 5 },
      attemptsMade: 1,
    } as Parameters<typeof captureDeadLetterJob>[1] extends infer T ? NonNullable<T> : never;
    const terminalError = new KnowledgeIngestionError(
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
      false,
      "ACQUIRING",
    );
    check(isFinalAttempt(dlqBullJob, terminalError) === false, "regular error was terminal early");
    const wrappedTerminal = new UnrecoverableError(terminalError.message);
    Object.defineProperty(wrappedTerminal, "knowledgeCode", { value: terminalError.code });
    Object.defineProperty(wrappedTerminal, "knowledgeStage", { value: terminalError.stage });
    check(
      isFinalAttempt(dlqBullJob, wrappedTerminal),
      "unrecoverable ingestion error was not treated as final",
    );
    await captureDeadLetterJob("knowledge.ingest", dlqBullJob, wrappedTerminal);
    check(
      (
        await prisma.knowledgeJob.findUniqueOrThrow({
          where: { id: dlqJob.data.knowledgeJobId },
        })
      ).status === "DEAD_LETTER",
      "DLQ capture did not terminally update the durable job",
    );
    const dlqAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: dlqFixture.tenant.id,
        action: "worker.job.dlq",
        entityId: dlqJob.id,
      },
      orderBy: { createdAt: "desc" },
    });
    const dlqPayload = JSON.stringify(dlqAudit.payload);
    check(!dlqPayload.includes("https://"), "DLQ audit exposed a raw source URL");
    check(!dlqPayload.includes("api_key"), "DLQ audit exposed source content");

    console.log(
      JSON.stringify({
        ok: true,
        checks,
        scenarios: [
          "fail-honest-pending-index",
          "queryable-readiness",
          "quarantine",
          "review-item-lifecycle",
          "hidden-security-change",
          "legal-hold",
          "duplicate",
          "stale-generation",
          "retry-crash",
          "reconcile-no-fetch",
          "delete-vector-fail-closed",
          "tenant-isolation",
          "config-disabled",
          "object-store-unavailable",
          "abort-signal",
          "timeout-fence",
          "actor-reauthorization",
          "runtime-expiry",
          "safe-dlq",
        ],
      }),
    );
  } finally {
    await purgeImmutableReviewFixtures();
    for (const item of fixtures.reverse()) {
      await prisma.tenant.delete({ where: { id: item.tenantId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: item.userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
