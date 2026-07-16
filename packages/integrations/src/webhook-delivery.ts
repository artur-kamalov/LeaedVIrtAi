import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import type { SendMessageInput, SendMessageResult } from "./index.js";

export const webhookDeliveryErrorMessages = Object.freeze({
  WEBHOOK_TARGET_MISSING: "The outbound webhook target is not configured.",
  WEBHOOK_TARGET_INVALID: "The outbound webhook target is invalid.",
  WEBHOOK_HTTPS_REQUIRED: "The outbound webhook target must use HTTPS.",
  WEBHOOK_TARGET_NOT_PUBLIC: "The outbound webhook target is not publicly reachable.",
  WEBHOOK_DNS_LOOKUP_FAILED: "The outbound webhook address could not be verified.",
  WEBHOOK_AUTH_INVALID: "The outbound webhook authentication configuration is invalid.",
  WEBHOOK_PAYLOAD_TOO_LARGE: "The outbound webhook payload is too large.",
  WEBHOOK_CONNECTION_FAILED: "The outbound webhook could not be reached securely.",
  WEBHOOK_TIMEOUT: "The outbound webhook did not respond in time.",
  WEBHOOK_ABORTED: "The outbound webhook delivery was cancelled.",
  WEBHOOK_REMOTE_ADDRESS_MISMATCH: "The outbound webhook connection could not be verified.",
  WEBHOOK_RESPONSE_HEADERS_TOO_LARGE: "The outbound webhook returned too many headers.",
  WEBHOOK_HTTP_RETRYABLE: "The outbound webhook temporarily rejected the delivery.",
  WEBHOOK_HTTP_REJECTED: "The outbound webhook rejected the delivery.",
} as const);

export type WebhookDeliveryErrorCode = keyof typeof webhookDeliveryErrorMessages;
export type WebhookDeliveryOutcome = "NOT_STARTED" | "FAILED" | "UNKNOWN";

export class WebhookDeliveryError extends Error {
  constructor(
    readonly code: WebhookDeliveryErrorCode,
    readonly retryable: boolean,
    readonly outcome: WebhookDeliveryOutcome,
    readonly statusCode?: number,
  ) {
    super(webhookDeliveryErrorMessages[code]);
    this.name = "WebhookDeliveryError";
  }
}

export interface WebhookResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface WebhookResolver {
  resolve(hostname: string): Promise<readonly WebhookResolvedAddress[]>;
}

export interface WebhookTransportRequest {
  address: string;
  family: 4 | 6;
  hostname: string;
  hostHeader: string;
  serverName?: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  maxHeaderBytes: number;
  maxHeaderCount: number;
  signal: AbortSignal;
}

