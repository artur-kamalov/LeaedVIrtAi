import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  businessImportEvidenceRecordHash,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  diffBusinessServiceRows,
  normalizeBusinessExternalId,
  remapBusinessImportFieldProvenance,
  type BusinessImportDiagnostic,
  type BusinessServiceCsvHeader,
  type BusinessServiceDiffCandidate,
  type ParsedBusinessServiceRow,
} from "@leadvirt/business-import";
import { Prisma } from "@leadvirt/db";
import type { BusinessImportView } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import {
  assertBusinessImportIfMatch,
  businessImportEtag,
  businessImportError,
  businessImportManifestHash,
} from "./business-import-http.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

type CandidateRow = Prisma.BusinessImportCandidateGetPayload<Record<string, never>>;
type OfferingRow = Prisma.BusinessOfferingGetPayload<{
  include: {
    prices: true;
    duration: true;
    sourceBindings: true;
  };
}>;

interface RebasedCandidate {
  candidate: CandidateRow;
  diff: BusinessServiceDiffCandidate;
  validationCodes: Prisma.InputJsonArray;
  reasonCodes: Prisma.InputJsonArray;
  requiresApproval: boolean;
  requiredPermission: string;
  changed: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isoDate(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function jsonArray(value: unknown[]): Prisma.InputJsonArray {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonArray;
}

function diagnosticValue(value: BusinessImportDiagnostic) {
  return {
    severity: value.severity,
    code: value.code.slice(0, 160),
    message: value.message.slice(0, 500),
    ...(value.row !== undefined ? { row: value.row } : {}),
    ...(value.column !== undefined ? { column: value.column } : {}),
    ...(value.field !== undefined ? { field: value.field.slice(0, 160) } : {}),
    ...(value.sheet !== undefined ? { sheet: value.sheet.slice(0, 160) } : {}),
    ...(value.cell !== undefined ? { cell: value.cell.slice(0, 160) } : {}),
    ...(value.range !== undefined ? { range: value.range.slice(0, 160) } : {}),
  };
}

function storedDiagnostics(value: unknown): BusinessImportDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    const item = record(entry);
    if (typeof item.code !== "string") return [];
    if (
      [
        "BUSINESS_IMPORT_AMBIGUOUS_IDENTITY",
        "BUSINESS_IMPORT_AMBIGUOUS_SOURCE_BINDING",
        "BUSINESS_IMPORT_AMBIGUOUS_CANONICAL_IDENTITY",
        "BUSINESS_IMPORT_DUPLICATE_IDENTITY",
        "BUSINESS_IMPORT_POSSIBLE_DUPLICATE",
      ].includes(item.code)
    ) {
      return [];
    }
    return [
      {
        severity: item.severity === "ERROR" ? ("ERROR" as const) : ("WARNING" as const),
        code: item.code.slice(0, 160),
        message:
          typeof item.message === "string" ? item.message.slice(0, 500) : item.code.slice(0, 160),
        ...(typeof item.row === "number" ? { row: item.row } : {}),
        ...(typeof item.column === "number" ? { column: item.column } : {}),
      },
    ];
  });
}

