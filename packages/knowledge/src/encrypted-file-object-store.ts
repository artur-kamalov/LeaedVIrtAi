import { constants as fsConstants } from "node:fs";
import { mkdir, link, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export const knowledgeObjectStoreMessages = Object.freeze({
  CONFIG_INVALID: "Knowledge artifact storage is not configured safely.",
  KEY_INVALID: "The knowledge artifact key is invalid.",
  OBJECT_TOO_LARGE: "The knowledge artifact exceeds the storage limit.",
  OBJECT_EXISTS: "The knowledge artifact already exists.",
  OBJECT_NOT_FOUND: "The knowledge artifact was not found.",
  OBJECT_CORRUPT: "The knowledge artifact could not be verified.",
  STORAGE_FAILED: "The knowledge artifact storage operation failed.",
} as const);

export type KnowledgeObjectStoreErrorCode = keyof typeof knowledgeObjectStoreMessages;

export class KnowledgeObjectStoreError extends Error {
  constructor(readonly code: KnowledgeObjectStoreErrorCode) {
    super(knowledgeObjectStoreMessages[code]);
    this.name = "KnowledgeObjectStoreError";
  }
}

export interface KnowledgeObjectEncryptionKey {
  id: string;
  key: Uint8Array;
}

export interface KnowledgeObjectWriteResult {
  key: string;
  encryptionKeyRef: string;
  plaintextBytes: number;
  storedBytes: number;
}

export interface KnowledgeObjectStore {
  put(key: string, value: Uint8Array): Promise<KnowledgeObjectWriteResult>;
  get(key: string, encryptionKeyRef: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface EncryptedFileKnowledgeObjectStoreOptions {
  rootPath: string;
  activeKey: KnowledgeObjectEncryptionKey;
  decryptKeys?: readonly KnowledgeObjectEncryptionKey[];
  maxPlaintextBytes?: number;
}

const MAGIC = Buffer.from("LVK1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function fail(code: KnowledgeObjectStoreErrorCode): never {
  throw new KnowledgeObjectStoreError(code);
}

function boundedMaximum(value: number | undefined) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 64 * 1024 * 1024
    ? value
    : DEFAULT_MAX_PLAINTEXT_BYTES;
}

function normalizedEncryptionKey(input: KnowledgeObjectEncryptionKey) {
  if (!KEY_SEGMENT.test(input.id) || input.key.byteLength !== 32) fail("CONFIG_INVALID");
  return { id: input.id, key: Buffer.from(input.key) };
}

function validateObjectKey(key: string) {
  if (
    typeof key !== "string" ||
    key.length < 3 ||
    key.length > 700 ||
    key.includes("\\") ||
    key.startsWith("/") ||
    key.endsWith("/")
  ) {
    fail("KEY_INVALID");
  }
  const segments = key.split("/");
  if (segments.length < 2 || segments.some((segment) => !KEY_SEGMENT.test(segment))) {
    fail("KEY_INVALID");
  }
  return segments.join("/");
}

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function pathHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function createKnowledgeObjectKey(input: {
  tenantId: string;
  sourceId: string;
  purpose: "raw" | "extracted" | "embedding";
}) {
  if (!input.tenantId.trim() || !input.sourceId.trim()) fail("KEY_INVALID");
  return [
    "tenants",
    pathHash(input.tenantId),
    "sources",
    pathHash(input.sourceId),
    input.purpose,
    `${randomUUID()}.lvobj`,
  ].join("/");
}

export function createDeterministicKnowledgeObjectKey(input: {
  tenantId: string;
  sourceId: string;
  purpose: "raw" | "extracted" | "embedding";
  identity: string;
}) {
  if (!input.tenantId.trim() || !input.sourceId.trim() || !input.identity.trim()) {
    fail("KEY_INVALID");
  }
  return [
    "tenants",
    pathHash(input.tenantId),
    "sources",
    pathHash(input.sourceId),
    input.purpose,
    `${pathHash(`${input.purpose}\u0000${input.identity}`)}.lvobj`,
  ].join("/");
}

export function decodeKnowledgeObjectEncryptionKey(value: string) {
  try {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) fail("CONFIG_INVALID");
    const key = Buffer.from(normalized, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== normalized) fail("CONFIG_INVALID");
    return new Uint8Array(key);
  } catch (error) {
    if (error instanceof KnowledgeObjectStoreError) throw error;
    fail("CONFIG_INVALID");
  }
}

export class EncryptedFileKnowledgeObjectStore implements KnowledgeObjectStore {
  private readonly rootPath: string;
  private readonly activeKey: { id: string; key: Buffer };
  private readonly keys: Map<string, Buffer>;
  private readonly maxPlaintextBytes: number;

  constructor(options: EncryptedFileKnowledgeObjectStoreOptions) {
    if (!options.rootPath.trim() || !isAbsolute(options.rootPath)) fail("CONFIG_INVALID");
    this.rootPath = resolve(options.rootPath);
    this.activeKey = normalizedEncryptionKey(options.activeKey);
    const configuredKeys = [options.activeKey, ...(options.decryptKeys ?? [])];
    if (new Set(configuredKeys.map((item) => item.id)).size !== configuredKeys.length) {
      fail("CONFIG_INVALID");
    }
    this.keys = new Map(
      configuredKeys.map((item) => {
        const normalized = normalizedEncryptionKey(item);
        return [normalized.id, normalized.key] as const;
      }),
    );
    this.maxPlaintextBytes = boundedMaximum(options.maxPlaintextBytes);
  }

  async put(key: string, value: Uint8Array): Promise<KnowledgeObjectWriteResult> {
    const normalizedKey = validateObjectKey(key);
    if (!(value instanceof Uint8Array) || value.byteLength > this.maxPlaintextBytes) {
      fail("OBJECT_TOO_LARGE");
    }
    const target = await this.targetPath(normalizedKey, true);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.activeKey.key, iv);
    cipher.setAAD(Buffer.from(normalizedKey, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([MAGIC, iv, tag, ciphertext]);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporary,
        fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_WRONLY |
          (fsConstants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(payload);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporary, target);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          fail("OBJECT_EXISTS");
        }
        throw error;
      }
      await unlink(temporary);
      return {
        key: normalizedKey,
        encryptionKeyRef: this.activeKey.id,
        plaintextBytes: value.byteLength,
        storedBytes: payload.byteLength,
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      if (error instanceof KnowledgeObjectStoreError) throw error;
      fail("STORAGE_FAILED");
    }
  }

  async get(key: string, encryptionKeyRef: string) {
    const normalizedKey = validateObjectKey(key);
    const encryptionKey = this.keys.get(encryptionKeyRef);
    if (!encryptionKey) fail("CONFIG_INVALID");
    const target = await this.targetPath(normalizedKey, false);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const metadata = await handle.stat();
      const maximumStoredBytes = this.maxPlaintextBytes + MAGIC.length + IV_BYTES + TAG_BYTES;
      if (
        !metadata.isFile() ||
        metadata.size < MAGIC.length + IV_BYTES + TAG_BYTES ||
        metadata.size > maximumStoredBytes
      ) {
        fail("OBJECT_CORRUPT");
      }
      const payload = await handle.readFile();
      if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) fail("OBJECT_CORRUPT");
      const ivStart = MAGIC.length;
      const tagStart = ivStart + IV_BYTES;
      const contentStart = tagStart + TAG_BYTES;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey,
        payload.subarray(ivStart, tagStart),
      );
      decipher.setAAD(Buffer.from(normalizedKey, "utf8"));
      decipher.setAuthTag(payload.subarray(tagStart, contentStart));
      return new Uint8Array(
        Buffer.concat([decipher.update(payload.subarray(contentStart)), decipher.final()]),
      );
    } catch (error) {
      if (error instanceof KnowledgeObjectStoreError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        fail("OBJECT_NOT_FOUND");
      }
      fail("OBJECT_CORRUPT");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async delete(key: string) {
    const target = await this.targetPath(validateObjectKey(key), false);
    try {
      await unlink(target);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
        return;
      fail("STORAGE_FAILED");
    }
  }

  private async targetPath(key: string, createParent: boolean) {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const resolvedRoot = await realpath(this.rootPath);
    const target = resolve(resolvedRoot, ...key.split("/"));
    if (!inside(resolvedRoot, target)) fail("KEY_INVALID");
    const parent = dirname(target);
    if (createParent) await mkdir(parent, { recursive: true, mode: 0o700 });
    let resolvedParent: string;
    try {
      resolvedParent = await realpath(parent);
    } catch {
      if (!createParent) fail("OBJECT_NOT_FOUND");
      fail("STORAGE_FAILED");
    }
    if (!inside(resolvedRoot, resolvedParent)) fail("KEY_INVALID");
    return resolve(resolvedParent, target.slice(parent.length + 1));
  }
}
