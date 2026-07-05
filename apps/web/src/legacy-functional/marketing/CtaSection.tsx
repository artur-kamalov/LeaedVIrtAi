import Link from "next/link";
import { Button } from "@leadvirt/ui";

export function CtaSection() {
  return (
    <section id="cta" className="container-page relative py-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-emerald-900/16 to-transparent blur-3xl" />
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-900 p-10 text-center shadow-2xl shadow-black/30 md:p-16">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:32px_32px] opacity-50" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/88 to-zinc-900/40" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-80 w-80 rounded-full bg-emerald-500/20 blur-[100px]" />

        <div className="relative z-10">
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50 md:text-6xl">
            Не теряйте клиентов, пока команда занята
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
            Подключите LeadVirt.ai и начните превращать каждое входящее сообщение в понятную заявку.
          </p>
          <Button asChild size="lg" className="mt-9 w-full shadow-[0_0_40px_rgba(52,211,153,0.24)] sm:w-auto">
            <Link href="/onboarding">Подключить AI-администратора</Link>
          </Button>
          <p className="mt-5 text-sm text-zinc-500">Бесплатный тестовый период 7 дней. Привязка карты не требуется.</p>
        </div>
      </div>
    </section>
  );
}
