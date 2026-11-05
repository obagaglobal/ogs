# OGS – ObagaGlobal Services

OGS is a multi-tenant business services platform owned by **ObagaGlobal**. It will serve individual customers, organisations with their own company portals, external individual and company service providers, and internal OGS employees. Planned features include a public service catalogue, hybrid service delivery and organisation approval workflows.

> **Current status: Phase 2, tenancy, RLS and data foundations.**
> The database enforces tenant isolation with PostgreSQL row-level security, proven by an integration test suite. The repository also has an audit log, a transactional outbox with a background worker, and health/readiness endpoints. No business features (authentication, organisations, catalogue, payments, ticketing) exist yet.

---

## Tech stack

| Area           | Technology                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| Runtime        | Node.js 24.18.1, pnpm 11.21.0 (workspaces)                                  |
| Language       | TypeScript 6.0 (strict), native ESM                                         |
| Backend        | NestJS 12, `@nestjs/config`, Zod environment validation                     |
| Data           | PostgreSQL 18 with row-level security, Prisma 7 (`@prisma/adapter-pg`)      |
| Queues / cache | Redis 8, BullMQ (transactional outbox → worker)                             |
| Frontend       | React 19, Vite 8, Tailwind CSS 4, shadcn/ui                                 |
| Quality        | ESLint 10 + typescript-eslint (strict, type-checked), Prettier 3            |
| Testing        | Vitest 5, Supertest, Testing Library + jsdom, integration tests on real DBs |
| Infrastructure | Docker Compose (local development)                                          |
| CI             | GitHub Actions                                                              |

## Repository structure

```
.
├── apps/
│   ├── api/                    NestJS backend (@ogs/api): HTTP API + background worker
│   │   ├── prisma/             Schema + migrations (RLS policies live in the migration SQL)
│   │   ├── scripts/            db-seed, db-reset guards
│   │   ├── src/
│   │   │   ├── database/       TenantDb: the only door to the database (sets RLS context)
│   │   │   ├── tenancy/        Workspace resolution (requested workspace → granted context)
│   │   │   ├── audit/          Append-only audit log
│   │   │   ├── events/         Transactional outbox, dispatcher, BullMQ consumer
│   │   │   ├── redis/          Redis connections
│   │   │   ├── health/         GET /api/v1/health (liveness), /api/v1/health/ready (readiness)
│   │   │   ├── main.ts         HTTP API entry point
│   │   │   └── worker.ts       Worker entry point
│   │   └── test/               e2e tests; test/integration = real PostgreSQL + Redis
│   └── web/                    React + Vite frontend (@ogs/web)
├── packages/
│   └── contracts/              Shared Zod schemas + inferred types (@ogs/contracts)
├── infrastructure/docker/      compose.yaml + postgres/init (database roles bootstrap)
├── docs/
│   ├── architecture/           Overview and the approved architecture review
│   ├── development/            Getting started and engineering standards
│   ├── plans/                  Approved phase plans
│   └── DECISIONS.md            Architecture decision records
├── scripts/                    Repository scripts (setup-env.mjs)
└── .github/workflows/          CI pipeline
```

## Quick start

Prerequisites: Node.js 24.18.1, pnpm 11.21.0, Docker with Compose v2. Full guide: [Getting started](docs/development/getting-started.md).

```powershell
pnpm install                 # install dependencies
pnpm setup:env               # create .env files from templates (never overwrites)
#   → edit .env and apps/api/.env and replace placeholder credentials (keep them consistent)

pnpm infra:up                # start PostgreSQL + Redis
pnpm db:roles                # create the ogs_* database roles (needed once per Docker volume)
pnpm db:migrate              # apply migrations
pnpm db:seed                 # optional sample data
pnpm dev                     # run API + worker + web
```

