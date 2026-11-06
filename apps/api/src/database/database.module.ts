import { Global, Module } from '@nestjs/common';
import { DatabaseHealth } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantDb } from './tenant-db.service.js';

/**
 * Global so every feature module can inject TenantDb. PrismaService is
 * deliberately not exported: the raw client never leaves this module.
 */
@Global()
@Module({
  providers: [PrismaService, TenantDb, DatabaseHealth],
  exports: [TenantDb, DatabaseHealth],
})
export class DatabaseModule {}
