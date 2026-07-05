import React from "react";

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
  | "settings";

interface NavState {
  route: Route;
  go: (route: Route, params?: Record<string, unknown>) => void;
  params: Record<string, unknown>;
}

const NavContext = React.createContext<NavState | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = React.useState<Route>("landing");
  const [params, setParams] = React.useState<Record<string, unknown>>({});

  const go = React.useCallback((next: Route, p: Record<string, unknown> = {}) => {
    setParams(p);
    setRoute(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  return (
    <NavContext.Provider value={{ route, go, params }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = React.useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}
