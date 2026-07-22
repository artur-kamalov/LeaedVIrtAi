import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import {
  BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS,
  BUSINESS_SERVICES_CSV_HEADERS,
  businessImportEvidenceRecordHash,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  type ParsedBusinessServiceRow,
} from "@leadvirt/business-import";
import { loadEnvFile } from "@leadvirt/config";
import { Prisma, prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { businessImportEtag } from "../../apps/api/src/modules/business-profile/business-import-http.js";
import { BusinessImportRebaseService } from "../../apps/api/src/modules/business-profile/business-import-rebase.service.js";
import type { BusinessImportRuntimeService } from "../../apps/api/src/modules/business-profile/business-import-runtime.service.js";
import { BusinessImportViewService } from "../../apps/api/src/modules/business-profile/business-import-view.service.js";
import { BusinessInformationStateService } from "../../apps/api/src/modules/business-profile/business-information-state.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  return typeof body === "object" && body !== null && "code" in body ? body.code : null;
}

function row(input: {
  externalId: string | null;
  name: string;
  price: string | null;
}): ParsedBusinessServiceRow {
  return {
    sourceRow: 1,
    externalId: input.externalId,
    category: "Consulting",
    name: input.name,
    description: `${input.name} description`,
    price: input.price
      ? {
          type: "FIXED",
          amount: input.price,
          from: null,
          to: null,
          currency: "EUR",
          unit: "session",
          taxNote: null,
        }
      : null,
    duration: { minimumMinutes: 60, maximumMinutes: null },
    locationExternalId: null,
    bookingNotes: null,
    active: true,
    validFrom: null,
    validUntil: null,
    language: "en",
    evidence: {},
    diagnostics: [],
    valid: true,
  };
}

function value(source: ParsedBusinessServiceRow) {
  return {
    externalId: source.externalId,
    category: source.category,
    name: source.name,
    description: source.description,
    price: source.price,
    duration: source.duration,
    locationExternalId: source.locationExternalId,
    bookingNotes: source.bookingNotes,
    active: source.active,
    validFrom: source.validFrom,
    validUntil: source.validUntil,
    language: source.language,
  };
}

