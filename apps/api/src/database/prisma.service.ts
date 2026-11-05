import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TypedConfigService } from '../config/env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from './prisma.factory.js';

/**
 * Owns the process's PrismaClient and connection pool.
 *
 * Internal to DatabaseModule: it is NOT exported, so feature modules cannot
 * inject it. They use TenantDb, which always sets the RLS context first.
 */
@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(@Inject(ConfigService) config: TypedConfigService) {
    this.client = createPrismaClient({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      maxConnections: config.get('DATABASE_POOL_MAX', { infer: true }),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
