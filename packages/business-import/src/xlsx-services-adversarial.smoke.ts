import assert from "node:assert/strict";
import { BusinessImportFileAdmissionError } from "./file-admission.js";
import {
  BusinessServicesXlsxError,
  parseBusinessServicesXlsx,
} from "./service-xlsx.js";
import {
  acceptedXlsxWithoutAdmission,
  admitXlsxFixture,
  createXlsxFixture,
  type XlsxFixtureSheet,
} from "./xlsx-test-fixture.js";

const mainNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function inline(reference: string, value: string) {
  return `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function worksheet(rows: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${mainNamespace}"><sheetData>${rows}</sheetData></worksheet>`;
}

function serviceSheet(dataCell = inline("A2", "Audit")) {
  return worksheet(`<row r="1">${inline("A1", "name")}</row><row r="2">${dataCell}</row>`);
}

async function parseFixture(input: Parameters<typeof createXlsxFixture>[0]) {
  const bytes = createXlsxFixture(input);
  return parseBusinessServicesXlsx(await admitXlsxFixture(bytes));
}

async function rejectsXlsx(code: string, operation: () => unknown) {
  await assert.rejects(Promise.resolve().then(operation), (error: unknown) => {
    assert(error instanceof BusinessServicesXlsxError);
    assert.equal(error.code, code);
    return true;
  });
}

const ddeFormula = `<c r="A2" t="str"><f>cmd|' /c calc'!A0</f><v>cached</v></c>`;
await rejectsXlsx("BUSINESS_IMPORT_XLSX_EXTERNAL_FORMULA", () =>
  parseFixture({ sheets: [{ name: "Services", xml: serviceSheet(ddeFormula) }] }),
);

const externalWorkbookFormula = `<c r="A2" t="str"><f>'[Book.xlsx]Sheet1'!A1</f><v>cached</v></c>`;
await rejectsXlsx("BUSINESS_IMPORT_XLSX_EXTERNAL_FORMULA", () =>
  parseFixture({ sheets: [{ name: "Services", xml: serviceSheet(externalWorkbookFormula) }] }),
);

const uncachedFormula = `<c r="A2" t="str"><f>CONCAT(&quot;Au&quot;,&quot;dit&quot;)</f></c>`;
await rejectsXlsx("BUSINESS_IMPORT_XLSX_FORMULA_CACHE_REQUIRED", () =>
  parseFixture({ sheets: [{ name: "Services", xml: serviceSheet(uncachedFormula) }] }),
);

const hiddenDde = createXlsxFixture({
  sheets: [
    { name: "Services", xml: serviceSheet() },
    { name: "Hidden", state: "hidden", xml: serviceSheet(ddeFormula) },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_EXTERNAL_FORMULA", async () =>
  parseBusinessServicesXlsx(await admitXlsxFixture(hiddenDde)),
);

const traversal = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: serviceSheet(),
      relationshipTarget: "../worksheets/sheet1.xml",
    },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(traversal)),
);

const dtd = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: `<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet xmlns="${mainNamespace}"><sheetData><row r="1">${inline("A1", "name")}</row></sheetData></worksheet>`,
    },
  ],
});
await assert.rejects(
  () => admitXlsxFixture(dtd),
  (error: unknown) => {
    assert(error instanceof BusinessImportFileAdmissionError);
    assert.equal(error.code, "BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
    return true;
  },
);

const undeclaredEntity = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: worksheet(`<row r="1">${inline("A1", "name")}</row><row r="2">${inline("A2", "&unknown;")}</row>`),
    },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_XML_INVALID", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(undeclaredEntity)),
);

const rowOutsideSheetData = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: `<?xml version="1.0"?><worksheet xmlns="${mainNamespace}"><row r="1">${inline("A1", "name")}</row><sheetData/></worksheet>`,
    },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(rowOutsideSheetData)),
);

