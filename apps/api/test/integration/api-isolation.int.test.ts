import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createLoginUser,
  grantRole,
  startStack,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { attempt, connect, createMembership, createTenant, withContext } from './support.js';

/**
 * A10 — tenant isolation proven through the HTTP API with real sessions
 * (ADR-027), on top of the database-level proofs from Phase 2.
 */
let stack: Stack;
let maint: pg.Client;

interface Org {
  tenantId: string;
  admin: FixtureUser;
  adminMembership: string;
  employee: FixtureUser;
  employeeMembership: string;
}

async function createOrg(status = 'ACTIVE'): Promise<Org> {
  const tenantId = await createTenant(maint, { status });
  const admin = await createLoginUser(maint);
  const employee = await createLoginUser(maint);
  const adminMembership = await createMembership(maint, tenantId, admin.id);
  const employeeMembership = await createMembership(maint, tenantId, employee.id);
  await grantRole(maint, adminMembership, tenantId, 'org_admin');
  await grantRole(maint, employeeMembership, tenantId, 'org_employee');
  return { tenantId, admin, adminMembership, employee, employeeMembership };
}

async function signedIn(user: FixtureUser): Promise<Client> {
  const client = new Client(stack.server);
  const response = await client.login(user.email, user.password);
  expect(response.status).toBe(200);
  return client;
}

beforeAll(async () => {
  stack = await startStack({ worker: false });
  maint = await connect('maint');
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

describe('A10 — API isolation', () => {
  let a: Org;
  let b: Org;
  let adminA: Client;

  beforeAll(async () => {
    a = await createOrg();
    b = await createOrg();
    adminA = await signedIn(a.admin);
  });

  it('positive control: A’s admin lists exactly A’s members', async () => {
    const response = await adminA.get('/workspace/members', { workspace: a.tenantId });
    expect(response.status).toBe(200);
    const ids = (response.body as { members: { membershipId: string }[] }).members.map(
      (m) => m.membershipId,
    );
    expect(ids.sort()).toEqual([a.adminMembership, a.employeeMembership].sort());
  });

  it('changing the id in the URL to B’s member gives 404, not B’s data', async () => {
    const response = await adminA.get(`/workspace/members/${b.adminMembership}`, {
      workspace: a.tenantId,
    });
    expect([response.status, response.body]).toEqual([404, { error: 'not_found' }]);
  });

  it('naming B’s workspace in the header is refused', async () => {
    const response = await adminA.get('/workspace/members', { workspace: b.tenantId });
    expect([response.status, response.body]).toEqual([403, { error: 'workspace_forbidden' }]);
  });

  it.each(['not-a-uuid', '00000000-0000-0000-0000-000000000000', "' OR 1=1 --", ''])(
    'a forged workspace header %j is refused',
    async (header) => {
      const response = await adminA.get('/workspace/members', { workspace: header });
      expect(response.status).toBe(403);
    },
  );

  it('a permission the role lacks is refused (employee cannot list members)', async () => {
    const employee = await signedIn(a.employee);
    const response = await employee.get('/workspace/members', { workspace: a.tenantId });
    expect([response.status, response.body]).toEqual([403, { error: 'permission_denied' }]);
    // …but can see their own workspace.
    expect((await employee.get('/workspace', { workspace: a.tenantId })).body).toMatchObject({
      tenantId: a.tenantId,
      roles: ['org_employee'],
    });
  });

  it('the personal workspace grants no tenant permissions', async () => {
    const response = await adminA.get('/workspace/members', { workspace: 'personal' });
    expect([response.status, response.body]).toEqual([403, { error: 'permission_denied' }]);
  });

  it('a member of both A and C, acting in A, sees only A’s members', async () => {
    const c = await createOrg();
    const both = await createLoginUser(maint);
    const inA = await createMembership(maint, a.tenantId, both.id);
    const inC = await createMembership(maint, c.tenantId, both.id);
    await grantRole(maint, inA, a.tenantId, 'org_admin');
    await grantRole(maint, inC, c.tenantId, 'org_admin');
    const client = await signedIn(both);

    const listed = (await client.get('/workspace/members', { workspace: a.tenantId })).body as {
      members: { membershipId: string }[];
    };
    expect(listed.members.map((m) => m.membershipId)).not.toContain(inC);
    expect(listed.members.map((m) => m.membershipId)).toContain(inA);
    expect(
      (await client.get(`/workspace/members/${c.adminMembership}`, { workspace: a.tenantId }))
        .status,
    ).toBe(404);
  });

  it('ending a membership removes access on the very next request', async () => {
    const org = await createOrg();
    const client = await signedIn(org.admin);
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).status).toBe(200);
    await maint.query(`UPDATE membership SET status = 'ENDED', ended_at = now() WHERE id = $1`, [
      org.adminMembership,
    ]);
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).body).toEqual({
      error: 'workspace_forbidden',
    });
  });

  it('removing a role removes its permissions on the very next request', async () => {
    const org = await createOrg();
    const client = await signedIn(org.admin);
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).status).toBe(200);
    await maint.query('DELETE FROM membership_role WHERE membership_id = $1', [
      org.adminMembership,
    ]);
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).body).toEqual({
      error: 'permission_denied',
    });
  });

  it('a suspended tenant drops to a restricted workspace on the next request', async () => {
    const org = await createOrg();
    const client = await signedIn(org.admin);
    await maint.query(`UPDATE tenant SET status = 'SUSPENDED' WHERE id = $1`, [org.tenantId]);
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).body).toEqual({
      error: 'workspace_restricted',
    });
    // The application-status endpoint stays reachable.
    expect((await client.get('/workspace', { workspace: org.tenantId })).body).toMatchObject({
      status: 'SUSPENDED',
      restricted: true,
    });
  });

  it('a pending organisation never gains operational access', async () => {
    const pending = await createOrg('PENDING_APPROVAL');
    const client = await signedIn(pending.admin);
    expect((await client.get('/workspace/members', { workspace: pending.tenantId })).status).toBe(
      403,
    );
    expect((await client.get('/workspace', { workspace: pending.tenantId })).body).toMatchObject({
      restricted: true,
    });
  });

  it('a session revoked from another device stops working immediately', async () => {
    const org = await createOrg();
    const laptop = await signedIn(org.admin);
    const phone = await signedIn(org.admin);
    const phoneSession = ((await phone.get('/auth/session')).body as { session: { id: string } })
      .session.id;
    expect((await laptop.delete(`/auth/sessions/${phoneSession}`)).status).toBe(204);
    expect((await phone.get('/workspace/members', { workspace: org.tenantId })).status).toBe(401);
  });

  it('the workspace switcher lists only the caller’s active workspaces', async () => {
    const listed = (await adminA.get('/me/workspaces')).body as {
      workspaces: { tenantId: string }[];
    };
    expect(listed.workspaces.map((w) => w.tenantId)).toEqual([a.tenantId]);
  });

  it('no request without a session reaches a protected route', async () => {
    const anonymous = new Client(stack.server);
    for (const path of ['/me/workspaces', '/workspace', '/workspace/members', '/auth/sessions']) {
      expect((await anonymous.get(path, { workspace: a.tenantId })).status, path).toBe(401);
    }
  });
});

