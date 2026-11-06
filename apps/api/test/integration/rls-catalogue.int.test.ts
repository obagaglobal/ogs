import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './support.js';

/**
 * T5 — Catalogue guard. Prisma never generates RLS, so this test is the safety
 * net: a migration that adds a table without RLS + FORCE + a policy, or that
 * hands ogs_app a privilege that ignores RLS, fails CI.
 */
const ALLOWLIST = new Set(['_prisma_migrations']);
const KNOWN_TABLES = [
  // Phase 2
  'app_user',
  'audit_log',
  'membership',
  'outbox_event',
  'tenant',
  // Phase 3A
  'authentication_event',
  'credential',
  'membership_role',
  'notification_delivery',
  'permission',
  'role',
  'role_permission',
  'user_token',
  // Phase 3B
  'file_metadata',
  'mfa_factor',
  'recovery_code',
];

interface TableRow {
  table: string;
  rls: boolean;
  forced: boolean;
  policies: number;
}

describe('RLS catalogue guard (T5)', () => {
  let owner: pg.Client;
  let tables: TableRow[];

  beforeAll(async () => {
    owner = await connect('owner');
    const result = await owner.query<TableRow>(`
      SELECT c.relname AS table,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`);
    tables = result.rows.filter((row) => !ALLOWLIST.has(row.table));
  });

  afterAll(async () => {
    await owner.end();
  });

  it('sees every known table (the guard is not vacuous)', () => {
    expect(tables.map((row) => row.table)).toEqual(expect.arrayContaining(KNOWN_TABLES));
  });

  it('every table has RLS enabled AND forced AND at least one policy', () => {
    const offenders = tables.filter((row) => !row.rls || !row.forced || row.policies === 0);
    expect(offenders).toEqual([]);
  });

  it('no runtime role holds TRUNCATE, REFERENCES or TRIGGER on any table (TRUNCATE ignores RLS)', async () => {
    const result = await owner.query<{ role: string; table: string; privilege: string }>(`
      SELECT r.role, c.relname AS table, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['ogs_app', 'ogs_readonly']) AS r(role)
       CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND has_table_privilege(r.role, c.oid, p.privilege)`);
    expect(result.rows).toEqual([]);
  });

  it('ogs_app cannot touch the migrations table', async () => {
    const result = await owner.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('ogs_app', '_prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE') AS allowed`,
    );
    expect(result.rows[0]?.allowed).toBe(false);
  });

  it('ogs_app owns nothing', async () => {
    const result = await owner.query<{ owned: number }>(`
      SELECT count(*)::int AS owned FROM pg_class c
       WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'ogs_app')`);
    expect(result.rows[0]?.owned).toBe(0);
  });
});
