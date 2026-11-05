import { healthCheckResponseSchema } from '@ogs/contracts';
import { describe, expect, it } from 'vitest';
import { APP_SERVICE_NAME, APP_VERSION } from '../app.constants.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('returns a payload that satisfies the shared contract', () => {
    const result = new HealthService().check();

    expect(healthCheckResponseSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.service).toBe(APP_SERVICE_NAME);
    expect(result.version).toBe(APP_VERSION);
  });
});
