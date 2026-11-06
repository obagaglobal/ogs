import { defineConfig } from 'vitest/config';

/**
 * Integration tests against real PostgreSQL 18 and Redis 8 (Phase 2 plan §4).
 *
 * Global setup resets the dedicated `ogs_test` database (never the dev database)
 * and applies all migrations as ogs_owner. Tests then connect as ogs_app (RLS
 * enforced), ogs_owner or ogs_maint, exactly like production code would.
 *
 * Run: `pnpm test:integration` (needs `pnpm infra:up` and `pnpm db:roles`).
 */
export default defineConfig({
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // Points the app's env at the test database, test Redis prefix and Mailpit
    // BEFORE any test imports AppModule (ConfigModule validates at import time).
    setupFiles: ['test/integration/env-setup.ts'],
    // Files share one database; run them one at a time so timing-sensitive
    // tests (pool, concurrency, queues) are not disturbed by each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
