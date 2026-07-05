"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { getAuthMe } from "@/lib/api/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    void getAuthMe()
      .then(() => {
        if (active) setAuthorized(true);
      })
      .catch(() => {
        if (active) router.replace("/login");
      });

    return () => {
      active = false;
    };
  }, [router]);

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950">
            <Bot className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium text-zinc-300">Проверяем доступ...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
