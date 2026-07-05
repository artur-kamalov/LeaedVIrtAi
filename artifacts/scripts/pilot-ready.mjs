import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const hasPublicWeb = Boolean(process.env.LEADVIRT_PUBLIC_WEB_BASE?.trim());
const hasPublicApi = Boolean(process.env.LEADVIRT_PUBLIC_API_BASE?.trim());
const requirePublic = process.env.LEADVIRT_READY_REQUIRE_PUBLIC === "1";
const skipLocalIntake = process.env.LEADVIRT_READY_SKIP_LOCAL_INTAKE === "1";
const reportPath = resolve(process.env.LEADVIRT_READY_REPORT_OUT ?? "docs/PILOT_READY_REPORT.md");
const startedAt = new Date();
const steps = [];

function elapsedMs(start) {
  return Date.now() - start;
}

function appendStep(step) {
  steps.push({
    ...step,
    durationMs: step.durationMs ?? 0,
    finishedAt: step.finishedAt ?? new Date().toISOString(),
  });
}

function tail(text, maxLines = 40) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function run(label, args) {
  console.log("");
  console.log(`== ${label}`);
  console.log(`$ corepack ${args.join(" ")}`);
  const stepStarted = Date.now();
  const command = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")]
      : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.log("");
    console.log(`Could not launch command: ${result.error.message}`);
  }

  appendStep({
    label,
    command: `corepack ${args.join(" ")}`,
    status: result.status === 0 && !result.error ? "passed" : "failed",
    exitCode: result.status ?? null,
    error: result.error?.message ?? null,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail(result.stderr ?? ""),
    durationMs: elapsedMs(stepStarted),
  });

  if (result.status !== 0 || result.error) {
    console.log("");
    console.log(`Pilot readiness stopped at: ${label}`);
    writeReport("failed", `Stopped at ${label}`);
    process.exit(result.status ?? 1);
  }
}

function skip(label, reason) {
  console.log("");
  console.log(`== ${label}`);
  console.log(reason);
  appendStep({
    label,
    command: "",
    status: "skipped",
    reason,
  });
}

function cleanupSummary() {
  const cleanup = steps.find((step) => step.label === "Pilot cleanup dry run");
  const match = cleanup?.stdoutTail?.match(/\{\s*"tenant"[\s\S]*?\n\}/);
  return match ? match[0] : "";
}

function writeReport(status, reason = "") {
  const endedAt = new Date();
  const cleanup = cleanupSummary();
  const lines = [
    "# LeadVirt Pilot Ready Report",
    "",
    `Status: ${status}`,
    `Started: ${startedAt.toISOString()}`,
    `Finished: ${endedAt.toISOString()}`,
    `Duration seconds: ${Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)}`,
    "",
    "## Environment",
    "",
    `- Local web: ${process.env.LEADVIRT_WEB_BASE?.trim() || "http://localhost:3001"}`,
    `- Local API: ${process.env.LEADVIRT_API_BASE?.trim() || "http://localhost:4001/api"}`,
    `- Public web: ${process.env.LEADVIRT_PUBLIC_WEB_BASE?.trim() || "not set"}`,
    `- Public API: ${process.env.LEADVIRT_PUBLIC_API_BASE?.trim() || "not set"}`,
    `- Local intake skipped: ${skipLocalIntake ? "yes" : "no"}`,
    `- Public preflight required: ${requirePublic ? "yes" : "no"}`,
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

  if (cleanup) {
    lines.push("## Cleanup Dry Run Counts");
    lines.push("");
    lines.push("```json");
    lines.push(cleanup);
    lines.push("```");
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
    lines.push("- Use `docs/PILOT_PACKET.md` for the operator/tester links and manual intake commands.");
    lines.push("- If a public URL is configured, confirm `qa:pilot:public` ran instead of being skipped.");
    lines.push("- Run `corepack pnpm run db:cleanup:pilot -- --confirm` only when you intentionally want to remove disposable pilot records.");
  } else {
    lines.push("- Fix the failed step above, rerun `corepack pnpm run pilot:ready`, and regenerate the packet if URLs or keys changed.");
  }
  lines.push("");

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("");
  console.log(`Pilot ready report written to ${reportPath}`);
}

console.log("LeadVirt Pilot Ready");
console.log("This command regenerates the packet, checks local readiness, runs local intake smoke, and runs public preflight when configured.");

run("Generate pilot packet", ["pnpm", "run", "pilot:packet"]);
run("Fast local doctor", ["pnpm", "run", "pilot:doctor"]);

if (skipLocalIntake) {
  skip("Local intake smoke", "Skipped because LEADVIRT_READY_SKIP_LOCAL_INTAKE=1.");
} else {
  run("Local real intake smoke", ["pnpm", "run", "qa:pilot:intake"]);
}

if (hasPublicWeb && hasPublicApi) {
  run("Public URL preflight", ["pnpm", "run", "qa:pilot:public"]);
} else if (requirePublic) {
  console.log("");
  console.log("Pilot readiness requires public preflight, but LEADVIRT_PUBLIC_WEB_BASE and/or LEADVIRT_PUBLIC_API_BASE are not set.");
  appendStep({
    label: "Public URL preflight",
    command: "corepack pnpm run qa:pilot:public",
    status: "failed",
    reason: "LEADVIRT_READY_REQUIRE_PUBLIC=1 but LEADVIRT_PUBLIC_WEB_BASE and/or LEADVIRT_PUBLIC_API_BASE are not set.",
  });
  writeReport("failed", "Public preflight was required but public URL env vars are missing.");
  process.exit(1);
} else {
  skip("Public URL preflight", "Skipped because LEADVIRT_PUBLIC_WEB_BASE and LEADVIRT_PUBLIC_API_BASE are not both set.");
}

run("Pilot cleanup dry run", ["pnpm", "run", "db:cleanup:pilot"]);

console.log("");
console.log("Pilot ready checks passed.");
writeReport("passed");
