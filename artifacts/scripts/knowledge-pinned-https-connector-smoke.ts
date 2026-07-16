import {
  PinnedHttpsConnectorError,
  connectWebsiteSource,
  createPinnedHttpsWebsiteSourceConnector,
  type PinnedHttpsConnectorErrorCode,
  type PinnedHttpsTransport,
  type PinnedHttpsTransportRequest,
  type PinnedHttpsTransportResponse,
  type WebsiteSourceConnectionTarget,
  type WebsiteSourceResolver,
} from "@leadvirt/knowledge";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function target(
  signal: AbortSignal = new AbortController().signal,
  overrides: Partial<WebsiteSourceConnectionTarget> = {},
): WebsiteSourceConnectionTarget {
  return {
    url: "https://public.example.com/docs?q=1",
    hostname: "public.example.com",
    hostHeader: "public.example.com",
    serverName: "public.example.com",
    port: 443,
    address: "93.184.216.34",
    family: 4,
    signal,
    ...overrides,
  };
}

async function* chunks(...values: Array<string | Uint8Array>) {
  for (const value of values) {
    yield typeof value === "string" ? Buffer.from(value) : value;
  }
}

function response(
  overrides: Partial<PinnedHttpsTransportResponse> = {},
): PinnedHttpsTransportResponse {
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=UTF-8", "content-length": "5" },
    headerBytes: 96,
    headerCount: 2,
    remoteAddress: "93.184.216.34",
    remoteFamily: 4,
    body: chunks("hello"),
    cancel() {},
    ...overrides,
  };
}

function transportWith(
  handler: (input: PinnedHttpsTransportRequest) => Promise<PinnedHttpsTransportResponse>,
) {
  const requests: PinnedHttpsTransportRequest[] = [];
  const transport: PinnedHttpsTransport = {
    async request(input) {
      requests.push(input);
      return handler(input);
    },
  };
  return { transport, requests };
}

async function expectConnectorError(
  promise: Promise<unknown>,
  code: PinnedHttpsConnectorErrorCode,
  label: string,
) {
  try {
    await promise;
    throw new Error(`${label}: expected ${code}`);
  } catch (error) {
    assert(error instanceof PinnedHttpsConnectorError, `${label}: error was not safely wrapped`);
    assert(error.code === code, `${label}: expected ${code}, got ${error.code}`);
    assert(
      !/public\.example\.com|93\.184\.216\.34|certificate mentions host/u.test(error.message),
      `${label}: public error leaked transport details`,
    );
  }
}

