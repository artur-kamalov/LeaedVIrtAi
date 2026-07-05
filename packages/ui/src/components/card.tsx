import type { HTMLAttributes } from "react";
import { cn } from "../tokens";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/8 bg-zinc-900/60 backdrop-blur-sm",
        hover && "transition-colors hover:border-white/15 hover:bg-zinc-900/80",
        className,
      )}
      {...props}
    />
  );
}
