# Changelog

All notable changes to OGS. Phases are delivered as pull requests into `main`.

## Unreleased: Phase 6b, "Kitenge signal" design system

### Added

- Design tokens for light and dark in `tokens.css`, wired into Tailwind and shadcn, with a lint rule and unit tests against raw colours and for WCAG contrast.
- Light, dark and system themes, chosen in the account menu, remembered per browser, with no flash on load.
- Self-hosted Space Grotesk, Inter and JetBrains Mono (Latin woff2). Money is shown as "KES 84,500" with tabular figures.
- A component library: buttons, form controls (including combobox, date picker and file upload with progress), badges and status pills, cards, stat tiles, data table, tabs, breadcrumbs, pagination, stepper, timeline, dialog, drawer, menus, tooltip, toasts, alerts, skeletons, and empty, error and loading states.
- `<KitengeMotif />`, the signature element, used only where the rules allow.
- New app shell: collapsible sidebar, mobile drawer, skip link, workspace switcher with type, search placeholder, notifications and account menu.
- Public catalogue: motif header strip, "Karibu" hero, category cards, instant search, mono prices, and "Sign in to request".
- `/design-system` reference page (development, and platform staff in production).
- An i18n layer (`t()`), with "Karibu" and "Habari {name}" greetings.
- Playwright design suites: 36 screenshots, axe in both themes, keyboard, responsive and touch-target checks, theme persistence and no-flash, motif rules.
- Lighthouse CI on `/services` (mobile): performance ≥ 85, accessibility ≥ 95.

### Changed

- Every existing screen restyled, with no change to behaviour. The sign-in title is now "Karibu. Sign in to OGS", and signed-out visitors see "Sign in to request" on a service page.
- Routes are code-split: the first load of `/services` dropped from a 606 kB single bundle to a 301 kB entry plus small route chunks.
- `@ogs/contracts`: the header constants, `isApiErrorBody` and `formatKes` live in Zod-free modules (`http.ts`, `money.ts`), still exported from the package index, so the public catalogue loads no schemas. There are no API or schema changes.

## Phase 7: requests, quotations and orders (PR #8)

See [`docs/plans/phase-7-requests-orders.md`](docs/plans/phase-7-requests-orders.md) and ADR-046 … ADR-054.

## Phases 2–6

See the plans in [`docs/plans/`](docs/plans/) and [`docs/DECISIONS.md`](docs/DECISIONS.md).