async function main() {
  let checks = 0;
  const happyTransport = transportWith(async () => response({ body: chunks("he", "ll", "o") }));
  const connector = createPinnedHttpsWebsiteSourceConnector({
    transport: happyTransport.transport,
    maxBodyBytes: 5,
  });
  const acquired = await connector.connect(target());
  assert(acquired.status === 200, "Allowed HTML status was lost");
  assert(acquired.body?.contentType === "text/html", "HTML content type was not normalized");
  assert(acquired.body.charset === "utf-8", "Charset was not normalized");
  assert(acquired.body.byteLength === 5, "Body byte length was wrong");
  assert(Buffer.from(acquired.body.bytes).toString("utf8") === "hello", "Body bytes changed");
  assert(
    acquired.body.sha256 === "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "Body SHA-256 was wrong",
  );
  assert(
    Object.keys(acquired.body).sort().join(",") ===
      "byteLength,bytes,charset,contentType,sha256",
    "Body exposed unsafe response metadata",
  );
  checks += 7;

  const request = happyTransport.requests[0];
  assert(request?.method === "GET", "Connector did not force GET");
  assert(request.address === "93.184.216.34" && request.family === 4, "Connector did not pin the approved address and family");
  assert(request.port === 443 && request.path === "/docs?q=1", "Connector changed the approved HTTPS target");
  assert(request.hostHeader === "public.example.com", "Original Host was not preserved");
  assert(request.serverName === "public.example.com", "TLS SNI was not preserved");
  assert(request.verifyHostname === "public.example.com", "TLS certificate hostname was not preserved");
  assert(request.rejectUnauthorized, "Certificate verification was disabled");
  assert(request.minimumTlsVersion === "TLSv1.2", "Minimum TLS version was weakened");
  assert(request.headers["Accept-Encoding"] === "identity", "Identity encoding was not requested");
  assert(!("Cookie" in request.headers) && !("Authorization" in request.headers), "Connector sent cookie or authorization headers");
  assert(
    Object.keys(request.headers).sort().join(",") ===
      "Accept,Accept-Encoding,Connection,Host,User-Agent",
    "Connector sent unexpected custom headers",
  );
  checks += 11;

  const plainConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () =>
      response({
        headers: { "content-type": "text/plain" },
        body: chunks("plain text"),
      }),
    ).transport,
  });
  const plain = await plainConnector.connect(target());
  assert(plain.body?.contentType === "text/plain" && plain.body.charset === null, "Plain text was not accepted safely");
  checks += 1;

  let redirectBodyRead = false;
  let redirectCancelled = false;
  const redirectConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () =>
      response({
        statusCode: 302,
        headers: { location: "https://next.example.com/" },
        body: (async function* () {
          redirectBodyRead = true;
          yield Buffer.from("redirect body");
        })(),
        cancel() {
          redirectCancelled = true;
        },
      }),
    ).transport,
  });
  const redirect = await redirectConnector.connect(target());
  assert(redirect.status === 302 && redirect.redirectLocation === "https://next.example.com/", "Redirect metadata was not returned");
  assert(!redirectBodyRead && redirectCancelled, "Redirect body was consumed or left open");
  checks += 2;

  for (const [headers, code, label] of [
    [{ "content-type": "text/html", "content-encoding": "gzip" }, "CONTENT_ENCODING_NOT_ALLOWED", "gzip body"],
    [{ "content-type": "text/html", "content-encoding": "br" }, "CONTENT_ENCODING_NOT_ALLOWED", "brotli body"],
    [{ "content-type": "application/json" }, "CONTENT_TYPE_NOT_ALLOWED", "JSON body"],
    [{ "content-type": "application/octet-stream" }, "CONTENT_TYPE_NOT_ALLOWED", "binary body"],
    [{}, "CONTENT_TYPE_NOT_ALLOWED", "missing content type"],
    [{ "content-type": ["text/html", "text/plain"] }, "RESPONSE_INVALID", "duplicate content type"],
    [{ "content-type": "text/html", "content-length": "invalid" }, "RESPONSE_INVALID", "invalid content length"],
  ] as const) {
    let cancelled = false;
    const invalidConnector = createPinnedHttpsWebsiteSourceConnector({
      transport: transportWith(async () =>
        response({
          headers,
          cancel() {
            cancelled = true;
          },
        }),
      ).transport,
    });
    await expectConnectorError(invalidConnector.connect(target()), code, label);
    assert(cancelled, `${label}: rejected response was not cancelled`);
    checks += 2;
  }

  for (const [statusCode, label] of [
    [204, "empty success status"],
    [206, "partial status"],
    [404, "not found status"],
    [500, "server error status"],
  ] as const) {
    let cancelled = false;
    const statusConnector = createPinnedHttpsWebsiteSourceConnector({
      transport: transportWith(async () =>
        response({
          statusCode,
          cancel() {
            cancelled = true;
          },
        }),
      ).transport,
    });
    await expectConnectorError(statusConnector.connect(target()), "STATUS_NOT_ALLOWED", label);
    assert(cancelled, `${label}: response was not cancelled`);
    checks += 2;
  }

  const missingRedirectConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () => response({ statusCode: 301, headers: {} })).transport,
  });
  await expectConnectorError(
    missingRedirectConnector.connect(target()),
    "RESPONSE_INVALID",
    "redirect without Location",
  );
  checks += 1;

  for (const [overrides, label] of [
    [{ headerBytes: 40_000 }, "header byte limit"],
    [{ headerCount: 101 }, "header count limit"],
  ] as const) {
    let cancelled = false;
    const headerConnector = createPinnedHttpsWebsiteSourceConnector({
      transport: transportWith(async () =>
        response({
          ...overrides,
          cancel() {
            cancelled = true;
          },
        }),
      ).transport,
    });
    await expectConnectorError(headerConnector.connect(target()), "HEADERS_TOO_LARGE", label);
    assert(cancelled, `${label}: response was not cancelled`);
    checks += 2;
  }

  let declaredBodyRead = false;
  let declaredCancelled = false;
  const declaredOversizeConnector = createPinnedHttpsWebsiteSourceConnector({
    maxBodyBytes: 5,
    transport: transportWith(async () =>
      response({
        headers: { "content-type": "text/html", "content-length": "6" },
        body: (async function* () {
          declaredBodyRead = true;
          yield Buffer.from("123456");
        })(),
        cancel() {
          declaredCancelled = true;
        },
      }),
    ).transport,
  });
  await expectConnectorError(
    declaredOversizeConnector.connect(target()),
    "BODY_TOO_LARGE",
    "declared oversized body",
  );
  assert(!declaredBodyRead && declaredCancelled, "Declared oversized body was consumed or left open");
  checks += 2;

  let streamedCancelled = false;
  const streamedOversizeConnector = createPinnedHttpsWebsiteSourceConnector({
    maxBodyBytes: 5,
    transport: transportWith(async () =>
      response({
        headers: { "content-type": "text/html" },
        body: chunks("123", "456"),
        cancel() {
          streamedCancelled = true;
        },
      }),
    ).transport,
  });
  await expectConnectorError(
    streamedOversizeConnector.connect(target()),
    "BODY_TOO_LARGE",
    "streamed oversized body",
  );
  assert(streamedCancelled, "Streamed oversized response was not cancelled");
  checks += 2;

  const lengthMismatchConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () =>
      response({
        headers: { "content-type": "text/html", "content-length": "6" },
        body: chunks("short"),
      }),
    ).transport,
  });
  await expectConnectorError(
    lengthMismatchConnector.connect(target()),
    "RESPONSE_INVALID",
    "content-length mismatch",
  );
  checks += 1;

  let mismatchBodyRead = false;
  let mismatchCancelled = false;
  const mismatchConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () =>
      response({
        remoteAddress: "1.1.1.1",
        body: (async function* () {
          mismatchBodyRead = true;
          yield Buffer.from("unsafe");
        })(),
        cancel() {
          mismatchCancelled = true;
        },
      }),
    ).transport,
  });
  await expectConnectorError(
    mismatchConnector.connect(target()),
    "REMOTE_ADDRESS_MISMATCH",
    "remote address mismatch",
  );
  assert(!mismatchBodyRead && mismatchCancelled, "Mismatched peer body was consumed or left open");
  checks += 2;

  const familyMismatchConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () => response({ remoteFamily: 6 })).transport,
  });
  await expectConnectorError(
    familyMismatchConnector.connect(target()),
    "REMOTE_ADDRESS_MISMATCH",
    "remote family mismatch",
  );
  checks += 1;

  const tlsTransport = transportWith(async () => {
    throw Object.assign(new Error("certificate mentions host"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
  const tlsConnector = createPinnedHttpsWebsiteSourceConnector({ transport: tlsTransport.transport });
  await expectConnectorError(
    tlsConnector.connect(target()),
    "TLS_VERIFICATION_FAILED",
    "TLS certificate failure",
  );
  checks += 1;

  const headerOverflowTransport = transportWith(async () => {
    throw Object.assign(new Error("raw parser detail"), { code: "HPE_HEADER_OVERFLOW" });
  });
  await expectConnectorError(
    createPinnedHttpsWebsiteSourceConnector({ transport: headerOverflowTransport.transport }).connect(target()),
    "HEADERS_TOO_LARGE",
    "transport header overflow",
  );
  checks += 1;

  const failedTransport = transportWith(async () => {
    throw new Error("connect ECONNREFUSED 93.184.216.34");
  });
  await expectConnectorError(
    createPinnedHttpsWebsiteSourceConnector({ transport: failedTransport.transport }).connect(target()),
    "TRANSPORT_FAILED",
    "transport failure",
  );
  checks += 1;

  let preAbortedCalls = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  const abortConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: transportWith(async () => {
      preAbortedCalls += 1;
      return response();
    }).transport,
  });
  await expectConnectorError(abortConnector.connect(target(preAborted.signal)), "ABORTED", "pre-aborted request");
  assert(preAbortedCalls === 0, "Pre-aborted acquisition reached the transport");
  checks += 2;

  const runningAbort = new AbortController();
  const hangingTransport = transportWith(
    async () => new Promise<PinnedHttpsTransportResponse>(() => undefined),
  );
  const runningAbortConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: hangingTransport.transport,
  });
  const abortedPromise = runningAbortConnector.connect(target(runningAbort.signal));
  runningAbort.abort();
  await expectConnectorError(abortedPromise, "ABORTED", "in-flight abort");
  checks += 1;

  const timeoutTransport = transportWith(
    async () => new Promise<PinnedHttpsTransportResponse>(() => undefined),
  );
  const timeoutConnector = createPinnedHttpsWebsiteSourceConnector({
    transport: timeoutTransport.transport,
    timeoutMs: 100,
  });
  await expectConnectorError(timeoutConnector.connect(target()), "TIMEOUT", "connector timeout");
  checks += 1;

  for (const [overrides, label] of [
    [{ hostHeader: "other.example.com" }, "Host mismatch"],
    [{ serverName: "other.example.com" }, "SNI mismatch"],
    [{ address: "not-an-ip" }, "non-IP target"],
    [{ family: 6 as const }, "target family mismatch"],
  ] as const) {
    await expectConnectorError(
      connector.connect(target(undefined, overrides)),
      "TARGET_INVALID",
      label,
    );
    checks += 1;
  }

  const resolver: WebsiteSourceResolver = {
    async resolve() {
      return [{ address: "93.184.216.34", family: 4 }];
    },
  };
  const outerMismatch = await connectWebsiteSource("https://public.example.com/", {
    resolver,
    connector: mismatchConnector,
  });
  assert(
    !outerMismatch.ok && outerMismatch.reason.code === "CONNECTION_FAILED",
    "Redirect/fetch policy did not fail closed after connector peer mismatch",
  );
  checks += 1;

  console.log(`Knowledge pinned HTTPS connector smoke: ${checks}/${checks} checks passed`);
}

void main();
