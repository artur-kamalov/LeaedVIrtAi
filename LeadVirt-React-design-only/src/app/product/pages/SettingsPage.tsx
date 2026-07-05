import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
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

/* ============================================================
   Tab contents
   ============================================================ */

function ProfileTab() {
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    toast.success("Изменения сохранены");
    setTimeout(() => setSaved(false), 2000);
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
          <Avatar name="Студия Glow" size={64} />
          <div>
            <p className="text-sm font-semibold text-zinc-200 mb-1">
              Логотип компании
            </p>
            <p className="text-xs text-zinc-500 mb-3">
              PNG, JPG до 5 МБ · рекомендуется 256×256
            </p>
            <Button size="sm" variant="outline">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Загрузить
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Название компании">
            <Input defaultValue="Студия Glow" placeholder="Введите название" />
          </Field>

          <Field label="Сфера деятельности">
            <Select defaultValue="beauty">
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
            <Select defaultValue="msk">
              <option value="msk">Москва (UTC+3)</option>
              <option value="spb">Санкт-Петербург (UTC+3)</option>
              <option value="ekb">Екатеринбург (UTC+5)</option>
              <option value="nsk">Новосибирск (UTC+7)</option>
              <option value="vlk">Владивосток (UTC+10)</option>
            </Select>
          </Field>

          <Field label="Телефон">
            <Input
              defaultValue="+7 (495) 123-45-67"
              placeholder="+7 (___) ___-__-__"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Контактный email">
            <Input
              type="email"
              defaultValue="admin@glow.ru"
              placeholder="email@компания.ru"
            />
          </Field>

          <Field label="Сайт">
            <Input
              defaultValue="https://glow-studio.ru"
              placeholder="https://"
            />
          </Field>
        </div>

        <div className="pt-2 flex justify-end">
          <Button onClick={handleSave} className="gap-2">
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
                  Сохранить изменения
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </Card>
    </div>
  );
}

const teamMembers = [
  {
    name: "Мария Климова",
    email: "m.klimova@glow.ru",
    role: "Администратор",
    roleColor: "bg-emerald-500/15 text-emerald-300",
    online: true,
  },
  {
    name: "Игорь Петров",
    email: "i.petrov@glow.ru",
    role: "Менеджер",
    roleColor: "bg-indigo-500/15 text-indigo-300",
    online: true,
  },
  {
    name: "Анна Лис",
    email: "a.lis@glow.ru",
    role: "Оператор",
    roleColor: "bg-amber-500/15 text-amber-300",
    online: false,
  },
  {
    name: "Дмитрий Волков",
    email: "d.volkov@glow.ru",
    role: "Оператор",
    roleColor: "bg-amber-500/15 text-amber-300",
    online: false,
  },
];

function TeamTab() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const openDeleteConfirm = (name: string) => {
    setDeleteTarget(name);
    setConfirmDelete(true);
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
        {teamMembers.map((member) => (
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
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <DropdownItem
                icon={UserCog}
                onClick={() =>
                  toast("Изменение роли", {
                    description: `Выберите новую роль для ${member.name}`,
                  })
                }
              >
                Изменить роль
              </DropdownItem>
              <DropdownItem
                icon={KeyRound}
                onClick={() =>
                  toast.success("Письмо со сбросом пароля отправлено", {
                    description: member.email,
                  })
                }
              >
                Сбросить пароль
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                danger
                icon={UserX}
                onClick={() => openDeleteConfirm(member.name)}
              >
                Удалить участника
              </DropdownItem>
            </Dropdown>
          </div>
        ))}
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => toast.success("Приглашение отправлено")}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Пригласить участника
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить участника?"
        description={`${deleteTarget ?? "Участник"} потеряет доступ к платформе. Это действие нельзя отменить.`}
        danger
        confirmLabel="Удалить"
        onConfirm={() => {
          toast.success("Участник удалён");
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

const channelEntries = Object.entries(channels) as [
  keyof typeof channels,
  (typeof channels)[keyof typeof channels]
][];

function ChannelsTab() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    instagram: true,
    whatsapp: true,
    telegram: true,
    website: false,
    vk: false,
    email: true,
    call: false,
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Каналы коммуникации"
        description="Подключите каналы, по которым AI будет принимать обращения"
      />

      <Card className="divide-y divide-white/5">
        {channelEntries.map(([id, ch]) => {
          const Icon = ch.icon;
          const isOn = enabled[id];
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
                  {ch.label}
                </p>
                <p className="text-xs text-zinc-500">
                  {isOn ? (
                    <span className="text-emerald-400">● Подключён</span>
                  ) : (
                    "Не подключён"
                  )}
                </p>
              </div>

              <button className="hidden sm:inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-400 transition-colors mr-2">
                Настроить
                <ExternalLink className="w-3 h-3" />
              </button>

              <Toggle
                checked={isOn}
                onChange={(v) => setEnabled((prev) => ({ ...prev, [id]: v }))}
              />
            </div>
          );
        })}
      </Card>
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
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    new_lead: true,
    no_reply: true,
    booking: true,
    daily: false,
    tg_summary: true,
  });

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
              onChange={(v) => {
                setToggles((prev) => ({ ...prev, [item.id]: v }));
                toast("Настройка обновлена");
              }}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

