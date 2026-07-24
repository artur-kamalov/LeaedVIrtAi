"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  BookOpenCheck,
  Check,
  FileCheck2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import type {
  KnowledgeV2ApproverRole,
  KnowledgeV2GuidanceCondition,
  KnowledgeV2GuidanceConditionField,
  KnowledgeV2GuidanceConditionOperator,
  KnowledgeV2GuidanceReviewStatus,
  KnowledgeV2GuidanceRuleType,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import { ApiClientError } from "@/lib/api/client";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";
import {
  approveKnowledgeV2GuidanceRule,
  createKnowledgeV2GuidanceRule,
  createKnowledgeV2IdempotencyKey,
  disableKnowledgeV2GuidanceRule,
  listKnowledgeV2Guidance,
  rejectKnowledgeV2GuidanceRule,
  updateKnowledgeV2GuidanceRule,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { findKnowledgeDataElement } from "./knowledge-dom";
import { ConfirmDialog, EmptyState, Modal, Select, Spinner } from "../ui";

const ruleTypes: KnowledgeV2GuidanceRuleType[] = [
  "RESPONSE",
  "PROHIBITION",
  "ESCALATION",
  "APPROVAL",
  "TOOL_USE",
  "STYLE",
];
const reviewStatuses: KnowledgeV2GuidanceReviewStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "DISABLED",
];
const riskLevels: KnowledgeV2RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const conditionFields: KnowledgeV2GuidanceConditionField[] = [
  "INTENT",
  "CHANNEL",
  "LOCALE",
  "LOCATION",
  "BUSINESS_HOURS",
  "CUSTOMER_AUTHORIZATION",
  "LEAD_STAGE",
  "TOOL_RESULT",
];
const conditionOperators: KnowledgeV2GuidanceConditionOperator[] = [
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "EXISTS",
  "GREATER_THAN",
  "LESS_THAN",
];
const approverRoles: KnowledgeV2ApproverRole[] = ["OWNER", "ADMIN", "MANAGER"];

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

const ruleTypeKeys: Record<KnowledgeV2GuidanceRuleType, TranslationKey> = {
  RESPONSE: "knowledge.guidance.type.response",
  PROHIBITION: "knowledge.guidance.type.prohibition",
  ESCALATION: "knowledge.guidance.type.escalation",
  APPROVAL: "knowledge.guidance.type.approval",
  TOOL_USE: "knowledge.guidance.type.toolUse",
  STYLE: "knowledge.guidance.type.style",
};
const reviewKeys: Record<KnowledgeV2GuidanceReviewStatus, TranslationKey> = {
  DRAFT: "knowledge.guidance.review.draft",
  PENDING_REVIEW: "knowledge.guidance.review.pendingReview",
  APPROVED: "knowledge.guidance.review.approved",
  REJECTED: "knowledge.guidance.review.rejected",
  DISABLED: "knowledge.guidance.review.disabled",
};
const riskKeys: Record<KnowledgeV2RiskLevel, TranslationKey> = {
  LOW: "knowledge.guidance.risk.low",
  MEDIUM: "knowledge.guidance.risk.medium",
  HIGH: "knowledge.guidance.risk.high",
  CRITICAL: "knowledge.guidance.risk.critical",
};
const conditionFieldKeys: Record<KnowledgeV2GuidanceConditionField, TranslationKey> = {
  INTENT: "knowledge.guidance.field.intent",
  CHANNEL: "knowledge.guidance.field.channel",
  LOCALE: "knowledge.guidance.field.locale",
  LOCATION: "knowledge.guidance.field.location",
  BUSINESS_HOURS: "knowledge.guidance.field.businessHours",
  CUSTOMER_AUTHORIZATION: "knowledge.guidance.field.customerAuthorization",
  LEAD_STAGE: "knowledge.guidance.field.leadStage",
  TOOL_RESULT: "knowledge.guidance.field.toolResult",
};
const conditionOperatorKeys: Record<KnowledgeV2GuidanceConditionOperator, TranslationKey> = {
  EQUALS: "knowledge.guidance.operator.equals",
  NOT_EQUALS: "knowledge.guidance.operator.notEquals",
  IN: "knowledge.guidance.operator.in",
  NOT_IN: "knowledge.guidance.operator.notIn",
  CONTAINS: "knowledge.guidance.operator.contains",
  EXISTS: "knowledge.guidance.operator.exists",
  GREATER_THAN: "knowledge.guidance.operator.greaterThan",
  LESS_THAN: "knowledge.guidance.operator.lessThan",
};
const approverKeys: Record<KnowledgeV2ApproverRole, TranslationKey> = {
  OWNER: "knowledge.guidance.approver.owner",
  ADMIN: "knowledge.guidance.approver.admin",
  MANAGER: "knowledge.guidance.approver.manager",
};

type ConditionMode = "ALL" | "PREDICATE" | "EXISTING";
type EditorState = { mode: "create" } | { mode: "edit"; rule: KnowledgeV2GuidanceRuleView };
type DecisionAction = "APPROVE" | "REJECT" | "DISABLE";
type ConfirmState = {
  action: Extract<DecisionAction, "REJECT" | "DISABLE">;
  rule: KnowledgeV2GuidanceRuleView;
};

interface GuidanceFormState {
  title: string;
  type: KnowledgeV2GuidanceRuleType;
  instruction: string;
  conditionMode: ConditionMode;
  conditionField: KnowledgeV2GuidanceConditionField;
  conditionOperator: KnowledgeV2GuidanceConditionOperator;
  conditionValue: string;
  conditionDirty: boolean;
  priority: string;
  riskLevel: KnowledgeV2RiskLevel;
  requiredApproverRole: KnowledgeV2ApproverRole | "NONE";
  effectiveUntil: string;
  effectiveUntilDirty: boolean;
  examples: string;
}

const emptyForm: GuidanceFormState = {
  title: "",
  type: "RESPONSE",
  instruction: "",
  conditionMode: "ALL",
  conditionField: "INTENT",
  conditionOperator: "EQUALS",
  conditionValue: "",
  conditionDirty: true,
  priority: "0",
  riskLevel: "LOW",
  requiredApproverRole: "NONE",
  effectiveUntil: "",
  effectiveUntilDirty: true,
  examples: "",
};

const inputClass =
  "h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 max-sm:min-h-11";
const textareaClass = cn(inputClass, "h-auto min-h-24 resize-y py-2.5 leading-relaxed");

function displayConditionValue(value: unknown, t?: Translate): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => displayConditionValue(item, t)).join(", ");
  return t ? t("knowledge.guidance.value.configured") : "";
}

