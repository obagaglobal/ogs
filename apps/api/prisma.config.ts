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
    // Migrations run as the schema owner (ogs_owner), never as the runtime role.
    // Optional so that `prisma validate` / `prisma generate` work without a database.
    url: process.env['DATABASE_MIGRATION_URL'] ?? '',
  },
});
