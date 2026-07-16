import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { WorkflowsService } from "../../apps/api/src/modules/workflows/workflows.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { email: `workflow-truth-${suffix}@example.test`, name: "Workflow Truth Owner" },
  });
  const tenant = await prisma.tenant.create({
    data: { name: "Workflow Truth Smoke", slug: `workflow-truth-${suffix}` },
  });

  try {
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const context: RequestContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };
    const service = new WorkflowsService(prisma as never);

    const unsupported = await service.create(context, {
      name: "Unsupported draft",
      status: "DRAFT",
      steps: [
        { type: "TRIGGER", name: "Inbound", config: { enabled: true } },
        { type: "AI_MESSAGE", name: "Pretend AI reply", config: { enabled: true } },
        { type: "END", name: "End", config: { enabled: true } },
      ],
    });
    assert(unsupported.execution?.executable === false, "Unsupported draft was projected as executable.");

    let publishRejected = false;
    try {
      await service.publish(context, unsupported.id);
    } catch (error) {
      publishRejected = error instanceof BadRequestException;
    }
    assert(publishRejected, "Publishing an unsupported workflow did not fail closed.");
    assert(
      (await prisma.workflow.findUniqueOrThrow({ where: { id: unsupported.id } })).status === "DRAFT",
      "Rejected publish changed the workflow status.",
    );

    const blockedTest = await service.test(context, unsupported.id);
    assert(blockedTest.status === "BLOCKED", "Unsupported workflow test was not blocked.");
    assert(blockedTest.runId === null && blockedTest.events === 0, "Blocked test created execution claims.");
    assert(
      (await prisma.workflowRun.count({ where: { workflowId: unsupported.id } })) === 0,
      "Blocked test persisted a workflow run.",
    );

    await prisma.workflow.update({
      where: { id: unsupported.id },
      data: { status: "ACTIVE", publishedAt: new Date() },
    });
    const legacyResults = await service.runForEvent({
      tenantId: tenant.id,
      eventType: "message.received",
      text: "legacy active definition",
      actorUserId: user.id,
    });
    assert(legacyResults.length === 1, "Legacy active workflow did not produce an accountable result.");
    assert(legacyResults[0]?.status === "FAILED", "Legacy unsupported workflow was marked completed.");
    const legacyRun = await prisma.workflowRun.findUniqueOrThrow({
      where: { id: legacyResults[0]?.runId },
      include: { events: true },
    });
    assert(legacyRun.status === "FAILED", "Legacy unsupported run did not persist FAILED.");
    assert(
      legacyRun.events.every((event) => !event.type.includes("prepared") && !event.type.includes("scheduled")),
      "Unsupported runtime emitted a side-effect claim.",
    );
    assert(
      legacyRun.events.length === 1 && legacyRun.events[0]?.type === "workflow.failed",
      "Unsupported runtime emitted step completion events before failing.",
    );
    assert(
      (await prisma.auditLog.count({
        where: {
          tenantId: tenant.id,
          entityId: unsupported.id,
          action: "workflow.runtime_failed",
        },
      })) === 1,
      "Failed runtime was not audited.",
    );
    assert(
      (await prisma.usageCounter.count({ where: { tenantId: tenant.id } })) === 0,
      "Failed workflow changed billable usage.",
    );
    await prisma.workflowStep.update({
      where: { id: unsupported.steps[0]!.id },
      data: { config: { enabled: true, keywordFilter: "legacy" } },
    });
    const unrelatedResults = await service.runForEvent({
      tenantId: tenant.id,
      eventType: "message.received",
      text: "unrelated inbound message",
      actorUserId: user.id,
    });
    assert(unrelatedResults.length === 0, "A blocked workflow ran for an unrelated trigger.");
    assert(
      (await prisma.workflowRun.count({ where: { workflowId: unsupported.id } })) === 1,
      "An unrelated trigger created a failed workflow run.",
    );
    await prisma.workflow.update({ where: { id: unsupported.id }, data: { status: "PAUSED" } });

    const executable = await service.create(context, {
      name: "Real handoff",
      status: "ACTIVE",
      steps: [
        { type: "TRIGGER", name: "Inbound", config: { enabled: true } },
        { type: "HANDOFF", name: "Manager handoff", config: { enabled: true } },
        { type: "END", name: "End", config: { enabled: true } },
      ],
    });
    assert(executable.execution?.executable === true, "Supported workflow was projected as blocked.");
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, status: "OPEN" },
    });
    const liveResults = await service.runForEvent({
      tenantId: tenant.id,
      eventType: "message.received",
      conversationId: conversation.id,
      text: "please connect me",
      actorUserId: user.id,
    });
    assert(liveResults.length === 1 && liveResults[0]?.status === "COMPLETED", "Real handoff did not complete.");
    const updatedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    assert(
      updatedConversation.status === "WAITING_FOR_HUMAN" && updatedConversation.handoffRequested,
      "Completed handoff did not update the conversation.",
    );
    const liveEvents = await prisma.workflowRunEvent.findMany({
      where: { workflowRunId: liveResults[0]?.runId },
      orderBy: { createdAt: "asc" },
    });
    assert(liveEvents.some((event) => event.type === "handoff.completed"), "Handoff completion event is missing.");
    assert(!liveEvents.some((event) => event.type === "handoff.requested"), "Handoff used a non-terminal claim.");

    const contextBoundTest = await service.test(context, executable.id);
    assert(contextBoundTest.status === "BLOCKED", "Context-bound handoff test claimed completion.");
    assert(contextBoundTest.runId === null, "Context-bound blocked test created a run.");

    const evaluation = await service.create(context, {
      name: "Evaluation only",
      status: "DRAFT",
      steps: [
        { type: "TRIGGER", name: "Inbound", config: { enabled: true } },
        { type: "CONDITION", name: "No-op condition", config: { rules: [] } },
        { type: "END", name: "End", config: { enabled: true } },
      ],
    });
    const evaluationTest = await service.test(context, evaluation.id);
    assert(evaluationTest.status === "COMPLETED", "Executable evaluation test did not complete.");
    const usage = await prisma.usageCounter.findFirstOrThrow({ where: { tenantId: tenant.id } });
    assert(usage.workflowRuns === 1, "Workflow tests changed live workflow usage.");

    console.log("Workflow runtime truthfulness smoke passed.");
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
