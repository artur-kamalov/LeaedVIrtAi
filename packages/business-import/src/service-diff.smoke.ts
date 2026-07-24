import assert from "node:assert/strict";
import {
  BUSINESS_IMPORT_CATALOG_MUTATION_LIMIT,
  BUSINESS_SERVICES_CSV_HEADERS,
  applyBusinessServiceCatalogMode,
  businessImportCandidateRequiresApproval,
  businessImportManualFieldsByOffering,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  countBusinessImportCatalogMutations,
  diffBusinessServiceRows,
  isBusinessImportCatalogMutationAction,
  parseBusinessServicesCsv,
  type ParsedBusinessServiceRow,
} from "./index.js";

const first = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from("external_id,name,price_type,price_amount,currency\nsvc-1,Audit,FIXED,100,EUR\n"),
  ),
);
const original = first.rows[0] as ParsedBusinessServiceRow;
const initial = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [],
  sourceBindings: [],
});
assert.equal(initial[0]?.action, "ADD");
assert.equal(initial[0]?.riskLevel, "HIGH");
assert.equal(businessImportCandidateRequiresApproval("HIGH", "ADD"), true);
assert.equal(businessImportCandidateRequiresApproval("HIGH", "LINK"), true);
assert.equal(businessImportCandidateRequiresApproval("LOW", "LINK"), false);
assert.equal(businessImportCandidateRequiresApproval("HIGH", "UNCHANGED"), false);

const existing = {
  id: "offering-1",
  value: original,
  valueHash: businessOfferingValueHash(original),
};
const binding = {
  offeringId: existing.id,
  externalKey: "svc-1",
  identityKey: businessOfferingIdentityKey(original),
  sourceValueHash: existing.valueHash,
};
const unchanged = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(unchanged[0]?.action, "UNCHANGED");

const unboundExisting = {
  ...existing,
  value: { ...original, externalId: null },
  valueHash: businessOfferingValueHash({ ...original, externalId: null }),
};
const linked = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [unboundExisting],
  sourceBindings: [],
});
assert.equal(linked[0]?.action, "LINK");
assert.equal(linked[0]?.targetOfferingId, unboundExisting.id);
assert.equal(linked[0]?.riskLevel, "HIGH");
assert.equal(linked[0]?.proposedValueHash, businessOfferingValueHash(original));

const identityMismatchedBinding = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [unboundExisting],
  sourceBindings: [
    { ...binding, externalKey: "another-source-key", identityKey: "another-identity" },
  ],
});
assert.equal(identityMismatchedBinding[0]?.action, "CONFLICT");

const duplicateBindingTarget = { ...existing, id: "offering-2" };
const duplicateExternalBinding = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [existing, duplicateBindingTarget],
  sourceBindings: [
    binding,
    { ...binding, offeringId: duplicateBindingTarget.id, externalKey: " SVC-1 " },
  ],
});
assert.equal(duplicateExternalBinding[0]?.action, "CONFLICT");
assert.equal(duplicateExternalBinding[0]?.targetOfferingId, null);
assert.equal(duplicateExternalBinding[0]?.current, null);
assert.equal(
  duplicateExternalBinding[0]?.diagnostics.at(-1)?.code,
  "BUSINESS_IMPORT_AMBIGUOUS_SOURCE_BINDING",
);

const withoutExternalId = await parseBusinessServicesCsv(
  new Uint8Array(Buffer.from("name\nAudit\n")),
);
const identityRow = withoutExternalId.rows[0] as ParsedBusinessServiceRow;
const duplicateIdentityBinding = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [identityRow],
  existing: [existing],
  sourceBindings: [
    { ...binding, externalKey: "legacy-a", identityKey: businessOfferingIdentityKey(identityRow) },
    { ...binding, externalKey: "legacy-b", identityKey: businessOfferingIdentityKey(identityRow) },
  ],
});
assert.equal(duplicateIdentityBinding[0]?.action, "CONFLICT");
assert.equal(duplicateIdentityBinding[0]?.targetOfferingId, null);
assert.equal(
  duplicateIdentityBinding[0]?.diagnostics.at(-1)?.code,
  "BUSINESS_IMPORT_AMBIGUOUS_SOURCE_BINDING",
);

