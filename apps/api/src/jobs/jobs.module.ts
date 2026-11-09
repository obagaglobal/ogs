import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { AssigneeJobsService } from './assignee-jobs.service.js';
import { CustomerJobsController } from './customer-jobs.controller.js';
import { CustomerJobsService } from './customer-jobs.service.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobsController } from './jobs.controller.js';
import { PlatformJobsController } from './platform-jobs.controller.js';
import { StaffJobsService } from './staff-jobs.service.js';

/** Jobs, offers, assignments and field work (Phase 9). */
@Module({
  imports: [IdentityModule, ProvidersModule],
  controllers: [PlatformJobsController, JobsController, CustomerJobsController],
  providers: [StaffJobsService, AssigneeJobsService, CustomerJobsService, JobLifecycleService],
})
export class JobsModule {}
