import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  LayoutDashboard,
  Inbox,
  KanbanSquare,
  Workflow,
  BarChart3,
  Plug,
  Settings,
  Search,
  Bell,
  Plus,
  ChevronLeft,
  Menu,
  X,
  Sun,
  Moon,
  Database,
  CalendarCheck,
  Sparkles,
  UserCircle,
  CreditCard,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "../lib/utils";
import { useNav, type Route } from "./nav";
import { useTheme } from "./theme";
import { Avatar } from "./shared";
import { Button } from "../components/ui/Button";
import { TooltipProvider, Tip, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "./ui";

const notifications: { id: string; icon: LucideIcon; color: string; text: string; time: string; unread: boolean }[] = [
  { id: "n1", icon: Sparkles, color: "text-emerald-400", text: "AI квалифицировал нового лида: Анна Соколова", time: "2 мин назад", unread: true },
  { id: "n2", icon: CalendarCheck, color: "text-sky-400", text: "Создана запись: Балаяж + стрижка, пт 16:00", time: "18 мин назад", unread: true },
  { id: "n3", icon: Database, color: "text-teal-400", text: "Лид Павел Громов отправлен в amoCRM", time: "1 ч назад", unread: false },
];

const navItems: { id: Route; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "pipeline", label: "Воронка / CRM", icon: KanbanSquare },
  { id: "automation", label: "Автоматизация", icon: Workflow },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "integrations", label: "Интеграции", icon: Plug },
  { id: "settings", label: "Настройки", icon: Settings },
];

const mobileNav: { id: Route; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Чаты", icon: Inbox },
  { id: "pipeline", label: "Воронка", icon: KanbanSquare },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "settings", label: "Ещё", icon: Settings },
];

function NavLink({ item, active, onClick }: { item: typeof navItems[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
      )}
    >
      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <Icon className={cn("w-5 h-5 relative z-10", active && "text-emerald-400")} />
      <span className="relative z-10">{item.label}</span>
    </button>
  );
}