const duplicateCanonicalIdentity = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [existing, duplicateBindingTarget],
  sourceBindings: [],
});
assert.equal(duplicateCanonicalIdentity[0]?.action, "CONFLICT");
assert.equal(duplicateCanonicalIdentity[0]?.targetOfferingId, null);
assert.equal(duplicateCanonicalIdentity[0]?.current, null);
assert.equal(
  duplicateCanonicalIdentity[0]?.diagnostics.at(-1)?.code,
  "BUSINESS_IMPORT_AMBIGUOUS_CANONICAL_IDENTITY",
);

const legacySource = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from(
      [
        "category,name,description,price_type,price_from,currency,price_unit,active",
        "Installation,Air conditioner installation,Standard installation,FROM,14900,RUB,service,true",
      ].join("\n"),
    ),
  ),
);
const legacyRow = legacySource.rows[0] as ParsedBusinessServiceRow;
const legacyIdentityKey = businessOfferingIdentityKey(legacyRow);
const legacyExistingValue = { ...legacyRow, externalId: legacyIdentityKey };
const legacyExisting = {
  id: "offering-stable-id-adoption",
  value: legacyExistingValue,
  valueHash: businessOfferingValueHash(legacyExistingValue),
};
const explicitStableIdSource = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from(
      [
        "external_id,category,name,description,price_type,price_from,currency,price_unit,active",
        "SRV-001,Installation,Air conditioner installation,Standard installation,FROM,14900,RUB,per service,true",
      ].join("\n"),
    ),
  ),
);
const explicitStableIdRow = explicitStableIdSource.rows[0] as ParsedBusinessServiceRow;
const legacyBinding = {
  offeringId: legacyExisting.id,
  externalKey: legacyIdentityKey,
  identityKey: legacyIdentityKey,
  sourceValueHash: businessOfferingValueHash(legacyRow),
};
const stableIdAdoption = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [explicitStableIdRow],
  existing: [legacyExisting],
  sourceBindings: [legacyBinding],
});
assert.equal(stableIdAdoption.length, 1);
assert.equal(stableIdAdoption[0]?.action, "UPDATE");
assert.equal(stableIdAdoption[0]?.targetOfferingId, legacyExisting.id);
assert.equal(stableIdAdoption[0]?.sourceExternalKey, "SRV-001");
assert.equal(
  stableIdAdoption.some((candidate) => candidate.action === "MISSING"),
  false,
);

const ambiguousStableIdAdoption = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [explicitStableIdRow],
  existing: [legacyExisting],
  sourceBindings: [
    legacyBinding,
    { ...legacyBinding, externalKey: `${legacyIdentityKey}-duplicate` },
  ],
});
assert.equal(ambiguousStableIdAdoption[0]?.action, "CONFLICT");
assert.equal(ambiguousStableIdAdoption[0]?.targetOfferingId, legacyExisting.id);

const decimalEquivalent = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from(
      "external_id,name,price_type,price_amount,currency\nsvc-1,Audit,FIXED,100.0000,EUR\n",
    ),
  ),
);
const decimalReplay = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: decimalEquivalent.rows,
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(decimalReplay[0]?.action, "UNCHANGED");

const changedParse = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from("external_id,name,price_type,price_amount,currency\nsvc-1,Audit,FIXED,125,EUR\n"),
  ),
);
const changed = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: changedParse.rows,
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(changed[0]?.action, "INVALID");
assert.equal(changed[0]?.diagnostics.at(-1)?.code, "BUSINESS_IMPORT_PARTIAL_UPDATE_UNSUPPORTED");

const fullReplacement = Object.fromEntries(
  BUSINESS_SERVICES_CSV_HEADERS.map((header) => [header, ""]),
);
Object.assign(fullReplacement, {
  external_id: "svc-1",
  name: "Audit",
  price_type: "FIXED",
  price_amount: "125",
  currency: "EUR",
  active: "true",
});
const completeChangedParse = await parseBusinessServicesCsv(
  new Uint8Array(
    Buffer.from(
      `${BUSINESS_SERVICES_CSV_HEADERS.join(",")}\n${BUSINESS_SERVICES_CSV_HEADERS.map((header) => fullReplacement[header]).join(",")}\n`,
    ),
  ),
);
const completeChanged = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: completeChangedParse.rows,
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(completeChanged[0]?.action, "UPDATE");

