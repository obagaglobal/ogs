# Getting Started (Local Development)

## Prerequisites

- Node.js **24.18.1** (`nvm use` reads `.nvmrc`)
- pnpm **11.21.0** (`corepack enable` picks it up from `package.json`)
- Docker Desktop / Docker Engine with Compose v2

### Windows PowerShell

If the execution policy blocks the `pnpm.ps1` / `npm.ps1` launchers, use the `.cmd` launchers that ship alongside them: `pnpm.cmd install`, `pnpm.cmd dev`, `pnpm.cmd check`, and so on. Every `pnpm <script>` command in this guide works the same way as `pnpm.cmd <script>`. You do not need to (and should not) change the execution policy.

All commands below run from the repository root in PowerShell, Git Bash or any POSIX shell.

## First-time setup

```powershell
pnpm install          # install all workspace dependencies
pnpm setup:env        # create .env, apps/api/.env, apps/web/.env from templates (never overwrites)
```

Edit the generated files and replace the `change-me-local-only` placeholders. Keep them consistent:

| Root `.env`            | Must match in `apps/api/.env`               |
| ---------------------- | ------------------------------------------- |
| `OGS_APP_PASSWORD`     | password in `DATABASE_URL` (user `ogs_app`) |
| `OGS_OWNER_PASSWORD`   | password in `DATABASE_MIGRATION_URL`        |
| `OGS_MAINT_PASSWORD`   | password in `DATABASE_MAINT_URL`            |
| `REDIS_PASSWORD`       | password in `REDIS_URL`                     |
| `POSTGRES_*`, `*_PORT` | host/port/database in the URLs              |

`POSTGRES_USER`/`POSTGRES_PASSWORD` are the container superuser. Only the role bootstrap script uses them; no application URL may.

## Start infrastructure and the database

```powershell
pnpm infra:up         # start PostgreSQL 18, Redis 8, Mailpit and the object store
pnpm db:roles         # create/refresh the ogs_* roles and the ogs_test database (idempotent)
pnpm db:migrate       # apply migrations to ogs_dev as ogs_owner
pnpm db:seed          # optional: roles, sample tenants, users, providers, catalogue (idempotent)
```

- On a **new** Docker volume the role bootstrap runs automatically; `pnpm db:roles` is then a harmless no-op. On a volume created before Phase 2 you **must** run it once.
- Changing an `OGS_*_PASSWORD` and re-running `pnpm db:roles` rotates that password.
- `pnpm infra:down` stops the containers; data stays in the `ogs_postgres-data` / `ogs_redis-data` volumes.
- **Email:** the worker sends every email to **Mailpit**. Open http://localhost:8025 to read verification and password-reset emails. Nothing leaves your machine.

Seeded accounts. All are verified, and all use the password in `SEED_USER_PASSWORD` (`apps/api/.env`):

| User                 | Workspace (role)                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `admin@ogs.test`     | OGS Platform (`super_admin`)                                                                    |
| `alice@acme.test`    | Acme Kenya Ltd (`org_admin`) and Nairobi Tech Partners (`provider_technician`)                  |
| `bob@savanna.test`   | Savanna Logistics (`org_admin`; the tenant is pending approval, so the workspace is restricted) |
| `tech@ntp.test`      | Nairobi Tech Partners (`provider_admin`)                                                        |
| `jane@provider.test` | Approved individual provider (Provider workspace)                                               |

## Sign in to the web app

Open http://localhost:5173 and sign in, or create a new account (the confirmation email arrives in Mailpit).

- **Seeded admins must set up two-step verification first.** That covers `admin@ogs.test`, `alice@acme.test`, `bob@savanna.test` and `tech@ntp.test`, because MFA is mandatory for OGS staff and admin roles. The app takes you to the setup page: scan the QR code with any authenticator app, or type the key shown under it. Then keep the recovery codes it shows you.
- **Losing the authenticator** on a dev database is not a problem: run `pnpm db:seed` again. It resets the seeded users' passwords, but not their MFA. To reset MFA for one user, delete their rows from `mfa_factor` and `recovery_code` as `ogs_maint`, set `app_user.mfa_enabled = false` inside a transaction with `set_config('app.is_platform', 'true', true)`, and sign in again.
- Use the header to switch workspaces. The current workspace is always shown there.
- **Security** lists your signed-in devices and your two-step verification status.

### Try the organisation flow (Phase 4)

