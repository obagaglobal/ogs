import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface PrismaClientOptions {
  readonly connectionString: string;
  /** Maximum pooled connections. */
  readonly maxConnections: number;
  readonly applicationName?: string;
}

type QueryArgs = Parameters<pg.ClientBase['query']>;

/**
 * Runs a client's promise-style queries strictly one after another.
 *
 * Prisma's query interpreter runs independent parts of one query plan (e.g.
 * sibling relation loads) concurrently. Inside an interactive transaction they
 * all share ONE pg client, and pg 8 then queues them itself, warning "Calling
 * client.query() when the client is already executing a query is deprecated";
 * pg 9 will reject them. A PostgreSQL connection executes one statement at a
 * time anyway, so chaining here costs nothing and keeps statement order.
 *
 * The real query is looked up on the prototype at call time. Callback and
 * Submittable (stream) calls keep pg's own behaviour; Prisma uses neither.
 * Proven by test/integration/pg-concurrency.int.test.ts.
 */
export function serializeQueries(client: pg.ClientBase): void {
  let tail: Promise<unknown> = Promise.resolve();
  const settle = () => undefined;
  const serialized = (...args: QueryArgs): unknown => {
    const real = Reflect.get(Object.getPrototypeOf(client) as object, 'query') as (
      this: pg.ClientBase,
      ...a: QueryArgs
    ) => unknown;
    const first = args[0] as { submit?: unknown } | undefined;
    if (typeof args.at(-1) === 'function' || typeof first?.submit === 'function') {
      return real.apply(client, args);
    }
    const run = tail.then(() => real.apply(client, args));
    tail = run.then(settle, settle);
    return run;
  };
  Object.defineProperty(client, 'query', { value: serialized, configurable: true, writable: true });
}

/**
 * The only place a PrismaClient is constructed. Exported for integration tests
 * that need a specific pool size (e.g. the pool-of-one leak test); application
 * code obtains database access through TenantDb only.
 */
export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
    application_name: options.applicationName ?? 'ogs-api',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('connect', serializeQueries);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({ adapter });
}
