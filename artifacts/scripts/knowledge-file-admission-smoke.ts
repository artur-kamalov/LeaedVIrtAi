import assert from "node:assert/strict";
import {
  admitKnowledgeFile,
  KnowledgeFileAdmissionError,
  type KnowledgeFileAdmissionAuditEvent,
  type KnowledgeFileScanner,
} from "@leadvirt/knowledge";

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);
const stream = async function* (...chunks: Uint8Array[]) {
  for (const chunk of chunks) yield chunk;
};

class FixtureScanner implements KnowledgeFileScanner {
  readonly identity = {
    provider: "fixture-scanner",
    version: "test-v1",
    approvedForProduction: false,
  };

  constructor(private readonly mode: "CLEAN" | "UNAVAILABLE" | "ERROR" | "TIMEOUT" = "CLEAN") {}

  async scan(input: { bytes: Uint8Array; signal: AbortSignal }) {
    if (this.mode === "UNAVAILABLE") return { verdict: "UNAVAILABLE" as const };
    if (this.mode === "ERROR") throw new Error("fixture scanner error");
    if (this.mode === "TIMEOUT") {
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }));
      return { verdict: "UNAVAILABLE" as const };
    }
    const text = Buffer.from(input.bytes).toString("utf8");
    if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return { verdict: "MALICIOUS" as const, signature: "fixture-eicar" };
    }
    return { verdict: "CLEAN" as const };
  }
}

