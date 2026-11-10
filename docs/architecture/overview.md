# Architecture Overview

> Status: Phase 7 complete (service requests, quotations, orders, manual payments) on top of Phases 2–6 (tenancy, RLS, identity, access control, organisations, providers, catalogue).

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
  | `platform/`      | Platform elevation (`POST /platform/elevate`) and elevated routes (`GET /platform/tenants`).                                                   |
  | `files/`         | `FileService` (purposes, type sniffing, quarantine), `ObjectStorage` (S3), `FileScanHandler` + `FileScanner` (worker).                         |
  | `tenancy/`       | `WorkspaceContextService` (requested workspace → granted `DbContext`), `/me/workspaces`, `/workspace`, `/workspace/members`.                   |
  | `audit/`         | `AuditService.record(db, entry)`: append-only, same transaction as the change.                                                                 |
  | `events/`        | `OutboxService.publish(db, event)` (API + worker); dispatcher, BullMQ queue and consumer (worker only).                                        |
  | `health/`        | Liveness and readiness.                                                                                                                        |

  `CoreModule` (config, database, Redis, audit, events) is shared by `AppModule` (HTTP) and `WorkerModule`. The worker additionally loads `NotificationsModule`; only the API loads `AccessModule`, `IdentityModule` and `AuthzModule`.

## 5. Frontend (`apps/web`)

- **React 19 + Vite 8 + TypeScript.** Tailwind CSS 4 is wired in through `@tailwindcss/vite`, so there is no `tailwind.config.js`.
- **shadcn/ui:** set up in `components.json` (new-york style, neutral base, CSS variables in `src/index.css`). The `cn()` helper lives in `src/lib/utils.ts`. Generated primitives go in `src/components/ui/`, which currently contains only `button.tsx`. Add more with `pnpm dlx shadcn@latest add <component>` from `apps/web`.
- **Structure:** feature folders in `src/features/<feature>/` hold that feature's components and hooks: `auth/` (sign-in, sign-up, email links, MFA, security page), `workspace/` (switcher, dashboard), `organisation/` and `members/` (Phase 4), `provider/` (Phase 5: application, profile & skills, coverage, availability, and the skill, county and weekly-hours pickers), `platform/` (staff review queue, organisation and provider review, eligibility search, skills taxonomy, all behind the elevation gate) and `system-status/` (`/status`). `src/app/app-shell.tsx` holds the signed-in shell and the redirects the API dictates (MFA owed → `/mfa`, enrolment required → `/mfa/setup`, email unverified → `/verify-email/pending`).
- **Data:** React Router 8 and TanStack Query 5. `src/lib/api.ts` is the only HTTP client. It sends JSON, the CSRF token on unsafe requests and `X-OGS-Workspace`, and turns error bodies into `ApiError(code)`. Forms validate with the same Zod schemas as the API.
- **Tests:** component tests mock `fetch` per route (`src/test/render-app.tsx`). `e2e/` holds the Playwright journeys (`pnpm test:e2e`): sign-up to workspace, the organisation journey, and the provider journey.
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

