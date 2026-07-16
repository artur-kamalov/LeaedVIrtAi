import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2FeedbackService } from "../../apps/api/src/modules/knowledge/knowledge-v2-feedback.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks += 1;
}

function config(input: { rootPath?: string; key?: Buffer; keyId?: string }) {
  return {
    knowledgeObjectStorePath: input.rootPath,
    knowledgeArtifactEncryptionKey: input.key?.toString("base64"),
    knowledgeArtifactEncryptionKeyId: input.keyId,
  } as unknown as AppConfigService;
}

function context(
  tenant: RequestContext["tenant"],
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
    check(
      typeof payload === "object" && payload !== null && "code" in payload && payload.code === code,
      `Expected ${code}, received ${JSON.stringify(payload)}.`,
    );
    return;
  }
  throw new Error(`Expected ${status} ${code}.`);
}

async function storedBytes(rootPath: string): Promise<Buffer> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map((entry) => {
      const path = join(rootPath, entry.name);
      return entry.isDirectory() ? storedBytes(path) : readFile(path);
    }),
  );
  return Buffer.concat(parts);
}

async function storedFileCount(rootPath: string): Promise<number> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const counts = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? storedFileCount(join(rootPath, entry.name)) : Promise.resolve(1),
    ),
  );
  return counts.reduce((total, count) => total + count, 0);
}

async function cleanup(prisma: PrismaService, tenantIds: string[], userId?: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.knowledgeV2FeedbackEvidence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Feedback.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Citation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2RetrievalTrace.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvaluationResultEvidence.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await tx.knowledgeV2EvaluationResult.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvaluationRun.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2EvidenceReference.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2DocumentRevision.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Document.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2Source.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgeV2IdempotencyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgePublicationItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.knowledgePublication.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (userId) await tx.user.deleteMany({ where: { id: userId } });
  });
}

