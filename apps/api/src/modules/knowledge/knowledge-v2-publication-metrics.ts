import type { PrismaClient } from "@leadvirt/db";
import { incrementCounter, observeHistogram } from "../metrics/metrics.registry.js";

type PublicationOperation = "PUBLISH" | "ROLLBACK" | "UNKNOWN";
type PublicationResult = "succeeded" | "blocked" | "failed";
type SourceKind = "website" | "manual" | "other";
type ItemKind = "document" | "fact" | "guidance" | "none";

const durationBuckets = [
  0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 900, 3_600, 21_600, 86_400, 604_800, 2_592_000,
];

function secondsBetween(start: Date, end: Date) {
  return Math.max(0, Math.min(31_536_000, (end.getTime() - start.getTime()) / 1_000));
}

function operationLabel(operation: PublicationOperation) {
  return operation === "PUBLISH" ? "publish" : operation === "ROLLBACK" ? "rollback" : "unknown";
}

function sourceKind(value: string | null | undefined): SourceKind {
  if (value === "WEBSITE") return "website";
  if (value === "MANUAL") return "manual";
  return "other";
}

function itemKind(value: string): ItemKind {
  if (value === "DOCUMENT_REVISION") return "document";
  if (value === "FACT_VERSION") return "fact";
  if (value === "GUIDANCE_RULE_VERSION") return "guidance";
  return "none";
}

function blockedFailure(code: string) {
  return ["BASE_CHANGED", "CRITICAL_EVALUATION", "PERMISSION", "STALE", "VALIDATION"].some(
    (token) => code.includes(token),
  );
}

async function publicationTelemetry(
  prisma: Pick<PrismaClient, "knowledgePublication">,
  tenantId: string,
  publicationId: string,
) {
  return prisma.knowledgePublication.findFirst({
    where: { id: publicationId, tenantId, corpusKind: "STRUCTURED_V2" },
    select: {
      createdAt: true,
      activatedAt: true,
      validation: { select: { createdAt: true } },
      items: {
        select: {
          itemType: true,
          factVersion: { select: { createdAt: true } },
          guidanceRuleVersion: { select: { createdAt: true } },
          v2DocumentRevision: {
            select: {
              createdAt: true,
              document: { select: { source: { select: { kind: true } } } },
            },
          },
        },
      },
    },
  });
}

function itemSource(item: {
  itemType: string;
  v2DocumentRevision: { document: { source: { kind: string } } } | null;
}): SourceKind {
  if (item.itemType === "FACT_VERSION" || item.itemType === "GUIDANCE_RULE_VERSION") {
    return "manual";
  }
  return sourceKind(item.v2DocumentRevision?.document.source.kind);
}

function aggregateSource(items: Array<Parameters<typeof itemSource>[0]>): SourceKind {
  const sources = new Set(items.map(itemSource));
  return sources.size === 1 ? (sources.values().next().value ?? "other") : "other";
}

function recordOutcome(input: {
  result: PublicationResult;
  operation: PublicationOperation;
  sourceKind: SourceKind;
  durationSeconds?: number;
}) {
  const labels = {
    result: input.result,
    operation: operationLabel(input.operation),
    item_kind: "none",
    source_kind: input.sourceKind,
  };
  incrementCounter(
    "leadvirt_knowledge_publication_outcomes_total",
    "Durable Knowledge v2 publication outcomes.",
    ["result", "operation", "item_kind", "source_kind"],
    labels,
  );
  if (input.durationSeconds !== undefined) {
    observeHistogram(
      "leadvirt_knowledge_publication_duration_seconds",
      "Knowledge v2 publication duration to a durable terminal outcome.",
      ["result", "operation", "item_kind", "source_kind"],
      durationBuckets,
      labels,
      input.durationSeconds,
    );
  }
}

export async function recordKnowledgeV2PublicationSuccess(
  prisma: Pick<PrismaClient, "knowledgePublication">,
  input: {
    tenantId: string;
    publicationId: string;
    operation: Exclude<PublicationOperation, "UNKNOWN">;
  },
) {
  const publication = await publicationTelemetry(prisma, input.tenantId, input.publicationId);
  if (!publication?.activatedAt) return;
  const aggregate = aggregateSource(publication.items);
  recordOutcome({
    result: "succeeded",
    operation: input.operation,
    sourceKind: aggregate,
    durationSeconds: secondsBetween(publication.createdAt, publication.activatedAt),
  });
  const baseLabels = { result: "succeeded", item_kind: "none", source_kind: aggregate };
  observeHistogram(
    "leadvirt_knowledge_time_to_queryable_seconds",
    "Time from an immutable Knowledge v2 candidate, publication, or item to active queryability.",
    ["result", "operation", "item_kind", "source_kind"],
    durationBuckets,
    { ...baseLabels, operation: "publication" },
    secondsBetween(publication.createdAt, publication.activatedAt),
  );
  if (publication.validation) {
    observeHistogram(
      "leadvirt_knowledge_time_to_queryable_seconds",
      "Time from an immutable Knowledge v2 candidate, publication, or item to active queryability.",
      ["result", "operation", "item_kind", "source_kind"],
      durationBuckets,
      { ...baseLabels, operation: "candidate" },
      secondsBetween(publication.validation.createdAt, publication.activatedAt),
    );
  }
  for (const item of publication.items) {
    const createdAt =
      item.factVersion?.createdAt ??
      item.guidanceRuleVersion?.createdAt ??
      item.v2DocumentRevision?.createdAt;
    if (!createdAt) continue;
    observeHistogram(
      "leadvirt_knowledge_time_to_queryable_seconds",
      "Time from an immutable Knowledge v2 candidate, publication, or item to active queryability.",
      ["result", "operation", "item_kind", "source_kind"],
      durationBuckets,
      {
        result: "succeeded",
        operation: "item",
        item_kind: itemKind(item.itemType),
        source_kind: itemSource(item),
      },
      secondsBetween(createdAt, publication.activatedAt),
    );
  }
}

export async function recordKnowledgeV2PublicationFailure(
  prisma: Pick<PrismaClient, "knowledgePublication">,
  input: {
    tenantId: string;
    publicationId?: string | null;
    operation: PublicationOperation;
    code: string;
  },
) {
  const publication = input.publicationId
    ? await publicationTelemetry(prisma, input.tenantId, input.publicationId)
    : null;
  recordOutcome({
    result: blockedFailure(input.code) ? "blocked" : "failed",
    operation: input.operation,
    sourceKind: publication ? aggregateSource(publication.items) : "other",
    ...(publication ? { durationSeconds: secondsBetween(publication.createdAt, new Date()) } : {}),
  });
}
