# @ogs/contracts

Shared contracts between `apps/api` and `apps/web`, built with [Zod](https://zod.dev).

Each contract is a Zod schema; its TypeScript type is inferred from the schema with `z.infer`, so the runtime check and the static type cannot drift apart.

- `healthCheckResponseSchema` / `HealthCheckResponse`: the `GET /api/health` response.
- `apiEnvSchema` / `parseApiEnv` / `ApiEnv`: validates the API environment at startup. Error messages name the invalid keys only and never include their values.

Rules:

- Every export is a public contract between applications; change it deliberately.
- No framework code (NestJS, React) in this package.

Build with `pnpm --filter @ogs/contracts build` (output in `dist/`). Test with `pnpm --filter @ogs/contracts test`.
