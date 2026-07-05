import { stageLabels, type LeadStage } from "@/features/mock/data";
import { cn } from "@/lib/cn";

const styles: Record<LeadStage, string> = {
  new: "border-sky-500/30 text-sky-300",
  progress: "border-amber-500/30 text-amber-300",
  qualified: "border-violet-500/30 text-violet-300",
  booked: "border-emerald-500/30 text-emerald-300",
  crm: "border-teal-500/30 text-teal-300",
  closed: "border-zinc-600/30 text-zinc-400",
  lost: "border-rose-500/30 text-rose-300"
};

export function StagePill({ stage }: { stage: LeadStage }) {
  return (
    <span className={cn("rounded-full border bg-white/[0.02] px-2.5 py-1 text-xs font-medium", styles[stage])}>
      {stageLabels[stage]}
    </span>
  );
}
