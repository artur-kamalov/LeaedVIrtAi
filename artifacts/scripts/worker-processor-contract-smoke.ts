import assert from "node:assert/strict";
import { createConfiguredAiProvider } from "@leadvirt/ai";

let checks = 0;

function check(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks += 1;
}

function rejectsSync(run: () => unknown, pattern: RegExp, message: string) {
  assert.throws(run, pattern, message);
  checks += 1;
}

async function rejectsAsync(run: () => Promise<unknown>, pattern: RegExp, message: string) {
  await assert.rejects(run, pattern, message);
  checks += 1;
}

const localProvider = createConfiguredAiProvider({
  provider: "mock",
  realProviderEnabled: false,
  production: false,
  apiKey: "",
});
check(localProvider.providerName === "mock", "Explicit local mock provider was not selected.");

rejectsSync(
  () =>
    createConfiguredAiProvider({
      provider: "mock",
      realProviderEnabled: false,
      production: true,
      apiKey: "",
    }),
  /not operational in production/u,
  "Production accepted the mock AI provider.",
);
rejectsSync(
  () =>
    createConfiguredAiProvider({
      provider: "openai",
      realProviderEnabled: false,
      production: true,
      apiKey: "configured-but-disabled",
    }),
  /not operational in production/u,
  "Production accepted a disabled real AI provider.",
);
rejectsSync(
  () =>
    createConfiguredAiProvider({
      provider: "openai",
      realProviderEnabled: true,
      production: true,
      apiKey: "",
    }),
  /AI_API_KEY is required/u,
  "Production accepted an OpenAI provider without a key.",
);

async function main() {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "test";
  process.env.AI_PROVIDER = "mock";
  process.env.AI_ENABLE_REAL_PROVIDER = "false";
  process.env.DATABASE_URL ??=
    "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
  delete process.env.KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID;
  delete process.env.KNOWLEDGE_QUERY_HMAC_KEYS;

  const [{ processLeadVirtJob }, { processLeadVirtJobWithReliability }] = await Promise.all([
    import("../../apps/worker/src/processors/processor-registry.js"),
    import("../../apps/worker/src/reliability/worker-reliability.js"),
  ]);
  type JobInput = Parameters<typeof processLeadVirtJob>[1];

  function job(data: Record<string, unknown>): JobInput {
    return { id: "worker-contract-job", data, opts: {} } as JobInput;
  }

  for (const queueName of [
    "ai.followUp",
    "channels.processWebhook",
    "crm.syncLead",
    "analytics.aggregate",
    "billing.calculateUsage",
  ] as const) {
    rejectsSync(
      () => processLeadVirtJob(queueName, job({})),
      new RegExp(`No processor is implemented for ${queueName.replace(".", "\\.")}`, "u"),
      `${queueName} returned success without an implementation.`,
    );
  }

  rejectsSync(
    () => processLeadVirtJob("ai.extractLeadFields", job({ text: "lead" })),
    /Invalid ai\.extractLeadFields job data/u,
    "Lead extraction accepted missing tenant and conversation identity.",
  );
  rejectsSync(
    () => processLeadVirtJob("ai.reply", job({})),
    /Invalid ai\.reply job data/u,
    "AI reply accepted an invalid payload.",
  );
  rejectsSync(
    () => processLeadVirtJob("channels.sendMessage", job({})),
    /Invalid channels\.sendMessage job data/u,
    "Channel delivery accepted an invalid payload.",
  );
  const untrackedDelivery = {
    tenantId: "c123456789012345678901234",
    conversationId: "c987654321098765432109876",
    messageId: "c111111111111111111111111",
    source: "webhook",
    requestedAt: "2026-07-15T12:00:00.000Z",
  };
  rejectsSync(
    () => processLeadVirtJob("channels.sendMessage", job(untrackedDelivery)),
    /Invalid channels\.sendMessage job data/u,
    "Channel delivery accepted a payload without runtime authorization fields.",
  );
  await rejectsAsync(
    () => processLeadVirtJobWithReliability("channels.sendMessage", job(untrackedDelivery)),
    /channels\.sendMessage job is not backed by RuntimeOutbox/u,
    "Worker reliability accepted an untracked channel delivery.",
  );
  const trackedDelivery = {
    ...untrackedDelivery,
    runtimeEventId: "c222222222222222222222222",
    runtimeGeneration: 1,
  };
  for (const [label, data] of [
    ["extra field", { ...trackedDelivery, injected: true }],
    ["invalid timestamp", { ...trackedDelivery, requestedAt: "today" }],
    ["partial AI fence", { ...trackedDelivery, aiReplyGeneration: 1 }],
  ] as const) {
    rejectsSync(
      () => processLeadVirtJob("channels.sendMessage", job(data)),
      /Invalid channels\.sendMessage job data/u,
      `Channel delivery accepted ${label}.`,
    );
  }

  const extraction = await processLeadVirtJob(
    "ai.extractLeadFields",
    job({
      tenantId: "c123456789012345678901234",
      conversationId: "c987654321098765432109876",
      text: "Please call me tomorrow.",
    }),
  );
  check(
    typeof extraction === "object" && extraction !== null && "fields" in extraction,
    "A valid extraction job did not reach the configured local provider.",
  );

  console.log(`Worker processor contract smoke passed (${checks} checks).`);
}

void main();
