"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import type {
  KnowledgeV2ConflictCandidateType,
  KnowledgeV2ConflictDecision,
  KnowledgeV2BulkReviewEligibilityReason,
  KnowledgeV2BulkReviewPreviewView,
  KnowledgeV2ConflictResolution,
  KnowledgeV2ConflictType,
  KnowledgeV2ConflictView,
  KnowledgeV2EvidenceLinkView,
  KnowledgeV2EvidenceTargetType,
  KnowledgeV2ReviewAction,
  KnowledgeV2ReviewItemView,
  KnowledgeV2ReviewReason,
  KnowledgeV2ReviewStatus,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import {
  assignKnowledgeV2Conflict,
  assignKnowledgeV2ReviewItem,
  createKnowledgeV2IdempotencyKey,
  dismissKnowledgeV2ReviewItem,
  executeKnowledgeV2BulkReview,
  getKnowledgeV2Conflict,
  getKnowledgeV2ReviewItem,
  listKnowledgeV2ReviewItems,
  previewKnowledgeV2BulkReview,
  resolveKnowledgeV2Conflict,
  resolveKnowledgeV2ReviewItem,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { EmptyState, LoadingOverlay, Modal, Select, Spinner, StatusBadge } from "../ui";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const REFRESH_INTERVAL_MS = 8_000;
const MAX_BACKGROUND_REFRESHES = 30;
const MAX_BULK_ITEMS = 50;

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 aria-invalid:border-rose-500/60 max-sm:min-h-11";
const textareaClass = cn(inputClass, "h-auto min-h-28 resize-y py-2.5");

const reviewStatuses: KnowledgeV2ReviewStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
  "SUPERSEDED",
];
const reviewReasons: KnowledgeV2ReviewReason[] = [
  "MISSING_REQUIRED_INFORMATION",
  "CONFLICTING_VALUES",
  "INFERRED_HIGH_RISK",
  "LOW_CONFIDENCE_CONTENT",
  "SENSITIVE_CONTENT",
  "STALE_SOURCE",
  "INACCESSIBLE_SOURCE",
  "FAILING_TEST",
];
const riskLevels: KnowledgeV2RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const reviewActions: Exclude<KnowledgeV2ReviewAction, "DISMISS">[] = [
  "REVIEW_VALUE",
  "CORRECT_SOURCE",
  "ADD_MISSING_ANSWER",
  "CHANGE_GUIDANCE",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
  "APPROVE",
  "REJECT",
];
const bulkReviewActions: Exclude<KnowledgeV2ReviewAction, "DISMISS">[] = [
  "APPROVE",
  "REJECT",
  "CORRECT_SOURCE",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
];
const conflictResolutions: KnowledgeV2ConflictDecision[] = [
  "KEEP_LEFT",
  "KEEP_RIGHT",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
];

const statusKeys: Record<KnowledgeV2ReviewStatus, TranslationKey> = {
  OPEN: "knowledge.review.status.open",
  ASSIGNED: "knowledge.review.status.assigned",
  IN_REVIEW: "knowledge.review.status.inReview",
  RESOLVED: "knowledge.review.status.resolved",
  DISMISSED: "knowledge.review.status.dismissed",
  SUPERSEDED: "knowledge.review.status.superseded",
};
const reasonKeys: Record<KnowledgeV2ReviewReason, TranslationKey> = {
  MISSING_REQUIRED_INFORMATION: "knowledge.review.reason.missing",
  CONFLICTING_VALUES: "knowledge.review.reason.conflicting",
  INFERRED_HIGH_RISK: "knowledge.review.reason.inferredHighRisk",
  LOW_CONFIDENCE_CONTENT: "knowledge.review.reason.lowConfidence",
  SENSITIVE_CONTENT: "knowledge.review.reason.sensitive",
  STALE_SOURCE: "knowledge.review.reason.stale",
  INACCESSIBLE_SOURCE: "knowledge.review.reason.inaccessible",
  FAILING_TEST: "knowledge.review.reason.failingTest",
};
const riskKeys: Record<KnowledgeV2RiskLevel, TranslationKey> = {
  LOW: "knowledge.review.risk.low",
  MEDIUM: "knowledge.review.risk.medium",
  HIGH: "knowledge.review.risk.high",
  CRITICAL: "knowledge.review.risk.critical",
};
const actionKeys: Record<KnowledgeV2ReviewAction, TranslationKey> = {
  REVIEW_VALUE: "knowledge.review.action.reviewValue",
  CORRECT_SOURCE: "knowledge.review.action.correctSource",
  ADD_MISSING_ANSWER: "knowledge.review.action.addMissing",
  CHANGE_GUIDANCE: "knowledge.review.action.changeGuidance",
  MARK_UNANSWERABLE: "knowledge.review.action.markUnanswerable",
  REQUIRE_HANDOFF: "knowledge.review.action.requireHandoff",
  EXCLUDE_CONTENT: "knowledge.review.action.exclude",
  RETRY_SOURCE: "knowledge.review.action.retrySource",
  VERIFY_PERMISSION: "knowledge.review.action.verifyPermission",
  APPROVE: "knowledge.review.action.approve",
  REJECT: "knowledge.review.action.reject",
  DISMISS: "knowledge.review.action.dismiss",
};
const conflictTypeKeys: Record<KnowledgeV2ConflictType, TranslationKey> = {
  FACT_VALUE: "knowledge.review.conflictType.factValue",
  GUIDANCE_RULE: "knowledge.review.conflictType.guidance",
  AUTHORITY: "knowledge.review.conflictType.authority",
  SCOPE_OVERLAP: "knowledge.review.conflictType.scope",
  EFFECTIVE_PERIOD: "knowledge.review.conflictType.period",
  PERMISSION: "knowledge.review.conflictType.permission",
  DUPLICATE_IDENTITY: "knowledge.review.conflictType.duplicate",
};
const resolutionKeys: Record<KnowledgeV2ConflictResolution, TranslationKey> = {
  KEEP_LEFT: "knowledge.review.resolution.keepLeft",
  KEEP_RIGHT: "knowledge.review.resolution.keepRight",
  MERGE: "knowledge.review.resolution.merge",
  SPLIT_SCOPE: "knowledge.review.resolution.splitScope",
  MARK_UNANSWERABLE: "knowledge.review.resolution.markUnanswerable",
  REQUIRE_HANDOFF: "knowledge.review.resolution.requireHandoff",
  DISMISS: "knowledge.review.resolution.dismiss",
};
const evidenceTargetKeys: Record<KnowledgeV2EvidenceTargetType, TranslationKey> = {
  DOCUMENT_REVISION: "knowledge.review.evidence.target.documentRevision",
  FACT_VERSION: "knowledge.review.evidence.target.factVersion",
  GUIDANCE_RULE_VERSION: "knowledge.review.evidence.target.guidanceVersion",
  MESSAGE: "knowledge.review.evidence.target.message",
  TOOL_RESULT: "knowledge.review.evidence.target.toolResult",
  EXTERNAL_REFERENCE: "knowledge.review.evidence.target.external",
};
const candidateTypeKeys: Record<KnowledgeV2ConflictCandidateType, TranslationKey> = {
  DOCUMENT_REVISION: "knowledge.review.conflict.candidateType.document",
  FACT_VERSION: "knowledge.review.conflict.candidateType.fact",
  GUIDANCE_RULE_VERSION: "knowledge.review.conflict.candidateType.guidance",
};
const bulkReasonKeys: Record<KnowledgeV2BulkReviewEligibilityReason, TranslationKey> = {
  NOT_FOUND: "knowledge.review.bulk.reason.notFound",
  STATUS_NOT_OPEN: "knowledge.review.bulk.reason.status",
  RISK_NOT_LOW: "knowledge.review.bulk.reason.risk",
  SOURCE_REQUIRED: "knowledge.review.bulk.reason.sourceRequired",
  SOURCE_NOT_READY: "knowledge.review.bulk.reason.sourceReady",
  CONFLICT_LINKED: "knowledge.review.bulk.reason.conflict",
  RESTRICTED_CONTENT: "knowledge.review.bulk.reason.restricted",
  ACTION_MISMATCH: "knowledge.review.bulk.reason.action",
  ACTION_UNSUPPORTED: "knowledge.review.bulk.reason.unsupported",
  TARGET_SCHEMA_UNAVAILABLE: "knowledge.review.bulk.reason.schemaUnavailable",
  SOURCE_MISMATCH: "knowledge.review.bulk.reason.sourceMismatch",
  REASON_MISMATCH: "knowledge.review.bulk.reason.reasonMismatch",
  TARGET_SCHEMA_MISMATCH: "knowledge.review.bulk.reason.schemaMismatch",
};

