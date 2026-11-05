import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/audit/audit.service.js';
import { InvalidDbContextError, type DbContext } from '../../src/database/index.js';
import { attempt, connect, createTenantDb, createTwoTenants, type Fixture } from './support.js';

describe('audit log (T7)', () => {
  let maint: pg.Client;
  let owner: pg.Client;
  let fx: Fixture;
  const { db, client } = createTenantDb(2);
  const audit = new AuditService();

  beforeAll(async () => {
    maint = await connect('maint');
    owner = await connect('owner');
    fx = await createTwoTenants(maint);
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
    await owner.end();
  });

  const ctxA = (): DbContext => ({
    kind: 'workspace',
    userId: fx.userA,
    tenantId: fx.tenantA,
    restricted: false,
  });

  async function findByEntity(entityId: string) {
    const result = await maint.query<{ actor_user_id: string; actor_kind: string }>(
      'SELECT actor_user_id, actor_kind FROM audit_log WHERE entity_id = $1',
      [entityId],
    );
    return result.rows;
  }

  it('commits with the business change and records the real actor', async () => {
    const entityId = randomUUID();
    await db.run(ctxA(), async (tx) =>
      audit.record(tx, {
        action: 'test.committed',
        tenantId: fx.tenantA,
        entityType: 'test',
        entityId,
      }),
    );
    expect(await findByEntity(entityId)).toEqual([{ actor_user_id: fx.userA, actor_kind: 'USER' }]);
  });

  it('disappears when the business change rolls back', async () => {
    const entityId = randomUUID();
    await expect(
      db.run(ctxA(), async (tx) => {
        await audit.record(tx, { action: 'test.rolled_back', tenantId: fx.tenantA, entityId });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await findByEntity(entityId)).toEqual([]);
  });

  it('cannot be changed or removed by any role', async () => {
    const entityId = randomUUID();
    await db.run(ctxA(), async (tx) =>
      audit.record(tx, { action: 'test.immutable', tenantId: fx.tenantA, entityId }),
    );

    // ogs_maint bypasses RLS and holds UPDATE/DELETE grants: only the trigger stops it.
    await maint.query('BEGIN');
    const maintUpdate = await attempt(
      maint,
      `UPDATE audit_log SET action = 'test.tampered' WHERE entity_id = $1`,
      [entityId],
    );
    const maintDelete = await attempt(maint, 'DELETE FROM audit_log WHERE entity_id = $1', [
      entityId,
    ]);
    await maint.query('ROLLBACK');
    expect(maintUpdate).toMatchObject({ error: expect.stringMatching(/append-only/) as unknown });
    expect(maintDelete).toMatchObject({ error: expect.stringMatching(/append-only/) as unknown });

    // The owner may TRUNCATE (TRUNCATE ignores RLS): the statement trigger stops it.
    await owner.query('BEGIN');
    const ownerTruncate = await attempt(owner, 'TRUNCATE audit_log');
    await owner.query('ROLLBACK');
    expect(ownerTruncate).toMatchObject({ error: expect.stringMatching(/append-only/) as unknown });

    expect(await findByEntity(entityId)).toHaveLength(1);
  });
});

describe('platform and system contexts (T10)', () => {
  let maint: pg.Client;
  let fx: Fixture;
  const { db, client } = createTenantDb(2);

  beforeAll(async () => {
    maint = await connect('maint');
    fx = await createTwoTenants(maint);
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  it('platform context sees across tenants and is itself audited', async () => {
    const reason = `integration test ${randomUUID()}`;
    const seen = await db.run({ kind: 'platform', userId: fx.userA, reason }, async (tx) =>
      tx.tenant.findMany({ where: { id: { in: [fx.tenantA, fx.tenantB] } }, select: { id: true } }),
    );
    expect(seen.map((t) => t.id).sort()).toEqual([fx.tenantA, fx.tenantB].sort());

    const audit = await maint.query<{ actor_user_id: string; action: string }>(
      'SELECT actor_user_id, action FROM audit_log WHERE reason = $1',
      [reason],
    );
    expect(audit.rows).toEqual([{ actor_user_id: fx.userA, action: 'platform.context_used' }]);
  });

  it('platform context without a reason never reaches the database', async () => {
    await expect(
      db.run({ kind: 'platform', userId: fx.userA, reason: ' ' }, async (tx) => tx.tenant.count()),
    ).rejects.toThrow(InvalidDbContextError);
  });

  it('system context reads the outbox but no tenant data', async () => {
    const counts = await db.run({ kind: 'system', job: 'it.check' }, async (tx) => ({
      tenants: await tx.tenant.count(),
      users: await tx.appUser.count(),
      memberships: await tx.membership.count(),
      audit: await tx.auditLog.count(),
      outboxReadable: (await tx.outboxEvent.count()) >= 0,
    }));
    expect(counts).toEqual({
      tenants: 0,
      users: 0,
      memberships: 0,
      audit: 0,
      outboxReadable: true,
    });
  });

  it('system context scoped to a tenant sees that tenant only', async () => {
    const seen = await db.run(
      { kind: 'system', job: 'it.check', tenantId: fx.tenantA },
      async (tx) => tx.tenant.findMany({ select: { id: true } }),
    );
    expect(seen).toEqual([{ id: fx.tenantA }]);
  });
});
