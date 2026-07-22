import { posix } from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { SaxesParser, type SaxesTagNS } from "saxes";
import type { AcceptedBusinessImportFile } from "./file-admission.js";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
  parseBusinessServiceRow,
  resolveBusinessServiceHeader,
  type BusinessImportDiagnostic,
  type BusinessImportXlsxCellEvidence,
  type BusinessServiceColumnMapping,
  type BusinessServiceCsvHeader,
  type ParsedBusinessServiceRow,
} from "./service-csv.js";

export const BUSINESS_SERVICES_XLSX_PARSER_VERSION = "leadvirt.xlsx.services.v1";

export interface BusinessServicesXlsxLimits {
  maxBytes: number;
  maxExpandedBytes: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCellCharacters: number;
  maxTotalCharacters: number;
  maxServices: number;
  maxXmlDepth: number;
  maxXmlPartBytes: number;
}

export interface ParsedBusinessServicesXlsxSheet {
  name: string;
  headerRow: number;
  range: string;
  headers: BusinessServiceCsvHeader[];
  rowCount: number;
}

export interface ParsedBusinessServicesXlsx {
  schemaVersion: typeof BUSINESS_SERVICES_CSV_SCHEMA_VERSION;
  parserVersion: typeof BUSINESS_SERVICES_XLSX_PARSER_VERSION;
  templateSchemaVersion: string | null;
  sheets: ParsedBusinessServicesXlsxSheet[];
  rows: ParsedBusinessServiceRow[];
  diagnostics: BusinessImportDiagnostic[];
  counts: {
    sheetCount: number;
    visibleSheetCount: number;
    hiddenSheetCount: number;
    serviceSheetCount: number;
    workbookRows: number;
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

export class BusinessServicesXlsxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: BusinessImportDiagnostic[] = [],
  ) {
    super(message);
    this.name = "BusinessServicesXlsxError";
  }
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAIN_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const PACKAGE_RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const OFFICE_RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const WORKSHEET_RELATIONSHIP = /\/worksheet$/u;
const SHARED_STRINGS_RELATIONSHIP = /\/sharedStrings$/u;
const CELL_REFERENCE = /^([A-Z]{1,3})([1-9]\d*)$/u;
const NUMBER_VALUE = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[Ee][+-]?\d+)?$/u;
const FIXED_ZIP_TIME = new Date(2020, 0, 1, 0, 0, 0);
const MAX_FORMULA_DIAGNOSTICS = 100;
const DEFAULT_LIMITS: BusinessServicesXlsxLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 50 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 10_000,
  maxColumns: 100,
  maxCellCharacters: 8 * 1024,
  maxTotalCharacters: 1_000_000,
  maxServices: 200,
  maxXmlDepth: 64,
  maxXmlPartBytes: 50 * 1024 * 1024,
};

interface WorkbookSheet {
  name: string;
  relationshipId: string;
  state: "VISIBLE" | "HIDDEN" | "VERY_HIDDEN";
}

interface PackageRelationship {
  id: string;
  type: string;
  target: string;
}

type XlsxCellType = BusinessImportXlsxCellEvidence["cellType"];

interface RawCell {
  reference: string;
  row: number;
  column: number;
  value: string;
  cellType: XlsxCellType;
  cachedFormula: boolean;
}

interface RawRow {
  row: number;
  cells: Map<number, RawCell>;
}

interface RawSheet {
  rows: RawRow[];
  physicalRows: number;
  range: string;
}

interface PendingCell {
  reference: string;
  row: number;
  column: number;
  declaredType: string | null;
  value: string;
  valueSeen: boolean;
  inlineValue: string;
  formula: string;
  formulaSeen: boolean;
}

interface XmlHandlers {
  open?: (tag: SaxesTagNS) => void;
  close?: (tag: SaxesTagNS) => void;
  text?: (value: string) => void;
}

function mergedLimits(input?: Partial<BusinessServicesXlsxLimits>): BusinessServicesXlsxLimits {
  return { ...DEFAULT_LIMITS, ...input };
}

function fail(code: string, message: string, diagnostics: BusinessImportDiagnostic[] = []): never {
  throw new BusinessServicesXlsxError(code, message, diagnostics);
}

function attribute(tag: SaxesTagNS, localName: string) {
  for (const value of Object.values(tag.attributes)) {
    if (value.local === localName && value.uri === "") return value.value;
  }
  return null;
}

function officeRelationshipId(tag: SaxesTagNS) {
  for (const value of Object.values(tag.attributes)) {
    if (value.local === "id" && OFFICE_RELATIONSHIP_NAMESPACES.has(value.uri)) {
      return value.value;
    }
  }
  return null;
}

function hasXmlControlCharacter(value: string) {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || (point >= 0x7f && point <= 0x9f);
  });
}

