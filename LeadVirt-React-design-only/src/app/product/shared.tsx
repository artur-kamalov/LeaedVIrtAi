import React from "react";
import { motion } from "motion/react";
import {
  Instagram,
  MessageCircle,
  Send,
  Globe,
  Mail,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";

/* ============================================================
   Channels
   ============================================================ */
export type ChannelId =
  | "instagram"
  | "whatsapp"
  | "telegram"
  | "website"
  | "vk"
  | "email"
  | "call";

export const channels: Record<
  ChannelId,
  { label: string; icon: LucideIcon; color: string; bg: string }
> = {
  instagram: { label: "Instagram", icon: Instagram, color: "text-pink-400", bg: "bg-pink-500/10" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  telegram: { label: "Telegram", icon: Send, color: "text-sky-400", bg: "bg-sky-500/10" },
  website: { label: "Сайт", icon: Globe, color: "text-indigo-400", bg: "bg-indigo-500/10" },
  vk: { label: "VK", icon: MessageCircle, color: "text-blue-400", bg: "bg-blue-500/10" },
  email: { label: "Email", icon: Mail, color: "text-amber-400", bg: "bg-amber-500/10" },
  call: { label: "Звонок", icon: Phone, color: "text-teal-400", bg: "bg-teal-500/10" },
};

export function ChannelBadge({ id, withLabel = false }: { id: ChannelId; withLabel?: boolean }) {
  const c = channels[id];
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1", c.bg)}>
      <Icon className={cn("w-3.5 h-3.5", c.color)} />
      {withLabel && <span className={cn("text-xs font-medium", c.color)}>{c.label}</span>}
    </span>
  );
}

/* ============================================================
   Lead statuses / pipeline stages
   ============================================================ */
export type StageId =
  | "new"
  | "progress"
  | "qualified"
  | "booked"
  | "crm"
  | "closed";

export const stages: Record<StageId, { label: string; color: string; dot: string; border: string }> = {
  new: { label: "Новый", color: "text-sky-300", dot: "bg-sky-400", border: "border-sky-500/30" },
  progress: { label: "В работе", color: "text-amber-300", dot: "bg-amber-400", border: "border-amber-500/30" },
  qualified: { label: "Квалифицирован", color: "text-violet-300", dot: "bg-violet-400", border: "border-violet-500/30" },
  booked: { label: "Записан / Заказ", color: "text-emerald-300", dot: "bg-emerald-400", border: "border-emerald-500/30" },
  crm: { label: "Отправлен в CRM", color: "text-teal-300", dot: "bg-teal-400", border: "border-teal-500/30" },
  closed: { label: "Закрыт", color: "text-zinc-400", dot: "bg-zinc-500", border: "border-zinc-600/30" },
};

export const stageOrder: StageId[] = ["new", "progress", "qualified", "booked", "crm", "closed"];

export function StatusPill({ stage }: { stage: StageId }) {
  const s = stages[stage];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium bg-white/[0.02]", s.border, s.color)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export type Temp = "hot" | "warm" | "cold";
export const temps: Record<Temp, { label: string; color: string; bg: string }> = {
  hot: { label: "Горячий", color: "text-rose-300", bg: "bg-rose-500/15" },
  warm: { label: "Тёплый", color: "text-amber-300", bg: "bg-amber-500/15" },
  cold: { label: "Холодный", color: "text-sky-300", bg: "bg-sky-500/15" },
};

export function TempPill({ t }: { t: Temp }) {
  const v = temps[t];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", v.bg, v.color)}>{v.label}</span>;
}

/* ============================================================
   Surfaces
   ============================================================ */
export function Card({
  className,
  children,
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm",
        hover && "transition-colors hover:border-white/10 hover:bg-zinc-900/80",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 tracking-tight">{title}</h2>
        {sub && <p className="text-sm text-zinc-500 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ============================================================
   Avatar (gradient + initials)
   ============================================================ */
const gradients = [
  "from-emerald-400 to-teal-600",
  "from-indigo-400 to-fuchsia-600",
  "from-amber-400 to-orange-600",
  "from-sky-400 to-blue-600",
  "from-rose-400 to-pink-600",
  "from-violet-400 to-purple-600",
];

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const g = gradients[name.charCodeAt(0) % gradients.length];
  return (
    <div
      className={cn("rounded-full bg-gradient-to-br flex items-center justify-center font-semibold text-zinc-950 shrink-0", g)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

/* ============================================================
   Stat card
   ============================================================ */
export function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  positive = true,
  accent = "text-emerald-400",
  index = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  accent?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: "easeOut" }}
    >
      <Card hover className="p-5 relative overflow-hidden group">
        <div className="absolute -right-8 -top-8 w-28 h-28 bg-current opacity-[0.04] blur-2xl rounded-full group-hover:opacity-[0.08] transition-opacity" />
        <div className="flex items-center justify-between mb-4">
          <div className={cn("w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center", accent)}>
            <Icon className="w-5 h-5" />
          </div>
          {delta && (
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", positive ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")}>
              {delta}
            </span>
          )}
        </div>
        <div className="text-3xl font-bold text-zinc-50 tracking-tight">{value}</div>
        <div className="text-sm text-zinc-500 mt-1">{label}</div>
      </Card>
    </motion.div>
  );
}

/* small inline pill */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", className)}>
      {children}
    </span>
  );
}
