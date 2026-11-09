# OGS — notes for Claude Code

OGS (ObagaGlobal Services) is an ICT services marketplace for Kenya. It is a pnpm monorepo:

- `apps/api`: NestJS, Prisma 7, PostgreSQL with row-level security;
- `apps/web`: React 19, Vite, Tailwind;
- `packages/contracts`: Zod schemas shared by the API and the web app.

Start with [README.md](README.md), [docs/architecture/overview.md](docs/architecture/overview.md), [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/design/DESIGN_SYSTEM.md](docs/design/DESIGN_SYSTEM.md).

## Status

<!-- Keep this block current: update it whenever a phase PR is opened, merged or approved. -->

| Phase                                                        | State                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| 0 Architecture review                                        | Accepted (D-1 … D-18 → ADR-009 … ADR-026)                          |
| 2 Tenancy, RLS, data foundations                             | Merged to `main` (#1)                                              |
| 3 Identity, access, first shell                              | Merged to `main` (#2)                                              |
| 4 Organisations, approvals, invitations, members             | Merged to `main` (#3)                                              |
| 5 Providers, KYC review, coverage, availability, eligibility | Merged to `main` (#4); §8 refinements approved (ADR-033 … ADR-037) |
| 6 Service catalogue                                          | Merged to `main` (#7)                                              |
| 7 Requests, quotations, orders                               | Merged to `main` (#8); §8 delivery notes approved                  |
| 6b Design system (Kitenge signal)                            | Merged to `main` (#10)                                             |
| 8 Ticketing and ITSM                                         | Merged to `main` (#11)                                             |
| 9 Assignment and dispatch                                    | Not started: plan needed                                           |

Last updated: 2026-11-09.

## Workflow rules (from the owner)

These rules live here so they never depend on local memory.

- **The owner merges every PR.** "Phase N approved" means you may build Phase N. It never means you may merge any PR.
- **One phase at a time:**
  1. Write the plan in `docs/plans/` and wait for "Phase N approved".
  2. Build and test on a `phase-N/<name>` branch. The whole phase goes into **one PR into `main`**.
  3. Wait for green CI and report it with the PR link.
  4. Don't start the next phase until the owner has merged this phase's PR.
- Commit or push only when asked. Within an approved phase, committing and pushing the phase branch is part of the job.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Don't run dev servers or tests while the owner is running `pnpm dev`.** When you finish, stop every server and background process you started, and say so.
- **Never commit `.env` files or real secrets.**
- **Never run destructive database commands** (reset, drop, `down -v`). Give the owner the command to run instead. Prisma also refuses `migrate reset` from an AI agent: the owner runs `pnpm db:reset` / `pnpm db:reset:test`.
- Never bypass safety checks:
  - Never add `minimumReleaseAgeExclude` to work around pnpm's minimum release age; pin an older version instead.
  - Never skip hooks or work around a blocked command.
- The development machine is Windows. Give the owner **PowerShell** commands.

## Security rules

- Tenant isolation is enforced in the backend **and** by PostgreSQL RLS. Never trust a tenant or workspace ID sent by the browser.
- Set RLS context only with transaction-local `set_config(…, true)` (in `TenantDb`). Never use session-level `SET`.
- `ogs_app`, the app's database role, doesn't own the tables and has no `BYPASSRLS`.
- Money is stored as integer minor units with a currency code. Never use floats.
- Payments are confirmed only by verified gateway callbacks or reconciliation, never by a browser redirect.
- Internal notes never reach customers (ADR-059).
- Audit records are append-only.

## Working conventions

- `pnpm check` (format, lint with zero warnings, typecheck, unit tests) must pass before pushing. `pnpm test:integration` needs `pnpm infra:up` and runs against `ogs_test`.
- `pnpm test:e2e` starts the API from `apps/api/dist`. Rebuild it (`pnpm --filter @ogs/api build`) after API changes.
- Every new table needs RLS enabled **and** forced, explicit grants to `ogs_app`, and an entry in `test/integration/rls-catalogue.int.test.ts` and `isolation.int.test.ts`.
- Database access goes through `TenantDb.run(ctx, …)` only; lint bans Prisma or `pg` imports outside `src/database`.
- Every route needs an access decorator. Default deny is enforced at start-up by `AccessRouteCheck`.
- Edit files with the editor tools, not shell heredocs or `node -e` (quotes and backticks get mangled). Windows host: keep LF line endings.

## Design (Phase 6b, ADR-055)

All new screens use the Kitenge signal design system: its tokens and its components.

- **Colours:** use the tokens only (`bg-paper`, `text-ink`, `bg-saffron`, `border-control-border`, `text-success`…). Raw colours (hex, `rgb()`, palette classes like `bg-red-500`) fail lint and tests outside `apps/web/src/styles/tokens.css`. A new colour pair must pass `src/test/contrast.test.ts`.
- **Components:** build screens from `apps/web/src/components/ui` (`Button`, `FormField` + `Input`/`Select`, `Card`, `StatusPill`, `DataTable`, `EmptyState`…). Money uses `<Money minor={…} />`; references and IDs use `<Code>`.
- **Saffron:** at most one `highlight` button per screen. Saffron is never text on light backgrounds.
- **Motif:** `<KitengeMotif />` appears only in the public header strip and hero, empty states, the page loader, sign-in/sign-up and marketing dividers. Never behind text, in tables or in forms, and at most once per signed-in page; `e2e/theme-motif.spec.ts` counts it.
- **Strings:** new UI strings go through `t()` (`apps/web/src/i18n/en.ts`). Use "Karibu" and "Habari" only as the voice rules say.
- **Accessibility:** controls are 44 px on phones (`min-h-11 md:min-h-…`). Keep the global focus ring; don't add `outline-none`. Interactive elements need an accessible name that contains their visible text.
- **Selectors:** e2e journeys select by role and name with substring matching. Don't add links or buttons whose names contain an existing nav label (e.g. "Requests") on the same page.
- **Routes:** pages are lazy (`App.tsx`). Keep Zod and heavy libraries off the public catalogue's first load, and use the zod-free `@ogs/contracts` modules (`http.ts`, `money.ts`) there.
- **Tests:** after visual changes, run `e2e/visual.spec.ts`. CI's Linux screenshots are the committed baselines (see docs/development/getting-started.md#design-tests).
