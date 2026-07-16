import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import type {
  WebsiteSourceConnectionResponse,
  WebsiteSourceConnectionTarget,
  WebsiteSourceConnector,
} from "./website-source-url-security.js";

export const pinnedHttpsConnectorMessages = Object.freeze({
  TARGET_INVALID: "The approved website target is invalid.",
  ABORTED: "Website acquisition was cancelled.",
  TIMEOUT: "The website did not respond in time.",
  TLS_VERIFICATION_FAILED: "The website TLS identity could not be verified.",
  TRANSPORT_FAILED: "The secure website connection failed.",
  REMOTE_ADDRESS_MISMATCH: "The website connection reached an unexpected destination.",
  HEADERS_TOO_LARGE: "The website response headers are too large.",
  BODY_TOO_LARGE: "The website content is too large.",
  CONTENT_ENCODING_NOT_ALLOWED: "Compressed website content is not accepted.",
  CONTENT_TYPE_NOT_ALLOWED: "The website did not return HTML or plain text.",
  STATUS_NOT_ALLOWED: "The website returned an unsupported response status.",
  RESPONSE_INVALID: "The website returned an invalid response.",
} as const);

export type PinnedHttpsConnectorErrorCode = keyof typeof pinnedHttpsConnectorMessages;

export class PinnedHttpsConnectorError extends Error {
  constructor(readonly code: PinnedHttpsConnectorErrorCode) {
    super(pinnedHttpsConnectorMessages[code]);
    this.name = "PinnedHttpsConnectorError";
  }
}

export type AcquiredWebsiteContentType = "text/html" | "text/plain";

export interface AcquiredWebsiteSourceBody {
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  contentType: AcquiredWebsiteContentType;
  charset: string | null;
}

export interface PinnedHttpsTransportRequest {
  method: "GET";
  address: string;
  family: 4 | 6;
  port: 443;
  path: string;
  hostHeader: string;
  serverName?: string;
  verifyHostname: string;
  rejectUnauthorized: true;
  minimumTlsVersion: "TLSv1.2";
  headers: Readonly<Record<string, string>>;
  maxHeaderBytes: number;
  signal: AbortSignal;
}