function decodeXml(bytes: Uint8Array, partName: string, limits: BusinessServicesXlsxLimits) {
  if (bytes.byteLength > limits.maxXmlPartBytes) {
    fail("BUSINESS_IMPORT_XLSX_XML_PART_LIMIT", "An XLSX XML part exceeds the safe size limit.");
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("BUSINESS_IMPORT_XLSX_XML_INVALID", "The XLSX contains invalid UTF-8 XML.");
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    fail("BUSINESS_IMPORT_XLSX_XML_ACTIVE_CONTENT", "DTD and entity declarations are not allowed.");
  }
  if (xml.length > limits.maxXmlPartBytes) {
    fail("BUSINESS_IMPORT_XLSX_XML_PART_LIMIT", "An XLSX XML part exceeds the safe size limit.");
  }
  return { xml, partName };
}

function parseXml(
  bytes: Uint8Array,
  partName: string,
  limits: BusinessServicesXlsxLimits,
  handlers: XmlHandlers,
) {
  const decoded = decodeXml(bytes, partName, limits);
  const parser = new SaxesParser({
    xmlns: true as const,
    fileName: decoded.partName,
    defaultXMLVersion: "1.0",
    forceXMLVersion: true,
  });
  let depth = 0;
  parser.on("doctype", () => {
    fail("BUSINESS_IMPORT_XLSX_XML_ACTIVE_CONTENT", "DTD declarations are not allowed.");
  });
  parser.on("processinginstruction", () => {
    fail("BUSINESS_IMPORT_XLSX_XML_ACTIVE_CONTENT", "XML processing instructions are not allowed.");
  });
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > limits.maxXmlDepth) {
      fail("BUSINESS_IMPORT_XLSX_XML_DEPTH_LIMIT", "The XLSX XML nesting is too deep.");
    }
    handlers.open?.(tag);
  });
  parser.on("closetag", (tag) => {
    handlers.close?.(tag);
    depth -= 1;
  });
  parser.on("text", (value) => handlers.text?.(value));
  parser.on("cdata", (value) => handlers.text?.(value));
  try {
    parser.write(decoded.xml).close();
  } catch (error) {
    if (error instanceof BusinessServicesXlsxError) throw error;
    fail("BUSINESS_IMPORT_XLSX_XML_INVALID", "The XLSX contains malformed XML.");
  }
}

function extractArchive(
  accepted: AcceptedBusinessImportFile,
  limits: BusinessServicesXlsxLimits,
) {
  if (
    accepted.provenance.extension !== "xlsx" ||
    accepted.provenance.detectedMimeType !== XLSX_MIME ||
    accepted.provenance.declaredMimeType !== XLSX_MIME
  ) {
    fail(
      "BUSINESS_IMPORT_XLSX_ADMISSION_REQUIRED",
      "XLSX parsing requires a file accepted by the business import admission gate.",
    );
  }
  if (accepted.bytes.byteLength > limits.maxBytes) {
    fail("BUSINESS_IMPORT_XLSX_BYTE_LIMIT", "The XLSX exceeds the compressed byte limit.");
  }
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(accepted.bytes);
  } catch {
    fail("BUSINESS_IMPORT_XLSX_ARCHIVE_INVALID", "The XLSX archive cannot be read.");
  }
  let expandedBytes = 0;
  for (const [name, bytes] of Object.entries(archive)) {
    if (name.includes("\\") || name.includes("\0")) {
      fail("BUSINESS_IMPORT_XLSX_ARCHIVE_INVALID", "The XLSX contains an invalid part name.");
    }
    expandedBytes += bytes.byteLength;
    if (expandedBytes > limits.maxExpandedBytes) {
      fail("BUSINESS_IMPORT_XLSX_EXPANDED_LIMIT", "The XLSX exceeds the expanded byte limit.");
    }
  }
  return archive;
}

function requiredPart(archive: Record<string, Uint8Array>, name: string) {
  const value = archive[name];
  if (!value) fail("BUSINESS_IMPORT_XLSX_PART_MISSING", "The XLSX package is incomplete.");
  return value;
}

