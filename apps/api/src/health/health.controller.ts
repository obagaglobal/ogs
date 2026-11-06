import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { HealthCheckResponse, ReadinessResponse } from '@ogs/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import { ReadinessService } from './readiness.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly readinessService: ReadinessService,
  ) {}

  /** Liveness: the process is up. Probes nothing, so it never fails because a dependency is down. */
  @Get()
  @Header('Cache-Control', 'no-store')
  check(): HealthCheckResponse {
    return this.healthService.check();
  }

  /** Readiness: 200 when PostgreSQL and Redis answer, otherwise 503 naming the failed dependency. */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.readinessService.check();
    response.status(result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
