"use client";

import { type DependencyList, type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Card, ChatBubble, MetricCard, StatusBadge } from "@leadvirt/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  Clock,
  Code2,
  Copy,
  CreditCard,
  Database,
  ExternalLink,
  Filter,
  Inbox,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X
} from "lucide-react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  AnalyticsOverview,
  ChannelType,
  ConversationDetail,
  DashboardSummary,
  IntegrationAccount,
  IntegrationSampleDeliveryResult,
  IntegrationTestResult,
  Lead,
  LeadStatus,
  OnboardingState,
  PricingPlan,
  SettingsAccount,
  Subscription,
  UsageSummary,
  Workflow as WorkflowDto
} from "@leadvirt/types";
import { getAnalyticsOverview } from "@/lib/api/analytics";
import { getBillingUsage, getCurrentSubscription, listBillingPlans } from "@/lib/api/billing";
import { sendConversationMessage } from "@/lib/api/conversations";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { connectIntegration, disconnectIntegration, listIntegrations, sendSampleInbound, testIntegrationConnection } from "@/lib/api/integrations";
import { listInboxConversations } from "@/lib/api/inbox";
import { bookLeadAppointment, createLeadTask, getPipelineSummary, sendLeadToCrm, updateLead } from "@/lib/api/leads";
import { completeOnboardingStep, getOnboardingState } from "@/lib/api/onboarding";
import { getAccountSettings, getBillingSettings, getSecuritySettings, getTeamSettings } from "@/lib/api/settings";
import { listWorkflows, publishWorkflow, testWorkflow } from "@/lib/api/workflows";
import { ChannelBadge } from "@/legacy-functional/leadvirt/ChannelBadge";
import { PageHeader } from "@/legacy-functional/leadvirt/PageHeader";
import { StagePill } from "@/legacy-functional/leadvirt/StagePill";
import { cn } from "@/lib/cn";
import {
  activity as fallbackActivity,
  chartData,
  channels,
  dashboardMetrics,
  leads as fallbackLeads,
  messages as fallbackMessages,
  stageLabels,
  workflows as fallbackWorkflows,
  type ChannelId,
  type LeadStage
} from "@/features/mock/data";

