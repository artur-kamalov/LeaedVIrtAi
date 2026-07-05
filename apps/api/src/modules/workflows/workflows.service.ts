import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ChannelType, Workflow } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { UpsertWorkflowDto, UpsertWorkflowStepDto } from "./dto/upsert-workflow.dto.js";

type WorkflowWithSteps = Prisma.WorkflowGetPayload<{ include: { steps: true } }>;
type WorkflowStepRow = WorkflowWithSteps["steps"][number];

export interface WorkflowRuntimeInput {
  tenantId: string;
  eventType: "message.received" | "workflow.test";
  conversationId?: string | null;
  leadId?: string | null;
  channelType?: ChannelType | null;
  text?: string | null;
  source?: string;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonObject;
  receivedAt?: Date;
}

export interface WorkflowRuntimeResult {
  workflowId: string;
  runId: string;
  status: "COMPLETED" | "FAILED";
  message: string;
  events: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function channelKey(channelType?: ChannelType | null) {
  switch (channelType) {
    case "TELEGRAM":
      return "telegram";
    case "WHATSAPP":
      return "whatsapp";
    case "INSTAGRAM":
      return "instagram";
    case "WEBSITE":
    case "WEBHOOK":
    case "EMAIL":
    case "DEMO":
      return "web";
    default:
      return null;
  }
}

function stepBlockType(step: WorkflowStepRow) {
  const config = asRecord(step.config);
  return optionalString(config.blockType) ?? step.type.toLowerCase();
}

function stepEnabled(step: WorkflowStepRow) {
  const config = asRecord(step.config);
  return config.enabled !== false;
}

function interpolateTemplate(template: string, lead: { name: string | null; interest: string | null } | null) {
  const name = lead?.name?.trim() || "клиент";
  const interest = lead?.interest?.trim() || "ваш запрос";
  return template
    .replaceAll("{{имя}}", name)
    .replaceAll("{{name}}", name)
    .replaceAll("{{интерес}}", interest)
    .replaceAll("{{request}}", interest);
}

@Injectable()
export class WorkflowsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(context: RequestContext, options: { includeArchived?: boolean } = {}): Promise<Workflow[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        tenantId: context.tenantId,
        deletedAt: null,
        ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" } })
      },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
    return workflows.map((workflow) => this.mapWorkflow(workflow));
  }

  async get(context: RequestContext, id: string): Promise<Workflow> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } }
    });
    if (!workflow) {
      throw new NotFoundException("Workflow was not found.");
    }
    return this.mapWorkflow(workflow);
  }

  async create(context: RequestContext, dto: UpsertWorkflowDto): Promise<Workflow> {
    const steps = dto.steps?.length
      ? dto.steps
      : [
          { type: "TRIGGER", name: "New message", positionX: 80, positionY: 120 },
          { type: "AI_MESSAGE", name: "AI response", positionX: 320, positionY: 120 },
          { type: "END", name: "End", positionX: 560, positionY: 120 }
        ] satisfies UpsertWorkflowStepDto[];

    const workflow = await this.prisma.workflow.create({
      data: {
        tenantId: context.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        status: dto.status ?? "DRAFT",
        createdById: context.userId,
        steps: {
          create: steps.map((step, index) => this.stepCreateData(context, step, index))
        }
      }
    });
    await this.log(context, "workflow.created", workflow.id, { name: workflow.name });
    return this.get(context, workflow.id);
  }

  async update(context: RequestContext, id: string, dto: UpsertWorkflowDto): Promise<Workflow> {
    await this.ensureWorkflow(context.tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.WorkflowUpdateInput = {
        name: dto.name,
        description: dto.description ?? null,
        status: dto.status ?? "DRAFT"
      };

      if (dto.steps) {
        data.version = { increment: 1 };
      }

      await tx.workflow.update({
        where: { id },
        data
      });

      if (dto.steps) {
        await this.syncSteps(tx, context, id, dto.steps);
      }
    });
    await this.log(context, "workflow.updated", id, { name: dto.name, steps: dto.steps?.length ?? undefined });
    return this.get(context, id);
  }

  async publish(context: RequestContext, id: string): Promise<Workflow> {
    await this.ensureWorkflow(context.tenantId, id);
    await this.prisma.workflow.update({
      where: { id },
      data: { status: "ACTIVE", publishedAt: new Date() }
    });
    await this.log(context, "workflow.published", id, {});
    return this.get(context, id);
  }

  async runForEvent(input: WorkflowRuntimeInput): Promise<WorkflowRuntimeResult[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { tenantId: input.tenantId, status: "ACTIVE", deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }]
    });

    const results: WorkflowRuntimeResult[] = [];
    for (const workflow of workflows) {
      if (this.workflowMatchesInput(workflow, input)) {
        results.push(await this.executeWorkflow(workflow, input));
      }
    }
    return results;
  }

  async test(context: RequestContext, id: string) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } }
    });
    if (!workflow) {
      throw new NotFoundException("Сценарий не найден.");
    }

    const result = await this.executeWorkflow(workflow, {
      tenantId: context.tenantId,
      eventType: "workflow.test",
      text: "Тестовое входящее сообщение клиента",
      source: "automation-test",
      actorUserId: context.userId,
      metadata: { mode: "test" }
    });

    await this.log(context, "workflow.tested", id, { runId: result.runId });
    return {
      runId: result.runId,
      status: result.status,
      message: result.message,
      events: result.events
    };
  }

  private workflowMatchesInput(workflow: WorkflowWithSteps, input: WorkflowRuntimeInput) {
    if (input.eventType === "workflow.test") return true;

    const trigger = workflow.steps.find((step) => step.type === "TRIGGER" && stepEnabled(step));
    if (!trigger) return true;

    const config = asRecord(trigger.config);
    const requestedChannel = optionalString(config.channel);
    const key = channelKey(input.channelType);

    if (requestedChannel && requestedChannel !== "any" && key && requestedChannel !== key && requestedChannel !== input.channelType) {
      return false;
    }

    const channels = asRecord(config.channels);
    if (key && typeof channels[key] === "boolean" && channels[key] === false) {
      return false;
    }

    const keyword = optionalString(config.keywordFilter);
    if (keyword) {
      const text = (input.text ?? "").toLowerCase();
      if (!text.includes(keyword.toLowerCase())) {
        return false;
      }
    }

    return true;
  }

  private async executeWorkflow(workflow: WorkflowWithSteps, input: WorkflowRuntimeInput): Promise<WorkflowRuntimeResult> {
    const startedAt = input.receivedAt ?? new Date();
    const run = await this.prisma.workflowRun.create({
      data: {
        tenantId: input.tenantId,
        workflowId: workflow.id,
        conversationId: input.conversationId ?? null,
        leadId: input.leadId ?? null,
        status: "RUNNING",
        startedAt,
        metadata: this.runtimeMetadata(input)
      }
    });

    let eventCount = 0;
    const lead = input.leadId
      ? await this.prisma.lead.findFirst({
          where: { id: input.leadId, tenantId: input.tenantId, deletedAt: null },
          select: {
            id: true,
            name: true,
            interest: true,
            status: true,
            temperature: true,
            valueAmount: true,
            source: true,
            summary: true
          }
        })
      : null;

    try {
      for (const step of workflow.steps) {
        const result = await this.executeStep(run.id, step, input, lead);
        eventCount += 1;
        if (result.stop) break;
      }

      await this.createRunEvent(run.id, null, "workflow.completed", `Сценарий "${workflow.name}" выполнен.`, {
        workflowId: workflow.id,
        stepEvents: eventCount
      });
      eventCount += 1;

      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date()
        }
      });
      await this.incrementWorkflowUsage(input.tenantId, startedAt);
      await this.createLeadRuntimeEvent(workflow, input, run.id, eventCount);
      await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId ?? null,
          action: "workflow.runtime_completed",
          entityType: "workflow",
          entityId: workflow.id,
          payload: {
            runId: run.id,
            eventType: input.eventType,
            conversationId: input.conversationId ?? null,
            leadId: input.leadId ?? null,
            events: eventCount
          }
        }
      });

      return {
        workflowId: workflow.id,
        runId: run.id,
        status: "COMPLETED",
        message: `Сценарий "${workflow.name}" выполнен: ${eventCount} событий.`,
        events: eventCount
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workflow runtime error";
      await this.createRunEvent(run.id, null, "workflow.failed", message, { workflowId: workflow.id });
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date()
        }
      });
      return {
        workflowId: workflow.id,
        runId: run.id,
        status: "FAILED",
        message,
        events: eventCount + 1
      };
    }
  }

  private async executeStep(
    runId: string,
    step: WorkflowStepRow,
    input: WorkflowRuntimeInput,
    lead: {
      id: string;
      name: string | null;
      interest: string | null;
      status: string;
      temperature: string;
      valueAmount: number | null;
      source: string | null;
      summary: string | null;
    } | null
  ) {
    const config = asRecord(step.config);
    const blockType = stepBlockType(step);

    if (!stepEnabled(step)) {
      await this.createRunEvent(runId, step.id, "step.skipped", `${step.name}: шаг выключен.`, {
        stepType: step.type,
        blockType,
        reason: "disabled"
      });
      return { stop: false };
    }

    if (step.type === "CONDITION") {
      const matched = this.conditionMatches(config, lead);
      await this.createRunEvent(runId, step.id, matched ? "condition.matched" : "condition.skipped", step.name, {
        stepType: step.type,
        blockType,
        matched
      });
      return { stop: !matched };
    }

    if (step.type === "HANDOFF" && input.conversationId && input.eventType !== "workflow.test") {
      await this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { status: "WAITING_FOR_HUMAN", handoffRequested: true }
      });
    }

    const message = this.stepRuntimeMessage(step, config, lead);
    await this.createRunEvent(runId, step.id, this.stepRuntimeEventType(step), message, {
      stepType: step.type,
      blockType
    });
    return { stop: false };
  }

  private conditionMatches(config: Record<string, unknown>, lead: { [key: string]: unknown } | null) {
    const rules = Array.isArray(config.rules) ? config.rules.filter(isRecord) : [];
    if (rules.length === 0 || !lead) return true;

    return rules.every((rule) => {
      const field = optionalString(rule.field)?.toLowerCase();
      const op = optionalString(rule.op) ?? "eq";
      const expected = optionalString(rule.value) ?? "";
      const actual = this.conditionFieldValue(field, lead);

      if (op === "contains") return actual.toLowerCase().includes(expected.toLowerCase());
      if (op === "gt") return Number(actual) > Number(expected);
      if (op === "lt") return Number(actual) < Number(expected);
      return actual.toLowerCase() === expected.toLowerCase();
    });
  }

  private conditionFieldValue(field: string | undefined, lead: { [key: string]: unknown }) {
    switch (field) {
      case "budget":
      case "value":
      case "сумма":
      case "бюджет":
        return this.conditionValueToString(lead.valueAmount ?? 0);
      case "status":
      case "статус":
        return this.conditionValueToString(lead.status);
      case "temperature":
      case "интерес":
        return this.conditionValueToString(lead.temperature ?? lead.interest);
      case "source":
      case "источник":
        return this.conditionValueToString(lead.source);
      default:
        return this.conditionValueToString(lead.interest ?? lead.summary ?? lead.name);
    }
  }

  private conditionValueToString(value: unknown) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  }

  private stepRuntimeEventType(step: WorkflowStepRow) {
    switch (step.type) {
      case "TRIGGER":
        return "trigger.matched";
      case "AI_MESSAGE":
        return "ai_message.prepared";
      case "QUESTION":
        return "qualification.prepared";
      case "ACTION":
        return "action.prepared";
      case "DELAY":
        return "followup.scheduled";
      case "HANDOFF":
        return "handoff.requested";
      case "END":
        return "workflow.end";
      default:
        return "step.completed";
    }
  }

  private stepRuntimeMessage(step: WorkflowStepRow, config: Record<string, unknown>, lead: { name: string | null; interest: string | null } | null) {
    if (step.type === "AI_MESSAGE") {
      const template = optionalString(config.greetingText) ?? step.name;
      return interpolateTemplate(template, lead);
    }
    if (step.type === "QUESTION") {
      const questions = Array.isArray(config.questions)
        ? config.questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      return questions.length > 0 ? questions.join(" / ") : step.name;
    }
    if (step.type === "DELAY") {
      const hours = optionalString(config.followupDelayHours) ?? "24";
      return `Follow-up scheduled in ${hours}h`;
    }
    if (step.type === "ACTION") {
      return optionalString(config.action) ?? optionalString(config.blockType) ?? step.name;
    }
    return step.name;
  }

  private async createRunEvent(
    runId: string,
    stepId: string | null,
    type: string,
    message: string,
    metadata: Prisma.InputJsonObject = {}
  ) {
    await this.prisma.workflowRunEvent.create({
      data: {
        workflowRunId: runId,
        stepId,
        type,
        message,
        metadata
      }
    });
  }

  private runtimeMetadata(input: WorkflowRuntimeInput): Prisma.InputJsonObject {
    return {
      eventType: input.eventType,
      source: input.source ?? "api",
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      channelType: input.channelType ?? null,
      text: input.text ?? null,
      ...(input.metadata ?? {})
    };
  }

  private async createLeadRuntimeEvent(workflow: WorkflowWithSteps, input: WorkflowRuntimeInput, runId: string, events: number) {
    if (!input.leadId || input.eventType === "workflow.test") return;
    await this.prisma.leadEvent.create({
      data: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        type: "workflow_run_completed",
        title: "Сценарий автоматизации выполнен",
        message: workflow.name,
        metadata: {
          workflowId: workflow.id,
          runId,
          eventType: input.eventType,
          events
        }
      }
    });
  }

  private async incrementWorkflowUsage(tenantId: string, at: Date) {
    const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    await this.prisma.usageCounter.upsert({
      where: {
        tenantId_periodStart_periodEnd: {
          tenantId,
          periodStart,
          periodEnd
        }
      },
      create: {
        tenantId,
        periodStart,
        periodEnd,
        workflowRuns: 1
      },
      update: {
        workflowRuns: { increment: 1 }
      }
    });
  }

  private async ensureWorkflow(tenantId: string, id: string) {
    const workflow = await this.prisma.workflow.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    if (!workflow) {
      throw new NotFoundException("Сценарий не найден.");
    }
    return workflow;
  }

  private mapWorkflow(workflow: WorkflowWithSteps): Workflow {
    return {
      id: workflow.id,
      tenantId: workflow.tenantId,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      version: workflow.version,
      publishedAt: workflow.publishedAt?.toISOString() ?? null,
      steps: workflow.steps.map((step) => ({
        id: step.id,
        workflowId: step.workflowId,
        type: step.type,
        name: step.name,
        positionX: step.positionX,
        positionY: step.positionY,
        config: step.config
      }))
    };
  }

  private stepCreateData(context: RequestContext, step: UpsertWorkflowStepDto, index: number): Prisma.WorkflowStepCreateWithoutWorkflowInput {
    return {
      ...(step.id ? { id: step.id } : {}),
      tenantId: context.tenantId,
      type: step.type,
      name: step.name,
      positionX: step.positionX ?? 80 + index * 240,
      positionY: step.positionY ?? 120,
      ...(step.config ? { config: step.config as Prisma.InputJsonObject } : {})
    };
  }

  private stepUpdateData(step: UpsertWorkflowStepDto, index: number): Prisma.WorkflowStepUpdateInput {
    const data: Prisma.WorkflowStepUpdateInput = {
      type: step.type,
      name: step.name,
      positionX: step.positionX ?? 80 + index * 240,
      positionY: step.positionY ?? 120
    };

    if (step.config) {
      data.config = step.config as Prisma.InputJsonObject;
    }

    return data;
  }

  private async syncSteps(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    workflowId: string,
    steps: UpsertWorkflowStepDto[]
  ) {
    const incomingIds = steps.map((step) => step.id).filter((id): id is string => typeof id === "string" && id.length > 0);

    await tx.workflowStep.deleteMany({
      where: {
        tenantId: context.tenantId,
        workflowId,
        ...(incomingIds.length > 0 ? { id: { notIn: incomingIds } } : {})
      }
    });

    for (const [index, step] of steps.entries()) {
      const existing = step.id
        ? await tx.workflowStep.findFirst({ where: { id: step.id, tenantId: context.tenantId, workflowId }, select: { id: true } })
        : null;

      if (existing) {
        await tx.workflowStep.update({
          where: { id: existing.id },
          data: this.stepUpdateData(step, index)
        });
        continue;
      }

      await tx.workflowStep.create({
        data: {
          ...this.stepCreateData(context, step, index),
          workflow: { connect: { id: workflowId } }
        }
      });
    }
  }

  private async log(context: RequestContext, action: string, entityId: string, payload: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "workflow",
        entityId,
        payload
      }
    });
  }
}
