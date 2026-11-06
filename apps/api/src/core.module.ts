import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/index.js';
import { EventsModule } from './events/events.module.js';
import { RedisModule } from './redis/redis.module.js';

/** Infrastructure shared by the API and the worker process. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Resolved relative to the working directory (apps/api when run via pnpm).
      // Variables already set in the process environment take precedence.
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    EventsModule,
  ],
})
export class CoreModule {}
