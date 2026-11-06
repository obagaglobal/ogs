import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLoginUser,
  currentCode,
  grantRole,
  mailsTo,
  signIn,
  startStack,
  uniqueEmail,
  waitForMail,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { connect, createMembership, createTenant } from './support.js';

let stack: Stack;
let maint: pg.Client;

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

interface Org {
  tenantId: string;
  admin: FixtureUser;
  adminMembership: string;
}

async function createOrg(kind = 'ORGANISATION'): Promise<Org> {
  const tenantId = await createTenant(maint, { kind });
  const admin = await createLoginUser(maint, { mfa: true });
  const adminMembership = await createMembership(maint, tenantId, admin.id);
  await grantRole(
    maint,
    adminMembership,
    tenantId,
    kind === 'ORGANISATION' ? 'org_admin' : 'provider_admin',
  );
  return { tenantId, admin, adminMembership };
}

async function roleId(code: string): Promise<string> {
  const { rows } = await maint.query<{ id: string }>(
    'SELECT id FROM role WHERE tenant_id IS NULL AND code = $1',
    [code],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`no role ${code}`);
  }
  return id;
}

function invitationFrom(text: string): { token: string; email: string } {
  const fragment = /\/invitations\/accept#([^\s]+)/.exec(text)?.[1] ?? '';
  const params = new URLSearchParams(fragment);
  return { token: params.get('token') ?? '', email: params.get('email') ?? '' };
}

describe('C4 — invitations', () => {
  it('invite → email → accept by the invited account only, once', async () => {
    const org = await createOrg();
    const admin = await signIn(stack.server, maint, org.admin);
    const inviteeEmail = uniqueEmail('invitee');

    const created = await admin.post(
      '/workspace/invitations',
      { email: inviteeEmail, roleIds: [await roleId('org_employee')] },
      { workspace: org.tenantId },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: inviteeEmail,
      roles: ['org_employee'],
      status: 'PENDING',
    });
    const { token, email } = invitationFrom(
      (await waitForMail(inviteeEmail, /invited to join/)).text,
    );
    expect(email).toBe(inviteeEmail);

    // Someone else, signed in, cannot use it.
    const stranger = await signIn(stack.server, maint, await createLoginUser(maint));
    expect((await stranger.post('/invitations/accept', { token })).body).toEqual({
      error: 'invitation_email_mismatch',
    });

    const invitee = await createLoginUser(maint, { email: inviteeEmail });
    const client = await signIn(stack.server, maint, invitee);
    const accepted = await client.post('/invitations/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ tenantId: org.tenantId, kind: 'ORGANISATION' });
    expect((await client.get('/workspace', { workspace: org.tenantId })).body).toMatchObject({
      roles: ['org_employee'],
    });
    // Single use.
    expect((await client.post('/invitations/accept', { token })).body).toEqual({
      error: 'invitation_invalid',
    });

    // The token is never stored or logged in clear.
    const dump = await maint.query(
      `SELECT (SELECT json_agg(a) FROM audit_log a WHERE a.tenant_id = $1) AS audit,
              (SELECT json_agg(i) FROM invitation i WHERE i.tenant_id = $1) AS invitations`,
      [org.tenantId],
    );
    expect(JSON.stringify(dump.rows)).not.toContain(token);
  });

  it('re-inviting revokes the earlier link; expired and revoked links fail', async () => {
    const org = await createOrg();
    const admin = await signIn(stack.server, maint, org.admin);
    const email = uniqueEmail('twice');
    const employee = await roleId('org_employee');
    await admin.post(
      '/workspace/invitations',
      { email, roleIds: [employee] },
      { workspace: org.tenantId },
    );
    const first = invitationFrom((await waitForMail(email, /invited to join/)).text);
    await admin.post(
      '/workspace/invitations',
      { email, roleIds: [employee] },
      { workspace: org.tenantId },
    );
    const second = invitationFrom((await waitForMail(email, /invited to join/, 2)).text);
    expect(second.token).not.toBe(first.token);

    const client = await signIn(stack.server, maint, await createLoginUser(maint, { email }));
    expect((await client.post('/invitations/accept', { token: first.token })).body).toEqual({
      error: 'invitation_invalid',
    });
    await maint.query(
      `UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE email = $1`,
      [email],
    );
    expect((await client.post('/invitations/accept', { token: second.token })).body).toEqual({
      error: 'invitation_invalid',
    });
  });

  it('only roles of this workspace kind can be offered', async () => {
    const org = await createOrg();
    const admin = await signIn(stack.server, maint, org.admin);
    for (const code of ['super_admin', 'provider_admin']) {
      expect(
        (
          await admin.post(
            '/workspace/invitations',
            { email: uniqueEmail(), roleIds: [await roleId(code)] },
            { workspace: org.tenantId },
          )
        ).body,
      ).toEqual({ error: 'role_not_allowed' });
    }
  });

  it('an invitation into a suspended organisation cannot be accepted', async () => {
    const org = await createOrg();
    const admin = await signIn(stack.server, maint, org.admin);
    const email = uniqueEmail('late');
    await admin.post(
      '/workspace/invitations',
      { email, roleIds: [await roleId('org_employee')] },
      { workspace: org.tenantId },
    );
    const { token } = invitationFrom((await waitForMail(email, /invited to join/)).text);
    await maint.query('BEGIN');
    await maint.query(`SELECT set_config('app.is_platform', 'true', true)`);
    await maint.query(`UPDATE tenant SET status = 'SUSPENDED' WHERE id = $1`, [org.tenantId]);
    await maint.query('COMMIT');
    const client = await signIn(stack.server, maint, await createLoginUser(maint, { email }));
    expect((await client.post('/invitations/accept', { token })).body).toEqual({
      error: 'tenant_not_active',
    });
  });
});

