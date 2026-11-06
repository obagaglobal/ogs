# Development Standards

These standards apply to every change in this repository. CI enforces the automated ones.

## 1. Toolchain

| Tool    | Version     | Notes                                                   |
| ------- | ----------- | ------------------------------------------------------- |
| Node.js | 24.18.1     | Pinned in `.nvmrc`; `engines` allows `>=24.18.1 <25`.   |
| pnpm    | 11.21.0     | Pinned in `packageManager`; use Corepack or install it. |
| Docker  | Compose v2+ | Local infrastructure only.                              |

Use **pnpm only**. Never commit a `package-lock.json` or `yarn.lock`.

## 2. Quality gates

Run `pnpm check` before you push. It runs these in order:

1. `pnpm format:check`: Prettier
2. `pnpm lint`: ESLint, with zero warnings allowed
3. `pnpm typecheck`: `tsc` across all workspaces
4. `pnpm test`: Vitest across all workspaces

CI (`.github/workflows/ci.yml`) also runs `pnpm build`, validates the Prisma schema, and validates the Docker Compose file.

## 3. TypeScript

- `strict` is on, along with: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`/`Parameters`, and `verbatimModuleSyntax`. Do not relax these in a workspace tsconfig.
- Do not use `any`. Use `unknown` and narrow it.
- Do not use non-null assertions (`!`). Handle the `undefined` case explicitly.
- Validate data from outside the process (HTTP bodies, env, third-party APIs) with a Zod schema from `@ogs/contracts`. Casting it with `as` is not validation.
- ESM everywhere. In `apps/api` and `packages/*`, relative imports include the `.js` extension.

## 4. Linting and formatting

- ESLint is configured in `eslint.config.js` using `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, React Hooks, and React Refresh. Prettier owns formatting, and `eslint-config-prettier` turns off rules that would conflict with it.
- Prettier settings: single quotes, semicolons, trailing commas, 100-character lines, LF line endings.
- Use `eslint-disable` comments only on a single line, with a `--` reason. Unused disable comments are errors.

## 5. Naming and structure

| Item               | Convention                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| Files              | `kebab-case.ts` (Nest: `<name>.<role>.ts`, e.g. `health.controller.ts`) |
| React components   | `PascalCase` exports in `kebab-case.tsx` files                          |
| Tests              | Co-located `*.test.ts(x)`; API e2e tests in `apps/api/test/`            |
| Workspace packages | `@ogs/<name>`                                                           |
| Env variables      | `UPPER_SNAKE_CASE`; API ones are validated in `apiEnvSchema`            |

Backend features live in their own Nest module (`src/<feature>/`). Frontend features live in `src/features/<feature>/`. Code moves to `packages/` only once both apps need it.

## 6. Testing

- **Unit tests:** pure logic and services, with no network or database.
- **API e2e tests:** boot `AppModule` through `@nestjs/testing`, apply `configureApp`, and send requests with Supertest. They need no database: connections are lazy.
- **Integration tests** (`apps/api/test/integration/*.int.test.ts`, `pnpm test:integration`): real PostgreSQL and Redis, connecting as the real roles. Required for anything touching RLS, transactions, the outbox or queues. Create your own uniquely named fixtures; never rely on an empty database.
- **Web component tests:** Testing Library with jsdom. Query the way a user would (by role or text). Mock `fetch` at the boundary.
- Every bug fix comes with a test that fails without the fix.

## 7. Configuration and secrets

- Commit `.env.example` templates only. `.env` and `.env.*` files are git-ignored.
- Templates hold placeholders (`change-me-local-only`), never real credentials.
- `pnpm setup:env` creates missing `.env` files from the templates and never overwrites existing ones.
- Never log configuration values. The env validator reports variable names only.
- Docker services bind to `127.0.0.1`, and Compose fails to start if a required credential is not set.

## 8. Git workflow

- `main` is always releasable and protected by CI.
- Do work on short-lived branches, `type/short-description` (e.g. `feat/catalogue-listing`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`.
- Never force-push to `main`. Never commit secrets. If one is committed, rotate it immediately (rewriting history is not enough).

## 9. Dependencies

- Add a dependency only when it provides clear value that is hard to replicate. Say why in the PR description.
- Add it to the workspace that uses it, not to the root, unless it is repo-wide tooling.
- The lockfile (`pnpm-lock.yaml`) is committed. CI installs with `--frozen-lockfile`.
- Packages that need install scripts must be explicitly allowed in `pnpm-workspace.yaml`.

## 10. Database and multi-tenancy

These rules protect tenant isolation (review §5–§6, ADR-009/010). CI enforces the ones marked ✔.

**Access**

- ✔ Only `apps/api/src/database/` may import Prisma (`../generated/prisma`, `@prisma/*`) or `pg`. Everything else imports from `src/database/index.js` (ESLint `no-restricted-imports`).
- All application database work goes through `TenantDb.run(context, (db) => ...)`. The context is a required argument: `user`, `workspace`, `platform` (needs a reason, always audited) or `system` (worker jobs).
- Pass the `db` handle down to services. Never keep it after `run` returns, and never start a second `run` inside the first: one unit of work is one transaction.
- ✔ No `$queryRawUnsafe` / `$executeRawUnsafe`. Use the `$queryRaw` tagged template, which parameterises every value.
- Never run session-level `SET`, `SET ROLE`, `RESET`, `LISTEN`, session advisory locks or anything else that outlives a transaction. The context is transaction-local by design so pooled connections (Prisma's pool, PgBouncer in transaction mode) cannot leak it.
- The API and worker connect as `ogs_app` only. `ogs_owner` runs migrations; `ogs_maint` (BYPASSRLS) is for seeds and break-glass work and is never configured in the API.

**Schema changes**

- Create migrations with `prisma migrate dev --create-only`, then add the SQL Prisma cannot generate before applying:
  - ✔ `ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY` and at least one policy on every table (RLS catalogue test).
  - Explicit grants to `ogs_app` (there are no default privileges for it). ✔ Never `TRUNCATE`, `REFERENCES` or `TRIGGER`. Grant `DELETE` only where hard deletion is a deliberate design decision.
  - Policies read context only through `app.current_user_id()`, `app.current_tenant_id()`, `app.is_platform()`, `app.current_actor_kind()`.
  - A policy on table X must never query a table whose policy queries X (no recursion). Today `tenant_select` reads `membership`, so `membership` policies must not read `tenant`.
- RLS enforces **isolation** (whose rows). **Authorisation** (which actions a member may take) belongs in the API.
- `INSERT ... RETURNING` needs SELECT rights on the new row. Where the writer may not read back (audit log, outbox), insert with `createMany`.
- Prisma does not model partial indexes, CHECK constraints, triggers or policies; keep them in the migration SQL with a comment explaining why.
- IDs are UUIDv7 from PostgreSQL 18's `uuidv7()`. Times are `timestamptz`. Money (Phase 7+) is integer minor units.
- Never edit a migration that has reached `main`; add a new one.

**Audit and events**

- Record audit entries with `AuditService.record(db, …)` and publish events with `OutboxService.publish(db, …)` using the **same** `db` handle as the business change, so they commit or roll back together.
- The audit actor is filled by the database from the context; do not pass it. Audit metadata must not contain secrets (keys like `password`, `token`, `secret` are rejected).
- Event handlers must be idempotent on `eventId`: delivery is at least once.

**Tests**

- Any new tenant-owned table gets cases in `test/integration/isolation.int.test.ts` (read/update/insert/delete across tenants) in the same PR.

## 11. Endpoints and access control

- ✔ Every route declares exactly one of `@Public()`, `@Authenticated(...)` or `@RequirePermission(code)`; the API refuses to start otherwise, and permission codes must exist in `src/authz/catalogue.json`.
- Prefer `@RequirePermission`. Use `@Authenticated` only for the caller's own data (sessions, profile, workspace list). Use `@Public` only for sign-in flows and health.
- Never read a tenant or user id from the request to decide whose data to touch. Use `@Ctx()` (the granted `DbContext`) and `@Auth()` (the caller).
- **Always scope queries to `ctx.tenantId` as well.** RLS lets users see their _own_ rows in other tenants (e.g. their memberships), so "whatever RLS returns" is not the same as "this workspace's rows".
- A record from another tenant answers 404, never 403, so ids cannot be probed.
- Validate every body with a schema from `@ogs/contracts` via `parseBody`. Errors are `{ "error": "<code>" }`, with field paths but never values.
- New permissions: add them to `catalogue.json`, run `pnpm --filter @ogs/api docs:permissions`, and commit both.
- Any new tenant-scoped endpoint gets cases in `test/integration/api-isolation.int.test.ts` (foreign id → 404, foreign workspace header → 403, missing permission → 403).
- Mark sensitive actions with `@RequireRecentMfa(minutes)` (step-up). Credential and MFA changes, role changes and anything platform-wide need it.
- Cross-tenant staff features use `@RequireElevation(code)`, never `platform` contexts built by hand. The elevation carries the reason that `TenantDb` writes to the audit log.
- Files are uploaded only through `FileService` with a registered purpose (`src/files/file-purposes.ts`). Never serve object-store URLs directly; issue `downloadUrl` for `CLEAN` files.
