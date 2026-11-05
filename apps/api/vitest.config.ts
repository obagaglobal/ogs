import { defineConfig } from 'vitest/config';

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
    restoreMocks: true,
  },
});
