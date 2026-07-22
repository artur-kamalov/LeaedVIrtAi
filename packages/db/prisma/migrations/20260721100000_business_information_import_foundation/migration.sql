BEGIN;

-- CreateEnum
CREATE TYPE "BusinessInformationRevisionOrigin" AS ENUM ('LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'REVERT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BusinessInformationAuthority" AS ENUM ('LEGACY_BACKFILL', 'MANUAL', 'IMPORTED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BusinessInformationResourceType" AS ENUM ('BUSINESS_IDENTITY', 'OFFERING', 'OFFERING_PRICE', 'OFFERING_DURATION');

-- CreateEnum
CREATE TYPE "BusinessOfferingKind" AS ENUM ('SERVICE', 'PRODUCT', 'MENU_ITEM');

-- CreateEnum
CREATE TYPE "BusinessOfferingPriceType" AS ENUM ('FIXED', 'FROM', 'RANGE', 'FREE', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "BusinessImportSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessImportPurpose" AS ENUM ('SERVICES', 'BUSINESS_INFORMATION');

-- CreateEnum
CREATE TYPE "BusinessImportFormat" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "BusinessImportArtifactMalwareStatus" AS ENUM ('PENDING', 'CLEAN', 'DETECTED', 'SCAN_FAILED');

-- CreateEnum
CREATE TYPE "BusinessImportMimeValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "BusinessImportArtifactDeletionState" AS ENUM ('RETAINED', 'TOMBSTONED', 'DELETING', 'DELETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BusinessImportObjectKind" AS ENUM ('STAGING', 'RAW_ARTIFACT', 'PARSED_MANIFEST', 'EVIDENCE_EXCERPT', 'APPLICATION_PREVIEW', 'REVISION_DELTA');

-- CreateEnum
CREATE TYPE "BusinessImportState" AS ENUM ('CREATED', 'UPLOADING', 'UPLOADED', 'SCANNING', 'PARSING', 'MAPPING_REQUIRED', 'EXTRACTING', 'READY_FOR_REVIEW', 'AWAITING_APPROVAL', 'APPLYING', 'PROJECTING', 'APPLIED', 'PARTIALLY_APPLIED', 'PROJECTION_DELAYED', 'CLOSED_WITH_REMAINDER', 'FAILED_RETRYABLE', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BusinessImportTargetCategory" AS ENUM ('BUSINESS_IDENTITY', 'OFFERINGS', 'LOCATIONS', 'HOURS', 'FAQ', 'POLICIES', 'PROMOTIONS', 'HANDOFF_RULES');

-- CreateEnum
CREATE TYPE "BusinessImportCandidateAction" AS ENUM ('ADD', 'UPDATE', 'UNCHANGED', 'CONFLICT', 'INVALID', 'MISSING', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "BusinessImportCandidateDecision" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'SUBMITTED_FOR_APPROVAL', 'REJECTED', 'STALE', 'APPLIED');

-- CreateEnum
CREATE TYPE "BusinessImportConfidenceBand" AS ENUM ('CONFIRMED_FORMAT', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "BusinessImportRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "BusinessImportApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "BusinessImportApplicationKind" AS ENUM ('APPLY', 'REVERT');

-- CreateEnum
CREATE TYPE "BusinessImportApplicationState" AS ENUM ('COMMITTED', 'PROJECTING', 'READY', 'PROJECTION_DELAYED', 'REVERTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BusinessImportQuotaStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "BusinessInformationState" (
    "tenantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentRevisionId" TEXT,
    "canonicalHash" TEXT NOT NULL,
    "etag" INTEGER NOT NULL DEFAULT 1,
    "lastProjectedRevisionId" TEXT,
    "lastProjectedRevision" INTEGER,
    "lastProjectedHash" TEXT,
    "lastProjectionReceiptId" TEXT,
    "lastProjectionReceiptHash" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessInformationState_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "BusinessInformationRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "parentRevisionId" TEXT,
    "parentRevision" INTEGER,
    "canonicalHash" TEXT NOT NULL,
    "origin" "BusinessInformationRevisionOrigin" NOT NULL,
    "deltaObjectKey" TEXT NOT NULL,
    "deltaEncryptionKeyRef" TEXT NOT NULL,
    "deltaObjectLedgerId" TEXT NOT NULL,
    "deltaObjectKind" "BusinessImportObjectKind" NOT NULL DEFAULT 'REVISION_DELTA',
    "deltaHash" TEXT NOT NULL,
    "affectedResources" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessInformationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportObjectLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectKind" "BusinessImportObjectKind" NOT NULL,
    "objectStorageKey" TEXT NOT NULL,
    "encryptionKeyRef" TEXT NOT NULL,
    "retentionClass" TEXT NOT NULL,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletionState" "BusinessImportArtifactDeletionState" NOT NULL DEFAULT 'RETAINED',
    "retainUntil" TIMESTAMP(3),
    "tombstoneReason" TEXT,
    "tombstonedAt" TIMESTAMP(3),
    "deletionStartedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportObjectLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "businessType" TEXT,
    "description" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL,
    "defaultCurrency" VARCHAR(3) NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOffering" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "BusinessOfferingKind" NOT NULL DEFAULT 'SERVICE',
    "category" TEXT,
    "parentCategory" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "bookingNotes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOfferingPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "type" "BusinessOfferingPriceType" NOT NULL,
    "amount" DECIMAL(19,4),
    "amountFrom" DECIMAL(19,4),
    "amountTo" DECIMAL(19,4),
    "currency" VARCHAR(3) NOT NULL,
    "unit" TEXT,
    "taxNote" TEXT,
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOfferingPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOfferingDuration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "minimumMinutes" INTEGER NOT NULL,
    "maximumMinutes" INTEGER,
    "preparationMinutes" INTEGER,
    "bufferMinutes" INTEGER,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOfferingDuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lineageKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "upstreamSystem" TEXT,
    "status" "BusinessImportSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "latestImportId" TEXT,
    "lastSchemaHash" TEXT,
    "lastMappingRevision" INTEGER,
    "etag" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessImportSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "objectStorageKey" TEXT NOT NULL,
    "encryptionKeyRef" TEXT NOT NULL,
    "objectLedgerId" TEXT NOT NULL,
    "objectKind" "BusinessImportObjectKind" NOT NULL DEFAULT 'RAW_ARTIFACT',
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "detectedMimeType" TEXT,
    "declaredMimeType" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "malwareStatus" "BusinessImportArtifactMalwareStatus" NOT NULL DEFAULT 'PENDING',
    "mimeValidationStatus" "BusinessImportMimeValidationStatus" NOT NULL DEFAULT 'PENDING',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "purpose" "BusinessImportPurpose" NOT NULL,
    "format" "BusinessImportFormat" NOT NULL,
    "state" "BusinessImportState" NOT NULL DEFAULT 'CREATED',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "etag" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "expectedByteSize" BIGINT NOT NULL,
    "uploadTokenHash" TEXT NOT NULL,
    "stagingObjectKey" TEXT,
    "stagingEncryptionKeyRef" TEXT,
    "stagingObjectLedgerId" TEXT,
    "stagingObjectKind" "BusinessImportObjectKind",
    "artifactId" TEXT,
    "artifactSha256" TEXT,
    "parsedRevisionId" TEXT,
    "parsedManifestObjectKey" TEXT,
    "parsedManifestEncryptionKeyRef" TEXT,
    "parsedManifestObjectLedgerId" TEXT,
    "parsedManifestObjectKind" "BusinessImportObjectKind",
    "parsedManifestHash" TEXT,
    "baseBusinessRevisionId" TEXT,
    "baseInformationRevision" INTEGER NOT NULL,
    "baseInformationHash" TEXT NOT NULL,
    "selectedCategories" JSONB NOT NULL,
    "parserVersion" TEXT,
    "ocrVersion" TEXT,
    "mapperVersion" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "safeSummary" JSONB,
    "failureCode" TEXT,
    "failureStage" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "reviewReadyAt" TIMESTAMP(3),
    "reviewCompletedAt" TIMESTAMP(3),
    "applyStartedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportParsedRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "importGeneration" INTEGER NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactSha256" TEXT NOT NULL,
    "manifestObjectLedgerId" TEXT NOT NULL,
    "manifestObjectKind" "BusinessImportObjectKind" NOT NULL DEFAULT 'PARSED_MANIFEST',
    "manifestObjectKey" TEXT NOT NULL,
    "manifestEncryptionKeyRef" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "ocrVersion" TEXT,
    "mapperVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "extractionContractVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessImportParsedRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "tableKey" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "headerRow" INTEGER,
    "targetCategory" "BusinessImportTargetCategory" NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "defaultLocale" TEXT,
    "defaultCurrency" VARCHAR(3),
    "defaultTimezone" TEXT,
    "defaultUnit" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "etag" INTEGER NOT NULL DEFAULT 1,
    "supersedesMappingId" TEXT,
    "supersedesRevision" INTEGER,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "mappingId" TEXT,
    "candidateKey" TEXT NOT NULL,
    "targetCategory" "BusinessImportTargetCategory" NOT NULL,
    "semanticTargetKey" TEXT NOT NULL,
    "action" "BusinessImportCandidateAction" NOT NULL,
    "normalizedValue" JSONB NOT NULL,
    "normalizedValueHash" TEXT NOT NULL,
    "targetOfferingId" TEXT,
    "currentFingerprint" TEXT,
    "risk" "BusinessImportRiskLevel" NOT NULL,
    "confidence" "BusinessImportConfidenceBand" NOT NULL,
    "validationCodes" JSONB,
    "reasonCodes" JSONB,
    "decision" "BusinessImportCandidateDecision" NOT NULL DEFAULT 'PENDING',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "etag" INTEGER NOT NULL DEFAULT 1,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportCandidateRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parsedRevisionId" TEXT NOT NULL,
    "importGeneration" INTEGER NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactSha256" TEXT NOT NULL,
    "parsedManifestHash" TEXT NOT NULL,
    "mappingId" TEXT,
    "targetCategory" "BusinessImportTargetCategory" NOT NULL,
    "semanticTargetKey" TEXT NOT NULL,
    "action" "BusinessImportCandidateAction" NOT NULL,
    "normalizedValue" JSONB NOT NULL,
    "normalizedValueHash" TEXT NOT NULL,
    "fieldProvenance" JSONB NOT NULL,
    "targetOfferingId" TEXT,
    "currentFingerprint" TEXT,
    "risk" "BusinessImportRiskLevel" NOT NULL,
    "confidence" "BusinessImportConfidenceBand" NOT NULL,
    "validationCodes" JSONB,
    "reasonCodes" JSONB,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessImportCandidateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportCandidateApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "candidateValueHash" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "requiredPermission" TEXT NOT NULL,
    "riskReason" TEXT NOT NULL,
    "state" "BusinessImportApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "etag" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportCandidateApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportApprovalGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "candidateValueHash" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessImportApprovalGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportCandidateEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "candidateValueHash" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactSha256" TEXT NOT NULL,
    "importGeneration" INTEGER NOT NULL,
    "parsedRevisionId" TEXT NOT NULL,
    "parsedManifestHash" TEXT NOT NULL,
    "semanticElementId" TEXT,
    "semanticTableId" TEXT,
    "locator" JSONB NOT NULL,
    "sourceValueHash" TEXT NOT NULL,
    "excerptHash" TEXT NOT NULL,
    "excerptObjectKey" TEXT NOT NULL,
    "excerptEncryptionKeyRef" TEXT NOT NULL,
    "excerptObjectLedgerId" TEXT NOT NULL,
    "excerptObjectKind" "BusinessImportObjectKind" NOT NULL DEFAULT 'EVIDENCE_EXCERPT',
    "parserVersion" TEXT NOT NULL,
    "ocrVersion" TEXT,
    "extractionContractVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessImportCandidateEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOfferingSourceBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "normalizedCandidateKey" TEXT,
    "firstSeenImportId" TEXT NOT NULL,
    "lastSeenImportId" TEXT NOT NULL,
    "lastSeenSourceValueHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOfferingSourceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "kind" "BusinessImportApplicationKind" NOT NULL DEFAULT 'APPLY',
    "state" "BusinessImportApplicationState" NOT NULL DEFAULT 'COMMITTED',
    "revertOfApplicationId" TEXT,
    "previewManifestHash" TEXT NOT NULL,
    "previewObjectLedgerId" TEXT NOT NULL,
    "previewObjectKind" "BusinessImportObjectKind" NOT NULL DEFAULT 'APPLICATION_PREVIEW',
    "previewObjectKey" TEXT NOT NULL,
    "previewEncryptionKeyRef" TEXT NOT NULL,
    "candidateManifestHash" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "baseInformationRevision" INTEGER NOT NULL,
    "baseInformationHash" TEXT NOT NULL,
    "baseBusinessRevisionId" TEXT,
    "resultingInformationRevision" INTEGER NOT NULL,
    "resultingInformationHash" TEXT NOT NULL,
    "businessRevisionId" TEXT NOT NULL,
    "affectedResourceVersions" JSONB NOT NULL,
    "projectionOutboxDedupeKey" TEXT NOT NULL,
    "projectionOutboxId" TEXT,
    "projectionOutboxPrunedAt" TIMESTAMP(3),
    "projectionReceiptHash" TEXT,
    "publicationId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportApplicationCandidate" (
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "candidateValueHash" TEXT NOT NULL,
    "action" "BusinessImportCandidateAction" NOT NULL,
    "targetCategory" "BusinessImportTargetCategory" NOT NULL,
    "risk" "BusinessImportRiskLevel" NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "approvalGrantId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessImportApplicationCandidate_pkey" PRIMARY KEY ("tenantId","applicationId","candidateId")
);

-- CreateTable
CREATE TABLE "BusinessInformationProjectionReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "businessRevisionId" TEXT NOT NULL,
    "businessRevision" INTEGER NOT NULL,
    "businessRevisionHash" TEXT NOT NULL,
    "knowledgeTargetKey" TEXT NOT NULL,
    "knowledgeDraftGeneration" INTEGER NOT NULL,
    "knowledgeDraftManifestHash" TEXT NOT NULL,
    "runtimeOutboxId" TEXT,
    "runtimeOutboxDedupeKey" TEXT NOT NULL,
    "runtimeOutboxPrunedAt" TIMESTAMP(3),
    "receiptHash" TEXT NOT NULL,
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessInformationProjectionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessInformationAttribution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" "BusinessInformationResourceType" NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "identityId" TEXT,
    "offeringId" TEXT,
    "offeringPriceId" TEXT,
    "offeringDurationId" TEXT,
    "fieldPath" TEXT NOT NULL,
    "currentValueHash" TEXT NOT NULL,
    "sourceValueHash" TEXT,
    "authority" "BusinessInformationAuthority" NOT NULL,
    "confidence" "BusinessImportConfidenceBand",
    "sourceId" TEXT,
    "importId" TEXT,
    "candidateId" TEXT,
    "candidateVersion" INTEGER,
    "candidateValueHash" TEXT,
    "evidenceId" TEXT,
    "artifactId" TEXT,
    "artifactSha256" TEXT,
    "importGeneration" INTEGER,
    "parsedRevisionId" TEXT,
    "parsedManifestHash" TEXT,
    "applicationId" TEXT,
    "businessRevisionId" TEXT NOT NULL,
    "businessRevision" INTEGER NOT NULL,
    "businessRevisionHash" TEXT NOT NULL,
    "parserVersion" TEXT,
    "ocrVersion" TEXT,
    "mapperVersion" TEXT,
    "schemaVersion" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessInformationAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessImportQuotaReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "status" "BusinessImportQuotaStatus" NOT NULL DEFAULT 'RESERVED',
    "rawBytes" BIGINT NOT NULL DEFAULT 0,
    "expandedBytes" BIGINT NOT NULL DEFAULT 0,
    "sheetCount" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "cellCount" BIGINT NOT NULL DEFAULT 0,
    "pdfPageCount" INTEGER NOT NULL DEFAULT 0,
    "ocrPageCount" INTEGER NOT NULL DEFAULT 0,
    "ocrPixels" BIGINT NOT NULL DEFAULT 0,
    "processorSeconds" INTEGER NOT NULL DEFAULT 0,
    "extractedCharacters" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "modelTokens" BIGINT NOT NULL DEFAULT 0,
    "retainedBytes" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImportQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessInformationState_tenantId_revision_idx" ON "BusinessInformationState"("tenantId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationState_currentRevision_key" ON "BusinessInformationState"("tenantId", "currentRevisionId", "revision", "canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationState_projectionReceipt_key" ON "BusinessInformationState"("tenantId", "lastProjectionReceiptId", "lastProjectedRevisionId", "lastProjectedRevision", "lastProjectedHash", "lastProjectionReceiptHash");

-- CreateIndex
CREATE INDEX "BusinessInformationRevision_tenantId_createdAt_idx" ON "BusinessInformationRevision"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessInformationRevision_tenantId_parentRevisionId_idx" ON "BusinessInformationRevision"("tenantId", "parentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationRevision_tenantId_revision_key" ON "BusinessInformationRevision"("tenantId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationRevision_tenantId_id_key" ON "BusinessInformationRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationRevision_tenantId_id_revision_key" ON "BusinessInformationRevision"("tenantId", "id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationRevision_exact_key" ON "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationRevision_deltaObjectKey_key" ON "BusinessInformationRevision"("deltaObjectKey");

-- CreateIndex
CREATE INDEX "BusinessImportObjectLedger_tenantId_deletionState_retainUnt_idx" ON "BusinessImportObjectLedger"("tenantId", "deletionState", "retainUntil");

-- CreateIndex
CREATE INDEX "BusinessImportObjectLedger_tenantId_legalHold_deletionState_idx" ON "BusinessImportObjectLedger"("tenantId", "legalHold", "deletionState");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportObjectLedger_tenantId_id_key" ON "BusinessImportObjectLedger"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportObjectLedger_tenantId_objectStorageKey_key" ON "BusinessImportObjectLedger"("tenantId", "objectStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportObjectLedger_exact_object_key" ON "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessIdentity_tenantId_key" ON "BusinessIdentity"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessIdentity_tenantId_id_key" ON "BusinessIdentity"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BusinessOffering_tenantId_active_updatedAt_idx" ON "BusinessOffering"("tenantId", "active", "updatedAt");

-- CreateIndex
CREATE INDEX "BusinessOffering_tenantId_kind_category_idx" ON "BusinessOffering"("tenantId", "kind", "category");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOffering_tenantId_id_key" ON "BusinessOffering"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BusinessOfferingPrice_tenantId_offeringId_effectiveFrom_idx" ON "BusinessOfferingPrice"("tenantId", "offeringId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BusinessOfferingPrice_tenantId_currency_idx" ON "BusinessOfferingPrice"("tenantId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOfferingPrice_tenantId_id_key" ON "BusinessOfferingPrice"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOfferingDuration_tenantId_id_key" ON "BusinessOfferingDuration"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOfferingDuration_tenantId_offeringId_key" ON "BusinessOfferingDuration"("tenantId", "offeringId");

-- CreateIndex
CREATE INDEX "BusinessImportSource_tenantId_status_updatedAt_idx" ON "BusinessImportSource"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportSource_tenantId_id_key" ON "BusinessImportSource"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportSource_tenantId_lineageKey_key" ON "BusinessImportSource"("tenantId", "lineageKey");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportSource_tenantId_id_latestImportId_key" ON "BusinessImportSource"("tenantId", "id", "latestImportId");

-- CreateIndex
CREATE INDEX "BusinessImportArtifact_tenantId_sourceId_sha256_idx" ON "BusinessImportArtifact"("tenantId", "sourceId", "sha256");

-- CreateIndex
CREATE INDEX "BusinessImportArtifact_tenantId_objectLedgerId_idx" ON "BusinessImportArtifact"("tenantId", "objectLedgerId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportArtifact_tenantId_id_key" ON "BusinessImportArtifact"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportArtifact_tenantId_sourceId_id_key" ON "BusinessImportArtifact"("tenantId", "sourceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportArtifact_exact_hash_key" ON "BusinessImportArtifact"("tenantId", "sourceId", "id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportArtifact_tenantId_objectStorageKey_key" ON "BusinessImportArtifact"("tenantId", "objectStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_uploadTokenHash_key" ON "BusinessImport"("uploadTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_stagingObjectKey_key" ON "BusinessImport"("stagingObjectKey");

-- CreateIndex
CREATE INDEX "BusinessImport_tenantId_state_updatedAt_idx" ON "BusinessImport"("tenantId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "BusinessImport_tenantId_sourceId_createdAt_idx" ON "BusinessImport"("tenantId", "sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessImport_state_expiresAt_idx" ON "BusinessImport"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "BusinessImport_tenantId_artifactSha256_idx" ON "BusinessImport"("tenantId", "artifactSha256");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_tenantId_id_key" ON "BusinessImport"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_tenantId_sourceId_id_key" ON "BusinessImport"("tenantId", "sourceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_exact_artifact_key" ON "BusinessImport"("tenantId", "sourceId", "id", "artifactId", "artifactSha256");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImport_current_parsed_revision_key" ON "BusinessImport"("tenantId", "sourceId", "id", "artifactId", "artifactSha256", "generation", "parsedRevisionId", "parsedManifestObjectLedgerId", "parsedManifestObjectKind", "parsedManifestObjectKey", "parsedManifestEncryptionKeyRef", "parsedManifestHash");

-- CreateIndex
CREATE INDEX "BusinessImportParsedRevision_tenantId_artifactId_importGene_idx" ON "BusinessImportParsedRevision"("tenantId", "artifactId", "importGeneration");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_tenantId_id_key" ON "BusinessImportParsedRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_tenantId_sourceId_importId_id_key" ON "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_exact_key" ON "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "id", "manifestObjectLedgerId", "manifestObjectKind", "manifestObjectKey", "manifestEncryptionKeyRef", "manifestHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_evidence_key" ON "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "id", "manifestHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_tenantId_sourceId_importId_imp_key" ON "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "importGeneration");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportParsedRevision_tenantId_manifestObjectKey_key" ON "BusinessImportParsedRevision"("tenantId", "manifestObjectKey");

-- CreateIndex
CREATE INDEX "BusinessImportMapping_tenantId_sourceId_schemaHash_idx" ON "BusinessImportMapping"("tenantId", "sourceId", "schemaHash");

-- CreateIndex
CREATE INDEX "BusinessImportMapping_tenantId_importId_targetCategory_idx" ON "BusinessImportMapping"("tenantId", "importId", "targetCategory");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportMapping_tenantId_id_key" ON "BusinessImportMapping"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportMapping_tenantId_importId_id_key" ON "BusinessImportMapping"("tenantId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportMapping_lineage_revision_key" ON "BusinessImportMapping"("tenantId", "sourceId", "tableKey", "targetCategory", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportMapping_lineage_identity_key" ON "BusinessImportMapping"("tenantId", "sourceId", "tableKey", "targetCategory", "id", "revision");

-- CreateIndex
CREATE INDEX "BusinessImportCandidate_tenantId_importId_decision_action_idx" ON "BusinessImportCandidate"("tenantId", "importId", "decision", "action");

-- CreateIndex
CREATE INDEX "BusinessImportCandidate_tenantId_targetOfferingId_idx" ON "BusinessImportCandidate"("tenantId", "targetOfferingId");

-- CreateIndex
CREATE INDEX "BusinessImportCandidate_tenantId_risk_requiresApproval_idx" ON "BusinessImportCandidate"("tenantId", "risk", "requiresApproval");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidate_tenantId_id_key" ON "BusinessImportCandidate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidate_tenantId_importId_id_key" ON "BusinessImportCandidate"("tenantId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidate_source_context_key" ON "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidate_tenantId_importId_candidateKey_key" ON "BusinessImportCandidate"("tenantId", "importId", "candidateKey");

-- CreateIndex
CREATE INDEX "BusinessImportCandidateRevision_tenantId_importId_candidate_idx" ON "BusinessImportCandidateRevision"("tenantId", "importId", "candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_tenantId_id_key" ON "BusinessImportCandidateRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_tenantId_sourceId_importId__key" ON "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_version_key" ON "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_approval_key" ON "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "requiresApproval", "requiredPermission");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_application_key" ON "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "action", "targetCategory", "risk", "requiresApproval", "requiredPermission");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateRevision_exact_parse_key" ON "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "parsedRevisionId", "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash");

-- CreateIndex
CREATE INDEX "BusinessImportCandidateApproval_tenantId_importId_state_idx" ON "BusinessImportCandidateApproval"("tenantId", "importId", "state");

-- CreateIndex
CREATE INDEX "BusinessImportCandidateApproval_tenantId_requestedByUserId__idx" ON "BusinessImportCandidateApproval"("tenantId", "requestedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateApproval_tenantId_id_key" ON "BusinessImportCandidateApproval"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApproval_candidate_context_key" ON "BusinessImportCandidateApproval"("tenantId", "sourceId", "importId", "candidateId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApproval_exact_version_key" ON "BusinessImportCandidateApproval"("tenantId", "sourceId", "importId", "candidateId", "id", "candidateVersion", "candidateValueHash", "requiredPermission");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateApproval_tenantId_candidateId_candid_key" ON "BusinessImportCandidateApproval"("tenantId", "candidateId", "candidateVersion", "candidateValueHash", "requiredPermission");

-- CreateIndex
CREATE INDEX "BusinessImportApprovalGrant_tenantId_importId_candidateId_idx" ON "BusinessImportApprovalGrant"("tenantId", "importId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApprovalGrant_tenantId_id_key" ON "BusinessImportApprovalGrant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApprovalGrant_exact_key" ON "BusinessImportApprovalGrant"("tenantId", "sourceId", "importId", "candidateId", "id", "candidateVersion", "candidateValueHash", "requiredPermission");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApprovalGrant_tenantId_approvalId_key" ON "BusinessImportApprovalGrant"("tenantId", "approvalId");

-- CreateIndex
CREATE INDEX "BusinessImportCandidateEvidence_tenantId_candidateId_idx" ON "BusinessImportCandidateEvidence"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "BusinessImportCandidateEvidence_tenantId_artifactId_parsedR_idx" ON "BusinessImportCandidateEvidence"("tenantId", "artifactId", "parsedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportCandidateEvidence_tenantId_id_key" ON "BusinessImportCandidateEvidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportEvidence_source_context_key" ON "BusinessImportCandidateEvidence"("tenantId", "sourceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportEvidence_exact_context_key" ON "BusinessImportCandidateEvidence"("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash", "sourceValueHash", "id");

-- CreateIndex
CREATE INDEX "BusinessImportEvidence_excerpt_ledger_idx" ON "BusinessImportCandidateEvidence"("tenantId", "excerptObjectLedgerId");

-- CreateIndex
CREATE INDEX "BusinessOfferingSourceBinding_tenantId_offeringId_idx" ON "BusinessOfferingSourceBinding"("tenantId", "offeringId");

-- CreateIndex
CREATE INDEX "BusinessOfferingSourceBinding_tenantId_sourceId_normalizedC_idx" ON "BusinessOfferingSourceBinding"("tenantId", "sourceId", "normalizedCandidateKey");

-- CreateIndex
CREATE INDEX "BusinessOfferingSourceBinding_tenantId_sourceId_active_idx" ON "BusinessOfferingSourceBinding"("tenantId", "sourceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOfferingSourceBinding_tenantId_id_key" ON "BusinessOfferingSourceBinding"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOfferingSourceBinding_tenantId_sourceId_externalKey_key" ON "BusinessOfferingSourceBinding"("tenantId", "sourceId", "externalKey");

-- CreateIndex
CREATE INDEX "BusinessImportApplication_tenantId_importId_state_idx" ON "BusinessImportApplication"("tenantId", "importId", "state");

-- CreateIndex
CREATE INDEX "BusinessImportApplication_tenantId_resultingInformationRevi_idx" ON "BusinessImportApplication"("tenantId", "resultingInformationRevision");

-- CreateIndex
CREATE INDEX "BusinessImportApplication_tenantId_publicationId_idx" ON "BusinessImportApplication"("tenantId", "publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_tenantId_id_key" ON "BusinessImportApplication"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_tenantId_importId_id_key" ON "BusinessImportApplication"("tenantId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_source_context_key" ON "BusinessImportApplication"("tenantId", "sourceId", "importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_revision_context_key" ON "BusinessImportApplication"("tenantId", "sourceId", "importId", "id", "businessRevisionId", "resultingInformationRevision", "resultingInformationHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_projection_context_key" ON "BusinessImportApplication"("tenantId", "sourceId", "importId", "id", "businessRevisionId", "resultingInformationRevision", "resultingInformationHash", "projectionOutboxDedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_tenantId_businessRevisionId_key" ON "BusinessImportApplication"("tenantId", "businessRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_tenantId_idempotencyKeyHash_key" ON "BusinessImportApplication"("tenantId", "idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplication_tenantId_projectionOutboxDedupeKe_key" ON "BusinessImportApplication"("tenantId", "projectionOutboxDedupeKey");

-- CreateIndex
CREATE INDEX "BusinessImportApplicationCandidate_tenantId_importId_candid_idx" ON "BusinessImportApplicationCandidate"("tenantId", "importId", "candidateId");

-- CreateIndex
CREATE INDEX "BusinessImportApplicationCandidate_tenantId_approvalGrantId_idx" ON "BusinessImportApplicationCandidate"("tenantId", "approvalGrantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportApplicationCandidate_attribution_key" ON "BusinessImportApplicationCandidate"("tenantId", "sourceId", "importId", "applicationId", "candidateId", "candidateVersion", "candidateValueHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_applicationId_key" ON "BusinessInformationProjectionReceipt"("applicationId");

-- CreateIndex
CREATE INDEX "BusinessInformationProjectionReceipt_tenantId_businessRevis_idx" ON "BusinessInformationProjectionReceipt"("tenantId", "businessRevision", "projectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_tenantId_id_key" ON "BusinessInformationProjectionReceipt"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_exact_key" ON "BusinessInformationProjectionReceipt"("tenantId", "id", "businessRevisionId", "businessRevision", "businessRevisionHash", "receiptHash");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_tenantId_applicationId_key" ON "BusinessInformationProjectionReceipt"("tenantId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_application_key" ON "BusinessInformationProjectionReceipt"("tenantId", "sourceId", "importId", "applicationId", "businessRevisionId", "businessRevision", "businessRevisionHash", "runtimeOutboxDedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationProjectionReceipt_tenantId_runtimeOutbox_key" ON "BusinessInformationProjectionReceipt"("tenantId", "runtimeOutboxDedupeKey");

-- CreateIndex
CREATE INDEX "BusinessInformationAttribution_tenantId_resourceType_resour_idx" ON "BusinessInformationAttribution"("tenantId", "resourceType", "resourceKey", "fieldPath", "supersededAt");

-- CreateIndex
CREATE INDEX "BusinessInformationAttribution_tenantId_sourceId_importId_idx" ON "BusinessInformationAttribution"("tenantId", "sourceId", "importId");

-- CreateIndex
CREATE INDEX "BusinessInformationAttribution_tenantId_candidateId_idx" ON "BusinessInformationAttribution"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "BusinessInformationAttribution_tenantId_businessRevisionId_idx" ON "BusinessInformationAttribution"("tenantId", "businessRevisionId");

-- CreateIndex
CREATE INDEX "BusinessInformationAttribution_tenantId_artifactId_idx" ON "BusinessInformationAttribution"("tenantId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInformationAttribution_tenantId_id_key" ON "BusinessInformationAttribution"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BusinessImportQuotaReservation_status_expiresAt_idx" ON "BusinessImportQuotaReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BusinessImportQuotaReservation_tenantId_status_createdAt_idx" ON "BusinessImportQuotaReservation"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportQuotaReservation_tenantId_id_key" ON "BusinessImportQuotaReservation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessImportQuotaReservation_tenantId_importId_key" ON "BusinessImportQuotaReservation"("tenantId", "importId");

-- AddForeignKey
ALTER TABLE "BusinessInformationState" ADD CONSTRAINT "BusinessInformationState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationState" ADD CONSTRAINT "BusinessInformationState_tenantId_currentRevisionId_revisi_fkey" FOREIGN KEY ("tenantId", "currentRevisionId", "revision", "canonicalHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationState" ADD CONSTRAINT "BusinessInformationState_tenantId_lastProjectionReceiptId__fkey" FOREIGN KEY ("tenantId", "lastProjectionReceiptId", "lastProjectedRevisionId", "lastProjectedRevision", "lastProjectedHash", "lastProjectionReceiptHash") REFERENCES "BusinessInformationProjectionReceipt"("tenantId", "id", "businessRevisionId", "businessRevision", "businessRevisionHash", "receiptHash") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationState" ADD CONSTRAINT "BusinessInformationState_tenantId_updatedByUserId_fkey" FOREIGN KEY ("tenantId", "updatedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationRevision" ADD CONSTRAINT "BusinessInformationRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationRevision" ADD CONSTRAINT "BusinessInformationRevision_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationRevision" ADD CONSTRAINT "BusinessInformationRevision_tenantId_parentRevisionId_pare_fkey" FOREIGN KEY ("tenantId", "parentRevisionId", "parentRevision") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationRevision" ADD CONSTRAINT "BusinessInformationRevision_tenantId_deltaObjectLedgerId_d_fkey" FOREIGN KEY ("tenantId", "deltaObjectLedgerId", "deltaObjectKind", "deltaObjectKey", "deltaEncryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportObjectLedger" ADD CONSTRAINT "BusinessImportObjectLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessIdentity" ADD CONSTRAINT "BusinessIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOffering" ADD CONSTRAINT "BusinessOffering_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingPrice" ADD CONSTRAINT "BusinessOfferingPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingPrice" ADD CONSTRAINT "BusinessOfferingPrice_tenantId_offeringId_fkey" FOREIGN KEY ("tenantId", "offeringId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingDuration" ADD CONSTRAINT "BusinessOfferingDuration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingDuration" ADD CONSTRAINT "BusinessOfferingDuration_tenantId_offeringId_fkey" FOREIGN KEY ("tenantId", "offeringId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportSource" ADD CONSTRAINT "BusinessImportSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportSource" ADD CONSTRAINT "BusinessImportSource_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportSource" ADD CONSTRAINT "BusinessImportSource_tenantId_updatedByUserId_fkey" FOREIGN KEY ("tenantId", "updatedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportSource" ADD CONSTRAINT "BusinessImportSource_tenantId_id_latestImportId_fkey" FOREIGN KEY ("tenantId", "id", "latestImportId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportArtifact" ADD CONSTRAINT "BusinessImportArtifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportArtifact" ADD CONSTRAINT "BusinessImportArtifact_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "BusinessImportSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportArtifact" ADD CONSTRAINT "BusinessImportArtifact_tenantId_objectLedgerId_objectKind__fkey" FOREIGN KEY ("tenantId", "objectLedgerId", "objectKind", "objectStorageKey", "encryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "BusinessImportSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_stagingObjectLedgerId_stagingObjec_fkey" FOREIGN KEY ("tenantId", "stagingObjectLedgerId", "stagingObjectKind", "stagingObjectKey", "stagingEncryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_sourceId_artifactId_artifactSha256_fkey" FOREIGN KEY ("tenantId", "sourceId", "artifactId", "artifactSha256") REFERENCES "BusinessImportArtifact"("tenantId", "sourceId", "id", "sha256") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_baseBusinessRevisionId_baseInforma_fkey" FOREIGN KEY ("tenantId", "baseBusinessRevisionId", "baseInformationRevision", "baseInformationHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_sourceId_id_artifactId_artifactSha_fkey" FOREIGN KEY ("tenantId", "sourceId", "id", "artifactId", "artifactSha256", "generation", "parsedRevisionId", "parsedManifestObjectLedgerId", "parsedManifestObjectKind", "parsedManifestObjectKey", "parsedManifestEncryptionKeyRef", "parsedManifestHash") REFERENCES "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "id", "manifestObjectLedgerId", "manifestObjectKind", "manifestObjectKey", "manifestEncryptionKeyRef", "manifestHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImport" ADD CONSTRAINT "BusinessImport_tenantId_cancelledByUserId_fkey" FOREIGN KEY ("tenantId", "cancelledByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportParsedRevision" ADD CONSTRAINT "BusinessImportParsedRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportParsedRevision" ADD CONSTRAINT "BusinessImportParsedRevision_tenantId_sourceId_importId_ar_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "artifactId", "artifactSha256") REFERENCES "BusinessImport"("tenantId", "sourceId", "id", "artifactId", "artifactSha256") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportParsedRevision" ADD CONSTRAINT "BusinessImportParsedRevision_tenantId_sourceId_artifactId__fkey" FOREIGN KEY ("tenantId", "sourceId", "artifactId", "artifactSha256") REFERENCES "BusinessImportArtifact"("tenantId", "sourceId", "id", "sha256") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportParsedRevision" ADD CONSTRAINT "BusinessImportParsedRevision_tenantId_manifestObjectLedger_fkey" FOREIGN KEY ("tenantId", "manifestObjectLedgerId", "manifestObjectKind", "manifestObjectKey", "manifestEncryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportMapping" ADD CONSTRAINT "BusinessImportMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportMapping" ADD CONSTRAINT "BusinessImportMapping_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "BusinessImportSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportMapping" ADD CONSTRAINT "BusinessImportMapping_tenantId_sourceId_importId_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportMapping" ADD CONSTRAINT "BusinessImportMapping_tenantId_confirmedByUserId_fkey" FOREIGN KEY ("tenantId", "confirmedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportMapping" ADD CONSTRAINT "BusinessImportMapping_tenantId_sourceId_tableKey_targetCat_fkey" FOREIGN KEY ("tenantId", "sourceId", "tableKey", "targetCategory", "supersedesMappingId", "supersedesRevision") REFERENCES "BusinessImportMapping"("tenantId", "sourceId", "tableKey", "targetCategory", "id", "revision") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidate" ADD CONSTRAINT "BusinessImportCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidate" ADD CONSTRAINT "BusinessImportCandidate_tenantId_sourceId_importId_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidate" ADD CONSTRAINT "BusinessImportCandidate_tenantId_importId_mappingId_fkey" FOREIGN KEY ("tenantId", "importId", "mappingId") REFERENCES "BusinessImportMapping"("tenantId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidate" ADD CONSTRAINT "BusinessImportCandidate_tenantId_targetOfferingId_fkey" FOREIGN KEY ("tenantId", "targetOfferingId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidate" ADD CONSTRAINT "BusinessImportCandidate_tenantId_decidedByUserId_fkey" FOREIGN KEY ("tenantId", "decidedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_import_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_parsed_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash") REFERENCES "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "id", "manifestHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_tenantId_importId_mappingI_fkey" FOREIGN KEY ("tenantId", "importId", "mappingId") REFERENCES "BusinessImportMapping"("tenantId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateRevision" ADD CONSTRAINT "BusinessImportCandidateRevision_tenantId_targetOfferingId_fkey" FOREIGN KEY ("tenantId", "targetOfferingId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_import_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "requiresApproval", "requiredPermission") REFERENCES "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "requiresApproval", "requiredPermission") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_tenantId_requestedByUserId_fkey" FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateApproval" ADD CONSTRAINT "BusinessImportCandidateApproval_tenantId_decidedByUserId_fkey" FOREIGN KEY ("tenantId", "decidedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_tenantId_sourceId_importId_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash") REFERENCES "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_approval_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "approvalId", "candidateVersion", "candidateValueHash", "requiredPermission") REFERENCES "BusinessImportCandidateApproval"("tenantId", "sourceId", "importId", "candidateId", "id", "candidateVersion", "candidateValueHash", "requiredPermission") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApprovalGrant" ADD CONSTRAINT "BusinessImportApprovalGrant_tenantId_grantedByUserId_fkey" FOREIGN KEY ("tenantId", "grantedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_import_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "parsedRevisionId", "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash") REFERENCES "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "parsedRevisionId", "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_parsed_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash") REFERENCES "BusinessImportParsedRevision"("tenantId", "sourceId", "importId", "artifactId", "artifactSha256", "importGeneration", "id", "manifestHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_tenantId_sourceId_artifact_fkey" FOREIGN KEY ("tenantId", "sourceId", "artifactId", "artifactSha256") REFERENCES "BusinessImportArtifact"("tenantId", "sourceId", "id", "sha256") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportCandidateEvidence" ADD CONSTRAINT "BusinessImportCandidateEvidence_tenantId_excerptObjectLedg_fkey" FOREIGN KEY ("tenantId", "excerptObjectLedgerId", "excerptObjectKind", "excerptObjectKey", "excerptEncryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingSourceBinding" ADD CONSTRAINT "BusinessOfferingSourceBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingSourceBinding" ADD CONSTRAINT "BusinessOfferingSourceBinding_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "BusinessImportSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingSourceBinding" ADD CONSTRAINT "BusinessOfferingSourceBinding_tenantId_offeringId_fkey" FOREIGN KEY ("tenantId", "offeringId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingSourceBinding" ADD CONSTRAINT "BusinessOfferingSourceBinding_tenantId_sourceId_firstSeenI_fkey" FOREIGN KEY ("tenantId", "sourceId", "firstSeenImportId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessOfferingSourceBinding" ADD CONSTRAINT "BusinessOfferingSourceBinding_tenantId_sourceId_lastSeenIm_fkey" FOREIGN KEY ("tenantId", "sourceId", "lastSeenImportId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_sourceId_importId_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_baseBusinessRevisionId__fkey" FOREIGN KEY ("tenantId", "baseBusinessRevisionId", "baseInformationRevision", "baseInformationHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_businessRevisionId_resu_fkey" FOREIGN KEY ("tenantId", "businessRevisionId", "resultingInformationRevision", "resultingInformationHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_previewObjectLedgerId_p_fkey" FOREIGN KEY ("tenantId", "previewObjectLedgerId", "previewObjectKind", "previewObjectKey", "previewEncryptionKeyRef") REFERENCES "BusinessImportObjectLedger"("tenantId", "id", "objectKind", "objectStorageKey", "encryptionKeyRef") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_projectionOutboxId_fkey" FOREIGN KEY ("projectionOutboxId") REFERENCES "RuntimeOutbox"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_publicationId_fkey" FOREIGN KEY ("tenantId", "publicationId") REFERENCES "KnowledgePublication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplication" ADD CONSTRAINT "BusinessImportApplication_tenantId_revertOfApplicationId_fkey" FOREIGN KEY ("tenantId", "revertOfApplicationId") REFERENCES "BusinessImportApplication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplicationCandidate" ADD CONSTRAINT "BusinessImportApplicationCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplicationCandidate" ADD CONSTRAINT "BusinessImportApplicationCandidate_tenantId_sourceId_impor_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "applicationId") REFERENCES "BusinessImportApplication"("tenantId", "sourceId", "importId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplicationCandidate" ADD CONSTRAINT "BusinessImportApplicationCandidate_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplicationCandidate" ADD CONSTRAINT "BusinessImportApplicationCandidate_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "action", "targetCategory", "risk", "requiresApproval", "requiredPermission") REFERENCES "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "action", "targetCategory", "risk", "requiresApproval", "requiredPermission") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportApplicationCandidate" ADD CONSTRAINT "BusinessImportApplicationCandidate_approval_grant_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "approvalGrantId", "candidateVersion", "candidateValueHash", "requiredPermission") REFERENCES "BusinessImportApprovalGrant"("tenantId", "sourceId", "importId", "candidateId", "id", "candidateVersion", "candidateValueHash", "requiredPermission") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationProjectionReceipt" ADD CONSTRAINT "BusinessInformationProjectionReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationProjectionReceipt" ADD CONSTRAINT "BusinessInformationProjectionReceipt_import_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId") REFERENCES "BusinessImport"("tenantId", "sourceId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationProjectionReceipt" ADD CONSTRAINT "BusinessInformationProjectionReceipt_application_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "applicationId", "businessRevisionId", "businessRevision", "businessRevisionHash", "runtimeOutboxDedupeKey") REFERENCES "BusinessImportApplication"("tenantId", "sourceId", "importId", "id", "businessRevisionId", "resultingInformationRevision", "resultingInformationHash", "projectionOutboxDedupeKey") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationProjectionReceipt" ADD CONSTRAINT "BusinessInformationProjectionReceipt_tenantId_businessRevi_fkey" FOREIGN KEY ("tenantId", "businessRevisionId", "businessRevision", "businessRevisionHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationProjectionReceipt" ADD CONSTRAINT "BusinessInformationProjectionReceipt_runtimeOutboxId_fkey" FOREIGN KEY ("runtimeOutboxId") REFERENCES "RuntimeOutbox"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_identityId_fkey" FOREIGN KEY ("tenantId", "identityId") REFERENCES "BusinessIdentity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_offeringId_fkey" FOREIGN KEY ("tenantId", "offeringId") REFERENCES "BusinessOffering"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_offeringPriceId_fkey" FOREIGN KEY ("tenantId", "offeringPriceId") REFERENCES "BusinessOfferingPrice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_offeringDurationId_fkey" FOREIGN KEY ("tenantId", "offeringDurationId") REFERENCES "BusinessOfferingDuration"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "BusinessImportSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_importId_fkey" FOREIGN KEY ("tenantId", "importId") REFERENCES "BusinessImport"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId") REFERENCES "BusinessImportCandidate"("tenantId", "sourceId", "importId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_candidate_revision_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "parsedRevisionId", "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash") REFERENCES "BusinessImportCandidateRevision"("tenantId", "sourceId", "importId", "candidateId", "version", "normalizedValueHash", "parsedRevisionId", "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_evidence_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash", "sourceValueHash", "evidenceId") REFERENCES "BusinessImportCandidateEvidence"("tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash", "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash", "sourceValueHash", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_sourceId_artifactI_fkey" FOREIGN KEY ("tenantId", "sourceId", "artifactId", "artifactSha256") REFERENCES "BusinessImportArtifact"("tenantId", "sourceId", "id", "sha256") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_application_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "applicationId", "businessRevisionId", "businessRevision", "businessRevisionHash") REFERENCES "BusinessImportApplication"("tenantId", "sourceId", "importId", "id", "businessRevisionId", "resultingInformationRevision", "resultingInformationHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_application_candidate_fkey" FOREIGN KEY ("tenantId", "sourceId", "importId", "applicationId", "candidateId", "candidateVersion", "candidateValueHash") REFERENCES "BusinessImportApplicationCandidate"("tenantId", "sourceId", "importId", "applicationId", "candidateId", "candidateVersion", "candidateValueHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_businessRevisionId_fkey" FOREIGN KEY ("tenantId", "businessRevisionId", "businessRevision", "businessRevisionHash") REFERENCES "BusinessInformationRevision"("tenantId", "id", "revision", "canonicalHash") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessInformationAttribution" ADD CONSTRAINT "BusinessInformationAttribution_tenantId_approvedByUserId_fkey" FOREIGN KEY ("tenantId", "approvedByUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportQuotaReservation" ADD CONSTRAINT "BusinessImportQuotaReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BusinessImportQuotaReservation" ADD CONSTRAINT "BusinessImportQuotaReservation_tenantId_importId_fkey" FOREIGN KEY ("tenantId", "importId") REFERENCES "BusinessImport"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "BusinessInformationState"
  ADD CONSTRAINT "BusinessInformationState_version_check" CHECK ("revision" >= 0 AND "etag" > 0),
  ADD CONSTRAINT "BusinessInformationState_hash_check" CHECK ("canonicalHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "BusinessInformationState_current_check" CHECK (
    ("revision" = 0 AND "currentRevisionId" IS NULL)
    OR ("revision" > 0 AND "currentRevisionId" IS NOT NULL)
  ),
  ADD CONSTRAINT "BusinessInformationState_projection_check" CHECK (
    (
      "lastProjectedRevisionId" IS NULL
      AND "lastProjectedRevision" IS NULL
      AND "lastProjectedHash" IS NULL
      AND "lastProjectionReceiptId" IS NULL
      AND "lastProjectionReceiptHash" IS NULL
    )
    OR (
      "lastProjectedRevisionId" IS NOT NULL
      AND "lastProjectedRevision" > 0
      AND "lastProjectedRevision" <= "revision"
      AND "lastProjectedHash" ~ '^[a-f0-9]{64}$'
      AND "lastProjectionReceiptId" IS NOT NULL
      AND "lastProjectionReceiptHash" ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE "BusinessInformationRevision"
  ADD CONSTRAINT "BusinessInformationRevision_number_check" CHECK (
    "revision" > 0
    AND (
      ("revision" = 1 AND "parentRevisionId" IS NULL AND "parentRevision" IS NULL)
      OR ("revision" > 1 AND "parentRevisionId" IS NOT NULL AND "parentRevision" = "revision" - 1)
    )
  ),
  ADD CONSTRAINT "BusinessInformationRevision_hash_check" CHECK (
    "canonicalHash" ~ '^[a-f0-9]{64}$' AND "deltaHash" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "BusinessInformationRevision_object_check" CHECK (
    "deltaObjectKind" = 'REVISION_DELTA'
  );

ALTER TABLE "BusinessImportObjectLedger"
  ADD CONSTRAINT "BusinessImportObjectLedger_identity_check" CHECK (
    length("objectStorageKey") > 0
    AND length("encryptionKeyRef") > 0
    AND length("retentionClass") > 0
  ),
  ADD CONSTRAINT "BusinessImportObjectLedger_lifecycle_check" CHECK (
    ("retainUntil" IS NULL OR "retainUntil" >= "createdAt")
    AND ("tombstonedAt" IS NULL OR "tombstonedAt" >= "createdAt")
    AND ("deletionStartedAt" IS NULL OR "deletionStartedAt" >= "tombstonedAt")
    AND ("deletedAt" IS NULL OR "deletedAt" >= "deletionStartedAt")
    AND (
      (
        "legalHold"
        AND "deletionState" = 'RETAINED'
        AND "tombstoneReason" IS NULL
        AND "tombstonedAt" IS NULL
        AND "deletionStartedAt" IS NULL
        AND "deletedAt" IS NULL
        AND "lastErrorCode" IS NULL
      )
      OR (
        NOT "legalHold"
        AND (
          ("deletionState" = 'RETAINED' AND "tombstoneReason" IS NULL AND "tombstonedAt" IS NULL AND "deletionStartedAt" IS NULL AND "deletedAt" IS NULL AND "lastErrorCode" IS NULL)
          OR ("deletionState" = 'TOMBSTONED' AND length("tombstoneReason") > 0 AND "tombstonedAt" IS NOT NULL AND "deletionStartedAt" IS NULL AND "deletedAt" IS NULL AND "lastErrorCode" IS NULL)
          OR ("deletionState" = 'DELETING' AND length("tombstoneReason") > 0 AND "tombstonedAt" IS NOT NULL AND "deletionStartedAt" IS NOT NULL AND "deletedAt" IS NULL)
          OR ("deletionState" = 'DELETED' AND length("tombstoneReason") > 0 AND "tombstonedAt" IS NOT NULL AND "deletionStartedAt" IS NOT NULL AND "deletedAt" IS NOT NULL)
          OR ("deletionState" = 'FAILED' AND length("tombstoneReason") > 0 AND "tombstonedAt" IS NOT NULL AND "deletionStartedAt" IS NOT NULL AND "deletedAt" IS NULL AND length("lastErrorCode") > 0)
        )
      )
    )
  );

ALTER TABLE "BusinessIdentity"
  ADD CONSTRAINT "BusinessIdentity_value_check" CHECK (
    "rowVersion" > 0
    AND "defaultCurrency" ~ '^[A-Z]{3}$'
    AND length("defaultLocale") > 0
    AND length("timezone") > 0
  );

ALTER TABLE "BusinessOffering"
  ADD CONSTRAINT "BusinessOffering_version_check" CHECK ("rowVersion" > 0),
  ADD CONSTRAINT "BusinessOffering_archive_check" CHECK ("archivedAt" IS NULL OR "active" = false);

ALTER TABLE "BusinessOfferingPrice"
  ADD CONSTRAINT "BusinessOfferingPrice_value_check" CHECK (
    "rowVersion" > 0
    AND "currency" ~ '^[A-Z]{3}$'
    AND ("effectiveUntil" IS NULL OR "effectiveFrom" IS NULL OR "effectiveUntil" >= "effectiveFrom")
    AND (
      ("type" = 'FIXED' AND "amount" IS NOT NULL AND "amount" >= 0 AND "amountFrom" IS NULL AND "amountTo" IS NULL)
      OR ("type" = 'FROM' AND "amount" IS NULL AND "amountFrom" IS NOT NULL AND "amountFrom" >= 0 AND "amountTo" IS NULL)
      OR ("type" = 'RANGE' AND "amount" IS NULL AND "amountFrom" IS NOT NULL AND "amountTo" IS NOT NULL AND "amountFrom" >= 0 AND "amountTo" >= "amountFrom")
      OR ("type" IN ('FREE', 'ON_REQUEST') AND "amount" IS NULL AND "amountFrom" IS NULL AND "amountTo" IS NULL)
    )
  );

ALTER TABLE "BusinessOfferingDuration"
  ADD CONSTRAINT "BusinessOfferingDuration_value_check" CHECK (
    "rowVersion" > 0
    AND "minimumMinutes" >= 0
    AND ("maximumMinutes" IS NULL OR "maximumMinutes" >= "minimumMinutes")
    AND ("preparationMinutes" IS NULL OR "preparationMinutes" >= 0)
    AND ("bufferMinutes" IS NULL OR "bufferMinutes" >= 0)
  );

ALTER TABLE "BusinessImportSource"
  ADD CONSTRAINT "BusinessImportSource_version_check" CHECK (
    "etag" > 0 AND ("lastMappingRevision" IS NULL OR "lastMappingRevision" > 0)
  ),
  ADD CONSTRAINT "BusinessImportSource_archive_check" CHECK (
    ("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL)
  );

ALTER TABLE "BusinessImportArtifact"
  ADD CONSTRAINT "BusinessImportArtifact_value_check" CHECK (
    "byteSize" > 0
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "objectKind" = 'RAW_ARTIFACT'
  ),
  ADD CONSTRAINT "BusinessImportArtifact_scan_check" CHECK (
    "malwareStatus" NOT IN ('CLEAN', 'DETECTED') OR "scannedAt" IS NOT NULL
  );

ALTER TABLE "BusinessImport"
  ADD CONSTRAINT "BusinessImport_version_check" CHECK (
    "generation" > 0 AND "etag" > 0 AND "expectedByteSize" > 0 AND "baseInformationRevision" >= 0
  ),
  ADD CONSTRAINT "BusinessImport_hash_check" CHECK (
    "baseInformationHash" ~ '^[a-f0-9]{64}$'
    AND ("artifactSha256" IS NULL OR "artifactSha256" ~ '^[a-f0-9]{64}$')
    AND ("parsedManifestHash" IS NULL OR "parsedManifestHash" ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT "BusinessImport_base_revision_check" CHECK (
    ("baseInformationRevision" = 0 AND "baseBusinessRevisionId" IS NULL)
    OR ("baseInformationRevision" > 0 AND "baseBusinessRevisionId" IS NOT NULL)
  ),
  ADD CONSTRAINT "BusinessImport_staging_check" CHECK (
    (
      "stagingObjectKey" IS NULL
      AND "stagingEncryptionKeyRef" IS NULL
      AND "stagingObjectLedgerId" IS NULL
      AND "stagingObjectKind" IS NULL
    )
    OR (
      "stagingObjectKey" IS NOT NULL
      AND "stagingEncryptionKeyRef" IS NOT NULL
      AND "stagingObjectLedgerId" IS NOT NULL
      AND "stagingObjectKind" = 'STAGING'
    )
  ),
  ADD CONSTRAINT "BusinessImport_artifact_check" CHECK (
    ("artifactId" IS NULL AND "artifactSha256" IS NULL)
    OR ("artifactId" IS NOT NULL AND "artifactSha256" IS NOT NULL)
  ),
  ADD CONSTRAINT "BusinessImport_manifest_check" CHECK (
    (
      "parsedRevisionId" IS NULL
      AND "parsedManifestObjectKey" IS NULL
      AND "parsedManifestEncryptionKeyRef" IS NULL
      AND "parsedManifestObjectLedgerId" IS NULL
      AND "parsedManifestObjectKind" IS NULL
      AND "parsedManifestHash" IS NULL
    )
    OR (
      "artifactId" IS NOT NULL
      AND "parsedRevisionId" IS NOT NULL
      AND "parsedManifestObjectKey" IS NOT NULL
      AND "parsedManifestEncryptionKeyRef" IS NOT NULL
      AND "parsedManifestObjectLedgerId" IS NOT NULL
      AND "parsedManifestObjectKind" = 'PARSED_MANIFEST'
      AND "parsedManifestHash" IS NOT NULL
      AND "parserVersion" IS NOT NULL
      AND "mapperVersion" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "BusinessImport_retry_check" CHECK (NOT "retryable" OR "state" = 'FAILED_RETRYABLE'),
  ADD CONSTRAINT "BusinessImport_cancel_check" CHECK (
    "state" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL)
  ),
  ADD CONSTRAINT "BusinessImport_applied_check" CHECK (
    "state" NOT IN ('APPLIED', 'PARTIALLY_APPLIED') OR "appliedAt" IS NOT NULL
  );

ALTER TABLE "BusinessImportParsedRevision"
  ADD CONSTRAINT "BusinessImportParsedRevision_value_check" CHECK (
    "importGeneration" > 0
    AND "artifactSha256" ~ '^[a-f0-9]{64}$'
    AND "manifestHash" ~ '^[a-f0-9]{64}$'
    AND "manifestObjectKind" = 'PARSED_MANIFEST'
    AND length("parserVersion") > 0
    AND length("mapperVersion") > 0
    AND length("schemaVersion") > 0
    AND length("extractionContractVersion") > 0
  );

ALTER TABLE "BusinessImportMapping"
  ADD CONSTRAINT "BusinessImportMapping_version_check" CHECK (
    "revision" > 0
    AND "etag" > 0
    AND ("headerRow" IS NULL OR "headerRow" > 0)
    AND ("defaultCurrency" IS NULL OR "defaultCurrency" ~ '^[A-Z]{3}$')
    AND (
      ("revision" = 1 AND "supersedesMappingId" IS NULL AND "supersedesRevision" IS NULL)
      OR (
        "revision" > 1
        AND "supersedesMappingId" IS NOT NULL
        AND "supersedesRevision" = "revision" - 1
      )
    )
  );

ALTER TABLE "BusinessImportCandidate"
  ADD CONSTRAINT "BusinessImportCandidate_version_check" CHECK (
    "version" > 0
    AND "etag" > 0
    AND "normalizedValueHash" ~ '^[a-f0-9]{64}$'
    AND (("requiresApproval" AND length("requiredPermission") > 0) OR (NOT "requiresApproval" AND "requiredPermission" = ''))
  ),
  ADD CONSTRAINT "BusinessImportCandidate_nonapplyable_check" CHECK (
    "action" NOT IN ('MISSING', 'INVALID')
    OR "decision" NOT IN ('ACCEPTED', 'EDITED', 'SUBMITTED_FOR_APPROVAL', 'APPLIED')
  ),
  ADD CONSTRAINT "BusinessImportCandidate_prohibited_check" CHECK (
    "risk" <> 'PROHIBITED'
    OR "decision" NOT IN ('ACCEPTED', 'EDITED', 'SUBMITTED_FOR_APPROVAL', 'APPLIED')
  );

CREATE OR REPLACE FUNCTION "business_import_field_provenance_valid"(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  entry RECORD;
  path_count INTEGER := 0;
  expected_paths TEXT[] := ARRAY[
    '/active', '/archivedAt', '/bookingNotes', '/category', '/description',
    '/duration/maximumMinutes', '/duration/minimumMinutes', '/externalId', '/kind',
    '/language', '/locationExternalId', '/name', '/price/amount', '/price/currency',
    '/price/from', '/price/taxNote', '/price/to', '/price/type', '/price/unit',
    '/validFrom', '/validUntil'
  ];
BEGIN
  IF jsonb_typeof(value) <> 'object' OR NOT value ?& expected_paths THEN
    RETURN FALSE;
  END IF;
  FOR entry IN SELECT key, item FROM jsonb_each(value) AS fields(key, item) LOOP
    path_count := path_count + 1;
    IF jsonb_typeof(entry.item) <> 'object'
      OR NOT entry.item ? 'authority'
      OR jsonb_typeof(entry.item->'authority') <> 'string' THEN
      RETURN FALSE;
    END IF;
    IF entry.item->>'authority' = 'IMPORTED' THEN
      IF (entry.item - 'authority' - 'evidenceId') <> '{}'::jsonb
        OR jsonb_typeof(entry.item->'evidenceId') <> 'string'
        OR length(entry.item->>'evidenceId') = 0 THEN
        RETURN FALSE;
      END IF;
    ELSIF entry.item->>'authority' IN ('MANUAL', 'SYSTEM') THEN
      IF (entry.item - 'authority') <> '{}'::jsonb THEN
        RETURN FALSE;
      END IF;
    ELSE
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN path_count = cardinality(expected_paths);
END;
$$;

ALTER TABLE "BusinessImportCandidateRevision"
  ADD CONSTRAINT "BusinessImportCandidateRevision_value_check" CHECK (
    "version" > 0
    AND "importGeneration" > 0
    AND "normalizedValueHash" ~ '^[a-f0-9]{64}$'
    AND "artifactSha256" ~ '^[a-f0-9]{64}$'
    AND "parsedManifestHash" ~ '^[a-f0-9]{64}$'
    AND "business_import_field_provenance_valid"("fieldProvenance")
    AND (("requiresApproval" AND length("requiredPermission") > 0) OR (NOT "requiresApproval" AND "requiredPermission" = ''))
  );

ALTER TABLE "BusinessImportCandidateApproval"
  ADD CONSTRAINT "BusinessImportApproval_version_check" CHECK (
    "candidateVersion" > 0
    AND "etag" > 0
    AND "candidateValueHash" ~ '^[a-f0-9]{64}$'
    AND "requiresApproval"
    AND length("requiredPermission") > 0
  ),
  ADD CONSTRAINT "BusinessImportApproval_state_check" CHECK (
    ("state" = 'PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "invalidatedAt" IS NULL)
    OR ("state" IN ('APPROVED', 'REJECTED') AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "invalidatedAt" IS NULL)
    OR ("state" = 'INVALIDATED' AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "invalidatedAt" IS NOT NULL)
  );

ALTER TABLE "BusinessImportApprovalGrant"
  ADD CONSTRAINT "BusinessImportApprovalGrant_value_check" CHECK (
    "candidateVersion" > 0
    AND "candidateValueHash" ~ '^[a-f0-9]{64}$'
    AND "decisionHash" ~ '^[a-f0-9]{64}$'
    AND length("requiredPermission") > 0
  );

ALTER TABLE "BusinessImportCandidateEvidence"
  ADD CONSTRAINT "BusinessImportEvidence_value_check" CHECK (
    "candidateVersion" > 0
    AND "importGeneration" > 0
    AND "candidateValueHash" ~ '^[a-f0-9]{64}$'
    AND "artifactSha256" ~ '^[a-f0-9]{64}$'
    AND "parsedManifestHash" ~ '^[a-f0-9]{64}$'
    AND "sourceValueHash" ~ '^[a-f0-9]{64}$'
    AND "excerptHash" ~ '^[a-f0-9]{64}$'
    AND "excerptObjectKind" = 'EVIDENCE_EXCERPT'
  );

ALTER TABLE "BusinessOfferingSourceBinding"
  ADD CONSTRAINT "BusinessOfferingBinding_value_check" CHECK (
    length("externalKey") > 0 AND "lastSeenSourceValueHash" ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE "BusinessImportApplication"
  ADD CONSTRAINT "BusinessImportApplication_revision_check" CHECK (
    "baseInformationRevision" >= 0
    AND "resultingInformationRevision" = "baseInformationRevision" + 1
    AND (
      ("baseInformationRevision" = 0 AND "baseBusinessRevisionId" IS NULL)
      OR ("baseInformationRevision" > 0 AND "baseBusinessRevisionId" IS NOT NULL)
    )
  ),
  ADD CONSTRAINT "BusinessImportApplication_hash_check" CHECK (
    "previewManifestHash" ~ '^[a-f0-9]{64}$'
    AND "candidateManifestHash" ~ '^[a-f0-9]{64}$'
    AND "idempotencyKeyHash" ~ '^[a-f0-9]{64}$'
    AND "baseInformationHash" ~ '^[a-f0-9]{64}$'
    AND "resultingInformationHash" ~ '^[a-f0-9]{64}$'
    AND ("projectionReceiptHash" IS NULL OR "projectionReceiptHash" ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT "BusinessImportApplication_kind_check" CHECK (
    ("kind" = 'APPLY' AND "revertOfApplicationId" IS NULL)
    OR ("kind" = 'REVERT' AND "revertOfApplicationId" IS NOT NULL)
  ),
  ADD CONSTRAINT "BusinessImportApplication_preview_check" CHECK (
    "previewObjectKind" = 'APPLICATION_PREVIEW'
  ),
  ADD CONSTRAINT "BusinessImportApplication_outbox_check" CHECK (
    "projectionOutboxId" IS NULL OR "projectionOutboxPrunedAt" IS NULL
  ),
  ADD CONSTRAINT "BusinessImportApplication_receipt_check" CHECK (
    (
      "projectionReceiptHash" IS NULL
      AND "projectedAt" IS NULL
      AND "state" IN ('COMMITTED', 'PROJECTING', 'PROJECTION_DELAYED')
    )
    OR (
      "projectionReceiptHash" IS NOT NULL
      AND "projectedAt" IS NOT NULL
      AND "state" IN ('READY', 'REVERTED', 'SUPERSEDED')
    )
  ),
  ADD CONSTRAINT "BusinessImportApplication_terminal_check" CHECK (
    ("state" <> 'REVERTED' OR "revertedAt" IS NOT NULL)
    AND ("state" <> 'SUPERSEDED' OR "supersededAt" IS NOT NULL)
  );

ALTER TABLE "BusinessImportApplicationCandidate"
  ADD CONSTRAINT "BusinessImportApplicationCandidate_value_check" CHECK (
    "candidateVersion" > 0
    AND "candidateValueHash" ~ '^[a-f0-9]{64}$'
    AND "action" NOT IN ('UNCHANGED', 'CONFLICT', 'INVALID', 'MISSING')
    AND (
      ("requiresApproval" AND length("requiredPermission") > 0 AND "approvalGrantId" IS NOT NULL)
      OR (NOT "requiresApproval" AND "requiredPermission" = '' AND "approvalGrantId" IS NULL)
    )
  );

ALTER TABLE "BusinessInformationProjectionReceipt"
  ADD CONSTRAINT "BusinessInformationProjectionReceipt_value_check" CHECK (
    "businessRevision" > 0
    AND "knowledgeDraftGeneration" > 0
    AND length("knowledgeTargetKey") > 0
    AND "businessRevisionHash" ~ '^[a-f0-9]{64}$'
    AND "knowledgeDraftManifestHash" ~ '^[a-f0-9]{64}$'
    AND "receiptHash" ~ '^[a-f0-9]{64}$'
    AND ("runtimeOutboxId" IS NULL OR "runtimeOutboxPrunedAt" IS NULL)
  );

ALTER TABLE "BusinessInformationAttribution"
  ADD CONSTRAINT "BusinessInformationAttribution_hash_check" CHECK (
    "currentValueHash" ~ '^[a-f0-9]{64}$'
    AND "businessRevisionHash" ~ '^[a-f0-9]{64}$'
    AND "businessRevision" > 0
    AND ("sourceValueHash" IS NULL OR "sourceValueHash" ~ '^[a-f0-9]{64}$')
    AND ("candidateValueHash" IS NULL OR "candidateValueHash" ~ '^[a-f0-9]{64}$')
    AND ("artifactSha256" IS NULL OR "artifactSha256" ~ '^[a-f0-9]{64}$')
    AND ("parsedManifestHash" IS NULL OR "parsedManifestHash" ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT "BusinessInformationAttribution_resource_check" CHECK (
    ("resourceType" = 'BUSINESS_IDENTITY' AND "identityId" IS NOT NULL AND "resourceKey" = "identityId" AND "offeringId" IS NULL AND "offeringPriceId" IS NULL AND "offeringDurationId" IS NULL)
    OR ("resourceType" = 'OFFERING' AND "identityId" IS NULL AND "offeringId" IS NOT NULL AND "resourceKey" = "offeringId" AND "offeringPriceId" IS NULL AND "offeringDurationId" IS NULL)
    OR ("resourceType" = 'OFFERING_PRICE' AND "identityId" IS NULL AND "offeringId" IS NULL AND "offeringPriceId" IS NOT NULL AND "resourceKey" = "offeringPriceId" AND "offeringDurationId" IS NULL)
    OR ("resourceType" = 'OFFERING_DURATION' AND "identityId" IS NULL AND "offeringId" IS NULL AND "offeringPriceId" IS NULL AND "offeringDurationId" IS NOT NULL AND "resourceKey" = "offeringDurationId")
  ),
  ADD CONSTRAINT "BusinessInformationAttribution_approval_check" CHECK (
    ("approvedByUserId" IS NULL) = ("approvedAt" IS NULL)
  ),
  ADD CONSTRAINT "BusinessInformationAttribution_provenance_check" CHECK (
    (
      "authority" = 'IMPORTED'
      AND "sourceId" IS NOT NULL
      AND "importId" IS NOT NULL
      AND "candidateId" IS NOT NULL
      AND "candidateVersion" > 0
      AND "candidateValueHash" IS NOT NULL
      AND "evidenceId" IS NOT NULL
      AND "artifactId" IS NOT NULL
      AND "artifactSha256" IS NOT NULL
      AND "importGeneration" > 0
      AND "parsedRevisionId" IS NOT NULL
      AND "parsedManifestHash" IS NOT NULL
      AND "applicationId" IS NOT NULL
      AND "sourceValueHash" IS NOT NULL
      AND "confidence" IS NOT NULL
      AND "parserVersion" IS NOT NULL
      AND "mapperVersion" IS NOT NULL
      AND "schemaVersion" IS NOT NULL
    )
    OR (
      "authority" <> 'IMPORTED'
      AND "sourceId" IS NULL
      AND "importId" IS NULL
      AND "candidateId" IS NULL
      AND "candidateVersion" IS NULL
      AND "candidateValueHash" IS NULL
      AND "evidenceId" IS NULL
      AND "artifactId" IS NULL
      AND "artifactSha256" IS NULL
      AND "importGeneration" IS NULL
      AND "parsedRevisionId" IS NULL
      AND "parsedManifestHash" IS NULL
      AND "applicationId" IS NULL
      AND "sourceValueHash" IS NULL
      AND "confidence" IS NULL
      AND "parserVersion" IS NULL
      AND "ocrVersion" IS NULL
      AND "mapperVersion" IS NULL
      AND "schemaVersion" IS NULL
      AND "modelVersion" IS NULL
      AND "promptVersion" IS NULL
    )
  );

ALTER TABLE "BusinessImportQuotaReservation"
  ADD CONSTRAINT "BusinessImportQuotaReservation_value_check" CHECK (
    "rawBytes" >= 0
    AND "expandedBytes" >= 0
    AND "sheetCount" >= 0
    AND "rowCount" >= 0
    AND "columnCount" >= 0
    AND "cellCount" >= 0
    AND "pdfPageCount" >= 0
    AND "ocrPageCount" >= 0
    AND "ocrPixels" >= 0
    AND "processorSeconds" >= 0
    AND "extractedCharacters" >= 0
    AND "candidateCount" >= 0
    AND "modelTokens" >= 0
    AND "retainedBytes" >= 0
  ),
  ADD CONSTRAINT "BusinessImportQuotaReservation_state_check" CHECK (
    ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL)
    OR ("status" IN ('RELEASED', 'EXPIRED') AND "releasedAt" IS NOT NULL)
    OR ("status" = 'RESERVED' AND "consumedAt" IS NULL AND "releasedAt" IS NULL)
  );

CREATE UNIQUE INDEX "BusinessInformationAttribution_current_field_key"
  ON "BusinessInformationAttribution"("tenantId", "resourceType", "resourceKey", "fieldPath")
  WHERE "supersededAt" IS NULL;

CREATE OR REPLACE FUNCTION "business_import_reject_immutable_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "BusinessInformationRevision_immutable"
BEFORE UPDATE OR DELETE ON "BusinessInformationRevision"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();

CREATE TRIGGER "BusinessImportParsedRevision_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportParsedRevision"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();

CREATE TRIGGER "BusinessImportCandidateRevision_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportCandidateRevision"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();

CREATE TRIGGER "BusinessImportApprovalGrant_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportApprovalGrant"
FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"();

CREATE OR REPLACE FUNCTION "business_import_object_ledger_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger is durable and cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId"
    OR NEW."id" <> OLD."id"
    OR NEW."objectKind" <> OLD."objectKind"
    OR NEW."objectStorageKey" <> OLD."objectStorageKey"
    OR NEW."encryptionKeyRef" <> OLD."encryptionKeyRef"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger object identity is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."retainUntil" IS NOT NULL
    AND (NEW."retainUntil" IS NULL OR NEW."retainUntil" < OLD."retainUntil")
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger retention cannot be shortened' USING ERRCODE = '23514';
  END IF;

  IF OLD."tombstoneReason" IS NOT NULL
    AND NEW."tombstoneReason" IS DISTINCT FROM OLD."tombstoneReason"
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger tombstone reason is immutable' USING ERRCODE = '23514';
  END IF;

  IF (OLD."tombstonedAt" IS NOT NULL AND NEW."tombstonedAt" IS DISTINCT FROM OLD."tombstonedAt")
    OR (OLD."deletionStartedAt" IS NOT NULL AND NEW."deletionStartedAt" IS DISTINCT FROM OLD."deletionStartedAt")
    OR (OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt")
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger lifecycle timestamps are immutable once recorded' USING ERRCODE = '23514';
  END IF;

  IF NEW."deletionState" <> OLD."deletionState" AND NOT (
    (OLD."deletionState" = 'RETAINED' AND NEW."deletionState" = 'TOMBSTONED')
    OR (OLD."deletionState" = 'TOMBSTONED' AND NEW."deletionState" = 'DELETING')
    OR (OLD."deletionState" = 'DELETING' AND NEW."deletionState" IN ('DELETED', 'FAILED'))
    OR (OLD."deletionState" = 'FAILED' AND NEW."deletionState" = 'DELETING')
  ) THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger deletion lifecycle cannot move backward or skip states' USING ERRCODE = '23514';
  END IF;

  IF NEW."legalHold" IS DISTINCT FROM OLD."legalHold"
    AND (OLD."deletionState" <> 'RETAINED' OR NEW."deletionState" <> 'RETAINED')
  THEN
    RAISE EXCEPTION 'BusinessImportObjectLedger legal hold can only change while retained' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportObjectLedger_identity_guard"
BEFORE UPDATE OR DELETE ON "BusinessImportObjectLedger"
FOR EACH ROW EXECUTE FUNCTION "business_import_object_ledger_identity_guard"();

CREATE OR REPLACE FUNCTION "business_import_mapping_lineage_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenantId" <> OLD."tenantId"
    OR NEW."sourceId" <> OLD."sourceId"
    OR NEW."tableKey" <> OLD."tableKey"
    OR NEW."targetCategory" <> OLD."targetCategory"
    OR NEW."revision" <> OLD."revision"
    OR NEW."supersedesMappingId" IS DISTINCT FROM OLD."supersedesMappingId"
    OR NEW."supersedesRevision" IS DISTINCT FROM OLD."supersedesRevision"
  THEN
    RAISE EXCEPTION 'BusinessImportMapping lineage is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportMapping_lineage_guard"
BEFORE UPDATE ON "BusinessImportMapping"
FOR EACH ROW EXECUTE FUNCTION "business_import_mapping_lineage_guard"();

CREATE OR REPLACE FUNCTION "business_import_parsed_revision_generation_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_generation INTEGER;
BEGIN
  SELECT "generation"
    INTO current_generation
  FROM "BusinessImport"
  WHERE "tenantId" = NEW."tenantId"
    AND "sourceId" = NEW."sourceId"
    AND "id" = NEW."importId"
    AND "artifactId" = NEW."artifactId"
    AND "artifactSha256" = NEW."artifactSha256"
  FOR UPDATE;

  IF current_generation IS NULL OR current_generation <> NEW."importGeneration" THEN
    RAISE EXCEPTION 'Parsed revision generation is stale' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportParsedRevision_generation_guard"
BEFORE INSERT ON "BusinessImportParsedRevision"
FOR EACH ROW EXECUTE FUNCTION "business_import_parsed_revision_generation_guard"();

CREATE OR REPLACE FUNCTION "business_import_approval_grant_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_record RECORD;
BEGIN
  SELECT
    "state",
    "decidedByUserId",
    "decidedAt",
    "candidateVersion",
    "candidateValueHash",
    "requiredPermission"
  INTO approval_record
  FROM "BusinessImportCandidateApproval"
  WHERE "tenantId" = NEW."tenantId"
    AND "sourceId" = NEW."sourceId"
    AND "importId" = NEW."importId"
    AND "candidateId" = NEW."candidateId"
    AND "id" = NEW."approvalId"
  FOR SHARE;

  IF approval_record IS NULL
    OR approval_record."state" <> 'APPROVED'
    OR approval_record."decidedByUserId" <> NEW."grantedByUserId"
    OR approval_record."decidedAt" <> NEW."grantedAt"
    OR approval_record."candidateVersion" <> NEW."candidateVersion"
    OR approval_record."candidateValueHash" <> NEW."candidateValueHash"
    OR approval_record."requiredPermission" <> NEW."requiredPermission"
  THEN
    RAISE EXCEPTION 'Approval grant requires an exact approved decision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportApprovalGrant_approval_guard"
BEFORE INSERT ON "BusinessImportApprovalGrant"
FOR EACH ROW EXECUTE FUNCTION "business_import_approval_grant_guard"();

CREATE OR REPLACE FUNCTION "business_import_projection_outbox_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."projectionOutboxId" IS NULL THEN
      IF NEW."projectionOutboxId" IS DISTINCT FROM OLD."projectionOutboxId"
        OR NEW."projectionOutboxDedupeKey" <> OLD."projectionOutboxDedupeKey"
        OR NEW."businessRevisionId" <> OLD."businessRevisionId"
        OR NEW."resultingInformationRevision" <> OLD."resultingInformationRevision"
        OR NEW."projectionOutboxPrunedAt" IS DISTINCT FROM OLD."projectionOutboxPrunedAt"
      THEN
        RAISE EXCEPTION 'Pruned projection outbox identity is immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW."projectionOutboxId" IS NULL THEN
      IF NEW."projectionOutboxDedupeKey" <> OLD."projectionOutboxDedupeKey"
        OR NEW."businessRevisionId" <> OLD."businessRevisionId"
        OR NEW."resultingInformationRevision" <> OLD."resultingInformationRevision"
      THEN
        RAISE EXCEPTION 'Projection outbox snapshot changed during pruning' USING ERRCODE = '23514';
      END IF;
      NEW."projectionOutboxPrunedAt" := COALESCE(NEW."projectionOutboxPrunedAt", CURRENT_TIMESTAMP);
      RETURN NEW;
    END IF;

    IF NEW."projectionOutboxId" <> OLD."projectionOutboxId"
      OR NEW."projectionOutboxDedupeKey" <> OLD."projectionOutboxDedupeKey"
      OR NEW."businessRevisionId" <> OLD."businessRevisionId"
      OR NEW."resultingInformationRevision" <> OLD."resultingInformationRevision"
      OR NEW."projectionOutboxPrunedAt" IS DISTINCT FROM OLD."projectionOutboxPrunedAt"
    THEN
      RAISE EXCEPTION 'Projection outbox identity is immutable after application commit' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."projectionOutboxId" IS NULL THEN
      RAISE EXCEPTION 'Projection outbox identity is required at application commit' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "RuntimeOutbox"
    WHERE "id" = NEW."projectionOutboxId"
      AND "tenantId" = NEW."tenantId"
      AND "dedupeKey" = NEW."projectionOutboxDedupeKey"
      AND "aggregateType" = 'BusinessInformationRevision'
      AND "aggregateId" = NEW."businessRevisionId"
      AND "aggregateVersion" = NEW."resultingInformationRevision"
  ) THEN
    RAISE EXCEPTION 'Projection outbox does not match the exact Business Information revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportApplication_projection_outbox_guard"
BEFORE INSERT OR UPDATE OF "projectionOutboxId", "projectionOutboxDedupeKey", "projectionOutboxPrunedAt", "businessRevisionId", "resultingInformationRevision"
ON "BusinessImportApplication"
FOR EACH ROW EXECUTE FUNCTION "business_import_projection_outbox_guard"();

CREATE OR REPLACE FUNCTION "business_information_projection_receipt_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  application_outbox_id TEXT;
BEGIN
  SELECT "projectionOutboxId"
    INTO application_outbox_id
  FROM "BusinessImportApplication"
  WHERE "tenantId" = NEW."tenantId"
    AND "sourceId" = NEW."sourceId"
    AND "importId" = NEW."importId"
    AND "id" = NEW."applicationId"
    AND "businessRevisionId" = NEW."businessRevisionId"
    AND "resultingInformationRevision" = NEW."businessRevision"
    AND "resultingInformationHash" = NEW."businessRevisionHash"
    AND "projectionOutboxDedupeKey" = NEW."runtimeOutboxDedupeKey"
  FOR KEY SHARE;

  IF application_outbox_id IS NULL
    OR NEW."runtimeOutboxId" IS NULL
    OR application_outbox_id <> NEW."runtimeOutboxId"
    OR NOT EXISTS (
      SELECT 1
      FROM "RuntimeOutbox"
      WHERE "id" = NEW."runtimeOutboxId"
        AND "tenantId" = NEW."tenantId"
        AND "dedupeKey" = NEW."runtimeOutboxDedupeKey"
        AND "aggregateType" = 'BusinessInformationRevision'
        AND "aggregateId" = NEW."businessRevisionId"
        AND "aggregateVersion" = NEW."businessRevision"
    )
  THEN
    RAISE EXCEPTION 'Projection receipt does not match its application and outbox' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessInformationProjectionReceipt_exact_guard"
BEFORE INSERT ON "BusinessInformationProjectionReceipt"
FOR EACH ROW EXECUTE FUNCTION "business_information_projection_receipt_guard"();

CREATE OR REPLACE FUNCTION "business_information_projection_receipt_immutable_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BusinessInformationProjectionReceipt is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."runtimeOutboxId" IS NOT NULL
    AND NEW."runtimeOutboxId" IS NULL
    AND (to_jsonb(NEW) - 'runtimeOutboxId' - 'runtimeOutboxPrunedAt')
      = (to_jsonb(OLD) - 'runtimeOutboxId' - 'runtimeOutboxPrunedAt')
  THEN
    NEW."runtimeOutboxPrunedAt" := COALESCE(NEW."runtimeOutboxPrunedAt", CURRENT_TIMESTAMP);
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BusinessInformationProjectionReceipt is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "BusinessInformationProjectionReceipt_immutable"
BEFORE UPDATE OR DELETE ON "BusinessInformationProjectionReceipt"
FOR EACH ROW EXECUTE FUNCTION "business_information_projection_receipt_immutable_guard"();

CREATE OR REPLACE FUNCTION "business_import_application_ready_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" IN ('READY', 'REVERTED', 'SUPERSEDED') AND NOT EXISTS (
    SELECT 1
    FROM "BusinessInformationProjectionReceipt"
    WHERE "tenantId" = NEW."tenantId"
      AND "sourceId" = NEW."sourceId"
      AND "importId" = NEW."importId"
      AND "applicationId" = NEW."id"
      AND "businessRevisionId" = NEW."businessRevisionId"
      AND "businessRevision" = NEW."resultingInformationRevision"
      AND "businessRevisionHash" = NEW."resultingInformationHash"
      AND "runtimeOutboxDedupeKey" = NEW."projectionOutboxDedupeKey"
      AND "receiptHash" = NEW."projectionReceiptHash"
  ) THEN
    RAISE EXCEPTION 'Ready application requires an exact durable projection receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportApplication_ready_guard"
BEFORE INSERT OR UPDATE ON "BusinessImportApplication"
FOR EACH ROW EXECUTE FUNCTION "business_import_application_ready_guard"();

CREATE OR REPLACE FUNCTION "business_import_applied_projection_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" IN ('APPLIED', 'PARTIALLY_APPLIED') AND NOT EXISTS (
    SELECT 1
    FROM "BusinessImportApplication" application_record
    INNER JOIN "BusinessInformationProjectionReceipt" receipt
      ON receipt."tenantId" = application_record."tenantId"
      AND receipt."sourceId" = application_record."sourceId"
      AND receipt."importId" = application_record."importId"
      AND receipt."applicationId" = application_record."id"
      AND receipt."businessRevisionId" = application_record."businessRevisionId"
      AND receipt."businessRevision" = application_record."resultingInformationRevision"
      AND receipt."businessRevisionHash" = application_record."resultingInformationHash"
      AND receipt."receiptHash" = application_record."projectionReceiptHash"
    WHERE application_record."tenantId" = NEW."tenantId"
      AND application_record."sourceId" = NEW."sourceId"
      AND application_record."importId" = NEW."id"
      AND application_record."state" = 'READY'
  ) THEN
    RAISE EXCEPTION 'Applied import requires a ready application with an exact projection receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImport_applied_projection_guard"
BEFORE INSERT OR UPDATE ON "BusinessImport"
FOR EACH ROW EXECUTE FUNCTION "business_import_applied_projection_guard"();

COMMIT;
