# Localization

Supported UI locales: English (`en`), Spanish (`es`), French (`fr`), German (`de`), Portuguese (`pt`), and Russian (`ru`). English is the default when no valid locale cookie exists.

- Locale is read from the `leadvirt-locale` cookie in the root layout.
- `I18nProvider` updates text, `document.documentElement.lang`, dates, numbers, currency, metadata, and Telegram widget language.
- The language dropdown is available on landing, auth, onboarding, and the product shell.
- English and Russian messages live in `apps/web/src/i18n/messages.ts`; additional typed dictionaries live in `apps/web/src/i18n/translations` and must contain every key.

Current coverage includes the marketing site, pricing, industry examples, authentication, onboarding, shared workspace shell, and dashboard. Operational pages listed in `docs/CHECKLIST.md` remain Russian-first until their copy is migrated.

Run `corepack pnpm run qa:localization` with the web app on `localhost:3001` to verify every locale, switching, persistence, and interpolation tokens.
