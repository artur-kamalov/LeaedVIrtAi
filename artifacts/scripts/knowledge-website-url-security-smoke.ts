import {
  admitWebsiteSourceUrl,
  connectWebsiteSource,
  type WebsiteSourceConnector,
  type WebsiteSourceRejectionCode,
  type WebsiteSourceResolvedAddress,
  type WebsiteSourceResolver,
  type WebsiteSourceSecurityResult,
} from "@leadvirt/knowledge";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resolverFor(entries: Record<string, readonly WebsiteSourceResolvedAddress[]>) {
  const calls: string[] = [];
  const resolver: WebsiteSourceResolver = {
    async resolve(hostname) {
      calls.push(hostname);
      const result = entries[hostname];
      if (!result) throw new Error("not found");
      return result;
    },
  };
  return { resolver, calls };
}

function expectRejected<T>(
  result: WebsiteSourceSecurityResult<T>,
  code: WebsiteSourceRejectionCode,
  label: string,
) {
  assert(!result.ok, `${label}: expected rejection ${code}`);
  assert(result.reason.code === code, `${label}: expected ${code}, got ${result.reason.code}`);
  assert(
    !/127\.0\.0\.1|169\.254\.169\.254|private\.internal/u.test(result.reason.message),
    `${label}: public error leaked destination details`,
  );
}

