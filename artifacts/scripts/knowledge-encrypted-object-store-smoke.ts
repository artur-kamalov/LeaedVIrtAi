import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
} from "@leadvirt/knowledge";

let checks = 0;

function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks += 1;
}

async function expectCode(work: Promise<unknown> | (() => unknown), code: KnowledgeObjectStoreError["code"]) {
  const promise = typeof work === "function" ? Promise.resolve().then(work) : work;
  await assert.rejects(promise, (error) => {
    checks += 1;
    return error instanceof KnowledgeObjectStoreError && error.code === code;
  });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "leadvirt-knowledge-store-"));
  const active = { id: "artifact-key-v1", key: randomBytes(32) };
  try {
    const store = new EncryptedFileKnowledgeObjectStore({
      rootPath: root,
      activeKey: active,
      maxPlaintextBytes: 1024,
    });
    const objectKey = createKnowledgeObjectKey({
      tenantId: "tenant-sensitive-id",
      sourceId: "source-sensitive-id",
      purpose: "raw",
    });
    check(objectKey.startsWith("tenants/"), "object key is tenant namespaced");
    check(!objectKey.includes("tenant-sensitive-id"), "object key does not expose tenant id");
    check(!objectKey.includes("source-sensitive-id"), "object key does not expose source id");

    const plaintext = new TextEncoder().encode("Confidential website source body");
    const written = await store.put(objectKey, plaintext);
    check(written.encryptionKeyRef === active.id, "active key reference is returned");
    check(written.plaintextBytes === plaintext.byteLength, "plaintext length is recorded");
    check(written.storedBytes > plaintext.byteLength, "authenticated envelope overhead is present");

    const raw = await readFile(join(root, ...objectKey.split("/")));
    check(!raw.includes(Buffer.from(plaintext)), "stored artifact does not contain plaintext");
    check(raw.subarray(0, 4).toString("ascii") === "LVK1", "stored artifact has a versioned envelope");
    check(
      Buffer.from(await store.get(objectKey, active.id)).equals(Buffer.from(plaintext)),
      "artifact decrypts exactly",
    );

    await expectCode(store.put(objectKey, plaintext), "OBJECT_EXISTS");
    await expectCode(store.get(objectKey, "missing-key"), "CONFIG_INVALID");
    await expectCode(store.put("../escape", plaintext), "KEY_INVALID");
    await expectCode(store.put("single", plaintext), "KEY_INVALID");
    await expectCode(store.put(createKnowledgeObjectKey({ tenantId: "t", sourceId: "s", purpose: "raw" }), randomBytes(1025)), "OBJECT_TOO_LARGE");

    const wrongKeyStore = new EncryptedFileKnowledgeObjectStore({
      rootPath: root,
      activeKey: { id: active.id, key: randomBytes(32) },
    });
    await expectCode(wrongKeyStore.get(objectKey, active.id), "OBJECT_CORRUPT");

    const tamperedKey = createKnowledgeObjectKey({ tenantId: "t", sourceId: "s", purpose: "raw" });
    await store.put(tamperedKey, plaintext);
    const tamperedPath = join(root, ...tamperedKey.split("/"));
    const tampered = await readFile(tamperedPath);
    tampered[tampered.length - 1] ^= 0xff;
    await writeFile(tamperedPath, tampered);
    await expectCode(store.get(tamperedKey, active.id), "OBJECT_CORRUPT");

    await store.delete(objectKey);
    await store.delete(objectKey);
    await expectCode(store.get(objectKey, active.id), "OBJECT_NOT_FOUND");

    const encoded = Buffer.from(active.key).toString("base64");
    check(Buffer.from(decodeKnowledgeObjectEncryptionKey(encoded)).equals(active.key), "base64 key decodes exactly");
    await expectCode(() => decodeKnowledgeObjectEncryptionKey("not-a-32-byte-key"), "CONFIG_INVALID");
    await expectCode(
      () =>
        new EncryptedFileKnowledgeObjectStore({
          rootPath: "relative/path",
          activeKey: active,
        }),
      "CONFIG_INVALID",
    );
    await expectCode(
      () =>
        new EncryptedFileKnowledgeObjectStore({
          rootPath: root,
          activeKey: active,
          decryptKeys: [{ id: active.id, key: active.key }],
        }),
      "CONFIG_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log(`Knowledge encrypted object store smoke: ${checks}/${checks} checks passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