export interface WebhookTransportResponse {
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  remoteAddress: string;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export interface WebhookTransport {
  request(input: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

export interface WebhookDeliveryClientOptions {
  resolver?: WebhookResolver;
  transport?: WebhookTransport;
  defaultTimeoutMs?: number;
  maxPayloadBytes?: number;
  maxResponseBytes?: number;
  maxHeaderBytes?: number;
  maxHeaderCount?: number;
}

export interface WebhookOutboundConfiguration {
  targetUrl: string;
  timeoutMs: number;
  auth?: {
    headerName: string;
    headerValue: string;
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_HEADER_BYTES = 32 * 1024;
const DEFAULT_MAX_HEADER_COUNT = 100;
const MAX_URL_LENGTH = 2_048;
const MAX_AUTH_SECRET_LENGTH = 4_096;
const MAX_ATTACHMENT_COUNT = 16;
const MAX_ATTACHMENT_LENGTH = 2_048;

const blockedHostSuffixes = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "corp",
  "consul",
  "svc",
  "home",
  "lan",
  "onion",
  "test",
  "invalid",
  "example",
  "arpa",
] as const;

const blockedIpv4Prefixes = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const blockedIpv6Prefixes = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const;

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const blockedAuthHeaders = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "expect",
  "forwarded",
  "host",
  "idempotency-key",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-leadvirt-delivery-id",
  "x-leadvirt-event",
]);

class WebhookTransportFailure extends Error {
  constructor(
    readonly requestSent: boolean,
    readonly headersTooLarge = false,
  ) {
    super("Webhook transport failed");
    this.name = "WebhookTransportFailure";
  }
}

function nodeErrorCode(error: unknown) {
  if (!isRecord(error) || typeof error.code !== "string") return "";
  return error.code;
}

class DeliveryAbortReason {
  constructor(readonly kind: "timeout" | "caller") {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function containsControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function fail(
  code: WebhookDeliveryErrorCode,
  retryable = false,
  outcome: WebhookDeliveryOutcome = "NOT_STARTED",
  statusCode?: number,
): never {
  throw new WebhookDeliveryError(code, retryable, outcome, statusCode);
}

function safeAuthHeader(value: unknown) {
  const header = nonEmptyString(value)?.toLowerCase();
  if (
    !header ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/u.test(header) ||
    blockedAuthHeaders.has(header) ||
    (header !== "authorization" && !header.startsWith("x-"))
  ) {
    fail("WEBHOOK_AUTH_INVALID");
  }
  return header;
}

function parseAuth(outbound: Record<string, unknown>, credentials: unknown) {
  if (outbound.headers !== undefined) fail("WEBHOOK_AUTH_INVALID");
  const auth = asRecord(outbound.auth);
  const credentialRecord = asRecord(credentials);
  const secret =
    nonEmptyString(auth.secret) ??
    nonEmptyString(outbound.secret) ??
    nonEmptyString(credentialRecord.webhookOutboundSecret);
  const configured = Object.keys(auth).length > 0 || outbound.secret !== undefined;
  if (!secret) {
    if (configured) fail("WEBHOOK_AUTH_INVALID");
    return undefined;
  }
  if (
    secret.length > MAX_AUTH_SECRET_LENGTH ||
    [...secret].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code > 126;
    })
  ) {
    fail("WEBHOOK_AUTH_INVALID");
  }

  const headerName = safeAuthHeader(auth.headerName ?? outbound.secretHeader ?? "authorization");
  const scheme = nonEmptyString(auth.scheme);
  if (scheme && scheme !== "Bearer") fail("WEBHOOK_AUTH_INVALID");
  const effectiveScheme = scheme ?? (headerName === "authorization" ? "Bearer" : null);
  return {
    headerName,
    headerValue: effectiveScheme ? `${effectiveScheme} ${secret}` : secret,
  };
}

export function readWebhookOutboundConfiguration(
  settings: unknown,
  credentials?: unknown,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
): WebhookOutboundConfiguration {
  const webhook = asRecord(asRecord(settings).webhook);
  const outbound = asRecord(webhook.outbound);
  const targetUrl = nonEmptyString(outbound.targetUrl);
  if (!targetUrl) fail("WEBHOOK_TARGET_MISSING");
  if (
    targetUrl.length > MAX_URL_LENGTH ||
    targetUrl !== (outbound.targetUrl as string) ||
    containsControlCharacter(targetUrl)
  ) {
    fail("WEBHOOK_TARGET_INVALID");
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    fail("WEBHOOK_TARGET_INVALID");
  }
  if (parsed.protocol !== "https:") fail("WEBHOOK_HTTPS_REQUIRED");
  if (parsed.username || parsed.password || parsed.port || parsed.hash) {
    fail("WEBHOOK_TARGET_INVALID");
  }
  const normalized = normalizeHostname(parsed);
  if (normalized.family && !isPublicAddress(normalized.hostname, normalized.family)) {
    fail("WEBHOOK_TARGET_NOT_PUBLIC");
  }
  if (!normalized.family) parsed.hostname = normalized.hostname;
  if (
    outbound.timeoutMs !== undefined &&
    (typeof outbound.timeoutMs !== "number" ||
      !Number.isInteger(outbound.timeoutMs) ||
      outbound.timeoutMs < 1_000 ||
      outbound.timeoutMs > 20_000)
  ) {
    fail("WEBHOOK_TARGET_INVALID");
  }

  const auth = parseAuth(outbound, credentials);
  return {
    targetUrl: parsed.href,
    timeoutMs: boundedInteger(outbound.timeoutMs, defaultTimeoutMs, 1_000, 20_000),
    ...(auth ? { auth } : {}),
  };
}

export function webhookOutboundConfigured(settings: unknown) {
  const outbound = asRecord(asRecord(asRecord(settings).webhook).outbound);
  return nonEmptyString(outbound.targetUrl) !== null;
}

export function webhookOutboundAuthenticationConfigured(settings: unknown) {
  const outbound = asRecord(asRecord(asRecord(settings).webhook).outbound);
  const auth = asRecord(outbound.auth);
  return (
    auth.configured === true ||
    nonEmptyString(auth.secret) !== null ||
    nonEmptyString(outbound.secret) !== null
  );
}

function stripIpv6Brackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function ipFamily(value: string): 4 | 6 | null {
  const family = isIP(stripIpv6Brackets(value));
  return family === 4 ? 4 : family === 6 ? 6 : null;
}

function ipv4Value(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    throw new Error("Invalid IPv4 address");
  }
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6Parts(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  if (normalized.includes("%") || normalized.split("::").length > 2) {
    throw new Error("Invalid IPv6 address");
  }

  function sideParts(side: string) {
    if (!side) return [];
    const parts = side.split(":");
    const last = parts.at(-1);
    if (last?.includes(".")) {
      const embedded = ipv4Value(last);
      parts.splice(
        parts.length - 1,
        1,
        ((embedded >> 16n) & 0xffffn).toString(16),
        (embedded & 0xffffn).toString(16),
      );
    }
    return parts.map((part) => {
      if (!/^[0-9a-f]{1,4}$/u.test(part)) throw new Error("Invalid IPv6 address");
      return Number.parseInt(part, 16);
    });
  }

  const [leftText = "", rightText] = normalized.split("::");
  const left = sideParts(leftText);
  const right = sideParts(rightText ?? "");
  if (rightText === undefined && left.length !== 8) throw new Error("Invalid IPv6 address");
  const missing = 8 - left.length - right.length;
  if (rightText !== undefined && missing < 1) throw new Error("Invalid IPv6 address");
  return [...left, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...right];
}

function ipv6Value(address: string) {
  return ipv6Parts(address).reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function addressValue(address: string, family: 4 | 6) {
  return family === 4 ? ipv4Value(address) : ipv6Value(address);
}

function matchesPrefix(value: bigint, prefix: bigint, bits: number, width: number) {
  const shift = BigInt(width - bits);
  return value >> shift === prefix >> shift;
}

function isPublicAddress(address: string, family: 4 | 6) {
  const value = addressValue(address, family);
  if (family === 4) {
    return !blockedIpv4Prefixes.some(([prefix, bits]) =>
      matchesPrefix(value, ipv4Value(prefix), bits, 32),
    );
  }
  if (!matchesPrefix(value, ipv6Value("2000::"), 3, 128)) return false;
  return !blockedIpv6Prefixes.some(([prefix, bits]) =>
    matchesPrefix(value, ipv6Value(prefix), bits, 128),
  );
}

function addressKey(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = ipFamily(normalized);
  if (!family) return null;
  return `${family}:${addressValue(normalized, family).toString(16)}`;
}

function normalizeHostname(url: URL) {
  const raw = stripIpv6Brackets(url.hostname).toLowerCase();
  const hostname = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (!hostname) fail("WEBHOOK_TARGET_INVALID");
  const family = ipFamily(hostname);
  if (!family) {
    const labels = hostname.split(".");
    const invalid =
      hostname.length > 253 ||
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
      blockedHostSuffixes.some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
      ) ||
      /^\d+$/u.test(labels.at(-1) ?? "");
    if (invalid) fail("WEBHOOK_TARGET_INVALID");
  }
  return { hostname, family };
}

const systemResolver: WebhookResolver = {
  async resolve(hostname) {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map((answer) => {
      const family = ipFamily(answer.address);
      if (!family || family !== answer.family) throw new Error("Invalid DNS response");
      return { address: answer.address, family };
    });
  },
};

async function resolvePublicTarget(
  configuration: WebhookOutboundConfiguration,
  resolver: WebhookResolver,
  signal: AbortSignal,
) {
  const url = new URL(configuration.targetUrl);
  const { hostname, family } = normalizeHostname(url);
  if (!family) url.hostname = hostname;
  if (family) {
    if (!isPublicAddress(hostname, family)) fail("WEBHOOK_TARGET_NOT_PUBLIC");
    return { url, hostname, addresses: [{ address: hostname, family }] };
  }

  let answers: readonly WebhookResolvedAddress[];
  let abortResolution: (() => void) | undefined;
  try {
    answers = await Promise.race([
      resolver.resolve(hostname),
      new Promise<never>((_resolve, reject) => {
        abortResolution = () => reject(new Error("Webhook resolution aborted."));
        if (signal.aborted) abortResolution();
        else signal.addEventListener("abort", abortResolution, { once: true });
      }),
    ]);
  } catch {
    if (signal.aborted) throw deliveryAbortError(signal.reason, false);
    fail("WEBHOOK_DNS_LOOKUP_FAILED", true);
  } finally {
    if (abortResolution) signal.removeEventListener("abort", abortResolution);
  }
  if (!answers.length) fail("WEBHOOK_DNS_LOOKUP_FAILED", true);

  const unique = new Map<string, WebhookResolvedAddress>();
  for (const answer of answers) {
    const key = addressKey(answer.address);
    const resolvedFamily = ipFamily(answer.address);
    if (!key || !resolvedFamily || resolvedFamily !== answer.family) {
      fail("WEBHOOK_DNS_LOOKUP_FAILED", true);
    }
    if (!isPublicAddress(answer.address, answer.family)) fail("WEBHOOK_TARGET_NOT_PUBLIC");
    unique.set(key, { address: answer.address, family: answer.family });
  }
  return { url, hostname, addresses: [...unique.values()] };
}

function deliveryAbortError(reason: unknown, requestSent: boolean) {
  const timeout = reason instanceof DeliveryAbortReason && reason.kind === "timeout";
  return new WebhookDeliveryError(
    timeout ? "WEBHOOK_TIMEOUT" : "WEBHOOK_ABORTED",
    !requestSent,
    requestSent ? "UNKNOWN" : "NOT_STARTED",
  );
}

function createDeliverySignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(new DeliveryAbortReason("caller"));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DeliveryAbortReason("timeout")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

const nodeHttpsTransport: WebhookTransport = {
  request(input) {
    return new Promise((resolve, reject) => {
      let requestSent = false;
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: input.address,
          family: input.family,
          port: 443,
          method: "POST",
          path: input.path,
          servername: input.serverName,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity(input.hostname, certificate),
          agent: false,
          maxHeaderSize: input.maxHeaderBytes,
          headers: { ...input.headers, Host: input.hostHeader },
          signal: input.signal,
        },
        (response) => {
          const headerCount = response.rawHeaders.length / 2;
          const headerBytes = response.rawHeaders.reduce(
            (total, value) => total + Buffer.byteLength(value, "utf8"),
            0,
          );
          if (headerCount > input.maxHeaderCount || headerBytes > input.maxHeaderBytes) {
            response.destroy();
            reject(new WebhookTransportFailure(true, true));
            return;
          }
          const remoteAddress = response.socket.remoteAddress;
          if (!remoteAddress || !response.statusCode) {
            response.destroy();
            reject(new WebhookTransportFailure(true));
            return;
          }
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            remoteAddress,
            body: response,
            cancel: () => response.destroy(),
          });
        },
      );
      request.once("finish", () => {
        requestSent = true;
      });
      request.once("error", (error) => {
        const code = nodeErrorCode(error);
        reject(
          new WebhookTransportFailure(
            requestSent,
            code === "HPE_HEADER_OVERFLOW" || code === "UND_ERR_HEADERS_OVERFLOW",
          ),
        );
      });
      request.end(input.body);
    });
  },
};