describe('A9 — roles cannot cross tenant kinds or tenants', () => {
  let app: pg.Client;
  let org: Org;

  beforeAll(async () => {
    app = await connect('app');
    org = await createOrg();
  });

  afterAll(async () => {
    await app.end();
  });

  const asOrg = <T>(work: () => Promise<T>) =>
    withContext(app, { userId: org.admin.id, tenantId: org.tenantId }, work);

  it('an organisation custom role cannot hold a platform permission', async () => {
    await asOrg(async () => {
      const role = await app.query<{ id: string }>(
        `INSERT INTO role (tenant_id, scope, code, name) VALUES ($1, 'ORGANISATION', 'auditors', 'Auditors') RETURNING id`,
        [org.tenantId],
      );
      const roleId = role.rows[0]?.id;
      expect(
        await attempt(
          app,
          `INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'audit.read')`,
          [roleId],
        ),
      ).toMatchObject({ rowCount: 1 });
      expect(
        await attempt(
          app,
          `INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'platform.settings.manage')`,
          [roleId],
        ),
      ).toMatchObject({ code: '23514' });
    });
  });

  it('an organisation cannot create or edit system roles', async () => {
    await asOrg(async () => {
      expect(
        await attempt(
          app,
          `INSERT INTO role (tenant_id, scope, code, name, is_system) VALUES (NULL, 'ORGANISATION', 'x', 'x', true)`,
        ),
      ).toMatchObject({ code: '42501' });
      expect(
        await attempt(
          app,
          `UPDATE role SET name = 'hijacked' WHERE code = 'org_admin' AND tenant_id IS NULL`,
        ),
      ).toMatchObject({ rowCount: 0 });
      const superAdmin = await app.query<{ id: string }>(
        `SELECT id FROM role WHERE code = 'super_admin'`,
      );
      expect(
        await attempt(
          app,
          `INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'workspace.read')`,
          [superAdmin.rows[0]?.id],
        ),
      ).toMatchObject({ code: '42501' });
    });
  });

  it('a PLATFORM role cannot be granted inside an organisation', async () => {
    await asOrg(async () => {
      const superAdmin = await app.query<{ id: string }>(
        `SELECT id FROM role WHERE code = 'super_admin'`,
      );
      expect(
        await attempt(
          app,
          `INSERT INTO membership_role (membership_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
          [org.employeeMembership, superAdmin.rows[0]?.id, org.tenantId],
        ),
      ).toMatchObject({ code: '23514' });
    });
  });

  it('another organisation’s custom roles are invisible and ungrantable', async () => {
    const other = await createOrg();
    const { rows } = await maint.query<{ id: string }>(
      `INSERT INTO role (tenant_id, scope, code, name) VALUES ($1, 'ORGANISATION', 'secret_role', 'Secret') RETURNING id`,
      [other.tenantId],
    );
    await asOrg(async () => {
      expect((await app.query('SELECT 1 FROM role WHERE id = $1', [rows[0]?.id])).rowCount).toBe(0);
      expect(
        await attempt(
          app,
          `INSERT INTO membership_role (membership_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
          [org.employeeMembership, rows[0]?.id, org.tenantId],
        ),
      ).toHaveProperty('error');
    });
  });

  it('credentials and tokens are invisible to every user and tenant context', async () => {
    await asOrg(async () => {
      const counts = await app.query<{ c: number; t: number }>(
        'SELECT (SELECT count(*)::int FROM credential) AS c, (SELECT count(*)::int FROM user_token) AS t',
      );
      expect(counts.rows[0]).toEqual({ c: 0, t: 0 });
    });
  });
});
