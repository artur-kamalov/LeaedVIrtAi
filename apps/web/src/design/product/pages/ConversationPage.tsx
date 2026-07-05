import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  Send,
  Paperclip,
  Smile,
  ChevronDown,
  ChevronUp,
  Database,
  CheckSquare,
  CalendarPlus,
  BadgeCheck,
  Clock,
  User,
  Zap,
  MoreVertical,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Dropdown, DropdownItem, DropdownSeparator } from "../ui";
import { toast } from "sonner";
import { ProductLayout, BackButton } from "../ProductLayout";
import { Card, Avatar, ChannelBadge, StatusPill, TempPill } from "../shared";
import type { ChatMessage, Lead } from "../types";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../ui";
import { cn } from "../../lib/utils";
import {
  draftAiReply,
  getConversation,
  handoffConversation,
  sendConversationMessage,
  updateConversationStatus,
} from "@/lib/api/conversations";
import {
  bookLeadAppointment,
  createLeadTask,
  sendLeadToCrm,
  updateLead,
} from "@/lib/api/leads";
import type { ConversationDetail, ConversationStatus, Lead as ApiLead, LeadEvent } from "@leadvirt/types";
import { leadFromConversation, messagesFromConversation, relativeTimeLabel } from "../apiAdapters";

/* ── helpers ─────────────────────────────────────────────────── */
function formatValue(v: number) {
  return v.toLocaleString("ru-RU");
}

/* ── Timeline data ───────────────────────────────────────────── */
type TimelineItem = {
  icon: typeof User;
  label: string;
  time: string;
  color: string;
};

const quickReplies = [
  "Уточнить услугу",
  "Предложить время",
  "Отправить прайс",
  "Подтвердить запись",
  "Передать менеджеру",
];

function eventIconAndColor(type: string): Pick<TimelineItem, "icon" | "color"> {
  if (type.includes("crm")) return { icon: Database, color: "text-emerald-400" };
  if (type.includes("task")) return { icon: CheckSquare, color: "text-sky-400" };
  if (type.includes("booking") || type.includes("appointment")) return { icon: CalendarPlus, color: "text-violet-400" };
  if (type.includes("qualified") || type.includes("updated")) return { icon: BadgeCheck, color: "text-emerald-400" };
  if (type.includes("ai")) return { icon: Bot, color: "text-emerald-400" };
  if (type.includes("message")) return { icon: User, color: "text-zinc-400" };
  return { icon: Zap, color: "text-amber-400" };
}

function localizeEventTitle(event: LeadEvent) {
  const labels: Record<string, string> = {
    "Message sent": "Сообщение отправлено",
    "AI reply queued": "AI-ответ поставлен в очередь",
    "Lead sent to CRM": "Лид отправлен в CRM",
  };
  return labels[event.title] ?? event.title;
}

function timelineFromEvents(events?: LeadEvent[]) {
  if (!events?.length) return [];
  return events.slice(0, 6).map((event) => ({
    ...eventIconAndColor(event.type),
    label: localizeEventTitle(event),
    time: relativeTimeLabel(event.createdAt),
  }));
}

function senderLabel(from: ChatMessage["from"]) {
  if (from === "client") return "Клиент";
  if (from === "ai") return "AI";
  return "Менеджер";
}

function sanitizeFilePart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "conversation";
}

