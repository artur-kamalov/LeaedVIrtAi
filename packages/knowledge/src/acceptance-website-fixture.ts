import { PinnedHttpsConnectorError } from "./pinned-https-website-connector.js";
import type { PinnedHttpsTransport } from "./pinned-https-website-connector.js";
import type { WebsiteSourceResolver } from "./website-source-url-security.js";

export const KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_URL =
  "https://knowledge-acceptance.leadvirt.com/fresh-owner";

export const KNOWLEDGE_ACCEPTANCE_WEBSITE_EXPECTED_SENTENCE =
  "Polar Lantern Studio's signature service code is AURORA-7291.";

const fixtureHost = "knowledge-acceptance.leadvirt.com";
const fixtureAddress = "93.184.216.34";
const fixtureHtml = [
  "<!doctype html>",
  '<html lang="en">',
  "<head><title>Polar Lantern Studio services</title></head>",
  "<body>",
  "<main>",
  "<h1>Polar Lantern Studio</h1>",
  `<p>${KNOWLEDGE_ACCEPTANCE_WEBSITE_EXPECTED_SENTENCE}</p>`,
  "<p>Aurora consultations are available Tuesday through Saturday.</p>",
  "</main>",
  "</body>",
  "</html>",
].join("");
const fixtureBytes = new TextEncoder().encode(fixtureHtml);

async function* fixtureBody() {
  yield await Promise.resolve(fixtureBytes);
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function knowledgeAcceptanceWebsiteFixtureEnabled(env: Record<string, string | undefined>) {
  return env.APP_ENV === "acceptance" && enabled(env.KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_ENABLED);
}

export function createKnowledgeAcceptanceWebsiteFixture(): {
  resolver: WebsiteSourceResolver;
  transport: PinnedHttpsTransport;
} {
  return {
    resolver: {
      resolve(hostname) {
        if (hostname !== fixtureHost) throw new Error("Acceptance website host is not available.");
        return Promise.resolve([{ address: fixtureAddress, family: 4 }]);
      },
    },
    transport: {
      request(input) {
        if (input.signal.aborted) throw new PinnedHttpsConnectorError("ABORTED");
        if (
          input.address !== fixtureAddress ||
          input.family !== 4 ||
          input.port !== 443 ||
          input.path !== "/fresh-owner" ||
          input.hostHeader !== fixtureHost ||
          input.verifyHostname !== fixtureHost ||
          input.serverName !== fixtureHost ||
          input.rejectUnauthorized !== true ||
          input.minimumTlsVersion !== "TLSv1.2"
        ) {
          throw new PinnedHttpsConnectorError("TARGET_INVALID");
        }
        return Promise.resolve({
          statusCode: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-length": String(fixtureBytes.byteLength),
          },
          headerBytes: 72,
          headerCount: 2,
          remoteAddress: fixtureAddress,
          remoteFamily: 4,
          body: fixtureBody(),
          cancel() {},
        });
      },
    },
  };
}
