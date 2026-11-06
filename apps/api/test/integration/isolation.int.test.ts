import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attempt,
  connect,
  createTenantLogRows,
  createTwoTenants,
  withContext,
  type Fixture,
} from './support.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const TABLES = ['tenant', 'app_user', 'membership', 'audit_log', 'outbox_event'] as const;
const PHASE_3_TABLES = [
  'credential',
  'user_token',
  'authentication_event',
  'notification_delivery',
  'permission',
  'role',
  'role_permission',
  'membership_role',
] as const;

describe('fail closed without a context (T2)', () => {
  let app: pg.Client;
  let maint: pg.Client;
  let fx: Fixture;

  beforeAll(async () => {
    app = await connect('app');
    maint = await connect('maint');
    fx = await createTwoTenants(maint);
    await createTenantLogRows(maint, fx.tenantA, fx.userA);
  });

  afterAll(async () => {
    await app.end();
    await maint.end();
  });

  it.each([...TABLES, ...PHASE_3_TABLES])(
    '%s returns zero rows when no context was ever set',
    async (table) => {
      const result = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(result.rows[0]?.n).toBe(0);
    },
  );

  it('every insert is rejected without a context', async () => {
    await app.query('BEGIN');
    try {
      const statements: [string, unknown[]][] = [
        [
          `INSERT INTO tenant (kind, name, slug) VALUES ('ORGANISATION', 'x', $1)`,
          [`x-${randomUUID()}`],
        ],
        [`INSERT INTO app_user (email) VALUES ($1)`, [`${randomUUID()}@example.test`]],
        [`INSERT INTO membership (tenant_id, user_id) VALUES ($1, $2)`, [fx.tenantA, fx.userA]],
        [`INSERT INTO audit_log (action) VALUES ('test.no_context')`, []],
        [`INSERT INTO outbox_event (type, payload) VALUES ('test.no_context', '{}')`, []],
      ];
      for (const [sql, params] of statements) {
        const result = await attempt(app, sql, params);
        expect(result, sql).toHaveProperty('error');
      }
    } finally {
      await app.query('ROLLBACK');
    }
  });
});