const manuallyEnrichedExisting = {
  ...existing,
  value: {
    ...original,
    description: "Owner-written description",
    duration: { minimumMinutes: 45, maximumMinutes: 60 },
  },
};
manuallyEnrichedExisting.valueHash = businessOfferingValueHash(manuallyEnrichedExisting.value);
const manualPartialReplacement = diffBusinessServiceRows({
  sourceLineageId: "replacement-source",
  rows: changedParse.rows,
  existing: [manuallyEnrichedExisting],
  sourceBindings: [],
  replacementScopeBindings: [
    {
      ...binding,
      sourceValueHash: manuallyEnrichedExisting.valueHash,
    },
  ],
  manualFieldsByOfferingId: businessImportManualFieldsByOffering([
    {
      offeringId: existing.id,
      resourceType: "OFFERING",
      fieldPath: "/description",
    },
    {
      offeringId: existing.id,
      resourceType: "OFFERING_DURATION",
      fieldPath: "/minimumMinutes",
    },
  ]),
});
assert.equal(manualPartialReplacement[0]?.action, "UPDATE");

const renamedWithoutId = await parseBusinessServicesCsv(
  new Uint8Array(Buffer.from("name\nExtended audit\n")),
);
const conflict = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: renamedWithoutId.rows,
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(conflict[0]?.action, "CONFLICT");
assert.equal(conflict.at(-1)?.action, "MISSING");

const missing = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [],
  existing: [existing],
  sourceBindings: [binding],
});
assert.equal(missing[0]?.action, "MISSING");
assert.equal(applyBusinessServiceCatalogMode(missing, "ADD")[0]?.action, "MISSING");
const replacement = applyBusinessServiceCatalogMode(missing, "REPLACE");
assert.equal(replacement[0]?.action, "ARCHIVE");
assert.equal(replacement[0]?.diagnostics[0]?.code, "BUSINESS_IMPORT_ARCHIVE_MISSING_SERVICE");
const globalReplacement = applyBusinessServiceCatalogMode(
  diffBusinessServiceRows({
    sourceLineageId: "replacement-source",
    rows: [],
    existing: [existing],
    sourceBindings: [],
    replacementScopeBindings: [
      binding,
      { ...binding, externalKey: "same-offering-from-another-catalog" },
    ],
  }),
  "REPLACE",
);
assert.equal(globalReplacement.length, 1);
assert.equal(globalReplacement[0]?.action, "ARCHIVE");
assert.equal(globalReplacement[0]?.targetOfferingId, existing.id);

const duplicateCatalogReplacement = applyBusinessServiceCatalogMode(
  diffBusinessServiceRows({
    sourceLineageId: "replacement-source",
    rows: [original],
    existing: [existing, duplicateBindingTarget],
    sourceBindings: [],
    replacementScopeBindings: [binding, { ...binding, offeringId: duplicateBindingTarget.id }],
  }),
  "REPLACE",
);
assert.deepEqual(
  duplicateCatalogReplacement.map((candidate) => candidate.action),
  ["LINK", "ARCHIVE"],
);
assert.equal(duplicateCatalogReplacement[0]?.targetOfferingId, existing.id);
assert.equal(duplicateCatalogReplacement[1]?.targetOfferingId, duplicateBindingTarget.id);
assert.notEqual(
  duplicateCatalogReplacement[0]?.candidateKey,
  duplicateCatalogReplacement[1]?.candidateKey,
);