function BillingTab() {
  const [planModalOpen, setPlanModalOpen] = useState(false);

  const usageItems = [
    { label: "Лиды обработано", used: 1248, total: 2000 },
    { label: "Активные каналы", used: 6, total: 10 },
    { label: "Участники команды", used: 4, total: 10 },
    { label: "Автоматизаций", used: 12, total: 25 },
  ];

  const invoices = [
    { date: "01.06.2025", amount: "4 900 ₽", status: "Оплачен" },
    { date: "01.05.2025", amount: "4 900 ₽", status: "Оплачен" },
    { date: "01.04.2025", amount: "4 900 ₽", status: "Оплачен" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Биллинг и подписка"
        description="Управляйте тарифом и способом оплаты"
      />

      {/* Plan card */}
      <div className="relative rounded-3xl p-px overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/40 via-teal-500/20 to-transparent" />
        <div className="relative rounded-[calc(1.5rem-1px)] bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Pill className="bg-emerald-500/15 text-emerald-300 mb-3 text-xs">
                Текущий тариф
              </Pill>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-50">
                Тариф «Бизнес»
              </h3>
              <p className="text-zinc-400 text-sm mt-1">
                Следующее списание — 1 июля 2025
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-zinc-50 tracking-tight">
                4 900 ₽
              </p>
              <p className="text-xs text-zinc-500">в месяц</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {usageItems.map((item) => {
              const pct = Math.round((item.used / item.total) * 100);
              return (
                <div key={item.label}>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                    <span>{item.label}</span>
                    <span className="text-zinc-300 font-medium">
                      {item.used.toLocaleString("ru")}{" "}
                      <span className="text-zinc-500">
                        / {item.total.toLocaleString("ru")}
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
            <Button variant="outline">Отменить подписку</Button>
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
          {plans.map((plan) => (
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
                variant={plan.popular ? "default" : "outline"}
                className="mt-auto"
                onClick={() => {
                  toast.success(`Тариф «${plan.name}» активирован`);
                  setPlanModalOpen(false);
                }}
              >
                Выбрать
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      {/* Payment method */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Способ оплаты
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-100">
                •••• •••• •••• 4242
              </p>
              <p className="text-xs text-zinc-500">Visa · Истекает 09/27</p>
            </div>
          </div>
          <Button size="sm" variant="outline">
            Изменить
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
                <p className="text-xs text-zinc-500">Тариф «Бизнес»</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-zinc-100">
                  {inv.amount}
                </span>
                <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                  {inv.status}
                </Pill>
                <Tip content="Скачать счёт">
                  <button className="text-zinc-500 hover:text-zinc-200 transition-colors">
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

function SecurityTab() {
  const [showPass, setShowPass] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const sessions = [
    {
      device: "MacBook Pro",
      icon: Monitor,
      location: "Москва, RU",
      time: "Сейчас",
      current: true,
    },
    {
      device: "iPhone 15 Pro",
      icon: Smartphone,
      location: "Москва, RU",
      time: "2 часа назад",
      current: false,
    },
    {
      device: "Chrome · Windows",
      icon: Globe,
      location: "Санкт-Петербург, RU",
      time: "Вчера",
      current: false,
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Безопасность"
        description="Защита вашего аккаунта и управление сессиями"
      />

      {/* Change password */}
      <Card className="p-6 space-y-5">
        <p className="text-sm font-bold text-zinc-200 tracking-tight">
          Изменить пароль
        </p>
        <Field label="Текущий пароль">
          <div className="relative">
            <Input
              type={showPass ? "text" : "password"}
              placeholder="••••••••"
              className="pr-10"
            />
            <Tip content={showPass ? "Скрыть пароль" : "Показать пароль"}>
              <button
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
            <Input type="password" placeholder="••••••••" />
          </Field>
          <Field label="Повторите пароль">
            <Input type="password" placeholder="••••••••" />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => toast.success("Пароль успешно обновлён")}>
            Обновить пароль
          </Button>
        </div>
      </Card>

      {/* 2FA */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              Двухфакторная аутентификация
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Дополнительная защита через приложение-аутентификатор
            </p>
          </div>
          <Toggle
            checked={twoFA}
            onChange={(v) => {
              setTwoFA(v);
              toast(v ? "2FA включена" : "2FA отключена");
            }}
          />
        </div>
        <AnimatePresence>
          {twoFA && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  2FA активна · приложение Google Authenticator
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Sessions */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Активные сессии
        </p>
        <div className="space-y-3">
          {sessions.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.device}
                className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
              >
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-200">
                      {s.device}
                    </p>
                    {s.current && (
                      <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                        Текущая
                      </Pill>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {s.location} · {s.time}
                  </p>
                </div>
                {!s.current && (
                  <Tip content="Завершить сессию">
                    <button
                      onClick={() =>
                        toast("Сессия завершена", { description: s.device })
                      }
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
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut className="w-4 h-4" />
            Выйти на всех устройствах
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Выйти на всех устройствах?"
        description="Все активные сессии будут завершены. Вам потребуется войти заново."
        danger
        confirmLabel="Выйти везде"
        onConfirm={() => toast.success("Выход выполнен на всех устройствах")}
      />
    </div>
  );
}

const apiKeys = [
  {
    id: "key_1",
    name: "Производство",
    key: "sk-live-••••••••••••••••••••••••••••••••3f7a",
    created: "12 мар 2025",
    last: "Сегодня",
  },
  {
    id: "key_2",
    name: "Тестирование",
    key: "sk-test-••••••••••••••••••••••••••••••••9c2b",
    created: "28 фев 2025",
    last: "3 дня назад",
  },
  {
    id: "key_3",
    name: "Интеграция CRM",
    key: "sk-live-••••••••••••••••••••••••••••••••1d4e",
    created: "1 янв 2025",
    last: "Неделю назад",
  },
];

function ApiKeysTab() {
  const [copied, setCopied] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const handleCopy = (id: string) => {
    setCopied(id);
    toast("Скопировано");
    setTimeout(() => setCopied(null), 1500);
  };

  const openRevoke = (id: string) => {
    setRevokeTarget(id);
    setConfirmRevoke(true);
  };

  const targetKey = apiKeys.find((k) => k.id === revokeTarget);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="API ключи"
        description="Используйте ключи для интеграции с внешними сервисами"
      />

      <Card className="divide-y divide-white/5">
        {apiKeys.map((k) => (
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

      <div className="flex justify-end">
        <Button onClick={() => toast.success("Ключ создан")}>
          <Plus className="w-4 h-4 mr-1.5" />
          Создать ключ
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
        confirmLabel="Отозвать"
        onConfirm={() => {
          toast.success("Ключ отозван");
          setRevokeTarget(null);
        }}
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

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const ActiveContent = tabContentMap[activeTab];

  return (
    <ProductLayout title="Настройки">
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
  );
}