function safeDeliveryId(input: SendMessageInput) {
  const metadata = asRecord(input.metadata);
  const explicit =
    nonEmptyString(metadata.deliveryOperationId) ??
    nonEmptyString(metadata.messageId) ??
    nonEmptyString(metadata.triggerMessageId);
  if (explicit && explicit.length <= 200 && /^[A-Za-z0-9._:-]+$/u.test(explicit)) return explicit;
  return `webhook_delivery_${createHash("sha256")
    .update(
      JSON.stringify({
        tenantId: input.tenantId,
        channelAccountId: input.channelAccountId,
        conversationId: input.conversationId,
        externalConversationId: input.externalConversationId,
        text: input.text,
      }),
    )
    .digest("hex")}`;
}

function normalizedAttachments(input: SendMessageInput) {
  if (!input.attachments?.length) return undefined;
  if (
    input.attachments.length > MAX_ATTACHMENT_COUNT ||
    input.attachments.some(
      (attachment) =>
        typeof attachment !== "string" ||
        attachment.length === 0 ||
        attachment.length > MAX_ATTACHMENT_LENGTH ||
        containsControlCharacter(attachment),
    )
  ) {
    fail("WEBHOOK_PAYLOAD_TOO_LARGE");
  }
  return input.attachments;
}

function payloadFor(input: SendMessageInput, deliveryId: string) {
  const metadata = asRecord(input.metadata);
  const messageId = nonEmptyString(metadata.messageId);
  const attachments = normalizedAttachments(input);
  const receiverConversationId = input.externalConversationId.replace(/^webhook:/u, "");
  return {
    schemaVersion: 1,
    event: "leadvirt.message.outbound",
    deliveryId,
    data: {
      channelAccountId: input.channelAccountId,
      conversationId: receiverConversationId,
      leadVirtConversationId: input.conversationId,
      message: {
        ...(messageId ? { id: messageId } : {}),
        text: input.text,
        ...(attachments ? { attachments } : {}),
      },
    },
  };
}

