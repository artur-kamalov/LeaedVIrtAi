import { cn } from "../lib/utils";

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap font-bold tracking-normal text-zinc-100", className)}>
      <span>Lead</span>
      <span className="text-emerald-400">Virt</span>
      <span>.ai</span>
    </span>
  );
}
