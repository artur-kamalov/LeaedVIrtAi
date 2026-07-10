"use client";

import React from "react";
import { intlLocale, localeCookieName, normalizeLocale, type Locale } from "./config";
import { messages, type TranslationKey, type TranslationValues } from "./messages";

interface I18nState {
  locale: Locale;
  localeTag: string;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
}

const I18nContext = React.createContext<I18nState | null>(null);

function interpolate(message: string, values?: TranslationValues) {
  if (!values) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  const localeTag = intlLocale(locale);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale);
    setLocaleState(normalized);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${localeCookieName}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = normalized;
  }, []);

  const t = React.useCallback(
    (key: TranslationKey, values?: TranslationValues) => interpolate(messages[locale][key], values),
    [locale],
  );

  const formatNumber = React.useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(localeTag, options).format(value),
    [localeTag],
  );

  const formatDate = React.useCallback(
    (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
      const date = value instanceof Date ? value : new Date(value);
      return new Intl.DateTimeFormat(localeTag, options).format(date);
    },
    [localeTag],
  );

  const formatCurrency = React.useCallback(
    (value: number, currency = "RUB") =>
      new Intl.NumberFormat(localeTag, { style: "currency", currency, maximumFractionDigits: 0 }).format(value),
    [localeTag],
  );

  const state = React.useMemo<I18nState>(
    () => ({ locale, localeTag, setLocale, t, formatNumber, formatDate, formatCurrency }),
    [formatCurrency, formatDate, formatNumber, locale, localeTag, setLocale, t],
  );

  return <I18nContext.Provider value={state}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = React.useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
