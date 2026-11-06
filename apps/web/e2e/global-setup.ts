import { existsSync } from 'node:fs';
import { Redis } from 'ioredis';

/**
 * Every browser in the e2e run signs up from 127.0.0.1, so repeated local runs
 * exhaust the per-IP registration limit (10/hour). Before each run, clear the
 * rate-limit counters on the LOCAL dev Redis only. Production limits are untouched.
 */
export default async function globalSetup(): Promise<void> {
  const apiEnv = new URL('../../api/.env', import.meta.url);
  if (existsSync(apiEnv)) {
    process.loadEnvFile(apiEnv);
  }
  const url = process.env['REDIS_URL'];
  if (url === undefined) {
    return;
  }
  const { hostname } = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('e2e global setup only resets a local Redis');
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
