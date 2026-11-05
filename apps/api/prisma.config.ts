import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env automatically. Use Node's built-in loader
// (no extra dependency); variables already set in the shell take precedence.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional in Phase 1: required only for commands that connect (migrate, db).
    url: process.env['DATABASE_URL'] ?? '',
  },
});
