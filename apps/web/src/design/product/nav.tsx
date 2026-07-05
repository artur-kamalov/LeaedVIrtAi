"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

export type Route =
  | "landing"
  | "onboarding"
  | "dashboard"
  | "inbox"
  | "conversation"
  | "pipeline"
  | "automation"
  | "analytics"
  | "integrations"
  | "billing"
  | "settings";

interface NavState {
  route: Route;
  go: (route: Route, params?: Record<string, unknown>) => void;
  params: Record<string, unknown>;
}

const NavContext = React.createContext<NavState | null>(null);

const routePaths: Record<Route, string> = {
  landing: "/",
  onboarding: "/onboarding",
  dashboard: "/app",
  inbox: "/app/inbox",
  conversation: "/app/inbox",
  pipeline: "/app/leads",
  automation: "/app/automations",
  analytics: "/app/analytics",
  integrations: "/app/integrations",
  billing: "/app/billing",
  settings: "/app/settings"
};

function pathFor(route: Route, params: Record<string, unknown>) {
  if (route === "conversation") {
    const id = typeof params.id === "string" && params.id.length > 0 ? params.id : "";
    return id ? `/app/inbox/${encodeURIComponent(id)}` : "/app/inbox";
  }

  return routePaths[route];
}

export function hrefForRoute(route: Route, params: Record<string, unknown> = {}) {
  return pathFor(route, params);
}

function stateForPath(pathname: string): Pick<NavState, "route" | "params"> {
  if (pathname === "/onboarding" || pathname === "/app/onboarding") {
    return { route: "onboarding", params: {} };
  }

  if (pathname === "/demo") return { route: "dashboard", params: { mode: "demo" } };
  if (pathname === "/app") return { route: "dashboard", params: {} };
  if (pathname === "/app/inbox") return { route: "inbox", params: {} };

  if (pathname.startsWith("/app/inbox/")) {
    const id = decodeURIComponent(pathname.slice("/app/inbox/".length) || "");
    return { route: "conversation", params: { id } };
  }

  if (pathname === "/app/leads") return { route: "pipeline", params: {} };
  if (pathname === "/app/automations") return { route: "automation", params: {} };
  if (pathname === "/app/analytics") return { route: "analytics", params: {} };
  if (pathname === "/app/integrations") return { route: "integrations", params: {} };
  if (pathname === "/app/billing") return { route: "billing", params: {} };
  if (pathname === "/app/settings") return { route: "settings", params: {} };

  return { route: "landing", params: {} };
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const pathnameState = React.useMemo(() => stateForPath(pathname), [pathname]);
  const [params, setParams] = React.useState<Record<string, unknown>>({});

  React.useEffect(() => {
    setParams(pathnameState.params);
  }, [pathnameState.params]);

  const go = React.useCallback((next: Route, p: Record<string, unknown> = {}) => {
    setParams(p);
    router.push(pathFor(next, p));
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }, [router]);

  return (
    <NavContext.Provider value={{ route: pathnameState.route, go, params }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = React.useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}