| `DbContext` | Sees                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`      | own `app_user` row, own memberships, tenants they belong to                                                                                   |
| `provider`  | the person's individual-provider rows and the jobs assigned to that provider (`app.provider_id`, Phase 9); never their personal customer rows |
| `workspace` | the tenant's rows (+ the user's own rows). `restricted` when the tenant is pending/rejected/suspended                                         |
| `platform`  | everything; requires a reason; every use writes `platform.context_used` to the audit log                                                      |
| `system`    | outbox (dispatcher) and, if given a tenant, that tenant's rows; never user data                                                               |

**Workspace resolution.** `WorkspaceContextService` grants a `workspace` context only for an ACTIVE membership in a tenant that is not CLOSED or deleted. A PLATFORM-tenant membership gives an ordinary workspace context; cross-tenant `platform` context is a separate, permission-gated elevation (Phase 3+).

**Audit log.** Append-only: a trigger rejects UPDATE, DELETE and TRUNCATE for every role, and `ogs_app` holds only SELECT and INSERT. The actor columns default from the context and the insert policy rejects any other value.

**Outbox.** Events are inserted in the business transaction (no RETURNING; only `system` context may read them). The worker claims batches with `FOR UPDATE SKIP LOCKED`, enqueues with `jobId = event id`, then marks them dispatched — at-least-once delivery, idempotent handlers. Failed handlers retry with exponential backoff; after the last attempt the event goes to the `ogs-events-dead` queue.

**Proof.** `apps/api/test/integration` (CI job "Integration tests") covers: pool-of-one context leak (incl. rollback), fail-closed without context, a cross-tenant read/update/delete/insert/move matrix, role hardening, an RLS catalogue guard for every table, 200 concurrent mixed-tenant transactions, audit immutability, outbox atomicity and racing dispatchers, workspace resolution and readiness.

**Assignment grants (Phase 9, ADR-063).** Providers reach work only through the job tables, and only while they hold an ACTIVE assignment (or a PENDING offer); they have no policy on any customer table. See §13.

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

**MFA and step-up (Phase 3B).** TOTP with sealed secrets (`MFA_ENCRYPTION_KEYS`), a replay guard and 10 recovery codes. When MFA is on, sign-in creates an `mfaPending` session that only reaches `/auth/mfa/verify`, `/auth/session`, `/auth/csrf` and sign-out. Platform members and `org_admin`/`provider_admin` must enrol: until they do, every other route answers `mfa_enrollment_required`. `@RequireRecentMfa(minutes)` demands a TOTP check within the window and answers `step_up_required` otherwise (`POST /auth/mfa/step-up`).

**Platform elevation (review §6.3).** A PLATFORM member with `platform.cross_tenant_access` who has stepped up calls `POST /platform/elevate { reason, tenantId? }`. That gives a 15-minute elevation stored on the session. Routes marked `@RequireElevation(code)` need the elevation id in `X-OGS-Elevation` and the permission in the PLATFORM workspace. They then run in a `platform` `DbContext`, and `TenantDb` audits each unit of work with the reason.

**Files.** Each upload declares a purpose, which fixes its owners, size limit and allowed types. The type is sniffed from the bytes. The object goes to a private S3 bucket under a random key, and the file stays `QUARANTINED` until the worker's scanner (integrity and type now, ClamAV later) marks it `CLEAN` or `REJECTED`. Downloads are 60-second presigned `attachment` URLs, issued only for `CLEAN` files visible to the caller's RLS context and owned by the acting workspace or user.

**Endpoints (Phase 3).**

| Method and path                                                                        | Access                                               | Purpose                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /auth/register`                                                                  | public                                               | Create an account (202 whether new or not)                       |
| `POST /auth/verify-email`                                                              | public                                               | Confirm the email with the emailed token                         |
| `POST /auth/resend-verification`                                                       | signed in, unverified ok                             | Send the confirmation email again                                |
| `POST /auth/login` / `POST /auth/logout`                                               | public / signed in                                   | Start / end a session                                            |
| `POST /auth/password/forgot` / `POST /auth/password/reset`                             | public                                               | Reset by email (202 always / signs out everywhere)               |
| `POST /auth/password/change`                                                           | signed in                                            | New password; other sessions signed out, this one rotated        |
| `GET /auth/csrf` / `GET /auth/session`                                                 | signed in                                            | CSRF token / who am I                                            |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others` | signed in                                            | Manage own sessions                                              |
| `GET /me/workspaces`                                                                   | verified                                             | Workspace switcher                                               |
| `GET /workspace`                                                                       | verified, any workspace incl. restricted             | Current workspace, roles and permissions                         |
| `GET /workspace/members`, `GET /workspace/members/:id`                                 | `membership.read`                                    | Members of the current tenant                                    |
| `GET /auth/mfa`, `POST /auth/mfa/totp/setup`, `POST /auth/mfa/totp/confirm`            | signed in (enrolment allowed)                        | MFA status and enrolment                                         |
| `POST /auth/mfa/verify`                                                                | MFA pending                                          | Second step of sign-in (code or recovery code)                   |
| `POST /auth/mfa/step-up`, `POST /auth/mfa/recovery-codes`, `DELETE /auth/mfa`          | signed in (+ step-up for the last two)               | Step-up, new recovery codes, turn MFA off (refused if mandatory) |
| `POST /platform/elevate`, `POST /platform/elevation/end`                               | `platform.cross_tenant_access` + step-up / signed in | Start / end an elevation                                         |
| `GET /platform/tenants`                                                                | elevation + `platform.tenant.review`                 | Every tenant (or the elevation's one)                            |

Errors are always `{ "error": "<code>" }`, for example `invalid_credentials`, `email_unverified`, `csrf_invalid`, `workspace_forbidden`, `workspace_restricted`, `permission_denied`, `mfa_required`, `mfa_enrollment_required`, `step_up_required`, `elevation_required`, `invalid_mfa_code` or `rate_limited` (with `Retry-After`).

**Proof.** The integration suites `auth-flows` (A1–A7, A11, A12), `api-isolation` (A9, A10), `mfa-platform` (B1–B3) and `files` (B4) run the API and worker in-process against PostgreSQL, Redis, Mailpit and the object store. The Playwright test (B5) runs the whole first-run journey in Chromium. The ASVS L2 self-assessment is in [`docs/security/asvs-phase3.md`](../security/asvs-phase3.md).

## 8. Organisations (Phase 4)

Planned in the [Phase 4 plan](../plans/phase-4-organisations.md).

**Application lifecycle.** A verified user registers an organisation, which creates, atomically:

- a PENDING_APPROVAL tenant;
- an `organisation_profile`;
- a DRAFT `organisation_application`;
- an `org_admin` membership for the applicant.

The applicant's workspace is restricted: it reaches only the application, the profile and `organisation.document` uploads. OGS staff review under an elevation and approve, request changes (with a reason) or reject (with a reason, final). Every transition is recorded in the append-only `organisation_application_event`, audited, and emailed to the organisation's admins through the outbox. Once the organisation is ACTIVE, its admins must enrol in MFA (P4-1).

**Members.** Admins can:

- invite people by email (single-use worker-minted token, 7 days, accepted only by that address, ACTIVE tenants only);
- suspend, reactivate or end memberships;
- replace a member's roles;
- build custom roles from the permissions allowed for their tenant kind;
- manage a flat list of departments, archived rather than deleted.

The last ACTIVE admin can never be removed, demoted or suspended. A deferred, per-tenant-locked trigger enforces this at COMMIT.

**Database guards added in Phase 4:**

- tenant kind is immutable;
- tenant status changes only through platform or system contexts;
- application decisions are platform-only;
- the event history is append-only;
- one pending invitation per email and tenant.

**Endpoints (Phase 4).**

| Method and path                                                                                         | Access                                             | Purpose                                                            |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /organisations`                                                                                   | verified user                                      | Apply (creates the pending organisation)                           |
| `GET /organisation/application`, `PATCH /organisation/profile`, `POST /organisation/application/submit` | `organisation.profile.manage` (restricted allowed) | The applicant's view, edit and submit                              |
| `POST /files` (multipart), `GET /files/:id/download`                                                    | workspace (restricted: application documents only) | Upload and 60-second download link                                 |
| `GET /platform/applications`, `GET /platform/applications/:id`                                          | elevation + `platform.tenant.review`               | Review queue and detail                                            |
| `POST /platform/applications/:id/approve` \| `reject` \| `request-changes`                              | elevation + `platform.tenant.approve`              | Decide (reason for reject and changes; never your own application) |
| `POST /platform/tenants/:id/suspend` \| `reactivate`                                                    | elevation + `platform.tenant.approve`              | Suspend or reactivate (reason)                                     |
| `POST/GET /workspace/invitations`, `DELETE /workspace/invitations/:id`                                  | `membership.invite`                                | Invite, list, revoke                                               |
| `POST /invitations/accept`                                                                              | verified user                                      | Accept (email must match)                                          |
| `PATCH /workspace/members/:id`, `PUT /workspace/members/:id/roles`, `POST /workspace/leave`             | `membership.manage` / `role.manage` / member       | Status and department, roles, leave                                |
| `GET/POST/PATCH/DELETE /workspace/roles`, `GET /workspace/permissions`                                  | `role.read` / `role.manage`                        | Custom roles                                                       |
| `GET/POST/PATCH /workspace/departments`                                                                 | `membership.read` / `department.manage`            | Departments                                                        |