function parsedCandidate(
  candidate: CandidateRow,
  sourceRow: number,
  evidenceHeaders: ReadonlySet<BusinessServiceCsvHeader> = new Set(),
): ParsedBusinessServiceRow {
  const value = record(candidate.normalizedValue);
  const priceValue = record(value.price);
  const durationValue = record(value.duration);
  const priceType = ["FIXED", "FROM", "RANGE", "FREE", "ON_REQUEST"].includes(
    String(priceValue.type),
  )
    ? (priceValue.type as "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST")
    : null;
  const minimumMinutes = Number(durationValue.minimumMinutes);
  const maximumMinutes =
    durationValue.maximumMinutes === null || durationValue.maximumMinutes === undefined
      ? null
      : Number(durationValue.maximumMinutes);
  return {
    sourceRow,
    externalId: nullableText(value.externalId),
    category: nullableText(value.category),
    name: nullableText(value.name) ?? "",
    description: nullableText(value.description),
    price: priceType
      ? {
          type: priceType,
          amount: nullableText(priceValue.amount),
          from: nullableText(priceValue.from),
          to: nullableText(priceValue.to),
          currency: nullableText(priceValue.currency),
          unit: nullableText(priceValue.unit),
          taxNote: nullableText(priceValue.taxNote),
        }
      : null,
    duration:
      Number.isInteger(minimumMinutes) && minimumMinutes >= 0
        ? {
            minimumMinutes,
            maximumMinutes:
              maximumMinutes !== null && Number.isInteger(maximumMinutes) && maximumMinutes >= 0
                ? maximumMinutes
                : null,
          }
        : null,
    locationExternalId: nullableText(value.locationExternalId),
    bookingNotes: nullableText(value.bookingNotes),
    active: value.active !== false,
    validFrom: nullableText(value.validFrom),
    validUntil: nullableText(value.validUntil),
    language: nullableText(value.language),
    evidence: Object.fromEntries(
      BUSINESS_SERVICES_CSV_HEADERS.filter((header) => evidenceHeaders.has(header)).map(
        (header, index) => [
          header,
          {
            format: "CSV" as const,
            row: sourceRow,
            column: index + 1,
            header,
            sourceValue: "",
          },
        ],
      ),
    ),
    diagnostics: storedDiagnostics(candidate.validationCodes),
    valid: candidate.action !== "INVALID",
  };
}

function primaryPrice(offering: OfferingRow) {
  return [...offering.prices].sort((left, right) => {
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    return created || left.id.localeCompare(right.id);
  })[0];
}

function currentOfferingRow(offering: OfferingRow, sourceId: string): ParsedBusinessServiceRow {
  const price = primaryPrice(offering);
  const binding = [...offering.sourceBindings]
    .filter((item) => item.sourceId === sourceId && item.active)
    .sort((left, right) => left.externalKey.localeCompare(right.externalKey))[0];
  return {
    sourceRow: 0,
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
    validFrom: isoDate(price?.effectiveFrom),
    validUntil: isoDate(price?.effectiveUntil),
    language: offering.locale,
    evidence: {},
    diagnostics: [],
    valid: true,
  };
}

function reasonCodes(candidate: BusinessServiceDiffCandidate) {
  return [
    ...(candidate.action === "MISSING" ? ["BUSINESS_IMPORT_MISSING_FROM_REVISION"] : []),
    ...(candidate.action === "CONFLICT" ? ["BUSINESS_IMPORT_REVIEW_CONFLICT"] : []),
    ...(candidate.action === "INVALID" ? ["BUSINESS_IMPORT_INVALID_ROW"] : []),
  ];
}

function conflict(candidate: BusinessServiceDiffCandidate, code: string) {
  return {
    ...candidate,
    action: "CONFLICT" as const,
    confidence: "LOW" as const,
    current: null,
    targetOfferingId: null,
    diagnostics: [
      ...candidate.diagnostics,
      {
        severity: "WARNING" as const,
        code,
        message: "The service identity matches more than one current record.",
        ...(candidate.proposed ? { row: candidate.proposed.sourceRow } : {}),
      },
    ],
  };
}

