import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

export type BusinessImportMimeType =
  | "text/csv"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/pdf";

export type BusinessImportFileAdmissionErrorCode =
  | "BUSINESS_IMPORT_UPLOAD_ABORTED"
  | "BUSINESS_IMPORT_FILE_TOO_LARGE"
  | "BUSINESS_IMPORT_FILENAME_INVALID"
  | "BUSINESS_IMPORT_PATH_TRAVERSAL"
  | "BUSINESS_IMPORT_EXTENSION_DENIED"
  | "BUSINESS_IMPORT_MIME_NOT_ALLOWED"
  | "BUSINESS_IMPORT_MIME_MISMATCH"
  | "BUSINESS_IMPORT_CONTENT_INVALID"
  | "BUSINESS_IMPORT_POLYGLOT_DETECTED"
  | "BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED"
  | "BUSINESS_IMPORT_MACRO_DETECTED"
  | "BUSINESS_IMPORT_ARCHIVE_TRAVERSAL"
  | "BUSINESS_IMPORT_DECOMPRESSION_LIMIT"
  | "BUSINESS_IMPORT_ENCRYPTED_FILE"
  | "BUSINESS_IMPORT_EXTERNAL_REFERENCE_DETECTED"
  | "BUSINESS_IMPORT_MALWARE_DETECTED"
  | "BUSINESS_IMPORT_SCANNER_UNAVAILABLE"
  | "BUSINESS_IMPORT_SCANNER_TIMEOUT"
  | "BUSINESS_IMPORT_SCANNER_ERROR";

export class BusinessImportFileAdmissionError extends Error {
  constructor(
    readonly code: BusinessImportFileAdmissionErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "BusinessImportFileAdmissionError";
  }
}

export interface BusinessImportFileScanner {
  readonly identity: {
    provider: string;
    version: string;
    approvedForProduction: boolean;
  };
  scan(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: BusinessImportMimeType;
    signal: AbortSignal;
  }): Promise<
    | { verdict: "CLEAN" }
    | { verdict: "MALICIOUS"; signature?: string | null }
    | { verdict: "UNAVAILABLE" }
  >;
}

export interface BusinessImportAdmissionOptions {
  environment?: "PRODUCTION" | "TEST";
  maxBytes?: number;
  maxArchiveEntries?: number;
  maxDecompressedBytes?: number;
  maxDecompressionRatio?: number;
  scannerTimeoutMs?: number;
  scanner?: BusinessImportFileScanner;
  signal?: AbortSignal;
  audit?: (event: {
    outcome: "ACCEPTED" | "REJECTED";
    errorCode?: BusinessImportFileAdmissionErrorCode;
    byteCount: number;
    declaredMimeType: string;
    detectedMimeType?: string;
    scannerProvider?: string;
    scannerVersion?: string;
    sha256?: string;
  }) => void | Promise<void>;
}

export interface AcceptedBusinessImportFile {
  bytes: Uint8Array;
  provenance: {
    filename: string;
    extension: "csv" | "xlsx" | "pdf";
    declaredMimeType: BusinessImportMimeType;
    detectedMimeType: BusinessImportMimeType;
    byteSize: number;
    sha256: string;
    scannerProvider: string;
    scannerVersion: string;
  };
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DANGEROUS_EXTENSIONS = new Set([
  "bat", "cmd", "com", "dll", "docm", "exe", "hta", "html", "jar", "js", "lnk",
  "mjs", "msi", "ps1", "scr", "svg", "vbs", "xls", "xlsb", "xlsm", "xlam", "zip",
]);
const MIME_BY_EXTENSION = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

function fail(code: BusinessImportFileAdmissionErrorCode, retryable = false): never {
  throw new BusinessImportFileAdmissionError(code, retryable);
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || (point >= 0x7f && point <= 0x9f);
  });
}

