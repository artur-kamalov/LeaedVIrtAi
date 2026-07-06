import type { AiBudgetBlockedRecord, AiBudgetStore } from "@leadvirt/ai";
import { prisma, type Prisma } from "@leadvirt/db";
import { recordAiBudgetBlocked } from "../observability/metrics.js";

export function createAiBudgetStore(): AiBudgetStore {
  return {
    async usedTokensSince(tenantId: string, since: Date) {
      const usage = await prisma.aiUsageLog.aggregate({
        where: {
          tenantId,
          createdAt: { gte: since },
          status: { not: "BUDGET_BLOCKED" }
        },
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      });

      return (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0);
    },

    async recordBlocked(record: AiBudgetBlockedRecord) {
      recordAiBudgetBlocked({
        budgetType: record.budgetType,
        actionType: record.actionType,
        provider: record.provider,
        model: record.model,
        requestedTokens: record.requestedTokens
      });

      const metadata: Prisma.InputJsonObject = {
        budgetType: record.budgetType,
        limitTokens: record.limitTokens,
        usedTokens: record.usedTokens,
        requestedTokens: record.requestedTokens
      };

      await prisma.aiUsageLog.create({
        data: {
          tenantId: record.tenantId,
          conversationId: record.conversationId ?? null,
          provider: record.provider,
          model: record.model,
          actionType: record.actionType,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          estimatedCost: "0.000000",
          status: "BUDGET_BLOCKED",
          errorMessage: `AI ${record.budgetType} token budget exceeded.`,
          metadata
        }
      });
    }
  };
}
