import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env.js';

describe('parseApiEnv', () => {
  it('applies defaults for an empty environment', () => {
    expect(parseApiEnv({})).toEqual({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      API_CORS_ORIGINS: ['http://localhost:5173'],
    });
  });

  it('coerces the port and splits CORS origins', () => {
    const env = parseApiEnv({
      API_PORT: '4000',
      API_CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('accepts PostgreSQL and Redis connection URLs', () => {
    const env = parseApiEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/ogs',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.DATABASE_URL).toBeDefined();
    expect(env.REDIS_URL).toBeDefined();
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseApiEnv({ API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => parseApiEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('never echoes values in the error message', () => {
    const secret = 'postgresql-but-malformed-secret-value';
    try {
      parseApiEnv({ DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
