import { describe, expect, it } from 'vitest';
import type { TypedConfigService } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { RateLimiter, RateLimiterUnavailable } from './rate-limiter.js';

describe('RateLimiter (A4)', () => {
  it('fails closed when Redis is unreachable', async () => {
    const config = {
      get: (key: string) => (key === 'REDIS_URL' ? 'redis://127.0.0.1:1/0' : 'ogs-unit'),
    } as unknown as TypedConfigService;
    const redis = new RedisService(config);
    const limiter = new RateLimiter(redis, config);
    limiter.onModuleInit();
    await expect(limiter.consume('loginPerIp', '203.0.113.9')).rejects.toBeInstanceOf(
      RateLimiterUnavailable,
    );
    await redis.onApplicationShutdown();
  });
});
