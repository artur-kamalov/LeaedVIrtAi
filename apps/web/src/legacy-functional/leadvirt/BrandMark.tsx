import { Bot } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950 shadow-glow">
        <Bot className="h-5 w-5" />
      </div>
      {!compact ? <span className="text-xl font-bold tracking-tight text-zinc-50">LeadVirt.ai</span> : null}
    </div>
  );
}
