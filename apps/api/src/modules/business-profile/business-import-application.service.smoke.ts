import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HttpException } from "@nestjs/common";
import {
  BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS,
  businessImportEvidenceRecordHash,
  businessOfferingValueHash,
  parseBusinessServicesCsv,
} from "@leadvirt/business-import";
import { PrismaClient } from "@leadvirt/db";
import type { Prisma } from "@leadvirt/db";
import type { BusinessImportOfferingValue } from "@leadvirt/types";
import type { KnowledgeObjectStore } from "@leadvirt/knowledge";
import type { RequestContext } from "../../common/request-context.js";
import type { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { businessImportEtag, businessInformationEtag } from "./business-import-http.js";
import {
  BusinessImportApplicationService,
  businessImportPriceEffectiveWindowIsValid,
  businessImportReplacementRemovalKind,
  businessImportReplaceSelectionIssue,
} from "./business-import-application.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

const root = resolve(import.meta.dirname, "../../../../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_apply_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

assert.equal(
  businessImportPriceEffectiveWindowIsValid({
    validFrom: "2026-08-01",
    validUntil: "2026-08-15",
    approvalGrantedAt: "2026-07-21T16:59:00.000Z",
  }),
  true,
);
assert.equal(
  businessImportPriceEffectiveWindowIsValid({
    validFrom: "2027-01-01",
    validUntil: null,
    approvalGrantedAt: "2026-07-21T16:59:00.000Z",
  }),
  false,
);
assert.equal(
  businessImportPriceEffectiveWindowIsValid({
    validFrom: "2026-08-01",
    validUntil: "2026-08-01",
    approvalGrantedAt: null,
  }),
  false,
);

function command(args: string[], env: NodeJS.ProcessEnv) {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")] : args;
  return new Promise<{ status: number | null; output: string }>((resolveCommand, rejectCommand) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (status) => resolveCommand({ status, output }));
  });
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : null;
}

function valueHash(value: BusinessImportOfferingValue) {
  return businessOfferingValueHash({
    sourceRow: 0,
    externalId: value.externalId ?? null,
    category: value.category ?? null,
    name: value.name,
    description: value.description ?? null,
    price: value.price
      ? {
          type: value.price.type,
          amount: value.price.amount ?? null,
          from: value.price.from ?? null,
          to: value.price.to ?? null,
          currency: value.price.currency ?? null,
          unit: value.price.unit ?? null,
          taxNote: value.price.taxNote ?? null,
        }
      : null,
    duration: value.duration
      ? {
          minimumMinutes: value.duration.minimumMinutes,
          maximumMinutes: value.duration.maximumMinutes ?? null,
        }
      : null,
    locationExternalId: value.locationExternalId ?? null,
    bookingNotes: value.bookingNotes ?? null,
    active: value.active,
    validFrom: value.validFrom ?? null,
    validUntil: value.validUntil ?? null,
    language: value.language ?? null,
    evidence: {},
    diagnostics: [],
    valid: true,
  });
}

type StoredOffering = Prisma.BusinessOfferingGetPayload<{
  include: { prices: true; duration: true; sourceBindings: true };
}>;

function storedOfferingValue(offering: StoredOffering, sourceId: string) {
  const price = [...offering.prices].sort((left, right) => {
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    return created || left.id.localeCompare(right.id);
  })[0];
  const binding = offering.sourceBindings.find((item) => item.sourceId === sourceId && item.active);
  const date = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? null;
  return {
    externalId: binding?.externalKey ?? null,
    category: offering.category,
    name: offering.name,
    description: offering.description,
    price: price
      ? {
          type: price.type,
          amount: price.amount?.toString() ?? null,
          from: price.amountFrom?.toString() ?? null,
          to: price.amountTo?.toString() ?? null,
          currency: price.currency,
          unit: price.unit,
          taxNote: price.taxNote,
        }
      : null,
    duration: offering.duration
      ? {
          minimumMinutes: offering.duration.minimumMinutes,
          maximumMinutes: offering.duration.maximumMinutes,
        }
      : null,
    locationExternalId: null,
    bookingNotes: offering.bookingNotes,
    active: offering.active,
    validFrom: date(price?.effectiveFrom),
    validUntil: date(price?.effectiveUntil),
    language: offering.locale,
  } satisfies BusinessImportOfferingValue;
}

function runtimeConfig(objectRoot: string) {
  return {
    businessImportEnabled: true,
    businessImportMaxFileBytes: 10 * 1024 * 1024,
    businessImportUploadTtlSeconds: 600,
    businessImportMaxPendingPerTenant: 5,
    businessImportParserApproved: false,
    businessImportParserUrl: undefined,
    businessImportParserVersion: "smoke-parser-v1",
    businessImportParserTimeoutMs: 5_000,
    knowledgeObjectStorePath: objectRoot,
    knowledgeArtifactEncryptionKey: randomBytes(32).toString("base64"),
    knowledgeArtifactEncryptionKeyId: "smoke-key-v1",
    knowledgeFileUploadStreamTimeoutMs: 5_000,
    knowledgeFileScannerHost: "127.0.0.1",
    knowledgeFileScannerApproved: true,
    knowledgeFileScannerPort: 3310,
    knowledgeFileScannerVersion: "smoke-clamav-v1",
    knowledgeFileScannerTimeoutMs: 5_000,
  } as unknown as AppConfigService;
}

