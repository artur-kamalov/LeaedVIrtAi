import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const localWebBase = normalizeBase(process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001");
const localApiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const publicWebBase = normalizeBase(process.env.LEADVIRT_PUBLIC_WEB_BASE ?? "");
const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE ?? "");
const packetPath = resolve(process.env.LEADVIRT_PILOT_PACKET_OUT ?? "docs/PILOT_PACKET.md");
const webRouteTimeoutMs = 15000;

const expectedKeys = {
  TELEGRAM: process.env.LEADVIRT_PUBLIC_TELEGRAM_KEY ?? "demo-telegram-webhook",
  WEBHOOK: process.env.LEADVIRT_PUBLIC_WEBHOOK_KEY ?? "demo-generic-webhook",
  WEBSITE: process.env.LEADVIRT_PUBLIC_WIDGET_KEY ?? "demo-website-widget",
};

const checks = [];
const notes = [];

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  if (!cleaned) return "";
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function healthUrl(apiBase) {
  return apiBase.replace(/\/api$/, "/health");
}

function targetWebBase() {
  return publicWebBase || localWebBase;
}

function targetApiBase() {
  return publicApiBase || localApiBase;
}

function ok(name, detail = "") {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail = "") {
  checks.push({ ok: false, name, detail });
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html, text/plain, */*" },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function dataArray(result) {
  return result.ok && Array.isArray(result.json?.data) ? result.json.data : [];
}

function findBy(items, predicate) {
  return items.find((item) => item && typeof item === "object" && predicate(item));
}

function status(result) {
  if (result.ok) return `HTTP ${result.status}`;
  return result.error ? result.error : `HTTP ${result.status}`;
}

async function checkWebRoute(path, label) {
  const url = `${localWebBase}${path}`;
  const result = await fetchText(url, webRouteTimeoutMs);
  if (result.ok && result.text.trim().length > 20) {
    ok(`${label} route`, `${url} (${status(result)})`);
  } else {
    fail(`${label} route`, `${url} (${status(result)})`);
  }
}

function checkChannel(type, label, channels) {
  const channel = findBy(channels, (item) => item.type === type);
  const expectedKey = expectedKeys[type];
  if (!channel) {
    fail(`${label} channel`, "missing from /channels");
    return;
  }
  if (channel.status !== "ACTIVE") {
    fail(`${label} channel`, `status is ${channel.status}`);
    return;
  }
  if (channel.publicKey !== expectedKey) {
    fail(`${label} channel`, `public key is ${channel.publicKey ?? "missing"}, expected ${expectedKey}`);
    return;
  }
  ok(`${label} channel`, `${channel.status} / ${channel.publicKey}`);
}

function checkIntegration(provider, label, integrations) {
  const integration = findBy(integrations, (item) => item.provider === provider);
  if (!integration) {
    fail(`${label} integration`, "missing from /integrations");
    return;
  }
  if (integration.status !== "CONNECTED") {
    fail(`${label} integration`, `status is ${integration.status}`);
    return;
  }
  if (!integration.inboundEndpoint?.publicKey || !integration.inboundEndpoint?.endpointPath) {
    fail(`${label} integration`, "missing inbound endpoint metadata");
    return;
  }
  ok(`${label} integration`, `${integration.status} / ${integration.inboundEndpoint.publicKey}`);
}

async function checkWidgetConfig() {
  const url = `${localApiBase}/public/widget/${expectedKeys.WEBSITE}/config`;
  const result = await fetchJson(url);
  const publicKey = result.json?.data?.publicKey;
  if (result.ok && publicKey === expectedKeys.WEBSITE) {
    ok("Widget config", `${url} (${status(result)})`);
  } else {
    fail("Widget config", `${url} (${status(result)}), publicKey=${publicKey ?? "missing"}`);
  }
}

function checkPacket() {
  if (!existsSync(packetPath)) {
    fail("Pilot packet", `missing at ${packetPath}; run corepack pnpm run pilot:packet`);
    return;
  }

  const packet = readFileSync(packetPath, "utf8");
  const expectedWeb = `- Active packet web target: ${targetWebBase()}`;
  const expectedApi = `- Active packet API target: ${targetApiBase()}`;
  const hasWeb = packet.includes(expectedWeb);
  const hasApi = packet.includes(expectedApi);
  const hasManualSmoke = packet.includes("## Manual Intake Smoke Commands");

  if (hasWeb && hasApi && hasManualSmoke) {
    ok("Pilot packet", `${packetPath}`);
    return;
  }

  const missing = [
    hasWeb ? null : `web target should be ${targetWebBase()}`,
    hasApi ? null : `API target should be ${targetApiBase()}`,
    hasManualSmoke ? null : "manual intake commands missing",
  ].filter(Boolean);
  fail("Pilot packet", `${missing.join("; ")}; run corepack pnpm run pilot:packet`);
}

async function main() {
  console.log("LeadVirt Pilot Doctor");
  console.log(`Local web: ${localWebBase}`);
  console.log(`Local API: ${localApiBase}`);
  if (publicWebBase || publicApiBase) {
    console.log(`Public web: ${publicWebBase || "not set"}`);
    console.log(`Public API: ${publicApiBase || "not set"}`);
  } else {
    notes.push("Public URL env is not set; qa:pilot:public will skip until LEADVIRT_PUBLIC_WEB_BASE and LEADVIRT_PUBLIC_API_BASE are configured.");
  }
  console.log("");

  const [health, channelsResult, integrationsResult] = await Promise.all([
    fetchJson(healthUrl(localApiBase)),
    fetchJson(`${localApiBase}/channels`),
    fetchJson(`${localApiBase}/integrations`),
    checkWebRoute("/", "Landing"),
    checkWebRoute("/demo", "Demo"),
    checkWebRoute("/widget/demo", "Widget demo"),
  ]);

  if (health.ok) ok("API health", `${healthUrl(localApiBase)} (${status(health)})`);
  else fail("API health", `${healthUrl(localApiBase)} (${status(health)})`);

  const channels = dataArray(channelsResult);
  if (channelsResult.ok) ok("Channels API", `${channels.length} channels`);
  else fail("Channels API", status(channelsResult));

  const integrations = dataArray(integrationsResult);
  if (integrationsResult.ok) ok("Integrations API", `${integrations.length} integrations`);
  else fail("Integrations API", status(integrationsResult));

  checkChannel("TELEGRAM", "Telegram", channels);
  checkChannel("WEBHOOK", "Webhook/API", channels);
  checkChannel("WEBSITE", "Website widget", channels);
  checkIntegration("TELEGRAM", "Telegram", integrations);
  checkIntegration("WEBHOOK_API", "Webhook/API", integrations);
  await checkWidgetConfig();
  checkPacket();

  for (const check of checks) {
    const prefix = check.ok ? "PASS" : "FAIL";
    console.log(`${prefix} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  if (notes.length) {
    console.log("");
    for (const note of notes) console.log(`NOTE ${note}`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log("");
  if (failed.length) {
    console.log(`Pilot doctor failed: ${failed.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log("Pilot doctor passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