describe('C5 — the last admin can never disappear', () => {
  it('refuses demoting, suspending, ending or leaving for the only admin', async () => {
    const org = await createOrg();
    const employee = await createLoginUser(maint);
    const employeeMembership = await createMembership(maint, org.tenantId, employee.id);
    await grantRole(maint, employeeMembership, org.tenantId, 'org_employee');
    const admin = await signIn(stack.server, maint, org.admin);
    const ws = { workspace: org.tenantId };

    expect(
      (
        await admin.agent
          .patch(`/api/v1/workspace/members/${org.adminMembership}`)
          .set('X-CSRF-Token', admin.csrf ?? '')
          .set('X-OGS-Workspace', org.tenantId)
          .send({ status: 'SUSPENDED' })
      ).body,
    ).toEqual({
      error: 'cannot_change_own_membership',
    });
    const demote = await admin.agent
      .put(`/api/v1/workspace/members/${org.adminMembership}/roles`)
      .set('X-CSRF-Token', admin.csrf ?? '')
      .set('X-OGS-Workspace', org.tenantId)
      .send({ roleIds: [await roleId('org_employee')] });
    expect(demote.body).toEqual({ error: 'last_admin' });
    expect((await admin.post('/workspace/leave', {}, ws)).body).toEqual({ error: 'last_admin' });
    // Still an admin afterwards.
    expect((await admin.get('/workspace/members', ws)).status).toBe(200);
  });

  it('two admins demoting each other at the same moment: exactly one wins', async () => {
    const org = await createOrg();
    const second = await createLoginUser(maint, { mfa: true });
    const secondMembership = await createMembership(maint, org.tenantId, second.id);
    await grantRole(maint, secondMembership, org.tenantId, 'org_admin');
    const a = await signIn(stack.server, maint, org.admin);
    const b = await signIn(stack.server, maint, second);
    const employee = await roleId('org_employee');
    const demote = (client: typeof a, target: string) =>
      client.agent
        .put(`/api/v1/workspace/members/${target}/roles`)
        .set('X-CSRF-Token', client.csrf ?? '')
        .set('X-OGS-Workspace', org.tenantId)
        .send({ roleIds: [employee] });

    const results = await Promise.all([
      demote(a, secondMembership),
      demote(b, org.adminMembership),
    ]);
    // The loser is refused either by the database (409 last_admin) or, if the winner
    // committed first, because it is no longer an admin (403 permission_denied).
    const [won, lost] = [...results].sort((x, y) => x.status - y.status);
    expect(won?.status).toBe(204);
    expect([403, 409]).toContain(lost?.status);
    const { rows } = await maint.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership m JOIN membership_role mr ON mr.membership_id = m.id
         JOIN role r ON r.id = mr.role_id
        WHERE m.tenant_id = $1 AND m.status = 'ACTIVE' AND r.code = 'org_admin'`,
      [org.tenantId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('C5 — last-admin guard under a true database race', () => {
  it('two open transactions removing each other’s admin role: one commit is refused', async () => {
    const org = await createOrg();
    const second = await createLoginUser(maint, { mfa: true });
    const secondMembership = await createMembership(maint, org.tenantId, second.id);
    await grantRole(maint, secondMembership, org.tenantId, 'org_admin');
    const adminRole = await roleId('org_admin');

    const [t1, t2] = await Promise.all([connect('app'), connect('app')]);
    try {
      for (const [client, actor] of [
        [t1, org.admin.id],
        [t2, second.id],
      ] as const) {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true),
                  set_config('app.actor_kind', 'USER', true)`,
          [actor, org.tenantId],
        );
      }
      const remove = 'DELETE FROM membership_role WHERE membership_id = $1 AND role_id = $2';
      await t1.query(remove, [secondMembership, adminRole]);
      await t2.query(remove, [org.adminMembership, adminRole]);
      const outcomes = await Promise.allSettled([t1.query('COMMIT'), t2.query('COMMIT')]);
      expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
      const failure = outcomes.find((o) => o.status === 'rejected');
      expect(String(failure?.status === 'rejected' ? failure.reason : '')).toMatch(
        /would have no active org_admin/,
      );
    } finally {
      await Promise.allSettled([t1.query('ROLLBACK'), t2.query('ROLLBACK')]);
      await Promise.all([t1.end(), t2.end()]);
    }
  });
});

