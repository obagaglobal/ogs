#!/usr/bin/env node
/**
 * Guard for destructive development commands (db:reset).
 * Refuses unless NODE_ENV is not production AND the migration database is local.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const fail = (reason) => {
  console.error(`Refusing to continue: ${reason}`);
  process.exit(1);
};

if (process.env.NODE_ENV === 'production') {
  fail('NODE_ENV is production.');
}
const raw = process.env.DATABASE_MIGRATION_URL;
if (!raw) {
  fail('DATABASE_MIGRATION_URL is not set.');
}
let url;
try {
  url = new URL(raw);
} catch {
  fail('DATABASE_MIGRATION_URL is not a valid URL.');
}
if (!LOCAL_HOSTS.has(url.hostname)) {
  fail('DATABASE_MIGRATION_URL does not point at a local database.');
}
console.log(`OK: local database "${url.pathname.slice(1)}".`);
