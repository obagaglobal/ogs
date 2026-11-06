import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '../../src/database/tenant-db.service.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { connect, createTenantDb, createUser } from './support.js';

/**
 * Regression guard: no pg client ever has two queries in flight.
 *
 * Prisma's query interpreter runs independent parts of one query plan (e.g.
 * sibling relation loads) concurrently. Inside an interactive transaction they
 * all share ONE pg client, so pg 8 queued them and printed "Calling
 * client.query() when the client is already executing a query is deprecated";
 * pg 9 will refuse them. createPrismaClient serialises queries per client.
 *
 * This test does not rely on the warning (Node prints a deprecation only once
 * per process): it counts in-flight queries per client directly.
 */
let maint: pg.Client;
let providerId: string;
let db: TenantDb;
let prisma: PrismaClient;

/** pg's real query method, called with an explicit receiver below. */
const realQuery = Reflect.get(pg.Client.prototype, 'query') as (
  this: pg.Client,
  ...args: unknown[]
) => unknown;
const inFlight = new WeakMap<object, number>();
let maxInFlight = 0;
const warnings: string[] = [];
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';
const onWarning = (warning: Error) => {
  warnings.push(warning.message);
};

beforeAll(async () => {
  process.on('warning', onWarning);

  maint = await connect('maint');
  const owner = await createUser(maint);
  providerId = randomUUID();
  await maint.query(
    `INSERT INTO provider (id, kind, owner_user_id, display_name, status) VALUES ($1, 'INDIVIDUAL', $2, 'Concurrency probe', 'ACTIVE')`,
    [providerId, owner],
  );
  await maint.query(
    `INSERT INTO provider_application (provider_id, status, applicant_user_id) VALUES ($1, 'APPROVED', $2)`,
    [providerId, owner],
  );
  await maint.query(
    `INSERT INTO provider_skill (provider_id, skill_code) VALUES ($1, 'networking'), ($1, 'cctv')`,
    [providerId],
  );
  await maint.query(
    `INSERT INTO provider_region (provider_id, region_code) VALUES ($1, 'KE-30'), ($1, 'KE-13')`,
    [providerId],
  );
  await maint.query(
    `INSERT INTO provider_working_hours (provider_id, weekday, start_minute, end_minute)
     VALUES ($1, 1, 480, 1020), ($1, 2, 480, 1020)`,
    [providerId],
  );
  ({ db, client: prisma } = createTenantDb(2));
});

/** Counts queries in flight per client, then defers to pg. */
function countingQuery(this: pg.Client, ...args: unknown[]): unknown {
  const result = realQuery.apply(this, args);
  // Duck-typed: pg's promise may come from another realm than the test's Promise.
  if (isThenable(result)) {
    const now = (inFlight.get(this) ?? 0) + 1;
    inFlight.set(this, now);
    maxInFlight = Math.max(maxInFlight, now);
    const settle = () => {
      inFlight.set(this, (inFlight.get(this) ?? 1) - 1);
    };
    void result.then(settle, settle);
  }
  return result;
}

// The integration config restores mocks before every test, so spy per test.
// The spy sits on the prototype, under the per-client serialisation, and so
// sees exactly when each query really reaches pg.
beforeEach(() => {
  maxInFlight = 0;
  vi.spyOn(pg.Client.prototype, 'query').mockImplementation(countingQuery);
});

afterAll(async () => {
  process.off('warning', onWarning);
  vi.restoreAllMocks();
  await prisma.$disconnect();
  await maint.end();
});

describe('pg client concurrency', () => {
  it('a read with sibling relations inside a transaction runs one query at a time', async () => {
    const loaded = await db.run(
      { kind: 'system', job: 'providers.concurrency_probe' },
      async (tx) =>
        tx.provider.findUnique({
          where: { id: providerId },
          select: {
            id: true,
            skills: { select: { skillCode: true } },
            regions: { select: { regionCode: true } },
            workingHours: { select: { weekday: true } },
            timeOff: { select: { id: true } },
            application: { select: { status: true, events: { select: { id: true } } } },
          },
        }),
    );
    // The probe really loaded everything (the test is not vacuous)...
    expect(loaded?.skills).toHaveLength(2);
    expect(loaded?.regions).toHaveLength(2);
    expect(loaded?.workingHours).toHaveLength(2);
    expect(loaded?.application?.status).toBe('APPROVED');
    // ...and no client ever had a second query queued behind a running one.
    expect(maxInFlight).toBe(1);
    expect(warnings.filter((message) => message.includes('already executing a query'))).toEqual([]);
  });

  it('many units of work in parallel share the pool without overlapping on a client', async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () =>
        db.run({ kind: 'system', job: 'providers.concurrency_probe' }, async (tx) =>
          tx.provider.findUnique({
            where: { id: providerId },
            select: { skills: true, regions: true, workingHours: true },
          }),
        ),
      ),
    );
    expect(maxInFlight).toBe(1);
  });
});