async function fixture(
  prisma: PrismaService,
  informationState: BusinessInformationStateService,
  store: KnowledgeObjectStore,
) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const sourceId = randomUUID();
  const importId = randomUUID();
  const artifactId = randomUUID();
  const parsedRevisionId = randomUUID();
  const artifactHash = randomBytes(32).toString("hex");
  const manifestHash = randomBytes(32).toString("hex");
  await prisma.tenant.create({
    data: { id: tenantId, name: "Application smoke", slug: `application-smoke-${tenantId}` },
  });
  const user = await prisma.user.create({
    data: { id: userId, email: `${userId}@example.test`, name: "Smoke owner" },
  });
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const context: RequestContext = {
    tenantId,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user,
  };
  const state = await informationState.get(context);
  await prisma.businessIdentity.create({
    data: {
      tenantId,
      displayName: tenant.name,
      defaultLocale: "en",
      timezone: "UTC",
      defaultCurrency: "USD",
    },
  });
  await prisma.businessImportSource.create({
    data: {
      id: sourceId,
      tenantId,
      lineageKey: `smoke-${sourceId}`,
      displayName: "Smoke source",
      createdByUserId: userId,
    },
  });
  const rawLedger = await prisma.businessImportObjectLedger.create({
    data: {
      tenantId,
      objectKind: "RAW_ARTIFACT",
      objectStorageKey: `smoke/${artifactId}/raw`,
      encryptionKeyRef: "smoke-key-v1",
      retentionClass: "SMOKE",
    },
  });
  const parsedLedger = await prisma.businessImportObjectLedger.create({
    data: {
      tenantId,
      objectKind: "PARSED_MANIFEST",
      objectStorageKey: `smoke/${artifactId}/manifest`,
      encryptionKeyRef: "smoke-key-v1",
      retentionClass: "SMOKE",
    },
  });
  await prisma.businessImportArtifact.create({
    data: {
      id: artifactId,
      tenantId,
      sourceId,
      objectStorageKey: rawLedger.objectStorageKey,
      encryptionKeyRef: rawLedger.encryptionKeyRef,
      objectLedgerId: rawLedger.id,
      sha256: artifactHash,
      byteSize: 128n,
      declaredMimeType: "text/csv",
      originalFilename: "services.csv",
      malwareStatus: "CLEAN",
      mimeValidationStatus: "VALID",
      scannedAt: new Date(),
    },
  });
  await prisma.businessImport.create({
    data: {
      id: importId,
      tenantId,
      sourceId,
      purpose: "SERVICES",
      format: "CSV",
      state: "PARSING",
      displayName: "Smoke services",
      originalFilename: "services.csv",
      declaredMimeType: "text/csv",
      expectedByteSize: 128n,
      uploadTokenHash: randomBytes(32).toString("hex"),
      artifactId,
      artifactSha256: artifactHash,
      baseBusinessRevisionId: state.currentRevisionId,
      baseInformationRevision: state.revision,
      baseInformationHash: state.canonicalHash,
      selectedCategories: ["OFFERINGS"],
      schemaVersion: "leadvirt.services.v1",
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      createdByUserId: userId,
    },
  });
  await prisma.businessImportParsedRevision.create({
    data: {
      id: parsedRevisionId,
      tenantId,
      sourceId,
      importId,
      importGeneration: 1,
      artifactId,
      artifactSha256: artifactHash,
      manifestObjectLedgerId: parsedLedger.id,
      manifestObjectKey: parsedLedger.objectStorageKey,
      manifestEncryptionKeyRef: parsedLedger.encryptionKeyRef,
      manifestHash,
      parserVersion: "smoke-parser-v1",
      mapperVersion: "smoke-mapper-v1",
      schemaVersion: "leadvirt.services.v1",
      extractionContractVersion: "smoke-extraction-v1",
    },
  });
  await prisma.businessImport.update({
    where: { id: importId },
    data: {
      state: "READY_FOR_REVIEW",
      parsedRevisionId,
      parsedManifestObjectKey: parsedLedger.objectStorageKey,
      parsedManifestEncryptionKeyRef: parsedLedger.encryptionKeyRef,
      parsedManifestObjectLedgerId: parsedLedger.id,
      parsedManifestObjectKind: "PARSED_MANIFEST",
      parsedManifestHash: manifestHash,
      parserVersion: "smoke-parser-v1",
      mapperVersion: "smoke-mapper-v1",
      reviewReadyAt: new Date(),
    },
  });

  const parsedPrices = await parseBusinessServicesCsv(
    new TextEncoder().encode(
      [
        "name,price_type,price_amount,price_from,price_to,currency",
        "Fixed,FIXED,10,,,EUR",
        "From,FROM,,20,,EUR",
        "Range,RANGE,,30,40,EUR",
        "Free,FREE,,,,",
        "On request,ON_REQUEST,,,,",
      ].join("\n"),
    ),
  );
  assert.equal(parsedPrices.counts.invalidRows, 0);

  async function candidate(
    name: string,
    risk: "LOW" | "HIGH",
    price: BusinessImportOfferingValue["price"] = {
      type: "FIXED",
      amount: "100.00",
      from: null,
      to: null,
      currency: "USD",
      unit: "session",
      taxNote: null,
    },
    evidenceState: "VALID" | "INVALID_RECORD" | "EXPIRED" = "VALID",
    options: {
      action?: "ADD" | "LINK";
      targetOfferingId?: string;
      externalId?: string;
      currentFingerprint?: string;
      validFrom?: string;
      validUntil?: string;
    } = {},
  ) {
    const id = randomUUID();
    const normalized: BusinessImportOfferingValue = {
      externalId: options.externalId ?? `service-${name.toLowerCase()}`,
      category: "Consulting",
      name,
      description: `${name} description`,
      price,
      duration: { minimumMinutes: 60, maximumMinutes: 90 },
      locationExternalId: null,
      bookingNotes: null,
      active: true,
      validFrom: options.validFrom ?? null,
      validUntil: options.validUntil ?? null,
      language: "en",
    };
    const normalizedHash = valueHash(normalized);
    const evidenceId = randomUUID();
    const fieldProvenance = Object.fromEntries(
      BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [
        path,
        path === "/name"
          ? { authority: "IMPORTED", evidenceId }
          : path === "/description" || path.startsWith("/price/") || path.startsWith("/duration/")
            ? { authority: "MANUAL" }
            : { authority: "SYSTEM" },
      ]),
    ) as Prisma.InputJsonObject;
    const requiresApproval = risk === "HIGH";
    const requiredPermission = requiresApproval ? "business_information.approve_high_risk" : "";
    await prisma.businessImportCandidate.create({
      data: {
        id,
        tenantId,
        sourceId,
        importId,
        candidateKey: randomBytes(32).toString("hex"),
        targetCategory: "OFFERINGS",
        semanticTargetKey: `offering:${id}`,
        action: options.action ?? "ADD",
        normalizedValue: normalized as unknown as Prisma.InputJsonObject,
        normalizedValueHash: normalizedHash,
        targetOfferingId: options.targetOfferingId ?? null,
        currentFingerprint: options.currentFingerprint ?? null,
        risk,
        confidence: "HIGH",
        decision: "ACCEPTED",
        requiresApproval,
        requiredPermission,
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    await prisma.businessImportCandidateRevision.create({
      data: {
        tenantId,
        sourceId,
        importId,
        candidateId: id,
        version: 1,
        parsedRevisionId,
        importGeneration: 1,
        artifactId,
        artifactSha256: artifactHash,
        parsedManifestHash: manifestHash,
        targetCategory: "OFFERINGS",
        semanticTargetKey: `offering:${id}`,
        action: options.action ?? "ADD",
        normalizedValue: normalized as unknown as Prisma.InputJsonObject,
        normalizedValueHash: normalizedHash,
        targetOfferingId: options.targetOfferingId ?? null,
        currentFingerprint: options.currentFingerprint ?? null,
        fieldProvenance,
        risk,
        confidence: "HIGH",
        requiresApproval,
        requiredPermission,
      },
    });
    const evidenceBytes = new TextEncoder().encode(name);
    const evidenceHash = createHash("sha256").update(evidenceBytes).digest("hex");
    const evidenceObjectKey = `smoke/${artifactId}/evidence/${id}`;
    const evidenceWrite = await store.put(evidenceObjectKey, evidenceBytes);
    const ledgerCreatedAt =
      evidenceState === "EXPIRED" ? new Date(Date.now() - 2 * 60 * 60_000) : new Date();
    const evidenceLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "EVIDENCE_EXCERPT",
        objectStorageKey: evidenceObjectKey,
        encryptionKeyRef: evidenceWrite.encryptionKeyRef,
        retentionClass: "SMOKE",
        retainUntil:
          evidenceState === "EXPIRED"
            ? new Date(Date.now() - 60 * 60_000)
            : new Date(Date.now() + 24 * 60 * 60_000),
        createdAt: ledgerCreatedAt,
      },
    });
    const evidenceRecord = {
      id: evidenceId,
      tenantId,
      sourceId,
      importId,
      candidateId: id,
      candidateVersion: 1,
      candidateValueHash: normalizedHash,
      artifactId,
      artifactSha256: artifactHash,
      importGeneration: 1,
      parsedRevisionId,
      parsedManifestHash: manifestHash,
      semanticElementId: null,
      semanticTableId: null,
      locator: { row: 2, field: "name" },
      sourceValueHash: evidenceHash,
      excerptHash: evidenceHash,
      excerptObjectKey: evidenceLedger.objectStorageKey,
      excerptEncryptionKeyRef: evidenceLedger.encryptionKeyRef,
      excerptObjectLedgerId: evidenceLedger.id,
      excerptObjectKind: "EVIDENCE_EXCERPT" as const,
      parserVersion: "smoke-parser-v1",
      ocrVersion: null,
      extractionContractVersion: "smoke-extraction-v1",
    };
    await prisma.businessImportCandidateEvidence.create({
      data: {
        ...evidenceRecord,
        evidenceRecordHash:
          evidenceState === "INVALID_RECORD"
            ? "0".repeat(64)
            : businessImportEvidenceRecordHash(evidenceRecord),
      },
    });
    return {
      id,
      normalizedHash,
      requiredPermission,
      evidenceId,
      evidenceObjectKey,
    };
  }

  const priceCandidates = await Promise.all(
    parsedPrices.rows.map((row) => {
      assert(row.price);
      return candidate(row.name, "LOW", row.price);
    }),
  );
  const linkOffering = await prisma.businessOffering.create({
    data: {
      tenantId,
      category: "Consulting",
      name: "Existing linked service",
      description: "Existing linked service description",
      locale: "en",
      active: true,
      prices: {
        create: {
          type: "FIXED",
          amount: "75.00",
          currency: "USD",
          unit: "session",
        },
      },
      duration: { create: { minimumMinutes: 60, maximumMinutes: 90 } },
    },
    include: { prices: true, duration: true },
  });
  const linkValue: BusinessImportOfferingValue = {
    externalId: "catalog-existing-linked-service",
    category: linkOffering.category,
    name: linkOffering.name,
    description: linkOffering.description,
    price: {
      type: "FIXED",
      amount: "75.00",
      from: null,
      to: null,
      currency: "USD",
      unit: "session",
      taxNote: null,
    },
    duration: { minimumMinutes: 60, maximumMinutes: 90 },
    locationExternalId: null,
    bookingNotes: null,
    active: true,
    validFrom: null,
    validUntil: null,
    language: "en",
  };
  const link = await candidate(linkValue.name, "HIGH", linkValue.price, "VALID", {
    action: "LINK",
    targetOfferingId: linkOffering.id,
    externalId: linkValue.externalId!,
    currentFingerprint: valueHash({ ...linkValue, externalId: null }),
  });
  const futurePrice = await candidate("Future priced service", "HIGH", undefined, "VALID", {
    validFrom: "2027-01-01",
  });
  const duplicateExternal = await candidate("Duplicate external key", "LOW", null, "VALID", {
    externalId: "SERVICE-FIXED",
  });
  const low = priceCandidates[0]!;
  const high = await candidate("Regulated advice", "HIGH");
  const invalidEvidence = await candidate("Invalid evidence", "LOW", undefined, "INVALID_RECORD");
  const expiredEvidence = await candidate("Expired evidence", "LOW", undefined, "EXPIRED");
  const unavailableEvidence = await candidate("Unavailable evidence", "LOW");
  const applyUnavailableEvidence = await candidate("Apply unavailable evidence", "LOW");
  const decisionAt = new Date();
  const approval = await prisma.businessImportCandidateApproval.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: high.id,
      candidateVersion: 1,
      candidateValueHash: high.normalizedHash,
      requiresApproval: true,
      requiredPermission: high.requiredPermission,
      riskReason: "HIGH",
      requestedByUserId: userId,
    },
  });
  await prisma.businessImportCandidateApproval.update({
    where: { id: approval.id },
    data: {
      state: "APPROVED",
      decidedByUserId: userId,
      decidedAt: decisionAt,
      etag: { increment: 1 },
    },
  });
  await prisma.businessImportApprovalGrant.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: high.id,
      candidateVersion: 1,
      candidateValueHash: high.normalizedHash,
      requiredPermission: high.requiredPermission,
      approvalId: approval.id,
      grantedByUserId: userId,
      grantedAt: decisionAt,
      decisionHash: randomBytes(32).toString("hex"),
    },
  });
  await prisma.businessImportCandidateApproval.update({
    where: { id: approval.id },
    data: {
      state: "INVALIDATED",
      invalidatedAt: new Date(),
      etag: { increment: 1 },
    },
  });
  const linkDecisionAt = new Date(decisionAt.getTime() + 1_000);
  const linkApproval = await prisma.businessImportCandidateApproval.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: link.id,
      candidateVersion: 1,
      candidateValueHash: link.normalizedHash,
      requiresApproval: true,
      requiredPermission: link.requiredPermission,
      riskReason: "HIGH",
      state: "APPROVED",
      requestedByUserId: userId,
      decidedByUserId: userId,
      decidedAt: linkDecisionAt,
    },
  });
  const linkApprovalGrant = await prisma.businessImportApprovalGrant.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: link.id,
      candidateVersion: 1,
      candidateValueHash: link.normalizedHash,
      requiredPermission: link.requiredPermission,
      approvalId: linkApproval.id,
      grantedByUserId: userId,
      grantedAt: linkDecisionAt,
      decisionHash: randomBytes(32).toString("hex"),
    },
  });
  const futureDecisionAt = new Date(decisionAt.getTime() + 2_000);
  const futureApproval = await prisma.businessImportCandidateApproval.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: futurePrice.id,
      candidateVersion: 1,
      candidateValueHash: futurePrice.normalizedHash,
      requiresApproval: true,
      requiredPermission: futurePrice.requiredPermission,
      riskReason: "HIGH",
      state: "APPROVED",
      requestedByUserId: userId,
      decidedByUserId: userId,
      decidedAt: futureDecisionAt,
    },
  });
  await prisma.businessImportApprovalGrant.create({
    data: {
      tenantId,
      sourceId,
      importId,
      candidateId: futurePrice.id,
      candidateVersion: 1,
      candidateValueHash: futurePrice.normalizedHash,
      requiredPermission: futurePrice.requiredPermission,
      approvalId: futureApproval.id,
      grantedByUserId: userId,
      grantedAt: futureDecisionAt,
      decisionHash: randomBytes(32).toString("hex"),
    },
  });
  return {
    context,
    importId,
    low,
    high,
    invalidEvidence,
    expiredEvidence,
    unavailableEvidence,
    applyUnavailableEvidence,
    priceCandidates,
    link,
    linkApprovalGrant,
    futurePrice,
    linkOffering,
    duplicateExternal,
    state,
  };
}

