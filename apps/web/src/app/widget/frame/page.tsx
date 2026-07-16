import { cookies } from "next/headers";
import { LeadVirtWidget } from "@/components/widget/LeadVirtWidget";
import { localeCookieName } from "@/i18n/config";
import { normalizeWidgetLocale, widgetMessage } from "@/i18n/widget-messages";

type WidgetFramePageProps = {
  searchParams: Promise<{
    key?: string;
  }>;
};

export default async function WidgetFramePage({ searchParams }: WidgetFramePageProps) {
  const params = await searchParams;
  const publicKey = params.key?.trim();
  const cookieStore = await cookies();
  const locale = normalizeWidgetLocale(cookieStore.get(localeCookieName)?.value);

  return (
    <main className="min-h-screen bg-transparent" data-leadvirt-frame="true">
      <style>{`
        html,
        body {
          background: transparent !important;
        }
      `}</style>
      {publicKey ? (
        <LeadVirtWidget publicKey={publicKey} embedded />
      ) : (
        <div
          lang={locale}
          data-testid="widget-missing-key"
          data-widget-locale={locale}
          className="pointer-events-auto fixed bottom-4 left-4 right-4 max-w-[320px] rounded-lg border border-rose-400/25 bg-zinc-950/95 p-4 text-sm text-rose-100 shadow-2xl shadow-black/40 sm:left-auto"
        >
          <p className="break-words font-semibold">
            {widgetMessage(locale, "widget.frame.missing.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-rose-100/70">
            {widgetMessage(locale, "widget.frame.missing.detail")}
          </p>
        </div>
      )}
    </main>
  );
}
