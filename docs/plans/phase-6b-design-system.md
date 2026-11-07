# Phase 6b Plan — "Kitenge signal" design system

**Status:** APPROVED by the owner on 2026-11-06 ("Design phase approved"). **§9 (Phase 7 screens) was added and approved by the owner on 2026-11-07.** The owner merged Phase 7 (PR #8) first, so this branch (`phase-6b/design-system`, from `main` @ `bbbea88`) restyles the Phase 7 screens too. Ships as one PR into `main`; not merged by the agent.

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

## 8. Delivery notes (2026-11-06)

- **Journeys unchanged.** All six existing Playwright journeys pass with no selector changes. The workspace switcher stays a native `<select>` labelled "Workspace", and nav link names are unchanged.
- **Unit-test wording changes:**
  - (`App.test.tsx`) the sign-in heading is now "Karibu. Sign in to OGS";
  - (`phase6.test.tsx`) signed-out visitors see "Sign in to request" on a service page (signed-in users still see "Request this service");
  - (`App.test.tsx`) the first query after `renderApp` now awaits (`findBy…`), because routes are lazy.
- **Unit-test timing:** the async-query timeout is 5 s and the per-test timeout 15 s, because lazy route chunks are transformed on first use under a parallel `pnpm check`.
- **Performance:**
  - Routes are code-split. Lighthouse on `/services` (mobile) first measured performance 78.
  - Moving the toaster behind sign-in and adding `modulepreload` links for the catalogue chunks raised it to 83–87.
  - Taking Zod off the public path raised it to **92–96** (accessibility **100**).
  - The Zod change moved the header constants, a Zod-free `isApiErrorBody` (tested to agree with `apiErrorSchema`) and `formatKes` into `packages/contracts/src/http.ts` and `money.ts`, still exported from the package index. There are no schema, endpoint or API behaviour changes. This touches the shared package, so it is called out in the PR for review.
- **Accessibility fixes found by the new tests:**
  - the account-menu button's name now includes the visible initials (WCAG 2.5.3);
  - table roots can no longer widen the page at 360 px;
  - table sort buttons are 44 px on phones.
- **Screenshots:** Linux baselines come from the first CI run (artifact `screenshot-baselines-linux`) and are committed afterwards. Until then CI writes rather than compares them.
- **i18n:** the shell, the auth layout, the dashboard, the public catalogue and every new component use `t()`. Older feature screens (team, organisation, provider, platform staff, requests) still hold English literals; converting them is mechanical and left for a follow-up.

## 9. Scope addition: the Phase 7 screens (approved 2026-11-07)

The owner asked for the Phase 7 screens to get a full redesign, beyond the shared restyle they already have:

- **Already done:** new buttons, fields and cards; mono KES amounts; status badges with dots; a timeline for history; an empty state for the requests list.
- **Not done yet:** proper layouts, tables, progress and phone-sized screens.

### 9.1 Customer screens

| Screen                                  | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request form** (`/requests/new`)      | Breadcrumb (Services › service › Request). The fields are grouped into two cards, "Where and when" and "About the job"; the county select uses the `Select` component. On large screens a sticky estimate card shows Subtotal, VAT 16% and Estimated total, mono and right-aligned; on phones it sits above the button. A quote-only service shows an info `Alert`. "Send request" becomes the screen's one `highlight` button.                                                        |
| **Requests list** (`/requests`)         | A `DataTable` (Number in mono as the link, Service, Submitted, Status), sortable and paginated, which becomes stacked cards below `sm`. The empty state is unchanged.                                                                                                                                                                                                                                                                                                                  |
| **Request detail** (`/requests/:id`)    | A page header with the number in mono and a status pill. A progress `Stepper` uses the customer labels: Submitted → Being reviewed → Quotation ready → Awaiting payment → Confirmed (a cancelled request shows Cancelled instead). On large screens, two columns: details and quotation on the left; order, payment instructions and actions on the right. "Accept quotation" is the `highlight` button, "Reject" is secondary and "Cancel request" is `danger`. History is unchanged. |
| **Quotation view** (customer and staff) | A lines table on the shared table styling. Totals sit in a right-aligned mono block, with a stronger rule above the total. Validity is shown as a badge, turning `warning` within 48 hours of expiry. A status pill shows the quotation status, with the existing lowercase word ("issued", "accepted"…) kept as its label.                                                                                                                                                            |

### 9.2 Staff and finance screens

| Screen                                                            | Changes                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request queue** (`/platform/requests`)                          | A `DataTable` (Number, Customer, Service, Submitted, Status). The status filter stays a `Select` labelled "Status".                                                                                                                                                                                                                                                    |
| **Staff request and quotation editor** (`/platform/requests/:id`) | The decision buttons sit in a card. Each line is a table row on desktop and a stacked card on phones. Add and remove use ghost icon buttons with accessible names. A live totals panel shows the same text as today ("Subtotal KES … + VAT KES … = KES …") in mono. Validity uses a `Select`. "Issue quotation" is `highlight`; "Save draft" is secondary.             |
| **Orders list** (`/platform/orders`)                              | A `DataTable` (Order, Customer, Total, Paid, Balance, Status), with mono, right-aligned numbers.                                                                                                                                                                                                                                                                       |
| **Finance order page** (`/platform/orders/:id`)                   | Stat tiles for Total, Paid and Balance, with Balance emphasised. A "Record a payment" card: amount with a KES prefix, method `Select`, mono reference field, and "Record payment" as `highlight`. A payments table. "Organisation billing terms" in its own card, with the current terms shown as a badge. "Cancel the order" in a separate card with a danger border. |

### 9.3 Rules for this addition

- **Behaviour unchanged:** same fields, validation, API calls, idempotency keys and permissions. Only layout and presentation change.
- **The Phase 7 journeys stay unchanged.** These names stay exactly as they are:
  - field labels: Address, Contact phone, What do you need?, Status, "Line 1 unit price (KES)", "Line 1 quantity", Amount (KES), Reference;
  - buttons: Send request, Start review, Accept at KES …, Needs a quotation, Save draft, Issue quotation, Accept quotation, Record payment;
  - request numbers as link names, the request number in the page heading, the totals text, and the word "issued".
- No new motif: these are signed-in work screens, and only the existing empty state carries it.
- Strings added or changed on these screens go through `t()`. That converts them, which narrows the i18n limitation in §8.

### 9.4 Tests for this addition

- **Visual suite:** four more pages, request detail with an issued quotation, staff request with the quotation editor, the orders list and the finance order page. They use API fixtures (like the catalogue), so the screenshots are stable: 13 pages × light/dark × 1440/360 = **52 screenshots**.
- **axe** in both themes, plus the no-horizontal-scroll and 44 px checks, also cover those four pages.
- **Unit tests:** the existing Phase 7 tests (`phase7.test.tsx`) must keep passing. Any change of wording is listed in the delivery notes.
- **Gates:** the `requests-journey.spec.ts` journeys, `pnpm check`, `pnpm test:integration` and Lighthouse on `/services` (unaffected: these screens are behind sign-in).

### 9.5 Delivery

One more step on this branch, after the current work: Phase 7 customer screens → staff and finance screens → tests → docs (DESIGN_SYSTEM.md, delivery notes). Each part is committed when green, and the work stays within the one Phase 6b PR.