function parseWorkbook(bytes: Uint8Array, limits: BusinessServicesXlsxLimits) {
  const sheets: WorkbookSheet[] = [];
  const names = new Set<string>();
  let rootSeen = false;
  let definedName: string | null = null;
  let definedNameValue = "";
  let templateSchemaVersion: string | null = null;
  parseXml(bytes, "xl/workbook.xml", limits, {
    open(tag) {
      if (!rootSeen) {
        if (tag.local !== "workbook" || !MAIN_NAMESPACES.has(tag.uri)) {
          fail("BUSINESS_IMPORT_XLSX_WORKBOOK_INVALID", "The XLSX workbook root is invalid.");
        }
        rootSeen = true;
      }
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "sheet") {
        const name = attribute(tag, "name")?.normalize("NFC") ?? "";
        const relationshipId = officeRelationshipId(tag) ?? "";
        const rawState = attribute(tag, "state") ?? "visible";
        if (
          !name ||
          name.length > 31 ||
          hasXmlControlCharacter(name) ||
          /[\\/?*:[\]]/u.test(name) ||
          !relationshipId
        ) {
          fail("BUSINESS_IMPORT_XLSX_SHEET_INVALID", "The XLSX contains invalid sheet metadata.");
        }
        const foldedName = name.toLocaleLowerCase("und");
        if (names.has(foldedName)) {
          fail("BUSINESS_IMPORT_XLSX_SHEET_INVALID", "The XLSX contains duplicate sheet names.");
        }
        names.add(foldedName);
        const state =
          rawState === "visible"
            ? "VISIBLE"
            : rawState === "hidden"
              ? "HIDDEN"
              : rawState === "veryHidden"
                ? "VERY_HIDDEN"
                : null;
        if (!state) {
          fail("BUSINESS_IMPORT_XLSX_SHEET_INVALID", "The XLSX contains an unknown sheet state.");
        }
        sheets.push({ name, relationshipId, state });
        if (sheets.length > limits.maxSheets) {
          fail(
            "BUSINESS_IMPORT_XLSX_SHEET_LIMIT",
            `The workbook contains more than ${limits.maxSheets} sheets.`,
          );
        }
      }
      if (tag.local === "definedName") {
        definedName = attribute(tag, "name");
        definedNameValue = "";
      }
    },
    text(value) {
      if (definedName) definedNameValue += value;
    },
    close(tag) {
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local !== "definedName") return;
      if (definedName === "_LeadVirtSchemaVersion") {
        const value = definedNameValue.trim();
        templateSchemaVersion = value.startsWith('"') && value.endsWith('"')
          ? value.slice(1, -1).replace(/""/gu, '"')
          : value;
      }
      definedName = null;
      definedNameValue = "";
    },
  });
  if (!rootSeen || sheets.length === 0) {
    fail("BUSINESS_IMPORT_XLSX_WORKBOOK_INVALID", "The XLSX workbook contains no sheets.");
  }
  return { sheets, templateSchemaVersion };
}

function parseRelationships(
  bytes: Uint8Array,
  partName: string,
  limits: BusinessServicesXlsxLimits,
) {
  const relationships = new Map<string, PackageRelationship>();
  let rootSeen = false;
  parseXml(bytes, partName, limits, {
    open(tag) {
      if (!rootSeen) {
        if (tag.local !== "Relationships" || !PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.uri)) {
          fail(
            "BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID",
            "The XLSX relationship root is invalid.",
          );
        }
        rootSeen = true;
      }
      if (
        tag.local !== "Relationship" ||
        !PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.uri)
      ) return;
      const id = attribute(tag, "Id") ?? "";
      const type = attribute(tag, "Type") ?? "";
      const target = attribute(tag, "Target") ?? "";
      const targetMode = attribute(tag, "TargetMode");
      if (!id || !type || !target || relationships.has(id)) {
        fail(
          "BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID",
          "The XLSX contains an invalid relationship.",
        );
      }
      if (targetMode && targetMode !== "Internal") {
        fail(
          "BUSINESS_IMPORT_XLSX_EXTERNAL_RELATIONSHIP",
          "External XLSX relationships are not allowed.",
        );
      }
      relationships.set(id, { id, type, target });
    },
  });
  if (!rootSeen) {
    fail("BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID", "The XLSX relationships are missing.");
  }
  return relationships;
}

function resolveInternalPart(basePart: string, rawTarget: string) {
  let target: string;
  try {
    target = decodeURIComponent(rawTarget);
  } catch {
    fail("BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID", "An XLSX relationship target is invalid.");
  }
  if (
    !target ||
    target.includes("\\") ||
    target.includes("\0") ||
    target.includes("?") ||
    target.includes("#") ||
    target.split("/").some((segment) => segment === "..") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(target)
  ) {
    fail("BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID", "An XLSX relationship target is unsafe.");
  }
  const packageAbsolute = target.startsWith("/");
  const candidate = packageAbsolute
    ? target.slice(1)
    : posix.join(posix.dirname(basePart), target);
  const normalized = posix.normalize(candidate);
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/")
  ) {
    fail("BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID", "An XLSX relationship leaves the package.");
  }
  return normalized;
}

function parseSharedStrings(bytes: Uint8Array, limits: BusinessServicesXlsxLimits) {
  const strings: string[] = [];
  let rootSeen = false;
  let insideItem = false;
  let insideText = false;
  let phoneticDepth = 0;
  let current = "";
  let totalCharacters = 0;
  parseXml(bytes, "xl/sharedStrings.xml", limits, {
    open(tag) {
      if (!rootSeen) {
        if (tag.local !== "sst" || !MAIN_NAMESPACES.has(tag.uri)) {
          fail(
            "BUSINESS_IMPORT_XLSX_SHARED_STRINGS_INVALID",
            "The XLSX shared strings root is invalid.",
          );
        }
        rootSeen = true;
      }
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "si") {
        if (insideItem) {
          fail(
            "BUSINESS_IMPORT_XLSX_SHARED_STRINGS_INVALID",
            "The XLSX shared string table is malformed.",
          );
        }
        insideItem = true;
        current = "";
      } else if (insideItem && tag.local === "rPh") {
        phoneticDepth += 1;
      } else if (insideItem && tag.local === "t" && phoneticDepth === 0) {
        insideText = true;
      }
    },
    text(value) {
      if (insideItem && insideText && phoneticDepth === 0) current += value;
    },
    close(tag) {
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "t") insideText = false;
      if (tag.local === "rPh") phoneticDepth = Math.max(0, phoneticDepth - 1);
      if (tag.local !== "si") return;
      if (current.length > limits.maxCellCharacters) {
        fail(
          "BUSINESS_IMPORT_XLSX_CELL_LIMIT",
          `A shared string exceeds ${limits.maxCellCharacters} characters.`,
        );
      }
      totalCharacters += current.length;
      if (totalCharacters > limits.maxTotalCharacters) {
        fail(
          "BUSINESS_IMPORT_XLSX_CHARACTER_LIMIT",
          `The shared string table exceeds ${limits.maxTotalCharacters} characters.`,
        );
      }
      strings.push(current);
      if (strings.length > limits.maxRows * limits.maxColumns) {
        fail(
          "BUSINESS_IMPORT_XLSX_SHARED_STRINGS_LIMIT",
          "The XLSX contains too many shared strings.",
        );
      }
      insideItem = false;
      insideText = false;
      current = "";
    },
  });
  if (!rootSeen) {
    fail("BUSINESS_IMPORT_XLSX_SHARED_STRINGS_INVALID", "The shared string table is missing.");
  }
  return strings;
}

