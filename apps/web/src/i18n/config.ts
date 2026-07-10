export const supportedLocales = ["ru", "en"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "ru";
export const localeCookieName = "leadvirt-locale";

export const localeOptions: ReadonlyArray<{ value: Locale; shortLabel: string; label: string }> = [
  { value: "ru", shortLabel: "RU", label: "Русский" },
  { value: "en", shortLabel: "EN", label: "English" },
];

export function normalizeLocale(value: string | null | undefined): Locale {
  return supportedLocales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

export function intlLocale(locale: Locale) {
  return locale === "en" ? "en-US" : "ru-RU";
}
