import { LeadVirtWidget } from "@/components/widget/LeadVirtWidget";

type WidgetFramePageProps = {
  searchParams: Promise<{
    key?: string;
  }>;
};

export default async function WidgetFramePage({ searchParams }: WidgetFramePageProps) {
  const params = await searchParams;
  const publicKey = params.key?.trim();

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
        <div className="pointer-events-auto fixed bottom-4 right-4 max-w-[320px] rounded-2xl border border-rose-400/25 bg-zinc-950/95 p-4 text-sm text-rose-100 shadow-2xl shadow-black/40">
          <p className="font-semibold">LeadVirt widget key is required</p>
          <p className="mt-1 text-xs leading-5 text-rose-100/70">
            Add `data-leadvirt-key` to the embed script or pass `?key=...` to the frame URL.
          </p>
        </div>
      )}
    </main>
  );
}
