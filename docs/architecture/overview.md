# Architecture Overview

> Status: Phase 3A (identity, sessions and access control) on top of Phase 2 (tenancy and RLS). This document describes what exists today and the intended direction. Planned items are marked **(planned)** and are not implemented.

## 1. Product context

OGS (ObagaGlobal Services) is a multi-tenant business services platform owned by ObagaGlobal. Over the coming phases it will serve:

| Actor                         | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| Individual customer           | A person buying services for themselves.                      |
| Organisation / company portal | A tenant with its own members, approvals and service history. |
| External individual provider  | A freelancer delivering services through OGS.                 |
| External company provider     | A partner company delivering services through OGS.            |
| Internal OGS employee         | ObagaGlobal staff who operate and deliver services.           |

Cross-cutting capabilities **(planned)**: a public service catalogue, hybrid delivery (internal and external providers on one engagement), and organisation approval workflows.

Phases 1–2 implement **none** of these business capabilities. They provide the engineering foundation and the tenant-isolation layer every feature is built on.

## 2. System context

```
 Browser ──HTTP──▶ apps/web (React SPA, Vite)
                       │  /api/* (dev: Vite proxy)
                       ▼
                   apps/api (NestJS, HTTP) ──▶ PostgreSQL 18 (as ogs_app, RLS enforced)
                                           └─▶ Redis 8 (readiness; sessions in Phase 3)
                   apps/api worker (same code, no HTTP)
                     ├─ outbox dispatcher: outbox_event ──▶ BullMQ queue "ogs-events"
                     └─ event consumer:    BullMQ ──▶ handlers (retry → dead-letter queue)
```

The API and the worker are two processes built from the same `apps/api` code (`dist/main.js`, `dist/worker.js`). The API never runs queue loops; the worker never serves HTTP.

In development, the web dev server (port 5173) proxies `/api/*` to the API (port 3000), so the browser only ever talks to one origin. PostgreSQL and Redis run in Docker via `infrastructure/docker/compose.yaml`.

## 3. Monorepo layout

| Path                    | Package          | Responsibility                                            |
| ----------------------- | ---------------- | --------------------------------------------------------- |
| `apps/api`              | `@ogs/api`       | NestJS HTTP API. Owns all business logic and data access. |
| `apps/web`              | `@ogs/web`       | React SPA. Presentation only; talks to the API over HTTP. |
| `packages/contracts`    | `@ogs/contracts` | Shared Zod schemas and the types inferred from them.      |
| `infrastructure/docker` | n/a              | Local development infrastructure (Docker Compose).        |
| `docs`                  | n/a              | Architecture and development documentation.               |
| `scripts`               | n/a              | Repository automation (e.g. `setup-env.mjs`).             |
| `.github/workflows`     | n/a              | Continuous integration.                                   |

### Dependency rules

```
apps/web ─┐
          ├──▶ @ogs/contracts ──▶ zod
apps/api ─┘
```

- Apps may depend on packages. Packages never depend on apps.
- `apps/web` and `apps/api` never import from each other. They share contracts only through `@ogs/contracts`.
- Every contract is a Zod schema; its TypeScript type is derived with `z.infer`, never written by hand, so the runtime check and the static type cannot drift apart.
- Strict compiler settings live once in the root `tsconfig.base.json`. Each workspace extends it and adds only its environment-specific options (Node types, DOM/JSX, decorators). A separate shared-config package will be introduced only if those overrides start to repeat.
- Add a new shared package only when there is a concrete second consumer and a clear boundary; prefer extending `@ogs/contracts` otherwise.
- Shared packages are compiled to ESM in `dist/` (with `.d.ts`). That is why root scripts run `build:packages` before `dev`, `typecheck` and `test`.

## 4. Backend (`apps/api`)