function buildTranscript(lead: Lead, messages: ChatMessage[], conversationId: string, status: ConversationStatus) {
  const header = [
    "LeadVirt conversation export",
    `Conversation ID: ${conversationId}`,
    `Lead: ${lead.name}`,
    `Service: ${lead.service}`,
    `Source: ${lead.source}`,
    `Status: ${status}`,
    "",
    "Messages:",
  ];

  const body = messages.map((message) => `[${message.time}] ${senderLabel(message.from)}: ${message.text}`);
  return [...header, ...body, ""].join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Message bubble ──────────────────────────────────────────── */
function MessageBubble({ msg, index, customerInitial }: { msg: ChatMessage; index: number; customerInitial: string }) {
  const isClient = msg.from === "client";
  const isAI = msg.from === "ai";
  const isManager = msg.from === "manager";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: "easeOut" }}
      className={cn(
        "flex gap-2.5 max-w-[85%] sm:max-w-[72%]",
        isClient ? "self-start" : "self-end flex-row-reverse"
      )}
    >
      {isClient && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold">
            {customerInitial}
          </div>
        </div>
      )}
      {isAI && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>
      )}
      {isManager && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 text-xs font-semibold">
            М
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {isAI && (
          <span className="text-[10px] font-semibold text-emerald-400 self-end pr-1">AI</span>
        )}
        {isManager && (
          <span className="text-[10px] font-semibold text-indigo-400 self-end pr-1">Менеджер</span>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isClient && "bg-zinc-800 text-zinc-100 rounded-tl-sm",
            isAI && "bg-emerald-500/15 border border-emerald-500/20 text-zinc-100 rounded-tr-sm",
            isManager && "bg-indigo-500/15 border border-indigo-500/20 text-zinc-100 rounded-tr-sm"
          )}
        >
          {msg.text}
        </div>
        <span className="text-[10px] text-zinc-600 px-1">{msg.time}</span>
      </div>
    </motion.div>
  );
}

/* ── Lead info panel ─────────────────────────────────────────── */
type LeadAction = "crm" | "task" | "appointment" | "qualified";
type ConversationAction = "handoff" | "close" | "open";

