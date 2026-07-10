# Localization

Supported UI locales: Russian (`ru`) and English (`en`). Russian remains the default.

- Locale is read from the `leadvirt-locale` cookie in the root layout.
- `I18nProvider` updates text, `document.documentElement.lang`, dates, numbers, currency, metadata, and Telegram widget language.
- `LanguageSwitcher` is available on landing, auth, onboarding, and the product shell.
- Typed messages live in `apps/web/src/i18n/messages.ts`; both locale dictionaries must contain every key.

Current coverage includes the marketing site, pricing, industry examples, authentication, onboarding, shared workspace shell, and dashboard. Operational pages listed in `docs/CHECKLIST.md` remain Russian-first until their copy is migrated.

Run `corepack pnpm run qa:localization` with the web app on `localhost:3001` to verify switching and persistence.