| Service       | URL                                       |
| ------------- | ----------------------------------------- |
| Web           | http://localhost:5173                     |
| API liveness  | http://127.0.0.1:3000/api/v1/health       |
| API readiness | http://127.0.0.1:3000/api/v1/health/ready |
| PostgreSQL    | localhost:5432 (127.0.0.1 only)           |
| Redis         | localhost:6379 (127.0.0.1 only)           |

> **Windows PowerShell:** if script execution policy blocks `pnpm`, call the `.cmd` launcher instead, e.g. `pnpm.cmd install` or `pnpm.cmd dev`. You do not need to change the execution policy.

## Scripts

| Command                                       | Description                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                                    | Run API, worker and web in watch mode                             |
| `pnpm dev:api` / `dev:worker` / `dev:web`     | Run one process                                                   |
| `pnpm build`                                  | Production build of every package and app                         |
| `pnpm check`                                  | Format check + lint + typecheck + unit tests (run before pushing) |
| `pnpm test`                                   | Unit + HTTP e2e tests (no Docker needed)                          |
| `pnpm test:integration`                       | RLS / isolation / outbox tests on real PostgreSQL + Redis         |
| `pnpm lint` / `lint:fix`                      | ESLint (zero warnings allowed)                                    |
| `pnpm format` / `format:check`                | Prettier                                                          |
| `pnpm typecheck`                              | TypeScript across all workspaces                                  |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Manage local Docker infrastructure                                |
| `pnpm db:roles`                               | Create/refresh database roles and the `ogs_test` database         |
| `pnpm db:migrate` / `db:migrate:dev`          | Apply migrations / create a migration (dev)                       |
| `pnpm db:seed`                                | Insert sample tenants, users and memberships                      |
| `pnpm db:reset` / `db:reset:test`             | **Wipe** and rebuild the local dev / test database (guarded)      |
| `pnpm setup:env`                              | Create missing `.env` files from `.env.example`                   |

## API

All routes are versioned under `/api/v1`.

- `GET /api/v1/health`: liveness. Never touches PostgreSQL or Redis.
- `GET /api/v1/health/ready`: readiness. `200` when PostgreSQL and Redis answer, `503` otherwise.

```json
{
  "status": "not_ready",
  "checks": { "database": "up", "redis": "down" },
  "timestamp": "2026-11-05T23:01:48.629Z"
}
```

Response types come from Zod schemas in `@ogs/contracts` (`healthCheckResponseSchema`, `readinessResponseSchema`). The API tests and the web app both check responses against those schemas.

## Tenant isolation in one paragraph

The API connects as `ogs_app`, a role that cannot bypass RLS and owns nothing. Every unit of work runs through `TenantDb.run(context, …)`, which starts a transaction and sets the user, tenant and actor as **transaction-local** settings, so pooled connections can never carry them into another request. Every table has RLS **enabled and forced**, and a missing context matches no rows. CI fails if a table is added without policies. Details: [architecture overview §6](docs/architecture/overview.md#6-multi-tenancy-and-data-isolation) and [standards §10](docs/development/standards.md#10-database-and-multi-tenancy).

## Configuration and security

- Only `.env.example` templates are committed. Real `.env` files are git-ignored.
- The API validates its environment at startup and refuses to start if a variable is invalid. Error messages name the variable but never show its value.
- The running API only knows the `ogs_app` credentials. Migration (`ogs_owner`) and maintenance (`ogs_maint`) credentials are read only by Prisma CLI and dev scripts.
- Docker Compose has no default credentials and binds ports to `127.0.0.1` only.
- pnpm's supply-chain protections are left on. Only Prisma is allowed to run install scripts (`allowBuilds` in `pnpm-workspace.yaml`), and the minimum package release age is enforced.
- Browser-visible variables (`VITE_*`) are public. Never put secrets in them.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Architecture review (approved)](docs/architecture/review.md) and [decision records](docs/DECISIONS.md)
- [Phase 2 plan](docs/plans/phase-2-tenancy.md)
- [Getting started](docs/development/getting-started.md)
- [Development standards](docs/development/standards.md)

## License

Proprietary. © ObagaGlobal. All rights reserved.
