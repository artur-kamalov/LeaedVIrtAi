import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  buildKnowledgeV2SnapshotAuthorizationManifest,
  KnowledgeRetriever,
  LegacyKnowledgePublisher,
  type KnowledgeV2SnapshotAuthorizationManifest,
  type KnowledgeRuntimeConfig,
} from "@leadvirt/knowledge";
import { canonicalKnowledgeV2Hash } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface CandidateProjectionTestView {
  items: Array<{ itemType: string; itemId: string }>;
  blockers: Array<{ code: string; resource?: { id: string } }>;
}

interface PublicationServiceInternals {
  candidateProjection(
    db: never,
    tenantId: string,
    evaluatedAt?: Date,
  ): Promise<CandidateProjectionTestView>;
  finalizeDocumentPublication(tx: never, publication: never, activatedAt: Date): Promise<void>;
  snapshotAuthorizationManifest(
    tenantId: string,
    snapshot: never,
    items: never,
  ): KnowledgeV2SnapshotAuthorizationManifest;
  assertCurrentSnapshotAuthorization(
    tx: never,
    tenantId: string,
    manifest: KnowledgeV2SnapshotAuthorizationManifest,
    publicationItems: never,
  ): Promise<void>;
}

function sourcePermissionFingerprint(input: {
  tenantId: string;
  sourceId: string;
  permissionVersion: number;
  scope: Record<string, string[]>;
}) {
  return canonicalKnowledgeV2Hash({
    tenantId: input.tenantId,
    sourceId: input.sourceId,
    permissionVersion: input.permissionVersion,
    scope: input.scope,
    classification: "PUBLIC",
    locale: "en",
  });
}

function responseCode(error: unknown) {
  if (!error || typeof error !== "object" || !("getResponse" in error)) return null;
  const response = (error as { getResponse(): unknown }).getResponse();
  if (!response || typeof response !== "object" || !("code" in response)) return null;
  return (response as { code?: unknown }).code;
}

