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
} from "lucide-react";
import { Dropdown, DropdownItem, DropdownSeparator } from "../ui";
import { toast } from "sonner";
import { ProductLayout, BackButton } from "../ProductLayout";
import { Card, Avatar, ChannelBadge, StatusPill, TempPill } from "../shared";
import { conversation as initialConversation, quickReplies, leads } from "../data";
import type { ChatMessage } from "../data";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";

/* ── helpers ─────────────────────────────────────────────────── */
function formatValue(v: number) {
  return v.toLocaleString("ru-RU");
}

/* ── Timeline data ───────────────────────────────────────────── */
const timeline = [
  { icon: User, label: "Создан лид", time: "10:01", color: "text-sky-400" },
  { icon: Bot, label: "AI ответил", time: "10:02", color: "text-emerald-400" },
  { icon: Zap, label: "Уточнение услуги", time: "10:05", color: "text-amber-400" },
  { icon: CalendarPlus, label: "Запись создана", time: "10:09", color: "text-violet-400" },
];

/* ── Message bubble ──────────────────────────────────────────── */
function MessageBubble({ msg, index }: { msg: ChatMessage; index: number }) {
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
            К
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
function LeadInfoPanel({ lead }: { lead: (typeof leads)[number] }) {
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
          <Button size="sm" className="w-full justify-start gap-2" onClick={() => toast.success("Лид отправлен в CRM")}>
            <Database className="w-4 h-4" />
            Отправить в CRM
          </Button>
          <button onClick={() => toast.success("Задача создана")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200">
            <CheckSquare className="w-4 h-4 text-zinc-400" />
            Создать задачу
          </button>
          <button onClick={() => toast.success("Запись создана")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200">
            <CalendarPlus className="w-4 h-4 text-zinc-400" />
            Записать на приём
          </button>
          <button onClick={() => toast.success("Лид квалифицирован")} className="w-full flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors px-3 py-2 text-sm font-medium text-emerald-300">
            <BadgeCheck className="w-4 h-4" />
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
            {timeline.map((item, i) => {
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
  const lead =
    leads.find((l) => l.id === (params.id as string)) ?? leads[0];

  const [messages, setMessages] = useState<ChatMessage[]>(initialConversation);
  const [inputValue, setInputValue] = useState("");
  const [showLeadInfo, setShowLeadInfo] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text) return;
    const newMsg: ChatMessage = {
      id: `m${Date.now()}`,
      from: "manager",
      text,
      time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue("");
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

  return (
    <ProductLayout title="Диалог">
      <BackButton to="inbox" label="Назад во входящие" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-10rem)] lg:h-[calc(100vh-9rem)]">
        {/* ── LEFT: Chat column ── */}
        <div className="flex flex-col min-h-0">
          <Card className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-3xl">
            {/* Chat header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={lead.name} size={42} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-100 truncate">{lead.name}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <ChannelBadge id={lead.channel} withLabel />
                    <StatusPill stage={lead.stage} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* AI active indicator */}
                <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium text-emerald-300">AI ведёт диалог</span>
                </div>

                {/* Mobile toggle for lead info */}
                <button
                  className="lg:hidden flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300"
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
                    <button className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  }
                >
                  <DropdownItem onClick={() => toast("Передано менеджеру")}>
                    Передать менеджеру
                  </DropdownItem>
                  <DropdownItem onClick={() => toast("Экспорт начат")}>
                    Экспорт переписки
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem danger onClick={() => toast.error("Контакт заблокирован")}>
                    Заблокировать
                  </DropdownItem>
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
                    <LeadInfoPanel lead={lead} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.id} msg={msg} index={i} />
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
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                    className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center transition-all",
                      inputValue.trim()
                        ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-[0_0_16px_rgba(52,211,153,0.4)]"
                        : "bg-white/5 text-zinc-600 cursor-not-allowed"
                    )}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Lead info (desktop) ── */}
        <div className="hidden lg:flex flex-col gap-4 overflow-y-auto pb-4">
          <LeadInfoPanel lead={lead} />
        </div>
      </div>

      {/* Sticky mobile actions */}
      <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 px-4 pb-2 pt-2 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          <Button size="sm" className="flex-1 justify-center gap-2" onClick={() => toast.success("Лид отправлен в CRM")}>
            <Database className="w-4 h-4" />
            В CRM
          </Button>
          <button onClick={() => toast.success("Запись создана")} className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-900/90 backdrop-blur px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10 transition-colors">
            <CalendarPlus className="w-4 h-4 text-zinc-400" />
            Записать
          </button>
        </div>
      </div>
    </ProductLayout>
  );
}
