"use client";

import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Bot, CheckCircle2, Loader2, MessageCircle, SendHorizontal, Sparkles, X } from "lucide-react";
import type { WidgetConfig, WidgetConversationMessage } from "@leadvirt/types";
import { cn } from "@/lib/cn";
import { getWidgetConfig, sendWidgetMessage } from "@/lib/api/widget";

type LocalMessage = WidgetConversationMessage & {
  pending?: boolean;
  error?: boolean;
};

type WidgetStyle = CSSProperties & {
  "--widget-primary": string;
  "--widget-accent": string;
};

export interface LeadVirtWidgetProps {
  publicKey: string;
  defaultOpen?: boolean;
  embedded?: boolean;
}

function createSessionId(publicKey: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `lvw_${publicKey}_${suffix}`;
}

function storageKey(publicKey: string) {
  return `leadvirt.widget.session.${publicKey}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Запрос виджета не выполнен";
}

function welcomeMessage(config: WidgetConfig): LocalMessage {
  return {
    id: "widget-welcome",
    senderType: "AI",
    direction: "OUTBOUND",
    text: config.welcomeMessage,
    createdAt: new Date().toISOString(),
    status: "SENT"
  };
}

function MessageBubble({ message, index }: { message: LocalMessage; index: number }) {
  const fromCustomer = message.senderType === "CUSTOMER";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index * 0.035, 0.2), duration: 0.22 }}
      className={cn("flex", fromCustomer ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[82%] break-words rounded-[1.1rem] px-4 py-3 text-sm leading-6 shadow-sm",
          fromCustomer
            ? "rounded-br-md bg-[var(--widget-primary)] text-zinc-950"
            : "rounded-bl-md border border-white/10 bg-white/[0.06] text-zinc-100",
          message.error && "bg-rose-500/15 text-rose-100 ring-1 ring-rose-400/30"
        )}
      >
        <p>{message.text}</p>
        <div className={cn("mt-1 flex justify-end text-[10px]", fromCustomer ? "text-zinc-900/60" : "text-zinc-500")}>
          {message.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : message.status === "FAILED" ? "Ошибка" : "Отправлено"}
        </div>
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <div className="rounded-[1.1rem] rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              animate={{ opacity: [0.35, 1, 0.35], y: [0, -3, 0] }}
              transition={{ duration: 0.85, repeat: Infinity, delay: dot * 0.14 }}
              className="h-1.5 w-1.5 rounded-full bg-emerald-300"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function LeadVirtWidget({ publicKey, defaultOpen = false, embedded = false }: LeadVirtWidgetProps) {
  const prefersReducedMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getWidgetConfig(publicKey)
      .then((result) => {
        if (cancelled) return;
        setConfig(result);
        setMessages((current) => (current.length > 0 ? current : [welcomeMessage(result)]));
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = storageKey(publicKey);
    const existing = window.localStorage.getItem(key);
    if (existing) {
      setSessionId(existing);
      return;
    }
    const next = createSessionId(publicKey);
    window.localStorage.setItem(key, next);
    setSessionId(next);
  }, [publicKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [messages, sending, prefersReducedMotion]);

  const styleVars: WidgetStyle = useMemo(
    () => ({
      "--widget-primary": config?.primaryColor ?? "#34d399",
      "--widget-accent": config?.accentColor ?? "#10b981"
    }),
    [config?.accentColor, config?.primaryColor]
  );

  const position = config?.position ?? "bottom-right";
  const launcherAnchor = position === "bottom-left" ? "left-4 sm:left-6" : "right-4 sm:right-6";
  const panelAnchor =
    position === "bottom-left"
      ? "left-3 right-3 sm:left-6 sm:right-auto"
      : "left-3 right-3 sm:left-auto sm:right-6";
  const transition = prefersReducedMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 32 };
  const title = config?.title ?? "LeadVirt.ai";
  const subtitle = config?.subtitle ?? "AI-администратор";
  const quickReplies = config?.suggestedReplies ?? ["Хочу записаться", "Сколько стоит?", "Позовите менеджера"];

  async function submitMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || !sessionId || sending) return;
    const clientMessageId = `${sessionId}:${Date.now()}`;
    const optimistic: LocalMessage = {
      id: clientMessageId,
      senderType: "CUSTOMER",
      direction: "INBOUND",
      text,
      createdAt: new Date().toISOString(),
      status: "QUEUED",
      pending: true
    };

    setMessages((current) => [...current, optimistic]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const body = {
        sessionId,
        clientMessageId,
        text
      };
      const pageUrl = typeof window !== "undefined" ? window.location.href : "";
      const referrer = typeof document !== "undefined" ? document.referrer : "";
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const response = await sendWidgetMessage(publicKey, {
        ...body,
        ...(pageUrl ? { pageUrl } : {}),
        ...(referrer ? { referrer } : {}),
        ...(userAgent ? { userAgent } : {})
      });
      setMessages(response.messages);
    } catch (caught) {
      setError(errorMessage(caught));
      setMessages((current) =>
        current.map((message) =>
          message.id === clientMessageId ? { ...message, pending: false, error: true, status: "FAILED" } : message
        )
      );
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage();
  }

  return (
    <div style={styleVars} className={cn("leadvirt-widget", embedded ? "pointer-events-none fixed inset-0 z-[2147483647]" : "fixed inset-0 z-50 pointer-events-none")}>
      <AnimatePresence>
        {open ? (
          <motion.section
            key="panel"
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={transition}
            className={cn(
              "pointer-events-auto fixed bottom-3 flex h-[min(680px,calc(100vh-1.5rem))] w-auto flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 backdrop-blur-xl sm:bottom-24 sm:w-[390px]",
              panelAnchor
            )}
            aria-label="Чат-виджет LeadVirt.ai"
          >
            <header className="relative overflow-hidden border-b border-white/10 bg-zinc-900 px-4 py-4">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.18),transparent_42%)]" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <motion.div
                    {...(prefersReducedMotion
                      ? {}
                      : {
                          animate: { rotate: [0, 3, -3, 0], scale: [1, 1.04, 1] },
                          transition: { duration: 2.8, repeat: Infinity }
                        })}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--widget-primary)] text-zinc-950 shadow-lg shadow-emerald-500/20"
                  >
                    <Bot className="h-6 w-6" />
                  </motion.div>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-50">{title}</h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      <span className="truncate">{subtitle}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть чат"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-300" />
                  Загрузка чата
                </div>
              ) : null}

              {!loading && messages.map((message, index) => <MessageBubble key={message.id} message={message} index={index} />)}
              {sending ? <TypingDots /> : null}
            </div>

            <div className="border-t border-white/10 bg-zinc-950/95 p-3">
              {error ? (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {messages.length <= 1 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {quickReplies.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      disabled={sending || loading}
                      onClick={() => void submitMessage(reply)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-100 disabled:opacity-50"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              ) : null}

              <form onSubmit={onSubmit} className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={1}
                  maxLength={4000}
                  placeholder="Напишите сообщение..."
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm leading-5 text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/50"
                  disabled={loading || !config}
                />
                <button
                  type="submit"
                  aria-label="Отправить сообщение"
                  disabled={!input.trim() || sending || loading || !config}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--widget-primary)] text-zinc-950 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                </button>
              </form>

              <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-600">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  Защищенная сессия
                </span>
                <span>{config?.poweredBy ?? "LeadVirt.ai"}</span>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label="Открыть чат"
        onClick={() => setOpen(true)}
        {...(prefersReducedMotion ? {} : { whileHover: { y: -2, scale: 1.03 }, whileTap: { scale: 0.97 } })}
        className={cn(
          "pointer-events-auto fixed bottom-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--widget-primary)] text-zinc-950 shadow-2xl shadow-emerald-500/25 sm:bottom-6",
          launcherAnchor,
          open && "hidden"
        )}
      >
        <span className="absolute inset-0 rounded-2xl bg-[var(--widget-primary)] opacity-35 blur-md" />
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-950 text-emerald-300">
          <Sparkles className="h-3 w-3" />
        </span>
        <MessageCircle className="relative h-7 w-7" />
      </motion.button>
    </div>
  );
}
