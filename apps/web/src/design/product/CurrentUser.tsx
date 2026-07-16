"use client";

import React from "react";
import type { UserRole } from "@leadvirt/types";
import type { AuthMe } from "@/lib/api/auth";

export interface ProductPermissions {
  role: UserRole;
  canManageLeads: boolean;
  canManageConversations: boolean;
  canManageWorkflows: boolean;
  canManageIntegrations: boolean;
  canTestIntegrations: boolean;
  canManageAccount: boolean;
  canManageTeam: boolean;
  canManageChannels: boolean;
  canManageChannelSecrets: boolean;
  canManageBilling: boolean;
  canViewAiAudit: boolean;
  canViewKnowledgeWorkspace: boolean;
}

const CurrentUserContext = React.createContext<AuthMe | null>(null);
const CurrentUserLocaleUpdaterContext = React.createContext<
  ((locale: NonNullable<AuthMe["locale"]>) => void) | null
>(null);

export function permissionsForRole(role: UserRole): ProductPermissions {
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const isManager = isAdmin || role === "MANAGER";
  const isOperator = isManager || role === "AGENT";

  return {
    role,
    canManageLeads: isOperator,
    canManageConversations: isOperator,
    canManageWorkflows: isManager,
    canManageIntegrations: isAdmin,
    canTestIntegrations: isManager,
    canManageAccount: isManager,
    canManageTeam: isAdmin,
    canManageChannels: isManager,
    canManageChannelSecrets: isAdmin,
    canManageBilling: isAdmin,
    canViewAiAudit: isManager,
    canViewKnowledgeWorkspace: isManager,
  };
}

export function CurrentUserProvider({
  user,
  onLocaleChange,
  children,
}: {
  user: AuthMe;
  onLocaleChange: (locale: NonNullable<AuthMe["locale"]>) => void;
  children: React.ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={user}>
      <CurrentUserLocaleUpdaterContext.Provider value={onLocaleChange}>
        {children}
      </CurrentUserLocaleUpdaterContext.Provider>
    </CurrentUserContext.Provider>
  );
}

export function useOptionalCurrentUser() {
  return React.useContext(CurrentUserContext);
}

export function useCurrentUser() {
  const user = useOptionalCurrentUser();
  if (!user) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return user;
}

export function useOptionalCurrentUserLocaleUpdater() {
  return React.useContext(CurrentUserLocaleUpdaterContext);
}

export function useProductPermissions() {
  return permissionsForRole(useOptionalCurrentUser()?.role ?? "VIEWER");
}