function formatRub(value: number | null | undefined) {
  if (!value) return "0 ₽";
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "сейчас";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const legacyTextTranslations: Record<string, string> = {
  Mon: "Пн",
  Tue: "Вт",
  Wed: "Ср",
  Thu: "Чт",
  Fri: "Пт",
  Sat: "Сб",
  Sun: "Вс",
  demo: "демо",
  "mock AI": "AI",
  seed: "данные",
  "Demo Company": "Демо-компания",
  "Demo Owner": "Менеджер LeadVirt",
  "Delivery Demo": "Тест доставки",
  "LeadVirt Sample Lead": "Тестовый лид LeadVirt",
  "LeadVirt Demo": "Демо LeadVirt",
  "Webhook Demo Client": "Клиент из webhook-демо",
  "Testing Telegram delivery history in LeadVirt.ai": "Проверка доставки Telegram в LeadVirt.ai",
  "Sample Webhook/API inbound message from the integrations page": "Тестовое входящее сообщение Webhook/API со страницы интеграций",
  "Sample Telegram inbound message from the integrations page": "Тестовое входящее сообщение Telegram со страницы интеграций",
  "I need pricing and an appointment from the webhook API": "Нужна цена и запись через webhook API",
  "Thanks, I can qualify this request. Could you share the service, preferred timing, and contact details?":
    "Спасибо, я квалифицирую заявку. Уточните услугу, удобное время и контакты.",
  "I can help with that. What day and time would be convenient for the customer?":
    "Помогу с записью. Какой день и время удобны клиенту?",
  "I can bring a manager into this conversation and keep the lead context ready.":
    "Я подключу менеджера и сохраню контекст лида.",
  "Telegram bot": "Telegram-бот",
  "Website widget": "Виджет сайта",
  "Email campaign": "Email-кампания",
  Referral: "Рекомендация",
  "Call tracking": "Коллтрекинг",
  "VK messages": "VK сообщения",
  "integration_sample_inbound": "Входящий тест интеграции",
  "webhook event processed": "Webhook-событие обработано",
  "telegram webhook processed": "Webhook Telegram обработан",
  "integration_test_connection": "Проверка подключения интеграции",
  "demo_sync": "Демо-синхронизация",
  "test_connection": "Проверка подключения",
  "sample_inbound": "Тестовое входящее событие",
  "lead.create": "Создание лида в CRM",
  Channel: "Канал",
  Developer: "Разработчикам",
  "E-commerce": "E-commerce",
  Calendar: "Календарь",
  CRM: "CRM",
  integration: "интеграция",
  conversation: "диалог",
  tenant: "рабочее пространство",
  lead: "лид",
  workflow: "сценарий",
  onboarding: "настройка"
};

function localizeLegacyText(value?: string | null) {
  if (!value) return "";
  let result = legacyTextTranslations[value] ?? value;
  result = result.replaceAll("(integration)", "(интеграция)");
  result = result.replaceAll("(conversation)", "(диалог)");
  result = result.replaceAll("(tenant)", "(рабочее пространство)");
  result = result.replaceAll("(lead)", "(лид)");
  result = result.replaceAll("(workflow)", "(сценарий)");
  result = result.replaceAll("integration sample inbound", "Входящий тест интеграции");
  result = result.replaceAll("webhook event processed", "Webhook-событие обработано");
  result = result.replaceAll("telegram webhook processed", "Webhook Telegram обработан");
  result = result.replaceAll("integration test connection", "Проверка подключения интеграции");
  result = result.replaceAll("mock adapter responded successfully.", "демо-адаптер ответил успешно.");
  result = result.replaceAll("demo sync completed.", "демо-синхронизация завершена.");
  result = result.replaceAll("sample inbound event processed.", "тестовое входящее событие обработано.");
  result = result.replaceAll("connected in demo mode.", "подключено в демо-режиме.");
  result = result.replaceAll("disconnected in demo mode.", "отключено в демо-режиме.");
  result = result.replaceAll("is not connected. Connect it before testing live traffic.", "не подключен. Подключите интеграцию перед проверкой live-трафика.");
  result = result.replaceAll("seed completed", "Демо-данные подготовлены");
  result = result.replaceAll("lead sent_to_crm", "Лид отправлен в CRM");
  result = result.replaceAll("booking created", "Запись создана");
  result = result.replaceAll("task created", "Задача создана");
  result = result.replaceAll("integration connected", "Интеграция подключена");
  result = result.replaceAll("workflow published", "Сценарий опубликован");
  result = result.replaceAll("onboarding step_completed", "Шаг onboarding завершен");
  return result;
}

function displayBusinessName(value?: string | null) {
  return localizeLegacyText(value) || "Демо-компания";
}

function initialsFor(value?: string | null) {
  const normalized = localizeLegacyText(value).trim();
  if (!normalized) return "LV";
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function channelId(type?: ChannelType | null): ChannelId {
  switch (type) {
    case "INSTAGRAM":
      return "instagram";
    case "WHATSAPP":
      return "whatsapp";
    case "TELEGRAM":
      return "telegram";
    case "EMAIL":
      return "email";
    case "WEBHOOK":
      return "webhook";
    case "WEBSITE":
    case "PHONE":
    case "VK":
    case "DEMO":
    case null:
    case undefined:
      return "website";
  }
}

function channelTypeFromId(id: ChannelId): ChannelType {
  switch (id) {
    case "instagram":
      return "INSTAGRAM";
    case "whatsapp":
      return "WHATSAPP";
    case "telegram":
      return "TELEGRAM";
    case "email":
      return "EMAIL";
    case "webhook":
      return "WEBHOOK";
    case "website":
      return "WEBSITE";
  }
}

function stageFromStatus(status?: string | null): LeadStage {
  switch (status) {
    case "NEW":
    case "OPEN":
      return "new";
    case "IN_PROGRESS":
    case "WAITING_FOR_CUSTOMER":
    case "WAITING_FOR_HUMAN":
      return "progress";
    case "QUALIFIED":
      return "qualified";
    case "BOOKED":
    case "ORDERED":
      return "booked";
    case "SENT_TO_CRM":
      return "crm";
    case "CLOSED":
      return "closed";
    case "LOST":
      return "lost";
    default:
      return "new";
  }
}

function temperatureLabel(temperature?: string | null) {
  const labels: Record<string, string> = {
    COLD: "Холодный",
    Cold: "Холодный",
    HOT: "Горячий",
    Hot: "Горячий",
    WARM: "Тёплый",
    Warm: "Тёплый"
  };

  return labels[temperature ?? ""] ?? temperature ?? "Не указана";
}

function senderFromMessage(message: { senderType: string }) {
  if (message.senderType === "AI") return "ai" as const;
  if (message.senderType === "USER") return "user" as const;
  if (message.senderType === "SYSTEM") return "system" as const;
  return "customer" as const;
}

function AiTypingIndicator({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.div
      key="ai-typing"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="flex justify-start"
    >
      <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-emerald-300" />
          <span>LeadVirt.ai готовит ответ</span>
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((dot) =>
              reduceMotion ? (
                <span key={dot} className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              ) : (
                <motion.span
                  key={dot}
                  className="h-1.5 w-1.5 rounded-full bg-emerald-300"
                  animate={{ opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
                  transition={{ duration: 0.85, repeat: Infinity, delay: dot * 0.14 }}
                />
              )
            )}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function useApiData<T>(loader: () => Promise<T>, fallback: T, deps: DependencyList = []) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loader()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить данные");
        setData(fallback);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, deps);

  return { data, loading, error, setData };
}

function Notice({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return <div className="mb-4 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">Загружаем данные LeadVirt.ai...</div>;
  }
  if (error) {
    const message = error === "Failed to fetch" ? "Не удалось получить данные" : localizeLegacyText(error);
    return <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{message}. Показан локальный набор данных.</div>;
  }
  return null;
}

function compactActivityLabel(value: string) {
  return value.replace(/\s+\((интеграция|диалог|лид|сценарий|рабочее пространство)\)$/u, "");
}

function fallbackConversations(): ConversationDetail[] {
  return fallbackLeads.map((lead) => ({
    id: lead.id,
    tenantId: "fallback",
    leadId: lead.id,
    channelType: lead.channel.toUpperCase() as ChannelType,
    status: lead.stage === "closed" ? "CLOSED" : "OPEN",
    subject: lead.interest,
    lastMessageAt: new Date().toISOString(),
    aiEnabled: lead.ai,
    handoffRequested: false,
    lead: {
      id: lead.id,
      tenantId: "fallback",
      name: lead.name,
      source: lead.source,
      channelType: lead.channel.toUpperCase() as ChannelType,
      status: "NEW",
      temperature: lead.temperature.toUpperCase() as Lead["temperature"],
      valueAmount: lead.value,
      currency: "RUB",
      interest: lead.interest,
      assignedToName: lead.manager,
      createdAt: new Date().toISOString()
    },
    lastMessage: lead.lastMessage,
    unreadCount: lead.unread,
    messages: [],
    events: []
  }));
}

export function DashboardView() {
  const reduceMotion = useReducedMotion();
  const { data: summary, loading, error } = useApiData<DashboardSummary | null>(getDashboardSummary, null);
  const metrics = summary
    ? [
        { icon: Inbox, label: "Новые лиды", value: String(summary.metrics.newLeadsCount), delta: "онлайн" },
        { icon: Bot, label: "Диалоги AI", value: String(summary.metrics.aiConversationsCount), delta: "24/7" },
        { icon: CalendarCheck, label: "Записи / заказы", value: String(summary.metrics.bookingsOrdersCreated), delta: "готово" },
        { icon: Database, label: "Лиды в CRM", value: String(summary.metrics.leadsSentToCrm), delta: "CRM" },
        { icon: Sparkles, label: "Средний ответ", value: `${summary.metrics.averageResponseTimeSeconds} сек`, delta: "AI" },
        { icon: Check, label: "Конверсия", value: `${summary.metrics.conversionRate}%`, delta: "воронка" }
      ]
    : dashboardMetrics;
  const trend = (summary?.trend ?? chartData).map((item) => ({ ...item, name: localizeLegacyText(item.name) }));
  const activity = (summary?.recentActivity.map((item) => localizeLegacyText(item.title)) ?? fallbackActivity).map(compactActivityLabel);
  const channelPerformance = summary?.channelPerformance ?? [];
  const newLeads = summary?.metrics.newLeadsCount ?? dashboardMetrics[0]?.value ?? "128";
  const booked = summary?.metrics.bookingsOrdersCreated ?? dashboardMetrics[2]?.value ?? "342";
  const responseTime = summary?.metrics.averageResponseTimeSeconds ? `${summary.metrics.averageResponseTimeSeconds} сек` : dashboardMetrics[4]?.value ?? "18 сек";
  const conversion = summary?.metrics.conversionRate ? `${summary.metrics.conversionRate}%` : dashboardMetrics[5]?.value ?? "31,4%";
  const totalChannelValue = channelPerformance.length
    ? channelPerformance.reduce((sum, channel) => sum + channel.valueAmount, 0)
    : fallbackLeads.reduce((sum, lead) => sum + lead.value, 0);
  const dashboardMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.34, ease: "easeOut" as const } };
  const hoverMotion = reduceMotion ? {} : { whileHover: { y: -3 } };

  return (
    <>
      <PageHeader
        title="Обзор"
        description="LeadVirt.ai собирает входящие каналы, скорость ответа, заявки и передачу лидов в CRM."
        actions={<Button><Plus className="h-4 w-4" /> Новый сценарий</Button>}
      />
      <Notice loading={loading} error={error} />
      <motion.section {...dashboardMotion} className="mb-4">
        <Card className="overflow-hidden border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(24,24,27,0.66)_45%,rgba(14,165,233,0.09))] p-5 md:p-6">
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] xl:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                </span>
                AI-пульт сегодня
              </div>
              <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-zinc-50 md:text-4xl">
                Входящие заявки превращаются в запись, задачу или CRM-карточку без потери контекста.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
                Видно, где AI уже ответил, какие каналы приносят выручку и что менеджеру нужно забрать в работу прямо сейчас.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-zinc-300">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  <Users className="h-3.5 w-3.5 text-emerald-300" />
                  {newLeads} новых лидов
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                  Контекст сохранён
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild>
                  <a href="/app/inbox">
                    <Inbox className="h-4 w-4" />
                    Открыть входящие
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href="/app/automations">
                    <Workflow className="h-4 w-4" />
                    Сценарии AI
                  </a>
                </Button>
              </div>
            </div>
            <div className="hidden gap-3 sm:grid sm:grid-cols-2">
              {[
                { icon: Sparkles, label: "Средний ответ", value: responseTime },
                { icon: Check, label: "Конверсия", value: conversion },
                { icon: CalendarCheck, label: "Записи / заказы", value: String(booked) },
                { icon: Database, label: "Объём каналов", value: formatRub(totalChannelValue) }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-zinc-950/45 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3 text-emerald-300">
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-semibold text-zinc-500">live</span>
                    </div>
                    <div className="text-2xl font-bold tracking-tight text-zinc-50">{item.value}</div>
                    <div className="mt-1 text-xs text-zinc-400">{item.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </motion.section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={dashboardMotion.initial}
            animate={dashboardMotion.animate}
            transition={{ ...dashboardMotion.transition, delay: reduceMotion ? 0 : Math.min(index * 0.045, 0.24) }}
            {...hoverMotion}
          >
            <MetricCard {...metric} />
          </motion.div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <motion.div {...dashboardMotion} transition={{ ...dashboardMotion.transition, delay: reduceMotion ? 0 : 0.12 }} className="min-w-0">
        <Card className="h-full p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">Лиды и записи</h2>
              <p className="text-sm text-zinc-500">Недельная динамика заявок и записей</p>
            </div>
            <StagePill stage="booked" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} />
                <Line type="monotone" dataKey="leads" stroke="#34d399" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="booked" stroke="#38bdf8" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        </motion.div>
        <motion.div {...dashboardMotion} transition={{ ...dashboardMotion.transition, delay: reduceMotion ? 0 : 0.18 }} className="min-w-0">
        <Card className="h-full p-6">
          <h2 className="mb-5 text-lg font-semibold text-zinc-50">Последние события</h2>
          <div className="space-y-4">
            {activity.slice(0, 7).map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-3 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span className="text-zinc-300">{item}</span>
              </div>
            ))}
          </div>
        </Card>
        </motion.div>
        <motion.div {...dashboardMotion} transition={{ ...dashboardMotion.transition, delay: reduceMotion ? 0 : 0.24 }} className="min-w-0">
        <Card className="h-full p-6">
          <h2 className="mb-5 text-lg font-semibold text-zinc-50">Каналы</h2>
          <div className="space-y-3">
            {(channelPerformance.length ? channelPerformance : fallbackLeads.slice(0, 5).map((lead) => ({ channelType: lead.channel.toUpperCase() as ChannelType, name: lead.source, valueAmount: lead.value, leads: 1 }))).map((channel, index) => (
              <div key={`${channel.channelType}-${channel.name}-${index}`} className="flex items-center justify-between rounded-xl bg-white/5 p-3">
                <ChannelBadge id={channelId(channel.channelType)} label />
                <span className="text-sm font-semibold text-zinc-100">{formatRub(channel.valueAmount)}</span>
              </div>
            ))}
          </div>
        </Card>
        </motion.div>
      </div>
    </>
  );
}