async function main() {
  let checks = 0;
  const publicDns = resolverFor({
    "public.example.com": [{ address: "93.184.216.34", family: 4 }],
    "start.example.com": [{ address: "93.184.216.34", family: 4 }],
    "next.example.com": [{ address: "1.1.1.1", family: 4 }],
    "dual.example.com": [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ],
  });

  const normalized = await admitWebsiteSourceUrl(
    "https://PUBLIC.Example.COM.:443/docs?q=1#section",
    { resolver: publicDns.resolver },
  );
  assert(normalized.ok, "Public HTTPS URL was rejected");
  assert(
    normalized.value.normalizedUrl === "https://public.example.com/docs?q=1",
    `Unexpected normalized URL: ${normalized.value.normalizedUrl}`,
  );
  assert(normalized.value.hostname === "public.example.com", "Hostname was not normalized");
  assert(publicDns.calls.at(-1) === "public.example.com", "Resolver received an unnormalized host");
  checks += 4;

  for (const [url, label] of [
    ["https://8.8.8.8/", "public IPv4 literal"],
    ["https://[2606:4700:4700::1111]/", "public IPv6 literal"],
    ["https://public.example.com:443/", "explicit default HTTPS port"],
  ] as const) {
    const result = await admitWebsiteSourceUrl(url, { resolver: publicDns.resolver });
    assert(result.ok, `${label} was rejected`);
    checks += 1;
  }

  for (const [url, code, label] of [
    ["not a URL", "INVALID_URL", "invalid URL"],
    [" https://public.example.com/", "INVALID_URL", "leading whitespace"],
    ["http://public.example.com/", "HTTPS_REQUIRED", "HTTP scheme"],
    ["ftp://public.example.com/", "HTTPS_REQUIRED", "FTP scheme"],
    ["file:///etc/passwd", "HTTPS_REQUIRED", "file scheme"],
    ["https://user:secret@public.example.com/", "CREDENTIALS_NOT_ALLOWED", "userinfo"],
    ["https://public.example.com:8443/", "PORT_NOT_ALLOWED", "custom port"],
    ["https://localhost/", "HOST_NOT_ALLOWED", "localhost"],
    ["https://api.localhost/", "HOST_NOT_ALLOWED", "localhost suffix"],
    ["https://private.internal/", "HOST_NOT_ALLOWED", "internal suffix"],
    ["https://metadata.google.internal/", "HOST_NOT_ALLOWED", "metadata hostname"],
    ["https://intranet/", "HOST_NOT_ALLOWED", "single-label hostname"],
  ] as const) {
    expectRejected(await admitWebsiteSourceUrl(url, { resolver: publicDns.resolver }), code, label);
    checks += 1;
  }

  for (const [url, label] of [
    ["https://0.0.0.0/", "unspecified IPv4"],
    ["https://10.1.2.3/", "private IPv4 10/8"],
    ["https://100.100.100.200/", "carrier-grade and metadata IPv4"],
    ["https://127.0.0.1/", "loopback IPv4"],
    ["https://2130706433/", "decimal loopback IPv4"],
    ["https://0x7f000001/", "hex loopback IPv4"],
    ["https://169.254.169.254/", "link-local metadata IPv4"],
    ["https://172.16.0.1/", "private IPv4 172/12"],
    ["https://192.168.1.1/", "private IPv4 192.168/16"],
    ["https://192.0.2.1/", "documentation IPv4"],
    ["https://198.18.0.1/", "benchmark IPv4"],
    ["https://224.0.0.1/", "multicast IPv4"],
    ["https://255.255.255.255/", "reserved IPv4"],
    ["https://[::]/", "unspecified IPv6"],
    ["https://[::1]/", "loopback IPv6"],
    ["https://[::ffff:127.0.0.1]/", "mapped loopback IPv6"],
    ["https://[64:ff9b::7f00:1]/", "NAT64 IPv6"],
    ["https://[2001:db8::1]/", "documentation IPv6"],
    ["https://[2002:7f00:1::]/", "6to4 IPv6"],
    ["https://[3fff::1]/", "new documentation IPv6"],
    ["https://[fc00::1]/", "unique-local IPv6"],
    ["https://[fe80::1]/", "link-local IPv6"],
    ["https://[ff02::1]/", "multicast IPv6"],
  ] as const) {
    expectRejected(
      await admitWebsiteSourceUrl(url, { resolver: publicDns.resolver }),
      "DESTINATION_NOT_PUBLIC",
      label,
    );
    checks += 1;
  }

  const mixedDns = resolverFor({
    "mixed.example.com": [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    "private.example.com": [{ address: "192.168.1.10", family: 4 }],
    "private6.example.com": [{ address: "fe80::1", family: 6 }],
    "empty.example.com": [],
  });
  expectRejected(
    await admitWebsiteSourceUrl("https://mixed.example.com/", { resolver: mixedDns.resolver }),
    "DESTINATION_NOT_PUBLIC",
    "mixed public/private DNS answers",
  );
  expectRejected(
    await admitWebsiteSourceUrl("https://private.example.com/", { resolver: mixedDns.resolver }),
    "DESTINATION_NOT_PUBLIC",
    "private DNS answer",
  );
  expectRejected(
    await admitWebsiteSourceUrl("https://private6.example.com/", { resolver: mixedDns.resolver }),
    "DESTINATION_NOT_PUBLIC",
    "private IPv6 DNS answer",
  );
  expectRejected(
    await admitWebsiteSourceUrl("https://empty.example.com/", { resolver: mixedDns.resolver }),
    "DNS_LOOKUP_FAILED",
    "empty DNS answer",
  );
  expectRejected(
    await admitWebsiteSourceUrl("https://missing.example.com/", { resolver: mixedDns.resolver }),
    "DNS_LOOKUP_FAILED",
    "DNS failure",
  );
  checks += 5;

  const redirectCalls: string[] = [];
  const safeRedirectConnector: WebsiteSourceConnector<string> = {
    async connect(target) {
      redirectCalls.push(`${target.hostname}:${target.address}`);
      assert(target.port === 443, "Connector did not receive HTTPS port");
      assert(
        target.hostHeader === target.hostname,
        "Connector did not receive the normalized Host header",
      );
      assert(
        target.serverName === target.hostname,
        "Connector did not receive the TLS server name",
      );
      if (target.hostname === "start.example.com") {
        return {
          status: 302,
          remoteAddress: target.address,
          redirectLocation: "https://next.example.com/final#ignored",
        };
      }
      return { status: 200, remoteAddress: target.address, body: "website body" };
    },
  };
  const safeRedirect = await connectWebsiteSource("https://start.example.com/", {
    resolver: publicDns.resolver,
    connector: safeRedirectConnector,
  });
  assert(safeRedirect.ok, "Safe public redirect was rejected");
  assert(
    safeRedirect.value.finalUrl === "https://next.example.com/final",
    "Final URL was not normalized",
  );
  assert(safeRedirect.value.redirects.length === 1, "Safe redirect was not recorded once");
  assert(safeRedirect.value.response.body === "website body", "Final connector response was lost");
  assert(redirectCalls.length === 2, "Safe redirect did not re-resolve and reconnect");
  checks += 8;

  let blockedRedirectConnections = 0;
  const blockedRedirect = await connectWebsiteSource("https://start.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect(target) {
        blockedRedirectConnections += 1;
        return {
          status: 302,
          remoteAddress: target.address,
          redirectLocation: "https://169.254.169.254/latest/meta-data/",
        };
      },
    },
  });
  expectRejected(blockedRedirect, "REDIRECT_NOT_ALLOWED", "redirect to metadata IP");
  assert(blockedRedirectConnections === 1, "Blocked redirect reached its destination connector");
  checks += 2;

  const blockedSchemeRedirect = await connectWebsiteSource("https://start.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect(target) {
        return {
          status: 301,
          remoteAddress: target.address,
          redirectLocation: "http://next.example.com/",
        };
      },
    },
  });
  expectRejected(blockedSchemeRedirect, "REDIRECT_NOT_ALLOWED", "redirect to HTTP");
  checks += 1;

  const blockedQueryRedirect = await connectWebsiteSource("https://start.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect(target) {
        return {
          status: 302,
          remoteAddress: target.address,
          redirectLocation: "https://next.example.com/final?access_token=secret",
        };
      },
    },
  });
  expectRejected(blockedQueryRedirect, "REDIRECT_NOT_ALLOWED", "redirect with query data");
  checks += 1;

  const reboundPrivate = await connectWebsiteSource("https://public.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect() {
        return { status: 200, remoteAddress: "127.0.0.1", body: "unsafe" };
      },
    },
  });
  expectRejected(reboundPrivate, "DNS_REBINDING_DETECTED", "private DNS rebinding");
  checks += 1;

  const reboundPublic = await connectWebsiteSource("https://public.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect() {
        return { status: 200, remoteAddress: "1.1.1.1", body: "wrong public peer" };
      },
    },
  });
  expectRejected(reboundPublic, "DNS_REBINDING_DETECTED", "public-address DNS rebinding");
  checks += 1;

  let failoverAttempts = 0;
  const failover = await connectWebsiteSource("https://dual.example.com/", {
    resolver: publicDns.resolver,
    connector: {
      async connect(target) {
        failoverAttempts += 1;
        if (target.family === 6) throw new Error("IPv6 unavailable");
        return { status: 200, remoteAddress: target.address, body: "IPv4 fallback" };
      },
    },
  });
  assert(
    failover.ok && failover.value.response.body === "IPv4 fallback",
    "Approved-address failover failed",
  );
  assert(failoverAttempts === 2, "Connector did not try the second approved address");
  checks += 2;

  const abortController = new AbortController();
  let abortedConnectorCalls = 0;
  const abortedConnection = connectWebsiteSource("https://slow.example.com/", {
    signal: abortController.signal,
    resolver: {
      resolve: () => new Promise(() => undefined),
    },
    connector: {
      async connect(target) {
        abortedConnectorCalls += 1;
        return { status: 200, remoteAddress: target.address };
      },
    },
  });
  abortController.abort();
  expectRejected(await abortedConnection, "CONNECTION_FAILED", "caller abort during DNS");
  assert(abortedConnectorCalls === 0, "Aborted DNS admission reached the connector");
  checks += 2;

  let redirectNumber = 0;
  const redirectLimit = await connectWebsiteSource("https://start.example.com/", {
    resolver: publicDns.resolver,
    maxRedirects: 1,
    connector: {
      async connect(target) {
        redirectNumber += 1;
        return {
          status: 302,
          remoteAddress: target.address,
          redirectLocation:
            redirectNumber === 1 ? "https://next.example.com/one" : "https://start.example.com/two",
        };
      },
    },
  });
  expectRejected(redirectLimit, "TOO_MANY_REDIRECTS", "redirect limit");
  checks += 1;

  console.log(`Knowledge website URL security smoke: ${checks}/${checks} checks passed`);
}

void main();