function columnNumber(letters: string) {
  let value = 0;
  for (const character of letters) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
}

function columnLetters(column: number) {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function cellReference(value: string, limits: BusinessServicesXlsxLimits) {
  const match = CELL_REFERENCE.exec(value);
  if (!match) {
    fail("BUSINESS_IMPORT_XLSX_CELL_REFERENCE_INVALID", "The XLSX contains an invalid cell reference.");
  }
  const column = columnNumber(match[1] ?? "");
  const row = Number(match[2]);
  if (column < 1 || column > limits.maxColumns) {
    fail(
      "BUSINESS_IMPORT_XLSX_COLUMN_LIMIT",
      `The workbook uses a column beyond ${columnLetters(limits.maxColumns)}.`,
    );
  }
  if (!Number.isSafeInteger(row) || row < 1 || row > limits.maxRows) {
    fail("BUSINESS_IMPORT_XLSX_ROW_LIMIT", `The workbook uses a row beyond ${limits.maxRows}.`);
  }
  return { column, row };
}

function quotedSheetName(name: string) {
  return `'${name.replace(/'/gu, "''")}'`;
}

function sheetRange(sheet: string, reference: string) {
  return `${quotedSheetName(sheet)}!${reference}`;
}

function isExternalFormula(formula: string) {
  const value = formula.normalize("NFKC");
  return (
    /(?:https?|ftp|file):/iu.test(value) ||
    /\\\\/u.test(value) ||
    /[A-Za-z]:[\\/]/u.test(value) ||
    /\[[^\]]+\][^!]{0,256}!/u.test(value) ||
    /\|[^!]{0,1024}!/u.test(value) ||
    /\b(?:WEBSERVICE|FILTERXML|RTD|CALL|REGISTER(?:\.ID)?|EXEC|HYPERLINK)\s*\(/iu.test(value)
  );
}

function decodeCell(
  cell: PendingCell,
  sharedStrings: string[],
  limits: BusinessServicesXlsxLimits,
) {
  const raw = cell.value;
  let value: string;
  let cellType: XlsxCellType;
  switch (cell.declaredType) {
    case null:
    case "n": {
      value = raw.trim();
      if (value && !NUMBER_VALUE.test(value)) {
        fail("BUSINESS_IMPORT_XLSX_NUMBER_INVALID", "The XLSX contains an invalid numeric value.");
      }
      cellType = value ? "NUMBER" : "BLANK";
      break;
    }
    case "s": {
      const indexValue = raw.trim();
      if (!/^(?:0|[1-9]\d*)$/u.test(indexValue)) {
        fail(
          "BUSINESS_IMPORT_XLSX_SHARED_STRING_INVALID",
          "The XLSX contains an invalid shared string reference.",
        );
      }
      const index = Number(indexValue);
      const shared = sharedStrings[index];
      if (shared === undefined) {
        fail(
          "BUSINESS_IMPORT_XLSX_SHARED_STRING_INVALID",
          "The XLSX references a missing shared string.",
        );
      }
      value = shared;
      cellType = "SHARED_STRING";
      break;
    }
    case "inlineStr":
      value = cell.inlineValue;
      cellType = value ? "INLINE_STRING" : "BLANK";
      break;
    case "str":
      value = raw;
      cellType = value ? "STRING" : "BLANK";
      break;
    case "b": {
      const boolean = raw.trim();
      if (boolean !== "0" && boolean !== "1") {
        fail("BUSINESS_IMPORT_XLSX_BOOLEAN_INVALID", "The XLSX contains an invalid boolean value.");
      }
      value = boolean === "1" ? "true" : "false";
      cellType = "BOOLEAN";
      break;
    }
    case "d":
      value = raw.trim();
      cellType = value ? "DATE" : "BLANK";
      break;
    case "e":
      return fail("BUSINESS_IMPORT_XLSX_CELL_ERROR", "The XLSX contains a cell error value.");
    default:
      fail("BUSINESS_IMPORT_XLSX_CELL_TYPE_UNSUPPORTED", "The XLSX contains an unsupported cell type.");
  }
  if (value.length > limits.maxCellCharacters) {
    fail(
      "BUSINESS_IMPORT_XLSX_CELL_LIMIT",
      `A cell exceeds ${limits.maxCellCharacters} characters.`,
    );
  }
  return { value, cellType };
}

function parseWorksheet(input: {
  bytes: Uint8Array;
  partName: string;
  sheetName: string;
  sharedStrings: string[];
  limits: BusinessServicesXlsxLimits;
  warnCachedFormula: (cell: PendingCell) => void;
  addCharacters: (count: number) => void;
}) {
  const rows: RawRow[] = [];
  const rowNumbers = new Set<number>();
  let rootSeen = false;
  let sheetDataSeen = false;
  let insideSheetData = false;
  let currentRow: RawRow | null = null;
  let currentCell: PendingCell | null = null;
  let previousRow = 0;
  let previousColumn = 0;
  let capture: "VALUE" | "FORMULA" | "INLINE" | null = null;
  let inlineDepth = 0;
  let phoneticDepth = 0;
  let minimumRow = Number.POSITIVE_INFINITY;
  let maximumRow = 0;
  let minimumColumn = Number.POSITIVE_INFINITY;
  let maximumColumn = 0;
  parseXml(input.bytes, input.partName, input.limits, {
    open(tag) {
      if (!rootSeen) {
        if (tag.local !== "worksheet" || !MAIN_NAMESPACES.has(tag.uri)) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "An XLSX worksheet root is invalid.");
        }
        rootSeen = true;
      }
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "sheetData") {
        if (sheetDataSeen || insideSheetData || currentRow || currentCell) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX sheet data is malformed.");
        }
        sheetDataSeen = true;
        insideSheetData = true;
        return;
      }
      if (tag.local === "row") {
        if (!insideSheetData || currentRow) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX contains nested rows.");
        }
        const rawRow = attribute(tag, "r");
        const row = rawRow ? Number(rawRow) : previousRow + 1;
        if (
          !Number.isSafeInteger(row) ||
          row < 1 ||
          row > input.limits.maxRows ||
          row <= previousRow ||
          rowNumbers.has(row)
        ) {
          fail("BUSINESS_IMPORT_XLSX_ROW_LIMIT", "The XLSX contains an invalid or excessive row.");
        }
        currentRow = { row, cells: new Map() };
        rowNumbers.add(row);
        previousRow = row;
        previousColumn = 0;
        return;
      }
      if (tag.local === "c") {
        if (!currentRow || currentCell) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX contains an invalid cell.");
        }
        const rawReference = attribute(tag, "r");
        const reference = rawReference ?? `${columnLetters(previousColumn + 1)}${currentRow.row}`;
        const parsed = cellReference(reference, input.limits);
        if (
          parsed.row !== currentRow.row ||
          parsed.column <= previousColumn ||
          currentRow.cells.has(parsed.column)
        ) {
          fail(
            "BUSINESS_IMPORT_XLSX_CELL_REFERENCE_INVALID",
            "The XLSX contains an out-of-order or duplicate cell reference.",
          );
        }
        previousColumn = parsed.column;
        currentCell = {
          reference,
          row: parsed.row,
          column: parsed.column,
          declaredType: attribute(tag, "t"),
          value: "",
          valueSeen: false,
          inlineValue: "",
          formula: "",
          formulaSeen: false,
        };
        return;
      }
      if (!currentCell) return;
      if (tag.local === "v") {
        capture = "VALUE";
        currentCell.valueSeen = true;
      } else if (tag.local === "f") {
        capture = "FORMULA";
        currentCell.formulaSeen = true;
      } else if (tag.local === "is") {
        inlineDepth += 1;
      } else if (inlineDepth > 0 && tag.local === "rPh") {
        phoneticDepth += 1;
      } else if (inlineDepth > 0 && tag.local === "t" && phoneticDepth === 0) {
        capture = "INLINE";
      }
    },
    text(value) {
      if (!currentCell) return;
      if (capture === "VALUE") currentCell.value += value;
      if (capture === "FORMULA") currentCell.formula += value;
      if (capture === "INLINE" && phoneticDepth === 0) currentCell.inlineValue += value;
    },
    close(tag) {
      if (!MAIN_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "v" || tag.local === "f" || tag.local === "t") capture = null;
      if (tag.local === "rPh") phoneticDepth = Math.max(0, phoneticDepth - 1);
      if (tag.local === "is") inlineDepth = Math.max(0, inlineDepth - 1);
      if (tag.local === "c") {
        if (!currentCell || !currentRow) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX contains an invalid cell.");
        }
        if (currentCell.formulaSeen) {
          input.addCharacters(currentCell.formula.length);
          if (isExternalFormula(currentCell.formula)) {
            fail(
              "BUSINESS_IMPORT_XLSX_EXTERNAL_FORMULA",
              "DDE and external formulas are not allowed.",
            );
          }
          if (!currentCell.valueSeen) {
            fail(
              "BUSINESS_IMPORT_XLSX_FORMULA_CACHE_REQUIRED",
              "Formula cells require a cached value and are never evaluated by LeadVirt.",
            );
          }
          input.warnCachedFormula(currentCell);
        }
        const decoded = decodeCell(currentCell, input.sharedStrings, input.limits);
        input.addCharacters(decoded.value.length);
        currentRow.cells.set(currentCell.column, {
          reference: currentCell.reference,
          row: currentCell.row,
          column: currentCell.column,
          value: decoded.value,
          cellType: decoded.cellType,
          cachedFormula: currentCell.formulaSeen,
        });
        minimumRow = Math.min(minimumRow, currentCell.row);
        maximumRow = Math.max(maximumRow, currentCell.row);
        minimumColumn = Math.min(minimumColumn, currentCell.column);
        maximumColumn = Math.max(maximumColumn, currentCell.column);
        currentCell = null;
        capture = null;
        inlineDepth = 0;
        phoneticDepth = 0;
      }
      if (tag.local === "row") {
        if (!currentRow || currentCell) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX contains an incomplete row.");
        }
        rows.push(currentRow);
        currentRow = null;
      }
      if (tag.local === "sheetData") {
        if (!insideSheetData || currentRow || currentCell) {
          fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX sheet data is incomplete.");
        }
        insideSheetData = false;
      }
    },
  });
  if (!rootSeen || !sheetDataSeen || insideSheetData || currentRow || currentCell) {
    fail("BUSINESS_IMPORT_XLSX_WORKSHEET_INVALID", "The XLSX worksheet is incomplete.");
  }
  const range = maximumRow === 0
    ? sheetRange(input.sheetName, "A1")
    : sheetRange(
        input.sheetName,
        `${columnLetters(minimumColumn)}${minimumRow}:${columnLetters(maximumColumn)}${maximumRow}`,
      );
  return { rows, physicalRows: rows.length, range } satisfies RawSheet;
}

