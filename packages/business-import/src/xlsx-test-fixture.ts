import { createHash } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import {
  admitBusinessImportFile,
  type AcceptedBusinessImportFile,
  type BusinessImportFileScanner,
} from "./file-admission.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FIXED_TIME = new Date(2020, 0, 1, 0, 0, 0);

export interface XlsxFixtureSheet {
  name: string;
  xml: string;
  state?: "visible" | "hidden" | "veryHidden";
  relationshipTarget?: string;
}

function escaped(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function entry(value: string): [Uint8Array, { level: 6; mtime: Date }] {
  return [new TextEncoder().encode(value), { level: 6, mtime: FIXED_TIME }];
}

export function createXlsxFixture(input: {
  sheets: XlsxFixtureSheet[];
  sharedStringsXml?: string;
  workbookXml?: string;
  workbookRelationshipsXml?: string;
  extraEntries?: Record<string, string | Uint8Array>;
}) {
  const workbook = input.workbookXml ?? `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${input.sheets.map((sheet, index) => `<sheet name="${escaped(sheet.name)}" sheetId="${index + 1}"${sheet.state && sheet.state !== "visible" ? ` state="${sheet.state}"` : ""} r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
  const workbookRelationships = input.workbookRelationshipsXml ?? `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${input.sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${escaped(sheet.relationshipTarget ?? `worksheets/sheet${index + 1}.xml`)}"/>`).join("")}
  ${input.sharedStringsXml ? `<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` : ""}
</Relationships>`;
  const archive: Zippable = {
    "[Content_Types].xml": entry(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${input.sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`),
    "_rels/.rels": entry(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": entry(workbook),
    "xl/_rels/workbook.xml.rels": entry(workbookRelationships),
  };
  input.sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = entry(sheet.xml);
  });
  if (input.sharedStringsXml) archive["xl/sharedStrings.xml"] = entry(input.sharedStringsXml);
  for (const [name, value] of Object.entries(input.extraEntries ?? {})) {
    archive[name] = [
      typeof value === "string" ? new TextEncoder().encode(value) : value,
      { level: 6, mtime: FIXED_TIME },
    ];
  }
  return zipSync(archive, { level: 6 });
}

const scanner: BusinessImportFileScanner = {
  identity: { provider: "xlsx-fixture", version: "1", approvedForProduction: false },
  scan: () => Promise.resolve({ verdict: "CLEAN" }),
};

export async function admitXlsxFixture(bytes: Uint8Array): Promise<AcceptedBusinessImportFile> {
  return admitBusinessImportFile(
    {
      filename: "services.xlsx",
      declaredMimeType: XLSX_MIME,
      stream: (async function* stream() {
        await Promise.resolve();
        yield bytes;
      })(),
    },
    { environment: "TEST", scanner },
  );
}

export function acceptedXlsxWithoutAdmission(bytes: Uint8Array): AcceptedBusinessImportFile {
  return {
    bytes,
    provenance: {
      filename: "services.xlsx",
      extension: "xlsx",
      declaredMimeType: XLSX_MIME,
      detectedMimeType: XLSX_MIME,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      scannerProvider: "fixture",
      scannerVersion: "1",
    },
  };
}
