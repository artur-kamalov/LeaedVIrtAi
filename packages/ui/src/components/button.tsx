import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../tokens";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
}

const variants = {
  primary: "bg-emerald-400 text-zinc-950 hover:bg-emerald-300 shadow-lg shadow-emerald-500/15",
  secondary: "bg-white/10 text-zinc-100 hover:bg-white/15",
  outline: "border border-white/10 bg-white/[0.02] text-zinc-100 hover:bg-white/10",
  ghost: "text-zinc-300 hover:bg-white/8 hover:text-zinc-50",
  danger: "bg-rose-500 text-white hover:bg-rose-600"
} as const;

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
  icon: "h-10 w-10 p-0"
} as const;

export function Button({
  asChild = false,
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      type={asChild ? undefined : type}
      {...props}
    />
  );
}
