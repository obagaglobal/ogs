#!/usr/bin/env node
/**
 * Recreates the INTEGRATION TEST database (ogs_test) from scratch: drops all of
 * its data and re-applies every migration as ogs_owner.
 *
 * Only needed when a migration was edited rather than appended during
 * development. Never touches the dev database: the URL is rewritten to the test
 * database and must point at a local server.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const database = process.env.OGS_TEST_DB ?? 'ogs_test';
if (!/^ogs_test[a-z0-9_]*$/.test(database)) {
  console.error('Refusing: OGS_TEST_DB must start with "ogs_test".');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' || !process.env.DATABASE_MIGRATION_URL) {
  console.error('Refusing: NODE_ENV is production or DATABASE_MIGRATION_URL is not set.');
  process.exit(1);
}
const url = new URL(process.env.DATABASE_MIGRATION_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error('Refusing: DATABASE_MIGRATION_URL does not point at a local server.');
  process.exit(1);
}
url.pathname = `/${database}`;
url.search = '';

console.log(`Resetting local test database "${database}"...`);
execSync('pnpm exec prisma migrate reset --force', {
  env: { ...process.env, DATABASE_MIGRATION_URL: url.toString() },
  stdio: 'inherit',
});
