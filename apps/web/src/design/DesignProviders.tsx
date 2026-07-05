"use client";

import type { ReactNode } from "react";
import { NavProvider } from "./product/nav";
import { ThemeProvider } from "./product/theme";

export function DesignProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <NavProvider>{children}</NavProvider>
    </ThemeProvider>
  );
}
