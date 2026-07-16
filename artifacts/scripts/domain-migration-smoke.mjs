import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const workflowPath = ".github/workflows/deploy-leadvirt-com.yml";
const workflow = read(workflowPath);
const nginx = read("deploy/nginx.https.conf");
const nginxHttp = read("deploy/nginx.conf");
const cutover = read("deploy/enable-leadvirt-com-https.sh");
const stagingEnv = read("deploy/env.staging.example");
const readinessSmoke = read("artifacts/scripts/release-readiness-scripts-smoke.mjs");
const pilotPacket = read("docs/PILOT_PACKET.md");

assert(
  !existsSync(resolve(root, ".github/workflows/deploy-leadvirt-ru.yml")),
  "Legacy deploy workflow still exists.",
);
assert(
  !existsSync(resolve(root, ".github/workflows/deploy-leadvirt-ai.yml")),
  "Mistaken .ai deploy workflow still exists.",
);
assert(
  !existsSync(resolve(root, "deploy/enable-leadvirt-ai-https.sh")),
  "Mistaken .ai cutover script still exists.",
);
assert(
  workflow.includes("name: Deploy LeadVirt.com"),
  "Deploy workflow is not named for LeadVirt.com.",
);
assert(
  workflow.includes("PUBLIC_URL: https://leadvirt.com"),
  "Deploy workflow public URL is not canonical.",
);
assert(
  workflow.includes("environment: leadvirt-com"),
  "Deploy workflow does not use the leadvirt-com environment.",
);
assert(!workflow.includes("leadvirt.ru"), "Deploy workflow still configures the retired domain.");
assert(!workflow.includes("LEGACY_DOMAIN"), "Deploy workflow still passes legacy-domain inputs.");

const prepareIndex = workflow.indexOf("enable-leadvirt-com-https.sh");
const drainedNginxIndex = workflow.indexOf("DEPLOY_GATE: public-nginx-stopped", prepareIndex);
const switchIndex = workflow.indexOf('case "$previous_current_kind" in', drainedNginxIndex);
assert(
  prepareIndex >= 0 && drainedNginxIndex > prepareIndex && switchIndex > drainedNginxIndex,
  "Domain preparation must finish before the active release changes.",
);

assert(nginx.includes("server_name leadvirt.com;"), "Canonical nginx server is missing.");
assert(
  nginx.includes("/etc/letsencrypt/live/leadvirt.com/fullchain.pem"),
  "Canonical certificate path is missing.",
);
assert(
  !nginx.includes("leadvirt.ru"),
  "HTTPS nginx config still serves the retired domain.",
);
assert(
  !nginxHttp.includes("leadvirt.ru"),
  "HTTP nginx config still serves the retired domain.",
);
assert(
  /listen 80 default_server;[\s\S]*?server_name _;[\s\S]*?return 444;/.test(nginx),
  "Unknown HTTP hosts are not rejected.",
);
assert(
  /listen 80 default_server;[\s\S]*?server_name _;[\s\S]*?return 444;/.test(nginxHttp),
  "Pre-TLS nginx config does not reject unknown HTTP hosts.",
);
assert(
  /listen 443 ssl default_server;[\s\S]*?ssl_reject_handshake on;/.test(nginx),
  "Unknown HTTPS hosts are not rejected during the TLS handshake.",
);

assert(
  cutover.includes('PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-leadvirt.com}"'),
  "Cutover script has the wrong primary domain.",
);
assert(
  cutover.includes("ACME challenge path is not reachable"),
  "Cutover script does not preflight ACME routing.",
);
assert(
  cutover.includes("$certbot_webroot/.well-known/acme-challenge"),
  "Cutover preflight writes outside the ACME challenge directory.",
);
assert(
  cutover.includes('--cert-name "$PRIMARY_DOMAIN"'),
  "Cutover certificate path is not deterministic.",
);
assert(!cutover.includes("LEGACY_DOMAIN"), "Cutover script still configures a legacy domain.");
assert(
  cutover.includes("nginx -t -c /tmp/leadvirt-nginx.https.conf"),
  "Cutover script does not validate candidate nginx config.",
);
assert(
  stagingEnv.includes("NEXT_PUBLIC_APP_URL=https://leadvirt.com"),
  "Staging frontend origin is not canonical.",
);
assert(!stagingEnv.includes("leadvirt.ru"), "Staging CORS still permits the retired domain.");
assert(
  readinessSmoke.includes('LEADVIRT_PUBLIC_WEB_BASE: "https://leadvirt.com"'),
  "Release smoke still targets the legacy domain.",
);
assert(
  pilotPacket.includes("Public web: https://leadvirt.com"),
  "Pilot packet does not target the canonical domain.",
);
assert(
  !pilotPacket.includes("https://leadvirt.ru"),
  "Pilot packet still publishes legacy-domain links.",
);
assert(
  !pilotPacket.includes("demo-webhook-secret"),
  "Pilot packet contains a fallback webhook secret.",
);
assert(
  nginx.includes("server_name masterbudet.ru www.masterbudet.ru;"),
  "Shared Master Budet proxy routes are missing.",
);
assert(
  nginx.includes("resolver 127.0.0.11 valid=30s ipv6=off;"),
  "Master Budet proxy does not use deferred Docker DNS.",
);
assert(
  nginx.includes("ssl_certificate /etc/letsencrypt/live/masterbudet.ru/fullchain.pem;"),
  "Master Budet apex TLS certificate is not configured.",
);
assert(
  nginx.includes("server_name www.masterbudet.ru;"),
  "Master Budet www TLS redirect is not configured.",
);
assert(
  nginx.includes("return 308 https://masterbudet.ru$request_uri;"),
  "Master Budet HTTP traffic does not redirect to the HTTPS apex.",
);

console.log("PASS: LeadVirt.com is canonical and the retired domain is absent from runtime configuration.");
