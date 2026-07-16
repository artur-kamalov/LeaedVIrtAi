import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeSourceQueueService } from "../../apps/api/src/modules/knowledge/knowledge-source-queue.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2SourceService } from "../../apps/api/src/modules/knowledge/knowledge-v2-source.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function config(enabled: boolean) {
  return {
    env: { APP_ENV: "local" },
    redisUrl: "redis://localhost:6380",
    knowledgeWebsiteImportEnabled: enabled,
    knowledgeWebsiteEgressReady: enabled,
    knowledgeAcceptanceWebsiteFixtureEnabled: false,
    knowledgeObjectStorePath: enabled ? resolve(".leadvirt/knowledge-smoke") : undefined,
    knowledgeArtifactEncryptionKey: enabled ? Buffer.alloc(32, 1).toString("base64") : undefined,
    knowledgeArtifactEncryptionKeyId: enabled ? "knowledge-smoke-key" : undefined,
  } as unknown as AppConfigService;
}

function context(
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: RequestContext["tenant"]["status"];
    businessType: string | null;
    timezone: string;
  },
  user: RequestContext["user"],
  role: RequestContext["role"] = "OWNER",
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "credentials",
    tenant,
    user,
  };
}

async function expectKnowledgeError(action: Promise<unknown>, status: number, code: string) {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof HttpException) || error.getStatus() !== status) throw error;
    const payload = error.getResponse();
    assert(
      typeof payload === "object" && payload !== null && "code" in payload && payload.code === code,
      `Expected ${code}, received ${JSON.stringify(payload)}.`,
    );
    return;
  }
  throw new Error(`Expected ${status} ${code}.`);
}

function queuedOperation(payload: Prisma.JsonValue) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const data = payload.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return typeof data.operation === "string" ? data.operation : null;
}