**Proof.** The suites `organisations` (C1–C3, C9) and `members` (C4–C8, C10) cover:

- the automatic route walk proving a pending organisation is inert;
- a true two-transaction last-admin race;
- invitation binding and expiry;
- cross-tenant 404/403 on every new endpoint.

The Playwright journey `organisation-journey.spec.ts` covers apply, approve, invite and accept with three people.

## 9. Providers (Phase 5)

Planned in the [Phase 5 plan](../plans/phase-5-providers.md).

**Two kinds, one model.** A `provider` row is either:

- a **provider company** (`kind = COMPANY`, one per PROVIDER_COMPANY tenant), registered with `POST /providers/companies` like an organisation (pending tenant, business profile, DRAFT application, `provider_admin` membership, created by the job `providers.register`);
- an **individual** (`kind = INDIVIDUAL`, owned by one user), created with `POST /providers/me` from the personal account.

Both go through the same application lifecycle as organisations (`src/applications/application-rules.ts`). The Phase 4 trigger `app.protect_application_status` also guards `provider_application`, and `app.protect_provider_columns` makes provider identity immutable and status a platform or system decision.

**Provider workspace (P5-2).** `X-OGS-Workspace: provider` selects the person's individual capacity. It runs in their `user` context (their rows are user-owned), grants no role permissions, and stays restricted until approval. The `/provider/*` routes serve both kinds: the workspace decides which provider (`providers/provider-subject.ts`). Reading a company needs `workspace.read`; changing it needs `provider.profile.manage`. Any other workspace gets `403 not_a_provider_workspace`.