export function InboxView() {
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const { data, loading, error } = useApiData(
    () => listInboxConversations({ ...(status ? { status: status as ConversationDetail["status"] } : {}), search, limit: 30 }),
    { data: fallbackConversations(), pagination: { page: 1, limit: 30, total: fallbackConversations().length, hasMore: false } },
    [status, search]
  );
  const conversations = data.data;
  const selected = conversations[0];
  const reduceMotion = useReducedMotion();
  const hasFilters = Boolean(status || search.trim());
  const totalConversations = conversations.length;
  const unreadTotal = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);
  const aiActiveTotal = conversations.filter((conversation) => conversation.aiEnabled).length;
  const handoffTotal = conversations.filter((conversation) => conversation.handoffRequested || conversation.status === "WAITING_FOR_HUMAN").length;
  const rowMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.26, ease: "easeOut" as const } };
  const rowHover = reduceMotion ? {} : { whileHover: { x: 4 } };
  const panelMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.32, ease: "easeOut" as const } };

  return (
    <>
      <PageHeader
        title="Входящие"
        description="Единая очередь LeadVirt.ai с AI-статусом, источником, качеством лида и быстрыми действиями."
        actions={<Button variant="outline"><Filter className="h-4 w-4" /> Фильтры</Button>}
      />
      <Notice loading={loading} error={error} />
      <motion.div {...panelMotion} className="mb-4 hidden grid-cols-4 gap-3 md:grid">
        {[
          { label: "Диалоги в очереди", value: totalConversations, icon: Inbox },
          { label: "Непрочитано", value: unreadTotal, icon: MessageCircle },
          { label: "AI ведёт", value: aiActiveTotal, icon: Bot },
          { label: "Нужен человек", value: handoffTotal, icon: Users }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold leading-none text-zinc-50">{item.value}</div>
                <div className="mt-1 truncate text-xs text-zinc-500">{item.label}</div>
              </div>
            </Card>
          );
        })}
      </motion.div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.75fr]">
        <motion.div {...panelMotion} className="min-w-0">
        <Card className="overflow-hidden">
          <div className="space-y-3 border-b border-white/5 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-10 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/50"
                placeholder="Поиск по имени, интересу или сообщению"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["", "Все"],
                ["OPEN", "Открытые"],
                ["WAITING_FOR_HUMAN", "Нужен человек"],
                ["WAITING_FOR_CUSTOMER", "Ждём клиента"],
                ["CLOSED", "Закрытые"]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setStatus(value)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${status === value ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-white/10 bg-white/5 text-zinc-300 hover:text-zinc-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-[360px] space-y-1 p-2">
            {loading ? (
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex animate-pulse gap-4 rounded-2xl p-3">
                    <div className="h-9 w-9 rounded-full bg-white/8" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="h-3 w-2/5 rounded-full bg-white/8" />
                      <div className="h-3 w-4/5 rounded-full bg-white/5" />
                      <div className="flex gap-2">
                        <div className="h-5 w-20 rounded-full bg-white/5" />
                        <div className="h-5 w-28 rounded-full bg-white/5" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
                  <Inbox className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200">Диалоги не найдены</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                  Выберите другой статус или очистите поиск, чтобы увидеть больше диалогов LeadVirt.ai.
                </p>
                {hasFilters ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-5"
                    onClick={() => {
                      setStatus("");
                      setSearch("");
                    }}
                  >
                    <X className="h-4 w-4" />
                    Очистить фильтры
                  </Button>
                ) : null}
              </motion.div>
            ) : (
              <AnimatePresence initial={false}>
                {conversations.map((conversation, index) => {
                const lead = conversation.lead;
                return (
                  <motion.a
                    key={conversation.id}
                    href={`/app/inbox/${conversation.id}`}
                    initial={rowMotion.initial}
                    animate={rowMotion.animate}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ ...rowMotion.transition, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.25) }}
                    {...rowHover}
                    className={cn(
                      "group relative flex gap-4 rounded-2xl border p-3 transition-colors",
                      index === 0
                        ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                        : "border-transparent hover:border-white/8 hover:bg-white/[0.03]"
                    )}
                  >
                    <ChannelBadge id={channelId(conversation.channelType ?? lead?.channelType)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate font-semibold text-zinc-50">{localizeLegacyText(lead?.name ?? conversation.subject ?? "Новый диалог")}</h3>
                        <span className="text-xs text-zinc-500">{formatDateTime(conversation.lastMessageAt)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm text-zinc-400">{localizeLegacyText(conversation.lastMessage) || "Пока нет сообщений"}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <StagePill stage={stageFromStatus(lead?.status ?? conversation.status)} />
                        <span className="text-xs text-zinc-500">{localizeLegacyText(lead?.interest ?? conversation.subject)}</span>
                      </div>
                    </div>
                    {conversation.unreadCount ? (
                      <span className="mt-0.5 flex h-6 min-w-6 shrink-0 self-start rounded-full bg-emerald-400 px-2 text-xs font-bold leading-6 text-zinc-950 shadow-[0_0_14px_rgba(52,211,153,0.28)]">
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </motion.a>
                );
                })}
              </AnimatePresence>
            )}
          </div>
        </Card>
        </motion.div>
        <motion.div {...panelMotion} transition={{ ...panelMotion.transition, delay: reduceMotion ? 0 : 0.08 }} className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          <LeadSummary lead={selected?.lead ?? null} conversation={selected ?? null} />
        </motion.div>
      </div>
    </>
  );
}

export function ConversationView({ leadId = "" }: { leadId?: string }) {
  const fallback = fallbackConversations()[0];
  const { data: conversation, loading, error, setData } = useApiData<ConversationDetail | null>(
    () => (leadId ? import("@/lib/api/conversations").then((api) => api.getConversation(leadId)) : Promise.resolve(null)),
    fallback ?? null,
    [leadId]
  );
  const [input, setInput] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const lead = conversation?.lead ?? null;
  const leadName = localizeLegacyText(lead?.name ?? conversation?.subject) || "Диалог";
  const leadInterest = localizeLegacyText(lead?.interest ?? lead?.summary ?? conversation?.subject) || "Интерес уточняется";
  const activeChannel = channelId(conversation?.channelType ?? lead?.channelType);
  const leadStage = stageFromStatus(lead?.status ?? conversation?.status);
  const aiEnabled = conversation?.aiEnabled ?? true;
  const messages = conversation?.messages.length ? conversation.messages : fallbackMessages.map((message) => ({
    id: message.id,
    tenantId: "fallback",
    conversationId: "fallback",
    direction: message.sender === "customer" ? "INBOUND" : "OUTBOUND",
    senderType: message.sender === "ai" ? "AI" : "CUSTOMER",
    text: message.text,
    createdAt: new Date().toISOString()
  }));
  const panelMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: "easeOut" as const } };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages.length, pendingText, reduceMotion, sending]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setPendingText(text);
    setActionMessage("Отправляем сообщение...");
    try {
      const updated = await sendConversationMessage(conversation.id, text);
      setData(updated);
      setActionMessage("AI LeadVirt.ai подготовил ответ и обновил карточку лида.");
    } catch (caught) {
      setInput(text);
      setActionMessage(caught instanceof Error ? caught.message : "Не удалось отправить сообщение.");
    } finally {
      setPendingText(null);
      setSending(false);
    }
  }

  async function runLeadAction(action: "crm" | "task" | "booking" | "qualified") {
    if (!lead) return;
    try {
      if (action === "crm") {
        const updatedLead = await sendLeadToCrm(lead.id);
        setData(conversation ? { ...conversation, lead: updatedLead } : conversation);
        setActionMessage("Лид отправлен в CRM, запись добавлена в журнал синхронизации.");
        return;
      }
      if (action === "task") await createLeadTask(lead.id, "Связаться с лидом из диалога");
      if (action === "booking") await bookLeadAppointment(lead.id, lead.interest ?? "Запись", new Date(Date.now() + 24 * 60 * 60_000).toISOString());
      if (action === "qualified") {
        const updatedLead = await updateLead(lead.id, { status: "QUALIFIED" });
        setData(conversation ? { ...conversation, lead: updatedLead } : conversation);
      }
      setActionMessage("Действие выполнено и записано в журнал аудита.");
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Не удалось выполнить действие.");
    }
  }

  return (
    <>
      <PageHeader
        title={leadName}
        description="Сообщения, AI-ответы, контекст лида и безопасная передача менеджеру."
        actions={
          <>
            <Button variant="outline" onClick={() => void runLeadAction("qualified")}><Bot className="h-4 w-4" /> Квалифицировать</Button>
            <Button onClick={() => void runLeadAction("crm")}><Database className="h-4 w-4" /> В CRM</Button>
          </>
        }
      />
      <Notice loading={loading} error={error} />
      <AnimatePresence>
        {actionMessage ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          >
            {actionMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[1fr_360px]">
        <motion.div {...panelMotion} className="min-w-0">
        <Card className="flex min-h-0 flex-col overflow-hidden border-white/10">
          <div className="border-b border-white/5 bg-white/[0.025] p-4">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 via-teal-400 to-sky-400 text-base font-black text-zinc-950 shadow-[0_0_30px_rgba(52,211,153,0.2)]">
                  {initialsFor(leadName)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-zinc-50">{leadName}</h2>
                    <StatusBadge tone={aiEnabled ? "success" : "neutral"}>{aiEnabled ? "AI активен" : "Ручной режим"}</StatusBadge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-400">{leadInterest}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ChannelBadge id={activeChannel} label />
                <StagePill stage={leadStage} />
                {conversation?.handoffRequested ? <StatusBadge tone="warning">Нужен человек</StatusBadge> : null}
              </div>
            </div>
          </div>
          <div ref={messagesContainerRef} className="flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(52,211,153,0.08),transparent_38%)] p-4 md:p-5">
            <AnimatePresence initial={false}>
              {messages.map((message, index) => (
                <motion.div
                  key={message.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.16) }}
                >
                  <ChatBubble sender={senderFromMessage(message)} time={formatDateTime(message.createdAt)}>
                    {localizeLegacyText(message.text) || ""}
                  </ChatBubble>
                </motion.div>
              ))}
              {pendingText ? (
                <motion.div
                  key="pending-message"
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  <ChatBubble sender="user" time="отправка">
                    {pendingText}
                  </ChatBubble>
                </motion.div>
              ) : null}
              {sending ? <AiTypingIndicator reduceMotion={reduceMotion} /> : null}
            </AnimatePresence>
          </div>
          <form onSubmit={(event) => { void handleSend(event); }} className="flex flex-col border-t border-white/5 bg-zinc-950/45 p-4">
            <div className="order-2 mt-3 flex flex-wrap items-center gap-2 md:order-1 md:mb-3 md:mt-0">
              <span className="mr-1 text-xs font-semibold text-zinc-500">Быстрые ответы</span>
              {["Уточнить телефон", "Предложить слот", "Передать менеджеру", "Спросить бюджет"].map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => setInput(reply)}
                  disabled={sending}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition hover:text-zinc-50 disabled:pointer-events-none disabled:opacity-50"
                >
                  {reply}
                </button>
              ))}
            </div>
            <div className="order-1 flex gap-2 md:order-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={sending}
                className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 text-sm outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/50 disabled:opacity-60"
                placeholder="Написать сообщение..."
              />
              <Button size="icon" aria-label="Отправить сообщение" disabled={sending || !input.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </Card>
        </motion.div>
        <motion.div {...panelMotion} transition={{ ...panelMotion.transition, delay: reduceMotion ? 0 : 0.08 }} className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          <LeadSummary lead={lead} conversation={conversation} onAction={(action) => { void runLeadAction(action); }} />
        </motion.div>
      </div>
    </>
  );
}

