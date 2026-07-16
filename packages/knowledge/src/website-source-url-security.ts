import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const websiteSourceRejectionMessages = Object.freeze({
  INVALID_URL: "Enter a valid website URL.",
  HTTPS_REQUIRED: "Only HTTPS website URLs are allowed.",
  CREDENTIALS_NOT_ALLOWED: "Website URLs cannot include credentials.",
  PORT_NOT_ALLOWED: "Website URLs must use the standard HTTPS port.",
  HOST_NOT_ALLOWED: "This website host is not allowed.",
  DESTINATION_NOT_PUBLIC: "This website destination is not publicly reachable.",
  DNS_LOOKUP_FAILED: "The website address could not be verified.",
  REDIRECT_NOT_ALLOWED: "The website redirected to a destination that is not allowed.",
  TOO_MANY_REDIRECTS: "The website redirected too many times.",
  CONNECTION_FAILED: "The website could not be reached securely.",
  DNS_REBINDING_DETECTED: "The website connection could not be verified.",
} as const);

export type WebsiteSourceRejectionCode = keyof typeof websiteSourceRejectionMessages;

export interface WebsiteSourceRejection {
  code: WebsiteSourceRejectionCode;
  message: (typeof websiteSourceRejectionMessages)[WebsiteSourceRejectionCode];
}

export type WebsiteSourceSecurityResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WebsiteSourceRejection };

export interface WebsiteSourceResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface WebsiteSourceResolver {
  resolve(hostname: string): Promise<readonly WebsiteSourceResolvedAddress[]>;
}

export interface AdmittedWebsiteSourceUrl {
  normalizedUrl: string;
  hostname: string;
  port: 443;
  addresses: readonly WebsiteSourceResolvedAddress[];
}

export interface WebsiteSourceConnectionTarget {
  url: string;
  hostname: string;
  hostHeader: string;
  serverName?: string;
  port: 443;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
}

export interface WebsiteSourceConnectionResponse<T> {
  status: number;
  remoteAddress: string;
  redirectLocation?: string | null;
  body?: T;
}

export interface WebsiteSourceConnector<T> {
  connect(target: WebsiteSourceConnectionTarget): Promise<WebsiteSourceConnectionResponse<T>>;
}