**Editing rules.** A provider edits its profile, skills, regions, weekly hours (Africa/Nairobi) and time off while DRAFT or CHANGES_REQUESTED, and again after approval. While SUBMITTED the content is frozen (`application_locked`). A SUSPENDED or REJECTED provider is read-only.

**Review.** The Phase 4 queue (`GET /platform/applications?type=organisation|provider_company|individual_provider`) lists all three kinds. Decisions open with `platform.tenant.review` under an elevation, then require the kind's approve permission: `platform.tenant.approve` for companies, `platform.provider.approve` for individuals. Approval records the verification checklist in `provider_verification` (platform-only, append-only). Rejecting an individual sets `retain_until` to 24 months later (ADR-018).

**KYC documents (P5-5).** The file purposes are `provider.identity` (personal only), `provider.certificate`, and `provider.company_document` (tenant, `provider.profile.manage`). Staff see identity documents only with `platform.provider.approve` or `platform.compliance.review`, and each view is audited with the elevation's reason. No ID number or date of birth is stored.

**Eligibility.** `EligibilityService.find` applies every hard filter in SQL:

- application approved, provider ACTIVE, company tenant ACTIVE;
- accepting work;
- every required skill;
- covers the county (or remote, when the service allows it);
- with `at`: within weekly hours (Africa/Nairobi) and not on time off.

It then scores with documented weights (`ELIGIBILITY_WEIGHTS`) and returns one reason per factor. Phase 5 exposes it only to staff (`ticket.assign`, elevated); dispatch uses it in Phase 9.

**Endpoints (Phase 5).**

| Method and path                                                                                                                                                                                              | Access                                                                        | Purpose                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `POST /providers/companies`, `POST /providers/me`                                                                                                                                                            | verified user                                                                 | Register a company / apply as an individual |
| `GET /provider`                                                                                                                                                                                              | Provider workspace, or company `workspace.read` (restricted allowed)          | The provider's own view                     |
| `PATCH /provider/profile`, `PATCH /provider/business`, `PUT /provider/skills`, `PUT /provider/regions`, `PUT /provider/working-hours`, `POST/DELETE /provider/time-off`, `POST /provider/application/submit` | Provider workspace, or company `provider.profile.manage` (restricted allowed) | Edit and submit                             |
| `GET /reference/skills`, `GET /reference/regions`                                                                                                                                                            | signed in                                                                     | Picker data (active only)                   |
| `GET /platform/provider-applications/:id`                                                                                                                                                                    | elevation + `platform.tenant.review`                                          | Review detail (identity documents gated)    |
| `POST /platform/provider-applications/:id/approve` \| `reject` \| `request-changes`                                                                                                                          | elevation + `platform.tenant.review` + kind's approve permission              | Decide (checklist on approve)               |
| `POST /platform/providers/:id/suspend` \| `reactivate`                                                                                                                                                       | elevation + `platform.tenant.review` + kind's approve permission              | Lifecycle after approval (reason)           |
| `GET /platform/providers/eligible?skills=&region=&at=&remote=`                                                                                                                                               | elevation + `ticket.assign`                                                   | Explained eligibility                       |
| `GET/POST /platform/skills`, `PATCH /platform/skills/:code`                                                                                                                                                  | elevation + `platform.catalogue.manage`                                       | Skill taxonomy                              |

**Web.** The workspace switcher offers "Provider · Individual" when the person has a provider profile. The personal dashboard links to "Become a provider" and "Register a provider company". Provider workspaces get "Application / Profile & skills", "Coverage" and "Availability". Staff get a typed review queue, the provider review with its checklist, "Eligibility" and "Skills".