function responseContentLength(response: WebhookTransportResponse) {
  const value = response.headers["content-length"];
  const scalar =
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
        ? (value as readonly string[])[0]
        : undefined;
  if (typeof scalar !== "string" || !/^\d+$/u.test(scalar.trim())) return null;
  const parsed = Number(scalar);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedResponse(response: WebhookTransportResponse, maximum: number) {
  const declared = responseContentLength(response);
  if (declared !== null && declared > maximum) {
    response.cancel();
    return { bytes: new Uint8Array(), truncated: true };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maximum) {
      response.cancel();
      return { bytes: new Uint8Array(), truncated: true };
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated: false };
}

function externalMessageId(bytes: Uint8Array, fallback: string) {
  if (!bytes.byteLength) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fallback;
  }
  const body = asRecord(parsed);
  const data = asRecord(body.data);
  const value =
    nonEmptyString(body.externalMessageId) ??
    nonEmptyString(body.messageId) ??
    nonEmptyString(body.id) ??
    nonEmptyString(data.externalMessageId) ??
    nonEmptyString(data.messageId) ??
    nonEmptyString(data.id);
  return value && value.length <= 256 && !containsControlCharacter(value) ? value : fallback;
}

export class WebhookDeliveryClient {
  private readonly resolver: WebhookResolver;
  private readonly transport: WebhookTransport;
  private readonly defaultTimeoutMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxResponseBytes: number;
  private readonly maxHeaderBytes: number;
  private readonly maxHeaderCount: number;

