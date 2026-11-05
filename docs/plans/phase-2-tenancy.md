# Phase 2 Plan — Tenancy, RLS and Data Foundations

**Status:** DRAFT. Waiting for "Phase 2 approved."
**Based on:** [Architecture Review](../architecture/review.md) §4–§6 and §13, ADR-009, ADR-010, ADR-015 (D-7) and ADR-026.
**Starting point:** `main` @ `b01cf24` (Phase 1), plus `0d08dad` (decision records).

## 1. Goal

When Phase 2 ends, the database itself enforces tenant isolation. Isolation must hold even if application code is buggy, and pooled connections must never carry one request's tenant context into another. Every later phase builds on this guarantee, so Phase 2 delivers the plumbing, proves it with tests, and adds no business features.

## 2. Scope

### 2.1 Database roles and connection model

| Role           | Created by            | Used for                                                                                  |
| -------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `ogs_owner`    | role bootstrap script | Owns the schema and runs `prisma migrate`. Never used at runtime.                         |
| `ogs_app`      | role bootstrap script | API and worker. `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOINHERIT`, and not an owner.       |
| `ogs_readonly` | role bootstrap script | SELECT only, subject to RLS. Nothing uses it yet.                                         |
| `ogs_maint`    | role bootstrap script | `BYPASSRLS`. Used only for dev seeding and break-glass work. Never configured in the API. |

- **`infrastructure/docker/postgres/roles.sql`** creates the roles. It is idempotent (`DO` blocks) and takes passwords as psql variables. Two paths run it:
  - **New volume:** an initdb hook (`/docker-entrypoint-initdb.d`).
  - **Existing volume:** `pnpm db:roles`, which runs `docker compose exec postgres psql …`. No `psql` is needed on Windows.
- The compose superuser (`POSTGRES_USER`) is used only to bootstrap roles. Nothing else uses it.
- **Grants:** live in migrations. `ogs_owner` grants DML to `ogs_app` table by table, and `ALTER DEFAULT PRIVILEGES` covers future tables.
- **Environment:**
  - `DATABASE_URL` (as `ogs_app`) and `REDIS_URL` become **required** in `apiEnvSchema`.
  - A new `DATABASE_MIGRATION_URL` (as `ogs_owner`) is read only by `prisma.config.ts`.
  - A new `DATABASE_MAINT_URL` is read only by the dev seed script.
  - Root `.env.example` gains `OGS_OWNER_PASSWORD`, `OGS_APP_PASSWORD`, `OGS_READONLY_PASSWORD` and `OGS_MAINT_PASSWORD` placeholders.

### 2.2 Context GUCs and SQL helpers (first migration)

- **Context helpers:** schema `app`, with `STABLE` helper functions `app.current_user_id()`, `app.current_tenant_id()`, `app.is_platform()` and `app.actor_kind()`.
  - Each one reads `nullif(current_setting('app.x', true), '')`.
  - **Gotcha this handles:** once a transaction-local GUC has been set on a pooled session, it reverts to `''`, not NULL. A bare `''::uuid` cast would throw an error instead of failing closed.
- **Extensions:** `citext` for email.
- **IDs:** primary keys default to PostgreSQL 18's built-in `uuidv7()`, and the app may also supply one (see P2-5).

### 2.3 Tables introduced

