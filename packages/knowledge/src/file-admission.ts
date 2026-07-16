import { createHash } from "node:crypto";

export type KnowledgeFileMimeType = "text/plain" | "text/csv" | "application/pdf";

export type KnowledgeFileAdmissionErrorCode =
  | "KNOWLEDGE_UPLOAD_STREAM_ABORTED"
  | "KNOWLEDGE_UPLOAD_FILE_TOO_LARGE"
  | "KNOWLEDGE_UPLOAD_FILENAME_INVALID"
  | "KNOWLEDGE_UPLOAD_PATH_TRAVERSAL"
  | "KNOWLEDGE_UPLOAD_EXTENSION_DENIED"
  | "KNOWLEDGE_UPLOAD_MIME_NOT_ALLOWED"
  | "KNOWLEDGE_UPLOAD_MIME_MISMATCH"
  | "KNOWLEDGE_UPLOAD_CONTENT_INVALID"
  | "KNOWLEDGE_UPLOAD_POLYGLOT_DETECTED"
  | "KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED"
  | "KNOWLEDGE_UPLOAD_MACRO_DETECTED"
  | "KNOWLEDGE_UPLOAD_ARCHIVE_TRAVERSAL"
  | "KNOWLEDGE_UPLOAD_DECOMPRESSION_LIMIT"
  | "KNOWLEDGE_UPLOAD_MALWARE_DETECTED"
  | "KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE"
  | "KNOWLEDGE_UPLOAD_SCANNER_TIMEOUT"
  | "KNOWLEDGE_UPLOAD_SCANNER_ERROR";

export class KnowledgeFileAdmissionError extends Error {
  constructor(
    readonly code: KnowledgeFileAdmissionErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "KnowledgeFileAdmissionError";
  }
}

export interface KnowledgeFileScanner {
  readonly identity: {
    provider: string;
    version: string;
    approvedForProduction: boolean;
  };
  scan(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: KnowledgeFileMimeType;
    signal: AbortSignal;
  }): Promise<
    | { verdict: "CLEAN" }
    | { verdict: "MALICIOUS"; signature?: string | null }
    | { verdict: "UNAVAILABLE" }
  >;
}

export interface KnowledgeFileAdmissionAuditEvent {
  outcome: "ACCEPTED" | "REJECTED";
  errorCode?: KnowledgeFileAdmissionErrorCode;
  byteCount: number;
  declaredMimeType: string;
  detectedMimeType?: string;
  scannerProvider?: string;
  scannerVersion?: string;
  sha256?: string;
}

export interface KnowledgeFileAdmissionOptions {
  environment?: "PRODUCTION" | "TEST";
  maxBytes?: number;
  maxArchiveEntries?: number;
  maxDecompressedBytes?: number;
  maxDecompressionRatio?: number;
  scannerTimeoutMs?: number;
  scanner?: KnowledgeFileScanner;
  signal?: AbortSignal;
  audit?: (event: KnowledgeFileAdmissionAuditEvent) => void | Promise<void>;
}

export interface AcceptedKnowledgeFile {
  bytes: Uint8Array;
  provenance: {
    filename: string;
    extension: "txt" | "csv" | "pdf";
    declaredMimeType: KnowledgeFileMimeType;
    detectedMimeType: KnowledgeFileMimeType;
    byteSize: number;
    sha256: string;
    scannerProvider: string;
    scannerVersion: string;
  };
}

const defaultMaxBytes = 10 * 1024 * 1024;
const dangerousExtensions = new Set([
  "bat", "cmd", "com", "dll", "docm", "exe", "hta", "html", "jar", "js", "lnk",
  "mjs", "msi", "ps1", "scr", "svg", "vbs", "xlsm", "zip",
]);
const mimeByExtension = {
  txt: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
} as const;

function fail(code: KnowledgeFileAdmissionErrorCode, retryable = false): never {
  throw new KnowledgeFileAdmissionError(code, retryable);
}

function sanitizeFilename(value: string): {
  filename: string;
  extension: "txt" | "csv" | "pdf";
} {
  const normalized = value.normalize("NFC");
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (
    !normalized ||
    normalized.length > 128 ||
    hasControlCharacter ||
    /[\u202a-\u202e\u2066-\u2069]/u.test(normalized)
  ) fail("KNOWLEDGE_UPLOAD_FILENAME_INVALID");
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("..")
  ) fail("KNOWLEDGE_UPLOAD_PATH_TRAVERSAL");
  if (
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    normalized.endsWith(" ") ||
    !/^[\p{L}\p{N}][\p{L}\p{N} _().-]*$/u.test(normalized)
  ) fail("KNOWLEDGE_UPLOAD_FILENAME_INVALID");
  const segments = normalized.toLocaleLowerCase().split(".");
  if (segments.length < 2) fail("KNOWLEDGE_UPLOAD_EXTENSION_DENIED");
  if (segments.slice(0, -1).some((segment) => dangerousExtensions.has(segment))) {
    fail("KNOWLEDGE_UPLOAD_EXTENSION_DENIED");
  }
  const candidateExtension = segments.at(-1);
  if (
    candidateExtension !== "txt" &&
    candidateExtension !== "csv" &&
    candidateExtension !== "pdf"
  ) {
    fail("KNOWLEDGE_UPLOAD_EXTENSION_DENIED");
  }
  const extension: "txt" | "csv" | "pdf" = candidateExtension;
  return { filename: normalized, extension };
}

