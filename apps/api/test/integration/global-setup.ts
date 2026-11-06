import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { TestProject } from 'vitest/node';

export interface IntegrationUrls {
  /** ogs_app: the runtime role. RLS enforced. */
  readonly app: string;
  /** ogs_owner: owns the schema (subject to FORCE RLS like everyone else). */
  readonly owner: string;
  /** ogs_maint: BYPASSRLS, used only to create fixtures across tenants. */
  readonly maint: string;
  readonly redis: string;
  /** Unique BullMQ prefix for this run, so runs never see each other's jobs. */
  readonly queuePrefix: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationUrls;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set (apps/api/.env) to run integration tests`);
  }
  return value;
}

/** Same server and credentials, but always the dedicated test database. */
function toTestDatabase(name: string, database: string): string {
  const url = new URL(required(name));
  if (!LOCAL_HOSTS.has(url.hostname) && process.env['CI'] !== 'true') {
    throw new Error(`${name} must point at a local server for integration tests`);
  }
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

export default function setup(project: TestProject): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const database = process.env['OGS_TEST_DB'] ?? 'ogs_test';
  if (!/^ogs_test[a-z0-9_]*$/.test(database)) {
    throw new Error('OGS_TEST_DB must start with "ogs_test" so tests never touch another database');
  }

  const urls: IntegrationUrls = {
    app: toTestDatabase('DATABASE_URL', database),
    owner: toTestDatabase('DATABASE_MIGRATION_URL', database),
    maint: toTestDatabase('DATABASE_MAINT_URL', database),
    redis: required('REDIS_URL'),
    queuePrefix: `ogs-test-${randomBytes(4).toString('hex')}`,
  };

  // Bring the test database up to date as ogs_owner. Non-destructive: tests
  // create their own uniquely named rows and never depend on an empty database.
  // If a migration was edited (not appended) during development, recreate the
  // test database yourself with `pnpm db:reset:test`.
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_MIGRATION_URL: urls.owner },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  project.provide('integration', urls);
}
