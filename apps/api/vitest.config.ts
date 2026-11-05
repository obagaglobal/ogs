import { defineConfig } from 'vitest/config';

/**
 * Unit and HTTP e2e tests: no PostgreSQL or Redis needed. Connections in the API
 * are lazy, so the app boots without them; the placeholder URLs below satisfy
 * env validation and point at a closed port, so an accidental query fails fast.
 * Tests that need real infrastructure live in test/integration (see
 * vitest.integration.config.ts).
 */
export default defineConfig({
  // NestJS dependency injection relies on legacy decorators + emitted type metadata.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    restoreMocks: true,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unit-test:unused@127.0.0.1:1/unused',
      REDIS_URL: 'redis://127.0.0.1:1/0',
    },
  },
});
