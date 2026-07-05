"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Briefcase,
  Car,
  CheckCircle2,
  Database,
  GraduationCap,
  HeartPulse,
  Scissors,
  ShoppingBag,
  User,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/cn";

type NicheId = "beauty" | "medicine" | "ecom" | "edu" | "auto" | "services";

interface Niche {
  id: NicheId;
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
  bgColor: string;
  gradient: string;
  userMsg: string;
  aiMsg: string;
  crmTask: string;
  crmBg: string;
  crmBorder: string;
}

const niches: Niche[] = [
  {
    id: "beauty",
    icon: Scissors,
    title: "Бьюти-сфера",
    desc: "Автоматическая запись, консультация по прайсу и напоминания о визитах.",
    color: "text-pink-400",
    bgColor: "bg-pink-400/10",
    gradient: "from-pink-500/20",
    userMsg: "Привет! Есть свободное окно на стрижку сегодня вечером?",
    aiMsg: "Здравствуйте! Да, к мастеру Алексею есть окна на 18:00 и 19:30. Записать вас?",
    crmTask: "Новая запись: Стрижка, 19:30",
    crmBg: "bg-pink-500/10",
    crmBorder: "border-pink-500/20"
  },
  {
    id: "medicine",
    icon: HeartPulse,
    title: "Медицина",
    desc: "Квалификация симптомов, запись к врачам, сбор первичного анамнеза.",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    gradient: "from-blue-500/20",
    userMsg: "Добрый день. Как записаться к кардиологу?",
    aiMsg: "Добрый день! Ближайшая запись к доктору Смирнову завтра в 14:00. Подсказать стоимость приема?",
    crmTask: "Лид в CRM: кардиолог",
    crmBg: "bg-blue-500/10",
    crmBorder: "border-blue-500/20"
  },
  {
    id: "ecom",
    icon: ShoppingBag,
    title: "E-commerce",
    desc: "Ответы по наличию, помощь с выбором размера, статусы заказов.",
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    gradient: "from-orange-500/20",
    userMsg: "А этот свитер есть в размере L в черном цвете?",
    aiMsg: "Да, размер L есть в наличии. Осталось 2 штуки. Оформить заказ с доставкой?",
    crmTask: "Новый заказ: свитер L",
    crmBg: "bg-orange-500/10",
    crmBorder: "border-orange-500/20"
  },
  {
    id: "edu",
    icon: GraduationCap,
    title: "Образование",
    desc: "Продажа курсов, отправка ссылок на вебинары, ответы на частые вопросы.",
    color: "text-violet-400",
    bgColor: "bg-violet-400/10",
    gradient: "from-violet-500/20",
    userMsg: "Сколько длится курс по дизайну?",
    aiMsg: "Курс длится 3 месяца онлайн, 2 раза в неделю. Отправить полную программу?",
    crmTask: "Запрос: программа курса",
    crmBg: "bg-violet-500/10",
    crmBorder: "border-violet-500/20"
  },
  {
    id: "auto",
    icon: Car,
    title: "Автосервисы",
    desc: "Запись на ТО, расчет примерной стоимости работ, статус ремонта.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/10",
    gradient: "from-yellow-500/20",
    userMsg: "Сколько стоит поменять масло на Toyota Camry?",
    aiMsg: "Замена с вашими расходниками 1 500 ₽, с нашим маслом от 6 500 ₽. Записать вас?",
    crmTask: "Лид: замена масла",
    crmBg: "bg-yellow-500/10",
    crmBorder: "border-yellow-500/20"
  },
  {
    id: "services",
    icon: Briefcase,
    title: "Услуги B2B/B2C",
    desc: "Клининг, юристы, ремонт. Оценка стоимости по фото и сбор деталей.",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    gradient: "from-emerald-500/20",
    userMsg: "Нужна генеральная уборка двухкомнатной квартиры. Сколько стоит?",
    aiMsg: "Генеральная уборка 2-комнатной квартиры стоит от 4 500 ₽. На какой день удобно?",
    crmTask: "Лид: ген. уборка",
    crmBg: "bg-emerald-500/10",
    crmBorder: "border-emerald-500/20"
  }
];

