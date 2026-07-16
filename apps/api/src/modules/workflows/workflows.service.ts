import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ChannelType, Workflow, WorkflowTestResult } from "@leadvirt/types";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { UpsertWorkflowDto, UpsertWorkflowStepDto } from "./dto/upsert-workflow.dto.js";
import { workflowExecutionIssues, workflowExecutionMessage } from "./workflow-runtime-contract.js";

type WorkflowWithSteps = Prisma.WorkflowGetPayload<{ include: { steps: true } }>;
type WorkflowStepRow = WorkflowWithSteps["steps"][number];

export interface WorkflowRuntimeInput {
  tenantId: string;
  eventType: "message.received" | "workflow.test";
  idempotencyKey?: string;
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

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function runtimeInputHash(input: WorkflowRuntimeInput) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalValue({
          tenantId: input.tenantId,
          eventType: input.eventType,
          conversationId: input.conversationId ?? null,
          leadId: input.leadId ?? null,
          channelType: input.channelType ?? null,
          text: input.text ?? null,
          source: input.source ?? null,
          actorUserId: input.actorUserId ?? null,
          metadata: input.metadata ?? null,
          receivedAt: input.receivedAt ?? null,
        }),
      ),
    )
    .digest("hex");
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

@Injectable()
export class WorkflowsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    context: RequestContext,
    options: { includeArchived?: boolean } = {},
  ): Promise<Workflow[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        tenantId: context.tenantId,
        deletedAt: null,
        ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
      },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return workflows.map((workflow) => this.mapWorkflow(workflow));
  }

  async get(context: RequestContext, id: string): Promise<Workflow> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
    });
    if (!workflow) {
      throw new NotFoundException("Workflow was not found.");
    }
    return this.mapWorkflow(workflow);
  }

  async create(context: RequestContext, dto: UpsertWorkflowDto): Promise<Workflow> {
    const steps = dto.steps?.length
      ? dto.steps
      : ([
          { type: "TRIGGER", name: "New message", positionX: 80, positionY: 120 },
          { type: "END", name: "End", positionX: 320, positionY: 120 },
        ] satisfies UpsertWorkflowStepDto[]);

    if (dto.status === "ACTIVE") {
      this.assertWorkflowExecutable(steps);
    }

    const workflow = await this.prisma.workflow.create({
      data: {
        tenantId: context.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        status: dto.status ?? "DRAFT",
        publishedAt: dto.status === "ACTIVE" ? new Date() : null,
        createdById: context.userId,
        steps: {
          create: steps.map((step, index) => this.stepCreateData(context, step, index)),
        },
      },
    });
    await this.log(context, "workflow.created", workflow.id, { name: workflow.name });
    return this.get(context, workflow.id);
  }

  async update(context: RequestContext, id: string, dto: UpsertWorkflowDto): Promise<Workflow> {
    await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.workflow.findFirst({
          where: { id, tenantId: context.tenantId, deletedAt: null },
          include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
        });
        if (!current) {
          throw new NotFoundException("Workflow was not found.");
        }

        const nextStatus = dto.status ?? current.status;
        if (nextStatus === "ACTIVE") {
          this.assertWorkflowExecutable(dto.steps ?? current.steps);
        }

        const data: Prisma.WorkflowUpdateInput = {
          name: dto.name,
          status: nextStatus,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(nextStatus === "ACTIVE" && !current.publishedAt ? { publishedAt: new Date() } : {}),
        };

        if (dto.steps) {
          data.version = { increment: 1 };
        }

        await tx.workflow.update({ where: { id }, data });
        if (dto.steps) {
          await this.syncSteps(tx, context, id, dto.steps);
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.log(context, "workflow.updated", id, {
      name: dto.name,
      steps: dto.steps?.length ?? undefined,
    });
    return this.get(context, id);
  }

  async publish(context: RequestContext, id: string): Promise<Workflow> {
    await this.prisma.$transaction(
      async (tx) => {
        const workflow = await tx.workflow.findFirst({
          where: { id, tenantId: context.tenantId, deletedAt: null },
          include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
        });
        if (!workflow) {
          throw new NotFoundException("Workflow was not found.");
        }
        this.assertWorkflowExecutable(workflow.steps);
        await tx.workflow.update({
          where: { id },
          data: { status: "ACTIVE", publishedAt: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.log(context, "workflow.published", id, {});
    return this.get(context, id);
  }

  async runForEvent(input: WorkflowRuntimeInput): Promise<WorkflowRuntimeResult[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { tenantId: input.tenantId, status: "ACTIVE", deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    });

    const results: WorkflowRuntimeResult[] = [];
    for (const workflow of workflows) {
      if (!this.workflowMatchesInput(workflow, input)) continue;
      results.push(await this.executeWorkflow(workflow, input));
    }
    return results;
  }

  async test(context: RequestContext, id: string): Promise<WorkflowTestResult> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null },
      include: { steps: { orderBy: [{ positionX: "asc" }, { createdAt: "asc" }] } },
    });
    if (!workflow) {
      throw new NotFoundException("Workflow was not found.");
    }

    const issues = workflowExecutionIssues(workflow.steps);
    const blockedMessage = workflowExecutionMessage(issues);
    if (blockedMessage) {
      await this.log(context, "workflow.test_blocked", id, {
        reason: "unsupported_definition",
        issueCodes: issues.map((issue) => issue.code),
      });
      return {
        runId: null,
        status: "BLOCKED",
        message: blockedMessage,
        events: 0,
      };
    }

    const contextBoundStep = workflow.steps.find(
      (step) => step.type === "HANDOFF" && stepEnabled(step),
    );
    if (contextBoundStep) {
      const message = `Workflow test is blocked because step "${contextBoundStep.name}" requires a real conversation.`;
      await this.log(context, "workflow.test_blocked", id, {
        reason: "conversation_required",
        stepId: contextBoundStep.id,
      });
      return {
        runId: null,
        status: "BLOCKED",
        message,
        events: 0,
      };
    }

    const result = await this.executeWorkflow(workflow, {
      tenantId: context.tenantId,
      eventType: "workflow.test",
      text: "Test inbound customer message",
      source: "automation-test",
      actorUserId: context.userId,
      metadata: { mode: "test" },
    });

    await this.log(context, "workflow.tested", id, {
      runId: result.runId,
      status: result.status,
    });
    return {
      runId: result.runId,
      status: result.status,
      message: result.message,
      events: result.events,
    };
  }

  private workflowMatchesInput(workflow: WorkflowWithSteps, input: WorkflowRuntimeInput) {
    if (input.eventType === "workflow.test") return true;

    const trigger = workflow.steps.find((step) => step.type === "TRIGGER" && stepEnabled(step));
    if (!trigger) return false;

    const config = asRecord(trigger.config);
    const requestedChannel = optionalString(config.channel);
    const key = channelKey(input.channelType);

    if (
      requestedChannel &&
      requestedChannel !== "any" &&
      key &&
      requestedChannel !== key &&
      requestedChannel !== input.channelType
    ) {
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

  private async executeWorkflow(
    workflow: WorkflowWithSteps,
    input: WorkflowRuntimeInput,
  ): Promise<WorkflowRuntimeResult> {
    const startedAt = input.receivedAt ?? new Date();
    const inputHash = runtimeInputHash(input);
    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const lockKey = `workflow:${input.tenantId}:${workflow.id}:${input.idempotencyKey}`;
        await tx.$queryRaw(Prisma.sql`
          SELECT TRUE AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
        `);
        const existing = await tx.workflowRun.findFirst({
          where: {
            tenantId: input.tenantId,
            workflowId: workflow.id,
            idempotencyKey: input.idempotencyKey,
          },
          include: { _count: { select: { events: true } } },
        });
        if (existing) {
          if (existing.inputHash !== inputHash) {
            throw new ConflictException(
              "Workflow event idempotency key was reused with different input.",
            );
          }
          if (existing.status !== "COMPLETED" && existing.status !== "FAILED") {
            throw new Error("Workflow event has an incomplete persisted execution.");
          }
          const status = existing.status;
          return {
            workflowId: workflow.id,
            runId: existing.id,
            status,
            message:
              status === "COMPLETED"
                ? `Workflow "${workflow.name}" already completed.`
                : (existing.errorMessage ?? `Workflow "${workflow.name}" failed.`),
            events: existing._count.events,
          };
        }
      }

      const run = await tx.workflowRun.create({
        data: {
          tenantId: input.tenantId,
          workflowId: workflow.id,
          conversationId: input.conversationId ?? null,
          leadId: input.leadId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          inputHash: input.idempotencyKey ? inputHash : null,
          status: "RUNNING",
          startedAt,
          metadata: this.runtimeMetadata(input),
        },
      });

      let eventCount = 0;
      try {
        const definitionIssues = workflowExecutionIssues(workflow.steps);
        const blockedMessage = workflowExecutionMessage(definitionIssues);
        if (blockedMessage) throw new Error(blockedMessage);

        const lead = input.leadId
          ? await tx.lead.findFirst({
              where: { id: input.leadId, tenantId: input.tenantId, deletedAt: null },
              select: {
                id: true,
                name: true,
                interest: true,
                status: true,
                temperature: true,
                valueAmount: true,
                source: true,
                summary: true,
              },
            })
          : null;

        for (const step of workflow.steps) {
          const result = await this.executeStep(tx, run.id, step, input, lead);
          eventCount += 1;
          if (result.stop) break;
        }

        await this.createRunEvent(
          tx,
          run.id,
          null,
          "workflow.completed",
          `Workflow "${workflow.name}" completed.`,
          { workflowId: workflow.id, stepEvents: eventCount },
        );
        eventCount += 1;

        await tx.workflowRun.update({
          where: { id: run.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        if (input.eventType !== "workflow.test") {
          await this.incrementWorkflowUsage(tx, input.tenantId, startedAt);
        }
        await this.createLeadRuntimeEvent(tx, workflow, input, run.id, eventCount);
        await tx.auditLog.create({
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
              events: eventCount,
            },
          },
        });

        return {
          workflowId: workflow.id,
          runId: run.id,
          status: "COMPLETED" as const,
          message: `Workflow "${workflow.name}" completed with ${eventCount} events.`,
          events: eventCount,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown workflow runtime error";
        await this.createRunEvent(tx, run.id, null, "workflow.failed", message, {
          workflowId: workflow.id,
        });
        await tx.workflowRun.update({
          where: { id: run.id },
          data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId ?? null,
            action: "workflow.runtime_failed",
            entityType: "workflow",
            entityId: workflow.id,
            payload: {
              runId: run.id,
              eventType: input.eventType,
              conversationId: input.conversationId ?? null,
              leadId: input.leadId ?? null,
              error: message,
            },
          },
        });
        return {
          workflowId: workflow.id,
          runId: run.id,
          status: "FAILED" as const,
          message,
          events: eventCount + 1,
        };
      }
    });
  }

  private async executeStep(
    tx: Prisma.TransactionClient,
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
    } | null,
  ) {
    const config = asRecord(step.config);
    const blockType = stepBlockType(step);

    if (!stepEnabled(step)) {
      await this.createRunEvent(tx, runId, step.id, "step.skipped", `${step.name}: шаг выключен.`, {
        stepType: step.type,
        blockType,
        reason: "disabled",
      });
      return { stop: false };
    }

    switch (step.type) {
      case "TRIGGER":
        await this.createRunEvent(tx, runId, step.id, "trigger.matched", step.name, {
          stepType: step.type,
          blockType,
        });
        return { stop: false };
      case "CONDITION": {
        const matched = this.conditionMatches(config, lead);
        await this.createRunEvent(
          tx,
          runId,
          step.id,
          matched ? "condition.matched" : "condition.not_matched",
          step.name,
          { stepType: step.type, blockType, matched },
        );
        return { stop: !matched };
      }
      case "HANDOFF": {
        const conversationId = input.conversationId;
        if (input.eventType === "workflow.test" || !conversationId) {
          throw new Error(`Workflow step "${step.name}" requires a real conversation.`);
        }
        const updated = await tx.conversation.updateMany({
          where: {
            id: conversationId,
            tenantId: input.tenantId,
            deletedAt: null,
          },
          data: { status: "WAITING_FOR_HUMAN", handoffRequested: true },
        });
        if (updated.count !== 1) {
          throw new Error(`Workflow step "${step.name}" could not find its conversation.`);
        }
        await tx.workflowRunEvent.create({
          data: {
            workflowRunId: runId,
            stepId: step.id,
            type: "handoff.completed",
            message: step.name,
            metadata: { stepType: step.type, blockType },
          },
        });
        return { stop: false };
      }
      case "END":
        await this.createRunEvent(tx, runId, step.id, "workflow.end", step.name, {
          stepType: step.type,
          blockType,
        });
        return { stop: true };
      default:
        throw new Error(`Workflow step "${step.name}" is not executable.`);
    }
  }

  private conditionMatches(
    config: Record<string, unknown>,
    lead: { [key: string]: unknown } | null,
  ) {
    const rules = Array.isArray(config.rules) ? config.rules.filter(isRecord) : [];
    if (rules.length === 0) return true;
    if (!lead) return false;

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

  private async createRunEvent(
    tx: Prisma.TransactionClient,
    runId: string,
    stepId: string | null,
    type: string,
    message: string,
    metadata: Prisma.InputJsonObject = {},
  ) {
    await tx.workflowRunEvent.create({
      data: {
        workflowRunId: runId,
        stepId,
        type,
        message,
        metadata,
      },
    });
  }

  private runtimeMetadata(input: WorkflowRuntimeInput): Prisma.InputJsonObject {
    return {
      eventType: input.eventType,
      source: input.source ?? "api",
      idempotencyKey: input.idempotencyKey ?? null,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      channelType: input.channelType ?? null,
      text: input.text ?? null,
      ...(input.metadata ?? {}),
    };
  }

  private async createLeadRuntimeEvent(
    tx: Prisma.TransactionClient,
    workflow: WorkflowWithSteps,
    input: WorkflowRuntimeInput,
    runId: string,
    events: number,
  ) {
    if (!input.leadId || input.eventType === "workflow.test") return;
    await tx.leadEvent.create({
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
          events,
        },
      },
    });
  }

  private async incrementWorkflowUsage(tx: Prisma.TransactionClient, tenantId: string, at: Date) {
    const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    await tx.usageCounter.upsert({
      where: {
        tenantId_periodStart_periodEnd: {
          tenantId,
          periodStart,
          periodEnd,
        },
      },
      create: {
        tenantId,
        periodStart,
        periodEnd,
        workflowRuns: 1,
      },
      update: {
        workflowRuns: { increment: 1 },
      },
    });
  }

  private assertWorkflowExecutable(steps: readonly (WorkflowStepRow | UpsertWorkflowStepDto)[]) {
    const issues = workflowExecutionIssues(
      steps.map((step, index) => ({
        id: step.id ?? `candidate-step-${index}`,
        type: step.type,
        name: step.name,
        config: step.config,
      })),
    );
    const message = workflowExecutionMessage(issues);
    if (!message) return;
    throw new BadRequestException({
      code: "WORKFLOW_NOT_EXECUTABLE",
      message,
      details: { issues },
    });
  }

  private mapWorkflow(workflow: WorkflowWithSteps): Workflow {
    const issues = workflowExecutionIssues(workflow.steps);
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
        config: step.config,
      })),
      execution: {
        executable: issues.length === 0,
        issues,
      },
    };
  }

  private stepCreateData(
    context: RequestContext,
    step: UpsertWorkflowStepDto,
    index: number,
  ): Prisma.WorkflowStepCreateWithoutWorkflowInput {
    return {
      ...(step.id ? { id: step.id } : {}),
      tenantId: context.tenantId,
      type: step.type,
      name: step.name,
      positionX: step.positionX ?? 80 + index * 240,
      positionY: step.positionY ?? 120,
      ...(step.config ? { config: step.config as Prisma.InputJsonObject } : {}),
    };
  }

  private stepUpdateData(
    step: UpsertWorkflowStepDto,
    index: number,
  ): Prisma.WorkflowStepUpdateInput {
    const data: Prisma.WorkflowStepUpdateInput = {
      type: step.type,
      name: step.name,
      positionX: step.positionX ?? 80 + index * 240,
      positionY: step.positionY ?? 120,
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
    steps: UpsertWorkflowStepDto[],
  ) {
    const incomingIds = steps
      .map((step) => step.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    await tx.workflowStep.deleteMany({
      where: {
        tenantId: context.tenantId,
        workflowId,
        ...(incomingIds.length > 0 ? { id: { notIn: incomingIds } } : {}),
      },
    });

    for (const [index, step] of steps.entries()) {
      const existing = step.id
        ? await tx.workflowStep.findFirst({
            where: { id: step.id, tenantId: context.tenantId, workflowId },
            select: { id: true },
          })
        : null;

      if (existing) {
        await tx.workflowStep.update({
          where: { id: existing.id },
          data: this.stepUpdateData(step, index),
        });
        continue;
      }

      await tx.workflowStep.create({
        data: {
          ...this.stepCreateData(context, step, index),
          workflow: { connect: { id: workflowId } },
        },
      });
    }
  }

  private async log(
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "workflow",
        entityId,
        payload,
      },
    });
  }
}
