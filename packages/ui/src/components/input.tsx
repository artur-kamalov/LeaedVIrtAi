import type { InputHTMLAttributes } from "react";
import { cn } from "../tokens";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20",
        className,
      )}
      {...props}
    />
  );
}
