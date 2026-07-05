import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const totpPeriodSeconds = 30;
const totpDigits = 6;

function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value: string) {
  const cleaned = value.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid base32 secret.");
    }
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function counterBuffer(counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

function hotp(secret: string, counter: number) {
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    (((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)) %
    10 ** totpDigits;
  return code.toString().padStart(totpDigits, "0");
}

function normalizeCode(code: string) {
  return code.replace(/[\s-]/g, "");
}

function safeEquals(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

function encryptionKey() {
  const source = process.env.AUTH_2FA_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? process.env.DATABASE_URL ?? "leadvirt-local-2fa-dev-key";
  return createHash("sha256").update(source).digest();
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpAuthUri(input: { issuer: string; accountName: string; secret: string }) {
  const issuer = encodeURIComponent(input.issuer);
  const accountName = encodeURIComponent(input.accountName);
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(totpDigits),
    period: String(totpPeriodSeconds)
  });
  return `otpauth://totp/${issuer}:${accountName}?${query.toString()}`;
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  const normalized = normalizeCode(code);
  if (!/^\d{6}$/.test(normalized)) return false;

  const counter = Math.floor(now / 1000 / totpPeriodSeconds);
  for (const drift of [-1, 0, 1]) {
    if (safeEquals(hotp(secret, counter + drift), normalized)) return true;
  }

  return false;
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptTotpSecret(encryptedSecret: string) {
  const [version, iv, tag, encrypted] = encryptedSecret.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported TOTP secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const left = randomBytes(4).toString("hex").toUpperCase();
    const right = randomBytes(4).toString("hex").toUpperCase();
    return `LV-${left}-${right}`;
  });
}