- **NestJS 12**, native ESM (`"type": "module"`, `module: NodeNext`). Relative imports use `.js` extensions.
- **Configuration:** `@nestjs/config` loads `apps/api/.env`, then validates it with `parseApiEnv` from `@ogs/contracts`. Invalid configuration stops startup with an error that names the invalid variables but never shows their values. `TypedConfigService` gives type-safe access.
- **Network binding:** the API listens on `API_HOST` (default `127.0.0.1`), so in development it is not reachable from other machines. Set `API_HOST=0.0.0.0` deliberately when running inside a container.
- **HTTP setup** is in `src/app.factory.ts` (`configureApp`), shared by `main.ts` and the e2e tests. It sets:
  - the global prefix `/api`
  - a CORS allow-list from `API_CORS_ORIGINS`
  - `x-powered-by` turned off
  - graceful shutdown hooks
- **Versioning:** URI versioning; every route lives under `/api/v1/` unless a controller declares another version.
- **Health:** `GET /api/v1/health` is **liveness** only and probes nothing. `GET /api/v1/health/ready` is **readiness**: 200 when PostgreSQL and Redis answer within their timeouts, 503 naming the failed dependency. Neither ever returns error details. Both send `Cache-Control: no-store`.
- **Feature modules:** each capability gets its own Nest module under `src/<feature>/` (controller, service, module, tests). `health/` is the reference example.
- **Prisma 7** with the `prisma-client` generator (ESM, output `src/generated/prisma`, git-ignored, generated by `build:packages`) and the `@prisma/adapter-pg` driver adapter. `prisma.config.ts` reads `DATABASE_MIGRATION_URL` (ogs_owner); the running API reads only `DATABASE_URL` (ogs_app).
- **Module map:**

  | Module           | Responsibility                                                                                                                                 |
  | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | `database/`      | `PrismaService` (internal), `TenantDb` (the only door to the database), `DbContext`, readiness probe. Public surface: `database/index.ts`.     |
  | `redis/`         | Lazy ioredis connections: BullMQ, sessions, rate limits, readiness.                                                                            |
  | `access/`        | The global `AccessGuard`, access decorators (`@Public`, `@Authenticated`, `@RequirePermission`, `@Auth`, `@Ctx`) and the start-up route check. |
  | `identity/`      | Registration, sign-in, password reset/change, lockout, rate limits, Argon2id hashing, breached-password policy. `/api/v1/auth/*`.              |
  | `sessions/`      | Redis session store and the session cookie.                                                                                                    |
  | `authz/`         | Permission catalogue (`catalogue.json`), start-up sync of system roles, effective permissions of a membership.                                 |
  | `notifications/` | Worker only: identity emails rendered from outbox events and sent over SMTP.                                                                   |
  | `tenancy/`       | `WorkspaceContextService` (requested workspace → granted `DbContext`), `/me/workspaces`, `/workspace`, `/workspace/members`.                   |
  | `audit/`         | `AuditService.record(db, entry)`: append-only, same transaction as the change.                                                                 |
  | `events/`        | `OutboxService.publish(db, event)` (API + worker); dispatcher, BullMQ queue and consumer (worker only).                                        |
  | `health/`        | Liveness and readiness.                                                                                                                        |

  `CoreModule` (config, database, Redis, audit, events) is shared by `AppModule` (HTTP) and `WorkerModule`. The worker additionally loads `NotificationsModule`; only the API loads `AccessModule`, `IdentityModule` and `AuthzModule`.

## 5. Frontend (`apps/web`)

- **React 19 + Vite 8 + TypeScript.** Tailwind CSS 4 is wired in through `@tailwindcss/vite`, so there is no `tailwind.config.js`.
- **shadcn/ui:** set up in `components.json` (new-york style, neutral base, CSS variables in `src/index.css`). The `cn()` helper lives in `src/lib/utils.ts`. Generated primitives go in `src/components/ui/`, which currently contains only `button.tsx`. Add more with `pnpm dlx shadcn@latest add <component>` from `apps/web`.
- **Structure:** feature folders in `src/features/<feature>/` hold that feature's components and hooks. `system-status/` is the reference example: it calls `/api/v1/health` and checks the response against the shared schema at runtime.
- **Path alias:** `@/` maps to `src/` (set in `tsconfig.app.json` and `vite.config.ts`).
- **Environment:** only `VITE_`-prefixed variables reach the browser, and they are public. `API_PROXY_TARGET` is read by the dev server only.

