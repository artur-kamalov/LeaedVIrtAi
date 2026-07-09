"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Channel, ChannelStatus, ChannelType, SettingsAccount } from "@leadvirt/types";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "qrcode";
import {
  Building2,
  Users,
  Radio,
  Bell,
  CreditCard,
  Shield,
  Key,
  ChevronRight,
  MoreHorizontal,
  Copy,
  Trash2,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  LogOut,
  Plus,
  Upload,
  Monitor,
  Smartphone,
  Globe,
  Download,
  UserCog,
  KeyRound,
  UserX,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { Card, Avatar, Pill, channels } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  Modal,
  ConfirmDialog,
  Tip,
  Select as BrandSelect,
} from "../ui";
import { toast } from "sonner";
import { plans } from "../plans";
import {
  changePassword,
  createApiKey,
  disableTwoFactor,
  enableTwoFactor,
  getAccountSettings,
  getBillingSettings,
  getNotificationsSettings,
  getSecuritySettings,
  getTeamSettings,
  inviteTeamMember,
  removeTeamMember,
  resetTeamMemberPassword,
  revokeApiKey,
  revokeOtherSecuritySessions,
  revokeSecuritySession,
  regenerateTwoFactorRecoveryCodes,
  startTwoFactorSetup,
  type ApiKeyCreated,
  type NotificationsSettings,
  type SecuritySession,
  type TeamPasswordReset,
  type TeamRole,
  updateAccountSettings,
  updateNotificationsSettings,
  updateTeamMemberRole,
} from "@/lib/api/settings";
import {
  cancelCurrentSubscription,
  changeSubscriptionPlan,
  getBillingPaymentMethod,
  getBillingUsage,
  getCurrentSubscription,
  listBillingInvoices,
  listBillingPlans,
  requestBillingPaymentMethodChange,
} from "@/lib/api/billing";
import { createChannel, listChannels, updateChannel } from "@/lib/api/channels";

/* ============================================================
   Reusable primitives
   ============================================================ */

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none",
        checked ? "bg-emerald-500" : "bg-white/10"
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 h-11 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all",
        className
      )}
      {...props}
    />
  );
}

function Select({
  className,
  children,
  defaultValue,
  value,
  onChange,
}: {
  className?: string;
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  // Convert <option> children into brand Select options.
  const options = React.Children.toArray(children)
    .filter((c): c is React.ReactElement<{ value: string; children: React.ReactNode }> =>
      React.isValidElement(c)
    )
    .map((c) => ({ value: String(c.props.value), label: c.props.children }));

  return (
    <BrandSelect
      className={className}
      options={options}
      defaultValue={defaultValue ?? (typeof value === "string" ? undefined : options[0]?.value)}
      value={value}
      onValueChange={onChange}
    />
  );
}

function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none",
        className
      )}
      {...props}
    />
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold tracking-tight text-zinc-50">{title}</h2>
      {description && (
        <p className="text-sm text-zinc-400 mt-1">{description}</p>
      )}
    </div>
  );
}

/* ============================================================
   Tab definitions
   ============================================================ */

type TabId =
  | "profile"
  | "team"
  | "channels"
  | "notifications"
  | "billing"
  | "security"
  | "api";

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Профиль компании", icon: Building2 },
  { id: "team", label: "Команда и роли", icon: Users },
  { id: "channels", label: "Каналы", icon: Radio },
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "billing", label: "Биллинг", icon: CreditCard },
  { id: "security", label: "Безопасность", icon: Shield },
  { id: "api", label: "API ключи", icon: Key },
];

type TeamSettings = Awaited<ReturnType<typeof getTeamSettings>>;
type SecuritySettings = Awaited<ReturnType<typeof getSecuritySettings>>;
type BillingSettings = Awaited<ReturnType<typeof getBillingSettings>>;
type BillingPlan = Awaited<ReturnType<typeof listBillingPlans>>[number];
type BillingSubscription = Awaited<ReturnType<typeof getCurrentSubscription>>;
type BillingUsage = Awaited<ReturnType<typeof getBillingUsage>>;
type BillingPaymentMethod = Awaited<ReturnType<typeof getBillingPaymentMethod>>;
type BillingInvoice = Awaited<ReturnType<typeof listBillingInvoices>>[number];

interface SettingsApiState {
  account: SettingsAccount | null;
  setAccount: (account: SettingsAccount) => void;
  team: TeamSettings | null;
  setTeam: (team: TeamSettings) => void;
  security: SecuritySettings | null;
  setSecurity: (security: SecuritySettings) => void;
  billing: BillingSettings | null;
  setBilling: (billing: BillingSettings) => void;
  notifications: NotificationsSettings | null;
  setNotifications: (notifications: NotificationsSettings) => void;
}

const SettingsApiContext = React.createContext<SettingsApiState>({
  account: null,
  setAccount: () => {},
  team: null,
  setTeam: () => {},
  security: null,
  setSecurity: () => {},
  billing: null,
  setBilling: () => {},
  notifications: null,
  setNotifications: () => {},
});

function useSettingsApi() {
  return React.useContext(SettingsApiContext);
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    OWNER: "Администратор",
    ADMIN: "Администратор",
    MANAGER: "Менеджер",
    AGENT: "Оператор",
    VIEWER: "Оператор",
  };
  return labels[role] ?? role;
}

