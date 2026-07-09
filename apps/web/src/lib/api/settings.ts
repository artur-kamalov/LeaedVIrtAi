import type { SettingsAccount } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export type TeamRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";
export type TeamMember = { id: string; role: TeamRole; user: { id: string; email: string; name?: string | null } };
export type TeamPasswordReset = { membershipId: string; userId: string; temporaryPassword: string; revokedSessions: number };
export type NotificationsSettings = {
  new_lead: boolean;
  no_reply: boolean;
  booking: boolean;
  daily: boolean;
  tg_summary: boolean;
};
export type ApiKeySummary = { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt?: string | null };
export type ApiKeyCreated = ApiKeySummary & { secret: string };
export type SecuritySession = {
  id: string;
  current: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};
export type SecuritySettings = {
  authMode: string;
  tenantScoped: boolean;
  currentRole: string;
  passwordChangeRequired?: boolean;
  twoFactor: {
    enabled: boolean;
    setupPending: boolean;
    confirmedAt: string | null;
    recoveryCodesRemaining: number;
  };
  sessions: SecuritySession[];
};
export type TwoFactorSetup = { secret: string; otpauthUri: string };
export type TwoFactorEnableResult = { twoFactor: SecuritySettings["twoFactor"]; recoveryCodes: string[] };

export function getAccountSettings() {
  return apiData<SettingsAccount>("/settings/account");
}

export function updateAccountSettings(body: { businessName?: string; timezone?: string; businessType?: string; logoDataUrl?: string | null }) {
  return apiData<SettingsAccount>("/settings/account", { method: "PATCH", ...jsonBody(body) });
}

export function getTeamSettings() {
  return apiData<TeamMember[]>("/settings/team");
}

export function inviteTeamMember(body: { email: string; name?: string; role: TeamRole }) {
  return apiData<TeamMember>("/settings/team", { method: "POST", ...jsonBody(body) });
}

export function updateTeamMemberRole(membershipId: string, role: TeamRole) {
  return apiData<TeamMember>(`/settings/team/${membershipId}`, { method: "PATCH", ...jsonBody({ role }) });
}

export function removeTeamMember(membershipId: string) {
  return apiData<{ id: string; removed: boolean }>(`/settings/team/${membershipId}`, { method: "DELETE" });
}

export function resetTeamMemberPassword(membershipId: string) {
  return apiData<TeamPasswordReset>(`/settings/team/${membershipId}/reset-password`, { method: "POST" });
}

export function getSecuritySettings() {
  return apiData<SecuritySettings>("/settings/security");
}

export function changePassword(body: { currentPassword: string; newPassword: string }) {
  return apiData<{ updated: boolean; revokedSessions: number }>("/settings/security/password", { method: "PATCH", ...jsonBody(body) });
}

export function startTwoFactorSetup() {
  return apiData<TwoFactorSetup>("/settings/security/2fa/setup", { method: "POST" });
}

export function enableTwoFactor(body: { code: string }) {
  return apiData<TwoFactorEnableResult>("/settings/security/2fa/enable", { method: "POST", ...jsonBody(body) });
}

export function disableTwoFactor(body: { currentPassword: string }) {
  return apiData<{ twoFactor: SecuritySettings["twoFactor"] }>("/settings/security/2fa/disable", { method: "POST", ...jsonBody(body) });
}

export function regenerateTwoFactorRecoveryCodes(body: { currentPassword: string }) {
  return apiData<TwoFactorEnableResult>("/settings/security/2fa/recovery-codes", { method: "POST", ...jsonBody(body) });
}

export function revokeSecuritySession(sessionId: string) {
  return apiData<{ id: string; revoked: boolean; current: boolean }>(`/settings/security/sessions/${sessionId}`, { method: "DELETE" });
}

export function revokeOtherSecuritySessions() {
  return apiData<{ revoked: number }>("/settings/security/sessions/revoke-others", { method: "POST" });
}

export function getNotificationsSettings() {
  return apiData<NotificationsSettings>("/settings/notifications");
}

export function updateNotificationsSettings(body: Partial<NotificationsSettings>) {
  return apiData<NotificationsSettings>("/settings/notifications", { method: "PATCH", ...jsonBody(body) });
}

export function getBillingSettings() {
  return apiData<{
    billingMode: string;
    apiKeys: ApiKeySummary[];
  }>("/settings/billing");
}

export function createApiKey(body: { name: string; scopes?: string }) {
  return apiData<ApiKeyCreated>("/settings/api-keys", { method: "POST", ...jsonBody(body) });
}

export function revokeApiKey(id: string) {
  return apiData<{ id: string; revoked: boolean }>(`/settings/api-keys/${id}`, { method: "DELETE" });
}
