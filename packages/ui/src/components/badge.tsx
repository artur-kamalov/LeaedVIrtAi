import type { HTMLAttributes } from "react";
import { cn } from "../tokens";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300",
        className,
      )}
      {...props}
    />
  );
}