export function ProductLayout({
  title,
  children,
  contentClassName,
}: {
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const { route, go } = useNav();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const sidebar = (
    <div className="flex flex-col h-full">
      <button onClick={() => go("landing")} className="flex items-center gap-2 px-3 h-20 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
          <Bot className="w-5 h-5 text-zinc-950" />
        </div>
        <span className="text-lg font-bold tracking-tight">AI Администратор</span>
      </button>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            active={route === item.id}
            onClick={() => {
              go(item.id);
              setMobileOpen(false);
            }}
          />
        ))}
      </nav>

      <div className="p-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/5 border border-emerald-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-emerald-300">AI активен</span>
          </div>
          <p className="text-xs text-zinc-400 mb-3">Тариф «Бизнес» · 12 дней пробного периода</p>
          <Button size="sm" className="w-full" onClick={() => go("settings")}>Улучшить тариф</Button>
        </div>

        <Dropdown
          align="start"
          trigger={
            <button className="mt-3 w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 transition-colors">
              <Avatar name="Студия Glow" size={36} />
              <div className="text-left min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-100 truncate">Студия Glow</div>
                <div className="text-xs text-zinc-500 truncate">admin@glow.ru</div>
              </div>
              <ChevronDown className="w-4 h-4 text-zinc-500" />
            </button>
          }
        >
          <DropdownLabel>Аккаунт</DropdownLabel>
          <DropdownItem icon={UserCircle} onClick={() => go("settings")}>Профиль компании</DropdownItem>
          <DropdownItem icon={CreditCard} onClick={() => go("settings")}>Биллинг и тариф</DropdownItem>
          <DropdownItem icon={Settings} onClick={() => go("settings")}>Настройки</DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={LogOut} danger onClick={() => go("landing")}>Выйти</DropdownItem>
        </Dropdown>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
    <div className={cn("min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30 selection:text-emerald-200", theme === "light" && "theme-light")}>
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!rounded-2xl !border !border-white/10 !bg-zinc-900 !text-zinc-100 !shadow-2xl",
            description: "!text-zinc-400",
            actionButton: "!bg-emerald-400 !text-zinc-950",
            cancelButton: "!bg-white/10 !text-zinc-300",
          },
        }}
      />
      {/* ambient bg */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        <div className="absolute top-[-10%] right-[5%] w-[40rem] h-[40rem] bg-emerald-500/5 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[10%] w-[40rem] h-[40rem] bg-indigo-500/5 blur-[150px] rounded-full" />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 border-r border-white/5 bg-zinc-950/70 backdrop-blur-xl z-40">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.aside
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 400, damping: 38 }}
              className="lg:hidden fixed inset-y-0 left-0 w-72 border-r border-white/5 bg-zinc-950 z-50"
            >
              <button onClick={() => setMobileOpen(false)} className="absolute top-6 right-4 text-zinc-400 z-10">
                <X className="w-5 h-5" />
              </button>
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="lg:pl-64 relative z-10">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-16 lg:h-20 border-b border-white/5 bg-zinc-950/60 backdrop-blur-xl">
          <div className="h-full px-4 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button className="lg:hidden text-zinc-400" onClick={() => setMobileOpen(true)}>
                <Menu className="w-6 h-6" />
              </button>
              <h1 className="text-lg lg:text-2xl font-bold tracking-tight truncate">{title}</h1>
            </div>

            <div className="flex items-center gap-2 lg:gap-3">
              <div className="hidden md:flex items-center gap-2 rounded-full bg-white/5 border border-white/5 px-3 h-10 w-64">
                <Search className="w-4 h-4 text-zinc-500" />
                <input
                  placeholder="Поиск лидов, чатов..."
                  className="bg-transparent text-sm outline-none placeholder:text-zinc-600 w-full"
                />
              </div>
              <Tip content={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
                <button
                  onClick={toggle}
                  aria-label="Переключить тему"
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-emerald-400 transition-colors"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {theme === "dark" ? (
                      <motion.span key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <Sun className="w-5 h-5" />
                      </motion.span>
                    ) : (
                      <motion.span key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <Moon className="w-5 h-5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </Tip>

              <Dropdown
                className="w-[340px] p-0 overflow-hidden"
                trigger={
                  <button aria-label="Уведомления" className="relative w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  </button>
                }
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                  <span className="text-sm font-semibold text-zinc-100">Уведомления</span>
                  <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">2 новых</span>
                </div>
                <div className="max-h-80 overflow-y-auto p-1.5">
                  {notifications.map((n) => {
                    const NIcon = n.icon;
                    return (
                      <div key={n.id} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className={cn("w-8 h-8 shrink-0 rounded-lg bg-white/5 flex items-center justify-center", n.color)}>
                          <NIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-200 leading-snug">{n.text}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">{n.time}</p>
                        </div>
                        {n.unread && <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-emerald-400" />}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => go("inbox")} className="w-full text-center text-sm font-medium text-emerald-400 hover:bg-white/5 py-3 border-t border-white/8 transition-colors">
                  Открыть все
                </button>
              </Dropdown>
              <Button size="sm" className="hidden sm:inline-flex" onClick={() => go("inbox")}>
                <Plus className="w-4 h-4 mr-1.5" /> Новый лид
              </Button>
            </div>
          </div>
        </header>

        <main className={cn("px-4 lg:px-8 py-6 pb-28 lg:pb-10 max-w-[1500px] mx-auto", contentClassName)}>
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/5 bg-zinc-950/90 backdrop-blur-xl">
        <div className="grid grid-cols-5 h-16">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className={cn("flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors", active ? "text-emerald-400" : "text-zinc-500")}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
    </TooltipProvider>
  );
}

/* Back button for sub-pages */
export function BackButton({ to, label }: { to: Route; label: string }) {
  const { go } = useNav();
  return (
    <button onClick={() => go(to)} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-4">
      <ChevronLeft className="w-4 h-4" /> {label}
    </button>
  );
}