describe('cross-tenant matrix under tenant A context (T3)', () => {
  let app: pg.Client;
  let maint: pg.Client;
  let fx: Fixture;

  beforeAll(async () => {
    app = await connect('app');
    maint = await connect('maint');
    fx = await createTwoTenants(maint);
    await createTenantLogRows(maint, fx.tenantA, fx.userA);
    await createTenantLogRows(maint, fx.tenantB, fx.userB);
  });

  afterAll(async () => {
    await app.end();
    await maint.end();
  });

  const asA = <T>(work: () => Promise<T>) =>
    withContext(app, { userId: fx.userA, tenantId: fx.tenantA }, work);

  it('positive control: A sees its own rows', async () => {
    await asA(async () => {
      const own = await app.query<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM tenant WHERE id = $1) AS tenant,
                (SELECT count(*)::int FROM membership WHERE id = $2) AS membership,
                (SELECT count(*)::int FROM app_user WHERE id = $3) AS app_user,
                (SELECT count(*)::int FROM audit_log WHERE tenant_id = $1) AS audit_log`,
        [fx.tenantA, fx.membershipA, fx.userA],
      );
      expect(own.rows[0]).toEqual({ tenant: 1, membership: 1, app_user: 1, audit_log: 1 });
    });
  });

  it('cannot READ any of B’s rows', async () => {
    await asA(async () => {
      const foreign = await app.query<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM tenant WHERE id = $1) AS tenant,
                (SELECT count(*)::int FROM membership WHERE tenant_id = $1) AS membership,
                (SELECT count(*)::int FROM app_user WHERE id = $2) AS app_user,
                (SELECT count(*)::int FROM audit_log WHERE tenant_id = $1) AS audit_log,
                (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $1) AS outbox_event`,
        [fx.tenantB, fx.userB],
      );
      expect(foreign.rows[0]).toEqual({
        tenant: 0,
        membership: 0,
        app_user: 0,
        audit_log: 0,
        outbox_event: 0,
      });
    });
  });

  it('cannot UPDATE any of B’s rows (0 rows affected)', async () => {
    await asA(async () => {
      const updates: [string, unknown[]][] = [
        [`UPDATE tenant SET name = 'hijacked' WHERE id = $1`, [fx.tenantB]],
        [`UPDATE membership SET status = 'SUSPENDED' WHERE tenant_id = $1`, [fx.tenantB]],
        [`UPDATE app_user SET status = 'SUSPENDED' WHERE id = $1`, [fx.userB]],
        [`UPDATE outbox_event SET attempts = 99 WHERE tenant_id = $1`, [fx.tenantB]],
      ];
      for (const [sql, params] of updates) {
        expect(await attempt(app, sql, params), sql).toMatchObject({ rowCount: 0 });
      }
    });
  });

  it('cannot DELETE any of B’s rows', async () => {
    await asA(async () => {
      for (const table of TABLES) {
        expect(await attempt(app, `DELETE FROM ${table}`), table).toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
        });
      }
    });
  });

  it('cannot INSERT rows owned by B', async () => {
    await asA(async () => {
      const inserts: [string, unknown[]][] = [
        [`INSERT INTO membership (tenant_id, user_id) VALUES ($1, $2)`, [fx.tenantB, fx.userA]],
        [
          `INSERT INTO audit_log (tenant_id, action) VALUES ($1, 'test.cross_tenant')`,
          [fx.tenantB],
        ],
        [
          `INSERT INTO outbox_event (tenant_id, type, payload) VALUES ($1, 'test.cross_tenant', '{}')`,
          [fx.tenantB],
        ],
        [
          `INSERT INTO tenant (kind, name, slug) VALUES ('ORGANISATION', 'x', $1)`,
          [`x-${randomUUID()}`],
        ],
      ];
      for (const [sql, params] of inserts) {
        expect(await attempt(app, sql, params), sql).toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
        });
      }
    });
  });

  it('cannot MOVE its own row into B (WITH CHECK)', async () => {
    await asA(async () => {
      expect(
        await attempt(app, `UPDATE membership SET tenant_id = $1 WHERE id = $2`, [
          fx.tenantB,
          fx.membershipA,
        ]),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it('may write audit and outbox rows for its own tenant', async () => {
    await asA(async () => {
      expect(
        await attempt(app, `INSERT INTO audit_log (tenant_id, action) VALUES ($1, 'test.own')`, [
          fx.tenantA,
        ]),
      ).toMatchObject({ rowCount: 1 });
      expect(
        await attempt(
          app,
          `INSERT INTO outbox_event (tenant_id, type, payload) VALUES ($1, 'test.own', '{}')`,
          [fx.tenantA],
        ),
      ).toMatchObject({ rowCount: 1 });
    });
  });

  it('cannot read the outbox as a user, even its own tenant’s events', async () => {
    await asA(async () => {
      const result = await app.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox_event');
      expect(result.rows[0]?.n).toBe(0);
    });
  });

  it('cannot spoof the audit actor', async () => {
    await asA(async () => {
      expect(
        await attempt(
          app,
          `INSERT INTO audit_log (tenant_id, action, actor_user_id) VALUES ($1, 'test.spoof', $2)`,
          [fx.tenantA, fx.userB],
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      expect(
        await attempt(
          app,
          `INSERT INTO audit_log (tenant_id, action, actor_kind) VALUES ($1, 'test.spoof', 'SYSTEM')`,
          [fx.tenantA],
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it('a user in personal context sees only their own user row and memberships', async () => {
    await withContext(app, { userId: fx.userA }, async () => {
      const result = await app.query<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM app_user) AS users,
                (SELECT count(*)::int FROM membership) AS memberships,
                (SELECT count(*)::int FROM tenant) AS tenants`,
      );
      expect(result.rows[0]).toEqual({ users: 1, memberships: 1, tenants: 1 });
    });
  });
});
