import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { executeAiToolCalls, type AiToolCall } from "../../apps/worker/src/ai/ai-tools.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function taskCreateCall(id: string, leadId: string, assignedToUserId?: string): AiToolCall {
  return {
    id,
    type: "task.create",
    input: {
      leadId,
      ...(assignedToUserId ? { assignedToUserId } : {}),
      title: "ABAC smoke task",
      priority: "HIGH"
    }
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: "AI Tool ABAC A",
          slug: `ai-tool-abac-a-${suffix}`,
          timezone: "Europe/Moscow"
        }
      }),
      prisma.tenant.create({
        data: {
          name: "AI Tool ABAC B",
          slug: `ai-tool-abac-b-${suffix}`,
          timezone: "Europe/Moscow"
        }
      })
    ]);
    tenantIds.push(tenantA.id, tenantB.id);

    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { email: `ai-tool-abac-a-${suffix}@leadvirt.ai`, name: "AI Tool ABAC A" } }),
      prisma.user.create({ data: { email: `ai-tool-abac-b-${suffix}@leadvirt.ai`, name: "AI Tool ABAC B" } })
    ]);
    userIds.push(userA.id, userB.id);
    await Promise.all([
      prisma.membership.create({ data: { tenantId: tenantA.id, userId: userA.id, role: "OWNER" } }),
      prisma.membership.create({ data: { tenantId: tenantB.id, userId: userB.id, role: "OWNER" } })
    ]);

    const [leadA, leadB] = await Promise.all([
      prisma.lead.create({
        data: {
          tenantId: tenantA.id,
          name: "AI Tool ABAC Lead A",
          status: "NEW",
          temperature: "WARM"
        }
      }),
      prisma.lead.create({
        data: {
          tenantId: tenantB.id,
          name: "AI Tool ABAC Lead B",
          status: "NEW",
          temperature: "WARM"
        }
      })
    ]);

    const [conversationA, conversationB] = await Promise.all([
      prisma.conversation.create({
        data: {
          tenantId: tenantA.id,
          leadId: leadA.id,
          status: "OPEN",
          subject: "ABAC A"
        }
      }),
      prisma.conversation.create({
        data: {
          tenantId: tenantB.id,
          leadId: leadB.id,
          status: "OPEN",
          subject: "ABAC B"
        }
      })
    ]);

    const foreignConversation = await executeAiToolCalls({
      tenantId: tenantA.id,
      graphRunId: `abac-${suffix}`,
      conversationId: conversationB.id,
      calls: [
        {
          id: "note-foreign-conversation",
          type: "lead.note.create",
          input: {
            leadId: leadA.id,
            title: "Should not be created",
            message: "Foreign conversation should block this note."
          }
        }
      ]
    });
    assert(foreignConversation[0]?.status === "SKIPPED", "Expected foreign conversation to skip tool execution.");
    assert(foreignConversation[0]?.reason === "conversation_not_found", "Expected conversation_not_found reason.");
    const leakedEvents = await prisma.leadEvent.count({ where: { tenantId: tenantA.id, leadId: leadA.id, type: "ai_tool_note" } });
    assert(leakedEvents === 0, "Expected no lead event when conversation belongs to another tenant.");

    const foreignAssignee = await executeAiToolCalls({
      tenantId: tenantA.id,
      graphRunId: `abac-${suffix}`,
      conversationId: conversationA.id,
      calls: [taskCreateCall("task-foreign-assignee", leadA.id, userB.id)]
    });
    assert(foreignAssignee[0]?.status === "SKIPPED", "Expected foreign assignee to skip task creation.");
    assert(foreignAssignee[0]?.reason === "assigned_user_not_in_tenant", "Expected assigned_user_not_in_tenant reason.");

    const allowedAssignee = await executeAiToolCalls({
      tenantId: tenantA.id,
      graphRunId: `abac-${suffix}`,
      conversationId: conversationA.id,
      calls: [taskCreateCall("task-allowed-assignee", leadA.id, userA.id)]
    });
    assert(allowedAssignee[0]?.status === "SUCCESS", "Expected same-tenant assignee task to succeed.");

    const task = await prisma.task.findFirst({
      where: {
        tenantId: tenantA.id,
        leadId: leadA.id,
        assignedToUserId: userA.id,
        title: "ABAC smoke task"
      }
    });
    assert(task, "Expected same-tenant task to exist.");

    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenantA.id,
        taskId: task.id
      })
    );
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
