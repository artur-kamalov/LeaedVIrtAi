"use client";

import { motion } from "motion/react";

const workflow = [
  {
    step: "01",
    title: "Клиент пишет",
    desc: "В любой удобный канал: сайт, Telegram, email, webhook или новый источник продаж."
  },
  {
    step: "02",
    title: "AI уточняет",
    desc: "Задает нужные вопросы, квалифицирует лида и собирает структурированные поля."
  },
  {
    step: "03",
    title: "Создает действие",
    desc: "Готовит запись, заказ, задачу, CRM-синхронизацию или передачу менеджеру."
  },
  {
    step: "04",
    title: "Команда видит контекст",
    desc: "Менеджеры получают чистую карточку лида вместо длинной переписки."
  }
];

export function WorkflowSection() {
  return (
    <section id="workflow" className="relative overflow-hidden border-y border-white/5 bg-zinc-900/20 py-24">
      <div className="container-page relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="mx-auto mb-16 max-w-2xl text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 md:text-5xl">
            От сообщения до управляемой возможности.
          </h2>
          <p className="mt-4 text-lg leading-8 text-zinc-400">
            Полностью управляемый процесс от первого касания до записи в вашей системе.
          </p>
        </motion.div>

        <div className="relative">
          <div className="absolute left-[12.5%] right-[12.5%] top-10 z-0 hidden h-px overflow-hidden rounded-full bg-zinc-800/70 md:block">
            <motion.div
              animate={{ left: ["-40%", "100%"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
              className="absolute inset-y-0 w-[40%] bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
            />
          </div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.16 } }
            }}
            className="relative z-10 grid gap-6 md:grid-cols-4"
          >
            {workflow.map((item) => (
              <motion.div
                key={item.step}
                variants={{
                  hidden: { opacity: 0, y: 40 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.62, ease: "easeOut" } }
                }}
                className="group"
              >
                <div className="flex h-full flex-col items-center text-center">
                  <motion.div
                    whileHover={{ scale: 1.08, y: -5 }}
                    className="relative z-10 mb-7 flex h-20 w-20 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-xl font-bold text-zinc-500 transition-all duration-300 group-hover:border-emerald-500/50 group-hover:bg-emerald-500/10 group-hover:text-emerald-300 group-hover:shadow-[0_0_30px_rgba(52,211,153,0.16)]"
                  >
                    <span className="absolute inset-0 rounded-2xl border-2 border-emerald-500/0 transition-colors group-hover:border-emerald-500/20" />
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.22, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-400 opacity-0 shadow-[0_0_10px_rgba(52,211,153,0.8)] transition-opacity duration-300 group-hover:opacity-100"
                    />
                    {item.step}
                  </motion.div>

                  <div className="h-full w-full rounded-2xl border border-white/8 bg-zinc-900/45 p-5 transition-colors duration-300 group-hover:border-zinc-700/80 group-hover:bg-zinc-900/80">
                    <h3 className="text-lg font-semibold text-zinc-100">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
