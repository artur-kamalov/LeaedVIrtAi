"use client";

import { Bot, CalendarCheck, GitMerge, MessageSquare, Sparkles, TrendingUp, Users } from "lucide-react";
import { ProductLayout } from "@/design/product/ProductLayout";
import { Avatar, Card, ChannelBadge, SectionTitle, StatCard, StatusPill } from "@/design/product/shared";
import { Button } from "@/design/components/ui/Button";

const demoStats = [
  { icon: Users, label: "Новые лиды", value: "1 439", delta: "+18%", positive: true, accent: "text-sky-400" },
  { icon: MessageSquare, label: "Диалоги AI", value: "982", delta: "+24%", positive: true, accent: "text-violet-400" },
  { icon: CalendarCheck, label: "Записи / заказы", value: "386", delta: "+12%", positive: true, accent: "text-emerald-400" },
  { icon: GitMerge, label: "Лиды в CRM", value: "612", delta: "+16%", positive: true, accent: "text-indigo-400" },
  { icon: TrendingUp, label: "Конверсия", value: "31%", delta: "+4 п.п.", positive: true, accent: "text-rose-400" },
  { icon: Bot, label: "Автоответы", value: "94%", delta: "+7%", positive: true, accent: "text-amber-400" },
];

const demoLeads = [
  { name: "Анна Соколова", channel: "instagram" as const, service: "Окрашивание + стрижка", value: "6 500 ₽", status: "qualified" as const },
  { name: "Дмитрий Орлов", channel: "whatsapp" as const, service: "Детейлинг авто", value: "12 000 ₽", status: "new" as const },
  { name: "Елена Васнецова", channel: "telegram" as const, service: "Консультация врача", value: "4 200 ₽", status: "booked" as const },
  { name: "Игорь Лебедев", channel: "website" as const, service: "Курс английского", value: "28 000 ₽", status: "progress" as const },
];

const demoChannels = [
  { channel: "instagram" as const, leads: 412, conv: 31 },
  { channel: "whatsapp" as const, leads: 388, conv: 38 },
  { channel: "telegram" as const, leads: 256, conv: 34 },
  { channel: "website" as const, leads: 198, conv: 27 },
];

const demoActivity = [
  "AI квалифицировал 4 обращения за последний час",
  "Создана запись: Балаяж + стрижка, пт 16:00",
  "Лид Павел Громов отправлен в amoCRM",
  "Отправлено 8 напоминаний о записи на завтра",
];

export function DemoDashboardPage() {
  return (
    <ProductLayout title="Demo preview">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Read-only demo</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Пример рабочего пространства LeadVirt</h2>
            <p className="mt-1 text-sm text-zinc-400">Эти данные статичны и не относятся к вашему аккаунту или базе.</p>
          </div>
          <Button onClick={() => window.location.assign("/signup")}>
            <Sparkles className="mr-2 h-4 w-4" />
            Создать workspace
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {demoStats.map((stat, index) => (
            <StatCard key={stat.label} {...stat} index={index + 1} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <SectionTitle title="Последние лиды" sub="Демо-примеры обращений" />
            <div className="space-y-1">
              {demoLeads.map((lead) => (
                <div key={lead.name} className="flex items-center gap-3 rounded-2xl px-3 py-3">
                  <Avatar name={lead.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-100">{lead.name}</span>
                      <ChannelBadge id={lead.channel} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{lead.service}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill stage={lead.status} />
                    <span className="text-xs font-semibold text-emerald-400">{lead.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle title="Каналы" sub="Лиды и конверсия" />
            <div className="space-y-4">
              {demoChannels.map((item) => (
                <div key={item.channel}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <ChannelBadge id={item.channel} withLabel />
                    <span className="text-xs text-zinc-400">{item.leads} лидов · <span className="font-semibold text-emerald-400">{item.conv}%</span></span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${item.conv}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-6">
          <SectionTitle title="Активность" sub="Статичная demo-лента" />
          <div className="grid gap-3 sm:grid-cols-2">
            {demoActivity.map((item) => (
              <div key={item} className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </ProductLayout>
  );
}