  constructor(options: WebhookDeliveryClientOptions = {}) {
    this.resolver = options.resolver ?? systemResolver;
    this.transport = options.transport ?? nodeHttpsTransport;
    this.defaultTimeoutMs = boundedInteger(
      options.defaultTimeoutMs,
      DEFAULT_TIMEOUT_MS,
      1_000,
      20_000,
    );
    this.maxPayloadBytes = boundedInteger(
      options.maxPayloadBytes,
      DEFAULT_MAX_PAYLOAD_BYTES,
      1_024,
      1024 * 1024,
    );
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      256 * 1024,
    );
    this.maxHeaderBytes = boundedInteger(
      options.maxHeaderBytes,
      DEFAULT_MAX_HEADER_BYTES,
      8 * 1024,
      64 * 1024,
    );
    this.maxHeaderCount = boundedInteger(
      options.maxHeaderCount,
      DEFAULT_MAX_HEADER_COUNT,
      16,
      200,
    );
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const configuration = readWebhookOutboundConfiguration(
      input.settings,
      input.credentials,
      this.defaultTimeoutMs,
    );
    const deliveryId = safeDeliveryId(input);
    const body = new TextEncoder().encode(JSON.stringify(payloadFor(input, deliveryId)));
    if (body.byteLength > this.maxPayloadBytes) fail("WEBHOOK_PAYLOAD_TOO_LARGE");
    const scopedSignal = createDeliverySignal(input.signal, configuration.timeoutMs);

