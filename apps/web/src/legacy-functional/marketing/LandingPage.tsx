import Link from "next/link";
import { Button, MetricCard } from "@leadvirt/ui";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "@/legacy-functional/leadvirt/BrandMark";
import { dashboardMetrics } from "@/features/mock/data";
import { CapabilitiesSection } from "./CapabilitiesSection";
import { CtaSection } from "./CtaSection";
import { HeroVisual } from "./HeroVisual";
import { NichesSection } from "./NichesSection";
import { PricingCards } from "./PricingCards";
import { WorkflowSection } from "./WorkflowSection";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-zinc-950/75 backdrop-blur-xl">
        <div className="container-page flex h-20 items-center justify-between">
          <Link href="/" aria-label="LeadVirt.ai home">
            <BrandMark />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
            <Link href="/demo" className="hover:text-zinc-100">Демо</Link>
            <a href="#features" className="hover:text-zinc-100">Возможности</a>
            <a href="#niches" className="hover:text-zinc-100">Решения</a>
            <a href="#workflow" className="hover:text-zinc-100">Сценарии</a>
            <Link href="/pricing" className="hover:text-zinc-100">Тарифы</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/onboarding">Попробовать</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="pt-28">
        <section className="container-page relative grid gap-12 py-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              AI-администратор для входящих заявок
            </div>
            <h1 className="text-5xl font-bold tracking-tight text-zinc-50 md:text-7xl">
              LeadVirt.ai превращает чаты в заявки, записи и продажи.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
              Отвечайте 24/7, квалифицируйте клиентов, готовьте записи и заказы, возвращайте диалоги в работу и передавайте менеджерам понятный контекст.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/onboarding">
                  Попробовать бесплатно <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/demo">Смотреть демо</Link>
              </Button>
            </div>
          </div>
          <HeroVisual />
        </section>

        <section className="border-y border-white/5 bg-zinc-900/30 py-8">
          <div className="container-page grid gap-3 sm:grid-cols-3">
            <div className="text-sm text-zinc-400"><strong className="text-zinc-50">18 сек</strong> среднее время ответа AI</div>
            <div className="text-sm text-zinc-400"><strong className="text-zinc-50">31,4%</strong> конверсия из диалога в лид</div>
            <div className="text-sm text-zinc-400"><strong className="text-zinc-50">24/7</strong> прием заявок и follow-up</div>
          </div>
        </section>

        <CapabilitiesSection />

        <section className="container-page py-10">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dashboardMetrics.slice(0, 3).map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>
        </section>

        <WorkflowSection />

        <NichesSection />

        <section className="container-page py-24" id="pricing">
          <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-5xl">Тарифы растут вместе с ценностью.</h2>
              <p className="mt-4 text-zinc-400">AI-диалоги, каналы, пользователи и сценарии масштабируются вместе с бизнесом.</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/pricing">Открыть тарифы</Link>
            </Button>
          </div>
          <PricingCards />
        </section>

        <CtaSection />
      </main>

      <footer className="border-t border-white/5 py-8">
        <div className="container-page flex flex-col justify-between gap-4 text-sm text-zinc-500 md:flex-row">
          <BrandMark compact />
          <p>© 2026 LeadVirt.ai. Все права защищены.</p>
        </div>
      </footer>
    </div>
  );
}