export function validateKnowledgeFileUploadMetadata(input: {
  filename: string;
  declaredMimeType: string;
}) {
  const safe = sanitizeFilename(input.filename);
  const expectedMime = mimeByExtension[safe.extension];
  if (!Object.values(mimeByExtension).includes(input.declaredMimeType as KnowledgeFileMimeType)) {
    fail("KNOWLEDGE_UPLOAD_MIME_NOT_ALLOWED");
  }
  if (input.declaredMimeType !== expectedMime) fail("KNOWLEDGE_UPLOAD_MIME_MISMATCH");
  return { ...safe, declaredMimeType: expectedMime };
}

async function readBounded(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
  onProgress?: (byteCount: number) => void,
) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      if (signal?.aborted) fail("KNOWLEDGE_UPLOAD_STREAM_ABORTED");
      const next = signal
        ? await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
            const aborted = () => reject(
              new KnowledgeFileAdmissionError("KNOWLEDGE_UPLOAD_STREAM_ABORTED"),
            );
            signal.addEventListener("abort", aborted, { once: true });
            iterator.next().then(resolve, reject).finally(() =>
              signal.removeEventListener("abort", aborted));
          })
        : await iterator.next();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) fail("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
      byteCount += next.value.byteLength;
      onProgress?.(byteCount);
      if (byteCount > maxBytes) fail("KNOWLEDGE_UPLOAD_FILE_TOO_LARGE");
      chunks.push(next.value);
    }
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function ascii(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("latin1");
}

function inspectArchive(
  bytes: Uint8Array,
  options: Required<Pick<
    KnowledgeFileAdmissionOptions,
    "maxArchiveEntries" | "maxDecompressedBytes" | "maxDecompressionRatio"
  >>,
) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let entries = 0;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    entries += 1;
    if (entries > options.maxArchiveEntries) fail("KNOWLEDGE_UPLOAD_DECOMPRESSION_LIMIT");
    const compressed = view.getUint32(offset + 18, true);
    const uncompressed = view.getUint32(offset + 22, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (offset + 30 + filenameLength + extraLength > bytes.length) {
      fail("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
    }
    const entryName = Buffer.from(
      bytes.subarray(offset + 30, offset + 30 + filenameLength),
    ).toString("utf8");
    if (
      entryName.startsWith("/") ||
      entryName.startsWith("\\") ||
      entryName.split(/[\\/]/u).some((segment) => segment === "..")
    ) fail("KNOWLEDGE_UPLOAD_ARCHIVE_TRAVERSAL");
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (
      totalUncompressed > options.maxDecompressedBytes ||
      totalUncompressed / Math.max(1, totalCompressed) > options.maxDecompressionRatio
    ) fail("KNOWLEDGE_UPLOAD_DECOMPRESSION_LIMIT");
    offset += 30 + filenameLength + extraLength + compressed;
  }
  return true;
}