function roleColor(role: string) {
  if (role === "OWNER" || role === "ADMIN") return "bg-emerald-500/15 text-emerald-300";
  if (role === "MANAGER") return "bg-indigo-500/15 text-indigo-300";
  return "bg-amber-500/15 text-amber-300";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatRub(value: number | null | undefined) {
  if (typeof value !== "number") return "Индивидуально";
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

function formatLimit(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat("ru-RU").format(value) : "без лимита";
}

function planName(plan?: Pick<BillingPlan, "code" | "name"> | null) {
  const labels: Record<string, string> = {
    START: "Старт",
    PROFESSIONAL: "Профессиональный",
    BUSINESS: "Бизнес",
    CORPORATE: "Корпоративный",
    Start: "Старт",
    Professional: "Профессиональный",
    Business: "Бизнес",
    Corporate: "Корпоративный",
  };

  return labels[plan?.code ?? ""] ?? labels[plan?.name ?? ""] ?? plan?.name ?? "Бизнес";
}

function apiPlanToDesignPlan(plan: BillingPlan) {
  return {
    id: plan.code.toLowerCase(),
    code: plan.code,
    name: planName(plan),
    tagline: plan.bestFor ?? "Для растущей команды LeadVirt.ai",
    price: plan.code === "CORPORATE" ? `от ${formatRub(plan.priceMonthlyRub)}` : formatRub(plan.priceMonthlyRub),
    priceNote: typeof plan.priceMonthlyRub === "number" ? "/ месяц" : "по договору",
    features: plan.features.length
      ? plan.features
      : [
          `${formatLimit(plan.aiConversations)} AI-диалогов`,
          `${formatLimit(plan.channelsLimit)} каналов`,
          `${formatLimit(plan.usersLimit)} участников`,
          `${formatLimit(plan.scenariosLimit)} сценариев`,
        ],
    popular: Boolean(plan.popular),
  };
}

function billingInvoiceStatusLabel(status: BillingInvoice["status"]) {
  const labels: Record<BillingInvoice["status"], string> = {
    PAID: "Оплачен",
    DUE: "К оплате",
    CANCELED: "Отменён",
  };
  return labels[status];
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildInvoiceText(invoice: BillingInvoice, businessName?: string) {
  const amount = invoice.amountRub === null ? "Индивидуально" : `${new Intl.NumberFormat("ru-RU").format(invoice.amountRub)} ₽`;
  return [
    "LeadVirt.ai",
    `Счёт: ${invoice.id}`,
    `Клиент: ${businessName ?? "Клиент LeadVirt.ai"}`,
    `Тариф: ${planName(invoice.plan)}`,
    `Период: ${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}`,
    `Дата выставления: ${formatDate(invoice.issuedAt)}`,
    `Сумма: ${amount}`,
    `Статус: ${billingInvoiceStatusLabel(invoice.status)}`,
    "",
    "Режим оплаты: manual invoice.",
    "Этот файл сформирован из данных LeadVirt.ai для MVP-биллинга."
  ].join("\n");
}

/* ============================================================
   Tab contents
   ============================================================ */

const LOGO_MAX_BYTES = 60 * 1024;

function ProfileTab() {
  const { account, setAccount } = useSettingsApi();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("other");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!account) return;
    setBusinessName(account.businessName);
    setBusinessType(account.tenant.businessType ?? "other");
    setTimezone(account.timezone);
    setLogoDataUrl(account.logoDataUrl ?? null);
  }, [account]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateAccountSettings({ businessName, businessType, timezone });
      setAccount(updated);
      setSaved(true);
      toast.success("Изменения сохранены");
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const saveLogo = async (nextLogoDataUrl: string | null) => {
    setLogoUploading(true);
    try {
      const updated = await updateAccountSettings({ businessName, businessType, timezone, logoDataUrl: nextLogoDataUrl });
      setAccount(updated);
      setLogoDataUrl(updated.logoDataUrl ?? null);
      toast.success(nextLogoDataUrl ? "Логотип обновлён" : "Логотип удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить логотип");
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Загрузите PNG или JPG");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Логотип должен быть до 60 КБ");
      return;
    }

    try {
      const nextLogoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("empty")));
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      await saveLogo(nextLogoDataUrl);
    } catch {
      toast.error("Не удалось прочитать файл");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Профиль компании"
        description="Основная информация о вашей организации"
      />

      {/* Logo row */}
      <Card className="p-6">
        <div className="flex items-center gap-5">
          {logoDataUrl ? (
            <img
              src={logoDataUrl}
              alt=""
              data-testid="settings-logo-preview"
              className="h-16 w-16 rounded-full border border-white/10 object-cover"
            />
          ) : (
            <Avatar name={businessName} size={64} />
          )}
          <div>
            <p className="text-sm font-semibold text-zinc-200 mb-1">
              Логотип компании
            </p>
            <p className="text-xs text-zinc-500 mb-3">
              PNG, JPG до 60 КБ · рекомендуется 256×256
            </p>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              data-testid="settings-logo-input"
              onChange={(event) => void handleLogoSelected(event)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid="settings-logo-upload"
                disabled={logoUploading || !account}
                onClick={() => logoInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                {logoUploading ? "Загружаем..." : "Загрузить"}
              </Button>
              {logoDataUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="settings-logo-remove"
                  disabled={logoUploading}
                  onClick={() => void saveLogo(null)}
                >
                  Удалить
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Название компании">
            <Input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Введите название" />
          </Field>

          <Field label="Сфера деятельности">
            <Select value={businessType} onChange={setBusinessType}>
              <option value="beauty">Красота и здоровье</option>
              <option value="fitness">Фитнес и спорт</option>
              <option value="education">Образование</option>
              <option value="retail">Розничная торговля</option>
              <option value="services">Услуги для бизнеса</option>
              <option value="other">Другое</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Описание"
          hint="Краткое описание вашей компании — помогает AI лучше отвечать клиентам"
        >
          <Textarea
            defaultValue="Студия красоты и ухода в центре Москвы. Специализируемся на стрижках, окрашивании и уходовых процедурах."
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Часовой пояс">
            <Select value={timezone} onChange={setTimezone}>
              <option value="Europe/Moscow">Москва (UTC+3)</option>
              <option value="Europe/Samara">Самара (UTC+4)</option>
              <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
              <option value="Asia/Novosibirsk">Новосибирск (UTC+7)</option>
              <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
            </Select>
          </Field>

          <Field label="Телефон">
            <Input
              placeholder="+7 (___) ___-__-__"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Контактный email">
            <Input
              type="email"
              value={account?.owner.email ?? ""}
              readOnly
              placeholder="email@компания.ru"
            />
          </Field>

          <Field label="Сайт">
            <Input
              placeholder="https://"
            />
          </Field>
        </div>

        <div className="pt-2 flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving} className="gap-2">
            <AnimatePresence mode="wait" initial={false}>
              {saved ? (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-2"
                >
                  <Check className="w-4 h-4" /> Сохранено
                </motion.span>
              ) : (
                <motion.span
                  key="save"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  {saving ? "Сохраняем..." : "Сохранить изменения"}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TeamTab() {
  const { team, setTeam } = useSettingsApi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [resetResult, setResetResult] = useState<(TeamPasswordReset & { name: string; email: string }) | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("AGENT");
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savingInvite, setSavingInvite] = useState(false);
  const members = (team ?? []).map((membership, index) => ({
        id: membership.id,
        name: membership.user.name ?? membership.user.email,
        email: membership.user.email,
        role: roleLabel(membership.role),
        roleCode: membership.role,
        roleColor: roleColor(membership.role),
        online: index === 0,
      }));

  const openDeleteConfirm = (member: { id: string; name: string }) => {
    setDeleteTarget({ id: member.id, name: member.name });
    setConfirmDelete(true);
  };

  const openPasswordReset = (member: { id: string; name: string; email: string }) => {
    setResetTarget({ id: member.id, name: member.name, email: member.email });
  };

  const handleRoleChange = async (memberId: string, role: TeamRole) => {
    if (!team) {
      toast.error("Командный API недоступен");
      return;
    }
    setSavingMemberId(memberId);
    try {
      const updated = await updateTeamMemberRole(memberId, role);
      setTeam(team.map((membership) => (membership.id === updated.id ? updated : membership)));
      toast.success("Роль обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить роль");
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Укажите email участника");
      return;
    }
    setSavingInvite(true);
    try {
      const created = await inviteTeamMember({
        email: inviteEmail,
        ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
        role: inviteRole,
      });
      setTeam(team ? [...team.filter((membership) => membership.id !== created.id), created] : [created]);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("AGENT");
      toast.success("Участник добавлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить участника");
    } finally {
      setSavingInvite(false);
    }
  };

  const handleRemove = async () => {
    if (!deleteTarget || !team) return;
    setSavingMemberId(deleteTarget.id);
    try {
      await removeTeamMember(deleteTarget.id);
      setTeam(team.filter((membership) => membership.id !== deleteTarget.id));
      toast.success("Участник удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить участника");
    } finally {
      setSavingMemberId(null);
      setDeleteTarget(null);
    }
  };

  const handlePasswordReset = async () => {
    if (!resetTarget) return;
    const target = resetTarget;
    setSavingMemberId(target.id);
    try {
      const result = await resetTeamMemberPassword(target.id);
      setResetResult({ ...result, name: target.name, email: target.email });
      toast.success("Временный пароль создан", {
        description: result.revokedSessions > 0 ? `Завершено сессий: ${result.revokedSessions}` : "Активных сессий не было",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сбросить пароль");
    } finally {
      setSavingMemberId(null);
      setResetTarget(null);
    }
  };

  const copyTemporaryPassword = () => {
    if (!resetResult) return;
    void navigator.clipboard?.writeText(resetResult.temporaryPassword);
    toast.success("Временный пароль скопирован");
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Команда и роли"
        description="Управляйте доступом сотрудников к платформе"
      />

      {/* Roles legend */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          Уровни доступа
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            {
              role: "Администратор",
              desc: "Полный доступ, настройки, биллинг",
              color: "text-emerald-300 bg-emerald-500/15",
            },
            {
              role: "Менеджер",
              desc: "Лиды, воронка, аналитика",
              color: "text-indigo-300 bg-indigo-500/15",
            },
            {
              role: "Оператор",
              desc: "Входящие чаты, ответы клиентам",
              color: "text-amber-300 bg-amber-500/15",
            },
          ].map((r) => (
            <div
              key={r.role}
              className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2"
            >
              <Pill className={r.color}>{r.role}</Pill>
              <span className="text-xs text-zinc-500">{r.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-white/5">
        {members.length === 0 && (
          <div className="px-5 py-6">
            <p className="text-sm font-semibold text-zinc-100">Участники команды пока не загружены</p>
            <p className="mt-1 text-xs text-zinc-500">
              После ответа API здесь будут показаны только реальные участники этого workspace.
            </p>
          </div>
        )}
        {members.map((member) => (
          <div
            key={member.email}
            className="flex items-center gap-4 px-5 py-4 relative"
          >
            <div className="relative shrink-0">
              <Avatar name={member.name} size={40} />
              {member.online && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-zinc-900" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">
                {member.name}
              </p>
              <p className="text-xs text-zinc-500 truncate">{member.email}</p>
            </div>

            <Pill className={cn("hidden sm:inline-flex", member.roleColor)}>
              {member.role}
            </Pill>

            <Dropdown
              trigger={
                <button
                  aria-label={`Управление ${member.name}`}
                  disabled={savingMemberId === member.id}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              {(["ADMIN", "MANAGER", "AGENT", "VIEWER"] as TeamRole[]).map((role) => (
                <DropdownItem
                  key={role}
                  icon={UserCog}
                  onClick={() => void handleRoleChange(member.id, role)}
                >
                  {roleLabel(role)}
                </DropdownItem>
              ))}
              <DropdownItem
                icon={KeyRound}
                onClick={() => openPasswordReset(member)}
              >
                Сбросить пароль
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                danger
                icon={UserX}
                onClick={() => openDeleteConfirm(member)}
              >
                Удалить участника
              </DropdownItem>
            </Dropdown>
          </div>
        ))}
      </Card>

      <div className="flex justify-end">
        <Button
          aria-label="Пригласить участника"
          onClick={() => setInviteOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Пригласить участника
        </Button>
      </div>

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Пригласить участника"
        description="Добавьте участника в текущий workspace. Реальная отправка письма будет подключена вместе с Auth."
        className="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={savingInvite}>
              Отмена
            </Button>
            <Button onClick={() => void handleInvite()} disabled={savingInvite}>
              {savingInvite ? "Добавляем..." : "Добавить"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Имя">
            <Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Имя участника" />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="name@company.ru"
            />
          </Field>
          <Field label="Роль">
            <Select value={inviteRole} onChange={(value) => setInviteRole(value as TeamRole)}>
              <option value="ADMIN">Администратор</option>
              <option value="MANAGER">Менеджер</option>
              <option value="AGENT">Оператор</option>
              <option value="VIEWER">Наблюдатель</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить участника?"
        description={`${deleteTarget?.name ?? "Участник"} потеряет доступ к платформе. Это действие нельзя отменить.`}
        danger
        confirmLabel="Удалить"
        onConfirm={() => void handleRemove()}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        title="Сбросить пароль?"
        description={`Для ${resetTarget?.name ?? "участника"} будет создан временный пароль. Все активные сессии участника будут завершены.`}
        confirmLabel={savingMemberId === resetTarget?.id ? "Сбрасываем..." : "Сбросить"}
        onConfirm={() => void handlePasswordReset()}
      />

      <Modal
        open={resetResult !== null}
        onOpenChange={(open) => {
          if (!open) setResetResult(null);
        }}
        title="Временный пароль"
        description={`Передайте пароль участнику ${resetResult?.email ?? ""}. После закрытия окна он больше не будет показан.`}
        className="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setResetResult(null)}>
              Закрыть
            </Button>
            <Button onClick={copyTemporaryPassword}>
              <Copy className="w-4 h-4 mr-1.5" />
              Скопировать
            </Button>
          </>
        }
      >
        {resetResult && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-zinc-100">{resetResult.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{resetResult.email}</p>
            </div>
            <code className="block rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-mono text-sm text-emerald-100 break-all">
              {resetResult.temporaryPassword}
            </code>
            <p className="text-xs text-zinc-500">
              Пароль нужно сменить вручную после входа. Старые сессии участника завершены: {resetResult.revokedSessions}.
            </p>
          </div>
        )}
      </Modal>

    </div>
  );
}

const channelEntries = Object.entries(channels) as [
  keyof typeof channels,
  (typeof channels)[keyof typeof channels]
][];

type DesignChannelId = keyof typeof channels;

type WidgetSettingsForm = {
  title: string;
  subtitle: string;
  businessName: string;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  position: "bottom-right" | "bottom-left";
  suggestedRepliesText: string;
  consentText: string;
  poweredBy: string;
};

const channelTypeByDesignId: Record<DesignChannelId, ChannelType> = {
  instagram: "INSTAGRAM",
  whatsapp: "WHATSAPP",
  telegram: "TELEGRAM",
  website: "WEBSITE",
  webhook: "WEBHOOK",
  vk: "VK",
  email: "EMAIL",
  call: "PHONE",
};

const creatableChannelIds = new Set<DesignChannelId>(["website", "telegram", "webhook"]);

const defaultWidgetSettings: WidgetSettingsForm = {
  title: "LeadVirt.ai",
  subtitle: "AI-администратор",
  businessName: "Демо-компания",
  welcomeMessage: "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
  primaryColor: "#34d399",
  accentColor: "#10b981",
  position: "bottom-right",
  suggestedRepliesText: "Хочу записаться\nСколько стоит?\nПозовите менеджера",
  consentText: "Отправляя сообщение, вы соглашаетесь, что команда может связаться с вами по этой заявке.",
  poweredBy: "LeadVirt.ai",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringFromRecord(source: Record<string, unknown>, key: string, fallback: string) {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function widgetFormFromChannel(channel: Channel | null): WidgetSettingsForm {
  const settings = asRecord(channel?.settings);
  const widget = isRecord(settings.widget) ? asRecord(settings.widget) : settings;
  const suggestedReplies = Array.isArray(widget.suggestedReplies)
    ? widget.suggestedReplies.filter((item): item is string => typeof item === "string")
    : defaultWidgetSettings.suggestedRepliesText.split("\n");

  return {
    title: stringFromRecord(widget, "title", defaultWidgetSettings.title),
    subtitle: stringFromRecord(widget, "subtitle", defaultWidgetSettings.subtitle),
    businessName: stringFromRecord(widget, "businessName", defaultWidgetSettings.businessName),
    welcomeMessage: stringFromRecord(widget, "welcomeMessage", defaultWidgetSettings.welcomeMessage),
    primaryColor: stringFromRecord(widget, "primaryColor", defaultWidgetSettings.primaryColor),
    accentColor: stringFromRecord(widget, "accentColor", defaultWidgetSettings.accentColor),
    position: widget.position === "bottom-left" ? "bottom-left" : "bottom-right",
    suggestedRepliesText: suggestedReplies.join("\n"),
    consentText: stringFromRecord(widget, "consentText", defaultWidgetSettings.consentText),
    poweredBy: stringFromRecord(widget, "poweredBy", defaultWidgetSettings.poweredBy),
  };
}

function widgetSettingsPayload(form: WidgetSettingsForm) {
  return {
    widget: {
      title: form.title,
      subtitle: form.subtitle,
      businessName: form.businessName,
      welcomeMessage: form.welcomeMessage,
      primaryColor: form.primaryColor,
      accentColor: form.accentColor,
      position: form.position,
      locale: "ru-RU",
      suggestedReplies: form.suggestedRepliesText
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      consentText: form.consentText,
      poweredBy: form.poweredBy,
    },
  };
}

function publicApiOrigin() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api").replace(/\/api\/?$/, "").replace(/\/$/, "");
}

function webhookConnectionDetails(channel: Channel | null) {
  const publicKey = channel?.publicKey ?? "";
  const settings = asRecord(channel?.settings);
  const webhook = isRecord(settings.webhook) ? asRecord(settings.webhook) : settings;
  const secret = stringFromRecord(webhook, "secret", stringFromRecord(webhook, "webhookSecret", ""));
  return {
    publicKey,
    secret,
    secretHeader: "x-leadvirt-webhook-secret",
    endpoint: publicKey ? `${publicApiOrigin()}/api/public/channels/webhook/${publicKey}/events` : "",
  };
}

function channelStatusLabel(status: ChannelStatus) {
  const labels: Record<ChannelStatus, string> = {
    ACTIVE: "● Подключён",
    DISABLED: "Отключён",
    ERROR: "Ошибка подключения",
    PENDING: "Ожидает подключения",
    COMING_SOON: "Скоро",
  };
  return labels[status];
}

function channelStatusClass(status: ChannelStatus) {
  if (status === "ACTIVE") return "text-emerald-400";
  if (status === "ERROR") return "text-rose-400";
  if (status === "PENDING") return "text-amber-400";
  return "text-zinc-500";
}

function ChannelsTab() {
  const [apiChannels, setApiChannels] = useState<Channel[] | null | undefined>(undefined);
  const [selectedWidgetChannel, setSelectedWidgetChannel] = useState<Channel | null>(null);
  const [selectedWebhookChannel, setSelectedWebhookChannel] = useState<Channel | null>(null);
  const [widgetForm, setWidgetForm] = useState<WidgetSettingsForm>(defaultWidgetSettings);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [savingChannelId, setSavingChannelId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void listChannels()
      .then((items) => {
        if (!cancelled) setApiChannels(items);
      })
      .catch(() => {
        if (!cancelled) setApiChannels(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const channelForDesignId = (id: DesignChannelId) => apiChannels?.find((channel) => channel.type === channelTypeByDesignId[id]) ?? null;

  const createWorkspaceChannel = async (id: DesignChannelId) => {
    if (!creatableChannelIds.has(id)) {
      toast.error("Channel is configured through its provider integration");
      return null;
    }

    const label = channels[id].label;
    const savingId = `create:${id}`;
    setSavingChannelId(savingId);
    try {
      const created = await createChannel({
        type: channelTypeByDesignId[id] as "WEBSITE" | "TELEGRAM" | "WEBHOOK",
        name: label,
        status: "ACTIVE",
      });
      setApiChannels((prev) => (prev ? [...prev, created] : [created]));
      toast.success("Channel created", { description: created.publicKey ?? label });
      return created;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create channel");
      return null;
    } finally {
      setSavingChannelId(null);
    }
  };

  const openWidgetSettings = (channel: Channel | null) => {
    if (!channel) {
      toast.error("Канал сайта пока не найден");
      return;
    }
    setSelectedWidgetChannel(channel);
    setWidgetForm(widgetFormFromChannel(channel));
    setWidgetModalOpen(true);
  };

  const openWebhookSettings = (channel: Channel | null) => {
    if (!channel) {
      toast.error("Webhook/API channel is not created yet");
      return;
    }
    setSelectedWebhookChannel(channel);
    setWebhookModalOpen(true);
  };

  const toggleChannel = async (id: DesignChannelId, checked: boolean) => {
    const channel = channelForDesignId(id);
    if (!channel) {
      if (checked) {
        await createWorkspaceChannel(id);
        return;
      }
      toast.error("Канал не найден в workspace. Подключите его через интеграции или onboarding.");
      return;
    }
    if (channel.status === "COMING_SOON") {
      toast("Этот канал скоро появится");
      return;
    }

    const nextStatus: ChannelStatus = checked ? "ACTIVE" : "DISABLED";
    const previousChannels = apiChannels;
    setApiChannels((prev) =>
      prev ? prev.map((item) => (item.id === channel.id ? { ...item, status: nextStatus } : item)) : prev
    );
    setSavingChannelId(channel.id);
    try {
      const updated = await updateChannel(channel.id, { status: nextStatus });
      setApiChannels((prev) => (prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : prev));
      toast(checked ? "Канал включён" : "Канал отключён");
    } catch (error) {
        setApiChannels(previousChannels);
      toast.error(error instanceof Error ? error.message : "Не удалось обновить канал");
    } finally {
      setSavingChannelId(null);
    }
  };

  const saveWidgetSettings = async () => {
    if (!selectedWidgetChannel) return;
    setSavingChannelId(selectedWidgetChannel.id);
    try {
      const updated = await updateChannel(selectedWidgetChannel.id, {
        status: selectedWidgetChannel.status === "COMING_SOON" ? "PENDING" : selectedWidgetChannel.status,
        settings: widgetSettingsPayload(widgetForm),
      });
      setApiChannels((prev) => (prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : prev));
      setSelectedWidgetChannel(updated);
      setWidgetModalOpen(false);
      toast.success("Настройки виджета сохранены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить виджет");
    } finally {
      setSavingChannelId(null);
    }
  };

  const webhookDetails = webhookConnectionDetails(selectedWebhookChannel);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Каналы коммуникации"
        description="Подключите каналы, по которым AI будет принимать обращения"
      />
      {apiChannels === null && (
        <Pill className="bg-amber-500/15 text-amber-300 text-xs">
          API каналов недоступен, данные workspace не загружены
        </Pill>
      )}

      <Card className="divide-y divide-white/5">
        {channelEntries.map(([id, ch]) => {
          const channel = channelForDesignId(id);
          const Icon = ch.icon;
          const isOn = channel ? channel.status === "ACTIVE" : false;
          const isSaving = channel ? savingChannelId === channel.id : savingChannelId === `create:${id}`;
          return (
            <div key={id} className="flex items-center gap-4 px-5 py-4">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  ch.bg
                )}
              >
                <Icon className={cn("w-5 h-5", ch.color)} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-100">
                  {channel?.name ?? ch.label}
                </p>
                <p className="text-xs text-zinc-500">
                  {channel ? (
                    <span className={channelStatusClass(channel.status)}>{channelStatusLabel(channel.status)}</span>
                  ) : (
                    "Не подключён"
                  )}
                  {channel?.publicKey && (
                    <span className="hidden sm:inline text-zinc-600"> · {channel.publicKey}</span>
                  )}
                </p>
              </div>

              <button
                aria-label={`Настроить ${ch.label}`}
                onClick={() => {
                  if (id === "website") {
                    openWidgetSettings(channel);
                    return;
                  }
                  if (id === "webhook") {
                    if (channel) {
                      openWebhookSettings(channel);
                      return;
                    }
                    void createWorkspaceChannel(id).then((created) => {
                      if (created) openWebhookSettings(created);
                    });
                    return;
                  }
                  toast("Настройки канала будут доступны после подключения провайдера");
                }}
                className="hidden sm:inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-400 transition-colors mr-2"
              >
                Настроить
                <ExternalLink className="w-3 h-3" />
              </button>

              <Toggle
                checked={isOn}
                onChange={(v) => {
                  if (isSaving) return;
                  void toggleChannel(id, v);
                }}
              />
            </div>
          );
        })}
      </Card>

      <Modal
        open={widgetModalOpen}
        onOpenChange={setWidgetModalOpen}
        title="Настройки виджета сайта"
        description="Эти параметры сразу используются публичным `/public/widget/:publicKey/config`."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setWidgetModalOpen(false)} disabled={savingChannelId === selectedWidgetChannel?.id}>
              Отмена
            </Button>
            <Button onClick={() => void saveWidgetSettings()} disabled={savingChannelId === selectedWidgetChannel?.id}>
              Сохранить виджет
            </Button>
          </>
        }
      >
        <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">Public key</p>
                <p className="text-sm font-mono text-zinc-200 mt-1">{selectedWidgetChannel?.publicKey ?? "Не создан"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(selectedWidgetChannel?.publicKey ?? "");
                  toast("Public key скопирован");
                }}
                disabled={!selectedWidgetChannel?.publicKey}
              >
                <Copy className="w-4 h-4 mr-1.5" />
                Копировать
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Заголовок">
              <Input aria-label="Заголовок" value={widgetForm.title} onChange={(event) => setWidgetForm((prev) => ({ ...prev, title: event.target.value }))} />
            </Field>
            <Field label="Подзаголовок">
              <Input aria-label="Подзаголовок" value={widgetForm.subtitle} onChange={(event) => setWidgetForm((prev) => ({ ...prev, subtitle: event.target.value }))} />
            </Field>
          </div>

          <Field label="Название бизнеса">
            <Input aria-label="Название бизнеса" value={widgetForm.businessName} onChange={(event) => setWidgetForm((prev) => ({ ...prev, businessName: event.target.value }))} />
          </Field>

          <Field label="Приветственное сообщение">
            <Textarea
              aria-label="Приветственное сообщение"
              rows={4}
              value={widgetForm.welcomeMessage}
              onChange={(event) => setWidgetForm((prev) => ({ ...prev, welcomeMessage: event.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Основной цвет">
              <Input aria-label="Основной цвет" value={widgetForm.primaryColor} onChange={(event) => setWidgetForm((prev) => ({ ...prev, primaryColor: event.target.value }))} />
            </Field>
            <Field label="Акцент">
              <Input aria-label="Акцент" value={widgetForm.accentColor} onChange={(event) => setWidgetForm((prev) => ({ ...prev, accentColor: event.target.value }))} />
            </Field>
            <Field label="Позиция">
              <Select value={widgetForm.position} onChange={(position) => setWidgetForm((prev) => ({ ...prev, position: position === "bottom-left" ? "bottom-left" : "bottom-right" }))}>
                <option value="bottom-right">Справа снизу</option>
                <option value="bottom-left">Слева снизу</option>
              </Select>
            </Field>
          </div>

          <Field label="Быстрые ответы" hint="Каждый вариант с новой строки или через запятую.">
            <Textarea
              aria-label="Быстрые ответы"
              rows={3}
              value={widgetForm.suggestedRepliesText}
              onChange={(event) => setWidgetForm((prev) => ({ ...prev, suggestedRepliesText: event.target.value }))}
            />
          </Field>

          <Field label="Текст согласия">
            <Textarea
              aria-label="Текст согласия"
              rows={2}
              value={widgetForm.consentText}
              onChange={(event) => setWidgetForm((prev) => ({ ...prev, consentText: event.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={webhookModalOpen}
        onOpenChange={setWebhookModalOpen}
        title="Webhook/API"
        description="Use these values in the external service that sends leads into LeadVirt."
        className="max-w-2xl"
        footer={
          <Button variant="outline" onClick={() => setWebhookModalOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          {[
            { label: "Endpoint", value: webhookDetails.endpoint },
            { label: "Public key", value: webhookDetails.publicKey },
            { label: "Secret header", value: webhookDetails.secretHeader },
            { label: "Secret", value: webhookDetails.secret },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-zinc-500">{item.label}</p>
                  <p className="mt-1 break-all font-mono text-sm text-zinc-200">{item.value || "Not generated"}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(item.value);
                    toast(`${item.label} copied`);
                  }}
                  disabled={!item.value}
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

const notifItems = [
  {
    id: "new_lead",
    label: "Новый лид",
    desc: "Уведомление при каждом новом обращении",
  },
  {
    id: "no_reply",
    label: "Лид без ответа",
    desc: "Если клиент не получил ответ более 30 минут",
  },
  {
    id: "booking",
    label: "Запись создана",
    desc: "Когда AI успешно записал клиента",
  },
  {
    id: "daily",
    label: "Ежедневный отчёт",
    desc: "Сводка результатов за сутки на email",
  },
  {
    id: "tg_summary",
    label: "Сводка в Telegram",
    desc: "Краткая сводка каждый день в 09:00",
  },
];

function NotificationsTab() {
  const { notifications, setNotifications } = useSettingsApi();
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    new_lead: true,
    no_reply: true,
    booking: true,
    daily: false,
    tg_summary: true,
  });

  useEffect(() => {
    if (notifications) setToggles(notifications);
  }, [notifications]);

  const handleToggle = async (id: string, value: boolean) => {
    const previous = toggles;
    const next = { ...toggles, [id]: value };
    setToggles(next);
    try {
      const updated = await updateNotificationsSettings({ [id]: value } as Partial<NotificationsSettings>);
      setNotifications(updated);
      toast("Настройка обновлена");
    } catch (error) {
      setToggles(previous);
      toast.error(error instanceof Error ? error.message : "Не удалось обновить уведомления");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Уведомления"
        description="Настройте, о каких событиях вы хотите получать оповещения"
      />

      <Card className="divide-y divide-white/5">
        {notifItems.map((item) => (
          <div key={item.id} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-100">{item.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
            </div>
            <Toggle
              checked={toggles[item.id]}
              onChange={(v) => void handleToggle(item.id, v)}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

function BillingTab() {
  const { account } = useSettingsApi();
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [paymentMethodRequesting, setPaymentMethodRequesting] = useState(false);
  const [paymentMethodRequestedAt, setPaymentMethodRequestedAt] = useState<string | null>(null);
  const [planChangeCode, setPlanChangeCode] = useState<BillingPlan["code"] | null>(null);
  const [billingData, setBillingData] = useState<{
    plans: BillingPlan[];
    subscription: BillingSubscription;
    usage: BillingUsage | null;
    paymentMethod: BillingPaymentMethod | null;
    invoices: BillingInvoice[];
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      listBillingPlans(),
      getCurrentSubscription(),
      getBillingUsage(),
      getBillingPaymentMethod(),
      listBillingInvoices(),
    ]).then(
      ([plansResult, subscriptionResult, usageResult, paymentMethodResult, invoicesResult]) => {
        if (cancelled) return;

        setBillingError(
          plansResult.status === "rejected" ||
            subscriptionResult.status === "rejected" ||
            usageResult.status === "rejected" ||
            paymentMethodResult.status === "rejected" ||
            invoicesResult.status === "rejected"
        );
        setBillingData({
          plans: plansResult.status === "fulfilled" ? plansResult.value : [],
          subscription: subscriptionResult.status === "fulfilled" ? subscriptionResult.value : null,
          usage: usageResult.status === "fulfilled" ? usageResult.value : null,
          paymentMethod: paymentMethodResult.status === "fulfilled" ? paymentMethodResult.value : null,
          invoices: invoicesResult.status === "fulfilled" ? invoicesResult.value : [],
        });
        setBillingLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const activePlan = billingData?.subscription?.plan;
  const displayPlans = billingData?.plans.length ? billingData.plans.map(apiPlanToDesignPlan) : plans;
  const currentPlanName = planName(activePlan);
  const currentPrice = activePlan ? formatRub(activePlan.priceMonthlyRub) : "4 900 ₽";
  const subscriptionStatus = billingData?.subscription?.status ?? null;
  const subscriptionCanceled = subscriptionStatus === "CANCELED" || subscriptionStatus === "CANCELLED";
  const currentPeriodEnd = billingData?.subscription?.periodEnd
    ? formatDate(billingData.subscription.periodEnd)
    : "1 июля 2025";
  const usage = billingData?.usage;
  const paymentMethod = billingData?.paymentMethod;
  const paymentMethodChangeRequested = Boolean(paymentMethodRequestedAt || paymentMethod?.status === "change_requested");
  const usageItems: { label: string; used: number; total: number | null }[] = usage
    ? [
        { label: "AI-диалоги", used: usage.aiConversations, total: usage.aiConversationsLimit },
        { label: "Активные каналы", used: usage.channels, total: usage.channelsLimit },
        { label: "Участники команды", used: usage.users, total: usage.usersLimit },
        { label: "Автоматизации", used: usage.scenarios, total: usage.scenariosLimit },
      ]
    : [
        { label: "Лиды обработано", used: 1248, total: 2000 },
        { label: "Активные каналы", used: 6, total: 10 },
        { label: "Участники команды", used: 4, total: 10 },
        { label: "Автоматизаций", used: 12, total: 25 },
      ];

  const handleSelectPlan = async (planCode: BillingPlan["code"], displayName: string) => {
    setPlanChangeCode(planCode);
    try {
      const subscription = await changeSubscriptionPlan(planCode);
      setBillingData((current) => {
        const nextUsage = current?.usage
          ? {
              ...current.usage,
              aiConversationsLimit: subscription.plan.aiConversations,
              channelsLimit: subscription.plan.channelsLimit,
              usersLimit: subscription.plan.usersLimit,
              scenariosLimit: subscription.plan.scenariosLimit,
            }
          : null;
        return {
          plans: current?.plans.length ? current.plans : [subscription.plan],
          subscription,
          usage: nextUsage,
          paymentMethod: current?.paymentMethod ?? null,
          invoices: current?.invoices ?? [],
        };
      });
      setPlanModalOpen(false);
      toast.success(`Тариф «${displayName}» активирован`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить тариф");
    } finally {
      setPlanChangeCode(null);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelSaving(true);
    try {
      const subscription = await cancelCurrentSubscription();
      setBillingData((current) => ({
        plans: current?.plans ?? [],
        subscription,
        usage: current?.usage ?? null,
        paymentMethod: current?.paymentMethod ?? null,
        invoices: current?.invoices ?? [],
      }));
      toast.success("Подписка отменена", {
        description: `Доступ сохранён до ${formatDate(subscription.periodEnd)}`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отменить подписку");
    } finally {
      setCancelSaving(false);
    }
  };

  const handlePaymentMethodChangeRequest = async () => {
    if (!paymentMethod) {
      toast.error("Платёжный метод недоступен");
      return;
    }
    setPaymentMethodRequesting(true);
    try {
      const result = await requestBillingPaymentMethodChange();
      setPaymentMethodRequestedAt(result.requestedAt);
      setBillingData((current) =>
        current
          ? {
              ...current,
              paymentMethod: {
                ...paymentMethod,
                status: "change_requested",
                updatedAt: result.requestedAt,
              },
            }
          : current
      );
      toast.success("Запрос отправлен", {
        description: "Менеджер LeadVirt.ai свяжется для обновления реквизитов.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
    } finally {
      setPaymentMethodRequesting(false);
    }
  };

  const handleDownloadInvoice = (invoice: BillingInvoice | null) => {
    if (!invoice) {
      toast.error("Счёт доступен только при подключённом Billing API");
      return;
    }
    downloadTextFile(invoice.downloadName, buildInvoiceText(invoice, account?.businessName));
    toast.success("Счёт скачан");
  };

  const invoices = billingData?.invoices.length
    ? billingData.invoices.map((invoice) => ({
        id: invoice.id,
        date: formatDate(invoice.issuedAt),
        amount: formatRub(invoice.amountRub),
        status: billingInvoiceStatusLabel(invoice.status),
        plan: `Тариф «${planName(invoice.plan)}»`,
        invoice,
      }))
    : [];

  const paymentMethodLabel = paymentMethod?.label ?? "Безналичный расчёт по счёту";
  const paymentMethodDescription = paymentMethod?.description ?? "Счёт выставляется вручную менеджером LeadVirt.ai";
  const paymentMethodActionLabel = paymentMethodRequesting
    ? "Отправляем..."
    : paymentMethodChangeRequested
      ? "Запрос отправлен"
      : paymentMethod?.nextActionLabel ?? "Запросить изменение";
  const paymentMethodStatusLabel = paymentMethodChangeRequested ? "Запрос отправлен" : "Manual billing";
  const paymentMethodStatusClass = paymentMethodChangeRequested
    ? "bg-amber-500/15 text-amber-300"
    : "bg-emerald-500/15 text-emerald-300";

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Биллинг и подписка"
        description="Управляйте тарифом и способом оплаты"
      />
      {billingError && (
        <Pill className="bg-amber-500/15 text-amber-300 text-xs">
          API биллинга недоступен, данные workspace не загружены
        </Pill>
      )}

      {/* Plan card */}
      <div className="relative rounded-3xl p-px overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/40 via-teal-500/20 to-transparent" />
        <div className="relative rounded-[calc(1.5rem-1px)] bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Pill
                className={cn(
                  "mb-3 text-xs",
                  subscriptionCanceled ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"
                )}
              >
                {billingLoading ? "Загрузка тарифа" : subscriptionCanceled ? "Подписка отменена" : "Текущий тариф"}
              </Pill>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-50">
                Тариф «{currentPlanName}»
              </h3>
              <p className="text-zinc-400 text-sm mt-1">
                {subscriptionCanceled ? `Доступ сохранён до ${currentPeriodEnd}` : `Следующее списание — ${currentPeriodEnd}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-zinc-50 tracking-tight">
                {currentPrice}
              </p>
              <p className="text-xs text-zinc-500">
                {activePlan?.priceMonthlyRub === null ? "по договору" : "в месяц"}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {usageItems.map((item) => {
              const pct = item.total ? Math.min(100, Math.round((item.used / item.total) * 100)) : 48;
              return (
                <div key={item.label}>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                    <span>{item.label}</span>
                    <span className="text-zinc-300 font-medium">
                      {item.used.toLocaleString("ru")}{" "}
                      <span className="text-zinc-500">
                        / {item.total ? item.total.toLocaleString("ru") : "без лимита"}
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className={cn(
                        "h-full rounded-full",
                        pct >= 80
                          ? "bg-amber-400"
                          : "bg-gradient-to-r from-emerald-500 to-teal-400"
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex gap-3">
            <Button onClick={() => setPlanModalOpen(true)}>Изменить тариф</Button>
            <Button
              variant="outline"
              disabled={billingLoading || billingError || !billingData?.subscription || subscriptionCanceled || cancelSaving}
              onClick={() => setCancelConfirmOpen(true)}
            >
              {cancelSaving ? "Отменяем..." : subscriptionCanceled ? "Подписка отменена" : "Отменить подписку"}
            </Button>
          </div>
        </div>
      </div>

      {/* Plan selection modal */}
      <Modal
        open={planModalOpen}
        onOpenChange={setPlanModalOpen}
        title="Выбрать тариф"
        description="Сравните планы и выберите подходящий для вашей команды"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          {displayPlans.map((plan) => {
            const planCode = "code" in plan ? plan.code : null;
            const active = Boolean(planCode && activePlan?.code === planCode);
            const changing = Boolean(planCode && planChangeCode === planCode);
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-2xl border p-5 flex flex-col gap-3 transition-colors",
                  plan.popular
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-white/5 bg-white/[0.03]"
                )}
              >
                {plan.popular && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                    Популярный
                  </span>
                )}
                <div>
                  <p className="text-sm font-bold text-zinc-100">{plan.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{plan.tagline}</p>
                </div>
                <div>
                  <span className="text-xl font-bold text-zinc-50">{plan.price}</span>
                  <span className="text-xs text-zinc-500 ml-1">{plan.priceNote}</span>
                </div>
                <ul className="space-y-1.5">
                  {plan.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-zinc-400">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                  {plan.features.length > 4 && (
                    <li className="text-xs text-zinc-600">
                      +{plan.features.length - 4} ещё
                    </li>
                  )}
                </ul>
                <Button
                  size="sm"
                  variant={plan.popular ? "primary" : "outline"}
                  className="mt-auto"
                  disabled={!planCode || active || planChangeCode !== null}
                  onClick={() => {
                    if (planCode) void handleSelectPlan(planCode, plan.name);
                  }}
                >
                  {changing ? "Сохраняем" : active ? "Текущий" : planCode ? "Выбрать" : "API недоступен"}
                </Button>
              </div>
            );
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Отменить подписку?"
        description={`Тариф «${currentPlanName}» будет отменён. Доступ и лимиты останутся до ${currentPeriodEnd}.`}
        danger
        confirmLabel="Подтвердить отмену"
        onConfirm={() => void handleCancelSubscription()}
      />

      {/* Payment method */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Способ оплаты
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-zinc-100">{paymentMethodLabel}</p>
                <Pill className={cn("text-[10px]", paymentMethodStatusClass)}>
                  {paymentMethodStatusLabel}
                </Pill>
              </div>
              <p className="text-xs text-zinc-500">{paymentMethodDescription}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!paymentMethod || paymentMethodRequesting || paymentMethodChangeRequested}
            onClick={() => void handlePaymentMethodChangeRequest()}
          >
            {paymentMethodActionLabel}
          </Button>
        </div>
      </Card>

      {/* Invoices */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          История платежей
        </p>
        <div className="space-y-2">
          {invoices.map((inv) => (
            <div
              key={inv.date}
              className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
            >
              <div>
                <p className="text-sm text-zinc-200 font-medium">{inv.date}</p>
                <p className="text-xs text-zinc-500">{inv.plan}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-zinc-100">
                  {inv.amount}
                </span>
                <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                  {inv.status}
                </Pill>
                <Tip content="Скачать счёт">
                  <button
                    aria-label={`Скачать счёт ${inv.date}`}
                    disabled={!inv.invoice}
                    onClick={() => handleDownloadInvoice(inv.invoice)}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </Tip>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function sessionPresentation(session: SecuritySession) {
  const userAgent = session.userAgent?.toLowerCase() ?? "";
  const isPhone = /iphone|android|mobile/.test(userAgent);
  const isDesktop = /macintosh|windows|linux/.test(userAgent);
  const browser = userAgent.includes("firefox")
    ? "Firefox"
    : userAgent.includes("edg/")
      ? "Edge"
      : userAgent.includes("safari") && !userAgent.includes("chrome")
        ? "Safari"
        : userAgent.includes("chrome")
          ? "Chrome"
          : "Браузер";

  return {
    device: isPhone ? `${browser} · телефон` : isDesktop ? `${browser} · компьютер` : browser,
    icon: isPhone ? Smartphone : isDesktop ? Monitor : Globe,
    location: session.ipAddress ? `IP ${session.ipAddress}` : "IP не записан",
    time: session.current ? "Сейчас" : formatDate(session.lastUsedAt)
  };
}

function defaultSecuritySettings(): SecuritySettings {
  return {
    authMode: "credentials",
    tenantScoped: true,
    currentRole: "OWNER",
    passwordChangeRequired: false,
    twoFactor: {
      enabled: false,
      setupPending: false,
      confirmedAt: null,
      recoveryCodesRemaining: 0
    },
    sessions: []
  };
}

function SecurityTab() {
  const { security, setSecurity } = useSettingsApi();
  const [showPass, setShowPass] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<Awaited<ReturnType<typeof startTwoFactorSetup>> | null>(null);
  const [twoFactorQrDataUrl, setTwoFactorQrDataUrl] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorAction, setTwoFactorAction] = useState<"setup" | "enable" | "disable" | "recovery" | null>(null);
  const [visibleRecoveryCodes, setVisibleRecoveryCodes] = useState<string[]>([]);

  const sessions = security?.sessions ?? [];
  const twoFactor = security?.twoFactor ?? defaultSecuritySettings().twoFactor;

  useEffect(() => {
    let cancelled = false;
    if (!twoFactorSetup) {
      setTwoFactorQrDataUrl("");
      return;
    }

    QRCode.toDataURL(twoFactorSetup.otpauthUri, {
      margin: 1,
      width: 176,
      color: {
        dark: "#0f172a",
        light: "#f8fafc"
      }
    })
      .then((dataUrl) => {
        if (!cancelled) setTwoFactorQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setTwoFactorQrDataUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [twoFactorSetup]);

  async function refreshSecurity() {
    const updated = await getSecuritySettings();
    setSecurity(updated);
    return updated;
  }

  async function handlePasswordChange() {
    if (newPassword !== repeatPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Новый пароль должен быть не короче 8 символов");
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      await refreshSecurity();
      toast.success("Пароль обновлён", {
        description: result.revokedSessions > 0 ? `Завершено других сессий: ${result.revokedSessions}` : undefined,
      });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось обновить пароль");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setSessionActionId(sessionId);
    try {
      await revokeSecuritySession(sessionId);
      setSecurity({
        ...(security ?? defaultSecuritySettings()),
        sessions: sessions.filter((session) => session.id !== sessionId),
      });
      toast.success("Сессия завершена");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось завершить сессию");
    } finally {
      setSessionActionId(null);
    }
  }

  async function handleRevokeOthers() {
    setSessionActionId("others");
    try {
      const result = await revokeOtherSecuritySessions();
      await refreshSecurity();
      toast.success("Другие сессии завершены", { description: `Завершено: ${result.revoked}` });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось завершить другие сессии");
    } finally {
      setSessionActionId(null);
    }
  }

  function updateTwoFactor(nextTwoFactor: SecuritySettings["twoFactor"]) {
    setSecurity({
      ...(security ?? defaultSecuritySettings()),
      twoFactor: nextTwoFactor,
    });
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard?.writeText(value);
      toast.success(label);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  async function handleStartTwoFactor() {
    setTwoFactorAction("setup");
    setVisibleRecoveryCodes([]);
    try {
      const setup = await startTwoFactorSetup();
      setTwoFactorSetup(setup);
      setTwoFactorCode("");
      toast.success("2FA setup создан");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось начать настройку 2FA");
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleEnableTwoFactor() {
    setTwoFactorAction("enable");
    try {
      const result = await enableTwoFactor({ code: twoFactorCode });
      updateTwoFactor(result.twoFactor);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setVisibleRecoveryCodes(result.recoveryCodes);
      toast.success("2FA включена", { description: "Сохраните recovery codes в безопасном месте." });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось включить 2FA");
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleDisableTwoFactor() {
    setTwoFactorAction("disable");
    try {
      const result = await disableTwoFactor({ currentPassword: twoFactorPassword });
      updateTwoFactor(result.twoFactor);
      setTwoFactorPassword("");
      setVisibleRecoveryCodes([]);
      setTwoFactorSetup(null);
      toast.success("2FA отключена");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось отключить 2FA");
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleRegenerateRecoveryCodes() {
    setTwoFactorAction("recovery");
    try {
      const result = await regenerateTwoFactorRecoveryCodes({ currentPassword: twoFactorPassword });
      updateTwoFactor(result.twoFactor);
      setVisibleRecoveryCodes(result.recoveryCodes);
      setTwoFactorPassword("");
      toast.success("Recovery codes обновлены");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось обновить recovery codes");
    } finally {
      setTwoFactorAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Безопасность"
        description="Защита вашего аккаунта и управление сессиями"
      />

      <Card className="p-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Режим входа", value: security?.authMode ?? "credentials" },
          { label: "Tenant isolation", value: security?.tenantScoped ? "Включен" : "Неизвестно" },
          { label: "Текущая роль", value: security ? roleLabel(security.currentRole) : "Администратор" },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">{item.label}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</p>
          </div>
        ))}
      </Card>

      {/* Change password */}
      <Card className={cn("p-6 space-y-5", security?.passwordChangeRequired && "border-amber-500/30 bg-amber-500/5")}>
        {security?.passwordChangeRequired && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-200">Нужно сменить временный пароль</p>
            <p className="mt-1 text-xs text-amber-100/70">
              Администратор выдал временный пароль. Укажите его как текущий и задайте новый постоянный пароль.
            </p>
          </div>
        )}
        <p className="text-sm font-bold text-zinc-200 tracking-tight">
          Изменить пароль
        </p>
        <Field label="Текущий пароль">
          <div className="relative">
            <Input
              type={showPass ? "text" : "password"}
              placeholder="••••••••"
              className="pr-10"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-label="Текущий пароль"
            />
            <Tip content={showPass ? "Скрыть пароль" : "Показать пароль"}>
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPass ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </Tip>
          </div>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Новый пароль">
            <Input
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-label="Новый пароль"
            />
          </Field>
          <Field label="Повторите пароль">
            <Input
              type="password"
              placeholder="••••••••"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              aria-label="Повторите пароль"
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => void handlePasswordChange()}
            disabled={passwordSaving || !currentPassword || !newPassword || !repeatPassword}
          >
            Обновить пароль
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-5" data-testid="settings-two-factor-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Двухфакторная аутентификация</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              TOTP-коды из authenticator app и одноразовые recovery codes для аварийного входа.
            </p>
          </div>
          <Pill className={twoFactor.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"}>
            {twoFactor.enabled ? "Включено" : twoFactor.setupPending || twoFactorSetup ? "Настройка" : "Выключено"}
          </Pill>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">Статус</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{twoFactor.enabled ? "Активна" : "Не активна"}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">Recovery codes</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{twoFactor.recoveryCodesRemaining}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">Подтверждена</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{twoFactor.confirmedAt ? formatDate(twoFactor.confirmedAt) : "Нет"}</p>
          </div>
        </div>

        {!twoFactor.enabled && !twoFactorSetup && (
          <div className="flex justify-end">
            <Button onClick={() => void handleStartTwoFactor()} disabled={twoFactorAction === "setup"} className="gap-2">
              <ShieldCheck className="w-4 h-4" />
              Настроить 2FA
            </Button>
          </div>
        )}

        {!twoFactor.enabled && twoFactorSetup && (
          <div className="space-y-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-200">Добавьте ключ в authenticator app</p>
                <p className="mt-1 text-xs text-emerald-100/70">
                  Отсканируйте QR-код или вставьте setup key вручную.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyText(twoFactorSetup.secret, "Setup key скопирован")}>
                  <Copy className="w-4 h-4 mr-1.5" />
                  Key
                </Button>
                <Button variant="outline" size="sm" onClick={() => void copyText(twoFactorSetup.otpauthUri, "otpauth URI скопирован")}>
                  <Copy className="w-4 h-4 mr-1.5" />
                  URI
                </Button>
              </div>
            </div>
            {twoFactorQrDataUrl && (
              <div
                role="img"
                aria-label="QR-код для настройки 2FA"
                className="h-44 w-44 rounded-2xl border border-white/10 bg-slate-50 bg-contain bg-center bg-no-repeat p-2"
                style={{ backgroundImage: `url(${twoFactorQrDataUrl})` }}
              />
            )}
            <code className="block rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 font-mono text-xs text-zinc-200 break-all">
              {twoFactorSetup.secret}
            </code>
            <Field label="Код из приложения">
              <Input
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
                inputMode="numeric"
                placeholder="123456"
                aria-label="2FA код подтверждения"
              />
            </Field>
            <div className="flex justify-end">
              <Button onClick={() => void handleEnableTwoFactor()} disabled={twoFactorAction === "enable" || twoFactorCode.length < 6}>
                Подтвердить и включить
              </Button>
            </div>
          </div>
        )}

        {twoFactor.enabled && (
          <div className="space-y-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <Field label="Текущий пароль" hint="Нужен для отключения 2FA или выпуска новых recovery codes.">
              <Input
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
                type="password"
                placeholder="••••••••"
                aria-label="Пароль для 2FA действий"
              />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => void handleRegenerateRecoveryCodes()}
                disabled={twoFactorAction === "recovery" || !twoFactorPassword}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Новые recovery codes
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDisableTwoFactor()}
                disabled={twoFactorAction === "disable" || !twoFactorPassword}
                className="border-rose-500/20 text-rose-300 hover:bg-rose-500/5"
              >
                Отключить 2FA
              </Button>
            </div>
          </div>
        )}

        {visibleRecoveryCodes.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-100">Сохраните recovery codes</p>
                <p className="mt-1 text-xs text-amber-100/70">
                  Эти коды показываются только сейчас. Каждый код можно использовать один раз вместо TOTP.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyText(visibleRecoveryCodes.join("\n"), "Recovery codes скопированы")}>
                <Copy className="w-4 h-4 mr-1.5" />
                Скопировать
              </Button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {visibleRecoveryCodes.map((code) => (
                <code key={code} className="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-amber-50">
                  {code}
                </code>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Sessions */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Активные сессии
        </p>
        <div className="space-y-3">
          {sessions.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
              Активных credential-сессий пока нет.
            </div>
          )}
          {sessions.map((s) => {
            const presentation = sessionPresentation(s);
            const Icon = presentation.icon;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
              >
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-200">
                      {presentation.device}
                    </p>
                    {s.current && (
                      <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                        Текущая
                      </Pill>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {presentation.location} · {presentation.time}
                  </p>
                </div>
                {!s.current && (
                  <Tip content="Завершить сессию">
                    <button
                      type="button"
                      onClick={() => void handleRevokeSession(s.id)}
                      disabled={sessionActionId === s.id}
                      className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      Закрыть
                    </button>
                  </Tip>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5">
          <Button
            variant="outline"
            className="gap-2 text-rose-400 border-rose-500/20 hover:bg-rose-500/5"
            disabled={sessions.filter((session) => !session.current).length === 0 || sessionActionId === "others"}
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut className="w-4 h-4" />
            Выйти на других устройствах
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Выйти на других устройствах?"
        description="Все остальные активные сессии будут завершены. Текущая вкладка останется авторизованной."
        danger
        confirmLabel="Завершить другие"
        onConfirm={() => void handleRevokeOthers()}
      />
    </div>
  );
}

function ApiKeysTab() {
  const { billing, setBilling } = useSettingsApi();
  const [copied, setCopied] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingKey, setRevokingKey] = useState(false);
  const displayApiKeys = (billing?.apiKeys ?? []).map((key) => ({
        id: key.id,
        name: key.name,
        key: `${key.keyPrefix}••••••••••••••••`,
        created: formatDate(key.createdAt),
        last: key.lastUsedAt ? formatDate(key.lastUsedAt) : "Не использовался",
      }));

  const handleCopy = (id: string) => {
    const secret = createdKey?.id === id ? createdKey.secret : displayApiKeys.find((key) => key.id === id)?.key ?? "";
    void navigator.clipboard?.writeText(secret);
    setCopied(id);
    toast("Скопировано");
    setTimeout(() => setCopied(null), 1500);
  };

  const openRevoke = (id: string) => {
    setRevokeTarget(id);
    setConfirmRevoke(true);
  };

  const targetKey = displayApiKeys.find((k) => k.id === revokeTarget);

  const handleCreateKey = async () => {
    setCreatingKey(true);
    try {
      const created = await createApiKey({ name: `Ключ ${new Date().toLocaleDateString("ru-RU")}` });
      setCreatedKey(created);
      setBilling({
        billingMode: billing?.billingMode ?? "manual",
        apiKeys: [...(billing?.apiKeys ?? []), created],
      });
      toast.success("Ключ создан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать ключ");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!revokeTarget) return;
    setRevokingKey(true);
    try {
      await revokeApiKey(revokeTarget);
      setBilling({
        billingMode: billing?.billingMode ?? "manual",
        apiKeys: (billing?.apiKeys ?? []).filter((key) => key.id !== revokeTarget),
      });
      if (createdKey?.id === revokeTarget) setCreatedKey(null);
      toast.success("Ключ отозван");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отозвать ключ");
    } finally {
      setRevokingKey(false);
      setRevokeTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="API ключи"
        description="Используйте ключи для интеграции с внешними сервисами"
      />

      <Card className="divide-y divide-white/5">
        {displayApiKeys.length === 0 && (
          <div className="px-5 py-6">
            <p className="text-sm font-semibold text-zinc-100">API-ключи пока не созданы</p>
            <p className="mt-1 text-xs text-zinc-500">
              Создайте первый ключ для webhook, виджета или внешней интеграции.
            </p>
          </div>
        )}
        {displayApiKeys.map((k) => (
          <div key={k.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <p className="text-sm font-semibold text-zinc-100">{k.name}</p>
                <p className="text-xs text-zinc-500">
                  Создан {k.created} · Последнее использование: {k.last}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Tip content="Скопировать ключ">
                  <button
                    onClick={() => handleCopy(k.id)}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {copied === k.id ? (
                        <motion.span
                          key="check"
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.7, opacity: 0 }}
                          className="flex items-center gap-1.5 text-emerald-400"
                        >
                          <Check className="w-3.5 h-3.5" /> Скопировано
                        </motion.span>
                      ) : (
                        <motion.span
                          key="copy"
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.7, opacity: 0 }}
                          className="flex items-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" /> Копировать
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                </Tip>
                <Tip content="Отозвать ключ">
                  <button
                    onClick={() => openRevoke(k.id)}
                    className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-rose-500/5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Отозвать
                  </button>
                </Tip>
              </div>
            </div>
            <code className="inline-block text-xs font-mono text-zinc-400 bg-white/5 rounded-lg px-3 py-1.5 max-w-full truncate">
              {k.key}
            </code>
          </div>
        ))}
      </Card>

      {createdKey && (
        <Card className="p-5 border-emerald-500/20 bg-emerald-500/5">
          <p className="text-xs font-semibold text-emerald-300 mb-1">Новый ключ создан</p>
          <p className="text-xs text-zinc-400 mb-3">Скопируйте secret сейчас. После обновления страницы он больше не будет показан.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 text-xs font-mono text-zinc-200 bg-black/30 rounded-lg px-3 py-2 overflow-x-auto">
              {createdKey.secret}
            </code>
            <Button variant="outline" size="sm" onClick={() => handleCopy(createdKey.id)}>
              <Copy className="w-4 h-4 mr-1.5" />
              Скопировать
            </Button>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void handleCreateKey()} disabled={creatingKey}>
          <Plus className="w-4 h-4 mr-1.5" />
          {creatingKey ? "Создаём..." : "Создать ключ"}
        </Button>
      </div>

      <Card className="p-5 border-amber-500/20 bg-amber-500/5">
        <p className="text-xs font-semibold text-amber-300 mb-1">
          Важная информация
        </p>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Храните API ключи в безопасном месте и не передавайте третьим лицам.
          При подозрении на компрометацию немедленно отзовите ключ и создайте
          новый.
        </p>
      </Card>

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Отозвать ключ?"
        description={`Ключ «${targetKey?.name ?? ""}» будет немедленно деактивирован. Все интеграции, использующие его, перестанут работать.`}
        danger
        confirmLabel={revokingKey ? "Отзываем..." : "Отозвать"}
        onConfirm={() => void handleRevokeKey()}
      />
    </div>
  );
}

const tabContentMap: Record<TabId, React.ComponentType> = {
  profile: ProfileTab,
  team: TeamTab,
  channels: ChannelsTab,
  notifications: NotificationsTab,
  billing: BillingTab,
  security: SecurityTab,
  api: ApiKeysTab,
};

/* ============================================================
   Main SettingsPage
   ============================================================ */

export function SettingsPage({
  initialTab = "profile",
  title = "Настройки",
}: {
  initialTab?: TabId;
  title?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [account, setAccount] = useState<SettingsAccount | null>(null);
  const [team, setTeam] = useState<TeamSettings | null>(null);
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [billing, setBilling] = useState<BillingSettings | null>(null);
  const [notifications, setNotifications] = useState<NotificationsSettings | null>(null);
  const ActiveContent = tabContentMap[activeTab];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      getAccountSettings(),
      getTeamSettings(),
      getSecuritySettings(),
      getBillingSettings(),
      getNotificationsSettings(),
    ]).then(([accountResult, teamResult, securityResult, billingResult, notificationsResult]) => {
      if (cancelled) return;
      if (accountResult.status === "fulfilled") setAccount(accountResult.value);
      if (teamResult.status === "fulfilled") setTeam(teamResult.value);
      if (securityResult.status === "fulfilled") setSecurity(securityResult.value);
      if (billingResult.status === "fulfilled") setBilling(billingResult.value);
      if (notificationsResult.status === "fulfilled") setNotifications(notificationsResult.value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsApiContext.Provider value={{ account, setAccount, team, setTeam, security, setSecurity, billing, setBilling, notifications, setNotifications }}>
      <ProductLayout title={title}>
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Vertical tab nav (desktop) / Horizontal chips (mobile) ── */}

        {/* Mobile horizontal scrollable chips */}
        <div className="lg:hidden w-full overflow-x-auto pb-1 -mx-1 px-1">
          <div className="flex gap-2 min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all border",
                    active
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.1)]"
                      : "bg-white/[0.03] border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop vertical nav */}
        <nav className="hidden lg:flex lg:w-56 shrink-0 flex-col gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-left transition-all",
                  active
                    ? "text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="settings-active"
                    className="absolute inset-0 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.08)]"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon
                  className={cn(
                    "w-4 h-4 relative z-10 shrink-0",
                    active ? "text-emerald-400" : "text-zinc-500"
                  )}
                />
                <span className="relative z-10">{tab.label}</span>
                {active && (
                  <ChevronRight className="w-3.5 h-3.5 relative z-10 ml-auto text-emerald-400/60" />
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Content panel ── */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <ActiveContent />
            </motion.div>
          </AnimatePresence>
        </div>
        </div>
      </ProductLayout>
    </SettingsApiContext.Provider>
  );
}