const collisionHeating = {
  ...original,
  externalId: "shared-workspace-id",
  name: "Heating installation",
  description: "Owner-authored heating notes",
};
const collisionCooling = {
  ...original,
  externalId: "shared-workspace-id",
  name: "Cooling installation",
  description: "Cooling notes",
};
const collisionHeatingExisting = {
  id: "collision-heating",
  value: collisionHeating,
  valueHash: businessOfferingValueHash(collisionHeating),
};
const collisionCoolingExisting = {
  id: "collision-cooling",
  value: collisionCooling,
  valueHash: businessOfferingValueHash(collisionCooling),
};
const collisionBindings = [
  {
    offeringId: collisionHeatingExisting.id,
    externalKey: "shared-workspace-id",
    identityKey: businessOfferingIdentityKey(collisionHeating),
    sourceValueHash: collisionHeatingExisting.valueHash,
  },
  {
    offeringId: collisionCoolingExisting.id,
    externalKey: "shared-workspace-id",
    identityKey: businessOfferingIdentityKey(collisionCooling),
    sourceValueHash: collisionCoolingExisting.valueHash,
  },
];
const identityDisambiguatedReplacement = applyBusinessServiceCatalogMode(
  diffBusinessServiceRows({
    sourceLineageId: "replacement-source",
    rows: [collisionCooling],
    existing: [collisionHeatingExisting, collisionCoolingExisting],
    sourceBindings: [],
    replacementScopeBindings: collisionBindings,
  }),
  "REPLACE",
);
assert.deepEqual(
  identityDisambiguatedReplacement.map((candidate) => candidate.action),
  ["LINK", "ARCHIVE"],
);
assert.equal(identityDisambiguatedReplacement[0]?.targetOfferingId, collisionCoolingExisting.id);
assert.equal(identityDisambiguatedReplacement[1]?.targetOfferingId, collisionHeatingExisting.id);

const collisionVentilation = {
  ...original,
  externalId: "shared-workspace-id",
  name: "Ventilation installation",
  description: "New ventilation service",
};
const unmatchedCollisionReplacement = applyBusinessServiceCatalogMode(
  diffBusinessServiceRows({
    sourceLineageId: "replacement-source",
    rows: [collisionVentilation],
    existing: [collisionHeatingExisting, collisionCoolingExisting],
    sourceBindings: [],
    replacementScopeBindings: collisionBindings,
    manualFieldsByOfferingId: businessImportManualFieldsByOffering([
      {
        offeringId: collisionHeatingExisting.id,
        resourceType: "OFFERING",
        fieldPath: "/description",
      },
    ]),
  }),
  "REPLACE",
);
assert.deepEqual(
  unmatchedCollisionReplacement.map((candidate) => candidate.action),
  ["ADD", "ARCHIVE", "ARCHIVE"],
);
assert.equal(unmatchedCollisionReplacement[0]?.targetOfferingId, null);
assert.deepEqual(
  unmatchedCollisionReplacement
    .slice(1)
    .map((candidate) => candidate.targetOfferingId)
    .sort(),
  [collisionCoolingExisting.id, collisionHeatingExisting.id].sort(),
);
assert.equal(
  unmatchedCollisionReplacement.some((candidate) => candidate.action === "UPDATE"),
  false,
);

const firstCatalogReplacement = applyBusinessServiceCatalogMode(
  diffBusinessServiceRows({
    sourceLineageId: "first-replacement-source",
    rows: [original],
    existing: [],
    sourceBindings: [],
    replacementScopeBindings: [],
  }),
  "REPLACE",
);
assert.equal(firstCatalogReplacement.length, 1);
assert.equal(firstCatalogReplacement[0]?.action, "ADD");

const mutationLimitBoundary = Array.from(
  { length: BUSINESS_IMPORT_CATALOG_MUTATION_LIMIT },
  () => ({ action: "UPDATE" }),
);
assert.equal(countBusinessImportCatalogMutations(mutationLimitBoundary), 400);
assert.equal(
  countBusinessImportCatalogMutations([
    ...mutationLimitBoundary,
    { action: "UNCHANGED" },
    { action: "CONFLICT" },
  ]),
  400,
);
assert.equal(
  countBusinessImportCatalogMutations([...mutationLimitBoundary, { action: "ARCHIVE" }]),
  401,
);
assert.equal(isBusinessImportCatalogMutationAction("LINK"), true);
assert.equal(isBusinessImportCatalogMutationAction("UNCHANGED"), false);

process.stdout.write("business services diff smoke passed\n");