**Proof.** The suite `providers` (D1–D9) covers:

- a combinatorial eligibility table (every hard filter);
- both lifecycles, with the approve permission per kind;
- the pending-provider route walk;
- KYC visibility and audit;
- technicians, isolation and multi-capacity;
- Nairobi time-zone edges, including midnight and the new year;
- the taxonomy rules.

## 10. Service catalogue (Phase 6)

Planned in the [Phase 6 plan](../plans/phase-6-catalogue.md); decisions ADR-038 … ADR-045.

**Data.** Platform-owned tables with no tenant column:

- `service_category`: a two-level tree. Archiving a parent archives its children, and the database refuses an active category under an archived parent.
- `service`: content, audience, delivery mode, allowed channels, and status DRAFT → PUBLISHED → RETIRED. A trigger maintains the full-text search vector (name unstemmed and stemmed, summary, category, body).
- `service_price`: append-only versions in integer minor units (KES, excluding VAT), with CHECKs per pricing model.
- `service_skill`: required skills with a minimum experience band; internal only.

**Anonymous access (ADR-038).** `DbContext` kind `anonymous` sets no identity, so every existing policy matches nothing. Only the catalogue SELECT policies are context-free and return published services in active categories. `catalogue.int.test.ts` (E1/E2) checks every combination over HTTP and raw SQL, and that the anonymous context sees zero rows in every other table.

**Public API** (`@Public()`, per-IP rate limit, `Cache-Control: public, no-cache` with ETags, so a retired service disappears at once):

| Method and path                                                                                      | Purpose                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /catalogue/categories`, `GET /catalogue/categories/:slug`                                       | Category tree, one category                                                  |
| `GET /catalogue/services?q=&category=&model=&audience=&delivery=&minPrice=&maxPrice=&cursor=&limit=` | Full-text search with filters; keyset pages with a cursor bound to its query |
| `GET /catalogue/services/:slug`                                                                      | Service detail (strict public DTO)                                           |
| `GET /catalogue/sitemap.xml`                                                                         | Sitemap; `robots.txt` in the web app points to it                            |

**Staff API** (`@RequireElevation('platform.catalogue.manage')`, audited, optimistic concurrency on `version`):

| Method and path                                                                       | Purpose                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GET/POST /platform/catalogue/categories`, `PATCH /platform/catalogue/categories/:id` | Categories: create, edit, move, archive, restore |
| `GET/POST /platform/catalogue/services`, `GET/PATCH /platform/catalogue/services/:id` | Services: drafts and content                     |
| `POST /platform/catalogue/services/:id/prices`                                        | New price version                                |
| `PUT /platform/catalogue/services/:id/skills`                                         | Required skills                                  |
| `POST /platform/catalogue/services/:id/publish`, `/retire`, `/restore`                | Lifecycle (publish checks list what is missing)  |

`GET /platform/providers/eligible?service=<id>` applies a service's skills, minimum experience, remote delivery and channels.

**Money.** `@ogs/contracts` holds `moneyMinorSchema`, `formatKes`, `priceLabel` and `withIndicativeVat`; the API builds every price label. Staff amount input is parsed as text, never through floats.

**Web.** Public pages `/services`, `/services/c/:category` and `/services/:slug` sit outside the signed-in shell, with per-page meta and JSON-LD. Staff use "Catalogue": category tree, service list, and an editor with price history, required skills and publishing.

**Proof.** `catalogue.int.test.ts` (E1–E8), the contracts money tests, web component tests and the Playwright `catalogue-journey.spec.ts` (E9).

## 11. Requests, quotations and orders (Phase 7)

Planned in the [Phase 7 plan](../plans/phase-7-requests-orders.md); decisions ADR-046 … ADR-054.

**Ownership.** Every commercial record belongs to an organisation (`customer_tenant_id`) or a person (`customer_user_id`), never both (ADR-009). `app.owns_customer_row()` shows an organisation's rows in its workspace, and a person's rows only in their personal workspace. Staff see everything under an elevation; `orders.*` worker jobs see what they process.

**Lifecycle.** `src/orders/transitions.ts` is the single table of what each command may do, from which states, and by whom. Every command checks it, guards the change with the row's status and `version`, and writes a history row (`service_request_event` / `service_order_event`), an audit row and an outbox event in the same transaction. Database triggers are a second, independent guard:

- request snapshots, issued quotations, payments and history are immutable;
- customers can only cancel, or accept or reject an issued quotation;
- a customer-created order must match its accepted quotation and the organisation's billing terms.

```text
SUBMITTED → UNDER_REVIEW → ORDERED (catalogue price)  |  → AWAITING_QUOTATION ⇄ QUOTATION_ISSUED → ORDERED
any state before ORDERED → CANCELLED
Order: AWAITING_PAYMENT → PAID → READY_FOR_ASSIGNMENT (postpaid: READY at once) · → CANCELLED (refund due if paid)
```

**Money.** Integer minor units throughout. `vatOn`, `lineTotals` and `documentTotals` in `@ogs/contracts` compute 16% VAT per line, rounded half up; values are stored per line and totals are sums (database CHECKs enforce it).

**Idempotency.** `Idempotency-Key` on submit, quotation acceptance and payment recording (`order-support.ts` `idempotent()`): the key row is written first in the same transaction, so concurrent duplicates wait and then replay the stored response.

**Quotation expiry.** Issuing schedules a delayed `orders.quotation_expiry` outbox event at `expires_at` and a 48-hour warning email; the worker's hourly `QuotationExpirySweeper` catches anything missed. `QuotationExpiryService.expire` is idempotent.

**API.**

| Method and path                                                                                                      | Access                                                                         | Purpose                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| `POST /requests` (Idempotency-Key), `GET /requests`, `GET /requests/:id`                                             | personal workspace, or organisation with `request.create` / `request.read_all` | Submit, list, view         |
| `POST /requests/:id/cancel`, `/quotations/:qid/accept` (Idempotency-Key), `/quotations/:qid/reject`, `/order/cancel` | customer (`quotation.accept` in organisations)                                 | Customer decisions         |
| `GET /platform/requests`, `GET /platform/requests/:id`, `POST …/review`, `…/accept`, `…/needs-quotation`, `…/cancel` | elevation + `platform.quotation.issue`                                         | Staff decisions            |
| `PUT /platform/requests/:id/quotation`, `POST …/quotations/:qid/issue`                                               | elevation + `platform.quotation.issue`                                         | Quotation draft and issue  |
| `GET /platform/orders`, `GET /platform/orders/:id`, `POST …/payments` (Idempotency-Key), `POST …/cancel`             | elevation + `platform.finance.manage`                                          | Orders and manual payments |
| `GET/PUT /platform/organisations/:tenantId/billing`                                                                  | elevation + `platform.finance.manage`                                          | Payment terms              |

**Web.** "Request this service" on public service pages leads to `/requests/new`; customers use "Requests" (list, detail, quotation accept/reject, payment instructions). Staff use "Requests" (queue, decisions, quotation editor with live totals) and finance uses "Orders" (payments, cancellation, billing terms).

**Proof.** `orders.int.test.ts` (F1–F9), the contracts money property tests, web component tests and the Playwright `requests-journey.spec.ts` (F10).

## 12. Tickets and the helpdesk (Phase 8)

Planned in the [Phase 8 plan](../plans/phase-8-ticketing.md); decisions ADR-056 … ADR-062.

**Ownership.** A ticket belongs to an organisation or a person, never both (ADR-009), and the same `app.owns_customer_row()` rule as Phase 7 applies. Inside an organisation, members see their own tickets. `ticket.read_department` adds tickets from the member's department, which is snapshotted on the ticket when it is opened. `ticket.read_all` (org admins) shows all of the organisation's tickets. RLS keeps the tenant boundary, and the service layer applies the member split (ADR-060).

**Internal notes never reach customers (ADR-059).** This is enforced at every layer:

- **Database.** `ticket_internal_note` is its own table, and its only RLS policy is `app.is_platform()`. Activity rows carry a `visibility`, and customers' RLS returns only `PUBLIC` rows. Note attachments are owned by the PLATFORM tenant, so a customer's file policies cannot reach them either.
- **Audit.** Audit rows of internal staff commands have no tenant, so they never appear in an organisation's own audit log.
- **API.** Customer responses are built only from public rows and parsed through `customerTicketSchema`, which has no internal field.
- **Email.** Ticket emails never contain reply or note text.
- **Proof.** `tickets.int.test.ts` T2 calls every customer GET route (enumerated from the router) as the requester, an org admin and a person, after a canary note exists. The Playwright journey visits every customer page in the route table, checking the page and every API response it loads.