export function validateBusinessImportUploadMetadata(input: {
  filename: string;
  declaredMimeType: string;
}): {
  filename: string;
  extension: "csv" | "xlsx" | "pdf";
  declaredMimeType: BusinessImportMimeType;
} {
  const filename = input.filename.normalize("NFC");
  if (
    !filename ||
    filename.length > 128 ||
    hasControlCharacter(filename) ||
    /[\u202a-\u202e\u2066-\u2069]/u.test(filename)
  ) fail("BUSINESS_IMPORT_FILENAME_INVALID");
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".." ||
    filename.includes("..")
  ) fail("BUSINESS_IMPORT_PATH_TRAVERSAL");
  if (
    filename.startsWith(".") ||
    filename.endsWith(".") ||
    filename.endsWith(" ") ||
    !/^[\p{L}\p{N}][\p{L}\p{N} _().-]*$/u.test(filename)
  ) fail("BUSINESS_IMPORT_FILENAME_INVALID");
  const segments = filename.toLocaleLowerCase().split(".");
  if (segments.length < 2) fail("BUSINESS_IMPORT_EXTENSION_DENIED");
  if (segments.slice(0, -1).some((segment) => DANGEROUS_EXTENSIONS.has(segment))) {
    fail("BUSINESS_IMPORT_EXTENSION_DENIED");
  }
  const extension = segments.at(-1);
  if (extension !== "csv" && extension !== "xlsx" && extension !== "pdf") {
    fail("BUSINESS_IMPORT_EXTENSION_DENIED");
  }
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (!Object.values(MIME_BY_EXTENSION).includes(input.declaredMimeType as BusinessImportMimeType)) {
    fail("BUSINESS_IMPORT_MIME_NOT_ALLOWED");
  }
  if (input.declaredMimeType !== expectedMime) fail("BUSINESS_IMPORT_MIME_MISMATCH");
  return { filename, extension, declaredMimeType: expectedMime };
}

async function readBounded(
  stream: AsyncIterable<Uint8Array>,
  maximum: number,
  signal?: AbortSignal,
) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) fail("BUSINESS_IMPORT_UPLOAD_ABORTED");
      const next = await iterator.next();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) fail("BUSINESS_IMPORT_CONTENT_INVALID");
      size += next.value.byteLength;
      if (size > maximum) fail("BUSINESS_IMPORT_FILE_TOO_LARGE");
      chunks.push(next.value);
    }
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    throw error;
  }
  if (size === 0) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function latin1(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("latin1");
}

function signature(bytes: Uint8Array) {
  const prefix = latin1(bytes.subarray(0, 16));
  if (prefix.startsWith("%PDF-")) return "pdf" as const;
  if (prefix.startsWith("PK\x03\x04")) return "zip" as const;
  if (prefix.startsWith("MZ") || prefix.startsWith("\x7fELF")) return "executable" as const;
  if (prefix.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")) return "ole" as const;
  return "text" as const;
}

function inspectCsv(bytes: Uint8Array) {
  const kind = signature(bytes);
  if (kind !== "text") {
    if (kind === "executable") fail("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
    if (kind === "ole") fail("BUSINESS_IMPORT_MACRO_DETECTED");
    fail("BUSINESS_IMPORT_MIME_MISMATCH");
  }
  if (bytes.includes(0)) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  const sample = latin1(bytes.subarray(0, Math.min(bytes.byteLength, 128 * 1024)));
  if (/<(?:script|iframe|object|embed|svg|html)\b|<!DOCTYPE|javascript:/iu.test(sample)) {
    fail("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
  }
  if (!/[,;\t]/u.test(sample)) fail("BUSINESS_IMPORT_MIME_MISMATCH");
}

interface ZipEntry {
  name: string;
  compressed: number;
  uncompressed: number;
  flags: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  fail("BUSINESS_IMPORT_CONTENT_INVALID");
}

function inspectZipDirectory(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxExpanded: number; maxRatio: number },
) {
  if (signature(bytes) !== "zip") fail("BUSINESS_IMPORT_MIME_MISMATCH");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes, view);
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (entries === 0 || entries > limits.maxEntries) fail("BUSINESS_IMPORT_DECOMPRESSION_LIMIT");
  if (directoryOffset + directorySize > end) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  const output: ZipEntry[] = [];
  let offset = directoryOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      fail("BUSINESS_IMPORT_CONTENT_INVALID");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.byteLength || nameLength === 0) fail("BUSINESS_IMPORT_CONTENT_INVALID");
    const name = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
    if (
      name.includes("\0") ||
      name.startsWith("/") ||
      name.startsWith("\\") ||
      /^[A-Za-z]:/u.test(name) ||
      name.split(/[\\/]/u).some((segment) => segment === "..")
    ) fail("BUSINESS_IMPORT_ARCHIVE_TRAVERSAL");
    if ((flags & 0x1) !== 0) fail("BUSINESS_IMPORT_ENCRYPTED_FILE");
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (
      totalUncompressed > limits.maxExpanded ||
      totalUncompressed / Math.max(1, totalCompressed) > limits.maxRatio
    ) fail("BUSINESS_IMPORT_DECOMPRESSION_LIMIT");
    output.push({ name, compressed, uncompressed, flags });
    offset = next;
  }
  if (offset !== directoryOffset + directorySize) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  return output;
}