1. **Apply.** Sign up as a new user, then on the personal dashboard choose **Register an organisation**. Fill in the details, upload a PDF, JPEG or PNG certificate and **Submit for review**. The workspace shows "pending" and only the application is reachable.
2. **Review.** Sign in as `admin@ogs.test` (super admin). Pick the **OGS Platform** workspace, open **Applications** and start an elevated session (a reason plus your authenticator code). Then approve, request changes or reject. Each decision is emailed to the organisation's admins (see Mailpit).
3. **Run the organisation.** Back as the applicant: after approval you must set up two-step verification, because MFA is mandatory for organisation admins. Then use **Team** to invite people, change roles and suspend or remove members, **Roles** for custom roles, and **Departments**.
4. **Accept an invitation.** Open the invitation link from Mailpit, then sign in or create an account with the invited address and accept.

The seeded data already includes Acme Kenya Ltd (approved) and Savanna Logistics (submitted, waiting in the review queue).

## Try the API with a session

PowerShell, keeping the session cookie in `$s`:

```powershell
$api = 'http://127.0.0.1:3000/api/v1'
Invoke-RestMethod "$api/auth/login" -Method Post -ContentType 'application/json' `
  -Body '{"email":"alice@acme.test","password":"change-me-local-only"}' -SessionVariable s
Invoke-RestMethod "$api/me/workspaces" -WebSession $s
Invoke-RestMethod "$api/workspace/members" -WebSession $s `
  -Headers @{ 'X-OGS-Workspace' = '01930000-0000-7000-8000-000000000002' }
$csrf = (Invoke-RestMethod "$api/auth/csrf" -WebSession $s).csrfToken
Invoke-RestMethod "$api/auth/logout" -Method Post -ContentType 'application/json' -Body '{}' `
  -WebSession $s -Headers @{ 'X-CSRF-Token' = $csrf }
```

The rules every client must follow:

- Send `Content-Type: application/json` on any request with a body.
- Send `X-CSRF-Token` (from `GET /auth/csrf`) on every POST, PUT, PATCH or DELETE once signed in.
- Choose the workspace with `X-OGS-Workspace: personal | <tenantId>`.

The endpoint list is in the [architecture overview](../architecture/overview.md#7-identity-sessions-and-access).

## Run the applications

```powershell
pnpm dev              # API + worker + web together, in watch mode
pnpm dev:api          # API only     → http://127.0.0.1:3000/api/v1/health
pnpm dev:worker       # worker only  (outbox dispatcher + event consumer)
pnpm dev:web          # web only     → http://localhost:5173
```

- Liveness: `http://127.0.0.1:3000/api/v1/health` (never touches the database).
- Readiness: `http://127.0.0.1:3000/api/v1/health/ready` (200 when PostgreSQL and Redis answer, 503 otherwise).
- The web app proxies `/api/*` to the API, so its "API status" card shows **Online** once the API is running.

## Tests

```powershell
pnpm test               # unit + HTTP e2e tests (no Docker needed)
pnpm test:integration   # RLS, isolation, auth, MFA, files: real PostgreSQL, Redis, Mailpit, object store
pnpm test:e2e           # builds, then runs the journeys and design suites in a real Chromium (Playwright)
```

Integration tests need `pnpm infra:up` and `pnpm db:roles`. They run against the separate **`ogs_test`** database (never `ogs_dev`), apply migrations to it automatically, and use a unique Redis/BullMQ prefix per run. The API and the worker run in-process, and emails are read back from Mailpit. Tests create uniquely named rows and users and never wipe anything. If you edited an existing migration (rather than adding a new one), recreate the test database with `pnpm db:reset:test`.

The browser tests need the dev database migrated and seeded (one joins the seeded Acme organisation). It also needs Chromium for Playwright, installed once with `pnpm --filter @ogs/web exec playwright install chromium`. It reuses an API, worker or web server that is already running. They start the API from its build output (`dist/`), so rebuild it (`pnpm --filter @ogs/api build`) after API changes unless an API is already running. Each run adds a few `*@e2e.test` users, one provider, one `e2e_*` skill, one retired `fibre-splicing-*` service, one organisation and a few requests and orders to the dev database.

The public catalogue is at http://localhost:5173/services (no sign-in needed). The seed adds 8 categories and 17 published services; staff manage them under **Catalogue** in the OGS Platform workspace (seeded `admin@ogs.test`, after starting an elevation).

Requests (Phase 7): sign in, open a service and choose **Request this service**. Staff handle requests under **Requests**, and finance records payments under **Orders**. The seeded Acme Kenya Ltd is postpaid (30 days), so its orders are confirmed without a payment step; everyone else prepays.

## Design system

The look and feel ("Kitenge signal") is described in [docs/design/DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md).

- **Reference page:** sign in and open http://localhost:5173/design-system. It is open to everyone in development. In a production build only OGS platform staff can see it: select the **OGS Platform** workspace first.
- **Theme:** use the account menu (avatar, top right): Light, Dark or System.
- **Fonts:** after upgrading the `@fontsource/*` packages, run `pnpm --filter @ogs/web fonts:sync` to refresh `apps/web/public/fonts`.

