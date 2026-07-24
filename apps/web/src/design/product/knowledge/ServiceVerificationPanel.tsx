"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { KnowledgeV2FactView, KnowledgeV2JsonValue } from "@leadvirt/types";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiClientError } from "@/lib/api/client";
import {
  bulkVerifyKnowledgeV2Facts,
  createKnowledgeV2IdempotencyKey,
  listKnowledgeV2Facts,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { LoadingOverlay, Modal, StatusBadge } from "../ui";
import { findKnowledgeDataElement } from "./knowledge-dom";

const PAGE_SIZE = 20;
const BULK_LIMIT = 200;

function objectValue(value: KnowledgeV2JsonValue): Record<string, KnowledgeV2JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function textValue(value: KnowledgeV2JsonValue | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function serviceName(fact: KnowledgeV2FactView) {
  const normalized = objectValue(fact.normalizedValue);
  return textValue(normalized?.name) || fact.displayValue?.trim() || fact.factKey;
}

function servicePrice(fact: KnowledgeV2FactView, unknownLabel: string) {
  const normalized = objectValue(fact.normalizedValue);
  const prices = normalized?.prices;
  if (!Array.isArray(prices) || prices.length === 0) return unknownLabel;

  const price = objectValue(prices[0]);
  if (!price) return unknownLabel;
  const amount = textValue(price.amount);
  const amountFrom = textValue(price.amountFrom);
  const amountTo = textValue(price.amountTo);
  const currency = textValue(price.currency) || fact.currency?.trim() || "";
  const unit = textValue(price.unit) || fact.unit?.trim() || "";
  const suffix = [currency, unit ? `/ ${unit}` : ""].filter(Boolean).join(" ");

  if (amount) return [amount, suffix].filter(Boolean).join(" ");
  if (amountFrom && amountTo)
    return [`${amountFrom}-${amountTo}`, suffix].filter(Boolean).join(" ");
  if (amountFrom) return [`${amountFrom}+`, suffix].filter(Boolean).join(" ");
  if (amountTo) return [`<= ${amountTo}`, suffix].filter(Boolean).join(" ");
  return unknownLabel;
}

export function ServiceVerificationPanel({
  blockingFactIds,
  canVerify,
  onChanged,
}: {
  blockingFactIds: string[];
  canVerify: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const focusFactId = searchParams.get("factId");
  const task = searchParams.get("task");
  const [facts, setFacts] = React.useState<KnowledgeV2FactView[]>([]);
  const [loading, setLoading] = React.useState(blockingFactIds.length > 0);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const requestSequence = React.useRef(0);
  const panelRef = React.useRef<HTMLElement>(null);

  const blockerKey = React.useMemo(
    () => [...new Set(blockingFactIds)].sort().join(","),
    [blockingFactIds],
  );

  const load = React.useCallback(async () => {
    const expectedIds = new Set(blockerKey ? blockerKey.split(",") : []);
    if (expectedIds.size === 0) {
      setFacts([]);
      setLoading(false);
      setError(null);
      return;
    }

    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = new Map<string, KnowledgeV2FactView>();
      let cursor: string | undefined;
      do {
        const result = await listKnowledgeV2Facts({
          cursor,
          limit: 100,
          entityType: "BUSINESS_OFFERING",
        });
        for (const fact of result.items) {
          if (expectedIds.has(fact.id)) found.set(fact.id, fact);
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
      } while (cursor && found.size < expectedIds.size);

      if (sequence !== requestSequence.current) return;
      setFacts(
        [...found.values()].sort((left, right) =>
          serviceName(left).localeCompare(serviceName(right)),
        ),
      );
    } catch {
      if (sequence !== requestSequence.current) return;
      setError(t("knowledge.ux.verification.error"));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [blockerKey, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filteredFacts = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return facts;
    return facts.filter((fact) => serviceName(fact).toLocaleLowerCase().includes(query));
  }, [facts, search]);

  const pageCount = Math.max(1, Math.ceil(filteredFacts.length / PAGE_SIZE));
  const visibleFacts = React.useMemo(
    () => filteredFacts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredFacts, page],
  );

  React.useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  React.useEffect(() => {
    if (!focusFactId || task !== "verify-services" || loading) return;
    const index = filteredFacts.findIndex((fact) => fact.id === focusFactId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      findKnowledgeDataElement("data-verification-fact-id", focusFactId)?.focus();
    });
  }, [filteredFacts, focusFactId, loading, task]);

  async function verifyAll() {
    const eligible = facts
      .filter((fact) => fact.allowedActions.includes("VERIFY"))
      .slice(0, BULK_LIMIT);
    if (!canVerify || eligible.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await bulkVerifyKnowledgeV2Facts(
        { items: eligible.map((fact) => ({ id: fact.id, etag: fact.etag })) },
        { "Idempotency-Key": createKnowledgeV2IdempotencyKey() },
      );
      setConfirmOpen(false);
      setFacts((current) =>
        current.filter((fact) => !eligible.some((item) => item.id === fact.id)),
      );
      onChanged();
    } catch (caught) {
      setConfirmOpen(false);
      setError(t("knowledge.ux.verification.error"));
      if (caught instanceof ApiClientError && caught.status === 412) await load();
    } finally {
      setSaving(false);
    }
  }

  const blockingCount = blockingFactIds.length;
  const verifiableCount = Math.min(
    facts.filter((fact) => fact.allowedActions.includes("VERIFY")).length,
    BULK_LIMIT,
  );

  return (
    <section
      ref={panelRef}
      className="scroll-mt-24 border-y border-white/10 bg-zinc-950/30 px-4 py-5 sm:px-5"
      data-testid="knowledge-service-verification"
    >
      <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
              blockingCount > 0
                ? "border-amber-500/25 bg-amber-500/10"
                : "border-emerald-500/20 bg-emerald-500/10",
            )}
          >
            {blockingCount > 0 ? (
              <ShieldCheck className="h-5 w-5 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {t(
                blockingCount > 0
                  ? "knowledge.ux.verification.title"
                  : "knowledge.ux.verification.readyTitle",
              )}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              {t(
                blockingCount > 0
                  ? "knowledge.ux.verification.description"
                  : "knowledge.ux.verification.readyDescription",
              )}
            </p>
          </div>
        </div>
        {blockingCount > 0 && canVerify ? (
          <Button
            type="button"
            disabled={loading || saving || verifiableCount === 0}
            onClick={() => setConfirmOpen(true)}
            data-testid="knowledge-service-verify-all"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("knowledge.ux.verification.confirmAll", { count: verifiableCount || blockingCount })}
          </Button>
        ) : null}
      </div>

      {blockingCount > 0 && !canVerify ? (
        <p className="mt-4 text-sm text-amber-300">{t("knowledge.ux.verification.readOnly")}</p>
      ) : null}
      {error ? (
        <div
          className="mt-4 flex items-start gap-2 border-l-2 border-rose-500 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void load()}
          >
            {t("knowledge.common.tryAgain")}
          </Button>
        </div>
      ) : null}

      {loading ? <LoadingOverlay label={t("knowledge.business.loading")} /> : null}

      {!loading && facts.length > 0 ? (
        <div className="mt-5 min-w-0">
          <div className="flex min-w-0 flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t("knowledge.ux.verification.search")}
                className="h-10 w-full min-w-0 rounded-md border border-white/10 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/15"
              />
            </label>
            <span className="text-sm tabular-nums text-zinc-500">
              {t("businessProfile.services.resultCount", {
                count: filteredFacts.length,
                total: facts.length,
              })}
            </span>
          </div>

          <div
            className="divide-y divide-white/10"
            data-testid="knowledge-service-verification-list"
          >
            {visibleFacts.map((fact) => {
              const focused = fact.id === focusFactId;
              return (
                <div
                  key={fact.id}
                  tabIndex={-1}
                  data-verification-fact-id={fact.id}
                  className={cn(
                    "flex min-h-[52px] min-w-0 scroll-mt-32 flex-col justify-center gap-1 px-2 py-2 outline-none transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                    focused && "bg-amber-500/10 ring-1 ring-inset ring-amber-400/40",
                  )}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-100">
                    {serviceName(fact)}
                  </span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm tabular-nums text-zinc-300">
                      {servicePrice(fact, t("knowledge.ux.verification.unknownPrice"))}
                    </span>
                    <StatusBadge status="warning">
                      {t("knowledge.business.verification.pendingReview")}
                    </StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredFacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("knowledge.ux.verification.noResults")}
            </p>
          ) : null}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between border-t border-white/10 pt-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={page === 1}
                aria-label={t("businessProfile.services.previousPage")}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs tabular-nums text-zinc-500">
                {t("businessProfile.services.page", { page, pages: pageCount })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={page === pageCount}
                aria-label={t("businessProfile.services.nextPage")}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!saving) setConfirmOpen(open);
        }}
        title={t("knowledge.ux.verification.modalTitle")}
        description={t("knowledge.ux.verification.modalDescription")}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmOpen(false)}
            >
              {t("knowledge.common.cancel")}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void verifyAll()}>
              <ShieldCheck className="h-4 w-4" />
              {t("knowledge.ux.verification.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          {t("knowledge.ux.verification.confirmAll", { count: verifiableCount })}
        </p>
      </Modal>
    </section>
  );
}