function enrichRowDiagnostics(
  row: ParsedBusinessServiceRow,
  sheet: string,
  columns: BusinessServiceColumnMapping[],
) {
  const columnByField = new Map(columns.map(({ field, column }) => [field, column]));
  row.diagnostics = row.diagnostics.map((item) => {
    const column = item.field ? columnByField.get(item.field) : item.column;
    if (!column) return { ...item, sheet };
    const cell = `${columnLetters(column)}${row.sourceRow}`;
    return { ...item, sheet, column, cell, range: sheetRange(sheet, cell) };
  });
  return row;
}

function parseServiceSheet(input: {
  sheetName: string;
  raw: RawSheet;
  diagnostics: BusinessImportDiagnostic[];
}) {
  const headerRow = input.raw.rows.find((row) =>
    [...row.cells.values()].some((cell) => cell.value.trim().length > 0),
  );
  if (!headerRow) {
    input.diagnostics.push({
      severity: "WARNING",
      code: "BUSINESS_IMPORT_XLSX_SHEET_EMPTY",
      message: "The empty worksheet was not imported.",
      sheet: input.sheetName,
    });
    return null;
  }
  const columns: BusinessServiceColumnMapping[] = [];
  const used = new Set<BusinessServiceCsvHeader>();
  for (const cell of headerRow.cells.values()) {
    if (!cell.value.trim()) continue;
    const field = resolveBusinessServiceHeader(cell.value);
    if (!field) {
      input.diagnostics.push({
        severity: "WARNING",
        code: "BUSINESS_IMPORT_COLUMN_UNUSED",
        message: `Column '${cell.value.trim()}' is not used.`,
        sheet: input.sheetName,
        cell: cell.reference,
        range: sheetRange(input.sheetName, cell.reference),
        row: cell.row,
        column: cell.column,
      });
      continue;
    }
    if (used.has(field)) {
      fail(
        "BUSINESS_IMPORT_XLSX_DUPLICATE_COLUMN",
        `More than one XLSX column maps to '${field}'.`,
      );
    }
    used.add(field);
    columns.push({ field, column: cell.column });
  }
  if (columns.length === 0) {
    input.diagnostics.push({
      severity: "WARNING",
      code: "BUSINESS_IMPORT_XLSX_SHEET_UNUSED",
      message: "The worksheet does not contain a recognized services table and was not imported.",
      sheet: input.sheetName,
      range: input.raw.range,
    });
    return null;
  }
  if (!used.has("name")) {
    fail(
      "BUSINESS_IMPORT_XLSX_NAME_COLUMN_REQUIRED",
      `The worksheet '${input.sheetName}' requires a service name column.`,
    );
  }
  columns.sort((left, right) => left.column - right.column);
  const rows: ParsedBusinessServiceRow[] = [];
  for (const rawRow of input.raw.rows) {
    if (rawRow.row <= headerRow.row) continue;
    if (![...rawRow.cells.values()].some((cell) => cell.value.trim().length > 0)) continue;
    const width = Math.max(...columns.map(({ column }) => column));
    const record = Array.from({ length: width }, () => "");
    for (const cell of rawRow.cells.values()) {
      if (cell.column <= width) record[cell.column - 1] = cell.value;
    }
    const row = parseBusinessServiceRow(
      record,
      rawRow.row,
      columns,
      ({ sourceRow, column, field, sourceValue }) => {
        const rawCell = rawRow.cells.get(column);
        const reference = rawCell?.reference ?? `${columnLetters(column)}${sourceRow}`;
        return {
          format: "XLSX",
          sheet: input.sheetName,
          cell: reference,
          range: sheetRange(input.sheetName, reference),
          row: sourceRow,
          column,
          header: field,
          sourceValue,
          cellType: rawCell?.cellType ?? "BLANK",
          cachedFormula: rawCell?.cachedFormula ?? false,
        };
      },
    );
    rows.push(enrichRowDiagnostics(row, input.sheetName, columns));
  }
  return {
    sheet: {
      name: input.sheetName,
      headerRow: headerRow.row,
      range: input.raw.range,
      headers: columns.map(({ field }) => field),
      rowCount: rows.length,
    } satisfies ParsedBusinessServicesXlsxSheet,
    rows,
  };
}