All of these tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`.

| Table          | Owner class    | Notes                                                                                                                                                                                                                         | RLS (summary)                                                                                                                                                                              |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenant`       | itself         | `kind` (ORGANISATION, PROVIDER_COMPANY, PLATFORM) · `status` (PENDING_APPROVAL, ACTIVE, REJECTED, SUSPENDED, CLOSED) · `name` · `slug` · `version` · `deleted_at`. A partial unique index allows exactly one PLATFORM tenant. | Visible when `id = current tenant`, when the current user has a membership in it (the workspace list), or under platform context.                                                          |
| `app_user`     | user           | **Minimal:** `id`, `email citext unique`, `status`, timestamps. Credentials, profile and MFA come in Phase 3.                                                                                                                 | `id = current user`, or platform.                                                                                                                                                          |
| `membership`   | tenant         | `tenant_id`, `user_id`, `status` (INVITED, ACTIVE, SUSPENDED, ENDED), `joined_at`, `ended_at`, `version`. Unique on `(tenant_id, user_id)`.                                                                                   | `tenant_id = current tenant`, or `user_id = current user`, or platform. This policy never queries `tenant`, so policies cannot recurse.                                                    |
| `audit_log`    | tenant or none | `occurred_at`, `actor_user_id`, `actor_kind`, `tenant_id?`, `action`, `entity_type`, `entity_id`, `request_id`, `ip`, `user_agent`, `metadata jsonb`.                                                                         | INSERT checks `tenant_id` against context. SELECT is limited to own tenant, or platform. `ogs_app` has **INSERT and SELECT only**, and a trigger rejects UPDATE and DELETE for every role. |
| `outbox_event` | tenant or none | `type`, `payload jsonb`, `tenant_id?`, `occurred_at`, `available_at`, `dispatched_at?`, `attempts`, `last_error`.                                                                                                             | INSERT is allowed under the writer's own context. SELECT and UPDATE are allowed only when `app.actor_kind() = 'system'`, which only the dispatcher sets.                                   |

Rationale for including `app_user` and `membership` in Phase 2:

- RLS needs real tenant-owned and user-owned rows to prove isolation.
- The workspace resolver needs memberships to validate against.

These tables have **no** HTTP endpoints in this phase.

The assignment-grant branch from ADR-010 is **not** written in this phase because `ServiceAssignment` does not exist until Phase 9. The policy helper pattern is designed so that branch can be added there.

### 2.4 `TenantDb` (apps/api/src/database/)

- **Prisma client:** Prisma 7 `prisma-client` with `@prisma/adapter-pg`. `PrismaService` is the only place a `PrismaClient` is constructed.
- **API:**
  - `tenantDb.run(ctx, (tx) => …)` opens one interactive transaction.
  - Its first statement sets every GUC in one round-trip: `select set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true), …`.
  - Business code only ever sees `tx`.
- **`DbContext`** is a discriminated union:
  - `user` (userId only)
  - `workspace` (userId + tenantId)
  - `platform` (userId plus a required `reason`, and writes an audit row for the unit of work)
  - `system` (worker jobs, with a named `job`)
- **Context is passed explicitly**, with no AsyncLocalStorage, so a missing context is a type error rather than a silent default.
- **Lint rule:** an ESLint `no-restricted-imports` rule bans importing `src/generated/prisma` outside `src/database/`.
- **Banned:** session-level `SET`, `$queryRawUnsafe` and advisory session locks. These are enforced by lint where possible and documented in `standards.md`.

### 2.5 Workspace context resolver (service only)

- **`WorkspaceContextService.resolve(userId, requested: 'personal' | tenantId)`** turns a requested workspace into a `DbContext`:
  - It validates that the membership is ACTIVE and checks the tenant's status.
  - A tenant in PENDING_APPROVAL, REJECTED or SUSPENDED gets a **restricted** context.
  - Anything else is refused.
- It is tested directly. The HTTP guard that reads `X-OGS-Workspace` needs a session to exist, so it is wired in Phase 3 (see P2-1).

### 2.6 D-7 foundations moved into Phase 2

- **AuditService:**
  - `audit.record(tx, entry)` writes in the **same transaction** as the change it describes.
  - It never receives secrets. A metadata allowlist and a test enforce this.
- **Outbox:**
  - `outbox.publish(tx, event)` writes in the same transaction as the change.
  - The dispatcher, running in the worker, works in `system` context:
    1. It claims rows with `FOR UPDATE SKIP LOCKED LIMIT n`.
    2. It enqueues each row to BullMQ with `jobId = event.id`, which deduplicates.
    3. It sets `dispatched_at`.
  - Delivery is at least once, so consumers must be idempotent on the event id.
  - Retries use exponential backoff, and a dead-letter queue is visible in logs.
