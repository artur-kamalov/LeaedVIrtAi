import type { Metadata } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/i18n/I18nProvider";
import { localeCookieName, normalizeLocale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import "@/styles/globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(localeCookieName)?.value);
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"),
    title: "LeadVirt.ai",
    description: messages[locale]["meta.description"],
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(localeCookieName)?.value);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