    try {
      const target = await resolvePublicTarget(configuration, this.resolver, scopedSignal.signal);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        Connection: "close",
        "Content-Type": "application/json",
        "Idempotency-Key": deliveryId,
        "User-Agent": "LeadVirt-Webhook/1.0",
        "X-LeadVirt-Delivery-Id": deliveryId,
        "X-LeadVirt-Event": "leadvirt.message.outbound",
      };
      if (configuration.auth) {
        headers[configuration.auth.headerName] = configuration.auth.headerValue;
      }

      let response: WebhookTransportResponse | null = null;
      let connectedAddress: WebhookResolvedAddress | null = null;
      for (const address of target.addresses) {
        try {
          response = await this.transport.request({
            address: address.address,
            family: address.family,
            hostname: target.hostname,
            hostHeader: target.url.host,
            ...(isIP(target.hostname) ? {} : { serverName: target.hostname }),
            path: `${target.url.pathname}${target.url.search}`,
            headers,
            body,
            maxHeaderBytes: this.maxHeaderBytes,
            maxHeaderCount: this.maxHeaderCount,
            signal: scopedSignal.signal,
          });
          connectedAddress = address;
          break;
        } catch (error) {
          const sent = error instanceof WebhookTransportFailure && error.requestSent;
          if (scopedSignal.signal.aborted) {
            throw deliveryAbortError(scopedSignal.signal.reason, sent);
          }
          if (error instanceof WebhookTransportFailure && error.headersTooLarge) {
            fail("WEBHOOK_RESPONSE_HEADERS_TOO_LARGE", false, sent ? "UNKNOWN" : "NOT_STARTED");
          }
          if (sent) fail("WEBHOOK_CONNECTION_FAILED", false, "UNKNOWN");
        }
      }
      if (!response || !connectedAddress) fail("WEBHOOK_CONNECTION_FAILED", true);

      if (addressKey(response.remoteAddress) !== addressKey(connectedAddress.address)) {
        response.cancel();
        fail("WEBHOOK_REMOTE_ADDRESS_MISMATCH", false, "UNKNOWN");
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.cancel();
        const retryable = retryableStatuses.has(response.statusCode);
        fail(
          retryable ? "WEBHOOK_HTTP_RETRYABLE" : "WEBHOOK_HTTP_REJECTED",
          retryable,
          "FAILED",
          response.statusCode,
        );
      }

      const responseBody = await readBoundedResponse(response, this.maxResponseBytes);
      const fallbackId = `webhook:${deliveryId}`;
      return {
        externalMessageId: responseBody.truncated
          ? fallbackId
          : externalMessageId(responseBody.bytes, fallbackId),
        status: response.statusCode === 202 ? "queued" : "sent",
      };
    } catch (error) {
      if (error instanceof WebhookDeliveryError) throw error;
      if (scopedSignal.signal.aborted) {
        throw deliveryAbortError(scopedSignal.signal.reason, true);
      }
      fail("WEBHOOK_CONNECTION_FAILED", false, "UNKNOWN");
    } finally {
      scopedSignal.close();
    }
  }
}
