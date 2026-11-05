import { describe, expect, it } from 'vitest';
import { healthCheckResponseSchema, readinessResponseSchema } from './health.js';

describe('healthCheckResponseSchema', () => {
  const valid = {
    status: 'ok',
    service: 'ogs-api',
    version: '0.1.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    uptimeSeconds: 12,
  };

  it('accepts a valid payload', () => {
    expect(healthCheckResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown status', () => {
    expect(healthCheckResponseSchema.safeParse({ ...valid, status: 'down' }).success).toBe(false);
  });

  it('rejects a negative uptime', () => {
    expect(healthCheckResponseSchema.safeParse({ ...valid, uptimeSeconds: -1 }).success).toBe(
      false,
    );
  });
});

describe('readinessResponseSchema', () => {
  const valid = {
    status: 'not_ready',
    checks: { database: 'up', redis: 'down' },
    timestamp: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a valid payload', () => {
    expect(readinessResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects extra detail in a check', () => {
    expect(
      readinessResponseSchema.safeParse({ ...valid, checks: { database: 'up', redis: 'error' } })
        .success,
    ).toBe(false);
  });
});
