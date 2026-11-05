# Getting Started (Local Development)

## Prerequisites

- Node.js **24.18.1** (`nvm use` reads `.nvmrc`)
- pnpm **11.21.0** (`corepack enable` picks it up from `package.json`)
- Docker Desktop / Docker Engine with Compose v2

### Windows PowerShell

If the execution policy blocks the `pnpm.ps1` / `npm.ps1` launchers, use the `.cmd` launchers that ship alongside them: `pnpm.cmd install`, `pnpm.cmd dev`, `pnpm.cmd check`, and so on. Every `pnpm <script>` command in this guide works the same way as `pnpm.cmd <script>`. You do not need to (and should not) change the execution policy.

## First-time setup

```bash
pnpm install          # install all workspace dependencies
pnpm setup:env        # create .env, apps/api/.env, apps/web/.env from templates (never overwrites)
```

Edit the generated files and replace the `change-me-local-only` placeholders. Keep the passwords in `apps/api/.env` (`DATABASE_URL`, `REDIS_URL`) the same as the ones in the root `.env`.

## Start infrastructure (PostgreSQL + Redis)

```bash
pnpm infra:up         # docker compose up -d
docker compose -f infrastructure/docker/compose.yaml --env-file .env ps   # both should be "healthy"
pnpm infra:down       # stop; data persists in the ogs_postgres-data / ogs_redis-data volumes
```

The API does not connect to either service yet. They are ready for later phases.

## Run the applications

```bash
pnpm dev              # build shared packages, then run API and web together
pnpm dev:api          # API only  → http://127.0.0.1:3000/api/health
pnpm dev:web          # web only  → http://localhost:5173
```

The web app proxies `/api/*` to the API, so its "API status" card shows **Online** once the API is running.

## Everyday commands

| Command                                  | What it does                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `pnpm check`                             | format check + lint + typecheck + tests          |
| `pnpm format`                            | apply Prettier formatting                        |
| `pnpm lint:fix`                          | auto-fix lint issues                             |
| `pnpm test`                              | run all test suites once                         |
| `pnpm build`                             | production build of all packages and apps        |
| `pnpm infra:validate`                    | validate the Compose file against `.env.example` |
| `pnpm --filter @ogs/api prisma:validate` | validate the Prisma schema                       |

## Troubleshooting

- **`Cannot find module '@ogs/contracts'`**: the shared packages have not been built yet. Run `pnpm build:packages`. The root `dev`, `typecheck` and `test` scripts do this for you.
- **`Invalid API environment configuration`**: a variable in `apps/api/.env` is malformed. The error message names it.
- **Port already in use**: change `API_PORT` in `apps/api/.env` (and `API_PROXY_TARGET` in `apps/web/.env`), or change `POSTGRES_PORT`/`REDIS_PORT` in `.env`.