type FilterValue<T extends string> = T | "ALL";
type DecisionMode = "RESOLVE" | "DISMISS" | "CONFLICT_RESOLVE" | null;

interface ReviewDetailState {
  item: KnowledgeV2ReviewItemView;
  etag: string;
}

interface ConflictDetailState {
  conflict: KnowledgeV2ConflictView;
  etag: string;
}

function apiError(caught: unknown, fallback: string) {
  return caught instanceof ApiClientError ? caught : new ApiClientError(fallback, 500);
}

function responseEtag(headers: Headers, fallback: string) {
  return headers.get("etag") ?? fallback;
}

function statusTone(status: KnowledgeV2ReviewStatus) {
  if (status === "RESOLVED") return "success" as const;
  if (status === "DISMISSED" || status === "SUPERSEDED") return "info" as const;
  if (status === "IN_REVIEW" || status === "ASSIGNED") return "warning" as const;
  return "error" as const;
}

function riskTone(risk: KnowledgeV2RiskLevel) {
  if (risk === "HIGH" || risk === "CRITICAL") return "error" as const;
  if (risk === "MEDIUM") return "warning" as const;
  return "info" as const;
}

function isActionable(status: KnowledgeV2ReviewStatus) {
  return status === "OPEN" || status === "ASSIGNED" || status === "IN_REVIEW";
}

function isBulkSelectable(item: KnowledgeV2ReviewItemView) {
  return item.riskLevel === "LOW" && !item.conflictId;
}

function hasReadableConflictValues(conflict: KnowledgeV2ConflictView) {
  return Boolean(
    conflict.candidates?.length &&
    conflict.candidates.every(
      (candidate) =>
        !candidate.redacted &&
        typeof candidate.safeValue === "string" &&
        candidate.safeValue.trim().length > 0,
    ),
  );
}

function availableResolutions(conflict: KnowledgeV2ConflictView | null) {
  return conflict && hasReadableConflictValues(conflict)
    ? conflictResolutions
    : (["MARK_UNANSWERABLE", "REQUIRE_HANDOFF"] as const);
}