function conditionValueText(
  condition: Extract<KnowledgeV2GuidanceCondition, { kind: "PREDICATE" }>,
) {
  if (condition.operator === "EXISTS" || condition.value === undefined) return "";
  if (Array.isArray(condition.value)) {
    return condition.value.map((item) => displayConditionValue(item)).join(", ");
  }
  if (typeof condition.value === "object" && condition.value !== null) return "";
  return displayConditionValue(condition.value);
}

function dateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function effectiveUntilIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formForRule(rule: KnowledgeV2GuidanceRuleView): GuidanceFormState {
  const predicate = rule.condition.kind === "PREDICATE" ? rule.condition : null;
  const noCondition = rule.condition.kind === "ALL" && rule.condition.conditions.length === 0;
  const approver = rule.requiredApproverRole ?? "NONE";
  return {
    title: rule.title,
    type: rule.type,
    instruction: rule.instruction,
    conditionMode: predicate ? "PREDICATE" : noCondition ? "ALL" : "EXISTING",
    conditionField: predicate?.field ?? "INTENT",
    conditionOperator: predicate?.operator ?? "EQUALS",
    conditionValue: predicate ? conditionValueText(predicate) : "",
    conditionDirty: false,
    priority: String(rule.priority),
    riskLevel: rule.riskLevel,
    requiredApproverRole:
      isHighRisk(rule) && approver !== "OWNER" && approver !== "ADMIN" ? "OWNER" : approver,
    effectiveUntil: dateInputValue(rule.effectiveUntil),
    effectiveUntilDirty: false,
    examples: rule.examples.join("\n"),
  };
}

function examplesFromText(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function createTieBreakKey(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ".")
    .replace(/^\.+|\.+$/gu, "")
    .slice(0, 72);
  return `ui.${slug || "rule"}.${Date.now().toString(36)}`;
}