**Lifecycle.** `src/tickets/transitions.ts` is the single table of commands, from-states, actor, permission and activity visibility. Every command checks it, guards the change with status and `version`, and writes one `ticket_event`, an audit row and (for public changes) an outbox event. `protect_ticket` and the comment, note and attachment triggers are the second guard.

```text
NEW → OPEN (triage: priority + category) → IN_PROGRESS ⇄ AWAITING_CUSTOMER (customer reply returns it) / ON_HOLD
any active state → RESOLVED → CLOSED (customer accepts, or automatically after 7 days)
RESOLVED → IN_PROGRESS (customer reopen within 7 days, with a reason; staff reopen any time before CLOSED)
any active state → CLOSED (customer withdraws, with a reason) · CLOSED is final
```

**Auto-close.** Resolving publishes a delayed `tickets.auto_close` event at `resolved_at + 7 days`. The worker's hourly `TicketAutoCloseSweeper` is the safety net, and `TicketAutoCloseService.close` is idempotent.

**API.**

| Method and path                                                                                                                                                              | Access                                                | Purpose                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `GET /tickets/categories`, `GET /tickets/linkable-orders`                                                                                                                    | signed in (workspace)                                 | Form data                            |
| `POST /tickets` (Idempotency-Key), `GET /tickets`, `GET /tickets/:id`, `POST …/comments`, `…/reopen`, `…/accept-resolution`, `…/withdraw`, `GET …/attachments/:aid/download` | personal workspace, or organisation with `ticket.*`   | Customer tickets                     |
| `GET /platform/tickets`, `GET /platform/tickets/:id`, `GET …/linkable-orders`, `GET …/attachments/:aid/download`, `GET /platform/ticket-assignees`                           | elevation + `ticket.read`                             | Queue and ticket                     |
| `POST /platform/tickets/:id/{triage,start,await-customer,hold,resume,resolve,reopen,priority,category,link-order,take,comments,files}`                                       | elevation + `ticket.comment`                          | Helpdesk work                        |
| `POST /platform/tickets/:id/notes`; `POST /platform/tickets/:id/assign`                                                                                                      | elevation + `ticket.internal_note`; + `ticket.assign` | Internal notes; assignment           |
| `POST /platform/tickets` (Idempotency-Key), `GET /platform/customers?q=`, `GET /platform/customers/:tenantId/members`                                                        | elevation + `ticket.create`                           | Tickets on behalf (ADR-061)          |
| `POST /platform/requests` (Idempotency-Key)                                                                                                                                  | elevation + `platform.request.on_behalf`              | Service requests on behalf (ADR-062) |

**Web.** Customers use "Support" (`/support`): a list, a new-ticket form with urgency and attachments, and a ticket page with the conversation, a reply box, and reopen, accept and withdraw. Staff use "Tickets" (`/platform/tickets`): a queue with filters and counts, and a ticket workspace. In the workspace, internal notes are dashed, carry a lock and an "Internal" badge, and the composer's tab decides between "Send reply" and "Add internal note". Staff also have forms for tickets and requests on a customer's behalf.

**Proof.** `tickets.int.test.ts` (T1–T8), `phase8.test.tsx` (component tests) and the Playwright `tickets-journey.spec.ts` (T9 and the web half of T2). The design suites (visual, axe, motif, touch targets) include the five ticket screens.

## 13. Jobs, offers and field work (Phase 9)

Planned in the [Phase 9 plan](../plans/phase-9-assignment.md); decisions ADR-063 … ADR-074.

**Jobs.** A paid or postpaid order (`jobs.order_ready` event, plus a 5-minute sweep) or a ticket that needs a visit (staff "Send a technician") becomes a `job` (`JOB-2026-000123`). The job copies its customer owner, its requirements (channels, skills, county, remote) and a provider-facing brief written by OGS. Orders follow their job: READY_FOR_ASSIGNMENT → IN_DELIVERY → COMPLETED (ADR-072).

**Who sees what.** Staff (elevated) see everything. The customer sees status, a first name and "OGS technician" / "OGS partner technician", customer-visible activity and the completion report. An assignee sees the brief, the site and the site contact, only while they hold the ACTIVE assignment; before accepting, an offer shows the area only. Providers have no RLS policy on orders, requests, quotations, payments, tickets or any customer table (ADR-063), and never see internal notes (ADR-064). Internal OGS technicians may read the internal notes of the ticket behind their own job.