## 6. Multi-tenancy and data isolation

Designed in the [Architecture Review](review.md) §4–§6 and ADR-009/010; implemented in Phase 2. Database rules for contributors are in [standards §10](../development/standards.md#10-database-and-multi-tenancy).

**Ownership.** One shared schema. Every row has an explicit owner: platform (no owner column), tenant (`tenant_id`) or user (`owner_user_id`, `customer_user_id`, ADR-009). A `tenant` row exists for each organisation, provider company and the single PLATFORM tenant (enforced by a partial unique index).

**Roles.**

| Role           | Used by               | Key property                                                                        |
| -------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `ogs_owner`    | migrations            | owns the schema; FORCE RLS applies to it too                                        |
| `ogs_app`      | API + worker          | NOBYPASSRLS, NOINHERIT, owns nothing, explicit per-table grants, no DELETE/TRUNCATE |
| `ogs_readonly` | reporting (later)     | SELECT through RLS                                                                  |
| `ogs_maint`    | dev seed, break-glass | BYPASSRLS; never configured in the API                                              |

Roles and the `ogs_test` database are created by `infrastructure/docker/postgres/init/00-ogs-roles.sh` (initdb hook + `pnpm db:roles`).

**Context.** `TenantDb.run(ctx, work)` opens one interactive transaction whose first statement sets `app.user_id`, `app.tenant_id`, `app.is_platform` and `app.actor_kind` with `set_config(..., true)` (transaction-local). Policies read them through `app.*()` helper functions that map both "never set" and "reverted to ''" to NULL, so a missing context matches no rows. Context kinds:

| `DbContext` | Sees                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `user`      | own `app_user` row, own memberships, tenants they belong to                                           |
| `workspace` | the tenant's rows (+ the user's own rows). `restricted` when the tenant is pending/rejected/suspended |
| `platform`  | everything; requires a reason; every use writes `platform.context_used` to the audit log              |
| `system`    | outbox (dispatcher) and, if given a tenant, that tenant's rows; never user data                       |

**Workspace resolution.** `WorkspaceContextService` grants a `workspace` context only for an ACTIVE membership in a tenant that is not CLOSED or deleted. A PLATFORM-tenant membership gives an ordinary workspace context; cross-tenant `platform` context is a separate, permission-gated elevation (Phase 3+).

**Audit log.** Append-only: a trigger rejects UPDATE, DELETE and TRUNCATE for every role, and `ogs_app` holds only SELECT and INSERT. The actor columns default from the context and the insert policy rejects any other value.

**Outbox.** Events are inserted in the business transaction (no RETURNING; only `system` context may read them). The worker claims batches with `FOR UPDATE SKIP LOCKED`, enqueues with `jobId = event id`, then marks them dispatched — at-least-once delivery, idempotent handlers. Failed handlers retry with exponential backoff; after the last attempt the event goes to the `ogs-events-dead` queue.

**Proof.** `apps/api/test/integration` (CI job "Integration tests") covers: pool-of-one context leak (incl. rollback), fail-closed without context, a cross-tenant read/update/delete/insert/move matrix, role hardening, an RLS catalogue guard for every table, 200 concurrent mixed-tenant transactions, audit immutability, outbox atomicity and racing dispatchers, workspace resolution and readiness.

**Not yet:** the assignment-grant branch for providers (ADR-010) arrives with `ServiceAssignment` in Phase 9.

## 7. Identity, sessions and access

Planned in the [Phase 3 plan](../plans/phase-3-identity.md) §2 (Phase 3A). Permission codes and roles: [permissions.md](permissions.md).

**Request pipeline.** Every request passes one global `AccessGuard`:

1. The route must declare `@Public()`, `@Authenticated({ workspace?, allowUnverified?, allowRestricted? })` or `@RequirePermission(code)`. A route without one makes the API refuse to start (default deny).
2. Unsafe requests with a body must be `application/json`, so cross-site forms are refused (415).
3. The session comes from the `ogs_session` cookie (`__Host-ogs_session` in production; HttpOnly, SameSite=Lax), checked in Redis. Unsafe requests also need `X-CSRF-Token` equal to the session's token.
4. The user is reloaded: suspended or deleted users lose every session. Unverified users only reach routes marked `allowUnverified`.
5. The workspace comes from `X-OGS-Workspace` (default `personal`). `WorkspaceContextService` grants it only for an ACTIVE membership; pending, rejected and suspended tenants get a restricted context.
6. Permissions are the union of the membership's roles, loaded fresh for every request. Removing a role or a membership takes effect on the next request.

Controllers receive the granted `DbContext` through `@Ctx()` and the caller through `@Auth()`. They never read tenant ids from the client.

**Identity data** (`credential`, `user_token`, `authentication_event`) is reachable only from `system` contexts running an `identity.*` job (`app.job` setting). No user or tenant context can read a password hash or token, even its own. Emails are outbox events. The worker mints the token, keeps only its SHA-256, sends through SMTP (Mailpit in development) and records delivery per event.

**Endpoints (Phase 3A).**

| Method and path                                                                        | Access                                   | Purpose                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `POST /auth/register`                                                                  | public                                   | Create an account (202 whether new or not)                |
| `POST /auth/verify-email`                                                              | public                                   | Confirm the email with the emailed token                  |
| `POST /auth/resend-verification`                                                       | signed in, unverified ok                 | Send the confirmation email again                         |
| `POST /auth/login` / `POST /auth/logout`                                               | public / signed in                       | Start / end a session                                     |
| `POST /auth/password/forgot` / `POST /auth/password/reset`                             | public                                   | Reset by email (202 always / signs out everywhere)        |
| `POST /auth/password/change`                                                           | signed in                                | New password; other sessions signed out, this one rotated |
| `GET /auth/csrf` / `GET /auth/session`                                                 | signed in                                | CSRF token / who am I                                     |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others` | signed in                                | Manage own sessions                                       |
| `GET /me/workspaces`                                                                   | verified                                 | Workspace switcher                                        |
| `GET /workspace`                                                                       | verified, any workspace incl. restricted | Current workspace, roles and permissions                  |
| `GET /workspace/members`, `GET /workspace/members/:id`                                 | `membership.read`                        | Members of the current tenant                             |

Errors are always `{ "error": "<code>" }`, for example `invalid_credentials`, `email_unverified`, `csrf_invalid`, `workspace_forbidden`, `workspace_restricted`, `permission_denied` or `rate_limited` (with `Retry-After`).

**Proof.** The integration suites `auth-flows` (A1–A7, A11, A12) and `api-isolation` (A9, A10) run the API and worker in-process against PostgreSQL, Redis and Mailpit.

## 8. Architecture decisions

| ID  | Decision                                                                  | Status                    |
| --- | ------------------------------------------------------------------------- | ------------------------- |
| 001 | pnpm workspace monorepo (apps + packages)                                 | Accepted                  |
| 002 | Shared packages compiled to ESM `dist/` (not consumed as raw TS)          | Accepted                  |
| 003 | TypeScript 6.0.x (TS 7 not yet supported by `typescript-eslint`/Nest CLI) | Accepted                  |
| 004 | Zod for shared runtime validation (API contracts + env)                   | Accepted                  |
| 005 | Vitest for all test suites (Nest decorators via Vite's Oxc transformer)   | Accepted                  |
| 006 | Health endpoint is liveness-only until data dependencies exist            | Accepted                  |
| 008 | One shared package (`@ogs/contracts`); types inferred from Zod schemas    | Accepted                  |
| 007 | Multi-tenancy model                                                       | Superseded by ADR-009/010 |

ADR-009 … ADR-026 (from the approved [Architecture Review](review.md)) are recorded in [`docs/DECISIONS.md`](../DECISIONS.md).
Phase 2 implementation decisions (P2-1 … P2-5) are ADR-027 … ADR-031 in the same file.
