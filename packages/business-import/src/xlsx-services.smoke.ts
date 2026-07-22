import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createBusinessServicesXlsxTemplate,
  parseBusinessServicesXlsx,
} from "./service-xlsx.js";
import { admitXlsxFixture, createXlsxFixture } from "./xlsx-test-fixture.js";

const mainNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function inline(reference: string, value: string) {
  return `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

const englishTemplate = createBusinessServicesXlsxTemplate({ locale: "en" });
const repeatedTemplate = createBusinessServicesXlsxTemplate({ locale: "en" });
const russianTemplate = createBusinessServicesXlsxTemplate({ locale: "ru" });
assert.deepEqual(englishTemplate, repeatedTemplate);
assert.notDeepEqual(englishTemplate, russianTemplate);
assert.equal(
  createHash("sha256").update(englishTemplate).digest("hex"),
  "956786bc9038757b79f71951789f234b22c290b24ec0c084f10bea5e8e4c7675",
);

for (const template of [englishTemplate, russianTemplate]) {
  const parsedTemplate = parseBusinessServicesXlsx(await admitXlsxFixture(template));
  assert.equal(parsedTemplate.templateSchemaVersion, "leadvirt.services.v1");
  assert.equal(parsedTemplate.counts.serviceSheetCount, 1);
  assert.equal(parsedTemplate.counts.totalRows, 0);
  assert.ok(
    parsedTemplate.diagnostics.some(
      (item) => item.code === "BUSINESS_IMPORT_XLSX_SHEET_UNUSED" && item.sheet === "Instructions",
    ),
  );
}

const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="${mainNamespace}" count="13" uniqueCount="13">
  <si><t>name</t></si><si><t>description</t></si><si><t>price_type</t></si>
  <si><t>price_amount</t></si><si><t>currency</t></si><si><t>duration_minutes</t></si>
  <si><t>active</t></si><si><t>language</t></si>
  <si><r><t>Au</t></r><r><t>dit</t></r></si><si><t>Detailed review</t></si>
  <si><t>FIXED</t></si><si><t>EUR</t></si><si><t>en</t></si>
</sst>`;

const englishSheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="${mainNamespace}"><sheetData>
  <row r="1">
    <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>
    <c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c>
    <c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c>
    <c r="G1" t="s"><v>6</v></c><c r="H1" t="s"><v>7</v></c>
  </row>
  <row r="2">
    <c r="A2" t="s"><v>8</v></c><c r="B2" t="inlineStr"><is><t>Detailed review</t></is></c>
    <c r="C2" t="s"><v>10</v></c><c r="D2"><f>100+25</f><v>125</v></c>
    <c r="E2" t="s"><v>11</v></c><c r="F2"><v>60</v></c>
    <c r="G2" t="b"><v>1</v></c><c r="H2" t="s"><v>12</v></c>
  </row>
</sheetData></worksheet>`;

const russianSheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="${mainNamespace}"><sheetData>
  <row r="1">
    ${inline("A1", "услуга")}${inline("B1", "описание")}${inline("C1", "тип цены")}
    ${inline("D1", "цена")}${inline("E1", "валюта")}${inline("F1", "активна")}${inline("G1", "язык")}
  </row>
  <row r="2">
    ${inline("A2", "Аудит")}${inline("B2", "Проверка")}${inline("C2", "FREE")}
    <c r="F2" t="b"><v>0</v></c>${inline("G2", "ru")}
  </row>
</sheetData></worksheet>`;

const hiddenSheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="${mainNamespace}"><sheetData>
  <row r="1">${inline("A1", "name")}</row>
  <row r="2">${inline("A2", "Internal service")}</row>
</sheetData></worksheet>`;

const workbook = createXlsxFixture({
  sharedStringsXml: sharedStrings,
  sheets: [
    { name: "Services", xml: englishSheet },
    { name: "Услуги", xml: russianSheet },
    { name: "Internal", state: "hidden", xml: hiddenSheet },
  ],
});
const parsed = parseBusinessServicesXlsx(await admitXlsxFixture(workbook));
assert.equal(parsed.counts.sheetCount, 3);
assert.equal(parsed.counts.hiddenSheetCount, 1);
assert.equal(parsed.counts.serviceSheetCount, 2);
assert.equal(parsed.counts.workbookRows, 6);
assert.equal(parsed.counts.totalRows, 2);
assert.equal(parsed.counts.validRows, 2);
assert.deepEqual(parsed.rows.map((row) => row.name), ["Audit", "Аудит"]);
assert.equal(parsed.rows[0]?.price?.amount, "125");
assert.equal(parsed.rows[0]?.duration?.minimumMinutes, 60);
assert.equal(parsed.rows[0]?.active, true);
assert.equal(parsed.rows[1]?.price?.type, "FREE");
assert.equal(parsed.rows[1]?.active, false);
const englishNameEvidence = parsed.rows[0]?.evidence.name;
const englishPriceEvidence = parsed.rows[0]?.evidence.price_amount;
const russianNameEvidence = parsed.rows[1]?.evidence.name;
assert.equal(englishNameEvidence?.format, "XLSX");
assert.equal(englishPriceEvidence?.format, "XLSX");
assert.equal(russianNameEvidence?.format, "XLSX");
if (
  englishNameEvidence?.format !== "XLSX" ||
  englishPriceEvidence?.format !== "XLSX" ||
  russianNameEvidence?.format !== "XLSX"
) {
  throw new Error("Expected XLSX cell evidence.");
}
assert.equal(englishNameEvidence.range, "'Services'!A2");
assert.equal(englishNameEvidence.cellType, "SHARED_STRING");
assert.equal(englishPriceEvidence.cachedFormula, true);
assert.equal(russianNameEvidence.range, "'Услуги'!A2");
assert.ok(
  parsed.diagnostics.some(
    (item) => item.code === "BUSINESS_IMPORT_XLSX_CACHED_FORMULA_USED" && item.cell === "D2",
  ),
);
assert.ok(
  parsed.diagnostics.some(
    (item) => item.code === "BUSINESS_IMPORT_XLSX_HIDDEN_SHEET_IGNORED" && item.sheet === "Internal",
  ),
);

process.stdout.write("business services XLSX golden smoke passed\n");
