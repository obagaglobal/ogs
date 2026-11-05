import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Resolved relative to the working directory (apps/api when run via pnpm).
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    HealthModule,
  ],
})
export class AppModule {}
