import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HttpException } from "@nestjs/common";
import {
  BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
} from "@leadvirt/business-import";
import { Prisma, PrismaClient } from "@leadvirt/db";
import type { BusinessImportCandidateAction, BusinessImportOfferingValue } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import type { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { businessImportCandidateEtag, businessImportEtag } from "./business-import-http.js";
import { BusinessImportReviewService } from "./business-import-review.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";

const root = resolve(import.meta.dirname, "../../../../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_review_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

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

function runtimeConfig(objectRoot: string) {
  return {
    businessImportEnabled: true,
    businessImportMaxFileBytes: 10 * 1024 * 1024,
    businessImportUploadTtlSeconds: 600,
    businessImportMaxPendingPerTenant: 5,
    businessImportParserApproved: false,
    businessImportParserUrl: undefined,
    businessImportParserVersion: "review-smoke-parser-v1",
    businessImportParserTimeoutMs: 5_000,
    knowledgeObjectStorePath: objectRoot,
    knowledgeArtifactEncryptionKey: randomBytes(32).toString("base64"),
    knowledgeArtifactEncryptionKeyId: "review-smoke-key-v1",
    knowledgeFileUploadStreamTimeoutMs: 5_000,
    knowledgeFileScannerHost: "127.0.0.1",
    knowledgeFileScannerApproved: true,
    knowledgeFileScannerPort: 3310,
    knowledgeFileScannerVersion: "review-smoke-clamav-v1",
    knowledgeFileScannerTimeoutMs: 5_000,
  } as unknown as AppConfigService;
}

function offering(input: {
  name: string;
  category?: string;
  description?: string;
  price?: BusinessImportOfferingValue["price"];
}): BusinessImportOfferingValue {
  return {
    externalId: null,
    category: input.category ?? "Consulting",
    name: input.name,
    description: input.description ?? null,
    price: input.price ?? null,
    duration: null,
    locationExternalId: null,
    bookingNotes: null,
    active: true,
    validFrom: null,
    validUntil: null,
    language: "en",
  };
}

function valueHash(value: BusinessImportOfferingValue) {
  return businessOfferingValueHash({
    sourceRow: 1,
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

function identityKey(value: BusinessImportOfferingValue) {
  return businessOfferingIdentityKey({
    category: value.category ?? null,
    name: value.name,
    locationExternalId: value.locationExternalId ?? null,
    language: value.language ?? null,
  });
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  return typeof body === "object" && body !== null && "code" in body ? body.code : null;
}

async function fixture(prisma: PrismaService) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const sourceId = randomUUID();
  const importId = randomUUID();
  const artifactId = randomUUID();
  const parsedRevisionId = randomUUID();
  const artifactHash = randomBytes(32).toString("hex");
  const manifestHash = randomBytes(32).toString("hex");
  const tenant = await prisma.tenant.create({
    data: { id: tenantId, name: "Review smoke", slug: `review-smoke-${tenantId}` },
  });
  const user = await prisma.user.create({
    data: { id: userId, email: `${userId}@example.test`, name: "Review owner" },
  });
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  const context: RequestContext = {
    tenantId,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user,
  };
  await prisma.businessImportSource.create({
    data: {
      id: sourceId,
      tenantId,
      lineageKey: `review-smoke-${sourceId}`,
      displayName: "Review smoke source",
      createdByUserId: userId,
    },
  });
  const artifactLedger = await prisma.businessImportObjectLedger.create({
    data: {
      tenantId,
      objectKind: "RAW_ARTIFACT",
      objectStorageKey: `review-smoke/${artifactId}/raw`,
      encryptionKeyRef: "review-smoke-key-v1",
      retentionClass: "SMOKE",
    },
  });
  const parsedLedger = await prisma.businessImportObjectLedger.create({
    data: {
      tenantId,
      objectKind: "PARSED_MANIFEST",
      objectStorageKey: `review-smoke/${artifactId}/manifest`,
      encryptionKeyRef: "review-smoke-key-v1",
      retentionClass: "SMOKE",
    },
  });
  await prisma.businessImportArtifact.create({
    data: {
      id: artifactId,
      tenantId,
      sourceId,
      objectStorageKey: artifactLedger.objectStorageKey,
      encryptionKeyRef: artifactLedger.encryptionKeyRef,
      objectLedgerId: artifactLedger.id,
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
      displayName: "Review corrections",
      originalFilename: "services.csv",
      declaredMimeType: "text/csv",
      expectedByteSize: 128n,
      uploadTokenHash: randomBytes(32).toString("hex"),
      artifactId,
      artifactSha256: artifactHash,
      baseInformationRevision: 0,
      baseInformationHash: "0".repeat(64),
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
      parserVersion: "review-smoke-parser-v1",
      mapperVersion: "review-smoke-mapper-v1",
      schemaVersion: "leadvirt.services.v1",
      extractionContractVersion: "review-smoke-extraction-v1",
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
      parserVersion: "review-smoke-parser-v1",
      mapperVersion: "review-smoke-mapper-v1",
      reviewReadyAt: new Date(),
    },
  });

  async function candidate(
    action: Extract<BusinessImportCandidateAction, "INVALID" | "CONFLICT">,
    value: BusinessImportOfferingValue,
    targetOfferingId: string | null = null,
  ) {
    const id = randomUUID();
    const normalizedHash = valueHash(value);
    const fieldProvenance = Object.fromEntries(
      BUSINESS_IMPORT_FIELD_PROVENANCE_PATHS.map((path) => [path, { authority: "SYSTEM" }]),
    ) as Prisma.InputJsonObject;
    await prisma.businessImportCandidate.create({
      data: {
        id,
        tenantId,
        sourceId,
        importId,
        candidateKey: randomBytes(32).toString("hex"),
        targetCategory: "OFFERINGS",
        semanticTargetKey: identityKey(value),
        action,
        normalizedValue: value as unknown as Prisma.InputJsonObject,
        normalizedValueHash: normalizedHash,
        targetOfferingId,
        risk: "LOW",
        confidence: "LOW",
        validationCodes: action === "INVALID" ? ["INVALID_FIXTURE"] : Prisma.JsonNull,
        reasonCodes: action === "CONFLICT" ? ["CONFLICT_FIXTURE"] : Prisma.JsonNull,
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
        semanticTargetKey: identityKey(value),
        action,
        normalizedValue: value as unknown as Prisma.InputJsonObject,
        normalizedValueHash: normalizedHash,
        targetOfferingId,
        fieldProvenance,
        risk: "LOW",
        confidence: "LOW",
        validationCodes: action === "INVALID" ? ["INVALID_FIXTURE"] : Prisma.JsonNull,
        reasonCodes: action === "CONFLICT" ? ["CONFLICT_FIXTURE"] : Prisma.JsonNull,
      },
    });
    return { id, normalizedHash };
  }

  return {
    context,
    importId,
    candidate,
    existingOffering: async (value: BusinessImportOfferingValue) =>
      prisma.businessOffering.create({
        data: {
          tenantId,
          category: value.category ?? null,
          name: value.name,
          description: value.description ?? null,
          locale: value.language ?? "en",
          bookingNotes: value.bookingNotes ?? null,
          active: value.active,
          ...(value.price
            ? {
                prices: {
                  create: {
                    type: value.price.type ?? "FIXED",
                    amount: value.price.amount ?? null,
                    amountFrom: value.price.from ?? null,
                    amountTo: value.price.to ?? null,
                    currency: value.price.currency ?? "EUR",
                    unit: value.price.unit ?? null,
                    taxNote: value.price.taxNote ?? null,
                  },
                },
              }
            : {}),
          ...(value.duration
            ? {
                duration: {
                  create: {
                    minimumMinutes: value.duration.minimumMinutes ?? 0,
                    maximumMinutes: value.duration.maximumMinutes ?? null,
                  },
                },
              }
            : {}),
        },
      }),
  };
}

async function main() {
  const maintenance = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-review-smoke-"));
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
    const views = new BusinessImportViewService(prisma, runtime);
    const service = new BusinessImportReviewService(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
      runtime,
      views,
    );
    const data = await fixture(prisma);

    const invalid = await data.candidate("INVALID", offering({ name: "Broken row" }));
    const invalidBefore = await views.getCandidate(data.context, data.importId, invalid.id);
    assert.deepEqual(invalidBefore.allowedDecisions, ["REJECTED"]);
    assert.equal(invalidBefore.canEditProposed, true);
    const correctedAdd = offering({ name: "Unique corrected service", description: "Ready" });
    const addView = await service.decideCandidate(
      data.context,
      data.importId,
      invalid.id,
      { decision: "ACCEPTED", proposed: correctedAdd },
      businessImportCandidateEtag(invalid.id, 1),
      "review-invalid-to-add",
    );
    assert.equal(addView.action, "ADD");
    assert.equal(addView.decision, "EDITED");
    assert.equal(addView.version, 2);
    assert.equal(addView.targetOfferingId, null);
    const addRevision = await prisma.businessImportCandidateRevision.findFirstOrThrow({
      where: { candidateId: invalid.id, version: 2 },
    });
    assert.equal(addRevision.action, "ADD");
    assert.equal(addRevision.targetOfferingId, null);
    assert.deepEqual(addRevision.validationCodes, null);
    assert.deepEqual(addRevision.reasonCodes, null);

    const existingValue = offering({ name: "Existing service", description: "Old description" });
    const existing = await data.existingOffering(existingValue);
    const conflict = await data.candidate("CONFLICT", offering({ name: "Unresolved conflict" }));
    const conflictBefore = await views.getCandidate(data.context, data.importId, conflict.id);
    assert.deepEqual(conflictBefore.allowedDecisions, ["REJECTED"]);
    assert.equal(conflictBefore.canEditProposed, true);
    const correctedUpdate = offering({
      name: existingValue.name,
      description: "Updated description",
    });
    const updateView = await service.decideCandidate(
      data.context,
      data.importId,
      conflict.id,
      { decision: "ACCEPTED", proposed: correctedUpdate },
      businessImportCandidateEtag(conflict.id, 1),
      "review-conflict-to-update",
    );
    assert.equal(updateView.action, "UPDATE");
    assert.equal(updateView.targetOfferingId, existing.id);
    assert.equal(updateView.decision, "EDITED");
    const updateRevision = await prisma.businessImportCandidateRevision.findFirstOrThrow({
      where: { candidateId: conflict.id, version: 2 },
    });
    assert.equal(updateRevision.action, "UPDATE");
    assert.equal(updateRevision.targetOfferingId, existing.id);
    assert.match(updateRevision.currentFingerprint ?? "", /^[a-f0-9]{64}$/u);

    const linkValue = offering({
      name: "Existing link target",
      description: "Unchanged",
      price: {
        type: "FIXED",
        amount: "60.00",
        from: null,
        to: null,
        currency: "EUR",
        unit: "service",
        taxNote: null,
      },
    });
    const linkTarget = await data.existingOffering(linkValue);
    const linkCandidate = await data.candidate("CONFLICT", linkValue, linkTarget.id);
    const linkedView = await service.decideCandidate(
      data.context,
      data.importId,
      linkCandidate.id,
      {
        decision: "ACCEPTED",
        proposed: { ...linkValue, externalId: "catalog-existing-link-target" },
      },
      businessImportCandidateEtag(linkCandidate.id, 1),
      "review-conflict-to-link",
    );
    assert.equal(linkedView.action, "LINK");
    assert.equal(linkedView.targetOfferingId, linkTarget.id);
    assert.equal(linkedView.riskLevel, "HIGH");
    assert.equal(linkedView.decision, "EDITED");
    const linkRevision = await prisma.businessImportCandidateRevision.findFirstOrThrow({
      where: { candidateId: linkCandidate.id, version: 2 },
    });
    assert.equal(linkRevision.action, "LINK");
    assert.equal(linkRevision.targetOfferingId, linkTarget.id);
    assert.equal(linkRevision.requiresApproval, true);
    const linkImportBeforeApproval = await views.get(data.context, data.importId);
    const approvedLink = await service.bulkApprove(
      data.context,
      data.importId,
      {
        candidates: [
          {
            id: linkedView.id,
            version: linkedView.version,
            etag: linkedView.etag,
          },
        ],
      },
      linkImportBeforeApproval.etag,
      "review-priced-link-owner-approval",
    );
    assert.deepEqual(approvedLink.summary, {
      selected: 1,
      newlyApproved: 1,
      approvalRequestsCreated: 1,
      alreadyApproved: 0,
    });
    assert.equal(approvedLink.candidates[0]?.approval?.state, "APPROVED");
    assert.equal(
      await prisma.businessImportApprovalGrant.count({ where: { candidateId: linkedView.id } }),
      1,
    );

    const provisionalValue = offering({ name: "Provisional target", description: "Existing" });
    const provisionalTarget = await data.existingOffering(provisionalValue);
    const provisional = await data.candidate("CONFLICT", provisionalValue, provisionalTarget.id);
    const renamed = offering({ name: "Independent service", description: "New" });
    const renamedView = await service.decideCandidate(
      data.context,
      data.importId,
      provisional.id,
      { decision: "ACCEPTED", proposed: renamed },
      businessImportCandidateEtag(provisional.id, 1),
      "review-conflict-renamed-to-add",
    );
    assert.equal(renamedView.action, "ADD");
    assert.equal(renamedView.targetOfferingId, null);
    const preservedTarget = await prisma.businessOffering.findUniqueOrThrow({
      where: { id: provisionalTarget.id },
    });
    assert.equal(preservedTarget.name, provisionalValue.name);

    const ambiguousValue = offering({ name: "Ambiguous service" });
    await data.existingOffering(ambiguousValue);
    await data.existingOffering(ambiguousValue);
    const ambiguous = await data.candidate("CONFLICT", offering({ name: "Ambiguous input" }));
    await assert.rejects(
      service.decideCandidate(
        data.context,
        data.importId,
        ambiguous.id,
        { decision: "ACCEPTED", proposed: ambiguousValue },
        businessImportCandidateEtag(ambiguous.id, 1),
        "review-ambiguous-remains-conflict",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        errorCode(error) === "BUSINESS_IMPORT_CANDIDATE_STILL_CONFLICTED",
    );
    const unchangedAmbiguous = await prisma.businessImportCandidate.findUniqueOrThrow({
      where: { id: ambiguous.id },
    });
    assert.equal(unchangedAmbiguous.action, "CONFLICT");
    assert.equal(unchangedAmbiguous.decision, "PENDING");
    assert.equal(unchangedAmbiguous.version, 1);
    assert.equal(unchangedAmbiguous.etag, 1);
    assert.equal(unchangedAmbiguous.normalizedValueHash, ambiguous.normalizedHash);
    assert.equal(
      await prisma.businessImportCandidateRevision.count({ where: { candidateId: ambiguous.id } }),
      1,
    );

    const highRisk = await data.candidate("INVALID", offering({ name: "Priced broken row" }));
    const highRiskAdd = offering({
      name: "Priced corrected service",
      price: {
        type: "FIXED",
        amount: "125.00",
        from: null,
        to: null,
        currency: "EUR",
        unit: "session",
        taxNote: null,
      },
    });
    const highRiskView = await service.decideCandidate(
      data.context,
      data.importId,
      highRisk.id,
      { decision: "ACCEPTED", proposed: highRiskAdd },
      businessImportCandidateEtag(highRisk.id, 1),
      "review-high-risk-add",
    );
    assert.equal(highRiskView.action, "ADD");
    assert.equal(highRiskView.riskLevel, "HIGH");
    assert.equal(highRiskView.decision, "EDITED");
    assert.equal(highRiskView.approval, null);
    const highRiskStored = await prisma.businessImportCandidate.findUniqueOrThrow({
      where: { id: highRisk.id },
    });
    assert.equal(highRiskStored.requiresApproval, true);
    assert.equal(highRiskStored.requiredPermission, "business_information.approve");
    assert.equal(highRiskStored.decision, "EDITED");
    assert.equal(
      await prisma.businessImportApprovalGrant.count({ where: { candidateId: highRisk.id } }),
      0,
    );
    const importBeforeApproval = await prisma.businessImport.findUniqueOrThrow({
      where: { id: data.importId },
    });
    const importView = await views.get(data.context, data.importId);
    assert.equal(importView.applyEligibility.eligible, false);
    assert.equal(importView.applyEligibility.pendingApprovals, 1);
    const submitted = await service.requestApproval(
      data.context,
      data.importId,
      [highRisk.id],
      businessImportEtag(data.importId, importBeforeApproval.etag),
      "review-high-risk-request-approval",
    );
    assert.equal(submitted.candidates[0]?.decision, "SUBMITTED_FOR_APPROVAL");
    assert.equal(submitted.candidates[0]?.approval?.state, "PENDING");

    async function prepareHighRisk(name: string, key: string) {
      const row = await data.candidate("INVALID", offering({ name: `${name} invalid` }));
      return service.decideCandidate(
        data.context,
        data.importId,
        row.id,
        {
          decision: "ACCEPTED",
          proposed: offering({
            name,
            price: {
              type: "FIXED",
              amount: "75.00",
              from: null,
              to: null,
              currency: "EUR",
              unit: "service",
              taxNote: null,
            },
          }),
        },
        businessImportCandidateEtag(row.id, 1),
        key,
      );
    }

    const secondHighRisk = await prepareHighRisk(
      "Second priced service",
      "review-bulk-approval-second-high-risk",
    );
    const pendingHighRisk = await views.getCandidate(data.context, data.importId, highRisk.id);
    const beforeBulkApproval = await views.get(data.context, data.importId);
    const bulkApprovalInput = {
      candidates: [pendingHighRisk, secondHighRisk].map((candidate) => ({
        id: candidate.id,
        version: candidate.version,
        etag: candidate.etag,
      })),
    };
    const bulkApproved = await service.bulkApprove(
      data.context,
      data.importId,
      bulkApprovalInput,
      beforeBulkApproval.etag,
      "review-bulk-approval-multi",
    );
    assert.deepEqual(bulkApproved.summary, {
      selected: 2,
      newlyApproved: 2,
      approvalRequestsCreated: 1,
      alreadyApproved: 0,
    });
    assert.equal(bulkApproved.candidates.length, 2);
    assert.ok(
      bulkApproved.candidates.every(
        (candidate) =>
          candidate.decision === "ACCEPTED" && candidate.approval?.state === "APPROVED",
      ),
    );
    assert.equal(
      await prisma.businessImportApprovalGrant.count({
        where: { candidateId: { in: [highRisk.id, secondHighRisk.id] } },
      }),
      2,
    );
    const importAfterBulk = await prisma.businessImport.findUniqueOrThrow({
      where: { id: data.importId },
    });
    const approvalCountAfterBulk = await prisma.businessImportCandidateApproval.count({
      where: { candidateId: { in: [highRisk.id, secondHighRisk.id] } },
    });
    const grantCountAfterBulk = await prisma.businessImportApprovalGrant.count({
      where: { candidateId: { in: [highRisk.id, secondHighRisk.id] } },
    });
    const replayedBulkApproval = await service.bulkApprove(
      data.context,
      data.importId,
      bulkApprovalInput,
      beforeBulkApproval.etag,
      "review-bulk-approval-multi",
    );
    assert.deepEqual(replayedBulkApproval.summary, bulkApproved.summary);
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: data.importId } })).etag,
      importAfterBulk.etag,
    );
    assert.equal(
      await prisma.businessImportCandidateApproval.count({
        where: { candidateId: { in: [highRisk.id, secondHighRisk.id] } },
      }),
      approvalCountAfterBulk,
    );
    assert.equal(
      await prisma.businessImportApprovalGrant.count({
        where: { candidateId: { in: [highRisk.id, secondHighRisk.id] } },
      }),
      grantCountAfterBulk,
    );
    await prisma.membership.update({
      where: {
        tenantId_userId: {
          tenantId: data.context.tenantId,
          userId: data.context.userId,
        },
      },
      data: { role: "MANAGER" },
    });
    try {
      await assert.rejects(
        service.bulkApprove(
          data.context,
          data.importId,
          bulkApprovalInput,
          beforeBulkApproval.etag,
          "review-bulk-approval-multi",
        ),
        (error: unknown) =>
          error instanceof HttpException &&
          error.getStatus() === 403 &&
          errorCode(error) === "BUSINESS_IMPORT_PERMISSION_DENIED",
      );
    } finally {
      await prisma.membership.update({
        where: {
          tenantId_userId: {
            tenantId: data.context.tenantId,
            userId: data.context.userId,
          },
        },
        data: { role: "OWNER" },
      });
    }

    const currentBulkRows = await Promise.all(
      [highRisk.id, secondHighRisk.id].map((candidateId) =>
        views.getCandidate(data.context, data.importId, candidateId),
      ),
    );
    const currentBulkImport = await views.get(data.context, data.importId);
    const alreadyApproved = await service.bulkApprove(
      data.context,
      data.importId,
      {
        candidates: currentBulkRows.map((candidate) => ({
          id: candidate.id,
          version: candidate.version,
          etag: candidate.etag,
        })),
      },
      currentBulkImport.etag,
      "review-bulk-approval-already-approved",
    );
    assert.deepEqual(alreadyApproved.summary, {
      selected: 2,
      newlyApproved: 0,
      approvalRequestsCreated: 0,
      alreadyApproved: 2,
    });
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: data.importId } })).etag,
      importAfterBulk.etag,
    );

    const managerId = randomUUID();
    const manager = await prisma.user.create({
      data: { id: managerId, email: `${managerId}@example.test`, name: "Review manager" },
    });
    await prisma.membership.create({
      data: { tenantId: data.context.tenantId, userId: managerId, role: "MANAGER" },
    });
    const managerContext: RequestContext = {
      ...data.context,
      userId: managerId,
      user: manager,
      role: "MANAGER",
    };
    await assert.rejects(
      service.bulkApprove(
        managerContext,
        data.importId,
        {
          candidates: currentBulkRows.map((candidate) => ({
            id: candidate.id,
            version: candidate.version,
            etag: candidate.etag,
          })),
        },
        currentBulkImport.etag,
        "review-bulk-approval-manager-denied",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 403 &&
        errorCode(error) === "BUSINESS_IMPORT_PERMISSION_DENIED",
    );
    await assert.rejects(
      service.bulkApprove(
        { ...managerContext, role: "OWNER" },
        data.importId,
        {
          candidates: currentBulkRows.map((candidate) => ({
            id: candidate.id,
            version: candidate.version,
            etag: candidate.etag,
          })),
        },
        currentBulkImport.etag,
        "review-bulk-approval-membership-revalidated",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 403 &&
        errorCode(error) === "BUSINESS_IMPORT_PERMISSION_DENIED",
    );

    const closedHighRisk = await prepareHighRisk(
      "Rejected priced service",
      "review-bulk-approval-closed-high-risk",
    );
    const validHighRisk = await prepareHighRisk(
      "Atomic priced service",
      "review-bulk-approval-atomic-high-risk",
    );
    const beforeClosedRequest = await views.get(data.context, data.importId);
    const submittedClosed = await service.requestApproval(
      data.context,
      data.importId,
      [closedHighRisk.id],
      beforeClosedRequest.etag,
      "review-bulk-approval-closed-request",
    );
    const closedApprovalId = submittedClosed.candidates[0]?.approval?.id;
    assert.ok(closedApprovalId);
    const beforeClosedDecision = await views.get(data.context, data.importId);
    await service.decideApproval(
      data.context,
      data.importId,
      closedApprovalId,
      { decision: "REJECTED", reason: "Rejected smoke version" },
      beforeClosedDecision.etag,
      "review-bulk-approval-closed-reject",
    );
    const closedView = await views.getCandidate(data.context, data.importId, closedHighRisk.id);
    const validView = await views.getCandidate(data.context, data.importId, validHighRisk.id);
    const beforeAtomicFailure = await prisma.businessImport.findUniqueOrThrow({
      where: { id: data.importId },
    });
    const validBeforeAtomicFailure = await prisma.businessImportCandidate.findUniqueOrThrow({
      where: { id: validHighRisk.id },
    });
    await assert.rejects(
      service.bulkApprove(
        data.context,
        data.importId,
        {
          candidates: [validView, closedView].map((candidate) => ({
            id: candidate.id,
            version: candidate.version,
            etag: candidate.etag,
          })),
        },
        businessImportEtag(data.importId, beforeAtomicFailure.etag),
        "review-bulk-approval-atomic-closed-failure",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        errorCode(error) === "BUSINESS_IMPORT_APPROVAL_VERSION_CLOSED",
    );
    const validAfterAtomicFailure = await prisma.businessImportCandidate.findUniqueOrThrow({
      where: { id: validHighRisk.id },
    });
    assert.equal(validAfterAtomicFailure.decision, validBeforeAtomicFailure.decision);
    assert.equal(validAfterAtomicFailure.version, validBeforeAtomicFailure.version);
    assert.equal(validAfterAtomicFailure.etag, validBeforeAtomicFailure.etag);
    assert.equal(
      validAfterAtomicFailure.normalizedValueHash,
      validBeforeAtomicFailure.normalizedValueHash,
    );
    assert.equal(
      await prisma.businessImportCandidateApproval.count({
        where: { candidateId: validHighRisk.id },
      }),
      0,
    );
    assert.equal(
      await prisma.businessImportApprovalGrant.count({ where: { candidateId: validHighRisk.id } }),
      0,
    );
    assert.equal(
      (await prisma.businessImport.findUniqueOrThrow({ where: { id: data.importId } })).etag,
      beforeAtomicFailure.etag,
    );

    await assert.rejects(
      service.bulkApprove(
        data.context,
        data.importId,
        {
          candidates: [{ id: validView.id, version: validView.version + 1, etag: validView.etag }],
        },
        businessImportEtag(data.importId, beforeAtomicFailure.etag),
        "review-bulk-approval-version-fence",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 412 &&
        errorCode(error) === "BUSINESS_IMPORT_REVISION_CONFLICT",
    );

    const invalidatedHighRisk = await prepareHighRisk(
      "Invalidated priced service",
      "review-bulk-approval-invalidated-high-risk",
    );
    const beforeInvalidatedRequest = await views.get(data.context, data.importId);
    await service.requestApproval(
      data.context,
      data.importId,
      [invalidatedHighRisk.id],
      beforeInvalidatedRequest.etag,
      "review-bulk-approval-invalidated-request",
    );
    const submittedInvalidated = await views.getCandidate(
      data.context,
      data.importId,
      invalidatedHighRisk.id,
    );
    await service.decideCandidate(
      data.context,
      data.importId,
      invalidatedHighRisk.id,
      { decision: "ACCEPTED" },
      submittedInvalidated.etag,
      "review-bulk-approval-invalidated-reopen",
    );
    const invalidatedView = await views.getCandidate(
      data.context,
      data.importId,
      invalidatedHighRisk.id,
    );
    assert.equal(invalidatedView.approval?.state, "INVALIDATED");
    const beforeInvalidatedBulk = await views.get(data.context, data.importId);
    await assert.rejects(
      service.bulkApprove(
        data.context,
        data.importId,
        {
          candidates: [
            {
              id: invalidatedView.id,
              version: invalidatedView.version,
              etag: invalidatedView.etag,
            },
          ],
        },
        beforeInvalidatedBulk.etag,
        "review-bulk-approval-invalidated-closed",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        errorCode(error) === "BUSINESS_IMPORT_APPROVAL_VERSION_CLOSED",
    );

    const editedClosed = await service.decideCandidate(
      data.context,
      data.importId,
      closedHighRisk.id,
      { decision: "ACCEPTED", proposed: closedView.proposed },
      closedView.etag,
      "review-bulk-approval-closed-edited",
    );
    assert.equal(editedClosed.version, closedView.version + 1);
    const beforeEditedApproval = await views.get(data.context, data.importId);
    const approvedEditedClosed = await service.bulkApprove(
      data.context,
      data.importId,
      {
        candidates: [
          { id: editedClosed.id, version: editedClosed.version, etag: editedClosed.etag },
        ],
      },
      beforeEditedApproval.etag,
      "review-bulk-approval-edited-version",
    );
    assert.equal(approvedEditedClosed.candidates[0]?.approval?.state, "APPROVED");
    assert.equal(approvedEditedClosed.candidates[0]?.decision, "ACCEPTED");

    await assert.rejects(
      service.bulkApprove(
        data.context,
        data.importId,
        {
          candidates: Array.from({ length: 401 }, (_, index) => ({
            id: `candidate-${index}`,
            version: 1,
            etag: '"candidate-etag"',
          })),
        },
        (await views.get(data.context, data.importId)).etag,
        "review-bulk-approval-cap",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 422 &&
        errorCode(error) === "BUSINESS_IMPORT_APPROVAL_SELECTION_INVALID",
    );

    const terminal = await data.candidate("CONFLICT", offering({ name: "Applied service" }));
    await prisma.businessImportCandidate.update({
      where: { id: terminal.id },
      data: { decision: "APPLIED", appliedAt: new Date() },
    });
    await assert.rejects(
      service.decideCandidate(
        data.context,
        data.importId,
        terminal.id,
        { decision: "REJECTED" },
        businessImportCandidateEtag(terminal.id, 1),
        "review-applied-decision-final",
      ),
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        errorCode(error) === "BUSINESS_IMPORT_CANDIDATE_DECISION_FINAL",
    );
    const terminalView = await views.getCandidate(data.context, data.importId, terminal.id);
    assert.deepEqual(terminalView.allowedDecisions, []);
    assert.equal(terminalView.canEditProposed, false);

    console.log("Business import review correction smoke passed.");
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
  if (failure !== undefined) throw new Error("Business import review correction smoke failed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
