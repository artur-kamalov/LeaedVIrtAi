import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

loadLocalEnv();

const startedAt = new Date();
const reportPath = resolve(process.env.LEADVIRT_PUBLIC_READY_REPORT_OUT ?? "docs/PUBLIC_RELEASE_READY_REPORT.md");
const publicWebBase = normalizeBase(process.env.LEADVIRT_PUBLIC_WEB_BASE ?? "");
const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE ?? "");
const selectedChannels = process.env.LEADVIRT_PUBLIC_CHANNELS?.trim() || "webhook";
const skipPublicPreflight = isTruthy(process.env.LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT ?? "");
const steps = [];
const childEnv = {
  ...process.env,
  LEADVIRT_API_BASE: process.env.LEADVIRT_API_BASE?.trim() || publicApiBase,
  LEADVIRT_PUBLIC_CHANNELS: selectedChannels,
  LEADVIRT_AUTH_READY_STRICT: "1",
  LEADVIRT_PROVISION_STRICT: "1",
};

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  if (!cleaned) return "";
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function findEnvFile(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === "\"" ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"") : unquoted;
  }

  return trimmed;
}

function loadLocalEnv() {
  const envPath = findEnvFile();
  if (!envPath) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(withoutExport.slice(separator + 1));
  }
}

function redact(text) {
  return text
    .replace(/(AI_API_KEY=)[^\r\n]*/g, "$1[redacted]")
    .replace(/(\$env:AI_API_KEY=")[^"]*(")/g, "$1[redacted]$2")
    .replace(/(LEADVIRT_WEBHOOK_SECRET=)[^\r\n]*/g, "$1[redacted]")
    .replace(/(LEADVIRT_PUBLIC_WEBHOOK_SECRET=)[^\r\n]*/g, "$1[redacted]")
    .replace(/(\$env:LEADVIRT_WEBHOOK_SECRET=")[^"]*(")/g, "$1[redacted]$2")
    .replace(/(\$env:LEADVIRT_PUBLIC_WEBHOOK_SECRET=")[^"]*(")/g, "$1[redacted]$2")
    .replace(/(Secret\s*\|\s*)[^\r\n]*/gi, "$1[redacted]");
}

function tail(text, maxLines = 40) {
  const lines = redact(text).trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function appendStep(step) {
  steps.push({
    ...step,
    finishedAt: step.finishedAt ?? new Date().toISOString(),
  });
}

function requiredEnv(name) {
  return Boolean(process.env[name]?.trim());
}

function validateEnvironment() {
  const missing = [];
  if (!publicWebBase) missing.push("LEADVIRT_PUBLIC_WEB_BASE");
  if (!publicApiBase) missing.push("LEADVIRT_PUBLIC_API_BASE");
  if (!requiredEnv("DATABASE_URL")) missing.push("DATABASE_URL");
  if (!requiredEnv("LEADVIRT_PROVISION_EMAIL")) missing.push("LEADVIRT_PROVISION_EMAIL");
  if (!requiredEnv("LEADVIRT_PROVISION_PASSWORD")) missing.push("LEADVIRT_PROVISION_PASSWORD");
  if (process.env.AI_PROVIDER !== "openai") missing.push("AI_PROVIDER=openai");
  if (process.env.AI_ENABLE_REAL_PROVIDER !== "true") missing.push("AI_ENABLE_REAL_PROVIDER=true");
  if (!requiredEnv("AI_API_KEY")) missing.push("AI_API_KEY");

  if (missing.length > 0) {
    appendStep({
      label: "Environment",
      command: "",
      status: "failed",
      reason: `Missing required env: ${missing.join(", ")}`,
    });
    writeReport("failed", `Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }

  appendStep({
    label: "Environment",
    command: "",
    status: "passed",
    reason: "Required public release env is set.",
  });
}

function run(label, args, options = {}) {
  console.log("");
  console.log(`== ${label}`);
  console.log(`$ corepack ${args.join(" ")}`);
  const started = Date.now();
  const command = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")]
      : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  appendStep({
    label,
    command: `corepack ${args.join(" ")}`,
    status: result.status === 0 && !result.error ? "passed" : "failed",
    exitCode: result.status ?? null,
    durationMs: Date.now() - started,
    error: result.error?.message ?? null,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  });

  if (options.captureWebhookEnv && result.status === 0 && !result.error) {
    captureWebhookEnv(stdout);
  }

  if (result.status !== 0 || result.error) {
    writeReport("failed", `Stopped at ${label}`);
    process.exit(result.status ?? 1);
  }
}

function captureWebhookEnv(stdout) {
  const key = stdout.match(/^LEADVIRT_PUBLIC_WEBHOOK_KEY=(.+)$/m)?.[1]?.trim();
  const secret = stdout.match(/^LEADVIRT_PUBLIC_WEBHOOK_SECRET=(.+)$/m)?.[1]?.trim();
  if (key) childEnv.LEADVIRT_PUBLIC_WEBHOOK_KEY = key;
  if (secret) childEnv.LEADVIRT_PUBLIC_WEBHOOK_SECRET = secret;
}

function writeReport(status, reason = "") {
  const finishedAt = new Date();
  const lines = [
    "# LeadVirt Public Release Ready Report",
    "",
    `Status: ${status}`,
    `Started: ${startedAt.toISOString()}`,
    `Finished: ${finishedAt.toISOString()}`,
    `Duration seconds: ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}`,
    "",
    "## Environment",
    "",
    `- Public web: ${publicWebBase || "not set"}`,
    `- Public API: ${publicApiBase || "not set"}`,
    `- Selected channels: ${selectedChannels}`,
    `- AI provider: ${process.env.AI_PROVIDER?.trim() || "not set"}`,
    `- AI real provider enabled: ${process.env.AI_ENABLE_REAL_PROVIDER?.trim() || "false"}`,
    `- AI model: ${process.env.AI_DEFAULT_MODEL?.trim() || "gpt-5.5 (default)"}`,
    `- AI API key: ${process.env.AI_API_KEY?.trim() ? "set (redacted)" : "not set"}`,
    `- Provision user: ${process.env.LEADVIRT_PROVISION_EMAIL?.trim() || "not set"}`,
    `- Webhook key captured: ${childEnv.LEADVIRT_PUBLIC_WEBHOOK_KEY ? "yes" : "no"}`,
    `- Webhook secret captured: ${childEnv.LEADVIRT_PUBLIC_WEBHOOK_SECRET ? "yes (redacted)" : "no"}`,
    `- Public URL preflight: ${skipPublicPreflight ? "skipped by LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT" : "required"}`,
    "",
    "## Steps",
    "",
  ];

  for (const step of steps) {
    lines.push(`### ${step.label}`);
    lines.push("");
    lines.push(`- Status: ${step.status}`);
    if (step.command) lines.push(`- Command: \`${step.command}\``);
    if (typeof step.exitCode === "number") lines.push(`- Exit code: ${step.exitCode}`);
    if (step.durationMs) lines.push(`- Duration ms: ${step.durationMs}`);
    if (step.reason) lines.push(`- Reason: ${step.reason}`);
    if (step.error) lines.push(`- Error: ${step.error}`);
    if (step.stdoutTail) {
      lines.push("");
      lines.push("Output tail:");
      lines.push("");
      lines.push("```text");
      lines.push(step.stdoutTail);
      lines.push("```");
    }
    if (step.stderrTail) {
      lines.push("");
      lines.push("Error output tail:");
      lines.push("");
      lines.push("```text");
      lines.push(step.stderrTail);
      lines.push("```");
    }
    lines.push("");
  }

  if (reason) {
    lines.push("## Stop Reason");
    lines.push("");
    lines.push(reason);
    lines.push("");
  }

  lines.push("## Next Actions");
  lines.push("");
  if (status === "passed") {
    lines.push("- Use the terminal output from `provision:webhook-channel` to configure Master Budet env.");
    lines.push("- Use `docs/PILOT_PACKET.md` for operator links and public smoke commands.");
    lines.push("- Do not commit webhook secrets into docs or source files.");
  } else if (status === "passed-with-skipped-public-preflight") {
    lines.push("- Use the terminal output from `provision:webhook-channel` to configure Master Budet env.");
    lines.push("- Run `corepack pnpm run qa:pilot:public` from an operator machine with Playwright browser access before inviting testers.");
    lines.push("- Do not commit webhook secrets into docs or source files.");
  } else {
    lines.push("- Required AI env for public release: `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, `AI_API_KEY`, and optionally `AI_DEFAULT_MODEL`.");
    lines.push("- Fix the failed step above, then rerun `corepack pnpm run release:public-ready`.");
  }
  lines.push("");

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("");
  console.log(`Public release ready report written to ${reportPath}`);
}

console.log("LeadVirt Public Release Ready");
console.log("This command checks strict auth readiness, provisions Webhook/API, regenerates the packet, and runs public URL preflight.");
if (skipPublicPreflight) {
  console.log("Public URL preflight will be skipped. Run qa:pilot:public separately from an operator machine before external testers.");
}

validateEnvironment();
run("AI provider smoke", ["pnpm", "run", "qa:ai:provider"]);
run("Strict auth readiness", ["pnpm", "run", "qa:auth:staging-ready"]);
run("Provision Webhook/API channel", ["pnpm", "run", "provision:webhook-channel"], { captureWebhookEnv: true });
run("Generate pilot packet", ["pnpm", "run", "pilot:packet"]);
if (skipPublicPreflight) {
  appendStep({
    label: "Public URL preflight",
    command: "corepack pnpm run qa:pilot:public",
    status: "skipped",
    reason: "Skipped by LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT. Run this from an operator machine with Playwright browser access before inviting testers.",
  });
} else {
  run("Public URL preflight", ["pnpm", "run", "qa:pilot:public"]);
}

console.log("");
if (skipPublicPreflight) {
  console.log("Public release non-browser checks passed. Public URL preflight still needs an operator-local run.");
  writeReport("passed-with-skipped-public-preflight");
} else {
  console.log("Public release checks passed.");
  writeReport("passed");
}
