"use client";

import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Languages } from "lucide-react";
import { localeOptions, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "../lib/utils";

export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const [hydrated, setHydrated] = React.useState(false);
  const activeLocale = localeOptions.find((option) => option.value === locale) ?? localeOptions[0];

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="language-switcher"
          data-locale={locale}
          aria-label={t("language.label")}
          disabled={!hydrated}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-wait disabled:opacity-60",
            className,
          )}
        >
          <Languages className="h-4 w-4" aria-hidden="true" />
          <span lang={activeLocale.value} className="min-w-0 truncate text-xs font-semibold">
            {compact ? activeLocale.shortLabel : activeLocale.label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[120] min-w-[220px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-white/10 bg-zinc-900 p-1.5 text-zinc-100 shadow-2xl shadow-black/50 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-normal text-zinc-500">
            {t("language.label")}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            {localeOptions.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                data-testid={`language-option-${option.value}`}
                className="relative flex h-10 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 outline-none transition-colors data-[highlighted]:bg-white/[0.07] data-[state=checked]:bg-emerald-400/10"
              >
                <span className="inline-flex h-6 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-[10px] font-bold text-zinc-400">
                  {option.shortLabel}
                </span>
                <span lang={option.value} className="flex-1 text-sm font-medium text-zinc-200">
                  {option.label}
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
