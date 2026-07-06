import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { AiAuditService } from "../../apps/api/src/modules/ai-audit/ai-audit.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFor(tenant: { id: string; name: string; slug: string; status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED"; businessType: string | null; timezone: string }, userId: string): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `ai-audit-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "AI Audit Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const service = new AiAuditService(prisma as unknown as PrismaService);

  try {
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: "AI Audit A",
          slug: `ai-audit-a-${suffix}`,
          timezone: "Europe/Moscow"
        }
      }),
      prisma.tenant.create({
        data: {
          name: "AI Audit B",
          slug: `ai-audit-b-${suffix}`,
          timezone: "Europe/Moscow"
        }
      })
    ]);
    tenantIds.push(tenantA.id, tenantB.id);

    const user = await prisma.user.create({
      data: {
        email: `ai-audit-${suffix}@leadvirt.ai`,
        name: "AI Audit Smoke"
      }
    });
    userIds.push(user.id);

    const [leadA, conversationA] = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          tenantId: tenantA.id,
          name: "AI Audit Lead A",
          status: "NEW",
          temperature: "WARM"
        }
      });
      const conversation = await tx.conversation.create({
        data: {
          tenantId: tenantA.id,
          leadId: lead.id,
          status: "OPEN",
          subject: "AI audit smoke"
        }
      });
      return [lead, conversation];
    });

    await Promise.all([
      prisma.aiUsageLog.create({
        data: {
          tenantId: tenantA.id,
          conversationId: conversationA.id,
          leadId: leadA.id,
          provider: "mock",
          model: "mock-v1",
          actionType: "langgraph_queued_reply",
          inputTokens: 12,
          outputTokens: 20,
          estimatedCost: "0.000000",
          latencyMs: 35,
          status: "SUCCESS",
          metadata: {
            graphRunId: `graph-${suffix}`,
            quality: { passed: true },
            toolCalls: [{ type: "lead.note.create", input: { phone: "+7 999 123-45-67", email: "lead@example.com" } }],
            toolResults: [{ status: "SUCCESS" }],
            retrievedContext: [{ chunkId: "chunk_a" }]
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenantA.id,
          action: "ai.langgraph_reply.processed",
          entityType: "conversation",
          entityId: conversationA.id,
          payload: {
            graphRunId: `graph-${suffix}`,
            webhookSecret: "secret-should-not-leak",
            customer: { email: "customer@example.com", phone: "+7 900 111-22-33" },
            toolCalls: [{ type: "task.create", input: { assignedToUserId: user.id } }]
          }
        }
      }),
      prisma.aiUsageLog.create({
        data: {
          tenantId: tenantB.id,
          provider: "mock",
          model: "mock-v1",
          actionType: "foreign_marker_should_not_return",
          inputTokens: 1,
          outputTokens: 1,
          estimatedCost: "0.000000",
          status: "SUCCESS"
        }
      })
    ]);

    const result = await service.list(contextFor(tenantA, user.id), "20");
    const payload = JSON.stringify(result);
    assert(result.summary.totalEvents >= 2, "Expected AI audit events for tenant A.");
    assert(result.items.some((item) => item.action === "langgraph_queued_reply"), "Expected usage event.");
    assert(result.items.some((item) => item.action === "ai.langgraph_reply.processed"), "Expected audit event.");
    assert(!payload.includes("foreign_marker_should_not_return"), "Expected tenant B audit data to be excluded.");
    assert(!payload.includes("lead@example.com"), "Expected metadata email redaction.");
    assert(!payload.includes("+7 999 123-45-67"), "Expected metadata phone redaction.");
    assert(!payload.includes("secret-should-not-leak"), "Expected secret redaction.");
    assert(!payload.includes("customer@example.com"), "Expected audit payload email redaction.");

    console.log(JSON.stringify({ ok: true, totalEvents: result.summary.totalEvents }));
  } finally {
    if (tenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