async function manualFieldReplacementFixture(
  prisma: PrismaService,
  context: RequestContext,
  originalImportId: string,
) {
  const state = await prisma.businessInformationState.findUniqueOrThrow({
    where: { tenantId: context.tenantId },
  });
  const originalImport = await prisma.businessImport.findUniqueOrThrow({
    where: { id: originalImportId },
  });
  assert(originalImport.artifactId);
  assert(originalImport.artifactSha256);
  await prisma.businessImport.update({
    where: { id: originalImportId },
    data: { state: "PROJECTION_DELAYED" },
  });
  const manualDescription = await prisma.businessInformationAttribution.findFirstOrThrow({
    where: {
      tenantId: context.tenantId,
      authority: "MANUAL",
      fieldPath: "/description",
      supersededAt: null,
    },
    orderBy: { offeringId: "asc" },
  });
  assert(manualDescription.offeringId);
  const targetOfferingId = manualDescription.offeringId;
  const activeBindings = await prisma.businessOfferingSourceBinding.findMany({
    where: { tenantId: context.tenantId, active: true },
    select: { offeringId: true },
    orderBy: { offeringId: "asc" },
  });
  const offeringIds = [...new Set(activeBindings.map((binding) => binding.offeringId))];
  const offerings = await prisma.businessOffering.findMany({
    where: { tenantId: context.tenantId, id: { in: offeringIds } },
    include: { prices: true, duration: true, sourceBindings: true },
    orderBy: { id: "asc" },
  });
  assert.equal(offerings.length, offeringIds.length);
  const target = offerings.find((offering) => offering.id === targetOfferingId);
  assert(target);
  const manualDescriptionValue = target.description;
  const replacementName = `${target.name} replacement`;
  const manualPrice = target.prices[0];
  assert(manualPrice);
  assert(target.duration);
  const replacementImportId = randomUUID();
  const parsedRevisionId = randomUUID();
  const parsedManifestHash = randomBytes(32).toString("hex");
  const parsedLedger = await prisma.businessImportObjectLedger.create({
    data: {
      tenantId: context.tenantId,
      objectKind: "PARSED_MANIFEST",
      objectStorageKey: `smoke/${replacementImportId}/manifest`,
      encryptionKeyRef: "smoke-key-v1",
      retentionClass: "SMOKE",
    },
  });
  await prisma.businessImport.create({
    data: {
      id: replacementImportId,
      tenantId: context.tenantId,
      sourceId: originalImport.sourceId,
      purpose: "SERVICES",
      catalogMode: "REPLACE",
      format: "CSV",
      state: "PARSING",
      displayName: "Manual ownership replacement",
      originalFilename: "renamed-services.csv",
      declaredMimeType: "text/csv",
      expectedByteSize: 128n,
      uploadTokenHash: randomBytes(32).toString("hex"),
      artifactId: originalImport.artifactId,
      artifactSha256: originalImport.artifactSha256,
      baseBusinessRevisionId: state.currentRevisionId,
      baseInformationRevision: state.revision,
      baseInformationHash: state.canonicalHash,
      selectedCategories: ["OFFERINGS"],
      schemaVersion: "leadvirt.services.v1",
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      createdByUserId: context.userId,
    },
  });
  await prisma.businessImportParsedRevision.create({
    data: {
      id: parsedRevisionId,
      tenantId: context.tenantId,
      sourceId: originalImport.sourceId,
      importId: replacementImportId,
      importGeneration: 1,
      artifactId: originalImport.artifactId,
      artifactSha256: originalImport.artifactSha256,
      manifestObjectLedgerId: parsedLedger.id,
      manifestObjectKey: parsedLedger.objectStorageKey,
      manifestEncryptionKeyRef: parsedLedger.encryptionKeyRef,
      manifestHash: parsedManifestHash,
      parserVersion: "smoke-parser-v1",
      mapperVersion: "smoke-mapper-v1",
      schemaVersion: "leadvirt.services.v1",
      extractionContractVersion: "smoke-extraction-v1",
    },
  });
  await prisma.businessImport.update({
    where: { id: replacementImportId },
    data: {
      state: "READY_FOR_REVIEW",
      parsedRevisionId,
      parsedManifestObjectKey: parsedLedger.objectStorageKey,
      parsedManifestEncryptionKeyRef: parsedLedger.encryptionKeyRef,
      parsedManifestObjectLedgerId: parsedLedger.id,
      parsedManifestObjectKind: "PARSED_MANIFEST",
      parsedManifestHash,
      parserVersion: "smoke-parser-v1",
      mapperVersion: "smoke-mapper-v1",
      reviewReadyAt: new Date(),
    },
  });
  await prisma.businessImportSource.update({
    where: { id: originalImport.sourceId },
    data: { latestImportId: replacementImportId, etag: { increment: 1 } },
  });
  const fieldProvenance = Object.fromEntries(
    BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [path, { authority: "SYSTEM" }]),
  ) as Prisma.InputJsonObject;
  let updateCandidateId = "";
  for (const offering of offerings) {
    const currentValue = storedOfferingValue(offering, originalImport.sourceId);
    const normalizedValue =
      offering.id === targetOfferingId
        ? {
            ...currentValue,
            name: replacementName,
            description: "Replacement file must not overwrite this manual field",
            price: null,
            duration: null,
            validFrom: null,
            validUntil: null,
          }
        : currentValue;
    const normalizedValueHash = valueHash(normalizedValue);
    const candidateId = randomUUID();
    const action = offering.id === targetOfferingId ? "UPDATE" : "UNCHANGED";
    await prisma.businessImportCandidate.create({
      data: {
        id: candidateId,
        tenantId: context.tenantId,
        sourceId: originalImport.sourceId,
        importId: replacementImportId,
        candidateKey: randomBytes(32).toString("hex"),
        targetCategory: "OFFERINGS",
        semanticTargetKey: `offering:${offering.id}`,
        action,
        normalizedValue,
        normalizedValueHash,
        targetOfferingId: offering.id,
        currentFingerprint: valueHash(currentValue),
        risk: "LOW",
        confidence: "HIGH",
        decision: action === "UPDATE" ? "ACCEPTED" : "PENDING",
        requiresApproval: false,
        requiredPermission: "",
        ...(action === "UPDATE" ? { decidedByUserId: context.userId, decidedAt: new Date() } : {}),
      },
    });
    if (action !== "UPDATE") continue;
    updateCandidateId = candidateId;
    await prisma.businessImportCandidateRevision.create({
      data: {
        tenantId: context.tenantId,
        sourceId: originalImport.sourceId,
        importId: replacementImportId,
        candidateId,
        version: 1,
        parsedRevisionId,
        importGeneration: 1,
        artifactId: originalImport.artifactId,
        artifactSha256: originalImport.artifactSha256,
        parsedManifestHash,
        targetCategory: "OFFERINGS",
        semanticTargetKey: `offering:${offering.id}`,
        action: "UPDATE",
        normalizedValue,
        normalizedValueHash,
        fieldProvenance,
        targetOfferingId: offering.id,
        currentFingerprint: valueHash(currentValue),
        risk: "LOW",
        confidence: "HIGH",
        requiresApproval: false,
        requiredPermission: "",
      },
    });
  }
  assert(updateCandidateId);
  return {
    importId: replacementImportId,
    importMatch: businessImportEtag(replacementImportId, 1),
    informationMatch: businessInformationEtag(context.tenantId, state.etag),
    targetOfferingId,
    updateCandidateId,
    manualDescriptionValue,
    replacementName,
    manualPrice: {
      amount: manualPrice.amount?.toString() ?? null,
      rowVersion: manualPrice.rowVersion,
    },
    manualDuration: {
      minimumMinutes: target.duration.minimumMinutes,
      maximumMinutes: target.duration.maximumMinutes,
      rowVersion: target.duration.rowVersion,
    },
  };
}

