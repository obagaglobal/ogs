import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ReadinessService],
})
export class HealthModule {}
