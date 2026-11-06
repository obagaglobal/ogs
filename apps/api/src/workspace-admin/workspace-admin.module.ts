import { Module } from '@nestjs/common';
import { WorkspaceAdminController } from './workspace-admin.controller.js';
import { WorkspaceAdminService } from './workspace-admin.service.js';

/** Members, custom roles and departments of a workspace (Phase 4). */
@Module({
  controllers: [WorkspaceAdminController],
  providers: [WorkspaceAdminService],
})
export class WorkspaceAdminModule {}