export function recomputeBusinessImportCandidates(input: {
  sourceLineageId: string;
  candidates: CandidateRow[];
  offerings: OfferingRow[];
  sourceId: string;
  evidenceHeadersByCandidateId?: ReadonlyMap<string, ReadonlySet<BusinessServiceCsvHeader>>;
}): RebasedCandidate[] {
  const current = input.offerings.map((offering) => {
    const value = currentOfferingRow(offering, input.sourceId);
    return { id: offering.id, value, valueHash: businessOfferingValueHash(value) };
  });
  const currentById = new Map(current.map((item) => [item.id, item]));
  const bindings = input.offerings.flatMap((offering) =>
    offering.sourceBindings
      .filter((binding) => binding.sourceId === input.sourceId && binding.active)
      .sort((left, right) => left.externalKey.localeCompare(right.externalKey))
      .map((binding) => ({
        offeringId: offering.id,
        externalKey: binding.externalKey,
        identityKey: businessOfferingIdentityKey(currentById.get(offering.id)!.value),
        sourceValueHash: binding.lastSeenSourceValueHash,
      })),
  );
  const importedCandidates = input.candidates.filter(
    (candidate) => !["MISSING", "ARCHIVE"].includes(candidate.action),
  );
  const rows = importedCandidates.map((candidate, index) =>
    parsedCandidate(candidate, index + 1, input.evidenceHeadersByCandidateId?.get(candidate.id)),
  );
  const diffs = diffBusinessServiceRows({
    sourceLineageId: input.sourceLineageId,
    rows,
    existing: current,
    sourceBindings: bindings,
  }).slice(0, rows.length);
  const identities = new Map<string, number>();
  const externals = new Map<string, number>();
  for (const row of rows) {
    const identity = businessOfferingIdentityKey(row);
    identities.set(identity, (identities.get(identity) ?? 0) + 1);
    const external = normalizeBusinessExternalId(row.externalId);
    if (external) externals.set(external, (externals.get(external) ?? 0) + 1);
  }
  const currentIdentities = new Map<string, number>();
  for (const offering of current) {
    const identity = businessOfferingIdentityKey(offering.value);
    currentIdentities.set(identity, (currentIdentities.get(identity) ?? 0) + 1);
  }
  const bindingIdentities = new Map<string, number>();
  const bindingExternals = new Map<string, number>();
  for (const binding of bindings) {
    bindingIdentities.set(
      binding.identityKey,
      (bindingIdentities.get(binding.identityKey) ?? 0) + 1,
    );
    const external = normalizeBusinessExternalId(binding.externalKey);
    bindingExternals.set(external, (bindingExternals.get(external) ?? 0) + 1);
  }
  const byCandidateId = new Map<string, BusinessServiceDiffCandidate>();
  importedCandidates.forEach((candidate, index) => {
    const row = rows[index]!;
    let diff = diffs[index]!;
    const identity = businessOfferingIdentityKey(row);
    const external = normalizeBusinessExternalId(row.externalId);
    if (
      (identities.get(identity) ?? 0) > 1 ||
      (external && (externals.get(external) ?? 0) > 1) ||
      (!external && (bindingIdentities.get(identity) ?? 0) > 1) ||
      (!external && (currentIdentities.get(identity) ?? 0) > 1) ||
      (external && (bindingExternals.get(external) ?? 0) > 1)
    ) {
      diff = conflict(diff, "BUSINESS_IMPORT_AMBIGUOUS_IDENTITY");
    }
    byCandidateId.set(candidate.id, diff);
  });
  return input.candidates.map((candidate) => {
    const proposed = parsedCandidate(
      candidate,
      0,
      input.evidenceHeadersByCandidateId?.get(candidate.id),
    );
    const diff = byCandidateId.get(candidate.id) ?? {
      candidateKey: candidate.candidateKey,
      action: "MISSING" as const,
      riskLevel: "HIGH" as const,
      confidence: "CONFIRMED_FORMAT" as const,
      proposed: null,
      current: candidate.targetOfferingId
        ? (currentById.get(candidate.targetOfferingId) ?? null)
        : null,
      targetOfferingId:
        candidate.targetOfferingId && currentById.has(candidate.targetOfferingId)
          ? candidate.targetOfferingId
          : null,
      sourceExternalKey: proposed.externalId,
      identityKey: businessOfferingIdentityKey(proposed),
      proposedValueHash: null,
      diagnostics: [
        {
          severity: "WARNING" as const,
          code: "BUSINESS_IMPORT_MISSING_FROM_REVISION",
          message: "This existing service is absent from the imported file and remains unchanged.",
        },
      ],
    };
    if (diff.proposed && diff.proposedValueHash !== candidate.normalizedValueHash) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_CANDIDATE_INTEGRITY_FAILED",
        "A candidate no longer matches its immutable value hash.",
      );
    }
    const validationCodes = jsonArray(diff.diagnostics.map(diagnosticValue));
    const recomputedReasons = jsonArray(reasonCodes(diff));
    const requiresApproval = diff.riskLevel === "HIGH" && ["ADD", "UPDATE"].includes(diff.action);
    const requiredPermission = requiresApproval ? "business_information.approve" : "";
    const changed =
      candidate.decision !== "APPLIED" &&
      (candidate.action !== diff.action ||
        candidate.semanticTargetKey !== diff.identityKey ||
        candidate.targetOfferingId !== diff.targetOfferingId ||
        candidate.currentFingerprint !== (diff.current?.valueHash ?? null) ||
        candidate.risk !== diff.riskLevel ||
        candidate.confidence !== diff.confidence ||
        candidate.requiresApproval !== requiresApproval ||
        candidate.requiredPermission !== requiredPermission ||
        businessImportManifestHash(candidate.validationCodes ?? []) !==
          businessImportManifestHash(validationCodes) ||
        businessImportManifestHash(candidate.reasonCodes ?? []) !==
          businessImportManifestHash(recomputedReasons));
    return {
      candidate,
      diff,
      validationCodes,
      reasonCodes: recomputedReasons,
      requiresApproval,
      requiredPermission,
      changed,
    };
  });
}

