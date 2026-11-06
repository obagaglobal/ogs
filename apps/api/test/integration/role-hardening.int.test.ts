import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attempt, connect } from './support.js';

const INSUFFICIENT_PRIVILEGE = '42501';

/** T4 — ogs_app cannot escape RLS by any route available to it. */
describe('ogs_app role hardening (T4)', () => {
  let app: pg.Client;
  let owner: pg.Client;

  beforeAll(async () => {
    app = await connect('app');
    owner = await connect('owner');
    // Every attempt runs inside one transaction with savepoints, so a
    // statement that unexpectedly succeeds still changes nothing.
    await app.query('BEGIN');
  });

  afterAll(async () => {
    await app.query('ROLLBACK');
    await app.end();
    await owner.end();
  });

  it('is not a superuser and has no BYPASSRLS', async () => {
    const result = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it.each(['ogs_owner', 'ogs_maint', 'ogs_readonly'])('cannot SET ROLE %s', async (role) => {
    expect(await attempt(app, `SET ROLE ${role}`)).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it.each([
    'ALTER TABLE tenant DISABLE ROW LEVEL SECURITY',
    'ALTER TABLE tenant NO FORCE ROW LEVEL SECURITY',
    'DROP POLICY tenant_select ON tenant',
    'CREATE POLICY leak ON tenant FOR SELECT USING (true)',
    'ALTER TABLE audit_log DISABLE TRIGGER ALL',
    'TRUNCATE audit_log',
    'CREATE TABLE public.sneaky (id int)',
    'CREATE FUNCTION app.sneaky() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$',
  ])('cannot run: %s', async (sql) => {
    expect(await attempt(app, sql)).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('row_security = off errors instead of returning rows', async () => {
    await app.query('SAVEPOINT rs');
    await app.query('SET LOCAL row_security = off');
    const result = await attempt(app, 'SELECT * FROM tenant');
    await app.query('ROLLBACK TO SAVEPOINT rs');
    expect(result).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    expect('error' in result && result.error).toMatch(/row-level security/);
  });

  it('cannot DELETE from any table (no grant: deletes are soft)', async () => {
    for (const table of ['tenant', 'app_user', 'membership', 'audit_log', 'outbox_event']) {
      expect(await attempt(app, `DELETE FROM ${table}`)).toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    }
  });

  it('even the schema owner sees no rows without a context (FORCE RLS)', async () => {
    const result = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM tenant');
    expect(result.rows[0]?.n).toBe(0);
  });
});