function zipLocalEntry(name: string, compressed: number, uncompressed: number) {
  const nameBytes = bytes(name);
  const value = new Uint8Array(30 + nameBytes.length + compressed);
  const view = new DataView(value.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(18, compressed, true);
  view.setUint32(22, uncompressed, true);
  view.setUint16(26, nameBytes.length, true);
  value.set(nameBytes, 30);
  return value;
}

async function expectCode(
  action: Promise<unknown>,
  code: KnowledgeFileAdmissionError["code"],
) {
  await assert.rejects(action, (error: unknown) =>
    error instanceof KnowledgeFileAdmissionError && error.code === code);
}

async function main() {
  const auditEvents: KnowledgeFileAdmissionAuditEvent[] = [];
  const baseOptions = {
    environment: "TEST" as const,
    scanner: new FixtureScanner(),
    audit: (event: KnowledgeFileAdmissionAuditEvent) => { auditEvents.push(event); },
  };
  const text = await admitKnowledgeFile({
    filename: "notes.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("Clean support notes.")),
  }, baseOptions);
  assert.equal(text.provenance.detectedMimeType, "text/plain");
  assert.match(text.provenance.sha256, /^[a-f0-9]{64}$/u);
  const csv = await admitKnowledgeFile({
    filename: "catalog.csv",
    declaredMimeType: "text/csv",
    stream: stream(bytes("sku,name\n1,Consultation\n")),
  }, baseOptions);
  assert.equal(csv.provenance.detectedMimeType, "text/csv");
  const pdf = await admitKnowledgeFile({
    filename: "policy.pdf",
    declaredMimeType: "application/pdf",
    stream: stream(bytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n")),
  }, baseOptions);
  assert.equal(pdf.provenance.detectedMimeType, "application/pdf");

  await expectCode(admitKnowledgeFile({
    filename: "eicar.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_MALWARE_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "spoof.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("%PDF-1.4\n%%EOF")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_MIME_MISMATCH");
  await expectCode(admitKnowledgeFile({
    filename: "invalid-mime.txt",
    declaredMimeType: "PRIVATE_MIME_SECRET",
    stream: stream(bytes("clean")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_MIME_NOT_ALLOWED");
  await expectCode(admitKnowledgeFile({
    filename: "invoice.pdf.exe",
    declaredMimeType: "application/pdf",
    stream: stream(bytes("%PDF-1.4\n%%EOF")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_EXTENSION_DENIED");
  await expectCode(admitKnowledgeFile({
    filename: "../private.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("secret")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_PATH_TRAVERSAL");
  await expectCode(admitKnowledgeFile({
    filename: "large.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("1234"), bytes("5678")),
  }, { ...baseOptions, maxBytes: 7 }), "KNOWLEDGE_UPLOAD_FILE_TOO_LARGE");
  await expectCode(admitKnowledgeFile({
    filename: "archive.txt",
    declaredMimeType: "text/plain",
    stream: stream(zipLocalEntry("../escape.txt", 1, 1)),
  }, baseOptions), "KNOWLEDGE_UPLOAD_ARCHIVE_TRAVERSAL");
  await expectCode(admitKnowledgeFile({
    filename: "bomb.txt",
    declaredMimeType: "text/plain",
    stream: stream(zipLocalEntry("safe.txt", 1, 1_000_000)),
  }, { ...baseOptions, maxDecompressionRatio: 10 }), "KNOWLEDGE_UPLOAD_DECOMPRESSION_LIMIT");
  await expectCode(admitKnowledgeFile({
    filename: "macro.txt",
    declaredMimeType: "text/plain",
    stream: stream(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  }, baseOptions), "KNOWLEDGE_UPLOAD_MACRO_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "active.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("<script>sendSecrets()</script>")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "active.pdf",
    declaredMimeType: "application/pdf",
    stream: stream(bytes("%PDF-1.4\n/OpenAction 1 0 R\n%%EOF")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "polyglot.pdf",
    declaredMimeType: "application/pdf",
    stream: stream(bytes("%PDF-1.4\nMZ executable\n%%EOF")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_POLYGLOT_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "formula.csv",
    declaredMimeType: "text/csv",
    stream: stream(bytes("name,value\nitem,=cmd|' /C calc'!A0\n")),
  }, baseOptions), "KNOWLEDGE_UPLOAD_ACTIVE_CONTENT_DETECTED");
  await expectCode(admitKnowledgeFile({
    filename: "outage.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("clean")),
  }, { ...baseOptions, scanner: new FixtureScanner("UNAVAILABLE") }),
  "KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE");
  await expectCode(admitKnowledgeFile({
    filename: "timeout.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("clean")),
  }, { ...baseOptions, scanner: new FixtureScanner("TIMEOUT"), scannerTimeoutMs: 5 }),
  "KNOWLEDGE_UPLOAD_SCANNER_TIMEOUT");
  await expectCode(admitKnowledgeFile({
    filename: "error.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("clean")),
  }, { ...baseOptions, scanner: new FixtureScanner("ERROR") }),
  "KNOWLEDGE_UPLOAD_SCANNER_ERROR");
  await expectCode(admitKnowledgeFile({
    filename: "production.txt",
    declaredMimeType: "text/plain",
    stream: stream(bytes("clean")),
  }, { scanner: new FixtureScanner() }), "KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE");

  const abort = new AbortController();
  let streamClosed = false;
  const blockingStream = async function* () {
    try {
      yield bytes("first");
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    } finally {
      streamClosed = true;
    }
  };
  const abortedAdmission = admitKnowledgeFile({
    filename: "aborted.txt",
    declaredMimeType: "text/plain",
    stream: blockingStream(),
  }, { ...baseOptions, signal: abort.signal });
  setTimeout(() => abort.abort(), 5).unref();
  await expectCode(abortedAdmission, "KNOWLEDGE_UPLOAD_STREAM_ABORTED");
  assert.equal(streamClosed, true);

  const auditJson = JSON.stringify(auditEvents);
  assert.equal(auditJson.includes("EICAR-STANDARD"), false);
  assert.equal(auditJson.includes("sendSecrets"), false);
  assert.equal(auditJson.includes("PRIVATE_MIME_SECRET"), false);
  assert.ok(auditEvents.filter((event) => event.outcome === "REJECTED").every(
    (event) => event.sha256 === undefined,
  ));
  assert.equal(auditEvents.filter((event) => event.outcome === "ACCEPTED").length, 3);
  console.log(JSON.stringify({ checks: 26, passed: 26 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
