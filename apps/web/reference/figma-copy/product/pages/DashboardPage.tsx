import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Users,
  MessageSquare,
  CalendarCheck,
  GitMerge,
  Timer,
  TrendingUp,
  ChevronRight,
  UserPlus,
  Zap,
  Bot,
  CalendarDays,
  Building2,
  Sparkles,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ProductLayout } from "../ProductLayout";
import {
  Card,
  SectionTitle,
  StatCard,
  Avatar,
  ChannelBadge,
  StatusPill,
} from "../shared";
import { leads, activity, channelPerformance, leadsByDay } from "../data";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../ui";
import { cn } from "../../lib/utils";

/* ─── helpers ─── */
function formatRub(v: number) {
  return v.toLocaleString("ru-RU") + " ₽";
}

function todayLabel() {
  return new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ─── Custom tooltip for recharts ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-zinc-900 border border-white/10 px-4 py-3 shadow-xl text-sm">
      <p className="text-zinc-400 mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name}:</span>
          <span className="font-bold text-zinc-50">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Activity icon/color per type ─── */
const activityMeta = {
  lead: { icon: UserPlus, color: "text-sky-400", bg: "bg-sky-500/15", dot: "bg-sky-400" },
  booking: { icon: CalendarCheck, color: "text-emerald-400", bg: "bg-emerald-500/15", dot: "bg-emerald-400" },
  crm: { icon: Building2, color: "text-indigo-400", bg: "bg-indigo-500/15", dot: "bg-indigo-400" },
  ai: { icon: Bot, color: "text-violet-400", bg: "bg-violet-500/15", dot: "bg-violet-400" },
};

/* ══════════════════════════════════════════════════
   DashboardPage
══════════════════════════════════════════════════ */
export function DashboardPage() {
  const { go } = useNav();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 650);
    return () => clearTimeout(t);
  }, []);

  const stats = [
    {
      icon: Users,
      label: "Новые лиды",
      value: "1 248",
      delta: "+18%",
      positive: true,
      accent: "text-sky-400",
    },
    {
      icon: MessageSquare,
      label: "Диалоги AI",
      value: "964",
      delta: "+12%",
      positive: true,
      accent: "text-violet-400",
    },
    {
      icon: CalendarCheck,
      label: "Записи / заказы",
      value: "412",
      delta: "+9%",
      positive: true,
      accent: "text-emerald-400",
    },
    {
      icon: GitMerge,
      label: "Лиды в CRM",
      value: "388",
      delta: "+14%",
      positive: true,
      accent: "text-indigo-400",
    },
    {
      icon: Timer,
      label: "Среднее время ответа",
      value: "18 сек",
      delta: "-22%",
      positive: true,
      accent: "text-amber-400",
    },
    {
      icon: TrendingUp,
      label: "Конверсия",
      value: "31%",
      delta: "+6%",
      positive: true,
      accent: "text-rose-400",
    },
  ];

  const recentLeads = leads.slice(0, 5);

  if (loading) {
    return (
      <ProductLayout title="Обзор">
        <div className="space-y-8">
          {/* Stat cards skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-3xl" />
            ))}
          </div>
          {/* Chart + lists row skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="lg:col-span-2 h-72 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </div>
        </div>
      </ProductLayout>
    );
  }

  return (
    <ProductLayout title="Обзор">
      {/* ── Glow orbs (decorative) ── */}
      <div className="pointer-events-none fixed top-20 right-0 w-96 h-96 bg-emerald-500/5 blur-[130px] rounded-full" />
      <div className="pointer-events-none fixed bottom-32 left-1/4 w-72 h-72 bg-indigo-500/5 blur-[120px] rounded-full" />

      <div className="space-y-8">

        {/* ── 1. Greeting row ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
        >
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-50">
              Добро пожаловать, Студия Glow 👋
            </h2>
            <p className="text-sm text-zinc-500 mt-1 capitalize">{todayLabel()}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => go("inbox")}
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              Новый лид
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => go("automation")}
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Сценарии
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => go("analytics")}
            >
              <Zap className="w-4 h-4 mr-1.5" />
              Аналитика
            </Button>
          </div>
        </motion.div>

        {/* ── 2. Stat cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {stats.map((s, i) => (
            <StatCard
              key={s.label}
              icon={s.icon}
              label={s.label}
              value={s.value}
              delta={s.delta}
              positive={s.positive}
              accent={s.accent}
              index={i + 1}
            />
          ))}
        </div>

        {/* ── 3. Chart + Channels ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Chart */}
          <motion.div
            className="lg:col-span-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.3, ease: "easeOut" }}
          >
            <Card className="p-6">
              <SectionTitle
                title="Лиды за неделю"
                sub="Новые обращения и состоявшиеся записи по дням"
                action={
                  <button
                    onClick={() => go("analytics")}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                  >
                    Подробнее <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                }
              />
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={leadsByDay} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <defs key="defs-dashboard-leads">
                      <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradBooked" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid key="grid" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis
                      key="x"
                      dataKey="day"
                      tick={{ fill: "#71717a", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      key="y"
                      tick={{ fill: "#71717a", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
                    <Area
                      key="leads"
                      type="monotone"
                      dataKey="leads"
                      name="Лиды"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#gradLeads)"
                      dot={false}
                      activeDot={{ r: 4, fill: "#34d399", stroke: "#18181b", strokeWidth: 2 }}
                    />
                    <Area
                      key="booked"
                      type="monotone"
                      dataKey="booked"
                      name="Записи"
                      stroke="#818cf8"
                      strokeWidth={2}
                      fill="url(#gradBooked)"
                      dot={false}
                      activeDot={{ r: 4, fill: "#818cf8", stroke: "#18181b", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-5 mt-4">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-emerald-400 rounded-full" />
                  <span className="text-xs text-zinc-500">Лиды</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-indigo-400 rounded-full" />
                  <span className="text-xs text-zinc-500">Записи</span>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Channels */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.38, ease: "easeOut" }}
          >
            <Card className="p-6 h-full">
              <SectionTitle title="Каналы" sub="Лиды и конверсия" />
              <div className="space-y-4">
                {channelPerformance.map((cp, i) => (
                  <motion.div
                    key={cp.channel}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.42 + i * 0.06, duration: 0.4 }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <ChannelBadge id={cp.channel} withLabel />
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-zinc-400">{cp.leads} лидов</span>
                        <span className="text-emerald-400 font-semibold">{cp.conv}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${cp.conv}%` }}
                        transition={{ delay: 0.5 + i * 0.06, duration: 0.7, ease: "easeOut" }}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* ── 4. Recent leads + Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Recent Leads */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.46, ease: "easeOut" }}
          >
            <Card className="p-6">
              <SectionTitle
                title="Последние лиды"
                sub="Актуальные обращения"
                action={
                  <button
                    onClick={() => go("inbox")}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                  >
                    Все лиды <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                }
              />
              <div className="space-y-1">
                {recentLeads.map((lead, i) => (
                  <motion.button
                    key={lead.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.07, duration: 0.4 }}
                    onClick={() => go("conversation")}
                    className="w-full flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-white/5 transition-colors text-left group"
                  >
                    <Avatar name={lead.name} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-zinc-100 truncate">{lead.name}</span>
                        <ChannelBadge id={lead.channel} />
                      </div>
                      <span className="text-xs text-zinc-500 truncate block">{lead.service}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <StatusPill stage={lead.stage} />
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-emerald-400">{formatRub(lead.value)}</span>
                        <span className="text-[10px] text-zinc-600">{lead.time}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 ml-1" />
                  </motion.button>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Activity feed */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.52, ease: "easeOut" }}
          >
            <Card className="p-6">
              <SectionTitle
                title="Активность"
                sub="События в реальном времени"
                action={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-xs text-emerald-400 font-medium">Live</span>
                  </span>
                }
              />
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[18px] top-3 bottom-3 w-px bg-white/5" />
                <div className="space-y-1">
                  {activity.map((item, i) => {
                    const meta = activityMeta[item.type];
                    const Icon = meta.icon;
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.56 + i * 0.07, duration: 0.38 }}
                        className="flex items-start gap-3 py-2.5 px-1"
                      >
                        <div
                          className={cn(
                            "relative z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                            meta.bg
                          )}
                        >
                          <Icon className={cn("w-4 h-4", meta.color)} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <p className="text-sm text-zinc-300 leading-snug">{item.text}</p>
                          <p className="text-xs text-zinc-600 mt-0.5">{item.time}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </motion.div>
        </div>

      </div>
    </ProductLayout>
  );
}
