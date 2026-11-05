import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://ogs_app:pass@localhost:5432/ogs',
  REDIS_URL: 'redis://:pass@localhost:6379/0',
};

describe('parseApiEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(parseApiEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      API_CORS_ORIGINS: ['http://localhost:5173'],
      DATABASE_POOL_MAX: 10,
      QUEUE_PREFIX: 'ogs',
      OUTBOX_POLL_INTERVAL_MS: 1000,
      OUTBOX_BATCH_SIZE: 100,
    });
  });

  it('requires DATABASE_URL and REDIS_URL', () => {
    expect(() => parseApiEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('coerces the port and splits CORS origins', () => {
    const env = parseApiEnv({
      ...required,
      API_PORT: '4000',
      API_CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseApiEnv({ ...required, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => parseApiEnv({ ...required, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unsafe queue prefix', () => {
    expect(() => parseApiEnv({ ...required, QUEUE_PREFIX: 'Bad Prefix!' })).toThrow(/QUEUE_PREFIX/);
  });

  it('never echoes values in the error message', () => {
    const secret = 'postgresql-but-malformed-secret-value';
    try {
      parseApiEnv({ ...required, DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