export interface WebsiteSourceAdmissionOptions {
  resolver?: WebsiteSourceResolver;
  resolutionTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface WebsiteSourceConnectionOptions<T> extends WebsiteSourceAdmissionOptions {
  connector: WebsiteSourceConnector<T>;
  connectionTimeoutMs?: number;
  maxRedirects?: number;
}

export interface ConnectedWebsiteSource<T> {
  finalUrl: string;
  redirects: readonly string[];
  response: WebsiteSourceConnectionResponse<T>;
}

class WebsiteSourcePolicyError extends Error {
  constructor(readonly code: WebsiteSourceRejectionCode) {
    super(websiteSourceRejectionMessages[code]);
    this.name = "WebsiteSourcePolicyError";
  }
}

const systemResolver: WebsiteSourceResolver = {
  async resolve(hostname) {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map((answer) => {
      const family = ipFamily(answer.address);
      if (!family || family !== answer.family) throw new Error("Invalid DNS response");
      return { address: answer.address, family };
    });
  },
};

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

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 2_048;
const DEFAULT_RESOLUTION_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

function fail(code: WebsiteSourceRejectionCode): never {
  throw new WebsiteSourcePolicyError(code);
}

function publicReason(
  error: unknown,
  fallback: WebsiteSourceRejectionCode,
): WebsiteSourceRejection {
  const code = error instanceof WebsiteSourcePolicyError ? error.code : fallback;
  return { code, message: websiteSourceRejectionMessages[code] };
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

function isPublicIpv4(address: string) {
  const value = ipv4Value(address);
  return !blockedIpv4Prefixes.some(([prefix, bits]) =>
    matchesPrefix(value, ipv4Value(prefix), bits, 32),
  );
}

function isPublicIpv6(address: string) {
  const value = ipv6Value(address);
  const globalUnicast = matchesPrefix(value, ipv6Value("2000::"), 3, 128);
  if (!globalUnicast) return false;
  return !blockedIpv6Prefixes.some(([prefix, bits]) =>
    matchesPrefix(value, ipv6Value(prefix), bits, 128),
  );
}

function addressIdentity(address: string) {
  const normalized = stripIpv6Brackets(address);
  const family = ipFamily(normalized);
  if (!family) throw new Error("Invalid IP address");
  return {
    family,
    key: `${family}:${addressValue(normalized, family).toString(16)}`,
    address: normalized,
  } as const;
}

function isPublicAddress(address: string, family: 4 | 6) {
  return family === 4 ? isPublicIpv4(address) : isPublicIpv6(address);
}

function validateDomainHostname(hostname: string) {
  if (hostname.length > 253) fail("HOST_NOT_ALLOWED");
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    fail("HOST_NOT_ALLOWED");
  }
  const suffixBlocked = blockedHostSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (suffixBlocked || /^\d+$/u.test(labels.at(-1) ?? "")) fail("HOST_NOT_ALLOWED");
}

function containsControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function normalizeUrl(input: string) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_URL_LENGTH ||
    input !== input.trim() ||
    containsControlCharacter(input)
  ) {
    fail("INVALID_URL");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    fail("INVALID_URL");
  }
  if (url.protocol !== "https:") fail("HTTPS_REQUIRED");
  if (url.username || url.password) fail("CREDENTIALS_NOT_ALLOWED");
  if (url.port) fail("PORT_NOT_ALLOWED");

  const rawHostname = stripIpv6Brackets(url.hostname).toLowerCase();
  const hostname = rawHostname.endsWith(".") ? rawHostname.slice(0, -1) : rawHostname;
  if (!hostname) fail("HOST_NOT_ALLOWED");
  const family = ipFamily(hostname);
  if (!family) {
    validateDomainHostname(hostname);
    url.hostname = hostname;
  }
  url.hash = "";
  return { url, hostname, family };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: WebsiteSourceRejectionCode,
  signal?: AbortSignal,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortFromCaller: (() => void) | undefined;
  try {
    if (signal?.aborted) fail("CONNECTION_FAILED");
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new WebsiteSourcePolicyError(code)), timeoutMs);
      }),
      ...(signal
        ? [
            new Promise<T>((_resolve, reject) => {
              abortFromCaller = () => reject(new WebsiteSourcePolicyError("CONNECTION_FAILED"));
              signal.addEventListener("abort", abortFromCaller, { once: true });
            }),
          ]
        : []),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortFromCaller) signal?.removeEventListener("abort", abortFromCaller);
  }
}

function safeTimeout(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 100 && value <= 60_000
    ? Math.floor(value)
    : fallback;
}

async function resolvePublicAddresses(
  hostname: string,
  resolver: WebsiteSourceResolver,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  let answers: readonly WebsiteSourceResolvedAddress[];
  try {
    answers = await withTimeout(resolver.resolve(hostname), timeoutMs, "DNS_LOOKUP_FAILED", signal);
  } catch (error) {
    if (error instanceof WebsiteSourcePolicyError) throw error;
    fail("DNS_LOOKUP_FAILED");
  }
  if (!answers.length) fail("DNS_LOOKUP_FAILED");

  const unique = new Map<string, WebsiteSourceResolvedAddress>();
  for (const answer of answers) {
    let identity: ReturnType<typeof addressIdentity>;
    try {
      identity = addressIdentity(answer.address);
    } catch {
      fail("DNS_LOOKUP_FAILED");
    }
    if (identity.family !== answer.family) fail("DNS_LOOKUP_FAILED");
    if (!isPublicAddress(identity.address, identity.family)) fail("DESTINATION_NOT_PUBLIC");
    unique.set(identity.key, { address: identity.address, family: identity.family });
  }
  return [...unique.values()];
}

