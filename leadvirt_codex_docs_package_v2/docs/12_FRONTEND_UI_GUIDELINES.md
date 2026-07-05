# 12 — Frontend UI Guidelines

## Frontend principles

- Next.js + React + TypeScript.
- Tailwind-first styling.
- Preserve existing Figma-generated landing style.
- Do not use a heavy UI framework that overrides the design language.
- Use accessible, reusable components.
- Build real product UI states, not static mockups.


## Figma React design source for pixel-perfect UI

The folder below will exist in the project root:

```text
LeadVirt-React-design-only/
```

It is a static React + Tailwind export from Figma. Use it as the **visual source of truth for product layouts**.

Codex may copy/refactor:

- JSX structure;
- HTML structure;
- Tailwind classes;
- cards, dashboards, chat layouts, tables, forms, modals, dropdowns, tooltips, popovers, and mobile layouts.

Codex must not copy:

- generated routes;
- `react-router` setup;
- generated `App.tsx` route logic;
- fake app shell architecture;
- generated data fetching or business logic.

Real routes must be created with the planned Next.js App Router structure.

Before frontend work, inspect this folder and produce a short migration plan that maps Figma static screens/components to real LeadVirt routes and reusable components.

See `docs/22_FIGMA_REACT_DESIGN_IMPORT.md` for the complete import rules.

## Existing landing page rule

The landing page is the visual source of truth.

Do not break:

- animations;
- section order;
- hero visual language;
- typography feel;
- spacing rhythm;
- button shapes;
- card style;
- gradients;
- interactive elements.

If extracting components, verify that the landing still looks and animates the same.

## Product routes

```text
/app/dashboard
/app/inbox
/app/inbox/[conversationId]
/app/leads
/app/leads/[leadId]
/app/automations
/app/automations/[workflowId]
/app/analytics
/app/integrations
/app/settings
/app/billing
/app/onboarding
```

## Marketing routes

```text
/
/demo
/features
/solutions
/pricing
/integrations
/login
/signup
```

## Required desktop screens

1. Dashboard / Overview.
2. Inbox.
3. Conversation / Lead detail.
4. Leads / CRM pipeline.
5. Automation builder.
6. Analytics.
7. Integrations.
8. Settings.
9. Billing / Pricing.
10. Onboarding.

## Component system

Recommended components:

```text
AppShell
Sidebar
TopBar
PageHeader
MetricCard
StatusBadge
ChannelIcon
LeadCard
ConversationListItem
MessageBubble
LeadInfoPanel
ActionButtonGroup
DataTable
KanbanBoard
KanbanColumn
WorkflowCanvas
WorkflowNode
PropertiesPanel
IntegrationCard
PricingCard
Modal
DropdownMenu
Tooltip
Toast
EmptyState
LoadingSkeleton
ErrorState
```

## Visual states

Every interactive component should include:

- default;
- hover;
- active;
- focus;
- disabled;
- loading;
- error if relevant;
- success if relevant.

## Important UI polish items

The following were previously weak or missing in generated design and must be polished:

- dropdown menus;
- popups;
- modals;
- tooltips;
- hover states;
- empty states;
- loading states;
- error states;
- success states;
- notification toasts;
- confirmation dialogs;
- light-theme text contrast.

## Contrast rule

In light theme, avoid light text on light backgrounds.

Use accessible contrast for:

- nav text;
- labels;
- table rows;
- badges;
- disabled states;
- button text;
- chart labels;
- card descriptions.

## Data fetching states

Every page should handle:

```text
loading
empty
loaded
error
permission denied
```

## Design language

The UI should feel:

- premium;
- intelligent;
- conversion-focused;
- alive;
- not generic;
- not overly corporate;
- not childish.

## Dashboard requirements

Cards:

- New leads
- AI conversations
- Bookings/orders created
- Leads sent to CRM
- Average response time
- Conversion rate

Panels:

- Recent activity
- Channel performance
- Quick actions
- AI insights

## Inbox requirements

Must include:

- channel icons;
- search;
- filters;
- status tabs;
- unread indicators;
- lead status badges;
- right-side summary;
- quick actions;
- live updates later.

## Conversation detail requirements

Must include:

- message bubbles;
- AI/user/customer/system distinction;
- quick replies;
- lead info panel;
- action buttons;
- notes;
- status changes;
- handoff state;
- message composer.

## Pipeline requirements

Must include:

- kanban columns;
- draggable-looking cards, actual drag optional for MVP;
- statuses;
- values;
- source/channel;
- assigned manager;
- quick open lead.

## Automation builder requirements

Must include:

- scenario list;
- canvas;
- nodes;
- connectors;
- zoom controls;
- selected node settings;
- publish/test buttons;
- validation warnings.

## Analytics requirements

Must include:

- KPI cards;
- leads by channel chart;
- conversion chart;
- response time chart;
- best sources;
- AI insights.

## Integrations requirements

Must include:

- grid of integration cards;
- connected/disconnected/error states;
- connect modal;
- settings modal;
- disconnect confirmation;
- API/webhook section.