async function cleanupTenant(prisma: PrismaService, tenantId: string) {
  await prisma.knowledgeV2Document.updateMany({
    where: { tenantId },
    data: { currentDraftRevisionId: null, currentPublishedRevisionId: null },
  });
  await prisma.knowledgeV2DeletionLedger.deleteMany({ where: { tenantId } });
  await prisma.knowledgeJob.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2Chunk.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2Element.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2DocumentRevision.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2Document.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2Artifact.deleteMany({ where: { tenantId } });
  await prisma.knowledgeV2Source.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: "Knowledge v2 source smoke",
      slug: `kv2-source-${stamp}`,
      businessType: "services",
      timezone: "Europe/Paris",
    },
  });
  const otherTenant = await prisma.tenant.create({
    data: { name: "Knowledge v2 source isolation", slug: `kv2-source-other-${stamp}` },
  });
  const user = await prisma.user.create({
    data: { email: `kv2-source-${stamp}@example.test`, name: "Source owner" },
  });
  await prisma.membership.create({
    data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
  });

  const owner = context(tenant, user);
  const otherOwner = context(otherTenant, user);
  const manager = context(tenant, user, "MANAGER");
  const agent = context(tenant, user, "AGENT");
  const viewer = context(tenant, user, "VIEWER");
  const enabledConfig = config(true);
  const queue = new KnowledgeSourceQueueService(enabledConfig, prisma);
  const dispatchedEventIds: string[] = [];
  queue.dispatch = (eventId: string) => {
    dispatchedEventIds.push(eventId);
  };
  const idempotency = new KnowledgeV2IdempotencyService(prisma);
  const service = new KnowledgeV2SourceService(prisma, idempotency, queue, enabledConfig);
  const disabledService = new KnowledgeV2SourceService(prisma, idempotency, queue, config(false));
  const relativeStoreConfig = Object.assign(config(true), {
    knowledgeObjectStorePath: ".leadvirt/relative-store",
  });
  const invalidKeyConfig = Object.assign(config(true), {
    knowledgeArtifactEncryptionKey: "not-a-valid-key",
  });

  try {
    await expectKnowledgeError(
      disabledService.createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Disabled website",
          canonicalUri: "https://example.com/",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `disabled-${stamp}`,
      ),
      503,
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
    );
    await expectKnowledgeError(
      new KnowledgeV2SourceService(prisma, idempotency, queue, relativeStoreConfig).createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Relative store website",
          canonicalUri: "https://example.com/",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `relative-store-${stamp}`,
      ),
      503,
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
    );
    await expectKnowledgeError(
      new KnowledgeV2SourceService(prisma, idempotency, queue, invalidKeyConfig).createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Invalid key website",
          canonicalUri: "https://example.com/",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `invalid-key-${stamp}`,
      ),
      503,
      "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
    );
    await expectKnowledgeError(
      service.createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Query website",
          canonicalUri: `https://example.com/?token=raw-url-${stamp}`,
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `query-url-${stamp}`,
      ),
      400,
      "KNOWLEDGE_SOURCE_URL_QUERY_NOT_ALLOWED",
    );
    await expectKnowledgeError(
      service.createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Internal source with public audience",
          canonicalUri: "https://example.com/",
          defaultClassification: "INTERNAL",
          defaultLocale: "en",
          defaultScope: { audiences: ["PUBLIC"] },
        },
        `classification-audience-${stamp}`,
      ),
      400,
      "KNOWLEDGE_VALIDATION_SCOPE_CLASSIFICATION_CONFLICT",
    );
    await expectKnowledgeError(
      service.createSource(
        manager,
        {
          kind: "MANUAL",
          displayName: "Manager source",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `manager-${stamp}`,
      ),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );
    await expectKnowledgeError(
      service.createSource(
        owner,
        {
          kind: "MANUAL",
          displayName: "Unsupported manual source",
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `unsupported-${stamp}`,
      ),
      422,
      "KNOWLEDGE_SOURCE_KIND_UNSUPPORTED",
    );

    const createInput = {
      kind: "WEBSITE" as const,
      displayName: "Service handbook",
      canonicalUri: "https://example.com/",
      defaultClassification: "PUBLIC" as const,
      defaultLocale: "en",
      defaultScope: { audiences: ["INTERNAL" as const] },
    };
    const created = await service.createSource(owner, createInput, `create-${stamp}`);
    const replay = await service.createSource(owner, createInput, `create-${stamp}`);
    const dependencyIndependentReplay = await disabledService.createSource(
      owner,
      createInput,
      `create-${stamp}`,
    );
    assert(created.resource.type === "SOURCE", "Create did not return a source resource.");
    assert(
      replay.jobId === created.jobId &&
        replay.idempotencyReplayed &&
        dependencyIndependentReplay.jobId === created.jobId &&
        dependencyIndependentReplay.idempotencyReplayed,
      "Create replay drifted or depended on live ingestion configuration.",
    );
    await expectKnowledgeError(
      disabledService.createSource(
        owner,
        { ...createInput, displayName: "Reused key with changed input" },
        `create-${stamp}`,
      ),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    const sourceId = created.resource.id;
    const sourceRecord = await prisma.knowledgeV2Source.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert(
      sourceRecord.externalRootKey?.startsWith("website:") &&
        !sourceRecord.externalRootKey.includes(createInput.displayName),
      "The server did not derive an opaque external root key.",
    );
    const ownerSourceView = await service.getSource(owner, sourceId);
    assert(
      !JSON.stringify(ownerSourceView).includes(sourceRecord.externalRootKey),
      "The public source view exposed the internal root key.",
    );
    assert(
      (await service.listSources(owner, { query: sourceRecord.externalRootKey })).items.length ===
        0,
      "The public source search exposed the internal root key.",
    );

    const createJob = await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: created.jobId } });
    assert(createJob.v2SourceId === sourceId, "Create job lost its source identity.");
    assert(createJob.payloadRef?.startsWith("runtime-outbox:"), "Create job has no outbox ref.");
    const createEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: createJob.payloadRef.slice("runtime-outbox:".length) },
    });
    assert(
      createEvent.aggregateId === sourceId &&
        createEvent.generation === sourceRecord.generation &&
        queuedOperation(createEvent.payload) === "IMPORT",
      "Create job and outbox event are inconsistent.",
    );
    assert(dispatchedEventIds.length === 1, "Create replay dispatched the outbox twice.");

    assert(
      (await service.listSources(agent, {})).items.length === 0 &&
        (await service.listSources(viewer, {})).items.length === 0 &&
        (await service.listSources(manager, {})).items.some((source) => source.id === sourceId),
      "Source audience policy did not fail closed for lower roles.",
    );
    await expectKnowledgeError(
      service.getSource(agent, sourceId),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );

    assert(
      (await service.listSources(otherOwner, {})).items.length === 0,
      "Source list leaked tenants.",
    );
    await expectKnowledgeError(
      service.getSource(otherOwner, sourceId),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );

    await prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.id },
      data: { maxDocuments: 1 },
    });
    await expectKnowledgeError(
      service.createSource(
        owner,
        {
          kind: "WEBSITE",
          displayName: "Over quota",
          canonicalUri: `https://example.com/quota-${stamp}`,
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
        `quota-${stamp}`,
      ),
      422,
      "KNOWLEDGE_QUOTA_DOCUMENT_LIMIT_REACHED",
    );
    await prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.id },
      data: { maxDocuments: 1_000 },
    });

    await prisma.knowledgeV2Source.update({
      where: { id: sourceId },
      data: { status: "READY", etag: { increment: 1 }, lastSuccessAt: new Date() },
    });
    const denyDocument = await prisma.knowledgeV2Document.create({
      data: {
        tenantId: tenant.id,
        sourceId,
        externalKey: `deny-${stamp}`,
        kind: "WEB_PAGE",
        title: "Permission fence sentinel",
        canonicalLocale: "en",
        scope: { audiences: ["INTERNAL"] },
        audience: ["INTERNAL"],
        classification: "INTERNAL",
        status: "ACTIVE",
      },
    });
    const denyRevision = await prisma.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: tenant.id,
        sourceId,
        documentId: denyDocument.id,
        revisionNumber: 1,
        contentHash: "a".repeat(64),
        status: "READY",
        pipelineVersion: "knowledge-v2",
        sourcePermissionFingerprint: "b".repeat(64),
      },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: denyDocument.id },
      data: { currentDraftRevisionId: denyRevision.id },
    });
    const denyChunk = await prisma.knowledgeV2Chunk.create({
      data: {
        tenantId: tenant.id,
        revisionId: denyRevision.id,
        documentId: denyDocument.id,
        ordinal: 0,
        contentHash: "c".repeat(64),
        tokenCount: 1,
        locale: "en",
        scope: { audiences: ["INTERNAL"] },
        classification: "INTERNAL",
        permissionVersion: 1,
        denseSchemaVersion: "dense-v1",
        sparseSchemaVersion: "sparse-v1",
        pipelineVersion: "knowledge-v2",
        vectorPointId: `deny-vector-${stamp}`,
        indexState: "INDEXED",
        provenanceRange: { start: 0, end: 1 },
      },
    });
    const ready = await service.getSource(owner, sourceId);
    await expectKnowledgeError(
      service.updateSource(owner, sourceId, { displayName: "Stale edit" }, `stale-${stamp}`, [
        '"stale-etag"',
      ]),
      412,
      "REVISION_CONFLICT",
    );
    const renamed = await service.updateSource(
      owner,
      sourceId,
      { displayName: "Updated handbook" },
      `rename-${stamp}`,
      [ready.etag],
    );
    assert(!renamed.job, "Display-name edit unexpectedly queued work.");
    assert(
      renamed.resource.generation === ready.generation,
      "Display-name edit changed generation.",
    );

    const reconciled = await service.updateSource(
      owner,
      sourceId,
      { defaultLocale: "fr" },
      `locale-${stamp}`,
      [renamed.resource.etag],
    );
    assert(
      reconciled.job && reconciled.resource.generation === ready.generation + 1,
      "Material edit did not queue reconciliation.",
    );
    const reconcileJob = await prisma.knowledgeJob.findUniqueOrThrow({
      where: { id: reconciled.job.jobId },
    });
    const reconcileEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: reconcileJob.payloadRef!.slice("runtime-outbox:".length) },
    });
    assert(
      reconcileJob.stage === "RECONCILING" &&
        queuedOperation(reconcileEvent.payload) === "RECONCILE",
      "Material edit used the wrong queue operation.",
    );
    assert(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: {
          tenantId: tenant.id,
          sourceId,
          sourceGeneration: reconciled.resource.generation,
          targetType: "SOURCE",
          targetId: sourceId,
        },
      })) === 2,
      "Material edit did not record permission reconciliation.",
    );
    const [immediatelyDeniedChunk, permissionBumpedDocument] = await Promise.all([
      prisma.knowledgeV2Chunk.findUniqueOrThrow({ where: { id: denyChunk.id } }),
      prisma.knowledgeV2Document.findUniqueOrThrow({ where: { id: denyDocument.id } }),
    ]);
    assert(
      immediatelyDeniedChunk.indexState === "DELETED" &&
        immediatelyDeniedChunk.deletedAt &&
        permissionBumpedDocument.deletionGeneration === 2,
      "Material source edit did not immediately deny stale chunks.",
    );

    await prisma.knowledgeV2Source.update({
      where: { id: sourceId },
      data: { status: "READY", etag: { increment: 1 } },
    });
    const beforePause = await service.getSource(owner, sourceId);
    const pauseReason = `pause raw reason ${stamp}`;
    const paused = await service.pauseSource(
      owner,
      sourceId,
      { reason: pauseReason },
      `pause-${stamp}`,
      [beforePause.etag],
    );
    assert(paused.resource.status === "PAUSED", "Pause was not synchronous.");
    const jobCountBeforeDeferred = await prisma.knowledgeJob.count({
      where: { tenantId: tenant.id },
    });
    const deferred = await service.updateSource(
      owner,
      sourceId,
      { defaultClassification: "INTERNAL" },
      `deferred-${stamp}`,
      [paused.resource.etag],
    );
    assert(
      deferred.resource.status === "NEEDS_REVIEW" && !deferred.job,
      "Paused material edit was not deferred.",
    );
    assert(
      (await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } })) ===
        jobCountBeforeDeferred,
      "Paused material edit queued work.",
    );
    assert(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: {
          tenantId: tenant.id,
          sourceId,
          sourceGeneration: deferred.resource.generation,
          targetType: "SOURCE",
          targetId: sourceId,
        },
      })) === 2,
      "Deferred material edit did not preserve cleanup proof.",
    );
    assert(
      (await prisma.knowledgeV2DeletionLedger.count({
        where: {
          tenantId: tenant.id,
          sourceId,
          sourceGeneration: reconciled.resource.generation,
          targetType: "SOURCE",
          targetId: sourceId,
          subsystem: { in: ["VECTOR_INDEX", "CACHE"] },
        },
      })) === 0,
      "Deferred permission edit left superseded reconciliation rows behind.",
    );
    await expectKnowledgeError(
      service.syncSource(
        owner,
        sourceId,
        { reason: `invalid deferred sync ${stamp}` },
        `deferred-sync-${stamp}`,
        [deferred.resource.etag],
      ),
      409,
      "KNOWLEDGE_CONFLICT_ACTION_NOT_ALLOWED",
    );
    const resumed = await disabledService.resumeSource(
      owner,
      sourceId,
      { reason: `resume raw reason ${stamp}` },
      `resume-${stamp}`,
      [deferred.resource.etag],
    );
    const resumeJob = await prisma.knowledgeJob.findUniqueOrThrow({ where: { id: resumed.jobId } });
    const resumeEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: resumeJob.payloadRef!.slice("runtime-outbox:".length) },
    });
    const resumedSource = await prisma.knowledgeV2Source.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert(
      queuedOperation(resumeEvent.payload) === "RECONCILE" &&
        resumeJob.stage === "RECONCILING" &&
        resumeJob.generation === deferred.resource.generation &&
        resumedSource.generation === deferred.resource.generation,
      "Deferred resume did not preserve its fence and queue network-independent reconciliation.",
    );

    const objectStorageKey = `private/object/${stamp}`;
    const encryptionKeyRef = `private-encryption-${stamp}`;
    const extractedObjectKey = `private/extracted/${stamp}`;
    const elementObjectKey = `private/element/${stamp}`;
    const vectorPointId = `private-vector-${stamp}`;
    const previewContent = `private preview content ${stamp}`;
    const documentExternalKey = `handbook-${stamp}`;
    const documentUriSecret = `document-uri-secret-${stamp}`;
    const sourcePermissionFingerprint = "3".repeat(64);
    const artifact = await prisma.knowledgeV2Artifact.create({
      data: {
        tenantId: tenant.id,
        sourceId,
        objectStorageKey,
        encryptionKeyRef,
        sha256: "1".repeat(64),
        byteSize: 128n,
        acquisitionUriHash: `private-acquisition-${stamp}`,
        securityClassification: "INTERNAL",
        retentionClass: "standard",
        malwareStatus: "CLEAN",
        mimeValidationStatus: "VALID",
      },
    });
    const document = await prisma.knowledgeV2Document.create({
      data: {
        tenantId: tenant.id,
        sourceId,
        externalKey: documentExternalKey,
        kind: "WEB_PAGE",
        canonicalUri: `https://user:password@redacted.example.test/handbook?token=${documentUriSecret}#private`,
        title: "Service handbook",
        canonicalLocale: "fr",
        scope: { audiences: ["INTERNAL"] },
        audience: ["INTERNAL"],
        classification: "INTERNAL",
        status: "ACTIVE",
      },
    });
    const revision = await prisma.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: tenant.id,
        sourceId,
        documentId: document.id,
        revisionNumber: 1,
        contentHash: "2".repeat(64),
        artifactId: artifact.id,
        extractedContentObjectKey: extractedObjectKey,
        status: "READY",
        pipelineVersion: "knowledge-v2",
        sourcePermissionFingerprint,
        parserQuality: { score: 0.99 },
      },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: document.id },
      data: { currentDraftRevisionId: revision.id, currentPublishedRevisionId: revision.id },
    });
    const element = await prisma.knowledgeV2Element.create({
      data: {
        tenantId: tenant.id,
        documentId: document.id,
        revisionId: revision.id,
        kind: "PARAGRAPH",
        ordinal: 0,
        normalizedText: previewContent,
        objectStorageKey: elementObjectKey,
        contentHash: "4".repeat(64),
        locale: "fr",
        classification: "INTERNAL",
      },
    });
    const chunk = await prisma.knowledgeV2Chunk.create({
      data: {
        tenantId: tenant.id,
        revisionId: revision.id,
        documentId: document.id,
        ordinal: 0,
        parentElementId: element.id,
        contentHash: "5".repeat(64),
        tokenCount: 4,
        locale: "fr",
        classification: "INTERNAL",
        permissionVersion: 1,
        denseSchemaVersion: "dense-v1",
        sparseSchemaVersion: "sparse-v1",
        pipelineVersion: "knowledge-v2",
        vectorPointId,
        indexState: "INDEXED",
        provenanceRange: { start: 0, end: 24 },
      },
    });

    const preview = await service.previewRevision(owner, revision.id);
    const previewJson = JSON.stringify(preview);
    const documentViewJson = JSON.stringify(await service.getDocument(owner, document.id));
    for (const privateValue of [
      objectStorageKey,
      encryptionKeyRef,
      extractedObjectKey,
      elementObjectKey,
      vectorPointId,
      artifact.id,
      sourcePermissionFingerprint,
      documentExternalKey,
      documentUriSecret,
      "user:password",
    ]) {
      assert(
        !previewJson.includes(privateValue) && !documentViewJson.includes(privateValue),
        `A public document response exposed ${privateValue}.`,
      );
    }
    assert(previewJson.includes(previewContent), "Preview omitted normalized content.");
    assert(
      preview.elements[0]?.hasObjectReference,
      "Preview lost the redacted object reference flag.",
    );
    assert(
      (await service.previewRevision(manager, revision.id)).elements[0]?.normalizedText ===
        previewContent,
      "The explicit manager review policy did not allow internal source content.",
    );
    await expectKnowledgeError(
      service.getDocument(agent, document.id),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );
    await expectKnowledgeError(
      service.listDocumentRevisions(agent, document.id, {}),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );
    await expectKnowledgeError(
      service.previewRevision(agent, revision.id),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );

    const publicRootKey = `manual:public-${stamp}`;
    const publicUriSecret = `public-uri-secret-${stamp}`;
    const publicSource = await prisma.knowledgeV2Source.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        displayName: "Public FAQ",
        externalRootKey: publicRootKey,
        canonicalUri: `https://public.example.test/faq?token=${publicUriSecret}`,
        status: "READY",
        defaultScope: { audiences: ["PUBLIC"] },
        defaultClassification: "PUBLIC",
        defaultLocale: "en",
      },
    });
    const publicExternalKey = `public-document-${stamp}`;
    const publicDocument = await prisma.knowledgeV2Document.create({
      data: {
        tenantId: tenant.id,
        sourceId: publicSource.id,
        externalKey: publicExternalKey,
        kind: "MANUAL_DOCUMENT",
        canonicalUri: `https://public.example.test/faq?token=${publicUriSecret}`,
        title: "Public answers",
        canonicalLocale: "en",
        scope: { audiences: ["PUBLIC"] },
        audience: ["PUBLIC"],
        classification: "PUBLIC",
        status: "ACTIVE",
      },
    });
    const publicFingerprint = "6".repeat(64);
    const publicRevision = await prisma.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: tenant.id,
        sourceId: publicSource.id,
        documentId: publicDocument.id,
        revisionNumber: 1,
        contentHash: "7".repeat(64),
        status: "READY",
        pipelineVersion: "knowledge-v2",
        sourcePermissionFingerprint: publicFingerprint,
        scopeSnapshot: { audiences: ["PUBLIC"] },
      },
    });
    const publicContent = `public answer ${stamp}`;
    await prisma.knowledgeV2Element.create({
      data: {
        tenantId: tenant.id,
        documentId: publicDocument.id,
        revisionId: publicRevision.id,
        kind: "PARAGRAPH",
        ordinal: 0,
        normalizedText: publicContent,
        contentHash: "8".repeat(64),
        locale: "en",
        classification: "PUBLIC",
      },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: publicDocument.id },
      data: {
        currentDraftRevisionId: publicRevision.id,
        currentPublishedRevisionId: publicRevision.id,
      },
    });

    const agentSources = await service.listSources(agent, {});
    const viewerDocuments = await service.listDocuments(viewer, {});
    const publicSourceViewJson = JSON.stringify(await service.getSource(viewer, publicSource.id));
    const publicDocumentViewJson = JSON.stringify(
      await service.getDocument(viewer, publicDocument.id),
    );
    assert(
      agentSources.items.some((source) => source.id === publicSource.id) &&
        !agentSources.items.some((source) => source.id === sourceId) &&
        viewerDocuments.items.some((item) => item.id === publicDocument.id) &&
        !viewerDocuments.items.some((item) => item.id === document.id),
      "Public/customer ABAC did not isolate internal source content.",
    );
    for (const privateValue of [
      publicRootKey,
      publicExternalKey,
      publicFingerprint,
      publicUriSecret,
    ]) {
      assert(
        !publicSourceViewJson.includes(privateValue) &&
          !publicDocumentViewJson.includes(privateValue),
        `A customer-facing view exposed ${privateValue}.`,
      );
    }
    const agentPublicPreview = await service.previewRevision(agent, publicRevision.id);
    assert(
      agentPublicPreview.elements[0]?.normalizedText === publicContent &&
        !JSON.stringify(agentPublicPreview).includes(publicFingerprint),
      "Agent safe preview did not preserve public content redaction.",
    );
    const viewerRevisions = await service.listDocumentRevisions(viewer, publicDocument.id, {});
    assert(
      viewerRevisions.items.length === 1 && viewerRevisions.items[0]?.allowedActions.length === 0,
      "Viewer revision metadata advertised unauthorized preview actions.",
    );
    await prisma.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: tenant.id,
        sourceId: publicSource.id,
        documentId: publicDocument.id,
        revisionNumber: 2,
        contentHash: "9".repeat(64),
        status: "REJECTED",
        pipelineVersion: "knowledge-v2",
        sourcePermissionFingerprint: "0".repeat(64),
        scopeSnapshot: { audiences: ["PUBLIC"] },
      },
    });
    assert(
      (await service.listDocumentRevisions(agent, publicDocument.id, { status: "REJECTED" })).items
        .length === 0 &&
        (await service.listDocumentRevisions(owner, publicDocument.id, { status: "REJECTED" }))
          .items.length === 1,
      "A client status filter overrode revision ABAC.",
    );
    await expectKnowledgeError(
      service.previewRevision(viewer, publicRevision.id),
      403,
      "KNOWLEDGE_PERMISSION_ACTION_DENIED",
    );

    const excludeReason = `exclude raw reason ${stamp}`;
    const excluded = await service.excludeRevision(
      owner,
      revision.id,
      { reason: excludeReason },
      `exclude-${stamp}`,
      [preview.revision.etag],
    );
    assert(excluded.resource.type === "REVISION", "Exclude returned the wrong resource.");
    const [excludedRevision, excludedChunk, excludedDocument, excludeJob, excludeLedgers] =
      await Promise.all([
        prisma.knowledgeV2DocumentRevision.findUniqueOrThrow({ where: { id: revision.id } }),
        prisma.knowledgeV2Chunk.findUniqueOrThrow({ where: { id: chunk.id } }),
        prisma.knowledgeV2Document.findUniqueOrThrow({ where: { id: document.id } }),
        prisma.knowledgeJob.findUniqueOrThrow({ where: { id: excluded.jobId } }),
        prisma.knowledgeV2DeletionLedger.findMany({
          where: {
            tenantId: tenant.id,
            sourceId,
            targetType: "REVISION",
            targetId: revision.id,
          },
        }),
      ]);
    assert(excludedRevision.status === "REJECTED", "Exclude did not reject the revision.");
    assert(excludedChunk.indexState === "DELETED" && excludedChunk.deletedAt, "Chunk deny failed.");
    assert(
      excludedDocument.currentDraftRevisionId === null &&
        excludedDocument.currentPublishedRevisionId === null &&
        excludedDocument.status === "NEEDS_REVIEW",
      "Excluded revision remained the document draft.",
    );
    assert(excludeJob.v2RevisionId === revision.id, "Exclude job lost the revision identity.");
    assert(
      excludeLedgers.length === 2 &&
        excludeLedgers.every((ledger) => ledger.status === "PENDING" && ledger.deniedAt),
      "Exclude did not preserve vector/cache cleanup proof.",
    );
    const excludeEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: excludeJob.payloadRef!.slice("runtime-outbox:".length) },
    });
    assert(
      queuedOperation(excludeEvent.payload) === "RECONCILE",
      "Exclude did not queue reconciliation.",
    );

    const policySource = await prisma.knowledgeV2Source.create({
      data: {
        tenantId: tenant.id,
        kind: "WEBSITE",
        displayName: "Public policy source",
        externalRootKey: `website:policy-${stamp}`,
        canonicalUri: "https://policy.example.test/",
        status: "READY",
        defaultScope: { audiences: ["PUBLIC"] },
        defaultClassification: "PUBLIC",
        defaultLocale: "en",
      },
    });
    const policySourceView = await service.getSource(owner, policySource.id);
    await expectKnowledgeError(
      service.updateSource(
        owner,
        policySource.id,
        { defaultClassification: "INTERNAL" },
        `classification-patch-${stamp}`,
        [policySourceView.etag],
      ),
      400,
      "KNOWLEDGE_VALIDATION_SCOPE_CLASSIFICATION_CONFLICT",
    );
    const unchangedPolicySource = await prisma.knowledgeV2Source.findUniqueOrThrow({
      where: { id: policySource.id },
    });
    assert(
      unchangedPolicySource.defaultClassification === "PUBLIC" &&
        unchangedPolicySource.generation === policySource.generation,
      "A rejected classification/audience patch changed the source.",
    );

    const beforeDelete = await service.getSource(owner, sourceId);
    const deleteReason = `delete raw reason ${stamp}`;
    const deleted = await service.deleteSource(
      owner,
      sourceId,
      { reason: deleteReason },
      `delete-${stamp}`,
      [beforeDelete.etag],
    );
    const [deletedSource, deletedDocument, deletedArtifact, ledgers, deleteJob] = await Promise.all(
      [
        prisma.knowledgeV2Source.findUniqueOrThrow({ where: { id: sourceId } }),
        prisma.knowledgeV2Document.findUniqueOrThrow({ where: { id: document.id } }),
        prisma.knowledgeV2Artifact.findUniqueOrThrow({ where: { id: artifact.id } }),
        prisma.knowledgeV2DeletionLedger.findMany({
          where: {
            tenantId: tenant.id,
            sourceId,
            sourceGeneration: beforeDelete.generation + 1,
            targetType: "SOURCE",
            targetId: sourceId,
          },
        }),
        prisma.knowledgeJob.findUniqueOrThrow({ where: { id: deleted.jobId } }),
      ],
    );
    assert(
      deletedSource.status === "DELETING" && deletedSource.tombstonedAt,
      "Delete did not tombstone the source.",
    );
    assert(
      deletedDocument.status === "TOMBSTONED" && deletedDocument.tombstonedAt,
      "Delete did not deny the document.",
    );
    assert(deletedArtifact.deletionState === "TOMBSTONED", "Delete did not deny the artifact.");
    assert(
      ledgers.length === 4 &&
        new Set(ledgers.map((ledger) => ledger.subsystem)).size === 4 &&
        ledgers.every((ledger) => ledger.status === "PENDING" && ledger.deniedAt),
      "Deletion ledger is incomplete.",
    );
    const deleteEvent = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: deleteJob.payloadRef!.slice("runtime-outbox:".length) },
    });
    assert(queuedOperation(deleteEvent.payload) === "DELETE", "Delete used the wrong operation.");
    await expectKnowledgeError(
      service.previewRevision(owner, revision.id),
      404,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
    );

    const auditPayloads = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, action: { startsWith: "knowledge.v2." } },
      select: { payload: true },
    });
    const auditJson = JSON.stringify(auditPayloads);
    for (const privateValue of [
      pauseReason,
      excludeReason,
      deleteReason,
      previewContent,
      `raw-url-${stamp}`,
    ]) {
      assert(!auditJson.includes(privateValue), "Audit payload stored raw sensitive input.");
    }

    console.log(
      JSON.stringify({
        ok: true,
        sourceId,
        jobs: await prisma.knowledgeJob.count({ where: { tenantId: tenant.id } }),
        outboxEvents: await prisma.runtimeOutbox.count({ where: { tenantId: tenant.id } }),
        dispatches: dispatchedEventIds.length,
        deletionLedgerEntries: ledgers.length,
      }),
    );
  } finally {
    await cleanupTenant(prisma, tenant.id).catch(() => undefined);
    await cleanupTenant(prisma, otherTenant.id).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
