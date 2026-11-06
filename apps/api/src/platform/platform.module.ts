import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';

/** Cross-tenant staff endpoints (elevation). Grows with platform administration (Phase 14). */
@Module({
  controllers: [PlatformController],
})
export class PlatformModule {}
