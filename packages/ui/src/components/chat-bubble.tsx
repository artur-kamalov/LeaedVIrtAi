import type { ReactNode } from "react";
import { cn } from "../tokens";

export function ChatBubble({
  sender,
  children,
  time
}: {
  sender: "customer" | "ai" | "user" | "system";
  children: ReactNode;
  time?: string;
}) {
  const isOutbound = sender === "ai" || sender === "user";
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          sender === "ai" && "bg-emerald-400 text-zinc-950",
          sender === "user" && "bg-sky-500 text-white",
          sender === "customer" && "border border-white/8 bg-white/5 text-zinc-100",
          sender === "system" && "border border-amber-500/20 bg-amber-500/10 text-amber-200",
        )}
      >
        {children}
        {time ? <div className="mt-1 text-[11px] opacity-60">{time}</div> : null}
      </div>
    </div>
  );
}
