import { Controller, Get, Header } from '@nestjs/common';
import type { HealthCheckResponse } from '@ogs/contracts';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  check(): HealthCheckResponse {
    return this.healthService.check();
  }
}