function LeadInfoPanel({
  lead,
  timelineItems,
  pendingAction,
  onAction,
}: {
  lead: Lead;
  timelineItems: TimelineItem[];
  pendingAction: LeadAction | null;
  onAction: (action: LeadAction) => void;
}) {
  const isPending = (action: LeadAction) => pendingAction === action;

  return (
    <div className="flex flex-col gap-4">
      {/* Info card */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-4">
          Информация о лиде
        </h3>
        <div className="space-y-3">
          <InfoRow label="Статус">
            <StatusPill stage={lead.stage} />
          </InfoRow>
          <InfoRow label="Температура">
            <TempPill t={lead.temp} />
          </InfoRow>
          <InfoRow label="Менеджер">
            <span className="text-sm text-zinc-300">{lead.manager}</span>
          </InfoRow>
          <InfoRow label="Источник">
            <span className="text-sm text-zinc-300">{lead.source}</span>
          </InfoRow>
          <InfoRow label="Услуга">
            <span className="text-sm text-zinc-300">{lead.service}</span>
          </InfoRow>
          <InfoRow label="Сумма">
            <span className="text-sm font-semibold text-emerald-400">
              {formatValue(lead.value)} ₽
            </span>
          </InfoRow>
          <InfoRow label="Канал">
            <ChannelBadge id={lead.channel} withLabel />
          </InfoRow>
        </div>
      </Card>

      {/* Actions */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-3">Действия</h3>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="w-full justify-start gap-2" disabled={Boolean(pendingAction)} onClick={() => onAction("crm")}>
            {isPending("crm") ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            Отправить в CRM
          </Button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("task")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("task") ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CheckSquare className="w-4 h-4 text-zinc-400" />}
            Создать задачу
          </button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("appointment")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("appointment") ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CalendarPlus className="w-4 h-4 text-zinc-400" />}
            Записать на приём
          </button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("qualified")} className="w-full flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors px-3 py-2 text-sm font-medium text-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("qualified") ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
            Отметить квалифицированным
          </button>
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-4">Таймлайн</h3>
        <div className="relative">
          <div className="absolute left-[13px] top-1 bottom-1 w-px bg-white/5" />
          <div className="space-y-4">
            {timelineItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.07 }}
                  className="flex items-start gap-3 relative"
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0 z-10",
                      item.color
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs text-zinc-300 font-medium">{item.label}</p>
                    <p className="text-[10px] text-zinc-600 flex items-center gap-1 mt-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {item.time}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <div className="flex items-center justify-end">{children}</div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export function ConversationPage() {
  const { params } = useNav();
  const conversationId = typeof params.id === "string" && params.id.length > 0 ? params.id : "";

  const [apiConversation, setApiConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [showLeadInfo, setShowLeadInfo] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDraftingAiReply, setIsDraftingAiReply] = useState(false);
  const [pendingLeadAction, setPendingLeadAction] = useState<LeadAction | null>(null);
  const [pendingConversationAction, setPendingConversationAction] = useState<ConversationAction | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lead = apiConversation ? leadFromConversation(apiConversation) : null;
  const apiLeadId = apiConversation?.lead?.id ?? null;
  const timelineItems = timelineFromEvents(apiConversation?.events);
  const conversationStatus = apiConversation?.status ?? "OPEN";
  const conversationModeLabel =
    conversationStatus === "WAITING_FOR_HUMAN"
      ? "Передано менеджеру"
      : conversationStatus === "CLOSED"
        ? "Диалог закрыт"
        : apiConversation?.aiEnabled === false
          ? "AI выключен"
          : "AI ведёт диалог";
  const customerInitial = lead?.name.trim().charAt(0).toUpperCase() || "К";

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let active = true;

    setApiConversation(null);
    setMessages([]);

    if (!conversationId) {
      setIsLoadingConversation(false);
      return () => {
        active = false;
      };
    }

    setIsLoadingConversation(true);
    void getConversation(conversationId)
      .then((conversation) => {
        if (!active) return;
        setApiConversation(conversation);
        const nextMessages = messagesFromConversation(conversation);
        setMessages(nextMessages);
      })
      .catch(() => {
        if (!active) return;
        setApiConversation(null);
        setMessages([]);
      })
      .finally(() => {
        if (active) setIsLoadingConversation(false);
      });

    return () => {
      active = false;
    };
  }, [conversationId]);

  if (!lead) {
    return (
      <ProductLayout title="Диалог">
        <BackButton to="inbox" label="Назад во входящие" />
        <div className="flex min-h-[50vh] items-center justify-center">
          <EmptyState
            icon={MessageSquare}
            title={isLoadingConversation ? "Загружаем диалог" : "Диалог не найден"}
            description={
              isLoadingConversation
                ? "Проверяем обращение в базе workspace."
                : "Откройте диалог из списка входящих. В рабочем пространстве показываются только реальные обращения из вашей базы."
            }
          />
        </div>
      </ProductLayout>
    );
  }

  async function handleSend() {
    const text = inputValue.trim();
    if (!text || isSending) return;
    const newMsg: ChatMessage = {
      id: `m${Date.now()}`,
      from: "manager",
      text,
      time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue("");

    if (!apiConversation) return;

    setIsSending(true);
    try {
      const updated = await sendConversationMessage(apiConversation.id, text);
      setApiConversation(updated);
      const nextMessages = messagesFromConversation(updated);
      setMessages(nextMessages.length > 0 ? nextMessages : [newMsg]);
      toast.success("Сообщение отправлено");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось отправить сообщение");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleQuickReply(text: string) {
    setInputValue(text);
  }

  function handleExportTranscript() {
    const filename = `leadvirt-${sanitizeFilePart(lead.name)}-${sanitizeFilePart(conversationId)}.txt`;
    downloadTextFile(filename, buildTranscript(lead, messages, conversationId, conversationStatus));
    toast.success("Экспорт переписки готов");
  }

  async function handleDraftAiReply() {
    if (isDraftingAiReply) return;

    if (!apiConversation) {
      toast.error("AI-подсказка доступна для API-диалога");
      return;
    }

    setIsDraftingAiReply(true);
    try {
      const draft = await draftAiReply(apiConversation.id);
      setInputValue(draft.reply);
      toast.success("AI-подсказка готова", {
        description: draft.handoffRequired ? "Проверьте текст: AI рекомендует менеджера." : "Можно отредактировать и отправить.",
      });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось подготовить AI-подсказку");
    } finally {
      setIsDraftingAiReply(false);
    }
  }

  function applyApiLead(updatedLead: ApiLead) {
    setApiConversation((current) => (current ? { ...current, lead: updatedLead } : current));
  }

  async function refreshConversation() {
    if (!apiConversation) return;
    const updated = await getConversation(apiConversation.id);
    setApiConversation(updated);
    const nextMessages = messagesFromConversation(updated);
    setMessages(nextMessages);
  }

  function applyConversationUpdate(updated: ConversationDetail) {
    setApiConversation(updated);
    const nextMessages = messagesFromConversation(updated);
    setMessages(nextMessages);
  }

  async function changeConversationStatus(status: ConversationStatus) {
    if (!apiConversation) return null;
    return updateConversationStatus(apiConversation.id, status);
  }

  async function handleConversationAction(action: ConversationAction) {
    if (pendingConversationAction) return;

    if (!apiConversation) {
      toast.error("Действие доступно для API-диалога");
      return;
    }

    setPendingConversationAction(action);
    try {
      if (action === "handoff") {
        const updated = await handoffConversation(apiConversation.id);
        applyConversationUpdate(updated);
        toast.success("Диалог передан менеджеру");
      }

      if (action === "close") {
        const updated = await changeConversationStatus("CLOSED");
        if (updated) applyConversationUpdate(updated);
        toast.success("Диалог закрыт");
      }

      if (action === "open") {
        const updated = await changeConversationStatus("OPEN");
        if (updated) applyConversationUpdate(updated);
        toast.success("Диалог открыт");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Действие с диалогом не выполнено");
    } finally {
      setPendingConversationAction(null);
    }
  }

  async function handleLeadAction(action: LeadAction) {
    if (!apiLeadId) {
      toast.error("Действие доступно для API-лида");
      return;
    }

    setPendingLeadAction(action);
    try {
      if (action === "crm") {
        const updated = await sendLeadToCrm(apiLeadId);
        applyApiLead(updated);
        toast.success("Лид отправлен в CRM");
      }

      if (action === "task") {
        await createLeadTask(apiLeadId, "Связаться с лидом из диалога");
        toast.success("Задача создана");
      }

      if (action === "appointment") {
        await bookLeadAppointment(
          apiLeadId,
          lead.service || "Запись",
          new Date(Date.now() + 24 * 60 * 60_000).toISOString()
        );
        await refreshConversation();
        toast.success("Запись создана");
      }

      if (action === "qualified") {
        const updated = await updateLead(apiLeadId, { status: "QUALIFIED" });
        applyApiLead(updated);
        toast.success("Лид квалифицирован");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Действие не выполнено");
    } finally {
      setPendingLeadAction(null);
    }
  }

  return (
    <ProductLayout title="Диалог">
      <BackButton to="inbox" label="Назад во входящие" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-10rem)] lg:h-[calc(100vh-9rem)]">
        {/* ── LEFT: Chat column ── */}
        <div className="flex flex-col min-h-0">
          <Card className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-3xl">
            {/* Chat header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                <Avatar name={lead.name} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-zinc-100 truncate">{lead.name}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <ChannelBadge id={lead.channel} withLabel />
                    <StatusPill stage={lead.stage} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 w-full sm:w-auto">
                {/* AI active indicator */}
                <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium text-emerald-300">{conversationModeLabel}</span>
                </div>

                {/* Mobile toggle for lead info */}
                <button
                  className="lg:hidden flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300"
                  onClick={() => setShowLeadInfo((v) => !v)}
                >
                  Информация о лиде
                  {showLeadInfo ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Chat options menu */}
                <Dropdown
                  trigger={
                    <button
                      aria-label="Действия с диалогом"
                      className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  }
                >
                  <DropdownItem onClick={() => void handleConversationAction("handoff")}>
                    {pendingConversationAction === "handoff" ? "Передаём..." : "Передать менеджеру"}
                  </DropdownItem>
                  <DropdownItem onClick={() => void handleDraftAiReply()}>
                    {isDraftingAiReply ? "Готовим AI-подсказку..." : "AI-подсказка"}
                  </DropdownItem>
                  <DropdownItem onClick={handleExportTranscript}>
                    Экспорт переписки
                  </DropdownItem>
                  <DropdownSeparator />
                  {conversationStatus === "CLOSED" ? (
                    <DropdownItem onClick={() => void handleConversationAction("open")}>
                      {pendingConversationAction === "open" ? "Открываем..." : "Открыть диалог"}
                    </DropdownItem>
                  ) : (
                    <DropdownItem danger onClick={() => void handleConversationAction("close")}>
                      {pendingConversationAction === "close" ? "Закрываем..." : "Закрыть диалог"}
                    </DropdownItem>
                  )}
                </Dropdown>
              </div>
            </div>

            {/* Mobile collapsible lead info */}
            <AnimatePresence>
              {showLeadInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="lg:hidden overflow-hidden border-b border-white/5"
                >
                  <div className="p-4 max-h-80 overflow-y-auto">
                    <LeadInfoPanel
                      lead={lead}
                      timelineItems={timelineItems}
                      pendingAction={pendingLeadAction}
                      onAction={(action) => void handleLeadAction(action)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages area */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-3">
                {isLoadingConversation && (
                  <div className="self-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
                    Загрузка диалога...
                  </div>
                )}
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.id} msg={msg} index={i} customerInitial={customerInitial} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Quick replies */}
            <div className="px-5 py-2 border-t border-white/5 shrink-0">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {quickReplies.map((qr) => (
                  <button
                    key={qr}
                    onClick={() => handleQuickReply(qr)}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-emerald-500/30 transition-colors px-3 py-1.5 text-xs font-medium text-zinc-300"
                  >
                    {qr}
                  </button>
                ))}
              </div>
            </div>

            {/* Input bar */}
            <div className="px-4 pb-4 pt-2 shrink-0">
              <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 focus-within:border-emerald-500/40 transition-colors">
                <button className="mb-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Paperclip className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                </button>
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Написать сообщение..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none leading-relaxed max-h-28 overflow-y-auto py-1"
                />
                <div className="flex items-center gap-1.5 mb-1 shrink-0">
                  <button className="text-zinc-500 hover:text-zinc-300 transition-colors">
                    <Smile className="w-[18px] h-[18px]" />
                  </button>
                  <button
                    aria-label="Отправить сообщение"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isSending}
                    className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center transition-all",
                      inputValue.trim() && !isSending
                        ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-[0_0_16px_rgba(52,211,153,0.4)]"
                        : "bg-white/5 text-zinc-600 cursor-not-allowed"
                    )}
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Lead info (desktop) ── */}
        <div className="hidden lg:flex flex-col gap-4 overflow-y-auto pb-4">
          <LeadInfoPanel
            lead={lead}
            timelineItems={timelineItems}
            pendingAction={pendingLeadAction}
            onAction={(action) => void handleLeadAction(action)}
          />
        </div>
      </div>

      {/* Sticky mobile actions */}
      <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 px-4 pb-2 pt-2 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          <Button size="sm" className="flex-1 justify-center gap-2" disabled={Boolean(pendingLeadAction)} onClick={() => void handleLeadAction("crm")}>
            {pendingLeadAction === "crm" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            В CRM
          </Button>
          <button disabled={Boolean(pendingLeadAction)} onClick={() => void handleLeadAction("appointment")} className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-900/90 backdrop-blur px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {pendingLeadAction === "appointment" ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CalendarPlus className="w-4 h-4 text-zinc-400" />}
            Записать
          </button>
        </div>
      </div>
    </ProductLayout>
  );
}