const foreignNamespaceRows = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: `<?xml version="1.0"?><worksheet xmlns="${mainNamespace}" xmlns:foreign="urn:leadvirt:test"><foreign:sheetData><foreign:row r="999999"/></foreign:sheetData><sheetData><row foreign:r="10001" r="1"><c foreign:r="CW1" r="A1" t="inlineStr"><is><t>name</t></is></c></row><row r="2">${inline("A2", "Audit")}</row></sheetData></worksheet>`,
    },
  ],
});
const namespaceSafe = parseBusinessServicesXlsx(
  acceptedXlsxWithoutAdmission(foreignNamespaceRows),
);
assert.equal(namespaceSafe.rows[0]?.name, "Audit");

const invalidSharedString = createXlsxFixture({
  sharedStringsXml: `<?xml version="1.0"?><sst xmlns="${mainNamespace}"><si><t>name</t></si></sst>`,
  sheets: [
    {
      name: "Services",
      xml: worksheet(
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>9</v></c></row>',
      ),
    },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_SHARED_STRING_INVALID", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(invalidSharedString)),
);

const excessiveColumn = createXlsxFixture({
  sheets: [{ name: "Services", xml: worksheet(`<row r="1">${inline("CW1", "name")}</row>`) }],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_COLUMN_LIMIT", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(excessiveColumn)),
);

const excessiveRow = createXlsxFixture({
  sheets: [{ name: "Services", xml: worksheet(`<row r="10001">${inline("A10001", "name")}</row>`) }],
});
await rejectsXlsx("BUSINESS_IMPORT_XLSX_ROW_LIMIT", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(excessiveRow)),
);

const excessiveServices = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: worksheet(
        [
          `<row r="1">${inline("A1", "name")}</row>`,
          ...Array.from({ length: 201 }, (_, index) => {
            const row = index + 2;
            return `<row r="${row}">${inline(`A${row}`, `Service ${row}`)}</row>`;
          }),
        ].join(""),
      ),
    },
  ],
});
await rejectsXlsx("BUSINESS_IMPORT_SERVICE_LIMIT", () =>
  parseBusinessServicesXlsx(acceptedXlsxWithoutAdmission(excessiveServices)),
);

const twentySheets: XlsxFixtureSheet[] = [
  { name: "Services", xml: serviceSheet() },
  ...Array.from({ length: 19 }, (_, index) => ({
    name: `Hidden ${index + 1}`,
    state: "hidden" as const,
    xml: worksheet(""),
  })),
];
const maximumSheets = await parseFixture({ sheets: twentySheets });
assert.equal(maximumSheets.counts.sheetCount, 20);
assert.equal(maximumSheets.counts.hiddenSheetCount, 19);

await rejectsXlsx("BUSINESS_IMPORT_XLSX_SHEET_LIMIT", () =>
  parseFixture({
    sheets: [
      ...twentySheets,
      { name: "Hidden 20", state: "hidden", xml: worksheet("") },
    ],
  }),
);

const columnNames = (column: number) => {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
};
const exactColumnLimit = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: worksheet(
        `<row r="1">${Array.from({ length: 100 }, (_, index) => inline(`${columnNames(index + 1)}1`, index === 0 ? "name" : `unused_${index}`)).join("")}</row><row r="2">${inline("A2", "Audit")}</row>`,
      ),
    },
  ],
});
const exactColumns = parseBusinessServicesXlsx(await admitXlsxFixture(exactColumnLimit));
assert.equal(exactColumns.rows[0]?.name, "Audit");
assert.equal(exactColumns.sheets[0]?.range, "'Services'!A1:CV2");

const manyRows = Array.from({ length: 9_999 }, (_, index) => {
  const row = index + 2;
  return `<row r="${row}">${inline(`A${row}`, `Service ${row}`)}</row>`;
}).join("");
const exactRowLimit = createXlsxFixture({
  sheets: [
    {
      name: "Services",
      xml: worksheet(`<row r="1">${inline("A1", "name")}</row>${manyRows}`),
    },
  ],
});
const exactRows = parseBusinessServicesXlsx(await admitXlsxFixture(exactRowLimit), {
  maxServices: 10_000,
});
assert.equal(exactRows.counts.workbookRows, 10_000);
assert.equal(exactRows.counts.totalRows, 9_999);
assert.equal(exactRows.counts.validRows, 9_999);

process.stdout.write("business services XLSX adversarial smoke passed\n");
