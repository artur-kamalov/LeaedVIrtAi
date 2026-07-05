"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BarChart3,
  Bell,
  Bot,
  CalendarCheck,
  ChevronDown,
  CreditCard,
  Database,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Search,
  Settings,
  Sparkles,
  Workflow,
  X
} from "lucide-react";
import { useState } from "react";
import { Button, Card } from "@leadvirt/ui";
import { BrandMark } from "@/legacy-functional/leadvirt/BrandMark";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/app", label: "Обзор", mobileLabel: "Обзор", icon: LayoutDashboard },
  { href: "/app/inbox", label: "Входящие", mobileLabel: "Входящие", icon: Inbox },
  { href: "/app/leads", label: "Воронка / CRM", mobileLabel: "CRM", icon: KanbanSquare },
  { href: "/app/automations", label: "Автоматизация", mobileLabel: "Авто", icon: Workflow },
  { href: "/app/analytics", label: "Аналитика", mobileLabel: "Аналитика", icon: BarChart3 },
  { href: "/app/integrations", label: "Интеграции", mobileLabel: "Интеграции", icon: Plug },
  { href: "/app/settings", label: "Настройки", mobileLabel: "Настройки", icon: Settings },
  { href: "/app/billing", label: "Биллинг", mobileLabel: "Биллинг", icon: CreditCard }
];

const notifications = [
  {
    id: "n1",
    icon: Sparkles,
    color: "text-emerald-300",
    text: "AI квалифицировал нового лида: Анна Соколова",
    time: "2 мин назад",
    unread: true
  },
  {
    id: "n2",
    icon: CalendarCheck,
    color: "text-sky-300",
    text: "Создана запись: балаяж и стрижка, пятница 16:00",
    time: "18 мин назад",
    unread: true
  },
  {
    id: "n3",
    icon: Database,
    color: "text-teal-300",
    text: "Лид Игорь Лебедев отправлен в CRM",
    time: "1 ч назад",
    unread: false
  }
];

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 font-semibold text-zinc-950"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

function Sidebar({ navScope = "desktop", onNavigate }: { navScope?: string; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        className="flex h-20 items-center px-4"
        {...(onNavigate ? { onClick: onNavigate } : {})}
      >
        <BrandMark />
      </Link>
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              {...(onNavigate ? { onClick: onNavigate } : {})}
              className={cn(
                "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-zinc-50"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`app-shell-active-nav-${navScope}`}
                  className="absolute inset-0 rounded-xl border border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_24px_rgba(52,211,153,0.12)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <Icon className={cn("relative z-10 h-5 w-5", active && "text-emerald-300")} />
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3">
        <Card className="border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            AI активен
          </div>
          <p className="mb-3 text-xs text-zinc-400">Тариф «Бизнес» · 12 дней пробного периода.</p>
          <Button asChild size="sm" className="w-full">
            <Link href="/app/billing">Улучшить тариф</Link>
          </Button>
        </Card>
        <Link
          href="/app/settings"
          className="mt-3 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
          {...(onNavigate ? { onClick: onNavigate } : {})}
        >
          <Avatar name="Студия Glow" />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium text-zinc-100">Студия Glow</div>
            <div className="truncate text-xs text-zinc-500">admin@glow.ru</div>
          </div>
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </Link>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const springTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 38 };
  const pageTransition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" as const };
  const activePage =
    navItems.find((item) => pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href))) ??
    navItems[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/5 bg-zinc-950/75 backdrop-blur-xl lg:flex">
        <Sidebar navScope="desktop" />
      </aside>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={springTransition}
              className="relative h-full w-72 border-r border-white/5 bg-zinc-950 shadow-2xl shadow-black/40"
            >
              <button
                aria-label="Close menu"
                className="absolute right-4 top-6 rounded-full p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
              <Sidebar navScope="mobile-drawer" onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 h-16 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl lg:h-20">
          <div className="flex h-full items-center justify-between gap-4 px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <button className="rounded-lg p-1 text-zinc-400 lg:hidden" onClick={() => setMobileOpen(true)}>
                <Menu className="h-6 w-6" />
              </button>
              <span className="truncate text-lg font-bold tracking-tight text-zinc-50 lg:hidden">{activePage?.label}</span>
              <div className="hidden items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-2 text-sm text-zinc-500 md:flex md:w-80">
                <Search className="h-4 w-4" />
                <span>Поиск лидов, чатов...</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  aria-expanded={notificationsOpen}
                  aria-label="Уведомления"
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/5 bg-white/5 text-zinc-400 transition-colors hover:text-zinc-100"
                  type="button"
                  onClick={() => setNotificationsOpen((open) => !open)}
                >
                  <Bell className="h-5 w-5" />
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                </button>
                <AnimatePresence>
                  {notificationsOpen ? (
                    <motion.div
                      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
                      className="absolute right-0 top-12 z-50 w-[calc(100vw-2rem)] max-w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
                    >
                      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                        <span className="text-sm font-semibold text-zinc-100">Уведомления</span>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          2 новых
                        </span>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-1.5">
                        {notifications.map((notification) => {
                          const Icon = notification.icon;

                          return (
                            <Link
                              key={notification.id}
                              href="/app/inbox"
                              className="flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5"
                              onClick={() => setNotificationsOpen(false)}
                            >
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 ${notification.color}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm leading-snug text-zinc-200">{notification.text}</p>
                                <p className="mt-0.5 text-[11px] text-zinc-500">{notification.time}</p>
                              </div>
                              {notification.unread ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" /> : null}
                            </Link>
                          );
                        })}
                      </div>
                      <Link
                        href="/app/inbox"
                        className="block border-t border-white/8 py-3 text-center text-sm font-medium text-emerald-300 transition-colors hover:bg-white/5"
                        onClick={() => setNotificationsOpen(false)}
                      >
                        Открыть все
                      </Link>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
              <Button asChild size="sm">
                <Link href="/app/inbox">
                  <Bot className="h-4 w-4" />
                  Новый лид
                </Link>
              </Button>
              <Button asChild size="icon" variant="outline" className="hidden sm:inline-flex">
                <Link href="/login" aria-label="Выйти">
                  <LogOut className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
            transition={pageTransition}
            className="mx-auto max-w-[1500px] px-4 py-6 pb-24 lg:px-8 lg:pb-10"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-white/5 bg-zinc-950/95 backdrop-blur lg:hidden">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 overflow-hidden text-[10px] font-medium transition-colors",
                active ? "text-emerald-200" : "text-zinc-500"
              )}
            >
              {active ? (
                <motion.span
                  layoutId="app-shell-mobile-active"
                  className="absolute inset-x-3 top-2 bottom-2 rounded-xl bg-emerald-500/10"
                  transition={springTransition}
                />
              ) : null}
              <Icon className={cn("relative z-10 h-5 w-5", active && "text-emerald-300")} />
              <span className="relative z-10">{item.mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
