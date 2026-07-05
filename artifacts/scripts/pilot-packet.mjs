import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const localWebBase = normalizeBase(process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001");
const localApiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const publicWebBase = normalizeBase(process.env.LEADVIRT_PUBLIC_WEB_BASE ?? "");
const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE ?? "");
const packetPath = resolve(process.env.LEADVIRT_PILOT_PACKET_OUT ?? "docs/PILOT_PACKET.md");

const telegramKeyOverride = process.env.LEADVIRT_PUBLIC_TELEGRAM_KEY ?? "";
const telegramSecret = process.env.LEADVIRT_PUBLIC_TELEGRAM_SECRET ?? "demo-telegram-secret";
const webhookKeyOverride = process.env.LEADVIRT_PUBLIC_WEBHOOK_KEY ?? "";
const webhookSecret = process.env.LEADVIRT_PUBLIC_WEBHOOK_SECRET ?? "demo-webhook-secret";
const widgetKeyOverride = process.env.LEADVIRT_PUBLIC_WIDGET_KEY ?? "";

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  if (!cleaned) return "";
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function publicOrLocalApiBase() {
  return publicApiBase || localApiBase;
}

function publicOrLocalWebBase() {
  return publicWebBase || localWebBase;
}

function healthUrl(apiBase) {
  return apiBase.replace(/\/api$/, "/health");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchText(url) {
  try {
    const response = await fetch(url, { headers: { accept: "text/html, text/plain, */*" } });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function dataArray(result) {
  return result.ok && Array.isArray(result.json?.data) ? result.json.data : [];
}

function findBy(items, predicate) {
  return items.find((item) => item && typeof item === "object" && predicate(item));
}

function endpointFromIntegration(integration, fallback) {
  const endpoint = integration?.inboundEndpoint;
  if (endpoint && typeof endpoint === "object") {
    return {
      publicKey: String(endpoint.publicKey ?? fallback.publicKey),
      endpointPath: String(endpoint.endpointPath ?? fallback.endpointPath),
      secretHeader: String(endpoint.secretHeader ?? fallback.secretHeader),
      samplePayload: fallback.samplePayload,
    };
  }
  return fallback;
}

function endpointUrl(apiBase, endpointPath) {
  if (apiBase.endsWith("/api") && endpointPath.startsWith("/api/")) {
    return `${apiBase.replace(/\/api$/, "")}${endpointPath}`;
  }
  return `${apiBase}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
}

function channelLine(label, channel) {
  if (!channel) return `- ${label}: missing`;
  return `- ${label}: ${channel.status ?? "UNKNOWN"} / ${channel.publicKey ?? "no public key"}`;
}

function integrationLine(label, integration) {
  if (!integration) return `- ${label}: missing`;
  const endpoint = integration.inboundEndpoint;
  const endpointState = endpoint?.publicKey ? `endpoint ${endpoint.publicKey}` : "no endpoint";
  return `- ${label}: ${integration.status ?? "UNKNOWN"} / ${endpointState}`;
}

function statusText(result) {
  if (result.ok) return `ok (${result.status})`;
  return result.error ? `failed (${result.error})` : `failed (${result.status})`;
}

function fencedJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function psString(value) {
  return String(value).replace(/"/g, '`"');
}

async function main() {
  const [localHealth, webRoot, channelsResult, integrationsResult] = await Promise.all([
    fetchJson(healthUrl(localApiBase)),
    fetchText(localWebBase),
    fetchJson(`${localApiBase}/channels`),
    fetchJson(`${localApiBase}/integrations`),
  ]);

  const channels = dataArray(channelsResult);
  const integrations = dataArray(integrationsResult);

  const telegramChannel = findBy(channels, (channel) => channel.type === "TELEGRAM");
  const webhookChannel = findBy(channels, (channel) => channel.type === "WEBHOOK");
  const widgetChannel = findBy(channels, (channel) => channel.type === "WEBSITE");
  const telegramIntegration = findBy(integrations, (integration) => integration.provider === "TELEGRAM");
  const webhookIntegration = findBy(integrations, (integration) => integration.provider === "WEBHOOK_API");

  const telegramKey = telegramKeyOverride || telegramChannel?.publicKey || "demo-telegram-webhook";
  const webhookKey = webhookKeyOverride || webhookChannel?.publicKey || "demo-generic-webhook";
  const widgetKey = widgetKeyOverride || widgetChannel?.publicKey || "demo-website-widget";

  const telegramEndpoint = endpointFromIntegration(telegramIntegration, {
    publicKey: telegramKey,
    endpointPath: `/api/public/channels/telegram/${telegramKey}/webhook`,
    secretHeader: "x-telegram-bot-api-secret-token",
    samplePayload: {
      update_id: "pilot-sample-update",
      message: {
        chat: { id: "pilot-chat" },
        from: { id: "pilot-user", first_name: "Pilot TG", last_name: "Sample" },
        text: "Pilot Telegram message",
      },
    },
  });

  const webhookEndpoint = endpointFromIntegration(webhookIntegration, {
    publicKey: webhookKey,
    endpointPath: `/api/public/channels/webhook/${webhookKey}/events`,
    secretHeader: "x-leadvirt-webhook-secret",
    samplePayload: {
      eventId: "pilot-sample-event",
      source: "Pilot social landing webhook",
      conversationId: "pilot-sample-conversation",
      customer: { name: "Pilot Webhook Sample", phone: "+79990000000" },
      message: { id: "pilot-sample-message", text: "Pilot webhook message" },
    },
  });

  const targetWebBase = publicOrLocalWebBase();
  const targetApiBase = publicOrLocalApiBase();
  const telegramUrl = endpointUrl(targetApiBase, telegramEndpoint.endpointPath);
  const webhookUrl = endpointUrl(targetApiBase, webhookEndpoint.endpointPath);
  const widgetConfigUrl = `${targetApiBase}/public/widget/${widgetKey}/config`;
  const widgetMessageUrl = `${targetApiBase}/public/widget/${widgetKey}/messages`;

  const lines = [
    "# LeadVirt Pilot Packet",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This packet is for the first controlled test-client sessions. It uses the current local API state when available and falls back to seeded demo keys.",
    "",
    "## Bases",
    "",
    `- Local web: ${localWebBase} (${statusText(webRoot)})`,
    `- Local API: ${localApiBase} (${statusText(localHealth)})`,
    `- Public web: ${publicWebBase || "not set"}`,
    `- Public API: ${publicApiBase || "not set"}`,
    `- Active packet web target: ${targetWebBase}`,
    `- Active packet API target: ${targetApiBase}`,
    "",
    "## Operator Links",
    "",
    `- Landing: ${targetWebBase}/`,
    `- Product demo: ${targetWebBase}/demo`,
    `- Login/client cabinet: ${targetWebBase}/login`,
    `- Integrations readiness: ${targetWebBase}/app/integrations`,
    `- Inbox: ${targetWebBase}/app/inbox`,
    `- Pipeline: ${targetWebBase}/app/leads`,
    `- Automation: ${targetWebBase}/app/automations`,
    `- Widget demo: ${targetWebBase}/widget/demo`,
    "",
    "## Current Local Readiness",
    "",
    channelLine("Telegram channel", telegramChannel),
    channelLine("Webhook/API channel", webhookChannel),
    channelLine("Website widget channel", widgetChannel),
    integrationLine("Telegram integration", telegramIntegration),
    integrationLine("Webhook/API integration", webhookIntegration),
    "",
    "## Intake Endpoints",
    "",
    "### Telegram",
    "",
    `- Endpoint: ${telegramUrl}`,
    `- Public key: ${telegramEndpoint.publicKey}`,
    `- Header: ${telegramEndpoint.secretHeader}: ${telegramSecret}`,
    "",
    fencedJson(telegramEndpoint.samplePayload),
    "",
    "### Webhook/API",
    "",
    `- Endpoint: ${webhookUrl}`,
    `- Public key: ${webhookEndpoint.publicKey}`,
    `- Header: ${webhookEndpoint.secretHeader}: ${webhookSecret}`,
    "",
    fencedJson(webhookEndpoint.samplePayload),
    "",
    "### Website Widget",
    "",
    `- Demo page: ${targetWebBase}/widget/demo`,
    `- Public key: ${widgetKey}`,
    `- Config endpoint: ${widgetConfigUrl}`,
    `- Message endpoint: ${widgetMessageUrl}`,
    "",
    "```html",
    `<script async src="${targetWebBase}/widget/embed.js" data-leadvirt-key="${widgetKey}"></script>`,
    "```",
    "",
    "## Manual Intake Smoke Commands",
    "",
    "Run these from PowerShell when you want to create fresh test leads without opening the browser UI.",
    "",
    "### Telegram",
    "",
    "```powershell",
    "$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    `$telegramEndpoint = "${psString(telegramUrl)}"`,
    `$telegramHeaders = @{ "${psString(telegramEndpoint.secretHeader)}" = "${psString(telegramSecret)}" }`,
    "$telegramBody = @\"",
    "{",
    "  \"update_id\": \"packet-tg-$pilotId\",",
    "  \"message\": {",
    "    \"message_id\": \"packet-tg-message-$pilotId\",",
    "    \"date\": 1761260000,",
    "    \"chat\": { \"id\": \"packet-tg-chat-$pilotId\", \"type\": \"private\" },",
    "    \"from\": {",
    "      \"id\": \"packet-tg-user-$pilotId\",",
    "      \"first_name\": \"Pilot TG\",",
    "      \"last_name\": \"Packet $pilotId\",",
    "      \"username\": \"pilot_packet_$pilotId\"",
    "    },",
    "    \"text\": \"Pilot packet Telegram intake $pilotId\"",
    "  }",
    "}",
    "\"@",
    "Invoke-RestMethod -Method Post -Uri $telegramEndpoint -Headers $telegramHeaders -ContentType \"application/json\" -Body $telegramBody",
    "```",
    "",
    "### Webhook/API",
    "",
    "```powershell",
    "$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    `$webhookEndpoint = "${psString(webhookUrl)}"`,
    `$webhookHeaders = @{ "${psString(webhookEndpoint.secretHeader)}" = "${psString(webhookSecret)}" }`,
    "$webhookBody = @\"",
    "{",
    "  \"eventId\": \"packet-webhook-$pilotId\",",
    "  \"source\": \"Pilot packet social landing webhook\",",
    "  \"conversationId\": \"packet-webhook-conversation-$pilotId\",",
    "  \"customer\": {",
    "    \"id\": \"packet-webhook-customer-$pilotId\",",
    "    \"name\": \"Pilot Webhook Packet $pilotId\",",
    "    \"phone\": \"+79990000000\"",
    "  },",
    "  \"message\": {",
    "    \"id\": \"packet-webhook-message-$pilotId\",",
    "    \"text\": \"Pilot packet webhook intake $pilotId\",",
    "    \"timestamp\": \"2026-06-23T20:00:00.000Z\"",
    "  }",
    "}",
    "\"@",
    "Invoke-RestMethod -Method Post -Uri $webhookEndpoint -Headers $webhookHeaders -ContentType \"application/json\" -Body $webhookBody",
    "```",
    "",
    "### Website Widget",
    "",
    "```powershell",
    "$pilotId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    `$widgetEndpoint = "${psString(widgetMessageUrl)}"`,
    "$widgetBody = @\"",
    "{",
    "  \"sessionId\": \"packet-widget-session-$pilotId\",",
    "  \"clientMessageId\": \"packet-widget-message-$pilotId\",",
    "  \"text\": \"Pilot packet widget intake $pilotId\",",
    "  \"customer\": {",
    "    \"name\": \"Pilot Widget Packet $pilotId\",",
    "    \"phone\": \"+79991111111\"",
    "  },",
    `  "pageUrl": "${psString(targetWebBase)}/widget/demo",`,
    `  "referrer": "${psString(targetWebBase)}"`,
    "}",
    "\"@",
    "Invoke-RestMethod -Method Post -Uri $widgetEndpoint -ContentType \"application/json\" -Body $widgetBody",
    "```",
    "",
    "## Preflight Commands",
    "",
    "One-command pilot readiness:",
    "",
    "```powershell",
    "corepack pnpm run pilot:ready",
    "```",
    "",
    "This writes the latest readiness report to `docs/PILOT_READY_REPORT.md`.",
    "",
    "Individual checks:",
    "",
    "```powershell",
    "corepack pnpm run pilot:doctor",
    "corepack pnpm --filter @leadvirt/web typecheck",
    "corepack pnpm --filter @leadvirt/web lint",
    "corepack pnpm --filter @leadvirt/web build",
    "corepack pnpm run qa:api",
    "corepack pnpm run qa:pilot:intake",
    "```",
    "",
    "Public URL preflight:",
    "",
    "```powershell",
    `$env:LEADVIRT_PUBLIC_WEB_BASE="${publicWebBase || "https://your-public-web-url"}"`,
    `$env:LEADVIRT_PUBLIC_API_BASE="${publicApiBase || "https://your-public-api-url/api"}"`,
    "corepack pnpm run qa:pilot:public",
    "```",
    "",
    "## Pilot Session Flow",
    "",
    "1. Open the product demo with the tester.",
    "2. Send one inbound message through the chosen channel.",
    "3. Confirm the lead appears in Inbox with the correct source/channel.",
    "4. Open the conversation and check timeline, AI draft, handoff/status, and transcript export.",
    "5. Move the lead in Pipeline and create a manager task.",
    "6. Check Automation status and Analytics activity after the interaction.",
    "",
    "## Cleanup",
    "",
    "```powershell",
    "corepack pnpm run db:cleanup:pilot",
    "corepack pnpm run db:cleanup:pilot -- --confirm",
    "```",
    "",
  ];

  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, lines.join("\n"), "utf8");
  console.log(`Pilot packet written to ${packetPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
