import assert from "node:assert/strict";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  diffBusinessServiceRows,
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
assert.equal(linked[0]?.riskLevel, "LOW");
assert.equal(linked[0]?.proposedValueHash, businessOfferingValueHash(original));

const differentlyBound = diffBusinessServiceRows({
  sourceLineageId: "source-1",
  rows: [original],
  existing: [unboundExisting],
  sourceBindings: [{ ...binding, externalKey: "another-source-key" }],
});
assert.equal(differentlyBound[0]?.action, "CONFLICT");

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

process.stdout.write("business services diff smoke passed\n");
