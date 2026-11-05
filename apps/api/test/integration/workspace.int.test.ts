import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceContextService } from '../../src/tenancy/workspace-context.service.js';
import { connect, createMembership, createTenant, createTenantDb, createUser } from './support.js';

describe('WorkspaceContextService (T9)', () => {
  let maint: pg.Client;
  const { db, client } = createTenantDb(2);
  const service = new WorkspaceContextService(db);
  let user: string;

  beforeAll(async () => {
    maint = await connect('maint');
    user = await createUser(maint);
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  async function tenantWith(tenantStatus: string, membershipStatus = 'ACTIVE', deleted = false) {
    const tenantId = await createTenant(maint, { status: tenantStatus, deleted });
    await createMembership(maint, tenantId, user, membershipStatus);
    return tenantId;
  }

  it('personal workspace always resolves to a user context', async () => {
    expect(await service.resolve(user, 'personal')).toMatchObject({
      ok: true,
      context: { kind: 'user', userId: user },
    });
  });

  it('active membership in an active tenant → full workspace context', async () => {
    const tenantId = await tenantWith('ACTIVE');
    expect(await service.resolve(user, tenantId)).toMatchObject({
      ok: true,
      context: { kind: 'workspace', userId: user, tenantId, restricted: false },
      workspace: { kind: 'ORGANISATION', tenantId, restricted: false },
    });
  });

  it('accepts an upper-case tenant id', async () => {
    const tenantId = await tenantWith('ACTIVE');
    expect(await service.resolve(user, tenantId.toUpperCase())).toMatchObject({
      ok: true,
      context: { tenantId },
    });
  });

  it.each(['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'])(
    '%s tenant → restricted context only',
    async (status) => {
      const tenantId = await tenantWith(status);
      expect(await service.resolve(user, tenantId)).toMatchObject({
        ok: true,
        context: { kind: 'workspace', restricted: true },
        workspace: { tenantStatus: status, restricted: true },
      });
    },
  );

  it.each(['INVITED', 'SUSPENDED', 'ENDED'])('%s membership → refused', async (status) => {
    const tenantId = await tenantWith('ACTIVE', status);
    expect(await service.resolve(user, tenantId)).toEqual({
      ok: false,
      reason: 'membership_inactive',
    });
  });

  it('closed or deleted tenant → refused', async () => {
    expect(await service.resolve(user, await tenantWith('CLOSED'))).toEqual({
      ok: false,
      reason: 'tenant_unavailable',
    });
    expect(await service.resolve(user, await tenantWith('ACTIVE', 'ACTIVE', true))).toEqual({
      ok: false,
      reason: 'tenant_unavailable',
    });
  });

  it('a tenant the user does not belong to → refused', async () => {
    const stranger = await createTenant(maint);
    expect(await service.resolve(user, stranger)).toEqual({ ok: false, reason: 'not_a_member' });
  });

  it('garbage → refused without touching the database', async () => {
    expect(await service.resolve(user, "1' OR '1'='1")).toEqual({
      ok: false,
      reason: 'invalid_workspace',
    });
  });

  it('lists only usable workspaces, flagging restricted ones', async () => {
    const other = await createUser(maint);
    const active = await createTenant(maint, { status: 'ACTIVE' });
    const pending = await createTenant(maint, { status: 'PENDING_APPROVAL' });
    const closed = await createTenant(maint, { status: 'CLOSED' });
    const ended = await createTenant(maint, { status: 'ACTIVE' });
    await createMembership(maint, active, other);
    await createMembership(maint, pending, other);
    await createMembership(maint, closed, other);
    await createMembership(maint, ended, other, 'ENDED');

    const list = await service.listWorkspaces(other);
    expect(list.map(({ tenantId, restricted }) => ({ tenantId, restricted }))).toEqual(
      expect.arrayContaining([
        { tenantId: active, restricted: false },
        { tenantId: pending, restricted: true },
      ]),
    );
    expect(list).toHaveLength(2);
  });
});