- **Worker process:**
  - A new `apps/api/src/worker.ts` entry point uses `NestFactory.createApplicationContext(WorkerModule)` and runs the same modules as the API without HTTP.
  - `pnpm dev` starts the API, worker and web together. `pnpm dev:worker` starts the worker alone.
  - A no-op `system.ping` consumer proves the pipeline end to end.
- **Redis module:** one shared `ioredis` connection factory for BullMQ, later sessions, and readiness checks.

### 2.7 Carry-overs from Phase 1

- **API versioning:** add URI versioning (`/api/v1/...`) before any business endpoint exists (see P2-3). Health moves to `/api/v1/health`, and the web client and tests are updated with it.
- **Readiness:** `GET /api/v1/health/ready` checks PostgreSQL (as `ogs_app`) and Redis. It returns 503 with per-dependency status, and never includes error details or connection strings. Liveness stays dependency-free.

### 2.8 Developer workflow (Windows PowerShell first)

New root scripts:

- `pnpm db:roles`
- `pnpm db:migrate` (`prisma migrate deploy` as owner)
- `pnpm db:migrate:dev`
- `pnpm db:seed` (as `ogs_maint`): the PLATFORM tenant, two organisations, one provider company and four users with memberships
- `pnpm db:reset` (dev only, refuses when `NODE_ENV=production`)
- `pnpm test:integration`

README and `docs/development/getting-started.md` are updated with these PowerShell steps. Integration tests use a separate `ogs_test` database, so dev data is never touched.

## 3. Out of scope (explicitly)

- **Phase 3:**
  - Authentication, sessions, credentials, MFA, roles, permissions and any login.
  - FileService and MinIO (see P2-2).
- **Phase 4:** tenant and membership HTTP endpoints, invitations and departments.
- **Phase 9:** the assignment-grant RLS branch (ADR-010).
- **Phase 15:** NGINX, production role provisioning and PgBouncer deployment.
- **Not this phase:** UI changes, beyond pointing the health widget at `/api/v1`.

## 4. Tests: what proves Phase 2 is done

Integration tests run against real PostgreSQL 18 and Redis 8 (compose locally, service containers in CI).

| #   | Test                         | Proves                                                                                                                                                                                                                    |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Pool leak**                | With pool size 1: run tenant A's unit of work, then query with no context → 0 rows. Repeat after a unit of work that **throws** (rollback path).                                                                          |
| T2  | **Fail closed**              | With no context, every RLS table returns 0 rows, and inserts are rejected.                                                                                                                                                |
| T3  | **Cross-tenant matrix**      | Under tenant A's context, raw SQL as `ogs_app` cannot read, update or delete B's rows (0 rows affected), and inserting a row with `tenant_id = B` raises an RLS violation. Covers every tenant table.                     |
| T4  | **Role hardening**           | `ogs_app` is not superuser and lacks BYPASSRLS. It cannot `SET ROLE ogs_owner` or `ogs_maint`, cannot `ALTER TABLE … DISABLE/NO FORCE ROW LEVEL SECURITY`, and `SET row_security = off` errors instead of returning rows. |
| T5  | **Catalogue guard** (CI)     | Every table in `public`, except an explicit allowlist (`_prisma_migrations`), has `relrowsecurity` and `relforcerowsecurity` set and at least one policy. A new table without RLS fails CI.                               |
| T6  | **Concurrent mixed tenants** | 200 interleaved units of work across 3 tenants on a pool of 5. Each sees only its own rows.                                                                                                                               |
| T7  | **Audit immutability**       | UPDATE and DELETE on `audit_log` fail for `ogs_app` and `ogs_owner`. An audit row from a rolled-back transaction does not exist.                                                                                          |
| T8  | **Outbox**                   | Committed change → exactly one event, and a rolled-back change → none. Two dispatchers racing → each event is enqueued once. A failing consumer retries with backoff, then lands in the DLQ.                              |
| T9  | **Workspace resolver**       | Active membership in an active tenant → workspace context. Pending or suspended tenant → restricted context. Ended membership, or a tenant the user doesn't belong to → refused.                                          |
| T10 | **Platform context**         | Platform reads require a reason and write an audit row. `system` context can read `outbox_event` but no other tenant table.                                                                                               |
| T11 | **Readiness**                | `/api/v1/health/ready` returns 200 when both dependencies are up, and 503 with the right component flagged when either is down.                                                                                           |
| T12 | **Lint guard**               | Importing the generated Prisma client from a feature module fails `pnpm lint`.                                                                                                                                            |

