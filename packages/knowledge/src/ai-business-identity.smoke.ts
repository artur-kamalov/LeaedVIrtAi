import assert from "node:assert/strict";
import {
  aiBusinessIdentityForCorpus,
  neutralAiBusinessIdentity,
  publishedAiBusinessIdentityFromFacts,
  resolveAiBusinessIdentity,
} from "./ai-business-identity.js";

const legacy = { businessName: "Live draft name", businessType: "Live draft type" };
const published = publishedAiBusinessIdentityFromFacts([
  {
    factKey: "business/name",
    displayValue: "Published name",
    normalizedValue: "Published normalized name",
  },
  {
    factKey: "business/type",
    displayValue: null,
    normalizedValue: "Published type",
  },
]);

assert.deepEqual(aiBusinessIdentityForCorpus("LEGACY_V1", legacy, published), legacy);
assert.deepEqual(aiBusinessIdentityForCorpus("STRUCTURED_V2", legacy, published), {
  businessName: "Published name",
  businessType: "Published type",
});
assert.deepEqual(
  aiBusinessIdentityForCorpus("STRUCTURED_V2", legacy, null),
  neutralAiBusinessIdentity,
);
assert.deepEqual(publishedAiBusinessIdentityFromFacts([]), neutralAiBusinessIdentity);

type ResolverDatabase = Parameters<typeof resolveAiBusinessIdentity>[0];

let structuredLegacyRead = false;
const structuredDatabase = {
  knowledgeCorpusSelector: {
    findUnique: () => Promise.resolve({ corpusKind: "STRUCTURED_V2" }),
  },
  activeKnowledgePublication: {
    findUnique: () => Promise.resolve({ publicationId: "publication-1" }),
  },
  knowledgePublication: {
    findFirst: () => Promise.resolve({ id: "publication-1" }),
  },
  knowledgePublicationItem: {
    findMany: () =>
      Promise.resolve([
        {
          factVersion: {
            displayValue: "Governed name",
            normalizedValue: "Governed name",
            fact: { factKey: "business/name" },
          },
        },
      ]),
  },
} as unknown as ResolverDatabase;
assert.deepEqual(
  await resolveAiBusinessIdentity(structuredDatabase, {
    tenantId: "tenant-1",
    legacyIdentity: () => {
      structuredLegacyRead = true;
      return legacy;
    },
  }),
  { businessName: "Governed name", businessType: null },
);
assert.equal(structuredLegacyRead, false);

let legacyPublicationRead = false;
const legacyDatabase = {
  knowledgeCorpusSelector: {
    findUnique: () => Promise.resolve({ corpusKind: "LEGACY_V1" }),
  },
  activeKnowledgePublication: {
    findUnique: () => {
      legacyPublicationRead = true;
      return Promise.resolve(null);
    },
  },
} as unknown as ResolverDatabase;
assert.deepEqual(
  await resolveAiBusinessIdentity(legacyDatabase, {
    tenantId: "tenant-1",
    legacyIdentity: () => legacy,
  }),
  legacy,
);
assert.equal(legacyPublicationRead, false);

console.log("AI business identity governance smoke passed.");