export function parseBusinessServicesXlsx(
  accepted: AcceptedBusinessImportFile,
  inputLimits?: Partial<BusinessServicesXlsxLimits>,
): ParsedBusinessServicesXlsx {
  const limits = mergedLimits(inputLimits);
  const archive = extractArchive(accepted, limits);
  const workbook = parseWorkbook(requiredPart(archive, "xl/workbook.xml"), limits);
  const relationships = parseRelationships(
    requiredPart(archive, "xl/_rels/workbook.xml.rels"),
    "xl/_rels/workbook.xml.rels",
    limits,
  );
  const sharedRelationship = [...relationships.values()].find((relationship) =>
    SHARED_STRINGS_RELATIONSHIP.test(relationship.type),
  );
  const sharedPartName = sharedRelationship
    ? resolveInternalPart("xl/workbook.xml", sharedRelationship.target)
    : archive["xl/sharedStrings.xml"]
      ? "xl/sharedStrings.xml"
      : null;
  const sharedStrings = sharedPartName
    ? parseSharedStrings(requiredPart(archive, sharedPartName), limits)
    : [];
  const diagnostics: BusinessImportDiagnostic[] = [];
  let formulaDiagnosticCount = 0;
  let formulaDiagnosticOverflowReported = false;
  if (
    workbook.templateSchemaVersion &&
    workbook.templateSchemaVersion !== BUSINESS_SERVICES_CSV_SCHEMA_VERSION
  ) {
    diagnostics.push({
      severity: "WARNING",
      code: "BUSINESS_IMPORT_XLSX_TEMPLATE_VERSION_UNKNOWN",
      message: "The workbook template version is not recognized. Review all imported values.",
    });
  }
  let totalCharacters = 0;
  let workbookRows = 0;
  let hiddenSheetCount = 0;
  const rows: ParsedBusinessServiceRow[] = [];
  const sheets: ParsedBusinessServicesXlsxSheet[] = [];
  for (const sheet of workbook.sheets) {
    const relationship = relationships.get(sheet.relationshipId);
    if (!relationship || !WORKSHEET_RELATIONSHIP.test(relationship.type)) {
      fail(
        "BUSINESS_IMPORT_XLSX_RELATIONSHIP_INVALID",
        "A workbook sheet does not reference an internal worksheet.",
      );
    }
    const partName = resolveInternalPart("xl/workbook.xml", relationship.target);
    const raw = parseWorksheet({
      bytes: requiredPart(archive, partName),
      partName,
      sheetName: sheet.name,
      sharedStrings,
      limits,
      warnCachedFormula(cell) {
        formulaDiagnosticCount += 1;
        if (formulaDiagnosticCount <= MAX_FORMULA_DIAGNOSTICS) {
          diagnostics.push({
            severity: "WARNING",
            code: "BUSINESS_IMPORT_XLSX_CACHED_FORMULA_USED",
            message: "LeadVirt used the workbook's cached formula value and did not evaluate the formula.",
            sheet: sheet.name,
            cell: cell.reference,
            range: sheetRange(sheet.name, cell.reference),
            row: cell.row,
            column: cell.column,
          });
        } else if (!formulaDiagnosticOverflowReported) {
          formulaDiagnosticOverflowReported = true;
          diagnostics.push({
            severity: "WARNING",
            code: "BUSINESS_IMPORT_XLSX_CACHED_FORMULA_WARNINGS_TRUNCATED",
            message: `More than ${MAX_FORMULA_DIAGNOSTICS} cells use cached formula values; additional per-cell warnings were omitted.`,
          });
        }
      },
      addCharacters(count) {
        totalCharacters += count;
        if (totalCharacters > limits.maxTotalCharacters) {
          fail(
            "BUSINESS_IMPORT_XLSX_CHARACTER_LIMIT",
            `The workbook exceeds ${limits.maxTotalCharacters} extracted characters.`,
          );
        }
      },
    });
    workbookRows += raw.physicalRows;
    if (workbookRows > limits.maxRows) {
      fail(
        "BUSINESS_IMPORT_XLSX_ROW_LIMIT",
        `The workbook contains more than ${limits.maxRows} physical rows.`,
      );
    }
    if (sheet.state !== "VISIBLE") {
      hiddenSheetCount += 1;
      diagnostics.push({
        severity: "WARNING",
        code: "BUSINESS_IMPORT_XLSX_HIDDEN_SHEET_IGNORED",
        message: "A hidden worksheet was inspected for safety but its values were not imported.",
        sheet: sheet.name,
        range: raw.range,
      });
      continue;
    }
    const parsed = parseServiceSheet({ sheetName: sheet.name, raw, diagnostics });
    if (!parsed) continue;
    sheets.push(parsed.sheet);
    rows.push(...parsed.rows);
    if (rows.length > limits.maxServices) {
      fail(
        "BUSINESS_IMPORT_SERVICE_LIMIT",
        `The workbook contains more than ${limits.maxServices} services.`,
      );
    }
  }
  if (sheets.length === 0) {
    fail(
      "BUSINESS_IMPORT_XLSX_SERVICES_SHEET_REQUIRED",
      "The workbook contains no visible services table.",
      diagnostics,
    );
  }
  const validRows = rows.filter((row) => row.valid).length;
  return {
    schemaVersion: BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
    parserVersion: BUSINESS_SERVICES_XLSX_PARSER_VERSION,
    templateSchemaVersion: workbook.templateSchemaVersion,
    sheets,
    rows,
    diagnostics,
    counts: {
      sheetCount: workbook.sheets.length,
      visibleSheetCount: workbook.sheets.length - hiddenSheetCount,
      hiddenSheetCount,
      serviceSheetCount: sheets.length,
      workbookRows,
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
    },
  };
}

