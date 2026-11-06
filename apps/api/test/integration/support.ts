import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createPrismaClient } from '../../src/database/prisma.factory.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { TenantDb } from '../../src/database/tenant-db.service.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export const urls = () => inject('integration');

export type Role = 'app' | 'owner' | 'maint';

/** A raw pg client logged in as one of the OGS roles. Caller must `end()` it. */
export async function connect(role: Role): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: urls()[role],
    application_name: `ogs-it-${role}`,
  });
  await client.connect();
  return client;
}

/** A TenantDb over its own pool, exactly as the API builds it. */
export function createTenantDb(maxConnections = 5): { db: TenantDb; client: PrismaClient } {
  const client = createPrismaClient({
    connectionString: urls().app,
    maxConnections,
    applicationName: 'ogs-it-tenantdb',
  });
  const db = new TenantDb({ client } as PrismaService);
  return { db, client };
}

export interface Settings {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly isPlatform?: boolean;
  readonly actorKind?: 'USER' | 'SYSTEM';
}

/**
 * Runs `work` in a transaction on a raw connection with the given RLS context,
 * set exactly like TenantDb does (transaction-local). Rolls back unless `commit`.
 */
export async function withContext<T>(
  client: pg.Client,
  settings: Settings,
  work: () => Promise<T>,
  commit = false,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true),
              set_config('app.is_platform', $3, true), set_config('app.actor_kind', $4, true)`,
      [
        settings.userId ?? '',
        settings.tenantId ?? '',
        settings.isPlatform === true ? 'true' : 'false',
        settings.actorKind ?? (settings.userId === undefined ? '' : 'USER'),
      ],
    );
    const result = await work();
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Runs one statement in its own savepoint so an expected error does not abort the transaction. */
export async function attempt(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<
  { rowCount: number; rows: Record<string, unknown>[] } | { error: string; code: string }
> {
  await client.query('SAVEPOINT attempt');
  try {
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT attempt');
    return { rowCount: result.rowCount ?? 0, rows: result.rows as Record<string, unknown>[] };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const pgError = error as { message: string; code?: string };
    return { error: pgError.message, code: pgError.code ?? '' };
  }
}

// ---------------------------------------------------------------------------
// Fixtures (created as ogs_maint, which bypasses RLS)
// ---------------------------------------------------------------------------

export interface Fixture {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly userA: string;
  readonly userB: string;
  readonly membershipA: string;
  readonly membershipB: string;
}

const suffix = () => randomUUID().slice(0, 8);

export async function createTenant(
  maint: pg.Client,
  options: { kind?: string; status?: string; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await maint.query(
    `INSERT INTO tenant (id, kind, status, name, slug, deleted_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      options.kind ?? 'ORGANISATION',
      options.status ?? 'ACTIVE',
      `Tenant ${suffix()}`,
      `t-${suffix()}-${suffix()}`,
      options.deleted === true ? new Date() : null,
    ],
  );
  return id;
}

export async function createUser(maint: pg.Client): Promise<string> {
  const id = randomUUID();
  await maint.query(`INSERT INTO app_user (id, email, status) VALUES ($1, $2, 'ACTIVE')`, [
    id,
    `user-${suffix()}@example.test`,
  ]);
  return id;
}

export async function createMembership(
  maint: pg.Client,
  tenantId: string,
  userId: string,
  status = 'ACTIVE',
): Promise<string> {
  const id = randomUUID();
  await maint.query(
    `INSERT INTO membership (id, tenant_id, user_id, status, joined_at, ended_at)
     VALUES ($1, $2, $3, $4, now(), $5)`,
    [id, tenantId, userId, status, status === 'ENDED' ? new Date() : null],
  );
  return id;
}

/** Two isolated tenants, each with one member. */
export async function createTwoTenants(maint: pg.Client): Promise<Fixture> {
  const tenantA = await createTenant(maint);
  const tenantB = await createTenant(maint);
  const userA = await createUser(maint);
  const userB = await createUser(maint);
  const membershipA = await createMembership(maint, tenantA, userA);
  const membershipB = await createMembership(maint, tenantB, userB);
  return { tenantA, tenantB, userA, userB, membershipA, membershipB };
}

/** Writes a tenant-scoped audit row and outbox row for `tenantId` (as ogs_maint). */
export async function createTenantLogRows(maint: pg.Client, tenantId: string, userId: string) {
  await maint.query(
    `INSERT INTO audit_log (actor_kind, actor_user_id, tenant_id, action) VALUES ('USER', $1, $2, 'fixture.created')`,
    [userId, tenantId],
  );
  await maint.query(
    `INSERT INTO outbox_event (type, tenant_id, payload, dispatched_at) VALUES ('fixture.created', $1, '{}', now())`,
    [tenantId],
  );
}
