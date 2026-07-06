import { loadEnvFile } from "@leadvirt/config";
import { AiBudgetExceededError, BudgetedAiProvider, MockAiProvider } from "@leadvirt/ai";
import { prisma } from "@leadvirt/db";
import { createAiBudgetStore } from "../../apps/worker/src/ai/ai-budget-store.js";
import { renderPrometheusMetrics } from "../../apps/worker/src/observability/metrics.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "AI Budget Smoke",
        slug: `ai-budget-smoke-${suffix}`,
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const provider = new BudgetedAiProvider(new MockAiProvider(), createAiBudgetStore(), {
      dailyTokenBudget: 10,
      monthlyTokenBudget: 0
    });

    let blocked = false;
    try {
      await provider.classifyIntent({
        tenantId: tenant.id,
        text: "How much does a full catalog consultation cost tomorrow?"
      });
    } catch (error) {
      blocked = error instanceof AiBudgetExceededError;
    }

    assert(blocked, "Expected AI budget guard to block the request.");

    const usage = await prisma.aiUsageLog.findFirst({
      where: {
        tenantId: tenant.id,
        status: "BUDGET_BLOCKED",
        actionType: "classify_intent"
      }
    });

    assert(usage, "Expected BUDGET_BLOCKED usage log.");
    assert((usage.inputTokens ?? 0) > 0, "Expected input token estimate.");
    assert((usage.outputTokens ?? 0) > 0, "Expected output token reserve.");

    const metrics = renderPrometheusMetrics();
    assert(metrics.includes("leadvirt_ai_budget_blocks_total"), "Expected budget block Prometheus metric.");
    assert(metrics.includes("leadvirt_ai_budget_blocked_tokens_total"), "Expected blocked token Prometheus metric.");

    console.log(JSON.stringify({ ok: true, tenantId: tenant.id, usageLogId: usage.id }));
  } finally {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exitCode = 1;
});
