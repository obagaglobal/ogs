import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbContext } from '../../src/database/index.js';
import {
  connect,
  createMembership,
  createTenant,
  createTenantDb,
  createTwoTenants,
  createUser,
  type Fixture,
} from './support.js';

interface Leak {
  pid: number;
  tenant: string | null;
  user: string | null;
  tenants: number;
}

describe('TenantDb with a pool of ONE connection (T1)', () => {
  let maint: pg.Client;
  let fx: Fixture;
  const { db, client } = createTenantDb(1);

  beforeAll(async () => {
    maint = await connect('maint');
    fx = await createTwoTenants(maint);
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  const ctxA = (): DbContext => ({
    kind: 'workspace',
    userId: fx.userA,
    tenantId: fx.tenantA,
    restricted: false,
  });

  /** Query on the same single pooled connection, deliberately WITHOUT TenantDb. */
  async function probe(): Promise<Leak> {
    const rows = await client.$queryRaw<Leak[]>`
      SELECT pg_backend_pid() AS pid,
             nullif(current_setting('app.tenant_id', true), '') AS tenant,
             nullif(current_setting('app.user_id', true), '') AS user,
             (SELECT count(*)::int FROM tenant) AS tenants`;
    const [row] = rows;
    if (row === undefined) {
      throw new Error('probe returned no row');
    }
    return row;
  }

  it('context does not survive a committed unit of work', async () => {
    const inside = await db.run(ctxA(), async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      return { pid: row?.pid, tenants: await tx.tenant.count() };
    });
    expect(inside.tenants).toBe(1);

    const after = await probe();
    expect(after.pid).toBe(inside.pid); // same physical connection
    expect(after).toMatchObject({ tenant: null, user: null, tenants: 0 });
  });

  it('context does not survive a unit of work that throws', async () => {
    await expect(
      db.run(ctxA(), async (tx) => {
        await tx.tenant.count();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await probe()).toMatchObject({ tenant: null, user: null, tenants: 0 });
  });

  it('a later unit of work for another tenant sees only that tenant', async () => {
    await db.run(ctxA(), async (tx) => tx.tenant.count());
    const seen = await db.run(
      { kind: 'workspace', userId: fx.userB, tenantId: fx.tenantB, restricted: false },
      async (tx) => tx.tenant.findMany({ select: { id: true } }),
    );
    expect(seen).toEqual([{ id: fx.tenantB }]);
  });
});

describe('concurrent mixed-tenant load (T6)', () => {
  let maint: pg.Client;
  const { db, client } = createTenantDb(5);
  const tenants: { tenantId: string; userId: string }[] = [];

  beforeAll(async () => {
    maint = await connect('maint');
    for (let i = 0; i < 3; i += 1) {
      const tenantId = await createTenant(maint);
      const userId = await createUser(maint);
      await createMembership(maint, tenantId, userId);
      tenants.push({ tenantId, userId });
    }
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  it('200 interleaved units of work on 5 connections never see a foreign row', async () => {
    const startedAll = performance.now();
    const runs = Array.from({ length: 200 }, async (_, i) => {
      const own = tenants[i % tenants.length];
      if (own === undefined) {
        throw new Error('unreachable');
      }
      const seen = await db.run(
        { kind: 'workspace', userId: own.userId, tenantId: own.tenantId, restricted: false },
        async (tx) => {
          // A tiny sleep forces interleaving across the pool.
          await tx.$executeRaw`SELECT pg_sleep(0.002)`;
          const visibleTenants = await tx.tenant.findMany({ select: { id: true } });
          const visibleMemberships = await tx.membership.findMany({ select: { tenantId: true } });
          return [...visibleTenants.map((t) => t.id), ...visibleMemberships.map((m) => m.tenantId)];
        },
      );
      return { own: own.tenantId, seen };
    });

    const results = await Promise.all(runs);
    const totalMs = performance.now() - startedAll;
    for (const { own, seen } of results) {
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((tenantId) => tenantId === own)).toBe(true);
    }

    // Smoke benchmark for ADR-026 (one interactive transaction per unit of work).
    // Each unit: BEGIN, set_config, pg_sleep(2 ms), two SELECTs, COMMIT.
    const perUnitMs = (totalMs * 5) / 200; // 5 connections working in parallel
    process.stdout.write(
      `    T6: 200 units on a pool of 5 in ${totalMs.toFixed(0)} ms ` +
        `(~${perUnitMs.toFixed(1)} ms connection time per unit)\n`,
    );
  });
});