describe('C6 — custom roles', () => {
  it('builds a role from allowed permissions, grants it, and protects system roles', async () => {
    const org = await createOrg();
    const admin = await signIn(stack.server, maint, org.admin);
    const ws = { workspace: org.tenantId };

    expect(
      (
        await admin.post(
          '/workspace/roles',
          { code: 'sneaky', name: 'Sneaky', permissions: ['platform.settings.manage'] },
          ws,
        )
      ).body,
    ).toEqual({
      error: 'permission_not_allowed',
    });
    expect(
      (
        await admin.post(
          '/workspace/roles',
          { code: 'org_admin', name: 'Fake admin', permissions: ['workspace.read'] },
          ws,
        )
      ).body,
    ).toEqual({
      error: 'role_code_taken',
    });
    const created = await admin.post(
      '/workspace/roles',
      {
        code: 'auditors',
        name: 'Auditors',
        permissions: ['workspace.read', 'audit.read', 'membership.read'],
      },
      ws,
    );
    expect(created.status).toBe(201);
    const auditorRole = (created.body as { id: string }).id;

    const person = await createLoginUser(maint);
    const membership = await createMembership(maint, org.tenantId, person.id);
    await grantRole(maint, membership, org.tenantId, 'org_employee');
    const setRoles = await admin.agent
      .put(`/api/v1/workspace/members/${membership}/roles`)
      .set('X-CSRF-Token', admin.csrf ?? '')
      .set('X-OGS-Workspace', org.tenantId)
      .send({ roleIds: [auditorRole] });
    expect(setRoles.status).toBe(204);
    const auditor = await signIn(stack.server, maint, person);
    expect((await auditor.get('/workspace/members', ws)).status).toBe(200);

    expect((await admin.delete(`/workspace/roles/${auditorRole}`, ws)).body).toEqual({
      error: 'role_in_use',
    });
    const systemRole = await roleId('org_employee');
    const editSystem = await admin.agent
      .patch(`/api/v1/workspace/roles/${systemRole}`)
      .set('X-CSRF-Token', admin.csrf ?? '')
      .set('X-OGS-Workspace', org.tenantId)
      .send({ name: 'Renamed' });
    expect(editSystem.body).toEqual({ error: 'system_role_immutable' });

    const roles = (await admin.get('/workspace/roles', ws)).body as { roles: { code: string }[] };
    expect(roles.roles.map((role) => role.code)).toEqual(
      expect.arrayContaining(['org_admin', 'auditors']),
    );
    expect(roles.roles.map((role) => role.code)).not.toContain('provider_admin');
  });
});

