# Phase 6b Plan — "Kitenge signal" design system

**Status:** APPROVED by the owner on 2026-11-06 ("Design phase approved"). The owner merged Phase 7 (PR #8) first, so this branch (`phase-6b/design-system`, from `main` @ `bbbea88`) restyles the Phase 7 screens too. Ships as one PR into `main`; not merged by the agent.

**Based on:** the owner's design brief (visual direction "Kitenge signal"), spec section 18 (premium, minimalist, consistent, responsive, accessible, fast; blue and purple never dominant), ADR-022 (one accent colour) and ADR-024 (English first, i18n-ready).

## 1. Objectives

One token-driven design system, in light and dark, used by every screen with no one-off styles. It carries an East African identity (the kitenge motif, a saffron accent, Swahili greetings), meets WCAG 2.2 AA (enforced by tests), and loads fast on Kenyan mobile data (enforced by a Lighthouse check).

## 2. Tokens (approved, with four contrast adjustments)

| Token                                                      | Light                         | Dark          |
| ---------------------------------------------------------- | ----------------------------- | ------------- |
| ink                                                        | `#151515`                     | `#F2F1EC`     |
| paper                                                      | `#FAFAF7`                     | `#121212`     |
| surface                                                    | `#FFFFFF`                     | `#1C1C1B`     |
| surface-muted                                              | `#F1F0EA`                     | `#232322`     |
| muted                                                      | `#5E5E5A`                     | `#A3A39E`     |
| border (decorative hairlines)                              | `#DEDCD4`                     | `#2E2E2C`     |
| **control-border** (new: input, checkbox, select outlines) | **`#86847C`**                 | **`#72716B`** |
| saffron                                                    | `#E8A317`                     | `#F0B43A`     |
| on-saffron                                                 | `#151515`                     | `#151515`     |
| danger                                                     | `#C23B22`                     | `#E2614A`     |
| success                                                    | **`#2B774B`** (was `#2E7D4F`) | `#4FB57D`     |
| warning                                                    | **`#9A5C00`** (was `#B26B00`) | `#E0A23A`     |

Contrast adjustments (WCAG AA), approved with the plan:

- **warning (light):** `#B26B00` was 4.02:1 on paper and 3.68:1 on surface-muted; `#9A5C00` gives 5.14:1 and 4.71:1.
- **success (light):** `#2E7D4F` was 4.42:1 on surface-muted; `#2B774B` gives 4.79:1.
- **Focus ring:** saffron alone is 2.07:1 on light paper (the non-text minimum is 3:1). The ring is two-tone: 2px ink inside, 2px saffron outside.
- **control-border:** the hairline `border` is about 1.3:1. Form-control outlines need 3:1 (WCAG 1.4.11), so they use `control-border`.

Saffron is never text on light backgrounds.

## 3. Scope

- **Tokens and theme:**
  - Tokens are CSS variables wired into Tailwind 4 and the shadcn theme. Raw colours are banned outside the token file, by a lint rule and a unit test.
  - Light, dark and system themes, remembered per browser, with no flash on load: `public/theme-init.js` runs before first paint.
- **Fonts:** self-hosted latin woff2 (Space Grotesk 400/500/700, Inter 400/500, JetBrains Mono 400/500), `font-display: swap`, two preloads.
- **Components:**
  - Actions and form fields: Button (primary, secondary, ghost, danger, highlight), Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Date picker, File upload with progress, Form field.
  - Status and content: Badge, StatusPill, Card, Stat tile, Table (sorting, pagination, empty and loading rows), Avatar, Money, Stepper/Timeline.
  - Navigation: Tabs, Breadcrumbs, Pagination.
  - Overlays: Dialog, Drawer, Dropdown menu, Tooltip, Toast.
  - Feedback: Alert, Skeleton, Empty state, Error state, page loader, and `<KitengeMotif />`.
- **App shell:**
  - A responsive sidebar: collapsible on desktop, a drawer on mobile.
  - A top bar with:
    - the workspace switcher (current workspace name and type always visible);
    - a search placeholder;
    - a notification bell placeholder;
    - a user menu with the theme toggle.
  - A skip-to-content link.
- **Restyle every existing screen** (Phases 3–7), with behaviour unchanged. The public catalogue gets the Karibu hero, category cards, search with instant feedback, mono KES prices and a "Sign in to request" call to action.
- **`/design-system`:** dev builds, and staff in production.
- **i18n and voice:**
  - An i18n layer (`t()`, English catalogue).
  - "Karibu" on sign-in and first visits; "Habari {name}" on dashboards.
  - The name falls back to the email's local part, because there is no name field yet.
- **Responsive and performance:**
  - 360 / 768 / 1024 / 1440 px; 44 px touch targets on mobile.
  - Route code-splitting, so the public catalogue chunk carries no authenticated-app code.

## 4. Exclusions

- No backend, API or contract changes, and no new business features.
- No command bar, live job tracker, M-Pesa UI or offline mode.
- No Swahili translation beyond the greetings, and no user name field.
- No CSP rollout. `theme-init.js` is compatible with one.

## 5. Packages (verified on npm on 2026-11-06; React 19 peers; older than pnpm's 1-day minimum release age)

| Package                                                                        | Version   |
| ------------------------------------------------------------------------------ | --------- |
| `radix-ui`                                                                     | `~1.8.1`  |
| `sonner`                                                                       | `~2.0.8`  |
| `vaul`                                                                         | `~1.1.2`  |
| `cmdk`                                                                         | `~1.1.1`  |
| `react-day-picker`                                                             | `~10.0.2` |
| `lucide-react`                                                                 | `~1.68.0` |
| `@fontsource/space-grotesk`, `@fontsource/inter`, `@fontsource/jetbrains-mono` | `~5.3.0`  |
| `@axe-core/playwright` (dev)                                                   | `~4.14.0` |
| `@lhci/cli` (dev)                                                              | `~0.16.0` |

`lucide-react` is pinned to 1.68.0 because 1.69.0 and 1.70.0 are less than a day old.

## 6. Tests and acceptance

- `pnpm check` passes. Every existing integration suite and every existing Playwright journey still passes; any selector that depends on wording and has to change is listed.
- **Screenshots:** 9 pages × light/dark × 1440/360 px. CI produces the Linux baselines; Windows runs are for viewing only.
- **axe:** checks in both themes; serious or critical violations fail the build.
- **Contrast:** a unit test covers every token pair the components use.
- **Theme:** the toggle persists, with no flash on reload.
- **Motif:** counted per page, appearing only where allowed.
- **Keyboard:** skip link, dialog focus trap, and a focus ring on every interactive element.
- **Lighthouse CI:** `/services`, mobile, performance at least 85 and accessibility at least 95. Scores are reported; a missed target is explained, not lowered.

## 7. Delivery

Small steps, each committed when green: tokens and fonts → theme → primitives → composites → motif and i18n → app shell → restyle by area → `/design-system` → tests → Lighthouse CI → docs → close-out and PR.
