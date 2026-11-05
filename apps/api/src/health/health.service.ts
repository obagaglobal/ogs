import { Injectable } from '@nestjs/common';
import type { HealthCheckResponse } from '@ogs/contracts';
import { APP_SERVICE_NAME, APP_VERSION } from '../app.constants.js';

@Injectable()
export class HealthService {
  /** Liveness only: reports that the process is up. No external dependencies are probed. */
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      service: APP_SERVICE_NAME,
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
