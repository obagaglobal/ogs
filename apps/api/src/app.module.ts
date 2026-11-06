import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { HealthModule } from './health/health.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

/** The HTTP API. */
@Module({
  imports: [CoreModule, HealthModule, TenancyModule],
})
export class AppModule {}