async function main() {
  assert.equal(businessImportReplacementRemovalKind(false), "ARCHIVE");
  assert.equal(businessImportReplacementRemovalKind(true), "UNLINK");
  assert.equal(
    businessImportReplaceSelectionIssue({
      catalogMode: "ADD",
      candidates: [],
      selectedCandidateIds: [],
      activeReplacementOfferingIds: [],
    }),
    null,
  );
  assert.equal(
    businessImportReplaceSelectionIssue({
      catalogMode: "REPLACE",
      candidates: [
        {
          id: "candidate-add",
          action: "ADD",
          decision: "ACCEPTED",
          targetOfferingId: null,
        },
      ],
      selectedCandidateIds: [],
      activeReplacementOfferingIds: [],
    })?.code,
    "BUSINESS_IMPORT_REPLACE_SELECTION_INCOMPLETE",
  );
  assert.equal(
    businessImportReplaceSelectionIssue({
      catalogMode: "REPLACE",
      candidates: [
        {
          id: "candidate-unchanged",
          action: "UNCHANGED",
          decision: "PENDING",
          targetOfferingId: "offering-covered",
        },
      ],
      selectedCandidateIds: [],
      activeReplacementOfferingIds: ["offering-covered"],
    }),
    null,
  );
  const maintenance = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-apply-smoke-"));
  let prisma: PrismaService | null = null;
  let failure: unknown;
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const migrated = await command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
      DATABASE_URL: smokeUrl.toString(),
    });
    assert.equal(migrated.status, 0, migrated.output);
    process.env.DATABASE_URL = smokeUrl.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    const runtime = new BusinessImportRuntimeService(runtimeConfig(objectRoot));
    const stateService = new BusinessInformationStateService(prisma);
    const service = new BusinessImportApplicationService(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
      runtime,
      stateService,
    );
    const views = new BusinessImportViewService(prisma, runtime);
    const runtimeStore = runtime.runtime().store;
    const fixtureData = await fixture(prisma, stateService, runtimeStore);
    const importMatch = businessImportEtag(fixtureData.importId, 1);
    const informationMatch = businessInformationEtag(
      fixtureData.context.tenantId,
      fixtureData.state.etag,
    );
    await prisma.businessImport.update({
      where: { id: fixtureData.importId },
      data: { catalogMode: "REPLACE" },
    });
    await assert.rejects(
      service.preview(
        fixtureData.context,
        fixtureData.importId,
        { candidateIds: [fixtureData.low.id] },
        importMatch,
        undefined,
        "replace-incomplete-preview",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_REPLACE_SELECTION_INCOMPLETE",
    );
    await prisma.businessImport.update({
      where: { id: fixtureData.importId },
      data: { catalogMode: "ADD" },
    });
    const duplicateExternalPreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.low.id, fixtureData.duplicateExternal.id] },
      importMatch,
      undefined,
      "duplicate-normalized-external-preview",
    );
    assert(
      duplicateExternalPreview.diagnostics.some(
        (item) => item.code === "BUSINESS_IMPORT_DUPLICATE_SOURCE_KEY",
      ),
    );
    const importView = await views.get(fixtureData.context, fixtureData.importId);
    assert.equal(importView.applyEligibility.eligible, false);
    assert(
      importView.applyEligibility.reasonCodes.includes("BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE"),
    );
    await assert.rejects(
      service.preview(
        fixtureData.context,
        fixtureData.importId,
        { candidateIds: [fixtureData.invalidEvidence.id] },
        importMatch,
        undefined,
        "invalid-evidence-preview",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_EVIDENCE_INTEGRITY_FAILED",
    );
    await assert.rejects(
      service.preview(
        fixtureData.context,
        fixtureData.importId,
        { candidateIds: [fixtureData.expiredEvidence.id] },
        importMatch,
        undefined,
        "expired-evidence-preview",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE",
    );
    await runtimeStore.delete(fixtureData.unavailableEvidence.evidenceObjectKey);
    await assert.rejects(
      service.preview(
        fixtureData.context,
        fixtureData.importId,
        { candidateIds: [fixtureData.unavailableEvidence.id] },
        importMatch,
        undefined,
        "unavailable-evidence-preview",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE",
    );
    const unavailableApplyPreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.applyUnavailableEvidence.id] },
      importMatch,
      undefined,
      "apply-unavailable-preview",
    );
    await runtimeStore.delete(fixtureData.applyUnavailableEvidence.evidenceObjectKey);
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: [fixtureData.applyUnavailableEvidence.id],
          manifestHash: unavailableApplyPreview.manifestHash,
        },
        importMatch,
        informationMatch,
        "apply-unavailable",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE",
    );
    assert.equal(await prisma.businessImportApplication.count(), 0);
    assert.equal(await prisma.businessInformationRevision.count(), 0);
    assert.equal(await prisma.runtimeOutbox.count(), 0);
    const blockedPreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.high.id] },
      importMatch,
      undefined,
      "approval-preview",
    );
    assert(
      blockedPreview.diagnostics.some((item) => item.code === "BUSINESS_IMPORT_APPROVAL_REQUIRED"),
    );
    const futurePricePreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.futurePrice.id] },
      importMatch,
      undefined,
      "future-price-preview",
    );
    assert(
      futurePricePreview.diagnostics.some(
        (item) => item.code === "BUSINESS_IMPORT_PRICE_EFFECTIVE_WINDOW_INVALID",
      ),
    );
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: [fixtureData.futurePrice.id],
          manifestHash: futurePricePreview.manifestHash,
        },
        importMatch,
        informationMatch,
        "future-price-apply",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_APPLICATION_BLOCKED",
    );
    const boundaryPrefix = `Catalog boundary ${randomUUID()}`;
    const currentActiveCount = await prisma.businessOffering.count({
      where: { tenantId: fixtureData.context.tenantId, active: true },
    });
    assert(currentActiveCount < 399);
    await prisma.businessOffering.createMany({
      data: Array.from({ length: 399 - currentActiveCount }, (_, index) => ({
        tenantId: fixtureData.context.tenantId,
        name: `${boundaryPrefix} ${index}`,
        locale: "en",
        active: true,
      })),
    });
    const boundaryAllowedPreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.low.id] },
      importMatch,
      undefined,
      "catalog-boundary-allowed-preview",
    );
    assert(
      !boundaryAllowedPreview.diagnostics.some(
        (item) => item.code === "BUSINESS_IMPORT_ACTIVE_CATALOG_LIMIT",
      ),
    );
    await prisma.businessOffering.create({
      data: {
        tenantId: fixtureData.context.tenantId,
        name: `${boundaryPrefix} overflow`,
        locale: "en",
        active: true,
      },
    });
    const boundaryBlockedPreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.low.id] },
      importMatch,
      undefined,
      "catalog-boundary-blocked-preview",
    );
    assert(
      boundaryBlockedPreview.diagnostics.some(
        (item) => item.code === "BUSINESS_IMPORT_ACTIVE_CATALOG_LIMIT",
      ),
    );
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: [fixtureData.low.id],
          manifestHash: boundaryBlockedPreview.manifestHash,
        },
        importMatch,
        informationMatch,
        "catalog-boundary-blocked-apply",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_APPLICATION_BLOCKED",
    );
    await prisma.businessOffering.deleteMany({
      where: {
        tenantId: fixtureData.context.tenantId,
        name: { startsWith: boundaryPrefix },
      },
    });
    const stalePreview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: [fixtureData.low.id] },
      importMatch,
      undefined,
      "stale-preview",
    );
    await prisma.businessImportCandidate.update({
      where: { id: fixtureData.low.id },
      data: { etag: { increment: 1 } },
    });
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        { candidateIds: [fixtureData.low.id], manifestHash: stalePreview.manifestHash },
        importMatch,
        informationMatch,
        "stale-apply",
      ),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 412,
    );
    assert.equal(await prisma.businessImportApplication.count(), 0);
    assert.equal(await prisma.businessInformationRevision.count(), 0);
    assert.equal(await prisma.runtimeOutbox.count(), 0);
    assert.equal(await prisma.businessOffering.count(), 1);
    const selectedCandidateIds = [
      ...fixtureData.priceCandidates.map((candidate) => candidate.id),
      fixtureData.link.id,
    ];
    const preview = await service.preview(
      fixtureData.context,
      fixtureData.importId,
      { candidateIds: selectedCandidateIds },
      importMatch,
      undefined,
      "valid-preview",
    );
    assert.equal(preview.businessInformationEtag, informationMatch);
    const application = await service.apply(
      fixtureData.context,
      fixtureData.importId,
      {
        candidateIds: selectedCandidateIds,
        manifestHash: preview.manifestHash,
      },
      importMatch,
      informationMatch,
      "valid-apply",
    );
    const replay = await service.apply(
      fixtureData.context,
      fixtureData.importId,
      {
        candidateIds: selectedCandidateIds,
        manifestHash: preview.manifestHash,
      },
      importMatch,
      informationMatch,
      "valid-apply",
    );
    assert.equal(replay.id, application.id);
    const applicationEndpoint = `POST:/business-profile/imports/${fixtureData.importId}/applications`;
    const expireTransientApplicationReplay = async () => {
      const expiresAt = new Date(Date.now() - 60_000);
      const expired = await prisma!.knowledgeV2IdempotencyRecord.updateMany({
        where: {
          tenantId: fixtureData.context.tenantId,
          endpoint: applicationEndpoint,
          key: "valid-apply",
        },
        data: { createdAt: new Date(expiresAt.getTime() - 60_000), expiresAt },
      });
      assert.equal(expired.count, 1);
    };
    await expireTransientApplicationReplay();
    const durableReplay = await service.apply(
      fixtureData.context,
      fixtureData.importId,
      {
        candidateIds: [...selectedCandidateIds].reverse(),
        manifestHash: preview.manifestHash,
      },
      [importMatch, importMatch],
      [informationMatch, informationMatch],
      "valid-apply",
    );
    assert.equal(durableReplay.id, application.id);
    await expireTransientApplicationReplay();
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: [selectedCandidateIds[0]!],
          manifestHash: preview.manifestHash,
        },
        importMatch,
        informationMatch,
        "valid-apply",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_IDEMPOTENCY_KEY_REUSED",
    );
    await expireTransientApplicationReplay();
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: selectedCandidateIds,
          manifestHash: preview.manifestHash,
        },
        '"changed-import-etag"',
        informationMatch,
        "valid-apply",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_IDEMPOTENCY_KEY_REUSED",
    );
    await expireTransientApplicationReplay();
    await assert.rejects(
      service.apply(
        fixtureData.context,
        fixtureData.importId,
        {
          candidateIds: selectedCandidateIds,
          manifestHash: preview.manifestHash,
        },
        importMatch,
        '"changed-information-etag"',
        "valid-apply",
      ),
      (error: unknown) => errorCode(error) === "BUSINESS_IMPORT_IDEMPOTENCY_KEY_REUSED",
    );
    assert.equal(await prisma.businessImportApplication.count(), 1);
    assert.equal(await prisma.businessInformationRevision.count(), 1);
    assert.equal(await prisma.runtimeOutbox.count(), 1);
    assert.equal(await prisma.businessOffering.count(), 6);
    assert.equal(await prisma.businessOfferingPrice.count(), 6);
    const storedPrices = await prisma.businessOfferingPrice.findMany();
    const priceByType = new Map(storedPrices.map((price) => [price.type, price]));
    assert.equal(priceByType.get("FIXED")?.amount?.toString(), "10");
    assert.equal(priceByType.get("FIXED")?.amountFrom, null);
    assert.equal(priceByType.get("FROM")?.amount, null);
    assert.equal(priceByType.get("FROM")?.amountFrom?.toString(), "20");
    assert.equal(priceByType.get("RANGE")?.amountFrom?.toString(), "30");
    assert.equal(priceByType.get("RANGE")?.amountTo?.toString(), "40");
    assert.equal(priceByType.get("FREE")?.amount, null);
    assert.equal(priceByType.get("FREE")?.amountFrom, null);
    assert.equal(priceByType.get("FREE")?.amountTo, null);
    assert.equal(priceByType.get("ON_REQUEST")?.amount, null);
    assert.equal(priceByType.get("ON_REQUEST")?.amountFrom, null);
    assert.equal(priceByType.get("ON_REQUEST")?.amountTo, null);
    const linkedOffering = await prisma.businessOffering.findUniqueOrThrow({
      where: { id: fixtureData.linkOffering.id },
      include: { prices: true, duration: true, sourceBindings: true },
    });
    assert.equal(linkedOffering.rowVersion, fixtureData.linkOffering.rowVersion);
    assert.equal(
      linkedOffering.prices[0]?.rowVersion,
      fixtureData.linkOffering.prices[0]?.rowVersion,
    );
    assert.equal(
      linkedOffering.duration?.rowVersion,
      fixtureData.linkOffering.duration?.rowVersion,
    );
    assert.equal(linkedOffering.sourceBindings.length, 1);
    assert.equal(linkedOffering.sourceBindings[0]?.externalKey, "catalog-existing-linked-service");
    assert.equal(linkedOffering.sourceBindings[0]?.active, true);
    const linkApplicationItem = await prisma.businessImportApplicationCandidate.findFirstOrThrow({
      where: { candidateId: fixtureData.link.id },
    });
    assert.equal(linkApplicationItem.action, "LINK");
    assert.equal(linkApplicationItem.risk, "HIGH");
    assert.equal(linkApplicationItem.requiresApproval, true);
    assert.equal(linkApplicationItem.approvalGrantId, fixtureData.linkApprovalGrant.id);
    const attributions = await prisma.businessInformationAttribution.findMany();
    const importedAttributions = attributions.filter((item) => item.authority === "IMPORTED");
    assert.equal(importedAttributions.length, fixtureData.priceCandidates.length);
    const expectedEvidence = new Map<string, string>(
      fixtureData.priceCandidates.map((candidate) => [candidate.id, candidate.evidenceId]),
    );
    for (const attribution of importedAttributions) {
      assert.equal(attribution.fieldPath, "/name");
      assert.equal(attribution.evidenceId, expectedEvidence.get(attribution.candidateId!));
      assert(attribution.sourceId);
      assert(attribution.importId);
      assert(attribution.applicationId);
    }
    const manualAttributions = attributions.filter((item) => item.authority === "MANUAL");
    assert.equal(
      manualAttributions.filter((item) => item.fieldPath === "/description").length,
      fixtureData.priceCandidates.length,
    );
    const nonImported = attributions.filter((item) => item.authority !== "IMPORTED");
    assert(nonImported.some((item) => item.authority === "SYSTEM" && item.fieldPath === "/kind"));
    for (const attribution of nonImported) {
      assert.equal(attribution.sourceValueHash, null);
      assert.equal(attribution.confidence, null);
      assert.equal(attribution.sourceId, null);
      assert.equal(attribution.importId, null);
      assert.equal(attribution.candidateId, null);
      assert.equal(attribution.candidateVersion, null);
      assert.equal(attribution.candidateValueHash, null);
      assert.equal(attribution.evidenceId, null);
      assert.equal(attribution.artifactId, null);
      assert.equal(attribution.applicationId, null);
      assert.equal(attribution.parserVersion, null);
      assert.equal(attribution.mapperVersion, null);
      assert.equal(attribution.schemaVersion, null);
    }
    assert.equal((await prisma.businessInformationState.findFirstOrThrow()).revision, 1);
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: fixtureData.importId } }))
        .state,
      "PROJECTING",
    );
    const stored = await prisma.businessImportApplication.findUniqueOrThrow({
      where: { id: application.id },
      include: { projectionReceipt: true, projectionOutbox: true },
    });
    assert.equal(stored.state, "COMMITTED");
    const applicationView = await service.getApplication(
      fixtureData.context,
      fixtureData.importId,
      application.id,
    );
    assert.equal(applicationView.counts.linked, 1);
    assert.equal(stored.projectionReceipt, null);
    const envelope = stored.projectionOutbox?.payload as Record<string, unknown>;
    assert.equal(envelope.queueName, "business.import");
    assert.equal(envelope.jobName, "project");
    assert.equal(envelope.jobId, `business-import-project:${application.id}:1`);
    const replacement = await manualFieldReplacementFixture(
      prisma,
      fixtureData.context,
      fixtureData.importId,
    );
    const replacementPreview = await service.preview(
      fixtureData.context,
      replacement.importId,
      { candidateIds: [replacement.updateCandidateId] },
      replacement.importMatch,
      replacement.informationMatch,
      "manual-field-replacement-preview",
    );
    assert.equal(replacementPreview.counts.updates, 1);
    assert.equal(replacementPreview.counts.removals, 0);
    await service.apply(
      fixtureData.context,
      replacement.importId,
      {
        candidateIds: [replacement.updateCandidateId],
        manifestHash: replacementPreview.manifestHash,
      },
      replacement.importMatch,
      replacement.informationMatch,
      "manual-field-replacement-apply",
    );
    const replacedOffering = await prisma.businessOffering.findUniqueOrThrow({
      where: { id: replacement.targetOfferingId },
      include: { prices: true, duration: true },
    });
    const replacedPrice = replacedOffering.prices[0];
    const replacedDuration = replacedOffering.duration;
    assert(replacedPrice);
    assert(replacedDuration);
    assert.equal(replacedOffering.name, replacement.replacementName);
    assert.equal(replacedOffering.description, replacement.manualDescriptionValue);
    assert.equal(replacedPrice.amount?.toString() ?? null, replacement.manualPrice.amount);
    assert.equal(replacedPrice.rowVersion, replacement.manualPrice.rowVersion);
    assert.equal(replacedDuration.minimumMinutes, replacement.manualDuration.minimumMinutes);
    assert.equal(replacedDuration.maximumMinutes, replacement.manualDuration.maximumMinutes);
    assert.equal(replacedDuration.rowVersion, replacement.manualDuration.rowVersion);
    const activeManualDescription = await prisma.businessInformationAttribution.findMany({
      where: {
        tenantId: fixtureData.context.tenantId,
        offeringId: replacement.targetOfferingId,
        authority: "MANUAL",
        fieldPath: "/description",
        supersededAt: null,
      },
    });
    assert.equal(activeManualDescription.length, 1);
    assert(
      (await prisma.businessInformationAttribution.count({
        where: {
          tenantId: fixtureData.context.tenantId,
          OR: [
            {
              resourceType: "OFFERING_PRICE",
              resourceKey: replacedPrice.id,
            },
            {
              resourceType: "OFFERING_DURATION",
              resourceKey: replacedDuration.id,
            },
          ],
          authority: "MANUAL",
          supersededAt: null,
        },
      })) > 0,
    );
    console.log("Business import application service smoke passed.");
  } catch (error) {
    failure = error;
  }
  for (const cleanup of [
    async () => prisma?.$disconnect(),
    async () =>
      maintenance.$queryRawUnsafe(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        databaseName,
      ),
    async () => maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`),
    async () => maintenance.$disconnect(),
    async () => rm(objectRoot, { recursive: true, force: true }),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure instanceof Error) throw failure;
  if (failure !== undefined) throw new Error("Business import application service smoke failed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
