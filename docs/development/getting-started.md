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
pnpm infra:up         # start PostgreSQL 18 + Redis 8 (docker compose up -d)
pnpm db:roles         # create/refresh the ogs_* roles and the ogs_test database (idempotent)
pnpm db:migrate       # apply migrations to ogs_dev as ogs_owner
pnpm db:seed          # optional: sample tenants, users, memberships (idempotent)
```

- On a **new** Docker volume the role bootstrap runs automatically; `pnpm db:roles` is then a harmless no-op. On a volume created before Phase 2 you **must** run it once.
- Changing an `OGS_*_PASSWORD` and re-running `pnpm db:roles` rotates that password.
- `pnpm infra:down` stops the containers; data stays in the `ogs_postgres-data` / `ogs_redis-data` volumes.

Seeded accounts (no passwords yet; login arrives in Phase 3):

| User               | Workspaces                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `admin@ogs.test`   | OGS Platform                                                     |
| `alice@acme.test`  | Acme Kenya Ltd, Nairobi Tech Partners (multi-membership example) |
| `bob@savanna.test` | Savanna Logistics (pending approval → restricted)                |
| `tech@ntp.test`    | Nairobi Tech Partners (provider company)                         |

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
pnpm test:integration   # RLS, isolation, outbox, readiness against real PostgreSQL + Redis
```

Integration tests need `pnpm infra:up` and `pnpm db:roles`. They run against the separate **`ogs_test`** database (never `ogs_dev`), apply migrations to it automatically, and use a unique BullMQ prefix per run. They create uniquely named rows and never wipe anything. If you edited an existing migration (rather than adding a new one), recreate the test database with `pnpm db:reset:test`.

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
- **Queries return no rows**: that is RLS failing closed. Code must use `TenantDb.run(context, ...)`; a missing or wrong context matches nothing by design.
- **Port already in use**: change `API_PORT` in `apps/api/.env` (and `API_PROXY_TARGET` in `apps/web/.env`), or change `POSTGRES_PORT`/`REDIS_PORT` in `.env` and the URLs to match.