export interface PinnedHttpsTransportResponse {
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  headerBytes: number;
  headerCount: number;
  remoteAddress: string;
  remoteFamily: 4 | 6;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export interface PinnedHttpsTransport {
  request(input: PinnedHttpsTransportRequest): Promise<PinnedHttpsTransportResponse>;
}

export interface PinnedHttpsWebsiteConnectorOptions {
  transport?: PinnedHttpsTransport;
  timeoutMs?: number;
  maxHeaderBytes?: number;
  maxHeaderCount?: number;
  maxBodyBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_HEADER_BYTES = 32 * 1024;
const DEFAULT_MAX_HEADER_COUNT = 100;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECT_LOCATION_BYTES = 2_048;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const fixedHeaders = Object.freeze({
  Accept: "text/html, text/plain;q=0.9",
  "Accept-Encoding": "identity",
  Connection: "close",
  "User-Agent": "LeadVirt-Knowledge-Source/1.0",
});

function fail(code: PinnedHttpsConnectorErrorCode): never {
  throw new PinnedHttpsConnectorError(code);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function normalizedIp(value: string) {
  const address = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const family = isIP(address);
  if (family !== 4 && family !== 6) return null;
  return { address: address.toLowerCase(), family } as const;
}

function ipv4Bytes(address: string) {
  return address.split(".").map((part) => Number.parseInt(part, 10));
}

function ipv6Words(address: string) {
  const [leftText = "", rightText] = address.toLowerCase().split("::");

  function words(side: string) {
    if (!side) return [];
    const parts = side.split(":");
    const last = parts.at(-1);
    if (last?.includes(".")) {
      const bytes = ipv4Bytes(last);
      parts.splice(
        parts.length - 1,
        1,
        ((bytes[0]! << 8) | bytes[1]!).toString(16),
        ((bytes[2]! << 8) | bytes[3]!).toString(16),
      );
    }
    return parts.map((part) => Number.parseInt(part, 16));
  }

  const left = words(leftText);
  const right = words(rightText ?? "");
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
}

function addressKey(value: string) {
  const parsed = normalizedIp(value);
  if (!parsed) return null;
  if (parsed.family === 4) {
    return `4:${ipv4Bytes(parsed.address)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return `6:${ipv6Words(parsed.address)
    .map((word) => word.toString(16).padStart(4, "0"))
    .join("")}`;
}

function validateTarget(target: WebsiteSourceConnectionTarget) {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    fail("TARGET_INVALID");
  }
  const urlHostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const targetAddress = normalizedIp(target.address);
  const hostnameFamily = isIP(target.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    target.port !== 443 ||
    urlHostname.toLowerCase() !== target.hostname.toLowerCase() ||
    url.host !== target.hostHeader ||
    !targetAddress ||
    targetAddress.family !== target.family ||
    (hostnameFamily
      ? target.serverName !== undefined
      : target.serverName !== target.hostname)
  ) {
    fail("TARGET_INVALID");
  }
  return url;
}

function singleHeader(
  headers: PinnedHttpsTransportResponse["headers"],
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  if (value.length !== 1) fail("RESPONSE_INVALID");
  return value[0] ?? null;
}

function validateContentEncoding(headers: PinnedHttpsTransportResponse["headers"]) {
  const encoding = singleHeader(headers, "content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") {
    fail("CONTENT_ENCODING_NOT_ALLOWED");
  }
}

function parseContentType(
  headers: PinnedHttpsTransportResponse["headers"],
): { contentType: AcquiredWebsiteContentType; charset: string | null } {
  const header = singleHeader(headers, "content-type");
  if (!header) fail("CONTENT_TYPE_NOT_ALLOWED");
  const [mediaTypeText = "", ...parameters] = header.split(";");
  const mediaType = mediaTypeText.trim().toLowerCase();
  const contentType: AcquiredWebsiteContentType =
    mediaType === "text/html"
      ? "text/html"
      : mediaType === "text/plain"
        ? "text/plain"
        : fail("CONTENT_TYPE_NOT_ALLOWED");
  const charsetParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.toLowerCase().startsWith("charset="));
  const charsetValue = charsetParameter?.slice("charset=".length).trim().replace(/^"|"$/gu, "");
  const charset =
    charsetValue && /^[a-z0-9._-]{1,40}$/iu.test(charsetValue)
      ? charsetValue.toLowerCase()
      : null;
  return { contentType, charset };
}

function declaredContentLength(headers: PinnedHttpsTransportResponse["headers"]) {
  const value = singleHeader(headers, "content-length");
  if (value === null) return null;
  if (!/^\d+$/u.test(value.trim())) fail("RESPONSE_INVALID");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) fail("RESPONSE_INVALID");
  return length;
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function isTlsError(error: unknown) {
  const code = errorCode(error);
  return (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("CERT_") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN"
  );
}

async function acquireResponse(
  target: WebsiteSourceConnectionTarget,
  transport: PinnedHttpsTransport,
  limits: {
    maxHeaderBytes: number;
    maxHeaderCount: number;
    maxBodyBytes: number;
  },
  signal: AbortSignal,
): Promise<WebsiteSourceConnectionResponse<AcquiredWebsiteSourceBody>> {
  const url = validateTarget(target);
  const response = await transport.request({
    method: "GET",
    address: target.address,
    family: target.family,
    port: 443,
    path: `${url.pathname}${url.search}`,
    hostHeader: target.hostHeader,
    ...(target.serverName ? { serverName: target.serverName } : {}),
    verifyHostname: target.hostname,
    rejectUnauthorized: true,
    minimumTlsVersion: "TLSv1.2",
    headers: { Host: target.hostHeader, ...fixedHeaders },
    maxHeaderBytes: limits.maxHeaderBytes,
    signal,
  });

  if (
    !Number.isInteger(response.headerBytes) ||
    response.headerBytes < 0 ||
    response.headerBytes > limits.maxHeaderBytes ||
    !Number.isInteger(response.headerCount) ||
    response.headerCount < 0 ||
    response.headerCount > limits.maxHeaderCount
  ) {
    response.cancel();
    fail("HEADERS_TOO_LARGE");
  }
  if (
    response.remoteFamily !== target.family ||
    addressKey(response.remoteAddress) !== addressKey(target.address)
  ) {
    response.cancel();
    fail("REMOTE_ADDRESS_MISMATCH");
  }
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    response.cancel();
    fail("RESPONSE_INVALID");
  }

  try {
    validateContentEncoding(response.headers);
  } catch (error) {
    response.cancel();
    throw error;
  }
  if (redirectStatuses.has(response.statusCode)) {
    const location = singleHeader(response.headers, "location");
    response.cancel();
    if (!location || Buffer.byteLength(location, "utf8") > MAX_REDIRECT_LOCATION_BYTES) {
      fail("RESPONSE_INVALID");
    }
    return {
      status: response.statusCode,
      remoteAddress: response.remoteAddress,
      redirectLocation: location,
    };
  }
  if (response.statusCode !== 200) {
    response.cancel();
    fail("STATUS_NOT_ALLOWED");
  }

  let content: ReturnType<typeof parseContentType>;
  let declaredLength: number | null;
  try {
    content = parseContentType(response.headers);
    declaredLength = declaredContentLength(response.headers);
  } catch (error) {
    response.cancel();
    throw error;
  }
  if (declaredLength !== null && declaredLength > limits.maxBodyBytes) {
    response.cancel();
    fail("BODY_TOO_LARGE");
  }

  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of response.body) {
      if (signal.aborted) fail("ABORTED");
      if (!(chunk instanceof Uint8Array)) fail("RESPONSE_INVALID");
      byteLength += chunk.byteLength;
      if (byteLength > limits.maxBodyBytes) fail("BODY_TOO_LARGE");
      const copy = new Uint8Array(chunk);
      chunks.push(copy);
      hash.update(copy);
    }
  } catch (error) {
    response.cancel();
    throw error;
  }
  if (declaredLength !== null && declaredLength !== byteLength) fail("RESPONSE_INVALID");

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    status: response.statusCode,
    remoteAddress: response.remoteAddress,
    body: {
      bytes,
      byteLength,
      sha256: hash.digest("hex"),
      contentType: content.contentType,
      charset: content.charset,
    },
  };
}

export function createPinnedHttpsWebsiteSourceConnector(
  options: PinnedHttpsWebsiteConnectorOptions = {},
): WebsiteSourceConnector<AcquiredWebsiteSourceBody> {
  const transport = options.transport ?? nodePinnedHttpsTransport;
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 60_000);
  const limits = {
    maxHeaderBytes: boundedInteger(
      options.maxHeaderBytes,
      DEFAULT_MAX_HEADER_BYTES,
      1_024,
      256 * 1024,
    ),
    maxHeaderCount: boundedInteger(options.maxHeaderCount, DEFAULT_MAX_HEADER_COUNT, 1, 1_000),
    maxBodyBytes: boundedInteger(
      options.maxBodyBytes,
      DEFAULT_MAX_BODY_BYTES,
      1,
      16 * 1024 * 1024,
    ),
  };

  return {
    async connect(target) {
      if (target.signal.aborted) fail("ABORTED");
      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      target.signal.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new PinnedHttpsConnectorError(timedOut ? "TIMEOUT" : "ABORTED")),
          { once: true },
        );
      });

      try {
        return await Promise.race([
          acquireResponse(target, transport, limits, controller.signal),
          aborted,
        ]);
      } catch (error) {
        if (error instanceof PinnedHttpsConnectorError) throw error;
        if (timedOut) fail("TIMEOUT");
        if (target.signal.aborted || controller.signal.aborted) fail("ABORTED");
        if (isTlsError(error)) fail("TLS_VERIFICATION_FAILED");
        if (errorCode(error) === "HPE_HEADER_OVERFLOW") fail("HEADERS_TOO_LARGE");
        fail("TRANSPORT_FAILED");
      } finally {
        clearTimeout(timeout);
        target.signal.removeEventListener("abort", abortFromCaller);
        controller.abort();
      }
    },
  };
}

export const nodePinnedHttpsTransport: PinnedHttpsTransport = {
  request(input) {
    return new Promise((resolve, reject) => {
      if (input.signal.aborted) {
        reject(new PinnedHttpsConnectorError("ABORTED"));
        return;
      }

      const request = httpsRequest({
        protocol: "https:",
        hostname: input.address,
        family: input.family,
        port: input.port,
        method: input.method,
        path: input.path,
        headers: input.headers,
        setHost: false,
        agent: false,
        rejectUnauthorized: input.rejectUnauthorized,
        minVersion: input.minimumTlsVersion,
        maxHeaderSize: input.maxHeaderBytes,
        ...(input.serverName ? { servername: input.serverName } : {}),
        checkServerIdentity: (_hostname, certificate) =>
          checkServerIdentity(input.verifyHostname, certificate),
      });
      let settled = false;
      const abort = () => request.destroy(new PinnedHttpsConnectorError("ABORTED"));
      input.signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => input.signal.removeEventListener("abort", abort);

      request.once("error", (error) => {
        cleanup();
        if (!settled) reject(error);
      });
      request.once("response", (response) => {
        settled = true;
        const remoteAddress = response.socket.remoteAddress ?? "";
        const remoteFamily = response.socket.remoteFamily === "IPv6" ? 6 : 4;
        const headers = Object.fromEntries(
          Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
        );
        const headerBytes =
          response.rawHeaders.reduce(
            (total, value, index) =>
              total + Buffer.byteLength(value, "latin1") + (index % 2 === 0 ? 2 : 4),
            2,
          );
        const cancel = () => {
          cleanup();
          response.destroy();
        };
        const body = (async function* () {
          try {
            for await (const chunk of response) {
              yield chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
            }
          } finally {
            cleanup();
          }
        })();
        resolve({
          statusCode: response.statusCode ?? 0,
          headers,
          headerBytes,
          headerCount: response.rawHeaders.length / 2,
          remoteAddress,
          remoteFamily,
          body,
          cancel,
        });
      });
      request.end();
    });
  },
};
