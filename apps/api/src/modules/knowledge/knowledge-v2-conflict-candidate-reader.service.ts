import { createHash, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  compareKnowledgeCanonicalText,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
} from "@leadvirt/knowledge";
import { AppConfigService } from "../../config/app-config.service.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { canonicalKnowledgeV2Hash, knowledgeV2Error } from "./knowledge-v2-http.js";

const restrictedReferencePrefix = "lvobj:v1:";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const readableSourceStatuses = new Set(["SYNCING", "READY", "PAUSED"]);
const readableRevisionStatuses = new Set(["READY", "NEEDS_REVIEW", "PUBLISHED", "SUPERSEDED"]);
const readableDocumentStatuses = new Set(["ACTIVE", "NEEDS_REVIEW"]);
const reviewerRoles = new Set(["OWNER", "ADMIN", "MANAGER"]);
const maximumRestrictedBytes = 32 * 1024;

type DatabaseClient = PrismaService | Prisma.TransactionClient;

const documentLineageSelect = {
  id: true,
  tenantId: true,
  contentHash: true,
  generation: true,
  status: true,
  deletedAt: true,
  sourcePermissionFingerprint: true,
  document: {
    select: {
      id: true,
      status: true,
      classification: true,
      audience: true,
      permissionVersion: true,
      deletionGeneration: true,
      tombstonedAt: true,
      deletedAt: true,
      currentDraftRevisionId: true,
      currentPublishedRevisionId: true,
      source: {
        select: {
          id: true,
          status: true,
          sourcePermissionVersion: true,
          generation: true,
          etag: true,
          defaultScope: true,
          defaultClassification: true,
          defaultLocale: true,
          tombstonedAt: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.KnowledgeV2DocumentRevisionSelect;

const candidateInclude = {
  conflict: {
    select: {
      id: true,
      status: true,
      severity: true,
      candidateSetHash: true,
      candidates: {
        select: {
          id: true,
          ordinal: true,
          candidateType: true,
          itemVersionHash: true,
          candidateValueHash: true,
          restrictedValueRef: true,
        },
        orderBy: [{ ordinal: "asc" as const }, { id: "asc" as const }],
      },
    },
  },
  documentRevision: { select: documentLineageSelect },
  factVersion: {
    select: {
      id: true,
      immutableHash: true,
      displayValue: true,
      normalizedValue: true,
      fact: { select: { id: true, deletedAt: true } },
    },
  },
  guidanceRuleVersion: {
    select: {
      id: true,
      immutableHash: true,
      instruction: true,
      guidanceRule: { select: { id: true, deletedAt: true } },
    },
  },
  evidenceLinks: {
    include: {
      evidenceReference: {
        include: {
          documentRevision: { select: documentLineageSelect },
        },
      },
    },
    orderBy: [{ ordinal: "asc" as const }, { evidenceReferenceId: "asc" as const }],
  },
} satisfies Prisma.KnowledgeV2ConflictCandidateInclude;

type CandidateRecord = Prisma.KnowledgeV2ConflictCandidateGetPayload<{
  include: typeof candidateInclude;
}>;
type DocumentLineage = NonNullable<CandidateRecord["documentRevision"]>;

export interface KnowledgeV2ConflictCandidateHydration {
  value: string;
  valueHash: string;
  authorizationHash: string;
  restricted: boolean;
}

interface RestrictedReferencePayload {
  version: number;
  key: string;
  encryptionKeyRef: string;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

const allowedAudiences = new Set(["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"]);

function strictAudienceArray(value: Prisma.JsonValue) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > allowedAudiences.size ||
    value.some((item) => typeof item !== "string" || !allowedAudiences.has(item))
  ) {
    throw new Error("invalid audience");
  }
  return [...new Set(value as string[])].sort();
}

function scopeAudiences(value: Prisma.JsonValue | null) {
  if (value === null) return null;
  if (Array.isArray(value) || typeof value !== "object") throw new Error("invalid source scope");
  const audiences = value.audiences;
  return audiences === undefined ? null : strictAudienceArray(audiences);
}

function sourcePermissionFingerprint(lineage: DocumentLineage) {
  const source = lineage.document.source;
  return canonicalKnowledgeV2Hash({
    tenantId: lineage.tenantId,
    sourceId: source.id,
    permissionVersion: source.sourcePermissionVersion,
    scope: source.defaultScope,
    classification: source.defaultClassification,
    locale: source.defaultLocale,
  });
}

@Injectable()
export class KnowledgeV2ConflictCandidateReaderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async hydrateForDetail(
    context: RequestContext,
    conflictId: string,
    candidateId: string,
  ): Promise<KnowledgeV2ConflictCandidateHydration | null> {
    try {
      return await this.hydrate(this.prisma, {
        tenantId: context.tenantId,
        userId: context.userId,
        conflictId,
        candidateId,
      });
    } catch {
      return null;
    }
  }

  async requireHydration(
    db: DatabaseClient,
    input: {
      tenantId: string;
      userId: string;
      conflictId: string;
      candidateId: string;
      expectedAuthorizationHash?: string;
      allowTerminalConflict?: boolean;
    },
  ) {
    const hydration = await this.hydrate(db, input).catch(() => null);
    if (
      !hydration ||
      (input.expectedAuthorizationHash &&
        hydration.authorizationHash !== input.expectedAuthorizationHash)
    ) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_CONFLICT_VALUE_HYDRATION_REQUIRED",
        "Candidate values are not safely available for this resolution.",
        { field: "resolution" },
      );
    }
    return hydration;
  }

  private async hydrate(
    db: DatabaseClient,
    input: {
      tenantId: string;
      userId: string;
      conflictId: string;
      candidateId: string;
      allowTerminalConflict?: boolean;
    },
  ): Promise<KnowledgeV2ConflictCandidateHydration> {
    const [membership, candidate] = await Promise.all([
      db.membership.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: { in: ["OWNER", "ADMIN", "MANAGER"] },
          user: { deletedAt: null },
          tenant: { deletedAt: null, status: { in: ["TRIALING", "ACTIVE"] } },
        },
        select: { role: true },
      }),
      db.knowledgeV2ConflictCandidate.findFirst({
        where: {
          tenantId: input.tenantId,
          id: input.candidateId,
          conflictId: input.conflictId,
        },
        include: candidateInclude,
      }),
    ]);
    if (!membership || !reviewerRoles.has(membership.role) || !candidate) throw new Error("denied");
    if (
      !input.allowTerminalConflict &&
      ["RESOLVED", "DISMISSED", "SUPERSEDED"].includes(candidate.conflict.status)
    ) {
      throw new Error("terminal");
    }
    if (
      membership.role === "MANAGER" &&
      (candidate.conflict.severity === "HIGH" || candidate.conflict.severity === "CRITICAL")
    ) {
      throw new Error("elevated");
    }

    this.assertCandidateTarget(candidate);
    const lineagePins = this.authorizedLineages(candidate, membership.role);
    const evidencePins = candidate.evidenceLinks.map((link) => {
      const evidence = link.evidenceReference;
      if (evidence.expiresAt && evidence.expiresAt <= new Date()) throw new Error("expired");
      const lineage = evidence.documentRevision;
      if (lineage) {
        const fingerprint = this.assertLineage(lineage, membership.role);
        if (
          evidence.v2DocumentRevisionId !== lineage.id ||
          evidence.itemVersionHash !== lineage.contentHash ||
          evidence.permissionFingerprint !== fingerprint
        ) {
          throw new Error("evidence fence");
        }
      } else if (membership.role === "MANAGER" && !evidence.isPublic) {
        throw new Error("evidence denied");
      }
      return {
        id: evidence.id,
        ordinal: link.ordinal,
        itemVersionHash: evidence.itemVersionHash,
        permissionFingerprint: evidence.permissionFingerprint,
        isPublic: evidence.isPublic,
        restrictedPayloadRefHash: evidence.restrictedPayloadRef
          ? sha256(evidence.restrictedPayloadRef)
          : null,
      };
    });

    let value: string;
    let valueHash: string;
    if (candidate.restrictedValueRef) {
      if (lineagePins.length === 0 || candidate.evidenceLinks.length === 0) {
        throw new Error("restricted lineage missing");
      }
      const bytes = await this.readRestricted(
        candidate.restrictedValueRef,
        candidate.candidateValueHash,
      );
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valueHash = sha256(bytes);
    } else {
      value = this.publicValue(candidate);
      valueHash = candidate.candidateValueHash;
    }
    if (!value.trim() || Buffer.byteLength(value, "utf8") > maximumRestrictedBytes) {
      throw new Error("invalid value");
    }

    const authorizationHash = canonicalKnowledgeV2Hash({
      version: 1,
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorRole: membership.role,
      conflictId: candidate.conflictId,
      conflictStatus: candidate.conflict.status,
      conflictSeverity: candidate.conflict.severity,
      candidateSetHash: candidate.conflict.candidateSetHash,
      candidateMembership: candidate.conflict.candidates.map((item) => ({
        id: item.id,
        ordinal: item.ordinal,
        candidateType: item.candidateType,
        itemVersionHash: item.itemVersionHash,
        candidateValueHash: item.candidateValueHash,
        restrictedValueRefHash: item.restrictedValueRef ? sha256(item.restrictedValueRef) : null,
      })),
      candidateId: candidate.id,
      candidateOrdinal: candidate.ordinal,
      candidateType: candidate.candidateType,
      itemVersionHash: candidate.itemVersionHash,
      candidateValueHash: candidate.candidateValueHash,
      restrictedValueRefHash: candidate.restrictedValueRef
        ? sha256(candidate.restrictedValueRef)
        : null,
      valueHash,
      lineagePins,
      evidencePins,
    });
    return {
      value,
      valueHash,
      authorizationHash,
      restricted: Boolean(candidate.restrictedValueRef),
    };
  }

  private assertCandidateTarget(candidate: CandidateRecord) {
    if (candidate.candidateType === "DOCUMENT_REVISION") {
      if (
        !candidate.documentRevision ||
        candidate.documentRevision.contentHash !== candidate.itemVersionHash
      ) {
        throw new Error("document target");
      }
      return;
    }
    if (candidate.candidateType === "FACT_VERSION") {
      if (
        !candidate.factVersion ||
        candidate.factVersion.immutableHash !== candidate.itemVersionHash ||
        candidate.factVersion.fact.deletedAt
      ) {
        throw new Error("fact target");
      }
      return;
    }
    if (
      !candidate.guidanceRuleVersion ||
      candidate.guidanceRuleVersion.immutableHash !== candidate.itemVersionHash ||
      candidate.guidanceRuleVersion.guidanceRule.deletedAt
    ) {
      throw new Error("guidance target");
    }
  }

  private authorizedLineages(candidate: CandidateRecord, role: string) {
    const lineages = [
      ...(candidate.documentRevision ? [candidate.documentRevision] : []),
      ...candidate.evidenceLinks.flatMap((link) =>
        link.evidenceReference.documentRevision ? [link.evidenceReference.documentRevision] : [],
      ),
    ];
    const unique = new Map(lineages.map((lineage) => [lineage.id, lineage]));
    return [...unique.values()]
      .sort((left, right) => compareKnowledgeCanonicalText(left.id, right.id))
      .map((lineage) => {
        const permissionFingerprint = this.assertLineage(lineage, role);
        const document = lineage.document;
        const source = document.source;
        return {
          revisionId: lineage.id,
          revisionGeneration: lineage.generation,
          revisionContentHash: lineage.contentHash,
          revisionStatus: lineage.status,
          sourcePermissionFingerprint: permissionFingerprint,
          documentId: document.id,
          documentStatus: document.status,
          classification: document.classification,
          audiences: this.audiences(
            document.audience,
            source.defaultScope,
            document.classification,
          ),
          permissionVersion: document.permissionVersion,
          deletionGeneration: document.deletionGeneration,
          currentDraftRevisionId: document.currentDraftRevisionId,
          currentPublishedRevisionId: document.currentPublishedRevisionId,
          sourceId: source.id,
          sourceStatus: source.status,
          sourceGeneration: source.generation,
          sourceEtag: source.etag,
          sourcePermissionVersion: source.sourcePermissionVersion,
        };
      });
  }

  private assertLineage(lineage: DocumentLineage, role: string) {
    const document = lineage.document;
    const source = document.source;
    const fingerprint = sourcePermissionFingerprint(lineage);
    if (
      !readableSourceStatuses.has(source.status) ||
      source.tombstonedAt ||
      source.deletedAt ||
      !readableDocumentStatuses.has(document.status) ||
      document.tombstonedAt ||
      document.deletedAt ||
      !readableRevisionStatuses.has(lineage.status) ||
      lineage.deletedAt ||
      document.permissionVersion !== source.sourcePermissionVersion ||
      lineage.sourcePermissionFingerprint !== fingerprint
    ) {
      throw new Error("lineage revoked");
    }
    const audiences = this.audiences(
      document.audience,
      source.defaultScope,
      document.classification,
    );
    if (
      role === "MANAGER" &&
      (!["PUBLIC", "INTERNAL"].includes(document.classification) ||
        !audiences.some((audience) => audience === "PUBLIC" || audience === "INTERNAL"))
    ) {
      throw new Error("classification denied");
    }
    return fingerprint;
  }

  private audiences(
    value: Prisma.JsonValue | null,
    sourceScope: Prisma.JsonValue | null,
    classification: string,
  ) {
    if (value !== null) return strictAudienceArray(value);
    const sourceConfigured = scopeAudiences(sourceScope);
    return sourceConfigured ?? (classification === "PUBLIC" ? ["PUBLIC"] : ["INTERNAL"]);
  }

  private publicValue(candidate: CandidateRecord): string {
    const factValue = candidate.factVersion?.displayValue;
    if (candidate.candidateType === "FACT_VERSION" && factValue?.trim()) {
      return factValue;
    }
    if (
      candidate.candidateType === "GUIDANCE_RULE_VERSION" &&
      candidate.guidanceRuleVersion?.instruction.trim()
    ) {
      return candidate.guidanceRuleVersion.instruction;
    }
    throw new Error("public value unavailable");
  }

  private async readRestricted(reference: string, expectedHash: string) {
    if (!sha256Pattern.test(expectedHash)) throw new Error("invalid hash");
    const payload = this.decodeReference(reference);
    const rootPath = this.config.knowledgeObjectStorePath;
    const keyValue = this.config.knowledgeArtifactEncryptionKey;
    const keyId = this.config.knowledgeArtifactEncryptionKeyId;
    if (!rootPath || !keyValue || !keyId) throw new Error("storage unavailable");
    const store = new EncryptedFileKnowledgeObjectStore({
      rootPath,
      activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(keyValue) },
      maxPlaintextBytes: maximumRestrictedBytes,
    });
    const bytes = await store.get(payload.key, payload.encryptionKeyRef);
    const actual = Buffer.from(sha256(bytes), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new Error("hash mismatch");
    }
    return bytes;
  }

  private decodeReference(reference: string) {
    if (!reference.startsWith(restrictedReferencePrefix)) throw new Error("invalid reference");
    const payload = JSON.parse(
      Buffer.from(reference.slice(restrictedReferencePrefix.length), "base64url").toString("utf8"),
    ) as RestrictedReferencePayload;
    if (
      payload.version !== 1 ||
      typeof payload.key !== "string" ||
      !payload.key ||
      typeof payload.encryptionKeyRef !== "string" ||
      !payload.encryptionKeyRef
    ) {
      throw new Error("invalid reference");
    }
    return payload;
  }
}
