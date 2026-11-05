# Architecture Overview

> Status: Phase 1 (engineering foundation). This document describes what exists today and the intended direction. Planned items are marked **(planned)** and are not implemented.

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

Phase 1 implements **none** of these business capabilities. It only provides the foundation they will be built on.

## 2. System context

```
 Browser ──HTTP──▶ apps/web (React SPA, Vite)
                       │  /api/* (dev: Vite proxy)
                       ▼
                   apps/api (NestJS) ──▶ PostgreSQL (planned use, via Prisma)
                                     └─▶ Redis      (planned use: cache, queues, sessions)
```

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
- **Health:** `GET /api/health` is a **liveness** check. It returns `HealthCheckResponse` with `Cache-Control: no-store`. It deliberately does not probe PostgreSQL or Redis. A readiness endpoint (`/api/health/ready`) **(planned)** will be added when the API first depends on them.
- **Feature modules:** each capability gets its own Nest module under `src/<feature>/` (controller, service, module, tests). `health/` is the reference example.
- **Prisma (foundation only):** `prisma/schema.prisma` declares the PostgreSQL datasource and the `prisma-client` generator. It has no models yet. `prisma.config.ts` reads `DATABASE_URL`. The client is not generated or used yet, so `@prisma/client` and a driver adapter will be added together with the first model.

## 5. Frontend (`apps/web`)

- **React 19 + Vite 8 + TypeScript.** Tailwind CSS 4 is wired in through `@tailwindcss/vite`, so there is no `tailwind.config.js`.
- **shadcn/ui:** set up in `components.json` (new-york style, neutral base, CSS variables in `src/index.css`). The `cn()` helper lives in `src/lib/utils.ts`. Generated primitives go in `src/components/ui/`, which currently contains only `button.tsx`. Add more with `pnpm dlx shadcn@latest add <component>` from `apps/web`.
- **Structure:** feature folders in `src/features/<feature>/` hold that feature's components and hooks. `system-status/` is the reference example: it calls `/api/health` and checks the response against the shared schema at runtime.
- **Path alias:** `@/` maps to `src/` (set in `tsconfig.app.json` and `vite.config.ts`).
- **Environment:** only `VITE_`-prefixed variables reach the browser, and they are public. `API_PROXY_TARGET` is read by the dev server only.

## 6. Multi-tenancy (planned direction, not implemented)

Decided in the [Architecture Review](review.md) §4–§6 and ADR-009/010 ([`DECISIONS.md`](../DECISIONS.md)). It is implemented in Phase 2. In summary:

- One shared PostgreSQL schema. Each row has an explicit owner: platform, tenant (`tenant_id`) or user (`owner_user_id`/`customer_user_id`).
- The server resolves the workspace from the `X-OGS-Workspace` request header by validating an active membership. The client's value is never trusted as fact.
- RLS uses `ENABLE` + `FORCE` on every tenant table. The runtime role `ogs_app` has no BYPASSRLS. Context is set with transaction-local `set_config(..., true)` inside a `TenantDb` transaction, which makes it safe with connection pooling.
- Assigned providers reach another tenant's rows only through an active-assignment RLS branch (ADR-010).

## 7. Architecture decisions

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
