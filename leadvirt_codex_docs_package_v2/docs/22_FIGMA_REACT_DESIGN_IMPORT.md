# 22 — Figma React Design Import Guide

A ready static React + Tailwind layout exported from Figma will be available in the project folder:

```text
LeadVirt-React-design-only/
```

This folder is a **visual implementation source**, not an application architecture source.

Codex must use it to create pixel-perfect LeadVirt.ai layouts. Codex may copy and refactor components, JSX structure, HTML structure, and Tailwind classes from this folder. Codex must not copy generated routing or generated application architecture from this folder.

---

## Purpose

`LeadVirt-React-design-only/` contains the approved Figma design as a small static React + Tailwind app.

Use it to:

- match the approved design as closely as possible;
- preserve exact visual style, spacing, typography, colors, shadows, border radius, gradients, and responsive behavior;
- reuse component markup and Tailwind utility classes;
- avoid rebuilding the UI from memory;
- ensure the product app looks consistent with the approved landing page.

---

## Allowed to copy/refactor

Codex may copy and refactor:

- JSX structure;
- static HTML layout;
- Tailwind classes;
- visual sections;
- component markup;
- cards;
- tables;
- lists;
- dashboards;
- chat layouts;
- lead cards;
- kanban cards;
- workflow nodes;
- pricing cards;
- modals;
- dropdowns;
- tooltips;
- popovers;
- forms;
- mobile layouts;
- simple animation classes or transitions when clean and compatible.

When copying, convert static generated markup into clean, typed, reusable production components.

---

## Not allowed to copy

Do **not** copy the Figma export as the real application.

Do not copy:

- generated route structure;
- generated route maps;
- `react-router` setup;
- generated `App.tsx` routing logic;
- fake page switching logic;
- random generated state management;
- messy generated data fetching;
- business logic from the Figma export;
- hardcoded architecture decisions;
- duplicate low-quality components without refactoring;
- generated file structure when it conflicts with the planned monorepo and Next.js architecture.

Figma-generated route code is considered low quality. The final app must use the planned Next.js App Router structure.

---

## Source-of-truth priority

When sources conflict, use this priority:

1. **LeadVirt architecture documentation** for app structure, routing, backend contracts, tenancy, security, data flow, and business logic.
2. **Existing landing page implementation** for landing page animations and marketing visual behavior.
3. **`LeadVirt-React-design-only/`** for visual layout, JSX structure, Tailwind classes, components, and pixel-perfect product UI.
4. **Codex judgment** only for glue code, accessibility fixes, responsive improvements, and production refactoring.

Never allow generated Figma routes to override the planned Next.js architecture.

---

## Required workflow before frontend implementation

Before implementing or modifying any product UI, Codex must:

1. Inspect `LeadVirt-React-design-only/`.
2. List the available screens and reusable components.
3. Identify which design component maps to which real product page.
4. Create a short migration plan.
5. Extract/refactor UI into the real app structure.
6. Preserve the existing landing page and animations.

---

## Target Next.js route structure

Use the real app routes below. Do not use Figma-generated routes.

```text
apps/web/src/app/
  (marketing)/
    page.tsx
    demo/page.tsx
    features/page.tsx
    solutions/page.tsx
    pricing/page.tsx
    integrations/page.tsx
  (auth)/
    login/page.tsx
    signup/page.tsx
  (app)/
    layout.tsx
    dashboard/page.tsx
    inbox/page.tsx
    inbox/[conversationId]/page.tsx
    leads/page.tsx
    leads/[leadId]/page.tsx
    automations/page.tsx
    automations/[workflowId]/page.tsx
    analytics/page.tsx
    integrations/page.tsx
    settings/page.tsx
    billing/page.tsx
    onboarding/page.tsx
```

The Figma export may provide visual content for these pages, but it must not define the routing system.

---

## Component extraction targets

Refactor useful design code into production components such as:

```text
apps/web/src/components/ui/
apps/web/src/components/layout/
apps/web/src/components/marketing/
apps/web/src/components/leadvirt/
apps/web/src/features/dashboard/components/
apps/web/src/features/inbox/components/
apps/web/src/features/leads/components/
apps/web/src/features/automations/components/
apps/web/src/features/analytics/components/
apps/web/src/features/integrations/components/
apps/web/src/features/settings/components/
apps/web/src/features/onboarding/components/
```

Examples:

```text
MetricCard
StatusBadge
ChannelIcon
LeadCard
ConversationListItem
MessageBubble
LeadInfoPanel
KanbanColumn
WorkflowNode
PropertiesPanel
IntegrationCard
PricingCard
Modal
DropdownMenu
Tooltip
Popover
Toast
EmptyState
LoadingSkeleton
```

---

## Refactoring rules

When migrating from `LeadVirt-React-design-only/`:

- keep Tailwind-first styling;
- preserve exact visual classes where useful;
- remove duplicated generated components;
- convert static markup into typed reusable components;
- move repeated raw values into Tailwind theme tokens or CSS variables when helpful;
- use a `cn()` utility for conditional class names;
- avoid `any`;
- avoid hardcoded business data inside reusable components;
- separate visual components from data loading;
- keep feature-specific mock data in feature-level mock files;
- keep accessibility for buttons, inputs, dialogs, menus, tabs, and forms;
- support keyboard navigation for dropdowns, dialogs, and popovers.

Example typed component direction:

```tsx
export type MetricCardProps = {
  label: string;
  value: string;
  change?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};
```

---

## Landing page protection

The landing page already exists and may contain animations.

Codex must:

- not break existing landing animations;
- not remove animated layers;
- not rename animation-dependent components unless necessary;
- not simplify hero/demo animations;
- not replace the landing with Figma export code unless explicitly requested;
- keep marketing animations isolated from app dashboard code if needed.

If `LeadVirt-React-design-only/` includes a landing version, compare it with the existing landing and migrate only safe improvements.

---

## Mobile responsive rules

If the Figma export includes mobile layouts, use them as the visual source.

If mobile layouts are missing for a screen, adapt the desktop design using the same visual language:

- one-column layout;
- compact app header;
- bottom navigation or compact drawer where appropriate;
- chat-first conversation view;
- collapsible lead details;
- sticky primary actions;
- large touch targets;
- no horizontal overflow;
- readable light-theme contrast.

---

## Pixel-perfect acceptance checklist

For every implemented frontend screen, verify:

- visual layout matches the Figma export;
- typography scale matches;
- spacing rhythm matches;
- colors and gradients match;
- cards, shadows, and border radius match;
- sidebar and topbar match;
- buttons and badges match;
- modals, dropdowns, tooltips, and popovers are styled;
- mobile layout is clean and usable;
- light-theme text contrast is readable;
- no unstyled native selects, dropdowns, or inputs remain;
- no Figma-generated broken routes are used;
- existing landing animations still work.

---

## Codex frontend instruction snippet

Use this snippet before any frontend task:

```text
Before implementing frontend UI, inspect the folder `LeadVirt-React-design-only/`.
It contains a static React + Tailwind export from Figma and is the visual source for pixel-perfect layouts.
Use it to copy/refactor components, JSX structure, HTML structure, and Tailwind classes.
Do not copy generated routes, generated router logic, fake app shell code, or Figma-generated architecture.
Rebuild routes using the planned Next.js App Router structure.
Preserve the existing landing page and its animations.
Convert useful static components into clean typed reusable components in the real app.
```
