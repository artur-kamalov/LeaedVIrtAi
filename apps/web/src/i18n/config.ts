export const supportedLocales = ["en", "es", "fr", "de", "pt", "ru"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "leadvirt-locale";

export const localeOptions: ReadonlyArray<{ value: Locale; shortLabel: string; label: string }> = [
  { value: "en", shortLabel: "EN", label: "English" },
  { value: "es", shortLabel: "ES", label: "Español" },
  { value: "fr", shortLabel: "FR", label: "Français" },
  { value: "de", shortLabel: "DE", label: "Deutsch" },
  { value: "pt", shortLabel: "PT", label: "Português" },
  { value: "ru", shortLabel: "RU", label: "Русский" },
];

export function normalizeLocale(value: string | null | undefined): Locale {
  return supportedLocales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

export function intlLocale(locale: Locale) {
  const localeTags: Record<Locale, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    pt: "pt-BR",
    ru: "ru-RU",
  };
  return localeTags[locale];
}
