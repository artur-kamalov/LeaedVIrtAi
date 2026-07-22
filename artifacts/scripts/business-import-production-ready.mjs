import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { isAbsolute, join } from "node:path";

function fail(code) {
  console.error(`FAIL: ${code}`);
  process.exit(1);
}

const expected = {
  BUSINESS_IMPORT_ENABLED: "true",
  BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED: "false",
  BUSINESS_IMPORT_PARSER_APPROVED: "false",
  BUSINESS_IMPORT_PARSER_URL: "",
  BUSINESS_IMPORT_PARSER_VERSION: "unconfigured",
  KNOWLEDGE_FILE_SCANNER_APPROVED: "true",
  KNOWLEDGE_FILE_SCANNER_HOST: "clamav",
  KNOWLEDGE_FILE_SCANNER_PORT: "3310",
};

for (const [name, value] of Object.entries(expected)) {
  if (process.env[name] !== value) fail(`BUSINESS_IMPORT_PRODUCTION_ENV_${name}`);
}

const objectStorePath = process.env.KNOWLEDGE_OBJECT_STORE_PATH?.trim() ?? "";
if (!objectStorePath || !isAbsolute(objectStorePath)) {
  fail("BUSINESS_IMPORT_OBJECT_STORE_PATH_INVALID");
}
try {
  accessSync(objectStorePath, constants.R_OK | constants.W_OK);
} catch {
  fail("BUSINESS_IMPORT_OBJECT_STORE_UNAVAILABLE");
}

async function probeObjectStore() {
  const probePath = join(
    objectStorePath,
    `.business-import-readiness-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  let handle;
  let failed = false;
  try {
    handle = await open(probePath, "wx", 0o600);
    await handle.writeFile("leadvirt-business-import-readiness\n", "utf8");
    await handle.sync();
  } catch {
    failed = true;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        failed = true;
      }
      try {
        await unlink(probePath);
      } catch {
        failed = true;
      }
    }
  }
  if (failed) fail("BUSINESS_IMPORT_OBJECT_STORE_PROBE_FAILED");
}

await probeObjectStore();

const key = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY?.trim() ?? "";
if (!/^[A-Za-z0-9+/]{43}=$/u.test(key)) fail("BUSINESS_IMPORT_ENCRYPTION_KEY_INVALID");
const decodedKey = Buffer.from(key, "base64");
if (decodedKey.byteLength !== 32 || decodedKey.toString("base64") !== key) {
  fail("BUSINESS_IMPORT_ENCRYPTION_KEY_INVALID");
}

const keyId = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID?.trim() ?? "";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(keyId)) {
  fail("BUSINESS_IMPORT_ENCRYPTION_KEY_ID_INVALID");
}

async function probeScanner() {
  const host = process.env.KNOWLEDGE_FILE_SCANNER_HOST;
  const port = Number.parseInt(process.env.KNOWLEDGE_FILE_SCANNER_PORT, 10);
  const bytes = Buffer.from("external_id,name\nrollout-probe,Rollout probe\n", "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  const terminator = Buffer.alloc(4);
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(10_000);
    socket.once("connect", () => {
      socket.write(Buffer.concat([Buffer.from("zINSTREAM\0", "utf8"), length, bytes, terminator]));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 512) finish(new Error("response_limit"));
      if (response.includes("\0")) {
        finish(response.replaceAll("\0", "").trim() === "stream: OK" ? null : new Error("scan"));
      }
    });
    socket.once("timeout", () => finish(new Error("timeout")));
    socket.once("error", finish);
    socket.once("end", () => {
      finish(response.replaceAll("\0", "").trim() === "stream: OK" ? null : new Error("scan"));
    });
  });
}

try {
  await probeScanner();
} catch {
  fail("BUSINESS_IMPORT_SCANNER_UNAVAILABLE");
}

console.log("PASS: CSV Business Import production prerequisites are ready.");
