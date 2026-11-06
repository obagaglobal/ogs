import { Module } from '@nestjs/common';
import { WorkspaceContextService } from './workspace-context.service.js';

/** Workspace resolution. HTTP wiring (X-OGS-Workspace guard) arrives with sessions in Phase 3. */
@Module({
  providers: [WorkspaceContextService],
  exports: [WorkspaceContextService],
})
export class TenancyModule {}