function detectMime(bytes: Uint8Array, extension: "txt" | "csv" | "pdf") {
  const source = ascii(bytes);
  const signatures = [
    source.startsWith("%PDF-") ? "pdf" : null,
    source.startsWith("MZ") || source.startsWith("\x7fELF") ? "executable" : null,
    source.startsWith("PK\x03\x04") ? "archive" : null,
    source.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") ? "ole" : null,
  ].filter(Boolean);
  if (signatures.length > 1) fail("KNOWLEDGE_UPLOAD_POLYGLOT_DETECTED");
  if (signatures[0] === "archive" || signatures[0] === "ole") {
    fail("KNOWLEDGE_UPLOAD_MACRO_DETECTED");
  }
  if (signatures[0] === "executable") fail("KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  if (signatures[0] === "pdf") return "application/pdf" as const;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
  }
  if (text.includes("\0")) fail("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
  if (
    /<(?:script|iframe|object|embed|svg|html)\b|<!DOCTYPE|javascript:|data:text\/html/iu.test(text)
  ) fail("KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  if (extension === "csv") {
    const lines = text.split(/\r?\n/u).filter((line) => line.trim());
    if (!lines.some((line) => /[,;\t]/u.test(line))) fail("KNOWLEDGE_UPLOAD_MIME_MISMATCH");
    if (lines.some((line) => line.split(/[,;\t]/u).some((cell) => /^[=+@]/u.test(cell.trim())))) {
      fail("KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
    }
    return "text/csv" as const;
  }
  return "text/plain" as const;
}

function inspectPdf(bytes: Uint8Array) {
  const source = ascii(bytes);
  const eof = source.lastIndexOf("%%EOF");
  if (eof < 0) fail("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
  if (source.slice(eof + 5).trim()) fail("KNOWLEDGE_UPLOAD_POLYGLOT_DETECTED");
  if (/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA)\b/u.test(source)) {
    fail("KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  }
  if (/<(?:script|iframe|object|embed|svg|html)\b|javascript:/iu.test(source)) {
    fail("KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  }
  if (source.slice(5).includes("MZ") || source.includes("PK\x03\x04")) {
    fail("KNOWLEDGE_UPLOAD_POLYGLOT_DETECTED");
  }
}

async function scan(
  scanner: KnowledgeFileScanner | undefined,
  input: { bytes: Uint8Array; filename: string; mimeType: KnowledgeFileMimeType },
  options: KnowledgeFileAdmissionOptions,
) {
  if (!scanner || (options.environment !== "TEST" && !scanner.identity.approvedForProduction)) {
    fail("KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE", true);
  }
  const controller = new AbortController();
  const timeoutMs = options.scannerTimeoutMs ?? 10_000;
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new KnowledgeFileAdmissionError("KNOWLEDGE_UPLOAD_SCANNER_TIMEOUT", true));
      }, timeoutMs);
      timer.unref();
    });
    const operation = scanner.scan({ ...input, signal: controller.signal });
    const result = await Promise.race([operation, timeout]);
    if (result.verdict === "MALICIOUS") fail("KNOWLEDGE_UPLOAD_MALWARE_DETECTED");
    if (result.verdict === "UNAVAILABLE") fail("KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE", true);
    return scanner.identity;
  } catch (error) {
    if (error instanceof KnowledgeFileAdmissionError) throw error;
    fail("KNOWLEDGE_UPLOAD_SCANNER_ERROR", true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function admitKnowledgeFile(
  input: {
    filename: string;
    declaredMimeType: string;
    stream: AsyncIterable<Uint8Array>;
  },
  options: KnowledgeFileAdmissionOptions = {},
): Promise<AcceptedKnowledgeFile> {
  let byteCount = 0;
  let detectedMimeType: string | undefined;
  const safeDeclaredMimeType = Object.values(mimeByExtension).includes(
    input.declaredMimeType as KnowledgeFileMimeType,
  ) ? input.declaredMimeType : "invalid";
  const audit = async (
    outcome: "ACCEPTED" | "REJECTED",
    errorCode?: KnowledgeFileAdmissionErrorCode,
    accepted?: AcceptedKnowledgeFile,
  ) => {
    await options.audit?.({
      outcome,
      ...(errorCode ? { errorCode } : {}),
      byteCount: accepted?.provenance.byteSize ?? byteCount,
      declaredMimeType: safeDeclaredMimeType,
      ...(detectedMimeType ? { detectedMimeType } : {}),
      ...(options.scanner
        ? {
            scannerProvider: options.scanner.identity.provider,
            scannerVersion: options.scanner.identity.version,
          }
        : {}),
      ...(accepted ? { sha256: accepted.provenance.sha256 } : {}),
    });
  };
  try {
    const safe = validateKnowledgeFileUploadMetadata(input);
    const expectedMime = safe.declaredMimeType;
    const bytes = await readBounded(
      input.stream,
      options.maxBytes ?? defaultMaxBytes,
      options.signal,
      (count) => { byteCount = count; },
    );
    byteCount = bytes.byteLength;
    inspectArchive(bytes, {
      maxArchiveEntries: options.maxArchiveEntries ?? 100,
      maxDecompressedBytes: options.maxDecompressedBytes ?? 100 * 1024 * 1024,
      maxDecompressionRatio: options.maxDecompressionRatio ?? 100,
    });
    const detected = detectMime(bytes, safe.extension);
    detectedMimeType = detected;
    if (detected !== expectedMime) fail("KNOWLEDGE_UPLOAD_MIME_MISMATCH");
    if (detected === "application/pdf") inspectPdf(bytes);
    const scannerIdentity = await scan(options.scanner, {
      bytes,
      filename: safe.filename,
      mimeType: detected,
    }, options);
    const accepted: AcceptedKnowledgeFile = {
      bytes,
      provenance: {
        filename: safe.filename,
        extension: safe.extension,
        declaredMimeType: expectedMime,
        detectedMimeType: detected,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannerProvider: scannerIdentity.provider,
        scannerVersion: scannerIdentity.version,
      },
    };
    await audit("ACCEPTED", undefined, accepted);
    return accepted;
  } catch (error) {
    const admissionError = error instanceof KnowledgeFileAdmissionError
      ? error
      : new KnowledgeFileAdmissionError("KNOWLEDGE_UPLOAD_CONTENT_INVALID");
    await audit("REJECTED", admissionError.code);
    throw admissionError;
  }
}
