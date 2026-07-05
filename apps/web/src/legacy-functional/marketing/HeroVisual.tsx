"use client";

import { Calendar, CheckCircle2, Database, MessageSquare, Sparkles } from "lucide-react";
import { motion } from "motion/react";

export function HeroVisual() {
  const incomingMessages = [
    { text: "Хочу записаться на завтра", delay: 0 },
    { text: "Сколько стоит услуга?", delay: 1.5 },
    { text: "Где вы находитесь?", delay: 0.8 }
  ];

  const outgoingTasks = [
    {
      icon: Calendar,
      text: "Новая запись: 14:00",
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      border: "border-blue-400/20",
      delay: 0.5
    },
    {
      icon: Database,
      text: "Лид добавлен в CRM",
      color: "text-violet-400",
      bg: "bg-violet-400/10",
      border: "border-violet-400/20",
      delay: 2
    },
    {
      icon: CheckCircle2,
      text: "Вопрос решен",
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20",
      delay: 1.2
    }
  ];

  return (
    <div className="relative mx-auto mt-12 flex aspect-square w-full max-w-4xl items-center justify-center md:aspect-video lg:mt-0">
      <div className="absolute inset-0 overflow-hidden rounded-3xl border border-zinc-800/50 bg-gradient-to-b from-transparent via-zinc-900/20 to-transparent backdrop-blur-sm">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      <motion.div
        animate={{
          boxShadow: [
            "0 0 0px 0px rgba(52, 211, 153, 0)",
            "0 0 40px 10px rgba(52, 211, 153, 0.2)",
            "0 0 0px 0px rgba(52, 211, 153, 0)"
          ]
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="absolute z-20 flex h-24 w-24 rotate-45 items-center justify-center rounded-2xl border border-emerald-500/30 bg-zinc-900 backdrop-blur-xl"
      >
        <div className="relative -rotate-45">
          <Sparkles className="h-8 w-8 text-emerald-400" />
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute -inset-4 rounded-full border border-dashed border-emerald-500/20"
          />
        </div>
      </motion.div>

      <div className="absolute left-[6%] top-[18%] z-10 space-y-4 md:left-[10%] md:top-[20%]">
        {incomingMessages.map((message) => (
          <motion.div
            key={message.text}
            initial={{ opacity: 0, x: -20, y: 10 }}
            animate={{ opacity: [0, 1, 1, 0], x: [-20, 20, 40, 80], y: [10, 0, -10, -20] }}
            transition={{ duration: 4, delay: message.delay, repeat: Infinity, repeatDelay: 1 }}
            className="flex w-40 items-center gap-3 rounded-2xl rounded-tl-sm border border-zinc-700 bg-zinc-800/80 p-3 text-sm text-zinc-300 shadow-xl backdrop-blur md:w-48"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-zinc-400" />
            <span className="truncate">{message.text}</span>
          </motion.div>
        ))}
      </div>

      <div className="absolute bottom-[16%] right-[4%] z-10 space-y-4 md:bottom-[20%] md:right-[10%]">
        {outgoingTasks.map((task) => {
          const Icon = task.icon;

          return (
            <motion.div
              key={task.text}
              initial={{ opacity: 0, x: -20, y: 10 }}
              animate={{ opacity: [0, 1, 1, 0], x: [-20, 20, 40, 60], y: [-10, 0, 10, 20] }}
              transition={{ duration: 4, delay: task.delay, repeat: Infinity, repeatDelay: 1 }}
              className={`flex w-44 items-center gap-3 rounded-xl border p-3 text-sm text-zinc-200 shadow-xl backdrop-blur md:w-52 ${task.bg} ${task.border}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${task.color}`} />
              <span className="truncate">{task.text}</span>
            </motion.div>
          );
        })}
      </div>

      <svg
        viewBox="0 0 1000 500"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      >
        <path
          d="M 0 150 C 250 150 400 250 500 250 C 600 250 750 350 1000 350"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="6 6"
        />
        <motion.path
          d="M 0 150 C 250 150 400 250 500 250 C 600 250 750 350 1000 350"
          stroke="url(#leadvirt-flow-gradient)"
          strokeWidth="3"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <defs>
          <linearGradient id="leadvirt-flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
            <stop offset="50%" stopColor="#34d399" stopOpacity="1" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