**CI changes:**

- A new `integration` job adds `postgres:18-alpine` and `redis:8-alpine` services.
- It runs `roles.sql`, then `migrate deploy` as `ogs_owner`, then `pnpm test:integration` as `ogs_app`.
- It is required on PRs.

The existing `verify` job is unchanged.

## 5. Acceptance criteria

1. Every T1–T12 test passes locally on Windows and in CI.
2. A clean clone followed by the README PowerShell steps yields a working stack: roles, migrations, seed, then API, worker and web all running.
3. `pnpm check` passes (format, lint, typecheck, unit tests).
4. Neither `.env.example` file contains a real secret, and `DATABASE_URL` points at `ogs_app`, never the superuser.
5. No authentication or business endpoints exist.
6. `docs/architecture/overview.md`, `docs/development/standards.md` (database rules) and `docs/DECISIONS.md` are updated for any decision taken below.

## 6. Delivery steps (one reviewable commit each)

1. Roles bootstrap, env schema changes, `.env.example` updates and `pnpm db:roles`.
2. First migration: `app` schema helpers, tables, policies, grants and the audit trigger.
3. `PrismaService`, `TenantDb`, `DbContext` and the lint ban. Tests T1–T6 and T12.
4. `WorkspaceContextService` and platform and system contexts. Tests T9 and T10.
5. AuditService. Test T7.
6. Redis module, worker entry point, outbox and dispatcher. Test T8.
7. `/api/v1` versioning and readiness endpoint. Test T11, plus the web health-widget update.
8. Seed, `db:*` scripts, CI integration job and docs.

Work happens on branch `phase-2/tenancy` and is opened as a PR to `main`.

## 7. Decisions needed before starting

| ID   | Question                                       | Recommendation                                                                                                                     | Why                                                                                                                                                                 |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | Review §13 asks for isolation proven "via API" | Prove it at the **database and service layer** in Phase 2. Add the API-level isolation suite in Phase 3, once real sessions exist. | The only alternative is a test-only "fake auth" header in production code, which is a risk to remove later. Database-level tests are the stronger guarantee anyway. |
| P2-2 | FileService and MinIO: Phase 2 or 3?           | **Phase 3**                                                                                                                        | It keeps Phase 2 focused on isolation. The first upload (provider documents, Phase 5) is still well ahead.                                                          |
| P2-3 | Introduce `/api/v1` now?                       | **Yes**                                                                                                                            | Free now, breaking later. It matches review §13.                                                                                                                    |
| P2-4 | Minimal `app_user` table in Phase 2?           | **Yes** (id, email, status only)                                                                                                   | Membership and user-owned RLS cannot be tested without it. Phase 3 extends it.                                                                                      |
| P2-5 | UUIDv7 source                                  | **PostgreSQL 18 `uuidv7()` default**, and the app may also supply IDs                                                              | No extra dependency, and the IDs are still time-ordered. Small deviation from the review's "generated in app".                                                      |

## 8. Risks

- **Prisma interactive transactions with a driver adapter:** these add latency per request (accepted in ADR-026). T6 doubles as a smoke benchmark, and its p95 is recorded in the PR.
- **Existing dev volumes:** the initdb hook does not run on them, so `pnpm db:roles` covers that case and the README calls it out.
- **Prisma's generated migrations never contain RLS:** T5 is the safety net. Every migration that adds a table must hand-edit its policies (`--create-only`).