async function main() {
  const prisma = new PrismaService();
  const rootPath = await mkdtemp(join(tmpdir(), "leadvirt-kv2-feedback-"));
  const tenantIds: string[] = [];
  let userId: string | undefined;
  await prisma.$connect();
  try {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: "Knowledge feedback smoke", slug: `kv2-feedback-${stamp}` },
    });
    tenantIds.push(tenant.id);
    const otherTenant = await prisma.tenant.create({
      data: { name: "Knowledge feedback isolation", slug: `kv2-feedback-other-${stamp}` },
    });
    tenantIds.push(otherTenant.id);
    const user = await prisma.user.create({
      data: { email: `kv2-feedback-${stamp}@example.test`, name: "Feedback owner" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const owner = context(tenant, user);

    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        manifestHash: `manifest-${stamp}`,
        pipelineVersion: "pipeline-v2",
        retrievalPolicyVersion: "retrieval-v2",
        promptPolicyVersion: "prompt-v2",
        readyAt: new Date(),
      },
    });
    const secondPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 2,
        status: "READY",
        manifestHash: `manifest-second-${stamp}`,
        pipelineVersion: "pipeline-v2",
        retrievalPolicyVersion: "retrieval-v2",
        promptPolicyVersion: "prompt-v2",
        readyAt: new Date(),
      },
    });
    const otherPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: otherTenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        manifestHash: `manifest-other-${stamp}`,
        pipelineVersion: "pipeline-v2",
        retrievalPolicyVersion: "retrieval-v2",
        promptPolicyVersion: "prompt-v2",
        readyAt: new Date(),
      },
    });
    const run = { id: randomUUID() };
    const runStartedAt = new Date();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "KnowledgeV2EvaluationRun" (
        "id", "tenantId", "corpusKind", "runKey", "runKind", "status", "snapshotKind",
        "targetKey", "publicationId", "datasetVersion", "testCaseSetHash", "configHash",
        "retrievalPolicyVersion", "promptPolicyVersion", "graphVersion", "codeCommit",
        "environment", "requestedByUserId", "startedAt", "completedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${run.id}, ${tenant.id}, 'STRUCTURED_V2', ${`run-${stamp}`}, 'PUBLICATION', 'SUCCEEDED',
        'PUBLICATION', 'workspace-v2', ${publication.id}, 'feedback-smoke-v1', ${`tests-${stamp}`},
        ${`config-${stamp}`}, 'retrieval-v2', 'prompt-v2', 'graph-v2', 'smoke', 'test', ${user.id},
        ${runStartedAt}, ${runStartedAt}, ${runStartedAt}, ${runStartedAt}
      )
    `);
    const result = { id: randomUUID() };
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "KnowledgeV2EvaluationResult" (
        "id", "tenantId", "corpusKind", "resultKey", "evaluationRunId", "repeatIndex",
        "status", "observedBehavior", "gateOutcome", "responseHash", "metricManifestHash",
        "evidenceManifestHash", "createdAt"
      ) VALUES (
        ${result.id}, ${tenant.id}, 'STRUCTURED_V2', ${`result-${stamp}`}, ${run.id}, 0, 'FAILED',
        'ANSWER', 'HOLD_FOR_APPROVAL', ${`response-${stamp}`}, ${`metrics-${stamp}`},
        ${`evidence-${stamp}`}, ${new Date()}
      )
    `);
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, subject: "Feedback smoke response" },
    });
    const responseMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        status: "SENT",
        text: "Bounded feedback smoke response",
      },
    });
    const source = await prisma.knowledgeV2Source.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        displayName: "Sensitive feedback source",
        externalRootKey: `feedback-source-${stamp}`,
        status: "READY",
        defaultClassification: "SENSITIVE",
      },
    });
    const document = await prisma.knowledgeV2Document.create({
      data: {
        tenantId: tenant.id,
        sourceId: source.id,
        externalKey: `feedback-document-${stamp}`,
        kind: "policy",
        title: "Sensitive policy",
        classification: "SENSITIVE",
        status: "ACTIVE",
      },
    });
    const revision = await prisma.knowledgeV2DocumentRevision.create({
      data: {
        tenantId: tenant.id,
        sourceId: source.id,
        documentId: document.id,
        revisionNumber: 1,
        contentHash: `document-hash-${stamp}`,
        status: "READY",
        pipelineVersion: "pipeline-v2",
        sourcePermissionFingerprint: `document-permission-${stamp}`,
      },
    });
    const citedEvidence = await prisma.knowledgeV2EvidenceReference.create({
      data: {
        tenantId: tenant.id,
        corpusKind: "STRUCTURED_V2",
        evidenceKey: `cited-${stamp}`,
        targetType: "DOCUMENT_REVISION",
        itemVersionHash: revision.contentHash,
        v2DocumentRevisionId: revision.id,
        safeLabel: "Private policy evidence",
        isPublic: false,
      },
    });
    const uncitedEvidence = await prisma.knowledgeV2EvidenceReference.create({
      data: {
        tenantId: tenant.id,
        corpusKind: "STRUCTURED_V2",
        evidenceKey: `uncited-${stamp}`,
        targetType: "EXTERNAL_REFERENCE",
        externalReferenceHash: `uncited-external-${stamp}`,
        safeLabel: "Uncited evidence",
        isPublic: false,
      },
    });
    await prisma.knowledgeV2EvaluationResultEvidence.create({
      data: {
        tenantId: tenant.id,
        corpusKind: "STRUCTURED_V2",
        evaluationResultId: result.id,
        evidenceReferenceId: citedEvidence.id,
        ordinal: 0,
        relevanceScore: 0.91,
      },
    });
    const trace = { id: randomUUID() };
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "KnowledgeV2RetrievalTrace" (
        "id", "tenantId", "corpusKind", "traceKey", "snapshotKind", "targetKey",
        "publicationId", "evaluationRunId", "evaluationResultId", "responseMessageId", "queryHash",
        "restrictedQueryRef", "filters", "filtersHash", "permissionFingerprint",
        "candidateCount", "selectedCount", "retrievalPolicyVersion", "promptPolicyVersion",
        "graphVersion", "outcome", "gateOutcome", "retrievalCandidateManifestHash",
        "citationManifestHash", "retentionClass", "retentionExpiresAt", "createdAt"
      ) VALUES (
        ${trace.id}, ${tenant.id}, 'STRUCTURED_V2', ${`trace-${stamp}`}, 'PUBLICATION',
        'workspace-v2', ${publication.id}, ${run.id}, ${result.id}, ${responseMessage.id},
        ${`query-${stamp}`},
        'restricted://feedback-smoke/query', '{}'::jsonb, ${`filters-${stamp}`},
        ${`permission-${stamp}`}, 1, 1, 'retrieval-v2', 'prompt-v2', 'graph-v2', 'ANSWERED',
        'HOLD_FOR_APPROVAL', ${`candidates-${stamp}`}, ${`citations-${stamp}`}, 'evaluation',
        ${new Date(Date.now() + 24 * 60 * 60 * 1000)}, ${new Date()}
      )
    `);
    await prisma.knowledgeV2Citation.create({
      data: {
        tenantId: tenant.id,
        corpusKind: "STRUCTURED_V2",
        citationKey: `citation-${stamp}`,
        retrievalTraceId: trace.id,
        evidenceReferenceId: citedEvidence.id,
        ordinal: 0,
        claimHash: `claim-${stamp}`,
        support: "CONTRADICTS",
        confidence: 0.87,
      },
    });

    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const service = new KnowledgeV2FeedbackService(
      prisma,
      idempotency,
      config({ rootPath, key: randomBytes(32), keyId: "feedback-smoke" }),
    );
    const disabled = new KnowledgeV2FeedbackService(prisma, idempotency, config({}));
    const note = `Private feedback note ${stamp}`;
    const input = {
      category: "INCORRECT_ANSWER" as const,
      riskLevel: "LOW" as const,
      retrievalTraceId: trace.id,
      note,
      proposedAction: "MARK_UNANSWERABLE" as const,
      correctionTargetType: "MARK_UNANSWERABLE" as const,
      evidenceReferenceIds: [citedEvidence.id],
    };

    await expectKnowledgeError(
      disabled.createFeedback(owner, input, `disabled-${stamp}`),
      503,
      "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
    );
    const createKey = `feedback-${stamp}`;
    const created = await service.createFeedback(owner, input, createKey);
    check(!created.idempotencyReplayed, "first feedback creation is not replayed");
    check(created.resource.retrievalTraceId === trace.id, "feedback pins the retrieval trace");
    check(created.resource.evaluationRunId === run.id, "feedback derives and pins the exact run");
    check(
      created.resource.evaluationResultId === result.id,
      "feedback derives and pins the exact result",
    );
    check(
      created.resource.publicationId === publication.id,
      "feedback derives and pins the exact publication",
    );
    check(created.resource.hasRestrictedNote, "feedback reports a protected note");
    check(
      created.resource.riskLevel === "HIGH",
      "sensitive cited evidence raises browser-supplied low risk to high",
    );
    check(created.resource.evidence.length === 1, "cited evidence is attached once");
    check(created.resource.evidence[0]?.evidence.redacted, "non-public evidence is redacted");
    check(
      created.resource.evidence[0]?.evidence.safeLabel === "Restricted evidence",
      "non-public evidence label is not disclosed",
    );

    const responseFeedback = await service.createFeedback(
      owner,
      { category: "OTHER", responseMessageId: responseMessage.id },
      `response-${stamp}`,
    );
    check(
      responseFeedback.resource.retrievalTraceId === trace.id &&
        responseFeedback.resource.publicationId === publication.id &&
        responseFeedback.resource.evaluationResultId === result.id,
      "response feedback discovers and pins its exact knowledge outcome",
    );
    check(
      responseFeedback.resource.riskLevel === "HIGH",
      "omitting evidence cannot down-classify the cited sensitive context",
    );

    const replay = await service.createFeedback(owner, input, createKey);
    check(replay.idempotencyReplayed, "identical feedback is replayed");
    check(replay.resource.id === created.resource.id, "replay returns the original feedback");
    await expectKnowledgeError(
      service.createFeedback(owner, { ...input, note: `${note} changed` }, createKey),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    await expectKnowledgeError(
      service.createFeedback(
        owner,
        { ...input, publicationId: secondPublication.id },
        `mismatch-${stamp}`,
      ),
      409,
      "KNOWLEDGE_CONFLICT_FEEDBACK_REFERENCE_MISMATCH",
    );
    const filesBeforeFailedMutation = await storedFileCount(rootPath);
    const failedMutationNote = `Cross-tenant feedback note ${stamp}`;
    await expectKnowledgeError(
      service.createFeedback(
        owner,
        { category: "OTHER", publicationId: otherPublication.id, note: failedMutationNote },
        `cross-tenant-${stamp}`,
      ),
      404,
      "KNOWLEDGE_CONFLICT_FEEDBACK_REFERENCE_NOT_FOUND",
    );
    check(
      (await storedFileCount(rootPath)) === filesBeforeFailedMutation,
      "failed final mutation removes only its newly prepared note object",
    );
    await expectKnowledgeError(
      service.createFeedback(
        owner,
        { ...input, note: undefined, evidenceReferenceIds: [uncitedEvidence.id] },
        `uncited-${stamp}`,
      ),
      404,
      "KNOWLEDGE_CONFLICT_FEEDBACK_REFERENCE_NOT_FOUND",
    );

    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      data: { role: "VIEWER" },
    });
    await expectKnowledgeError(
      service.createFeedback(
        owner,
        { category: "OTHER", publicationId: publication.id },
        `removed-role-${stamp}`,
      ),
      403,
      "KNOWLEDGE_PERMISSION_FEEDBACK_DENIED",
    );

    const [feedback, idempotencyRows, audits] = await Promise.all([
      prisma.knowledgeV2Feedback.findUniqueOrThrow({ where: { id: created.resource.id } }),
      prisma.knowledgeV2IdempotencyRecord.findMany({ where: { tenantId: tenant.id } }),
      prisma.auditLog.findMany({ where: { tenantId: tenant.id } }),
    ]);
    const ordinaryRecords = JSON.stringify({ feedback, idempotencyRows, audits });
    check(!ordinaryRecords.includes(note), "raw note is absent from ordinary database records");
    check(Boolean(feedback.noteHash), "database stores the note hash");
    check(Boolean(feedback.restrictedNoteRef), "database stores only a restricted note reference");
    check(
      !JSON.stringify(idempotencyRows).includes(feedback.restrictedNoteRef!),
      "idempotency records do not expose restricted references",
    );
    check(
      !JSON.stringify(audits).includes(feedback.restrictedNoteRef!),
      "audit records do not expose restricted references",
    );
    check(
      !(await storedBytes(rootPath)).includes(Buffer.from(note, "utf8")),
      "object-store files do not contain plaintext notes",
    );
    check(
      audits.some(
        (audit) =>
          audit.action === "knowledge.v2.feedback.created" && audit.entityId === feedback.id,
      ),
      "feedback creation is audited",
    );
  } finally {
    await cleanup(prisma, tenantIds, userId).catch(() => undefined);
    await prisma.$disconnect();
    await rm(rootPath, { recursive: true, force: true });
  }
  console.log(`Knowledge v2 feedback API smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
