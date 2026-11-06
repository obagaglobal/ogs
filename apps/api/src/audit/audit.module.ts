import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/** Shared kernel (review §2, D10): any module may record audit entries. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
