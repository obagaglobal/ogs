import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthzSyncService } from '../../src/authz/authz-sync.service.js';
import { CATALOGUE } from '../../src/authz/catalogue.js';
import { connect, createTenantDb } from './support.js';

describe('authorisation catalogue sync', () => {
  let maint: pg.Client;
  const { db, client } = createTenantDb(2);
  const sync = new AuthzSyncService(db);

  beforeAll(async () => {
    maint = await connect('maint');
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  it('makes the database match catalogue.json and is idempotent', async () => {
    await sync.sync();
    const second = await sync.sync();
    expect(second).toMatchObject({ grantsAdded: 0, grantsRemoved: 0 });

    const { rows } = await maint.query<{ code: string; n: number }>(
      `SELECT r.code, count(rp.permission_code)::int AS n
         FROM role r LEFT JOIN role_permission rp ON rp.role_id = r.id
        WHERE r.tenant_id IS NULL GROUP BY r.code`,
    );
    for (const role of CATALOGUE.roles) {
      expect(rows.find((row) => row.code === role.code)?.n, role.code).toBe(
        role.permissions.length,
      );
    }
  });

  it('removes a grant that is not in the catalogue (drift is repaired)', async () => {
    await maint.query(
      `INSERT INTO role_permission (role_id, permission_code)
       SELECT id, 'audit.read' FROM role WHERE code = 'org_employee' AND tenant_id IS NULL
       ON CONFLICT DO NOTHING`,
    );
    expect((await sync.sync()).grantsRemoved).toBe(1);
  });

  it('two instances syncing at once do not conflict', async () => {
    const results = await Promise.all([sync.sync(), sync.sync(), sync.sync()]);
    expect(results.every((result) => result.grantsAdded === 0)).toBe(true);
  });
});
