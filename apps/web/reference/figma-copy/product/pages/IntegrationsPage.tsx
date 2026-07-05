import React, { useState } from "react";
import {
  Send,
  MessageCircle,
  Instagram,
  Mail,
  Calendar,
  ShoppingBag,
  Webhook,
  Database,
  Layers,
  Store,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Settings,
  RefreshCw,
  Plug,
  LogOut,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle, Pill } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  ConfirmDialog,
  Tip,
  EmptyState,
} from "../ui";

/* ============================================================
   Data
   ============================================================ */
type Category = "CRM" | "Каналы" | "Календарь" | "E-commerce" | "Разработчикам";

interface Integration {
  id: string;
  name: string;
  category: Category;
  description: string;
  icon: React.ElementType;
  accentColor: string;
  accentBg: string;
  connected: boolean;
}

const INTEGRATIONS: Integration[] = [
  {
    id: "amocrm",
    name: "amoCRM",
    category: "CRM",
    description: "Передача сделок и контактов",
    icon: Database,
    accentColor: "text-violet-400",
    accentBg: "bg-violet-500/15",
    connected: true,
  },
  {
    id: "bitrix24",
    name: "Bitrix24",
    category: "CRM",
    description: "Синхронизация лидов и задач",
    icon: Layers,
    accentColor: "text-blue-400",
    accentBg: "bg-blue-500/15",
    connected: true,
  },
  {
    id: "retailcrm",
    name: "RetailCRM",
    category: "CRM",
    description: "Заказы для интернет-магазина",
    icon: Store,
    accentColor: "text-orange-400",
    accentBg: "bg-orange-500/15",
    connected: false,
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "Каналы",
    description: "Автоматические ответы в чатах и каналах",
    icon: Send,
    accentColor: "text-sky-400",
    accentBg: "bg-sky-500/15",
    connected: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "Каналы",
    description: "Обработка входящих сообщений и уведомления",
    icon: MessageCircle,
    accentColor: "text-emerald-400",
    accentBg: "bg-emerald-500/15",
    connected: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "Каналы",
    description: "Директ и комментарии под постами",
    icon: Instagram,
    accentColor: "text-pink-400",
    accentBg: "bg-pink-500/15",
    connected: true,
  },
  {
    id: "vk",
    name: "VK",
    category: "Каналы",
    description: "Сообщения и заявки из сообщества ВКонтакте",
    icon: MessageCircle,
    accentColor: "text-indigo-400",
    accentBg: "bg-indigo-500/15",
    connected: false,
  },
  {
    id: "email",
    name: "Email",
    category: "Каналы",
    description: "Входящие письма превращаются в задачи",
    icon: Mail,
    accentColor: "text-amber-400",
    accentBg: "bg-amber-500/15",
    connected: true,
  },
  {
    id: "gcalendar",
    name: "Google Calendar",
    category: "Календарь",
    description: "Запись клиентов и синхронизация расписания",
    icon: Calendar,
    accentColor: "text-teal-400",
    accentBg: "bg-teal-500/15",
    connected: true,
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "E-commerce",
    description: "Заказы и статусы доставки в одном месте",
    icon: ShoppingBag,
    accentColor: "text-lime-400",
    accentBg: "bg-lime-500/15",
    connected: false,
  },
  {
    id: "webhook",
    name: "Webhook / API",
    category: "Разработчикам",
    description: "Гибкая интеграция с любым сервисом через HTTP",
    icon: Webhook,
    accentColor: "text-rose-400",
    accentBg: "bg-rose-500/15",
    connected: false,
  },
];

const CATEGORIES: ("Все" | Category)[] = [
  "Все",
  "CRM",
  "Каналы",
  "Календарь",
  "E-commerce",
  "Разработчикам",
];

const FAKE_API_KEY = "sk-admin-••••••••••••••••••••••••••••••••";
const FAKE_WEBHOOK = "https://api.ai-admin.ru/webhook/v1/abc123xyz";

/* ============================================================
   Integration Card
   ============================================================ */
