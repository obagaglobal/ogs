import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, stepAt, totpCode } from '../../src/identity/mfa/totp.js';
import {
  Client,
  createLoginUser,
  currentCode,
  grantRole,
  signIn,
  startStack,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { connect, createMembership, createTenant, urls } from './support.js';

let stack: Stack;
let maint: pg.Client;
let redis: Redis;

beforeAll(async () => {
  stack = await startStack({ worker: false });
  maint = await connect('maint');
  redis = new Redis(urls().redis);
});

afterAll(async () => {
  redis.disconnect();
  await maint.end();
  await stack.close();
});

/** Rewrites one field of a live session in Redis (tests only). */
async function patchSession(client: Client, changes: Record<string, unknown>) {
  const id = ((await client.get('/auth/session')).body as { session: { id: string } }).session.id;
  for (const key of await redis.keys(`${urls().queuePrefix}:sess:*`)) {
    const raw = await redis.get(key);
    if (raw !== null && (JSON.parse(raw) as { id: string }).id === id) {
      await redis.set(
        key,
        JSON.stringify({ ...(JSON.parse(raw) as object), ...changes }),
        'KEEPTTL',
      );
      return;
    }
  }
  throw new Error('session not found');
}

async function events(userId: string): Promise<string[]> {
  const { rows } = await maint.query<{ kind: string }>(
    'SELECT kind FROM authentication_event WHERE user_id = $1 ORDER BY occurred_at, id',
    [userId],
  );
  return rows.map((row) => row.kind);
}

describe('B1 — TOTP enrolment, sign-in and recovery codes', () => {
  it('enrols, then requires the second factor at every sign-in', async () => {
    const user = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, user);
    const other = await signIn(stack.server, maint, user);

    expect((await client.get('/auth/mfa')).body).toEqual({
      enrolled: false,
      required: false,
      recoveryCodesRemaining: 0,
    });
    const setup = (await client.post('/auth/mfa/totp/setup')).body as {
      secret: string;
      otpauthUri: string;
    };
    expect(setup.otpauthUri).toContain(`OGS%3A${encodeURIComponent(user.email)}`);
    const secret = base32Decode(setup.secret);
    const code = () => totpCode(secret, stepAt(Math.floor(Date.now() / 1000)));

    expect((await client.post('/auth/mfa/totp/confirm', { code: '000000' })).body).toEqual({
      error: 'invalid_mfa_code',
    });
    const confirmed = await client.post('/auth/mfa/totp/confirm', { code: code() });
    expect(confirmed.status).toBe(201);
    const recoveryCodes = (confirmed.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    // Other sessions were authenticated without the factor: signed out.
    expect((await other.get('/auth/session')).status).toBe(401);

    // Sign in again: password alone is not enough.
    const fresh = new Client(stack.server);
    const login = await fresh.login(user.email, user.password);
    expect(login.body).toMatchObject({ session: { mfaPending: true }, user: { mfaEnabled: true } });
    expect((await fresh.get('/me/workspaces')).body).toEqual({ error: 'mfa_required' });

    // The code used at enrolment cannot be replayed.
    expect((await fresh.post('/auth/mfa/verify', { code: code() })).body).toEqual({
      error: 'invalid_mfa_code',
    });
    // A recovery code works exactly once.
    const recovery = recoveryCodes[0] ?? '';
    expect(
      (await fresh.post('/auth/mfa/verify', { recoveryCode: recovery.toUpperCase() })).status,
    ).toBe(200);
    await fresh.refreshCsrf();
    expect((await fresh.get('/me/workspaces')).status).toBe(200);

    const again = new Client(stack.server);
    await again.login(user.email, user.password);
    expect((await again.post('/auth/mfa/verify', { recoveryCode: recovery })).body).toEqual({
      error: 'invalid_mfa_code',
    });
    expect((await again.get('/auth/mfa')).status).toBe(403);

    expect(await events(user.id)).toEqual(
      expect.arrayContaining(['MFA_ENABLED', 'MFA_FAILED', 'RECOVERY_CODE_USED']),
    );
  });

  it('accepts a code from the previous 30-second step (clock drift)', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const client = new Client(stack.server);
    await client.login(user.email, user.password);
    expect((await client.post('/auth/mfa/verify', { code: currentCode(user, -1) })).status).toBe(
      200,
    );
  });

  it('a TOTP secret never leaves the database in clear text', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const { rows } = await maint.query<{ secret_sealed: string }>(
      'SELECT secret_sealed FROM mfa_factor WHERE user_id = $1',
      [user.id],
    );
    const stored = Buffer.from(rows[0]?.secret_sealed ?? '', 'base64');
    expect(stored.includes(user.totp ?? Buffer.alloc(0))).toBe(false);
  });
});