async function admitOrThrow(input: string, options: WebsiteSourceAdmissionOptions) {
  if (options.signal?.aborted) fail("CONNECTION_FAILED");
  const normalized = normalizeUrl(input);
  let addresses: WebsiteSourceResolvedAddress[];
  if (normalized.family) {
    if (!isPublicAddress(normalized.hostname, normalized.family)) fail("DESTINATION_NOT_PUBLIC");
    addresses = [{ address: normalized.hostname, family: normalized.family }];
  } else {
    addresses = await resolvePublicAddresses(
      normalized.hostname,
      options.resolver ?? systemResolver,
      safeTimeout(options.resolutionTimeoutMs, DEFAULT_RESOLUTION_TIMEOUT_MS),
      options.signal,
    );
  }
  return {
    normalizedUrl: normalized.url.href,
    hostname: normalized.hostname,
    port: 443 as const,
    addresses,
  } satisfies AdmittedWebsiteSourceUrl;
}

export async function admitWebsiteSourceUrl(
  input: string,
  options: WebsiteSourceAdmissionOptions = {},
): Promise<WebsiteSourceSecurityResult<AdmittedWebsiteSourceUrl>> {
  try {
    return { ok: true, value: await admitOrThrow(input, options) };
  } catch (error) {
    return { ok: false, reason: publicReason(error, "DNS_LOOKUP_FAILED") };
  }
}

async function connectPinned<T>(
  admitted: AdmittedWebsiteSourceUrl,
  connector: WebsiteSourceConnector<T>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  for (const approved of admitted.addresses) {
    if (signal?.aborted) fail("CONNECTION_FAILED");
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(admitted.normalizedUrl);
      const response = await Promise.race([
        connector.connect({
          url: admitted.normalizedUrl,
          hostname: admitted.hostname,
          hostHeader: url.host,
          ...(isIP(admitted.hostname) ? {} : { serverName: admitted.hostname }),
          port: 443,
          address: approved.address,
          family: approved.family,
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new WebsiteSourcePolicyError("CONNECTION_FAILED"));
          }, timeoutMs);
        }),
      ]);
      const expected = addressIdentity(approved.address);
      let remote: ReturnType<typeof addressIdentity>;
      try {
        remote = addressIdentity(response.remoteAddress);
      } catch {
        fail("DNS_REBINDING_DETECTED");
      }
      if (remote.key !== expected.key || !isPublicAddress(remote.address, remote.family)) {
        fail("DNS_REBINDING_DETECTED");
      }
      return response;
    } catch (error) {
      if (error instanceof WebsiteSourcePolicyError && error.code === "DNS_REBINDING_DETECTED") {
        throw error;
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
      controller.abort();
    }
  }
  fail("CONNECTION_FAILED");
}

export async function connectWebsiteSource<T>(
  input: string,
  options: WebsiteSourceConnectionOptions<T>,
): Promise<WebsiteSourceSecurityResult<ConnectedWebsiteSource<T>>> {
  const redirects: string[] = [];
  const maxRedirects =
    typeof options.maxRedirects === "number" &&
    Number.isInteger(options.maxRedirects) &&
    options.maxRedirects >= 0 &&
    options.maxRedirects <= 10
      ? options.maxRedirects
      : DEFAULT_MAX_REDIRECTS;
  const connectionTimeoutMs = safeTimeout(
    options.connectionTimeoutMs,
    DEFAULT_CONNECTION_TIMEOUT_MS,
  );

  try {
    if (options.signal?.aborted) fail("CONNECTION_FAILED");
    let admitted = await admitOrThrow(input, options);
    while (true) {
      const response = await connectPinned(
        admitted,
        options.connector,
        connectionTimeoutMs,
        options.signal,
      );
      if (!redirectStatuses.has(response.status) || !response.redirectLocation) {
        return {
          ok: true,
          value: { finalUrl: admitted.normalizedUrl, redirects, response },
        };
      }
      if (redirects.length >= maxRedirects) fail("TOO_MANY_REDIRECTS");

      let redirectUrl: string;
      try {
        const parsedRedirect = new URL(response.redirectLocation, admitted.normalizedUrl);
        if (parsedRedirect.search) fail("REDIRECT_NOT_ALLOWED");
        redirectUrl = parsedRedirect.href;
      } catch {
        fail("REDIRECT_NOT_ALLOWED");
      }
      try {
        admitted = await admitOrThrow(redirectUrl, options);
      } catch {
        fail("REDIRECT_NOT_ALLOWED");
      }
      redirects.push(admitted.normalizedUrl);
    }
  } catch (error) {
    return { ok: false, reason: publicReason(error, "CONNECTION_FAILED") };
  }
}
