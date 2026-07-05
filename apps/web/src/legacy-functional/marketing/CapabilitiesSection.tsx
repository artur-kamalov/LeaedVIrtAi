"use client";

import { Bot, Database, LineChart, MessageCircle, Zap } from "lucide-react";
import { motion } from "motion/react";

const cards = [
  {
    icon: Zap,
    title: "Ответы 24/7",
    text: "Мгновенные ответы ночью, в выходные и праздники. Ни один клиент не уйдет из-за долгого ожидания.",
    className: "md:col-span-2",
    accent: "text-emerald-300"
  },
  {
    icon: MessageCircle,
    title: "Квалификация лидов",
    text: "AI сам задает нужные вопросы, уточняет потребность и отсеивает нецелевые обращения.",
    className: "",
    accent: "text-sky-300"
  },
  {
    icon: Bot,
    title: "Повторные касания",
    text: "Напомнит о записи, вернет теплый диалог или предложит повторить заказ в нужный момент.",
    className: "",
    accent: "text-violet-300"
  },
  {
    icon: LineChart,
    title: "Передача в CRM и аналитика",
    text: "История переписки, теги, контакты и записи автоматически попадают в вашу CRM-систему.",
    className: "md:col-span-2",
    accent: "text-indigo-300"
  }
];

export function CapabilitiesSection() {
  return (
    <section id="features" className="container-page py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="mx-auto mb-14 max-w-2xl text-center"
      >
        <h2 className="text-3xl font-bold tracking-tight text-zinc-50 md:text-5xl">
          Что умеет AI-администратор
        </h2>
        <p className="mt-4 text-lg leading-8 text-zinc-400">
          Заменяет целый слой обработки входящих обращений и держит команду в контексте.
        </p>
      </motion.div>

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.12 } }
        }}
        className="grid gap-6 md:grid-cols-3 md:auto-rows-[280px]"
      >
        {cards.map((card, index) => {
          const Icon = card.icon;

          return (
            <motion.div
              key={card.title}
              variants={{
                hidden: { opacity: 0, y: 28 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.58, ease: "easeOut" } }
              }}
              className={`group relative flex min-h-[260px] flex-col justify-between overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-7 transition-colors duration-300 hover:border-zinc-700 md:min-h-0 ${card.className}`}
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:28px_28px] opacity-30" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.05] via-transparent to-emerald-500/[0.04] opacity-70 transition-opacity duration-500 group-hover:opacity-100" />

              <div className="relative z-10 max-w-md">
                <Icon className={`mb-4 h-8 w-8 ${card.accent}`} />
                <h3 className="text-2xl font-bold tracking-tight text-zinc-50">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{card.text}</p>
              </div>

              {index === 0 ? (
                <div className="relative z-10 mt-6 max-w-sm rounded-2xl border border-white/8 bg-zinc-950/75 p-4 backdrop-blur">
                  <div className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                    <span>Среднее время ответа: 18 сек</span>
                  </div>
                </div>
              ) : null}

              {index === 3 ? (
                <div className="relative z-10 mt-6 grid max-w-xl gap-3 sm:grid-cols-3">
                  {[
                    ["CRM", "219 лидов"],
                    ["Записи", "342"],
                    ["Конверсия", "31,4%"]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                      <Database className="mb-2 h-4 w-4 text-emerald-300" />
                      <div className="text-lg font-bold text-zinc-50">{value}</div>
                      <div className="text-xs text-zinc-500">{label}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
