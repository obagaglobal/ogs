import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface PrismaClientOptions {
  readonly connectionString: string;
  /** Maximum pooled connections. */
  readonly maxConnections: number;
  readonly applicationName?: string;
}

/**
 * The only place a PrismaClient is constructed. Exported for integration tests
 * that need a specific pool size (e.g. the pool-of-one leak test); application
 * code obtains database access through TenantDb only.
 */
export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections,
    application_name: options.applicationName ?? 'ogs-api',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}
