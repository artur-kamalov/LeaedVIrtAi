# Codex Addendum — Use `LeadVirt-React-design-only/` for Pixel-Perfect UI

Additional instruction:

A ready static React + Tailwind layout exported from Figma will be available in:

```text
LeadVirt-React-design-only/
```

Codex must use this folder as the visual source for pixel-perfect product layouts.

Codex may copy/refactor:

- components;
- JSX;
- HTML structure;
- Tailwind classes;
- visual sections;
- desktop layouts;
- mobile layouts;
- modals, dropdowns, tooltips, popovers, forms, cards, tables, dashboards, and chat UI.

Codex must not copy:

- generated routes;
- generated router logic;
- Figma-generated `App.tsx` page switching;
- fake app shell architecture;
- generated business logic or data fetching.

Real routes must be created with the planned Next.js App Router structure.

Before frontend implementation, inspect `LeadVirt-React-design-only/`, create a migration map from static design screens/components to real LeadVirt routes/components, then refactor useful design code into clean typed production components.

Preserve the existing landing page and animations.