function LeadSummary({
  lead,
  conversation,
  onAction
}: {
  lead: Lead | null;
  conversation?: Pick<ConversationDetail, "id" | "channelType" | "status" | "aiEnabled" | "handoffRequested" | "lastMessage" | "lastMessageAt"> | null;
  onAction?: (action: "crm" | "task" | "booking" | "qualified") => void;
}) {
  if (!lead) {
    return (
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-zinc-50">Лид не выбран</h2>
        <p className="mt-2 text-sm text-zinc-500">Выберите диалог, чтобы увидеть карточку лида.</p>
      </Card>
    );
  }

  const leadName = localizeLegacyText(lead.name) || "Новый лид";
  const leadInterest = localizeLegacyText(lead.interest ?? lead.summary) || "Интерес уточняется";
  const leadSource = localizeLegacyText(lead.source) || "LeadVirt.ai";
  const leadSummary = localizeLegacyText(lead.summary);
  const latestMessage = localizeLegacyText(conversation?.lastMessage) || leadSummary || leadInterest;
  const activeChannel = channelId(conversation?.channelType ?? lead.channelType);
  const aiEnabled = conversation?.aiEnabled ?? true;
  const rows = [
    ["Источник", leadSource],
    ["Сумма", formatRub(lead.valueAmount)],
    ["Менеджер", lead.assignedToName ?? "Не назначен"],
    ["Температура", temperatureLabel(lead.temperature)]
  ];

  return (
    <Card className="overflow-hidden border-emerald-500/15 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
      <div className="border-b border-white/8 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(24,24,27,0.72))] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 via-teal-400 to-sky-400 text-lg font-black text-zinc-950 shadow-[0_0_34px_rgba(52,211,153,0.22)]">
            {initialsFor(leadName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-zinc-50">{leadName}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-400">{leadInterest}</p>
              </div>
              <StagePill stage={stageFromStatus(lead.status)} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ChannelBadge id={activeChannel} label />
              <StatusBadge tone={aiEnabled ? "success" : "neutral"}>{aiEnabled ? "AI активен" : "Ручной режим"}</StatusBadge>
              {conversation?.handoffRequested ? <StatusBadge tone="warning">Нужен человек</StatusBadge> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div className="rounded-2xl border border-white/8 bg-white/[0.025]">
          {rows.map(([label, value], index) => (
            <div key={label} className={cn("flex items-center justify-between gap-4 px-4 py-3 text-sm", index ? "border-t border-white/6" : "")}>
              <span className="text-zinc-500">{label}</span>
              <span className={cn("text-right font-semibold text-zinc-200", label === "Сумма" ? "text-emerald-300" : "")}>{value}</span>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-white/8 bg-zinc-950/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Последнее сообщение</p>
            {conversation?.lastMessageAt ? <span className="text-xs text-zinc-600">{formatDateTime(conversation.lastMessageAt)}</span> : null}
          </div>
          <p className="line-clamp-3 text-sm leading-6 text-zinc-200">{latestMessage}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-50/80">
          <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Следующий шаг готов
          </div>
          <p>Источник, интерес, температура и последняя реплика уже собраны для менеджера.</p>
        </div>
        {onAction ? (
          <div className="grid gap-2">
            <Button variant="outline" className="justify-start" onClick={() => onAction("qualified")}><Bot className="h-4 w-4" /> Квалифицировать</Button>
            <Button variant="outline" className="justify-start" onClick={() => onAction("task")}><Clock className="h-4 w-4" /> Создать задачу</Button>
            <Button variant="outline" className="justify-start" onClick={() => onAction("booking")}><CalendarCheck className="h-4 w-4" /> Записать</Button>
            <Button className="justify-start" onClick={() => onAction("crm")}><ArrowRight className="h-4 w-4" /> Отправить в CRM</Button>
          </div>
        ) : conversation?.id ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <a
              href={`/app/inbox/${conversation.id}`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/15 transition hover:bg-emerald-300"
            >
              <MessageCircle className="h-4 w-4" />
              Открыть диалог
            </a>
            <a
              href="/app/leads"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
            >
              <Database className="h-4 w-4" />
              Воронка CRM
            </a>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function LeadsView() {
  const fallbackStatusByStage: Record<LeadStage, LeadStatus> = {
    new: "NEW",
    progress: "IN_PROGRESS",
    qualified: "QUALIFIED",
    booked: "BOOKED",
    crm: "SENT_TO_CRM",
    closed: "CLOSED",
    lost: "LOST"
  };
  const fallbackStages = (Object.keys(stageLabels) as LeadStage[]).map((stage) => ({
    status: fallbackStatusByStage[stage],
    count: fallbackLeads.filter((lead) => lead.stage === stage).length,
    valueAmount: fallbackLeads.filter((lead) => lead.stage === stage).reduce((sum, lead) => sum + lead.value, 0),
    leads: fallbackLeads.filter((lead) => lead.stage === stage).map((lead) => ({
      id: lead.id,
      tenantId: "fallback",
      name: lead.name,
      source: lead.source,
      channelType: channelTypeFromId(lead.channel),
      status: fallbackStatusByStage[stage],
      temperature: lead.temperature.toUpperCase() as Lead["temperature"],
      valueAmount: lead.value,
      currency: "RUB",
      interest: lead.interest,
      assignedToName: lead.manager,
      createdAt: new Date().toISOString()
    }))
  }));
  const { data, loading, error } = useApiData(getPipelineSummary, { stages: fallbackStages });
  const reduceMotion = useReducedMotion();
  const totalLeads = data.stages.reduce((sum, stage) => sum + stage.count, 0);
  const totalValue = data.stages.reduce((sum, stage) => sum + stage.valueAmount, 0);
  const activeStages = data.stages.filter((stage) => stage.count > 0).length;
  const stagesForSummary = data.stages.length ? data.stages : fallbackStages;
  const fallbackSummaryStage: (typeof stagesForSummary)[number] = { status: "NEW", count: 0, valueAmount: 0, leads: [] };
  const hottestStage = stagesForSummary.reduce(
    (best, stage) => (stage.valueAmount > best.valueAmount ? stage : best),
    stagesForSummary[0] ?? fallbackSummaryStage
  );
  const hottestStageLabel = stageLabels[stageFromStatus(hottestStage.status)] ?? "Воронка";
  const columnMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: "easeOut" as const } };
  const cardHover = reduceMotion ? {} : { whileHover: { y: -3 } };

  return (
    <>
      <PageHeader
        title="Воронка лидов"
        description="Канбан по статусам, источникам, суммам и ответственным менеджерам."
        actions={<Button><Plus className="h-4 w-4" /> Новый лид</Button>}
      />
      <Notice loading={loading} error={error} />
      <motion.section
        initial={columnMotion.initial}
        animate={columnMotion.animate}
        transition={columnMotion.transition}
        className="mb-4"
      >
        <Card className="overflow-hidden border-emerald-500/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(24,24,27,0.72)_48%,rgba(56,189,248,0.08))] p-4 md:p-5">
          <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-center">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                CRM-пульт
              </div>
              <h2 className="max-w-3xl text-xl font-bold tracking-tight text-zinc-50 md:text-2xl">
                {totalLeads} лидов на {formatRub(totalValue)} проходят через {activeStages} активных этапов.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Самый ценный этап сейчас: {hottestStageLabel}. Перемещайте работу между этапами через карточки и открывайте диалог для контекста.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Лиды", String(totalLeads)],
                ["Воронка", formatRub(totalValue)],
                ["Этапы", `${activeStages}/${data.stages.length}`]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-zinc-950/45 px-3 py-3">
                  <div className="text-base font-bold text-zinc-50 md:text-lg">{value}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </motion.section>
      <div className="flex gap-4 overflow-x-auto pb-3">
        {data.stages.map((stage, stageIndex) => (
          <motion.div
            key={stage.status}
            initial={columnMotion.initial}
            animate={columnMotion.animate}
            transition={{ ...columnMotion.transition, delay: reduceMotion ? 0 : Math.min(stageIndex * 0.045, 0.28) }}
            className="flex min-w-[270px] max-w-[292px] flex-1"
          >
            <Card className="flex w-full flex-col p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <StagePill stage={stageFromStatus(stage.status)} />
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/8 px-2 text-xs font-semibold text-zinc-200">{stage.count}</span>
              </div>
              <div className="mb-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-emerald-300">
                {formatRub(stage.valueAmount)}
              </div>
              <div className="flex flex-1 flex-col gap-3">
                <AnimatePresence initial={false}>
                  {stage.leads.length ? (
                    stage.leads.map((lead, leadIndex) => (
                      <motion.a
                        key={lead.id}
                        href="/app/inbox"
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                        transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : Math.min(leadIndex * 0.035, 0.18) }}
                        {...cardHover}
                        className="group block rounded-2xl border border-white/8 bg-white/[0.035] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.06]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate text-sm font-semibold text-zinc-50">{localizeLegacyText(lead.name) || "Новый лид"}</h3>
                          <ChannelBadge id={channelId(lead.channelType)} />
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-zinc-400">{localizeLegacyText(lead.interest) || "Интерес уточняется"}</p>
                        <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
                          <span className="truncate text-zinc-500">{localizeLegacyText(lead.assignedToName) || "Не назначен"}</span>
                          <span className="shrink-0 font-semibold text-emerald-300">{formatRub(lead.valueAmount)}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/6 pt-2 text-[11px] font-semibold">
                          <span className="text-zinc-500">{temperatureLabel(lead.temperature)}</span>
                          <span className="inline-flex items-center gap-1 text-emerald-300 opacity-80 transition group-hover:opacity-100">
                            Открыть
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </div>
                      </motion.a>
                    ))
                  ) : (
                    <motion.div
                      key={`${stage.status}-empty`}
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center"
                    >
                      <Inbox className="h-5 w-5 text-zinc-600" />
                      <p className="mt-2 text-xs text-zinc-600">Пока нет лидов</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}

export function AutomationsView() {
  const { data: workflows, loading, error, setData } = useApiData<WorkflowDto[]>(
    listWorkflows,
    fallbackWorkflows.map((workflow) => ({ id: workflow.title, tenantId: "fallback", name: workflow.title, status: "DRAFT", version: 1, description: `${workflow.steps} steps` }))
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const selected = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0];
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const workflowStatusLabel: Record<string, string> = {
    ACTIVE: "Активен",
    ARCHIVED: "Архив",
    DRAFT: "Черновик",
    PAUSED: "Пауза"
  };
  const workflowNameLabel: Record<string, string> = {
    "Booking appointment": "Запись на услугу",
    "Booking request": "Запись на услугу",
    "Запись клиента": "Запись на услугу",
    "Квалификация лида": "Квалификация лида",
    "Передача менеджеру": "Передача менеджеру",
    "Возврат follow-up": "Возврат follow-up",
    "FAQ response": "Ответы на FAQ",
    "Follow-up": "Повторное касание",
    "Follow-up recovery": "Повторное касание",
    "Human handoff": "Передача человеку",
    "Lead qualification": "Квалификация лида",
    "Order assistance": "Оформление заказа",
    "Send to CRM": "Отправка в CRM"
  };
  const fallbackFlowSteps = [
    { name: "Триггер: новое сообщение", caption: "Клиент пишет в любой канал", icon: MessageCircle },
    { name: "AI-приветствие", caption: "Персональное приветствие и сбор контекста", icon: Bot },
    { name: "Квалификация", caption: "AI задаёт уточняющие вопросы", icon: Check },
    { name: "Условие", caption: "Целевой лид?", icon: Workflow },
    { name: "Запись / Заказ", caption: "Бронирование времени или оформление заказа", icon: CalendarCheck },
    { name: "Повторное касание", caption: "Напоминание через 24ч, если нет ответа", icon: Clock },
    { name: "Отправка в CRM", caption: "Структурированный лид уходит в amoCRM", icon: Database }
  ];
  const flowStepNameLabel: Record<string, string> = {
    "Collect key details": "Сбор деталей",
    "Create event or handoff": "Запись или передача",
    Done: "Готово",
    "New customer message": "Триггер: новое сообщение",
    "Safe AI reply": "Безопасный AI-ответ"
  };
  const flowStepTypeLabel: Record<string, string> = {
    ACTION: "Создать запись, задачу или сделку",
    AI_MESSAGE: "Ответ с учетом правил безопасности",
    CONDITION: "Проверка условия и ветвление",
    END: "Финальное состояние сценария",
    HANDOFF: "Передача менеджеру",
    QUESTION: "Уточняющий вопрос клиенту",
    TRIGGER: "Клиент пишет в любой канал"
  };
  const flowSteps = selected?.steps?.length
    ? selected.steps.map((step) => ({
        name: flowStepNameLabel[step.name] ?? step.name,
        caption: flowStepTypeLabel[step.type] ?? step.type.replaceAll("_", " ").toLowerCase(),
        icon: step.type === "TRIGGER" ? MessageCircle : step.type === "ACTION" ? Database : step.type === "CONDITION" ? Workflow : Bot
      }))
    : fallbackFlowSteps;

  async function runWorkflowAction(action: "publish" | "test") {
    if (!selected) return;
    try {
      if (action === "publish") {
        const updated = await publishWorkflow(selected.id);
        setData(workflows.map((workflow) => (workflow.id === updated.id ? updated : workflow)));
        setActionMessage("Сценарий опубликован.");
      } else {
        const result = await testWorkflow(selected.id);
        setActionMessage(result.message);
      }
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Не удалось выполнить действие.");
    }
  }

  return (
    <>
      <PageHeader
        title="Автоматизация"
        description="Сценарии LeadVirt.ai: квалификация, запись, заказ, FAQ, follow-up и отправка в CRM."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runWorkflowAction("test")}>
              <ShieldCheck className="h-4 w-4" />
              Тест
            </Button>
            <Button onClick={() => void runWorkflowAction("publish")}>
              <Workflow className="h-4 w-4" />
              Опубликовать
            </Button>
          </div>
        )}
      />
      <Notice loading={loading} error={error} />
      <AnimatePresence>
        {actionMessage ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          >
            {actionMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="mb-5 flex flex-wrap gap-2">
        {workflows.slice(0, 5).map((workflow) => {
          const active = selected?.id === workflow.id;
          return (
            <button
              key={workflow.id}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition",
                active
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.16)]"
                  : "border-white/8 bg-white/[0.03] text-zinc-400 hover:border-white/15 hover:text-zinc-100"
              )}
              onClick={() => setSelectedWorkflowId(workflow.id)}
              type="button"
            >
              {workflowNameLabel[workflow.name] ?? workflow.name}
            </button>
          );
        })}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden p-5">
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/8 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">{workflowNameLabel[selected?.name ?? ""] ?? selected?.name ?? "Запись на услугу"}</h2>
              <p className="mt-1 text-sm text-zinc-500">{flowSteps.length} блоков · обновлено только что</p>
            </div>
            <StatusBadge tone={selected?.status === "ACTIVE" ? "success" : selected?.status === "PAUSED" ? "warning" : "neutral"}>
              {workflowStatusLabel[selected?.status ?? ""] ?? "Черновик"}
            </StatusBadge>
          </div>
          <div className="relative mx-auto max-w-2xl py-2">
            <div className="absolute left-1/2 top-4 hidden h-[calc(100%-2rem)] w-px -translate-x-1/2 bg-gradient-to-b from-emerald-400/0 via-emerald-400/45 to-emerald-400/0 md:block" />
            <div className="space-y-7">
              {flowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <motion.div
                    key={`${step.name}-${index}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.24) }}
                    className={cn(
                      "relative mx-auto flex max-w-xl items-center justify-between gap-4 rounded-2xl border bg-zinc-900/70 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)]",
                      index === 0 ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/8"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-50">{step.name}</h3>
                        <p className="mt-1 text-xs text-zinc-500">{step.caption}</p>
                      </div>
                    </div>
                    <div className="relative h-5 w-9 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_22px_rgba(52,211,153,0.2)]">
                      <span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-zinc-950" />
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <button className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-dashed border-white/10 px-6 py-3 text-sm font-semibold text-zinc-500 transition hover:border-emerald-500/30 hover:text-emerald-200" type="button">
              <Plus className="h-4 w-4" />
              Добавить блок
            </button>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">{flowSteps[0]?.name ?? "Триггер"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Настройки выбранного блока</p>
            </div>
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]" />
          </div>
          <div className="space-y-4">
            {[
              ["Telegram", true],
              ["WhatsApp", true],
              ["Instagram", false],
              ["Web-чат", true]
            ].map(([label, enabled]) => (
              <div key={String(label)} className="flex items-center justify-between text-sm">
                <span className="text-zinc-200">{label}</span>
                <span className={cn("relative h-5 w-9 rounded-full transition", enabled ? "bg-emerald-400" : "bg-white/10")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-zinc-950 transition", enabled ? "right-0.5" : "left-0.5")} />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Ключевые слова</p>
            <p className="mt-3 rounded-xl border border-white/8 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-400">Оставьте пустым для всех сообщений</p>
          </div>
          <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-50/80">
            Используйте <span className="font-mono text-emerald-200">{"{{переменная}}"}</span> для подстановки имени, телефона, источника, бюджета и даты.
          </div>
          <Button className="mt-5 w-full" variant="outline" onClick={() => void runWorkflowAction("test")}>Тестировать сценарий</Button>
        </Card>
      </div>
    </>
  );
}

export function AnalyticsView() {
  const { data, loading, error } = useApiData<AnalyticsOverview | null>(getAnalyticsOverview, null);
  const trend = data?.leadsOverTime ?? chartData;
  const fallbackLeadsByChannel: AnalyticsOverview["leadsByChannel"] = [
    { channelType: "INSTAGRAM", leads: 412, conversionRate: 31 },
    { channelType: "WHATSAPP", leads: 388, conversionRate: 38 },
    { channelType: "TELEGRAM", leads: 256, conversionRate: 29 },
    { channelType: "WEBSITE", leads: 198, conversionRate: 24 },
    { channelType: "EMAIL", leads: 64, conversionRate: 18 }
  ];
  const rawLeadsByChannel = data?.leadsByChannel ?? fallbackLeadsByChannel;
  const channelTotals = rawLeadsByChannel.reduce<Record<string, { id: ChannelId; leads: number; conversionTotal: number; count: number }>>((acc, item) => {
    const id = channelId(item.channelType);
    const current = acc[id] ?? { id, leads: 0, conversionTotal: 0, count: 0 };
    current.leads += item.leads;
    current.conversionTotal += item.conversionRate;
    current.count += 1;
    acc[id] = current;
    return acc;
  }, {});
  const leadsByChannel = Object.values(channelTotals)
    .map((item) => ({ id: item.id, leads: item.leads, conversionRate: Math.round(item.conversionTotal / Math.max(item.count, 1)) }))
    .sort((a, b) => b.leads - a.leads);
  const scenarioNameLabel: Record<string, string> = {
    "Booking appointment": "Запись на услугу",
    "FAQ response": "Ответы на FAQ",
    "Follow-up": "Повторное касание",
    "Order assistance": "Оформление заказа",
    "Send to CRM": "Отправка в CRM"
  };
  const scenarioConversion = (data?.conversionByScenario ?? [
    { scenario: "Запись на услугу", conversionRate: 38, runs: 412 },
    { scenario: "Консультация по прайсу", conversionRate: 30, runs: 256 },
    { scenario: "Оформление заказа", conversionRate: 26, runs: 198 },
    { scenario: "Повторное касание", conversionRate: 21, runs: 121 }
  ]).map((item) => ({ ...item, scenario: scenarioNameLabel[item.scenario] ?? item.scenario }));
  const responseTrend = [
    { time: "00:00", seconds: Math.max((data?.responseTime.averageSeconds ?? 18) - 4, 8) },
    { time: "04:00", seconds: Math.max((data?.responseTime.averageSeconds ?? 18) - 5, 8) },
    { time: "08:00", seconds: data?.responseTime.averageSeconds ?? 18 },
    { time: "12:00", seconds: data?.responseTime.p90Seconds ?? 28 },
    { time: "16:00", seconds: Math.max((data?.responseTime.averageSeconds ?? 18) + 3, 10) },
    { time: "20:00", seconds: data?.responseTime.averageSeconds ?? 18 }
  ];
  const insightLabels = data?.aiInsights?.length
    ? data.aiInsights.map((insight) =>
        insight
          .replace("Website and Instagram create the highest-value qualified leads this week.", "Сайт и Instagram дают самые дорогие квалифицированные лиды на этой неделе.")
          .replace("LeadVirt.ai should hand off medical or legal questions to a human before replying.", "Медицинские и юридические вопросы лучше передавать менеджеру до ответа AI.")
          .replace("Booking workflows perform best when the AI asks for preferred time earlier.", "Сценарии записи работают лучше, когда AI раньше спрашивает удобное время.")
          .replace("Follow-up can recover warm leads that stop responding after the first price question.", "Follow-up возвращает тёплых лидов, которые пропали после вопроса о цене.")
      )
    : ["Подключите API, чтобы увидеть рекомендации LeadVirt.ai."];
  const metrics = [
    { icon: Users, label: "Лиды", value: String(trend.reduce((sum, item) => sum + item.leads, 0)), delta: "7 дней" },
    { icon: Sparkles, label: "Конверсия", value: `${Math.round(scenarioConversion.reduce((sum, item) => sum + item.conversionRate, 0) / Math.max(scenarioConversion.length, 1))}%`, delta: "+6%" },
    { icon: Clock, label: "Средний ответ", value: `${data?.responseTime.averageSeconds ?? 18} сек`, delta: "-22%" },
    { icon: CalendarCheck, label: "Записи / заказы", value: String((data?.bookingsOrders.bookings ?? 0) + (data?.bookingsOrders.orders ?? 0)), delta: "данные" },
    { icon: CreditCard, label: "Оценка выручки", value: formatRub(data?.estimatedRevenue), delta: "демо" }
  ];

  return (
    <>
      <PageHeader
        title="Аналитика"
        description="Каналы, конверсия сценариев, скорость ответа, выручка и AI-рекомендации."
        actions={(
          <div className="flex flex-wrap gap-2">
            {["7 дней", "30 дней", "Квартал"].map((period, index) => (
              <button
                key={period}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  index === 1 ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" : "border-white/8 bg-white/[0.03] text-zinc-400 hover:text-zinc-100"
                )}
                type="button"
              >
                {period}
              </button>
            ))}
            <Button variant="outline">Экспорт</Button>
          </div>
        )}
      />
      <Notice loading={loading} error={error} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Лиды по каналам</h2>
          <p className="mt-1 text-sm text-zinc-500">Количество обращений за период</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadsByChannel.map((item) => ({ ...item, name: channels[item.id].label }))} layout="vertical" margin={{ left: 16, right: 16 }}>
                <XAxis type="number" stroke="#71717a" fontSize={12} />
                <YAxis dataKey="name" type="category" width={84} stroke="#71717a" fontSize={12} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} />
                <Bar dataKey="leads" fill="#34d399" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Конверсия по сценариям</h2>
          <p className="mt-1 text-sm text-zinc-500">Процент успешных сценариев</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scenarioConversion}>
                <XAxis dataKey="scenario" stroke="#71717a" fontSize={11} angle={-12} textAnchor="end" height={64} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} />
                <Bar dataKey="conversionRate" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Время ответа AI</h2>
          <p className="mt-1 text-sm text-zinc-500">Среднее время в течение суток</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={responseTrend}>
                <XAxis dataKey="time" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} />
                <Line type="monotone" dataKey="seconds" stroke="#14b8a6" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Лиды и записи по дням</h2>
          <p className="mt-1 text-sm text-zinc-500">Динамика за неделю</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} />
                <Line type="monotone" dataKey="leads" stroke="#34d399" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="booked" stroke="#818cf8" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-6">
          <h2 className="mb-5 text-lg font-semibold text-zinc-50">Лучшие каналы</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {leadsByChannel.slice(0, 6).map((channel) => (
              <div key={channel.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <ChannelBadge id={channel.id} label />
                <div className="text-right">
                  <p className="font-semibold text-zinc-100">{channel.leads}</p>
                  <p className="text-xs text-zinc-500">{channel.conversionRate}%</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="mb-5 text-lg font-semibold text-zinc-50">AI-рекомендации</h2>
          <div className="grid gap-3">
            {insightLabels.map((insight) => (
              <div key={insight} className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">{insight}</div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

export function IntegrationsView() {
  const { data: integrations, loading, error, setData } = useApiData<IntegrationAccount[]>(listIntegrations, []);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, IntegrationTestResult>>({});
  const [sampleProvider, setSampleProvider] = useState<string | null>(null);
  const [sampleResults, setSampleResults] = useState<Record<string, IntegrationSampleDeliveryResult>>({});
  const reduceMotion = useReducedMotion();
  const cardMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.34, ease: "easeOut" as const } };
  const hoverMotion = reduceMotion ? {} : { whileHover: { y: -4 } };
  const widgetPublicKey = "demo-website-widget";
  const widgetOrigin = process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3001";
  const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api").replace(/\/api\/?$/, "");
  const widgetSnippet = `<script async src="${widgetOrigin}/widget/embed.js" data-leadvirt-key="${widgetPublicKey}"></script>`;
  const statusLabels: Record<string, string> = {
    ACTIVE: "Активен",
    CONNECTED: "Подключено",
    DISCONNECTED: "Доступно",
    ERROR: "Ошибка",
    FAILED: "Ошибка",
    PENDING: "В очереди",
    PROCESSED: "Обработано",
    SKIPPED: "Пропущено",
    SUCCESS: "Успешно"
  };
  const statusLabel = (status?: string | null) => statusLabels[status ?? ""] ?? status ?? "";

  async function toggle(integration: IntegrationAccount) {
    try {
      const updated = integration.status === "CONNECTED"
        ? await disconnectIntegration(integration.provider)
        : await connectIntegration(integration.provider);
      setData(integrations.map((item) => (item.id === updated.id ? updated : item)));
      setActionMessage(`${updated.name}: ${statusLabel(updated.status)}`);
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Не удалось обновить интеграцию.");
    }
  }

  async function testConnection(integration: IntegrationAccount) {
    setTestingProvider(integration.provider);
    try {
      const result = await testIntegrationConnection(integration.provider);
      setData(integrations.map((item) => (item.id === result.integration.id ? result.integration : item)));
      setTestResults((current) => ({ ...current, [integration.provider]: result }));
      setActionMessage(localizeLegacyText(result.message));
    } catch (caught) {
      setActionMessage(caught instanceof Error ? localizeLegacyText(caught.message) : "Не удалось проверить интеграцию.");
    } finally {
      setTestingProvider(null);
    }
  }

  async function sendSample(integration: IntegrationAccount) {
    setSampleProvider(integration.provider);
    try {
      const result = await sendSampleInbound(integration.provider);
      setData(integrations.map((item) => (item.id === result.integration.id ? result.integration : item)));
      setSampleResults((current) => ({ ...current, [integration.provider]: result }));
      setActionMessage(`${integration.name}: тестовое входящее событие обработано.`);
    } catch (caught) {
      setActionMessage(caught instanceof Error ? localizeLegacyText(caught.message) : "Не удалось отправить тестовое входящее событие.");
    } finally {
      setSampleProvider(null);
    }
  }

  async function copyText(text: string, label: string) {
    if (!navigator.clipboard) {
      setActionMessage("Clipboard API недоступен в этом браузере.");
      return;
    }
    await navigator.clipboard.writeText(text);
    setActionMessage(`${label} скопирован.`);
  }

  async function copyWidgetSnippet() {
    await copyText(widgetSnippet, "Код виджета сайта");
  }

  return (
    <>
      <PageHeader title="Интеграции" description="Каналы, CRM, календарь, e-commerce и Webhook/API в демо-режиме." />
      <Notice loading={loading} error={error} />
      <AnimatePresence>
        {actionMessage ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          >
            {actionMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.div {...cardMotion} {...hoverMotion}>
        <Card className="mb-4 overflow-hidden border-emerald-500/20 bg-emerald-500/10 p-5">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/20">
              <MessageCircle className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-lg font-semibold text-zinc-50">Виджет сайта</h3>
                <StatusBadge tone="success">{statusLabel("ACTIVE")}</StatusBadge>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/80">
                Публичный чат уже подключен к демо-каналу сайта, inbox, захвату лидов и AI-ответам.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copyWidgetSnippet()}>
              <Copy className="h-4 w-4" />
              Копировать код
            </Button>
            <Button asChild>
              <a href="/widget/demo" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Открыть
              </a>
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[220px_1fr]">
          <div className="rounded-lg border border-white/10 bg-zinc-950/55 p-4">
            <p className="text-xs text-zinc-500">Публичный ключ</p>
            <p className="mt-2 break-all font-mono text-sm text-emerald-200">{widgetPublicKey}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-zinc-950/55 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
              <Code2 className="h-3.5 w-3.5" />
              Код установки
            </div>
            <code className="block break-all font-mono text-xs leading-5 text-zinc-200">{widgetSnippet}</code>
          </div>
        </div>
        </Card>
      </motion.div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration, index) => (
          <motion.div
            key={integration.id}
            initial={cardMotion.initial}
            animate={cardMotion.animate}
            transition={{ ...cardMotion.transition, delay: reduceMotion ? 0 : Math.min(index * 0.045, 0.32) }}
            {...hoverMotion}
            className="h-full"
          >
          <Card className="flex h-full min-h-[250px] flex-col p-5" hover>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-zinc-50">{integration.name}</h3>
                <p className="text-sm text-zinc-500">{localizeLegacyText(integration.category) || "Интеграция"}</p>
              </div>
              <StatusBadge tone={integration.status === "CONNECTED" ? "success" : integration.status === "ERROR" ? "danger" : "neutral"}>{statusLabel(integration.status)}</StatusBadge>
            </div>
            <p className="text-sm leading-6 text-zinc-400">Настройка хранится в LeadVirt.ai как демо-коннектор. Реальный OAuth появится позже.</p>
            <div className="mt-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
              Последняя синхронизация: <span className="text-zinc-200">{integration.lastSyncAt ? formatDateTime(integration.lastSyncAt) : "Никогда"}</span>
            </div>
            <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <p className="text-xs font-semibold text-zinc-300">Последняя активность</p>
              <div className="mt-2 space-y-2">
                {integration.recentSyncLogs?.length ? (
                  integration.recentSyncLogs.slice(0, 2).map((log) => (
                    <div key={log.id} className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="truncate text-zinc-200">{localizeLegacyText(log.message ?? log.action)}</p>
                        <p className="mt-0.5 text-zinc-500">{localizeLegacyText(log.action)} · {formatDateTime(log.createdAt)}</p>
                      </div>
                      <StatusBadge tone={log.status === "SUCCESS" ? "success" : log.status === "FAILED" ? "danger" : "warning"}>
                        {statusLabel(log.status)}
                      </StatusBadge>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-zinc-500">Событий пока нет.</p>
                )}
              </div>
            </div>
            <div className="mt-3 min-h-[46px] rounded-lg border border-white/8 bg-zinc-950/35 px-3 py-2 text-xs text-zinc-400">
              {testResults[integration.provider] ? (
                <div className="flex items-start gap-2">
                  <StatusBadge
                    tone={
                      testResults[integration.provider]?.status === "SUCCESS"
                        ? "success"
                        : testResults[integration.provider]?.status === "SKIPPED"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {statusLabel(testResults[integration.provider]?.status)}
                  </StatusBadge>
                  <span className="leading-5">{localizeLegacyText(testResults[integration.provider]?.message)}</span>
                </div>
              ) : (
                <span>Запустите тест, чтобы записать синхронизацию и аудит.</span>
              )}
            </div>
            {integration.inboundEndpoint ? (
              <div className="mt-3 rounded-lg border border-sky-500/15 bg-sky-500/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Входящий endpoint</p>
                    <p className="mt-1 text-xs text-sky-100/80">Секретный заголовок: {integration.inboundEndpoint.secretHeader}</p>
                  </div>
                  <StatusBadge tone="info">{integration.inboundEndpoint.channelType}</StatusBadge>
                </div>
                <code className="mt-3 block break-all rounded-md border border-white/10 bg-zinc-950/45 px-3 py-2 font-mono text-xs leading-5 text-zinc-100">
                  {apiOrigin}
                  {integration.inboundEndpoint.endpointPath}
                </code>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText(`${apiOrigin}${integration.inboundEndpoint?.endpointPath ?? ""}`, "Входящий endpoint")}
                  >
                    <Copy className="h-4 w-4" />
                    URL
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText(JSON.stringify(integration.inboundEndpoint?.samplePayload ?? {}, null, 2), "Тестовый payload")}
                  >
                    <Code2 className="h-4 w-4" />
                    Payload
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void sendSample(integration)}
                    disabled={sampleProvider === integration.provider}
                  >
                    <SendHorizontal className="h-4 w-4" />
                    {sampleProvider === integration.provider ? "Отправляем" : "Тестовый лид"}
                  </Button>
                </div>
                {sampleResults[integration.provider] ? (
                  <div className="mt-3 rounded-md border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    Образец доставлен: диалог {sampleResults[integration.provider]?.conversationId.slice(0, 8)}
                    {sampleResults[integration.provider]?.outboundStatus ? `, ответ ${sampleResults[integration.provider]?.outboundStatus}` : ""}
                  </div>
                ) : null}
                <div className="mt-3 rounded-md border border-white/10 bg-zinc-950/35 p-3">
                  <p className="text-xs font-semibold text-sky-100">Последние доставки</p>
                  <div className="mt-2 space-y-2">
                    {integration.recentWebhookEvents?.length ? (
                      integration.recentWebhookEvents.slice(0, 2).map((event) => (
                        <div key={event.id} className="flex items-start justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-zinc-200">{event.externalEventId}</p>
                            <p className="mt-0.5 text-zinc-500">{formatDateTime(event.receivedAt)}</p>
                            {event.errorMessage ? <p className="mt-1 text-rose-300">{event.errorMessage}</p> : null}
                          </div>
                          <StatusBadge tone={event.status === "PROCESSED" ? "success" : event.status === "FAILED" ? "danger" : "warning"}>
                            {statusLabel(event.status)}
                          </StatusBadge>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-sky-100/60">Доставок пока нет.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            <Button className="mt-auto w-full" variant={integration.status === "CONNECTED" ? "outline" : "primary"} onClick={() => void toggle(integration)}>
              {integration.status === "CONNECTED" ? "Отключить" : "Подключить"}
            </Button>
            <Button className="mt-2 w-full" variant="outline" onClick={() => void testConnection(integration)} disabled={testingProvider === integration.provider}>
              <ShieldCheck className="h-4 w-4" />
              {testingProvider === integration.provider ? "Проверяем" : "Проверить"}
            </Button>
          </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}

export function SettingsView() {
  type SettingsBundle = {
    account: SettingsAccount | null;
    team: { id: string; role: string; user: { id: string; email: string; name?: string | null } }[];
    security: { authMode: string; tenantScoped: boolean; currentRole: string } | null;
    billing: { billingMode: string; apiKeys: { id: string; name: string; keyPrefix: string; createdAt: string }[] } | null;
  };
  const fallback: SettingsBundle = { account: null, team: [], security: null, billing: null };
  const { data, loading, error } = useApiData(
    async () => {
      const [account, team, security, billing] = await Promise.all([
        getAccountSettings(),
        getTeamSettings(),
        getSecuritySettings(),
        getBillingSettings()
      ]);
      return { account, team, security, billing };
    },
    fallback
  );

  return (
    <>
      <PageHeader title="Настройки" description="Профиль компании, команда, безопасность, API-ключи и биллинг." />
      <Notice loading={loading} error={error} />
      <div className="grid gap-5 xl:grid-cols-[240px_1fr]">
        <Card className="grid h-fit grid-cols-2 gap-2 p-2 sm:grid-cols-3 xl:block xl:p-3">
          {["Профиль компании", "Команда и роли", "Каналы", "Уведомления", "Биллинг", "Безопасность", "API ключи"].map((item, index) => (
            <button
              key={item}
              className={cn(
                "block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition xl:py-3",
                index === 0 ? "bg-emerald-500/12 text-emerald-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              )}
              type="button"
            >
              {item}
            </button>
          ))}
        </Card>
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-50">Профиль компании</h2>
            <p className="mt-1 text-sm text-zinc-500">Основная информация, которую LeadVirt.ai использует в ответах клиентам.</p>
          </div>
          <Card className="p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-violet-500 text-2xl font-bold text-zinc-950">
                {displayBusinessName(data.account?.businessName).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-zinc-50">Логотип компании</h3>
                <p className="mt-1 text-sm text-zinc-500">PNG, JPG до 5 МБ · рекомендуется 256×256</p>
                <Button className="mt-3" variant="outline" size="sm"><Plus className="h-4 w-4" /> Загрузить</Button>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Название компании
                <input readOnly value={displayBusinessName(data.account?.businessName)} className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Сфера деятельности
                <input readOnly value="Красота и здоровье" className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300 md:col-span-2">
                Описание
                <textarea readOnly value="Студия красоты и ухода в центре Москвы. Специализируемся на стрижках, окрашивании и уходовых процедурах." className="min-h-24 w-full resize-none rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Часовой пояс
                <input readOnly value={data.account?.timezone ?? "Europe/Moscow"} className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Телефон
                <input readOnly value="+7 (495) 123-45-67" className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Контактный email
                <input readOnly value={data.account?.owner.email ?? "admin@glow.ru"} className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
              <label className="space-y-2 text-sm font-semibold text-zinc-300">
                Сайт
                <input readOnly value="https://glow-studio.ru" className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-zinc-100 outline-none" />
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <Button>Сохранить изменения</Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function BillingView() {
  const { data, loading, error } = useApiData(
    async () => {
      const [plans, subscription, usage] = await Promise.all([listBillingPlans(), getCurrentSubscription(), getBillingUsage()]);
      return { plans, subscription, usage };
    },
    { plans: [] as PricingPlan[], subscription: null as Subscription | null, usage: null as UsageSummary | null }
  );
  const usage = data.usage;
  const planNameLabel: Record<string, string> = {
    START: "Старт",
    PROFESSIONAL: "Профессиональный",
    BUSINESS: "Бизнес",
    CORPORATE: "Корпоративный",
    Start: "Старт",
    Professional: "Профессиональный",
    Business: "Бизнес",
    Corporate: "Корпоративный"
  };
  const currentPlanName = planNameLabel[data.subscription?.plan.code ?? ""] ?? planNameLabel[data.subscription?.plan.name ?? ""] ?? "Профессиональный";
  const usageRows = [
    { label: "AI-диалоги", current: usage?.aiConversations ?? 0, limit: usage?.aiConversationsLimit ?? null },
    { label: "Каналы", current: usage?.channels ?? 0, limit: usage?.channelsLimit ?? null },
    { label: "Пользователи", current: usage?.users ?? 0, limit: usage?.usersLimit ?? null },
    { label: "Сценарии", current: usage?.scenarios ?? 0, limit: usage?.scenariosLimit ?? null }
  ].map((item) => ({
    ...item,
    value: `${item.current} / ${item.limit ?? "индивидуально"}`,
    percent: item.limit ? Math.min(100, Math.round((item.current / item.limit) * 100)) : 48
  }));

  return (
    <>
      <PageHeader title="Биллинг" description="План, счётчики использования, лимиты и точные тарифы LeadVirt.ai." />
      <Notice loading={loading} error={error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <Card className="p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <p className="text-sm text-emerald-300">Текущий план</p>
              <h2 className="mt-1 text-3xl font-bold text-zinc-50">{currentPlanName}</h2>
              <p className="mt-2 text-sm text-zinc-400">Период до {formatDateTime(data.subscription?.periodEnd)}. Оплата пока в демо-режиме.</p>
            </div>
            <Button>Обновить план</Button>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {usageRows.map(({ label, value, percent }) => (
              <div key={label} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <div className="mb-3 flex justify-between text-sm"><span className="text-zinc-400">{label}</span><span className="text-zinc-100">{value}</span></div>
                <div className="h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${percent}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-zinc-50">Тарифы</h2>
          <div className="space-y-3">
            {data.plans.map((plan) => (
              <div key={plan.code} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-zinc-100">{planNameLabel[plan.code] ?? planNameLabel[plan.name] ?? plan.name}</span>
                  {plan.popular ? <StatusBadge tone="success">Популярный</StatusBadge> : null}
                </div>
                <p className="mt-2 text-sm text-zinc-400">{plan.code === "CORPORATE" ? "от " : ""}{formatRub(plan.priceMonthlyRub)} / месяц</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

export function OnboardingView() {
  const { data: state, loading, error, setData } = useApiData<OnboardingState | null>(getOnboardingState, null);
  const steps = ["business", "channel", "scenario", "profile", "crm", "launch"];
  const labels = ["Бизнес", "Канал", "Сценарий", "Профиль", "CRM", "Запуск"];
  const completed = new Set(state?.completedSteps ?? []);

  async function continueFlow() {
    const next = steps.find((step) => !completed.has(step)) ?? "launch";
    const updated = await completeOnboardingStep(next);
    setData(updated);
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 text-zinc-50">
      <PageHeader title="Запуск LeadVirt.ai" description="Настройте бизнес, первый канал, сценарий AI, профиль компании, CRM и запуск." />
      <Notice loading={loading} error={error} />
      <Card className="p-4 sm:p-6">
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {labels.map((step, index) => (
            <div key={step} className={`rounded-2xl border p-3 text-center ${completed.has(steps[index] ?? "") ? "border-emerald-500/25 bg-emerald-500/15" : "border-white/10 bg-white/5"}`}>
              <div className="text-xs text-emerald-300">Шаг {index + 1}</div>
              <div className="text-sm font-semibold text-zinc-50">{step}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {["Студия красоты", "Сервисный бизнес", "E-commerce", "Клиника", "Образование", "Автосервис"].map((item) => (
            <button key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left text-zinc-100 transition hover:border-emerald-400/40">
              <ShieldCheck className="mb-3 h-5 w-5 text-emerald-300" />
              {item}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => void continueFlow()}>Продолжить <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>
    </div>
  );
}