**Contexts (ADR-065).** The Provider workspace runs in a `provider` DbContext that sets `app.provider_id`; `app.owns_customer_row` ignores personal rows there. Company members use their company workspace; `app.holds_permission(code)` lets a company dispatcher (`ticket.assign`) see all of the company's jobs while a technician sees only those naming them. Internal technicians use the PLATFORM workspace without elevation.

**Eligibility in the database (ADR-073).** `app.can_take_job(job, kind, provider, technician)` is the one definition: approved, ACTIVE, accepting work, active company tenant, allowed channel, every required skill at the minimum experience, county or remote. Triggers check it when an offer is sent, when the assignment is created and when the offer is accepted; `EligibilityService` suggestions are filtered through it. Suspending a provider or company withdraws its offers and releases its jobs in the same transaction; a technician whose membership ends is released too.

**Lifecycle.** `src/jobs/transitions.ts` is the single table (actor, permission, customer/provider visibility). Every command writes one `job_event`, an audit row and usually an outbox event; `protect_job`, `protect_job_offer`, `protect_job_assignment`, `protect_job_work` and `protect_job_completion` are the second guard.

```text
QUEUED → OFFERED (staff, one pending offer) → ASSIGNED (accept) | QUEUED (decline with reason, expiry, withdrawal)
ASSIGNED → ON_THE_WAY → IN_PROGRESS ⇄ PAUSED (reason) → AWAITING_CONFIRMATION (completion report)
AWAITING_CONFIRMATION → COMPLETED (customer, 7-day auto-confirm, or staff with a reason) | IN_PROGRESS (problem reported)
working states → QUEUED (staff reassign, reason) · any state before COMPLETED → CANCELLED
```

Offers expire through a delayed `jobs.offer_expire` event plus the sweep; reports auto-confirm through `jobs.auto_confirm` plus the sweep. A ticket job is confirmed when the customer accepts the ticket's resolution (ADR-069).

**Photos.** `job.evidence` files are owned by the job's customer, uploaded only through `POST /jobs/:id/photos` (in the same transaction as the `job_evidence` row) and downloaded only through the jobs API; the generic `/files` routes refuse them. The phone shrinks photos to 1600 px before upload, which also drops EXIF location.

**API.**

| Method and path                                                                                                                                                                                                                  | Access                                                                                            | Purpose                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| `GET /platform/jobs`, `GET /platform/jobs/:id`, `GET …/candidates`, `PATCH …/brief`, `POST …/offers`, `…/offers/:oid/withdraw`, `…/reassign`, `…/cancel`, `POST /platform/tickets/:id/jobs`                                      | elevation + `ticket.assign`                                                                       | Dispatch                         |
| `POST /platform/jobs/:id/confirm`                                                                                                                                                                                                | elevation + `ticket.confirm_completion`                                                           | Confirm on the customer's behalf |
| `GET /platform/orders/:id/job`, `GET /platform/tickets/:id/job`, `GET /platform/jobs/:id/photos/:pid/download`                                                                                                                   | elevation + `ticket.read`                                                                         | Job status on staff pages        |
| `GET /jobs?view=offers\|active\|done`, `GET /jobs/offers/:oid`, `POST …/accept`, `…/decline`, `GET /jobs/:id`, `POST /jobs/:id/{on-the-way,start,pause,resume,notes,photos,completion,technician}`, `GET …/photos/:pid/download` | Provider, provider-company or (non-elevated) PLATFORM workspace; commands take an Idempotency-Key | Field work                       |
| `GET /requests/:id/progress`, `POST /requests/:id/job/{confirm,report-problem}`, `GET /tickets/:id/progress`, photo downloads                                                                                                    | customer workspaces                                                                               | Live tracker                     |

**Web.** Assignees get "Jobs" (`/jobs`): offers, active and done tabs; an offer page; a job page with one saffron next step, a call link, notes, photos and a completion report. Commands retry with the same Idempotency-Key and typed text is kept until sent. Staff get "Dispatch" (`/platform/dispatch`): a queue with counts and a job page with the brief editor, suggestions and offer dialog. Customers see a "Progress" card (Stepper + Timeline, polled every 30 s) on request and ticket pages.

**Proof.** `jobs.int.test.ts` (T1–T10), `transitions.test.ts`, `phase9.test.tsx` and the Playwright `jobs-journey.spec.ts` (T11, including a throttled phone). The design suites include five Phase 9 screens. `scripts/check-chunk-budget.mjs` keeps the technician chunk under 60 KB gzip.

## 14. Architecture decisions

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