async function runV2AuthorizationRegressions() {
  const tenantId = "tenant-v2-publication-scope";
  const publicScope = { audiences: ["PUBLIC"] };
  const authenticatedScope = { audiences: ["AUTHENTICATED_CUSTOMER"] };
  const internals = new KnowledgeV2PublicationService(
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as PublicationServiceInternals;
  const projectionDb = (overrides: {
    documents?: unknown[];
    facts?: unknown[];
    guidanceRules?: unknown[];
  }) => ({
    knowledgeV2Settings: {
      findUnique: () =>
        Promise.resolve({ publicationApprovalPolicy: "OWNER_OR_ADMIN", draftGeneration: 1 }),
    },
    knowledgeV2Document: { findMany: () => Promise.resolve(overrides.documents ?? []) },
    knowledgeV2Fact: { findMany: () => Promise.resolve(overrides.facts ?? []) },
    knowledgeV2GuidanceRule: {
      findMany: () => Promise.resolve(overrides.guidanceRules ?? []),
    },
    knowledgeV2ReviewItem: { findMany: () => Promise.resolve([]) },
    knowledgeV2Conflict: { findMany: () => Promise.resolve([]) },
    activeKnowledgePublication: { findUnique: () => Promise.resolve(null) },
  });
  const nullScopeProjection = await internals.candidateProjection(
    projectionDb({
      facts: [
        {
          id: "fact-null-scope",
          factKey: "business/null-scope",
          latestVersionNumber: 1,
          versions: [
            {
              id: "fact-version-null-scope",
              versionNumber: 1,
              immutableHash: "f".repeat(64),
              scope: null,
              effectiveFrom: null,
              effectiveUntil: null,
              riskLevel: "LOW",
              authority: "MANUAL",
              verifiedByUserId: "owner",
              lifecycleStatus: "ACTIVE",
              verificationStatus: "VERIFIED",
              evidence: [],
            },
          ],
        },
      ],
      guidanceRules: [
        {
          id: "guidance-null-scope",
          title: "Null scope guidance",
          latestVersionNumber: 1,
          versions: [
            {
              id: "guidance-version-null-scope",
              versionNumber: 1,
              immutableHash: "g".repeat(64),
              title: "Null scope guidance",
              scope: null,
              effectiveFrom: null,
              effectiveUntil: null,
              riskLevel: "LOW",
              reviewStatus: "APPROVED",
              requiredApproverRole: "OWNER",
              approvedByUserId: "owner",
              evidence: [],
            },
          ],
        },
      ],
    }) as never,
    tenantId,
  );
  assert(
    !nullScopeProjection.items.some((item) => item.itemType === "FACT_VERSION"),
    "A fact with tenant-default scope entered the publication candidate.",
  );
  assert(
    !nullScopeProjection.items.some((item) => item.itemType === "GUIDANCE_RULE_VERSION"),
    "Guidance with tenant-default scope entered the publication candidate.",
  );
  assert(
    nullScopeProjection.blockers.filter(
      (blocker) => blocker.code === "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_UNAVAILABLE",
    ).length === 2,
    "Null fact and guidance scopes did not produce explicit publication blockers.",
  );

  const sourceId = "source-scope-regression";
  const revisionId = "revision-scope-regression";
  const permissionFingerprint = sourcePermissionFingerprint({
    tenantId,
    sourceId,
    permissionVersion: 2,
    scope: publicScope,
  });
  const source = {
    id: sourceId,
    tenantId,
    kind: "WEBSITE",
    status: "READY",
    generation: 1,
    etag: 1,
    sourcePermissionVersion: 2,
    defaultScope: publicScope,
    defaultClassification: "PUBLIC",
    defaultLocale: "en",
    lastErrorCode: null,
    tombstonedAt: null,
    deletedAt: null,
  };
  const revision = {
    id: revisionId,
    contentHash: "d".repeat(64),
    status: "READY",
    sourcePermissionFingerprint: permissionFingerprint,
    scopeSnapshot: publicScope,
    effectiveFrom: null,
    effectiveUntil: null,
    staleAfter: null,
    deletedAt: null,
    chunks: [
      {
        id: "chunk-scope-regression",
        contentHash: "c".repeat(64),
        scope: authenticatedScope,
        permissionVersion: 2,
        denseSchemaVersion: "dense-v1",
        sparseSchemaVersion: "sparse-v1",
        pipelineVersion: "knowledge-v2",
      },
    ],
  };
  const document = {
    id: "document-scope-regression",
    title: "Scope regression document",
    status: "ACTIVE",
    scope: publicScope,
    audience: ["PUBLIC"],
    classification: "PUBLIC",
    permissionVersion: 2,
    currentDraftRevisionId: revisionId,
    source,
    currentDraftRevision: revision,
  };
  const chunkMismatchProjection = await internals.candidateProjection(
    projectionDb({ documents: [document] }) as never,
    tenantId,
  );
  assert(
    !chunkMismatchProjection.items.some((item) => item.itemId === revisionId) &&
      chunkMismatchProjection.blockers.some(
        (blocker) =>
          blocker.code === "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH" &&
          blocker.resource?.id === document.id,
      ),
    "A mismatched valid chunk scope did not block the document candidate.",
  );

  const snapshotId = "snapshot-authorization-regression";
  const indexSchemaHash = "a".repeat(64);
  const snapshotDocumentItem = {
    itemType: "DOCUMENT_REVISION" as const,
    itemId: revisionId,
    itemVersionHash: revision.contentHash,
    label: document.title,
    scope: publicScope,
    usesTenantDefaultScope: false,
    tenantDefaultScopeGeneration: null,
    tenantDefaultScopeHash: null,
    authorizationFingerprint: permissionFingerprint,
  };
  const snapshotManifestHash = canonicalKnowledgeV2Hash({
    version: 1,
    corpusKind: "STRUCTURED_V2",
    documents: [
      {
        revisionId,
        contentHash: revision.contentHash,
        authorizationFingerprint: permissionFingerprint,
        scope: publicScope,
      },
    ],
    indexSchemaHash,
  });
  const authorization = buildKnowledgeV2SnapshotAuthorizationManifest({
    tenantId,
    snapshotId,
    snapshotManifestHash,
    indexSchemaHash,
    points: [
      {
        sourceId,
        sourceGeneration: 1,
        authorizationFingerprint: permissionFingerprint,
        permissionVersion: 2,
        chunkId: "chunk-authorization-regression",
        documentId: document.id,
        revisionId,
        contentHash: "c".repeat(64),
        vectorPointId: "00000000-0000-4000-8000-000000000001",
        pointFingerprint: "e".repeat(64),
      },
    ],
  });
  const snapshotRecord = {
    id: snapshotId,
    tenantId,
    manifestHash: snapshotManifestHash,
    indexSchemaHash,
    expectedPointCount: 1,
    observedPointCount: 1,
    authorizationManifest: authorization.manifest,
    authorizationManifestHash: authorization.hash,
    authorizationManifestVersion: 1,
  };
  assert(
    internals.snapshotAuthorizationManifest(
      tenantId,
      snapshotRecord as never,
      [snapshotDocumentItem] as never,
    ).snapshotId === snapshotId,
    "A valid snapshot authorization manifest failed publication reconciliation.",
  );
  const snapshotFailureCode = (snapshot: unknown, items: unknown) => {
    try {
      internals.snapshotAuthorizationManifest(tenantId, snapshot as never, items as never);
      return null;
    } catch (error) {
      return responseCode(error);
    }
  };
  assert(
    snapshotFailureCode(
      {
        ...snapshotRecord,
        authorizationManifest: null,
        authorizationManifestHash: null,
        authorizationManifestVersion: null,
      },
      [snapshotDocumentItem],
    ) === "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    "Publication validation accepted a missing authorization manifest.",
  );
  const tamperedManifest = {
    ...authorization.manifest,
    partitions: authorization.manifest.partitions.map((partition, index) =>
      index === 0 ? { ...partition, sourceGeneration: partition.sourceGeneration + 1 } : partition,
    ),
  };
  assert(
    snapshotFailureCode({ ...snapshotRecord, authorizationManifest: tamperedManifest }, [
      snapshotDocumentItem,
    ]) === "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    "Publication validation accepted a tampered authorization manifest.",
  );
  assert(
    snapshotFailureCode({ ...snapshotRecord, manifestHash: "b".repeat(64) }, [
      snapshotDocumentItem,
    ]) === "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    "Publication validation accepted a stale authorization manifest.",
  );
  const extraDocumentItem = {
    ...snapshotDocumentItem,
    itemId: "revision-authorization-extra",
    itemVersionHash: "f".repeat(64),
  };
  assert(
    snapshotFailureCode(snapshotRecord, [snapshotDocumentItem, extraDocumentItem]) ===
      "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    "Publication validation accepted a candidate revision absent from the snapshot manifest.",
  );
  const authorizationWithExtraRevision = buildKnowledgeV2SnapshotAuthorizationManifest({
    tenantId,
    snapshotId,
    snapshotManifestHash,
    indexSchemaHash,
    points: [
      {
        sourceId,
        sourceGeneration: 1,
        authorizationFingerprint: permissionFingerprint,
        permissionVersion: 2,
        chunkId: "chunk-authorization-regression",
        documentId: document.id,
        revisionId,
        contentHash: "c".repeat(64),
        vectorPointId: "00000000-0000-4000-8000-000000000001",
        pointFingerprint: "e".repeat(64),
      },
      {
        sourceId,
        sourceGeneration: 1,
        authorizationFingerprint: permissionFingerprint,
        permissionVersion: 2,
        chunkId: "chunk-authorization-extra",
        documentId: "document-authorization-extra",
        revisionId: extraDocumentItem.itemId,
        contentHash: "1".repeat(64),
        vectorPointId: "00000000-0000-4000-8000-000000000002",
        pointFingerprint: "2".repeat(64),
      },
    ],
  });
  assert(
    snapshotFailureCode(
      {
        ...snapshotRecord,
        expectedPointCount: 2,
        observedPointCount: 2,
        authorizationManifest: authorizationWithExtraRevision.manifest,
        authorizationManifestHash: authorizationWithExtraRevision.hash,
      },
      [snapshotDocumentItem],
    ) === "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    "Publication validation accepted a snapshot revision absent from the candidate.",
  );

  const publicationDocumentItem = {
    itemType: "DOCUMENT_REVISION",
    itemId: revisionId,
    itemVersionHash: revision.contentHash,
    authorizationFingerprint: permissionFingerprint,
    v2DocumentRevision: {
      ...revision,
      sourceId,
      documentId: document.id,
      document: {
        title: document.title,
        status: document.status,
        scope: document.scope,
        permissionVersion: document.permissionVersion,
        tombstonedAt: null,
        deletedAt: null,
        source,
      },
    },
  };
  const authorizationTx = (currentSource: unknown) => ({
    $queryRaw: () => Promise.resolve([]),
    knowledgeV2Source: { findMany: () => Promise.resolve([currentSource]) },
  });
  await internals.assertCurrentSnapshotAuthorization(
    authorizationTx({ ...source, generation: 2 }) as never,
    tenantId,
    authorization.manifest,
    [publicationDocumentItem] as never,
  );
  let revokedAuthorizationError: unknown = null;
  let casReached = false;
  try {
    await internals.assertCurrentSnapshotAuthorization(
      authorizationTx({ ...source, generation: 2, sourcePermissionVersion: 3 }) as never,
      tenantId,
      authorization.manifest,
      [publicationDocumentItem] as never,
    );
    casReached = true;
  } catch (error) {
    revokedAuthorizationError = error;
  }
  assert(
    responseCode(revokedAuthorizationError) ===
      "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH" && !casReached,
    "A source permission revocation reached the publication CAS.",
  );

  let activationError: unknown = null;
  try {
    await internals.finalizeDocumentPublication(
      {
        $queryRaw: () => Promise.resolve([]),
        knowledgeV2Source: { findFirst: () => Promise.resolve(source) },
        knowledgeV2DocumentRevision: {
          updateMany: () => {
            throw new Error("Activation wrote the revision before checking chunk scope.");
          },
        },
      } as never,
      {
        id: "publication-scope-regression",
        tenantId,
        qualitySummary: { operation: "PUBLISH" },
        indexSnapshotId: "snapshot-scope-regression",
        indexSnapshot: {
          v2Items: [
            {
              chunkId: "chunk-scope-regression",
              contentHash: "c".repeat(64),
              vectorPointId: "point-scope-regression",
              chunk: {
                revisionId,
                scope: authenticatedScope,
                permissionVersion: 2,
              },
            },
          ],
        },
        items: [
          {
            itemType: "DOCUMENT_REVISION",
            itemId: revisionId,
            itemVersionHash: revision.contentHash,
            authorizationFingerprint: permissionFingerprint,
            v2DocumentRevision: {
              ...revision,
              sourceId,
              documentId: document.id,
              document: {
                title: document.title,
                status: document.status,
                scope: document.scope,
                permissionVersion: document.permissionVersion,
                tombstonedAt: null,
                deletedAt: null,
                source,
              },
            },
          },
        ],
      } as never,
      new Date(),
    );
  } catch (error) {
    activationError = error;
  }
  assert(
    responseCode(activationError) === "KNOWLEDGE_PUBLICATION_MANIFEST_INVALID",
    "Activation did not reject a snapshot chunk with a mismatched valid scope.",
  );
}

async function main() {
  await runV2AuthorizationRegressions();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const config: KnowledgeRuntimeConfig = {
    mode: "database",
    qdrantUrl: "http://localhost:6333",
    qdrantCollection: `knowledge_publication_smoke_${suffix.replaceAll("-", "_")}`,
    qdrantTimeoutMs: 1000,
    minScore: 0.05,
    candidateLimit: 20,
    targetKey: "workspace",
  };
  const publisher = new LegacyKnowledgePublisher(prisma, config);
  const retriever = new KnowledgeRetriever(prisma, config);
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Knowledge Publication Smoke",
        slug: `knowledge-publication-${suffix}`,
        businessType: "beauty",
        timezone: "Europe/Paris",
      },
    });
    tenantId = tenant.id;
    const oldMarker = `phasezerohaircut${suffix.replaceAll("-", "")}`;
    const newMarker = `phasezerocoloring${suffix.replaceAll("-", "")}`;
    const source = await prisma.businessKnowledgeSource.create({
      data: {
        tenantId,
        type: "CATALOG",
        status: "ACTIVE",
        source: "phase0-smoke",
        sourceKey: `phase0:${suffix}`,
        title: "Phase 0 catalog",
        content: `${oldMarker} haircut costs 2500 RUB and takes 60 minutes.`,
      },
    });

    const first = await publisher.publish({ tenantId, reason: "smoke_first" });
    assert(first.status === "activated", "The first knowledge publication was not activated.");
    assert(
      first.revisionCount === 1 && first.chunkCount === 1,
      "The first publication manifest is incomplete.",
    );

    const firstRetrieval = await retriever.retrieve({
      tenantId,
      query: `${oldMarker} price`,
      limit: 5,
    });
    assert(firstRetrieval.status === "grounded", "Published knowledge was not retrievable.");
    assert(
      firstRetrieval.publicationId === first.publicationId,
      "Retrieval did not capture the active publication.",
    );
    assert(
      firstRetrieval.evidence.some((item) => item.content.includes(oldMarker)),
      "Published evidence is missing.",
    );

    const irrelevant = await retriever.retrieve({
      tenantId,
      query: "unrelated quantum submarine",
      limit: 5,
    });
    assert(
      irrelevant.status === "insufficient_grounding",
      "Irrelevant content did not produce insufficient grounding.",
    );
    assert(irrelevant.evidence.length === 0, "Irrelevant retrieval returned arbitrary evidence.");

    await prisma.businessKnowledgeSource.update({
      where: { id: source.id },
      data: {
        content: `${newMarker} coloring costs 6000 RUB and requires consultation.`,
        version: { increment: 1 },
      },
    });
    const second = await publisher.publish({ tenantId, reason: "smoke_update" });
    assert(second.status === "activated", "Updated knowledge did not activate a new publication.");
    assert(
      second.sequence === first.sequence + 1,
      "Publication sequence did not advance exactly once.",
    );

    const activeRetrieval = await retriever.retrieve({
      tenantId,
      query: `${newMarker} price`,
      limit: 5,
    });
    assert(activeRetrieval.status === "grounded", "Updated knowledge is not active.");
    assert(
      activeRetrieval.publicationId === second.publicationId,
      "Updated retrieval used the wrong publication.",
    );

    const capturedOld = await retriever.retrieve({
      tenantId,
      publicationId: first.publicationId,
      query: `${oldMarker} price`,
      limit: 5,
    });
    assert(
      capturedOld.status === "grounded",
      "The captured old publication is not reproducible after an edit.",
    );
    assert(
      capturedOld.evidence.some((item) => item.content.includes(oldMarker)),
      "Old immutable evidence was overwritten.",
    );

    const unchanged = await publisher.publish({ tenantId, reason: "smoke_unchanged" });
    assert(unchanged.status === "unchanged", "An unchanged manifest created another publication.");
    assert(
      unchanged.publicationId === second.publicationId,
      "Unchanged publication identity drifted.",
    );

    await prisma.businessKnowledgeSource.update({
      where: { id: source.id },
      data: { status: "ARCHIVED", deletedAt: new Date(), version: { increment: 1 } },
    });
    const archived = await publisher.publish({ tenantId, reason: "smoke_archive" });
    assert(
      archived.status === "activated" && archived.chunkCount === 0,
      "Archive did not publish an empty active snapshot.",
    );

    const archivedActive = await retriever.retrieve({
      tenantId,
      query: `${newMarker} price`,
      limit: 5,
    });
    assert(archivedActive.status === "insufficient_grounding", "Archived content remains active.");
    const archivedOld = await retriever.retrieve({
      tenantId,
      publicationId: second.publicationId,
      query: `${newMarker} price`,
      limit: 5,
    });
    assert(
      archivedOld.status === "insufficient_grounding",
      "Logical deletion did not deny an older publication immediately.",
    );

    const counts = await Promise.all([
      prisma.knowledgeRevision.count({ where: { tenantId } }),
      prisma.knowledgeRevisionChunk.count({ where: { tenantId } }),
      prisma.knowledgeIndexSnapshot.count({ where: { tenantId, status: "READY" } }),
      prisma.knowledgePublication.count({ where: { tenantId } }),
      prisma.activeKnowledgePublication.count({ where: { tenantId } }),
    ]);
    assert(counts[0] === 2, `Expected 2 immutable revisions, received ${counts[0]}.`);
    assert(counts[1] === 2, `Expected 2 immutable chunks, received ${counts[1]}.`);
    assert(counts[2] === 3, `Expected 3 ready index snapshots, received ${counts[2]}.`);
    assert(counts[3] === 3 && counts[4] === 1, "Publication pointer cardinality is invalid.");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId,
        publications: [first.publicationId, second.publicationId, archived.publicationId],
        sequences: [first.sequence, second.sequence, archived.sequence],
        counts,
        v2AuthorizationRegressionChecks: 13,
      }),
    );
  } finally {
    if (tenantId) {
      await prisma.activeKnowledgePublication
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await prisma.knowledgePublication.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.knowledgeIndexSnapshot
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