@Injectable()
export class BusinessImportRebaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
    @Inject(BusinessImportViewService) private readonly views: BusinessImportViewService,
    @Inject(BusinessInformationStateService)
    private readonly informationState: BusinessInformationStateService,
  ) {}

  async rebase(
    context: RequestContext,
    importId: string,
    ifMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportView> {
    this.assertEditor(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/rebase`,
        key: idempotencyKey,
        request: { importId, ifMatch },
        transactionTimeoutMs: 120_000,
      },
      async (tx) => {
        const state = await this.informationState.ensureInTransaction(tx, context);
        await tx.$queryRaw(Prisma.sql`
          SELECT "tenantId"
          FROM "BusinessInformationState"
          WHERE "tenantId" = ${context.tenantId}
          FOR SHARE
        `);
        const importRecord = await this.lockImport(tx, context, importId);
        assertBusinessImportIfMatch(ifMatch, businessImportEtag(importId, importRecord.etag));
        await this.lockOfferings(tx, context.tenantId);
        const offerings = await tx.businessOffering.findMany({
          where: { tenantId: context.tenantId, archivedAt: null },
          include: {
            prices: true,
            duration: true,
            sourceBindings: true,
          },
          orderBy: { id: "asc" },
        });
        const candidates = await tx.businessImportCandidate.findMany({
          where: { tenantId: context.tenantId, importId },
          orderBy: [{ candidateKey: "asc" }, { id: "asc" }],
        });
        const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const exactEvidence = await tx.businessImportCandidateEvidence.findMany({
          where: {
            tenantId: context.tenantId,
            importId,
            candidateId: { in: candidates.map((candidate) => candidate.id) },
          },
        });
        const allowedHeaders = new Set<string>(BUSINESS_SERVICES_CSV_HEADERS);
        const evidenceHeadersByCandidateId = new Map<string, Set<BusinessServiceCsvHeader>>();
        for (const item of exactEvidence) {
          const candidate = candidateById.get(item.candidateId);
          if (
            !candidate ||
            item.candidateVersion !== candidate.version ||
            item.candidateValueHash !== candidate.normalizedValueHash
          )
            continue;
          if (businessImportEvidenceRecordHash(item) !== item.evidenceRecordHash) {
            this.evidenceIntegrityFailed();
          }
          const header = record(item.locator).header;
          if (typeof header !== "string" || !allowedHeaders.has(header)) continue;
          const headers = evidenceHeadersByCandidateId.get(candidate.id) ?? new Set();
          headers.add(header as BusinessServiceCsvHeader);
          evidenceHeadersByCandidateId.set(candidate.id, headers);
        }
        const rebased = recomputeBusinessImportCandidates({
          sourceLineageId: importRecord.source.lineageKey,
          candidates,
          offerings,
          sourceId: importRecord.sourceId,
          evidenceHeadersByCandidateId,
        });
        const now = new Date();
        for (const item of rebased.filter((candidate) => candidate.changed)) {
          await this.reviseCandidate(tx, context, importRecord, item, now);
        }
        const currentCandidates = await tx.businessImportCandidate.findMany({
          where: { tenantId: context.tenantId, importId },
          include: { approvalGrants: true },
          orderBy: [{ candidateKey: "asc" }, { id: "asc" }],
        });
        const pendingApprovals = await tx.businessImportCandidateApproval.count({
          where: {
            tenantId: context.tenantId,
            importId,
            state: "PENDING",
          },
        });
        const counts = {
          total: currentCandidates.length,
          valid: currentCandidates.filter((item) => item.action !== "INVALID").length,
          invalid: currentCandidates.filter((item) => item.action === "INVALID").length,
          additions: currentCandidates.filter((item) => item.action === "ADD").length,
          updates: currentCandidates.filter((item) => item.action === "UPDATE").length,
          linked: currentCandidates.filter((item) => item.action === "LINK").length,
          unchanged: currentCandidates.filter((item) => item.action === "UNCHANGED").length,
          conflicts: currentCandidates.filter((item) => item.action === "CONFLICT").length,
          pendingApproval: currentCandidates.filter(
            (item) =>
              item.requiresApproval &&
              !item.approvalGrants.some(
                (grant) =>
                  grant.candidateVersion === item.version &&
                  grant.candidateValueHash === item.normalizedValueHash,
              ),
          ).length,
          applied: currentCandidates.filter((item) => item.decision === "APPLIED").length,
        };
        const safeSummary = record(importRecord.safeSummary);
        const updated = await tx.businessImport.updateMany({
          where: {
            id: importId,
            tenantId: context.tenantId,
            etag: importRecord.etag,
            generation: importRecord.generation,
          },
          data: {
            baseBusinessRevisionId: state.currentRevisionId,
            baseInformationRevision: state.revision,
            baseInformationHash: state.canonicalHash,
            state: pendingApprovals > 0 ? "AWAITING_APPROVAL" : "READY_FOR_REVIEW",
            safeSummary: { ...safeSummary, counts },
            failureCode: null,
            failureStage: null,
            retryable: false,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.revisionConflict();
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.rebased",
            entityType: "business_import",
            entityId: importId,
            payload: {
              previousBaseRevision: importRecord.baseInformationRevision,
              resultingBaseRevision: state.revision,
              changedCandidateCount: rebased.filter((item) => item.changed).length,
              candidateCount: rebased.length,
            },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { importId },
          responseRef: importId,
        };
      },
    );
    return this.views.get(context, outcome.responseBody.importId);
  }

  private async reviseCandidate(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    importRecord: Prisma.BusinessImportGetPayload<{ include: { source: true } }>,
    item: RebasedCandidate,
    now: Date,
  ) {
    const candidate = item.candidate;
    if (candidate.decision === "APPLIED") return;
    const previous = await tx.businessImportCandidateRevision.findFirst({
      where: {
        tenantId: context.tenantId,
        sourceId: importRecord.sourceId,
        importId: importRecord.id,
        candidateId: candidate.id,
        version: candidate.version,
        normalizedValueHash: candidate.normalizedValueHash,
      },
    });
    if (!previous) this.revisionConflict();
    const evidence = await tx.businessImportCandidateEvidence.findMany({
      where: {
        tenantId: context.tenantId,
        importId: importRecord.id,
        candidateId: candidate.id,
        candidateVersion: candidate.version,
        candidateValueHash: candidate.normalizedValueHash,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (
      evidence.some((entry) => businessImportEvidenceRecordHash(entry) !== entry.evidenceRecordHash)
    )
      this.evidenceIntegrityFailed();
    if (evidence.length) {
      const evidenceLedgerIds = [...new Set(evidence.map((entry) => entry.excerptObjectLedgerId))];
      const ledgers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "BusinessImportObjectLedger"
        WHERE "tenantId" = ${context.tenantId}
          AND "id" IN (${Prisma.join(evidenceLedgerIds)})
          AND "objectKind" = 'EVIDENCE_EXCERPT'::"BusinessImportObjectKind"
          AND "deletionState" = 'RETAINED'::"BusinessImportArtifactDeletionState"
          AND ("retainUntil" IS NULL OR "retainUntil" > ${now})
        ORDER BY "id" ASC
        FOR SHARE
      `);
      if (new Set(ledgers.map((ledger) => ledger.id)).size !== evidenceLedgerIds.length) {
        throw businessImportError(
          HttpStatus.CONFLICT,
          "BUSINESS_IMPORT_EVIDENCE_EXPIRED",
          "The candidate evidence expired before the import could be rebased.",
        );
      }
    }
    await this.invalidateApprovals(tx, candidate, context.userId, now);
    const nextVersion = candidate.version + 1;
    const currentFingerprint = item.diff.current?.valueHash ?? null;
    const clonedEvidence = evidence.map((entry) => ({ entry, id: randomUUID() }));
    let fieldProvenance: ReturnType<typeof remapBusinessImportFieldProvenance>;
    try {
      fieldProvenance = remapBusinessImportFieldProvenance(
        previous.fieldProvenance,
        new Map(clonedEvidence.map(({ entry, id }) => [entry.id, id])),
      );
    } catch {
      this.revisionConflict();
    }
    await tx.businessImportCandidateRevision.create({
      data: {
        tenantId: context.tenantId,
        sourceId: importRecord.sourceId,
        importId: importRecord.id,
        candidateId: candidate.id,
        version: nextVersion,
        parsedRevisionId: previous.parsedRevisionId,
        importGeneration: previous.importGeneration,
        artifactId: previous.artifactId,
        artifactSha256: previous.artifactSha256,
        parsedManifestHash: previous.parsedManifestHash,
        mappingId: previous.mappingId,
        targetCategory: previous.targetCategory,
        semanticTargetKey: item.diff.identityKey,
        action: item.diff.action,
        normalizedValue: candidate.normalizedValue as Prisma.InputJsonValue,
        normalizedValueHash: candidate.normalizedValueHash,
        fieldProvenance,
        targetOfferingId: item.diff.targetOfferingId,
        currentFingerprint,
        risk: item.diff.riskLevel,
        confidence: item.diff.confidence,
        validationCodes: item.validationCodes,
        reasonCodes: item.reasonCodes,
        requiresApproval: item.requiresApproval,
        requiredPermission: item.requiredPermission,
      },
    });
    for (const { entry, id } of clonedEvidence) {
      const evidenceRecord = {
        id,
        tenantId: context.tenantId,
        sourceId: importRecord.sourceId,
        importId: importRecord.id,
        candidateId: candidate.id,
        candidateVersion: nextVersion,
        candidateValueHash: candidate.normalizedValueHash,
        artifactId: entry.artifactId,
        artifactSha256: entry.artifactSha256,
        importGeneration: entry.importGeneration,
        parsedRevisionId: entry.parsedRevisionId,
        parsedManifestHash: entry.parsedManifestHash,
        semanticElementId: entry.semanticElementId,
        semanticTableId: entry.semanticTableId,
        locator: entry.locator as Prisma.InputJsonValue,
        sourceValueHash: entry.sourceValueHash,
        excerptHash: entry.excerptHash,
        excerptObjectKey: entry.excerptObjectKey,
        excerptEncryptionKeyRef: entry.excerptEncryptionKeyRef,
        excerptObjectLedgerId: entry.excerptObjectLedgerId,
        excerptObjectKind: "EVIDENCE_EXCERPT" as const,
        parserVersion: entry.parserVersion,
        ocrVersion: entry.ocrVersion,
        extractionContractVersion: entry.extractionContractVersion,
      };
      await tx.businessImportCandidateEvidence.create({
        data: {
          ...evidenceRecord,
          evidenceRecordHash: businessImportEvidenceRecordHash(evidenceRecord),
        },
      });
    }
    const updated = await tx.businessImportCandidate.updateMany({
      where: {
        id: candidate.id,
        tenantId: context.tenantId,
        importId: importRecord.id,
        version: candidate.version,
        normalizedValueHash: candidate.normalizedValueHash,
        etag: candidate.etag,
      },
      data: {
        semanticTargetKey: item.diff.identityKey,
        action: item.diff.action,
        targetOfferingId: item.diff.targetOfferingId,
        currentFingerprint,
        risk: item.diff.riskLevel,
        confidence: item.diff.confidence,
        validationCodes: item.validationCodes,
        reasonCodes: item.reasonCodes,
        requiresApproval: item.requiresApproval,
        requiredPermission: item.requiredPermission,
        version: nextVersion,
        etag: { increment: 1 },
        decision: "PENDING",
        decidedByUserId: null,
        decidedAt: null,
        staleAt: null,
      },
    });
    if (updated.count !== 1) this.revisionConflict();
  }

  private async lockImport(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    importId: string,
  ) {
    const membership = await tx.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: context.tenantId, userId: context.userId },
      },
      include: {
        user: { select: { deletedAt: true } },
        tenant: { select: { deletedAt: true, status: true } },
      },
    });
    if (
      !membership ||
      !["OWNER", "ADMIN", "MANAGER"].includes(membership.role) ||
      membership.user.deletedAt ||
      membership.tenant.deletedAt ||
      !["ACTIVE", "TRIALING"].includes(membership.tenant.status)
    ) {
      this.permissionDenied();
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImport"
      WHERE "id" = ${importId} AND "tenantId" = ${context.tenantId}
      FOR UPDATE
    `);
    const value = await tx.businessImport.findFirst({
      where: { id: importId, tenantId: context.tenantId },
      include: { source: true },
    });
    if (!value) this.notFound();
    if (!["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(value.state)) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_STATE_CONFLICT",
        "The import is not ready to be rebased.",
      );
    }
    return value;
  }

  private async lockOfferings(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessOffering"
      WHERE "tenantId" = ${tenantId} AND "archivedAt" IS NULL
      ORDER BY "id" ASC
      FOR SHARE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT price."id"
      FROM "BusinessOfferingPrice" AS price
      JOIN "BusinessOffering" AS offering ON offering."id" = price."offeringId"
      WHERE price."tenantId" = ${tenantId}
        AND offering."tenantId" = ${tenantId}
        AND offering."archivedAt" IS NULL
      ORDER BY price."offeringId" ASC, price."id" ASC
      FOR SHARE OF price
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT duration."id"
      FROM "BusinessOfferingDuration" AS duration
      JOIN "BusinessOffering" AS offering ON offering."id" = duration."offeringId"
      WHERE duration."tenantId" = ${tenantId}
        AND offering."tenantId" = ${tenantId}
        AND offering."archivedAt" IS NULL
      ORDER BY duration."offeringId" ASC, duration."id" ASC
      FOR SHARE OF duration
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT binding."id"
      FROM "BusinessOfferingSourceBinding" AS binding
      JOIN "BusinessOffering" AS offering ON offering."id" = binding."offeringId"
      WHERE binding."tenantId" = ${tenantId}
        AND offering."tenantId" = ${tenantId}
        AND offering."archivedAt" IS NULL
      ORDER BY binding."sourceId" ASC, binding."externalKey" ASC, binding."id" ASC
      FOR SHARE OF binding
    `);
  }

  private async invalidateApprovals(
    tx: Prisma.TransactionClient,
    candidate: CandidateRow,
    actorUserId: string,
    now: Date,
  ) {
    await tx.businessImportCandidateApproval.updateMany({
      where: {
        tenantId: candidate.tenantId,
        candidateId: candidate.id,
        candidateVersion: candidate.version,
        candidateValueHash: candidate.normalizedValueHash,
        state: "PENDING",
      },
      data: {
        state: "INVALIDATED",
        decidedByUserId: actorUserId,
        decisionReason: "CANDIDATE_REBASED",
        decidedAt: now,
        invalidatedAt: now,
        etag: { increment: 1 },
      },
    });
    await tx.businessImportCandidateApproval.updateMany({
      where: {
        tenantId: candidate.tenantId,
        candidateId: candidate.id,
        candidateVersion: candidate.version,
        candidateValueHash: candidate.normalizedValueHash,
        state: { in: ["APPROVED", "REJECTED"] },
      },
      data: {
        state: "INVALIDATED",
        invalidatedAt: now,
        etag: { increment: 1 },
      },
    });
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private permissionDenied(): never {
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "The current user cannot rebase this import.",
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }

  private revisionConflict(): never {
    throw businessImportError(
      HttpStatus.PRECONDITION_FAILED,
      "BUSINESS_IMPORT_REVISION_CONFLICT",
      "The import changed while it was being rebased.",
    );
  }

  private evidenceIntegrityFailed(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_EVIDENCE_INTEGRITY_FAILED",
      "The candidate evidence could not be verified. Re-import the source file.",
    );
  }
}