describe('C7 — new endpoints stay inside their tenant', () => {
  it('foreign ids answer 404 and foreign workspaces 403', async () => {
    const a = await createOrg();
    const b = await createOrg();
    const adminA = await signIn(stack.server, maint, a.admin);
    const adminB = await signIn(stack.server, maint, b.admin);
    const ws = { workspace: a.tenantId };

    const bRole = (
      (
        await adminB.post(
          '/workspace/roles',
          { code: 'b_only', name: 'B only', permissions: ['workspace.read'] },
          { workspace: b.tenantId },
        )
      ).body as { id: string }
    ).id;
    const bDepartment = (
      (await adminB.post('/workspace/departments', { name: 'Finance' }, { workspace: b.tenantId }))
        .body as { id: string }
    ).id;
    const bInvite = (
      (
        await adminB.post(
          '/workspace/invitations',
          { email: uniqueEmail(), roleIds: [await roleId('org_employee')] },
          { workspace: b.tenantId },
        )
      ).body as { id: string }
    ).id;

    const patch = (path: string, body: object) =>
      adminA.agent
        .patch(`/api/v1${path}`)
        .set('X-CSRF-Token', adminA.csrf ?? '')
        .set('X-OGS-Workspace', a.tenantId)
        .send(body);
    expect(
      (await patch(`/workspace/members/${b.adminMembership}`, { status: 'SUSPENDED' })).status,
    ).toBe(404);
    expect((await patch(`/workspace/roles/${bRole}`, { name: 'Mine now' })).status).toBe(404);
    expect(
      (await patch(`/workspace/departments/${bDepartment}`, { name: 'Mine now' })).status,
    ).toBe(404);
    expect((await adminA.delete(`/workspace/invitations/${bInvite}`, ws)).status).toBe(404);
    expect((await adminA.delete(`/workspace/roles/${bRole}`, ws)).status).toBe(404);
    // Using B's role in A is refused, not silently granted.
    expect(
      (await adminA.post('/workspace/invitations', { email: uniqueEmail(), roleIds: [bRole] }, ws))
        .body,
    ).toEqual({
      error: 'role_not_allowed',
    });
    expect((await adminA.get('/workspace/roles', { workspace: b.tenantId })).status).toBe(403);
    // B's invitation and department are invisible to A.
    const listed = (await adminA.get('/workspace/invitations', ws)).body as {
      invitations: { id: string }[];
    };
    expect(listed.invitations.map((i) => i.id)).not.toContain(bInvite);
    const departments = (await adminA.get('/workspace/departments', ws)).body as {
      departments: { id: string }[];
    };
    expect(departments.departments.map((d) => d.id)).not.toContain(bDepartment);
  });
});

describe('C8 — one person, several workspaces', () => {
  it('switching between an organisation and a provider company never mixes data or permissions', async () => {
    const org = await createOrg();
    const provider = await createOrg('PROVIDER_COMPANY');
    const person = await createLoginUser(maint);
    const inOrg = await createMembership(maint, org.tenantId, person.id);
    const inProvider = await createMembership(maint, provider.tenantId, person.id);
    await grantRole(maint, inOrg, org.tenantId, 'org_employee');
    await grantRole(maint, inProvider, provider.tenantId, 'provider_technician');
    const client = await signIn(stack.server, maint, person);

    const workspaces = (await client.get('/me/workspaces')).body as {
      workspaces: { tenantId: string }[];
    };
    expect(workspaces.workspaces.map((w) => w.tenantId).sort()).toEqual(
      [org.tenantId, provider.tenantId].sort(),
    );
    expect((await client.get('/workspace', { workspace: org.tenantId })).body).toMatchObject({
      kind: 'ORGANISATION',
      roles: ['org_employee'],
    });
    expect((await client.get('/workspace', { workspace: provider.tenantId })).body).toMatchObject({
      kind: 'PROVIDER_COMPANY',
      roles: ['provider_technician'],
    });
    // An employee cannot list members in either; permissions never carry across.
    expect((await client.get('/workspace/members', { workspace: org.tenantId })).status).toBe(403);
    expect((await client.get('/workspace/members', { workspace: provider.tenantId })).status).toBe(
      403,
    );
  });
});

describe('C10 — security notices (ASVS F-2)', () => {
  it('a password change and turning MFA off are each emailed exactly once', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const client = await signIn(stack.server, maint, user);
    const changed = await client.post('/auth/password/change', {
      currentPassword: user.password,
      newPassword: 'quiet rivers flow north',
    });
    expect(changed.status).toBe(204);
    await waitForMail(user.email, /password was changed/);

    await client.refreshCsrf();
    await maint.query('UPDATE mfa_factor SET last_used_step = 0 WHERE user_id = $1', [user.id]);
    await client.post('/auth/mfa/step-up', { code: currentCode(user) });
    expect((await client.delete('/auth/mfa')).status).toBe(204);
    await waitForMail(user.email, /Two-step verification is off/);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const subjects = (await mailsTo(user.email)).map((mail) => mail.Subject);
    expect(subjects.filter((s) => s.includes('password was changed'))).toHaveLength(1);
    expect(subjects.filter((s) => s.includes('verification is off'))).toHaveLength(1);
  });
});
