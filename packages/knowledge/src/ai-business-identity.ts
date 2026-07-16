import type { Prisma } from "@leadvirt/db";

export interface AiBusinessIdentity {
  businessName: string;
  businessType: string | null;
}

export interface PublishedAiBusinessIdentityFact {
  factKey: string;
  displayValue: string | null;
  normalizedValue: Prisma.JsonValue;
}

type AiBusinessIdentityDatabase = Pick<
  Prisma.TransactionClient,
  | "knowledgeCorpusSelector"
  | "activeKnowledgePublication"
  | "knowledgePublication"
  | "knowledgePublicationItem"
>;

const identityFactKeys = ["business/name", "business/type"] as const;

export const neutralAiBusinessIdentity: AiBusinessIdentity = {
  businessName: "the business",
  businessType: null,
};

function nonEmptyText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function publishedAiBusinessIdentityFromFacts(
  facts: readonly PublishedAiBusinessIdentityFact[],
): AiBusinessIdentity {
  const values = new Map(
    facts.map((fact) => [
      fact.factKey,
      nonEmptyText(fact.displayValue) ?? nonEmptyText(fact.normalizedValue),
    ]),
  );
  return {
    businessName: values.get("business/name") ?? neutralAiBusinessIdentity.businessName,
    businessType: values.get("business/type") ?? null,
  };
}

export function aiBusinessIdentityForCorpus(
  corpusKind: "LEGACY_V1" | "STRUCTURED_V2",
  legacyIdentity: AiBusinessIdentity,
  publishedIdentity: AiBusinessIdentity | null,
) {
  return corpusKind === "LEGACY_V1"
    ? legacyIdentity
    : (publishedIdentity ?? neutralAiBusinessIdentity);
}

export async function resolvePublishedAiBusinessIdentity(
  db: AiBusinessIdentityDatabase,
  input: { tenantId: string; publicationId: string },
): Promise<AiBusinessIdentity | null> {
  const publication = await db.knowledgePublication.findFirst({
    where: {
      id: input.publicationId,
      tenantId: input.tenantId,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!publication) return null;

  const items = await db.knowledgePublicationItem.findMany({
    where: {
      tenantId: input.tenantId,
      publicationId: publication.id,
      corpusKind: "STRUCTURED_V2",
      itemType: "FACT_VERSION",
      factVersion: {
        fact: { factKey: { in: [...identityFactKeys] } },
      },
    },
    select: {
      factVersion: {
        select: {
          displayValue: true,
          normalizedValue: true,
          fact: { select: { factKey: true } },
        },
      },
    },
    orderBy: [{ itemId: "asc" }],
  });
  return publishedAiBusinessIdentityFromFacts(
    items.flatMap((item) =>
      item.factVersion
        ? [
            {
              factKey: item.factVersion.fact.factKey,
              displayValue: item.factVersion.displayValue,
              normalizedValue: item.factVersion.normalizedValue,
            },
          ]
        : [],
    ),
  );
}

export async function resolveAiBusinessIdentity(
  db: AiBusinessIdentityDatabase,
  input: {
    tenantId: string;
    legacyIdentity: AiBusinessIdentity | (() => AiBusinessIdentity | Promise<AiBusinessIdentity>);
  },
): Promise<AiBusinessIdentity> {
  const selector = await db.knowledgeCorpusSelector.findUnique({
    where: { tenantId: input.tenantId },
    select: { corpusKind: true },
  });
  const corpusKind = selector?.corpusKind ?? "LEGACY_V1";
  if (corpusKind === "LEGACY_V1") {
    return typeof input.legacyIdentity === "function"
      ? input.legacyIdentity()
      : input.legacyIdentity;
  }

  const pointer = await db.activeKnowledgePublication.findUnique({
    where: {
      tenantId_targetKey: { tenantId: input.tenantId, targetKey: "workspace-v2" },
    },
    select: { publicationId: true },
  });
  const publishedIdentity = pointer
    ? await resolvePublishedAiBusinessIdentity(db, {
        tenantId: input.tenantId,
        publicationId: pointer.publicationId,
      })
    : null;
  return aiBusinessIdentityForCorpus(corpusKind, neutralAiBusinessIdentity, publishedIdentity);
}
