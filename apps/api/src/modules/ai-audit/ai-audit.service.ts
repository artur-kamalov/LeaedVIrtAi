import { Inject, Injectable } from "@nestjs/common";
import { redactSensitiveData } from "@leadvirt/observability";
import type { AiAuditItem, AiAuditResponse, AiAuditSummary } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";

type UsageRow = Prisma.AiUsageLogGetPayload<{
  select: {
    id: true;
    conversationId: true;
    leadId: true;
    provider: true;
    model: true;
    actionType: true;
    inputTokens: true;
    outputTokens: true;
    estimatedCost: true;
    latencyMs: true;
    status: true;
    errorMessage: true;
    metadata: true;
    createdAt: true;
    conversation: { select: { subject: true } };
    lead: { select: { name: true } };
  };
}>;

type AuditRow = Prisma.AuditLogGetPayload<{
  select: {
    id: true;
    action: true;
    entityType: true;
    entityId: true;
    payload: true;
    createdAt: true;
  };
}>;

function boundedLimit(value: string | undefined) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactedRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return redactSensitiveData(value);
}

function arrayValue(value: Record<string, unknown> | null, key: string) {
  const item = value?.[key];
  return Array.isArray(item) ? item : undefined;
}

function stringValue(value: Record<string, unknown> | null, key: string) {
  const item = value?.[key];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function graphRunId(value: Record<string, unknown> | null) {
  return stringValue(value, "graphRunId");
}

@Injectable()
export class AiAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(context: RequestContext, rawLimit?: string): Promise<AiAuditResponse> {
    const limit = boundedLimit(rawLimit);
    const [usageRows, auditRows] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          conversationId: true,
          leadId: true,
          provider: true,
          model: true,
          actionType: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCost: true,
          latencyMs: true,
          status: true,
          errorMessage: true,
          metadata: true,
          createdAt: true,
          conversation: { select: { subject: true } },
          lead: { select: { name: true } }
        }
      }),
      this.prisma.auditLog.findMany({
        where: {
          tenantId: context.tenantId,
          OR: [
            { action: { startsWith: "ai." } },
            { action: "worker.job.dlq" },
            { action: "channel.message.sent" }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          payload: true,
          createdAt: true
        }
      })
    ]);

    const usageItems = usageRows.map((row) => this.mapUsage(row));
    const auditItems = auditRows.map((row) => this.mapAudit(row));
    const items = [...usageItems, ...auditItems]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);

    return {
      summary: this.summary(items),
      items
    };
  }

  private mapUsage(row: UsageRow): AiAuditItem {
    const metadata = redactedRecord(row.metadata);
    return {
      id: row.id,
      kind: "usage",
      createdAt: row.createdAt.toISOString(),
      action: row.actionType,
      status: row.status,
      provider: row.provider,
      model: row.model,
      conversationId: row.conversationId,
      conversationSubject: row.conversation?.subject ?? null,
      leadId: row.leadId,
      leadName: row.lead?.name ?? null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCost: row.estimatedCost?.toString() ?? null,
      latencyMs: row.latencyMs,
      errorMessage: row.errorMessage,
      graphRunId: graphRunId(metadata) ?? null,
      quality: metadata?.quality,
      toolCalls: arrayValue(metadata, "toolCalls"),
      toolResults: arrayValue(metadata, "toolResults"),
      retrievedContext: arrayValue(metadata, "retrievedContext"),
      payload: metadata
    };
  }

  private mapAudit(row: AuditRow): AiAuditItem {
    const payload = redactedRecord(row.payload);
    return {
      id: row.id,
      kind: "audit",
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      status: row.action.includes("dlq") ? "FAILED" : "AUDIT",
      entityType: row.entityType,
      entityId: row.entityId,
      conversationId: stringValue(payload, "conversationId") ?? null,
      leadId: stringValue(payload, "leadId") ?? null,
      graphRunId: graphRunId(payload) ?? null,
      quality: payload?.quality,
      toolCalls: arrayValue(payload, "toolCalls"),
      toolResults: arrayValue(payload, "toolResults"),
      retrievedContext: arrayValue(payload, "retrievedContext"),
      payload
    };
  }

  private summary(items: AiAuditItem[]): AiAuditSummary {
    const summary: AiAuditSummary = {
      totalEvents: items.length,
      usageLogs: 0,
      auditLogs: 0,
      success: 0,
      handoff: 0,
      failed: 0,
      budgetBlocked: 0,
      toolCalls: 0,
      lastEventAt: items[0]?.createdAt ?? null
    };

    for (const item of items) {
      if (item.kind === "usage") summary.usageLogs += 1;
      if (item.kind === "audit") summary.auditLogs += 1;
      if (item.status === "SUCCESS") summary.success += 1;
      if (item.status === "HANDOFF") summary.handoff += 1;
      if (item.status === "FAILED" || item.status === "ERROR") summary.failed += 1;
      if (item.status === "BUDGET_BLOCKED") summary.budgetBlocked += 1;
      summary.toolCalls += item.toolCalls?.length ?? 0;
    }

    return summary;
  }
}
