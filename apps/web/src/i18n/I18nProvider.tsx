"use client";

import React from "react";
import { updateLocalePreference } from "@/lib/api/settings";
import { intlLocale, localeCookieName, normalizeLocale, type Locale } from "./config";
import { messages, type TranslationKey, type TranslationValues } from "./messages";

type LocalePersistenceStatus = "idle" | "saving" | "error";

interface I18nState {
  locale: Locale;
  localeTag: string;
  setLocale: (locale: Locale) => void;
  persistLocale: (locale: Locale) => void;
  retryLocalePersistence: () => void;
  localePersistenceStatus: LocalePersistenceStatus;
  localePersistenceError: string | null;
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

function persistenceErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : null;
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  const [localePersistenceStatus, setLocalePersistenceStatus] =
    React.useState<LocalePersistenceStatus>("idle");
  const [localePersistenceError, setLocalePersistenceError] = React.useState<string | null>(null);
  const pendingLocale = React.useRef<Locale | null>(null);
  const inFlightLocale = React.useRef<Locale | null>(null);
  const failedLocale = React.useRef<Locale | null>(null);
  const mounted = React.useRef(true);
  const drainLocalePersistence = React.useRef<() => void>(() => undefined);
  const localeTag = intlLocale(locale);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale);
    setLocaleState(normalized);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${localeCookieName}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = normalized;
  }, []);

  drainLocalePersistence.current = () => {
    if (inFlightLocale.current || !pendingLocale.current) return;

    const targetLocale = pendingLocale.current;
    pendingLocale.current = null;
    inFlightLocale.current = targetLocale;
    setLocalePersistenceStatus("saving");
    setLocalePersistenceError(null);

    void updateLocalePreference(targetLocale)
      .then(() => {
        if (!mounted.current) return;
        failedLocale.current = null;
        if (!pendingLocale.current) {
          setLocalePersistenceStatus("idle");
          setLocalePersistenceError(null);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || pendingLocale.current) return;
        failedLocale.current = targetLocale;
        setLocalePersistenceStatus("error");
        setLocalePersistenceError(persistenceErrorMessage(error));
      })
      .finally(() => {
        inFlightLocale.current = null;
        if (mounted.current && pendingLocale.current) drainLocalePersistence.current();
      });
  };

  const persistLocale = React.useCallback((nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale);
    failedLocale.current = null;
    setLocalePersistenceError(null);

    if (inFlightLocale.current === normalized) {
      pendingLocale.current = null;
    } else {
      pendingLocale.current = normalized;
    }
    drainLocalePersistence.current();
  }, []);

  const retryLocalePersistence = React.useCallback(() => {
    const targetLocale = failedLocale.current;
    if (!targetLocale) return;
    failedLocale.current = null;
    pendingLocale.current = targetLocale;
    setLocalePersistenceError(null);
    drainLocalePersistence.current();
  }, []);

  const t = React.useCallback(
    (key: TranslationKey, values?: TranslationValues) => interpolate(messages[locale][key], values),
    [locale],
  );

  const formatNumber = React.useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(localeTag, options).format(value),
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
      new Intl.NumberFormat(localeTag, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value),
    [localeTag],
  );

  const state = React.useMemo<I18nState>(
    () => ({
      locale,
      localeTag,
      setLocale,
      persistLocale,
      retryLocalePersistence,
      localePersistenceStatus,
      localePersistenceError,
      t,
      formatNumber,
      formatDate,
      formatCurrency,
    }),
    [
      formatCurrency,
      formatDate,
      formatNumber,
      locale,
      localePersistenceError,
      localePersistenceStatus,
      localeTag,
      persistLocale,
      retryLocalePersistence,
      setLocale,
      t,
    ],
  );

  return <I18nContext.Provider value={state}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = React.useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
