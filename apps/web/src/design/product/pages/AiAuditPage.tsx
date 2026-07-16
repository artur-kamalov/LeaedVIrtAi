"use client";

import React from "react";
import type { AiAuditItem, AiAuditResponse } from "@leadvirt/types";
import { AlertTriangle, Bot, CheckCircle2, Database, ShieldCheck, Wrench } from "lucide-react";
import { getAiAudit } from "@/lib/api/ai-audit";
import { ApiClientError } from "@/lib/api/client";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle } from "../shared";
import { useApiResource } from "../useApiResource";
import { ResourceErrorState } from "../ResourceErrorState";
import { Skeleton } from "../ui";
import { cn } from "../../lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

function statusClass(status: string) {
  if (status === "SUCCESS" || status === "AUDIT")
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (status === "HANDOFF" || status === "BUDGET_BLOCKED")
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  if (status === "FAILED" || status === "ERROR")
    return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}

function jsonPreview(value: unknown) {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function optionalMetric(
  value: number | null | undefined,
  formatNumber: (value: number) => string,
  suffix = "",
) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)}${suffix}`;
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "text-emerald-300",
}: {
  icon: typeof Bot;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-white/5", tone)}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-zinc-50">{value}</div>
          <div className="text-xs text-zinc-500">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function AuditItemCard({ item }: { item: AiAuditItem }) {
  const { formatDate, formatNumber, t } = useI18n();
  const payload = jsonPreview(item.payload);
  const tools = (item.toolCalls?.length ?? 0) + (item.toolResults?.length ?? 0);
  const createdAt = item.createdAt
    ? formatDate(item.createdAt, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
  return (
    <Card hover className="p-5" data-testid={`ai-audit-item-${item.kind}-${item.id}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold",
                statusClass(item.status),
              )}
            >
              {item.status}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
              {item.kind}
            </span>
            <span className="text-xs text-zinc-500">{createdAt}</span>
          </div>
          <h3 className="mt-3 truncate text-base font-semibold text-zinc-100">{item.action}</h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {item.graphRunId && (
              <span>
                {t("suite.audit.graph")}: {item.graphRunId}
              </span>
            )}
            {item.provider && (
              <span>
                {item.provider}
                {item.model ? ` / ${item.model}` : ""}
              </span>
            )}
            {item.conversationId && (
              <span>
                {t("suite.audit.conversation")}: {item.conversationSubject || item.conversationId}
              </span>
            )}
            {item.leadId && (
              <span>
                {t("suite.audit.lead")}: {item.leadName || item.leadId}
              </span>
            )}
            {tools > 0 && (
              <span>
                {t("suite.audit.tools")}: {formatNumber(tools)}
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs text-zinc-500 lg:min-w-[260px]">
          <div>
            <div className="text-sm font-semibold text-zinc-200">
              {optionalMetric(item.inputTokens, formatNumber)}
            </div>
            <div>{t("suite.audit.input")}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">
              {optionalMetric(item.outputTokens, formatNumber)}
            </div>
            <div>{t("suite.audit.output")}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">
              {optionalMetric(item.latencyMs, formatNumber, "ms")}
            </div>
            <div>{t("suite.audit.latency")}</div>
          </div>
        </div>
      </div>
      {item.errorMessage && (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          {item.errorMessage}
        </div>
      )}
      {payload && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-emerald-300">
            {t("suite.audit.payload")}
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-white/5 bg-black/30 p-4 text-xs leading-relaxed text-zinc-300">
            {payload}
          </pre>
        </details>
      )}
    </Card>
  );
}

export function AiAuditPage() {
  const { formatDate, formatNumber, t } = useI18n();
  const loadAudit = React.useCallback(() => getAiAudit(50), []);
  const auditResource = useApiResource<AiAuditResponse>(loadAudit);
  const data = auditResource.data;
  const accessDenied =
    auditResource.error instanceof ApiClientError &&
    (auditResource.error.status === 401 || auditResource.error.status === 403);

  if (!data) {
    return (
      <ProductLayout title={t("suite.audit.title")} contentClassName="space-y-6">
        <SectionTitle title={t("suite.audit.title")} sub={t("suite.audit.subtitle")} />
        {auditResource.isLoading ? (
          <div className="space-y-4" data-testid="ai-audit-loading">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-24" />
            <Skeleton className="h-52" />
          </div>
        ) : (
          <ResourceErrorState
            testId="ai-audit-load-error"
            description={t("suite.audit.unavailable")}
            onRetry={accessDenied ? undefined : auditResource.reload}
          />
        )}
      </ProductLayout>
    );
  }

  const summary = data.summary;
  const items = data.items;

  return (
    <ProductLayout title={t("suite.audit.title")} contentClassName="space-y-6">
      <SectionTitle title={t("suite.audit.title")} sub={t("suite.audit.subtitle")} />
      {auditResource.isError ? (
        <ResourceErrorState
          testId="ai-audit-refresh-error"
          description={t("suite.audit.unavailable")}
          onRetry={accessDenied ? undefined : auditResource.reload}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Database}
          label={t("suite.audit.events")}
          value={formatNumber(summary.totalEvents)}
        />
        <Stat
          icon={CheckCircle2}
          label={t("suite.audit.success")}
          value={formatNumber(summary.success)}
          tone="text-emerald-300"
        />
        <Stat
          icon={AlertTriangle}
          label={t("suite.audit.handoffFailed")}
          value={`${formatNumber(summary.handoff)}/${formatNumber(summary.failed)}`}
          tone="text-amber-300"
        />
        <Stat
          icon={Wrench}
          label={t("suite.audit.toolRecords")}
          value={formatNumber(summary.toolCalls)}
          tone="text-sky-300"
        />
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              {t("suite.audit.tenantScoped")}
            </div>
            <div className="text-xs text-zinc-500">
              {t("suite.audit.lastEvent", {
                date: summary.lastEventAt
                  ? formatDate(summary.lastEventAt, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-",
              })}
            </div>
          </div>
        </div>
      </Card>

      {items.length === 0 && (
        <Card className="p-8 text-center">
          <Bot className="mx-auto mb-3 h-8 w-8 text-zinc-500" />
          <div className="font-semibold text-zinc-100">{t("suite.audit.empty")}</div>
          <div className="mt-1 text-sm text-zinc-500">{t("suite.audit.emptyDetail")}</div>
        </Card>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <AuditItemCard key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </ProductLayout>
  );
}
