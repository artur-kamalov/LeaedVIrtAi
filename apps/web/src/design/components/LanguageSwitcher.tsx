"use client";

import React from "react";
import { Languages } from "lucide-react";
import { localeOptions, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "../lib/utils";

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <label
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100",
        className,
      )}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        data-testid="language-switcher"
        aria-label={t("language.label")}
        value={locale}
        disabled={!hydrated}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="min-w-0 cursor-pointer appearance-none bg-transparent text-xs font-semibold outline-none disabled:cursor-wait"
      >
        {localeOptions.map((option) => (
          <option key={option.value} value={option.value} className="bg-zinc-900 text-zinc-100">
            {compact ? option.shortLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
