import { Global, Module } from '@nestjs/common';
import { AuthzSyncService } from './authz-sync.service.js';
import { PermissionService } from './permission.service.js';

/** Roles and permissions. The catalogue sync runs when the API starts. */
@Global()
@Module({
  providers: [PermissionService, AuthzSyncService],
  exports: [PermissionService, AuthzSyncService],
})
export class AuthzModule {}
