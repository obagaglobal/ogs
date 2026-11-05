import { Injectable } from '@nestjs/common';
import { withTimeout } from '../common/with-timeout.js';
import { PrismaService } from './prisma.service.js';

const PING_TIMEOUT_MS = 2_000;

/** Readiness probe for PostgreSQL. Touches no table, so it needs no RLS context. */
@Injectable()
export class DatabaseHealth {
  constructor(private readonly prisma: PrismaService) {}

  async isUp(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, PING_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }
}