export type BusinessServicesXlsxTemplateLocale = "en" | "ru";

const TEMPLATE_TEXT = {
  en: {
    title: "LeadVirt services import",
    version: "Template version",
    required: "Required column",
    requiredValue: "name",
    price: "Numeric prices require price_type and currency.",
    dates: "Use YYYY-MM-DD dates and positive whole minutes.",
    formulas: "Values are preferred. Formula cells use cached results and always require review.",
  },
  ru: {
    title: "Импорт услуг LeadVirt",
    version: "Версия шаблона",
    required: "Обязательный столбец",
    requiredValue: "name",
    price: "Для числовой цены укажите price_type и currency.",
    dates: "Используйте даты YYYY-MM-DD и целые положительные минуты.",
    formulas: "Предпочтительны значения. Для формул используется кэш, требующий проверки.",
  },
} as const;

function escapeXml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function inlineCell(reference: string, value: string, style = 0) {
  return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function xmlBytes(value: string) {
  return new TextEncoder().encode(value);
}

function zipEntry(value: string): [Uint8Array, { level: 6; mtime: Date }] {
  return [xmlBytes(value), { level: 6, mtime: FIXED_ZIP_TIME }];
}

function instructionsWorksheet(locale: BusinessServicesXlsxTemplateLocale) {
  const text = TEMPLATE_TEXT[locale];
  const rows = [
    [text.title],
    [text.version, BUSINESS_SERVICES_CSV_SCHEMA_VERSION],
    [],
    [text.required, text.requiredValue],
    [text.price],
    [text.dates],
    [text.formulas],
  ];
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) =>
          inlineCell(`${columnLetters(columnIndex + 1)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 0),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B7"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="72" customWidth="1"/></cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function servicesWorksheet() {
  const cells = BUSINESS_SERVICES_CSV_HEADERS.map((header, index) =>
    inlineCell(`${columnLetters(index + 1)}1`, header, 1),
  ).join("");
  const lastColumn = columnLetters(BUSINESS_SERVICES_CSV_HEADERS.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}1"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="2" width="18" customWidth="1"/><col min="3" max="4" width="30" customWidth="1"/><col min="5" max="19" width="18" customWidth="1"/></cols>
  <sheetData><row r="1">${cells}</row></sheetData>
  <autoFilter ref="A1:${lastColumn}1"/>
  <dataValidations count="2">
    <dataValidation type="list" allowBlank="1" sqref="E2:E10000"><formula1>"FIXED,FROM,RANGE,FREE,ON_REQUEST"</formula1></dataValidation>
    <dataValidation type="list" allowBlank="1" sqref="P2:P10000"><formula1>"true,false"</formula1></dataValidation>
  </dataValidations>
</worksheet>`;
}

export function createBusinessServicesXlsxTemplate(
  options: { locale?: BusinessServicesXlsxTemplateLocale } = {},
) {
  const locale = options.locale ?? "en";
  const archive: Zippable = {
    "[Content_Types].xml": zipEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    "_rels/.rels": zipEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": zipEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets><sheet name="Instructions" sheetId="1" r:id="rId1"/><sheet name="Services" sheetId="2" r:id="rId2"/></sheets>
  <definedNames><definedName name="_LeadVirtSchemaVersion" hidden="1">&quot;${BUSINESS_SERVICES_CSV_SCHEMA_VERSION}&quot;</definedName></definedNames>
  <calcPr calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": zipEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": zipEntry(instructionsWorksheet(locale)),
    "xl/worksheets/sheet2.xml": zipEntry(servicesWorksheet()),
    "xl/styles.xml": zipEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
  };
  return zipSync(archive, { level: 6 });
}