const initialNiche = niches[0]!;

export function NichesSection() {
  const [activeNicheId, setActiveNicheId] = useState<NicheId>(initialNiche.id);
  const active = niches.find((niche) => niche.id === activeNicheId) ?? initialNiche;

  return (
    <section id="niches" className="container-page py-24 md:py-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="mb-12 max-w-3xl"
      >
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">
          Подходит для любого бизнеса.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-400">
          AI адаптируется под сферу, услуги, прайс и тон общения, а команда получает уже структурированную заявку.
        </p>
      </motion.div>

      <div className="grid items-start gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-12">
        <div className="space-y-2">
          {niches.map((niche) => {
            const Icon = niche.icon;
            const isActive = niche.id === activeNicheId;

            return (
              <button
                key={niche.id}
                type="button"
                onClick={() => setActiveNicheId(niche.id)}
                className={cn(
                  "group flex w-full gap-4 rounded-2xl border p-4 text-left transition-all duration-300 sm:p-5",
                  isActive
                    ? "border-zinc-700 bg-zinc-900 shadow-lg"
                    : "border-transparent bg-transparent opacity-65 hover:border-zinc-800/80 hover:bg-zinc-900/50 hover:opacity-100"
                )}
              >
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 sm:h-12 sm:w-12",
                    isActive ? niche.bgColor : "bg-zinc-800",
                    isActive ? niche.color : "text-zinc-400 group-hover:text-zinc-300"
                  )}
                >
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="min-w-0">
                  <h3
                    className={cn(
                      "text-lg font-semibold transition-colors sm:text-xl",
                      isActive ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-200"
                    )}
                  >
                    {niche.title}
                  </h3>
                  <AnimatePresence initial={false}>
                    {isActive ? (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="overflow-hidden text-sm leading-6 text-zinc-400"
                      >
                        {niche.desc}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                </div>
              </button>
            );
          })}
        </div>

        <div className="relative flex min-h-[430px] items-center justify-center overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/25 md:min-h-[500px] md:p-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={`bg-${active.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className={cn(
                "pointer-events-none absolute -right-36 -top-36 h-96 w-96 rounded-full bg-gradient-to-br blur-[120px]",
                active.gradient,
                "to-transparent"
              )}
            />
          </AnimatePresence>

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:28px_28px] opacity-50" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-zinc-950/45 to-transparent" />

          <div className="relative z-10 w-full max-w-md space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={`chat-${active.id}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="relative space-y-6 pb-24 md:pb-16"
              >
                <motion.div
                  initial={{ opacity: 0, x: 20, y: 10 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="flex items-end justify-end gap-3"
                >
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-800 p-4 text-sm leading-relaxed text-zinc-200 shadow-md">
                    {active.userMsg}
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700">
                    <User className="h-4 w-4 text-zinc-400" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20, y: 10 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.5, ease: "easeOut" }}
                  className="flex items-end justify-start gap-3"
                >
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", active.bgColor)}>
                    <Bot className={cn("h-4 w-4", active.color)} />
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-300 shadow-md">
                    {active.aiMsg}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.6, delay: 1.05, ease: "backOut" }}
                  className="absolute bottom-0 right-0 z-20"
                >
                  <div
                    className={cn(
                      "flex max-w-[18rem] items-center gap-3 rounded-xl border bg-zinc-900/90 p-3 shadow-2xl backdrop-blur-xl sm:max-w-none sm:p-4",
                      active.crmBorder
                    )}
                  >
                    <div className={cn("rounded-lg p-2", active.crmBg)}>
                      <Database className={cn("h-5 w-5", active.color)} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-400">Добавлено в CRM</div>
                      <div className="truncate text-sm font-semibold text-zinc-100">{active.crmTask}</div>
                    </div>
                    <CheckCircle2 className={cn("ml-1 h-5 w-5 shrink-0", active.color)} />
                  </div>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
