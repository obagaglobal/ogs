import { Injectable } from '@nestjs/common';
import type { DependencyStatus, ReadinessResponse } from '@ogs/contracts';
import { DatabaseHealth } from '../database/index.js';
import { RedisService } from '../redis/redis.service.js';

const status = (up: boolean): DependencyStatus => (up ? 'up' : 'down');

/** Readiness: can this instance serve traffic that needs PostgreSQL and Redis? */
@Injectable()
export class ReadinessService {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [databaseUp, redisUp] = await Promise.all([this.database.isUp(), this.redis.isUp()]);
    return {
      status: databaseUp && redisUp ? 'ready' : 'not_ready',
      checks: { database: status(databaseUp), redis: status(redisUp) },
      timestamp: new Date().toISOString(),
    };
  }
}
