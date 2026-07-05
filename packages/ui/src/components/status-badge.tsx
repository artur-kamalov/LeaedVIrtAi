import type { ReactNode } from "react";
import { cn } from "../tokens";

const styles = {
  success: "border-emerald-500/25 bg-emerald-500/15 text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/15 text-amber-300",
  danger: "border-rose-500/25 bg-rose-500/15 text-rose-300",
  info: "border-sky-500/25 bg-sky-500/15 text-sky-300",
  neutral: "border-white/10 bg-white/5 text-zinc-300"
} as const;

export function StatusBadge({
  tone = "neutral",
  children
}: {
  tone?: keyof typeof styles;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", styles[tone])}>
      {children}
    </span>
  );
}
