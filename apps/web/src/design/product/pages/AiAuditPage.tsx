"use client";

import React from "react";
import type { AiAuditItem, AiAuditResponse } from "@leadvirt/types";
import { AlertTriangle, Bot, CheckCircle2, Clock3, Database, ShieldCheck, Wrench } from "lucide-react";
import { getAiAudit } from "@/lib/api/ai-audit";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle } from "../shared";
import { useApiResource } from "../useApiResource";
import { cn } from "../../lib/utils";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusClass(status: string) {
  if (status === "SUCCESS" || status === "AUDIT") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (status === "HANDOFF" || status === "BUDGET_BLOCKED") return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  if (status === "FAILED" || status === "ERROR") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}

function jsonPreview(value: unknown) {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "text-emerald-300"
}: {
  icon: typeof Bot;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-white/5", tone)}>
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
  const payload = jsonPreview(item.payload);
  const tools = (item.toolCalls?.length ?? 0) + (item.toolResults?.length ?? 0);
  return (
    <Card hover className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusClass(item.status))}>{item.status}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-400">{item.kind}</span>
            <span className="text-xs text-zinc-500">{formatDate(item.createdAt)}</span>
          </div>
          <h3 className="mt-3 truncate text-base font-semibold text-zinc-100">{item.action}</h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {item.graphRunId && <span>graph: {item.graphRunId}</span>}
            {item.provider && <span>{item.provider}{item.model ? ` / ${item.model}` : ""}</span>}
            {item.conversationId && <span>conversation: {item.conversationSubject || item.conversationId}</span>}
            {item.leadId && <span>lead: {item.leadName || item.leadId}</span>}
            {tools > 0 && <span>tools: {tools}</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs text-zinc-500 lg:min-w-[260px]">
          <div>
            <div className="text-sm font-semibold text-zinc-200">{item.inputTokens ?? 0}</div>
            <div>input</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">{item.outputTokens ?? 0}</div>
            <div>output</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">{item.latencyMs ?? 0}ms</div>
            <div>latency</div>
          </div>
        </div>
      </div>
      {item.errorMessage && <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">{item.errorMessage}</div>}
      {payload && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-emerald-300">Payload</summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-white/5 bg-black/30 p-4 text-xs leading-relaxed text-zinc-300">{payload}</pre>
        </details>
      )}
    </Card>
  );
}

export function AiAuditPage() {
  const loadAudit = React.useCallback(() => getAiAudit(50), []);
  const { data, isLoading, isError } = useApiResource<AiAuditResponse>(loadAudit);
  const summary = data?.summary;
  const items = data?.items ?? [];

  return (
    <ProductLayout title="AI audit" contentClassName="space-y-6">
      <SectionTitle title="AI audit" sub="Runtime decisions, quality gates, tool calls and delivery audit." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Database} label="events" value={summary?.totalEvents ?? 0} />
        <Stat icon={CheckCircle2} label="success" value={summary?.success ?? 0} tone="text-emerald-300" />
        <Stat icon={AlertTriangle} label="handoff / failed" value={`${summary?.handoff ?? 0}/${summary?.failed ?? 0}`} tone="text-amber-300" />
        <Stat icon={Wrench} label="tool records" value={summary?.toolCalls ?? 0} tone="text-sky-300" />
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Tenant-scoped audit</div>
            <div className="text-xs text-zinc-500">Last event: {formatDate(summary?.lastEventAt)}</div>
          </div>
        </div>
      </Card>

      {isLoading && (
        <Card className="flex min-h-[220px] items-center justify-center p-8 text-zinc-400">
          <Clock3 className="mr-2 h-4 w-4 animate-spin" /> Loading audit events
        </Card>
      )}

      {isError && (
        <Card className="p-6 text-rose-200">
          AI audit is unavailable for this workspace role or session.
        </Card>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <Card className="p-8 text-center">
          <Bot className="mx-auto mb-3 h-8 w-8 text-zinc-500" />
          <div className="font-semibold text-zinc-100">No AI audit events yet</div>
          <div className="mt-1 text-sm text-zinc-500">AI replies, quality gates and tool calls will appear here.</div>
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
