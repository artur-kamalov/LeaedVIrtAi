import type { LucideIcon } from "lucide-react";
import { Card } from "./card";
import { cn } from "../tokens";

export function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  accent = "text-emerald-400"
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: string;
  accent?: string;
}) {
  return (
    <Card hover className="relative overflow-hidden p-5">
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-current opacity-[0.04] blur-2xl" />
      <div className="mb-4 flex items-center justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-white/5", accent)}>
          <Icon className="h-5 w-5" />
        </div>
        {delta ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">{delta}</span> : null}
      </div>
      <div className="text-3xl font-bold tracking-tight text-zinc-50">{value}</div>
      <div className="mt-1 text-sm text-zinc-500">{label}</div>
    </Card>
  );
}
