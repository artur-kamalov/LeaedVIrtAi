import { strict as assert } from "node:assert";
import { zipSync } from "fflate";
import {
  admitBusinessImportFile,
  BusinessImportFileAdmissionError,
  type BusinessImportFileScanner,
} from "./file-admission.js";

const scanner: BusinessImportFileScanner = {
  identity: { provider: "fixture", version: "1", approvedForProduction: false },
  scan: () => Promise.resolve({ verdict: "CLEAN" }),
};

async function admit(filename: string, mimeType: string, bytes: Uint8Array) {
  return admitBusinessImportFile(
    {
      filename,
      declaredMimeType: mimeType,
      stream: (async function* stream() {
        await Promise.resolve();
        yield bytes;
      })(),
    },
    { environment: "TEST", scanner },
  );
}

async function rejects(code: string, operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    assert(error instanceof BusinessImportFileAdmissionError);
    assert.equal(error.code, code);
    return true;
  });
}

const csv = new TextEncoder().encode("name,price_amount\n=Literal,10.00\n");
const acceptedCsv = await admit("services.csv", "text/csv", csv);
assert.equal(acceptedCsv.provenance.detectedMimeType, "text/csv");

const minimalXlsx = zipSync({
  "[Content_Types].xml": new TextEncoder().encode(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  ),
  "_rels/.rels": new TextEncoder().encode(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  ),
  "xl/workbook.xml": new TextEncoder().encode(
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></workbook>',
  ),
});
const acceptedXlsx = await admit(
  "services.xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  minimalXlsx,
);
assert.equal(
  acceptedXlsx.provenance.detectedMimeType,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
);

const externalXlsx = zipSync({
  "[Content_Types].xml": new TextEncoder().encode("<Types/>") ,
  "_rels/.rels": new TextEncoder().encode(
    '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',
  ),
  "xl/workbook.xml": new TextEncoder().encode("<workbook/>") ,
});
await rejects("BUSINESS_IMPORT_EXTERNAL_REFERENCE_DETECTED", () =>
  admit(
    "external.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    externalXlsx,
  ),
);

const macroXlsx = zipSync({
  "[Content_Types].xml": new TextEncoder().encode("<Types/>") ,
  "_rels/.rels": new TextEncoder().encode("<Relationships/>") ,
  "xl/workbook.xml": new TextEncoder().encode("<workbook/>") ,
  "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
});
await rejects("BUSINESS_IMPORT_MACRO_DETECTED", () =>
  admit(
    "macro.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    macroXlsx,
  ),
);

await rejects("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED", () =>
  admit(
    "active.pdf",
    "application/pdf",
    new TextEncoder().encode("%PDF-1.7\n1 0 obj <</OpenAction 2 0 R>> endobj\n%%EOF"),
  ),
);

await rejects("BUSINESS_IMPORT_MIME_MISMATCH", () =>
  admit("wrong.pdf", "application/pdf", csv),
);

console.log("business import file admission smoke passed");
