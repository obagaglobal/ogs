import { existsSync } from 'node:fs';
import { Redis } from 'ioredis';

/**
 * Every browser in the e2e run signs in and signs up from 127.0.0.1, so the run
 * as a whole exceeds the per-IP limits (30 sign-ins per 15 minutes, 10 sign-ups
 * per hour) and later specs see "Too many attempts". The global setup and every
 * spec that signs in clear the rate-limit counters on the LOCAL Redis only (dev or
 * CI's service container). Production limits are untouched, and no e2e test
 * checks the limiter: the API's integration tests do.
 */
export async function resetRateLimits(): Promise<void> {
  const apiEnv = new URL('../../api/.env', import.meta.url);
  if (process.env['REDIS_URL'] === undefined && existsSync(apiEnv)) {
    process.loadEnvFile(apiEnv);
  }
  const url = process.env['REDIS_URL'];
  if (url === undefined) {
    return;
  }
  const { hostname } = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('e2e only resets the rate limits of a local Redis');
  }
  const prefix = process.env['QUEUE_PREFIX'] ?? 'ogs';
  const redis = new Redis(url);
  try {
    const keys = await redis.keys(`${prefix}:rl:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
}