function xmlText(value: Uint8Array, maximum: number) {
  if (value.byteLength > maximum) fail("BUSINESS_IMPORT_DECOMPRESSION_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) fail("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
  return text;
}

function inspectXlsx(
  bytes: Uint8Array,
  options: Required<Pick<
    BusinessImportAdmissionOptions,
    "maxArchiveEntries" | "maxDecompressedBytes" | "maxDecompressionRatio"
  >>,
) {
  const entries = inspectZipDirectory(bytes, {
    maxEntries: options.maxArchiveEntries,
    maxExpanded: options.maxDecompressedBytes,
    maxRatio: options.maxDecompressionRatio,
  });
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]) {
    if (!names.has(required)) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  }
  for (const { name } of entries) {
    const normalized = name.toLocaleLowerCase();
    if (
      normalized === "xl/vbaproject.bin" ||
      normalized.startsWith("xl/activex/") ||
      normalized.startsWith("xl/embeddings/") ||
      normalized.startsWith("customui/")
    ) fail("BUSINESS_IMPORT_MACRO_DETECTED");
    if (
      normalized.startsWith("xl/externallinks/") ||
      normalized === "xl/connections.xml" ||
      normalized.startsWith("xl/querytables/")
    ) fail("BUSINESS_IMPORT_EXTERNAL_REFERENCE_DETECTED");
  }
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    fail("BUSINESS_IMPORT_CONTENT_INVALID");
  }
  for (const [name, value] of Object.entries(archive)) {
    if (!name.toLocaleLowerCase().endsWith(".xml") && !name.toLocaleLowerCase().endsWith(".rels")) {
      continue;
    }
    let text: string;
    try {
      text = xmlText(value, options.maxDecompressedBytes);
    } catch (error) {
      if (error instanceof BusinessImportFileAdmissionError) throw error;
      fail("BUSINESS_IMPORT_CONTENT_INVALID");
    }
    if (
      /TargetMode\s*=\s*["']External["']/iu.test(text) ||
      /(?:Target|Source)\s*=\s*["'](?:https?|ftp|file):/iu.test(text) ||
      /(?:DDE|OLELink|externalLink|connection)\b/iu.test(text)
    ) fail("BUSINESS_IMPORT_EXTERNAL_REFERENCE_DETECTED");
    if (/application\/vnd\.ms-office\.vbaProject/iu.test(text)) {
      fail("BUSINESS_IMPORT_MACRO_DETECTED");
    }
  }
}

function inspectPdf(bytes: Uint8Array) {
  if (signature(bytes) !== "pdf") fail("BUSINESS_IMPORT_MIME_MISMATCH");
  const source = latin1(bytes);
  const eof = source.lastIndexOf("%%EOF");
  if (eof < 0) fail("BUSINESS_IMPORT_CONTENT_INVALID");
  if (source.slice(eof + 5).trim()) fail("BUSINESS_IMPORT_POLYGLOT_DETECTED");
  if (/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA)\b/u.test(source)) {
    fail("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
  }
  if (/\/Encrypt\b/u.test(source)) fail("BUSINESS_IMPORT_ENCRYPTED_FILE");
  if (/<(?:script|iframe|object|embed|svg|html)\b|javascript:/iu.test(source)) {
    fail("BUSINESS_IMPORT_ACTIVE_CONTENT_DETECTED");
  }
  if (source.slice(5).includes("MZ") || source.includes("PK\x03\x04")) {
    fail("BUSINESS_IMPORT_POLYGLOT_DETECTED");
  }
}

async function scan(
  scanner: BusinessImportFileScanner | undefined,
  input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: BusinessImportMimeType;
  },
  options: BusinessImportAdmissionOptions,
) {
  if (!scanner || (options.environment !== "TEST" && !scanner.identity.approvedForProduction)) {
    fail("BUSINESS_IMPORT_SCANNER_UNAVAILABLE", true);
  }
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BusinessImportFileAdmissionError("BUSINESS_IMPORT_SCANNER_TIMEOUT", true));
      }, options.scannerTimeoutMs ?? 10_000);
      timer.unref();
    });
    const result = await Promise.race([scanner.scan({ ...input, signal: controller.signal }), timeout]);
    if (result.verdict === "MALICIOUS") fail("BUSINESS_IMPORT_MALWARE_DETECTED");
    if (result.verdict === "UNAVAILABLE") fail("BUSINESS_IMPORT_SCANNER_UNAVAILABLE", true);
    return scanner.identity;
  } catch (error) {
    if (error instanceof BusinessImportFileAdmissionError) throw error;
    fail("BUSINESS_IMPORT_SCANNER_ERROR", true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function admitBusinessImportFile(
  input: {
    filename: string;
    declaredMimeType: string;
    stream: AsyncIterable<Uint8Array>;
  },
  options: BusinessImportAdmissionOptions = {},
): Promise<AcceptedBusinessImportFile> {
  let bytes = new Uint8Array();
  let detectedMimeType: BusinessImportMimeType | undefined;
  try {
    const metadata = validateBusinessImportUploadMetadata(input);
    bytes = await readBounded(input.stream, options.maxBytes ?? DEFAULT_MAX_BYTES, options.signal);
    if (metadata.extension === "csv") {
      inspectCsv(bytes);
      detectedMimeType = "text/csv";
    } else if (metadata.extension === "xlsx") {
      inspectXlsx(bytes, {
        maxArchiveEntries: options.maxArchiveEntries ?? 1_000,
        maxDecompressedBytes: options.maxDecompressedBytes ?? 50 * 1024 * 1024,
        maxDecompressionRatio: options.maxDecompressionRatio ?? 100,
      });
      detectedMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      inspectPdf(bytes);
      detectedMimeType = "application/pdf";
    }
    if (detectedMimeType !== metadata.declaredMimeType) fail("BUSINESS_IMPORT_MIME_MISMATCH");
    const scanner = await scan(
      options.scanner,
      { bytes, filename: metadata.filename, mimeType: detectedMimeType },
      options,
    );
    const accepted: AcceptedBusinessImportFile = {
      bytes,
      provenance: {
        filename: metadata.filename,
        extension: metadata.extension,
        declaredMimeType: metadata.declaredMimeType,
        detectedMimeType,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannerProvider: scanner.provider,
        scannerVersion: scanner.version,
      },
    };
    await options.audit?.({
      outcome: "ACCEPTED",
      byteCount: bytes.byteLength,
      declaredMimeType: metadata.declaredMimeType,
      detectedMimeType,
      scannerProvider: scanner.provider,
      scannerVersion: scanner.version,
      sha256: accepted.provenance.sha256,
    });
    return accepted;
  } catch (error) {
    const admission =
      error instanceof BusinessImportFileAdmissionError
        ? error
        : new BusinessImportFileAdmissionError("BUSINESS_IMPORT_CONTENT_INVALID");
    await options.audit?.({
      outcome: "REJECTED",
      errorCode: admission.code,
      byteCount: bytes.byteLength,
      declaredMimeType: input.declaredMimeType,
      ...(detectedMimeType ? { detectedMimeType } : {}),
      ...(options.scanner
        ? {
            scannerProvider: options.scanner.identity.provider,
            scannerVersion: options.scanner.identity.version,
          }
        : {}),
    });
    throw admission;
  }
}
