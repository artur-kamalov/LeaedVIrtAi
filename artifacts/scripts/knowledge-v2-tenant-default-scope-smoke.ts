import { createHash } from "node:crypto";
import {
  knowledgeV2StructuredAuthorizationFingerprint,
  knowledgeV2TenantDefaultScopeHash,
  parseKnowledgeV2TenantDefaultScopePolicy,
  resolveKnowledgeV2StructuredScope,
  stableKnowledgeValue,
  type KnowledgeV2PersistedScope,
} from "@leadvirt/knowledge";

let assertions = 0;

function check(condition: unknown, message: string) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const publicScope: KnowledgeV2PersistedScope = {
  brandIds: [],
  locationIds: [],
  channelTypes: [],
  assistantIds: [],
  audiences: ["PUBLIC"],
  segments: [],
  locales: [],
};
const internalScope: KnowledgeV2PersistedScope = {
  ...publicScope,
  audiences: ["INTERNAL"],
};

check(
  parseKnowledgeV2TenantDefaultScopePolicy({ scope: null, generation: 0, hash: null }) === null,
  "An unset tenant default became an authorization policy.",
);

const publicPolicy = parseKnowledgeV2TenantDefaultScopePolicy({
  scope: publicScope,
  generation: 1,
  hash: knowledgeV2TenantDefaultScopeHash(publicScope),
});
check(publicPolicy !== null, "A canonical tenant default was rejected.");

const inherited = resolveKnowledgeV2StructuredScope(null, publicPolicy);
check(
  inherited?.usesTenantDefaultScope === true &&
    inherited.tenantDefaultScopeGeneration === 1 &&
    inherited.tenantDefaultScopeHash === publicPolicy?.hash &&
    inherited.scope.audiences[0] === "PUBLIC",
  "A null structured scope did not inherit the exact policy binding.",
);

check(
  resolveKnowledgeV2StructuredScope(null, null) === null,
  "A null structured scope widened without a stored tenant default.",
);
check(
  resolveKnowledgeV2StructuredScope({}, publicPolicy) === null &&
    resolveKnowledgeV2StructuredScope({ audiences: [] }, publicPolicy) === null,
  "An explicit empty audience became a universal scope.",
);

const explicit = resolveKnowledgeV2StructuredScope(publicScope, null);
check(
  explicit?.usesTenantDefaultScope === false &&
    explicit.tenantDefaultScopeGeneration === null &&
    explicit.tenantDefaultScopeHash === null,
  "An explicit scope was bound to tenant-default state.",
);

const evidence = [
  {
    id: "evidence-1",
    kind: "MANUAL_NOTE",
    label: "Owner note",
    locator: null,
    isPublic: false,
    legacyRevisionId: null,
    sourceReference: null,
    elementReference: null,
    quoteHash: null,
    confidence: null,
  },
];
const explicitFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
  itemType: "FACT_VERSION",
  binding: explicit!,
  riskLevel: "LOW",
  authority: { authority: "OWNER_VERIFIED", verifiedByUserId: "owner-1" },
  evidence,
});
const legacyFingerprint = createHash("sha256")
  .update(
    stableKnowledgeValue({
      version: 1,
      corpusKind: "STRUCTURED_V2",
      itemType: "FACT_VERSION",
      scope: publicScope,
      riskLevel: "LOW",
      authority: { authority: "OWNER_VERIFIED", verifiedByUserId: "owner-1" },
      evidence,
    }),
  )
  .digest("hex");
check(
  explicitFingerprint === legacyFingerprint,
  "An explicit scope lost its existing authorization fingerprint.",
);

const internalPolicy = parseKnowledgeV2TenantDefaultScopePolicy({
  scope: internalScope,
  generation: 2,
  hash: knowledgeV2TenantDefaultScopeHash(internalScope),
});
const inheritedInternal = resolveKnowledgeV2StructuredScope(null, internalPolicy);
const publicFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
  itemType: "FACT_VERSION",
  binding: inherited!,
  riskLevel: "LOW",
  authority: { authority: "OWNER_VERIFIED", verifiedByUserId: "owner-1" },
  evidence,
});
const internalFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
  itemType: "FACT_VERSION",
  binding: inheritedInternal!,
  riskLevel: "LOW",
  authority: { authority: "OWNER_VERIFIED", verifiedByUserId: "owner-1" },
  evidence,
});
check(
  publicFingerprint !== internalFingerprint,
  "A changed tenant default reused an inherited authorization fingerprint.",
);
check(
  parseKnowledgeV2TenantDefaultScopePolicy({
    scope: publicScope,
    generation: 1,
    hash: "0".repeat(64),
  }) === null,
  "A mismatched tenant-default scope hash was accepted.",
);
check(
  parseKnowledgeV2TenantDefaultScopePolicy({
    scope: { ...publicScope, audiences: [] },
    generation: 1,
    hash: knowledgeV2TenantDefaultScopeHash({ ...publicScope, audiences: [] }),
  }) === null,
  "A tenant default without an audience was accepted.",
);

console.log(
  JSON.stringify({ assertions, inheritedGeneration: inherited?.tenantDefaultScopeGeneration }),
);
