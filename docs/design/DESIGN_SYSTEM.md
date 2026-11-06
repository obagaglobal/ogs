# OGS design system: Kitenge signal

The visual language of the OGS web app (Phase 6b, [ADR-055](../DECISIONS.md#adr-055--visual-direction-kitenge-signal-phase-6b)). The living reference is **`/design-system`** in the app (see [getting started](../development/getting-started.md#design-system)).

## 1. Principles

- **Ink on paper, one saffron signal.** Saffron marks the one key action on a screen, the focus ring and "live" states, and nothing else.
- **Calm workspaces, warm public pages.** The motif and the Swahili greetings live on public and entry screens. Work screens stay quiet.
- **Accessible by construction.** Tokens are checked for contrast, controls are 44 px on phones, and every interactive element shows the focus ring.
- **Fast on phones.** Routes are code-split, the fonts are self-hosted, and there is no Zod on the public catalogue's first load.

## 2. Tokens

All colours live in `apps/web/src/styles/tokens.css`, switched by `<html data-theme="light|dark">`. Tailwind utilities map onto them (`bg-paper`, `text-ink`, `bg-saffron`, `text-on-saffron`, `border-control-border`, `text-success`…), and so do the shadcn variables (`--primary`, `--muted-foreground`, `--ring`…).

| Token            | Light     | Dark      | Use                                                   |
| ---------------- | --------- | --------- | ----------------------------------------------------- |
| `ink`            | `#151515` | `#F2F1EC` | Text, primary buttons, emphasised borders             |
| `paper`          | `#FAFAF7` | `#121212` | Page background                                       |
| `surface`        | `#FFFFFF` | `#1C1C1B` | Cards, inputs, menus                                  |
| `surface-muted`  | `#F1F0EA` | `#232322` | Hover, table headers, neutral badges                  |
| `muted`          | `#5E5E5A` | `#A3A39E` | Secondary text (`text-muted-foreground`)              |
| `border`         | `#DEDCD4` | `#2E2E2C` | Decorative hairlines (the default border colour)      |
| `control-border` | `#86847C` | `#72716B` | Input, select, checkbox outlines (3:1, WCAG 1.4.11)   |
| `saffron`        | `#E8A317` | `#F0B43A` | Highlight button, focus ring, live, active nav marker |
| `on-saffron`     | `#151515` | `#151515` | Text on saffron                                       |
| `danger`         | `#C23B22` | `#E2614A` | Errors, destructive actions                           |
| `success`        | `#2B774B` | `#4FB57D` | Done, paid                                            |
| `warning`        | `#9A5C00` | `#E0A23A` | Pending, attention                                    |

Rules:

- **No raw colours** outside `tokens.css`. `ogs/no-raw-colours` (ESLint) and `src/test/no-raw-colours.test.ts` reject hex, `rgb()`, `hsl()` and Tailwind palette classes (`bg-red-500`).
- **Contrast** of every pair in use is asserted in `src/test/contrast.test.ts`: text ≥ 4.5:1, control outlines and the focus indicator ≥ 3:1.
- **Saffron is never text** on light backgrounds (2.07:1).
- **Tinted status fills** (`bg-success/10`…) carry **ink** text. The colour goes on the border and the dot.

Radius is 4 px (`rounded-md`), with 2 px for small items. Shadows appear only on floating surfaces (`--shadow-float`). Motion is 120–200 ms ease-out, and is switched off under `prefers-reduced-motion`.

## 3. Type

| Role                     | Face           | Weights       | Notes                                             |
| ------------------------ | -------------- | ------------- | ------------------------------------------------- |
| Headings, labels, badges | Space Grotesk  | 400, 500, 700 | `font-display`                                    |
| Body                     | Inter          | 400, 500      | 16 px, line-height 1.6                            |
| Money, numbers, IDs      | JetBrains Mono | 400, 500      | `.tabular` (tabular figures); `<Money>`, `<Code>` |

- **Scale:** 12 / 14 / 16 / 18 / 22 / 28 / 36 / 48 px.
- **Money:** always `formatKes` ("KES 84,500"), shown with `<Money minor={…} />`.
- **Font files:** self-hosted from `@fontsource` (`pnpm --filter @ogs/web fonts:sync`), `font-display: swap`, with Inter 400 and Space Grotesk 700 preloaded. `src/test/fonts.test.ts` checks that the files match the packages.

## 4. Theme

- **Choices:** light, dark or system, in the account menu (and on `/design-system`).
- **Storage:** the choice is stored in `localStorage["ogs.theme"]`; "system" removes the key and follows `prefers-color-scheme` live.
- **No flash:** `public/theme-init.js` is a classic, blocking script at the top of `<head>`. It sets `data-theme` before any stylesheet applies. It is an external file, so a future Content-Security-Policy needs no `unsafe-inline`.
- **Code:** `src/theme/theme.ts` (`useTheme`, `setThemeChoice`).

## 5. Components (`apps/web/src/components/ui`)

| Area       | Components                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions    | `Button`: primary (ink), secondary (outline), ghost, danger, highlight (saffron: one per screen), link                                                                                                |
| Forms      | `FormField` (label, help, error wired by id), `Input`, `Textarea`, `Select` (native), `Checkbox`, `RadioGroup`, `Switch`, `Combobox` (cmdk), `DatePicker` (react-day-picker), `FileUpload` (progress) |
| Status     | `Badge`, `StatusPill`: draft, pending, active, live, completed, paid, overdue, breached, suspended                                                                                                    |
| Data       | `Card` (+ `emphasis`), `CardHeader`, `PageHeader`, `StatTile`, `DataTable` (sort, pagination, empty and loading rows), `Money`, `Code`, `Avatar`                                                      |
| Navigation | `Tabs`, `Breadcrumbs`, `Pagination`, `Stepper`, `Timeline`                                                                                                                                            |
| Overlays   | `DialogContent` (focus trap, Escape, focus restore), `Drawer` (vaul), dropdown `Menu*`, `Tooltip`, `Toaster` (sonner: `toast()` behind sign-in)                                                       |
| Feedback   | `Alert`, `Banner`, `Skeleton`, `EmptyState`, `ErrorState`, `PageLoader`, `RouteFallback`                                                                                                              |
| Identity   | `KitengeMotif`, `BrandMark`                                                                                                                                                                           |

The older `form-controls` helpers (`Field`, `Card`, `Notice`) are thin wrappers over these, so older screens share the same look.

Touch targets: buttons, inputs and selects are `min-h-11` (44 px) below `md`. Checkbox, radio and switch draw a 20–24 px box, and an `::after` overlay extends the hit area to 44 px.

## 6. The Kitenge motif

`<KitengeMotif variant="band|corner|divider" tone="saffron-ink|saffron-only|muted" height={…} />` draws an original band of alternating triangles with small diamond "seeds" (the divider drops them). It is an inline SVG with `aria-hidden` and carries `data-motif`.

| Allowed                               | Never                               |
| ------------------------------------- | ----------------------------------- |
| Public header strip                   | Behind text                         |
| Hero of the public home and catalogue | In tables or forms                  |
| Empty states                          | More than once per signed-in page   |
| Full-page loader                      | As a substitute for a status colour |
| Sign-in and sign-up                   |                                     |
| Marketing section dividers            |                                     |

`e2e/theme-motif.spec.ts` counts motifs per page and fails on any in a table or form. `/design-system` is the one documented exception, because it shows the variants.

## 7. App shell

- **Sidebar:** collapsible from `md`, remembered in `localStorage["ogs.sidebar"]`. On phones it becomes a drawer. The active link has a saffron bar.
- **Top bar:**
  - workspace switcher: a native `<select>` labelled "Workspace" that shows name and type, plus a type badge from `lg`;
  - search placeholder (Ctrl+K search is a later phase);
  - notifications;
  - account menu: security, theme and sign out.
- **Skip link** first on every page; `#main` receives focus.

## 8. Voice

- "Karibu" on the public hero and the sign-in and sign-up titles; "Habari, {first name}" on dashboards, with the name taken from the email (`habari()`).
- Everything else is sentence-case English.
- Strings go through `t(key, vars)` (`src/i18n`). The shell, the auth layout, the dashboard, the public catalogue and the new components use it. Older feature screens still hold English literals: see the known limitations in the Phase 6b PR.

## 9. Responsiveness and accessibility

- **Breakpoints tested:** 360, 768, 1024 and 1440 px, with no horizontal scrolling.
- **Accessibility target:** WCAG 2.2 AA.
- **Checks:**
  - axe on 9 pages in both themes (serious or critical fails);
  - keyboard: skip link, dialog trap and restore;
  - focus ring visible;
  - 44 px targets at 360 px.

## 10. Tests and tooling

| Check                     | Where                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| No raw colours            | `eslint-rules/no-raw-colours.js`, `src/test/no-raw-colours.test.ts` |
| Contrast                  | `src/test/contrast.test.ts`                                         |
| Fonts                     | `src/test/fonts.test.ts`                                            |
| Components                | `src/components/ui/components.test.tsx`                             |
| Screenshots (36)          | `e2e/visual.spec.ts` (9 pages × light/dark × 1440/360)              |
| axe, keyboard, responsive | `e2e/a11y.spec.ts`                                                  |
| Theme and motif           | `e2e/theme-motif.spec.ts`                                           |
| Performance               | `lighthouserc.cjs`: `/services` mobile, performance ≥ 85, a11y ≥ 95 |

**Screenshot baselines:** Linux images (from CI) are the reference and are committed under `apps/web/e2e/__screenshots__/`. Windows and macOS images are written locally for viewing and are git-ignored. CI writes any missing Linux baseline and uploads it as the `screenshot-baselines-linux` artifact, so it can be committed.