function IntegrationCard({
  integration,
  connected,
  onToggle,
  onDisconnect,
  index,
}: {
  integration: Integration;
  connected: boolean;
  onToggle: () => void;
  onDisconnect: () => void;
  index: number;
}) {
  const Icon = integration.icon;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
        whileHover={{ y: -4 }}
        className="group"
      >
        <div
          className={cn(
            "relative rounded-2xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm p-5 flex flex-col gap-4 h-full",
            "transition-all duration-300",
            "hover:border-white/10 hover:bg-zinc-900/80",
            connected && "hover:shadow-[0_0_24px_-6px] hover:shadow-emerald-500/20"
          )}
        >
          {/* Glow blob */}
          <div
            className={cn(
              "absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500",
              integration.accentBg
            )}
          />

          {/* Header row */}
          <div className="flex items-start justify-between gap-3 relative">
            <div
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                integration.accentBg
              )}
            >
              <Icon className={cn("w-6 h-6", integration.accentColor)} />
            </div>
            <Pill
              className={cn(
                "text-[11px] shrink-0",
                "bg-white/5 text-zinc-400 border border-white/5"
              )}
            >
              {integration.category}
            </Pill>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 flex-1 relative">
            <span className="text-sm font-bold text-zinc-100 tracking-tight">
              {integration.name}
            </span>
            <span className="text-xs text-zinc-500 leading-relaxed">
              {integration.description}
            </span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 relative">
            {connected ? (
              <>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Подключено
                </span>
                <Dropdown
                  trigger={
                    <Button variant="outline" size="sm" className="h-8 px-3 text-xs rounded-full">
                      Настроить
                    </Button>
                  }
                >
                  <DropdownItem
                    icon={Settings}
                    onClick={() => toast("Открываю настройки...")}
                  >
                    Настроить
                  </DropdownItem>
                  <DropdownItem
                    icon={RefreshCw}
                    onClick={() => toast.success("Синхронизация запущена")}
                  >
                    Синхронизировать
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem
                    icon={LogOut}
                    onClick={() => setConfirmOpen(true)}
                    danger
                  >
                    Отключить
                  </DropdownItem>
                </Dropdown>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-4 text-xs rounded-full w-full"
                onClick={onToggle}
              >
                <Zap className="w-3 h-3 mr-1.5" />
                Подключить
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Отключить интеграцию?"
        description={`${integration.name} будет отключён. Вы сможете подключить его снова в любое время.`}
        danger
        confirmLabel="Отключить"
        onConfirm={() => {
          onDisconnect();
          toast.success(`${integration.name} отключён`);
        }}
      />
    </>
  );
}

/* ============================================================
   API Card
   ============================================================ */
function ApiCard() {
  const [copied, setCopied] = useState<"key" | "webhook" | null>(null);

  function handleCopy(type: "key" | "webhook", value: string) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
    >
      <Card className="p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
                API ключ
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-800/60 border border-white/5 px-4 py-2.5">
                <span className="flex-1 text-sm font-mono text-zinc-300 truncate">
                  {FAKE_API_KEY}
                </span>
                <button
                  onClick={() => handleCopy("key", FAKE_API_KEY)}
                  className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                  title="Скопировать"
                >
                  {copied === "key" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
                Webhook URL
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-800/60 border border-white/5 px-4 py-2.5">
                <span className="flex-1 text-sm font-mono text-zinc-300 truncate">
                  {FAKE_WEBHOOK}
                </span>
                <button
                  onClick={() => handleCopy("webhook", FAKE_WEBHOOK)}
                  className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                  title="Скопировать"
                >
                  {copied === "webhook" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:pt-6 md:shrink-0">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="w-4 h-4" />
              Документация API
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/* ============================================================
   Page
   ============================================================ */
export function IntegrationsPage() {
  const [activeCategory, setActiveCategory] = useState<"Все" | Category>("Все");
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(INTEGRATIONS.map((i) => [i.id, i.connected]))
  );

  function toggleConnection(id: string) {
    setConnectedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const totalConnected = Object.values(connectedMap).filter(Boolean).length;
  const totalAvailable = INTEGRATIONS.length;
  const channelsActive = INTEGRATIONS.filter(
    (i) => i.category === "Каналы" && connectedMap[i.id]
  ).length;

  const filtered =
    activeCategory === "Все"
      ? INTEGRATIONS
      : INTEGRATIONS.filter((i) => i.category === activeCategory);

  return (
    <ProductLayout title="Интеграции">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50 mb-1">
            Интеграции
          </h1>
          <p className="text-sm text-zinc-400 max-w-xl">
            Подключите каналы и сервисы — AI Администратор будет работать со всеми вашими источниками заявок.
          </p>
        </motion.div>

        {/* Stat chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-wrap gap-3"
        >
          {[
            {
              label: "Подключено",
              value: totalConnected,
              color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
            },
            {
              label: "Доступно",
              value: totalAvailable,
              color: "text-zinc-300 bg-white/5 border-white/5",
            },
            {
              label: "Каналов активно",
              value: channelsActive,
              color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium",
                color
              )}
            >
              <span className="text-base font-bold">{value}</span>
              <span className="text-xs opacity-80">{label}</span>
            </div>
          ))}
        </motion.div>

        {/* Category filter */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="flex flex-wrap gap-2"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-200",
                activeCategory === cat
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/[0.03] border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
              )}
            >
              {cat}
            </button>
          ))}
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((integration, i) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              connected={connectedMap[integration.id]}
              onToggle={() => toggleConnection(integration.id)}
              index={i}
            />
          ))}
        </div>

        {/* API / Webhook section */}
        <div>
          <SectionTitle
            title="API ключи / Webhook"
            sub="Используйте для прямой интеграции с вашими сервисами"
          />
          <ApiCard />
        </div>
      </div>
    </ProductLayout>
  );
}