async function cleanup(tenantId: string | null, userId: string | null) {
  if (!tenantId && !userId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    if (tenantId) {
      const tables = [
        "AuditLog",
        "KnowledgeV2IdempotencyRecord",
        "BusinessInformationAttribution",
        "BusinessInformationProjectionReceipt",
        "BusinessImportApplicationCandidate",
        "BusinessImportApplication",
        "BusinessImportApprovalGrant",
        "BusinessImportCandidateApproval",
        "BusinessImportCandidateEvidence",
        "BusinessImportCandidateRevision",
        "BusinessImportCandidate",
        "BusinessImportMapping",
        "BusinessImportQuotaReservation",
        "BusinessImportParsedRevision",
        "BusinessOfferingSourceBinding",
        "BusinessImport",
        "BusinessImportArtifact",
        "BusinessImportSource",
        "BusinessOfferingPrice",
        "BusinessOfferingDuration",
        "BusinessOffering",
        "BusinessInformationState",
        "BusinessInformationRevision",
        "BusinessImportObjectLedger",
        "Membership",
      ];
      for (const table of tables) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
      }
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Tenant" WHERE "id" = ${tenantId}`);
    }
    if (userId) await tx.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "id" = ${userId}`);
  });
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  let userId: string | null = null;
  try {
    const leakedTenants = await prisma.tenant.findMany({
      where: { slug: { startsWith: "business-import-rebase-" } },
      select: { id: true },
    });
    const leakedSources = await prisma.businessImportSource.findMany({
      where: { lineageKey: { startsWith: "rebase-source-" } },
      select: { tenantId: true },
    });
    for (const leakedTenantId of new Set([
      ...leakedTenants.map((item) => item.id),
      ...leakedSources.map((item) => item.tenantId),
    ])) {
      await cleanup(leakedTenantId, null);
    }
    const leakedUsers = await prisma.user.findMany({
      where: { email: { startsWith: "business-import-rebase-" } },
      select: { id: true },
    });
    for (const leaked of leakedUsers) await cleanup(null, leaked.id);
    const user = await prisma.user.create({
      data: { email: `business-import-rebase-${suffix}@example.test`, name: "Rebase Owner" },
    });
    userId = user.id;
    const tenant = await prisma.tenant.create({
      data: {
        name: "Rebase Business",
        slug: `business-import-rebase-${suffix}`,
        timezone: "UTC",
      },
    });
    tenantId = tenant.id;
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    const source = await prisma.businessImportSource.create({
      data: {
        tenantId,
        lineageKey: `rebase-source-${suffix}`,
        displayName: "Rebase source",
        status: "ACTIVE",
        createdByUserId: userId,
      },
    });
    const revisionOneLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "REVISION_DELTA",
        objectStorageKey: `rebase/${suffix}/revision-1`,
        encryptionKeyRef: "rebase-test-key",
        retentionClass: "BUSINESS_INFORMATION_REVISION",
      },
    });
    const revisionOne = await prisma.businessInformationRevision.create({
      data: {
        tenantId,
        revision: 1,
        canonicalHash: "1".repeat(64),
        origin: "LEGACY_BACKFILL",
        deltaObjectKey: revisionOneLedger.objectStorageKey,
        deltaEncryptionKeyRef: revisionOneLedger.encryptionKeyRef,
        deltaObjectLedgerId: revisionOneLedger.id,
        deltaHash: "d".repeat(64),
        affectedResources: [],
        createdByUserId: userId,
      },
    });
    const revisionTwoLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "REVISION_DELTA",
        objectStorageKey: `rebase/${suffix}/revision-2`,
        encryptionKeyRef: "rebase-test-key",
        retentionClass: "BUSINESS_INFORMATION_REVISION",
      },
    });
    const revisionTwo = await prisma.businessInformationRevision.create({
      data: {
        tenantId,
        revision: 2,
        parentRevisionId: revisionOne.id,
        parentRevision: 1,
        canonicalHash: "2".repeat(64),
        origin: "MANUAL",
        deltaObjectKey: revisionTwoLedger.objectStorageKey,
        deltaEncryptionKeyRef: revisionTwoLedger.encryptionKeyRef,
        deltaObjectLedgerId: revisionTwoLedger.id,
        deltaHash: "e".repeat(64),
        affectedResources: [{ type: "OFFERING", operation: "UPDATE" }],
        createdByUserId: userId,
      },
    });
    await prisma.businessInformationState.create({
      data: {
        tenantId,
        revision: 2,
        currentRevisionId: revisionTwo.id,
        canonicalHash: revisionTwo.canonicalHash,
        etag: 2,
        updatedByUserId: userId,
      },
    });

    const stableOffering = await prisma.businessOffering.create({
      data: {
        tenantId,
        name: "Renamed manually after parsing",
        category: "Consulting",
        description: "Canonical manual description",
        locale: "en",
        prices: {
          create: {
            type: "FIXED",
            amount: "45",
            currency: "EUR",
            unit: "session",
          },
        },
        duration: { create: { minimumMinutes: 60 } },
      },
    });
    const ambiguousOne = await prisma.businessOffering.create({
      data: {
        tenantId,
        name: "Ambiguous service",
        category: "Consulting",
        description: "First duplicate",
        locale: "en",
      },
    });
    const ambiguousTwo = await prisma.businessOffering.create({
      data: {
        tenantId,
        name: "Ambiguous service",
        category: "Consulting",
        description: "Second duplicate",
        locale: "en",
      },
    });
    const missingOffering = await prisma.businessOffering.create({
      data: {
        tenantId,
        name: "Existing source-only service",
        category: "Consulting",
        locale: "en",
      },
    });
    const appliedOffering = await prisma.businessOffering.create({
      data: {
        tenantId,
        name: "Applied service edited after commit",
        category: "Consulting",
        description: "Canonical description edited after the import was applied",
        locale: "en",
        prices: {
          create: {
            type: "FIXED",
            amount: "95",
            currency: "EUR",
            unit: "session",
          },
        },
        duration: { create: { minimumMinutes: 60 } },
      },
    });
    assert(ambiguousOne.id !== ambiguousTwo.id, "Ambiguous fixture did not create two offerings.");

    const artifactLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "RAW_ARTIFACT",
        objectStorageKey: `rebase/${suffix}/artifact`,
        encryptionKeyRef: "rebase-test-key",
        retentionClass: "BUSINESS_IMPORT_RAW",
      },
    });
    const artifact = await prisma.businessImportArtifact.create({
      data: {
        tenantId,
        sourceId: source.id,
        objectStorageKey: artifactLedger.objectStorageKey,
        encryptionKeyRef: artifactLedger.encryptionKeyRef,
        objectLedgerId: artifactLedger.id,
        sha256: "a".repeat(64),
        byteSize: 100,
        declaredMimeType: "text/csv",
        originalFilename: "services.csv",
        malwareStatus: "CLEAN",
        mimeValidationStatus: "VALID",
        scannedAt: new Date(),
      },
    });
    const importRecord = await prisma.businessImport.create({
      data: {
        tenantId,
        sourceId: source.id,
        purpose: "SERVICES",
        format: "CSV",
        state: "READY_FOR_REVIEW",
        displayName: "Rebase smoke",
        originalFilename: "services.csv",
        declaredMimeType: "text/csv",
        expectedByteSize: 100,
        uploadTokenHash: `rebase-upload-${suffix}`,
        artifactId: artifact.id,
        artifactSha256: artifact.sha256,
        baseBusinessRevisionId: revisionOne.id,
        baseInformationRevision: 1,
        baseInformationHash: revisionOne.canonicalHash,
        selectedCategories: ["OFFERINGS"],
        schemaVersion: "leadvirt.services.v1",
        parserVersion: "leadvirt.csv.services.v1",
        mapperVersion: "leadvirt.services.mapper.v1",
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdByUserId: userId,
        safeSummary: { counts: {}, diagnostics: [] },
      },
    });
    await prisma.businessOfferingSourceBinding.createMany({
      data: [
        {
          tenantId,
          sourceId: source.id,
          offeringId: stableOffering.id,
          externalKey: "svc-stable",
          firstSeenImportId: importRecord.id,
          lastSeenImportId: importRecord.id,
          lastSeenSourceValueHash: "3".repeat(64),
        },
        {
          tenantId,
          sourceId: source.id,
          offeringId: missingOffering.id,
          externalKey: "svc-missing",
          firstSeenImportId: importRecord.id,
          lastSeenImportId: importRecord.id,
          lastSeenSourceValueHash: "4".repeat(64),
        },
        {
          tenantId,
          sourceId: source.id,
          offeringId: appliedOffering.id,
          externalKey: "svc-applied",
          firstSeenImportId: importRecord.id,
          lastSeenImportId: importRecord.id,
          lastSeenSourceValueHash: "5".repeat(64),
        },
      ],
    });
    const manifestLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "PARSED_MANIFEST",
        objectStorageKey: `rebase/${suffix}/manifest`,
        encryptionKeyRef: "rebase-test-key",
        retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
      },
    });
    const parsedRevision = await prisma.businessImportParsedRevision.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        importGeneration: importRecord.generation,
        artifactId: artifact.id,
        artifactSha256: artifact.sha256,
        manifestObjectLedgerId: manifestLedger.id,
        manifestObjectKey: manifestLedger.objectStorageKey,
        manifestEncryptionKeyRef: manifestLedger.encryptionKeyRef,
        manifestHash: "b".repeat(64),
        parserVersion: "leadvirt.csv.services.v1",
        mapperVersion: "leadvirt.services.mapper.v1",
        schemaVersion: "leadvirt.services.v1",
        extractionContractVersion: "leadvirt.business-import.manifest.v1",
      },
    });
    await prisma.businessImport.update({
      where: { id: importRecord.id },
      data: {
        parsedRevisionId: parsedRevision.id,
        parsedManifestObjectKey: manifestLedger.objectStorageKey,
        parsedManifestEncryptionKeyRef: manifestLedger.encryptionKeyRef,
        parsedManifestObjectLedgerId: manifestLedger.id,
        parsedManifestObjectKind: "PARSED_MANIFEST",
        parsedManifestHash: parsedRevision.manifestHash,
      },
    });

    const proposedStable = row({
      externalId: "svc-stable",
      name: "Imported stable service",
      price: "50",
    });
    const oldCanonicalStable = row({
      externalId: "svc-stable",
      name: "Stable service before manual edit",
      price: "40",
    });
    const proposedAmbiguous = row({ externalId: null, name: "Ambiguous service", price: null });
    const proposedMissing = row({
      externalId: "svc-missing",
      name: "Existing source-only service",
      price: null,
    });
    const proposedApplied = row({
      externalId: "svc-applied",
      name: "Applied service from import",
      price: "80",
    });
    const stableHash = businessOfferingValueHash(proposedStable);
    const ambiguousHash = businessOfferingValueHash(proposedAmbiguous);
    const missingHash = businessOfferingValueHash(proposedMissing);
    const appliedHash = businessOfferingValueHash(proposedApplied);
    const stableCandidate = await prisma.businessImportCandidate.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateKey: "1".repeat(64),
        targetCategory: "OFFERINGS",
        semanticTargetKey: businessOfferingIdentityKey(proposedStable),
        action: "UPDATE",
        normalizedValue: value(proposedStable),
        normalizedValueHash: stableHash,
        targetOfferingId: stableOffering.id,
        currentFingerprint: businessOfferingValueHash(oldCanonicalStable),
        risk: "HIGH",
        confidence: "CONFIRMED_FORMAT",
        validationCodes: [],
        reasonCodes: [],
        decision: "ACCEPTED",
        requiresApproval: true,
        requiredPermission: "business_information.approve",
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    const ambiguousCandidate = await prisma.businessImportCandidate.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateKey: "2".repeat(64),
        targetCategory: "OFFERINGS",
        semanticTargetKey: businessOfferingIdentityKey(proposedAmbiguous),
        action: "ADD",
        normalizedValue: value(proposedAmbiguous),
        normalizedValueHash: ambiguousHash,
        risk: "LOW",
        confidence: "CONFIRMED_FORMAT",
        validationCodes: [],
        reasonCodes: [],
        decision: "ACCEPTED",
      },
    });
    const missingCandidate = await prisma.businessImportCandidate.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateKey: "3".repeat(64),
        targetCategory: "OFFERINGS",
        semanticTargetKey: businessOfferingIdentityKey(proposedMissing),
        action: "MISSING",
        normalizedValue: value(proposedMissing),
        normalizedValueHash: missingHash,
        targetOfferingId: missingOffering.id,
        currentFingerprint: missingHash,
        risk: "HIGH",
        confidence: "CONFIRMED_FORMAT",
        validationCodes: [],
        reasonCodes: ["BUSINESS_IMPORT_MISSING_FROM_REVISION"],
      },
    });
    const appliedAt = new Date(Date.now() - 60_000);
    const appliedCandidate = await prisma.businessImportCandidate.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateKey: "4".repeat(64),
        targetCategory: "OFFERINGS",
        semanticTargetKey: businessOfferingIdentityKey(proposedApplied),
        action: "UPDATE",
        normalizedValue: value(proposedApplied),
        normalizedValueHash: appliedHash,
        targetOfferingId: appliedOffering.id,
        currentFingerprint: appliedHash,
        risk: "HIGH",
        confidence: "CONFIRMED_FORMAT",
        validationCodes: [],
        reasonCodes: [],
        decision: "APPLIED",
        requiresApproval: true,
        requiredPermission: "business_information.approve",
        decidedByUserId: userId,
        decidedAt: appliedAt,
        appliedAt,
      },
    });
    const stableNameEvidenceId = randomUUID();
    const systemProvenance = Object.fromEntries(
      BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [path, { authority: "SYSTEM" }]),
    ) as Prisma.InputJsonObject;
    const stableProvenance = {
      ...systemProvenance,
      "/name": { authority: "IMPORTED", evidenceId: stableNameEvidenceId },
    } as Prisma.InputJsonObject;
    for (const candidate of [
      stableCandidate,
      ambiguousCandidate,
      missingCandidate,
      appliedCandidate,
    ]) {
      await prisma.businessImportCandidateRevision.create({
        data: {
          tenantId,
          sourceId: source.id,
          importId: importRecord.id,
          candidateId: candidate.id,
          version: 1,
          parsedRevisionId: parsedRevision.id,
          importGeneration: importRecord.generation,
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          parsedManifestHash: parsedRevision.manifestHash,
          targetCategory: "OFFERINGS",
          semanticTargetKey: candidate.semanticTargetKey,
          action: candidate.action,
          normalizedValue: candidate.normalizedValue,
          normalizedValueHash: candidate.normalizedValueHash,
          fieldProvenance:
            candidate.id === stableCandidate.id ? stableProvenance : systemProvenance,
          targetOfferingId: candidate.targetOfferingId,
          currentFingerprint: candidate.currentFingerprint,
          risk: candidate.risk,
          confidence: candidate.confidence,
          validationCodes: candidate.validationCodes ?? undefined,
          reasonCodes: candidate.reasonCodes ?? undefined,
          requiresApproval: candidate.requiresApproval,
          requiredPermission: candidate.requiredPermission,
        },
      });
    }
    const evidenceLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "EVIDENCE_EXCERPT",
        objectStorageKey: `rebase/${suffix}/evidence`,
        encryptionKeyRef: "rebase-test-key",
        retentionClass: "BUSINESS_IMPORT_EVIDENCE",
        retainUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.businessImportCandidateEvidence.createMany({
      data: BUSINESS_SERVICES_CSV_HEADERS.map((header, index) => {
        const evidenceRecord = {
          id: header === "name" ? stableNameEvidenceId : randomUUID(),
          tenantId,
          sourceId: source.id,
          importId: importRecord.id,
          candidateId: stableCandidate.id,
          candidateVersion: 1,
          candidateValueHash: stableCandidate.normalizedValueHash,
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          importGeneration: importRecord.generation,
          parsedRevisionId: parsedRevision.id,
          parsedManifestHash: parsedRevision.manifestHash,
          semanticElementId: null,
          semanticTableId: null,
          locator: { row: 2, column: index + 1, header },
          sourceValueHash: "c".repeat(64),
          excerptHash: "c".repeat(64),
          excerptObjectKey: evidenceLedger.objectStorageKey,
          excerptEncryptionKeyRef: evidenceLedger.encryptionKeyRef,
          excerptObjectLedgerId: evidenceLedger.id,
          excerptObjectKind: "EVIDENCE_EXCERPT" as const,
          parserVersion: "leadvirt.csv.services.v1",
          ocrVersion: null,
          extractionContractVersion: "leadvirt.business-import.manifest.v1",
        };
        return {
          ...evidenceRecord,
          evidenceRecordHash: businessImportEvidenceRecordHash(evidenceRecord),
        };
      }),
    });
    const approval = await prisma.businessImportCandidateApproval.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateId: stableCandidate.id,
        candidateVersion: 1,
        candidateValueHash: stableCandidate.normalizedValueHash,
        requiresApproval: true,
        requiredPermission: stableCandidate.requiredPermission,
        riskReason: "HIGH",
        state: "APPROVED",
        requestedByUserId: userId,
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    await prisma.businessImportApprovalGrant.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateId: stableCandidate.id,
        candidateVersion: 1,
        candidateValueHash: stableCandidate.normalizedValueHash,
        requiredPermission: stableCandidate.requiredPermission,
        approvalId: approval.id,
        grantedByUserId: userId,
        grantedAt: approval.decidedAt!,
        decisionHash: "f".repeat(64),
      },
    });
    const appliedApproval = await prisma.businessImportCandidateApproval.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateId: appliedCandidate.id,
        candidateVersion: 1,
        candidateValueHash: appliedCandidate.normalizedValueHash,
        requiresApproval: true,
        requiredPermission: appliedCandidate.requiredPermission,
        riskReason: "HIGH",
        state: "APPROVED",
        requestedByUserId: userId,
        decidedByUserId: userId,
        decidedAt: appliedAt,
      },
    });
    await prisma.businessImportApprovalGrant.create({
      data: {
        tenantId,
        sourceId: source.id,
        importId: importRecord.id,
        candidateId: appliedCandidate.id,
        candidateVersion: 1,
        candidateValueHash: appliedCandidate.normalizedValueHash,
        requiredPermission: appliedCandidate.requiredPermission,
        approvalId: appliedApproval.id,
        grantedByUserId: userId,
        grantedAt: appliedAt,
        decisionHash: "e".repeat(64),
      },
    });
    const [appliedBefore, appliedRevisionCountBefore, appliedGrantCountBefore] = await Promise.all([
      prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: appliedCandidate.id } }),
      prisma.businessImportCandidateRevision.count({
        where: { tenantId, candidateId: appliedCandidate.id },
      }),
      prisma.businessImportApprovalGrant.count({
        where: { tenantId, candidateId: appliedCandidate.id },
      }),
    ]);

    const context: RequestContext = {
      tenantId,
      userId,
      role: "OWNER",
      authMode: "email",
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        businessType: tenant.businessType,
        timezone: tenant.timezone,
      },
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        passwordChangeRequired: user.passwordChangeRequired,
      },
    };
    const runtime = { runtime: () => ({}) } as unknown as BusinessImportRuntimeService;
    const views = new BusinessImportViewService(prisma as unknown as PrismaService, runtime);
    const service = new BusinessImportRebaseService(
      prisma as unknown as PrismaService,
      new KnowledgeV2IdempotencyService(prisma as unknown as PrismaService),
      runtime,
      views,
      new BusinessInformationStateService(prisma as unknown as PrismaService),
    );
    const originalEtag = businessImportEtag(importRecord.id, importRecord.etag);
    const first = await service.rebase(context, importRecord.id, originalEtag, `rebase-${suffix}`);
    assert(
      first.baseBusinessInformationRevision === 2,
      "Rebase did not adopt the manual revision.",
    );
    const [stableAfter, ambiguousAfter, missingAfter, approvalAfter, evidenceAfter, audit] =
      await Promise.all([
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: stableCandidate.id } }),
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: ambiguousCandidate.id } }),
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: missingCandidate.id } }),
        prisma.businessImportCandidateApproval.findUniqueOrThrow({ where: { id: approval.id } }),
        prisma.businessImportCandidateEvidence.findMany({
          where: { tenantId, candidateId: stableCandidate.id },
          orderBy: { candidateVersion: "asc" },
        }),
        prisma.auditLog.findFirstOrThrow({
          where: { tenantId, action: "business_import.rebased", entityId: importRecord.id },
        }),
      ]);
    const [appliedAfter, appliedApprovalAfter, appliedRevisionCountAfter, appliedGrantCountAfter] =
      await Promise.all([
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: appliedCandidate.id } }),
        prisma.businessImportCandidateApproval.findUniqueOrThrow({
          where: { id: appliedApproval.id },
        }),
        prisma.businessImportCandidateRevision.count({
          where: { tenantId, candidateId: appliedCandidate.id },
        }),
        prisma.businessImportApprovalGrant.count({
          where: { tenantId, candidateId: appliedCandidate.id },
        }),
      ]);
    assert(
      JSON.stringify(appliedAfter) === JSON.stringify(appliedBefore),
      "Rebase mutated an applied candidate.",
    );
    assert(
      appliedRevisionCountAfter === appliedRevisionCountBefore,
      "Rebase revised an applied candidate.",
    );
    assert(
      JSON.stringify(appliedApprovalAfter) === JSON.stringify(appliedApproval),
      "Rebase invalidated or mutated an applied candidate approval.",
    );
    assert(
      appliedGrantCountAfter === appliedGrantCountBefore,
      "Rebase changed an applied candidate approval grant.",
    );
    assert(stableAfter.action === "UPDATE", "Stable external ID did not preserve UPDATE.");
    assert(
      stableAfter.targetOfferingId === stableOffering.id,
      "Stable external ID lost its target.",
    );
    assert(stableAfter.version === 2, "Manual current-value change did not bump the candidate.");
    assert(stableAfter.decision === "PENDING", "Changed accepted candidate remained accepted.");
    assert(approvalAfter.state === "INVALIDATED", "Exact prior approval was not invalidated.");
    assert(ambiguousAfter.action === "CONFLICT", "Ambiguous identity was not blocked.");
    assert(
      ambiguousAfter.targetOfferingId === null,
      "Ambiguous identity retained an unsafe target.",
    );
    assert(missingAfter.action === "MISSING", "Missing source row became an archive.");
    assert(
      evidenceAfter.length === BUSINESS_SERVICES_CSV_HEADERS.length * 2 &&
        evidenceAfter.every(
          (item) =>
            item.excerptObjectLedgerId === evidenceAfter[0]?.excerptObjectLedgerId &&
            item.excerptObjectKey === evidenceAfter[0]?.excerptObjectKey,
        ),
      "Rebase did not reuse the exact retained evidence object.",
    );
    const stableRevision = await prisma.businessImportCandidateRevision.findFirstOrThrow({
      where: { tenantId, candidateId: stableCandidate.id, version: 2 },
    });
    const nameBinding = (stableRevision.fieldProvenance as Record<string, unknown>)["/name"] as {
      authority?: string;
      evidenceId?: string;
    };
    const clonedNameEvidence = evidenceAfter.find(
      (item) =>
        item.candidateVersion === 2 && (item.locator as Record<string, unknown>).header === "name",
    );
    assert(
      nameBinding.authority === "IMPORTED" &&
        nameBinding.evidenceId === clonedNameEvidence?.id &&
        nameBinding.evidenceId !== stableNameEvidenceId,
      "Rebase did not remap exact field evidence to the cloned revision.",
    );
    assert(
      JSON.stringify(audit.payload).includes("Imported stable service") === false,
      "Rebase audit leaked candidate content.",
    );
    const replay = await service.rebase(context, importRecord.id, originalEtag, `rebase-${suffix}`);
    const stableAfterReplay = await prisma.businessImportCandidate.findUniqueOrThrow({
      where: { id: stableCandidate.id },
    });
    assert(replay.etag === first.etag, "Exact idempotent replay changed the import ETag.");
    assert(stableAfterReplay.version === 2, "Exact replay created another candidate revision.");
    const noOp = await service.rebase(
      context,
      importRecord.id,
      first.etag,
      `rebase-no-op-${suffix}`,
    );
    const [stableAfterNoOp, ambiguousAfterNoOp, appliedAfterNoOp, appliedApprovalAfterNoOp] =
      await Promise.all([
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: stableCandidate.id } }),
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: ambiguousCandidate.id } }),
        prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: appliedCandidate.id } }),
        prisma.businessImportCandidateApproval.findUniqueOrThrow({
          where: { id: appliedApproval.id },
        }),
      ]);
    assert(noOp.etag !== first.etag, "Explicit no-op rebase did not advance the import ETag.");
    assert(stableAfterNoOp.version === 2, "Stable candidate changed on deterministic rebase.");
    assert(
      ambiguousAfterNoOp.version === 2,
      "Ambiguous candidate changed on deterministic rebase.",
    );
    assert(
      JSON.stringify(appliedAfterNoOp) === JSON.stringify(appliedBefore) &&
        JSON.stringify(appliedApprovalAfterNoOp) === JSON.stringify(appliedApproval),
      "Applied candidate state changed on deterministic rebase.",
    );
    let staleError: unknown;
    try {
      await service.rebase(context, importRecord.id, originalEtag, `rebase-stale-${suffix}`);
    } catch (error) {
      staleError = error;
    }
    assert(
      errorCode(staleError) === "BUSINESS_IMPORT_REVISION_CONFLICT",
      "Stale import If-Match was not rejected.",
    );
    console.log(`business import rebase smoke passed (${checks} checks)`);
  } finally {
    await cleanup(tenantId, userId);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