### On your phone over Wi-Fi

1. Start the API as usual. Then start the web app on your network: `pnpm --filter @ogs/web dev --host`. Vite prints a `Network:` address such as `http://192.168.1.23:5173`.
2. Connect the phone to the same Wi-Fi and open that address. If Windows asks, allow Node.js on **private** networks.
3. The web server proxies `/api` to the API on the PC, so sign-in works. Email links still point to `localhost`, so open those on the PC.

To check the production build instead (as Lighthouse sees it): `pnpm --filter @ogs/web build`, then `pnpm --filter @ogs/web exec vite preview --host` (port 4173).

### Design tests

```powershell
pnpm --filter @ogs/web exec playwright test e2e/visual.spec.ts        # 36 screenshots
pnpm --filter @ogs/web exec playwright test e2e/a11y.spec.ts          # axe, keyboard, responsive, touch targets
pnpm --filter @ogs/web exec playwright test e2e/theme-motif.spec.ts   # theme persistence, no flash, motif rules
pnpm --filter @ogs/web exec playwright show-report                    # after a failure: diffs side by side
pnpm --filter @ogs/web lighthouse                                     # needs the API on :3000 and a web build
```

The design tests need the same set-up as the other browser tests (infrastructure up, dev database seeded). They also run as part of `pnpm test:e2e`.

**Screenshots:**

- Each platform keeps its own baselines. Only the **Linux** images, produced by CI, are committed (`apps/web/e2e/__screenshots__/`). Windows and macOS images are written locally on the first run, for viewing, and are git-ignored.
- After an intended visual change, delete the affected `*-linux.png` files and push. CI then writes new baselines and uploads them as the `screenshot-baselines-linux` artifact; download it (`gh run download <run-id> -n screenshot-baselines-linux`) and commit the images.
- To refresh your local images: add `--update-snapshots` to the first command above.

## Database workflow

| Command               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `pnpm db:migrate`     | apply pending migrations (`prisma migrate deploy`, as `ogs_owner`)                 |
| `pnpm db:migrate:dev` | create + apply a migration from schema changes (dev only)                          |
| `pnpm db:seed`        | insert sample data (as `ogs_maint`, idempotent)                                    |
| `pnpm db:reset`       | **destroys** `ogs_dev` data, re-applies migrations, re-seeds (local only, guarded) |
| `pnpm db:reset:test`  | **destroys** `ogs_test` data and re-applies migrations (local only, guarded)       |

**Every new table needs hand-written RLS.** Prisma never generates policies. Create the migration with `pnpm --filter @ogs/api exec prisma migrate dev --create-only --name <name>`, then add `ENABLE` + `FORCE ROW LEVEL SECURITY`, policies and explicit `ogs_app` grants to the SQL before applying it. The RLS catalogue test fails CI otherwise. See [standards §10](standards.md#10-database-and-multi-tenancy).

## Everyday commands

| Command                                  | What it does                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `pnpm check`                             | format check + lint + typecheck + unit tests     |
| `pnpm format`                            | apply Prettier formatting                        |
| `pnpm lint:fix`                          | auto-fix lint issues                             |
| `pnpm build`                             | production build of all packages and apps        |
| `pnpm infra:validate`                    | validate the Compose file against `.env.example` |
| `pnpm --filter @ogs/api prisma:validate` | validate the Prisma schema                       |

## Troubleshooting

- **`Cannot find module '@ogs/contracts'` or `../generated/prisma/...`**: run `pnpm build:packages` (builds shared packages and generates the Prisma client). The root `dev`, `lint`, `typecheck` and `test` scripts do this for you.
- **`Invalid API environment configuration`**: a variable in `apps/api/.env` is malformed or missing (`DATABASE_URL` and `REDIS_URL` are required since Phase 2). The error names it.
- **`password authentication failed for user "ogs_app"`**: the role passwords in the root `.env` and the URLs in `apps/api/.env` differ, or `pnpm db:roles` has not been run on this volume.
- **`403 email_unverified`**: the account has not confirmed its email. Open Mailpit (http://localhost:8025), or use a seeded account.
- **`403 csrf_invalid` / `415 json_required`**: see the client rules in [Try the API with a session](#try-the-api-with-a-session).
- **`429 rate_limited`** during manual testing: wait for `Retry-After` seconds. Counters live in Redis under `ogs:rl:*`.
- **Queries return no rows**: that is RLS failing closed. Code must use `TenantDb.run(context, ...)`; a missing or wrong context matches nothing by design.
- **Port already in use**: change `API_PORT` in `apps/api/.env` (and `API_PROXY_TARGET` in `apps/web/.env`), or change `POSTGRES_PORT`/`REDIS_PORT` in `.env` and the URLs to match.