describe('B2 — mandatory MFA for admins and platform staff', () => {
  it('an org admin without MFA can only enrol', async () => {
    const tenantId = await createTenant(maint);
    const admin = await createLoginUser(maint);
    const membership = await createMembership(maint, tenantId, admin.id);
    await grantRole(maint, membership, tenantId, 'org_admin');

    const client = await signIn(stack.server, maint, admin);
    expect((await client.get('/me/workspaces')).body).toEqual({ error: 'mfa_enrollment_required' });
    expect((await client.get('/workspace/members', { workspace: tenantId })).body).toEqual({
      error: 'mfa_enrollment_required',
    });
    expect((await client.get('/auth/mfa')).body).toMatchObject({ enrolled: false, required: true });
    expect((await client.post('/auth/mfa/totp/setup')).status).toBe(201);
  });

  it('an enrolled admin cannot switch MFA off', async () => {
    const tenantId = await createTenant(maint);
    const admin = await createLoginUser(maint, { mfa: true });
    const membership = await createMembership(maint, tenantId, admin.id);
    await grantRole(maint, membership, tenantId, 'org_admin');
    const client = await signIn(stack.server, maint, admin);
    expect((await client.delete('/auth/mfa')).body).toEqual({ error: 'mfa_required_by_role' });
  });

  it('a regular user may switch MFA off after a step-up', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const client = await signIn(stack.server, maint, user);
    await patchSession(client, { stepUpAt: Date.now() - 16 * 60_000 });
    expect((await client.delete('/auth/mfa')).body).toEqual({ error: 'step_up_required' });
    await maint.query('UPDATE mfa_factor SET last_used_step = 0 WHERE user_id = $1', [user.id]);
    expect((await client.post('/auth/mfa/step-up', { code: currentCode(user) })).status).toBe(204);
    expect((await client.delete('/auth/mfa')).status).toBe(204);
    expect((await client.get('/auth/mfa')).body).toMatchObject({ enrolled: false });
  });
});

describe('B3 — step-up and platform elevation', () => {
  let platformTenant: string;
  let staff: FixtureUser;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const existing = await maint.query<{ id: string }>(
      `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
    );
    platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
    staff = await createLoginUser(maint, { mfa: true });
    const membership = await createMembership(maint, platformTenant, staff.id);
    await grantRole(maint, membership, platformTenant, 'compliance');
    orgA = await createTenant(maint);
    orgB = await createTenant(maint);
  });

  it('a password change needs a recent step-up when MFA is on', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const client = await signIn(stack.server, maint, user);
    await patchSession(client, { stepUpAt: null });
    const change = await client.post('/auth/password/change', {
      currentPassword: user.password,
      newPassword: 'another long passphrase here',
    });
    expect(change.body).toEqual({ error: 'step_up_required' });
  });

  it('elevation needs the platform workspace, the permission, a step-up and a reason', async () => {
    const client = await signIn(stack.server, maint, staff);
    const reason = `Compliance review ${randomUUID()}`;

    // Personal workspace: no platform permission.
    expect((await client.post('/platform/elevate', { reason })).body).toEqual({
      error: 'permission_denied',
    });
    // Platform workspace but stale step-up.
    await patchSession(client, { stepUpAt: Date.now() - 20 * 60_000 });
    expect(
      (await client.post('/platform/elevate', { reason }, { workspace: platformTenant })).body,
    ).toEqual({ error: 'step_up_required' });
    await maint.query('UPDATE mfa_factor SET last_used_step = 0 WHERE user_id = $1', [staff.id]);
    await client.post('/auth/mfa/step-up', { code: currentCode(staff) });
    // Too short a reason.
    expect(
      (await client.post('/platform/elevate', { reason: 'x' }, { workspace: platformTenant })).body,
    ).toMatchObject({ error: 'invalid_request' });

    const elevated = await client.post(
      '/platform/elevate',
      { reason },
      { workspace: platformTenant },
    );
    expect(elevated.status).toBe(201);
    const { elevationId } = elevated.body as { elevationId: string };

    // Without naming the elevation: refused.
    expect((await client.get('/platform/tenants', { workspace: platformTenant })).body).toEqual({
      error: 'elevation_required',
    });
    const listed = await client.get('/platform/tenants', {
      workspace: platformTenant,
      headers: { 'X-OGS-Elevation': elevationId },
    });
    expect(listed.status).toBe(200);
    const ids = (listed.body as { tenants: { id: string }[] }).tenants.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([orgA, orgB]));

    // Both the elevation and the cross-tenant read are audited with the reason.
    const audit = await maint.query<{ action: string }>(
      'SELECT action FROM audit_log WHERE reason = $1 ORDER BY occurred_at',
      [reason],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'platform.elevation_started',
      'platform.context_used',
    ]);

    // Expiry.
    await patchSession(client, {
      elevation: { id: elevationId, reason, tenantId: null, expiresAt: Date.now() - 1 },
    });
    expect(
      (
        await client.get('/platform/tenants', {
          workspace: platformTenant,
          headers: { 'X-OGS-Elevation': elevationId },
        })
      ).body,
    ).toEqual({ error: 'elevation_required' });
  });

  it('an elevation scoped to one tenant sees only that tenant', async () => {
    const client = await signIn(stack.server, maint, staff);
    const scoped = await client.post(
      '/platform/elevate',
      { reason: 'Scoped support request TCK-42', tenantId: orgA },
      { workspace: platformTenant },
    );
    const { elevationId } = scoped.body as { elevationId: string };
    const listed = await client.get('/platform/tenants', {
      workspace: platformTenant,
      headers: { 'X-OGS-Elevation': elevationId },
    });
    expect((listed.body as { tenants: { id: string }[] }).tenants.map((t) => t.id)).toEqual([orgA]);
  });

  it('an organisation admin can never elevate', async () => {
    const tenantId = await createTenant(maint);
    const admin = await createLoginUser(maint, { mfa: true });
    const membership = await createMembership(maint, tenantId, admin.id);
    await grantRole(maint, membership, tenantId, 'org_admin');
    const client = await signIn(stack.server, maint, admin);
    const response = await client.post(
      '/platform/elevate',
      { reason: 'I would like to see everything' },
      { workspace: tenantId },
    );
    expect(response.body).toEqual({ error: 'permission_denied' });
  });
});
