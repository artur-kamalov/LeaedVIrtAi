import { PrismaClient, type Prisma } from "@prisma/client";
import { parseArgs } from "node:util";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

const prisma = new PrismaClient();
const { values: options } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  options: {
    confirm: { type: "boolean", default: false },
    "tenant-id": { type: "string" },
    "tenant-slug": { type: "string" },
  },
  strict: true,
});

function tenantSelector() {
  const tenantId = options["tenant-id"]?.trim();
  const tenantSlug = options["tenant-slug"]?.trim();
  if (tenantId && tenantSlug) throw new Error("Use either --tenant-id or --tenant-slug, not both.");
  if (tenantId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(tenantId)) {
    throw new Error("--tenant-id is invalid.");
  }
  if (tenantSlug && !/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$|^[a-z0-9]$/u.test(tenantSlug)) {
    throw new Error("--tenant-slug is invalid.");
  }
  return tenantId ? { id: tenantId } : { slug: tenantSlug || "demo-company" };
}

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
    where: { ...tenantSelector(), deletedAt: null },
    select: { id: true, name: true, slug: true },
  });

  if (!tenant) {
    console.log("Selected tenant was not found. Nothing to clean.");
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
    tenantId: tenant.id,
    tenant: tenant.slug,
    leads: leadIds.length,
    conversations: conversationIds.length,
    workflows: workflowIds.length,
    workflowRuns: workflowRunIds.length,
    webhookEvents: webhookEvents.length,
  };

  if (!options.confirm) {
    console.log("Pilot cleanup dry run:");
    console.log(JSON.stringify(counts, null, 2));
    console.log("Run with the same tenant selector plus --confirm to delete only these records.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workflowRunEvent.deleteMany({ where: { workflowRunId: { in: workflowRunIds } } });
    await tx.messageAttachment.deleteMany({
      where: { message: { conversationId: { in: conversationIds } } },
    });
    await tx.channelDeliveryOperation.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await tx.externalOperation.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.aiReplyRun.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.leadEvent.deleteMany({ where: { leadId: { in: leadIds } } });
    await tx.aiUsageLog.deleteMany({
      where: {
        tenantId: tenant.id,
        OR: [{ leadId: { in: leadIds } }, { conversationId: { in: conversationIds } }],
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
