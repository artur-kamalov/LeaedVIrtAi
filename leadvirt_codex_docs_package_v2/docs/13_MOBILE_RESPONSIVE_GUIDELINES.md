# 13 — Mobile Responsive Guidelines

## Goal

LeadVirt.ai must feel usable on mobile, especially for owners and managers checking leads quickly.

Mobile is not a separate native app. It is a responsive web app.

## Breakpoints

Use Tailwind breakpoints consistently.

Recommended mental model:

```text
mobile: 0–767px
tablet: 768–1023px
desktop: 1024px+
wide: 1280px+
```

## Mobile landing

Preserve the existing landing visual identity and animation direction.

Do not remove the core visual metaphor. Adapt layout:

- stacked hero;
- simplified nav with drawer;
- CTA visible early;
- product visual scaled down;
- metrics in scrollable cards;
- categories in horizontal chips;
- final CTA readable.

## Mobile app shell

Recommended:

- top bar with tenant name and quick action;
- bottom navigation for core pages;
- slide-out menu for secondary pages;
- sticky action buttons on detail screens.

Primary bottom nav:

```text
Dashboard
Inbox
Leads
Automations
More
```

## Mobile dashboard

Show:

- compact metric cards in 2-column grid;
- recent leads;
- quick actions;
- AI insights;
- channel performance as simple list or mini chart.

Avoid overly dense charts on small screens.

## Mobile inbox

Conversation list should be optimized for one-handed use.

Requirements:

- large tap targets;
- search at top;
- horizontal status filters;
- channel icons;
- unread indicators;
- lead status badges;
- pull-to-refresh feel if implemented.

## Mobile conversation detail

Chat-first layout.

Requirements:

- sticky conversation header;
- collapsible lead info drawer;
- sticky composer;
- quick action bar;
- action sheet for CRM/task/booking/handoff;
- message bubbles readable.

## Mobile lead card

Compact lead summary should show:

- name;
- status;
- source;
- value;
- interest;
- last message time;
- assigned manager;
- quick actions.

## Mobile onboarding

Use step-by-step flow:

1. Choose business type.
2. Connect channel.
3. Choose scenario.
4. Add business info.
5. Connect CRM or skip.
6. Launch.

Each step should have one primary action.

## Mobile automation builder

Full visual workflow editing can be limited on mobile.

Mobile should allow:

- view workflows;
- enable/disable;
- test scenario;
- edit basic settings;
- open desktop recommendation for full visual editing.

## Mobile analytics

Show:

- main KPI cards;
- simple charts;
- best channels list;
- AI recommendations.

Avoid complex multi-axis charts.

## Responsive implementation rules

- Avoid fixed widths that break on mobile.
- Use container queries or responsive utility classes where possible.
- All modals must be mobile-friendly.
- Dropdowns should become bottom sheets when useful.
- Tables should become cards or horizontal scroll.
- Kanban can become grouped lists on mobile.
- Sidebars should collapse into drawer/bottom nav.

## Accessibility

- Touch targets should be at least comfortable size.
- Focus states should remain visible.
- Text should not become too small.
- Contrast must remain readable in light theme.
- Avoid interactions requiring hover only.
