import { Module } from '@nestjs/common';
import { MeController, WorkspaceController } from './workspace.controller.js';
import { WorkspaceContextService } from './workspace-context.service.js';

/** Workspace resolution (used by AccessGuard) and the workspace endpoints. */
@Module({
  controllers: [MeController, WorkspaceController],
  providers: [WorkspaceContextService],
  exports: [WorkspaceContextService],
})
export class TenancyModule {}