export function KnowledgeReviewQueue({
  canReview,
  canBulkReview,
  canVerifyHighRisk,
  onChanged,
}: {
  canReview: boolean;
  canBulkReview: boolean;
  canVerifyHighRisk: boolean;
  onChanged: () => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [status, setStatus] = React.useState<FilterValue<KnowledgeV2ReviewStatus>>("ALL");
  const [reason, setReason] = React.useState<FilterValue<KnowledgeV2ReviewReason>>("ALL");
  const [risk, setRisk] = React.useState<FilterValue<KnowledgeV2RiskLevel>>("ALL");
  const [items, setItems] = React.useState<KnowledgeV2ReviewItemView[]>([]);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [listError, setListError] = React.useState<ApiClientError | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ReviewDetailState | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<ApiClientError | null>(null);
  const [conflict, setConflict] = React.useState<ConflictDetailState | null>(null);
  const [conflictError, setConflictError] = React.useState<ApiClientError | null>(null);
  const [decisionMode, setDecisionMode] = React.useState<DecisionMode>(null);
  const [decisionAction, setDecisionAction] =
    React.useState<Exclude<KnowledgeV2ReviewAction, "DISMISS">>("REVIEW_VALUE");
  const [conflictResolution, setConflictResolution] =
    React.useState<KnowledgeV2ConflictDecision>("KEEP_LEFT");
  const [rationale, setRationale] = React.useState("");
  const [rationaleError, setRationaleError] = React.useState(false);
  const [decisionError, setDecisionError] = React.useState<ApiClientError | null>(null);
  const [staleReloaded, setStaleReloaded] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = React.useState<string[]>([]);
  const [bulkAction, setBulkAction] =
    React.useState<Exclude<KnowledgeV2ReviewAction, "DISMISS">>("APPROVE");
  const [bulkPreview, setBulkPreview] = React.useState<KnowledgeV2BulkReviewPreviewView | null>(
    null,
  );
  const [bulkDialogOpen, setBulkDialogOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState<"preview" | "execute" | null>(null);
  const [bulkError, setBulkError] = React.useState<ApiClientError | null>(null);
  const mounted = React.useRef(false);
  const listSequence = React.useRef(0);
  const detailSequence = React.useRef(0);
  const backgroundRefreshes = React.useRef(0);
  const itemCount = React.useRef(0);
  const nextCursorRef = React.useRef<string | null>(null);
  const detailPanelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadItems = React.useCallback(
    async ({ append = false, silent = false }: { append?: boolean; silent?: boolean } = {}) => {
      const sequence = ++listSequence.current;
      if (append) setLoadingMore(true);
      else if (!silent) setLoading(true);

      try {
        const page = await listKnowledgeV2ReviewItems({
          limit: append ? PAGE_SIZE : Math.min(Math.max(PAGE_SIZE, itemCount.current), 100),
          ...(append && nextCursorRef.current ? { cursor: nextCursorRef.current } : {}),
          ...(status === "ALL" ? {} : { status }),
          ...(reason === "ALL" ? {} : { reason }),
          ...(risk === "ALL" ? {} : { riskLevel: risk }),
          ...(debouncedQuery ? { query: debouncedQuery } : {}),
        });
        if (!mounted.current || sequence !== listSequence.current) return;

        setItems((current) => {
          const next = append
            ? [
                ...current,
                ...page.items.filter((item) => !current.some((entry) => entry.id === item.id)),
              ]
            : page.items;
          itemCount.current = next.length;
          return next;
        });
        nextCursorRef.current = page.pageInfo.nextCursor;
        setHasNextPage(page.pageInfo.hasNextPage);
        setListError(null);
        if (!append) {
          setSelectedId((current) =>
            current && page.items.some((item) => item.id === current)
              ? current
              : (page.items[0]?.id ?? null),
          );
        }
      } catch (caught) {
        if (!mounted.current || sequence !== listSequence.current) return;
        if (!silent || itemCount.current === 0) {
          setListError(apiError(caught, t("knowledge.review.error.list")));
        }
      } finally {
        if (mounted.current && sequence === listSequence.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedQuery, reason, risk, status, t],
  );

  const loadDetail = React.useCallback(
    async (id: string, silent = false) => {
      const sequence = ++detailSequence.current;
      if (!silent) setDetailLoading(true);
      try {
        const response = await getKnowledgeV2ReviewItem(id);
        if (!mounted.current || sequence !== detailSequence.current) return;
        const nextDetail = {
          item: response.data,
          etag: responseEtag(response.headers, response.data.etag),
        };
        setDetail(nextDetail);
        setItems((current) =>
          current.map((item) => (item.id === response.data.id ? response.data : item)),
        );
        setDetailError(null);
        setConflict(null);
        setConflictError(null);

        if (response.data.conflictId) {
          try {
            const conflictResponse = await getKnowledgeV2Conflict(response.data.conflictId);
            if (!mounted.current || sequence !== detailSequence.current) return;
            setConflict({
              conflict: conflictResponse.data,
              etag: responseEtag(conflictResponse.headers, conflictResponse.data.etag),
            });
          } catch (caught) {
            if (!mounted.current || sequence !== detailSequence.current) return;
            setConflictError(apiError(caught, t("knowledge.review.error.conflict")));
          }
        }
      } catch (caught) {
        if (!mounted.current || sequence !== detailSequence.current) return;
        setDetailError(apiError(caught, t("knowledge.review.error.detail")));
        if (!silent) setDetail(null);
      } finally {
        if (mounted.current && sequence === detailSequence.current) setDetailLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    backgroundRefreshes.current = 0;
    itemCount.current = 0;
    nextCursorRef.current = null;
    void loadItems();
  }, [loadItems]);

  React.useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setConflict(null);
    }
  }, [loadDetail, selectedId]);

  React.useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      backgroundRefreshes.current = 0;
      void loadItems({ silent: true });
      if (selectedId && !decisionMode && !busyAction) void loadDetail(selectedId, true);
    }

    function pollWhenVisible() {
      if (
        document.visibilityState !== "visible" ||
        backgroundRefreshes.current >= MAX_BACKGROUND_REFRESHES
      ) {
        return;
      }
      backgroundRefreshes.current += 1;
      void loadItems({ silent: true });
    }

    const timer = window.setInterval(pollWhenVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [busyAction, decisionMode, loadDetail, loadItems, selectedId]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    setBulkSelectedIds([]);
    setBulkPreview(null);
    setBulkError(null);
    setBulkDialogOpen(false);
  }, [debouncedQuery, reason, risk, status]);

  React.useEffect(() => {
    if (!canBulkReview) {
      setBulkSelectedIds([]);
      setBulkPreview(null);
      setBulkDialogOpen(false);
    }
  }, [canBulkReview]);

  function toggleBulkItem(item: KnowledgeV2ReviewItemView, checked: boolean) {
    setBulkError(null);
    setBulkPreview(null);
    setBulkSelectedIds((current) => {
      if (!checked) return current.filter((id) => id !== item.id);
      if (current.includes(item.id)) return current;
      if (current.length >= MAX_BULK_ITEMS) {
        setNotice(t("knowledge.review.bulk.limit", { count: formatNumber(MAX_BULK_ITEMS) }));
        return current;
      }
      return [...current, item.id];
    });
  }

  function changeBulkAction(action: Exclude<KnowledgeV2ReviewAction, "DISMISS">) {
    setBulkAction(action);
    setBulkPreview(null);
    setBulkError(null);
  }

  async function requestBulkPreview() {
    if (!canBulkReview || bulkSelectedIds.length === 0 || bulkBusy) return;
    setBulkBusy("preview");
    setBulkError(null);
    try {
      const response = await previewKnowledgeV2BulkReview({
        itemIds: bulkSelectedIds,
        action: bulkAction,
      });
      setBulkPreview(response.data);
      setBulkDialogOpen(true);
      if (!response.data.eligible) {
        await loadItems({ silent: true });
        if (selectedId) await loadDetail(selectedId, true);
      }
    } catch (caught) {
      setBulkPreview(null);
      setBulkError(apiError(caught, t("knowledge.review.bulk.errorPreview")));
      setBulkDialogOpen(true);
      await loadItems({ silent: true });
      if (selectedId) await loadDetail(selectedId, true);
    } finally {
      setBulkBusy(null);
    }
  }

  async function executeBulkResolution() {
    if (!bulkPreview?.eligible || !bulkPreview.previewHash || !bulkPreview.expiresAt || bulkBusy) {
      return;
    }
    const previewItems = bulkPreview.items.flatMap((item) =>
      item.etag ? [{ id: item.id, etag: item.etag }] : [],
    );
    if (previewItems.length !== bulkSelectedIds.length) return;
    setBulkBusy("execute");
    setBulkError(null);
    try {
      await executeKnowledgeV2BulkReview(
        {
          action: bulkAction,
          items: previewItems,
          previewHash: bulkPreview.previewHash,
          previewExpiresAt: bulkPreview.expiresAt,
        },
        { "Idempotency-Key": createKnowledgeV2IdempotencyKey() },
      );
      setBulkDialogOpen(false);
      setBulkPreview(null);
      setBulkSelectedIds([]);
      setNotice(t("knowledge.review.bulk.success", { count: formatNumber(previewItems.length) }));
      await loadItems();
      if (selectedId) await loadDetail(selectedId, true);
      onChanged();
    } catch (caught) {
      setBulkError(apiError(caught, t("knowledge.review.bulk.errorExecute")));
      await loadItems({ silent: true });
      if (selectedId) await loadDetail(selectedId, true);
    } finally {
      setBulkBusy(null);
    }
  }

  function selectItem(id: string) {
    setSelectedId(id);
    setDecisionError(null);
    setStaleReloaded(false);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.setTimeout(() => detailPanelRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function updateItem(next: KnowledgeV2ReviewItemView, etag?: string) {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
    setDetail({ item: next, etag: etag ?? next.etag });
  }

  function canActOn(item: KnowledgeV2ReviewItemView) {
    return (
      canReview &&
      ((item.riskLevel !== "HIGH" && item.riskLevel !== "CRITICAL") || canVerifyHighRisk)
    );
  }

  function openDecision(mode: Exclude<DecisionMode, null>) {
    if (!detail) return;
    setDecisionMode(mode);
    setDecisionAction(
      detail.item.suggestedAction === "DISMISS" ? "REVIEW_VALUE" : detail.item.suggestedAction,
    );
    setConflictResolution(
      mode === "CONFLICT_RESOLVE"
        ? (availableResolutions(conflict?.conflict ?? null)[0] ?? "REQUIRE_HANDOFF")
        : "KEEP_LEFT",
    );
    setRationale("");
    setRationaleError(false);
    setDecisionError(null);
    setStaleReloaded(false);
  }

  async function reloadAfterConflict() {
    if (!selectedId) return;
    await loadDetail(selectedId, true);
    setStaleReloaded(true);
  }

  async function claimReviewItem() {
    if (!detail) return;
    setBusyAction("claim-review");
    setDecisionError(null);
    try {
      const response = await assignKnowledgeV2ReviewItem(
        detail.item.id,
        {},
        {
          "If-Match": detail.etag,
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        },
      );
      updateItem(
        response.data.resource,
        responseEtag(response.headers, response.data.resource.etag),
      );
      setNotice(t("knowledge.review.saved.claimed"));
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.review.error.action"));
      if (error.status === 412) await reloadAfterConflict();
      else setDecisionError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function claimConflict() {
    if (!conflict) return;
    setBusyAction("claim-conflict");
    setDecisionError(null);
    try {
      const response = await assignKnowledgeV2Conflict(
        conflict.conflict.id,
        {},
        {
          "If-Match": conflict.etag,
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        },
      );
      setConflict({
        conflict: response.data.resource,
        etag: responseEtag(response.headers, response.data.resource.etag),
      });
      setNotice(t("knowledge.review.saved.claimed"));
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.review.error.action"));
      if (error.status === 412) await reloadAfterConflict();
      else setDecisionError(error);
    } finally {
      setBusyAction(null);
    }
  }

  async function submitDecision() {
    if (!detail || !decisionMode) return;
    const trimmedRationale = rationale.trim();
    if (decisionMode === "DISMISS" && trimmedRationale.length < 8) {
      setRationaleError(true);
      return;
    }
    setBusyAction("decision");
    setDecisionError(null);
    setRationaleError(false);

    try {
      if (decisionMode === "CONFLICT_RESOLVE") {
        if (!conflict) return;
        const response = await resolveKnowledgeV2Conflict(
          conflict.conflict.id,
          {
            resolution: conflictResolution,
            ...(trimmedRationale ? { rationale: trimmedRationale } : {}),
          },
          {
            "If-Match": conflict.etag,
            "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
          },
        );
        setConflict({
          conflict: response.data.resource,
          etag: responseEtag(response.headers, response.data.resource.etag),
        });
        setNotice(t("knowledge.review.saved.conflict"));
      } else {
        const response =
          decisionMode === "DISMISS"
            ? await dismissKnowledgeV2ReviewItem(
                detail.item.id,
                { rationale: trimmedRationale },
                {
                  "If-Match": detail.etag,
                  "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
                },
              )
            : await resolveKnowledgeV2ReviewItem(
                detail.item.id,
                {
                  action: decisionAction,
                  ...(trimmedRationale ? { rationale: trimmedRationale } : {}),
                },
                {
                  "If-Match": detail.etag,
                  "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
                },
              );
        updateItem(
          response.data.resource,
          responseEtag(response.headers, response.data.resource.etag),
        );
        setNotice(
          t(
            decisionMode === "DISMISS"
              ? "knowledge.review.saved.dismissed"
              : "knowledge.review.saved.resolved",
          ),
        );
      }
      setDecisionMode(null);
      setRationale("");
      setStaleReloaded(false);
      void loadItems({ silent: true });
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.review.error.action"));
      if (error.status === 412) await reloadAfterConflict();
      else setDecisionError(error);
    } finally {
      setBusyAction(null);
    }
  }

  const counts = React.useMemo(
    () => ({
      loaded: items.length,
      actionable: items.filter((item) => isActionable(item.status)).length,
      highRisk: items.filter((item) => item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL")
        .length,
      conflicts: items.filter((item) => Boolean(item.conflictId)).length,
    }),
    [items],
  );
  const hasFilters = Boolean(
    debouncedQuery || status !== "ALL" || reason !== "ALL" || risk !== "ALL",
  );

  return (
    <section className="min-w-0 space-y-4" data-testid="knowledge-review-queue">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-100">{t("knowledge.review.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            {t("knowledge.review.description")}
          </p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label={t("knowledge.common.refresh")}
          disabled={loading}
          onClick={() => {
            backgroundRefreshes.current = 0;
            void loadItems();
            if (selectedId) void loadDetail(selectedId, true);
          }}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {!canReview ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-200">
              {t("knowledge.review.permissionTitle")}
            </p>
            <p className="mt-0.5 text-xs text-amber-200/65">
              {t("knowledge.review.permissionBody")}
            </p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-200"
          role="status"
          data-testid="knowledge-review-notice"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      <div className="grid grid-cols-2 border-y border-white/10 md:grid-cols-4">
        <QueueMetric label={t("knowledge.review.count.loaded")} value={counts.loaded} />
        <QueueMetric
          label={t("knowledge.review.count.actionable")}
          value={counts.actionable}
          attention={counts.actionable > 0}
        />
        <QueueMetric
          label={t("knowledge.review.count.highRisk")}
          value={counts.highRisk}
          attention={counts.highRisk > 0}
        />
        <QueueMetric
          label={t("knowledge.review.count.conflicts")}
          value={counts.conflicts}
          attention={counts.conflicts > 0}
        />
      </div>

      <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(150px,1fr))]">
        <label className="relative min-w-0">
          <span className="sr-only">{t("knowledge.review.searchAria")}</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("knowledge.review.searchPlaceholder")}
            aria-label={t("knowledge.review.searchAria")}
            className={cn(inputClass, "pl-9")}
            data-testid="knowledge-review-search"
          />
        </label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as FilterValue<KnowledgeV2ReviewStatus>)}
          ariaLabel={t("knowledge.review.filter.statusAria")}
          className="h-10 rounded-md"
          options={[
            { value: "ALL", label: t("knowledge.review.filter.status") },
            ...reviewStatuses.map((value) => ({ value, label: t(statusKeys[value]) })),
          ]}
        />
        <Select
          value={reason}
          onValueChange={(value) => setReason(value as FilterValue<KnowledgeV2ReviewReason>)}
          ariaLabel={t("knowledge.review.filter.reasonAria")}
          className="h-10 rounded-md"
          options={[
            { value: "ALL", label: t("knowledge.review.filter.reason") },
            ...reviewReasons.map((value) => ({ value, label: t(reasonKeys[value]) })),
          ]}
        />
        <Select
          value={risk}
          onValueChange={(value) => setRisk(value as FilterValue<KnowledgeV2RiskLevel>)}
          ariaLabel={t("knowledge.review.filter.riskAria")}
          className="h-10 rounded-md"
          options={[
            { value: "ALL", label: t("knowledge.review.filter.risk") },
            ...riskLevels.map((value) => ({ value, label: t(riskKeys[value]) })),
          ]}
        />
      </div>

      {canBulkReview ? (
        <div
          className="flex min-w-0 flex-col gap-3 border-y border-white/10 py-3 sm:flex-row sm:items-end sm:justify-between"
          data-testid="knowledge-review-bulk-toolbar"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-200">{t("knowledge.review.bulk.title")}</p>
            <p className="mt-1 text-xs text-zinc-500" aria-live="polite">
              {t("knowledge.review.bulk.selected", {
                selected: formatNumber(bulkSelectedIds.length),
                maximum: formatNumber(MAX_BULK_ITEMS),
              })}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={bulkAction}
              onValueChange={(value) => changeBulkAction(value as typeof bulkAction)}
              ariaLabel={t("knowledge.review.bulk.actionLabel")}
              className="w-full min-w-0 rounded-md sm:w-56"
              options={bulkReviewActions.map((value) => ({
                value,
                label: t(actionKeys[value]),
              }))}
            />
            <div className="flex min-w-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulkSelectedIds.length === 0 || bulkBusy !== null}
                onClick={() => {
                  setBulkSelectedIds([]);
                  setBulkPreview(null);
                  setBulkError(null);
                }}
              >
                {t("knowledge.review.bulk.clear")}
              </Button>
              <Button
                size="sm"
                disabled={bulkSelectedIds.length === 0 || bulkBusy !== null}
                onClick={() => void requestBulkPreview()}
                data-testid="knowledge-review-bulk-preview"
              >
                {bulkBusy === "preview" ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t("knowledge.review.bulk.preview")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/25 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 border-b border-white/10 lg:border-b-0 lg:border-r">
          {loading && items.length === 0 ? (
            <LoadingOverlay label={t("knowledge.review.loading")} />
          ) : listError && items.length === 0 ? (
            <QueueError
              error={listError}
              fallback={t("knowledge.review.error.list")}
              onRetry={() => void loadItems()}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={t(
                hasFilters
                  ? "knowledge.review.empty.filteredTitle"
                  : "knowledge.review.empty.title",
              )}
              description={t(
                hasFilters ? "knowledge.review.empty.filteredBody" : "knowledge.review.empty.body",
              )}
              className="min-h-[360px]"
            />
          ) : (
            <div className="min-w-0 p-2" role="list" data-testid="knowledge-review-list">
              {listError ? (
                <div className="mb-2 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-2 text-xs text-rose-200">
                  {listError.message || t("knowledge.review.error.list")}
                </div>
              ) : null}
              {items.map((item) => (
                <ReviewRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  bulkSelectable={canBulkReview && isBulkSelectable(item)}
                  bulkChecked={bulkSelectedIds.includes(item.id)}
                  bulkDisabled={
                    bulkSelectedIds.length >= MAX_BULK_ITEMS && !bulkSelectedIds.includes(item.id)
                  }
                  onSelect={() => selectItem(item.id)}
                  onBulkChange={(checked) => toggleBulkItem(item, checked)}
                />
              ))}
              {hasNextPage ? (
                <div className="flex justify-center border-t border-white/10 px-3 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => void loadItems({ append: true })}
                  >
                    {loadingMore ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t("knowledge.review.loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div
          ref={detailPanelRef}
          className="min-h-[420px] min-w-0 scroll-mt-4"
          data-testid="knowledge-review-detail-panel"
        >
          {detailLoading && !detail ? (
            <LoadingOverlay label={t("knowledge.review.loadingDetail")} />
          ) : detailError && !detail ? (
            <QueueError
              error={detailError}
              fallback={t("knowledge.review.error.detail")}
              onRetry={() => selectedId && void loadDetail(selectedId)}
            />
          ) : !detail ? (
            <EmptyState
              icon={FileWarning}
              title={t("knowledge.review.select.title")}
              description={t("knowledge.review.select.body")}
              className="min-h-[420px]"
            />
          ) : (
            <ReviewDetail
              detail={detail}
              conflict={conflict}
              conflictError={conflictError}
              canAct={canActOn(detail.item)}
              highRiskRestricted={
                (detail.item.riskLevel === "HIGH" || detail.item.riskLevel === "CRITICAL") &&
                !canVerifyHighRisk
              }
              busyAction={busyAction}
              actionError={decisionError}
              staleReloaded={staleReloaded}
              onClaim={() => void claimReviewItem()}
              onClaimConflict={() => void claimConflict()}
              onResolve={() => openDecision("RESOLVE")}
              onDismiss={() => openDecision("DISMISS")}
              onResolveConflict={() => openDecision("CONFLICT_RESOLVE")}
              onRetryConflict={() => void loadDetail(detail.item.id, true)}
            />
          )}
        </div>
      </div>

      <DecisionModal
        open={decisionMode !== null}
        mode={decisionMode}
        action={decisionAction}
        conflictResolution={conflictResolution}
        rationale={rationale}
        rationaleError={rationaleError}
        staleReloaded={staleReloaded}
        latestTitle={detail?.item.safeTitle ?? null}
        latestSummary={detail?.item.safeSummary ?? null}
        availableConflictResolutions={availableResolutions(conflict?.conflict ?? null)}
        error={decisionError}
        busy={busyAction === "decision"}
        onOpenChange={(open) => {
          if (!open && busyAction !== "decision") setDecisionMode(null);
        }}
        onActionChange={setDecisionAction}
        onResolutionChange={setConflictResolution}
        onRationaleChange={(value) => {
          setRationale(value);
          if (value.trim().length >= 8) setRationaleError(false);
        }}
        onSubmit={() => void submitDecision()}
      />
      <BulkReviewModal
        open={bulkDialogOpen}
        preview={bulkPreview}
        error={bulkError}
        busy={bulkBusy}
        action={bulkAction}
        onOpenChange={(open) => {
          if (!open && bulkBusy === null) setBulkDialogOpen(false);
        }}
        onPreview={() => void requestBulkPreview()}
        onConfirm={() => void executeBulkResolution()}
      />
    </section>
  );

  function QueueMetric({
    label,
    value,
    attention = false,
  }: {
    label: string;
    value: number;
    attention?: boolean;
  }) {
    return (
      <div className="min-w-0 border-white/10 px-4 py-3 odd:border-r md:[&:not(:last-child)]:border-r">
        <p className="text-xs text-zinc-500">{label}</p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold",
            attention ? "text-amber-300" : "text-zinc-100",
          )}
        >
          {formatNumber(value)}
        </p>
      </div>
    );
  }

  function ReviewRow({
    item,
    selected,
    bulkSelectable,
    bulkChecked,
    bulkDisabled,
    onSelect,
    onBulkChange,
  }: {
    item: KnowledgeV2ReviewItemView;
    selected: boolean;
    bulkSelectable: boolean;
    bulkChecked: boolean;
    bulkDisabled: boolean;
    onSelect: () => void;
    onBulkChange: (checked: boolean) => void;
  }) {
    return (
      <div
        role="listitem"
        className={cn(
          "mb-1.5 flex w-full min-w-0 items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors last:mb-0",
          selected
            ? "border-emerald-500/30 bg-emerald-500/[0.07]"
            : "border-transparent hover:border-white/10 hover:bg-white/[0.035]",
        )}
      >
        {bulkSelectable ? (
          <label className="mt-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center">
            <span className="sr-only">
              {t("knowledge.review.bulk.checkbox", { title: item.safeTitle })}
            </span>
            <input
              type="checkbox"
              checked={bulkChecked}
              disabled={bulkDisabled}
              onChange={(event) => onBulkChange(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-zinc-900 accent-emerald-500 focus:ring-2 focus:ring-emerald-500/40"
              data-testid={`knowledge-review-bulk-checkbox-${item.id}`}
            />
          </label>
        ) : null}
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          data-testid={`knowledge-review-item-${item.id}`}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL"
                ? "bg-rose-500/10 text-rose-400"
                : item.conflictId
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-sky-500/10 text-sky-400",
            )}
          >
            {item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL" ? (
              <ShieldAlert className="h-4 w-4" />
            ) : item.conflictId ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <ClipboardCheck className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-zinc-100">{item.safeTitle}</p>
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-zinc-500">
              {item.safeSummary || t(reasonKeys[item.reason])}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={statusTone(item.status)}>
                {t(statusKeys[item.status])}
              </StatusBadge>
              <StatusBadge status={riskTone(item.riskLevel)}>
                {t(riskKeys[item.riskLevel])}
              </StatusBadge>
              {item.assignedTo ? (
                <span className="max-w-full truncate text-[11px] text-zinc-500">
                  {item.assignedTo.displayName}
                </span>
              ) : null}
            </div>
          </div>
          <ChevronRight
            className={cn("mt-2 h-4 w-4 shrink-0", selected ? "text-emerald-400" : "text-zinc-700")}
          />
        </button>
      </div>
    );
  }

  function ReviewDetail({
    detail,
    conflict,
    conflictError,
    canAct,
    highRiskRestricted,
    busyAction,
    actionError,
    staleReloaded,
    onClaim,
    onClaimConflict,
    onResolve,
    onDismiss,
    onResolveConflict,
    onRetryConflict,
  }: {
    detail: ReviewDetailState;
    conflict: ConflictDetailState | null;
    conflictError: ApiClientError | null;
    canAct: boolean;
    highRiskRestricted: boolean;
    busyAction: string | null;
    actionError: ApiClientError | null;
    staleReloaded: boolean;
    onClaim: () => void;
    onClaimConflict: () => void;
    onResolve: () => void;
    onDismiss: () => void;
    onResolveConflict: () => void;
    onRetryConflict: () => void;
  }) {
    const item = detail.item;
    return (
      <article className="min-w-0 p-4 sm:p-5" data-testid="knowledge-review-detail">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={statusTone(item.status)}>
                {t(statusKeys[item.status])}
              </StatusBadge>
              <StatusBadge status={riskTone(item.riskLevel)}>
                {t(riskKeys[item.riskLevel])}
              </StatusBadge>
            </div>
            <h3 className="mt-3 break-words text-base font-semibold text-zinc-50">
              {item.safeTitle}
            </h3>
            <p className="mt-1 text-xs text-zinc-600">
              {t("knowledge.review.detail.updated", {
                date: formatDate(item.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {item.allowedActions.includes("CLAIM") ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canAct || busyAction !== null}
                onClick={onClaim}
                data-testid="knowledge-review-claim"
              >
                {busyAction === "claim-review" ? (
                  <Spinner className="mr-2 h-4 w-4" />
                ) : (
                  <UserRoundCheck className="mr-2 h-4 w-4" />
                )}
                {t(
                  busyAction === "claim-review"
                    ? "knowledge.review.action.claiming"
                    : "knowledge.review.action.claim",
                )}
              </Button>
            ) : null}
            {item.allowedActions.includes("RESOLVE") ? (
              <Button
                size="sm"
                disabled={!canAct || busyAction !== null}
                onClick={onResolve}
                data-testid="knowledge-review-resolve"
              >
                {t("knowledge.review.action.resolve")}
              </Button>
            ) : null}
            {item.allowedActions.includes("DISMISS") ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canAct || busyAction !== null}
                onClick={onDismiss}
                data-testid="knowledge-review-dismiss"
              >
                {t("knowledge.review.action.dismiss")}
              </Button>
            ) : null}
          </div>
        </div>

        {highRiskRestricted ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("knowledge.review.highRiskRestricted")}
          </div>
        ) : null}
        {staleReloaded ? <ChangedNotice /> : null}
        {actionError ? <ActionError error={actionError} /> : null}

        <div className="mt-5 grid gap-x-5 gap-y-3 border-y border-white/10 py-4 sm:grid-cols-2">
          <DetailField
            label={t("knowledge.review.detail.reason")}
            value={t(reasonKeys[item.reason])}
          />
          <DetailField
            label={t("knowledge.review.detail.suggested")}
            value={t(actionKeys[item.suggestedAction])}
          />
          <DetailField
            label={t("knowledge.review.detail.assignee")}
            value={item.assignedTo?.displayName ?? t("knowledge.review.detail.unassigned")}
          />
          <DetailField
            label={t("knowledge.review.detail.due")}
            value={
              item.dueAt
                ? formatDate(item.dueAt, { dateStyle: "medium", timeStyle: "short" })
                : t("knowledge.common.notRecorded")
            }
          />
        </div>

        <section className="mt-5">
          <h4 className="text-xs font-semibold uppercase text-zinc-500">
            {t("knowledge.review.detail.summary")}
          </h4>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
            {item.safeSummary || t("knowledge.review.detail.noSummary")}
          </p>
        </section>

        {item.hasRestrictedPayload ? <RestrictedNotice /> : null}

        <EvidenceSection evidence={item.evidence ?? []} />

        {item.conflictId ? (
          <ConflictSection
            conflict={conflict}
            error={conflictError}
            canAct={canAct}
            busyAction={busyAction}
            onClaim={onClaimConflict}
            onResolve={onResolveConflict}
            onRetry={onRetryConflict}
          />
        ) : null}
      </article>
    );
  }

  function EvidenceSection({ evidence }: { evidence: KnowledgeV2EvidenceLinkView[] }) {
    return (
      <section className="mt-6 border-t border-white/10 pt-5">
        <h4 className="text-sm font-semibold text-zinc-200">
          {t("knowledge.review.evidence.title")}
        </h4>
        {evidence.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">{t("knowledge.review.evidence.empty")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {evidence.map((link) => (
              <div
                key={link.evidence.id}
                className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm text-zinc-200">{link.evidence.safeLabel}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {t(evidenceTargetKeys[link.evidence.targetType])}
                    </p>
                  </div>
                  {link.evidence.isPublic && !link.evidence.redacted ? (
                    <StatusBadge status="success">
                      {t("knowledge.review.evidence.public")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge status="warning">
                      {t("knowledge.review.restricted.title")}
                    </StatusBadge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                  {link.evidence.confidence !== null && link.evidence.confidence !== undefined ? (
                    <span>
                      {t("knowledge.review.evidence.confidence", {
                        percent: formatNumber(Math.round(link.evidence.confidence * 100)),
                      })}
                    </span>
                  ) : null}
                  {link.evidence.observedAt ? (
                    <span>
                      {t("knowledge.review.evidence.observed", {
                        date: formatDate(link.evidence.observedAt, { dateStyle: "medium" }),
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function ConflictSection({
    conflict,
    error,
    canAct,
    busyAction,
    onClaim,
    onResolve,
    onRetry,
  }: {
    conflict: ConflictDetailState | null;
    error: ApiClientError | null;
    canAct: boolean;
    busyAction: string | null;
    onClaim: () => void;
    onResolve: () => void;
    onRetry: () => void;
  }) {
    return (
      <section
        className="mt-6 border-t border-white/10 pt-5"
        data-testid="knowledge-review-conflict"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-zinc-200">
            {t("knowledge.review.conflict.title")}
          </h4>
          {conflict ? (
            <div className="flex gap-2">
              {conflict.conflict.allowedActions.includes("CLAIM") ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canAct || busyAction !== null}
                  onClick={onClaim}
                >
                  {busyAction === "claim-conflict" ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  {t("knowledge.review.action.claim")}
                </Button>
              ) : null}
              {conflict.conflict.allowedActions.includes("RESOLVE") ? (
                <Button
                  size="sm"
                  disabled={!canAct || busyAction !== null}
                  onClick={onResolve}
                  data-testid="knowledge-conflict-resolve"
                >
                  {t("knowledge.review.conflict.resolve")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-3 text-sm text-rose-200">
            <p>{error.message || t("knowledge.review.error.conflict")}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              {t("knowledge.common.tryAgain")}
            </Button>
          </div>
        ) : !conflict ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-600">
            <Spinner className="h-4 w-4" />
            {t("knowledge.review.loadingDetail")}
          </div>
        ) : (
          <div className="mt-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={riskTone(conflict.conflict.severity)}>
                {t(riskKeys[conflict.conflict.severity])}
              </StatusBadge>
              <span className="text-xs text-zinc-500">
                {t(conflictTypeKeys[conflict.conflict.conflictType])}
              </span>
              {conflict.conflict.assignedTo ? (
                <span className="text-xs text-zinc-600">
                  {conflict.conflict.assignedTo.displayName}
                </span>
              ) : null}
            </div>
            <h5 className="mt-4 text-xs font-semibold uppercase text-zinc-500">
              {t("knowledge.review.conflict.candidates")}
            </h5>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
              {(conflict.conflict.candidates ?? []).map((candidate, index) => (
                <div
                  key={candidate.id}
                  className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
                >
                  <p className="text-sm font-medium text-zinc-200">
                    {t("knowledge.review.conflict.candidate", { number: formatNumber(index + 1) })}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t(candidateTypeKeys[candidate.candidateType])}
                  </p>
                  {candidate.safeValue && !candidate.redacted ? (
                    <p className="mt-2 break-words text-sm font-medium text-zinc-100">
                      {candidate.safeValue}
                    </p>
                  ) : null}
                  {candidate.confidence !== null && candidate.confidence !== undefined ? (
                    <p className="mt-2 text-[11px] text-zinc-500">
                      {t("knowledge.review.evidence.confidence", {
                        percent: formatNumber(Math.round(candidate.confidence * 100)),
                      })}
                    </p>
                  ) : null}
                  {(candidate.hasRestrictedValue && !candidate.safeValue) || candidate.redacted ? (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-300">
                      <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                      {t("knowledge.review.conflict.valueRestricted")}
                    </div>
                  ) : !candidate.safeValue ? (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
                      <FileWarning className="h-3.5 w-3.5 shrink-0" />
                      {t("knowledge.review.conflict.valueUnavailable")}
                    </div>
                  ) : null}
                  {candidate.evidence.length > 0 ? (
                    <div className="mt-3 border-t border-white/10 pt-2">
                      {candidate.evidence.map((link) => (
                        <p
                          key={link.evidence.id}
                          className="mt-1 break-words text-[11px] text-zinc-500 first:mt-0"
                        >
                          {link.evidence.safeLabel}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {!hasReadableConflictValues(conflict.conflict) ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs leading-5 text-amber-200">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("knowledge.review.conflict.resolveUnavailable")}
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  function RestrictedNotice() {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-3 py-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-200">
            {t("knowledge.review.restricted.title")}
          </p>
          <p className="mt-0.5 text-xs text-amber-200/65">
            {t("knowledge.review.restricted.body")}
          </p>
        </div>
      </div>
    );
  }

  function ChangedNotice() {
    return (
      <div
        className="mt-4 flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/[0.07] px-3 py-3"
        role="alert"
      >
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div>
          <p className="text-sm font-medium text-sky-200">{t("knowledge.review.changed.title")}</p>
          <p className="mt-0.5 text-xs text-sky-200/65">{t("knowledge.review.changed.body")}</p>
        </div>
      </div>
    );
  }

  function ActionError({ error }: { error: ApiClientError }) {
    return (
      <div
        className="mt-4 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-3 text-sm text-rose-200"
        role="alert"
      >
        {error.message || t("knowledge.review.error.action")}
        {error.requestId ? (
          <p className="mt-1 text-xs text-rose-200/55">
            {t("knowledge.common.request", { id: error.requestId })}
          </p>
        ) : null}
      </div>
    );
  }

  function DetailField({ label, value }: { label: string; value: string }) {
    return (
      <div className="min-w-0">
        <p className="text-xs text-zinc-600">{label}</p>
        <p className="mt-1 break-words text-sm text-zinc-300">{value}</p>
      </div>
    );
  }

  function DecisionModal({
    open,
    mode,
    action,
    conflictResolution,
    rationale,
    rationaleError,
    staleReloaded,
    latestTitle,
    latestSummary,
    availableConflictResolutions,
    error,
    busy,
    onOpenChange,
    onActionChange,
    onResolutionChange,
    onRationaleChange,
    onSubmit,
  }: {
    open: boolean;
    mode: DecisionMode;
    action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
    conflictResolution: KnowledgeV2ConflictDecision;
    rationale: string;
    rationaleError: boolean;
    staleReloaded: boolean;
    latestTitle: string | null;
    latestSummary: string | null;
    availableConflictResolutions: readonly KnowledgeV2ConflictDecision[];
    error: ApiClientError | null;
    busy: boolean;
    onOpenChange: (open: boolean) => void;
    onActionChange: (action: Exclude<KnowledgeV2ReviewAction, "DISMISS">) => void;
    onResolutionChange: (resolution: KnowledgeV2ConflictDecision) => void;
    onRationaleChange: (value: string) => void;
    onSubmit: () => void;
  }) {
    const dismissing = mode === "DISMISS";
    const resolvingConflict = mode === "CONFLICT_RESOLVE";
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={t(
          resolvingConflict
            ? "knowledge.review.conflict.resolveTitle"
            : dismissing
              ? "knowledge.review.dismiss.title"
              : "knowledge.review.resolve.title",
        )}
        description={t(
          dismissing
            ? "knowledge.review.dismiss.description"
            : "knowledge.review.resolve.description",
        )}
        className="max-w-xl rounded-lg"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              disabled={busy}
              className={dismissing ? "bg-rose-500 text-white hover:bg-rose-600" : ""}
              onClick={onSubmit}
              data-testid="knowledge-review-confirm-decision"
            >
              {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t(
                resolvingConflict
                  ? "knowledge.review.conflict.resolve"
                  : dismissing
                    ? "knowledge.review.action.dismiss"
                    : "knowledge.review.action.resolve",
              )}
            </Button>
          </>
        }
      >
        <div className="min-w-0 space-y-4">
          {staleReloaded ? <ChangedNotice /> : null}
          {staleReloaded && latestTitle ? (
            <div className="rounded-md border border-sky-500/20 bg-sky-500/[0.04] px-3 py-3">
              <p className="text-xs font-medium text-sky-300">
                {t("knowledge.review.changed.latest")}
              </p>
              <p className="mt-1.5 break-words text-sm font-medium text-zinc-200">{latestTitle}</p>
              {latestSummary ? (
                <p className="mt-1 break-words text-xs leading-5 text-zinc-500">{latestSummary}</p>
              ) : null}
            </div>
          ) : null}
          {error ? <ActionError error={error} /> : null}
          {!dismissing ? (
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t(
                  resolvingConflict
                    ? "knowledge.review.conflict.resolutionLabel"
                    : "knowledge.review.resolve.actionLabel",
                )}
              </span>
              <Select
                value={resolvingConflict ? conflictResolution : action}
                onValueChange={(value) => {
                  if (resolvingConflict) onResolutionChange(value as typeof conflictResolution);
                  else onActionChange(value as typeof action);
                }}
                ariaLabel={t(
                  resolvingConflict
                    ? "knowledge.review.conflict.resolutionLabel"
                    : "knowledge.review.resolve.actionLabel",
                )}
                className="rounded-md"
                options={
                  resolvingConflict
                    ? availableConflictResolutions.map((value) => ({
                        value,
                        label: t(resolutionKeys[value]),
                      }))
                    : reviewActions.map((value) => ({ value, label: t(actionKeys[value]) }))
                }
              />
            </label>
          ) : null}
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t("knowledge.review.resolve.rationaleLabel")}
            </span>
            <textarea
              value={rationale}
              onChange={(event) => onRationaleChange(event.target.value)}
              aria-invalid={rationaleError}
              aria-describedby={rationaleError ? "knowledge-review-rationale-error" : undefined}
              placeholder={t("knowledge.review.resolve.rationalePlaceholder")}
              className={textareaClass}
              data-testid="knowledge-review-rationale"
            />
            {rationaleError ? (
              <span
                id="knowledge-review-rationale-error"
                className="mt-1.5 block text-xs text-rose-400"
              >
                {t("knowledge.review.validation.rationale")}
              </span>
            ) : null}
          </label>
        </div>
      </Modal>
    );
  }

  function BulkReviewModal({
    open,
    preview,
    error,
    busy,
    action,
    onOpenChange,
    onPreview,
    onConfirm,
  }: {
    open: boolean;
    preview: KnowledgeV2BulkReviewPreviewView | null;
    error: ApiClientError | null;
    busy: "preview" | "execute" | null;
    action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
    onOpenChange: (open: boolean) => void;
    onPreview: () => void;
    onConfirm: () => void;
  }) {
    const eligibleCount = preview?.items.filter((item) => item.eligible).length ?? 0;
    const ineligibleCount = (preview?.items.length ?? 0) - eligibleCount;
    const errorMessage = error
      ? error.code === "KNOWLEDGE_CONFLICT_BULK_REVIEW_PREVIEW_EXPIRED"
        ? t("knowledge.review.bulk.expired")
        : error.status === 412 || error.code === "REVISION_CONFLICT"
          ? t("knowledge.review.bulk.stale")
          : error.message || t("knowledge.review.bulk.errorExecute")
      : null;
    const canConfirm = Boolean(
      preview?.eligible && preview.previewHash && preview.expiresAt && !error,
    );
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={t("knowledge.review.bulk.modalTitle")}
        description={t("knowledge.review.bulk.modalDescription")}
        className="max-w-2xl rounded-lg"
        footer={
          <>
            <Button variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>
              {t("knowledge.common.cancel")}
            </Button>
            {!canConfirm ? (
              <Button disabled={busy !== null || bulkSelectedIds.length === 0} onClick={onPreview}>
                {busy === "preview" ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t("knowledge.review.bulk.previewAgain")}
              </Button>
            ) : (
              <Button
                disabled={busy !== null}
                onClick={onConfirm}
                data-testid="knowledge-review-bulk-confirm"
              >
                {busy === "execute" ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t("knowledge.review.bulk.confirm")}
              </Button>
            )}
          </>
        }
      >
        <div className="min-w-0 space-y-4" data-testid="knowledge-review-bulk-modal">
          <div className="flex min-w-0 flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-zinc-500">{t("knowledge.review.bulk.actionLabel")}</p>
              <p className="mt-1 break-words text-sm font-medium text-zinc-100">
                {t(actionKeys[action])}
              </p>
            </div>
            {preview ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
                  {t("knowledge.review.bulk.eligibleCount", {
                    count: formatNumber(eligibleCount),
                  })}
                </span>
                {ineligibleCount > 0 ? (
                  <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">
                    {t("knowledge.review.bulk.ineligibleCount", {
                      count: formatNumber(ineligibleCount),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {errorMessage ? (
            <div
              className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-3 text-sm text-rose-200"
              role="alert"
              data-testid="knowledge-review-bulk-error"
            >
              {errorMessage}
            </div>
          ) : null}
          {preview ? (
            <div className="max-h-[min(50vh,440px)] min-w-0 space-y-2 overflow-y-auto pr-1">
              {preview.items.map((previewItem) => {
                const row = items.find((item) => item.id === previewItem.id);
                return (
                  <div
                    key={previewItem.id}
                    className={cn(
                      "min-w-0 rounded-md border px-3 py-3",
                      previewItem.eligible
                        ? "border-emerald-500/20 bg-emerald-500/[0.04]"
                        : "border-amber-500/20 bg-amber-500/[0.05]",
                    )}
                    data-testid={`knowledge-review-bulk-result-${previewItem.id}`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {previewItem.eligible ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      )}
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-zinc-200">
                          {row?.safeTitle ?? t("knowledge.review.bulk.itemUnavailable")}
                        </p>
                        {previewItem.reasons.length > 0 ? (
                          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-amber-200/80">
                            {previewItem.reasons.map((reason) => (
                              <li key={reason}>{t(bulkReasonKeys[reason])}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }
}

function QueueError({
  error,
  fallback,
  onRetry,
}: {
  error: ApiClientError;
  fallback: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/10">
        <AlertTriangle className="h-5 w-5 text-rose-400" />
      </div>
      <p className="mt-4 text-sm font-medium text-zinc-200">{error.message || fallback}</p>
      {error.requestId ? (
        <p className="mt-1 text-xs text-zinc-600">
          {t("knowledge.common.request", { id: error.requestId })}
        </p>
      ) : null}
      <Button variant="outline" className="mt-4" onClick={onRetry}>
        {t("knowledge.common.tryAgain")}
      </Button>
    </div>
  );
}