function conditionFromForm(
  form: GuidanceFormState,
  current?: KnowledgeV2GuidanceRuleView,
): KnowledgeV2GuidanceCondition {
  if (current && !form.conditionDirty) return current.condition;
  if (form.conditionMode === "ALL") return { kind: "ALL", conditions: [] };
  if (form.conditionMode === "EXISTING" && current) return current.condition;

  const base = {
    kind: "PREDICATE" as const,
    field: form.conditionField,
    operator: form.conditionOperator,
  };
  if (form.conditionOperator === "EXISTS") return base;
  if (form.conditionOperator === "IN" || form.conditionOperator === "NOT_IN") {
    const values = [
      ...new Set(
        form.conditionValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    return { ...base, value: values };
  }
  if (form.conditionOperator === "GREATER_THAN" || form.conditionOperator === "LESS_THAN") {
    return { ...base, value: Number(form.conditionValue) };
  }
  return { ...base, value: form.conditionValue.trim() };
}

function validateForm(form: GuidanceFormState, t: Translate) {
  const errors: Record<string, string> = {};
  if (form.title.trim().length < 2) errors.title = t("knowledge.guidance.validation.title");
  if (!form.instruction.trim()) errors.instruction = t("knowledge.guidance.validation.instruction");

  const priority = Number(form.priority);
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
    errors.priority = t("knowledge.guidance.validation.priority");
  }

  if (form.conditionMode === "PREDICATE" && form.conditionOperator !== "EXISTS") {
    const value = form.conditionValue.trim();
    if (!value) errors.condition = t("knowledge.guidance.validation.conditionValue");
    if (
      (form.conditionOperator === "GREATER_THAN" || form.conditionOperator === "LESS_THAN") &&
      !Number.isFinite(Number(value))
    ) {
      errors.condition = t("knowledge.guidance.validation.conditionNumber");
    }
    if (
      (form.conditionOperator === "IN" || form.conditionOperator === "NOT_IN") &&
      !value.split(",").some((item) => item.trim())
    ) {
      errors.condition = t("knowledge.guidance.validation.conditionList");
    }
  }

  const examples = examplesFromText(form.examples);
  if (examples.length > 20) errors.examples = t("knowledge.guidance.validation.examplesCount");
  const longExample = examples.find((example) => example.length > 1000);
  if (longExample) errors.examples = t("knowledge.guidance.validation.exampleLength");

  const expiry = form.effectiveUntil ? effectiveUntilIso(form.effectiveUntil) : null;
  if (form.effectiveUntil && !expiry)
    errors.effectiveUntil = t("knowledge.guidance.validation.expiryInvalid");
  if (isHighRisk(form)) {
    if (!expiry || new Date(expiry).getTime() <= Date.now()) {
      errors.effectiveUntil = t("knowledge.guidance.validation.highRiskExpiry");
    }
    if (form.requiredApproverRole !== "OWNER" && form.requiredApproverRole !== "ADMIN") {
      errors.requiredApproverRole = t("knowledge.guidance.validation.highRiskApprover");
    }
  }
  return errors;
}

function fieldError(errors: Record<string, string>, field: string) {
  if (errors[field]) return errors[field];
  const match = Object.entries(errors).find(
    ([key]) => key.startsWith(`${field}.`) || key.endsWith(`.${field}`),
  );
  return match?.[1];
}

function errorFields(error: ApiClientError) {
  const fields: Record<string, string> = {};
  for (const item of error.fieldErrors ?? []) fields[item.field] = item.message;
  if (error.field && !fields[error.field]) fields[error.field] = error.message;
  return fields;
}

function responseRule(response: Awaited<ReturnType<typeof createKnowledgeV2GuidanceRule>>) {
  const etag = response.headers.get("etag");
  return etag ? { ...response.data.resource, etag } : response.data.resource;
}

function isHighRisk(rule: Pick<KnowledgeV2GuidanceRuleView, "riskLevel">) {
  return rule.riskLevel === "HIGH" || rule.riskLevel === "CRITICAL";
}

function scopeLabel(rule: KnowledgeV2GuidanceRuleView, t: Translate) {
  const scope = rule.scope;
  const parts = [
    scope.brandIds.length
      ? t(
          scope.brandIds.length === 1
            ? "knowledge.guidance.scope.brand.one"
            : "knowledge.guidance.scope.brand.many",
          { count: scope.brandIds.length },
        )
      : "",
    scope.locationIds.length
      ? t(
          scope.locationIds.length === 1
            ? "knowledge.guidance.scope.location.one"
            : "knowledge.guidance.scope.location.many",
          { count: scope.locationIds.length },
        )
      : "",
    scope.channelTypes.length
      ? t(
          scope.channelTypes.length === 1
            ? "knowledge.guidance.scope.channel.one"
            : "knowledge.guidance.scope.channel.many",
          { count: scope.channelTypes.length },
        )
      : "",
    scope.audiences.length
      ? t(
          scope.audiences.length === 1
            ? "knowledge.guidance.scope.audience.one"
            : "knowledge.guidance.scope.audience.many",
          { count: scope.audiences.length },
        )
      : "",
    scope.locales.length
      ? t(
          scope.locales.length === 1
            ? "knowledge.guidance.scope.locale.one"
            : "knowledge.guidance.scope.locale.many",
          { count: scope.locales.length },
        )
      : "",
  ].filter(Boolean);
  return parts.length
    ? parts.join(" · ")
    : scope.usesTenantDefault
      ? t("knowledge.guidance.scope.workspaceDefault")
      : t("knowledge.guidance.scope.all");
}

function conditionLabel(condition: KnowledgeV2GuidanceCondition, t: Translate): string {
  if (condition.kind === "ALL" && condition.conditions.length === 0)
    return t("knowledge.guidance.condition.always");
  if (condition.kind === "PREDICATE") {
    const value = condition.value;
    const valueLabel = value === undefined ? "" : displayConditionValue(value, t);
    return valueLabel
      ? t("knowledge.guidance.condition.withValue", {
          field: t(conditionFieldKeys[condition.field]),
          operator: t(conditionOperatorKeys[condition.operator]),
          value: valueLabel,
        })
      : t("knowledge.guidance.condition.withoutValue", {
          field: t(conditionFieldKeys[condition.field]),
          operator: t(conditionOperatorKeys[condition.operator]),
        });
  }
  if (condition.kind === "NOT")
    return t("knowledge.guidance.condition.not", {
      condition: conditionLabel(condition.condition, t),
    });
  const count = condition.conditions.length;
  return t(
    count === 1
      ? "knowledge.guidance.condition.group.one"
      : "knowledge.guidance.condition.group.many",
    {
      kind: t(
        condition.kind === "ALL"
          ? "knowledge.guidance.condition.kind.all"
          : "knowledge.guidance.condition.kind.any",
      ),
      count,
    },
  );
}

const reviewStyles: Record<KnowledgeV2GuidanceReviewStatus, string> = {
  DRAFT: "border-zinc-600/40 bg-zinc-500/10 text-zinc-300",
  PENDING_REVIEW: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  DISABLED: "border-zinc-700 bg-zinc-800/70 text-zinc-500",
};

const riskStyles: Record<KnowledgeV2RiskLevel, string> = {
  LOW: "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300",
  MEDIUM: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
  HIGH: "border-orange-500/25 bg-orange-500/[0.08] text-orange-300",
  CRITICAL: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

export function GuidanceEditor({
  canEdit,
  canVerifyHighRisk,
  onChanged,
}: {
  canEdit: boolean;
  canVerifyHighRisk: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const focusedRuleId = searchParams.get("ruleId");
  const [rules, setRules] = React.useState<KnowledgeV2GuidanceRuleView[]>([]);
  const [searchInput, setSearchInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<KnowledgeV2GuidanceRuleType | "ALL">("ALL");
  const [reviewFilter, setReviewFilter] = React.useState<KnowledgeV2GuidanceReviewStatus | "ALL">(
    "ALL",
  );
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<ApiClientError | null>(null);
  const [mutationError, setMutationError] = React.useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [form, setForm] = React.useState<GuidanceFormState>(emptyForm);
  const [saving, setSaving] = React.useState(false);
  const [decisionBusy, setDecisionBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);
  const requestSequence = React.useRef(0);
  const deepLinkRequest = React.useRef(0);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const listQuery = React.useCallback(
    (cursor?: string) => ({
      limit: 100,
      ...(cursor ? { cursor } : {}),
      ...(query ? { query } : {}),
      ...(typeFilter === "ALL" ? {} : { type: typeFilter }),
      ...(reviewFilter === "ALL" ? {} : { reviewStatus: reviewFilter }),
    }),
    [query, reviewFilter, typeFilter],
  );

  const loadRules = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setNextCursor(null);
    setLoadError(null);
    try {
      const page = await listKnowledgeV2Guidance(listQuery());
      if (sequence !== requestSequence.current) return;
      setRules(page.items);
      setNextCursor(page.pageInfo.nextCursor);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setLoadError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("knowledge.guidance.error.load"), 500),
      );
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [listQuery, t]);

  React.useEffect(() => {
    void loadRules();
  }, [loadRules]);

  React.useEffect(() => {
    if (!focusedRuleId) return;
    setSearchInput("");
    setQuery("");
    setTypeFilter("ALL");
    setReviewFilter("ALL");
  }, [focusedRuleId]);

  React.useEffect(() => {
    if (!focusedRuleId || loading || query || typeFilter !== "ALL" || reviewFilter !== "ALL") {
      return;
    }
    const sequence = ++deepLinkRequest.current;
    const existing = rules.find((rule) => rule.id === focusedRuleId);
    void (async () => {
      const rule = existing ?? (await findCurrentRule(focusedRuleId));
      if (sequence !== deepLinkRequest.current || !rule) return;
      if (!existing)
        setRules((current) => [rule, ...current.filter((item) => item.id !== rule.id)]);
      window.requestAnimationFrame(() => {
        const target = findKnowledgeDataElement("data-guidance-rule-id", focusedRuleId);
        target?.scrollIntoView({ block: "center" });
        target?.focus();
      });
    })();
  }, [focusedRuleId, loading, query, reviewFilter, rules, typeFilter]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await listKnowledgeV2Guidance(listQuery(nextCursor));
      setRules((current) => {
        const known = new Set(current.map((rule) => rule.id));
        return [...current, ...page.items.filter((rule) => !known.has(rule.id))];
      });
      setNextCursor(page.pageInfo.nextCursor);
    } catch (caught) {
      setLoadError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("knowledge.guidance.error.loadMore"), 500),
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function openCreate() {
    if (!canEdit) return;
    setEditor({ mode: "create" });
    setForm({ ...emptyForm });
    setMutationError(null);
    setFieldErrors({});
  }

  function openEdit(rule: KnowledgeV2GuidanceRuleView) {
    if (!canEdit || !rule.allowedActions.includes("EDIT")) return;
    setEditor({ mode: "edit", rule });
    setForm(formForRule(rule));
    setMutationError(null);
    setFieldErrors({});
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
    setMutationError(null);
    setFieldErrors({});
  }

  function updateForm<K extends keyof GuidanceFormState>(key: K, value: GuidanceFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateCondition<K extends keyof GuidanceFormState>(key: K, value: GuidanceFormState[K]) {
    setForm((current) => ({ ...current, [key]: value, conditionDirty: true }));
  }

  function updateRisk(riskLevel: KnowledgeV2RiskLevel) {
    setForm((current) => ({
      ...current,
      riskLevel,
      ...((riskLevel === "HIGH" || riskLevel === "CRITICAL") &&
      current.requiredApproverRole !== "OWNER" &&
      current.requiredApproverRole !== "ADMIN"
        ? { requiredApproverRole: "OWNER" as const }
        : {}),
    }));
  }

  function updateEffectiveUntil(value: string) {
    setForm((current) => ({ ...current, effectiveUntil: value, effectiveUntilDirty: true }));
  }

  function acceptRule(rule: KnowledgeV2GuidanceRuleView) {
    requestSequence.current += 1;
    setRules((current) => [rule, ...current.filter((item) => item.id !== rule.id)]);
    void loadRules();
    void Promise.resolve(onChanged?.()).catch(() => undefined);
  }

  async function findCurrentRule(ruleId: string) {
    let cursor: string | undefined;
    do {
      const page = await listKnowledgeV2Guidance({ limit: 100, ...(cursor ? { cursor } : {}) });
      const current = page.items.find((rule) => rule.id === ruleId);
      if (current) return current;
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return null;
  }

  async function reloadConflict(ruleId: string) {
    try {
      const current = await findCurrentRule(ruleId);
      if (current) {
        setRules((items) => [current, ...items.filter((item) => item.id !== current.id)]);
        if (editor?.mode === "edit" && editor.rule.id === current.id) {
          setForm(formForRule(current));
          setEditor({ mode: "edit", rule: current });
        }
      }
      setMutationError(
        new ApiClientError(
          current
            ? t("knowledge.guidance.error.conflictReloaded")
            : t("knowledge.guidance.error.conflictMissing"),
          412,
          "REVISION_CONFLICT",
        ),
      );
    } catch (caught) {
      setMutationError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("knowledge.guidance.error.reload"), 500),
      );
    }
  }

  async function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !canEdit || saving) return;

    const validationErrors = validateForm(form, t);
    setFieldErrors(validationErrors);
    setMutationError(null);
    setNotice(null);
    if (Object.keys(validationErrors).length) return;

    setSaving(true);
    try {
      const current = editor.mode === "edit" ? editor.rule : undefined;
      const effectiveUntil =
        current && !form.effectiveUntilDirty
          ? (current.effectiveUntil ?? null)
          : form.effectiveUntil
            ? effectiveUntilIso(form.effectiveUntil)
            : null;
      const common = {
        title: form.title.trim(),
        type: form.type,
        condition: conditionFromForm(form, current),
        instruction: form.instruction.trim(),
        priority: Number(form.priority),
        riskLevel: form.riskLevel,
        requiredApproverRole:
          form.requiredApproverRole === "NONE" ? null : form.requiredApproverRole,
        effectiveUntil,
        examples: examplesFromText(form.examples),
      };
      const idempotencyKey = createKnowledgeV2IdempotencyKey();
      const response =
        editor.mode === "create"
          ? await createKnowledgeV2GuidanceRule(
              { ...common, tieBreakKey: createTieBreakKey(common.title) },
              { "Idempotency-Key": idempotencyKey },
            )
          : await updateKnowledgeV2GuidanceRule(
              editor.rule.id,
              {
                ...common,
                tieBreakKey: editor.rule.tieBreakKey,
                changeReason: "Updated in the Knowledge guidance editor.",
              },
              { "Idempotency-Key": idempotencyKey, "If-Match": editor.rule.etag },
            );
      const rule = responseRule(response);
      acceptRule(rule);
      setNotice(
        editor.mode === "create"
          ? t("knowledge.guidance.notice.created")
          : t("knowledge.guidance.notice.saved"),
      );
      setEditor(null);
      setFieldErrors({});
    } catch (caught) {
      const error =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("knowledge.guidance.error.save"), 500);
      if (error.status === 412 && editor.mode === "edit") {
        await reloadConflict(editor.rule.id);
      } else {
        setMutationError(error);
        setFieldErrors(errorFields(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function decide(rule: KnowledgeV2GuidanceRuleView, action: DecisionAction) {
    if (!canEdit || decisionBusy || !rule.allowedActions.includes(action)) return;
    if (action === "APPROVE" && isHighRisk(rule) && !canVerifyHighRisk) return;

    setDecisionBusy(`${rule.id}:${action}`);
    setMutationError(null);
    setNotice(null);
    try {
      const headers = {
        "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        "If-Match": rule.etag,
      };
      const response =
        action === "APPROVE"
          ? await approveKnowledgeV2GuidanceRule(
              rule.id,
              { note: "Approved in the Knowledge guidance editor." },
              headers,
            )
          : action === "REJECT"
            ? await rejectKnowledgeV2GuidanceRule(
                rule.id,
                { note: "Rejected in the Knowledge guidance editor." },
                headers,
              )
            : await disableKnowledgeV2GuidanceRule(
                rule.id,
                { note: "Disabled in the Knowledge guidance editor." },
                headers,
              );
      acceptRule(responseRule(response));
      setNotice(
        action === "APPROVE"
          ? t("knowledge.guidance.notice.approved")
          : action === "REJECT"
            ? t("knowledge.guidance.notice.rejected")
            : t("knowledge.guidance.notice.disabled"),
      );
    } catch (caught) {
      const error =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("knowledge.guidance.error.decision"), 500);
      if (error.status === 412) await reloadConflict(rule.id);
      else setMutationError(error);
    } finally {
      setDecisionBusy(null);
    }
  }

  const hasFilters = Boolean(query || typeFilter !== "ALL" || reviewFilter !== "ALL");

  return (
    <section className="space-y-4" data-testid="knowledge-guidance-editor">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t("knowledge.guidance.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("knowledge.guidance.description")}</p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={openCreate} data-testid="guidance-create">
            <Plus className="mr-1.5 h-4 w-4" />
            {t("knowledge.guidance.newRule")}
          </Button>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-200">
              {t("knowledge.guidance.readOnly.title")}
            </p>
            <p className="mt-0.5 text-xs text-amber-200/65">
              {t("knowledge.guidance.readOnly.description")}
            </p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-200">
          <Check className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      {mutationError && !editor ? (
        <ErrorBanner error={mutationError} onDismiss={() => setMutationError(null)} />
      ) : null}

      <div className="grid gap-2 rounded-lg border border-white/10 bg-zinc-950/30 p-3 md:grid-cols-[minmax(220px,1fr)_190px_190px_auto]">
        <label className="relative block">
          <span className="sr-only">{t("knowledge.guidance.search.label")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("knowledge.guidance.search.placeholder")}
            className={cn(inputClass, "pl-9")}
          />
        </label>
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value as KnowledgeV2GuidanceRuleType | "ALL")}
          ariaLabel={t("knowledge.guidance.filter.typesAria")}
          className="h-10 rounded-lg"
          options={[
            { value: "ALL", label: t("knowledge.guidance.filter.typesAll") },
            ...ruleTypes.map((value) => ({ value, label: t(ruleTypeKeys[value]) })),
          ]}
        />
        <Select
          value={reviewFilter}
          onValueChange={(value) =>
            setReviewFilter(value as KnowledgeV2GuidanceReviewStatus | "ALL")
          }
          ariaLabel={t("knowledge.guidance.filter.reviewsAria")}
          className="h-10 rounded-lg"
          options={[
            { value: "ALL", label: t("knowledge.guidance.filter.reviewsAll") },
            ...reviewStatuses.map((value) => ({ value, label: t(reviewKeys[value]) })),
          ]}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label={t("knowledge.guidance.refresh")}
          disabled={loading}
          onClick={() => void loadRules()}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loadError ? (
        <div className="flex flex-col gap-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-rose-200">{loadError.message}</p>
            {loadError.requestId ? (
              <p className="mt-0.5 text-xs text-rose-300/50">
                {t("knowledge.guidance.request", { requestId: loadError.requestId })}
              </p>
            ) : null}
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadRules()}>
            {t("knowledge.guidance.retry")}
          </Button>
        </div>
      ) : null}

      {loading && rules.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-white/10 bg-zinc-950/20">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner className="h-5 w-5" />
            {t("knowledge.guidance.loading")}
          </div>
        </div>
      ) : null}

      {!loading && rules.length === 0 && !loadError ? (
        <div className="rounded-lg border border-white/10 bg-zinc-950/20">
          <EmptyState
            icon={hasFilters ? SlidersHorizontal : BookOpenCheck}
            title={
              hasFilters
                ? t("knowledge.guidance.empty.filteredTitle")
                : t("knowledge.guidance.empty.title")
            }
            description={
              hasFilters
                ? t("knowledge.guidance.empty.filteredDescription")
                : t("knowledge.guidance.empty.description")
            }
            action={
              canEdit && !hasFilters ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("knowledge.guidance.newRule")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950/20">
          {rules.map((rule) => (
            <GuidanceRow
              key={rule.id}
              rule={rule}
              canEdit={canEdit}
              canVerifyHighRisk={canVerifyHighRisk}
              busy={decisionBusy}
              focused={focusedRuleId === rule.id}
              onEdit={() => openEdit(rule)}
              onApprove={() => void decide(rule, "APPROVE")}
              onConfirm={(action) => setConfirm({ action, rule })}
            />
          ))}
          {nextCursor ? (
            <div className="flex justify-center border-t border-white/10 px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t("knowledge.guidance.pagination.more")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={
          editor?.mode === "edit"
            ? t("knowledge.guidance.editor.editTitle")
            : t("knowledge.guidance.editor.newTitle")
        }
        description={t("knowledge.guidance.editor.description")}
        className="max-w-3xl"
        footer={
          <>
            <Button variant="outline" disabled={saving} onClick={closeEditor}>
              {t("knowledge.guidance.editor.cancel")}
            </Button>
            <Button type="submit" form="guidance-editor-form" disabled={saving || !canEdit}>
              {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {editor?.mode === "edit"
                ? t("knowledge.guidance.editor.save")
                : t("knowledge.guidance.editor.create")}
            </Button>
          </>
        }
      >
        <form
          id="guidance-editor-form"
          className="space-y-5"
          onSubmit={(event) => void saveRule(event)}
        >
          {mutationError ? <ErrorBanner error={mutationError} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t("knowledge.guidance.form.title")}
              error={fieldError(fieldErrors, "title")}
              className="sm:col-span-2"
            >
              <input
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                maxLength={160}
                placeholder={t("knowledge.guidance.form.titlePlaceholder")}
                className={inputClass}
                aria-invalid={Boolean(fieldError(fieldErrors, "title"))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.type")}
              error={fieldError(fieldErrors, "type")}
            >
              <Select
                value={form.type}
                onValueChange={(value) => updateForm("type", value as KnowledgeV2GuidanceRuleType)}
                ariaLabel={t("knowledge.guidance.form.type")}
                className="h-10 rounded-lg"
                options={ruleTypes.map((value) => ({ value, label: t(ruleTypeKeys[value]) }))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.risk")}
              error={fieldError(fieldErrors, "riskLevel")}
            >
              <Select
                value={form.riskLevel}
                onValueChange={(value) => updateRisk(value as KnowledgeV2RiskLevel)}
                ariaLabel={t("knowledge.guidance.form.risk")}
                className="h-10 rounded-lg"
                options={riskLevels.map((value) => ({ value, label: t(riskKeys[value]) }))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.instruction")}
              error={fieldError(fieldErrors, "instruction")}
              className="sm:col-span-2"
              hint={t("knowledge.guidance.form.instructionHint")}
            >
              <textarea
                value={form.instruction}
                onChange={(event) => updateForm("instruction", event.target.value)}
                maxLength={8000}
                rows={4}
                placeholder={t("knowledge.guidance.form.instructionPlaceholder")}
                className={textareaClass}
                aria-invalid={Boolean(fieldError(fieldErrors, "instruction"))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.condition")}
              error={fieldError(fieldErrors, "condition")}
              className="sm:col-span-2"
            >
              <Select
                value={form.conditionMode}
                onValueChange={(value) => updateCondition("conditionMode", value as ConditionMode)}
                ariaLabel={t("knowledge.guidance.form.condition")}
                className="h-10 rounded-lg"
                options={[
                  ...(form.conditionMode === "EXISTING"
                    ? [
                        {
                          value: "EXISTING",
                          label: t("knowledge.guidance.form.conditionKeep"),
                        },
                      ]
                    : []),
                  { value: "ALL", label: t("knowledge.guidance.form.conditionAlways") },
                  { value: "PREDICATE", label: t("knowledge.guidance.form.conditionOne") },
                ]}
              />
            </FormField>

            {form.conditionMode === "EXISTING" ? (
              <div className="sm:col-span-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-xs text-sky-200/80">
                {t("knowledge.guidance.form.conditionAdvanced")}
              </div>
            ) : null}

            {form.conditionMode === "PREDICATE" ? (
              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                <FormField label={t("knowledge.guidance.form.field")}>
                  <Select
                    value={form.conditionField}
                    onValueChange={(value) =>
                      updateCondition("conditionField", value as KnowledgeV2GuidanceConditionField)
                    }
                    ariaLabel={t("knowledge.guidance.form.field")}
                    className="h-10 rounded-lg"
                    options={conditionFields.map((value) => ({
                      value,
                      label: t(conditionFieldKeys[value]),
                    }))}
                  />
                </FormField>
                <FormField label={t("knowledge.guidance.form.operator")}>
                  <Select
                    value={form.conditionOperator}
                    onValueChange={(value) =>
                      updateCondition(
                        "conditionOperator",
                        value as KnowledgeV2GuidanceConditionOperator,
                      )
                    }
                    ariaLabel={t("knowledge.guidance.form.operator")}
                    className="h-10 rounded-lg"
                    options={conditionOperators.map((value) => ({
                      value,
                      label: t(conditionOperatorKeys[value]),
                    }))}
                  />
                </FormField>
                {form.conditionOperator !== "EXISTS" ? (
                  <FormField
                    label={t("knowledge.guidance.form.value")}
                    error={fieldError(fieldErrors, "condition")}
                    hint={
                      form.conditionOperator === "IN" || form.conditionOperator === "NOT_IN"
                        ? t("knowledge.guidance.form.listHint")
                        : undefined
                    }
                  >
                    <input
                      value={form.conditionValue}
                      onChange={(event) => updateCondition("conditionValue", event.target.value)}
                      placeholder={
                        form.conditionOperator === "IN" || form.conditionOperator === "NOT_IN"
                          ? t("knowledge.guidance.form.listPlaceholder")
                          : t("knowledge.guidance.form.valuePlaceholder")
                      }
                      className={inputClass}
                      aria-invalid={Boolean(fieldError(fieldErrors, "condition"))}
                    />
                  </FormField>
                ) : (
                  <div className="flex items-end pb-2 text-xs text-zinc-500">
                    {t("knowledge.guidance.form.existsHint")}
                  </div>
                )}
              </div>
            ) : null}

            <FormField
              label={t("knowledge.guidance.form.priority")}
              error={fieldError(fieldErrors, "priority")}
              hint={t("knowledge.guidance.form.priorityHint")}
            >
              <input
                type="number"
                min={-1000}
                max={1000}
                step={1}
                value={form.priority}
                onChange={(event) => updateForm("priority", event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldError(fieldErrors, "priority"))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.effectiveUntil")}
              error={fieldError(fieldErrors, "effectiveUntil")}
              hint={
                isHighRisk(form)
                  ? t("knowledge.guidance.form.expiryHighRiskHint")
                  : t("knowledge.guidance.form.expiryOptionalHint")
              }
            >
              <input
                type="date"
                value={form.effectiveUntil}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => updateEffectiveUntil(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldError(fieldErrors, "effectiveUntil"))}
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.approver")}
              error={fieldError(fieldErrors, "requiredApproverRole")}
              hint={
                isHighRisk(form)
                  ? t("knowledge.guidance.form.approverHighRiskHint")
                  : t("knowledge.guidance.form.approverHint")
              }
            >
              <Select
                value={form.requiredApproverRole}
                onValueChange={(value) =>
                  updateForm("requiredApproverRole", value as KnowledgeV2ApproverRole | "NONE")
                }
                ariaLabel={t("knowledge.guidance.form.approver")}
                className="h-10 rounded-lg"
                options={
                  isHighRisk(form)
                    ? approverRoles
                        .filter((value) => value === "OWNER" || value === "ADMIN")
                        .map((value) => ({ value, label: t(approverKeys[value]) }))
                    : [
                        { value: "NONE", label: t("knowledge.guidance.form.approverNone") },
                        ...approverRoles.map((value) => ({
                          value,
                          label: t(approverKeys[value]),
                        })),
                      ]
                }
              />
            </FormField>

            <FormField
              label={t("knowledge.guidance.form.examples")}
              error={fieldError(fieldErrors, "examples")}
              hint={t("knowledge.guidance.form.examplesHint")}
              className="sm:col-span-2"
            >
              <textarea
                value={form.examples}
                onChange={(event) => updateForm("examples", event.target.value)}
                rows={4}
                placeholder={t("knowledge.guidance.form.examplesPlaceholder")}
                className={textareaClass}
                aria-invalid={Boolean(fieldError(fieldErrors, "examples"))}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.action === "REJECT"
            ? t("knowledge.guidance.confirm.rejectTitle")
            : t("knowledge.guidance.confirm.disableTitle")
        }
        description={
          confirm?.action === "REJECT"
            ? t("knowledge.guidance.confirm.rejectDescription")
            : t("knowledge.guidance.confirm.disableDescription")
        }
        confirmLabel={
          confirm?.action === "REJECT"
            ? t("knowledge.guidance.confirm.reject")
            : t("knowledge.guidance.confirm.disable")
        }
        cancelLabel={t("knowledge.guidance.editor.cancel")}
        danger
        onConfirm={() => (confirm ? decide(confirm.rule, confirm.action) : false)}
      />
    </section>
  );
}

function GuidanceRow({
  rule,
  canEdit,
  canVerifyHighRisk,
  busy,
  focused,
  onEdit,
  onApprove,
  onConfirm,
}: {
  rule: KnowledgeV2GuidanceRuleView;
  canEdit: boolean;
  canVerifyHighRisk: boolean;
  busy: string | null;
  focused: boolean;
  onEdit: () => void;
  onApprove: () => void;
  onConfirm: (action: Extract<DecisionAction, "REJECT" | "DISABLE">) => void;
}) {
  const { t } = useI18n();
  const actionBusy = busy?.startsWith(`${rule.id}:`) ?? false;
  const canApprove =
    canEdit && rule.allowedActions.includes("APPROVE") && (!isHighRisk(rule) || canVerifyHighRisk);
  const showActions =
    canEdit &&
    rule.allowedActions.some(
      (action) =>
        action === "EDIT" || action === "APPROVE" || action === "REJECT" || action === "DISABLE",
    );

  return (
    <article
      tabIndex={-1}
      className={cn(
        "scroll-mt-24 border-b border-white/10 px-4 py-4 outline-none last:border-b-0",
        focused && "bg-amber-500/[0.07] ring-1 ring-inset ring-amber-400/40",
      )}
      data-guidance-rule-id={rule.id}
      data-testid={`guidance-rule-${rule.id}`}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-100">{rule.title}</h3>
            <Badge className="border-violet-500/20 bg-violet-500/[0.07] text-violet-300">
              {t(ruleTypeKeys[rule.type])}
            </Badge>
            <Badge className={reviewStyles[rule.reviewStatus]}>
              {t(reviewKeys[rule.reviewStatus])}
            </Badge>
            <Badge className={riskStyles[rule.riskLevel]}>
              {t("knowledge.guidance.risk.label", { risk: t(riskKeys[rule.riskLevel]) })}
            </Badge>
          </div>
          <p className="mt-2 line-clamp-2 max-w-4xl text-sm leading-relaxed text-zinc-300">
            {rule.instruction}
          </p>
          <div className="mt-3 grid gap-x-6 gap-y-2 text-xs text-zinc-500 md:grid-cols-2 xl:grid-cols-3">
            <Meta
              label={t("knowledge.guidance.row.condition")}
              value={conditionLabel(rule.condition, t)}
            />
            <Meta label={t("knowledge.guidance.row.scope")} value={scopeLabel(rule, t)} />
            <Meta label={t("knowledge.guidance.row.priority")} value={String(rule.priority)} />
            <Meta
              label={t("knowledge.guidance.row.approver")}
              value={
                rule.requiredApproverRole
                  ? t(approverKeys[rule.requiredApproverRole])
                  : t("knowledge.guidance.row.approverNone")
              }
            />
            <Meta
              label={t("knowledge.guidance.row.evidence")}
              value={
                rule.evidence.length
                  ? t(
                      rule.evidence.length === 1
                        ? "knowledge.guidance.row.evidenceLinked.one"
                        : "knowledge.guidance.row.evidenceLinked.many",
                      {
                        count: rule.evidence.length,
                        labels: rule.evidence
                          .slice(0, 2)
                          .map((item) => item.label)
                          .join(", "),
                      },
                    )
                  : t("knowledge.guidance.row.evidenceNone")
              }
              icon={<FileCheck2 className="h-3.5 w-3.5" />}
            />
            <Meta
              label={t("knowledge.guidance.row.examples")}
              value={t(
                rule.examples.length === 1
                  ? "knowledge.guidance.row.examplesCount.one"
                  : "knowledge.guidance.row.examplesCount.many",
                { count: rule.examples.length },
              )}
            />
          </div>
        </div>

        {showActions ? (
          <div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[360px] xl:justify-end">
            {rule.allowedActions.includes("EDIT") ? (
              <Button size="sm" variant="outline" disabled={actionBusy} onClick={onEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t("knowledge.guidance.action.edit")}
              </Button>
            ) : null}
            {canApprove ? (
              <Button size="sm" disabled={actionBusy} onClick={onApprove}>
                {busy === `${rule.id}:APPROVE` ? (
                  <Spinner className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("knowledge.guidance.action.approve")}
              </Button>
            ) : null}
            {rule.allowedActions.includes("REJECT") ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actionBusy}
                className="text-rose-300 hover:text-rose-200"
                onClick={() => onConfirm("REJECT")}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                {t("knowledge.guidance.action.reject")}
              </Button>
            ) : null}
            {rule.allowedActions.includes("DISABLE") ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actionBusy}
                onClick={() => onConfirm("DISABLE")}
              >
                <Power className="mr-1.5 h-3.5 w-3.5" />
                {t("knowledge.guidance.action.disable")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-zinc-600">{icon}</span>
      <p className="min-w-0">
        <span className="text-zinc-600">{label}: </span>
        <span className="break-words text-zinc-400">{value}</span>
      </p>
    </div>
  );
}

function FormField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-xs text-rose-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-zinc-600">{hint}</span>
      ) : null}
    </label>
  );
}

function ErrorBanner({ error, onDismiss }: { error: ApiClientError; onDismiss?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2.5">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-rose-200">{error.message}</p>
        {error.requestId ? (
          <p className="mt-0.5 text-xs text-rose-300/50">
            {t("knowledge.guidance.request", { requestId: error.requestId })}
          </p>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={t("knowledge.guidance.error.dismiss")}
          className="text-rose-300/60 transition-colors hover:text-rose-200"
          onClick={onDismiss}
        >
          <XCircle className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
