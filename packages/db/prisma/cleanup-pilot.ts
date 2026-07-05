import { PrismaClient, type Prisma } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const prisma = new PrismaClient();
const confirm = process.argv.includes("--confirm");

function pilotLeadWhere(tenantId: string): Prisma.LeadWhereInput {
  return {
    tenantId,
    OR: [
      { name: { startsWith: "Pilot TG " } },
      { name: { startsWith: "Pilot Webhook " } },
      { name: { startsWith: "Pilot Widget " } },
    ],
  };
}

function idList<T extends { id: string }>(items: T[]) {
  return items.map((item) => item.id);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "demo-company", deletedAt: null },
    select: { id: true, name: true, slug: true },
  });

  if (!tenant) {
    console.log("Demo tenant was not found. Nothing to clean.");
    return;
  }

  const pilotLeads = await prisma.lead.findMany({
    where: pilotLeadWhere(tenant.id),
    select: { id: true, name: true },
  });
  const pilotWorkflows = await prisma.workflow.findMany({
    where: { tenantId: tenant.id, name: { startsWith: "Pilot Intake Workflow " } },
    select: { id: true, name: true },
  });

  const leadIds = idList(pilotLeads);
  const workflowIds = idList(pilotWorkflows);

  const pilotConversations = await prisma.conversation.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        { leadId: { in: leadIds } },
        { externalConversationId: { startsWith: "telegram:pilot-tg-chat-" } },
        { externalConversationId: { startsWith: "webhook:pilot-webhook-conversation-" } },
        { externalConversationId: { startsWith: "pilot-widget-session-" } },
      ],
    },
    select: { id: true },
  });
  const conversationIds = idList(pilotConversations);

  const pilotWorkflowRuns = await prisma.workflowRun.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        { workflowId: { in: workflowIds } },
        { leadId: { in: leadIds } },
        { conversationId: { in: conversationIds } },
      ],
    },
    select: { id: true },
  });
  const workflowRunIds = idList(pilotWorkflowRuns);

  const webhookEvents = await prisma.webhookEvent.findMany({
    where: {
      tenantId: tenant.id,
      externalEventId: { contains: "pilot-" },
    },
    select: { id: true },
  });

  const counts = {
    tenant: tenant.slug,
    leads: leadIds.length,
    conversations: conversationIds.length,
    workflows: workflowIds.length,
    workflowRuns: workflowRunIds.length,
    webhookEvents: webhookEvents.length,
  };

  if (!confirm) {
    console.log("Pilot cleanup dry run:");
    console.log(JSON.stringify(counts, null, 2));
    console.log("Run with --confirm to delete only these prefixed pilot records.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workflowRunEvent.deleteMany({ where: { workflowRunId: { in: workflowRunIds } } });
    await tx.messageAttachment.deleteMany({ where: { message: { conversationId: { in: conversationIds } } } });
    await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.leadEvent.deleteMany({ where: { leadId: { in: leadIds } } });
    await tx.aiUsageLog.deleteMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { leadId: { in: leadIds } },
          { conversationId: { in: conversationIds } },
        ],
      },
    });
    await tx.task.deleteMany({ where: { tenantId: tenant.id, leadId: { in: leadIds } } });
    await tx.booking.deleteMany({ where: { tenantId: tenant.id, leadId: { in: leadIds } } });
    await tx.order.deleteMany({ where: { tenantId: tenant.id, leadId: { in: leadIds } } });
    await tx.workflowRun.deleteMany({ where: { id: { in: workflowRunIds } } });
    await tx.auditLog.deleteMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { entityId: { in: leadIds } },
          { entityId: { in: conversationIds } },
          { entityId: { in: workflowIds } },
        ],
      },
    });
    await tx.webhookEvent.deleteMany({ where: { id: { in: idList(webhookEvents) } } });
    await tx.workflow.deleteMany({ where: { id: { in: workflowIds } } });
    await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await tx.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  console.log("Pilot cleanup completed:");
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
