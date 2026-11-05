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
- **API e2e tests:** boot `AppModule` through `@nestjs/testing`, apply `configureApp`, and send requests with Supertest.
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
