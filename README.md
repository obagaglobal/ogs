# OGS – ObagaGlobal Services

OGS is a multi-tenant business services platform owned by **ObagaGlobal**. It will serve individual customers, organisations with their own company portals, external individual and company service providers, and internal OGS employees. Planned features include a public service catalogue, hybrid service delivery and organisation approval workflows.

> **Current status: Phase 1, engineering foundation.**
> This repository contains the monorepo, tooling, infrastructure and a health-check endpoint. No business features (authentication, organisations, catalogue, payments, purchasing, ticketing) have been implemented yet.

---

## Tech stack

| Area            | Technology                                                       |
| --------------- | ---------------------------------------------------------------- |
| Runtime         | Node.js 24.18.1, pnpm 11.21.0 (workspaces)                       |
| Language        | TypeScript 6.0 (strict), native ESM                              |
| Backend         | NestJS 12, `@nestjs/config`, Zod environment validation          |
| Frontend        | React 19, Vite 8, Tailwind CSS 4, shadcn/ui                      |
| Data (planned)  | PostgreSQL 18 via Prisma 7 (schema/config foundation only)       |
| Cache (planned) | Redis 8                                                          |
| Quality         | ESLint 10 + typescript-eslint (strict, type-checked), Prettier 3 |
| Testing         | Vitest 5, Supertest, Testing Library + jsdom                     |
| Infrastructure  | Docker Compose (local development)                               |
| CI              | GitHub Actions                                                   |

## Repository structure

```
.
├── apps/
│   ├── api/                  NestJS backend (@ogs/api)
│   │   ├── prisma/           Prisma schema (datasource + generator, no models yet)
│   │   ├── src/
│   │   │   ├── config/       Typed, validated environment configuration
│   │   │   ├── health/       GET /api/health (liveness) – reference feature module
│   │   │   ├── app.factory.ts  Shared HTTP setup (prefix, CORS, shutdown hooks)
│   │   │   └── main.ts       Entry point
│   │   └── test/             End-to-end tests (Supertest)
│   └── web/                  React + Vite frontend (@ogs/web)
│       └── src/
│           ├── components/ui/  shadcn/ui primitives
│           ├── features/       Feature folders (system-status = reference)
│           └── lib/            Utilities (cn)
├── packages/
│   └── contracts/            Shared Zod schemas + inferred types (@ogs/contracts)
├── infrastructure/docker/    compose.yaml – PostgreSQL + Redis for local dev
├── docs/
│   ├── architecture/         System architecture and decisions
│   └── development/          Getting started and engineering standards
├── scripts/                  Repository scripts (setup-env.mjs)
└── .github/workflows/        CI pipeline
```

## Quick start

Prerequisites: Node.js 24.18.1, pnpm 11.21.0, Docker with Compose v2.

```bash
pnpm install                 # install dependencies
pnpm setup:env               # create .env files from templates (never overwrites)
#   → edit .env, apps/api/.env, apps/web/.env and replace placeholder credentials

pnpm infra:up                # start PostgreSQL + Redis (optional in Phase 1)
pnpm dev                     # build shared packages, run API + web
```

| Service    | URL                              |
| ---------- | -------------------------------- |
| Web        | http://localhost:5173            |
| API health | http://127.0.0.1:3000/api/health |
| PostgreSQL | localhost:5432 (127.0.0.1 only)  |
| Redis      | localhost:6379 (127.0.0.1 only)  |

Run a single app with `pnpm dev:api` or `pnpm dev:web`. Both bind to `127.0.0.1` only.

> **Windows PowerShell:** if script execution policy blocks `pnpm`, call the `.cmd` launcher instead, e.g. `pnpm.cmd install` or `pnpm.cmd dev`. You do not need to change the execution policy.

## Scripts

| Command                                       | Description                                                  |
| --------------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                                    | Build shared packages, then run API and web in watch mode    |
| `pnpm build`                                  | Production build of every package and app                    |
| `pnpm check`                                  | Format check + lint + typecheck + tests (run before pushing) |
| `pnpm lint` / `lint:fix`                      | ESLint (zero warnings allowed)                               |
| `pnpm format` / `format:check`                | Prettier                                                     |
| `pnpm typecheck`                              | TypeScript across all workspaces                             |
| `pnpm test`                                   | Vitest across all workspaces                                 |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Manage local Docker infrastructure                           |
| `pnpm infra:validate`                         | Validate the Compose file                                    |
| `pnpm setup:env`                              | Create missing `.env` files from `.env.example`              |

## API

`GET /api/health` is a liveness check. It does not probe the database or cache.

```json
{
  "status": "ok",
  "service": "ogs-api",
  "version": "0.1.0",
  "timestamp": "2026-11-04T17:25:24.720Z",
  "uptimeSeconds": 3
}
```

The response type `HealthCheckResponse` is inferred from `healthCheckResponseSchema` in `@ogs/contracts`. The API test suite and the web app both check responses against that same schema.

## Configuration and security

- Only `.env.example` templates are committed. Real `.env` files are git-ignored.
- The API validates its environment at startup and refuses to start if a variable is invalid. Error messages name the variable but never show its value.
- Docker Compose has no default credentials. It will not start unless `POSTGRES_*` and `REDIS_PASSWORD` are set, and it binds ports to `127.0.0.1` only.
- pnpm's supply-chain protections are left on. Only Prisma is allowed to run install scripts (`allowBuilds` in `pnpm-workspace.yaml`), and the minimum package release age is enforced.
- Browser-visible variables (`VITE_*`) are public. Never put secrets in them.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Getting started](docs/development/getting-started.md)
- [Development standards](docs/development/standards.md)

## License

Proprietary. © ObagaGlobal. All rights reserved.
